# 指揮交接檔(唯一狀態源,主 session 開工必讀)
> owner: Fable 指揮 | last_verified_at: 2026-07-12(prod flyctl releases + prod 表存在性核實)

## prod 現況(已核實)
- 版本:v811(2026-07-11 晚部署,flyctl releases 核;v810 前一版)。四批全上線:行程頁修繕、skillRuns 建表、結帳驗位+揭露存證、財務工作台。
- migration 已套:0116 checkoutDisclosures ✓、0079 skillRuns ✓(prod SHOW TABLES 核)。
- 旗標:TOUR_INSTANT_CHECKOUT_ENABLED=OFF(結帳停止線生效,tour 按鈕=提交訂位需求,伺服器 fail-closed);PLAID_TRUST_DEFERRAL_ENABLED=ON(Fly secret,既有);STRIPE_TRUST_DEFERRAL_ENABLED=OFF。
- 待驗(未核實,標記):v811 部署後 smoke、16 團 Jeff 驗貨結論、看門狗 7/13 首跑。

## 已驗證 P0(證據在手)
- prod runtime 等同 root(2026-07-12 SHOW GRANTS:DROP/CREATE/ALTER/CREATE USER/SUPER),能刪表=6/17 洞仍開。DB 硬化必要性坐實。evidence: scratchpad/grants-recon.cjs。
- 信託 −$10,442=過水掃款非短缺(對帳到分),§17550 時點違規疑慮。待 Jeff:停掃款聲明(第零步)、律師/CPA、逐筆認人。evidence: trust-drift-audit-20260711.md。
- 五通道僅佔真實收款 29%,71% 是支票/拍存/電匯(信託三筆落此);訂單配對近乎零。重建框架須「全部進帳」。evidence: channel-aggregate-20260712.md。

## 結帳模式(已裁定不可回退)
- 模式一「驗證後即 capture」永久退役(UV 無 hold=付款成功但訂位失敗競態)。啟用路徑=模式二(授權→供應商確認→capture)或詢位制。付款成功≠訂位成功。

## 外部 AI 交流(Codex 第 5.5 輪)
- 分歧歸零。系統健康 4.1/10、CLAUDE.md 憲法 5.5/10。四 P0 待運行證據:DB 硬化、信託補救、五通道閉合、商業試驗。
- 通信檔:桌面 PACKGO_AI交流/(兩夾+索引);第 5 則(虛報自首)草擬待證據齊才傳。

## 在飛/待處理
- B1+B1.1:信託停止線已部署 v812(2026-07-13T00:14Z 前後 Jeff ship;77045fc + 0aafe37e,origin ae0ea9d4)。部署後第 1 步驗證 PASS:比對探針與基準逐項相同(recognizedCount 0/maxRecognizedAt null/pending 3),/health 全 ok。待 06:00 UTC cron 首跑驗 worker log+再探針,次日再一輪,全過才標「已部署且運行驗證」。evidence: features/trust-recognition-fail-closed/prod-baseline-20260712.md 執行紀錄。ship 警示 LOCAL_SCRIPT_TOKEN 未設(煙霧跳過),待 Jeff 補設。精確宣稱:recognizedAt 自動寫入已移除;轉帳偵測經機械閘(trustTransferWriteGate 硬 false)強制 dry-run,manual_backfill blocked,端點寫模式 403;催轉語全移除;「已出發」改中性;scan 用 LA 曆日;!db 改 throw。Codex 6.5 五完成線全補,其裁定=B1.1 補完立即部署不等 CPA 矩陣。對抗審查 fresh opus PASS 零阻塞;指揮親跑 trust 133 綠+tsc 0。第 3 層驗證(部署後次日 cron 零自動認列+recognizedAt COUNT/MAX 基準比對)pending。逐筆核准端點刻意未建(等 CPA 矩陣),建成前認列全停擺。backlog:報表未定稿標示(P1.4)、en trustNote「recognized (departed)」措辭、資料模型三分離。
- 證據補全批:完成(evidence_preservation 包+缺口登記+系統快照,~/Documents,已抽核)。
- DB 硬化批:完成(branch db-hardening commit 00324eb,抽核過:migrate 安全回退、schemaContract 缺表才 503、canary 腳本備妥未實跑、角色腳本佔位符無真憑證)。未合 main。code 部分(schemaContract+deploySmoke 九臂+migrate 回退)byte-identical 安全;角色/canary/還原需 Jeff console 操作才推進。runbook: docs/infra/db-role-hardening.md、restore-drill.md。
- CLAUDE.md 治理修正:本批(Codex 5.5 三 P0 已核採納,詳規進 60-evidence-and-ops.md)。

## 等 Jeff(晨晚兩班)
①信託第零步:停掃款聲明+BofA 轉出通知 ②律師/CPA ③五份正本下載進保全夾 ④DB 硬化重派授權 ⑤兩指揮 session 收成一個 ⑥商業試驗選團+流量源 ⑦裁決預算 B。

## 鐵閘
pnpm ship 只有 Jeff;AI 不動錢;runtime 禁 DDL(硬化前 prod 仍 root=活風險);prod schema 只准 tracked migration;供應商成本/圖不上客面;repo 在 ~/dev/網站(iCloud 隔絕);完成宣稱附 evidence_reference。

## 慣例
執行者只讀派工單;治理細節在 60-evidence-and-ops.md;歷史各 feature archive/;每日 journal/;本檔唯一狀態源。
