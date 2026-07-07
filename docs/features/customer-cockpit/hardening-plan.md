# 打磨總計畫(硬化戰役)— 2026-07-07 立案

> 起因:Ann Yuan 事故(真客人信被靜默吞 + 紅點徽章靜默死兩天)。Jeff 裁示:不趕時間,一次性把整類問題根除。原則:一波一批,批間留 soak 觀察期,全程照 T2/T6 紀律。

## 五個根,五波工程

### Wave 0:事故 hotfix(已派工)
徽章 500 修復、收信失敗浮出高卡、Ann 摘要補算、canary 加 unread 檢查。

### Wave 1:觀測神經(讓所有壞都會叫)
殺掉「靜默失敗」這一整類。
1. ship 後自動煙霧:safe-deploy 部署成功後,打一輪核心 admin 端點等價查詢(新增 LOCAL_SCRIPT_TOKEN 內部 smoke 端點,server 端逐一執行 customerList/guestList/unreadCount/todayList/watchdog/命令中心 inbox 的同款查詢),任一 throw → 部署腳本紅字報出(prod 已上新版,但你當場知道哪裡壞)。
2. 錯誤漏斗 errorFunnel:tRPC admin 路由 500、pipeline 逐信失敗、worker/cron crash → 去重 → high 優先 agentMessages 卡。Sentry 留作堆疊細節,漏斗負責「Jeff 一定看得到」。
3. fail-open 全面盤點:枚舉 server/ 所有 catch-and-continue 位置,逐一分類「必須浮出/可以安靜」,必須浮出的接漏斗。產出清單存檔。
4. 有人讀的計數器:週稽核 D1 摘要加三行:messagesFailed 週增量、各 queue failed 數、LLM circuit 統計。異常週才醒目。

### Wave 2:資料庫真實化(殺 SQL 盲區)
TiDB 已咬三口(ESCAPE 反斜線、migration 註解 -->、ORDER BY 關聯子查詢),全因本地無 DB、prod 是首演。
1. SQL 彩排:建 raw sql 片段登記表(收斂所有 sql`` 模板查詢的可執行形),ship 前腳本對 prod 唯讀跑 EXPLAIN 一輪,parse/resolution 錯誤當場擋。三次事故全是 EXPLAIN 就能抓的。
2. 紀律:新增 raw sql 必須登記,登記缺漏由 grep 測試擋。
3. 長期選項(暫緩):TiDB Cloud dev tier 當 CI 整合測試庫,等 Wave 1-2 跑順再議。

### Wave 3:時間紀律(殺時間戳類,已咬五口以上)
1. 統一 timeDiscipline 模組:todayLA/toLAday/floorToSecond/assertPastEventDate 等,全 server 掃蕩替換散裝日期運算。
2. 禁用清單測試:server 端裸用 toLocaleDateString 無 timeZone、getMonth/getDate、new Date() 直接比 DATETIME 等 pattern,grep 測試紅。
3. 清掉明細頁日期 timeZone 欠帳(批 A2 申報的 follow-up)。
4. TZ 矩陣測試(UTC/Asia/Taipei/America/Los_Angeles)成為時間相關套件標配。

### Wave 4:回歸考古(清帳十二批的已知限制)
把所有 T6 報告+progress.md 宣告過的已知限制/backlog 收進一本總帳,逐條裁決:現在修 / 永久接受(寫明理由)/ 掛觸發條件延後。已知欠帳含:文件 type enum、新建外寄草稿路、flight_ticket 生成器、逐日報價 v2、C 深連結、B2 讀工具、D3 桌機月報、attach 粒度、inquiry-thread 綁定、舊互動摘要 null 回填、LLM 聊天工具人因(orderId 記憶)等。
產出:hardening-ledger.md 總帳 + 「現在修」集合的實作批次。

### Wave 5:韌性演習(證明扛得住)
1. 全身健檢自動化:把監工的人肉 E2E(表單進場、草稿誠實、出件掛附件、承諾鏈)轉成月度自動套件(API 層,0909 帳號),月一跑,結果進 inbox 卡。
2. 監工驗收清單 v2:每次 ship 後固定四查(煙霧結果、漏斗零卡、canary 下次首跑、核心頁面目測),寫進 docs/agent/ 制度檔。

## 節奏

不趕。一波一批派工,批間 soak 二到三天真實服役觀察,有事故隨時插隊 hotfix。預估全程兩到三週。順序 0→1→2→3→4→5;1 與 2 若執行者行有餘力可併批。

## 完成定義

連續兩週:零靜默事故(所有失敗都有卡)、ship 煙霧全綠、週稽核/canary 全綠、Jeff 日常說不出新的不順手。屆時客戶頁封存為「營運中」,全力開下一區塊。
