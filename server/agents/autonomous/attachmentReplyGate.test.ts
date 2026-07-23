/**
 * pdf-attachment-reliability (2026-07-15/16) — attachment-mail suspension +
 * advisory risk highlighter.
 *
 * 2026-07-15 incident: the InquiryAgent prompt SAID "never tell the customer
 * we couldn't read their file", but prompt text is not a gate — the model
 * told a customer their (perfectly fine) PDF couldn't be parsed.
 *
 * FINAL CONTRACT (Codex 12:01 §五, after four matcher generations each
 * failed the next independent fresh corpus in both directions):
 *
 *   1. ANY attachment mail → forceEscalate=true, mechanically. Parse status
 *      and draft wording play no part in the SEND decision; a human sends.
 *   2. The wording matcher is ADVISORY: its unsafe/ambiguous/clean verdict
 *      and matched snippet only highlight the risky sentence on the card.
 *      It never drops a draft (dropDraft/droppedDraft are always false,
 *      bodyText is always the preserved canonical draft) and never
 *      authorizes a send.
 *
 * The corpora below are kept from every round — they now lock HINT QUALITY
 * (dangerous wording should not look clean; benign wording should not be
 * flagged unsafe) and, above all, the two mechanical invariants.
 */

import { describe, it, expect } from "vitest";

import {
  evaluateAttachmentReplyGate,
  findForbiddenReplyPhrase,
  finalizeAutonomousDraft,
  classifyAttachmentReply,
} from "./attachmentReplyGate";
import { stripMarkdownForEmail } from "../../_core/plainTextReply";
import { buildUpgradeCta } from "../../_core/repurchaseCta";

const att = (parseStatus: string, filename = "trip.pdf") => ({
  filename,
  parseStatus,
});
const READABLE = [{ filename: "trip.pdf", parseStatus: "ok" }];
const fin = (draftReply: string, attachments = [...READABLE]) =>
  finalizeAutonomousDraft({ draftReply, attachments });

// ══════════════════════════════════════════════════════════════════════
// 1. The mechanical suspension (Codex 12:01 §五.1)
// ══════════════════════════════════════════════════════════════════════

describe("mechanical suspension — ANY attachment mail escalates", () => {
  it("readable attachments + perfectly clean draft STILL escalate (suspension, not wording)", () => {
    const r = evaluateAttachmentReplyGate({
      attachments: [att("ok"), att("ok_truncated", "list.xlsx")],
      draftReply: "您好,已收到您的行程附件,以下是我們的建議。",
    });
    expect(r.forceEscalate).toBe(true);
    expect(r.dropDraft).toBe(false);
    expect(r.verdict).toBe("clean");
    expect(r.escalationReason).toContain("附件信一律");
  });

  it.each([
    "parse_error",
    "too_large",
    "empty",
    "unsupported",
    // fail-closed statuses (Codex 14:07): partial = fragment only;
    // not_processed = existence sentinel (cap / hydration / rescue replay).
    "partial",
    "not_processed",
  ])("a %s attachment escalates with the status reason", (status) => {
    const r = evaluateAttachmentReplyGate({
      attachments: [att("ok"), att(status, "bad.pdf")],
      draftReply: "您好。",
    });
    expect(r.forceEscalate).toBe(true);
    expect(r.escalationReason).toContain("bad.pdf");
    expect(r.escalationReason).toContain(status);
    expect(r.dropDraft).toBe(false);
  });

  it("no attachments → gate never trips (normal mail unaffected)", () => {
    const r = evaluateAttachmentReplyGate({
      attachments: [],
      draftReply: "上次那份檔案打不開的問題,我們已經處理好了。",
    });
    expect(r.forceEscalate).toBe(false);
    expect(r.dropDraft).toBe(false);
    expect(r.verdict).toBe("clean");
  });

  it("wording NEVER changes the escalation outcome — only the highlight", () => {
    const clean = evaluateAttachmentReplyGate({
      attachments: [att("ok")],
      draftReply: "報價如附件,兩人成行。",
    });
    const risky = evaluateAttachmentReplyGate({
      attachments: [att("ok")],
      draftReply: "您的附件我們無法解析,請重新上傳一次。",
    });
    expect(clean.forceEscalate).toBe(true);
    expect(risky.forceEscalate).toBe(true);
    expect(clean.riskHint).toBeUndefined();
    expect(risky.riskHint).toBeTruthy();
    expect(risky.escalationReason).toContain(risky.riskHint!);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. The matcher is demoted: it never destroys and never authorizes
//    (Codex 12:01 §五.2)
// ══════════════════════════════════════════════════════════════════════

describe("advisory demotion — no draft is ever dropped, no send ever authorized", () => {
  const WORST_LEAKS = [
    "您好,您的附件我們無法解析,請重新上傳一次。",
    "We were unable to read your attachment, please resend it.",
    "行程如下。\n\nP.S. 您的附件我們無法**解析**,請重**傳**一次。",
  ];
  for (const s of WORST_LEAKS) {
    it(`even the worst leak keeps its draft for Jeff: ${JSON.stringify(s.slice(0, 30))}…`, () => {
      const r = fin(s);
      expect(r.droppedDraft).toBe(false);
      expect(r.bodyText).toBe(stripMarkdownForEmail(s));
      expect(r.bodyText.length).toBeGreaterThan(0);
      expect(r.forceEscalate).toBe(true);
      expect(r.verdict).not.toBe("clean");
    });
  }

  it("evaluate-level: dropDraft is ALWAYS false, draftDropReason never set", () => {
    for (const draft of [
      "您的 PDF 無法解析,請重傳。",
      "請勿重傳附件。",
      "乾淨的正文。",
    ]) {
      const r = evaluateAttachmentReplyGate({
        attachments: [att("parse_error")],
        draftReply: draft,
      });
      expect(r.dropDraft).toBe(false);
      expect(r.draftDropReason).toBeUndefined();
      expect(r.forceEscalate).toBe(true);
    }
  });

  it("raw draft is still scanned for the hint (belt-and-suspenders)", () => {
    const r = evaluateAttachmentReplyGate({
      attachments: [att("ok")],
      draftReply: "乾淨的正文。",
      rawDraftReply: "您的附件我們讀不到,請重傳。",
    });
    expect(r.verdict).not.toBe("clean");
    expect(r.dropDraft).toBe(false);
  });

  it("finalize NEVER returns an empty bodyText for a non-empty draft", () => {
    for (const s of ["我們無法解析您的附件。", "報價如附件。", "Do not resend the attachment."]) {
      expect(fin(s).bodyText.length).toBeGreaterThan(0);
    }
  });

  it("empty draft + no attachments → true no-op", () => {
    const r = finalizeAutonomousDraft({ draftReply: "", attachments: [] });
    expect(r.forceEscalate).toBe(false);
    expect(r.bodyText).toBe("");
    expect(r.verdict).toBe("clean");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. finalize chokepoint mechanics (Codex 16:02 P1-3, kept under demotion)
// ══════════════════════════════════════════════════════════════════════

describe("finalizeAutonomousDraft — canonicalization mechanics", () => {
  it("canonicalizes the REAL Plus CTA copy: no **, no em dash, bodyText = canonical, escalates (attachment mail)", () => {
    for (const lang of ["zh-TW", "en"]) {
      const augmented =
        "您好,行程建議如下,詳情我們再約時間討論。" +
        buildUpgradeCta(lang, "https://packgoplay.com");
      const r = fin(augmented);
      expect(r.forceEscalate).toBe(true); // suspension — not a wording verdict
      expect(r.droppedDraft).toBe(false);
      expect(r.bodyText).toBe(stripMarkdownForEmail(augmented));
      expect(r.bodyText).not.toContain("**");
      expect(r.bodyText).not.toMatch(/[—–―‒]/);
      expect(r.bodyText).toContain("PACK&GO Plus");
    }
  });

  it("non-readable attachment reason survives through finalize", () => {
    const r = finalizeAutonomousDraft({
      draftReply: "您好,收到您的資料了。",
      attachments: [{ filename: "small.pdf", parseStatus: "not_processed" }],
    });
    expect(r.forceEscalate).toBe(true);
    expect(r.droppedDraft).toBe(false);
    expect(r.reason).toContain("small.pdf");
  });

  it("normalization is scan-only — a clean draft goes out byte-identical", () => {
    const draft = "您好,附件的行程我看過了,第 3 天建議改成搭新幹線。";
    const r = fin(draft);
    expect(r.bodyText).toBe(stripMarkdownForEmail(draft));
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. ADVISORY HINT QUALITY. Every corpus below is carried over from the
//    matcher-as-gate rounds. The matcher no longer decides anything, but a
//    highlighted card beats an unhighlighted one, so we still lock:
//      leak-family   → verdict must NOT be "clean"  (the card highlights)
//      benign-family → verdict must NOT be "unsafe" (no false alarm banner)
//    A regression here costs highlight quality, not customer safety — the
//    mechanical suspension in §1 is the safety boundary now.
// ══════════════════════════════════════════════════════════════════════

const HINT_LEAKS: ReadonlyArray<string> = [
  // round 1 (14:07) originals
  "您好,您的附件我們無法解析,請重新上傳一次。",
  "這個檔案我們讀不到,麻煩請重傳。",
  "系統顯示檔案太大,請改格式再寄給我們。",
  "請問您那邊能打開嗎?可以的話再傳一次。",
  "We were unable to read your attachment, please resend it.",
  "The file could not be opened on our side — could you send it again in a different format?",
  "您好,附件沒有成功讀出來,麻煩再寄一份給我們。",
  "您的行程檔案我們這邊開不起來,重寄一次好嗎?",
  "The attachment is unreadable on our end.",
  "Sorry, the PDF appears to be corrupted — please reattach it.",
  // round 2 (16:02)
  "The attachment did not open. Could you attach a fresh copy?",
  "The file won't open on our side. Could you share it again?",
  "I wasn't able to open the PDF. Would you mind uploading it once more?",
  "附件這邊沒有開成功,能否再提供一次?",
  "PDF 看不到內容,可以再給我一次嗎?",
  // batch-3 adversarial
  "附件那邊是空白的,再傳一次給我。",
  "我這邊的系統跑不出你附件的內容,再貼一份純文字給我好嗎?",
  "附件的內容我這邊顯示怪怪的,再麻煩您把重點打在信裡好嗎?",
  "The scan came out fuzzy for us. Could you retype the itinerary here?",
  "這個檔案我們沒辦法讀取,不好意思。",
  "We were unable to extract the text from your PDF.",
  "The system failed to extract content from the attachment.",
  "您寄來的附件收到了。可是我們沒有辦法打開,重寄一次好嗎?",
  // round 3 (17:40) verbatim typography strings
  "The attachment won’t open.",
  "I wasn’t able to open the PDF.",
  "附件似乎無法讀出文字。",
  "The PDF didn’t render for us.",
  "We had trouble opening the attachment.",
  "附件無法​解析。",
  "Your PDF has no readable text.",
  "We can’t get any text from the attachment.",
  // red-team v4
  "不好意思,您的附件開不了,方便重新傳一份給我嗎?",
  "我這邊看不到您附件的內容,方便把文字直接貼上來嗎?",
  "您好,系统无法解析您傳來的附件,方便重新傳一份給我嗎?",
  "附件這邊顯示有點狀況,麻煩您換個方式給我們。",
  "檔案內容出不來,想跟您確認一下行程日期。",
  "附件內容好像沒有跑出來。",
  "您傳的檔案我們這邊看起來怪怪的。",
  "附件收到了,不過內容看不太清楚,想請您確認一下。",
  "這個檔案在我們系統上顯示有狀況。",
  "麻煩您換個方式給我們檔案。",
  "您的PDF在我們這邊開起來是一片空白,能不能請您列印後拍照傳給我們?",
  "The file seems to be having issues on our end.",
  "We weren't able to make out the details in your attachment.",
  "Something went wrong with the PDF when it reached us.",
  "The PDF isn't showing up properly on our side.",
  "The attachment won't come up on our system.",
  "The attachment came through, but we can't quite make sense of it.",
  "Unfortunately we couldn't make out what's written in the attachment you sent.",
  // Codex 22:14 P1 leaks
  "The PDF rendered blank for us.",
  "附件載入失敗。",
  "PDF 沒有顯示出來。",
  "附件沒有內容。",
  "The file wouldn’t open.",
  "The attachment is not displaying correctly.",
  "We were not able to get the PDF to open.",
  "The PDF has no content.",
  "我們無法正常解析您的附件。",
  // Codex 09:21 leaks
  "The PDF came in blank.",
  "The PDF contains no text.",
  "We received the PDF, but it won't open.",
  "Please re-upload it.",
  "Can you send it again?",
  "PDF 下載後是空白的。",
  "附件打開後是一片空白。",
  "請把附件再寄一次。",
  "麻煩重傳它。",
  // red-team final (fresh hedged/metaphorical/buried)
  "這邊有點狀況,您的 PDF 好像沒辦法正常顯示。",
  "您的行程確認單似乎沒有跑出來,可能是我們系統的問題。",
  "那份護照掃描檔在我們電腦上叫不出來。",
  "開不起來耶,您上封信的附件。",
  "圖片載入不出來,我們這邊只看到一個叉叉。",
  "不好意思,可能是我們郵件系統的問題,附件收進來是 0 KB。",
  "附件被系統判定格式不支援,我們看不到內容。",
  "您的報名表好像被壓縮壞了,我們解壓縮不了。",
  "很不好意思,您的 PDF 在我們的閱讀器裡是空白頁。",
  "您附的那份簽證文件我們只看得到第一頁,後面都顯示不出來。",
  "抱歉,那份文件我們預覽不了,也下載不下來。",
  "附件我們收是收到了,只是內容一直出不來。",
  "您的附件似乎被我們的系統吃掉了,能再寄一次嗎?",
  "附件開啟後程式就當掉了,我們沒辦法確認內容。",
  "附件我們拉不下來,可能要麻煩您改寄雲端連結。",
  "The PDF you sent seems to be acting up on our end, so I haven't been able to view it yet.",
  "The itinerary file refuses to open no matter what we try.",
  "Our system choked on the PDF, so the booking details never loaded.",
  "The file shows up as gibberish when we open it here.",
  "Your attachment downloads as zero bytes on our end.",
  "Hmm, the document just spins forever and never actually opens for us.",
  "The document isn't cooperating with our viewer today.",
  "We're having a spot of bother getting your document to display.",
  "The passport copy came across scrambled, so I'll need a fresh one from you.",
  "Every attempt to open your document ends with our reader crashing.",
  "The file made it to us, but the contents didn't survive the journey.",
  "It didn't come through, unfortunately, so we're still waiting to see the actual document.",
  "For the Rome package, we can confirm two adults and one child. On a separate note, the passport scan you attached wouldn't open, so we'll need it again before ticketing. The hotel upgrade you asked about is available for an extra $40 per night.",
  "飯店已確認入住日期。另外您附的旅客名單檔案,我們這裡打不開,再請您重新提供。",
  "To finalize your Tokyo quote at $2,150 per person, we just need the passport details. The copy you attached earlier couldn't be opened here, so please pop it over again when you have a moment.",
];

describe("hint quality — dangerous wording is highlighted (never 'clean')", () => {
  for (const s of HINT_LEAKS) {
    it(`highlighted: ${JSON.stringify(s.slice(0, 44))}…`, () => {
      expect(classifyAttachmentReply(s).verdict).not.toBe("clean");
      // and through the black box: escalates, draft intact.
      const r = fin(s);
      expect(r.verdict).not.toBe("clean");
      expect(r.droppedDraft).toBe(false);
      expect(r.bodyText.length).toBeGreaterThan(0);
    });
  }
});

const HINT_BENIGN_CLEAN: ReadonlyArray<string> = [
  // round 1 controls
  "您好,我們已詳細看過您附的行程草稿,建議第 2 天加入故宮。",
  "Thanks for the itinerary — day 3 looks great, we suggest an earlier train.",
  "已收到附件,報價我們明天給您。",
  "The visa center cannot process applications on weekends, so we will submit on Monday.",
  "簽證中心週末無法處理申請件,我們週一會代為送件。",
  "報價單我明天再寄一份最新版本給您參考。",
  "這個檔期已經滿了,無法處理新的訂位,建議改看 10 月出發。",
  // round 2 controls
  "這次付款沒有成功,我們稍後再試一次刷卡。",
  "簽證結果還沒有成功出來,預計下週會有消息。",
  "The hotel file clerk cannot process applications on weekends.",
  "附件已收到。我明天再寄一份報價。",
  "The PDF explains that the visa center cannot process applications.",
  // batch-3 controls
  "請再提供出發日期與旅客人數,我們才能報價。",
  "我可以再提供幾個不同預算的選項給您參考。",
  "The consulate cannot process your documents during the holiday week.",
  "Visa documents cannot be processed by the consulate until Monday.",
  "Feel free to give us a call again anytime.",
  "Could you give us a call so we can resend the tickets by courier?",
  "If your travel document is damaged, the airline may deny boarding.",
  "您的簽證文件有問題的話,領事館會另行通知補件。",
  "您的截圖上看不到出發日期,方便告訴我確切日期嗎?",
  "Please paste the confirmation number into the form on our site.",
  // round 3 controls
  "附件已收到,請再提供出發日期與旅客人數。",
  "We received your attachment, please provide your passport number.",
  "Please send the confirmation number again.",
  "PDF 說明飯店有問題,我們建議改住別間。",
  "The scan shows a damaged passport.",
  // red-team v4 controls
  "麻煩再確認一下附件中的航班時間。",
  "合約已附上,麻煩您簽名後再寄回給我們,謝謝。",
  "The payment didn't come through on our end, could you please send it again?",
  "若官網照片審核沒過,請再上傳一張新的大頭照到ESTA網站。",
  "我明天再寄一份 PDF 報價給您。",
  "新版行程表我再傳一次檔案給您。",
  "上傳到簽證系統時,檔案太大會被退回,建議先壓縮再上傳。",
  "I'll attach a fresh copy of the updated quote with the new dates.",
  "I'll send a new copy of the invoice once the payment clears.",
  // Codex 22:14 core travel controls
  "The scan is of an empty beach.",
  "PDF 中寫著飯店無法處理提前入住。",
  "附件顯示護照損壞,需要換發。",
  "PDF 已收到,請再傳一次旅客姓名給我們。",
];

describe("hint quality — everyday quote flow is NOT flagged (verdict 'clean')", () => {
  for (const s of HINT_BENIGN_CLEAN) {
    it(`no flag: ${JSON.stringify(s.slice(0, 44))}…`, () => {
      expect(classifyAttachmentReply(s).verdict).toBe("clean");
    });
  }
});

// Benign sentences deliberately mined with dangerous vocabulary: ambiguous
// (a soft highlight) is acceptable, a full unsafe banner is not.
const HINT_BENIGN_NOT_UNSAFE: ReadonlyArray<string> = [
  // Codex 09:21 false-kill set
  "The PDF has no data for Sunday.",
  "The PDF describes an unreadable street sign near the hotel.",
  "Please re-upload the PDF to the consulate portal.",
  "PDF 中的空白頁是簽名頁。",
  "掃描檔是空白申請表。",
  "請重新上傳護照照片到 ESTA 網站。",
  "PDF 中寫著飯店保險箱打不開。",
  // red-team final false-kill set
  "麻煩簽好切結書後,把掃描檔傳給我們存查。",
  "請把附件轉寄給同行的家人,大家確認後再回覆我。",
  "請把附件裡的訂位代號再傳給我們,我幫您查改票費。",
  "回國後歡迎把照片發到我們的LINE群組,跟團員分享旅程。",
  "如果ESTA網站顯示逾時,請重新上傳一次就會成功。",
  "照片規格不符的話,請將照片重新上傳,簽證系統才會放行。",
  "新版報價單今晚整理好,會重寄給您一份。",
  "正確版本的行程確認書,稍後補寄給您。",
  "報到時您可以打開航空公司的App出示會員條碼嗎?",
  "抵達集合點前,您可以打開Google地圖跟著導航走。",
  "附件是空白的報名表,請列印後填寫基本資料。",
  "沖印店說這批照片太大,裝不進標準相框,建議改沖四乘六。",
  "手機拍夜景照片比較模糊是正常現象,開啟夜間模式會改善很多。",
  "體檢報告附件顯示狀況良好,高山行程可以安心參加。",
  "附件顯示有問題的路段我們都已避開,請放心。",
  "我們寄的報價PDF字體較小,若內容看不太清楚,跟我們說一聲,幫您調大字級。",
  "如果email收PDF不方便,我可以換個方式傳給您,例如改用LINE。",
  "置物櫃的照片我們已存檔申請理賠,那個打不開的鎖頭飯店會負責更換。",
  "The night photo in your attachment looks blurry because of the long exposure, but the guide says that is exactly the effect the photography class teaches.",
  "The PDF mentions the safe would not open, so the hotel moved you to another room.",
  // past-incident references (ambiguous-by-design)
  "您上週回報的檔案打不開問題,查出是連結過期,已重新開通。",
  "上次檔案打不開的問題已經處理好了,這次收到的資料都正常。",
];

describe("hint quality — vocabulary-adjacent benign content never gets the unsafe banner", () => {
  for (const s of HINT_BENIGN_NOT_UNSAFE) {
    it(`no unsafe banner: ${JSON.stringify(s.slice(0, 44))}…`, () => {
      expect(classifyAttachmentReply(s).verdict).not.toBe("unsafe");
    });
  }
});

// Same defect word, relation flipped — the classifier's clause-local +
// reporting analysis is what keeps highlights USEFUL (a card that flags
// every mention of 損壞 teaches Jeff to ignore the highlight).
describe("hint quality — reporting/relation contrasts", () => {
  const PAIRS: ReadonlyArray<[string, string]> = [
    ["附件顯示護照損壞,需要換發。", "附件損壞,麻煩您重新掃描。"],
    ["The scan shows a damaged passport.", "The scan is damaged, please rescan it."],
    ["PDF 中寫著飯店保險箱打不開。", "您的 PDF 打不開,可以再傳一次嗎?"],
    ["The PDF describes an unreadable street sign near the hotel.", "The PDF is unreadable on our end."],
    ["附件說明系統載入失敗時請重新整理。", "附件載入失敗。"],
    ["PDF 中寫著訂位代號沒有顯示出來是正常的。", "PDF 沒有顯示出來。"],
    ["附件提到這個欄位沒有內容也可以送件。", "附件沒有內容。"],
    ["The PDF explains what to do if the hotel safe wouldn’t open.", "The file wouldn’t open."],
    ["The PDF shows the blank immigration form you need to sign.", "The PDF rendered blank for us."],
    ["您的附件說明領事館無法正常解析舊版簽證條碼。", "我們無法正常解析您的附件。"],
  ];
  for (const [benign, leak] of PAIRS) {
    it(`contrast holds: ${JSON.stringify(benign.slice(0, 36))}…`, () => {
      expect(classifyAttachmentReply(benign).verdict).not.toBe("unsafe");
      expect(classifyAttachmentReply(leak).verdict).not.toBe("clean");
    });
  }

  it("pronoun antecedent resolution keeps hints precise", () => {
    expect(classifyAttachmentReply("The payment didn't come through, could you send it again?").verdict).toBe("clean");
    expect(classifyAttachmentReply("Can you send it again?").verdict).toBe("ambiguous");
    expect(classifyAttachmentReply("We received the PDF, but it won't open.").verdict).not.toBe("clean");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. Normalization bypasses — typography must not hide a hint. Cases built
//    from explicit CODE POINTS so the bytes are locked (a prior round's
//    green silently tested ASCII look-alikes). Codex 12:01 §二.6 confirmed
//    this layer PASS with 0 clean leaks over an independent 25-probe set.
// ══════════════════════════════════════════════════════════════════════

describe("normalization — typography cannot hide the highlight", () => {
  const cp = (n: number) => String.fromCodePoint(n);
  const flagged = (s: string) => classifyAttachmentReply(s).verdict !== "clean";

  const IGNORABLES: ReadonlyArray<[string, number]> = [
    ["U+034F COMBINING GRAPHEME JOINER", 0x034f],
    ["U+2065 (reserved, Default_Ignorable)", 0x2065],
    ["U+E0001 LANGUAGE TAG", 0xe0001],
    ["U+200B ZERO WIDTH SPACE", 0x200b],
    ["U+200C ZERO WIDTH NON-JOINER", 0x200c],
    ["U+200E LEFT-TO-RIGHT MARK", 0x200e],
    ["U+202A LEFT-TO-RIGHT EMBEDDING", 0x202a],
    ["U+202E RIGHT-TO-LEFT OVERRIDE", 0x202e],
    ["U+2060 WORD JOINER", 0x2060],
    ["U+2066 LEFT-TO-RIGHT ISOLATE", 0x2066],
    ["U+2068 FIRST STRONG ISOLATE", 0x2068],
    ["U+061C ARABIC LETTER MARK", 0x061c],
    ["U+180E MONGOLIAN VOWEL SEPARATOR", 0x180e],
    ["U+FE0F VARIATION SELECTOR-16", 0xfe0f],
    ["U+00AD SOFT HYPHEN", 0x00ad],
    ["U+FEFF BOM", 0xfeff],
  ];
  for (const [name, code] of IGNORABLES) {
    it(`${name} cannot split 無法解析`, () => {
      expect(flagged(`我們無法${cp(code)}解析您的附件。`)).toBe(true);
      expect(findForbiddenReplyPhrase(`我們無法${cp(code)}解析您的附件。`)).toBeTruthy();
    });
  }

  const HYPHENS: ReadonlyArray<[string, number]> = [
    ["U+2010 HYPHEN", 0x2010],
    ["U+2011 NON-BREAKING HYPHEN", 0x2011],
    ["U+2012 FIGURE DASH", 0x2012],
    ["U+2013 EN DASH used tight", 0x2013],
    ["U+2212 MINUS SIGN", 0x2212],
    ["U+FF0D FULLWIDTH HYPHEN-MINUS", 0xff0d],
  ];
  for (const [name, code] of HYPHENS) {
    it(`${name} cannot hide re-send`, () => {
      expect(flagged(`Please re${cp(code)}send the PDF.`)).toBe(true);
    });
  }

  it("U+2019 curly / U+02BC modifier apostrophes cannot hide contractions", () => {
    expect(flagged(`The file wouldn${cp(0x2019)}t open.`)).toBe(true);
    expect(flagged(`The file wouldn${cp(0x02bc)}t open.`)).toBe(true);
  });
  it("fullwidth ＰＤＦ is folded by NFKC", () => {
    expect(flagged(`我們無法解析您的${cp(0xff30)}${cp(0xff24)}${cp(0xff26)}。`)).toBe(true);
  });

  // Entity decoding covers the LISTED named entities + ALL numeric forms —
  // NOT every HTML5 named entity (Codex 12:01 §六.3; unknown names pass
  // through verbatim, which fails visibly rather than silently).
  const MARKUP: ReadonlyArray<[string, string]> = [
    ["&ZeroWidthSpace; (listed name)", "我們無法&ZeroWidthSpace;解析您的附件。"],
    ["&shy; (listed name)", "我們無法&shy;解析您的附件。"],
    ["hex numeric entities", "&#x7121;&#x6cd5;解析您的附件。"],
    ["decimal numeric entities", "&#28961;&#27861;解析您的附件。"],
    ["numeric-entity hyphen &#x2011;", "Please re&#x2011;send the PDF."],
    ["<br> soft break", "我們無法<br>解析您的附件。"],
    ["HTML tags", '我們無法<span class="x">解析</span>您的附件。'],
    ["markdown bold", "我們無法**解析**您的附件。"],
    ["markdown strikethrough filler", "我們~~x~~無法解析您的附件。"],
    ["markdown inline code", "我們無法`解析`您的附件。"],
    ["markdown link", "[我們無法解析您的附件](https://packgoplay.com)。"],
    ["CJK newline split", "附件無法\n解析。"],
  ];
  for (const [name, s] of MARKUP) {
    it(`${name} cannot hide the hint`, () => {
      expect(flagged(s)).toBe(true);
    });
  }

  it("simplified characters are folded for the scan (无法/读不到)", () => {
    expect(flagged("我们无法解析您的附件。")).toBe(true);
    expect(flagged("您的附件我们读不到,请重传。")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. findForbiddenReplyPhrase — hint-helper contract
// ══════════════════════════════════════════════════════════════════════

describe("findForbiddenReplyPhrase (hint helper)", () => {
  it("returns the risky snippet for observability, null when clean", () => {
    expect(findForbiddenReplyPhrase("我們無法解析您的附件,請重傳。")).toBeTruthy();
    expect(findForbiddenReplyPhrase("行程第 2 天改成火車")).toBe(null);
  });
  it("ambiguous is a soft hint — not a forbidden phrase", () => {
    // "Can you send it again?" is ambiguous (kept + escalated), not unsafe.
    expect(classifyAttachmentReply("Can you send it again?").verdict).toBe("ambiguous");
    expect(findForbiddenReplyPhrase("Can you send it again?")).toBe(null);
  });
});
