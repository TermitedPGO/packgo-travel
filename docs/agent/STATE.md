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
- B1+B1.1:已部署 v812(image SHA ae0ea9d4)且即時驗證通過(Codex 6.7 裁定措辭):health 全 ok、authenticated smoke 八臂綠(Codex 機上補驗)、部署前後信託聚合逐項不變。兩輪 cron 運行驗證全過,Codex 17 輪獨立複核蓋章(免第三輪);證據原件(BullMQ/探針原始 JSON)已入 evidence/ 記雜湊。v813(B1.2)已於 2026-07-14 部署 complete(image 90848514;七閘全綠含審查閘 6.9 首次真跑;部署後探針零信託寫入;evidence: prod-baseline-20260712.md v813 段)。B1 主題全鏈閉環。B1.2 已交付(commits 3d966650+5b214ef8,已推 origin,未部署):safe-deploy 去 rollback 建議+DEPLOYED_UNVERIFIED+審查閘 6.9(只比對索引狀態欄;整行比對死閘缺陷由指揮與對抗審查獨立收斂後修,附回歸測試)、TrustCard 三 key 中性化、真閘漏斗測試(pairsFound=1 零 UPDATE)、drizzle 守門+反引號紅測、failed handler 可測、11+2 行日期誤標修。驗證:tsc 0/trust 139 綠/i18n 551/ship:test 32。下一次 ship 條件:待傳信擺渡且索引 L43 狀態結案(審查閘才綠)+第二輪 cron 過。backlog 增:zh-TW 8956+en trustNote「已出發認列」。文案精確狀態(6.7補校正,不做全稱宣告):RecognitionCard 與 worker/卡片通知已改中性、活躍通知路徑無催轉語;FinanceCockpit/TrustCard.tsx 仍有「已出發待認列/出發後才認列轉 Operating」舊文案,待 B1.2。B1.2(6.6 退回,首輪 cron 後施工):safe-deploy 危險 rollback 指引+DEPLOYED_UNVERIFIED、TrustCard 文案、真閘漏斗測試、drizzle SQL 守門、7-13 誤標註解、preflight 加「外部審查未結不得進 token 閘」。evidence: features/trust-recognition-fail-closed/prod-baseline-20260712.md。
- 銀行正本(6.8 系列,Codex 於 Jeff 本機盤點,repo 只記去識別狀態):BofA 四帳戶身分已齊(兩存款帳+兩信用卡);兩存款帳 PDF 月結單連續;兩卡交易 CSV 已收且身分分開驗證;兩卡正式 PDF 月結單待補。新 P0(獨立任務,只有 Jeff 能動):信託帳銀行正本印「California IOLTA Trust Accounts / Public Service Trust Account」=律師信託名義,非 Seller of Travel 客款信託;待 Jeff 向 BofA 取得書面釐清(產品類型/所有權/利息歸屬/是否 IOLTA 報送),書面確認前不自行關帳、搬錢、改名。保全:三層結構已建(2026-07-12 深夜,~/legal_hold/bofa_bank_stmts_20260712:originals_readonly 400/working 600/去識別 manifest+異位副本 ~/dev/_保全manifest副本):27 檔全數雜湊零損複製(18 OP-DEP+6 TR-DEP+3 CC-A),stmt.csv SHA-256 與 Codex 6.8補 記錄完全一致。桌面 untitled folder 原件在 iCloud CloudDocs 同步路徑(已證),保留待 Jeff/律師裁決,同 §8 先例。CC-B 的 64 筆 CSV 不在該夾,位置待 Jeff 告知後補入保全。
- 本週主軸(6.9,Jeff 提出 Codex 同意):網站最小商業閉環 — 貨架可比較、詳情頁可決策、提交訂位需求必接住可追蹤,後台只留單一需求佇列+雙提醒路徑;付款維持 fail-closed(IOLTA 釐清前不開線上收款);明確不做清單見 Codex 6.9 §五。排程:B1 閉環(cron 兩輪+B1.2)收完後開新 session 施工。精確宣稱:recognizedAt 自動寫入已移除;轉帳偵測經機械閘(trustTransferWriteGate 硬 false)強制 dry-run,manual_backfill blocked,端點寫模式 403;催轉語全移除;「已出發」改中性;scan 用 LA 曆日;!db 改 throw。Codex 6.5 五完成線全補,其裁定=B1.1 補完立即部署不等 CPA 矩陣。對抗審查 fresh opus PASS 零阻塞;指揮親跑 trust 133 綠+tsc 0。第 3 層驗證(部署後次日 cron 零自動認列+recognizedAt COUNT/MAX 基準比對)pending。逐筆核准端點刻意未建(等 CPA 矩陣),建成前認列全停擺。backlog:報表未定稿標示(P1.4)、en trustNote「recognized (departed)」措辭、資料模型三分離。
- gmail-intake-ledger(branch 5e68a7c7,不進 main):切片 1-1.4 已交付(ledger/History 引擎/前綴推進/事件冪等/row claim/心跳續租/消耗水位/authoritative 硬閘)。Codex 17 輪:ledger 併發保護過,authoritative 硬阻擋(客戶副作用 outbox=獨立設計批);切片 1.4 修 P0-1 後 shadow-only code gate 重新申請中。之後停 Gmail 擴建回前台(七月排程)。v814 不合 main 不部署;30 天 dry-run/136 分類續停;scan 建列 '0' 兜底待 Codex 裁。Emerald/AXT 該信 Jeff 人工處理中。evidence: features/gmail-intake-ledger/progress.md。
- 證據補全批:完成(evidence_preservation 包+缺口登記+系統快照,~/Documents,已抽核)。
- DB 硬化批:完成(branch db-hardening commit 00324eb,抽核過:migrate 安全回退、schemaContract 缺表才 503、canary 腳本備妥未實跑、角色腳本佔位符無真憑證)。未合 main。code 部分(schemaContract+deploySmoke 九臂+migrate 回退)byte-identical 安全;角色/canary/還原需 Jeff console 操作才推進。runbook: docs/infra/db-role-hardening.md、restore-drill.md。
- CLAUDE.md 治理修正:本批(Codex 5.5 三 P0 已核採納,詳規進 60-evidence-and-ops.md)。

## 等 Jeff(晨晚兩班)
①信託第零步:停掃款聲明+BofA 轉出通知 ②律師/CPA ③五份正本下載進保全夾 ④DB 硬化重派授權 ⑤兩指揮 session 收成一個 ⑥商業試驗選團+流量源 ⑦裁決預算 B。

## 鐵閘
pnpm ship 只有 Jeff;AI 不動錢;runtime 禁 DDL(硬化前 prod 仍 root=活風險);prod schema 只准 tracked migration;供應商成本/圖不上客面;repo 在 ~/dev/網站(iCloud 隔絕);完成宣稱附 evidence_reference。

## 慣例
執行者只讀派工單;治理細節在 60-evidence-and-ops.md;歷史各 feature archive/;每日 journal/;本檔唯一狀態源。
