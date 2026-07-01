/**
 * loadCustomerDocs (批3 M2) — the single source of truth for "this customer's
 * documents". Extracted verbatim from the customerDocs tRPC procedure
 * (server/routers/adminCustomers.ts) so BOTH the 文件 tab AND the customer-AI
 * engine read documents through the same identity-resolution + leak guards.
 *
 * Two consumers, two url needs:
 *   - 文件 tab (browser): signUrls=true → uploaded docs get a short-TTL signed
 *     download URL.
 *   - AI engine (server fetch): signUrls=false (default) → raw R2 key, fed
 *     straight to storageGetBytes by customerDocsText (no pointless sign→unsign
 *     round-trip).
 *
 * Identity resolution mirrors customerConversationThread: quotes/invoices keyed
 * by userId OR the account's verified email (guest: the profile's own email,
 * guarded by `userId IS NULL` so another account's row never leaks in); uploaded
 * docs / custom orders by the resolved profileId(s); flight orders by userId.
 */
import { eq, desc, sql, and, or, inArray, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import {
  quoteDoc,
  invoiceDoc,
  uploadedDoc,
  flightOrderDoc,
  customOrderDocs,
  signDocUrl,
  mergeDocs,
  type CustomerDoc,
} from "../routers/adminCustomersDocs";

export type CustomerDocsScope = { userId: number } | { profileId: number };

export async function loadCustomerDocs(
  scope: CustomerDocsScope,
  opts: { signUrls?: boolean } = {},
): Promise<CustomerDoc[]> {
  const drizzleDb = await getDb();
  if (!drizzleDb) return [];

  const {
    users: usersTable,
    customerProfiles,
    aiQuotes: aiQuotesTable,
    invoices: invoicesTable,
    customerDocuments,
    flightOrders,
    customOrders: customOrdersTable,
  } = await import("../../drizzle/schema");
  const isRegistered = "userId" in scope;

  let email: string | null = null;
  let userId: number | null = null;
  let profileIds: number[] = [];
  if (isRegistered) {
    userId = scope.userId;
    email =
      (
        await drizzleDb
          .select({ email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1)
      )[0]?.email ?? null;
    const profs = await drizzleDb
      .select({ id: customerProfiles.id })
      .from(customerProfiles)
      .where(
        email
          ? or(eq(customerProfiles.userId, userId), eq(customerProfiles.email, email))
          : eq(customerProfiles.userId, userId),
      );
    profileIds = profs.map((p) => p.id);
  } else {
    const prof = (
      await drizzleDb
        .select({ id: customerProfiles.id, email: customerProfiles.email })
        .from(customerProfiles)
        .where(eq(customerProfiles.id, scope.profileId))
        .limit(1)
    )[0];
    email = prof?.email ?? null;
    if (prof) profileIds = [prof.id];
  }

  // Quotes (q:) — owned by userId, OR UNATTRIBUTED under the email (userId IS
  // NULL guard prevents another account's quote leaking in).
  const quoteConds: SQL[] = [];
  if (userId != null) quoteConds.push(eq(aiQuotesTable.userId, userId));
  if (email)
    quoteConds.push(
      and(sql`${aiQuotesTable.userId} IS NULL`, eq(aiQuotesTable.customerEmail, email)) as SQL,
    );
  const quoteRows = quoteConds.length
    ? await drizzleDb
        .select({
          id: aiQuotesTable.id,
          quoteNumber: aiQuotesTable.quoteNumber,
          estimatedTotal: aiQuotesTable.estimatedTotal,
          currency: aiQuotesTable.currency,
          pdfUrl: aiQuotesTable.pdfUrl,
          status: aiQuotesTable.status,
          createdAt: aiQuotesTable.createdAt,
        })
        .from(aiQuotesTable)
        .where(or(...quoteConds))
        .orderBy(desc(aiQuotesTable.createdAt))
        .limit(50)
    : [];

  // Invoices (inv:) — same rule.
  const invConds: SQL[] = [];
  if (userId != null) invConds.push(eq(invoicesTable.userId, userId));
  if (email)
    invConds.push(
      and(sql`${invoicesTable.userId} IS NULL`, eq(invoicesTable.customerEmail, email)) as SQL,
    );
  const invoiceRows = invConds.length
    ? await drizzleDb
        .select({
          id: invoicesTable.id,
          invoiceNumber: invoicesTable.invoiceNumber,
          totalAmount: invoicesTable.totalAmount,
          currency: invoicesTable.currency,
          pdfUrl: invoicesTable.pdfUrl,
          status: invoicesTable.status,
          customOrderId: invoicesTable.customOrderId,
          createdAt: invoicesTable.createdAt,
        })
        .from(invoicesTable)
        .where(or(...invConds))
        .orderBy(desc(invoicesTable.createdAt))
        .limit(50)
    : [];

  // Uploaded docs (cd:) — email attachments / passport·visa scans, by profileId(s).
  const uploadedRows = profileIds.length
    ? await drizzleDb
        .select({
          id: customerDocuments.id,
          type: customerDocuments.type,
          fileName: customerDocuments.fileName,
          r2Url: customerDocuments.r2Url,
          customOrderId: customerDocuments.customOrderId,
          uploadedAt: customerDocuments.uploadedAt,
        })
        .from(customerDocuments)
        .where(inArray(customerDocuments.customerProfileId, profileIds))
        .orderBy(desc(customerDocuments.uploadedAt))
        .limit(50)
    : [];

  // Flight orders (fo:) — registered only (keyed by users.id).
  const flightRows =
    userId != null
      ? await drizzleDb
          .select({
            id: flightOrders.id,
            airline: flightOrders.airline,
            flightSummary: flightOrders.flightSummary,
            status: flightOrders.status,
            createdAt: flightOrders.createdAt,
          })
          .from(flightOrders)
          .where(eq(flightOrders.customerUserId, userId))
          .orderBy(desc(flightOrders.createdAt))
          .limit(50)
      : [];

  // Custom orders (co-confirm: / co-quote:) — confirmation + quote PDFs, by
  // profileId(s). Referenced PDFs (Jeff uploads/pastes); never carry supplier cost.
  const orderRows = profileIds.length
    ? await drizzleDb
        .select({
          id: customOrdersTable.id,
          orderNumber: customOrdersTable.orderNumber,
          title: customOrdersTable.title,
          quotePdfUrl: customOrdersTable.quotePdfUrl,
          quoteId: customOrdersTable.quoteId,
          confirmationPdfUrl: customOrdersTable.confirmationPdfUrl,
          quoteSentAt: customOrdersTable.quoteSentAt,
          confirmedAt: customOrdersTable.confirmedAt,
          createdAt: customOrdersTable.createdAt,
        })
        .from(customOrdersTable)
        .where(inArray(customOrdersTable.customerProfileId, profileIds))
        .orderBy(desc(customOrdersTable.createdAt))
        .limit(50)
    : [];

  // customerDocuments store the R2 KEY. For the browser list we sign each to a
  // short-TTL URL; for the AI engine we leave the raw key (storageGetBytes reads
  // it directly). signDocUrl: bare key → signed, full URL → passthrough, fail → null.
  let uploadedDocs = uploadedRows.map(uploadedDoc);
  if (opts.signUrls) {
    const { getSecureDocumentUrl } = await import("../storage");
    uploadedDocs = await Promise.all(
      uploadedDocs.map(async (d) => ({
        ...d,
        url: await signDocUrl(d.url, getSecureDocumentUrl),
      })),
    );
  }

  return mergeDocs([
    quoteRows.map(quoteDoc),
    invoiceRows.map(invoiceDoc),
    uploadedDocs,
    flightRows.map(flightOrderDoc),
    orderRows.flatMap(customOrderDocs),
  ]);
}
