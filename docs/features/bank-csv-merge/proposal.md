# 提案 — 銀行帳目雙源合併(Plaid 自動 + CSV 完整描述覆蓋)

> Stage 1。起因 2026-06-12:Jeff「plaid 都是泛詞,連去 jack in the box 買什麼都不知道」。
> 前置診斷見 docs/features/admin-chat-claude-parity/backlog-plaid-descriptions.md(prod 驗證,非推測)。

## 問題(prod 數據)
- BofA 經 Plaid API 回傳被閹割:`PURCHASE`×55、`MAIL/TELEPHONE ORDER`×30,
  originalDescription 全 null、paymentMeta 內欄位全 null。小額刷卡連商家都沒有。
- Jeff 上傳的 BofA CSV 描述完整:Zelle memo + Conf#、商家+網址+地點(`INTUIT *TURBOTAX
  CL.INTUIT.COM CA`)全保留。
- 兩條來源並存但互不認識:今天 0 組精確重複,但同期間兩條都灌 + 日期差 1-2 天時
  會變成重複入帳(double-count P&L)。
- AI 分類在 Plaid 泛詞上失去最強信號(memo),大量卡 other_review。

## 目標
1. Plaid 照常自動同步(即時現金流,自動化優先)
2. Jeff 月底上傳一次 BofA CSV,系統**自動認出同一筆交易**:合併成一筆、CSV 完整描述覆蓋
   Plaid 泛詞、絕不重複入帳
3. 描述變豐富後,卡住的 other_review 自動重跑 AI 分類(仍只是建議,Jeff 確認才算 — 鐵律)
4. 帳本 UI 露出完整描述

## 非目標
- 品項明細(在 Jack in the Box 買了什麼漢堡):任何銀行 feed/CSV/QuickBooks 都沒有,
  只有收據有 — 走既有收據上傳,不在本 feature
- PDF 對賬單解析(現系統 PDF 只當附件,擴 parser 是另一個 feature)
- 換 aggregator(Finicity 等):Plaid 夠用於現金流,描述靠 CSV 補
- 任何自動確認分類:鐵律不動

## 成功標準
Jeff 上傳一份真實月度 CSV → 結果回報「合併 N 筆 / 新增 M 筆 / 模糊跳過 K 筆」,
帳本裡原本的 PURCHASE 變成完整描述,總金額分毫不差。
