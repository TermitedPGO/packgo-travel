/**
 * aiChatContextService.ts — enriches chatbot system prompt with LIVE tour
 * catalog data + funnel hooks (suggest /quote, suggest book, escalate to
 * inquiry).
 *
 * v78 motivation: the prior chatbot answered FAQ from a static system prompt
 * but couldn't reference real inventory. A customer asking "Do you have any
 * Japan tours in May under $3K?" got generic encouragement to "browse our
 * site" — high friction and low conversion. This service detects intent
 * from keywords, queries the real catalog, and injects up to 5 matching
 * tours into the system prompt so the AI can answer concretely.
 */

import { getDb } from "../db";
import { tours } from "../../drizzle/schema";
import { and, eq, like, or, gte, lte, desc } from "drizzle-orm";

export interface ChatEnrichment {
  systemPromptAddition: string;
  matchedTourCount: number;
  detectedIntent: string[];
  suggestionLinks: string[];
}

const COUNTRY_KEYWORDS: Record<string, { country: string; aliases: string[] }> = {
  japan: { country: "日本", aliases: ["日本", "東京", "大阪", "京都", "北海道", "沖繩", "japan", "tokyo", "osaka", "kyoto"] },
  korea: { country: "韓國", aliases: ["韓國", "首爾", "釜山", "korea", "seoul", "busan"] },
  taiwan: { country: "台灣", aliases: ["台灣", "taiwan"] },
  thailand: { country: "泰國", aliases: ["泰國", "曼谷", "清邁", "普吉", "thailand", "bangkok"] },
  europe: { country: "歐洲", aliases: ["歐洲", "europe", "巴黎", "倫敦", "羅馬", "瑞士", "義大利", "法國", "德國"] },
  usa: { country: "美國", aliases: ["美國", "美東", "美西", "紐約", "洛杉磯", "舊金山"] },
  newzealand: { country: "紐西蘭", aliases: ["紐西蘭", "new zealand", "奧克蘭", "皇后鎮"] },
  australia: { country: "澳洲", aliases: ["澳洲", "australia", "雪梨", "墨爾本"] },
  southamerica: { country: "南美", aliases: ["南美", "秘魯", "智利", "巴西", "阿根廷", "馬丘比丘"] },
  cruise: { country: "郵輪", aliases: ["郵輪", "cruise", "遊輪"] },
};

/**
 * Detect simple intent from the user message + recent history.
 */
function detectIntent(message: string, history: { role: string; content: string }[] = []): {
  destinationCountries: string[];
  budgetUSD?: number;
  budgetTWD?: number;
  isQuoteRequest: boolean;
  isBookingHelp: boolean;
  isVisaQuestion: boolean;
  isComplaintOrEscalation: boolean;
} {
  // Combine current message + last 2 turns of history for context
  const text = [message, ...history.slice(-4).map((h) => h.content)].join(" ").toLowerCase();

  const destinationCountries: string[] = [];
  for (const [, def] of Object.entries(COUNTRY_KEYWORDS)) {
    if (def.aliases.some((a) => text.includes(a.toLowerCase()))) {
      destinationCountries.push(def.country);
    }
  }

  // Budget detection
  let budgetUSD: number | undefined;
  let budgetTWD: number | undefined;
  const usdMatch = text.match(/\$\s*([0-9,]+)\s*(usd|美[元金]|k|千|萬)?/i);
  if (usdMatch) {
    let n = parseInt(usdMatch[1].replace(/,/g, ""), 10);
    const suffix = (usdMatch[2] || "").toLowerCase();
    if (suffix === "k" || suffix === "千") n *= 1000;
    if (suffix === "萬") n *= 10000;
    if (suffix.includes("usd") || /\$/.test(usdMatch[0])) budgetUSD = n;
    else if (suffix.includes("元")) budgetTWD = n;
  }
  const twdMatch = text.match(/(?:nt\$?|台幣|新台幣)\s*([0-9,]+)/i);
  if (twdMatch) {
    budgetTWD = parseInt(twdMatch[1].replace(/,/g, ""), 10);
  }

  return {
    destinationCountries,
    budgetUSD,
    budgetTWD,
    isQuoteRequest: /報價|quote|estimate|多少錢|how much|價錢|價格/i.test(text),
    isBookingHelp: /預訂|book|訂位|訂單|booking|付款|deposit|訂金/i.test(text),
    isVisaQuestion: /簽證|visa|護照|passport/i.test(text),
    isComplaintOrEscalation: /投訴|退款|refund|complaint|不滿|抱怨|聯絡|聯繫|找人/i.test(text),
  };
}

/**
 * Build the enrichment block to inject into the system prompt.
 */
export async function enrichChatContext(
  message: string,
  history: { role: string; content: string }[] = []
): Promise<ChatEnrichment> {
  const intent = detectIntent(message, history);

  const enrichment: ChatEnrichment = {
    systemPromptAddition: "",
    matchedTourCount: 0,
    detectedIntent: [],
    suggestionLinks: [],
  };

  // Tag detected intent for the AI's awareness
  if (intent.destinationCountries.length > 0) enrichment.detectedIntent.push(`destination:${intent.destinationCountries.join(",")}`);
  if (intent.budgetUSD) enrichment.detectedIntent.push(`budgetUSD:${intent.budgetUSD}`);
  if (intent.budgetTWD) enrichment.detectedIntent.push(`budgetTWD:${intent.budgetTWD}`);
  if (intent.isQuoteRequest) enrichment.detectedIntent.push("intent:quote");
  if (intent.isBookingHelp) enrichment.detectedIntent.push("intent:booking");
  if (intent.isVisaQuestion) enrichment.detectedIntent.push("intent:visa");
  if (intent.isComplaintOrEscalation) enrichment.detectedIntent.push("intent:escalation");

  const blocks: string[] = [];

  // 1) Inject real tour data when destination intent is detected
  if (intent.destinationCountries.length > 0) {
    const db = await getDb();
    if (db) {
      try {
        const conditions: any[] = [eq(tours.status, "active" as any)];
        const orList = intent.destinationCountries.flatMap((c) => [
          like(tours.destinationCountry, `%${c}%`),
          like(tours.title, `%${c}%`),
        ]);
        if (orList.length > 0) conditions.push(or(...orList)!);
        if (intent.budgetUSD) {
          // Convert USD budget to TWD for filtering (rough: 30:1)
          const twdBudget = intent.budgetUSD * 30;
          conditions.push(lte(tours.price, Math.ceil(twdBudget * 1.2)));
        }
        const matched = await db
          .select({
            id: tours.id,
            title: tours.title,
            destinationCity: tours.destinationCity,
            destinationCountry: tours.destinationCountry,
            duration: tours.duration,
            price: tours.price,
            heroSubtitle: tours.heroSubtitle,
          })
          .from(tours)
          .where(and(...conditions))
          .orderBy(desc(tours.featured), tours.price)
          .limit(5);

        if (matched.length > 0) {
          enrichment.matchedTourCount = matched.length;
          const list = matched
            .map(
              (t) =>
                `  - #${t.id} "${t.title}" — ${t.destinationCity || t.destinationCountry || ""}, ${t.duration} 天, NT$${t.price?.toLocaleString() || "?"}/人 — https://packgo-travel.fly.dev/tour/${t.id}`
            )
            .join("\n");
          blocks.push(`## 📚 即時行程資料庫（${matched.length} 個符合）
你可以引用以下實際存在的行程：
${list}

回答時：
- 提到行程時務必使用其實際標題與價格（不要編造）
- 結尾附上連結讓客戶可以直接查看詳情
- 若客戶問到價格細節（嬰兒、童價、單人房差），告訴客戶連結到行程詳情頁可看完整票價`);
        } else {
          blocks.push(`## ⚠️ 即時資料庫查詢結果
目前沒有完全符合 ${intent.destinationCountries.join("/")} ${intent.budgetUSD ? `預算 $${intent.budgetUSD}` : ""} 的現成行程。
建議引導客戶：
- 使用「AI 報價產生器」客製規劃：https://packgo-travel.fly.dev/quote
- 或直接聯繫客服 +1 (510) 634-2307`);
        }
      } catch (err) {
        console.warn("[aiChatContext] tour query failed:", (err as Error)?.message);
      }
    }
  }

  // 2) Quote request → suggest the AI quote generator
  if (intent.isQuoteRequest) {
    blocks.push(`## 💡 報價建議
客戶想要報價。引導他們使用「AI 報價產生器」（30 秒生 PDF 報價單）：
👉 https://packgo-travel.fly.dev/quote
或留下需求 + email，我們會在 1 個工作日內人工報價。`);
    enrichment.suggestionLinks.push("https://packgo-travel.fly.dev/quote");
  }

  // 3) Visa question
  if (intent.isVisaQuestion) {
    blocks.push(`## 📋 簽證相關
PACK&GO 提供中國簽證代辦服務。引導客戶到簽證頁面：
👉 https://packgo-travel.fly.dev/visa-services/china
其他國家簽證請建議客戶聯繫客服 +1 (510) 634-2307。`);
    enrichment.suggestionLinks.push("https://packgo-travel.fly.dev/visa-services/china");
  }

  // 4) Escalation / complaint → tell AI to NOT try to handle, escalate
  if (intent.isComplaintOrEscalation) {
    blocks.push(`## 🚨 升級處理
客戶可能有投訴、退款、或希望聯絡真人。**不要嘗試自行處理**，請：
1. 表達同理心
2. 取得他的聯絡方式（email + 訂單編號）
3. 告訴他你會請 Jeff 在 1 個工作日內親自回覆
4. 提供 +1 (510) 634-2307 / jeffhsieh09@gmail.com`);
  }

  enrichment.systemPromptAddition = blocks.length > 0 ? "\n\n" + blocks.join("\n\n") : "";
  return enrichment;
}
