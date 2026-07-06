# T6 批十 — 小修包(5 項 + 2 文案,2026-07-06)

> main 上工作,全套 vitest + tsc 綠才 commit,push,**未 ship**。每項附 file:line + 驗收。

## 修法一句話

1. **P1 weeklyCanary 秒級截斷誤判** — `server/_core/weeklyCanary.ts`:新增純函式
   `computeCanarySinceMs(now)=Math.floor(now.getTime()/1000)*1000-2000`,取代 `submitAtMs=now.getTime()`。
   MySQL DATETIME 只有秒精度,同秒落庫的 interaction createdAt 被截成整秒,原本帶毫秒的 sinceMs
   gte 一定誤判「早於」→ 假失敗(prod 實錄:互動 13:00:00、sinceMs=13:00:00.xxx,兩項全誤報)。
   向下取整到秒 + 2s 餘裕。回歸測試用帶毫秒注入時鐘鎖住(`weeklyCanary.test.ts`)。通用地雷「秒級
   截斷比較」已寫進 `docs/agent/30-templates.md`。
2. **P2 weeklyCorrectnessAudit 心跳** — `server/_core/weeklyCorrectnessAudit.ts`:跑完(不論有無差異)
   寫 Redis key `lastWeeklyAuditAt`(ISO 時間)+ log,監工才能區分「跑了沒事」與「根本沒跑」。
   fire-forget(Redis 掛不影響稽核),照 `redis` 既有用法。測試 mock `../redis` 鎖住(零差異也寫)。
3. **P2 夜間跟進草稿重複出卡 + 0 天沒回** — 三處:
   - `followupDraftProducer.ts` `buildFollowupDraftRow`:daysSince<=0 → 中性「今天剛聯絡」(不再「0 天沒回」)。
   - `followupDraftProducer.ts` `runFollowupDraftScan` dedup:移除 `readByJeff=0` 條件 —— 讀過的卡也算,
     與姊妹 `runFollowupScan`(followupScan.ts:220「read or not」)一致。原本讀過就不擋 → 7 天內可重出。
   - `followupDraftOnDemand.ts` `produceFollowupDraftForProfile`:插入前(所有 gate 都過後)先退場這位客人
     現有未讀 followup_draft 卡(readByJeff=1),重複觸發「給我草稿」不再疊卡。
   - 根因:重複的「0 天沒回」卡來自 on-demand 路(draft_followup 工具)被觸發兩次,on-demand 無 dedup;
     夜掃走 minDays=3,不會產 0 天、也已排除剛回覆過的客人(selectStaleQuoted 要最新列 outbound + days>=3)。
4. **P3 DetailTabs 顯示未歸屬 checkbox 死路 + 概覽最近對話 scope** — `DetailTabs.tsx`:
   - ChatTab「顯示未歸屬」toggle 原本包在 `{hasChat &&}` 內,scoped 列表空就消失成死路。改成 section 在
     `(hasChat || activeProjectId!==null)` 都渲染、toggle 在 `activeProjectId!==null` 就顯示、空列表出空狀態
     文案(勾選可看未歸屬);generic 無歷史 fallback 加 `activeProjectId===null` 守門避免雙顯示。
   - OverviewTab「最近對話」原本吃未過濾的共用 conversationMessages;改成自己的專案 scoped
     `customerConversationThread` 查詢(選中專案→{orderId},未分類→{unfiledOnly}),對齊歷史 tab。共用那條
     (餵客戶級真相條 deriveBallInCourt)不動,避免真相條被專案 scope 汙染。移除 OverviewTab 的
     chatMessages prop + CustomerDetail 呼叫端。
5. **文案 A** — `customerDocumentRender.ts` `DEFAULT_PAY_TERMS`:報價摘要(無比例)那句從「支付團費之
   約定比例」(讀起來像漏字)改成「支付團費訂金(實際比例以正式合約為準)」;有比例(收據/請款)仍明寫比例。
6. **文案 B** — `adapters.ts` `replyAttachmentDisplayName`:批八 generated key `generated-<ms>-<kind>.pdf`
   顯示成 customerDocuments 存的中文檔名 `<中文類型>_<YYYYMMDD>.pdf`(UTC),而非原始 key。key 的 ms 就是
   產生時 `now.getTime()`,與伺服器 `fileStamp(now)` 同源,重建出的檔名與 DB、與客人收到的信裡附件名完全一致
   (已核對 fileStamp 有補零 + DOC_LABEL 對照一致)。測試 `escalationReplyPayload.test.ts`。

## 對抗審查

先跑 5-lens workflow,4 路 agent stall(當前 classifier 間歇不可用,同 memory 記過的雷)
只剩 1 路完成;改用單一 focused reviewer(較穩)複審最高風險的 item 3 + item 5。抓到 item 3
兩個連帶缺陷,已回修(commit b641bae):

- **(medium)dedup 改動的 exclude-flow 連帶缺陷**:`already_drafted` 略過的客人沒進
  `draftedProfileIds`,`runFollowupScan` 仍對「已有草稿」的客人發矛盾提醒。dedup 改動讓讀過
  的卡也進 already_drafted、更常觸發。修:already_drafted 的 profileIds 一併加進
  `draftedProfileIds`。
- **(low)on-demand retire→insert 非原子**:insert 失敗會讓客人一瞬間零草稿。改成 insert
  優先拿 id、再退場「其他」未讀卡(排除剛插入的)。

item 5(OverviewTab scoped 查詢)四路檢查全過(prop 移除完整、真相條不受影響、scope 與歷史
tab 一致、無 hooks 規則問題)。item 1/2/4 + 兩文案自驗 + tsc + 全套綠;tweak B 檔名重建與伺服器
`fileStamp`(有補零)+ `DOC_LABEL` 已逐字核對一致。

## 驗證(數字紀律,原樣貼)

```
 Test Files  292 passed | 11 skipped (303)
      Tests  4336 passed | 90 skipped (4426)
```

`tsc --noEmit` 0 錯(pre-commit + pre-push)。i18n 100% parity(新增 projects.emptyScopedHint /
projects.noConversations 兩 key,zh-TW + en 同步)。

## 申報

- item 3 的 dedup/supersede 是 executor 的 DB 寫入邏輯,照本 repo「executor 上線後 prod 驗」慣例(pure
  helper 有單測:buildFollowupDraftRow 的 daysSince<=0 措辭)。
- item 4/5 是客戶頁 UI,本機無 DB 無法預覽,靠 tsc + 邏輯審查;上線後 prod 肉眼驗(勾 checkbox 出未歸屬、
  切專案最近對話跟著換、空專案不再死路)。

## Commit / 待 Jeff

- 後端小修(item 1/2/3 + 文案 A + 30-templates):`8e089d4`
- 前端小修(item 4/5 + 文案 B + i18n):`4535e33`
- 對抗審查回修(item 3 兩連帶缺陷):`b641bae`
- 樣張/文件:本 docs commit
- `pnpm ship`(本批已 commit + push origin/main,未 ship)。
