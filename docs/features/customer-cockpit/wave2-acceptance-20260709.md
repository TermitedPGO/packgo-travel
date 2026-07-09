# Wave 2 指揮驗收判定(2026-07-09,Fable)

> 受驗:branch `hardening-wave2`(d6fc35d + c2a2895),T6 報告 `t6-report-20260709-wave2.md`。
> 方法:四路 fresh 驗收(獨立重跑 / 手抄 SQL 保真抽查 / 通道安全複核 / 閘整合與 latent bug 核實),全程唯讀不碰 prod。

## 判定:PASS,併回 main

- 獨立重跑:tsc 0 錯;sqlRehearsal+observability 45/45;safe-deploy 閘測 22/22;單檔連跑穩定。數字與 T6 逐一相符。
- 保真抽查:9 條 handWritten 逐條與真碼比對全數語意等價;buildGuestListQuery 確為真 toSQL;coverage 守門實作是逐行精確雙向比對(比 T6 描述的 span 機制更嚴);白名單 3 條全成立;suppliersRouter 31 個 token 逐一走查零吞噬。
- 安全複核:18 組繞過構造(全形空白/BOM/註解前導/ANALYZE/大小寫/動詞黏字)全數被正向白名單擋下;參數內分號不誤殺;multipleStatements:false 雙保險;實測 Node 22 憑證不外洩。
- 閘整合:6.5 位置正確,既有七閘 diff 刪除行 = 0;三路 fail-closed;counters 近 7 天口徑正確且測試變強;worktree 紀律乾淨。

三條偏離申報(規模 168→357、手抄+prod EXPLAIN 兜底、stdin 換 base64)全數追認:方向不變、判斷正確。

## Latent bug 裁決

- opsActions.ts:390(P1,比 T6 申報更嚴重):cancel_booking 常態靜默假成功(訂單沒取消座位沒釋放卻回成功),數字開頭 reason 可能錯列取消。已另立任務卡 `task_b55ba8a9`,含歷史資料唯讀盤查。非本波修,不擋收。
- scheduledLearningService.ts:519(P3,比 T6 申報略輕):多 id 只學第一個,功能休眠(無前端呼叫點)。進 Wave 4 回歸考古總帳。

## P3 順手清單(下批帶走,不擋收)

1. registryEntries minPrice 條目錯認領 suppliersRouter.ts:1164-1165 兩行(無實害,帳目訂正)。
2. marginAudit 兩條 '?'→'Q' 字面替換補進條目 note(手抄申報完整性)。
3. rehearsalCore.test.ts 補 `--` 與 `#` 前導行註解兩個 expect(行為已正確,釘測試)。
4. sqlRehearsalGate.ts:138 sentinel 解析改 lastIndexOf(END),失敗訊息含 sentinel 字面時歸因不被誤導(仍 fail-closed,非安全題)。
5. sqlRehearsalGate.ts:73 註解改寫:遠端 stderr 實際會轉發本地,已驗無憑證;Node 升版時複驗。
6. safe-deploy.mjs 檔頭 docstring 補 6.5 閘與 SKIP_SQL_REHEARSAL;`all 7 gates passed` 字樣順手改。
7. progress.md 2043→2042 off-by-one。
8. weeklyCorrectnessAudit.ts:498 gatherQueueFailedCounts 傳入 audit 的 now(風格一致)。
9. T6 §5.2 span 描述與實作不符(實作更嚴),報告已成歷史檔不改,此處記錄澄清。

## 待 Jeff

1. gmail-poll 36 筆歷史 failed(dry-run 清單在 T6 附錄):點頭即清,不點頭不動。
2. ship 時機:閘 6.5 在本機 ship 腳本就生效(不用部署);counters 近 7 天口徑要部署才上線,建議等 F1 塊D 收完併一批 ship。
