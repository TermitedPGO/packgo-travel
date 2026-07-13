# gmail-intake-ledger progress

| 階段 | 狀態 | 證據 |
|------|------|------|
| 診斷 | 完成 2026-07-13(三層根因親證) | journal/2026-07-13.md |
| Codex 裁定 | 第 11 輪收:History 主路徑/A 止血/E 30天/D 逐message/F 不准延後/release 分離 v814 | Codex/2026-07-13.md |
| Stage 1-3 docs | 完成 2026-07-13 | proposal/design/tasks01 |
| Slice1 施工 | 完成 2026-07-13(opus):ledger schema(0117 僅產檔)、History 引擎、push 先落帳後 ack、shadow/history 路由(legacy 零變化)、F 骨架、D 對帳、watch 告警、Task02 兩唯讀工具(未實跑) | branch gmail-intake-ledger |
| 對抗審查 | FAIL→修復:B1 分頁截斷照推游標(高,真破口)退回修正 — truncated 旗標+游標凍結+P1 卡+12 新測試,land-then-freeze 指揮親讀;B2 收據流回歸(noise 網域收據不進 ledger)=v814 切換硬前置,交 Codex 裁;低風險 fromAddress 正規化+errorDetail 洗淨同批收 | 本表+審查報告 |
| 指揮驗收 | 通過 2026-07-13:tsc 0、gmail 14 檔 229 綠、DDL grep 乾淨、順序鐵律/CAS/bootstrap/截斷凍結段親讀 | 本表 |
| shadow 運行證據 | 未(v814 部署後;v813 先行,release 分離) | — |

## v814 切換硬前置(對抗審查確立)
- B2:history 模式下 noreply/noise 網域收據不進 ledger,會斷 pendingExpenses 收據流(legacy 的 receipt pass 在 noise 閘前)。shadow 期由並行 legacy 接住=安全;切 history 前必須解(方案交 Codex:ledger eligibility 加收據軌,或 history 模式保留收據專用掃描)。
- 截斷卡自動關閉現騎在對帳 Rule 3 上(executor 誠實申報),獨立自關需 AlertPort 擴充,列 slice2。

WIP:本批為當前唯一高風險施工批(B1.2 已完工待部署,不佔施工名額)。

## 切片 1.1(Codex 12 輪兩結構 P0)
| 階段 | 狀態 | 證據 |
|------|------|------|
| 施工 | 完成 2026-07-13(opus):ledger 先於分類(發現即入帳,六終態,noise 留稽核)、逐頁前綴推進(續跑取代凍結,發現無 cap)、receipt route(單一入口,shadow 只記 wouldRoute)、0117 就地修訂 | branch |
| 對抗審查 | PASS 零阻塞;四 finding 指揮裁定修完才交:labelAdded 發現宇宙錯配(真漏接,必修)、sniff-throw 誤終態 noise、insert 錯誤面不一致、白名單裸語句漂移 — 全修+新測試(labelAdded/三宇宙一致/sniff-throw/insert-throw) | 本表 |
| 指揮驗收 | 通過:tsc 0、gmail 14 檔 256 綠、前綴推進主迴圈:376-435 親讀(頁界 API 回傳、落帳先行、CAS forward-only、續頁失效收輪) | 本表 |
| 下輪 Codex 證據 | 待:12 輪 §十五組(順序紅綠/liveness 收斂/receipt parity/本地 TiDB migration 實跑+schema probe/SHA+manifest);本地 TiDB=Jeff 線下測試指令 | — |
