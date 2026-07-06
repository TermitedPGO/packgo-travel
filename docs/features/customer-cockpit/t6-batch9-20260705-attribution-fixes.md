# T6 批九 — 歸屬引擎三缺陷修復(F3/F1/F5,2026-07-05)

> 起因:0909 prod E2E 掃測(`e2e-sweep-20260705.md`)抓到三個歸屬引擎缺陷。本批只修這三個,
> main 上工作,全套 vitest + tsc 綠才 commit,未 ship。

## 修法一句話

- **F3(最優先,活風險)**:`interactionOrderAssignment.ts` 拿掉規則②「唯一在辦單 → 自動裸掛」;新
  thread 的唯一候選也一律送 LLM 確認,不確定 / 無 LLM(含 B4 純 deterministic 回填)一律 NULL,絕不裸掛。
- **F1**:`opsTools.ts` 的 `attach_interaction_to_order` 從「一次歸全部未歸戶」改成必須明確給
  `interactionIds` 或 `gmailThreadId`(二選一),兩者都沒給就拒絕,只掛指定到的那幾筆。
- **F5**:escalationBox 外寄回信經 `recordOutboundEmailInteraction` 沿同 `gmailThreadId` 繼承
  `customOrderId`(與 inbound 規則①對稱),thread 無歸屬留 NULL;承諾也跟著繼承的 order 走。

---

## F3 — 唯一在辦單啟發式太激進(主題混單)

**缺陷**:客人手上只有一張 Napa 報價單時,一封全新主題的 Yosemite 詢問被規則②裸掛進 Napa 單(prod 實測)。

**根因**:`decideInteractionOrderAssignment` 規則②「candidates.length === 1 → 自動掛」不看信件主題,單一在辦單就照收。

**修法**:
- 純函式:移除規則②的裸掛與 `single_in_progress_order` reason。新 thread(無①繼承)有任何候選 —— 含唯一候選 —— 一律要 `llmPick.confident===true` 且命中候選才掛,否則 NULL(`ambiguous_no_llm_or_unconfident`)。
- 呼叫端 `gmailPipeline.resolveInboundInteractionOrderId`:`candidates.length <= 1` 改成 `=== 0` 才跳過 LLM,單候選也走 LLM;system prompt 明講「就算只有一張候選,若是新主題一律回 confident=false」(附 Napa/Yosemite 例)。
- **連帶影響(申報)**:B4 存量回填(`interactionBackfill.ts`)是純 deterministic(永不帶 llmPick),故單候選 profile 現在回填為 NULL,只有 thread 繼承(①)才回填 —— 更保守,符合「絕不裸掛」。既有 B4 測試同步改。

**測試**:`interactionOrderAssignment.test.ts`(單候選無 llmPick→NULL、單候選+confident→掛、Yosemite 紅例 confident=false→NULL)、`interactionBackfill.test.ts`(單候選不再裸回填、thread 繼承仍回填、summarize/整合三案)。

## F1 — attach 一次歸全部未歸戶(粒度太粗)

**缺陷**:`attach_interaction_to_order` 一次把客人所有未歸戶對話歸到一張單,把不相干主題(Yosemite+北海道+Napa)全灌進同一張。

**修法**:工具改成必填 `interactionIds`(一串 id)或 `gmailThreadId`(整個 thread)二選一;兩者都沒給 → 拒絕並提示「到歷史頁多選或給明確 thread/id」。查詢加 selection clause(`inArray(id)` 或 `eq(gmailThreadId)`),只掛「本客人 scope + 尚未歸戶 + 指定到」的那幾筆。cross-customer / 終態守門不變。工具描述同步講清楚。

**測試**:`opsTools.test.ts`(無選擇→拒絕、空陣列→拒絕、gmailThreadId 路徑只掛該 thread、既有 cross-customer / 終態 / scope 測試補上 selection)。

## F5 — 外寄回信不自動歸單(與 inbound 不對稱)

**缺陷**:inbound 自動歸單,但 escalationBox 外寄回信 `customOrderId` 恆 NULL,同一對話兩半分屬不同 order 狀態,真相條 / 時間軸易分岔。

**修法**:`recordOutboundEmailInteraction` 加 `gmailThreadId` 選參;給了就查同 thread 最早已歸戶 sibling(`ORDER BY id ASC`,與 gmailPipeline 的 first-wins tiebreak 一致)繼承其 `customOrderId`,並把 threadId 記上該筆、回傳繼承到的 order。escalationBox 傳入 `target.gmailThreadId` 並用回傳的 order 餵承諾抽取(`recordPromisesForInteraction`)。thread 無歸屬 → NULL(絕不猜)。inquiryReply.ts 另一外寄路無 gmailThreadId 欄位,維持 NULL(向後相容,列 follow-up)。

**測試**:新增 `outboundInteraction.test.ts`(有 sibling→繼承並蓋 insert+回傳、無 sibling→NULL、沒給 threadId→不查/NULL、查不到 profile→recorded:false);`escalationBox.test.ts` 加 F5 wiring(把 target.gmailThreadId 傳給外寄記錄器)。

---

## 驗證(數字紀律,原樣貼)

```
 Test Files  291 passed | 11 skipped (302)
      Tests  4276 passed | 90 skipped (4366)
```

`tsc --noEmit` 0 錯(pre-commit + pre-push)。i18n 100% parity(未動 i18n)。

## 偏離申報 / 已知影響

- F3 連帶讓 **B4 存量回填更保守**:單候選 profile 不再自動回填(需 thread 繼承),NULL 保留待人工/未來帶 LLM 的回填。這是「絕不裸掛」的必然結果,已同步改 B4 測試。
- F5 只修 escalationBox 外寄路(任務指定);`inquiryReply.ts` 外寄路的 `inquiry` 無 gmailThreadId 欄位,維持 NULL,列 follow-up(若日後 inquiries 存 threadId 可比照)。
- F1 後,若 model 手上沒有明確 interactionIds/gmailThreadId,工具會拒絕並指路 UI 歷史頁多選 —— 這是刻意的(寧可要人明確選,也不要整批誤掛)。

## 待 Jeff

- `pnpm ship`(本批已 commit + push origin/main)。ship 後可對 0909 觀察:再寄一封新主題 email(單一在辦單情境),驗 interaction `customOrderId` 不再被裸掛(留 NULL 或經 LLM 確認)。
