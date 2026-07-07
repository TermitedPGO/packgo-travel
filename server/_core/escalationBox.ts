/**
 * escalationBox — escalation 進今日待辦的脊椎(批1 m3b).
 *
 * Agents escalate what they must not decide alone(客訴 / 退款 / 低信心詢問)
 * as agentMessages rows(messageType="escalation";B1 已把 title/body 寫成
 * 講人話)。Until now those only lived in the agent chat — this module
 * surfaces them in the workspace 需要你決定 bucket:
 *
 *   listEscalations        — every unread one(deliberately NOT windowed by
 *                            date: an old unread escalation must never
 *                            silently vanish)+ the most recent read ones,
 *                            dimmed, so a fresh ack stays visible/undoable.
 *   countUnreadEscalations — sidebar badge add-on for commandCenter.stats.
 *   ackEscalation          — 處理好了 toggle. Writes readByJeff — the SAME
 *                            state the agent-chat unread badge reads, so one
 *                            ack clears both surfaces (never two read-states
 *                            drifting apart).
 *
 * 批9 m1 (2026-06-12, Jeff 拍板「全部我核准」): escalations gained ONE
 * send path — sendEscalationReply — and it is Jeff-gated by construction:
 * it only fires from the workspace 編輯並回覆 dialog (🔒 checkbox confirm),
 * replies in the ORIGINAL Gmail thread via sendReplyInThread, and only
 * works on rows whose context carries the structured reply target
 * (gmailThreadId + customerEmail). Older rows degrade to view-only.
 * 鐵律不變:nothing here sends without Jeff's explicit click.
 */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  agentMessages,
  customerProfiles,
  users,
  gmailIntegration,
} from "../../drizzle/schema";
import { createChildLogger } from "./logger";
import { stripMarkdownForEmail } from "./plainTextReply";
import { REPLY_ATTACHMENT_KEY_PREFIX, type ReplyAttachmentRef } from "./replyAttachments";

const log = createChildLogger({ module: "escalationBox" });

/** Unread rows are capped only as a runaway safeguard, not a display window. */
const UNREAD_CAP = 50;
/** Read rows shown for undo context (dimmed at the bottom of the bucket). */
const READ_RECENT = 10;

export interface EscalationWho {
  /** Display name — registered user name, falling back to profile email. */
  label: string;
  /** users.id when the profile maps to a registered user; null = chip only. */
  userId: number | null;
}

export interface EscalationRow {
  id: number;
  agentName: string;
  title: string;
  body: string;
  /** InquiryAgent classification parsed from context JSON (null = unknown). */
  classification: string | null;
  /** 行程型態(context.tripType):custom_group/join_scheduled/free_independent/unclear。null=舊卡無此欄. */
  tripType: string | null;
  priority: "low" | "normal" | "high" | "critical";
  read: boolean;
  createdAt: Date;
  who: EscalationWho | null;
  /** 批9 m1 — AI 草稿(context.draftReply);null = 舊 row 無結構化欄位. */
  suggestedReply: string | null;
  /** card may offer 編輯並回覆 (context has gmailThreadId + customerEmail). */
  replyable: boolean;
  /** recipient shown in the gated confirm (「確認寄給 X」). */
  customerEmail: string | null;
  /**
   * 2026-06-13 tour-reference-resolve m3 — tours the resolver matched to the
   * customer's email (context.resolvedTours). Shown as a chip on the card so
   * Jeff jumps straight to /tour/:id to quote. draft-state tours are included
   * (Jeff-only view); the customer-facing draft never promises them.
   */
  resolvedTours: ResolvedTourChip[];
  /** code-shaped tokens the customer used that matched no tour (e.g. YG7). */
  unknownTourCodes: string[];
}

/** 批m3 — a resolved tour shown as a jump chip on the escalation card. */
export interface ResolvedTourChip {
  id: number;
  title: string;
  status: string;
}

/** Structured reply target parsed out of an escalation's context JSON. */
export interface EscalationReplyTarget {
  gmailThreadId: string;
  gmailMessageId: string | null;
  customerEmail: string;
  subject: string;
  draftReply: string | null;
}

/** Soft context parse: customerEmail MAY be null (recovered from the linked
 *  profile by the caller). Requires only gmailThreadId — the one thing not
 *  recoverable elsewhere. Returns null only on unparseable/non-object. */
export interface EscalationReplyContext {
  gmailThreadId: string | null;
  gmailMessageId: string | null;
  customerEmail: string | null;
  subject: string;
  draftReply: string | null;
  /** 批八 塊三 — generated customer-document PDFs attached to this draft, stored
   *  in the escalation context so they ride along on send. Namespace-guarded:
   *  each key must sit under reply-attachments/. Empty when none. Distinct from
   *  the inbound-email `attachments` field (that one is metadata for display). */
  replyAttachments: ReplyAttachmentRef[];
}

export function parseEscalationReplyContext(
  context: string | null,
): EscalationReplyContext | null {
  if (!context) return null;
  try {
    const p = JSON.parse(context) as Record<string, unknown>;
    if (p == null || typeof p !== "object" || Array.isArray(p)) return null;
    return {
      gmailThreadId:
        typeof p.gmailThreadId === "string" && p.gmailThreadId.trim()
          ? p.gmailThreadId
          : null,
      gmailMessageId:
        typeof p.gmailMessageId === "string" && p.gmailMessageId
          ? p.gmailMessageId
          : null,
      customerEmail:
        typeof p.customerEmail === "string" && p.customerEmail.trim()
          ? p.customerEmail.trim()
          : null,
      subject: typeof p.subject === "string" ? p.subject : "",
      draftReply:
        typeof p.draftReply === "string" && p.draftReply.trim()
          ? stripMarkdownForEmail(p.draftReply)
          : null,
      replyAttachments: parseReplyAttachments(p.replyAttachments),
    };
  } catch {
    return null;
  }
}

/**
 * 批八 塊三 — parse context.replyAttachments into namespace-guarded refs. Every
 * key MUST sit under reply-attachments/ (the outbound-attachment safety
 * boundary); anything else is dropped. Malformed entries are skipped, never
 * thrown on.
 */
function parseReplyAttachments(raw: unknown): ReplyAttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplyAttachmentRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (
      typeof a.key === "string" &&
      a.key.startsWith(REPLY_ATTACHMENT_KEY_PREFIX) &&
      typeof a.filename === "string" &&
      a.filename.trim().length > 0
    ) {
      out.push({ key: a.key, filename: a.filename });
    }
  }
  return out;
}

/**
 * 批9 m1 — strict reply target (gmailThreadId AND customerEmail present in
 * context). Kept for callers that want context-only resolution; the live
 * paths now recover customerEmail from the linked profile, see
 * resolveReplyTarget / listEscalations.
 */
export function parseEscalationReplyTarget(
  context: string | null,
): EscalationReplyTarget | null {
  const c = parseEscalationReplyContext(context);
  if (!c || !c.gmailThreadId || !c.customerEmail) return null;
  return {
    gmailThreadId: c.gmailThreadId,
    gmailMessageId: c.gmailMessageId,
    customerEmail: c.customerEmail,
    subject: c.subject,
    draftReply: c.draftReply,
  };
}

/**
 * 2026-06-13 — old escalation cards (pre batch-9 context fields) stored the
 * draft in the BODY, not context.draftReply. The body format (gmailPipeline)
 * is: "<reason>\n\n客人想問:...\n\n---\n建議回覆(還沒送出,給你過目):\n<draft>".
 * Pull the draft after that marker so the 編輯並回覆 dialog prefills it.
 */
export function extractDraftFromBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const markers = [
    "建議回覆(還沒送出,給你過目):",
    "建議回覆(還沒送出):",
    "建議回覆:",
  ];
  for (const m of markers) {
    const i = body.indexOf(m);
    if (i >= 0) {
      const draft = body.slice(i + m.length).trim();
      return draft ? stripMarkdownForEmail(draft) : null;
    }
  }
  // Older/English card format: "Draft (供你參考,**未送出**):\n<draft>".
  // Match the label loosely (the parenthetical wording + ** varied) so these
  // pre-fix cards still prefill the 編輯並回覆 dialog instead of an empty box.
  const m = body.match(/Draft\s*\([^)]*\)\s*[:：]\s*\n?/);
  if (m && m.index != null) {
    const draft = body.slice(m.index + m[0].length).trim();
    return draft ? stripMarkdownForEmail(draft) : null;
  }
  return null;
}

/**
 * Best-effort classification out of the message's context JSON. The context
 * shape is owned by each agent and may drift — malformed JSON or a missing
 * field returns null rather than throwing.
 */
export function parseEscalationClassification(
  context: string | null,
): string | null {
  if (!context) return null;
  try {
    const parsed = JSON.parse(context);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const c = (parsed as Record<string, unknown>).classification;
      if (typeof c === "string" && c.trim()) return c.trim();
    }
  } catch {
    // fall through
  }
  return null;
}

/** 行程型態(context.tripType);"unclear" 視為無意義 → null,卡片不顯示。 */
export function parseEscalationTripType(context: string | null): string | null {
  if (!context) return null;
  try {
    const parsed = JSON.parse(context);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const t = (parsed as Record<string, unknown>).tripType;
      if (typeof t === "string" && t.trim() && t !== "unclear") return t.trim();
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * 2026-06-13 m3 — pull resolvedTours + unknownTourCodes out of context JSON.
 * Both default to empty arrays (old cards have no such fields). Defensive:
 * each tour must have a numeric id + string title; status falls back to "".
 */
export function parseResolvedTours(context: string | null): {
  resolvedTours: ResolvedTourChip[];
  unknownTourCodes: string[];
} {
  const empty = { resolvedTours: [] as ResolvedTourChip[], unknownTourCodes: [] as string[] };
  if (!context) return empty;
  try {
    const parsed = JSON.parse(context);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const p = parsed as Record<string, unknown>;
    const resolvedTours = Array.isArray(p.resolvedTours)
      ? (p.resolvedTours as unknown[]).flatMap((t) => {
          if (!t || typeof t !== "object") return [];
          const o = t as Record<string, unknown>;
          if (typeof o.id !== "number" || typeof o.title !== "string") return [];
          return [
            {
              id: o.id,
              title: o.title,
              status: typeof o.status === "string" ? o.status : "",
            },
          ];
        })
      : [];
    const unknownTourCodes = Array.isArray(p.unknownTourCodes)
      ? (p.unknownTourCodes as unknown[]).filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0,
        )
      : [];
    return { resolvedTours, unknownTourCodes };
  } catch {
    return empty;
  }
}

type RawRow = {
  id: number;
  agentName: string;
  title: string;
  body: string;
  context: string | null;
  priority: "low" | "normal" | "high" | "critical";
  readByJeff: number;
  createdAt: Date;
  relatedCustomerProfileId: number | null;
};

/**
 * Unread escalations (all of them, newest first) + the most recent read ones.
 * Who is resolved relatedCustomerProfileId → customerProfiles → users with
 * two batched inArray lookups (zero per-row queries); a guest profile keeps
 * its email label with userId=null (chip without jump) — honest degradation,
 * same rule as approvalTaskWho.
 */
export async function listEscalations(): Promise<EscalationRow[]> {
  const db = await getDb();
  if (!db) {
    log.warn("[escalationBox] listEscalations: database not available");
    return [];
  }

  const baseSelect = {
    id: agentMessages.id,
    agentName: agentMessages.agentName,
    title: agentMessages.title,
    body: agentMessages.body,
    context: agentMessages.context,
    priority: agentMessages.priority,
    readByJeff: agentMessages.readByJeff,
    createdAt: agentMessages.createdAt,
    relatedCustomerProfileId: agentMessages.relatedCustomerProfileId,
  };

  const unread = (await db
    .select(baseSelect)
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.messageType, "escalation"),
        eq(agentMessages.readByJeff, 0),
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(UNREAD_CAP)) as RawRow[];

  const read = (await db
    .select(baseSelect)
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.messageType, "escalation"),
        eq(agentMessages.readByJeff, 1),
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(READ_RECENT)) as RawRow[];

  const rows = [...unread, ...read];

  const profileIds = [
    ...new Set(
      rows.flatMap((r) =>
        r.relatedCustomerProfileId != null
          ? [r.relatedCustomerProfileId]
          : [],
      ),
    ),
  ];

  const profileById = new Map<
    number,
    { id: number; userId: number | null; email: string | null }
  >();
  if (profileIds.length > 0) {
    const profiles = await db
      .select({
        id: customerProfiles.id,
        userId: customerProfiles.userId,
        email: customerProfiles.email,
      })
      .from(customerProfiles)
      .where(inArray(customerProfiles.id, profileIds));
    for (const p of profiles) profileById.set(p.id, p);
  }

  const userIds = [
    ...new Set(
      [...profileById.values()].flatMap((p) =>
        p.userId != null ? [p.userId] : [],
      ),
    ),
  ];
  const userById = new Map<number, { id: number; name: string | null }>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) userById.set(u.id, u);
  }

  return rows.map((r) => {
    const profile =
      r.relatedCustomerProfileId != null
        ? profileById.get(r.relatedCustomerProfileId)
        : undefined;
    const userName =
      profile?.userId != null
        ? userById.get(profile.userId)?.name?.trim()
        : undefined;
    const label = userName || profile?.email?.trim() || "";
    const ctx = parseEscalationReplyContext(r.context);
    // 2026-06-13 — recover customerEmail from the linked profile when the
    // context lacks it (pre-fix cards). gmailThreadId is always in context;
    // email is the only missing piece, and it's right here on the profile.
    const customerEmail = ctx?.customerEmail ?? profile?.email?.trim() ?? null;
    const suggestedReply = ctx?.draftReply ?? extractDraftFromBody(r.body);
    const replyable = Boolean(ctx?.gmailThreadId && customerEmail);
    const { resolvedTours, unknownTourCodes } = parseResolvedTours(r.context);
    return {
      id: r.id,
      agentName: r.agentName,
      title: r.title,
      body: r.body,
      classification: parseEscalationClassification(r.context),
      tripType: parseEscalationTripType(r.context),
      priority: r.priority,
      read: r.readByJeff !== 0,
      createdAt: r.createdAt,
      who: label ? { label, userId: profile?.userId ?? null } : null,
      suggestedReply,
      replyable,
      customerEmail,
      resolvedTours,
      unknownTourCodes,
    };
  });
}

/** Unread escalation count — additive field on commandCenter.stats. */
export async function countUnreadEscalations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.messageType, "escalation"),
        eq(agentMessages.readByJeff, 0),
      ),
    );
  return Number(rows[0]?.c ?? 0);
}

/**
 * 處理好了 ⇆ 未處理 for one escalation. handled=true marks it read (also
 * clearing the agent-chat unread badge); handled=false puts it back. Throws
 * on a missing row or a non-escalation message so the toggle can never
 * silently mutate some other inbox message.
 */
export async function ackEscalation(
  messageId: number,
  handled: boolean,
): Promise<{ id: number; read: boolean }> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }
  const rows = await db
    .select({
      id: agentMessages.id,
      messageType: agentMessages.messageType,
    })
    .from(agentMessages)
    .where(eq(agentMessages.id, messageId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`Message ${messageId} not found`);
  }
  if (row.messageType !== "escalation") {
    throw new Error(`Message ${messageId} is not an escalation`);
  }

  await db
    .update(agentMessages)
    .set(
      handled
        ? { readByJeff: 1, readAt: new Date() }
        : { readByJeff: 0, readAt: null },
    )
    .where(eq(agentMessages.id, messageId));

  log.info({ messageId, handled }, "[escalationBox] escalation acked");
  return { id: messageId, read: handled };
}

export interface EscalationReplyResult {
  sent: boolean;
  /** true = a kill switch downgraded the send to a dry run (nothing left). */
  dryRun: boolean;
  errorMessage?: string;
}

/**
 * 批9 m1 — Jeff 核准後把編輯過的回覆寄回原 Gmail thread。
 *
 * The ONLY caller is commandCenter.escalationReply, which only fires from
 * the workspace 編輯並回覆 dialog after the 🔒 checkbox — 鐵律(永不自動送)
 * 不變。Reuses the pipeline's sendReplyInThread (same thread, same from
 * address); on a real send the escalation is marked read and the sent body
 * is kept on the row (jeffResponse) for the record.
 */
export async function sendEscalationReply(
  messageId: number,
  body: string,
  attachments?: ReplyAttachmentRef[],
): Promise<EscalationReplyResult> {
  const db = await getDb();
  if (!db) return { sent: false, dryRun: false, errorMessage: "資料庫不可用" };

  const rows = await db
    .select({
      id: agentMessages.id,
      messageType: agentMessages.messageType,
      context: agentMessages.context,
      relatedCustomerProfileId: agentMessages.relatedCustomerProfileId,
    })
    .from(agentMessages)
    .where(eq(agentMessages.id, messageId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { sent: false, dryRun: false, errorMessage: `找不到訊息 ${messageId}` };
  }
  // email-auto-reply m2: 自動回留底卡(observation)也走同一條 Jeff-gated
  // 跟進更正路 — 仍然只有人手點 🔒 dialog 才會觸發。
  if (row.messageType !== "escalation" && row.messageType !== "observation") {
    return {
      sent: false,
      dryRun: false,
      errorMessage: "此訊息類型不支援回覆",
    };
  }

  const ctx = parseEscalationReplyContext(row.context);
  if (!ctx?.gmailThreadId) {
    return {
      sent: false,
      dryRun: false,
      errorMessage: "這封缺 Gmail 對話串資訊,無法回原信,請直接在 Gmail 回覆",
    };
  }
  // 2026-06-13 — recover customerEmail from the linked profile when context
  // lacks it (pre-fix cards). This un-sticks every existing escalation card.
  let customerEmail = ctx.customerEmail;
  if (!customerEmail && row.relatedCustomerProfileId != null) {
    const [prof] = await db
      .select({ email: customerProfiles.email })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, row.relatedCustomerProfileId))
      .limit(1);
    if (prof?.email?.trim()) customerEmail = prof.email.trim();
  }
  if (!customerEmail) {
    return {
      sent: false,
      dryRun: false,
      errorMessage: "找不到客人 email,無法寄出",
    };
  }
  const target: EscalationReplyTarget = {
    gmailThreadId: ctx.gmailThreadId,
    gmailMessageId: ctx.gmailMessageId,
    customerEmail,
    subject: ctx.subject,
    draftReply: ctx.draftReply,
  };

  // 2026-07-02 multi-account routing — the thread lives in WHICHEVER connected
  // account received the mail (poll/push iterate all active integrations), and
  // Gmail threadIds are per-mailbox. The old `.limit(1)` grabbed the first
  // active row regardless, so replying to a support@ thread through the other
  // account failed with "Requested entity was not found" while the UI showed
  // nothing. Order by id = the exact row the old limit(1) default picked, so
  // the previously-working case costs at most ONE probe; a single connected
  // account skips probing entirely (zero extra API calls).
  const integrations = await db
    .select()
    .from(gmailIntegration)
    .where(eq(gmailIntegration.isActive, 1))
    .orderBy(gmailIntegration.id);
  const { buildGmailClient, sendReplyInThread, threadExists } = await import(
    "./gmail"
  );
  const { resolveThreadOwner, describeNoThreadOwner } = await import(
    "./gmailAccountRouting"
  );
  const resolution = await resolveThreadOwner(integrations, (integ) =>
    threadExists(buildGmailClient(integ), target.gmailThreadId),
  );
  if (resolution.kind === "no_accounts") {
    return { sent: false, dryRun: false, errorMessage: "Gmail 整合未啟用" };
  }
  if (resolution.kind === "none") {
    log.error(
      {
        messageId,
        threadId: target.gmailThreadId,
        checked: resolution.checked,
        probeErrors: resolution.probeErrors,
      },
      "[escalationBox] no connected account owns the reply thread",
    );
    const { isAuthRevocationError } = await import("./gmailAuthFailure");
    const revoked = resolution.probeErrors.filter((p) =>
      isAuthRevocationError(p.message),
    );
    const base = describeNoThreadOwner(
      resolution.checked,
      resolution.probeErrors,
    );
    const errorMessage =
      revoked.length > 0
        ? `${base}(${revoked.map((p) => p.emailAddress).join("、")} 連線已失效,需要到設定重新連接 Gmail)`
        : base;
    return { sent: false, dryRun: false, errorMessage };
  }
  const integration = resolution.integration;
  log.info(
    {
      messageId,
      threadId: target.gmailThreadId,
      mailbox: integration.emailAddress,
      probed: resolution.kind === "owner",
    },
    "[escalationBox] reply routed to owning account",
  );

  // 2026-06-15 reply-attachments — load any attached files from R2, split into
  // inline parts vs >25MB download links (shared resolver, identical to the
  // inquiry path). Any failure here aborts the send with an honest message
  // rather than silently dropping an attachment the customer is expecting.
  // 批八 塊三 — merge the generated-document PDFs stored in the escalation
  // context (ctx.replyAttachments) with any caller-passed attachments, deduped
  // by key. This guarantees the receipt/quote PDF rides along on send even if
  // the frontend didn't re-pass it; keys are namespace-guarded at parse time.
  // Context wins on filename collision — it carries the human-readable Chinese
  // name (訂金收據.pdf), whereas the frontend derives an ascii name from the key.
  const attachmentsByKey = new Map<string, ReplyAttachmentRef>();
  for (const a of attachments ?? []) attachmentsByKey.set(a.key, a);
  for (const a of ctx.replyAttachments) attachmentsByKey.set(a.key, a);
  const mergedAttachments: ReplyAttachmentRef[] = [...attachmentsByKey.values()];

  // 批十二-1 (P0) — 送出前的附件誠實閘(純 code,零 LLM)。E2E F3:信本文寫「附在
  // 信裡」卻沒帶任何附件,客人收到看到寫有附件卻找不到。這裡在真正寄出前擋下:文案
  // 聲稱附上檔案但這封 mergedAttachments 為空 → 不寄,回可行動的錯誤逼 Jeff 先掛檔案
  // 或改掉字樣。用窄偵測器(只看附件宣稱),不跑抬頭/交付 gate 以免在寄送端誤擋。
  // 註:>25MB 檔會降級成下載連結,但那時 mergedAttachments.length>0(檔仍送達)→ 不擋。
  {
    const { detectAttachmentClaim } = await import(
      "../agents/autonomous/followupDraftHonesty"
    );
    if (detectAttachmentClaim(body) && mergedAttachments.length === 0) {
      log.warn(
        { messageId },
        "[escalationBox] body claims an attachment but none attached — blocking send",
      );
      return {
        sent: false,
        dryRun: false,
        errorMessage:
          "這封信寫了附上檔案,但實際沒有帶任何附件。請先產生並掛上文件(或把「附上/附在信裡」字樣拿掉)再寄一次。",
      };
    }
  }

  let finalBody = body;
  let inlineAttachments: import("./gmail").GmailAttachment[] | undefined;
  if (mergedAttachments.length > 0) {
    try {
      const {
        resolveReplyAttachments,
        appendDownloadLinksToBody,
        DOWNLOAD_LINK_TTL_SECONDS,
      } = await import("./replyAttachments");
      const { storageGetBytes, getSecureDocumentUrl } = await import("../storage");
      const resolved = await resolveReplyAttachments(mergedAttachments, {
        getBytes: (key) => storageGetBytes(key),
        makeLink: (key) => getSecureDocumentUrl(key, DOWNLOAD_LINK_TTL_SECONDS),
      });
      inlineAttachments = resolved.inline.length > 0 ? resolved.inline : undefined;
      finalBody = appendDownloadLinksToBody(body, resolved.links);
    } catch (err) {
      log.error({ messageId, err }, "[escalationBox] attachment resolution failed");
      return {
        sent: false,
        dryRun: false,
        errorMessage: "附件處理失敗,請重試或移除附件後再寄",
      };
    }
  }

  const gmail = buildGmailClient(integration);
  const send = await sendReplyInThread(gmail, {
    threadId: target.gmailThreadId,
    toEmail: target.customerEmail,
    subject: target.subject,
    bodyText: finalBody,
    fromEmail: integration.emailAddress,
    // Jeff clicked the gated confirm — this is a human-approved send, not
    // an autonomous one. The env-level AGENT_DRY_RUN switch still applies.
    confirmedAutoSendOk: true,
    inReplyToMessageId: target.gmailMessageId ?? undefined,
    attachments: inlineAttachments,
  });

  if (!send.ok) {
    log.error(
      { messageId, err: send.error },
      "[escalationBox] escalation reply send failed",
    );
    // 2026-06-13 — map a dead OAuth grant (invalid_grant) to an actionable
    // message instead of the cryptic raw error. The token genuinely needs
    // Jeff to reconnect Gmail; nothing retries its way out of this.
    const { isAuthRevocationError } = await import("./gmailAuthFailure");
    const errorMessage = isAuthRevocationError(send.error)
      ? "Gmail 連線已失效,需要重新授權:到設定重新連接 Gmail 後再寄一次"
      : send.error ?? "寄送失敗";
    return { sent: false, dryRun: false, errorMessage };
  }
  if (send.dryRun) {
    log.warn(
      { messageId, reason: send.reason },
      "[escalationBox] escalation reply downgraded to dry run",
    );
    return { sent: false, dryRun: true, errorMessage: send.reason };
  }

  await db
    .update(agentMessages)
    .set({ readByJeff: 1, readAt: new Date(), jeffResponse: finalBody })
    .where(eq(agentMessages.id, messageId));

  // 客戶往來時間軸補「我方回覆」(best-effort,絕不影響已寄出的結果)
  const { recordOutboundEmailInteraction } = await import(
    "./outboundInteraction"
  );
  const outboundResult = await recordOutboundEmailInteraction({
    customerEmail: target.customerEmail,
    body: finalBody,
    summary: `回覆:${target.subject || "(無主旨)"}(你核准寄出)`,
    generatedBy: "ai_draft_human_approved",
    // F5:這封回信沿同 thread 既有歸屬繼承 customOrderId(與 inbound 對稱)。
    gmailThreadId: target.gmailThreadId,
  });

  // customer-cockpit Phase6 A4 — 這封回覆改變了對話,摘要卡可能已過期;
  // fire-and-forget 排進去重算,不等 02:00 的 nightly cron(否則摘要卡會
  // 停在寄信前的舊狀態長達一整天)。整段包在 try 內:outboundResult 本身
  // 可能是 undefined(記錄失敗時的舊行為),存取屬性也不准炸掉已寄出的結果。
  try {
    if (outboundResult?.customerProfileId) {
      const { enqueueCustomerSummaryRefresh } = await import("../queue");
      await enqueueCustomerSummaryRefresh(outboundResult.customerProfileId);
    }
  } catch (err) {
    log.warn(
      { messageId, err: err instanceof Error ? err.message : String(err) },
      "[escalationBox] summary refresh enqueue failed (non-fatal)",
    );
  }

  // customer-cockpit Phase3 3a — 承諾追蹤(best-effort,絕不影響已寄出的結果)。
  // recordOutboundEmailInteraction 現在回傳它剛插入那筆的 interactionId/
  // customerProfileId(ResultSetHeader.insertId,跟 server/db.ts 同慣例),直接
  // 用這個當 sourceInteractionId —— 不再用「查這個 profile 最新一筆
  // outbound interaction」猜,那個寫法在同一客人短時間內並發寫入時會抓錯行
  // (race condition,已修)。fire-and-forget:不 await,錯誤在 promise 內部吞掉。
  void (async () => {
    try {
      if (!outboundResult.recorded || !outboundResult.interactionId || !outboundResult.customerProfileId) {
        return;
      }
      const { recordPromisesForInteraction } = await import("./promiseExtraction");
      const { todayLA } = await import("./customerFacts");
      await recordPromisesForInteraction({
        sourceInteractionId: outboundResult.interactionId,
        customerProfileId: outboundResult.customerProfileId,
        // F5:承諾跟著這封外寄 interaction 的歸屬走(thread 繼承來的 order,或 NULL)。
        customOrderId: outboundResult.customOrderId ?? null,
        emailBody: finalBody,
        todayLA: todayLA(),
      });
    } catch (err) {
      log.warn(
        { messageId, err: err instanceof Error ? err.message : String(err) },
        "[escalationBox] promise extraction hookup failed (non-fatal)",
      );
    }
  })();

  log.info(
    { messageId, to: target.customerEmail },
    "[escalationBox] escalation reply sent",
  );
  return { sent: true, dryRun: false };
}
