# Guest Customer Chat — 訪客也有 per-customer AI 聊天窗

> 起因（2026-06-15）：Jenny 來回這麼多次，後台還是沒有她的單獨聊天窗。查證後不是 bug，是設計：聊天窗只給註冊客戶，訪客只有唯讀頁。

## 問題

- 註冊客戶有 per-customer 聊天窗：`client/src/components/workspace/CustomerChat.tsx`，掛在完整客戶頁 `CustomerInbox.tsx:245`，用註冊 user id 當 key（呼叫 `/api/agent/ask-ops-stream?q=...&customerId=${userId}`）。
- email 訪客（`customerProfiles` 有 email、沒帳號/userId）走 `GuestCustomerPane.tsx`：只有唯讀來信紀錄＋用今日待辦卡片回覆，**沒有聊天窗**。元件註解寫著是 Jeff 拍板「訪客也進 sidebar，但輕量」。
- 結果：像 Jenny 這種高互動詢問，在她註冊前都沒有專屬聊天工作區。

## 目標

讓 email 訪客也有同樣的 per-customer AI 聊天窗，用 `customerProfileId` 當 key，掛進 `GuestCustomerPane`。Jeff 可以在裡面跟 OpsAgent 針對這位訪客對話（問她的 case、擬回覆等），跟註冊客戶體驗一致。

## 先讀這些碼

- `client/src/components/workspace/CustomerChat.tsx` — 聊天元件，目前吃 `userId`，串 `ask-ops-stream?customerId=${userId}`。
- `client/src/components/workspace/CustomerInbox.tsx`（約 245 行）— 完整客戶頁掛 `<CustomerChat userId=...>`。
- `client/src/components/workspace/GuestCustomerPane.tsx` — 訪客頁（唯讀，無聊天）。
- `server/agents/autonomous/opsAgentStream.ts` — `runOpsAgentStream(question, history, imageUrls, extraSystem)`；`extraSystem` 是「這條對話是關於哪位客人」的 pin（批2 m3）。
- `ask-ops-stream` endpoint（`grep -rn "ask-ops-stream" server`）— 目前用 `customerId`（= 註冊 userId）解析客人 context；要改成也能用 `customerProfileId` 解析。
- per-customer 聊天歷史怎麼存（`agentMessages`？某個 scoped key）— 訪客聊天要 key 在 profileId。

## 設計

- **後端**：`ask-ops-stream` 多收一個 optional `customerProfileId`（與現有 `customerId`/userId 二選一）。用它去 `customerProfiles` 撈出訪客（姓名、email、來信 context），組同樣的 `extraSystem` pin。聊天歷史 scope 到 profileId（reload 後還在，跟註冊版一樣）。
- **前端**：`CustomerChat` 改成可接 `userId` 或 `customerProfileId`（discriminated prop）。掛進 `GuestCustomerPane`（唯讀來信紀錄下方）。
- **i18n**：新字串進 zh-TW + en。
- **測試**：profileId 解析出正確客人 pin；endpoint 接受 profileId；歷史 scope 正確。

## 非目標

- 聊天窗內的自動動作不超出註冊版 `CustomerChat` 已有的。
- 訪客→完整客戶升級流程不動（註冊後一樣升級）。

## Rollout

`tsc --noEmit` 0 錯（OOM 用 `NODE_OPTIONS=--max-old-space-size=6144`）＋ vitest 綠 → `pnpm ship`（Jeff 放 token，§4.3）。驗收：Jenny（profile 2550004）的訪客頁出現可用的聊天窗。
