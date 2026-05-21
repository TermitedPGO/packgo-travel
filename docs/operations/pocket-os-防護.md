# Pocket OS 防護 — PACK&GO AI Safety Controls

> **背景:** 2026-04 Pocket OS 案例 — AI agent 9 秒刪掉 prod DB + backup。
> **目的:** 防止「自家請來的 AI 連根拔起」。

**狀態:** Tier 1 部分實作（2026-05-21）。Tier 2 + 3 待 Wave 3 開始前完成。

---

## ✅ Tier 1 — 已實作（2026-05-21）

### 1. Claude Code deny list（已寫入 `.claude/settings.local.json`）

40+ 條「不可逆」命令模式自動阻擋。Claude（含我 + sub-agents）執行這些命令會被 harness 自動拒絕：

```
fly secrets unset / fly apps destroy / fly volume destroy
fly ssh console * DELETE/DROP/TRUNCATE/rm -rf
git push --force / --force-with-lease / -f
git reset --hard HEAD~* / filter-branch / filter-repo
rm -rf ~/Library / Documents / Movies / Music / Pictures
rm -rf 網站/.git / drizzle / server / client / node_modules
rm -rf ~/.ssh / .aws / .config
diskutil eraseDisk / eraseVolume / sudo / chmod 777
```

**測試這個生效**:
```bash
# Claude 試圖跑：
# git push --force origin main
# → harness 應自動拒絕
```

驗證: 任何 Claude session（含 sub-agents） try 以上命令 → 被擋。

### 2. External backup script（已寫，待 Jeff 設 credentials）

檔案: `scripts/backup-tidb-to-r2.mjs`

**Jeff 要做的（10 分鐘）:**

1. **在 Cloudflare R2 建一個新 bucket `packgo-backups`**（與 prod assets bucket 分開）
2. **建一個 separate R2 API token**，scope 限定：
   - 只給 `packgo-backups` bucket
   - 權限只 `Object Read & Write`（不能 list other buckets，不能 delete buckets）
3. **設 R2 bucket lifecycle rule**：30 天後自動刪除（避免無限累積）
4. **設 5 個 env vars**（建議放 Jeff 本機 `~/.zshenv` 或 `~/.config/packgo-backup.env`，**NOT** Fly secrets — 否則 AI 也能拿）：
   ```
   DATABASE_URL=mysql://...               # 同 Fly secret
   BACKUP_R2_ACCESS_KEY_ID=...           # 新 token，與 Fly R2_ACCESS_KEY_ID 不同
   BACKUP_R2_SECRET_ACCESS_KEY=...
   BACKUP_R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   BACKUP_R2_BUCKET=packgo-backups
   ```
5. **手動測試**：
   ```bash
   source ~/.config/packgo-backup.env
   node /Users/jeff/Desktop/網站/scripts/backup-tidb-to-r2.mjs
   ```
   預期 ~30 秒，看到 `[backup] SUCCESS` 訊息。
6. **設 macOS launchd daily cron**（每天 11:00 Taipei = 03:00 UTC）：

   建 `~/Library/LaunchAgents/com.packgo.backup.plist`：
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key><string>com.packgo.backup</string>
       <key>ProgramArguments</key>
       <array>
           <string>/bin/zsh</string>
           <string>-c</string>
           <string>source ~/.config/packgo-backup.env &amp;&amp; /usr/local/bin/node /Users/jeff/Desktop/網站/scripts/backup-tidb-to-r2.mjs &gt;&gt; ~/Library/Logs/packgo-backup.log 2&gt;&amp;1</string>
       </array>
       <key>StartCalendarInterval</key>
       <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
       <key>RunAtLoad</key><false/>
   </dict>
   </plist>
   ```

   然後：
   ```bash
   launchctl load ~/Library/LaunchAgents/com.packgo.backup.plist
   ```

**注意:**
- Mac 關機時不會跑（限制）。週末出差時 backup 會 miss → 接受（TiDB 自身 backup 仍在）。
- 想 100% reliable → 改 Fly scheduled machine（複雜，未來再做）。
- Logs in `~/Library/Logs/packgo-backup.log` — 每週看一次有沒 fail。

### 3. Master key 紙本備份（**Jeff 必須親自做**）

兩個 secret 一旦遺失 → PACK&GO 整個資料層救不回：

```bash
# 印出值（在 terminal）：
fly ssh console -a packgo-travel -C "echo APP_ENCRYPTION_KEY=\$APP_ENCRYPTION_KEY"
fly ssh console -a packgo-travel -C "echo JWT_SECRET=\$JWT_SECRET"
fly ssh console -a packgo-travel -C "echo STRIPE_WEBHOOK_SECRET=\$STRIPE_WEBHOOK_SECRET"
```

**至少 2 處備份:**
1. **1Password / Bitwarden** vault 標籤 `PACK&GO master keys`
2. **實體紙本** 放公司保險箱 / 銀行保管箱

**這些 key 我（Claude）看不到值（被 deny list 自動 redact），但你必須備份。**

理由: Pocket OS 死於 backup 跟 prod 在同一個 access scope。即使 Fly + TiDB 同時被攻破，**只要 master key 在另一個物理位置**，加密的資料可以還原。

---

## 🟡 Tier 2 — 待做（Wave 3 前完成，~2 小時）

### 4. Stripe + MySQL MCP 安裝時的 scope

當你裝 Stripe MCP / MySQL MCP（按 `~/Desktop/MCP_skills_計畫_白話版.md`）時必須遵守:

**Stripe MCP:**
- ✅ 用 Restricted Key (`rk_*`)，**不是** `sk_live_*`
- ✅ 限定 scope: `customers:read`, `subscriptions:read`, `payment_intents:read`, `refunds:read`
- ❌ 禁止 scope: `refunds:write`, `customers:write`, `subscriptions:write`
- 退款一律手動（在 Stripe dashboard 自己按）

**MySQL MCP:**
- ✅ 建 `packgo_mcp_readonly` user，**只 `GRANT SELECT`**
- ❌ NOT `GRANT INSERT/UPDATE/DELETE/CREATE/DROP/ALTER`
- ✅ MCP env vars **不設** `ALLOW_INSERT_OPERATION` / `ALLOW_UPDATE_OPERATION` / `ALLOW_DELETE_OPERATION`（預設 false 保持）

### 5. Auto-send v3 延遲到 v3，v2 全 draft-only

Wave 3 Module 3.4 原規劃「confidence ≥ 90 自動寄」— **重新建議: v2 完全跳過 auto-send**。

理由:
- Pocket OS 教訓 = 自動化失控 = 不可逆
- AI 寄錯 quote / refund 確認 = 客人關係毀
- "快" 不是 PACK&GO 競爭力，"精準" 才是

v3 評估前提:
- v2 結束後 6+ 月觀察期，draft mode 沒重大誤判
- 100+ 客人實測通過
- Sentry 0 critical error related to auto-dispatch
- Jeff 親自批准每個技能單獨 opt-in

---

## 🟢 Tier 3 — 下個月做

### 6. 每日 AI 工作日誌 review (5 min)

每天早上看：
- `git log --since=yesterday` — AI 昨夜 commit
- `fly logs -a packgo-travel --since=24h` — prod errors
- Sentry digest email
- Stripe dashboard — 異常退款
- PostHog — 客人異常行為

### 7. "9 秒 brake" — Supervisor agent 強制 confirm

CLAUDE.md 加新章節 §十 — 任何下列操作必須先 `AskUserQuestion`：

```
- DELETE / DROP / TRUNCATE on prod DB
- fly apps destroy / fly volumes destroy
- 取消任何 Stripe subscription / 退款 > $500
- 大量 email send (> 50 收件人)
- 任何 force-push to main / master
```

實作: 我的 supervisor agent prompt 加 enforcement rule。

---

## 復盤模板（出事時用）

若 PACK&GO 真的出 Pocket OS 級別事件:

1. **立刻 freeze** — `fly scale count 0 -a packgo-travel`（停所有 prod traffic）
2. **找最近一份 R2 backup** — `aws s3 ls s3://packgo-backups/daily/`
3. **restore 到 staging TiDB**（不是 prod）— 用 backup 還原
4. **diff staging vs prod** — 確認哪些資料丟了 / 改了
5. **rollback Fly to last-known-good version** — `fly releases rollback v<X>`
6. **告知客人** — email + 微信 + LINE 同步
7. **post-mortem** — 5 whys，找到 root cause
8. **patch** — deny list / scope tightening / monitoring

---

## 更新紀錄

| 日期 | 變更 |
|---|---|
| 2026-05-21 | 初版，Tier 1 (deny list + backup script) 落地 |
