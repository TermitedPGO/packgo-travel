# 完工報告:Phase1b/1c + Phase2(2a/2b/2c)— 客戶頁衝 100 分

> 照 docs/agent/30-templates.md T6 交付。本批次接續上一 session 的 Phase1a(已上線 v781/v782,監工驗收過,不在本報告重複),做完「全渠道進場」剩下兩項(1b/1c)+「每個數字有出處」三項全部(2a/2b/2c)。

## 1. 交付清單

| commit | 一句話 | 檔案數 |
|---|---|---|
| `9bda950` | Phase1b 案件資料.md 批次匯入(admin端點+本機腳本) | 6(+1592/-3) |
| `63c14f2` | Phase1c iMessage 桌機同步(ingest端點+launchd腳本) | 7(+1348/-0) |
| `52962a6` | progress.md 回寫 Phase1a/1b/1c | 1 |
| `ce43265` | Phase2a 訂單金額對 invoice 看門狗(invoiceMismatch) | 7(+558/-2) |
| `d889fae` | Phase2b supplierCost 搬運收緊(文件驗證gate) | 5(+606/-25) |
| `d8654cf` | Phase2c Plaid 收款建議看門狗(paymentMatch) | 6(+605/-2) |
| `ba189e9` | progress.md 回寫 Phase2 三項 | 1 |

共 5 個 feature commit + 2 個文件回寫 commit,合計新增/修改 33 個檔案異動(含跨批次重複觸及的共用檔案如 `customOrderWatchdog.ts`、`adminCustomerOrders.ts`)。

## 2. 自測證據(逐條,可稽核)

**tsc**:每批 commit 前皆用 `NODE_OPTIONS="--max-old-space-size=6144" npx tsc --noEmit`(Bash `run_in_background:true` 背景跑+輪詢),5 個 feature commit 全數 0 錯;pre-commit hook 在每次 `git commit` 時又重跑一次,同樣 0 錯。今日收工前額外重跑一次全庫 tsc(獨立於任何一批),仍 0 錯。

**vitest**:測試數量隨批次遞增,每批都是「新測試 + 全套」雙重確認:
- 1b:`caseFileImport.test.ts` 35 個(含跨客戶守門、已註冊會員擋檔、LIKE 跳脫、售價多候選);全套 278 files / 3922+ 測試綠。
- 1c:`appleEpoch.test.ts` 15 個 + `imessageIngest.test.ts` 13 個;全套 280 files / 3950+ 測試綠。
- 2a:`customOrderWatchdog.test.ts` 累積到 79 個;全套 280 files / 3981 測試綠。
- 2b:`supplierCostVerification.test.ts` 20 個 + `opsTools.test.ts` 122 個(含既有);全套 281 files / 4007 測試綠。
- 2c:`customOrderWatchdog.test.ts` 累積到 97 個;全套 281 files / 4025 測試綠。
- 今日收工前額外重跑一次全套 vitest(獨立確認,非任何一批的驗收步驟),922 行輸出全數 ✓,無 ✗,與 2c 那次的 4025 passed / 0 failed 一致(輸出檔尾端因背景擷取時機沒抓到最終彙總行,但逐檔 ✓ 記錄 + exit code 0 已是充分證據)。

**對抗審查**(每批獨立 Workflow,四階段:實作→審查→修復→驗收):
- 1b:6 路審查,抓到 1 個 P0(David 案件檔裡 Jeff 本人電話「+1 (510) 634-2307」混在「對接人(客戶)」欄位,舊 prompt 沒排除業主本人聯絡資訊,可能導致跨客戶誤併)已修;另補齊 create_customer 既有的「已註冊會員 email 擋檔」規則(resolveOrIdentifyCustomer 原本漏了這條,已加 `blocked_registered_member`);LIKE 萬用字元未跳脫已修;售價多候選口徑已統一為「優先全案總價」。
- 1c:5 路審查,**沒有發現任何 P0/P1**(隱私邊界、Apple epoch 數學這兩個頭號地雷都獨立驗算過關);修 2 個 P2(未認領號碼時間戳追蹤範圍錯誤、電話查詢邏輯重複已抽共用函式)。
- 2a:3 路審查,抓到 2 個 P1(雙幣別文字裡合法 USD 金額被連坐漏抓;「total number of travelers: 4」計數語境誤判成金額,這個是誤報方向,比漏報更危險)已修;全形數字留為已知限制。
- 2b:3 路審查,四個攻擊角度(跨客戶守門/PII擋門/邊界值/時序)+ 部分欄位拒絕行為全部核實邏輯正確、無真缺陷;唯一修正是 schema 註解措辭過度宣稱(補上 admin 後台手動路徑的除外說明)。
- 2c:3 路審查,金額正負號方向 + 「AI 絕不碰錢」邊界獨立驗算過關,無破口;修 2 個真缺陷(同額候選分組沒區分 deposit/balance/total 導致巧合同額誤湊一組;bankTransactions 查詢無 orderBy 導致同日多筆命中同單時「取最新」結果不穩定)。

**行為驗證**(逐條驗收條件 → 過/沒過):
- 1b:blocked_no_identifier 在 dry-run 清楚列出不靜默 → 過(測試 + 程式碼路徑確認);供應商聯絡資訊不誤判 → 過(用 David/林朝安/金宥三份真實案件檔文字當 fixture 鎖住);confirm 兩次同資料夾不重複建單 → 過(folderName trace marker 查重測試)。
- 1c:電話對得上內容才送、對不上只送號碼+時間戳 → 過(五路審查其中一路逐行追蹤資料流,candidates 陣列含 text 但只存在腳本記憶體,送出前才依 knownSet 過濾);Apple epoch 轉換正確 → 過(獨立審查員手算驗證奈秒/秒交叉一致)。
- 2a:scorecard 案例($6,635 vs $6,621.40)正確跳黃卡 → 過(獨立驗收重新手算邏輯,非只信測試);單一數字吻合/文件無明確總額不叫 → 過。
- 2b:數字在文件裡→收、不在→拒、跨客戶引用→拒 → 過(20+7 個測試逐一覆蓋);非聊天路徑寫入 supplierCost 的唯一例外(admin 後台表單)已誠實記錄,非本次範圍。
- 2c:正負號方向(負=入帳才比對)→ 過(獨立驗收手動重算 -5000 vs 5000 兩案例);同額多單列全部候選、已收款腿不再叫、無吻合沉默 → 過。

## 3. 偏離申報

- 1b:設計文件建議「create_customer 跟批次匯入共用同一份識別邏輯」,實作選擇在 `server/db/customerProfile.ts` 另寫一份等價邏輯而非改造 `opsTools.ts` 的 `create_customer`(降低對既有工具的改動風險),已在檔案頂端註解明講這是刻意取捨,兩邊日後要手動同步。
- 1c:`imessage-sync.mjs`(本機 plain Node.js 腳本,不走 TS 編譯)手動複製了一份 `appleEpochToIso` 邏輯而非 import,已加雙向 DUAL-MAINTENANCE 註解但無測試鎖住 drift。
- 2a:`findInvoiceMismatchIssues` 沒有開放外部 threshold 參數(容差寫死模組內常數 `INVOICE_MISMATCH_TOLERANCE=1`),原始派工單提示了 threshold 可選參數但設計文件本身沒明講,執行者判斷不需要外部覆寫。
- 2b:schema 表級註解最終版本比原始要求更精確(明確排除 admin 後台手動路徑),這是審查抓到的必要修正,不是原始偏離。
- 2c:「決定一張單還欠哪一段錢」用 `depositPaidAt`/`balancePaidAt` 都空判斷,而非用 `status`(設計文件把這個判斷依據留給實作決定),理由寫在 `resolveUnpaidLeg` 註解:status 可能因出發/完團等其他理由推進,不代表錢真的收了。

## 4. 已知限制

- 1b:同資料夾併發 confirm 的競態(TOCTOU)需要 DB unique constraint 才能根治,要走 migration,目前是本機腳本手動逐一操作,觸發面低,先不處理。
- 1c:`chat.db` 的 `message`/`handle` 表實際欄位,本機無真實檔案可驗證,已在腳本註解與安裝說明列出假設,Jeff 首次跑前需要用 `sqlite3` 核對;`normalizePhoneForMatch` 不處理國碼前綴(`+1` vs 無前綴)差異,方向安全(漏抓不洩漏)但功能面可能讓合法客人簡訊被誤判未知。
- 2a:全形數字/貨幣符號不被辨識,漏判方向安全(不會誤抓),中文客群若慣用全形金額書寫會漏掉,目前無實際案例支撐修這條。
- 2b:admin 後台表單(`adminCustomerOrders.ts` 既有 mutation)寫 `supplierCost` 完全不受這次驗證約束,責任在 Jeff 本人核對 invoice——這是既有路徑,非本次引入的洞,已在 schema 註解明確劃界避免誤導。
- 2c:即時查詢不落地存任何比對狀態,一人公司資料量下無效能疑慮,但若客人/訂單量大幅成長,`matchPaymentsToOrders` 是 O(n·m) 巢狀迴圈,未預先優化。

## 5. 給指揮的審查建議(自曝弱點,優先看這幾點)

1. **1c 的 chat.db schema 假設是我這台環境完全沒法驗證的部分**——`message`/`handle` 表欄位名稱、`is_from_me` 語意、Apple epoch 奈秒/秒判斷閾值,都是依公開知識寫的,真正對不對只能等 Jeff 桌機實測。這是本批次裡「文件審查再仔細也補不了實測」的唯一一塊,建議監工驗收時特別標注這條不能只看 code review 過關就當數。
2. **2b 的「兩份等價邏輯」風險**(1b 的 `customerProfile.ts` vs `opsTools.ts` 的 `create_customer`)——這是我自己選的取捨,審查當下核實過兩邊邏輯完全一致,但這是「現在對,以後可能漂移」的結構性風險,不是一次性驗證能保證永遠對的東西。建議排進 Phase6「清舊帳」時重新檢查兩邊是否還一致。
3. **2a 的 extractInvoiceTotal 是純 regex 抓文字**,審查已經用真實案件檔(David/金宥/林朝安)的複雜句型鎖住已知的雙幣別、計數語境兩個陷阱,但這類「用錨點詞找金額」的正則邏輯本質上是有限樣本覆蓋,遇到 Jeff 桌面案件檔以外、更刁鑽的供應商 invoice 排版,無法保證零誤判,只能保證「該誠實沉默的地方多半會沉默」(容差機制是最後防線)。

## 6. 待 Jeff 手動

1. Ship 這 5 個 feature commit(`git push` → `export DEPLOY_TOKEN` → `echo "$DEPLOY_TOKEN" > .deploy-approve` → `pnpm ship`)。
2. Phase1b:ship 後用 `scripts/import-customer-cases.mjs` 對 1 個案子跑 dry-run,看預覽 OK 才 `--confirm-all` 批次剩下 14 案。
3. Phase1c:照 `docs/features/customer-cockpit/imessage-sync-setup.md` 走一遍安裝(Full Disk Access、`fly secrets set LOCAL_SCRIPT_TOKEN`、確認 chat.db schema),先手動跑一次腳本(不掛 launchd)驗證抓得到資料。
4. Phase2a/2c:ship 後挑一張真實 invoice PDF 掛在某訂單上驗 2a 會不會正確跳黃卡;挑一筆真實入帳驗 2c 建議跳不跳得出來(本機無真實 DB/Plaid 資料測不到)。

---

分類(供監工月度回顧用):本批次 5 個對抗審查回合共抓到約 12 項真缺陷(1b:4、1c:2、2a:2、2b:1、2c:2),絕大多數屬於「不可預知」類(需要真實案件檔文字/真實日期邊界才測得出來,例如 David 案件檔裡 Jeff 本人電話混在客戶欄、雙幣別發票句型、同額不同 legKind 分組漏洞),已記進本報告與 progress.md;沒有「prompt 可防」類發現(表示各批次的派工單本身邊界劃得夠清楚,不是漏寫地雷提示導致的)。
