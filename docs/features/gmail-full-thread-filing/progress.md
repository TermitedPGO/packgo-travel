# 進度 — gmail-full-thread-filing

> 權威主線見 plan.md;本檔是實作狀態總覽。

## MVP [0]-[6] — 收齊引擎(2026-06-23 完成,未部署)

| 步 | 內容 | 狀態 | commit / 檔案 |
|----|------|------|----------------|
| [0] | prod 拉 Emerald 信頭確認 gate | ✅ 結論見下 | (調查,無 code) |
| [1] | migration 0101:externalId + gmailThreadId + UNIQUE | ✅ tsc 0 | `drizzle/0101_interaction_external_id.sql` + schema + journal idx 101 |
| [2] | gmail.ts:Message-ID + listThreadMessagesForFiling | ✅ test 綠 | `server/_core/gmail.ts` + `gmail.test.ts`(+15 測) |
| [3] | 收件 insert 補 externalId + gmailThreadId + dup-key guard | ✅ tsc 0 | `server/agents/autonomous/gmailPipeline.ts` |
| [4] | threadFiling.ts:syncThreadToInteractions(claim-or-insert) | ✅ 18 測綠 | `server/_core/threadFiling.ts` + `threadFiling.test.ts` |
| [5] | poll hook:processOneEmail 末尾 sync 整條 thread | ✅ tsc 0 | gmailPipeline.ts(per-cycle Set 去重) |
| [6] | sentMailFiling 降級:只留附件→R2,移除 outbound 雙寫 | ✅ tsc 0 | `server/_core/sentMailFiling.ts` |

全測試:2821 passed / 0 failed;tsc 0。**未部署**(部署是 Jeff 的 `pnpm ship` gate)。

### [0] 結論(實測,推翻 plan §三.3 的猜測)
Emerald(eyoung@axt.com)8 條 thread、重度 **inbound**(不是「mostly outbound」)。
- 非 noise(axt.com 不在清單)、非 receipt 分支(她的 booking 信沒 PDF 附件+keyword,detectReceipt=false)。
- 真因:**收件 poll 是 `is:unread` + forward-only**,跑在 Jeff 親自讀的個人信箱。她的信被 Jeff 讀掉
  才輪到 poll(已無 UNREAD)→ `processOneEmail` 從不對她跑 → 0 profile / 0 interaction。4 個月歷史
  也早於 2026-05-11 整合連線。
- **影響**:MVP [5] poll hook 只在 `processOneEmail` 內觸發,**救不到 Emerald**。她要等 **[8] thread
  驅動 backfill**(下一批)。這正好 **印證** thread 驅動(非 profile 驅動)的設計前提。
- 她的 booking 信含明文卡號 → syncThreadToInteractions 的 scrubPii 是必須的(已含)。

### Jenny 驗收(機制已對真資料驗證,未跑 live)
- thread `19ea7f001a03861c` 共 9 封(6/8→6/16)。
- 缺的那封 = Jeff 純文字英文導遊報價 **US$174 / US$2,260 / US$226**,SENT、無 PDF
  (`2026-06-16T01:34:22Z` = 6/15 18:34 太平洋 = 「Jeff 6/15」)。has:attachment gate 漏的就是它。
- 部署後:她 thread 任何 inbound 一旦被 poll,thread sync 會把 9 封補齊(含這封 outbound,
  createdAt=真實 Gmail 時間,scrubPii 不動數字)。
- ⚠ 限制:[5] 需要該 thread 有「未讀 inbound」觸發 poll。若 Jenny 整串已讀,要等她下次來信
  (或 [8] 主動掃)才回填。proactive 掃既有靜止 thread = [8]。

## 加做:用講的收客人(on-demand 指名回填,2026-06-23,未部署)

Jeff 選「用講的」+「只收他本人的信」。把「指名收一個客人的整串 Gmail」接上既有 ops chat
(提案→點擊→執行,跟 sendCustomerEmail/triggerRefund 同一套,零新繞道)。研究見背景並行
workflow(wf_4a66328c-ab5)。

| 步 | 內容 | 狀態 | 檔案 |
|----|------|------|------|
| T1 | customerBackfill.ts:backfillCustomerByEmail(write)+ previewCustomerThreads(read,遮卡號)+ searchThreadIds | ✅ 7 測綠 | `server/_core/customerBackfill.ts` |
| T2 | opsTools:唯讀 preview_customer_threads 工具 + runTool case | ✅ | `opsTools.ts` (+test READ_TOOLS=10) |
| T3 | opsActions:collectCustomerThreads 動作(ensure-create profile、迴圈 active 信箱、不寫 lastInteractionAt) | ✅ | `opsActions.ts` (+enum/email/no-DB 測) |
| T4 | opsAgentStream:suggest_action enum + 工具清單 | ✅ | `opsAgentStream.ts` |
| T5 | opsAgent:ACTION_PROPOSAL_GUIDE 加 collectCustomerThreads + 鐵則(不猜 email、先 preview 再出 chip) | ✅ | `opsAgent.ts` |
| - | chip icon | ✅ | `AgentChatPage.tsx` |

安全(架構性):agent 手上只有唯讀 preview;真正歸檔是 WRITE action,只能經 chip + Jeff 點。
名字→search_customers 查;查不到(Emerald)請 Jeff 給 email,絕不猜。preview 樣本 scrubPii。
回填刻意不寫 lastInteractionAt → 不污染活躍窗、不二階燒摘要 LLM(burn=0)。
全測試 2831 passed / 0 failed;tsc 0。**與 MVP 綁一起上**(同一次 pnpm ship)。

決策待 Jeff:名字多筆候選 UX、maxThreads 50 上限(老客戶上百條 thread 可能 tRPC timeout)、
回填客人要不要也生 AI 摘要(預設不生)。供應商/航空 thread = 只收指名 email,要收就另外指名。

## 延後 [7]-[13](未做)
見 plan.md §四。下一批先 [7] senderClassifier → [8] backfill worker(thread 驅動,**先暫停
customerSummaryQueue**,dry-run 先給 Jeff)→ ... → [11] 讀取側 cap 提高 → [12] 身分層。

---
## 2026-07-01 部署查證(Claude)
[0]-[6] 已隨 6 月部署上線且在跑(push+poll 雙路徑,2026-07-01 v771 加 per-message Redis 鎖防雙處理)。[7]-[13] 照 plan.md §四排程,[8] backfill 仍待做(Emerald 舊信補收依賴它)。
