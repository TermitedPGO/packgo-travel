# tasks

- [x] T1 canonicalAuditRow 秒級正規化 + audit()/systemAudit() 寫入截秒(D1)
- [x] T2 tip 讀取 isNotNull(rowHash)(D2)
- [x] T3 hash UPDATE 失敗重試一次(D3)
- [x] T4 verifyAuditChain epoch 語意 + legacyRows/epochStartId(D4)
- [x] T5 ensureAuditChainEpoch(R6 後:確切 insertId 收據;錨定移 post-deploy 端點,index.ts startCron 不再接線——見 R6-2/R7-1)
- [x] T6 AuditLogTab legacyRows + i18n zh/en(D6)
- [x] T7 auditChain.test.ts 七組 + 既有測試不紅
- [x] T8 tsc 0 / focused 綠 / 全套綠 / 突變抽核
- [ ] T9 去信 + codex 終驗迴圈
- [x] R5-1 ensure last-attempt 語意
- [x] R5-2 錨定移 post-deploy endpoint+鎖語意
- [x] R5-3 writers 閉合(grant-admin/backfill/allowlist/payload 承重)
- [x] R5-4 UI/gate/威脅文件
- [x] R5-5 evidence v2
- [x] R6-1 ensure 確切身分+競爭 regression
- [x] R6-2 release image 綁定+endpoint 嚴格判準+端點/清單測試+鎖等待+雙 writer 測試
- [x] R6-3 grant-admin UTC+advisory lock+Y 叉偵測、backfill 進主通道、allowlist 語法感知
- [x] R6-4 UI epochStartId 分流+文件矛盾清除
