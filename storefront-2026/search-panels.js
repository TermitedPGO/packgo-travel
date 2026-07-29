/*
  search-panels.js — 機票與飯店改成 Expedia / Trip.com 那種一次填完的搜尋列
  (2026-07-29,Jeff 指定)

  原本這兩頁是「一次一題」的引導問卷,答完六題答案還蒸發。客人對訂票網站的
  肌肉記憶是:上面一排欄位一次填完,按搜尋。這支就是那個形狀。

  按下搜尋之後會發生什麼 —— 這件事我沒有自作主張:

  Pack & Go 是旅行社,不是比價網,手上沒有即時機位與房價。而且舊庫的
  server/services/affiliateLinkService.ts 有一段被明確寫下的決定:不自行組
  Trip.com 的深層連結(帶城市/日期/人數的網址),因為手工拼的連結不是官方認可
  的推廣連結,不保證算業績,Trip.com 也要求不要改動平台產生的連結。

  所以這裡的搜尋按鈕做的是「把你填的條件整理成一封需求,送給 Pack & Go」,
  由 Jeff 用他自己的通路查價回覆 —— 這才是這家公司實際在做的事。
  另外提供一個次要出口:直接前往 Trip.com 自己找(用的是那條已核准的推廣入口,
  不加任何自組參數)。

  要改成「按下去直接跳 Trip.com 帶條件搜尋」是可以做的,但那要先解決上面那個
  推廣連結的合規問題,不是我能自己決定的。
*/
(function () {
  "use strict";

  /* Trip.com 出口一律走站上現成的第一方轉址端點 /go/trip/:source。
     不把推廣網址寫在前端的三個理由:
       1. 那條端點會記錄是從哪一頁點出去的,前端硬寫就沒有這筆資料
       2. 已核准的推廣網址只該存在一個地方(server/services/affiliateLinkService.ts),
          前端再抄一份,哪天換連結就會有一份忘了改
       3. 那支端點有 allowlist 把關,前端硬寫等於繞過它
     合法的 source 是後端寫死的封閉清單,傳錯會回 400。 */
  var TRIP_GO = { flight: "/go/trip/flight_search", hotel: "/go/trip/hotel_search" };

  function t(zh, en) {
    var lang = (typeof state !== "undefined" && state && state.lang) || "zh";
    return lang === "zh" ? zh : en;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function today(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }

  function field(label, inner) {
    return '<label class="pg-sf-field"><span>' + esc(label) + "</span>" + inner + "</label>";
  }
  function num(name, value, min, max) {
    return '<input type="number" name="' + name + '" value="' + value + '" min="' + min + '" max="' + max + '" inputmode="numeric" />';
  }


  /* ── 快捷 ────────────────────────────────────────────────────────────────
     Pack & Go 的客人主要在灣區,常飛的就是台北、東京、上海、香港、首爾這幾條。
     這裡只是把欄位一次填好的便利鍵,不代表有現貨或特價,所以不寫任何價格。
     要改路線清單就改這兩個陣列。 */
  var FLIGHT_ROUTES = [
    ["舊金山 SFO", "台北 TPE", "San Francisco SFO", "Taipei TPE"],
    ["舊金山 SFO", "東京 NRT", "San Francisco SFO", "Tokyo NRT"],
    ["舊金山 SFO", "上海 PVG", "San Francisco SFO", "Shanghai PVG"],
    ["舊金山 SFO", "香港 HKG", "San Francisco SFO", "Hong Kong HKG"],
    ["舊金山 SFO", "首爾 ICN", "San Francisco SFO", "Seoul ICN"],
    ["洛杉磯 LAX", "台北 TPE", "Los Angeles LAX", "Taipei TPE"],
  ];
  var HOTEL_CITIES = [
    ["台北", "Taipei"], ["東京", "Tokyo"], ["大阪", "Osaka"],
    ["首爾", "Seoul"], ["香港", "Hong Kong"], ["上海", "Shanghai"],
  ];

  function flightQuick() {
    var chips = FLIGHT_ROUTES.map(function (r, i) {
      var zh = r[0].split(" ")[0] + " → " + r[1].split(" ")[0];
      var en = r[2].split(" ")[0] + " → " + r[3].split(" ")[0];
      return '<button type="button" class="pg-sf-chip" data-sf-route="' + esc(r[0]) + "|" + esc(r[1]) +
        '"><i>' + (i + 1) + "</i>" + esc(t(zh, en)) + "</button>";
    }).join("");
    var when = [
      '<button type="button" class="pg-sf-chip ghost" data-sf-when="30">' + esc(t("一個月後", "In a month")) + "</button>",
      '<button type="button" class="pg-sf-chip ghost" data-sf-when="60">' + esc(t("兩個月後", "In two months")) + "</button>",
      '<button type="button" class="pg-sf-chip ghost" data-sf-when="flex">' + esc(t("日期還沒定", "Dates flexible")) + "</button>",
    ].join("");
    return '<div class="pg-sf-quick"><span>' + esc(t("常飛路線", "Popular routes")) + "</span>" + chips +
      '</div><div class="pg-sf-quick"><span>' + esc(t("大概什麼時候", "Roughly when")) + "</span>" + when + "</div>";
  }

  function hotelQuick() {
    var chips = HOTEL_CITIES.map(function (c, i) {
      return '<button type="button" class="pg-sf-chip" data-sf-city="' + esc(c[0]) + '"><i>' + (i + 1) + "</i>" +
        esc(t(c[0], c[1])) + "</button>";
    }).join("");
    var nights = [3, 5, 7].map(function (n) {
      return '<button type="button" class="pg-sf-chip ghost" data-sf-nights="' + n + '">' +
        esc(t(n + " 晚", n + " nights")) + "</button>";
    }).join("");
    return '<div class="pg-sf-quick"><span>' + esc(t("熱門城市", "Popular cities")) + "</span>" + chips +
      '</div><div class="pg-sf-quick"><span>' + esc(t("住幾晚", "How long")) + "</span>" + nights + "</div>";
  }

  function flightPanel() {
    return (
      '<form class="pg-sf" data-sf="flight">' +
      '<div class="pg-sf-tabs">' +
      '<button type="button" class="is-on" data-sf-trip="rt">' + esc(t("來回", "Round trip")) + "</button>" +
      '<button type="button" data-sf-trip="ow">' + esc(t("單程", "One way")) + "</button>" +
      "</div>" +
      flightQuick() +
      '<div class="pg-sf-row pg-sf-flight">' +
      field(t("出發地", "From"), '<input name="from" placeholder="' + esc(t("城市或機場,例如 舊金山 SFO", "City or airport, e.g. San Francisco SFO")) + '" />') +
      field(t("目的地", "To"), '<input name="to" placeholder="' + esc(t("城市或機場,例如 東京 NRT", "City or airport, e.g. Tokyo NRT")) + '" />') +
      field(t("出發日", "Depart"), '<input type="date" name="depart" value="' + today(30) + '" />') +
      field(t("回程日", "Return"), '<input type="date" name="ret" value="' + today(37) + '" data-sf-return />') +
      field(t("旅客", "Travelers"), num("pax", 2, 1, 20)) +
      field(t("艙等", "Cabin"),
        '<select name="cabin">' +
        '<option value="economy">' + esc(t("經濟艙", "Economy")) + "</option>" +
        '<option value="premium">' + esc(t("豪華經濟艙", "Premium economy")) + "</option>" +
        '<option value="business">' + esc(t("商務艙", "Business")) + "</option>" +
        '<option value="first">' + esc(t("頭等艙", "First")) + "</option>" +
        "</select>") +
      '<button type="submit" class="pg-sf-go">' + esc(t("查機票", "Search flights")) + "</button>" +
      "</div>" +
      '<p class="pg-sf-note">' +
      esc(t("按下查機票,我們會用你填的條件替你比價,一個工作天內回覆含行李與必要費用的完整總價。",
            "We compare fares with your details and reply within one business day with a full price including bags and required fees.")) +
      ' <a href="' + TRIP_GO.flight + '" target="_blank" rel="noopener nofollow">' +
      esc(t("或自己上 Trip.com 找", "or search Trip.com yourself")) + "</a></p>" +
      shortcutHint("flight") +
      "</form>"
    );
  }

  function hotelPanel() {
    return (
      '<form class="pg-sf" data-sf="hotel">' +
      hotelQuick() +
      '<div class="pg-sf-row pg-sf-hotel">' +
      field(t("目的地", "Destination"), '<input name="city" placeholder="' + esc(t("城市、地區或飯店名", "City, area or hotel")) + '" />') +
      field(t("入住", "Check in"), '<input type="date" name="checkin" value="' + today(30) + '" />') +
      field(t("退房", "Check out"), '<input type="date" name="checkout" value="' + today(33) + '" />') +
      field(t("房間", "Rooms"), num("rooms", 1, 1, 10)) +
      field(t("住客", "Guests"), num("guests", 2, 1, 20)) +
      '<button type="submit" class="pg-sf-go">' + esc(t("查飯店", "Search hotels")) + "</button>" +
      "</div>" +
      '<p class="pg-sf-note">' +
      esc(t("按下查飯店,我們會回你含稅費、早餐與取消條件的總價,並說清楚是誰收款。",
            "We reply with a total including taxes, breakfast and cancellation terms, and say clearly who takes payment.")) +
      ' <a href="' + TRIP_GO.hotel + '" target="_blank" rel="noopener nofollow">' +
      esc(t("或自己上 Trip.com 找", "or search Trip.com yourself")) + "</a></p>" +
      shortcutHint("hotel") +
      "</form>"
    );
  }


  /* ── 鍵盤快捷 ─────────────────────────────────────────────────────────────
     訂票是重複性很高的動作,手不離鍵盤比較快。只在「焦點不在輸入框」時生效,
     所以不會吃掉你正在打的字。 */
  function inTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  function shortcutHint(kind) {
    var parts = [
      '<kbd>/</kbd> ' + esc(t("跳到第一格", "focus first field")),
      '<kbd>1</kbd>–<kbd>6</kbd> ' + esc(t("選常用選項", "pick a shortcut")),
    ];
    if (kind === "flight") parts.push('<kbd>R</kbd>/<kbd>O</kbd> ' + esc(t("來回/單程", "round trip / one way")));
    parts.push('<kbd>Enter</kbd> ' + esc(t("送出", "search")));
    return '<p class="pg-sf-keys">' + esc(t("鍵盤:", "Keys:")) + " " + parts.join(" · ") + "</p>";
  }

  document.addEventListener("keydown", function (e) {
    var form = document.querySelector(".pg-sf");
    if (!form) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Enter:在任何欄位裡都直接送出(原生行為在有多個欄位時不一定觸發)
    if (e.key === "Enter" && form.contains(document.activeElement)) {
      e.preventDefault();
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return;
    }
    if (inTyping(document.activeElement)) return;

    if (e.key === "/") {
      e.preventDefault();
      var first = form.querySelector("input[name=from], input[name=city]");
      if (first) first.focus();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      var chips = form.querySelectorAll("[data-sf-route], [data-sf-city]");
      var pick = chips[Number(e.key) - 1];
      if (pick) {
        e.preventDefault();
        pick.click();
      }
      return;
    }
    var k = e.key.toLowerCase();
    if (k === "r" || k === "o") {
      var tab = form.querySelector('[data-sf-trip="' + (k === "r" ? "rt" : "ow") + '"]');
      if (tab) {
        e.preventDefault();
        tab.click();
      }
    }
  });

  /** 把表單內容整理成一封人看得懂的需求。 */
  function briefOf(form) {
    var v = function (n) {
      var el = form.querySelector("[name=" + n + "]");
      return el ? String(el.value || "").trim() : "";
    };
    var kind = form.getAttribute("data-sf");
    if (kind === "flight") {
      var rt = form.querySelector("[data-sf-trip].is-on");
      var oneWay = rt && rt.getAttribute("data-sf-trip") === "ow";
      var cabinEl = form.querySelector("[name=cabin]");
      var cabin = cabinEl ? cabinEl.options[cabinEl.selectedIndex].textContent : "";
      return [
        t("行程類型", "Trip type") + "：" + (oneWay ? t("單程", "One way") : t("來回", "Round trip")),
        t("出發地", "From") + "：" + (v("from") || "—"),
        t("目的地", "To") + "：" + (v("to") || "—"),
        t("出發日", "Depart") + "：" + (v("depart") || "—"),
        oneWay ? null : t("回程日", "Return") + "：" + (v("ret") || "—"),
        t("旅客人數", "Travelers") + "：" + (v("pax") || "—"),
        t("艙等", "Cabin") + "：" + cabin,
      ].filter(Boolean).join("\n");
    }
    return [
      t("目的地", "Destination") + "：" + (v("city") || "—"),
      t("入住", "Check in") + "：" + (v("checkin") || "—"),
      t("退房", "Check out") + "：" + (v("checkout") || "—"),
      t("房間數", "Rooms") + "：" + (v("rooms") || "—"),
      t("住客人數", "Guests") + "：" + (v("guests") || "—"),
    ].join("\n");
  }

  /** 把引導問卷換成搜尋列。只換機票與飯店兩頁,其餘流程不動。 */
  function mount() {
    var root = document.getElementById("app");
    if (!root) return;
    var host = root.querySelector("#bc-service-flow");
    if (!host) return;
    var view = (typeof state !== "undefined" && state && state.view) || "";
    if (view === "flights") host.innerHTML = flightPanel();
    else if (view === "hotel") host.innerHTML = hotelPanel();
  }

  function fill(form, name, value) {
    var el = form.querySelector("[name=" + name + "]");
    if (el) el.value = value;
  }
  function markOn(group, el) {
    group.forEach(function (b) { b.classList.remove("is-picked"); });
    el.classList.add("is-picked");
  }

  document.addEventListener("click", function (e) {
    var route = e.target.closest("[data-sf-route]");
    if (route) {
      e.preventDefault();
      var f = route.closest(".pg-sf");
      var parts = route.getAttribute("data-sf-route").split("|");
      fill(f, "from", parts[0]);
      fill(f, "to", parts[1]);
      markOn([].slice.call(f.querySelectorAll("[data-sf-route]")), route);
      return;
    }
    var when = e.target.closest("[data-sf-when]");
    if (when) {
      e.preventDefault();
      var f2 = when.closest(".pg-sf");
      var v = when.getAttribute("data-sf-when");
      if (v === "flex") {
        fill(f2, "depart", "");
        fill(f2, "ret", "");
      } else {
        fill(f2, "depart", today(Number(v)));
        fill(f2, "ret", today(Number(v) + 7));
      }
      markOn([].slice.call(f2.querySelectorAll("[data-sf-when]")), when);
      return;
    }
    var city = e.target.closest("[data-sf-city]");
    if (city) {
      e.preventDefault();
      var f3 = city.closest(".pg-sf");
      fill(f3, "city", city.getAttribute("data-sf-city"));
      markOn([].slice.call(f3.querySelectorAll("[data-sf-city]")), city);
      return;
    }
    var nights = e.target.closest("[data-sf-nights]");
    if (nights) {
      e.preventDefault();
      var f4 = nights.closest(".pg-sf");
      var n = Number(nights.getAttribute("data-sf-nights"));
      var ci = f4.querySelector("[name=checkin]");
      var base = ci && ci.value ? new Date(ci.value) : new Date(today(30));
      var out = new Date(base);
      out.setDate(out.getDate() + n);
      fill(f4, "checkout", out.toISOString().slice(0, 10));
      markOn([].slice.call(f4.querySelectorAll("[data-sf-nights]")), nights);
      return;
    }
    var tab = e.target.closest("[data-sf-trip]");
    if (tab) {
      e.preventDefault();
      var form = tab.closest(".pg-sf");
      form.querySelectorAll("[data-sf-trip]").forEach(function (b) { b.classList.remove("is-on"); });
      tab.classList.add("is-on");
      var retField = form.querySelector("[data-sf-return]");
      if (retField) retField.closest(".pg-sf-field").style.display =
        tab.getAttribute("data-sf-trip") === "ow" ? "none" : "";
    }
  });

  document.addEventListener("submit", function (e) {
    var form = e.target.closest(".pg-sf");
    if (!form) return;
    e.preventDefault();
    window.PACKGO_PREFILL = briefOf(form);
    var opener = document.createElement("button");
    opener.setAttribute("data-enquiry-open", "");
    opener.style.display = "none";
    document.body.appendChild(opener);
    opener.click();
    opener.remove();
  });

  // 每次畫面重畫後重新掛上
  var origRender = null;
  function hook() {
    if (typeof window.renderPage === "function" && window.renderPage !== origRender) {
      var real = window.renderPage;
      origRender = function () {
        var r = real.apply(this, arguments);
        setTimeout(mount, 0);
        return r;
      };
      window.renderPage = origRender;
    }
    setTimeout(mount, 0);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook);
  else hook();
})();
