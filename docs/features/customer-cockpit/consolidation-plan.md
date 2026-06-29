# 客戶頁合併計畫 — 收斂成一頁(/ops/customers)

> 2026-06-29。Jeff:「我們就只該有兩種,測試間以及正式使用」+「所以我才在重建」。
> 北極星:客人頁只留一個(/ops/customers 駕駛艙)當正式,退掉 /workspace 與 admin-v2-archive。
> 重建的用意 = 甩掉沒人用的操作鷹架,不是把它們搬過來。來源:本 session 兩個 Explore agent 審計。

## 一、現在有三個世代(問題本身)

| 路由 | 元件 | 狀態 |
|------|------|------|
| `/admin-v2-archive` | admin-v2/CustomersTabV2 | 舊 28-tab,已封存 |
| `/workspace` | workspace/CustomerInbox(+ admin-v2/CustomerDetailSheet) | 整合工作台。/admin、/admin/v2 都 redirect 來這,目前實際在用 |
| `/ops/customers` | admin/customers/* 駕駛艙 | v4 重建,腦已做完,要變唯一 |

## 二、/ops 已經領先的(腦)

五秒真相條、漏價看門狗、客人記憶面板、AI 摘要(即時重算)、AI 工作台 + 草稿核可、訪客 parity。這些 /workspace 沒有。所以 /ops 不是落後,是更進。

## 三、/workspace 有、/ops 沒有的(手)—— 逐項裁決

Jeff 決策:重建是要甩掉這些,預設不搬;只有「碰到你日常真的在用」才搬。Jeff 已表態不用 app 管訂單。

| /workspace 功能 | 舊檔 | 大小 | 裁決 |
|------|------|------|------|
| 代客訂機票管理(建單/出票狀態機) | workspace/CustomerFlightOrders, FlightOrderDialogs | 大 | 預設不搬(你不在 app 管);真要用再單獨搬 |
| 訂單明細(取消/改期/退款/voucher/催尾款) | workspace/BookingDetailSheet | 大 | 預設不搬 |
| 簽證 6 步驟追蹤 | workspace/CustomerVisaSection | 中 | 預設不搬 |
| 客人微信訊息管理 | workspace/CustomerWechatMessages, WechatApproveDialog | 大 | 擱置,之後再決定(且你定過不接微信個人號) |
| 報價紀錄列表(歷史報價 PDF) | workspace/CustomerQuoteRecords | 中(輕) | 待定,輕,要的話便宜 |
| 升級回信對話框(附檔 + 收件人確認) | workspace/EscalationReplyDialog | 中 | 待定。/ops 的草稿送出已走同一條 escalationReply,只缺「附檔 + 確認」UI 變體。你回信會附檔才需要 |
| AI 建議動作 chips(聊天裡) | workspace/CustomerChatActions | 中 | 待定。/ops 聊天目前不渲染建議動作 chip。屬你日常聊天的 UX,要不要看你 |
| 訪客刪除 | workspace/GuestCustomerPane | 小 | 便宜,順手可加 |
| Auto-send 政策卡 | workspace/AutoSendPolicyCard | 小 | 公司層級設定,不屬單客頁,不搬 |

「待定」三項(報價紀錄 / 升級附檔 / 動作 chips)是唯一碰到你日常聊天/報價流的東西,動工時逐一問你要不要,其餘直接不搬。

## 四、收斂順序

1. /ops/customers 打磨完(proposal-header-notify-followup.md 的四題)。
2. 裁決「待定」三項要不要(動工時問)。
3. 客人入口指向 /ops/customers,棄用 /workspace 的客人頁。
4. 確認沒別的東西依賴後,刪掉重複的客人元件:workspace/CustomerInbox + 其客人子元件、admin-v2/CustomerDetailSheet(若 /ops 不用)、CustomersTabV2 的客人部分。刪除安全、便宜。

## 五、要先確認的閘(別假設)

- 完整刪掉 `Workspace.tsx`、把 `/admin`→`/ops` 整個翻過去,不只是客人頁:/workspace 還掛了公司層級的東西(分類帳、供應商、出團、今日任務等)。那些要先由其他 /ops domain(tours/finance/marketing/settings)接住,才能真的刪 /workspace。本計畫只負責「客人這塊」收斂到 /ops/customers;整站翻轉要另做跨 domain parity 檢查(本 session 未審其他 domain)。
- 測試間:暫照既有 = 本機/preview 測 → `pnpm ship` 上正式 → Jeff 放 .deploy-approve 同意。若 Jeff 要獨立線上 staging(自己網址+DB),另議。
- 微信整塊擱置。

## 六、這個月建議排法

- 先做:打磨四題(小、每天有感、先 ship)。
- 再做:客人頁收斂到 /ops(裁決待定三項 → 入口指向 /ops → 刪重複客人元件)。
- 排後(較大,非本月硬塞):Q4-B 日曆同步(OAuth scope)、整站 /workspace 退役(跨 domain)、微信。

部署一律:分支 → 測 → 給 Jeff 看 → 他同意才 ship。session 不自行部署。
