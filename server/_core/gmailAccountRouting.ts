/**
 * gmailAccountRouting — 多 Gmail 帳號下,thread 專屬操作該走哪個帳號。
 *
 * 起因(2026-07-02 E2E 實錄):客人的信進 support@packgoplay.com(自己的
 * gmailIntegration row),Jeff 在草稿卡點確認發送,但 sendEscalationReply
 * 拿 integration 是 `.where(isActive=1).limit(1)` — 永遠抓第一個 active
 * row,不管 thread 屬於哪個帳號。Gmail 的 threadId 是 per-mailbox 的,
 * 拿錯帳號送信直接炸 `Requested entity was not found`(prod log 兩次),
 * 而 UI 收到 HTTP 200 什麼都沒顯示,Jeff 以為寄出去了。
 *
 * Poll / push workers 本來就 iterate 所有 active integrations
 * (gmailPollWorker / gmailPushWorker),所以 thread 可能住在任何一個
 * 連線帳號。這支提供:
 *
 *   resolveThreadOwner — 純 orchestrator,probe 由呼叫端注入
 *     (實際 probe = gmail.users.threads.get,見 gmail.ts threadExists),
 *     所以不用碰 Gmail 就能單元測試。
 *     - 0 個帳號 → no_accounts
 *     - 1 個帳號 → single(完全不 probe:單帳號常見情境零額外 API call,
 *       行為與修前相同;send 失敗時本來的錯誤路徑會誠實回報)
 *     - ≥2 個帳號 → 依傳入順序 probe(呼叫端把「修前預設」排第一,
 *       所以舊行為正確的情況最多多花一次 API call),第一個擁有
 *       thread 的帳號勝出;某帳號 probe 炸掉(如 invalid_grant)記下來
 *       繼續試別的,絕不因一個帳號壞掉就放棄整條路由。
 *     - 全部都沒有 → none + 誠實列出查過哪些帳號、哪些查不動。
 *
 *   isGmailNotFoundError — 純 classifier:threads.get 的 404 /
 *     "Requested entity was not found" = 「這個帳號沒有這條 thread」,
 *     其他錯誤(網路 / 授權)一律往上丟,不可以吞成 false(吞掉會把
 *     「token 壞了」誤讀成「不是這個帳號的信」)。
 */

/** 一個 probe 失敗的帳號(記錄下來,錯誤訊息要誠實列出)。 */
export interface ThreadProbeError {
  emailAddress: string;
  message: string;
}

export type ThreadOwnerResolution<T> =
  /** 沒有任何 active integration — 呼叫端照舊回「Gmail 整合未啟用」。 */
  | { kind: "no_accounts" }
  /** 只有一個帳號:直接用,沒 probe(零額外 API call)。 */
  | { kind: "single"; integration: T }
  /** probe 確認這個帳號擁有該 thread。 */
  | { kind: "owner"; integration: T }
  /** 沒有帳號擁有該 thread(或擁有者 probe 不動)。 */
  | {
      kind: "none";
      /** probe 過且確定「沒有這條 thread」的帳號(依 probe 順序)。 */
      checked: string[];
      /** probe 本身炸掉的帳號(token 壞 / 網路),沒能確認有沒有。 */
      probeErrors: ThreadProbeError[];
    };

/**
 * 純 orchestrator:對每個 candidate 依序跑注入的 probe,找出擁有
 * thread 的帳號。probe 回 true = 擁有;false = 沒有;throw = 查不動
 * (記進 probeErrors 繼續下一個)。順序即優先序 — 呼叫端負責把
 * 「修前預設」(id 最小的 active row)排第一。
 */
export async function resolveThreadOwner<T extends { emailAddress: string }>(
  integrations: T[],
  probe: (integration: T) => Promise<boolean>,
): Promise<ThreadOwnerResolution<T>> {
  if (integrations.length === 0) return { kind: "no_accounts" };
  if (integrations.length === 1) {
    return { kind: "single", integration: integrations[0] };
  }
  const checked: string[] = [];
  const probeErrors: ThreadProbeError[] = [];
  for (const integration of integrations) {
    try {
      if (await probe(integration)) {
        return { kind: "owner", integration };
      }
      checked.push(integration.emailAddress);
    } catch (err) {
      probeErrors.push({
        emailAddress: integration.emailAddress,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { kind: "none", checked, probeErrors };
}

/**
 * threads.get 的「這個帳號沒有這條 thread」判定。googleapis 的 GaxiosError
 * 帶 numeric `code`(有時是 string)+ `response.status`;訊息固定是
 * "Requested entity was not found."。三者任一命中都算 not-found。
 * 純函式 → 單元測試不用 googleapis。
 */
export function isGmailNotFoundError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };
  if (e.code === 404 || e.code === "404") return true;
  if (e.status === 404) return true;
  if (e.response && e.response.status === 404) return true;
  const msg =
    typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("requested entity was not found");
}

/**
 * kind="none" 的誠實錯誤訊息:列出查過的帳號 + 查不動的帳號。
 * invalid_grant 類的 probe 失敗由呼叫端(escalationBox)另外 map 成
 * 「重新授權」提示,這裡只負責事實陳述。純函式 → 單元測試。
 */
export function describeNoThreadOwner(
  checked: string[],
  probeErrors: ThreadProbeError[],
): string {
  const checkedPart =
    checked.length > 0 ? `已檢查:${checked.join("、")}` : "";
  const errorPart =
    probeErrors.length > 0
      ? `無法檢查:${probeErrors.map((p) => p.emailAddress).join("、")}`
      : "";
  const detail = [checkedPart, errorPart].filter(Boolean).join(";");
  return `這封信不在任何連線中的 Gmail 帳號裡(${detail}),沒有寄出。請直接在 Gmail 回覆,或重新連接該信箱後再試`;
}
