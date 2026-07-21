# audit-chain-repair:稽核防竄鏈修復(1A0b 前 mandatory backlog)

> 2026-07-19。Jeff 指令「先專注在網頁版的」(原話),即優先處理此 web/server 側必修課。worktree:`dev/網站-auditchain`(branch `audit-chain-repair`,基於 main@855d175d)。

## 問題(prod 唯讀查核實測,證據見 PACKGO_AI交流/網站專案/財務篇/Claude/evidence-20260719-auditchain-raw.txt)

verifyAuditChain 等效走查(演算法逐字移植)對 prod adminAuditLog 337 列:ok=false。

1. row-modified 285/286 hashed 列:writeAuditRow 用記憶體 `new Date()`(毫秒級,auditLog.ts:272/:331)算 hash,但 `createdAt` 欄位是 `timestamp`(秒級,drizzle/schema.ts:2562),存入丟失毫秒(MySQL/TiDB 四捨五入非截斷);驗證從 DB 重讀(ms=000)重算必不合。**鏈自 migration 0073 起天生驗不過,非竄改。**
2. missing-hash rowId 630001:兩階段 insert→update 的 update 失敗孤列(Codex 15:56 已揭露之互動,實錘)。
3. chain-broken rowId 660001:孤列後下一筆 tip 讀到 null rowHash,fallback GENESIS(auditLog.ts:228)。

## 為什麼要修

- Codex 15:56/17:41 stop-line:接受 §3.4 雙裝置證據前必確認 verifyAuditChain().ok;實測 false → 1A0b 凍結。
- **1A0b gate(R5-4 修正,ok 單獨不夠)**:部署後須同時滿足 (1) verifyAuditChain().ok=true;(2) epochCount=1;(3) epochStartId+錨列 rowHash 與部署時封存於 repo 外 evidence 檔的首錨憑證一致;(4) legacyRows 與部署當下快照可對帳;(5) epoch 後重新取得 desktop-browser 與 pwa-standalone 兩列(皆 rowHash 非 null)——舊列 870062 在 legacy 段,不能充當修復後證據。
- 稽核鏈是信託/財務操作的防竄底座(紅線 3 之支撐),驗不過 = 這把鎖從未真正鎖上。

## 修法(設計先行,本批零 prod 資料手改、零 schema、零 migration)

前向修復 + 歷史誠實重錨,細節見 design.md。歷史列不重寫(重寫 hash = 破壞 tamper-evident 語意且無法證明過去);以 epoch 標記列把「設計缺陷時代」誠實分段,新時代起鏈必須全綠。

## 範圍

- 改(R6 後最終口徑):server/_core/auditLog.ts(canonical 秒級正規化、tip 跳 null、update 重試帶等待鎖、verify epoch 語意、ensureAuditChainEpoch 確切身分、systemAuditStrict)、server/_core/index.ts(LOCAL_SCRIPT_TOKEN 端點掛載;錨定不在 startup)、server/_core/auditChainEpochEndpoint.ts(可測 handler)、server/_core/storefrontBootPlan.ts(端點入清單)、scripts/safe-deploy.mjs(release image 綁定+錨定步驟)、scripts/grant-admin.mjs(鏈式寫入+UTC+advisory lock+Y 叉偵測)、server/scripts/backfill-passport-encryption.ts(改走主通道 systemAuditStrict)、client/src/components/admin/AuditLogTab.tsx(chainOkFromAnchor 分流)、i18n zh/en(chainOkFromAnchor/legacyRows/epochAnchor/multiEpochWarning 等 key)、測試:auditChain/auditChainEpochEndpoint/AuditLogTab/storefrontBootPlan/safe-deploy/grant-admin。
- 不動:schema、migration、clientBoot(其 rowHash 非 null ack 與本設計相容)、1A0a 已凍結面、1A0b 檔案、Trust/recognition gate、STATE。
- prod 生效途徑:唯一經 Jeff `pnpm ship` 部署;錨定由 safe-deploy 在證實所有機器綁定本次 release image 後,呼叫 token 保護端點觸發(app 內建行為經主通道寫入,非人工改資料;不在 startup)。
