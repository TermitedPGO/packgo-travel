# Reply Attachments — 桌面檔案 → 系統 → 客人回信

> Stage 1 proposal（2026-06-15）。起因：Jenny 報價 PDF 做完，沒辦法跟著後台回信一起送到客人手上。

## 問題（Jeff 的原話）

1. 「做完報價也要同時附上給客人」— 報價 PDF 產生後，應該自動跟著回信送出，不該是事後手動補。
2. 「自動附件我很常都是從我桌面移動到我電腦，你得幫我改進那個部分」— 檔案常在 Jeff 本機桌面產生（PDF / Excel / 行程表），目前要把桌面檔案弄進系統很麻煩，這段是主要痛點。

## 現況（已查證）

- 後台所有回信路徑（escalation「編輯並回覆」、inquiry reply、pipeline auto-reply）送出走的是 `server/_core/gmail.ts` 的 `buildMimeReply` → `sendReplyInThread`，目前只組「純文字 / HTML」MIME，夾不了附件。
- Gmail 送出用的是 `gmail.users.messages.send({ raw })`（raw MIME），底層本來就能掛附件，只是 `buildMimeReply` 還沒組 multipart。
- `server/storage.ts` 已有 `storagePut`（上傳 R2）、`getSecureDocumentUrl`（敏感文件時效連結）、`storageGet`。所以「把檔案放上雲端拿連結」的能力已經有。
- 結論：缺的不是能力，是兩段沒接：① 桌面檔案進系統的入口 ② 回信夾附件的出口。

## 目標

1. 後台回信能夾附件（PDF 為主，也支援 Excel/圖片）。
2. 桌面檔案能順暢進系統：後台回信 composer 直接拖放上傳 → R2 → 夾進這封回信。不用 Jeff 手動搬。
3. 報價情境自動化：產生報價 PDF 時自動上傳 R2 + 預設夾進該客人的回信草稿（Claude 產 PDF 後直接 push 進系統）。

## 非目標（這版先不做）

- 不做本機資料夾 watcher / 自動同步整個桌面（屬 local agent 範疇，另議）。
- 不改客人端網站，只動後台 + 寄信。

## 成功標準

- Jeff 在 Jenny 的卡片「編輯並回覆」裡，拖一份桌面 PDF 進去 → 送出 → Jenny 收到的回信帶著那份 PDF（或 >25MB 時帶下載連結）。
- 報價流程產出的 PDF 自動出現在該客人回信草稿的附件清單，Jeff 不用手動搬檔。
