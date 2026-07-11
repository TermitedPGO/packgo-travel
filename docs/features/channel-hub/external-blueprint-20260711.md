# PACK&GO 多渠道擴張完整建議

版本日期：2026 年 7 月 11 日

用途：提供 PACK&GO 與 Claude 指揮團隊作為多渠道客服、詢問、報價及訂單通知系統的產品與技術施工依據。

# 一、執行摘要

PACK&GO 應保留並積極準備 LINE、Meta、WeChat、Apple Messages for Business 等渠道擴張，但不應同時施工四套獨立客服系統。

先前「砍掉渠道擴張」應修正為：

> 不取消多渠道藍圖，但停止多渠道平行施工。先建立共同訊息核心與單一收件匣，再依實際詢問量逐一啟用。Gmail 是第一個參考實作與故障備援，不是永久唯一渠道。

長期原則是：

> PACK&GO 擁有客戶、對話、旅行需求與訂單真相，各訊息平台只提供可替換的傳輸能力。

這樣做不是延後成長，而是避免未來出現五個收件匣、五套客戶身分、五種 SLA、五套自動回覆規則，以及 Jeff 必須人工巡邏所有平台的局面。

# 二、商業目標與非目標

## 2.1 商業目標

1. 客戶可以使用自己習慣的渠道聯絡 PACK&GO。

2. Jeff 只需在一個 `/ops/inbox` 工作，不必分別巡 Gmail、LINE、Instagram、Messenger、WhatsApp、WeChat 和 Apple。

3. 所有渠道都能連回同一位客戶、同一個旅行需求及同一筆訂單。

4. 渠道擴張可以增加有效詢問和成交，而不使漏件、錯誤回覆及 Jeff 工時等比例增加。

5. 任一渠道或外部供應商故障時，不影響其他渠道及核心訂單資料。

## 2.2 第一階段不是目標的項目

1. 不做完整 CRM。

2. 不做跨渠道大量行銷廣播。

3. 不追求所有平台功能完全對等。

4. 不讓 AI 自主報價、承諾餘位、確認訂位、判斷退款或處理客款。

5. 不在聊天訊息中收集信用卡、護照影本或其他非必要敏感資料。

6. 不建立獨立的 `/ops/line`、`/ops/meta`、`/ops/wechat` 後台。

# 三、核心產品設計

所有渠道進入相同處理鏈：

```text
Channel adapter
    ↓
Webhook inbox
    ↓
驗簽與原始事件保存
    ↓
去重與順序整理
    ↓
Normalized conversation event
    ↓
客戶身分與旅行案件連結
    ↓
Assignment 與 SLA queue
    ↓
AI 分類、摘要或草稿
    ↓
Jeff 核准或安全自動回覆
    ↓
Channel policy gate
    ↓
Outbound delivery 與狀態追蹤
```

核心不能直接散落 `if channel === line` 或 `if channel === messenger` 的商業規則。平台差異應封裝在 adapter 和 policy gate，客戶、案件、報價及訂單邏輯則留在共同 domain。

# 四、最小資料模型

## 4.1 channel_account

代表 PACK&GO 在某平台的企業帳號。

最低欄位：

```text
id
channel
external_account_id
display_name
status
capabilities
credential_reference
last_verified_at
```

憑證只保存 secrets manager reference，不將 token 寫入資料庫明文、程式碼或文件。

## 4.2 contact

PACK&GO 的內部客戶實體，不依附任何單一平台。

```text
id
display_name
preferred_language
timezone
created_at
```

不要因為兩個渠道出現相同姓名就自動合併。

## 4.3 channel_identity

保存某位客戶在某平台的外部身分。

```text
id
contact_id
channel_account_id
external_user_id
verification_status
linked_at
unlinked_at
```

唯一約束至少包括：

```text
channel_account_id + external_user_id
```

客戶必須透過一次性安全連結、已登入帳號、已知訂單驗證或其他明確流程完成連結。不能只靠 AI 猜測或人工看起來像同一人。

## 4.4 travel_case

代表一次旅行意圖或服務案件。相同客戶可能同時詢問不同旅行，因此 conversation 不應只綁 contact。

```text
id
contact_id
tour_id
order_id
stage
owner
next_action_at
```

## 4.5 conversation

```text
id
travel_case_id
channel_account_id
external_conversation_id
status
assigned_to
last_customer_message_at
reply_window_expires_at
next_action_at
```

## 4.6 message

```text
id
conversation_id
direction
sender_type
external_message_id
content_type
text_content
provider_created_at
received_at
delivery_status
reply_to_message_id
```

附件應保存受控物件 reference，不把外部暫時 URL 當成永久檔案位置。

## 4.7 raw_webhook_event

```text
id
channel_account_id
provider_event_id
received_at
provider_timestamp
signature_verified
payload_reference
processing_status
processed_at
```

唯一約束：

```text
channel_account_id + provider_event_id
```

此表是事故重播、平台爭議及漏件調查的第一證據。保留期限應依隱私、法規及實際營運需求制定，不能無限保存，也不能處理完立即刪除。

## 4.8 outbound_message

使用 transactional outbox，避免資料已更新但訊息未送出，或重試時重複發送。

```text
id
conversation_id
idempotency_key
content_reference
policy_decision
status
attempt_count
next_attempt_at
provider_message_id
last_error_code
```

## 4.9 consent

```text
contact_id
channel
scope
source
captured_at
expires_at
revoked_at
evidence_reference
```

同意接收訂單通知不等於同意接收促銷訊息。不同 scope 必須分開保存。

# 五、Channel Adapter 契約

每個渠道 adapter 至少實作以下能力：

```ts
interface ChannelAdapter {
  verifyInbound(request: unknown): Promise<VerificationResult>;
  normalizeInbound(event: unknown): Promise<NormalizedEvent[]>;
  send(message: OutboundMessage): Promise<SendResult>;
  parseDeliveryEvent(event: unknown): Promise<DeliveryUpdate[]>;
  getCapabilities(context: ConversationContext): Promise<ChannelCapabilities>;
}
```

`ChannelCapabilities` 至少回答：

```text
can_send_now
requires_template
allowed_content_types
reply_window_expires_at
consent_required
message_cost_class
supports_read_receipt
supports_account_linking
```

前端 composer 必須服從 capabilities。若平台現在不允許自由文字，UI 應直接禁用，而不是等 API 回錯誤後才告訴 Jeff。

# 六、身分連結原則

1. 一位 contact 可以有多個 channel identity。

2. 一個 channel identity 在同一時間只能連到一位 contact。

3. 不用姓名、頭像、相似文字或 AI 猜測自動合併。

4. 可從聊天中傳送一次性連結，讓客戶登入 PACK&GO、輸入已知訂單資訊或完成其他明確驗證。

5. 連結後必須允許解除連結。

6. 所有人工合併與拆分都需要 audit log。

LINE 官方提供帳號連結流程，並要求服務允許使用者解除連結。[LINE User Account Linking](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)

Apple Messages for Business 向業者提供的是 opaque ID，不會直接提供客戶電話、email 或 Apple Account，因此不能假設平台身分就是 PACK&GO 客戶身分。[Apple Messages for Business & Privacy](https://www.apple.com/legal/privacy/data/en/messages-for-business/)

# 七、平台規則集中管理

各平台對自由回覆、主動通知、範本、同意及訊息數都有不同限制。這些規則應集中在 channel policy，而不是散落在 UI、worker 和 AI prompt。

每次送出前至少檢查：

1. 客戶是否允許接收這類訊息。

2. 目前是否仍在自由回覆時間窗。

3. 是否必須使用核准範本。

4. 範本語言與版本是否有效。

5. 是否超過平台或方案額度。

6. 客戶是否已封鎖、退出或解除連結。

7. 訊息是否含禁止透過聊天傳送的敏感資訊。

8. 是否需要 Jeff 人工核准。

# 八、`/ops/inbox` 最小工作台

第一版只需要完成工作，不需要做成大型客服中心。

## 8.1 必要佇列

1. 未讀

2. 等待 Jeff

3. 等待客戶

4. 等待供應商

5. 即將超過 SLA

6. 已超過 SLA

7. 傳送失敗

8. 已完成

## 8.2 對話畫面

同一畫面顯示：

1. 渠道來源

2. 客戶及 channel identity

3. 旅行案件、團、報價或訂單連結

4. 完整訊息時間線

5. SLA 和 reply window

6. AI 摘要與建議下一步

7. 回覆 composer

8. 轉人工、建立任務、標記完成

## 8.3 不該放進第一版的功能

1. 複雜客服績效報表

2. 多層團隊分派

3. 全功能行銷 campaign builder

4. 跨渠道自動追銷序列

5. 情緒分數等沒有明確行動用途的 AI 標籤

# 九、AI 與人工的責任邊界

## 9.1 可以自動執行

1. 收件確認

2. 營業時間及預計回覆時間

3. 意圖分類

4. 對話摘要

5. 語言偵測

6. 建議回覆草稿

7. 已由結構化資料確認的靜態 FAQ

8. 提醒 Jeff 有訊息接近 SLA

## 9.2 必須人工核准或走正式流程

1. 價格與餘位

2. 訂位是否成立

3. 供應商是否確認

4. 取消及退款資格

5. 收款、補款及付款連結

6. 信託資金相關說明

7. 法律或保障承諾

8. 客訴與例外補償

9. 護照及其他敏感資料收集

聊天中應提供安全網頁連結完成報價接受、揭露確認、付款或旅客資料收集。聊天是入口與通知，不是訂單真相源。

# 十、各渠道建議

## 10.1 LINE

建議作為第一個正式 adapter 候選。

初始用途：

1. 接收詢問

2. 人工回覆

3. 傳送安全報價連結

4. 已確認訂單的狀態通知

技術要求：

1. LINE Official Account 與 Business ID 必須由 PACK&GO 公司持有。

2. webhook 必須驗證 signature。

3. 收到 webhook 後快速回 2xx，再非同步處理。

4. 使用 `webhookEventId` 去重。

5. webhook 可能重送、重複及亂序，不能假設只送一次或依序到達。

6. reply token 應立即使用；push message 另受好友關係、封鎖狀態及訊息方案限制。

[LINE Receive Messages](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)

[LINE Send Messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/)

[LINE Messaging API Pricing](https://developers.line.biz/en/docs/messaging-api/pricing/)

## 10.2 Meta

「Meta」不是一個渠道，必須拆成 Instagram DM、Messenger、WhatsApp 三個決策。

### Instagram DM

適合條件：

1. 主要獲客來自 Instagram 內容、廣告、Story 或 Reel。

2. 客戶會直接由內容進入私訊。

3. PACK&GO 已使用 Instagram Professional Account。

初始只做客戶主動發起的對話。不要把 follower 當成可以主動群發的名單。

[Meta 官方 Instagram API Collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

### Messenger

適合條件：

1. 主要客群由 Facebook Page、社團或 Facebook 廣告而來。

2. 實際詢問量高於 Instagram DM。

一般自由回覆受客戶最近互動時間窗限制，因此資料模型必須保存 `last_customer_message_at`，UI 也必須顯示目前是否可回覆。

[Meta Messenger Platform API](https://www.postman.com/meta/messenger-platform-api/collection/iyp204x/messenger-platform-api)

[Meta Messenger Send API](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api)

### WhatsApp

適合條件：

1. 跨國客戶、親友推薦或手機號碼導向詢問占比高。

2. 客戶明確希望用 WhatsApp 接收服務訊息。

3. 團隊已能管理 opt in、opt out、24 小時回覆窗及核准範本。

應保存：

```text
opt_in_source
opt_in_at
consent_scope
last_customer_message_at
template_name
template_version
template_language
opt_out_at
delivery_failure_reason
```

[Meta 官方 WhatsApp Cloud API Collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)

[WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)

## 10.3 WeChat

WeChat 對華語市場有價值，但海外公司帳號資格、服務號權限、微信認證及中國境內可見性需要先用 Pack&Go LLC 的真實公司資料完成官方資格確認。

在資格確認前，不應先做完整 adapter。

初始步驟：

1. 申請官方企業持有的服務號或適用帳號。

2. 確認海外主體可用的客服能力。

3. 確認事件格式、XML、加密模式及回覆時限。

4. 先以原生工作台量測需求。

5. 達到門檻後再做 webhook shadow mode。

[WeChat Official Account Access Overview](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Access_Overview.html)

[WeChat 客服訊息說明](https://developers.weixin.qq.com/doc/service/guide/product/kf/intro.html)

## 10.4 Apple Messages for Business

不要接個人 iMessage，也不要稱為 iMessage API。

企業客服正式產品是 Apple Messages for Business。通常涉及 Apple Business Register、公司管理帳號、Messaging Service Provider、測試及體驗審查。

建議最後導入，原因是：

1. 接入與審查成本較高。

2. 需要穩定真人轉接與公開服務時段。

3. Apple 提供的是 opaque ID，仍需 PACK&GO 自己做安全身分連結。

4. 對一人公司而言，新增價值應先由真實 Apple 客戶需求證明。

[Apple Messages for Business Getting Started](https://register.apple.com/resources/messages/messaging-documentation/)

[Apple Messages for Business & Privacy](https://www.apple.com/legal/privacy/data/en/messages-for-business/)

# 十一、建議接入順序

在沒有更強的實測資料前，暫定：

```text
Gmail 共同核心
    ↓
LINE
    ↓
Instagram DM 或 Messenger 二選一
    ↓
WhatsApp
    ↓
WeChat
    ↓
Apple Messages for Business
```

這不是固定排名。可依下列證據調整：

1. 客戶在詢問表單選擇的偏好渠道。

2. 過去 30 天人工收到的有效詢問數。

3. 每個渠道的有效詢問轉報價率。

4. 每個渠道的報價轉訂金率。

5. 每個渠道每位有效詢問所需 Jeff 分鐘。

6. 客戶所在地、語言和實際使用習慣。

若 WeChat 的真實需求明顯高於 Meta，可以提前；若 Instagram 廣告是主要獲客來源，Instagram DM 應先於 Messenger；若跨國推薦占比高，WhatsApp 可提前。

# 十二、每個渠道的四階段上線法

## 階段一：原生收件匣

1. 建立公司持有的正式帳號。

2. 在網站放置深連結或 QR Code。

3. Jeff 使用平台原生工具人工回覆。

4. 記錄有效詢問量、回覆工時及漏接情況。

## 階段二：Webhook shadow mode

1. webhook 進入 PACK&GO。

2. `/ops/inbox` 顯示只讀訊息。

3. Jeff 仍回到原生平台回覆。

4. 驗證驗簽、去重、亂序、重播和告警。

5. 比對原生平台和 PACK&GO 的訊息是否一致。

## 階段三：統一人工回覆

1. Jeff 從 `/ops/inbox` 回覆。

2. policy gate 決定是否可發送。

3. outbound message 使用 idempotency key。

4. delivery status 回寫。

5. 原生平台保留為緊急備援。

## 階段四：限定自動化

1. 只開放收件確認、營業時間及明確靜態 FAQ。

2. AI 分類、摘要與草稿預設不直接送出。

3. 一類自動化一次開通，先觀察兩週。

4. 每類自動化有獨立 kill switch。

5. 有任何錯價、錯餘位、錯誤訂位承諾或客款問題，立即停用該類自動化。

# 十三、90 天建議路線

## 第 1 至 14 天

1. 確定渠道術語及共同狀態模型。

2. 建立 `channel_account`、`channel_identity`、`conversation`、`message`、`raw_webhook_event`、`outbound_message`、`consent`。

3. 將 Gmail 改接共同 conversation core。

4. 完成 `/ops/inbox` 最小版。

5. 建立 webhook、outbox、SLA 與傳送失敗監控。

6. 在公開詢問表單加入「偏好的聯絡方式」。

7. 申請並盤點所有公司持有的渠道帳號與管理權限。

## 第 15 至 30 天

1. LINE 先以原生收件匣接待。

2. 完成 LINE webhook shadow mode。

3. 進行 webhook signature、重送、重複、亂序及故障重播測試。

4. 比對 LINE 原生訊息和 PACK&GO 記錄。

5. 不開放 AI 自動發送。

## 第 31 至 60 天

1. 若 LINE 達到需求與可靠性門檻，啟用 `/ops/inbox` 雙向人工回覆。

2. 建立 LINE 安全帳號連結。

3. 開啟收件確認及營業時間兩類低風險自動化。

4. 跑滿四週，量測轉化與 Jeff 工時。

## 第 61 至 90 天

1. 依真實來源選 Instagram DM、Messenger 或 WhatsApp 其中一個。

2. 重複原生、shadow、雙向人工、限定自動化流程。

3. 若 LINE 未達門檻，不因排程到了就開第二渠道。

4. WeChat 只完成帳號資格確認，不先假設一定可用。

5. Apple Messages for Business 只做需求和 MSP 成本調查。

# 十四、渠道放行門檻

以下是建議起始值，不是永久真理。取得實際營運資料後應調整。

## 14.1 從原生進入 shadow mode

符合其中一項：

1. 連續四週每週至少 10 個有效詢問。

2. 每週切換、抄錄或追蹤該平台超過 2 小時。

3. 已出現可證明的漏接或重複處理問題。

## 14.2 從 shadow mode 進入雙向 API

全部符合：

1. webhook 到 `/ops` 成功率至少 99.5%。

2. 已測試重送、重複、亂序和延遲。

3. 零錯誤客戶身分合併。

4. 零重複 outbound message。

5. 未處理訊息告警正常。

6. 平台原生訊息和 PACK&GO 記錄可對上。

7. 已有停用開關和原生回覆備援。

## 14.3 從人工回覆進入自動化

全部符合：

1. 公開 SLA 達成率至少 90%。

2. Jeff 的待處理佇列沒有持續超過一個工作日。

3. 自動化內容屬低風險且有結構化事實來源。

4. 已建立抽樣覆核和錯誤率監控。

5. 每一類自動化有獨立 kill switch。

6. 過去四週無錯價、錯餘位、錯誤訂位確認及錯誤客款歸屬。

# 十五、成功指標

不要用訊息總量或已接渠道數作成功指標。

每個渠道至少追蹤：

1. 有效詢問數

2. 詢問轉正式報價率

3. 報價轉訂金率

4. 每位有效詢問的 Jeff 分鐘

5. 首次回覆中位時間及第 95 百分位時間

6. SLA 達成率

7. 漏接數

8. 重複回覆數

9. 傳送失敗率

10. 錯誤身分合併數

11. 客戶封鎖及 opt out 比例

12. 每位有效詢問的渠道成本

13. 每個渠道的實際貢獻毛利

下一個渠道只有在前一個渠道證明增加有效詢問、提高轉化或降低 Jeff 工時後才開工。

# 十六、監控與事故處理

## 16.1 必要監控

1. 每個 channel webhook 最近成功時間。

2. webhook 失敗及 signature 驗證失敗率。

3. raw event 未處理數量及最老等待時間。

4. outbound retry 數量及最老失敗時間。

5. 平台額度、token 到期及權限變更。

6. 即將超過 SLA 的 conversation。

7. 平台允許回覆時間窗即將關閉的 conversation。

## 16.2 Kill switch

至少支援：

1. 停止某個渠道所有 outbound。

2. 停止某一類自動化回覆。

3. 切換為只讀 shadow mode。

4. 將所有訊息改由 Jeff 人工核准。

5. 停止新的身分自動連結。

停用 outbound 不應停止 inbound 保存，否則事故期間會失去客戶訊息。

# 十七、安全、隱私與營運控制

1. 所有渠道帳號使用 PACK&GO 公司信箱持有，不綁施工者或 Jeff 的私人帳號。

2. 所有管理帳號啟用 MFA，並保存 recovery 方式和 break glass 流程。

3. token 和 secret 只放 secrets manager，定期輪替。

4. webhook 必須驗簽，未驗簽事件不能進入正式工作流。

5. 保留最少必要訊息資料，設定明確 retention 和刪除規則。

6. 聊天不接收信用卡資料。

7. 護照和旅客敏感資料改用安全入口，且只在供應商已確認需要時收集。

8. 人工合併客戶、修改 consent、重送訊息及變更訂單連結全部記 audit log。

9. 每個渠道公開合理的服務時間和預計回覆 SLA。

10. 離線時先回覆收到與服務時間，不做無法驗證的旅行承諾。

# 十八、自建與採購策略

建議原則：

> 自己擁有 conversation core、客戶身分、案件及訂單連結；平台 API、BSP 或 MSP 只負責訊息傳輸。

## 可以自建

1. 共同資料模型

2. `/ops/inbox`

3. Gmail、LINE、Meta 的薄 adapter

4. policy gate

5. outbox、SLA、告警及 audit log

## 適合考慮外部服務

1. Apple Messages for Business 的 MSP

2. WeChat 海外主體接入與認證

3. 多地區訊息送達及複雜範本管理

4. 未來真正需要多人客服路由時的專業客服基礎設施

選供應商時檢查：

1. 是否能匯出完整訊息及身分 mapping。

2. 是否提供 raw webhook 和 delivery status。

3. 是否支援 idempotency。

4. consent 和 opt out 是否可攜。

5. 終止服務後資料能否完整取回。

6. 是否會把供應商自己的 contact ID 變成唯一真相源。

7. 月費、每訊息費、範本費及隱藏 onboarding 成本。

不要因為採購 omnichannel 產品，就把 PACK&GO 的客戶與訂單真相交給供應商。

# 十九、最常見的失敗方式

1. 四個渠道一起開工，最後四個都停在半套。

2. 每個渠道各建一套客戶資料與後台。

3. 把 Meta 當成單一 adapter。

4. AI 根據聊天上下文自行報價或承諾餘位。

5. 只處理成功 webhook，不測重送、重複和亂序。

6. 送出訊息後不追蹤 delivery status。

7. 用姓名或電話模糊比對自動合併客戶。

8. 沒有保存 opt in 證據及 opt out 狀態。

9. 把個人 LINE、WeChat 或 iMessage 當成正式企業 API。

10. 先做大量廣播，再補 consent 與平台政策。

11. 原生平台和 PACK&GO 同時回覆，造成重複訊息。

12. 把「adapter 已完成」當成「渠道已可靠上線」，卻沒有正式環境驗證和 SLA 數據。

# 二十、Claude 建議施工拆分

## Epic 0：渠道事實錨點

交付：

1. 每個平台的公司帳號、權限、管理人、token 類型、webhook 規則、回覆窗、consent、費用及限制。

2. 每項事實附官方來源、查證日期、owner 和 expires_at。

驗收：

1. 不使用二手文章決定高風險平台規則。

2. 過期事實阻止 adapter 上線。

## Epic 1：Conversation core

交付：

1. 最小資料模型與 migration。

2. raw event uniqueness。

3. transactional outbox。

4. audit log。

驗收：

1. 重複輸入相同事件不產生第二則 message。

2. outbox 重試不造成重複 outbound。

3. conversation 可連到 contact、travel_case 和 order。

## Epic 2：Gmail reference adapter

交付：

1. Gmail inbound 進共同 message model。

2. Gmail outbound 經過 outbox。

3. Gmail conversation 顯示在 `/ops/inbox`。

驗收：

1. 現有 Gmail 功能不倒退。

2. Gmail 不再走獨立商業邏輯。

## Epic 3：`/ops/inbox`

交付：

1. 必要佇列及 SLA。

2. 對話時間線。

3. travel_case 和 order 連結。

4. 人工回覆與狀態更新。

驗收：

1. Jeff 可只使用一個工作台處理 Gmail。

2. 所有傳送失敗可看見、可重試、可追蹤。

## Epic 4：Channel policy gate

交付：

1. 回覆窗、consent、template 與內容類型判斷。

2. composer capability 控制。

3. kill switch。

驗收：

1. 禁止狀態無法從 UI 或 API 繞過。

2. policy decision 保存可稽核原因。

## Epic 5：LINE shadow mode

交付：

1. LINE webhook 驗簽。

2. raw event、去重、亂序及重播處理。

3. `/ops/inbox` 只讀呈現。

4. channel health monitor。

驗收：

1. 與 LINE 原生訊息逐筆比對。

2. 人工重送相同 webhook 不新增 message。

3. webhook 中斷及恢復會告警。

## Epic 6：LINE 雙向人工回覆

交付：

1. policy gate。

2. outbox send。

3. delivery status。

4. account linking。

5. 原生回覆備援流程。

驗收：

1. 零重複發送。

2. 超出平台能力時 UI 正確禁止。

3. 連結與解除連結有 audit log。

## Epic 7：低風險自動化

交付：

1. 收件確認。

2. 營業時間回覆。

3. AI 分類、摘要與草稿。

4. 每類獨立 kill switch。

驗收：

1. 高風險內容不能自動送出。

2. 所有 AI 自動訊息標記來源與版本。

3. 可抽樣計算錯誤率。

# 二十一、最終決策建議

1. 現在就保留並規劃多渠道，不需要放棄。

2. 現在先建共同核心，而不是同時建四個 adapter。

3. Gmail 先成為共同核心的第一個 reference adapter。

4. 第一個新渠道暫定 LINE，先原生、再 shadow、再雙向人工、最後才有限自動化。

5. Meta 拆成 Instagram DM、Messenger 和 WhatsApp 分別決策。

6. WeChat 先確認海外企業資格，再決定優先度。

7. Apple Messages for Business 最後評估，不接個人 iMessage。

8. 每次只開一個渠道，前一個渠道未達可靠性及商業門檻，不開下一個。

一句話：

> 渠道可以很多，收件匣只能一個；外部身分可以很多，客戶與訂單真相只能一份。
