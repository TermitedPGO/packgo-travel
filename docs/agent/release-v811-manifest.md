# v811 部署前風險一頁(Jeff 按 ship 前看這頁)

> 依外部審查要求製作。v810 的停止線已擋對客即時收款風險,故 v811 非自動第一順位,由 Jeff 依本頁裁部署時機。

## 內容物(四批,各自獨立驗收 PASS)
| 批 | 對客行為變化 | 旗標 | migration | 部署後 smoke | 回滾/停用 |
|---|---|---|---|---|---|
| 行程頁修繕一波 | 詳情頁規格數字單源(拿不準隱藏)、費用區排除語不再打勾、跨團同圖消失、手機價格/麵包屑/錨點修 | 無 | 無 | 開 tours/2 與 /7:數字一致、費用區無勾號牆、兩團不同圖 | git revert 該 merge;純前端+resolver,無資料變更 |
| 0079 skillRuns | 無對客變化;skill 派工開始正常寫追蹤表 | 無 | 0079(CREATE TABLE IF NOT EXISTS,有 down) | SHOW TABLES LIKE 'skillRuns' 落表;dispatcher log 不再現 skillRunId=0 降級 | 0079.down.sql(DROP IF EXISTS);表新建無存量資料,零風險 |
| 結帳驗位+揭露存證 | 無對客變化(旗標 OFF=停止線照舊全擋) | TOUR_INSTANT_CHECKOUT_ENABLED 維持未設(OFF) | 0116 checkoutDisclosures(新表,有 down) | SHOW TABLES LIKE 'checkoutDisclosures' 落表;tour 結帳仍被擋(PRECONDITION_FAILED) | 旗標本就 OFF;0116.down 可退;不影響既有付款路 |
| 財務工作台 | 僅 /ops 後台:待認領分頁+批次認領+錯誤態 | 無 | 無 | /ops/finance 待認領卡出現「載入更多」;TaxDetail 無 1040-ES 死鈕 | git revert;純 admin UI+router,認領仍逐筆稽核 |

## 前置檢查(ship 指令會自動跑的之外)
1. 0079 前置:prod 現無 skillRuns 表(已核,2026-07-11)、journal when 高水位語義已修(migrationJournal.test 守門)。
2. 部署前復原點:TiDB Cloud 自動備份(保留期 Jeff 尚未確認 —— 這是既有待辦,不擋本次,但列為已知缺口)。
3. 責任人:部署=Jeff;部署後走查=指揮(自動)。

## 已知風險
1. 0116/0079 兩個 migration 同車,release_command 失敗即中止部署(fly 機制),不會半套。
2. 無高風險行為開關變化:兩個遞延旗標、結帳旗標全部維持現狀。
