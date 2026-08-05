/**
 * uv-lang-compare 純函式測試。
 *
 * 用 node:test(同 safe-deploy.test.mjs 慣例),因為受測檔是 scripts/ 下的
 * 獨立 .mjs,不進 vite/vitest 的 TS 解析圈。
 *
 * 重點不在「函式有沒有回傳東西」,而在本腳本存在的理由:
 * 分辨「要了中文」與「真的拿到中文」。所以測試以判讀正確性為主。
 *
 * 執行:node --test scripts/uv-lang-compare.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
} from "./uv-lang-compare.mjs";

/* ───────────────────── 簡繁字表本身的不變量 ─────────────────────
 * 字表若靜默失衡(長度奇數、簡繁欄互相污染),判讀會整片錯而不報錯。
 * 這幾條是字表的結構鎖,不是行為測試。
 */

test("字表:配對長度為偶數,簡繁一一對應", () => {
  assert.equal(SIMP_TRAD_PAIRS.length % 2, 0, "配對字串長度必須是偶數");
  assert.equal(SIMPLIFIED_ONLY.size, TRADITIONAL_ONLY.size);
});

test("字表:簡繁兩集合不得有交集(有交集代表配對打錯位)", () => {
  const overlap = [...SIMPLIFIED_ONLY].filter((c) => TRADITIONAL_ONLY.has(c));
  assert.deepEqual(overlap, [], `重疊字:${overlap.join("")}`);
});

test("字表:不得收錄繁體常用同形字(假陽性來源)", () => {
  // 這些字在繁體正字法中都是獨立常用字,收進簡體表會讓純繁中內容被誤判成簡體
  for (const ch of "游后划谷台里面只干云制表") {
    assert.ok(!SIMPLIFIED_ONLY.has(ch), `「${ch}」不該在簡體表`);
  }
});

test("字表:涵蓋旅遊文本高頻簡體字(初版漏掉 发/额 的回歸鎖)", () => {
  for (const ch of "发额达过还进运连远选间预订证") {
    assert.ok(SIMPLIFIED_ONLY.has(ch), `「${ch}」應在簡體表`);
  }
});

/* ───────────────────────── analyzeText:判讀核心 ───────────────────────── */

test("analyzeText:純英文判 english,CJK 比例 0", () => {
  const a = analyzeText("Day 1 San Francisco to Yosemite National Park");
  assert.equal(a.verdict, "english");
  assert.equal(a.cjk, 0);
  assert.equal(a.cjkRatio, 0);
  assert.equal(a.script, "n-a");
});

test("analyzeText:純繁中判 chinese + traditional", () => {
  const a = analyzeText("第一天 舊金山出發前往優勝美地國家公園,沿途風景壯麗");
  assert.equal(a.verdict, "chinese");
  assert.equal(a.script, "traditional");
  assert.ok(a.cjkRatio > 0.9, `cjkRatio 應接近 1,實得 ${a.cjkRatio}`);
});

test("analyzeText:簡體要被抓出來(Jeff 要的是繁體)", () => {
  const a = analyzeText("第一天 旧金山出发前往优胜美地国家公园,沿途风景壮丽");
  assert.equal(a.verdict, "chinese");
  assert.equal(a.script, "simplified");
});

test("analyzeText:簡繁混排判 mixed — 供應商資料本身髒的情況", () => {
  const a = analyzeText("國家公园 观光行程");
  assert.equal(a.script, "mixed");
});

test("analyzeText:空字串與空白判 empty,不是 english", () => {
  for (const v of ["", "   ", "\n\t", null, undefined]) {
    assert.equal(analyzeText(v).verdict, "empty", `輸入 ${JSON.stringify(v)}`);
  }
});

test("analyzeText:中英混排判 mixed,不冒充 chinese", () => {
  // 地名保留英文是常見的,但整段仍以英文為主 → 不能算「拿到中文」
  const a = analyzeText("Yosemite National Park 國家公園 is one of the most visited parks in California USA");
  assert.equal(a.verdict, "mixed");
  assert.ok(a.cjkRatio < 0.7, `混排 cjkRatio 應 < 0.7,實得 ${a.cjkRatio}`);
});

test("analyzeText:標點不灌水 CJK 比例", () => {
  // 全形標點若被算進 CJK,這段純英文會被誤判成中文
  const a = analyzeText("Hotel check-in,breakfast included。");
  assert.equal(a.verdict, "english");
  assert.equal(a.cjk, 0);
});

/* ───────────────────────── 欄位抽取:對齊 uvDetail.ts ───────────────────────── */

const TRAVEL_FIXTURE = {
  productTravel: {
    productTravelInfoList: [
      {
        dayList: [
          // 故意亂序:uvDetail.ts 說 UV 回傳的 dayList 未排序
          {
            dayNumber: 2,
            section: "Yosemite|||1+++Fresno",
            content: [{ contentType: "100", relatedName: "優勝美地國家公園" }],
          },
          {
            dayNumber: 1,
            section: "San Francisco|||1",
            content: [{ contentType: "100", relatedName: "舊金山" }],
          },
        ],
      },
    ],
  },
  productNotice: {
    noticeInfo: [
      { matterName: "費用包含", noticeType: "0", vluesTip1: "<p>住宿<br/>門票</p>" },
      { matterName: "退改政策", noticeType: "3", vluesTip1: "出發前 30 天可全額退款" },
    ],
  },
  productCost: {
    list: [{ costName: "小費" }, { costName: "自費行程:直升機" }],
  },
};

test("extractDayTitles:依 dayNumber 排序,取 contentType 100 的 relatedName", () => {
  const days = extractDayTitles(TRAVEL_FIXTURE);
  assert.deepEqual(
    days.map((d) => [d.dayNumber, d.title]),
    [
      [1, "舊金山"],
      [2, "優勝美地國家公園"],
    ]
  );
});

test("extractDayTitles:結構缺失回空陣列,不丟例外", () => {
  for (const v of [{}, null, undefined, { productTravel: {} }, { productTravel: { productTravelInfoList: "x" } }]) {
    assert.deepEqual(extractDayTitles(v), []);
  }
});

test("extractNotices:保留 noticeType,HTML 被剝乾淨", () => {
  const n = extractNotices(TRAVEL_FIXTURE);
  assert.equal(n.length, 2);
  assert.equal(n[0].noticeType, "0");
  assert.equal(n[0].body, "住宿\n門票");
  assert.ok(!n[0].body.includes("<"), "HTML 標籤應已剝除");
});

test("extractCostItems:取 costName", () => {
  assert.deepEqual(
    extractCostItems(TRAVEL_FIXTURE).map((c) => c.name),
    ["小費", "自費行程:直升機"]
  );
});

test("stripHtml:<br> 轉換行,實體字元還原", () => {
  assert.equal(stripHtml("<p>A<br/>B&nbsp;C&amp;D</p>"), "A\nB C&D");
  assert.equal(stripHtml(null), "");
});

/* ───────────────────────── flatten + summarize ───────────────────────── */

test("flattenTour:團名 + 逐日 + 注意事項 + 自費,全部攤平且區塊標對", () => {
  const rows = flattenTour({ productName: "美西七日遊" }, TRAVEL_FIXTURE);
  const sections = [...new Set(rows.map((r) => r.section))];
  assert.deepEqual(sections, ["團名", "逐日行程", "費用包含", "注意事項", "自費/必付"]);
  assert.equal(rows[0].text, "美西七日遊");
  // noticeType 0 要歸到「費用包含」,不是「注意事項」
  assert.equal(rows.find((r) => r.key === "費用包含").section, "費用包含");
  assert.equal(rows.find((r) => r.key === "退改政策").section, "注意事項");
});

test("summarize:百分比正確,且中文/英文分開計", () => {
  const rows = [
    { analysis: analyzeText("舊金山出發前往優勝美地國家公園") },
    { analysis: analyzeText("優勝美地國家公園壯麗風景") },
    { analysis: analyzeText("San Francisco departure") },
    { analysis: analyzeText("") },
  ];
  const s = summarize(rows);
  assert.equal(s.total, 4);
  assert.equal(s.chinese, 2);
  assert.equal(s.english, 1);
  assert.equal(s.empty, 1);
  assert.equal(s.chinesePct, 50);
  assert.equal(s.traditionalCount, 2);
});

test("summarize:空輸入不除以零", () => {
  const s = summarize([]);
  assert.equal(s.total, 0);
  assert.equal(s.chinesePct, 0);
  assert.equal(s.englishPct, 0);
});

/* ───────────────────────── HTML 報告 ───────────────────────── */

test("renderHtml:產出完整 HTML,含兩語言欄位並排", () => {
  const results = [
    {
      productCode: "P00008687",
      langs: {
        en: { main: { productName: "US West 7 Days" }, rows: flattenTour({ productName: "US West 7 Days" }, TRAVEL_FIXTURE) },
        zhTW: { main: { productName: "美西七日遊" }, rows: flattenTour({ productName: "美西七日遊" }, TRAVEL_FIXTURE) },
      },
      errors: [],
      analyzed: [],
      summary: summarize([]),
    },
  ];
  const html = renderHtml(results, summarize([]));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("P00008687"));
  assert.ok(html.includes("美西七日遊"), "應含繁中團名");
  assert.ok(html.includes("US West 7 Days"), "應含英文團名供對照");
  assert.ok(html.includes("border-radius"), "設計紅線:可見元素需圓角");
});

test("renderHtml:跳脫 HTML,供應商字串不能注入標記", () => {
  const evil = '<script>alert(1)</script>';
  const results = [
    {
      productCode: evil,
      langs: {
        en: { main: { productName: evil }, rows: [] },
        zhTW: { main: { productName: evil }, rows: [{ section: "團名", key: "productName", text: evil }] },
      },
      errors: [],
      analyzed: [],
      summary: summarize([]),
    },
  ];
  const html = renderHtml(results, summarize([]));
  assert.ok(!html.includes("<script>alert(1)</script>"), "原始 script 標籤不得出現");
  assert.ok(html.includes("&lt;script&gt;"), "應已跳脫");
});

test("renderHtml:抓取錯誤要顯示,不得靜默吞掉", () => {
  const results = [
    {
      productCode: "P1",
      langs: { en: { main: null, rows: [] }, zhTW: { main: null, rows: [] } },
      errors: ["zhTW: HTTP 500"],
      analyzed: [],
      summary: summarize([]),
    },
  ];
  const html = renderHtml(results, summarize([]));
  assert.ok(html.includes("HTTP 500"), "錯誤訊息必須出現在報告上");
});

/* ───────────────────────── CLI 參數 ───────────────────────── */

test("parseArgs:預設與覆寫", () => {
  assert.equal(parseArgs(["node", "s"]).count, 10);
  assert.equal(parseArgs(["node", "s", "--count=25"]).count, 25);
  assert.deepEqual(parseArgs(["node", "s", "--codes=A, B ,C"]).codes, ["A", "B", "C"]);
  // 無效值退回預設,不產生 NaN
  assert.equal(parseArgs(["node", "s", "--count=abc"]).count, 10);
  assert.equal(parseArgs(["node", "s", "--count=0"]).count, 1);
});

/* ───────────────────── 直接執行(isDirectRun 回歸鎖) ─────────────────────
 * 2026-08-04 實機事故:Jeff 兩次執行都「零輸出、零錯誤、退出碼 0」,因為
 * 初版守衛用字串比對 import.meta.url 與 resolve(argv[1]),在兩種真實路徑
 * 下永遠不相等,main() 靜默不執行:
 *   1. 路徑含非 ASCII(repo 就在 ~/dev/網站)→ import.meta.url 百分號編碼
 *   2. 路徑經符號連結(macOS /tmp → /private/tmp)→ Node 解析真實路徑
 *
 * 單元測試驗不到這個 —— 必須真的用子行程從那兩種路徑跑一次。所以以下用
 * spawn,並以 stub fetch 讓它不依賴外網、跑得快且結果固定。
 */

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(THIS_DIR, "uv-lang-compare.mjs");

/** 假供應商:讓腳本完整跑完而不碰網路。 */
const STUB_SRC = `
const envelope = (responseData) => ({
  ResponseStatus: { Ack: "Success", Errors: [] },
  responseResult: { code: 200, msg: "ok", msgCode: "" },
  responseData,
});
globalThis.fetch = async (url, init) => {
  const lang = init?.headers?.languageCode;
  const name = lang === "2" ? "美西七日遊" : "US West 7 Days";
  let data;
  if (url.includes("getProductMain")) data = envelope({ productCode: "P1", productName: name });
  else if (url.includes("getProductTravelDetail")) data = envelope({ productTravel: {}, productNotice: {}, productCost: {} });
  else data = envelope({});
  return { ok: true, status: 200, json: async () => data };
};
`;

/** 從指定路徑跑腳本,回傳 stdout。exitCode 非 0 會拋。 */
function runScriptAt(scriptPath, outDir, cwd) {
  const stub = join(dirname(scriptPath), "stub.mjs");
  writeFileSync(stub, STUB_SRC);
  return execFileSync(
    process.execPath,
    ["--import", pathToFileUrlString(stub), scriptPath, "--codes=P1", `--out=${outDir}`],
    { cwd, encoding: "utf8", timeout: 60_000 }
  );
}

/** --import 需要 file:// URL;路徑含非 ASCII 時必須正確編碼。 */
function pathToFileUrlString(p) {
  return new URL(`file://${p.split("/").map(encodeURIComponent).join("/")}`).href;
}

test("直接執行:路徑含非 ASCII(中文)仍要執行 main", () => {
  const base = mkdtempSync(join(tmpdir(), "uvlang-"));
  const dir = join(base, "網站專案");           // ← 重現 ~/dev/網站
  mkdirSync(dir, { recursive: true });
  const copied = join(dir, "uv-lang-compare.mjs");
  copyFileSync(SCRIPT, copied);
  const outDir = join(base, "out-cjk");

  const stdout = runScriptAt(copied, outDir, base);

  assert.match(stdout, /縱橫 \(UV\) 語言對照抽樣/, "main() 必須執行並印出標頭");
  assert.match(stdout, /總結/, "必須跑到總結");
  const html = readFileSync(join(outDir, "uv-lang-compare.html"), "utf8");
  assert.match(html, /美西七日遊/, "報告要含繁中欄位");
});

test("直接執行:路徑經符號連結仍要執行 main", () => {
  const base = mkdtempSync(join(tmpdir(), "uvlang-"));
  const real = join(base, "real");
  mkdirSync(real, { recursive: true });
  const copied = join(real, "uv-lang-compare.mjs");
  copyFileSync(SCRIPT, copied);

  const link = join(base, "linked.mjs");
  symlinkSync(copied, link);                    // ← 重現 /tmp → /private/tmp
  const outDir = join(base, "out-link");

  const stdout = runScriptAt(copied, outDir, base);
  assert.match(stdout, /縱橫 \(UV\) 語言對照抽樣/, "副本本身要能跑");

  const viaLink = execFileSync(
    process.execPath,
    [
      "--import",
      pathToFileUrlString(join(real, "stub.mjs")),
      link,
      "--codes=P1",
      `--out=${join(base, "out-link2")}`,
    ],
    { cwd: base, encoding: "utf8", timeout: 60_000 }
  );
  assert.match(viaLink, /縱橫 \(UV\) 語言對照抽樣/, "經符號連結執行也必須跑 main");
});
