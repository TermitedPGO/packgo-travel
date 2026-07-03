# iMessage 桌機同步 — 安裝說明(一頁)

給 Jeff 在自己 Mac 上設定 `scripts/imessage-sync.mjs`,每 5 分鐘把 iMessage/簡訊同步進客戶頁時間軸。跟 Phase1b 的 `scripts/import-customer-cases.mjs` 共用同一份 `~/.packgo/local-script-token`,不用重設第二次。

## 0. 安裝套件依賴

腳本需要 `better-sqlite3`(唯讀開啟 chat.db 用),repo 目前沒裝。在專案根目錄跑一次:

```bash
npm install --no-save better-sqlite3
```

腳本開頭會自動檢查這個套件在不在,沒裝會印出上面這行指令再結束,不會丟一堆看不懂的 stack trace。

## 1. Full Disk Access(完整磁碟取用權限)

`~/Library/Messages/chat.db` 受 macOS 保護,執行腳本的程式必須有完整磁碟取用權限,否則唯讀開啟會直接失敗。

1. 系統設定(System Settings)→ 隱私權與安全性(Privacy & Security)→ 完整磁碟取用權限(Full Disk Access)。
2. 點左下角 + 號,把你實際跑這支腳本的程式加進去:
   - 如果是在 Terminal.app 裡手動跑或用 launchd 呼叫系統 node,加 **Terminal**。
   - 如果用 nvm/homebrew 裝的 node 直接被 launchd 呼叫(不經過 Terminal),要加的是 **node 執行檔本身**(`which node` 查路徑,例如 `/opt/homebrew/bin/node`),或乾脆把呼叫它的 shell(通常還是 Terminal 或 `/bin/zsh`)加進去。
3. 加完之後**完全關閉並重開 Terminal**(或重新登入),權限才會生效。
4. 驗證:跑 `sqlite3 ~/Library/Messages/chat.db ".tables"`,如果印得出 `message`、`handle` 等表名,權限沒問題;如果報 `unable to open database file`,回頭檢查上面步驟。

## 2. 確認 iCloud 訊息已同步到這台 Mac

腳本只讀本機 `chat.db`,不會去 iCloud 抓資料。確認訊息真的有進來本機:

1. 打開 Messages.app,確認 訊息 → 設定(Settings)→ iMessage 裡「你的 Apple ID」已登入,且「在此電腦上啟用訊息」(Enable Messages in iCloud,如果有開)狀態正常。
2. 隨便挑一則手機上收到過的近期簡訊/iMessage,確認同一則訊息在這台 Mac 的 Messages.app 視窗裡看得到。看得到就代表本機 chat.db 有這筆資料,腳本才讀得到。

## 3. LOCAL_SCRIPT_TOKEN(跟 Phase1b 共用)

如果 Phase1b(`import-customer-cases.mjs`)已經設定過這組 token,**跳過這節**,兩支腳本讀同一個檔案 `~/.packgo/local-script-token`,不用重做。

首次設定:

```bash
# 1) 產生一組隨機 token,設到 Fly 的環境變數(server 端讀 LOCAL_SCRIPT_TOKEN)
flyctl secrets set LOCAL_SCRIPT_TOKEN=$(openssl rand -hex 32) -a packgo-travel

# 2) 把同一個值存到本機檔案(注意:上面指令產生的值只在你自己終端機看得到,
#    要手動複製貼上到下面這個檔案裡,兩邊必須完全一樣)
mkdir -p ~/.packgo
echo '貼上上面產生的 token 字串' > ~/.packgo/local-script-token
chmod 600 ~/.packgo/local-script-token
```

想確認 Fly 上實際的值(忘記剛剛產生的字串時):

```bash
flyctl secrets list -a packgo-travel   # 只看得到 secret 名稱，看不到值本身
```

如果看不到值,直接重新 `flyctl secrets set` 一次新值,兩邊(Fly + 本機檔案)一起換掉即可,不影響其他功能。

## 4. launchd 排程(每 5 分鐘跑一次)

建立 `~/Library/LaunchAgents/com.packgo.imessage-sync.plist`(路徑、node 執行檔路徑請依實際環境調整):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.packgo.imessage-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/jeff/Desktop/網站/scripts/imessage-sync.mjs</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/jeff/.packgo/imessage-sync-launchd.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/jeff/.packgo/imessage-sync-launchd-error.log</string>
</dict>
</plist>
```

`/opt/homebrew/bin/node` 換成 `which node` 實際印出的路徑。`StartInterval` 300 秒 = 5 分鐘。

載入排程:

```bash
launchctl unload ~/Library/LaunchAgents/com.packgo.imessage-sync.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.packgo.imessage-sync.plist
```

檢查有沒有在跑:

```bash
launchctl list | grep packgo
tail -f ~/.packgo/imessage-sync.log
```

要暫停:

```bash
launchctl unload ~/Library/LaunchAgents/com.packgo.imessage-sync.plist
```

## 5. 未認領號碼怎麼查

電話對不上任何客人卡的訊息,內容不會離開這台 Mac,也不會進資料庫,只會記在本機 `~/.packgo/imessage-unclaimed.json`(只有電話 + 最後出現時間 + 出現次數,不含任何訊息內容)。想看:

```bash
cat ~/.packgo/imessage-unclaimed.json
```

看到眼熟的號碼,想讓之後的訊息自動歸戶,就用後台既有的「新增客人」流程幫這個人補上這支電話,之後這支號碼的新訊息會自動命中歸檔,不需要手動處理歷史訊息(歷史的仍在本機 log/Messages.app 裡,沒有回填機制)。

## 6. 隱私保證怎麼落實(摘要)

`imessage-sync.mjs` 送出訊息前,一律先呼叫 `POST /api/admin/imessage-check-known-phones` 用「純電話號碼、不含任何訊息內容」問 server 這批電話裡哪些是已知客人,只有回應裡列出的電話,才會在最終送出的訊息裡帶 `text`;其餘電話一律 `text: null`,只送電話號碼跟時間戳。完整技術決策寫在 `scripts/imessage-sync.mjs` 檔案開頭的註解。
