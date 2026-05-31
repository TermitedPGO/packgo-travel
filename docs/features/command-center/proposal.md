# 指揮中心 (Command Center) — Proposal（§9.1 Stage 1：需求）

> PACK&GO 後台統一指揮中心。dev + 營運 agent 都掛上去,Jeff **一個地方看 + 審**。
> 本文件只談「要什麼 / 為什麼」。實作細節留給 Stage 2 `design.md`。
> **已拍板決策**：家 = AdminV2 新 tab;範圍 = 4 條營運 lane 全要(客服 / 報價 / 行銷 / 財務)+ dev 橋接。

---

## 1. 背景與問題
- PACK&GO = 一人公司(Jeff)。開發、客服、報價、行銷(小紅書 / 公眾號 / 微信)、SEO/AEO、財務全一個人扛。
- 現況工具散落:
  - **開發** 靠多個 Claude Code panes + 一份 markdown 看板協調。
  - **營運** 靠 app 內 autonomous agents(`server/agents/autonomous/*`,InquiryAgent 等)+ 一堆 `packgo-*` subagent / skill。
- 痛點:agent 各做各的,**沒有一個地方總覽 + 審核**。Jeff 要在多個視窗 / 平台間切換才知道發生什麼、才能批准。缺一個「進來看一眼就知道要處理什麼」的入口。

## 2. 目標
一個住在 **AdminV2** 的「指揮中心」tab = 3 塊:
1. **狀態(Status)** — 每個 agent 現在 / 昨晚做了什麼(dev + 營運都在這)。
2. **審核箱(Approval Inbox)** — agent 產出、等 Jeff 一個 yes/no 的東西(客服草稿 / 報價單 / 行銷貼文 / code 合併)。← **核心**。「一個地方看」真正的意思是「一個地方審」。
3. **班表 + 每週提案(Schedule & Weekly Proposal)** — 誰幾點醒來做事 + 上週數據 + 本週想做的事。

對齊 Jeff 的既定原則:「Inbox 首頁、auto-send 預設、每週政策提案」「自動化優先 + 萬不得已才人力 + 品質公平不可犧牲」。

## 3. 核心政策 — 自動 / 人工 的線（品質公平不可犧牲）
| Lane | agent 自動做 | **一定要 Jeff 按** |
|------|------------|-------------------|
| 客服回覆 | 草擬回覆(always) | 送出(v1 逐封批准;敏感如醫療 / 緊急 / 政治 / 客訴 / 退款 → 永遠人工) |
| 報價 | 拉供應商價、草擬報價單 | **出 PDF / 報給客人(永遠人工;碰錢 + CST §17550 trust)** |
| 行銷出稿 | 按主題草擬小紅書 / 公眾號 / 微信文 | 發布(人工審品牌語氣 + 客訊風格) |
| 財務監看 | 對帳 / 淨利 / Trust 每天每週跑、抓異常 | 只推警示,**永遠不自動動錢** |

**鐵律**:碰錢、不可逆、客人看得到的承諾 → 一律人工閘門。

## 4. 範圍
**v1（in）:** 指揮中心 shell(3 塊 UI)+ 審核箱資料模型 + **客服回覆**一條 lane 端到端跑通(證明脊椎)。
**後續 phase（in,同架構複製）:** 報價 / 行銷 / 財務監看 lane。
**dev 橋接:** 把 Claude Code 開發 agent(panes + 看板)的狀態 + 待合併,同步進指揮中心的狀態列與審核箱。dev 那半已 ~80% 在跑,**只差顯示**。

**v1 非目標（out）:**
- 真正全自動寄客人信(無審核)— v1 一律審。
- 跨平台(小紅書 / 公眾號 / 微信)自動發文 — 先草擬,發布人工(除非該平台有 API,留 design 評估)。
- 自動動錢 / 自動退款 — 永遠不做。
- 取代 AdminV2 其他既有 tab — 指揮中心是新增的總覽層,不重寫現有功能。

## 5. 使用者故事
**主線 — 週一早上:** Jeff 開 AdminV2 指揮中心 →
- 上排「夜班做了啥」:3 封新詢問已草擬回覆、UV 價格同步完、SEO 稽核出 2 個 fix。
- 中間「待你審」:3 封客服草稿(一鍵全送 or 逐封改)、1 張報價單(核單價)、1 個 PKG-C 合併(等 OK 才 push)。
- 下面「班表 + 本週提案」:response time、citation rate + 這週 agent 想做的事。

**Per-lane:**
- **客服**:新詢問進來 → InquiryAgent 草擬回覆 → 進審核箱 → Jeff 改 / 一鍵送 → 寄出(走 PKG-1 的 `sendInquiryReply`)。
- **報價**:詢問判定要報價 → agent 拉供應商價(Lion / UV)+ `packgo-quote` skill 草擬 → 進審核箱 → Jeff 核單價 → 出 PDF。
- **行銷**:排程或 Jeff 下主題 → `packgo-xiaohongshu` / `packgo-wechat-oa` 出草稿 → 進審核箱 → Jeff 改 → 發布。
- **財務**:每天 / 每週排程跑對帳 + 淨利(吃 PKG-C 單一真相)→ 正常無聲、異常進審核箱當警示。

## 6. 成功標準
- Jeff 進一個 tab 就看到「夜班做了什麼 + 待我處理什麼」,不再跨視窗。
- 客服 response time 顯著下降(草稿即時就緒)。
- **沒有任何客人看得到的東西**(回信 / 報價 / 貼文)在未過政策閘門下送出。
- 每條 lane 都有 Vitest(§9.6);tsc 0。

## 7. 分期（建議建造順序 — 待 Jeff 確認）
| Phase | 內容 | 前置 |
|-------|------|------|
| **0 脊椎** | 審核箱資料模型(新 table,⚠️ DB schema 變更 → **需單一 owner**)+ 指揮中心 shell(3 塊空殼 UI)+ dev 狀態橋接 | — |
| **1 客服 lane（pilot）** | 接 PKG-1 寄信 + InquiryAgent 草擬 → 審核箱 → 送。**先跑通這條證明整個脊椎** | PKG-1 |
| **2 報價 lane** | 接 supplier sync + `packgo-quote` | supplier-uv 第二輪落地 |
| **3 行銷 lane** | 接 `packgo-xiaohongshu` / `packgo-wechat-oa` | 各平台 API 評估 |
| **4 財務監看 lane** | 接 PKG-C 單一淨利真相 + 排程 | PKG-C |

> **為何客服當 pilot**:有真資料(inquiries)、乾淨的「草擬 → 審 → 送」迴圈(正是脊椎)、痛點最大、對外平台依賴最低。報價碰錢 + 等供應商重寫、財務等 PKG-C、行銷依賴外部平台 API → 都排後面。

## 8. 開放問題（留給 Stage 2 design）
- 審核箱 table schema:欄位(type / lane / riskLevel / payload / status / createdBy / decidedBy …)、**誰擁有這次 migration**(看板鐵律:DB schema 只能一條 session 動)。
- 排程機制:複用既有 BullMQ / Redis 還是 cron?Fly.io 上夜班怎麼跑。
- dev 橋接:Claude Code(在 app 外)的狀態怎麼寫進 app DB — webhook? 共用檔? coordinator 寫入 endpoint?
- 客服 auto-send 信心門檻(哪些未來可自動送、哪些永遠人工)— 接 `packgo-customer-service` 既有 escalation 設計。
- 行銷各平台(小紅書 / 公眾號 / 微信)有無可用 API;沒有就停在「草稿 + 人工發」。
- 安全:自動寄信 / 發文的權限邊界、audit log(複用 `server/_core/auditLog.ts`)。

## 9. 依賴與既有資產（不另起爐灶）
- **基建**:AdminV2 shell、tRPC、Drizzle/MySQL、Redis/BullMQ、logger、Sentry、auditLog。
- **既有 in-app agents**:`server/agents/autonomous/*`。
- **既有 Claude Code subagents / skills**:`packgo-customer-service`、`packgo-quote`、`packgo-flight-ticket`、`packgo-deposit`、`packgo-xiaohongshu`、`packgo-wechat-oa`、`packgo-seo`、`packgo-ai-citation`。
- **前置工作包(已在看板)**:PKG-1(客服寄信)= Phase 1 enabler;PKG-C(財務單一真相)= Phase 4 enabler。

---
_狀態:Stage 1 草案。Jeff 確認分期順序後 → 進 Stage 2 `design.md`(談 schema、排程、橋接的具體實作)。_
