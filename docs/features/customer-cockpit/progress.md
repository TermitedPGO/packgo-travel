# 客戶頁衝 100 分 — 進度總覽

> 對應 `roadmap-100.md` 的九塊工作(Phase1-6 + 收尾)。監工看這份,不看實作細節;文件自稱完成不算數,以下每項都附驗證證據。

## Phase 1a:截圖/匯出檔進場升級(讀懂寫時間軸)— 已完成,待 ship

**做了什麼**:拖一張聊天截圖或匯出的聊天記錄 txt 進客戶頁聊天框,AI 現在會讀懂裡面的對話,判斷是不是跟目前這位客人的真實對話,把每則訊息用「對話裡的真實時間」(不是拖檔當下的歸檔時間)寫進 `customerInteractions` 時間軸 —— 不再只是存成一份文件。

**新增/修改檔案**:
- `server/_core/chatLogImport.ts`(新增)— 四個 export:`resolveEventDate`(日期年份推算純函式)、`classifyAndExtractChatLog`(LLM 讀懂對話+判斷對象是否相符)、`buildChatLogInteractionRows`(純函式組出要寫入的列)、`importChatLogForCustomer`(唯一碰 DB 的協調函式,含去重)。
- `server/_core/chatLogImport.test.ts`(新增,46 tests)。
- `server/_core/index.ts` — 接進 `/api/agent/ask-ops-stream` handler,`customerDocuments` 既有歸檔區塊之後,重用同一個 `persistProfileId`。
- `docs/features/customer-cockpit/roadmap-100.md` — Phase1a 打勾 + Jeff 2026-07-02 補的 Phase6 四項自我測試(月度scorecard/每週E2E canary含新增客人鏈/每週正確性稽核)。

**核心設計決策**:
- 日期年份推算 100% code 算(`resolveEventDate`),LLM 只負責讀出畫面上的日期原文——這個 repo 已經因為「歸檔時間冒充事件時間」死過兩次(commit 0fd04cf/5b021ca/d97dc33),這次刻意把數學和閱讀切開。
- 認人邏輯:只有畫面明確指名另一個具體的人時才判 mismatch 問 Jeff;沒看到名字或名字對得上一律放行,不製造假警訊(寧漏勿誤)。
- 去重鍵含時間戳(content+createdAt),同一句話不同時間說不會被誤殺;同一張截圖重複拖不會灌雙倍。

**驗證過程**:Workflow 四階段(實作 → 六路對抗式審查 → 修復 → 獨立驗收)。
- 六路審查抓到:認錯人風險 P1(客人卡沒填姓名時核對形同虛設)、prompt injection P1(轉述結果沒包隔離語句)、併發/去重 2 個真缺陷(批次寫入中途失敗吞掉已成功列、同內容不同時間誤判重複)、測試覆蓋缺口(核心 LLM 函式零測試)——全數 CONFIRMED 的 P1/P2 都已修復。
- 2 項留為已知限制,已記錄不阻擋上線:①同一張截圖幾乎同時拖兩次的競態(TOCTOU)需要資料庫唯一鍵,要走 migration 需要 Jeff 點頭,目前 Jeff 是唯一操作者、依序拖檔,實際觸發機率低;②LLM 呼叫在 SSE 串流開始前同步跑,截圖較長時聊天框會多等一下,真正修好要重構成 fire-and-forget,牽動 `[CHAT_IMPORT_RESULT]` 要在同一輪注入的架構,列為效能優化 backlog,非正確性缺陷。
- 額外自行修正(六路審查之後,獨立驗收之前):`no_messages` 且 `droppedCount>0`(讀到真對話但每則訊息日期都解析失敗)原本被歸類跟「不是聊天記錄」一樣靜默不提示,違反 `requirements.md` §六.4「不支援要提示,不准靜默」,已加一句明確提示 Jeff 截圖可能沒有可辨識的時間戳。

**最終驗證**(2026-07-02):`tsc --noEmit` 0 錯;`vitest run server/_core/chatLogImport.test.ts` 46/46 通過;完整套件 `vitest run` 277 files / 3887+ tests 全綠,無既有測試被波及。

**尚未做**:真實截圖端對端驗證(這批只有 unit test + mock,沒有真的拖一張截圖進 prod 聊天框跑過)。**Jeff ship 後**,建議挑 1 張真實微信截圖(或用 0909 測試客人)實測一輪,確認:①真的寫進時間軸且時間正確;②真相條有更新;③截圖裡沒對話內容時能正確判斷 not_a_chat_log。

**已知限制**(不阻擋上線,供之後決策):TOCTOU 併發競態(需 migration)、串流延遲(需架構重構)、非美式 DD/MM 日期格式會照美式慣例解讀(刻意取捨,PACK&GO 客群主要中英美式雙語)。

**狀態**:code 完成、tsc+測試綠、已 commit,等 Jeff 跑 `pnpm ship` 上線。上線後才能做真實截圖的 prod 驗證(本機無 DB/LLM 金鑰)。

---

## Phase 1b-6、收尾

尚未開始。裁示已收(2026-07-02):14 案存量進場 Jeff 先手拖 1-2 案驗流程、Plaid 收款建議做、今日清單放中欄空狀態、報價出手前案子要在系統裡的規矩已立。Phase6 自我體檢範圍已擴充(月度 scorecard 桌機腳本 + 每週 0909 E2E canary 含新增客人鏈 + 每週正確性稽核回饋迴圈),詳見 `roadmap-100.md`。
