# Wave 1 觀測神經 — post-ship 驗收走查(2026-07-09,prod v805)

> 對應 `dispatch-wave1.md` 尾的「驗收走查清單」七項。prod 已於 2026-07-09 部署 v805(machine 48e6399bd42778 @ sjc,LAST UPDATED 2026-07-09T19:04:01Z,checks passing)。
> 全程只讀不改:prod 探針走 `flyctl ssh console -a packgo-travel` + base64 編碼的 node 唯讀 script,直連 DATABASE_URL(mysql2)/ UPSTASH_REDIS_URL(ioredis)/ BullMQ getFailedCount。零寫入。token 一律走 shell env 展開,不進命令列字串。
> 探針刻意**不**呼叫 `gatherMessagesFailedWeeklyDelta`(它會 `redis.set` snapshot,有寫入副作用+污染 D1 基線),改直接讀資料源。

## 七項逐項結論 + 證據

### 1. ship 後煙霧七臂全綠 — PASS
部署輸出已確認七臂全過(任務前提)。我另用 deploy-smoke 端點重打一次再確認(見第 2 項),七臂同樣全綠。

### 2. `POST /api/admin/deploy-smoke`(帶 token)— PASS
機器內 `node fetch` 打 `localhost:8080/api/admin/deploy-smoke`(token 從 `$LOCAL_SCRIPT_TOKEN` env 讀),回應 `status:200`:
```
{"ok":true,"arms":[
 {"name":"customerList","ok":true,"ms":38,"rowCount":1},
 {"name":"guestList","ok":true,"ms":314,"rowCount":7},
 {"name":"customerUnreadCount","ok":true,"ms":640,"rowCount":154},
 {"name":"todayList","ok":true,"ms":160,"rowCount":1},
 {"name":"watchdogForCustomer","ok":true,"ms":74,"rowCount":2},
 {"name":"commandCenter.approvalTasks","ok":true,"ms":26,"rowCount":2},
 {"name":"commandCenter.escalations","ok":true,"ms":107,"rowCount":17}]}
```
七臂全 ok,各臂 ms 26–640 合理,rowCount 是真 prod 資料(154 未讀計數、17 escalation 等)。

### 3. 紅路演練 `{simulate:"fail"}` — PASS
同端點帶 `{"simulate":"fail"}`,回應 `status:200`、`ok:false`:前七臂**仍全 ok**(注入的假失敗不影響真查詢),尾端多一臂 `{"name":"simulated","ok":false,"ms":0,"error":"simulated failure (opts.simulateFail=true)"}`。端點語意與 safe-deploy.mjs 一致:端點回 `ok:false` → 腳本印紅字提示 rollback,但 exit code 不變(部署已完成)。

### 4. D1 週報第三段三計數器資料源 — PASS(資料源全可讀)
> 未真的 enqueue D1 job(會寫卡 + gatherMessagesFailedWeeklyDelta 會寫 snapshot 污染基線)。改逐一驗三計數器的資料源在 prod 可讀、數字合理。
- **messagesFailed 週增量**:`gmailIntegration` 2 row,`SUM(messagesFailed)=133`(可讀);snapshot key `weeklyAuditMessagesFailedSnapshot` = `null`。v805 後 D1 尚未跑過第一次(週一排程),所以首次跑會顯示「首次基線,下週起有增量」—— 符合設計,非異常。
- **各 queue failed 數**:`getFailedCount()` 五個代表 queue 全可讀 → `gmail-poll=36, weekly-correctness-audit=0, tour-generation=0, supplier-detail-enrichment=0, scaling-guardrails=0`(後兩者是原裸奔 worker,資料源可讀)。
- **LLM circuit 統計**:近 7 天 `llm:stats:YYYY-MM-DD` 可讀,聚合 `circuit_opened=0, rate_limit_429=0, calls_total=723`(逐日 60–145 calls,零斷路零限流,健康)。

### 5. errorFunnel 48h soak + 噪音閘 — PASS(零卡合理,無 P1/P2)
- **error-funnel 卡 = 0**:`SELECT COUNT(*) FROM agentMessages WHERE agentName='error-funnel'` → `0`。且 v805 部署後(`createdAt >= '2026-07-09 19:04:01'`)**任何 agentName 都零新卡**。屬「零卡(無錯)」情境。
- **零卡 vs gmail-poll 36 failed 的釐清(關鍵)**:查 gmail-poll failed job 時間戳 → `total:36, afterV805:0, beforeV805:36`,全部是 **2026-06-17** 的歷史殘留(failedReason 是當時的 DB 查詢失敗),遠早於 errorFunnel 上線。errorFunnel 不追溯歷史失敗 → 零卡**合理**,**不是** wireWorkerFunnel 失效。
- **噪音閘沒誤放**:零卡表示噪音閘沒把 4xx/EPIPE/LLM 雜訊誤放成洪水(v805 後無噪音卡)。惟這幾小時流量少,證據力有限。
- **噪音閘沒誤殺 / errorFunnel 落卡能力**:v805 後零真 500(deploy-smoke 七臂全綠、agentMessages 零新卡),**無自然實彈**可驗;目前靠單測佐證(`trpcNoiseGate.test.ts` 8 例逐 code 紅綠 + `errorFunnel.test.ts` 20 例)。**不在 prod 製造真錯誤驗證(違反只讀不改)。**
- **gmail 逐信失敗卡粒度**:`gmail-intake` 卡 3 張(BofA×1、Ally Tsai×2),都是 2026-07-08(v805 前的 Wave0 hotfix `buildIntakeFailureCard` 產物),≤5 封各自獨立卡 → 洪水閘(>5 才聚合)未觸發,粒度保留符合設計。

### 6. 兩個原裸奔 worker wireWorkerFunnel 已掛 — PASS(掛載已證,實彈待自然事件)
grep 證據:
```
server/scalingGuardrailWorker.ts:23        import { wireWorkerFunnel } from "./_core/errorFunnel";
server/scalingGuardrailWorker.ts:27        const scalingGuardrailWorker = new Worker<...>(
server/scalingGuardrailWorker.ts:59        wireWorkerFunnel(scalingGuardrailWorker, "scaling-guardrails");
server/supplierDetailEnrichmentWorker.ts:44 import { wireWorkerFunnel } from "./_core/errorFunnel";
server/supplierDetailEnrichmentWorker.ts:48 const supplierDetailEnrichmentWorker = new Worker<...>(
server/supplierDetailEnrichmentWorker.ts:99 wireWorkerFunnel(supplierDetailEnrichmentWorker, "supplier-detail-enrichment");
```
兩者都從原本裸 `new Worker(...)` 改成賦值 const + 掛 wireWorkerFunnel。prod 探針證實兩者 `getFailedCount()` 可讀(皆 0),worker 實例運作正常。這段期間兩者無自然失敗事件,**實彈未驗**(不人工製造 prod 失敗)。

### 7. fail-open ledger 抽查 5 條真偽 — PASS(分類品質可信)
抽 5 條涵蓋不同分類,對 repo 現場程式碼核對:
| ledger 條目 | 核對結果 |
|---|---|
| `gmailPipeline.ts:196`(A/customer-data,已接線) | ✓ 現場 catch(e) 首行即 `reportFunnelError(source:"fail-open:gmailPipeline:listUnreadMessages")` 後 return ok:false,描述精準 |
| `packpointMaintenanceQueue.ts:123`(A/cron-deploy,已接線) | ✓ 現場 catch(err) console.error+result.errors+++`reportFunnelError(source:"...autoUpgrade")`,描述精準 |
| `catalogRebuild/index.ts:226`(B) | ✓ 現場 catch(err) 只 log.warn "enrich failed (non-fatal, will gate on completeness)",刻意 fail-open,B 站得住 |
| `agentNotify.ts:90`(A/none Wave4) | ✓ 現場 catch(err) log.error+"Don't throw";標 none 正確(接回 funnel 會循環,因 funnel 自己走 notifyAgentMessage) |
| `stripeWebhook.ts:444`(A/none Wave4) | ✓ 分類正確但**行號漂移**:實際 catch 在 ~483(`Supplier notification failed`,只 log.error 未接 funnel,符合 Wave4 backlog);枚舉快照行號 444 vs 現況差約 40 行(接線動作插入多行所致) |

5 條分類 + swallowed 描述全部真;1 條行號漂移(ledger 是枚舉當下快照,已知特性,靠描述+就近搜尋仍可定位,不影響分類正確性)。附:stripeWebhook 全檔 13 處 money 敏感路徑已接 funnel。

## 總結:無 P1/P2 要回爐

七項全部 PASS 或合理。以下三點為**非阻塞觀察/建議**,不是回爐項:

- **(觀察 a)errorFunnel + tRPC 噪音閘的 prod 實彈尚未驗**:v805 部署後這幾小時零真錯誤(零 500、零 worker 自然失敗),soak 未滿 48h。落卡能力+噪音閘目前只有單測佐證。**建議**:續觀察到滿 48h,期間若出現自然 500 / worker 失敗,再查一次 agentMessages(agentName='error-funnel')確認卡有落、噪音閘沒誤放/誤殺。這是 soak 期本來就要做的續查,不是缺陷。
- **(觀察 b)gmail-poll 有 36 個 2026-06-17 的歷史 failed job 卡在 failed 集合未清理**:非 Wave1 引入,但會讓 D1 第二行永遠顯示 `⚠ gmail-poll=36`(即使無新失敗)——累計式 getFailedCount 把三週前的殘留一直算進去。**建議**(給後續,不阻塞 Wave1):清理歷史 failed(`scripts/cleanup-redis.ts` 有先例),或 D1 queue failed 改看「近 N 天」而非累計,避免基線噪音長期占著一個 ⚠。
- **(觀察 c)ledger 行號漂移**:如 stripeWebhook 444→~483,屬枚舉快照特性,已在 ledger「數字紀律」章節說明過。不影響分類正確性。

## 探針法備查(可重跑)
- 端點:機器內 `node`(全域 fetch)打 `localhost:8080/api/admin/deploy-smoke`,`Authorization: Bearer $LOCAL_SCRIPT_TOKEN`。
- DB:`mysql2/promise` 直連 `DATABASE_URL`(TiDB,ssl `rejectUnauthorized:false` fallback),唯讀 SELECT。注意 `rows` 是 TiDB 保留字,別名要改(本次踩過)。
- Redis:`ioredis` 連 `UPSTASH_REDIS_URL`(tls `rejectUnauthorized:false`),`hmget llm:stats:*` / `get weeklyAuditMessagesFailedSnapshot`。
- Queue:`bullmq` `new Queue(name,{connection})` + `getFailedCount()`(prod 無自訂 prefix,預設 `bull`)。
- 全部 base64 編碼經 `flyctl ssh console -C "sh -lc 'echo <b64> | base64 -d | node'"` 執行,避開引號轉義。
