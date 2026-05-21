/**
 * agent.* global office-overview sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from the office sub-router
 * (and originally from the 2,804-LOC server/routers/agentRouter.ts). The
 * single `officeOverview` procedure is large enough (~370 LOC) that
 * isolating it keeps office.ts inside the 500-LOC budget while preserving
 * a coherent "global office floor plan" surface.
 *
 * Merges data from:
 *   - interactionOutcomes (Round 81 autonomous agents: inquiry/review/etc)
 *   - agentActivityLogs (tooling agents: master tour-gen / translation /
 *     calibration / etc — these write to agentActivityLogs as they run)
 *
 * Returns a department-grouped tree that the OfficeOverview tab renders
 * as the "office floor plan."
 *
 * Procedures (1):
 *   - officeOverview
 */

import { sql } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  interactionOutcomes,
  agentActivityLogs,
} from "../../../drizzle/schema";

export const overviewRouter = router({
  officeOverview: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { departments: [] };

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    // Round 81 agents — from interactionOutcomes
    const round81Rows = await db
      .select({
        agentName: interactionOutcomes.agentName,
        total: sql<number>`COUNT(*)`,
        today: sql<number>`SUM(CASE WHEN ${interactionOutcomes.createdAt} >= ${startOfDay} THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN ${interactionOutcomes.outcomeFinalized}=0 AND (${interactionOutcomes.actionTaken} LIKE '%escalate%' OR ${interactionOutcomes.confidence} < 70) THEN 1 ELSE 0 END)`,
        latestAt: sql<Date | null>`MAX(${interactionOutcomes.createdAt})`,
      })
      .from(interactionOutcomes)
      .groupBy(interactionOutcomes.agentName);

    const round81Map = new Map<string, (typeof round81Rows)[number]>();
    for (const r of round81Rows) round81Map.set(r.agentName, r);

    // Tooling agents — from agentActivityLogs
    const toolingRows = await db
      .select({
        agentKey: agentActivityLogs.agentKey,
        agentName: agentActivityLogs.agentName,
        total: sql<number>`COUNT(*)`,
        today: sql<number>`SUM(CASE WHEN ${agentActivityLogs.startedAt} >= ${startOfDay} THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${agentActivityLogs.status}='failed' THEN 1 ELSE 0 END)`,
        running: sql<number>`SUM(CASE WHEN ${agentActivityLogs.status}='started' AND ${agentActivityLogs.completedAt} IS NULL THEN 1 ELSE 0 END)`,
        latestAt: sql<Date | null>`MAX(${agentActivityLogs.startedAt})`,
      })
      .from(agentActivityLogs)
      .groupBy(agentActivityLogs.agentKey, agentActivityLogs.agentName);

    const toolingMap = new Map<string, (typeof toolingRows)[number]>();
    for (const r of toolingRows) {
      const key = r.agentKey ?? r.agentName;
      if (!key) continue;
      toolingMap.set(key, r);
    }

    // Department + agent definitions (curated for display)
    type DeptAgent = {
      id: string;
      name: string;
      persona: string;
      source: "round81" | "tooling";
      sourceKey: string;
      deepLink: string;
      colorTone: "emerald" | "blue" | "purple" | "amber" | "rose" | "slate";
      today: number;
      pending: number;
      latestAt: Date | null;
      isOnline: boolean;
      isLive: boolean;
    };

    function buildAgent(
      id: string,
      name: string,
      persona: string,
      source: DeptAgent["source"],
      sourceKey: string,
      deepLink: string,
      tone: DeptAgent["colorTone"],
      _isLiveHint: boolean, // kept for call-site compat; now ignored
    ): DeptAgent {
      let today = 0,
        pending = 0;
      let latestAt: Date | null = null;
      if (source === "round81") {
        const row = round81Map.get(sourceKey);
        if (row) {
          today = Number(row.today ?? 0);
          pending = Number(row.pending ?? 0);
          latestAt = row.latestAt ?? null;
        }
      } else {
        const row = toolingMap.get(sourceKey);
        if (row) {
          today = Number(row.today ?? 0);
          pending = Number(row.failed ?? 0);
          latestAt = row.latestAt ?? null;
        }
      }
      // isOnline: actual activity within last 1 hour
      const isOnline =
        latestAt != null &&
        now.getTime() - new Date(latestAt).getTime() < 60 * 60 * 1000;
      // isLive (v449+): computed from real activity in last 30 days. The
      // hardcoded "I think this exists" flag was misleading — claimed 14/19
      // online when most tooling agents hadn't run in months.
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const isLive =
        latestAt != null &&
        now.getTime() - new Date(latestAt).getTime() < THIRTY_DAYS;
      return {
        id,
        name,
        persona,
        source,
        sourceKey,
        deepLink,
        colorTone: tone,
        today,
        pending,
        latestAt,
        isOnline,
        isLive,
      };
    }

    const departments = [
      {
        name: "客戶經營部",
        icon: "users",
        description: "面對客戶的第一線 — 詢問、評論、退款、關懷",
        agents: [
          buildAgent(
            "inquiry",
            "InquiryAgent",
            "我看每一封新客戶來信,分類、起草、不確定時找你",
            "round81",
            "inquiry",
            "autonomous-agents",
            "emerald",
            true,
          ),
          buildAgent(
            "review",
            "ReviewAgent",
            "我審核並回覆每條評論,批評稱讚一視同仁",
            "round81",
            "review",
            "autonomous-agents",
            "blue",
            false,
          ),
          buildAgent(
            "followup",
            "FollowupAgent",
            "出發前 / 旅途中 / 回國後 三段式關懷",
            "round81",
            "followup",
            "autonomous-agents",
            "amber",
            false,
          ),
          buildAgent(
            "refund",
            "RefundAgent",
            "退款 triage,最終 escalate Jeff 親自決定",
            "round81",
            "refund",
            "autonomous-agents",
            "rose",
            false,
          ),
        ],
      },
      {
        name: "行銷部",
        icon: "megaphone",
        description: "推廣 / 內容 / 廣告素材",
        agents: [
          buildAgent(
            "marketing",
            "MarketingAgent",
            "我區隔受眾發 EDM,有 opt-out 和頻率上限",
            "round81",
            "marketing",
            "autonomous-agents",
            "purple",
            false,
          ),
          buildAgent(
            "marketing_content",
            "ContentAgent",
            "我為小紅書 / 微信 / FB / IG 寫貼文文案",
            "tooling",
            "marketingContent",
            "marketing-content",
            "purple",
            true,
          ),
          buildAgent(
            "posters",
            "PostersAgent",
            "我把供應商海報轉成 7 個平台的版本",
            "tooling",
            "posters",
            "posters",
            "purple",
            true,
          ),
        ],
      },
      {
        name: "行程生成部",
        icon: "plane",
        description: "Master 協同 9 個子 agent 自動生成完整行程",
        agents: [
          buildAgent(
            "master_tour_gen",
            "MasterAgent",
            "我是行程生成的指揮官,協同 9 個子 agent",
            "tooling",
            "master",
            "tours",
            "slate",
            true,
          ),
          buildAgent(
            "itinerary",
            "ItineraryAgent",
            "我把長 PDF 或網頁拆成 day-by-day 結構",
            "tooling",
            "itinerary",
            "tours",
            "slate",
            true,
          ),
          buildAgent(
            "image_gen",
            "ImageGenAgent",
            "我為每個行程生成 hero / 子景點圖",
            "tooling",
            "imageGeneration",
            "tours",
            "slate",
            true,
          ),
          buildAgent(
            "color_theme",
            "ColorThemeAgent",
            "我為每個行程選定品牌色調與字體",
            "tooling",
            "colorTheme",
            "tours",
            "slate",
            true,
          ),
          buildAgent(
            "calibration",
            "CalibrationAgent",
            "我抽查生成內容的品質,標記需 Jeff 複審的",
            "tooling",
            "calibration",
            "calibration-review",
            "slate",
            true,
          ),
          buildAgent(
            "translation",
            "TranslationAgent",
            "中 ↔ 英 雙向翻譯,保持品牌語氣",
            "tooling",
            "translation",
            "tours",
            "slate",
            true,
          ),
        ],
      },
      {
        name: "情報部",
        icon: "binoculars",
        description: "監控供應商網站 + 競品動態",
        agents: [
          buildAgent(
            "tour_monitor",
            "TourMonitor",
            "我盯著供應商網站,飯店 / 行程異動立刻通報",
            "tooling",
            "tourMonitor",
            "tour-monitor",
            "blue",
            true,
          ),
          buildAgent(
            "competitor",
            "CompetitorMonitor",
            "我追蹤同業價格 / 行程 / 文案變化",
            "tooling",
            "competitor",
            "competitor-monitor",
            "blue",
            true,
          ),
        ],
      },
      {
        name: "服務部",
        icon: "shield",
        description: "簽證、特殊需求",
        agents: [
          buildAgent(
            "visa_assistant",
            "VisaAssistant",
            "中國簽證申請流程 SOP,自動分流 ID 種類",
            "tooling",
            "visa",
            "visa",
            "amber",
            true,
          ),
          buildAgent(
            "ai_quotes",
            "QuotesAgent",
            "我把客戶詢價秒生報價單",
            "tooling",
            "aiQuotes",
            "ai-quotes",
            "amber",
            true,
          ),
        ],
      },
      {
        name: "AI 自學部",
        icon: "brain",
        description: "讓所有 agent 隨時間變更聰明",
        agents: [
          buildAgent(
            "self_retrospective",
            "RetrospectiveAgent",
            "每週讀所有 agent 的 outcomes,自動 update policy",
            "round81",
            "self_retrospective",
            "autonomous-agents",
            "slate",
            false,
          ),
          buildAgent(
            "skill_learner",
            "SkillLearner",
            "我把過去成功的 task pattern 變成可重用的 skill",
            "tooling",
            "skillLearner",
            "ai-hub",
            "slate",
            true,
          ),
        ],
      },
    ];

    // Aggregate office stats
    const allAgents = departments.flatMap((d) => d.agents);
    const totalToday = allAgents.reduce((s, a) => s + a.today, 0);
    const totalPending = allAgents.reduce((s, a) => s + a.pending, 0);
    const liveCount = allAgents.filter((a) => a.isLive).length;
    const onlineCount = allAgents.filter((a) => a.isOnline).length;

    return {
      departments,
      summary: {
        totalAgents: allAgents.length,
        liveCount,
        onlineCount,
        totalToday,
        totalPending,
      },
    };
  }),
});
