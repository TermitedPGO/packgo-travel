# Task 01:最小垂直切片(單 mailbox shadow,opus 一批)

- [ ] migration:gmailIngestionLedger 新表 + gmailIntegration 加 lastSuccessfulSyncAt/intakeMode(tracked migration 檔,絕不對任何 DB 執行)
- [ ] eligibility 單一函式(排除 own-email/noreply/既有 noise 規則),history/fallback/對帳三方共用
- [ ] History 同步引擎:fencing lock、全分頁、ledger 先行、CAS 游標、404→bounded fallback(24h 重疊 -label 全分頁)、bootstrap(getProfile+首輪掃描)
- [ ] push 喚醒改先耐久排隊後 ack;重送冪等
- [ ] shadow 模式:History 路徑寫 ledger 不餵下游不貼標;legacy 原樣;intakeMode=history 的完整路徑(餵下游)完成但預設不切
- [ ] F 骨架:failed 終態+分類+退避重試+超閾人工卡
- [ ] D 對帳:四條 P1 規則+事故指紋卡去重+恢復自動關卡
- [ ] watch:缺 topic/NULL/過期/續期失敗告警(不再靜默);續期排程沿用
- [ ] 紅綠測試(全部):read-before-poll、同 thread 雙 message、duplicate push、page-2 crash 游標不前進、
      label 失敗不重複不藏信、History 404 fallback、watch 三態告警、OAuth 401/429/5xx 分類退避、
      CAS 並發不覆蓋新游標、bootstrap
- [ ] tsc 0 錯;既有 gmail 測試全綠不刪;i18n(若動 UI 卡文案);新測試單檔 5 次穩

# Task 02(獨立唯讀工具,同批可做):
- [ ] E backfill dry-run 腳本:兩信箱 30 天 metadata 清單(不下載附件不建單),Emerald 信必須命中;14 天內標優先
- [ ] 136 failed 分類表:mailbox/日期/錯誤類別/httpStatus/是否重試成功,永久漏接數另列(唯讀,de-identified)
