# gmail-intake-ledger(proposal)

> 來源:2026-07-13 Emerald/AXT 真實漏接 → 指揮診斷(三層根因)→ Codex 第 10/11 輪裁定。
> 高風險類別:客戶承諾+schema+批次資料。新 P0(客戶入口生死線,健康度 2.5/10)。

## 要解什麼

客戶信攝取存在已證實的永久漏接路徑:push watch 未註冊(GMAIL_PUBSUB_TOPIC 未設,靜默)、
poll 新信以 unread 當游標(Jeff 讀信快過 3 分鐘窗即永久錯過)、reconcile 只補已知 thread。
「新客來信+快速讀信」= 必漏。另 jeffhsieh09 線 messagesFailed=136/686 未分類無告警。

## 裁定後的目標架構(Codex 11 輪,全盤採納)

- History API = 權威增量游標(主路徑);push 只負責喚醒;定期同步走同一 History 路徑。
- unread 永久禁止當攝取游標(它是 UI 狀態,不是商業事件狀態)。
- ingestion ledger = 唯一可稽核事實源;message 級唯一鍵(integrationId+gmailMessageId);
  at-least-once 發現 + 冪等落庫;先耐久落帳再推游標(原子邊界)。
- Gmail label 降級為提交後可重試副作用,不是提交點。
- A(-label 查詢)只當 History 404/緊急止血的 bounded recovery,需 24h 重疊窗+全分頁+落帳先行。
- D 對帳改逐 message set-difference(5 分鐘一輪,四條 P1 規則+事故指紋去重)。
- F 同批先建可觀測骨架:failed=耐久狀態+錯誤分類+重試計畫+人工卡。

## 完成線(Codex 10 輪 §四,八項全過才可稱「Email 入口閉環可用」)

1. 新 thread 未讀態被攝取一次。
2. 新 thread 在 poll 前被 Jeff 讀取,仍被攝取一次。
3. 同 thread 連續兩封新 message 各自攝取,不合併遺失。
4. 同一 push 重送兩次,只建一筆 message interaction。
5. DB commit 後、label 前 crash,重啟後零遺失零重複。
6. watch NULL/過期/續期失敗三態皆告警且 reconciliation 補信。
7. lastHistoryId 過舊時 bounded recovery 補缺口並重建游標。
8. 136 failed 依 mailbox/日期/錯誤碼/是否重試成功分類,永久漏接數另列。

## 分批與 release(裁定)

- 本批=最小垂直切片:單一 mailbox、History 游標、message 冪等、read-before-poll 測試、
  watch 續期+告警、F 骨架、D 對帳核心。shadow/dry-run 先行,逐 mailbox 開旗標。
- 第一個 mailbox 運行證據過了才擴第二個。
- release:v812 凍結至第二輪信託 cron → B1.2 單獨 v813 → Gmail 單獨 v814。不同批不同 ship。
- 30 天 backfill(E)= v814 部署後的獨立人工核准操作,不綁 release/migration。

## 不做(本批)

- 不自動回信;backfill 不自動建單。
- 不動第二個 integration(等第一個證據)。
- 不修 136 筆每一種根因(先分類+骨架)。
- 不與 B1.2 同 release。
