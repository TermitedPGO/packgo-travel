#!/usr/bin/env node
/**
 * uv-lang-compare — 縱橫(UV / Universal Vision, Ctrip SOA2)語言對照抽樣。
 *
 * 起因(2026-08-04,Jeff):「之前 import 有些團只有純英文,那不是我想要的」。
 * 根因已定位:server/suppliers/uvClient.ts 四處把語言寫死成 3(英文)——
 * L49 COMMON_HEADERS.languageCode、L165 listProducts、L204 getProductMain、
 * L221 getProductTravelDetail。UV 自己支援 1=zh-CN / 2=zh-TW / 3=en,
 * 我們從來沒跟人家要過中文。
 *
 * 本腳本在「改任何正式程式之前」先取事實:同一批團各抓一次 en 與 zh-TW,
 * 逐欄位並排,並回答三個問題:
 *
 *   Q1 中文到底拿不拿得到?     → 每欄位算 CJK 字元比例(不是「有回應」就算有中文)
 *   Q2 拿到的是繁體還是簡體?   → 簡體專用字偵測(Jeff 要的是繁體)
 *   Q3 幾成的團中文是齊的?     → 逐團逐區塊填充率統計
 *
 * ⚠ 供應商回 200 不代表有中文。UV 的中文欄位常是空的、或直接退回英文原文,
 *   所以「requested zh-TW」與「actually got Chinese」必須分開量測——這是本
 *   腳本存在的唯一理由,不要簡化掉。
 *
 * 只讀。不連資料庫、不寫任何一列、不碰線上。可安全重複執行。
 *
 * 用法(在有對外網路的機器上跑,例如 Jeff 本機):
 *   node scripts/uv-lang-compare.mjs                    # 抽 10 團
 *   node scripts/uv-lang-compare.mjs --count=20
 *   node scripts/uv-lang-compare.mjs --codes=P00008687,P00002885
 *   node scripts/uv-lang-compare.mjs --out=/tmp/uv-lang
 *
 * 產出:
 *   <out>/uv-lang-compare.html   並排對照報告(瀏覽器打開看)
 *   <out>/uv-lang-compare.json   原始逐欄位資料(給後續判讀/存證)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/* ─────────────────────────── SOA2 客戶端(內聯) ───────────────────────────
 * 刻意不 import server/suppliers/uvClient.ts:那支寫死英文,而且會把 DB 相依
 * 一起拖進來。本腳本要能在沒有 DATABASE_URL 的機器上裸跑。
 * 請求格式與 uvClient.ts 逐欄位一致(GUEST_USER / branchcode / SOA2 envelope)。
 */

const SOA2_BASE = "https://online.ctrip.com/restapi/soa2";
const UV_BRANCH_CODE = "B00000003";

const GUEST_USER = {
  branchcode: UV_BRANCH_CODE,
  upBranchCode: UV_BRANCH_CODE,
  userCode: "U000000",
  userName: "GUEST",
  systemCode: 0,
};

/** UV 語言碼。名稱用在報告標題,acceptLanguage 一併切換避免伺服器端二次猜測。 */
const LANGS = {
  en: { code: "3", num: 3, label: "英文 (en)", acceptLanguage: "en-US,en;q=0.9" },
  zhTW: { code: "2", num: 2, label: "繁中 (zh-TW)", acceptLanguage: "zh-TW,zh;q=0.9" },
  zhCN: { code: "1", num: 1, label: "簡中 (zh-CN)", acceptLanguage: "zh-CN,zh;q=0.9" },
};

const DEFAULT_TIMEOUT_MS = 60_000;

function headersFor(lang) {
  return {
    "Content-Type": "application/json",
    branchcode: UV_BRANCH_CODE,
    languageCode: lang.code,
    "X-Requested-With": "XMLHttpRequest",
    Origin: "https://uvbookings.toursbms.com",
    Referer: "https://uvbookings.toursbms.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": lang.acceptLanguage,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callSoa(serviceId, endpoint, body, lang) {
  const url = `${SOA2_BASE}/${serviceId}/${endpoint}.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: headersFor(lang),
      body: JSON.stringify({ requestUser: GUEST_USER, ...body }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`[uv ${endpoint} ${lang.code}] network: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`[uv ${endpoint} ${lang.code}] HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.responseResult?.code !== 200) {
    throw new Error(
      `[uv ${endpoint} ${lang.code}] responseResult ${data?.responseResult?.code} ` +
        `${data?.responseResult?.msg ?? ""}`
    );
  }
  return data.responseData;
}

const listProducts = (page, pageSize, lang) =>
  callSoa(
    17626,
    "getPagerProductTemp",
    {
      keywords: "",
      currencyCode: "CI00000002",
      productOrderBy: 1,
      productLanguage: lang.num,
      status: 200,
      pager: { pageIndex: page, pageSize },
      departCountryCode: "",
      departCityCode: "",
      leaveCode: "",
      destinationCode: "",
      productType: "",
      tagIds: "",
      tripDays: "",
      beginTripDay: -1,
      endTripDay: -1,
      beginGroupPrice: -1,
      endGroupPrice: -1,
      beginGroupDate: "",
      endGroupDate: "",
      productTransfer: "",
      productForm: "",
      confirmType: "",
    },
    lang
  );

const getProductMain = (productCode, lang) =>
  callSoa(17626, "getProductMain", { productCode, productLanguage: lang.num }, lang);

const getProductTravelDetail = (productCode, lang) =>
  callSoa(
    17626,
    "getProductTravelDetail",
    { productCode, productLanguage: lang.num },
    lang
  );

/* ───────────────────────────── 語言偵測 ─────────────────────────────
 * 這一段是本腳本的判斷核心。「拿到回應」與「拿到中文」是兩件事。
 */

/** 中日韓統一表意文字。不含全形標點——標點在中英文件裡都會出現,會灌水。 */
const CJK_RE = /[一-鿿㐀-䶿]/g;
const LATIN_RE = /[A-Za-z]/g;

/**
 * 簡繁配對表。偶數位=簡體,奇數位=其對應繁體,由結構保證兩表對齊
 * (先前寫成兩條各自手打的字串,長度一旦對不上就會靜默誤判)。
 *
 * 收字原則,兩條都必須成立:
 *   1. 簡繁「不同形」——同形字(台/里/面/只)無鑑別力,收了只會製造雜訊。
 *   2. 簡體那個字在繁體正字法中「不是獨立常用字」——否則會假陽性。
 *      例:游(游泳)、后(皇后)、划(划船)、谷(山谷)在繁體都是常用字,
 *      出現不代表簡體,故一律不收。
 *
 * 目的是偵測不是轉換,不需要完備;但必須涵蓋旅遊文本高頻字,否則會像
 * 初版那樣漏掉「出发/全额」這種最常見的退改政策用語。
 */
const SIMP_TRAD_PAIRS =
  "们們这這个個时時会會说說关關边邊门門车車马馬国國华華单單双雙亚亞欧歐岛島湾灣应應该該无無现現电電龙龍风風飞飛机機场場观觀览覽园園汉漢议議价價费費择擇铁鐵银銀钟鐘长長专專业業务務东東乐樂买買卖賣亲親历歷带帶处處备備复復员員图圖书書温溫区區线線点點热熱岭嶺峡峽馆館剧劇钱錢铜銅铝鋁钢鋼轮輪艺藝术術发發达達过過还還进進运運连連远遠适適选選间間阳陽险險预預订訂证證额額优優传傳广廣厅廳岁歲汤湯汇匯灯燈爱愛独獨狮獅环環画畫离離简簡红紅级級组組经經统統绿綠网網罗羅联聯胜勝节節苏蘇药藥营營装裝见見规規视視计計认認让讓记記讲講许許设設语語请請读讀调調财財货貨质質贴貼资資赛賽转轉载載邮郵队隊阶階陆陸难難韩韓顶頂项項领領饭飯鸡雞鲜鮮学學实實宝寶当當录錄总總战戰护護报報数數旧舊来來标標树樹桥橋检檢楼樓欢歡洁潔济濟满滿滨濱灵靈烧燒种種称稱竞競笔筆类類纪紀纯純纳納终終绍紹绝絕继繼续續维維缆纜脑腦荣榮获獲补補觉覺论論访訪评評识識试試详詳误誤谈談谢謝责責败敗赏賞赠贈赶趕软軟较較辆輛迟遲递遞邻鄰闭閉问問闲閒闻聞阁閣际際陈陳雾霧静靜页頁顺順须須频頻颜顏饰飾驾駕验驗鱼魚鸟鳥龟龜为為与與从從众眾儿兒内內";

const SIMPLIFIED_ONLY = new Set();
const TRADITIONAL_ONLY = new Set();
for (let i = 0; i < SIMP_TRAD_PAIRS.length; i += 2) {
  SIMPLIFIED_ONLY.add(SIMP_TRAD_PAIRS[i]);
  TRADITIONAL_ONLY.add(SIMP_TRAD_PAIRS[i + 1]);
}

/**
 * 判讀一段文字。回傳的每個欄位都是給人看的結論,不是原始計數。
 *   cjk / latin  — 字元數
 *   cjkRatio     — CJK 佔「CJK + 拉丁字母」的比例。0 = 純英文,1 = 純中文
 *   verdict      — empty / chinese / english / mixed
 *   script       — traditional / simplified / mixed / n-a
 */
function analyzeText(text) {
  const s = typeof text === "string" ? text.trim() : "";
  if (!s) return { chars: 0, cjk: 0, latin: 0, cjkRatio: 0, verdict: "empty", script: "n-a" };

  const cjk = (s.match(CJK_RE) ?? []).length;
  const latin = (s.match(LATIN_RE) ?? []).length;
  const denom = cjk + latin;
  const cjkRatio = denom === 0 ? 0 : cjk / denom;

  let verdict;
  if (cjk === 0) verdict = "english";
  else if (cjkRatio >= 0.7) verdict = "chinese";
  else verdict = "mixed";

  let simp = 0;
  let trad = 0;
  for (const ch of s) {
    if (SIMPLIFIED_ONLY.has(ch)) simp++;
    else if (TRADITIONAL_ONLY.has(ch)) trad++;
  }
  let script = "n-a";
  if (cjk > 0) {
    if (simp > 0 && trad > 0) script = "mixed";
    else if (simp > 0) script = "simplified";
    else if (trad > 0) script = "traditional";
    else script = "undetermined"; // 有中文但沒命中取樣字,無法判定簡繁
  }

  return { chars: s.length, cjk, latin, cjkRatio: Number(cjkRatio.toFixed(3)), verdict, script, simp, trad };
}

/* ─────────────────────────── 欄位抽取 ───────────────────────────
 * 抽取邏輯對齊 server/services/supplierSync/uvDetail.ts,這樣報告看到的
 * 就是「真的會寫進我們 DB 的那些字」,而不是另一組平行宇宙的欄位。
 */

const stripHtml = (v) =>
  typeof v === "string"
    ? v
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+\n/g, "\n")
        .trim()
    : "";

/** 逐日行程標題:productTravel...dayList[].content 裡 contentType===100 的 relatedName。 */
function extractDayTitles(travel) {
  const pt = travel?.productTravel;
  const infoList = Array.isArray(pt?.productTravelInfoList) ? pt.productTravelInfoList : [];
  const dayList = infoList.flatMap((i) => (Array.isArray(i?.dayList) ? i.dayList : []));
  const sorted = [...dayList].sort(
    (a, b) => (Number(a?.dayNumber) || 0) - (Number(b?.dayNumber) || 0)
  );
  return sorted.map((d, idx) => {
    const blocks = Array.isArray(d?.content) ? d.content : [];
    const meta = blocks.find((b) => String(b?.contentType) === "100");
    const title = typeof meta?.relatedName === "string" ? meta.relatedName.trim() : "";
    return {
      dayNumber: Number(d?.dayNumber) || idx + 1,
      title: title || (typeof d?.section === "string" ? d.section.trim() : ""),
    };
  });
}

/** 注意事項 / 費用包含:productNotice.noticeInfo[]。 */
function extractNotices(travel) {
  const noticeInfo = Array.isArray(travel?.productNotice?.noticeInfo)
    ? travel.productNotice.noticeInfo
    : [];
  return noticeInfo.map((n) => ({
    name: typeof n?.matterName === "string" ? n.matterName.trim() : "",
    body: stripHtml(n?.vluesTip1) || stripHtml(n?.vluesTip2),
    noticeType: String(n?.noticeType ?? ""),
  }));
}

/** 自費 / 必付項目:productCost.list[]。 */
function extractCostItems(travel) {
  const list = Array.isArray(travel?.productCost?.list) ? travel.productCost.list : [];
  return list.map((c) => ({
    name:
      typeof c?.costName === "string"
        ? c.costName.trim()
        : typeof c?.name === "string"
          ? c.name.trim()
          : "",
  }));
}

/**
 * 把一個團在某語言下的所有可比欄位攤平成 [{區塊, 欄位, 文字}]。
 * 攤平後才能逐欄位跟另一語言對位比較,並統計填充率。
 */
function flattenTour(main, travel) {
  const rows = [];
  rows.push({ section: "團名", key: "productName", text: main?.productName ?? "" });

  for (const d of extractDayTitles(travel)) {
    rows.push({ section: "逐日行程", key: `Day ${d.dayNumber}`, text: d.title });
  }
  const notices = extractNotices(travel);
  notices.forEach((n, i) => {
    rows.push({
      section: n.noticeType === "0" ? "費用包含" : "注意事項",
      key: n.name || `#${i + 1}`,
      text: [n.name, n.body].filter(Boolean).join("\n"),
    });
  });
  for (const c of extractCostItems(travel)) {
    if (c.name) rows.push({ section: "自費/必付", key: c.name, text: c.name });
  }
  return rows;
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

/**
 * 解析整數參數。刻意不用 `parseInt(v) || fallback`——`v="0"` 時 parseInt 回 0,
 * 0 是 falsy,`||` 會吃掉它退回 fallback(featureFlags.ts 已記錄過的同款陷阱)。
 * 這裡把「無法解析」與「解析出的值超出範圍」分開處理:
 *   無法解析 → 退回預設值;可解析但太小 → 夾到下限。
 */
function parseIntArg(v, fallback, min) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

function parseArgs(argv) {
  const out = { count: 10, out: null, codes: null, page: 1 };
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "count") out.count = parseIntArg(v, 10, 1);
    else if (k === "page") out.page = parseIntArg(v, 1, 1);
    else if (k === "out") out.out = v;
    else if (k === "codes") out.codes = v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const outDir = resolve(args.out ?? join(process.cwd(), "uv-lang-compare-out"));
  mkdirSync(outDir, { recursive: true });

  console.log("縱橫 (UV) 語言對照抽樣 — 只讀,不碰資料庫\n");

  // 名錄用英文抓:證實已知可用的路徑,避免名錄本身就因語言參數失敗而中斷,
  // 讓「中文拿不到」與「連線失敗」兩種原因不會混在一起。
  let codes = args.codes;
  let listItems = [];
  if (!codes) {
    console.log(`抓產品名錄 (page=${args.page}, size=${args.count})...`);
    const listEn = await listProducts(args.page, args.count, LANGS.en);
    listItems = Array.isArray(listEn?.list) ? listEn.list : [];
    codes = listItems.map((i) => i.productCode).filter(Boolean).slice(0, args.count);
    console.log(`名錄共 ${listEn?.pager?.totalCount ?? "?"} 個產品,本次取 ${codes.length} 個\n`);
  } else {
    console.log(`使用指定產品碼 ${codes.length} 個\n`);
  }

  if (codes.length === 0) {
    console.error("名錄為空,沒有可比對的產品。中止。");
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const [idx, code] of codes.entries()) {
    process.stdout.write(`[${idx + 1}/${codes.length}] ${code} ... `);
    const entry = { productCode: code, langs: {}, errors: [] };

    for (const [langKey, lang] of Object.entries({ en: LANGS.en, zhTW: LANGS.zhTW })) {
      try {
        const main = await getProductMain(code, lang);
        await sleep(200 + Math.floor(Math.random() * 300)); // 對供應商客氣一點
        const travel = await getProductTravelDetail(code, lang);
        entry.langs[langKey] = { main, rows: flattenTour(main, travel) };
      } catch (err) {
        entry.errors.push(`${langKey}: ${err?.message ?? err}`);
        entry.langs[langKey] = { main: null, rows: [] };
      }
      await sleep(200 + Math.floor(Math.random() * 300));
    }

    // 以 zh-TW 的欄位為基準判讀(我們想要的語言),en 只當對照組。
    const zhRows = entry.langs.zhTW?.rows ?? [];
    const analyzed = zhRows.map((r) => ({ ...r, analysis: analyzeText(r.text) }));
    entry.analyzed = analyzed;
    entry.summary = summarize(analyzed);

    console.log(
      entry.errors.length
        ? `錯誤 (${entry.errors.length})`
        : `欄位 ${analyzed.length},中文 ${entry.summary.chinesePct}%,` +
            `簡體 ${entry.summary.simplifiedCount}`
    );
    results.push(entry);
  }

  const overall = summarize(results.flatMap((r) => r.analyzed ?? []));

  const jsonPath = join(outDir, "uv-lang-compare.json");
  writeFileSync(
    jsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), codes, overall, results }, null, 2)
  );

  const htmlPath = join(outDir, "uv-lang-compare.html");
  writeFileSync(htmlPath, renderHtml(results, overall));

  console.log("\n──────── 總結 ────────");
  console.log(`可比欄位總數      ${overall.total}`);
  console.log(`繁中要到中文      ${overall.chinesePct}%  (${overall.chinese} 欄)`);
  console.log(`仍是英文          ${overall.englishPct}%  (${overall.english} 欄)`);
  console.log(`中英混排          ${overall.mixedPct}%  (${overall.mixed} 欄)`);
  console.log(`空白              ${overall.emptyPct}%  (${overall.empty} 欄)`);
  console.log(`簡體字命中        ${overall.simplifiedCount} 欄  (要繁體,這些是問題)`);
  console.log(`繁體字命中        ${overall.traditionalCount} 欄`);
  console.log(`\nHTML 對照報告  ${htmlPath}`);
  console.log(`原始資料       ${jsonPath}`);
}

function summarize(rows) {
  const total = rows.length;
  const pct = (n) => (total === 0 ? 0 : Number(((n / total) * 100).toFixed(1)));
  const by = (v) => rows.filter((r) => r.analysis?.verdict === v).length;
  const chinese = by("chinese");
  const english = by("english");
  const mixed = by("mixed");
  const empty = by("empty");
  return {
    total,
    chinese,
    english,
    mixed,
    empty,
    chinesePct: pct(chinese),
    englishPct: pct(english),
    mixedPct: pct(mixed),
    emptyPct: pct(empty),
    simplifiedCount: rows.filter((r) => r.analysis?.script === "simplified").length,
    traditionalCount: rows.filter((r) => r.analysis?.script === "traditional").length,
    scriptMixedCount: rows.filter((r) => r.analysis?.script === "mixed").length,
  };
}

/* ─────────────────────────── HTML 報告 ─────────────────────────── */

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const VERDICT_LABEL = {
  chinese: "中文",
  english: "英文",
  mixed: "中英混",
  empty: "空白",
};

function renderHtml(results, overall) {
  const rows = results
    .map((r) => {
      const enRows = r.langs?.en?.rows ?? [];
      const zhRows = r.langs?.zhTW?.rows ?? [];
      // 以 zh-TW 的欄位順序為主軸,用 section+key 對位找 en 的同一欄。
      const enIndex = new Map(enRows.map((x) => [`${x.section}||${x.key}`, x.text]));
      const name =
        r.langs?.zhTW?.main?.productName || r.langs?.en?.main?.productName || r.productCode;

      const body = zhRows
        .map((zr) => {
          const a = analyzeText(zr.text);
          const en = enIndex.get(`${zr.section}||${zr.key}`) ?? "";
          const flag =
            a.script === "simplified"
              ? '<span class="tag tag-warn">簡體</span>'
              : a.script === "mixed"
                ? '<span class="tag tag-warn">簡繁混</span>'
                : "";
          return `<tr>
  <td class="c-sec">${esc(zr.section)}</td>
  <td class="c-key">${esc(zr.key)}</td>
  <td class="c-txt">${esc(en) || '<span class="muted">(空)</span>'}</td>
  <td class="c-txt">${esc(zr.text) || '<span class="muted">(空)</span>'}</td>
  <td class="c-ver"><span class="tag tag-${a.verdict}">${VERDICT_LABEL[a.verdict] ?? a.verdict}</span>${flag}</td>
</tr>`;
        })
        .join("\n");

      const errs = r.errors?.length
        ? `<div class="errs">抓取錯誤:${r.errors.map(esc).join(" / ")}</div>`
        : "";

      return `<section class="tour">
  <header>
    <h2>${esc(name)}</h2>
    <div class="meta"><code>${esc(r.productCode)}</code>
      欄位 ${r.summary?.total ?? 0} ·
      中文 ${r.summary?.chinesePct ?? 0}% ·
      英文 ${r.summary?.englishPct ?? 0}% ·
      簡體 ${r.summary?.simplifiedCount ?? 0}</div>
  </header>
  ${errs}
  <table>
    <thead><tr><th>區塊</th><th>欄位</th><th>${esc(LANGS.en.label)}</th><th>${esc(LANGS.zhTW.label)}</th><th>判讀</th></tr></thead>
    <tbody>${body || '<tr><td colspan="5" class="muted">無可比欄位</td></tr>'}</tbody>
  </table>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>縱橫語言對照 — ${results.length} 團抽樣</title>
<style>
  :root{--bg:#f7f7f5;--card:#fff;--ink:#1c1c1a;--muted:#77776f;--line:#e5e5e0;
        --ok:#1b7f4f;--warn:#a8600a;--bad:#a12b2b;--accent:#1f3a5f}
  @media (prefers-color-scheme:dark){
    :root{--bg:#17171a;--card:#202024;--ink:#ececea;--muted:#9a9a94;--line:#33333a;
          --ok:#4fbb85;--warn:#d9973f;--bad:#e0736f;--accent:#8fb3dd}}
  *{box-sizing:border-box}
  body{margin:0;padding:32px 20px;background:var(--bg);color:var(--ink);
       font:15px/1.6 -apple-system,"PingFang TC","Noto Sans TC",Segoe UI,sans-serif}
  .wrap{max-width:1240px;margin:0 auto}
  h1{font-size:24px;margin:0 0 6px}
  .sub{color:var(--muted);margin:0 0 24px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:32px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .card .n{font-size:26px;font-weight:600;letter-spacing:-.02em}
  .card .l{color:var(--muted);font-size:13px;margin-top:2px}
  .tour{background:var(--card);border:1px solid var(--line);border-radius:16px;
        padding:18px 20px;margin-bottom:20px;overflow:hidden}
  .tour h2{font-size:17px;margin:0 0 4px}
  .meta{color:var(--muted);font-size:13px;margin-bottom:12px}
  .meta code{background:var(--bg);border-radius:6px;padding:1px 6px}
  .errs{color:var(--bad);font-size:13px;margin-bottom:10px}
  .tblwrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13.5px;table-layout:fixed}
  th,td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid var(--line)}
  th{color:var(--muted);font-weight:500;font-size:12.5px;border-top:none}
  .c-sec{width:88px;color:var(--muted);white-space:nowrap}
  .c-key{width:130px;color:var(--muted);word-break:break-word}
  .c-txt{white-space:pre-wrap;word-break:break-word}
  .c-ver{width:104px;white-space:nowrap}
  .muted{color:var(--muted)}
  .tag{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;
       border:1px solid currentColor;margin-right:4px}
  .tag-chinese{color:var(--ok)} .tag-english{color:var(--bad)}
  .tag-mixed{color:var(--warn)} .tag-empty{color:var(--muted)}
  .tag-warn{color:var(--warn)}
</style></head><body><div class="wrap">
<h1>縱橫 (UV) 語言對照抽樣</h1>
<p class="sub">同一批團各抓一次英文與繁中,逐欄位並排。判讀欄看的是「實際拿到什麼」,不是「要了什麼」。<br>
產生時間 ${esc(new Date().toISOString())} · 抽樣 ${results.length} 團</p>
<div class="cards">
  <div class="card"><div class="n">${overall.total}</div><div class="l">可比欄位</div></div>
  <div class="card"><div class="n" style="color:var(--ok)">${overall.chinesePct}%</div><div class="l">要到中文</div></div>
  <div class="card"><div class="n" style="color:var(--bad)">${overall.englishPct}%</div><div class="l">仍是英文</div></div>
  <div class="card"><div class="n" style="color:var(--warn)">${overall.mixedPct}%</div><div class="l">中英混排</div></div>
  <div class="card"><div class="n">${overall.emptyPct}%</div><div class="l">空白</div></div>
  <div class="card"><div class="n" style="color:var(--warn)">${overall.simplifiedCount}</div><div class="l">簡體欄位</div></div>
</div>
${rows}
</div></body></html>`;
}

/* ─────────────────────────── 導出 + 進入點 ───────────────────────────
 * 純函式導出給 uv-lang-compare.test.mjs。main() 只在「直接執行本檔」時跑,
 * 否則 import 這支做單元測試會真的去打供應商 API(對外部系統的副作用)。
 */
export {
  analyzeText,
  extractDayTitles,
  extractNotices,
  extractCostItems,
  flattenTour,
  summarize,
  renderHtml,
  stripHtml,
  parseArgs,
  SIMP_TRAD_PAIRS,
  SIMPLIFIED_ONLY,
  TRADITIONAL_ONLY,
};

const isDirectRun =
  process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;

if (isDirectRun) {
  main().catch((err) => {
    console.error("\n失敗:", err?.message ?? err);
    process.exitCode = 1;
  });
}
