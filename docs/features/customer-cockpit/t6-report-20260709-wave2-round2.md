# 完工報告:Wave2 收尾 — gmail-poll 清理 + opsActions:390 P1 修正 + P3

> 執行:opus 4.8 / 2026-07-09 / branch `hardening-wave2`(已對齊 origin/main 261811d)。
> 上游:指揮令(gmail 清理 Jeff 授權「清」;opsActions:390 驗收升 P1 本波修;P3 九條一起收)。

## 1. 交付清單(round 2,尚未 commit)

8 檔改動(對 261811d):
- `server/agents/autonomous/opsActions.ts`:buildCancelAuditNote / cancelMessageSql 抽出 + doCancelBooking 修法(SQL 綁定 + 誠實 transitioned)。
- `server/agents/autonomous/opsActions.test.ts`:cancelBooking 佔位符 regression + 4 path 測試(+6)。
- `server/_core/sqlRehearsal/registryEntries.ts`:三個 opsActions 條目 source 更新 + updateBookingMessage 換真實形 + minPrice sources 訂正 + marginAudit 兩條 note。
- `server/_core/sqlRehearsal/rehearsalCore.test.ts`:P3-3 補 `--`/`#` 前導註解 expect。
- `scripts/sqlRehearsalGate.ts`:P3-4 sentinel lastIndexOf + P3-5 stderr 註解訂正。
- `scripts/safe-deploy.mjs`:P3-6 docstring 補 6.5 閘 + 字樣。
- `server/_core/weeklyCorrectnessAudit.ts`:P3-8 gatherQueueFailedCounts(now)。
- `docs/features/customer-cockpit/progress.md`:P3-7 + Wave2 收尾回寫。

## 2. gmail-poll 清理(prod 寫,Jeff 授權)

單一 flyctl ssh + stdin node 腳本,內建硬性守門(比「肉眼比對再另跑移除」更安全,無 TOCTOU 窗口):重跑 getFailed() 驗證 == 36 筆、全部 name=gmail-poll-tick、finishedOn 全落在 {2026-05-27, 2026-06-17},任一不符即零移除中止。

驗證相符(5/27×3 + 6/17×33,與 T6 round-1 dry-run 逐一對上)→ 逐筆 job.remove()。**before/after:36 → 0**(removedN=36,failedRemoveN=0)。只動 gmail-poll failed 集合。獨立唯讀複查:`getFailedCount()=0`,queue 健康(completed 100 / active 0 / waiting 0 / delayed 1 = 排程 tick)。

## 3. opsActions:390 P1 修正

**Ground truth(不憑推理,渲染真形狀)**:舊 `sql\`CONCAT(COALESCE(<col>,''), '\n[cancelled by OpsAgent ${date}] ', ${reason})\`` 渲成 `CONCAT(COALESCE(\`bookings\`.\`message\`, ''), '\n[cancelled by OpsAgent ?] ', ?)` —— 2 個 `?` 但其中一個卡在字串字面 `'...OpsAgent ?] '` 內(prepared 佔位數對不上綁定數 / text 引號被跳脫值撐破,兩者都炸)。修法渲成 `CONCAT(COALESCE(\`bookings\`.\`message\`, ''), ?)`,1 個 `?`、綁定整條稽核字串。

- **修法**:抽 exported `buildCancelAuditNote(reason, dateIso)` + `cancelMessageSql(col, reason, dateIso)`;doCancelBooking 用它。日期戳/reason 都不進 SQL 字面。同檔同款掃過:只 390 中招(293 doUpdateInternalNote / 439 releaseSeats 本就正確)。
- **併修假成功另一半**:原本無條件 `ok:true` + 固定「已取消·釋出座位」摘要。改成 transitioned=false(條件式更新沒命中)時回「本次未變更,未釋座」且不釋座;transitioned=true 才釋座 + 宣稱成功。這直接關掉「訂單沒取消座位沒釋放卻回成功」。
- **紅綠測試**:佔位符 regression 渲染真 `cancelMessageSql` 斷言 `sql` 沒有 `?` 落在字串字面內(`/'[^']*\?[^']*'/`)+ 佔位==綁定。已離線證明:舊寫法該 regex 命中(RED)、新寫法不命中(GREEN),`?count` 2→1。4 條 path 測試:正常釋座 / 沒命中不釋座 / 已取消早退 / 不存在。doCancelBooking 全程 await 無 fire-and-forget,不需 vi.waitFor;單檔連跑 5 次全穩(每次 32 綠)。
- **registry 同步**:三個 opsActions 條目 sources 隨行號更新(292→293 / 390→382 / 405→439);updateBookingMessage 的 sql 換成修後真實乾淨形。coverage/registry 綠、**prod EXPLAIN 238/238**。

## 4. 歷史盤查(唯讀,零受害)

signal 源:executeOpsAction(唯一呼叫端 ops.ts:157,無 cron/autonomous 旁路)執行後,由呼叫端無條件寫兩筆 agentMessages —— agent-role 帶 context=`{"executedAction":"cancelBooking","args":{bookingId,...}}`,jeff-role 帶純字串 body=`Action type: cancelBooking\nArgs:...`。且 executeOpsAction 內建 try/catch 吞錯回 {ok:false}(不 throw),故「成敗兩態」都會留記錄。唯讀探針(含對抗驗證後補的交叉驗證):
- agentMessages context `executedAction=cancelBooking` → **0 筆**。
- jeff-role body `Action type: cancelBooking%`(純字串,不受 JSON 格式漂移影響)→ **0 筆**。
- 最寬網 body∪context LIKE '%cancelBooking%'(涵蓋抽離前可能異形)→ **0 筆**。
- agentMessages 時間覆蓋:最早 2026-05-11、最晚 2026-07-09(共 938 筆)—— 橫跨 Module 2.10 抽離(2026-05-21)前後,故連抽離前歷史也涵蓋且為 0。
- **bookings 總數 0**、各狀態分布皆空(GROUP BY 空 → 確認是空表非查錯庫)。

結論分兩層(對抗驗證 P1 修正,別讀成 no-op):
1. **資料面:無任何歷史/當前列需補救、需清理**(0 執行 + 空表,三重訊號互證)。故無清單需交 Jeff、未代改任何列。
2. **程式碼面:latent bug 在 prod 尚未修、也尚未被觸發**(cancelBooking 從未執行過)。這代表「第一筆真訂單按取消時就會踩到」——舊版會 SQL 崩 + 靜默回假成功。**補救動作 = 把本波 wave2 修法(cancelMessageSql + transitioned 檢查 + 迴歸測試)ship 上 prod,趕在第一筆真取消之前**,不是關單。列入待辦(§9)。

## 5. P3 順手九條

①minPrice 條目 sources 移除錯吞的 suppliersRouter.ts:1164/1165(那兩行是 deactivateZeroPriceTours 的 WHERE,已由該條目覆蓋 → 移除無害且正確,span-masking 帳目訂正)。②marginAudit byTourId/activeOnly 補 '?'→'Q' 替換說明 note。③rehearsalCore.test 補 `--`/`#` 前導行註解 expect(白名單本就擋,釘測試)。④gate sentinel END 解析改 lastIndexOf(END)。⑤gate:73 註解訂正:遠端 stderr 經 stdio:inherit 會轉發本地(非留機上),已驗 Node 22 錯訊不含憑證 + 升版複驗提醒。⑥safe-deploy docstring 補 6.5 閘 + SKIP_SQL_REHEARSAL、改 all-7-gates 字樣。⑦progress 行數改非脆性描述(消 off-by-one 類問題)。⑧weeklyCorrectnessAudit 傳入 now。⑨T6 §5.2 純澄清(歷史檔不改)。

## 6. 自測證據(逐條可稽核)

- `tsc --noEmit` → exit 0、0 error。
- 全套 vitest:`Test Files 321 passed | 11 skipped (332)` / `Tests 4735 passed | 90 skipped (4825)`、exit 0。
- targeted:sqlRehearsal + opsActions + observability + weeklyCorrectnessAudit → `Tests 122 passed (122)`。
- safe-deploy `node --test` → `# tests 22 # pass 22 # fail 0`。
- prod EXPLAIN 彩排真跑 → `ok:true passed 238/238 failures 0`。
- opsActions.test 單檔連跑 5 次 → 每次 `32 passed`。
- 對抗驗證:三路 fresh(opus,high effort)—— 修法正確性 **PASS**(6 角度:渲染真形狀證只一個 ? 不在字面內、假成功另半修好、regression 有鑑別力、同檔無漏、top-level sql import 無 boot 副作用、mock 非假綠;唯一 P3 cosmetic 已收:移除本地 sql shadow);registry 同步 **PASS** 零 findings;盤查推理 **FAIL→已補強**:抓到 P1「零受害別讀成無需補救」框架修正(見 §4 兩層結論)+ P2/P3「證據獨立性/時間邊界」→ 已補純字串 body 第二訊號 + 最寬網 + 全時間覆蓋交叉驗證,三重互證 0,盲點關閉。

## 7. 偏離申報

- opsActions 修法「併修無條件 ok:true」那半,超出指揮 step 1 明寫的「SQL 修法」範圍,但正是驗收判定檔對 P1 bug 的描述(「座位沒釋放卻回成功」),且 cancel_booking 正常路徑測試自然涵蓋。判定屬「完成 flagged bug 本體」而非擴大解釋,如實申報。
- 過程踩到一個自作雷:P3-5 的註解身處遠端 blob 的 template literal 內,先後誤放反引號與 `dollar-brace` 提早關閉字串 → orchestrator 被 esbuild 擋。已修並在該處加警語。教訓見 §8。

## 8. 已知限制 / 給指揮的審查建議

1. **scripts/ 不受 tsc 檢查**(tsconfig 排除),orchestrator(sqlRehearsalGate.ts)唯一驗證是「實跑」。本波就是因此讓一個 template-literal 語法錯溜過 tsc、被 prod 彩排實跑擋下。閘 fail-closed 故壞 orchestrator 不會靜默 ship,但建議指揮考慮把 scripts/ 納入某種 CI parse 檢查(或 --emit-blob + node --check 進一道守門)。
2. **歷史盤查的訊號源唯一性**:結論建立在「cancelBooking 只經 executeOpsAction 這條路、且必寫 agentMessages」。若未來有別的 cancel 路徑不留此記錄,盤查會漏。目前 bookings 總數 0 讓結論無論如何成立,但這個前提值得指揮確認。
3. **opsActions 修法保真**:cancelMessageSql 是 exported 且被 regression 測試渲染真形狀釘住,漂移風險低;但 doCancelBooking 的 UPDATE 整條沒有離線 toSQL 斷言(mock db 忽略 query 結構),行為靠 path 測試 + prod EXPLAIN(registry 那條)兩面守。

## 9. 待 Jeff / 待指揮

- **併回 main + ship(這是 cancelBooking latent bug 的實際補救)**:bug 未觸發不等於不用修 —— 第一筆真訂單取消就會踩到舊版。本波修法必須 ship 上 prod 後,cancelBooking 才安全。gate 6.5 本機即生效不用部署;但 cancelBooking 修法與 observability 近 7 天口徑要部署才上線,建議隨下批一起 ship。
- gmail 清理已完成(36→0),無待辦。
- 歷史/資料面:零受害、空表,無清單需 Jeff 補救、未代改任何列。
