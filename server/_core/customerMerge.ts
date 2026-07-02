/**
 * customerMerge — 合併客人卡的機械核心 + 收信入口的 guest→member 自癒 (2026-07-02 G2)。
 *
 * 兩件事住在這裡:
 *
 * ① mergeCustomerProfiles — 從 opsTools 的 merge_into_customer case 抽出來的
 *    「機械合併」:externalId 撞卡先丟重複、四張表(互動/文件/專案/聊天)整份
 *    搬到目標卡、來源卡 block + 0109 mergedIntoProfileId 指標、Jeff 備註補一行
 *    日期戳、audit(customer.mergeInto)、目標卡 lastInboundAt 用 touchLastInbound
 *    重算(forward-only)、summary refresh。chat-facing 的驗證(target 用名字/
 *    email/編號解析、會員來源拒絕、循環 guard)留在 opsTools — 這裡只做搬運,
 *    行為與抽出前完全一致。
 *
 * ② resolveCanonicalForFiling — 收信入口自癒。真實事故(2026-07-02 E2E):
 *    jeffhsieh0909@gmail.com 同時有訪客卡 #2730001(userId NULL,6/6 建,
 *    整段信件史都在這)和會員卡 #2760017(userId 60001,6/24 註冊)。客人列表
 *    只顯示會員卡;來信按「同 email 最舊卡」歸到訪客卡 → 會員卡紅點永遠不亮、
 *    AI 摘要讀到過期的會員卡資料、訪客卡在 UI 又被搜尋去重藏掉。任何「先用
 *    訪客身分問價、之後才註冊」的真客人都會踩到。修法:進信解析到「訪客卡,
 *    且存在同 email 的會員卡(恰好一張)」→ 當場把訪客卡整份併進會員卡
 *    (跟 chat 合併工具同一套語意),再把新訊息 file 到會員卡。
 *
 *    兩道身分 guard(2026-07-02 review P1/P2):heal 只在「解析到的卡就是
 *    寄件人自己的訪客卡」(email 相同,大小寫不計)時開槍 — 被併走的聯絡人
 *    (leslie→Emerald)來信會 pointer-resolve 到別人的卡,在那裡 heal 等於
 *    跨身分合併+指標循環。會員候選卡也只認「活的」:帶 0109 指標(已併走)
 *    或 status=blocked(markNotCustomer 藏起來)的會員卡都不作 heal 目標,
 *    否則可見的訪客卡史整份搬進隱藏卡,之後來信在列表上永遠消失。
 *
 *    Idempotent:heal 過一次之後訪客卡帶 0109 指標,之後的來信
 *    followMergePointer 直接轉到會員卡,不會再合併第二次。0909 那對卡
 *    因此不需要任何資料遷移 — 下一封來信進來就自癒。
 *
 *    heal 失敗絕不弄斷收信:整段 try/catch,log.warn 後照舊 file 到訪客卡。
 */
import type { getDb } from "../db";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "customerMerge" });

/** Real drizzle handle (type-only import — no runtime dep on ../db). Both
 *  filing entrances and opsTools already hold exactly this type, and the
 *  shared touchLastInbound helper requires it. */
type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ── Pure date/note helpers (moved from opsTools with the merge core) ────────

/** Today's calendar date in America/Los_Angeles as "YYYY-MM-DD" (en-CA formats
 *  ISO-style). Jeff operates on LA time, so「7/21 還沒過」is judged in LA, not
 *  UTC — a late-evening LA chat must not roll the shorthand into next year. */
export function laToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
}

/**
 * Merge Jeff's private note (2026-07-01 P2 fix). The model has NO read path to
 * the old note, so a whole-field overwrite meant the second「備註加上X」silently
 * destroyed the first. The tool now owns the merge: a non-empty old note is
 * PRESERVED and the new text is appended as a dated line ([M/D], LA calendar —
 * the timezone Jeff operates in, per requirements §4.1). `replace:true` is the
 * only way to overwrite the whole field. Pure (clock injected via `now`) so
 * it's unit-tested without a DB.
 */
export function mergeCustomerNote(
  oldNote: string | null | undefined,
  newNote: string,
  replace: boolean,
  now: Date = new Date(),
): string {
  const next = newNote.trim();
  if (replace) return next;
  const prev = (oldNote ?? "").trim();
  if (!prev) return next;
  if (!next) return prev;
  const [, m, d] = laToday(now).split("-");
  return `${prev}\n[${Number(m)}/${Number(d)}] ${next}`;
}

/** mysql2-via-drizzle update/delete result → affected row count. The result
 *  shape varies by call path ([ResultSetHeader, …] or a bare header), so probe
 *  both. Non-numeric → 0 (never NaN into a count Jeff reads). */
function countAffected(r: any): number {
  const n = r?.[0]?.affectedRows ?? r?.affectedRows;
  return typeof n === "number" ? n : 0;
}

// ── Merge core ──────────────────────────────────────────────────────────────

export interface MergeSourceRow {
  id: number;
  userId: number | null;
  name: string | null;
  email: string | null;
  status: string | null;
  jeffPersonalNote: string | null;
}

export interface MergeTargetRow {
  id: number;
  name: string | null;
  email: string | null;
}

export interface MergeMoveCounts {
  interactions: number;
  documents: number;
  orders: number;
  chatMessages: number;
}

export interface MergeOutcome {
  targetProfileId: number;
  moved: MergeMoveCounts;
  duplicatesDropped: number;
  sourceLabel: string;
  targetLabel: string;
}

/**
 * Mechanically merge SOURCE profile into TARGET profile. Behavior is a 1:1
 * extraction of opsTools' merge_into_customer body (2026-07-02) — callers own
 * the chat-facing validation; this owns the moves. Throws on structural
 * problems (missing rows / member source / self-merge) — callers translate.
 *
 * `source` / `target` are optional preloaded rows: opsTools already reads them
 * for validation and passes them in so the query sequence (and the existing
 * opsTools tests' mocked row queue) stays exactly as before the extraction.
 */
export async function mergeCustomerProfiles(
  db: DrizzleDb,
  opts: {
    sourceProfileId: number;
    targetProfileId: number;
    /** goes into the audit row's ctx.user verbatim */
    actor: { id: number; email: string; role: string };
    /** goes into the audit row's reason verbatim */
    reason: string;
    source?: MergeSourceRow;
    target?: MergeTargetRow;
  },
): Promise<MergeOutcome> {
  const { sourceProfileId, targetProfileId, actor, reason } = opts;
  const { and, eq, inArray, isNotNull, sql: sqlRaw } = await import("drizzle-orm");
  const {
    customerProfiles,
    customerInteractions,
    customerDocuments,
    customOrders,
    customerChatMessages,
  } = await import("../../drizzle/schema");

  let source = opts.source;
  if (!source) {
    [source] = await db
      .select({
        id: customerProfiles.id,
        userId: customerProfiles.userId,
        name: customerProfiles.name,
        email: customerProfiles.email,
        status: customerProfiles.status,
        jeffPersonalNote: customerProfiles.jeffPersonalNote,
      })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, sourceProfileId))
      .limit(1);
  }
  if (!source) throw new Error(`merge source profile #${sourceProfileId} not found`);
  // Defensive invariant — the chat-facing refusal (with Jeff's wording) lives
  // in opsTools; this guards every OTHER caller: a registered member's history
  // must stay on the account, never be folded into someone else.
  if (source.userId != null)
    throw new Error(`merge source #${source.id} is a registered member — refusing`);

  let target = opts.target;
  if (!target) {
    [target] = await db
      .select({
        id: customerProfiles.id,
        name: customerProfiles.name,
        email: customerProfiles.email,
      })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, targetProfileId))
      .limit(1);
  }
  if (!target) throw new Error(`merge target profile #${targetProfileId} not found`);
  if (target.id === source.id) throw new Error("cannot merge a profile into itself");

  // customerInteractions carries uq(customerProfileId, externalId) — a cc'd
  // 同案聯絡人 often has the SAME email thread filed on both profiles, so a
  // blind move would hit a duplicate key. Drop the source's copies of
  // anything the target already has, then move the rest.
  const targetExt = await db
    .select({ externalId: customerInteractions.externalId })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customerProfileId, target.id),
        isNotNull(customerInteractions.externalId),
      ),
    )
    .limit(5000);
  const extIds = targetExt
    .map((r: { externalId: string | null }) => r.externalId)
    .filter((e: string | null): e is string => typeof e === "string" && e.length > 0);
  let duplicatesDropped = 0;
  if (extIds.length > 0) {
    const del = await db
      .delete(customerInteractions)
      .where(
        and(
          eq(customerInteractions.customerProfileId, source.id),
          inArray(customerInteractions.externalId, extIds),
        ),
      );
    duplicatesDropped = countAffected(del);
  }

  // Move the four tables. Idempotent by construction: a re-run finds the
  // source already empty and moves 0 rows, still成功.
  const moved: MergeMoveCounts = {
    interactions: countAffected(
      await db
        .update(customerInteractions)
        .set({ customerProfileId: target.id })
        .where(eq(customerInteractions.customerProfileId, source.id)),
    ),
    documents: countAffected(
      await db
        .update(customerDocuments)
        .set({ customerProfileId: target.id })
        .where(eq(customerDocuments.customerProfileId, source.id)),
    ),
    orders: countAffected(
      await db
        .update(customOrders)
        .set({ customerProfileId: target.id })
        .where(eq(customOrders.customerProfileId, source.id)),
    ),
    chatMessages: countAffected(
      await db
        .update(customerChatMessages)
        .set({ customerProfileId: target.id })
        .where(eq(customerChatMessages.customerProfileId, source.id)),
    ),
  };

  // customer-unread (0108) — 被併進來的互動裡可能有比目標卡現值更新的
  // inbound(實案:leslie 7/1 護照信併進 Emerald 後紅點沒亮):合併後重算
  // 目標卡 lastInboundAt = MAX(inbound createdAt),再交給 touchLastInbound
  // 條件式 UPDATE — 只往前推、永不倒退(跟各收信入口同一套 semantics)。
  // best-effort:紅點指針壞了不准弄死已經搬完資料的合併主流程。
  try {
    const [inboundMax] = await db
      .select({
        maxAt: sqlRaw<Date | string | null>`MAX(${customerInteractions.createdAt})`,
      })
      .from(customerInteractions)
      .where(
        and(
          eq(customerInteractions.customerProfileId, target.id),
          eq(customerInteractions.direction, "inbound"),
        ),
      );
    const maxAt = inboundMax?.maxAt;
    if (maxAt != null) {
      const ts = maxAt instanceof Date ? maxAt : new Date(maxAt);
      const { touchLastInbound } = await import("./customerUnread");
      await touchLastInbound(db, target.id, ts);
    }
  } catch (err) {
    log.warn(
      { err, targetProfileId: target.id },
      "[customerMerge] merge: lastInboundAt recompute failed (non-fatal, red dot only)",
    );
  }

  // Hide the duplicate + leave a dated trace in Jeff's note (append via
  // mergeCustomerNote — the existing note is never destroyed).
  const targetLabel = target.name || target.email || `#${target.id}`;
  const sourceLabel = source.name || source.email || `#${source.id}`;
  const mergedNote = mergeCustomerNote(
    source.jeffPersonalNote ?? null,
    `已併入 ${targetLabel} (#${target.id})`,
    false,
  );
  await db
    .update(customerProfiles)
    .set({
      status: "blocked",
      // 0109 結構化指標:歸檔入口(收信/寄信/附件/詢問)認到這張卡時,
      // followMergePointer 會轉到目標卡落資料 — 沒有它,leslie 這種被併走
      // 的 email 之後來信會掉進隱藏卡,列表永遠看不到。
      mergedIntoProfileId: target.id,
      jeffPersonalNote: mergedNote || null,
      updatedAt: new Date(),
    })
    .where(eq(customerProfiles.id, source.id));

  // Audit trail (same pattern as update_booking_status).
  const { audit } = await import("./auditLog");
  await audit({
    ctx: { user: actor },
    action: "customer.mergeInto",
    targetType: "customerProfile",
    targetId: source.id,
    changes: {
      before: { status: source.status },
      after: { status: "blocked", mergedInto: target.id, moved, duplicatesDropped },
    },
    reason,
  });

  // Refresh the target's driver-bar / summary so the merged history shows
  // up immediately (same bump create_custom_order does).
  void import("../queue")
    .then((m) => m.enqueueCustomerSummaryRefresh(target!.id))
    .catch(() => {});

  log.info(
    {
      sourceProfileId: source.id,
      targetProfileId: target.id,
      moved,
      duplicatesDropped,
      reason,
    },
    "[customerMerge] merge executed",
  );

  return {
    targetProfileId: target.id,
    moved,
    duplicatesDropped,
    sourceLabel,
    targetLabel,
  };
}

// ── Filing-entrance auto-heal (guest + member with the same email) ──────────

/** Actor stamped on auto-heal audit rows — there is no admin in the mail loop. */
const AUTO_HEAL_ACTOR = { id: 0, email: "system-auto-heal", role: "system" } as const;

export type FilingHealDecision =
  | { heal: true; targetProfileId: number }
  | {
      heal: false;
      reason:
        | "profile_missing"
        | "already_member"
        | "email_mismatch"
        | "no_member_match"
        | "multiple_member_matches";
    };

/** Case/whitespace-insensitive email normalization for the heal guards. */
function normalizeHealEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

/**
 * Pure decision core for the filing heal — unit-tested without a DB.
 * Cap (deliberate): heal fires ONLY for exactly this shape — the resolved
 * profile is a GUEST (userId NULL) whose OWN email is the filing email, and
 * there is exactly ONE live member card (userId NOT NULL, no 0109 pointer,
 * not blocked) with the same email. Anything else (member resolved directly,
 * pointer landed on another person's card, no member twin, several member
 * twins) files unchanged; ambiguous multi-member data is
 * duplicateProfileScan's job, not an inline guess.
 */
export function decideFilingHeal(input: {
  /** the inbound mail's sender email — the identity actually being filed */
  filingEmail: string;
  resolved:
    | { id: number; userId: number | null; email: string | null }
    | null
    | undefined;
  memberMatches: Array<{
    id: number;
    mergedIntoProfileId?: number | null;
    status?: string | null;
  }>;
}): FilingHealDecision {
  const resolved = input.resolved;
  if (!resolved) return { heal: false, reason: "profile_missing" };
  if (resolved.userId != null) return { heal: false, reason: "already_member" };
  // P1 guard (2026-07-02 review): the heal may only fire on the sender's OWN
  // guest card. After a contact-person merge (the live leslie→Emerald shape),
  // mail from the merged-away address pointer-resolves to a DIFFERENT person's
  // card; healing there would fold that person's whole case into the sender's
  // member card (cross-identity merge) and, when the member twin is the
  // pointered source itself, write a mergedIntoProfileId CYCLE that hides both
  // cards and re-runs the merge on every inbound. Email mismatch = normal
  // post-merge contact filing — leave it alone.
  const filingEmail = normalizeHealEmail(input.filingEmail);
  if (!filingEmail || normalizeHealEmail(resolved.email) !== filingEmail)
    return { heal: false, reason: "email_mismatch" };
  const members = input.memberMatches.filter(
    (m) =>
      // Defensive self-exclusion: the resolved guest can never be its own
      // member twin, but a caller passing an unfiltered list must not
      // self-merge.
      m.id !== resolved.id &&
      // P1: a merged-away card is not a live target — its history lives at
      // the end of its 0109 pointer; merging into it re-hides everything.
      m.mergedIntoProfileId == null &&
      // P2: markNotCustomer keeps userId but sets status=blocked (hidden).
      // Merging a visible guest into a hidden card makes all future mail
      // invisible on every surface — the exact symptom this heal fights.
      m.status !== "blocked",
  );
  if (members.length === 0) return { heal: false, reason: "no_member_match" };
  if (members.length > 1) return { heal: false, reason: "multiple_member_matches" };
  return { heal: true, targetProfileId: members[0].id };
}

/**
 * Resolve an email-matched profile id to the card new mail should be FILED to.
 * Shared by both filing entrances (gmailPipeline sender resolution and
 * ensureCustomerByEmail / 收-collect) so they stay one-line:
 *
 *   1. followMergePointer — already-merged cards route to their canonical card.
 *   2. Auto-heal (2026-07-02 G2): resolved card is the sender's OWN guest card
 *      (same email — a pointer that landed on another person's card never
 *      heals) and exactly one LIVE member card (no 0109 pointer, not blocked)
 *      shares the email → merge guest into member (full mergeCustomerProfiles
 *      semantics: moves, block+pointer, audit, touchLastInbound, summary
 *      refresh), then file to the member.
 *
 * Idempotent: after the first heal the guest carries the 0109 pointer, so the
 * next call short-circuits at step 1. The 0909 pair (guest #2730001 / member
 * #2760017) therefore heals itself on the next inbound — no data migration.
 *
 * NEVER throws: any heal failure logs a warning and returns the
 * pointer-resolved id, filing to the guest exactly as before the heal existed
 * — mail processing must not break because dedup hiccuped.
 */
export async function resolveCanonicalForFiling(
  db: DrizzleDb,
  profileId: number,
  email: string | null | undefined,
): Promise<number> {
  const { followMergePointer } = await import("./mergedProfile");
  const resolvedId = await followMergePointer(db, profileId);
  if (!email) return resolvedId;
  try {
    const { and, eq, isNotNull, isNull, ne } = await import("drizzle-orm");
    const { customerProfiles } = await import("../../drizzle/schema");
    const [resolved] = await db
      .select({
        id: customerProfiles.id,
        userId: customerProfiles.userId,
        name: customerProfiles.name,
        email: customerProfiles.email,
        status: customerProfiles.status,
        jeffPersonalNote: customerProfiles.jeffPersonalNote,
      })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, resolvedId))
      .limit(1);
    // Fast path (the vast majority of inbound mail): member card, or the row
    // vanished — nothing to heal.
    if (!resolved || resolved.userId != null) return resolvedId;

    const memberMatches: Array<{
      id: number;
      name: string | null;
      email: string | null;
      mergedIntoProfileId: number | null;
      status: string | null;
    }> = await db
      .select({
        id: customerProfiles.id,
        name: customerProfiles.name,
        email: customerProfiles.email,
        mergedIntoProfileId: customerProfiles.mergedIntoProfileId,
        status: customerProfiles.status,
      })
      .from(customerProfiles)
      .where(
        and(
          eq(customerProfiles.email, email),
          isNotNull(customerProfiles.userId),
          ne(customerProfiles.id, resolvedId),
          // P1: a merged-away「member」card is a dead target (its history
          // lives at the end of its 0109 pointer) — never heal into it.
          isNull(customerProfiles.mergedIntoProfileId),
          // P2: a markNotCustomer'd member (status=blocked, userId kept) is
          // hidden — merging a visible guest into it makes all future mail
          // invisible. status is NOT NULL default 'active', so ne() is safe.
          ne(customerProfiles.status, "blocked"),
        ),
      )
      .limit(3);

    // decideFilingHeal owns the FULL decision (email-identity guard + live
    // member filters, duplicated defensively from the SQL above); this wiring
    // only fetches candidates and executes.
    const decision = decideFilingHeal({ filingEmail: email, resolved, memberMatches });
    if (!decision.heal) {
      if (decision.reason === "multiple_member_matches") {
        // 不猜 — 留給每週 duplicateProfileScan 浮到 Jeff 的 inbox 人工併。
        log.warn(
          { guestProfileId: resolvedId, memberIds: memberMatches.map((m) => m.id) },
          "[customerMerge] filing heal skipped: several member cards share this email",
        );
      }
      return resolvedId;
    }

    const target = memberMatches.find((m) => m.id === decision.targetProfileId)!;
    await mergeCustomerProfiles(db, {
      sourceProfileId: resolvedId,
      targetProfileId: target.id,
      actor: AUTO_HEAL_ACTOR,
      reason: `auto-heal guest→member same-email merge (filing entrance, source=${resolvedId} target=${target.id})`,
      source: resolved,
      target,
    });
    log.info(
      { guestProfileId: resolvedId, memberProfileId: target.id },
      "[customerMerge] filing auto-heal: guest card merged into same-email member card",
    );
    return target.id;
  } catch (err) {
    // heal 失敗絕不弄斷收信 — 照舊 file 到訪客卡,下一封再試。
    log.warn(
      { err, profileId: resolvedId },
      "[customerMerge] filing auto-heal failed (non-fatal) — filing to the original card",
    );
    return resolvedId;
  }
}
