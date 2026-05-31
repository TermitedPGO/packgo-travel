/**
 * financeAdvisor — 指揮中心 財務頁 AI 顧問 (P4).
 *
 * NOT an approval executor. This is a standalone AI agent that Jeff can ask
 * financial questions in the 財務 dashboard. It pulls real data from the
 * financial services, builds a context-rich system prompt, and uses invokeLLM
 * to answer.
 *
 * 鐵律 (hardcoded in system prompt + enforced here):
 *   - READ-ONLY financial advisor.
 *   - MUST NOT suggest or execute money transfers, trades, or transactions.
 *   - Only provides analysis, explanations, and recommendations.
 *   - Never generates prices (CLAUDE.md: AI 不准報價).
 */

import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "financeAdvisor" });

const SYSTEM_PROMPT_PREFIX = `You are a read-only financial advisor for PACK&GO Travel Agency (PACK&GO, LLC), a US-based travel agency in Newark, CA.

CRITICAL RULES — you MUST follow these at all times:
1. You are a READ-ONLY advisor. You MUST NOT suggest or execute any money transfers, trades, or transactions.
2. You MUST NOT generate prices, quotes, or pricing recommendations. Refer Jeff to the actual supplier backend for real prices.
3. Only provide analysis, explanations, and recommendations based on the data provided.
4. Trust Account (CST §17550): Customer deposits in Trust #5442 are NOT revenue until the trip completes AND funds move to Operating #2174.
5. Answer in the same language Jeff asks in (Traditional Chinese or English).
6. Keep answers concise and actionable. Use real numbers from the data below.

COMPANY CONTEXT:
- Single-member LLC, Jeff is the sole owner/operator
- Revenue: group tours (main) + commissions + visa services
- Bank accounts: Operating #2174 (day-to-day) + Trust #5442 (customer deposits, CST §17550)
- Tax: Schedule C filer, estimated quarterly taxes
- Categories follow Schedule C mapping (Line 1 = Gross receipts, Line 4 = COGS, etc.)
`;

/**
 * Pull current financial snapshot from services. Each call is wrapped in
 * try/catch so a single service failure doesn't block the entire advisor.
 */
async function buildFinancialContext(): Promise<string> {
  const sections: string[] = [];
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startDate = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const endDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  // 1. Current month P&L from bankPLService
  try {
    const { generateBankPL } = await import("../../services/bankPLService");
    const pl = await generateBankPL({ startDate, endDate });
    sections.push(`CURRENT MONTH P&L (${startDate} to ${endDate}):
- Gross Income: $${pl.income.total.toFixed(2)}
- Total Expenses: $${pl.expenses.total.toFixed(2)} (COGS: $${pl.expenses.cogs.toFixed(2)}, Operating: $${pl.expenses.operating.toFixed(2)})
- Refunds: $${pl.refunds.toFixed(2)}
- Trust Deferred Income: $${pl.trustDeferredIncome.toFixed(2)}
- Net Profit: $${pl.netProfit.toFixed(2)}
- Profit Margin: ${pl.profitMargin.toFixed(1)}%
- Transactions: ${pl.transactionCount} total, ${pl.needsReviewCount} need review
- Uncategorized amount: $${pl.needsReviewAmount.toFixed(2)}`);
  } catch {
    sections.push("CURRENT MONTH P&L: (data unavailable)");
  }

  // 2. Monthly trend from financialReportService
  try {
    const { generateMonthlyTrend } = await import(
      "../../services/financialReportService"
    );
    const trend = await generateMonthlyTrend(6);
    if (trend.length > 0) {
      const trendLines = trend.map(
        (t) =>
          `  ${t.month}: income=$${t.income.toFixed(0)} expenses=$${t.expenses.toFixed(0)} net=$${t.netProfit.toFixed(0)} deferred=$${t.trustDeferredIncome.toFixed(0)}`,
      );
      sections.push(`MONTHLY TREND (last 6 months):\n${trendLines.join("\n")}`);
    }
  } catch {
    sections.push("MONTHLY TREND: (data unavailable)");
  }

  // 3. Trust deferral status
  try {
    const { totalDeferredForUser, isTrustDeferralEnabled } = await import(
      "../../services/trustDeferralService"
    );
    if (isTrustDeferralEnabled()) {
      const deferred = await totalDeferredForUser({ asOfDate: endDate });
      sections.push(`TRUST ACCOUNT STATUS:
- Deferral enabled: yes
- Total currently deferred (unrecognized): $${deferred.toFixed(2)}
- These are customer prepayments held in Trust #5442, not yet recognized as income per CST §17550.`);
    } else {
      sections.push("TRUST ACCOUNT STATUS: Deferral feature is off (immediate recognition mode).");
    }
  } catch {
    sections.push("TRUST ACCOUNT STATUS: (data unavailable)");
  }

  // 4. Tax summary for current year
  try {
    const { generateTaxSummary } = await import(
      "../../services/financialReportService"
    );
    const tax = await generateTaxSummary(y);
    sections.push(`TAX SUMMARY (${y} YTD):
- Total Income: $${tax.totalIncome.toFixed(2)}
- Total Expenses: $${tax.totalExpenses.toFixed(2)}
- Tax-Deductible Expenses: $${tax.taxDeductibleExpenses.toFixed(2)}
- Estimated Taxable Income: $${tax.estimatedTaxableIncome.toFixed(2)}`);
  } catch {
    sections.push(`TAX SUMMARY (${y}): (data unavailable)`);
  }

  return sections.join("\n\n");
}

/**
 * Ask the finance advisor a question. Pulls real data, builds context-rich
 * prompt, calls invokeLLM, returns the text answer.
 */
export async function askFinanceAdvisor(question: string): Promise<string> {
  log.info({ questionLength: question.length }, "[financeAdvisor] question received");

  const financialContext = await buildFinancialContext();
  const systemPrompt = `${SYSTEM_PROMPT_PREFIX}\n--- REAL-TIME FINANCIAL DATA ---\n${financialContext}\n--- END DATA ---`;

  try {
    const { invokeLLM } = await import("../../_core/llm");
    const result = await invokeLLM({
      model: "claude-haiku-4-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      maxTokens: 1024,
    });

    const answer =
      typeof result.choices[0]?.message?.content === "string"
        ? result.choices[0].message.content
        : "Unable to generate a response. Please try again.";

    log.info(
      { answerLength: answer.length, model: result.model },
      "[financeAdvisor] answer generated",
    );
    return answer;
  } catch (err) {
    log.error({ err }, "[financeAdvisor] invokeLLM failed");
    return "Financial advisor is temporarily unavailable. Please try again later.";
  }
}
