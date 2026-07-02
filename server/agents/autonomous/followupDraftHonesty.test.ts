/**
 * followupDraftHonesty tests — the 6/29 incident, codified:
 * a follow-up draft on Emerald's thread opened "Hi Leslie" (wrong person) AND
 * claimed "quotes 已寄" with zero delivery records. Both must block the card.
 * Precision guards are load-bearing too: future promises (我會寄 / I will send)
 * and no-name greetings must NEVER trip, and UNKNOWN evidence must fail OPEN.
 */
import { describe, it, expect } from "vitest";

import {
  detectDeliveryClaim,
  hasAnyDeliveryEvidence,
  parseAddress,
  parseFromHeader,
  emailLocalPart,
  pickCounterpartyEmail,
  extractGreetingName,
  collectAllowedGreetingNames,
  isGreetingNameAllowed,
  checkFollowupDraftHonesty,
  type DeliveryEvidence,
} from "./followupDraftHonesty";

const NO_EVIDENCE: DeliveryEvidence = {
  quoteSent: false,
  confirmed: false,
  deliveredDocFileNames: [],
};

describe("detectDeliveryClaim — strong past-tense claims only", () => {
  it.each([
    ["報價已寄給您,再麻煩您看一下"],
    ["資料我們已提供,請查收"],
    ["行程已確認,等您回覆"],
    ["已經寄過去了"],
    ["附上了新的報價單"],
    ["如先前寄出的報價,價格不變"],
    ["报价已发送,请查收"], // 簡體
    ["订单已确认"], // 簡體
    ["先前的 quotes 已寄,您參考一下"], // the real 6/29 phrasing
  ])("zh positive: %s", (text) => {
    expect(detectDeliveryClaim(text)).toBe(true);
  });

  it.each([
    ["I've sent the quotes over last week."],
    ["I have sent the itinerary to your email."],
    ["We sent the quote on Monday."],
    ["We've sent everything you asked for."],
    ["As promised, the quote is in your inbox."],
    ["Attached is the updated quote."],
    ["Attached are the two itineraries."],
    ["The quote was already sent to you."],
    ["We have already provided the pricing."],
    ["Your booking is already confirmed."],
  ])("en positive: %s", (text) => {
    expect(detectDeliveryClaim(text)).toBe(true);
  });

  it.each([
    ["我會寄報價給您"], // future promise
    ["我晚點寄給您,請稍等"],
    ["週五可以來取,護照都好了"], // the pickup-promise case
    ["之後會提供詳細行程"],
    ["確認好我再跟您說"], // 確認 without 已
    ["I will send the quote tomorrow."],
    ["We can send it over whenever you're ready."],
    ["I'll get the quote to you by Friday."],
    ["Happy to send more options if helpful."],
    ["Just checking in, no rush at all."],
  ])("future / neutral negative: %s", (text) => {
    expect(detectDeliveryClaim(text)).toBe(false);
  });
});

describe("hasAnyDeliveryEvidence", () => {
  it("empty evidence → false", () => {
    expect(hasAnyDeliveryEvidence(NO_EVIDENCE)).toBe(false);
  });
  it.each([
    [{ ...NO_EVIDENCE, quoteSent: true }],
    [{ ...NO_EVIDENCE, confirmed: true }],
    [{ ...NO_EVIDENCE, deliveredDocFileNames: ["台灣報價_2026.pdf"] }],
  ])("any single signal → true", (e) => {
    expect(hasAnyDeliveryEvidence(e as DeliveryEvidence)).toBe(true);
  });
});

describe("parseAddress / parseFromHeader / emailLocalPart", () => {
  it("Name <email> form", () => {
    expect(parseAddress("Leslie Green <leslie.green@axt.com>")).toEqual({
      name: "Leslie Green",
      email: "leslie.green@axt.com",
    });
  });
  it('quoted "Name" <email> form + lowercases email', () => {
    expect(parseAddress('"Young, Emerald" <EYoung@AXT.com>')).toEqual({
      name: "Young, Emerald",
      email: "eyoung@axt.com",
    });
  });
  it("bare email form", () => {
    expect(parseAddress("eyoung@axt.com")).toEqual({ name: null, email: "eyoung@axt.com" });
  });
  it("parseFromHeader reads the filed header block at content start", () => {
    expect(
      parseFromHeader("From: Leslie Green <leslie@axt.com>\nSubject: Re: quote\n\nHi Jeff,"),
    ).toEqual({ name: "Leslie Green", email: "leslie@axt.com" });
  });
  it("parseFromHeader ignores a mid-body quoted From line (not at start)", () => {
    expect(parseFromHeader("Thanks!\n\n> From: Someone <x@y.com>\n> hi")).toBeNull();
  });
  it("parseFromHeader null for header-less backfilled content", () => {
    expect(parseFromHeader("就是想問一下八月的團")).toBeNull();
    expect(parseFromHeader(null)).toBeNull();
  });
  it("emailLocalPart", () => {
    expect(emailLocalPart("leslie.green@axt.com")).toBe("leslie.green");
    expect(emailLocalPart("not-an-email")).toBeNull();
    expect(emailLocalPart(null)).toBeNull();
  });
});

describe("pickCounterpartyEmail — 收件人 = the thread's real From (the merged-card fix)", () => {
  const inbound = (content: string) => ({ direction: "inbound" as const, content });
  const outbound = (content: string) => ({ direction: "outbound" as const, content });

  it("uses the newest inbound From, not the profile email (leslie→Emerald merge)", () => {
    expect(
      pickCounterpartyEmail(
        [
          outbound("報價附上"), // newest = ours
          inbound("From: Leslie Green <leslie@axt.com>\nSubject: quote\n\ncan you quote?"),
          inbound("From: Emerald Young <eyoung@axt.com>\nSubject: old\n\nolder mail"),
        ],
        "eyoung@axt.com",
      ),
    ).toBe("leslie@axt.com");
  });
  it("walks past a header-less backfilled inbound to an older one WITH a From", () => {
    expect(
      pickCounterpartyEmail(
        [
          inbound("裸內文,threadFiling 補的"), // no header
          inbound("From: Leslie Green <leslie@axt.com>\nSubject: x\n\nhello"),
        ],
        "eyoung@axt.com",
      ),
    ).toBe("leslie@axt.com");
  });
  it("falls back to the profile email when no inbound has a From", () => {
    expect(pickCounterpartyEmail([outbound("hi"), inbound("裸內文")], "eyoung@axt.com")).toBe(
      "eyoung@axt.com",
    );
  });
});

describe("extractGreetingName", () => {
  it.each([
    ["Hi Leslie,\n\nJust checking in.", "Leslie"],
    ["Dear Emerald Young,\nHope you are well.", "Emerald Young"],
    ["Hello Jenny, hope the trip planning is going well.", "Jenny"],
    ["王姊姊您好,上次聊到的行程還留著。", "王"],
    ["Leslie 您好,想跟您確認一下。", "Leslie"],
    ["王姊,\n上次的報價您看了嗎", "王"],
    ["陳先生您好:", "陳"],
  ])("extracts a name: %s → %s", (body, name) => {
    expect(extractGreetingName(body)).toBe(name);
  });

  it.each([
    ["您好,想跟您確認一下行程。"], // no-name zh greeting
    ["Hi,\n\nJust checking in."],
    ["Hi there,\n\nJust following up."], // stopword
    ["Dear valued customer,"], // generic, not a person
    ["Hi hope you are doing well and had a great weekend."], // sentence, not a name
    ["就想問一下您那邊考慮得怎麼樣了。"], // no greeting at all
    [""],
  ])("no confident name → null (gate passes): %s", (body) => {
    expect(extractGreetingName(body)).toBeNull();
  });
});

describe("collectAllowedGreetingNames + isGreetingNameAllowed", () => {
  const rows = [
    { direction: "outbound" as const, content: "報價附上" },
    {
      direction: "inbound" as const,
      content: "From: Leslie Green <leslie.green@axt.com>\nSubject: quote\n\nplease quote",
    },
    { direction: "inbound" as const, content: "裸內文 backfill,無 header" },
  ];

  it("collects From display names, email local-parts, and the profile identity", () => {
    const names = collectAllowedGreetingNames({
      rowsNewestFirst: rows,
      profileName: "Emerald Young",
      profileEmail: "eyoung@axt.com",
    });
    expect(names).toContain("Leslie Green");
    expect(names).toContain("leslie.green");
    expect(names).toContain("Emerald Young");
    expect(names).toContain("eyoung");
  });

  it("first-name match: Hi Leslie ↔ Leslie Green", () => {
    expect(isGreetingNameAllowed("Leslie", ["Leslie Green"])).toBe(true);
  });
  it("case-insensitive + email local-part token match", () => {
    expect(isGreetingNameAllowed("leslie", ["leslie.green"])).toBe(true);
  });
  it("zh 稱呼: greeting 「王」 matches profile 「王美麗」 (surname prefix)", () => {
    expect(isGreetingNameAllowed("王", ["王美麗"])).toBe(true);
  });
  it("unknown name blocks: Hi Leslie on Emerald's clean thread", () => {
    expect(isGreetingNameAllowed("Leslie", ["Emerald Young", "eyoung"])).toBe(false);
  });
  it("EN tokens are exact — 'Le' must NOT prefix-match 'Leslie'", () => {
    expect(isGreetingNameAllowed("Le", ["Leslie Green"])).toBe(false);
  });

  it("harvests Jeff's outbound 稱呼 (the drafter's mandated name source)", () => {
    // followupDrafter tells the LLM to reuse how JEFF addressed the customer —
    // that 稱呼 lives in OUTBOUND content, which the collector must read.
    const names = collectAllowedGreetingNames({
      rowsNewestFirst: [
        { direction: "outbound" as const, content: "陳姊您好,行程幫您留著,不急。" },
        {
          direction: "inbound" as const,
          content: "From: Jenny Chen <jchen88@gmail.com>\nSubject: 台灣行\n\n想再看一下報價",
        },
      ],
      profileName: "Jenny Chen",
      profileEmail: "jchen88@gmail.com",
    });
    expect(names).toContain("陳");
    expect(names).toContain("Jenny Chen");
  });

  it("outbound rows without a greeting contribute nothing (報價附上)", () => {
    const names = collectAllowedGreetingNames({
      rowsNewestFirst: [{ direction: "outbound" as const, content: "報價附上,再麻煩您看一下。" }],
      profileName: null,
      profileEmail: null,
    });
    expect(names).toEqual([]);
  });

  it("outbound greeting is read past a filed From/Subject header block", () => {
    const names = collectAllowedGreetingNames({
      rowsNewestFirst: [
        {
          direction: "outbound" as const,
          content: "From: PACK&GO <support@packgoplay.com>\nSubject: Re: 台灣行\n\n王姊姊您好,上次聊到的行程都留著。",
        },
      ],
      profileName: null,
      profileEmail: null,
    });
    expect(names).toContain("王");
  });

  it("CJK greeting with ZERO CJK allowed names = UNKNOWN → passes (Jenny Chen ↔ 陳姊 bridge)", () => {
    // Records are romanized; we cannot deterministically map 陳↔Chen, so the
    // gate must not block the 慣稱 draft Jeff mandates.
    expect(isGreetingNameAllowed("陳", ["Jenny Chen", "jchen88"])).toBe(true);
  });

  it("CJK greeting still blocks when CJK evidence exists and mismatches (王 on 陳姊's thread)", () => {
    expect(isGreetingNameAllowed("王", ["陳", "Jenny Chen", "jchen88"])).toBe(false);
  });
});

describe("checkFollowupDraftHonesty — the combined gate", () => {
  const allowed = ["Emerald Young", "eyoung"];

  it("blocks the real 6/29 draft: Hi Leslie + quotes 已寄 with zero evidence", () => {
    const res = checkFollowupDraftHonesty({
      body: "Hi Leslie,\n\n先前的 quotes 已寄,再麻煩您看一下有沒有想調整的。",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: allowed,
    });
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("unverified_delivery_claim");
    expect(res.violations).toContain("greeting_unknown_recipient");
    expect(res.greetingName).toBe("Leslie");
  });

  it("claim + real quote evidence → passes", () => {
    const res = checkFollowupDraftHonesty({
      body: "Emerald 您好,報價已寄,再麻煩您看一下。",
      evidence: { ...NO_EVIDENCE, quoteSent: true },
      allowedGreetingNames: allowed,
    });
    expect(res.ok).toBe(true);
  });

  it("claim + delivered doc evidence → passes", () => {
    const res = checkFollowupDraftHonesty({
      body: "您好,行程表已寄到您信箱,再麻煩您看一下。",
      evidence: { ...NO_EVIDENCE, deliveredDocFileNames: ["台灣12天行程_2026.pdf"] },
      allowedGreetingNames: allowed,
    });
    expect(res.ok).toBe(true);
  });

  it("claim + UNKNOWN evidence (lookup failed) → fails OPEN with a warn flag", () => {
    const res = checkFollowupDraftHonesty({
      body: "您好,報價已寄,再麻煩您看一下。",
      evidence: null,
      allowedGreetingNames: allowed,
    });
    expect(res.ok).toBe(true);
    expect(res.claimWithUnknownEvidence).toBe(true);
  });

  it("future promise + zero evidence → passes (precision guard)", () => {
    const res = checkFollowupDraftHonesty({
      body: "Emerald 您好,報價我會寄給您,週五也可以來取件。",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: allowed,
    });
    expect(res.ok).toBe(true);
    expect(res.claimWithUnknownEvidence).toBe(false);
  });

  it("English future promise → passes", () => {
    const res = checkFollowupDraftHonesty({
      body: "Hi Emerald, I will send the updated quote tomorrow. No rush at all.",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: allowed,
    });
    expect(res.ok).toBe(true);
  });

  it("no-name greeting always passes the 抬頭 gate", () => {
    const res = checkFollowupDraftHonesty({
      body: "您好,想跟您確認一下上次的行程還有沒有興趣。",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: [],
    });
    expect(res.ok).toBe(true);
  });

  it("greeting matching the thread's From name passes (Leslie on Leslie's thread)", () => {
    const res = checkFollowupDraftHonesty({
      body: "Hi Leslie, just checking in on the quote request.",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: collectAllowedGreetingNames({
        rowsNewestFirst: [
          {
            direction: "inbound",
            content: "From: Leslie Green <leslie@axt.com>\nSubject: quote\n\nplease quote",
          },
        ],
        profileName: "Emerald Young",
        profileEmail: "eyoung@axt.com",
      }),
    });
    expect(res.ok).toBe(true);
  });

  it("the 慣稱 draft passes: Jeff called her 陳姊 before, records are romanized (Jenny Chen)", () => {
    const res = checkFollowupDraftHonesty({
      body: "陳姊,\n最近還好嗎?上次的行程都幫您留著,不急,您方便再回我一聲就好。",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: collectAllowedGreetingNames({
        rowsNewestFirst: [
          { direction: "outbound", content: "陳姊您好,報價我整理好就給您。" },
          {
            direction: "inbound",
            content: "From: Jenny Chen <jchen88@gmail.com>\nSubject: 台灣行\n\n想問一下八月的團",
          },
        ],
        profileName: "Jenny Chen",
        profileEmail: "jchen88@gmail.com",
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.greetingName).toBe("陳");
  });

  it("greeting mismatch + allowedNamesIncomplete (name lookup failed) → fails OPEN with a warn flag", () => {
    // Finding: evidence lookup failure used to null profileName and flip the
    // greeting gate to a false block. UNKNOWN must fail open on BOTH gates.
    const res = checkFollowupDraftHonesty({
      body: "Hi Emerald, just checking in.",
      evidence: null,
      allowedGreetingNames: ["eyoung"], // bare-address From headers only
      allowedNamesIncomplete: true,
    });
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
    expect(res.greetingWithUnknownNames).toBe(true);
  });

  it("same mismatch with a COMPLETE name set still blocks (fail-open is lookup-failure only)", () => {
    const res = checkFollowupDraftHonesty({
      body: "Hi Leslie, just checking in.",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: allowed,
      allowedNamesIncomplete: false,
    });
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("greeting_unknown_recipient");
    expect(res.greetingWithUnknownNames).toBe(false);
  });

  it("a MATCHED greeting never sets the unknown-names flag, even when incomplete", () => {
    const res = checkFollowupDraftHonesty({
      body: "Hi Emerald, just checking in.",
      evidence: NO_EVIDENCE,
      allowedGreetingNames: allowed,
      allowedNamesIncomplete: true,
    });
    expect(res.ok).toBe(true);
    expect(res.greetingWithUnknownNames).toBe(false);
  });
});
