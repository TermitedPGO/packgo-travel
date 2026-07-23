# audit-chain-repair design

## D1 秒級正規化(根因修復)

- `canonicalAuditRow`:createdAt 轉 ISO 後毫秒歸零(floor)。
- 更正(自查 P2):MySQL/TiDB 對小數秒是「四捨五入」不是截斷,單靠 canonical floor 不保證 round-trip。一致性依賴寫入口先截秒:ms=0 時 floor 與進位無差。宣稱範圍限定於 audit()/systemAudit() 兩個入口;繞過入口的直插寫入者必須自行截秒(R6-3 後:backfill 已改走主通道 systemAuditStrict——同 Redis 鎖域、同 canonical、同 retry,不再是旁路;唯一 CLI 旁路 grant-admin.mjs 走鏈式寫入+UTC timezone Z+DB advisory lock+寫後 Y 叉機械偵測)。
- `audit()`/`systemAudit()` 寫入時同樣先截秒再存(雙保險,存的值與 hash 的值同源)。
- 敏感度不損:秒級變動仍改變 hash(測試釘)。

## D2 tip 讀取跳過 null rowHash

`writeAuditRow` 讀 tip 改 `WHERE rowHash IS NOT NULL ORDER BY id DESC LIMIT 1`。孤列(update 失敗)不再把下一筆的 previousHash 拉回 GENESIS;下一筆直接鏈上一個好 hash。verifier 現行走查(missing-hash 標記後 expectedPrev 不動)天然相容此語意——孤列被標,鏈本身不斷。

## D3 update 失敗重試

設 previousHash/rowHash 的 UPDATE 失敗 → 重試一次;仍失敗 log.error 留孤列(比丟列好)。孤列會被 verifier 標 missing-hash;epoch 後出現 = ok 變 false = 訊號有意義(以前是雜訊,因為整條鏈本來就紅)。

## D4 verify epoch 語意(歷史誠實重錨)

- 新常數 `AUDIT_CHAIN_EPOCH_ACTION = "auditChain.epochStart"`。
- `verifyAuditChain()`:先找最後一筆 action=epochStart 且 rowHash 非 null 的列(id 最大者)。
  - 找到:該列之前的所有列計入 `legacyRows`(不驗、不算 anomaly、不掀 ok);從 epoch 列起驗。epoch 列自身:驗 row-modified(必須綠,它由修復後 code 寫);chain-broken 檢查以其自身 previousHash 為走查起點(pre-epoch 是 legacy,不追溯其 back-pointer 指向的內容)。之後列照常全驗。
  - 沒找到:維持現行全表走查(現況 ok=false,誠實不掩蓋)。
- 回傳形狀向後相容:原欄位不變,新增 `legacyRows: number`、`epochStartId: number | null`、`epochCount: number`(錨列總數,>1 = 重錨警訊,見 D4.5)。
- ok 的新語意:epoch 存在時 = epoch 起零異常;不存在時 = 全表零異常(同現行)。

歷史列為何不重寫:重算 hash 只能證明「今天算過」,不能證明過去未被改;重寫稽核表本身就是 tamper-evident 的反面。誠實做法是分段:缺陷時代標 legacy 全數保留原樣,新時代起真正上鎖。

## D4.5 威脅模型(誠實記載,自查 P1)

hash chain 防的是「無法重算 hash 的事後竄改」(app 層或僅有部分 DB 權限者)。**它不防具 DB 寫權限的攻擊者**:
- 舊設計下,這種攻擊者本可從任意點重算後續整條鏈(O(n) 重寫)。
- epoch 機制把「洗白歷史」的成本降到插入單筆自洽 hash 的 epochStart 列(verifier 取最後一筆錨)。這是接受的取捨,配套防線:verifier 回傳 epochCount,>1 時 UI 紅字警示(重錨事件對 Jeff 可見);部署後首錨的 id+rowHash 記入 repo 外 evidence 檔,之後 epochStartId 變動即為警訊。
- pre-epoch 刪列不可偵測(legacyRows 只會變小,無 anomaly)。實質無防護損失:legacy 時代 285/286 列本已 row-modified,刪列訊號早被噪音淹沒。如實記載,不宣稱「新時代起歷史也上鎖」。
- **R5-4 更正(Codex 裁定)**:DB 寫權攻擊者可「刪除/替換原錨後插入新錨」,甚至維持 epochCount=1 —— epochCount=1 本身不是法證,epoch 的 legacy 尾也談不上「不可竄改」。唯一的 repo/DB 外約束是:首錨 {id, rowHash} 於部署時由 safe-deploy 印出並封存到 repo 外 evidence 檔;之後任何一次核對發現 epochStartId 或錨列 rowHash 與封存值不符,即為警訊。verify 綠燈語意因此限定為「自最後錨點起完整」,UI 文案同步(chainOkFromAnchor,錨前 N 列明示未驗證)。
- 孤錨死鎖已由 R5-1 修法排除:ensure 判準 = 「最後一次 epoch attempt 是否有效」(非任意舊錨),有效性 = JS truthy(null 與空字串皆無效,與 verifier 同判準);孤錨/空字串錨下次呼叫自動補寫,寫後以「本次確切 insertId 的列 hash 落地」證實才回 written(systemAuditStrict 收據,不經吞錯通道;R6-1 —— 重查最後 attempt 仍可被同 id 補 hash 競爭假陽性,已以競爭 regression 釘死)。

## D5 錨定時序與觸發(R5-2 重設計:不在 startup)

- **不在 startup 錨定**。Fly rolling 部署先啟新機再停舊機;startup 錨定的瞬間舊 release 還活著,舊口徑(毫秒 hash)audit 寫入可能落在新錨之後,立即產生 post-epoch row-modified,部署後鏈不保證轉綠。
- 觸發流程(R9-1 最終口徑):safe-deploy 部署後 (1) 取最新 release(flyctl releases --json),機械要求 Status=complete;(2) **expected digest 必來自獨立權威**:release ImageRef 自帶 @sha256 直接用;tag-only 時以 exact repository:tag 對 Fly registry v2 API 做 manifest HEAD(與 Machines 完全無關),由共用純函式 parseRegistryDigestHeaders 解析(R10-1:只認 terminal HTTP block——proxy CONNECT 前導 block 不算;必 200、content-type 必為 manifest media type、docker-content-digest 恰好一個且 64-hex;401/404/redirect/text\/html/衝突 digest 一律 throw);tag 保留原大小寫(OCI tag 大小寫敏感,Fly ULID tag 含大寫),只正規化 registry/repository 與 digest——取不到即紅,絕不以「machines 彼此一致」充當 release 綁定;(3) `flyctl machines list --json` 的**所有回傳機器**必須 state=started 且 digest 與 expected exact 相等(/^sha256:[0-9a-f]{64}$/;tag optional,有 tag 才另比全名 ref —— tagless machine object 不 false-red;stopping/unknown/過渡機同 image 也擋);(4) 才呼叫 LOCAL_SCRIPT_TOKEN 保護的 `POST /api/admin/audit-chain-epoch`(auditChainEpochEndpoint factory);(5) 綠判準:ensure∈{written,exists}、verify.ok=true、epochCount=1、anomalyCount=0、epochStartId 為正整數、anchor.id===epochStartId、anchor.rowHash 為 64-hex;首錨 {id,rowHash} 印出供封存。
- token / machines 證明 / 端點 / 驗證任一缺 → `DEPLOYED_UNVERIFIED`(機械可辨字串),1A0b 不得開。
- ensureAuditChainEpoch 語意(R5-1):見 D4.5 末段(最後 attempt 判準+寫後證實)。
- 鎖語意(R5-2/R6-2):writeAuditRow 搶鎖五次、間隔 150ms(良性併發等到序列化,不立刻退化孤列);仍失敗**不進** read-tip+insert critical section,改插無鏈孤列(不讀 tip 避免 Y 叉、不算 hash;稽核列不丟,verifier 標 missing-hash,fail-visible)。R10-4 更正:Redis TTL 超窗不構成 Y 叉 —— DB 共鎖下第二 writer 只會序列化或落無鏈孤列,不可能兩筆 hashed 同前驅。
- 生效唯一途徑 = Jeff pnpm ship;endpoint 是 app 內建、token 鑑權、rate-limited,非人工改 prod 資料。

## D5.1 直接寫入者 allowlist(R7-3 後最終口徑)

adminAuditLog 的直接寫入入口全庫僅**兩**個,由 auditChain.test.ts 的**真 TypeChecker guard** 釘死(R13 最終口徑:ts.Program+getAliasedSymbol 符號收斂 —— roots=tsconfig 完整 fileNames 無過濾(production/虛擬共用 selectRoots,完整性由「literal-free 檔全數在 Program」測試機械釘死);括號/as/element access/namespace 成員/default barrel/多跳循環/destructuring 宣告與賦值/shorthand/computed/local object alias 全走 checker;shadow/decoy 天然不誤報。raw SQL:repo root 遞迴六副檔名,單檔 mini-Program lexical 求值(visited-set 防循環、無武斷深度上限)+quote/comment-aware tokenizer(MySQL executable comment 展開、引號內 #/-- 非註解、精確 table token 不誤報 decoy),且僅判 execute/query 呼叫引數。誠實邊界:runtime 動態值(參數/env)、eval、非 execute/query 名稱的執行通道不在靜態可判範圍):
1. server/_core/auditLog.ts(主通道 audit()/systemAudit()/systemAuditStrict;backfill-passport-encryption.ts 已併回此通道,同 Redis 鎖域)
2. scripts/grant-admin.mjs(CLI writer;鏈式寫入:截秒+UTC timezone Z+isNotNull tip+canonical 欄位序逐字對齊+retry+收斂重鏈+最終 Y 叉偵測 forked→exit 1)。
   **R8-2 共鎖域**:app writer 與 grant 進**同一實際互斥域** —— MySQL advisory lock GET_LOCK('audit:tip:lock'):app 端在 Redis NX 之內以 db.transaction 釘連線取同名 DB 鎖(等 3s;超時走無鏈孤列 fail-visible);grant 端 GET_LOCK 是硬要求(拿不到直接拒寫)。共鎖下 delayed-app 交錯不再可能(app 的 insert+hash 全程持鎖,grant 等其完成才進場;latch 真非同步 regression 釘住)。錯誤路徑(R9-2/R10-2 fail-closed):RELEASE_LOCK 必須回 1,throw/0/NULL 時以 KILL CONNECTION_ID() 隔離污染 session(GET_LOCK 不隨 commit/rollback 釋放,絕不讓帶鎖連線回 pool;KILL 失敗記 CRITICAL fail-visible)。transaction 缺失、BEGIN/GET_LOCK 層錯誤 → app 端**拒絕鏈式寫**改插無鏈孤列(fail-visible),絕不在無鎖/釋鎖狀態重跑 hashed writer;fn 自身錯誤原樣上拋且至多執行一次;fn 完成後 COMMIT 才炸 → 保留結果不重跑(受保護讀寫走 pool,早已落地)。同狀態下 grant 端 GET_LOCK 硬要求必拒寫 —— 任何單邊裸奔路徑都不存在。

## D6 UI

AuditLogTab 在 hashedRows/ungatedRows 旁加 legacyRows span(>0 才顯)與鏈錨點 id;epochCount>1 顯紅色警示條。i18n `admin.auditLog.{legacyRows,epochAnchor,multiEpochWarning}` zh+en。anomalies 渲染不變。

## 測試(auditChain.test.ts,mock db,零真 DB)

1. canonical round-trip:毫秒 Date 與 DB 重讀(ms=000)同 hash;差一秒不同 hash(敏感度)。
2. audit()/systemAudit() 存入的 createdAt 毫秒為 0。
3. tip 跳 null:末列 rowHash null 時 previousHash 取前一個非 null hash。
4. update 失敗重試一次成功 → 有 hash;連續失敗 → 留孤列 + error log,不 throw。
5. verify epoch:無 epoch 舊行為;有 epoch → pre-epoch 全 legacy、epoch 列 row-modified 驗綠、post-epoch anomaly 掀 ok=false;雙 epoch 取最後。
6. ensureAuditChainEpoch:無列寫一次、有列 no-op。
7. 既有 auditLog.systemAudit.test.ts 全綠不動。

## 回滾

git revert 本批 commit 即回舊行為;epoch 列若已寫入 prod,舊 code 的 verifier 只把它當普通列(action 無特殊語意),無破壞。
