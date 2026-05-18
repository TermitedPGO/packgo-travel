/**
 * Round 81 — Office Assistant (#全體辦公群 responder).
 *
 * When Jeff posts in #全體 channel, this assistant replies with whatever
 * he asked — using a snapshot of the business state as context:
 *   - Active tours
 *   - Pending inquiries / escalations
 *   - Recent agent activity
 *   - Recent customer interactions
 *
 * Not one of the 5 specialist agents — this is the "company secretary"
 * that handles broad questions and can hand-off to specialists when
 * needed ("you should DM @InquiryAgent for that").
 */

import { type Message } from "../../_core/llm";
import { getDb } from "../../db";
import { agentMessages } from "../../../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { runChatWithToolLoop } from "./agentChat";

function buildSystemPrompt(): string {
  return `你是 PACK&GO 旅行社的「辦公室助理」(Office Assistant),不是 5 個專家 agent 之一。Jeff(老闆,一人公司)在「#全體辦公群」channel 提問或交代事情時,你負責回應。

【你的角色】
- 公司助理 / 同事(不是櫃台,不是客服)
- 你有完整 DB 讀取權限,**透過工具呼叫**:
  - list_active_tours / search_tours — 查行程
  - get_customer_by_email — 查客戶 + 近期互動
  - list_recent_bookings — 看訂單
  - list_agent_recent_outcomes / get_agent_active_policy — 看任何 agent 狀態
  - list_pending_for_jeff — 等他看的東西
  - list_recent_general_failures — 失敗的 tooling job(這影響 header 「等你看」的數字)
  - get_office_summary — 整體公司一眼快照
- Jeff 問什麼,**你就查什麼**。不要假裝沒權限。

【公司核心原則(永遠遵守)】
- 自動化第一,但 confidence 不足一律 escalate Jeff
- 品質公平,不可因 VIP 分數差別待遇
- 萬不得以才麻煩 Jeff,但該找他的絕不省

【回答規則】
1. 用繁體中文(除非 Jeff 用英文 / 簡中跟你說話)
2. **散文式** — 像同事說話,不要 markdown bullets 除非 Jeff 明確要清單
3. **簡潔** — 1-3 句通常夠。Jeff 沒時間看 FAQ。
4. **不知道就查工具,不要編造**
5. **永遠不要瞎掰 channel / tab 名** — 系統實際存在的只有 5 個 domain(辦公室 / 營運 / 客戶 / 行銷 / 系統)+ 6 個 channel(全體辦公群 + 5 個 agent DM)。**沒有** #待審核 / #退款 / #客訴 / #agent-監控 這種東西。
6. 數據顯示有 pattern 問題,主動講出來 + 提一句建議
7. 沒有「過度禮貌」開場 — Jeff 是老闆,直接答
8. 不要 emoji 滿天飛,每訊息最多 1 個`;
}

export async function runOfficeAssistant(
  jeffMessage: string
): Promise<{ reply: string }> {
  const db = await getDb();

  // Pull last 10 messages in #全體 for conversation context
  const recentGen = db
    ? await db
        .select({
          senderRole: agentMessages.senderRole,
          body: agentMessages.body,
          createdAt: agentMessages.createdAt,
        })
        .from(agentMessages)
        .where(eq(agentMessages.agentName, "general"))
        .orderBy(desc(agentMessages.createdAt))
        .limit(10)
    : [];

  // Build conversation history (skip the user's current message — that's appended last)
  const historyAsc = recentGen.reverse();
  const history: Message[] = historyAsc.slice(0, -1).map((m) => ({
    role: m.senderRole === "jeff" ? "user" : "assistant",
    content: m.body,
  }));
  history.push({ role: "user", content: jeffMessage });

  const reply = await runChatWithToolLoop(buildSystemPrompt(), history);
  if (!reply) throw new Error("OfficeAssistant returned empty reply");
  return { reply };
}
