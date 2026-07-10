# Windows 常駐工位設定清單(2026-07-10 立)

> 定位:24/7 指揮值班機。跑夜間衝刺、排程掃描、瀏覽器偵察。不碰 prod DB 寫操作,不跑 ship(ship 永遠 Jeff 在自己機器跑)。
> 背景:Mac mini 延後採購(iMessage 只收不發、不需即時,MacBook 回家補課即可,見 macbook-imessage-catchup.md)。

## 一、一次性設定(照順序,約 30 分鐘)

1. 電源:設定 > 系統 > 電源,螢幕可關、睡眠設「永不」(接電源)。筆記本蓋子行為若是筆電另設「闔上蓋子不動作」。
2. WSL2:系統管理員 PowerShell 跑 `wsl --install -d Ubuntu`,重開機,進 Ubuntu 設帳號。
3. 基礎工具(Ubuntu 內):
   ```
   sudo apt update && sudo apt install -y git curl build-essential
   curl -fsSL https://fnm.vercel.app/install | bash && source ~/.bashrc
   fnm install 22 && corepack enable pnpm
   ```
4. Claude Code:`curl -fsSL https://claude.ai/install.sh | bash`,跑 `claude` 登入(用 jeffhsieh09 帳號)。
5. GitHub:`ssh-keygen -t ed25519`,公鑰加到 GitHub(TermitedPGO),`git clone git@github.com:TermitedPGO/packgo-travel.git ~/packgo`。
6. 驗證:`cd ~/packgo && pnpm install && NODE_OPTIONS="--max-old-space-size=6144" npx tsc --noEmit`,0 錯即工位可用。
7. 遠端進入(可選但建議):裝 Tailscale(Windows 側),MacBook 也裝,外出時可 ssh 回來看。
8. 瀏覽器偵察側(可選):Chrome 裝好、登好常用帳號(供應商後台等),配 Claude in Chrome 擴充。

## 二、環境差異紅線(跟 Mac 主力機不同處)

- 這台沒有 DATABASE_URL,跟本地慣例相同:DB 操作一律走 prod/Fly 或 LOCAL_SCRIPT_TOKEN HTTP 端點。
- 客人文件(PDF/字型)不在這台產:WeasyPrint 字型雷是照 macOS 調的,Windows 未踩坑。PDF 活留 MacBook。
- flyctl 可裝(`curl -L https://fly.io/install.sh | sh`)但只准唯讀探真,ship 紅線不變。
- 記憶體:WSL 預設吃一半 RAM。若機器 16GB 以下,建 `%UserProfile%\.wslconfig` 設 `memory=10GB`,避免 vitest 全套 OOM(跑不動就分片)。

## 三、日常運作模式

- Jeff 出門前:確認機器沒睡、WSL 內有一個 `claude` session 活著(或乾脆開著)。
- 指揮接班:夜間衝刺派工單照常走 docs/features/ 派工檔,這台的 session 讀單執行。
- 排程:例行掃描先用 Claude Code 內建排程;穩定後逐步搬雲端(Fly cron)。

## 待補資訊(Jeff 提供後更新本檔)

- [ ] 機器 RAM / CPU
- [ ] 是否已裝 WSL
- [ ] 平常開機時段(全天 or 白天)
