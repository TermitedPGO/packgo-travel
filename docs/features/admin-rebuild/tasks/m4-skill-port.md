# M4: Skill Port（報價單優先）

> 零件四。把 skills 接入 OpsAgent，報價單（packgo-quote）先做。

## 現狀

| Skill | isPorted | 狀態 |
|-------|----------|------|
| packgo-tour-comparison | true | 已可用 |
| packgo-quote | false | 有 template + 邏輯，未接入 agent |
| packgo-flight-ticket | false | 有 template，未接入 |
| packgo-deposit-receipt | false | placeholder |
| packgo-china-visa | false | placeholder |
| packgo-tour-confirmation | false | placeholder |

## Checklist

### 報價單 port（最高優先）

- [ ] 確認 `packgo-quote` skill 目前的檔案結構和 template
  - skill 定義在哪裡？有沒有獨立的 executor？
  - template HTML 在哪裡？
  - 需要哪些參數？（客人名、行程、價格、人數、日期...）

- [ ] 寫 skill executor `server/agents/skills/executors/quoteExecutor.ts`
  - 接收結構化參數
  - 填充 template HTML
  - 用 wkhtmltopdf 或 headless Chrome 轉 PDF
  - 上傳 PDF 到 R2
  - 回傳 fileUrl

- [ ] 在 `registry.ts` 設定 `isPorted: true`

- [ ] 在 `dispatcher.ts` 加入 quote skill 的 dispatch 邏輯

- [ ] 從 OpsAgent 調用測試
  - 模擬對話：「幫 David 報價日本 7 天 3 人」
  - 驗證 PDF 生成正確

- [ ] 寫 Vitest 測試

### 機票確認單 port（次優先）

- [ ] 確認 `packgo-flight-ticket` template 和參數
- [ ] 寫 executor
- [ ] 設定 isPorted: true
- [ ] 測試

### 其他 skill（後續）

- [ ] packgo-deposit-receipt
- [ ] packgo-china-visa
- [ ] packgo-tour-confirmation
- （這些可以在組裝階段後逐步做）

## 依賴

- wkhtmltopdf 或 headless Chrome 需要在 server 可用
- R2 storage 已有（server/storage.ts）
- 報價單需要行程數據（從 tours table 或 supplier API）

## 安全紅線

- 報價單只顯示售價（直客價），絕不顯示 agentPrice / 同業價
- PDF 不顯示供應商成本

## 不做

- 不做前端 UI
- 不做 skill 自動選擇（先由 OpsAgent 明確指定 skill name）
