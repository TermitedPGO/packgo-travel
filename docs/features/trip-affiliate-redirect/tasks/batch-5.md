# Batch 5 — batch-4 終驗四 P1 固定窄修(302 可用性/access-log PII/popup/telemetry 語意)

> 2026-07-16。承 Codex batch-4 終驗(14:04 PDT):核心 homepage-only 收斂 PASS 不得重開,
> 只收四個 P1 + docs 真值。同一隔離工作樹、分支、基準 `4c86254`。
> **停止線:不 commit、不 push、不部署。**

## P1 逐項對照

| # | Codex 終驗 P1 | 修法 | 檔案 |
|---|---------------|------|------|
| 1 | telemetry 被 `await` 在 302 前,Redis/DB **懸掛**(非立即 reject)就不導向;Codex 用 never-resolve promise 實證 50ms 後 statusCode=0 | handler 改為:驗完 source/target **先同步送出 302**,telemetry 改 `void recordBestEffort(...)` detached side effect(內部自吞全部失敗)。限流/Redis/DB 不再是 response 前置 | `tripRedirect.ts` |
| 2 | endpoint 雖不讀 query/body,但 pino-http 與 body parser 掛在它**前面**:query PII 進 access log(pino 原樣記 req.url/query),壞 JSON GET body 先被 parser 回 400 | route 改掛在 **compression 之後、correlationId/pino-http/express.json 之前**(`mountTripRedirect(app)` 共用函式,production 與測試同一接線);/go/trip 請求根本到不了 logger 與 parser | `_core/index.ts`、`tripRedirect.ts` |
| 3 | `_blank` popup 被 blocker 回 null 時,客人點了完全不動,零 fallback;「popup blocker 無從攔」宣稱被黑箱推翻 | 移除 window.open,改**同頁 `location.assign(firstPartyPath)`**(同源普通導向,無 popup 可擋);`navigation` 物件作 injectable seam 供測試證明「一次 click 必達精確路徑」;刪除「瀏覽器不會阻擋」宣稱(batch-4.md 已標註推翻) | `tripClickout.ts`、batch-4.md |
| 4 | admin 仍把可重放的 redirect request 稱「點擊」(總點擊數/點擊記錄/來源頁面/Click Log/Referrer Page) | 可見文案全改:總導流請求/導流記錄/來源、Total Redirect Requests/Redirect Log/Source;legacy flight/hotel 標「歷史機票導流/歷史飯店導流」「Historical … Redirects」「歷史機票/Legacy flights」badge;內部 key 名(schema 語彙)依裁定可留 | i18n zh-TW/en(12 值 ×2) |

## §7 P2 / docs-integrity 逐項

1. 三 caller 證據:新增 **source-contract 測試**(repo 無 RTL,依裁定用窄合約):三個元件都
   import 共用 clickout、傳各自 closed source、保留常駐告知、無 window.open、無手組 trip.com URL。
2. handler 單測 vs 完整 middleware:新增 **`tripRedirect.integration.test.ts`** 跑真 Express app
   + 真 HTTP listener,依 production 順序掛載;文件(design §七)已區分兩層。
3. 熱門航線/城市卡 external-link icon → `MessageCircle`(開的是站內顧問,不是外站)。
4. proposal 加「現況=homepage-only,§三~五為歷史實驗」橫幅;被取代的 Jeff 裁示標註取代裁定。
5. evidence:D13390050 一律改稱「出現在 Jeff 核准入口的素材」,不稱 known-good/有效。
6. 「零歸因、零佣金」降級為可親證陳述:觀察中掉參數+未見 Union cookie;佣金支付與否只有
   Affiliate 報表能定案。
7. cookie 措辭:未登入、未讀 Jeff 個人 cookie;唯讀驗證曾觀察**測試瀏覽器自身**的 attribution
   cookie 狀態。
8. untracked 口徑 1,126 → **1,129**(Codex 核數)已同步 progress/batch-4。

## 新增/更新測試

- `tripRedirect.test.ts`:+2 案 —— 限流 never-resolve、DB never-resolve,兩案都在 promise
  不解除的情況下斷言 response 已是 302 且 target 精確(Codex 指定驗法)。
- `tripRedirect.integration.test.ts`(新,10 案):真 express + 真 listener,production 順序
  (route → logger → parser):query 塞 email/電話/evil target → 302 且 access-log 捕捉為**空**;
  壞 JSON GET body → 302;四 source 真 HTTP 302 精確 target;未知 source 400 且不進 log;
  控制組證明 logger/parser 對其他 route 活著;source contract 釘死 `_core/index.ts` 掛載順序
  (mountTripRedirect 先於 pinoHttp 與 express.json)且無第二個字面路由。
- `tripClickout.test.ts`(改寫,12 案):navigation seam 證明一次 click 必達 `/go/trip/<source>`;
  window.open 永不被呼叫;GA 先於導向;invalid source no-op;production seam = location.assign。
- `affiliateCallers.contract.test.ts`(新,13 案):三 caller source contract + admin i18n
  semantic guard(zh 可見值禁「點擊/來源頁面」、en 禁 click/referrer、legacy 標歷史)。

## 驗證(全部實跑)

| 項目 | 結果 |
|------|------|
| Focused(8 檔:service 29+redirect 27+integration 10+atomic 6+router 2+clickout 12+analytics 10+contract 13) | **109 passed** |
| `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` | **exit 0、零錯** |
| 全量 vitest | **359 檔 / 5,264 tests passed / 90 skipped / 0 failed**(145s;比 batch-4 多 27 條=新增測試) |
| `git diff --check` + untracked 行尾空白/conflict 掃描 | 乾淨 |
| scope(`porcelain=v2 -uall`) | 13 tracked(+362/−481)+ 17 untracked(1,572 行,Codex 核數更正);staged 0;`inquiries.ts` diff 0 |
| 隔離 | 主樹 main 零 affiliate 檔變更;pdf-fix/sagadocs HEAD 均在 `4c86254`;本樹 HEAD=`4c86254` 未 commit |

## 禁動確認(同前 + §8 不准重開清單)

未動:deep links、affiliate ID/SID/核准 URL 常數、closed source enum、Lua script 本體、
analytics enum、server telemetry schema、Trip.com API/MCP/iframe/付款。
未觸碰付款、Gmail、migration、credential、deployment、`inquiries.ts`、Safe Booking Saga、
PDF parser、主樹與 siblings。未登入 Trip.com、未建訂單、零付款。
