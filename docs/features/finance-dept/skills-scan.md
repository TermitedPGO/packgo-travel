# 財務 Skills 盤點(2026-07-09)

> 研究員產出,供指揮派 F2/F3/F4 工單時取材。範圍:本機已裝 finance plugin 8 個 skill 全讀 + 開源生態掃描(每個候選都開過實際內容,不只看名字)。判準:一人旅行社 + Plaid 權威帳 + Schedule C + CST §17550,鐵律 AI 絕不動錢、分類鎖死 Schedule C 枚舉。
>
> 本機 finance plugin 路徑(Cowork session 快取,skill 以 `finance:<name>` 呼叫):
> `~/Library/Application Support/Claude/local-agent-mode-sessions/50f014f6-a1d0-48a9-aa7a-d43a37568250/84bfba6a-db1b-428d-ab39-a217f82c6f61/rpm/plugin_01KmRfL8EXGF3PeqMRzef1TR/skills/`

## 一、直接可用

| Skill | 來源 | 用在哪 | 怎麼觸發 | 一句話理由 |
|-------|------|--------|----------|------------|
| finance:reconciliation(只用銀行對帳三節) | 本機 plugin `skills/reconciliation/SKILL.md` | F3 月結核對儀式:Jeff 丟 BofA PDF 時的比對方法論;F1 待認領卡的三分類詞彙(時間差/需調整/需調查)+ 帳齡分級(30/60/90 天)升級規則 | 對話提「bank reconciliation / 對帳」自動觸發,或 Skill 名直呼 | 銀行對帳格式範本與未清項分類是通用方法論,直接套;GL-to-subledger 與 intercompany 兩節跳過不讀 |
| quarterly-taxes | [openaccountant/skills](https://github.com/openaccountant/skills) `shared/quarterly-taxes/SKILL.md`(MIT) | F4 合規防罰:1040-ES 季度預估稅提醒卡(藍圖 D 已畫待建) | 複製 SKILL.md 進 `~/.claude/skills/` 即用;現在就能在 CLI 配 Plaid 導出 CSV 手算 | safe harbor(100%/110%/90%)+ SE tax 15.3% x 92.35% + 四季截止日表,公式完整,正是防罰卡要的內容 |
| tax-prep | 同 repo `shared/tax-prep/SKILL.md` | F4 抓漏 + 年底 CPA 備料:交易按 Schedule C 真實行號(8/9/10/11/13...)歸類導出 | 同上,CLI 餵交易 CSV | 20 行 Schedule C line 對照表用真行號,與 Jeff 鎖死枚舉裁決同向;可當自家分類器的對照基準 |
| home-office-deduction | 同 repo `shared/home-office-deduction/SKILL.md` | F4 抓漏:home office 候選卡(藍圖明列) | 同上 | 簡化法 $5/sqft 上限 $1,500 vs 實支法 Form 8829 兩路都有,含 regular and exclusive use 資格判斷 |
| contractor-tracking | 同 repo `business/contractor-tracking/SKILL.md` | F4 合規防罰:1099-NEC 供應商付款 ≥$600 追蹤(藍圖 D 已畫) | 同上 | $600 門檻分級(REPORTABLE/APPROACHING)+ W-9 先收 + 24% backup withholding 規則齊全;注意只管美國境內服務商,Lion/UV/eChinaTours 等外國供應商不適用(見三-4) |
| invoice-organizer | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills/blob/master/invoice-organizer/SKILL.md) | 桌面供應商發票/收據批次歸檔 + CSV 匯總 | 複製進 skills 目錄,對資料夾跑 | 改名規則 + 分夾 + CSV 輸出即用;僅限本地檔案整理,入帳判斷仍走既有 receipt-intake ledger-or-archive 流程防雙計 |

## 二、改造可用

| Skill | 來源 | 核心邏輯對在哪 | 改造點 |
|-------|------|----------------|--------|
| finance:variance-analysis | 本機 plugin `skills/variance-analysis/SKILL.md` | F3 月報卡 / F4 建議卡的文案紀律:敘事六項檢查(具體/量化/因果/前瞻/可行動/精簡)+ 反模式清單 + 文字版 waterfall;價量分解天然對映 團費 x 人數 | 門檻是企業級($50K/10%),要換成 PACK&GO 量級;資料源接權威帳 P&L,不接它假設的 budget 系統 |
| month-end-close | openaccountant `business/month-end-close/SKILL.md` | 小公司版 7 步月結(拉當月交易 → 補分類 → 抓重複異常 → 對帳單期末餘額核對 → 歸檔),形狀就是 F3 月結核對儀式 | 它呼叫的 Wilson 工具(transaction_search 等)換成自家 tRPC/Plaid 資料;補上藍圖已定的「期初期末餘額 + 筆數」雙比對與出卡邏輯 |
| subscription-audit | openaccountant `personal/subscription-audit/SKILL.md` | F4 訂閱盤點該砍的:6 個月窗口 merchant 週期偵測 + 閒置標記 + 年化省額排序 | 偵測邏輯移植進 financeAdvisor 跑 bankTransactions;它自認的盲點(商家名變體、年繳漏抓)要在自家實作補 |
| venmo-reconciler | openaccountant `business/venmo-reconciler/SKILL.md` | F1 待認領卡的候選猜測啟發:商業/私人二分的關鍵詞 + 金額閾值 + 交易 ID 去重 | 輸入從 Venmo CSV 改為 Plaid 銀行摘要行(通道原則:一切由 Plaid 收口,不做通道別 importer);同 repo 的 stripe/square/paypal-import 因此都不需要 |
| tax-preparation plugin | [mrelph/claude-agents-skills](https://github.com/mrelph/claude-agents-skills/tree/main/plugins/tax-preparation) | F4 額度卡備料:self_employment_guide(Solo 401k/SEP/SIMPLE 供款選項)+ estimated_tax_calculator.py 含 safe harbor | 寫死 2024 稅年數字,採用前逐項更新;只取自雇一支,RSU/投資稅部分與 PACK&GO 無關 |
| openaccountants MCP plugin | [openaccountants/claude-code-plugin](https://github.com/openaccountants/claude-code-plugin) | 分類交叉驗證:800+ 具名會計師簽核 skill,`/openaccountants:classify-transactions` 可當第二意見 | 只在 CLI 當對照,不嵌 server(內容 AGPL-3.0,嵌入有授權義務);最終分類仍鎖自家 Schedule C 枚舉,它只做 cross-check |

另:openaccountant repo 還有 cash-flow-forecast、seasonal-patterns、client-profitability、runway-calculator 數個 F4 候選,本輪未逐一開檔驗證,F4 派工前值得再掃一眼(同 repo 品質穩定)。其 `paperclip/agents/bookkeeper|cfo/AGENTS.md` 兩份 agent 角色定義與三崗位設定同構,寫自家 agent prompt 時可參考。

## 三、自建更好(生態沒有,進派工單)

1. Trust 合規(CST §17550)遞延與認列看門狗。上網確認:搜尋只回法條原文與註冊指南,零現成 skill(如 [oag.ca.gov SOT statute](https://oag.ca.gov/sites/all/files/agweb/pdfs/travel/sot-statute-17550-59.pdf))。加州旅行社信託會計太小眾,照原計畫進 F2 派工單,規則用測試釘死。
2. 對帳引擎本體(bankTransactions 對映 customOrders/invoices/Stripe payout + 雙計防護)。生態的 reconciliation 全是方法論文件或 CSV importer,沒有能對自家 schema 的引擎;這是 repo 內 code,F1 派工單(已規劃,維持)。
3. Schedule C 鎖死枚舉分類器 + 審計軌跡。tax-prep 的行號對照表當底稿,但「枚舉鎖死 + AI 只列候選 + Jeff 逐筆確認 + 留痕」是自家紅線邏輯,生態 skill 都是開放式分類;進 F4 抓漏派工單。
4. S-corp election 損益兩算備料卡。搜尋只有 CPA 行銷網頁計算器與閉源付費 skill(SkillAvatars),無可靠開源 SKILL.md;含 reasonable salary 假設與 payroll 成本的兩算模型自建,進 F4 結構卡派工單。順帶:外國供應商(Lion TWD/UV/eChinaTours)的 1099 排除與 W-8 判別,contractor-tracking 不涵蓋,一併進 F4 合規防罰派工單補足。

## 四、本機 plugin 其餘六個:完全不適用

`journal-entry`、`journal-entry-prep`(複式分錄/應計/折舊,PACK&GO 無 GL,權威帳是 Plaid,藍圖明言不重造會計軟體)、`financial-statements`(ASC 220/210/230 GAAP 三表,F3 的 P&L 直接從權威帳算)、`close-management`(T+1 到 T+5 多人月結日曆 + 每日 standup,一人公司無此流程)、`audit-support`、`sox-testing`(SOX 404 是上市公司 ICFR 義務,與一人 LLC 無關)。這六個的觸發詞(journal entry、month-end close、SOX)若在財務對話誤觸,直接忽略即可,不必解除安裝。

附註:落選的完整報稅類 skill(calef/us-federal-tax-assistant-skill 無 Schedule C;chaturchatur/tax-filer、elderengineer/tax-organizer 走代填申報方向)與邊界「AI 備料不代判、不報稅」相抵,不採用。
