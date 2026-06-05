# Gmail 整合 + 分類器修復 — Progress

> 給監工 / 下一個 session 看的總覽。狀態真實,不自我宣稱完成。

## 狀態總表

| # | 項目 | 狀態 | 備註 |
|---|------|------|------|
| 1 | support@ 重新授權(找路徑 + 給網址) | ✅ 交付 | 網址見 design.md;**等 Jeff 實際去點** |
| 1b | 確認加第二隻 = 同流程 | ✅ 交付 | 同網址,選帳號畫面改帳號;footgun 已記 |
| 2 | Token 死掉節流警報 | ✅ **已部署 v670**(2026-06-05),prod /health 綠 | 不自動停用,只響一次;14 tests 綠 |
| 3a | 分類器 customer-vs-noise | 🟡 eval 核心已建(metrics+harness,7 tests 綠);等語料 | 見 Round 2 |
| 3b | 31% 處理例外 robustness | ⛔ 未開始 | 先量例外類型再補 |
| 4 | 連 jeffhsieh09 私人帳號 | ⛔ 鎖住 | 要 3a eval 過 + Jeff 簽核 |

## 阻擋點(blockers)

- **B1**:task 3 eval 語料要 support@ live mail → 需 Jeff 先重連 support@(task 1 網址)。重連後我才能跑 `scripts/gmail-eval/` 拉 gold set。
- **B2**:taxonomy A vs B 待 Jeff 拍板(不擋 eval,gold label 先用二元)。

## 下一步(依序)

1. Jeff 重連 support@(點 design.md 的網址,選 support@packgoplay.com)。
2. 我跑 read-only 語料拉取 → 標 gold → Jeff 抽查。
3. 實作 task 3 分類器 + 量 precision/recall。
4. 同時:task 2 跑 tsc + vitest 綠 → 等 Jeff 簽核部署。
5. 全部驗過 + 簽核 → 連 jeffhsieh09。

## Round 1 發現(2026-06-05)— 語料現實檢查

- support@ 已重連(token fresh,prod 已修)。auto-send 仍全關(`AGENT_DRY_RUN=true` + `autoSendEnabled=false`)。
- 從 support@ 拉了 180 天全部收信:**只有 88 封,來自 9 個 domain**。
- 預標:81 非客人(46 notification / 31 newsletter / 4 transactional)、7「客人候選」。7 個裡 6 個其實是自動通知(Plaid×2、Yelp×3、Squarespace×1),**頂多 1 封(@gmail.com)是真人**。
- **關鍵結論**:support@ 近 180 天幾乎沒有真客人來信。當初「229 spam」是 **jeffhsieh09 私人信箱**時期的量,不在 support@。
- **影響**:只靠 support@ 這 88 封做「客人 vs 雜訊」eval,positive 類別趨近 0,precision/recall 沒有統計意義。需要更有真客人 + 真 spam 的語料來源(見 blocker B3,等 Jeff 決定)。
- 產出(本機,gitignored):`scripts/gmail-eval/{pull-corpus,prelabel}.cjs` + `data/corpus.jsonl`(88)+ `data/gold.jsonl` + `data/gold-review.md`(26 待你確認)。

### Blocker B3 — eval 語料來源(已決定:Jeff 提供)
support@ 沒有足夠真客人。**Jeff 選:由他提供一批真實客人信(+ 非客人)當 ground truth。**
- 投放處:`scripts/gmail-eval/data/inbox-samples/`(README 已寫明格式;txt 區塊 / .eml / 對話貼上皆可)。
- ingest 工具就緒:`scripts/gmail-eval/ingest-samples.cjs`(.eml/.mbox/.txt/.json → provided-corpus.jsonl)。
- loop 狀態:背景 watcher 盯著投放資料夾,檔案一到自動醒來;否則 30 分鐘 heartbeat。
- **下一輪(資料到後)**:ingest → 合併 support@ 88 + provided → 重新預標 → Jeff 確認不確定的 → 建 eval harness → 跑 baseline classifier → 算 precision/recall → R2 起逐輪改。

## Round 2(2026-06-05 接手 session)

- **Task 2 已上線**:commit 7f65bfb → deploy v670。pre-commit hook 綠(tsc 0 error、i18n parity 6573/6573)。prod /health 全綠(db 28ms / redis 2ms / stripe 289ms / llm 348ms)。worker 乾淨啟動;Task 2 警報路徑由 14 unit tests 覆蓋(真實 invalid_grant 不在 prod 觸發,不強測)。
- **eval 引擎核心建好(可重用,Phase 1 直接接)**:
  - `server/_core/evalEngine/classificationMetrics.ts`:純函式、無依賴、通用多類別。precision / recall / f1 / confusion / accuracy / macroF1。**未定義的指標回 null 不回假 0**(0 正例時 recall = null = 「測不出」,不騙自己)。7 個 Vitest 綠。
  - `scripts/gmail-eval/score.ts`:harness runner(tsx)。truth = gold ?? 高信心 auto-resolved prelabel,排除未確認;吃 predictions.jsonl 算 binary customer-recall 報告。
  - 現況實測(score.ts 對現有 88 gold):**trusted-truth 62(customer 0、non-customer 62)、26 未確認**。harness 直接吐 WARNING:0 customer → recall 測不出。**用 code 證實 support@ 沒客人**。
- **語料決策(Jeff 2026-06-05)= 兩個都做**:(a) jeffhsieh09 唯讀拉(SPAM=負例、回過的 thread=正例,自動標 + 抽查),(b) Jeff 丟高價值真客人信進 inbox-samples/。

### 下一步(Round 3,等 Jeff 動作)

1. **jeffhsieh09 唯讀拉語料**:Jeff 需 re-auth。**Footgun**:OAuth callback 會把 isActive→1(等於把私人信箱接上 live worker),所以拉完要立刻設回 0。auto-send 兩道開關全關,期間最壞只是 #inquiry channel noise,不碰客人。Round 3 我設計安全唯讀路徑再請 Jeff 點。
2. **Jeff 丟樣本**進 `scripts/gmail-eval/data/inbox-samples/`(README 已寫格式,不要用 Fwd)。
3. 語料到 → ingest + 合併 support@ 88 + 重新預標 → Jeff 確認不確定的 → 跑 `score.ts` 出 baseline classifier 數字 → 逐輪改、每輪比數字。
4. 同時可做:task 3b(31% 例外 robustness)先量例外類型。

## 變更紀錄

- 2026-06-04:接手、驗 prod 現況、寫 proposal/design/progress、實作 task 2(throttled alert)。
- 2026-06-05 R1:重連確認、拉 support@ 語料(88)、啟發式預標、發現 support@ 無真客人 → 需決定語料來源。
- 2026-06-05 R2:Task 2 上線(v670)、建 eval 引擎核心(metrics + harness,7 tests 綠)、score.ts 證實現有語料 0 customer、語料決策=兩個都做。
