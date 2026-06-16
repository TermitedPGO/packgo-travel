# Reply Attachments — Design (Stage 2)

> 配合 proposal.md。實作放下一個乾淨 session（§9.7）。本檔是給實作 session 的交接圖。

## 三段資料流

```
[桌面檔案] --拖放上傳--> uploadReplyAttachment(admin) --storagePut--> R2
                                                              |
                                          回 {key, url, size, mimeType}
                                                              |
       存進該回信草稿 context.attachmentKeys[] <--------------+
                                                              |
[送出回信] sendEscalationReply/inquiryReply --attachmentKeys--> storageGetBytes
                                                              |
                              buildMimeReply(body, attachments[]) --multipart/mixed--> gmail.send(raw)
                                                              |
                                          >25MB? 改放 getSecureDocumentUrl(7d) 連結在內文
```

## 模組改動（檔案 → 改什麼）

### 出口：回信夾附件
- `server/_core/gmail.ts`
  - `buildMimeReply(input)` 擴充：`input.attachments?: { filename: string; mimeType: string; content: Buffer }[]`。
    有附件時組 `multipart/mixed`（第一部分原本的 text/html，其後每個附件一個 part，`Content-Disposition: attachment; filename*=UTF-8''<RFC5987>` 處理中文檔名，base64 編碼）。無附件時行為不變（回歸測試）。
  - `SendReplyInput` 加 `attachments?`。
- `server/storage.ts`
  - 加 `storageGetBytes(relKey): Promise<{ bytes: Buffer; mimeType: string }>`（目前只有回 URL 的 storageGet，需要能抓 bytes 給 MIME）。
- `server/_core/escalationBox.ts`
  - `sendEscalationReply` 收 `attachmentKeys?: string[]` → 逐一 `storageGetBytes` → 總和 >25MB 時不夾、改在內文尾端附 `getSecureDocumentUrl` 連結 → 否則傳 attachments 給 send。
- `server/_core/inquiryReply.ts`
  - `sendAdminInquiryReply` 同步加 `attachmentKeys?`（保持兩條送信路徑一致，見該檔 header 註解）。

### 入口：桌面 → R2
- `server/routers/commandCenter.ts`
  - 新 `uploadReplyAttachment` (adminProcedure)：input `{ filename, mimeType, base64 }`（先做 base64 mutation，<10MB；之後可升級 presigned PUT 直傳）。
    驗 mimeType 白名單（pdf/xlsx/png/jpg）+ 大小上限。`storagePut("reply-attachments/<profileId|guest>/<ts>-<safeName>", bytes)` → 回 `{ key, url, size }`。
  - `escalationReply` mutation input 加 `attachmentKeys?: string[]` → 轉給 `sendEscalationReply`。
- 草稿存附件：沿用 `agentMessages.context` JSON，加 `attachmentKeys: string[]`（無 schema 變更）。escalationBox 的 parse 加讀這個欄位。

### 客戶端：composer 拖放
- escalation 回信 dialog 元件（client/src/components/workspace/ 內，TodayEscalationCard 開的回覆 dialog）：
  - 加拖放 / 檔案選擇區（`<input type=file>` + drop zone，圓角 `rounded-lg` 合規）。
  - 選檔 → 讀成 base64 → 呼叫 `trpc.commandCenter.uploadReplyAttachment` → 顯示已附清單（檔名 + 大小 + 移除鈕）。
  - 送出時把 attachmentKeys 一起傳給 `escalationReply`。
  - i18n：新字串進 zh-TW + en（附加檔案 / 移除 / 上傳中 / 檔案過大）。

### 報價自動附件（第二階段，可先不做）
- 報價 PDF 產生流程（packgo-quote skill 產檔後，或 produceQuoteDraft）→ 自動呼叫 uploadReplyAttachment → 把 key 寫進該客人 escalation/draft 的 `context.attachmentKeys` → composer 預設帶出。
- Claude 端工作流：產完桌面 PDF 後，直接走上傳入口把檔案推進系統（直接解掉「從桌面手動搬」）。

## 測試（vitest，§9.5/§9.6 必寫）

- `gmail.test`：buildMimeReply 無附件 = 原樣（回歸）；有 1~N 附件 → multipart/mixed 結構正確、中文檔名 RFC5987 編碼正確、base64 內容可還原。
- `storage`：storageGetBytes 回正確 bytes + mimeType。
- `commandCenter`：uploadReplyAttachment 白名單擋非法 mimeType、超大擋下、storagePut 被呼叫、回 key。
- `escalationBox`：sendEscalationReply 帶 attachmentKeys → storageGetBytes 被呼叫、傳給 send；總和 >25MB → 改連結不夾。

## Rollout

1. 後端先（gmail/storage/escalationBox/commandCenter）+ 測試 + `tsc --noEmit`（OOM 用 `NODE_OPTIONS=--max-old-space-size=6144`）。
2. 客戶端 composer 拖放 + i18n。
3. `pnpm test` 綠 → `pnpm ship`（Jeff 放 .deploy-approve token）。
4. 先驗 escalation 回信路徑（Jenny 這筆直接受惠），再接 inquiry + 報價自動附件。

## 風險

- 中文檔名 MIME 編碼（RFC5987 / RFC2047）易出錯 → 測試一定要含中文檔名 case。
- Gmail 25MB 上限 → 超過自動降級成下載連結，不可硬夾爆 send。
- 客人端收到附件的安全性：附件只走 outbound（Jeff 確認送出），不開放客人上傳路徑。
