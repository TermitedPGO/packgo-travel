# Reply Attachments — Progress

> Stage 4 implementation. Started 2026-06-15. Decisions confirmed with Jeff before coding (§9.3).

## Jeff 拍板的三個決定（2026-06-15）

1. **上傳路徑**：presigned PUT 直傳（browser → R2），不是 base64-through-tRPC。
   - 原因：避開 Express 10mb body limit，大檔不卡。
   - 代價：需要 R2 bucket CORS（見下方 Deploy 前置）。
2. **附件預設**：夾檔為主，>25MB（base64 編碼後）才降級成 7 天下載連結。
3. **這個 PR 範圍**：escalation 回信路徑跑通（後端 + composer + 測試）。
   inquiry 路徑只加 `attachments` 參數保持一致（無 UI）；報價自動附件留下一個 PR。

## 模組狀態

| 模組 | 檔案 | 狀態 |
|------|------|------|
| 共用解析器 | `server/_core/replyAttachments.ts` | ✅ + test |
| R2 bytes + presigned PUT | `server/storage.ts`（storageGetBytes / storageCreatePresignedPut）| ✅ + test |
| MIME multipart | `server/_core/gmail.ts`（buildMimeReply 多段 + RFC5987）| ✅ + test |
| escalation 出口 | `server/_core/escalationBox.ts`（sendEscalationReply 收 attachments）| ✅ + test |
| inquiry 出口（參數一致）| `server/_core/inquiryReply.ts` + `server/emailService.ts` | ✅（無 UI）|
| 上傳入口 + 送出 | `server/routers/commandCenter.ts`（createReplyAttachmentUpload + escalationReply）| ✅ + test |
| composer 拖放 | `client/src/components/workspace/EscalationReplyDialog.tsx` | ✅ |
| i18n | `client/src/i18n/{zh-TW,en}.ts`（escReplyAttach*）| ✅ |

## 安全紅線（已落實）

- 附件 key 一律 namespace-guard：只接受 `reply-attachments/` 前綴，outbound email 不可夾任意 R2 物件（passport 同桶）。
- mimeType 白名單（pdf / xlsx / xls / png / jpg / webp）+ 單檔 50MB 上限，presign 時擋。
- escalationReply 仍是 Jeff-gated（🔒 checkbox），附件不改這條鐵律。

## Deploy 前置（presigned PUT 必須）

> browser → R2 直傳 PUT 需要 R2 bucket 設 CORS，否則瀏覽器 PUT 會吃到不透明的 CORS error。

R2 bucket CORS（packgoplay.com 來源）：
```json
[
  {
    "AllowedOrigins": ["https://packgoplay.com", "https://www.packgoplay.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```
（本機開發另加 `http://localhost:*` 來源。）

## 測試

- `replyAttachments.test.ts` — 白名單 / 大小擋 / encodedSize / 中文檔名 inline / >25MB→link / cumulative overflow / namespace guard。
- `gmail.test.ts` — 無附件回歸 / multipart 結構 / 中文 RFC5987 round-trip / base64 還原 / 多附件。
- `storage.test.ts` — storageGetBytes bytes+mime / storageCreatePresignedPut ContentType baked-in。
- `escalationBox.test.ts` — 小檔 inline / >25MB→link / namespace abort / 無附件回歸。
- `commandCenter.test.ts` — 白名單 BAD_REQUEST / 超大擋 / 合法 presign 回 key+putUrl。

## Rollout（剩下的）

1. tsc --noEmit 0 錯 + pnpm test 綠。← 驗證中
2. Jeff 設 R2 CORS（上方）。
3. `pnpm ship`（Jeff 放 .deploy-approve）。
4. 先驗 Jenny 的 escalation 回信：拖一份桌面 PDF → 送出 → Jenny 收到附件。
5. 下一個 PR：inquiry Inbox composer + 報價 PDF 產生後自動附件。
