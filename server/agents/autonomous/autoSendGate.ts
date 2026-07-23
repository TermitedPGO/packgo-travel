/**
 * autoSendGate — email 自動回覆的八步閘門(email-auto-reply m1)。
 *
 * 拍板(2026-06-12):信任階梯 — 影子先行收證據,達標類別 Jeff 親手開;
 * 達標線 20 封 + 95% 不改核准率;退款/投訴/報價/訂金/簽證永不自動。
 *
 * All gate decisions live in this PURE function so they can be unit-tested
 * exhaustively; gmailPipeline only executes the verdict. The post-LLM
 * safety blacklist (draft contains $ amounts / refund wording / password
 * resets) stays in the pipeline AFTER this gate — it can only ever
 * downgrade, never upgrade.
 *
 * Verdicts:
 *   "send"   — really send (Stage B, policy fully open for this class)
 *   "shadow" — record would_auto_send, send nothing (Stage A evidence)
 *   "draft"  — normal human-approval path (the default for everything)
 */

/**
 * 永不自動(硬編碼,改這裡才能動 — 刻意的摩擦)。碰錢碰法律的類別,
 * 任何政策 JSON 組合都繞不過。
 */
export const AUTO_SEND_HARD_EXCLUDED: ReadonlySet<string> = new Set([
  "refund_request",
  "complaint",
  "quote_request",
  "deposit_inquiry",
  "visa_inquiry",
]);

export interface AutoSendGateInput {
  classification: string;
  confidence: number;
  /** agent already decided this needs Jeff — auto-send never overrides. */
  shouldEscalate: boolean;
  hasAttachments: boolean;
  /** count of auto_replied outcomes so far today (cap source). */
  todaysAutoSent: number;
}

export interface AutoSendVerdict {
  verdict: "send" | "shadow" | "draft";
  /** machine-readable gate that decided; for logs + outcome context. */
  reason: string;
}

/** Missing/garbled policy keys default to the SAFE side, every time. */
export function readAutoSendPolicy(policy: Record<string, unknown> | null | undefined) {
  const p = policy ?? {};
  return {
    enabled: p.autoSendEnabled === true,
    minConfidence:
      typeof p.autoSendMinConfidence === "number" &&
      Number.isFinite(p.autoSendMinConfidence)
        ? p.autoSendMinConfidence
        : 90,
    // shadow defaults ON: a half-written policy must never silently go live
    shadowMode: p.autoSendShadowMode !== false,
    classes: Array.isArray(p.autoSendClasses)
      ? p.autoSendClasses.filter((c): c is string => typeof c === "string")
      : [],
    dailyCap:
      typeof p.autoSendDailyCap === "number" && p.autoSendDailyCap >= 0
        ? p.autoSendDailyCap
        : 10,
    // DEPRECATED (Codex 12:01 §五.1): attachments are now a HARD exclusion in
    // evaluateAutoSend — this key is kept only so the policy admin UI shape
    // stays stable; its value no longer opens anything.
    blockAttachments: true,
  };
}

export function evaluateAutoSend(
  input: AutoSendGateInput,
  policy: Record<string, unknown> | null | undefined,
): AutoSendVerdict {
  const p = readAutoSendPolicy(policy);

  // 0. master switch — off means not even shadow bookkeeping changes
  //    anything… EXCEPT we still want shadow evidence while OFF. Shadow is
  //    the Stage A default and runs regardless of the master switch; the
  //    master switch only gates REAL sends.
  if (input.shouldEscalate) return { verdict: "draft", reason: "escalated" };

  // 1. hard-coded exclusions — no policy combination can bypass
  if (AUTO_SEND_HARD_EXCLUDED.has(input.classification)) {
    return { verdict: "draft", reason: "hard-excluded-class" };
  }

  // 2. class allowlist. Empty list = nothing qualifies — BUT shadow mode
  //    still wants per-class evidence, so in shadow we evaluate the
  //    remaining gates as if the class were allowed.
  const classAllowed = p.classes.includes(input.classification);

  // 3. attachments — HARD exclusion, same tier as the money/legal classes
  //    (Codex 12:01 §五.1). Regex matchers were proven unable to bound
  //    natural-language read-failure wording across four independent fresh
  //    corpora, so attachment mail is suspended from autonomous send
  //    entirely: the PDF still parses and drafts, but a human sends. No
  //    policy key can reopen this — `autoSendBlockAttachments` is dead.
  //    Future re-enable = a separate controlled-template / structured-output
  //    project with shadow evidence, not more regex.
  if (input.hasAttachments) {
    return { verdict: "draft", reason: "has-attachments" };
  }

  // 4. confidence floor
  if (input.confidence < p.minConfidence) {
    return { verdict: "draft", reason: "below-confidence" };
  }

  // 5. daily cap (only matters for real sends; shadow is uncapped evidence)
  const capHit = input.todaysAutoSent >= p.dailyCap;

  // 6. (post-LLM blacklist runs in the pipeline after this gate)

  // 7/8. final routing
  if (p.enabled && !p.shadowMode && classAllowed) {
    if (capHit) return { verdict: "draft", reason: "daily-cap" };
    return { verdict: "send", reason: "all-gates-passed" };
  }
  // Everything that WOULD have sent under an open policy records shadow
  // evidence: class candidates only (hard exclusions already returned).
  return {
    verdict: "shadow",
    reason: classAllowed ? "shadow-mode" : "shadow-class-candidate",
  };
}
