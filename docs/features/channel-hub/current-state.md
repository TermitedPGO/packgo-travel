# Channel Hub 外接通道測繪（現況圖 + 可行性評估）

> 偵察產物，唯讀，零 code 修改。2026-07-10。
> 目的：Jeff 要把 iMessage / WeChat / LINE / 社媒等外部通道接進客戶系統，動工前先要一份誠實的現況圖與可行性評估。
> 誠實標注原則：凡「我沒實測、只是讀 code 或讀網路資料」的地方都會標 **[未驗證]**。

---

## 第 1 節　現況盤點（repo 內實況）

先講統一的落地表。客戶互動有「兩個彼此不通的桶」，這是整份測繪最重要的一句話：

- **桶 A `customerInteractions`**（`drizzle/schema.ts:2861`）：統一互動時間軸，keyed on `customerProfileId`。channel enum 已預留 `["email","whatsapp","wechat","line","sms","phone","web_form","review"]`（schema.ts:2865）。客戶頁駕駛艙讀的是這桶。Gmail、iMessage/SMS 都寫這裡。冪等靠 `uq_ci_profile_external`（customerProfileId + externalId）。
- **桶 B `wechatMessages`**（`drizzle/schema.ts:2296`）：WeChat 自成一張獨立表，keyed on `customerUserId`（users.id，不是 customerProfileId）。駕駛艙時間軸看不到這桶（要另外 `wechatAssist.listForCustomer` 撈）。

**這個分裂就是 channel-hub 要收的第一筆技術債。** 下面逐通道拆。

### 1.1 Gmail —— 成熟度：上線中（生產級，四通道裡唯一完整雙向）

- 進線：`gmailPollWorker.ts` + `gmailPushWorker.ts` + `server/agents/autonomous/gmailPipeline.ts`（poll + push 雙軌）。雙帳號。
- 歸檔：`server/_core/threadFiling.ts` —— 整條 thread reconcile 進 `customerInteractions` 的 **claim-or-insert** 引擎，冪等、不重複既有 453 筆 legacy row、pure planner（`planThreadFiling`）可單元測試、每筆過 `scrubPii`。這是全 repo 最值得複用的歸檔範本。
- 客戶配對：`emailCustomerMatch.ts`（sender email → users.email exact match → userId；不做 fuzzy，錯配比 guest 更糟）。profile 端用 `customerProfiles.email` + `followMergePointer`（併卡指標）。
- 出線：`outboundInteraction.ts::recordOutboundEmailInteraction` —— 真的寄（emailService）+ 回寫 outbound row，雙向完整。有 customOrder 繼承（`interactionOrderAssignment`）。
- 未讀：`touchLastInbound`（`customerUnread.ts`）驅動紅點。
- 結論：**Gmail 是「參考架構」**，其餘通道要往它的形狀收斂。

### 1.2 iMessage / SMS —— 成熟度：半成品（進線 code 齊全、但依賴 Jeff 桌機沒證據在跑）

- 進線 code：`server/_core/imessageIngest.ts`（`checkKnownPhones` 隱私閘 + `ingestImessageBatch` 寫入）。落 `customerInteractions` channel:`"sms"`，agentName:`"imessage_sync"`。
- 端點已 wired：`POST /api/admin/imessage-check-known-phones` 與 `POST /api/admin/imessage-ingest`（`server/_core/index.ts:1743 / 1779`），走 `LOCAL_SCRIPT_TOKEN` bearer 驗證 + rate limit。**所以 server 端是活的、已部署。**
- 走哪條路：**桌機常駐腳本讀 `~/Library/Messages/chat.db`（唯讀）**（`scripts/imessage-sync.mjs`，launchd 每 5 分鐘）。不是 BlueBubbles、不是 AppleScript、是直接讀 SQLite。只出站 HTTPS，從不寫回 chat.db。
- 隱私鐵律（Jeff 硬要求，寫死在腳本頭）：未知號碼的訊息「內容」絕不離開 Mac —— 先用「純電話、無內容」問 server 哪些號碼是已知客人（`checkKnownPhones`），只有已知號碼才在 payload 帶 `text`，其餘 `text:null`。fail-closed。
- 配對：phone → `customerProfiles.phone` exact（同一套 `normalizePhoneForMatch`）+ `followMergePointer`。未認領號碼不進 DB，攢在本機 `~/.packgo/imessage-unclaimed.json`。
- 出線：**無。** 純進線 read-only，沒有從系統回 iMessage 的路（也不該有，見第 2 節 iMessage 風險）。
- 兩個誠實缺口：
  1. **[未驗證]** `imessage-sync.mjs` 腳本頭自己註明：chat.db 的 schema（`message` / `handle` 欄位、`guid` 當 externalId、Apple epoch）是「根據近版 macOS 的最佳理解」但**沒在真機測過**，Jeff 要先 `sqlite3 ~/Library/Messages/chat.db ".schema message"` 對欄位。
  2. **[未驗證]** 沒有證據顯示 launchd 排程真的在 Jeff 桌機裝好在跑（需要 Full Disk Access + iCloud Messages）。安裝說明在 `docs/features/customer-cockpit/imessage-sync-setup.md`，但「有沒有真的裝」要問 Jeff。
- 資料流：`chat.db →(本機腳本+隱私閘)→ HTTPS ingest 端點 → imessageIngest → customerInteractions(sms) → touchLastInbound → 駕駛艙時間軸`。

### 1.3 WeChat —— 成熟度：半成品（manual-paste 上線中；OA webhook 只是註解，未實作）

- 走兩個 mode（`server/services/wechatAssistService.ts`）：
  1. **Manual paste（現在唯一能用的）**：Jeff 把微信 / 朋友圈 / LINE 訊息貼進 admin UI → `wechatAssist.draftReply`（`server/routers/wechatAssist.ts`）→ Haiku 草擬 Jeff 口吻的繁中回覆 → Jeff 審 / 改 / approve → **回貼剪貼簿手動送**（`approve` 只是把 row 標成 sent，並不經 API 真送）。
  2. **OA webhook（未實作）**：`processInboundFromWebhook()` 在檔案裡只是一句「future-ready」註解，**沒有對應的 webhook route、沒有實作**。grep 全 repo 確認：`server/` 內沒有任何 WeChat webhook 端點。
- 落地表：桶 B `wechatMessages`（**不是** customerInteractions）。source enum `["wechat_oa","manual_paste","moments_reply"]`。
- 配對：`wechatCustomerMatch.ts::findCustomerUserIdByOpenId`（inbound `fromOpenId` → `customerProfiles.wechatId` → 且該 profile 已綁 users → `customerUserId`）。manual paste 常配不上（沒有 openId）→ `customerUserId=null`，靠 `wechatAssist.assignCustomer` 人工補配。
- 出線：manual（剪貼簿），無 API 自動送。
- **關鍵情報**：Jeff 已裁示 **不接微信個人號 API/自動化**（封號風險）；微信定位是「零摩擦拖放」。見 `docs/features/customer-cockpit/sonnet5-handoff.md:85`。這條要當硬約束帶進波次規劃。
- 資料流：`貼上 →draftReply(Haiku)→ wechatMessages(桶B) →(openId 配對或人工)→ wechatAssist.listForCustomer 撈進 workspace`。**這條沒進駕駛艙統一時間軸。**

### 1.4 LINE —— 成熟度：殘骸 / 只有骨架（無任何 Messaging API 整合）

- 只有三樣東西，全部不是「通道」：
  1. `customerInteractions.channel` enum 有 `"line"`、`customerProfiles.lineId` 欄位（存 + 搜尋 + 併卡 `profiles.ts` 用），純資料欄位、沒有寫入路徑。
  2. LINE 訊息目前只能透過 1.3 的 manual-paste 混進 WeChat assist（system prompt 明寫「WeChat / 朋友圈 / LINE」）。
  3. 行銷文案生成器（`marketingCopyService.ts`、`posterProcessor.ts`）會產 LINE 風格貼文 —— 那是出站行銷，不是客服進線。
- 進線 / 出線 / 歸檔 / 配對：**全都沒有。** LINE 是四通道裡最空的，但（見第 2 節）也是官方門檻最低、最該先做的。

### 1.5 Instagram / Facebook Messenger（Jeff 說的「社媒」）—— 成熟度：零

- repo 內完全沒有 Meta / Messenger / IG DM 相關 code。只有行銷側產圖產文（FB/IG/OG 尺寸）。

### 現況一覽表

| 通道 | 進線 | 出線 | 歸檔落地 | 客戶配對 | 成熟度 |
|------|------|------|----------|----------|--------|
| Gmail | ✅ poll+push | ✅ 真寄+回寫 | `customerInteractions`(桶A) | email→users/profile | **上線中（生產級）** |
| iMessage/SMS | ✅ 桌機腳本讀 chat.db | ❌ 無 | `customerInteractions`(桶A, sms) | phone exact | 半成品（server 活、桌機端**[未驗證]**在跑） |
| WeChat | ⚠️ 只有 manual paste | ⚠️ 剪貼簿手動 | `wechatMessages`(桶B, 孤島) | openId→wechatId | 半成品（OA webhook **未實作**） |
| LINE | ❌（只混在 paste 裡） | ❌ | 無（僅 enum+欄位） | 僅 lineId 欄位 | 殘骸/骨架 |
| IG/FB Messenger | ❌ | ❌ | 無 | 無 | 零 |

---

## 第 2 節　通道可行性（上網查證，附來源）

### 2.1 WeChat 官方通道（Official Account）

- **海外主體能不能接**：可以，但只能自建 **服務號（Service Account）**，不能自建訂閱號（訂閱號要中國營業執照）。海外公司用本國營業登記文件即可，註冊區域須與公司登記地一致。([FDI China](https://fdichina.com/china-e-commerce/wechat-business-account/)、[WeChatWiki 海外主體註冊](https://wechatwiki.com/wechat-resources/wechat-overseas-official-account-registration-fees/))
- **認證**：一次性 **600 RMB** 驗證費，文件（營業執照、驗證函、負責人電話帳單、護照/ID；非英文要公證翻譯）齊全後約 **5–7 個工作天** 過審。([BWB Agency 2026 指南](https://bwb.agency/latest-news/guide-how-to-create-and-verify-official-wechat-account-as-a-non-chinese-business-in-2026))
- **ICP / 中國銀行帳戶**：訊息客服**不需要** ICP 或中國銀行帳戶；**只有要開 WeChat Pay / 電商收款才需要中國銀行帳戶**。對 PACK&GO「只要接客服訊息」的用途，這關可以跳過。([FDI China](https://fdichina.com/china-e-commerce/wechat-business-account/))
- **回覆時窗（硬限制）**：客服訊息 API 只能在客戶「最後一則訊息後 48 小時內」回；48h 內對同一用戶上限約 20 則普通訊息；超時只能改用需模板審核的「模板訊息」。且**客戶必須先關注 OA 並主動發訊**，商家才能回。([Zendesk WeChat 48h](https://support.zendesk.com/hc/en-us/articles/4410540013210-How-much-time-do-my-agents-have-to-reply-to-incoming-WeChat-messages)、[Weixin 官方客服訊息文件](https://developers.weixin.qq.com/doc/service/en/api/customer/message/api_sendcustommessage))
- **誠實的真實門檻**：技術上可行，但 OA 是「公眾號」模型不是 1:1 個人聊天。已習慣加 Jeff 個人微信聊天的華人客群，不會自動搬去搜尋+關注一個 OA —— 這是採用面的真缺口，不是技術缺口。跟 repo 現況（Jeff 已把微信定位成「零摩擦拖放」）一致。
- **個人號機器人方案（誠實寫封號風險）**：**強烈不建議，且 Jeff 已裁示不做。** 微信服務條款明文禁止機器人 / 腳本 / 自動化存取；個人號**沒有官方 API**，所有自動化都靠非官方 hack；Tencent 有 server 端行為分析 + client 指紋偵測，被判自動化多是**永久封號且不可逆**。2026-04 Tencent 更收緊、開始封「全 AI 自動化帳號」。([WeChat 使用政策](https://www.wechat.com/en/acceptable_use_policy.html)、[WeChat 社群守則-帳號真實性](https://safety.wechat.com/en_US/community-guidelines/cover/platform-authenticity-and-account-integrity)、[SCMP 2026 收緊](https://www.scmp.com/tech/article/3349696/tencent-moves-rein-ai-content-flood-wechat-stricter-rules))

### 2.2 LINE Messaging API

- **商業接入**：官方 Messaging API，webhook 收訊 + reply/push 送訊，正規、有文件、無灰色地帶。([LINE Developers Messaging API](https://developers.line.biz/en/docs/messaging-api/overview/))
- **費用層級（台灣 2026，PACK&GO 客群偏台灣，用台灣表）**：
  - 輕用量 **NT$0/月**，含 200 則免費，不可加購。
  - 中用量 **NT$800/月**，含 3,000 則，不可加購。
  - 高用量 **NT$1,200/月**，含 6,000 則，超量可加購 **約 NT$0.2/則起**。
  - 另有「聊天進階」約 NT$100/月（強化聊天室管理，與訊息方案獨立）。
  - 計費是「推播訊息（push）」按觸及人數算；**用 webhook 被動 reply 客戶主動來訊，一般不計入推播額度** —— 對「客服式一對一回覆」成本極低。([SiteNow 2026](https://site-now.app/line-oa-guide/)、[安永 2026 方案總整理](https://www.anyong.com.tw/37452)、[LINE Developers 計費](https://developers.line.biz/en/docs/messaging-api/pricing/))
- **結論**：五通道裡**官方門檻最低、成本最低、風險最低**。應排第一波。

### 2.3 iMessage

- **無官方 API 是事實**：Apple 沒有 iMessage 公開 API、沒有開發者計畫、沒有文件，且主動封鎖橋接（Beeper Mini、Nothing Chats 前例）。所有方案都是非官方。([Lindy: iMessage API](https://www.lindy.ai/blog/imessage-api-three-rewrites-one-apple-ban-and-what-actually-works)、[Claw Messenger 2026 指南](https://www.clawmessenger.com/blog/imessage-api-for-ai-agents))
- **現行橋接方案與各自風險**：
  - **直接讀 `chat.db`（PACK&GO 現在走的路）**：唯讀本機 SQLite，**不碰 Apple 帳號、不觸發封號**（因為根本沒對 Apple 伺服器發自動請求）。穩定性風險在「macOS 改 schema / attributedBody-only 訊息無純文字 `text`」而非封號。這是所有方案裡**風險最低的進線**，代價是只能讀、只在那台 Mac 有效、且要 Full Disk Access。
  - **BlueBubbles**：開源，用一台真 Mac 當中繼、走公開 API，比自建 daemon 風險低但仍非零。([BrightCoding BlueBubbles 2025](https://www.blog.brightcoding.dev/2025/11/27/%F0%9F%94%A5-finally-how-to-get-imessage-on-android-windows-linux-in-2025-complete-bluebubbles-guide/))
  - **Swift daemon / 自動化送訊（出線）**：**封號重災區。** Lindy 團隊在資料中心 Mac Mini 上建的 iMessage 橋接被 Apple 永久封號（撞到未公開的 spam 門檻），「下一個帳號也會被封，只是慢一點」。在非 Apple 硬體跑 macOS VM 也違反 ToS、帳號可能被停。([Lindy 實錄](https://www.lindy.ai/blog/imessage-api-three-rewrites-one-apple-ban-and-what-actually-works))
- **repo 半成品走哪條**：確認走**唯讀 chat.db**（1.2），不是 BlueBubbles、不是 AppleScript 送訊。這是最保守的選法。
- **結論**：**進線**（唯讀）可保留現況；**出線自動送 iMessage 明確不做**（封號 + ToS）。iMessage 排最後或維持現狀。

### 2.4 Instagram / Facebook Messenger（Meta 官方 API）

- **可行**：走官方 Messenger Platform / Instagram Graph API，webhook 收訊 + 24 小時窗內自由回。([Meta 官方文件](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview))
- **門檻**：需 Meta 開發者帳號 + 過 App Review 才能上生產；**2025–2026 的審核比 2022 嚴很多**（screencast 不完整、缺 opt-out、webhook 處理不足會被拒）。24 小時窗外要用 message tag 或模板（模板要預審），且 IG 自動化有「每帳號每小時 200 則」上限。CONFIRMED_EVENT_UPDATE tag 於 2026-04-27 起淘汰、誤用會被限制/封。([KeyAPI IG 24h 政策](https://www.keyapi.ai/blog/instagram-messaging-api-policy/)、[Meta Messenger/IG 政策](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy))
- **結論**：官方、正規，但要吃一次 App Review 的工。風險中等（合規性風險非封號風險）。排 LINE 之後、WeChat 之前或並行。

---

## 第 3 節　架構草案（統一收件匣的 channel adapter 形狀）

目標：所有通道都收斂到桶 A `customerInteractions` + 駕駛艙時間軸，一條 pipeline、五個 adapter。

```
                         ┌─────────────── INBOUND ADAPTERS（每通道一個）───────────────┐
 LINE webhook ──────────►│ normalize() → NormalizedInbound {                          │
 Meta(IG/FB) webhook ───►│   channel, externalId, direction,                          │
 WeChat OA webhook ─────►│   senderIdentity{ email? phone? wechatOpenId? lineUserId? }│
 Gmail poll/push ───────►│   text, occurredAt, threadKey? }                           │
 iMessage 桌機腳本 ─────►│                                                            │
                         └───────────────────────────┬────────────────────────────────┘
                                                      ▼
                                    ┌── 統一身分解析 resolveProfileByIdentity() ──┐
                                    │  email→profile / phone→profile /            │
                                    │  wechatId→profile / lineId→profile          │
                                    │  → followMergePointer（併卡指標）           │
                                    │  無命中 → guest profile 或掛 unassigned     │
                                    └───────────────────────┬─────────────────────┘
                                                            ▼
                              ┌── 冪等落地 fileInteraction()（複用 threadFiling 的 claim-or-insert）──┐
                              │  customerInteractions.insert(channel, direction, content=scrubPii,   │
                              │    externalId) · uq_ci_profile_external 去重 · onDuplicateKeyUpdate   │
                              └───────────────────────┬─────────────────────────────────────────────┘
                                                      ▼
              ┌─── customOrder 歸屬（interactionOrderAssignment）· touchLastInbound（未讀紅點）───┐
              └───────────────────────┬───────────────────────────────────────────────────────────┘
                                      ▼
                        客戶頁駕駛艙統一時間軸（已存在，讀 customerInteractions）
                                      │
                                      ▼  OUTBOUND（審核閘後）
       ┌── 每通道 send() adapter：LINE reply/push · Meta send · Gmail 真寄 · WeChat OA 客服訊息 ──┐
       │   （iMessage：不做出線）· 送出後 recordOutbound* 回寫 outbound row（複用現有 pattern）    │
       └──────────────────────────────────────────────────────────────────────────────────────────┘
```

**可直接複用（不重造）：**
- `customerInteractions` 表 + channel enum（已含 wechat/line/sms/whatsapp）、`customerProfiles` 多通道 id 欄位（wechatId/lineId/whatsappPhone）。
- `threadFiling.ts` 的 claim-or-insert 冪等引擎（pure planner 可測）—— 當成所有通道歸檔的樣板。
- `followMergePointer`（併卡）、`touchLastInbound`（未讀）、`interactionOrderAssignment`（訂單歸屬）、`scrubPii`、`errorFunnel` fail-open、`verifyInternalAuth`（本機腳本 token）。
- 三個既有配對器 `emailCustomerMatch` / `wechatCustomerMatch` / `imessageIngest.findCustomerProfileIdByPhone` —— 合併成一個 `resolveProfileByIdentity`。

**要新建：**
- 一個 `ChannelAdapter` 介面（`normalizeInbound()` + `send()`）+ 各通道實作。
- **webhook 接收端**：LINE / Meta / WeChat OA 各一個（含簽章驗證：LINE `X-Line-Signature`、Meta `X-Hub-Signature-256`、WeChat token 校驗）。
- **統一身分解析器**（收斂上述三個配對器；phone/email/openId/lineUserId 一個入口）。
- **出線 send adapter** + 回覆時窗合規檢查（WeChat 48h / Meta 24h / LINE 額度）。
- **收桶 B 的技術債**：把 `wechatMessages`（桶 B, keyed on users.id）遷/橋進 `customerInteractions`（桶 A, keyed on customerProfileId），讓微信也進統一時間軸。這是 Wave 0。

---

## 第 4 節　波次建議（風險低先行）

| 波次 | 通道 | 一句話範圍 | 風險 |
|------|------|-----------|------|
| **Wave 0** | 內部收斂 | 建 `resolveProfileByIdentity` 統一配對器 + 把 `wechatMessages`(桶B) 併進 `customerInteractions`(桶A)，讓微信也上駕駛艙統一時間軸。純內部、不碰外部 API。 | 極低（無外部依賴） |
| **Wave 1** | **LINE** | 接 LINE Messaging API：webhook 收訊 normalize→桶A、被動 reply 出線。官方、台灣客群、被動回覆幾乎零成本。 | 低（官方，NT$0 起） |
| **Wave 2** | **Meta（IG/FB Messenger）** | 接 Messenger Platform / IG Graph API：webhook + 24h 窗內回。要吃一次 App Review。 | 中（合規審核，非封號） |
| **Wave 3** | **WeChat 官方服務號** | 註冊+認證海外 Verified Service Account（600 RMB/5–7 天），實作 OA webhook 取代現行 manual-paste，48h 窗客服訊息出線。**個人號 bot 不做（封號，Jeff 已裁示）。** | 中（認證工 + 客戶需關注 OA 的採用摩擦） |
| **Wave 4 / 或明確不做** | **iMessage** | 進線維持現狀（唯讀 chat.db 桌機腳本，先驗證 Jeff 桌機真的在跑 + 對 chat.db schema）。**出線自動送 iMessage 明確不做**（Apple 封號 + ViolatesToS）。 | 進線低、出線高到不做 |

排序理由一句話：**官方且免費（LINE）→ 官方但要審核（Meta）→ 官方但要認證+有採用摩擦（WeChat OA）→ 無官方 API 只能唯讀、不能出線（iMessage）**。個人號機器人（微信/iMessage 送訊）全程不列入，封號風險 + ToS 違反 + Jeff 已裁示。

---

## 附：來源清單

**WeChat 官方 OA**：[FDI China](https://fdichina.com/china-e-commerce/wechat-business-account/)、[WeChatWiki 海外註冊費用](https://wechatwiki.com/wechat-resources/wechat-overseas-official-account-registration-fees/)、[BWB Agency 2026](https://bwb.agency/latest-news/guide-how-to-create-and-verify-official-wechat-account-as-a-non-chinese-business-in-2026)、[Zendesk 48h 窗](https://support.zendesk.com/hc/en-us/articles/4410540013210-How-much-time-do-my-agents-have-to-reply-to-incoming-WeChat-messages)、[Weixin 客服訊息 API](https://developers.weixin.qq.com/doc/service/en/api/customer/message/api_sendcustommessage)
**WeChat 個人號封號**：[使用政策](https://www.wechat.com/en/acceptable_use_policy.html)、[社群守則](https://safety.wechat.com/en_US/community-guidelines/cover/platform-authenticity-and-account-integrity)、[SCMP 2026 收緊](https://www.scmp.com/tech/article/3349696/tencent-moves-rein-ai-content-flood-wechat-stricter-rules)
**LINE**：[LINE Developers 總覽](https://developers.line.biz/en/docs/messaging-api/overview/)、[計費文件](https://developers.line.biz/en/docs/messaging-api/pricing/)、[SiteNow 台灣 2026](https://site-now.app/line-oa-guide/)、[安永 2026 方案](https://www.anyong.com.tw/37452)
**iMessage**：[Lindy 封號實錄](https://www.lindy.ai/blog/imessage-api-three-rewrites-one-apple-ban-and-what-actually-works)、[Claw Messenger 2026](https://www.clawmessenger.com/blog/imessage-api-for-ai-agents)、[BrightCoding BlueBubbles](https://www.blog.brightcoding.dev/2025/11/27/%F0%9F%94%A5-finally-how-to-get-imessage-on-android-windows-linux-in-2025-complete-bluebubbles-guide/)
**Meta IG/FB**：[Meta Messenger Platform 總覽](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview)、[IG 24h 政策](https://www.keyapi.ai/blog/instagram-messaging-api-policy/)、[Meta 訊息政策](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy)

## 附：repo 證據錨點（供動工時直接跳）

- 統一互動表 `drizzle/schema.ts:2861`（channel enum :2865）；WeChat 孤島表 `:2296`；多通道 id `:2705`
- Gmail 歸檔引擎 `server/_core/threadFiling.ts`；出線回寫 `server/_core/outboundInteraction.ts`
- iMessage 寫入 `server/_core/imessageIngest.ts`；端點 `server/_core/index.ts:1743 / 1779`；桌機腳本 `scripts/imessage-sync.mjs`
- WeChat 服務 `server/services/wechatAssistService.ts`；router `server/routers/wechatAssist.ts`；配對 `server/_core/wechatCustomerMatch.ts`
- 配對器 `server/_core/emailCustomerMatch.ts`；未讀 `server/_core/customerUnread.ts`；訂單歸屬 `server/_core/interactionOrderAssignment.ts`
- Jeff 已裁示不做微信個人號 bot：`docs/features/customer-cockpit/sonnet5-handoff.md:85`；iMessage 安裝說明 `docs/features/customer-cockpit/imessage-sync-setup.md`
