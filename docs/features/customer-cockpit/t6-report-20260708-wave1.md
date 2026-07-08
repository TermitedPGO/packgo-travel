# 完工報告:硬化戰役 Wave1 — 觀測神經(2026-07-08)

> 對應派工單 `docs/features/customer-cockpit/dispatch-wave1.md`,母計畫 `docs/features/customer-cockpit/hardening-plan.md`。四塊(A→B→C→D)依序執行,每塊獨立四階段(實作 → ≥3 路 fresh 對抗審查 → 修復 → 驗收),獨立 commit + push。全程未跑 `pnpm ship`,未跑 `flyctl deploy`。

## 1. 交付清單

| commit | 內容 | 檔案數 |
|---|---|---|
| `506660f` | feat(observability): 塊A — ship 後自動煙霧(deploySmoke) | 8 |
| `49890db` | docs: 塊A progress 回寫 | 1 |
| `eb6761b` | feat(observability): 塊B — 錯誤漏斗 errorFunnel | 35 |
| `10b42ac` | docs: 塊B progress 回寫 | 1 |
| `4b563a4` | feat(observability): 塊C — D1 週稽核觀測計數器 | 4 |
| `3ee4498` | docs: 塊C progress 回寫 | 1 |
| `762fa2e` | feat(observability): 塊D — fail-open 全面盤點 | 64 |
| `226aca0` | docs: 塊D progress 回寫 + Wave1 收官 | 1 |

全部已 push 到 `origin/main`(最終 HEAD `226aca0`)。**未 ship。**

## 2. 自測證據(逐條,可稽核)

### tsc
每塊 commit 前皆執行 `NODE_OPTIONS="--max-old-space-size=6144" pnpm exec tsc --noEmit`,四塊與最終合併狀態均 **0 錯**(pre-commit hook 每次 commit 也重跑一次,皆綠)。

### vitest(數字紀律:以下四組總結行皆從終端輸出原樣複製,經我獨立重跑核對,並與 pre-commit/pre-push hook 的重跑結果一致)

塊A 完工時:
```
 Test Files  303 passed | 11 skipped (314)
      Tests  4509 passed | 90 skipped (4599)
```

塊B 完工時:
```
 Test Files  305 passed | 11 skipped (316)
      Tests  4539 passed | 90 skipped (4629)
```

塊C 完工時:
```
 Test Files  306 passed | 11 skipped (317)
      Tests  4571 passed | 90 skipped (4661)
```

塊D 完工時(當前 main HEAD):
```
 Test Files  309 passed | 11 skipped (320)
      Tests  4580 passed | 90 skipped (4670)
```

新增測試檔:`deploySmoke.test.ts`(15)、`adminCustomers.test.ts`(5,.toSQL() 離線形狀斷言)、`errorFunnel.test.ts`(16→22,修 race condition 後補測)、`infraNoise.test.ts`(7)、`observabilityCounters.test.ts`(19)、`plaidWebhook.test.ts`、`gmailPipeline.funnel.test.ts`、`auth.passwordReset.funnel.test.ts`(塊D 3 個代表性樣本)+ `gmailPipeline.noise.test.ts` 擴充 3 條洪水閘邊界案例。另有 `node --test scripts/safe-deploy.test.mjs` 17/17 pass(塊A)。

### 對抗審查總覽

| 塊 | 路數 | 抓到的 P0/P1 | 處理方式(一句話) |
|---|---|---|---|
| A | 3(SQL 安全/端點安全與資料外洩/部署腳本語意) | 0 | 全 PASS,僅 2 則 note(縮排隨搬移自然變化、error 訊息理論 PII 風險低機率)記為已知限制不修 |
| B | 4(核心去重/tRPC 噪音閘專審/27-worker 完整性/gmail 洪水閘) | 2(核心去重 race condition;噪音閘漏擋 LLM 斷路器訊號) | race condition:in-memory 佔位鎖改同步寫入解掉同 process 併發 + 補突變測試;噪音閘漏洞:抽出共用模組 `infraNoise.ts`,sentry.ts 與 tRPC onError 共用同一份清單,收斂分岔 |
| C | 3(正確性/向後相容、時區地雷專審、測試偵測力) | 0(僅 P2) | 測試偵測力那路用突變測試抓到真實邊界 bug(空字串 observabilitySection 產生懸空 `---` 分隔線)已修;向後相容缺一個組合測試已補 |
| D | 3(ledger 完整性與抽樣品質/接線正確性/四分類一致性守範圍) | ledger 完整性一開始判 FAIL(2 項),接線正確性 PASS,一致性抓到 1 個真實誤判 | ledger 完整性的 2 項「阻塞」經覆核確認是**審查時序誤判**(審查跑在接線完成之後,把本批接線自己新增的 `.catch(` 呼叫誤認成漏枚舉的舊 catch;已在 ledger 方法論章節寫明,不需改動接線程式碼);一致性審查抓到 `catalogRebuild/index.ts:261` 誤標 highRiskType=none,已修復補接線 |

### 行為驗證(對照派工單「驗收條件」逐條)

1. tsc --noEmit 0 錯 — **過**(四塊各自 + 最終合併狀態)。
2. 全套 vitest 綠,總結行原樣貼 — **過**(見上方四組)。
3. 塊A:重構基線對照(8 支既有測試檔 164→164 逐字相同)— **過**;`.toSQL()` 離線形狀斷言測試綠 — **過**;grep 確認三個查詢體(customerList/guestList/customerUnreadCount 註冊臂)無第二份複製 — **過**;`node --test scripts/safe-deploy.test.mjs` 綠 — **過**(17/17)。
4. 塊B:噪音閘過濾表逐條測試 — **過**;never-throw 測試 — **過**;洪水閘紅綠例(2 封個別卡/6 封聚合卡/邊界值 5 封)— **過**;`grep "\.catch(() => {})" server/_core/index.ts` 對 zombie cleanup 那條已消失 — **過**(兩處呼叫點皆已接 reportFunnelError)。
5. 塊C:三段結構測試 — **過**;首跑分支測試 — **過**。
6. 塊D:ledger 條目數 = grep 總數 — **過**(873 = 873,見 ledger 檔案「數字紀律」章節);C 類清單完整列出 — **過**(6 筆全列於 ledger 專節)。
7. i18n:本批預期零 client JSX 變更 — **過**(pre-commit hook 四次 commit 皆跑 i18n parity audit,均回報 `100% parity, 0 hardcoded patterns`,7660 keys 中英文完全對齊,零新增/缺漏)。

## 3. 偏離申報

- **塊A**:
  - 派工單只列三個查詢體要抽函式(customerList/guestList/loadTodayListItems),但塊A 第 2 點要求煙霧要測 customerUnreadCount 的「註冊臂 + guest 臂」。因地雷規則禁止複製第二份查詢,延伸抽出第四支 `runRegisteredUnreadCountQuery`(只搬 SQL,JS 端過濾邏輯留在 procedure)。
  - watchdogForCustomer 未整支抽成 exported 函式(派工單原文只要求「代表性真查詢」),選用 email 動態解析 profileId + `listCustomOrdersByProfile` 作代表,範圍比整支抽取窄,已在實作回報說明理由。
  - guestList 抽函式時發現一個真實 JS 語意坑(`async function` return thenable 會被 Promise 解析演算法自動 `.then()` 展開,對免連線 QueryBuilder 會直接拋錯),改用 build/run 兩段式拆分修正,不影響「SQL 一字不動」鐵律。
- **塊B**:cron zombie cleanup 啟動時那次呼叫(派工單只點名 `setInterval` 那次)也一併接上漏斗,避免同一支函式兩個呼叫點行為不一致。
- **塊C**:`runWeeklyCorrectnessAudit` 的「零差異週不貼卡」行為被刻意改為「零差異週也貼一切正常卡」——這不算意外偏離,是派工單「三行永遠出現」+「異常趨勢週一必經 Jeff 眼前」的直接要求,但明確記錄在此避免被誤讀為向後相容承諾的破壞(兩支純函式 formatAuditDigest/aggregateAuditResults 本身對舊呼叫端仍是逐字向後相容,只有執行器 runWeeklyCorrectnessAudit 的對外行為變了)。
- **塊D**:派工單未規定盤點的具體執行方法,只規定產出格式與驗收條件。本批採 16 路平行 fresh 稽核(每路負責一批 file:line 清單獨立判斷)+ 動態分組接線 + 3 路對抗審查的方式執行,屬執行方法選擇不算偏離。

無其餘偏離。

## 4. 已知限制

- **塊A**:deploySmoke 七臂目前循序 `await`(非平行),總耗時是七臂總和;唯讀低頻端點,派工單未要求平行,刻意保守。
- **塊B**:
  - errorFunnel Layer 2(DB 級去重)是 select-then-branch,沒有 `(agentName, title)` unique constraint + upsert;同 process 併發已用 in-memory 佔位鎖解掉,但跨 process / 跨機器(Fly.io 若真的多開 machine)仍可能各自 miss、各自貼出重複卡。需要 schema migration,不在本批授權範圍。
  - `title = signature.slice(0, 200)` 比完整 signature 更粗,理論上不同簽名若前 200 字元相同會在 DB 層被誤判同卡,機率極低且無測試覆蓋。
  - module 級 `seen` Map 無 TTL/上限,長駐 process 理論上可無界成長。
  - `wireWorkerFunnel` 不分辨「業務預期失敗」與「系統壞了」,依賴新 worker 作者自律在 processor 內部吞掉預期錯誤,無程式碼層防呆(已文件化於 errorFunnel.ts docstring)。
- **塊C**:`QUEUE_MODULE_IMPORTERS` 是手動維護的 7 個 import 清單(非自動掃描 `server/queues/` 目錄),未來新增 queue 檔案忘記加入清單會被安靜漏掉(不報錯,只是少列一行)。
- **塊D**:
  - 14 筆 A 類(必須浮出)因 highRiskType=none 記帳留給 Wave4,本批未接線(完整清單見 ledger)。其中 `server/routers/inquiries.ts:310`(緊急客人事件通知 notifyOwner 失敗)雖分類本身站得住(通知基礎設施自身失敗,接回漏斗會循環,同構於 agentNotify.ts/llmCreditAlert.ts 已知排除模式),但審查三特別標註這是全部 143 筆 A 類裡唯一涉及人身安全的一條,建議提升優先權,不要跟一般 cron 註冊失敗同等排到 Wave4——**這個優先權裁決留給指揮/Jeff,我沒有單方擴大範圍先接**。
  - 6 筆 C 類(爭議)交指揮裁決,完整清單見 ledger 專節與下方第 5 節。
  - 129 個接線點是 60 個檔案的機械式單行編輯,對抗審查逐筆核對 + 3 個代表性樣本有完整測試覆蓋,但沒有對全部 129 處逐一寫單元測試(派工單原文只要求「抽代表性 3-5 處」,已照做)。

## 5. 給指揮的審查建議(自曝最可能有問題的點)

1. **errorFunnel 跨機器去重**:目前的 in-memory 佔位鎖只解決同一個 process 內的併發貼卡,若 Fly.io 未來真的多開 machine(目前應該是單機),同一時間點的系統性故障仍可能在不同機器各自貼出重複卡。这是已知限制不是 bug,但值得列入 Wave2/Wave4 的技術債候選。
2. **塊D 129 個接線點的抽查覆蓋面**:對抗審查是「逐筆比對 diff + 3 個代表性樣本有完整測試」,不是 129 處全部單元測試。若指揮要抽查真偽,建議挑幾個 money 類高風險路徑核對(`stripeWebhook.ts`、`plaidWebhook.ts`、`db/accounting.ts`),這些是金流敏感度最高的接線點。
3. **inquiries.ts:310 的優先權裁決**:審查三明確點名這是本批唯一涉及人身安全緊急案例的 fail-open catch,目前跟其他 13 筆 Wave4 backlog 同等對待。若指揮認為不該等到 Wave4,這是唯一需要現在就裁決的項目(其餘 13 筆 backlog + 6 筆 C 類爭議都可以照 Wave 節奏處理)。

## 6. 待 Jeff 手動

- **`pnpm ship`**:硬紅線,只有 Jeff 能跑,本次執行者從未觸碰部署路徑。ship 完貼回版本號(或直接告知已完成)即可。
- **ship 完之後**:派工單原文的「驗收走查清單」1-6 項(煙霧七臂原樣輸出核對、curl deploy-smoke 端點驗證、`{simulate:"fail"}` 紅路演練、D1 手動觸發截圖、48h soak 查 error-funnel 卡、兩個原裸奔 worker wiring grep 證據)**由執行者本人接手跑完並附截圖與探針證據回報**(Jeff 中途指示,已記錄,不再寫「待 Jeff 手動」)。唯一需要 Jeff 配合的是:若 LOCAL_SCRIPT_TOKEN 這把 token 只存在 Jeff 本機 shell / fly secrets,執行者可能需要 Jeff 提供才能親自跑 curl 驗證(屆時另行請示)。
- **走查清單第 7 項**(fail-open ledger 抽查 5 條真偽)仍交指揮(Fable)本人抽查,不是執行者自測範圍。
- **inquiries.ts:310 優先權裁決**(見第 5 節)。
