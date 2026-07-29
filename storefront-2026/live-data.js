/*
  live-data.js — 把設計原型接上真實行程資料(2026-07-28 起)

  這支是新網站的真資料接線。設計原型本來所有行程都是寫死的樣本;這裡改成
  開站時去打現行後端的公開端點,把回來的真行程換進 BC_TOURS,再重新渲染。

  刻意只做這一件事:
    - 不改 bc.js 的任何渲染邏輯,只換它吃的資料
    - 不碰登入、下單、付款(那些是碰錢的,另外走)
    - 抓不到資料時安靜留在原本的樣本上,不讓首頁開天窗

  誠實邊界(2026-07-28 現況):
    - 貨架需要的欄位(班期、回程、狀態、餘位、機票、價格、標題)已接真資料
    - 行程詳情頁需要的逐日行程、費用明細、飯店與取消條款尚未接,詳情頁目前
      仍是設計樣本。真行程點進詳情會看到空的區塊,這是已知狀態不是壞掉。
*/
(function () {
  "use strict";

  var API_BASE = window.PACKGO_API_BASE || ""; // 空字串 = 同源。本機由 dev-server.mjs 代理
  var PAGE_SIZE = 12;

  // ── 機票含不含:唯一誠實來源是 costExplanation ───────────────────────────
  //
  // 這段邏輯是從舊庫 client/src/pages/TourDetailPeony/actionArea.helpers.ts
  // 原樣搬過來的,含 2026-07-11 驗收回令 P2 的否定詞守門。不重寫的理由:那裡面
  // 是踩過的坑 —— 供應商會把「機票自理」塞進 included 陣列,舊碼讀成含機票,
  // 等於把排除句翻成最貴的過度承諾。
  var FLIGHT_RE = /機票|機位|air\s?fare|flights?/i;
  var COST_NEGATION_TERMS = [
    "不含", "不包括", "不包含", "未含", "未包含", "除外", "自理", "自費",
    "另付", "另計", "另行", "恕不",
    "not included", "not covered", "excluded", "excludes", "exclusion",
    "at your own", "own expense", "optional",
  ];

  function asStringArray(v) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }) : [];
  }
  /** 長篇費用說明牆:裡面同時寫了含與不含,拿它當訊號會反著騙客人。 */
  function isCostWall(text) {
    if (typeof text !== "string") return false;
    var t = text.trim();
    if (!t) return false;
    if (/[\r\n]/.test(t)) return true;
    if (t.length > 60) return true;
    var breaks = t.match(/[。;；]|\.\s|,\s.*,\s/g);
    return (breaks ? breaks.length : 0) >= 2;
  }
  function hasCostNegation(text) {
    if (typeof text !== "string") return false;
    var t = text.toLowerCase();
    return COST_NEGATION_TERMS.some(function (term) { return t.indexOf(term) !== -1; });
  }
  /** 回 "included" / "excluded" / "unknown"。模稜兩可一律 unknown,不亂承諾。 */
  function deriveFlightInclusion(costExplanation) {
    var ce = costExplanation;
    if (typeof ce === "string") {
      try { ce = JSON.parse(ce); } catch (e) { ce = null; }
    }
    if (!ce || typeof ce !== "object") return "unknown";
    var itemized = function (v) {
      return asStringArray(v).filter(function (s) { return !isCostWall(s); });
    };
    if (itemized(ce.excluded).some(function (s) { return FLIGHT_RE.test(s); })) return "excluded";
    var includedFlight = itemized(ce.included).filter(function (s) { return FLIGHT_RE.test(s); });
    if (includedFlight.some(hasCostNegation)) return "excluded";
    if (includedFlight.length > 0) return "included";
    return "unknown";
  }

  // ── 標題 ────────────────────────────────────────────────────────────────
  //
  // 資料庫存的是供應商原始標題,長這樣:
  //   [Gold] Small Group Tour (No more than 6 people) | Madrid-based World
  //   Heritage Discovery Tour:Journey Through the Glory of the Golden Age 5-Day
  // 版面把等級、人數、天數、目的地都另外顯示了,標題再帶一次就變成一團。
  //
  // 這裡只做「移除已經在別處顯示過的部分」,不改寫、不重寫、不加字。
  // 真正的解法是資料庫加一個對客短標題欄位;在那之前這是誠實的顯示層整理。
  function cleanTitle(raw) {
    var t = String(raw || "").trim();
    t = t.replace(/^\[[^\]]*\]\s*/, "");                 // 去開頭的 [Gold] / [Silver]
    t = t.replace(/^[^|]*\|\s*/, "");                    // 去第一個 | 之前的規格前綴
    // 去結尾的天數:5-Day / 9 Days / (9 Days) / 【8日】 都是同一件事
    t = t.replace(/\s*[（(\[]?\s*[-–]?\s*\d+\s*[- ]?Day(s)?\s*(Tour)?\s*[)）\]]?\s*$/i, "");
    t = t.replace(/\s*\d+\s*天\s*$/, "");
    t = t.replace(/\s{2,}/g, " ").trim();
    t = t.replace(/[:：]\s*$/, "");
    return t || String(raw || "").trim();
  }

  function buildCode(row, index) {
    var c = String(row.destinationCity || row.destinationCountry || "")
      .replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
    return (c || "PG" + (index + 1)) + "-" + (row.duration || 0) + "D";
  }

  /* 地圖座標:後端這支端點沒有經緯度,先沿用原型的三組座標當佔位。
     地圖那頁之後另接,不在本批。 */
  var SAMPLE_GEO = [
    { region: "ES", lon: -3.7038, lat: 40.4168, x: 471.6, y: 131.4 },
    { region: "GB", lon: -0.1276, lat: 51.5072, x: 480.6, y: 108.9 },
    { region: "JP", lon: 139.6917, lat: 35.6895, x: 812.3, y: 143.6 },
  ];

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getUTCFullYear() + "." + p(d.getUTCMonth() + 1) + "." + p(d.getUTCDate());
  }

  /** 依真實班期給狀態文案。沒有班期就說沒有,不編一個「可報名」出來。 */
  function statusOf(dep) {
    if (!dep) return bcI18n("暫無公開班期", "No published departure", "Sin salida publicada");
    var left = (typeof dep.totalSlots === "number" && typeof dep.bookedSlots === "number")
      ? dep.totalSlots - dep.bookedSlots : null;
    if (dep.status === "full" || left === 0) return bcI18n("已額滿", "Full", "Completo");
    if (left !== null && left <= 4) return bcI18n("餘位不多", "Limited seats", "Últimas plazas");
    return bcI18n("開放報名", "Open", "Disponible");
  }

  function toBcTour(row, index, depMap) {
    var seed = SAMPLE_GEO[index % SAMPLE_GEO.length];
    var city = row.destinationCity || row.destinationCountry || "";
    var country = row.destinationCountry || "";
    var dep = depMap && depMap[row.id];
    var flight = deriveFlightInclusion(row.costExplanation);
    var left = dep && typeof dep.totalSlots === "number" && typeof dep.bookedSlots === "number"
      ? dep.totalSlots - dep.bookedSlots : null;
    var title = cleanTitle(row.title);

    return {
      id: row.id,
      code: buildCode(row, index),
      destination: bcI18n(
        country + (city ? "・" + city : ""),
        country + (city ? " · " + city : ""),
        country + (city ? " · " + city : ""),
      ),
      world: { city: bcI18n(city, city, city), region: seed.region, lon: seed.lon, lat: seed.lat, x: seed.x, y: seed.y },
      title: bcI18n(title, title, title),
      days: row.duration || 0,
      nights: row.nights || Math.max(0, (row.duration || 1) - 1),
      nextDate: fmtDate(dep && dep.departureDate),
      returnDate: fmtDate(dep && dep.returnDate),
      price: (dep && typeof dep.adultPrice === "number" ? dep.adultPrice : row.price) || 0,
      // 只有明確查得出「含」才寫 true。unknown 一律當不含,寧可少承諾。
      air: flight === "included",
      airKnown: flight !== "unknown",
      formed: !!dep && dep.status === "open",
      seats: left,
      status: statusOf(dep),
      features: [],
      image: row.heroImage || "",
      // 詳情頁需要的欄位本批未接,給空值讓版面自己收斂,不塞假內容
      gallery: row.heroImage ? [row.heroImage] : [],
      includes: [], required: [], optional: [], departures: [], route: [],
      __live: true,
    };
  }

  function trpcUrl(procedure, input) {
    return API_BASE + "/api/trpc/" + procedure + "?input=" + encodeURIComponent(JSON.stringify({ json: input }));
  }
  function getJson(url) {
    return fetch(url, { headers: { accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function unwrap(payload) {
    return payload && payload.result && payload.result.data && payload.result.data.json;
  }

  function fetchTours() {
    return getJson(trpcUrl("tours.searchCards", { page: 1, pageSize: PAGE_SIZE, language: "zh-TW" }))
      .then(function (payload) {
        var data = unwrap(payload);
        var rows = data && data.tours;
        if (!Array.isArray(rows)) throw new Error("bad payload shape");
        if (rows.length === 0) return [];  // 真的沒有公開行程 → 誠實的空,不是錯誤
        var ids = rows.map(function (r) { return r.id; }).filter(function (n) { return typeof n === "number"; });
        return getJson(trpcUrl("departures.getNextBatch", { tourIds: ids }))
          .then(function (depPayload) { return { rows: rows, deps: unwrap(depPayload) || {} }; })
          // 班期拿不到不該讓整批失敗:退成沒有班期,狀態文案會誠實說「暫無公開班期」
          .catch(function () { return { rows: rows, deps: {} }; });
      })
      .then(function (bundle) {
        return bundle.rows.map(function (row, i) { return toBcTour(row, i, bundle.deps); });
      });
  }

  function apply(live) {
    if (typeof BC_TOURS === "undefined" || !Array.isArray(BC_TOURS)) return;
    // 空也要套用。上線第一天的教訓:抓不到就留著設計樣本,等於在正式站對客人
    // 顯示不存在的行程與價格 —— 那比空白嚴重得多。

    BC_TOURS.length = 0;
    Array.prototype.push.apply(BC_TOURS, live);
    if (typeof BC_DETAIL_TOURS !== "undefined" && Array.isArray(BC_DETAIL_TOURS)) {
      var extras = BC_DETAIL_TOURS.filter(function (t) {
        return !t.__live && !live.some(function (l) { return l.id === t.id; });
      });
      BC_DETAIL_TOURS.length = 0;
      Array.prototype.push.apply(BC_DETAIL_TOURS, live.concat(extras));
    }
    if (typeof renderPage === "function") renderPage();
    var withDate = live.filter(function (t) { return !!t.nextDate; }).length;
    window.PACKGO_LIVE = { ok: true, count: live.length, withDeparture: withDate, at: new Date().toISOString() };
    console.info("[live-data] 真實行程 " + live.length + " 筆,其中 " + withDate + " 筆有公開班期");
  }

  function boot() {
    fetchTours()
      .then(apply)
      .catch(function (err) {
        // 取不到資料時「清空」而不是留樣本。寧可讓客人看到「目前沒有公開行程」,
        // 也不能讓他看到一筆我們其實不賣的團和一個不存在的價格。
        window.PACKGO_LIVE = { ok: false, reason: String((err && err.message) || err) };
        console.warn("[live-data] 取真資料失敗,清空行程(不顯示設計樣本):", err);
        try { apply([]); } catch (e) { /* 清空失敗就維持原狀,至少不再惡化 */ }
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
