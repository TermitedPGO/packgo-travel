# Runbook — 開啟 TOUR_INSTANT_CHECKOUT_ENABLED 前置(運維閘)

> 2026-07-11 指揮驗收回令立。背景:必付格式漂移 P2 —— verifyTourCheckout 的
> (c-3) 用「頁面展示的必付清單(supplierProductDetails.priceTermsParsed,R4
> parser 落格式)」對比 live parse。若某團的 stored 是 R4 之前的舊格式(或沒
> enrich),兩端字串對不上 → mandatory_fees_changed 全擋。方向 fail-closed
> 安全,但會把可售團誤擋成詢位。故開旗標前必過以下兩條,不改碼。

## 前置一:promote 必帶 skipSync:false

全量 475(以及其後任何一波)promote 時,必帶 `skipSync:false` 讓 enrich 用
現行 R4 parser 重寫 stored priceTermsParsed —— 兩端(stored / live)同一個
`parseUvPriceTerms` 產生,格式恆等。跳過 sync 的 promote 會留下舊格式 stored,
該團上線後結帳一律被 (c-3) 擋。

## 前置二:開旗標前 prod 抽 1-2 個已 promote 團核必付兩端對齊

在 repo 根建臨時探針(跑完即刪,不進 git):

```bash
cat > .probe-checkout-verify.mts <<'EOF'
/** checkout-verify 必付兩端比對探針(runbook-flag-enable.md;跑完即刪,不進 git) */
import { getProductTravelDetail } from "./server/suppliers/uvClient";
import { parseUvPriceTerms } from "./server/services/supplierSync/uvDetail";

const [tourId, productCode] = process.argv.slice(2);
if (!tourId || !productCode) {
  console.error("usage: npx tsx .probe-checkout-verify.mts <tourId> <productCode>");
  process.exit(2);
}

// 展示端 = 客人頁實際渲染的資料(prod 公開 API tours.getSupplierDetail)
const url =
  "https://packgoplay.com/api/trpc/tours.getSupplierDetail?input=" +
  encodeURIComponent(JSON.stringify({ json: { tourId: Number(tourId) } }));
const resp = await fetch(url);
const body: any = await resp.json();
const parsed = body?.result?.data?.json?.priceTerms?.parsed;
const displayed: string[] = (parsed?.excluded ?? []).filter((s: string) => s.startsWith("必付:"));

// live 端 = verifyTourCheckout 用的同一把尺(同 uvClient + 同 parseUvPriceTerms)
const travel = await getProductTravelDetail(productCode);
const live = (parseUvPriceTerms(travel)?.excluded ?? []).filter((s) => s.startsWith("必付:"));

const aligned =
  displayed.length === live.length && displayed.every((s) => live.includes(s));
console.log(JSON.stringify({ tourId: Number(tourId), productCode, displayed, live, aligned }, null, 2));
process.exit(aligned ? 0 : 1);
EOF
npx tsx .probe-checkout-verify.mts <tourId> <productCode>   # aligned:true / exit 0 = 過
rm .probe-checkout-verify.mts
```

tourId 與 productCode 從團頁 URL / admin 取(productCode = sourceUrl 的
`/detail/<code>`)。`aligned: false`(exit 1)= 該團 stored 是舊格式或供應商
剛改了必付 → 先重跑該團 enrich(skipSync:false)再驗,全過才准開旗標。

判讀:這支探針的兩端與 verifyTourCheckout (c-3) 的兩端逐字同源
(展示端 = getSupplierDetail 渲染資料;live 端 = 同 uvClient + 同 parser),
探針 aligned = 結帳時 mandatoryFees 檢查會過。

## 實跑紀錄(2026-07-11,建 runbook 時的首輪抽測,本機對 prod)

| tourId | productCode | displayed | live | aligned |
|--------|-------------|-----------|------|---------|
| 2 | P00008667 | 0 條 | 0 條 | true |
| 8 | P00008673 | 0 條 | 0 條 | true |
| 11 | P00008653 | 1 條(TF1 Mandatory Fee: Niagara In-Depth Tour — Everyone USD$30.00 / CAD$40.00) | 同一條逐字相同 | true |

三團全過(含一團帶真必付)—— 探針機制與現行已上架團的兩端格式皆已驗證。
全量 475 開旗標前,照本 runbook 對「該波新 promote 的團」再抽 1-2 個跑一輪。

## 開旗標步驟

1. 前置一、二全過。
2. `flyctl secrets set TOUR_INSTANT_CHECKOUT_ENABLED=true -a packgo-travel`(隨下次部署生效;flag 讀 process.env,無熱切換 —— 刻意,錢的行為不允許 mid-run 翻轉)。
3. 開啟後 24h 看結構化 log:`fly logs | grep checkout_verification`,核 outcome 分佈與 reason 都符合預期(mandatory_fees_changed 異常升高 = stored 格式漂移,回前置一)。
