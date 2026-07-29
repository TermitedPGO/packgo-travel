/*
  enquiry.js — 讓網站真的收得到客人的需求(2026-07-29)

  盤點時發現的最大商業漏洞:新站漂亮,但全站沒有任何一條路能把客人的需求送到
  Jeff 手上。所有行動按鈕按下去只會跳一句「此功能尚未開放,不會送出資料或扣款」
  —— 客人看完機票服務想問,按下去被告知尚未開放,然後就走了。

  這支補上那條路:
    - 任何原本掛 data-demo-action 的按鈕,改成打開詢問面板
    - 面板送出後打現有後端的 inquiries.create(公開端點,有速率限制)
    - 面板上同時放電話與 email,不想填表的人可以直接聯絡

  刻意的邊界:
    - 只送出客人自己填的四個欄位,不夾帶任何瀏覽軌跡
    - 不碰付款、不碰登入、不建立帳號
    - 本機開發時 dev-server 會攔下這個 POST 並回模擬成功,不會在正式系統留資料
*/
(function () {
  "use strict";

  var PHONE = "+1 (510) 634-2307";
  var PHONE_HREF = "tel:+15106342307";
  var EMAIL = "support@packgoplay.com";

  function t(zh, en) {
    var lang = (typeof state !== "undefined" && state && state.lang) || "zh";
    return lang === "zh" ? zh : en;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /** 從目前畫面推出一個有意義的主旨,讓 Jeff 一眼知道客人從哪裡來。 */
  function subjectForView() {
    var v = (typeof state !== "undefined" && state && state.view) || "home";
    var map = {
      home: t("網站詢問", "Website enquiry"),
      tours: t("團體行程詢問", "Group journey enquiry"),
      detail: t("行程詢問", "Journey enquiry"),
      services: t("旅行服務詢問", "Travel service enquiry"),
      flights: t("機票服務詢問", "Flight service enquiry"),
      visa: t("簽證服務詢問", "Visa service enquiry"),
      "china-visa": t("中國簽證詢問", "China visa enquiry"),
      custom: t("客製旅行詢問", "Custom travel enquiry"),
      group: t("包團詢問", "Private group enquiry"),
      transfer: t("機場接送詢問", "Airport transfer enquiry"),
      hotel: t("訂房詢問", "Hotel enquiry"),
      contact: t("聯絡與支援", "Contact and support"),
      help: t("使用說明詢問", "Help enquiry"),
      about: t("網站詢問", "Website enquiry"),
    };
    return map[v] || t("網站詢問", "Website enquiry");
  }

  function panelHtml() {
    return (
      '<div class="pg-enquiry-backdrop" data-enquiry-close></div>' +
      '<div class="pg-enquiry-panel" role="dialog" aria-modal="true" aria-labelledby="pg-enquiry-title">' +
      '<button class="pg-enquiry-x" data-enquiry-close aria-label="' + esc(t("關閉", "Close")) + '">×</button>' +
      '<p class="pg-enquiry-eyebrow">PACK&amp;GO</p>' +
      '<h2 id="pg-enquiry-title">' + esc(t("告訴我們你想去哪裡", "Tell us what you need")) + "</h2>" +
      '<p class="pg-enquiry-sub">' +
      esc(t("留下聯絡方式,我們會直接回覆你,不是自動回信。",
            "Leave your contact and we will reply personally, not with an autoresponder.")) +
      "</p>" +
      '<form class="pg-enquiry-form" novalidate>' +
      '<label>' + esc(t("稱呼", "Name")) + '<input name="customerName" required maxlength="100" autocomplete="name" /></label>' +
      '<label>Email<input name="customerEmail" type="email" required maxlength="320" autocomplete="email" /></label>' +
      '<label>' + esc(t("電話(選填)", "Phone (optional)")) + '<input name="customerPhone" maxlength="40" autocomplete="tel" /></label>' +
      '<label>' + esc(t("想問什麼", "What do you need")) +
      '<textarea name="message" required maxlength="5000" rows="4" placeholder="' +
      esc(t("例如:十月想去日本,兩大一小,想要含機票的行程",
            "e.g. Japan in October, two adults and a child, airfare included")) + '"></textarea></label>' +
      '<p class="pg-enquiry-error" hidden></p>' +
      '<button type="submit" class="pg-enquiry-send">' + esc(t("送出", "Send")) + "</button>" +
      "</form>" +
      '<p class="pg-enquiry-alt">' +
      esc(t("不想填表也可以直接聯絡:", "Prefer to talk to a person:")) +
      ' <a href="' + PHONE_HREF + '">' + esc(PHONE) + "</a>" +
      ' · <a href="mailto:' + EMAIL + '">' + EMAIL + "</a></p>" +
      "</div>"
    );
  }

  function successHtml(name) {
    return (
      '<div class="pg-enquiry-backdrop" data-enquiry-close></div>' +
      '<div class="pg-enquiry-panel" role="dialog" aria-modal="true">' +
      '<button class="pg-enquiry-x" data-enquiry-close aria-label="' + esc(t("關閉", "Close")) + '">×</button>' +
      '<p class="pg-enquiry-eyebrow">PACK&amp;GO</p>' +
      "<h2>" + esc(t("收到了", "We have it")) + "</h2>" +
      '<p class="pg-enquiry-sub">' +
      esc(t((name ? name + "，" : "") + "我們會在一個工作天內回覆你。急件請直接來電。",
            "We will reply within one business day. For anything urgent, please call.")) +
      "</p>" +
      '<p class="pg-enquiry-alt"><a href="' + PHONE_HREF + '">' + esc(PHONE) + "</a>" +
      ' · <a href="mailto:' + EMAIL + '">' + EMAIL + "</a></p>" +
      '<button class="pg-enquiry-send" data-enquiry-close>' + esc(t("關閉", "Close")) + "</button>" +
      "</div>"
    );
  }

  function host() {
    var el = document.getElementById("pg-enquiry-root");
    if (!el) {
      el = document.createElement("div");
      el.id = "pg-enquiry-root";
      document.body.appendChild(el);
    }
    return el;
  }

  /** 把引導流程已回答的題目整理成人看得懂的文字,當作訊息預設值。 */
  function briefFromFlow(flowId) {
    try {
      if (!flowId || typeof bcFlowDefinitions !== "function" || typeof bcFlowState !== "function") return "";
      var flow = bcFlowDefinitions()[flowId];
      var st = bcFlowState(flowId);
      if (!flow || !st || !st.answers) return "";
      var lines = [];
      flow.steps.forEach(function (step) {
        var a = st.answers[step.key];
        if (!a) return;
        var label = typeof bcFlowAnswerLabel === "function" ? bcFlowAnswerLabel(step, a) : a;
        lines.push(String(step.question).replace(/<[^>]+>/g, "") + "：" + String(label).replace(/<[^>]+>/g, ""));
      });
      return lines.join("\n");
    } catch (e) {
      return "";
    }
  }

  function open(flowId) {
    var el = host();
    el.innerHTML = panelHtml();
    var brief = briefFromFlow(flowId);
    if (brief) {
      var ta = el.querySelector("textarea[name=message]");
      if (ta) ta.value = brief + "\n\n";
    }
    el.classList.add("is-open");
    document.documentElement.classList.add("modal-open");
    var first = el.querySelector("input[name=customerName]");
    if (first) setTimeout(function () { first.focus(); }, 30);
  }

  function close() {
    var el = host();
    el.classList.remove("is-open");
    el.innerHTML = "";
    document.documentElement.classList.remove("modal-open");
  }

  function send(form) {
    var val = function (n) {
      var el = form.querySelector("[name=" + n + "]");
      return el && el.value ? el.value : "";
    };
    var data = {
      customerName: val("customerName").trim(),
      customerEmail: val("customerEmail").trim(),
      customerPhone: val("customerPhone").trim() || undefined,
      subject: subjectForView(),
      message: val("message").trim(),
      inquiryType: "general",
    };
    var err = form.parentNode.querySelector(".pg-enquiry-error");
    function fail(msg) {
      err.textContent = msg;
      err.hidden = false;
    }
    if (!data.customerName) return fail(t("請留一個稱呼。", "Please tell us your name."));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.customerEmail)) return fail(t("Email 看起來不太對。", "That email does not look right."));
    if (!data.message) return fail(t("寫一句想問什麼就好。", "One line about what you need is enough."));

    var btn = form.querySelector(".pg-enquiry-send");
    btn.disabled = true;
    btn.textContent = t("送出中…", "Sending…");
    err.hidden = true;

    fetch("/api/trpc/inquiries.create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: data }),
    })
      .then(function (r) {
        if (r.status === 429) throw new Error(t("送太快了,請稍後再試,或直接來電。", "Too many attempts. Please try later or call us."));
        if (!r.ok) throw new Error(t("送出失敗", "Could not send"));
        return r.json();
      })
      .then(function (payload) {
        if (payload && payload.error) throw new Error(t("送出失敗", "Could not send"));
        host().innerHTML = successHtml(data.customerName);
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = t("送出", "Send");
        fail(
          (e && e.message ? e.message : t("送出失敗", "Could not send")) +
            t("　你也可以直接打 " + PHONE, " You can also call " + PHONE),
        );
      });
  }

  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-enquiry-open]") || e.target.closest("[data-demo-action]");
    if (opener) {
      e.preventDefault();
      e.stopPropagation();
      open(opener.getAttribute("data-enquiry-flow") || "");
      return;
    }
    if (e.target.closest("[data-enquiry-close]")) {
      e.preventDefault();
      close();
    }
  }, true); // 用捕獲階段,搶在原型自己的 toast 之前

  document.addEventListener("submit", function (e) {
    var form = e.target.closest(".pg-enquiry-form");
    if (!form) return;
    e.preventDefault();
    send(form);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && host().classList.contains("is-open")) close();
  });
})();
