# 批8 — 系統(乾淨黑白 power 頁,6 tab 合一)

> Stage 3 task 文件。設計依據:後台_10_系統.html(單頁 5 段)+ redesign-39.md 縮編拍板。
> 定位:「覺得哪裡不對勁才來查的頁」— 唯讀為主,乾淨黑白,不硬塞 worklist 卡。
> 吸收:autonomous-agents · skills · llm-cost · task-history · audit-log · ai-hub(cleanup 已降級為對話指令)。

## 實況調查(2026-06-11)

### 資料線(全部既有,零新後端)
- 自主 Agent:`adminAgents.getAgentOfficeStatus` → agentTodayStats(agentName/calls 7d/lastActive)+ activities
- AI 技能:`skills.list`(skillName/skillType/description/isActive/usageCount)+ `skills.getStats`
- AI 成本:`admin.llmCostReport {days}` → {totalUSD, totalCalls, cacheHitRate, days[{date, totalUSD, perModel[{model, costUSD}]}]}
- 任務記錄:`admin.getTaskHistory {limit}` → {logs[{taskTitle, agentName, status started/completed/failed/idle, startedAt, processingTimeMs, errorMessage}], summary}
- 審計日誌:`system.auditLogList {limit}` → {items[{userEmail, userRole, action, targetType, targetId, success, createdAt}]}

### Mockup 對照與誠實 gap
- agent 表「R:開關」:**無 enable/disable 後端**(agents 為 cron 驅動)→ v1 不放 toggle,記 gap
- 技能「測試跑一次」:**無 run-once mutation**(skills.aiLearn 是關鍵字學習非試跑)→ v1 列表唯讀,記 gap
- 其餘 5 段全部資料線齊
- 入口:WorkspaceCompany 第 7 sub-item「系統」(mockup sidebar = company-系統)

## Milestones(單一 milestone,頁面小)

### m1 — WorkspaceSystem 單頁 5 段 ✅
- [x] sidebar + WorkspaceCompany 加 "system" sub-item(置尾)
- [x] 自主 Agent 段:7 天統計表(名稱/呼叫數/上次活動)
- [x] AI 技能段:列表(名稱/說明/啟用/使用數)
- [x] AI 成本段:tiles(今日/近 30 天/呼叫數)+ provider 分布 + 快取命中率
- [x] 任務記錄段:近 10 筆(時間/任務/狀態 chip,failed 帶 errorMessage)
- [x] 審計段:近 10 筆(時間/誰 Jeff⚫/agent🤖/動作)
- [x] cleanup note(清理已降級為對話指令)
- [x] i18n · tsc 0 · Vitest(成本 tiles 推導/audit actor 判別)

## DoD
- [x] tsc 0 · 全套 Vitest 綠(2219 passed)· i18n parity 7296 keys · 300 行紅線(2 檔 138/197)· 手機規則
- [ ] Jeff visual approval(prod)

## Gaps(記錄,不虛構)
- agent enable/disable 開關(無後端)
- 技能「測試跑一次」(無 run-once mutation)
- 深查需求仍可去 /admin 對應 6 tab(切換前不移除)
