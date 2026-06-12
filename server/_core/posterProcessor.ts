/**
 * Round 80.22 Phase H2: Supplier poster processing pipeline.
 *
 * Pipeline (typically ~20s end-to-end):
 *   1. brandPoster()        — Sharp overlay PACK&GO logo + frame on raw image
 *   2. analyzePosterVision() — Claude Vision extracts title/dates/prices/highlights
 *   3. generatePlatformCopy() — One LLM call per platform (7 platforms ~10s parallel)
 *
 * Integration with existing infrastructure:
 *   - Reuses storagePut() for S3 (server/storage.ts)
 *   - Reuses invokeLLM() with image_url support (server/_core/llm.ts)
 *   - Sharp already in package.json
 *
 * Output stored in posterAssets.brandedImageUrl + posterAssets.aiAnalysis
 * + 7 rows in posterPlatformCopies table.
 */
import sharp from "sharp";
import path from "path";
import { promises as fs } from "fs";
import { invokeLLM } from "./llm";
import { generateImage } from "./imageGen";
import { storagePut } from "../storage";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "posterProcessor" });

/**
 * Resolve the PACK&GO logo file from disk (server/assets/packgo-logo-square.png).
 * Cached after first read since the file rarely changes.
 *
 * Falls back to the bag-only logo at client/public/images/logo-black-bag.webp
 * if the dedicated brand logo isn't deployed yet.
 */
let _cachedLogoBuffer: Buffer | null = null;
async function getBrandLogoBuffer(): Promise<Buffer | null> {
  if (_cachedLogoBuffer) return _cachedLogoBuffer;
  const candidates = [
    path.join(process.cwd(), "server/assets/packgo-logo-square.png"),
    path.join(process.cwd(), "client/public/images/logo-black-bag.webp"),
    path.join(process.cwd(), "client/public/images/logo-bag-black-v3.png"),
  ];
  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p);
      log.info({ path: p, bytes: buf.length }, "[Poster] Loaded brand logo");
      _cachedLogoBuffer = buf;
      return buf;
    } catch {
      continue;
    }
  }
  log.warn("[Poster] No brand logo file found — posters will lack logo composite");
  return null;
}

const PLATFORMS = [
  "wechat_moments",
  "wechat_group",
  "xiaohongshu",
  "line",
  "facebook",
  "instagram",
  "newsletter",
] as const;
export type Platform = (typeof PLATFORMS)[number];

const VENDOR_LABEL: Record<string, string> = {
  lion: "雄獅旅遊",
  zongheng: "縱橫旅遊",
  house: "PACK&GO 自家行程",
  other: "合作供應商",
};

const AUDIENCE_LABEL: Record<string, string> = {
  family: "家庭旅遊客群(2-4 人闔家旅行)",
  honeymoon: "蜜月夫妻 / 情侶",
  parent_child: "親子家庭(學齡前 / 學齡兒童)",
  business: "商務旅客 / 高端客戶",
  senior: "銀髮族 / 退休夫妻",
  general: "一般旅客",
};

/* ─────────────────── 1. AI poster generation ─────────────────── */

/**
 * PACK&GO brand visual identity baked into every generated poster.
 * Tweak this when brand evolves — affects ALL future poster generations.
 *
 * IMPORTANT: We instruct AI to LEAVE blank space at top (200px) and bottom
 * (~110px) because the actual PACK&GO logo + reliable footer strip get
 * composited via Sharp post-process. This avoids AI hallucinating a logo
 * or typo'ing the phone number.
 */
const BRAND_STYLE_PROMPT = `
PACK&GO travel agency brand style:
- Color palette: deep black (#0a0a0a) + cream white (#fafaf7) + gold accent (#c9a563)
- Typography: elegant serif for titles, clean sans-serif for body
- Mood: premium, warm, family-friendly, trustworthy, magazine-cover quality
- Layout: hero photo top 60%, info block bottom 35% on cream background
- TOP 220px: leave EMPTY / minimal — a logo will be composited here (do NOT draw any logo, brand mark, wordmark, or text in this top area)
- BOTTOM 130px: leave EMPTY / blank cream-colored strip — a contact info bar will be composited here (do NOT write phone numbers, websites, or contact info in the poster)
- Style is editorial / catalog-quality, NOT cartoonish or stock-photo-vibe
- All text MUST be in Traditional Chinese unless specified
- Visual hierarchy: title biggest, price medium, dates/highlights smaller
- Composition: title and details should sit in the MIDDLE 1500px of the 1792px-tall canvas, NOT in the top 220px nor bottom 130px
`.trim();

/**
 * Generate a brand-new PACK&GO poster from extracted analysis data,
 * using OpenAI gpt-image-2. Replaces the old Sharp logo overlay approach
 * (Round 80.22 H2-2 revision). Cost ~$0.07 per poster (1024x1792 medium).
 */
export async function brandPoster(args: {
  /** AI Vision analysis of the source poster — drives image content. */
  analysis: PosterAnalysis;
  /** Vendor label for footer credit. */
  vendorLabel: string;
}): Promise<{ url: string; cost: number; durationMs: number }> {
  const { analysis, vendorLabel } = args;

  // Build the gpt-image-2 prompt from analysis
  const highlights = (analysis.highlights || [])
    .slice(0, 4)
    .map((h, i) => `  ${i + 1}. ${h}`)
    .join("\n");
  const priceLine = analysis.priceFrom
    ? `Price from ${analysis.priceCurrency || "USD"} ${analysis.priceFrom.toLocaleString()}`
    : "";
  const dateLine = analysis.departureDate ? `Departure: ${analysis.departureDate}` : "";
  const durationLine = analysis.durationDays ? `${analysis.durationDays} days / ${analysis.durationDays - 1} nights` : "";

  const prompt = `
${BRAND_STYLE_PROMPT}

Generate a vertical (1024x1792) tourism promotional poster for this trip:

TITLE (largest, top-center, Traditional Chinese serif):
${analysis.title}

DESTINATION:
${analysis.destination || "(not specified)"}

KEY DETAILS (medium size, below title):
${dateLine}
${durationLine}
${priceLine}

HIGHLIGHTS (small bullets, lower section):
${highlights || "(none)"}

HERO IMAGE:
A high-quality landscape photo of ${analysis.destination || analysis.title} that fills the middle 50% of the poster (below the empty top zone, above the title block). Should look like a professional travel magazine cover photo, NOT a stock photo. Warm natural lighting, vibrant but not oversaturated.

CRITICAL — empty zones for logo + footer composite:
- TOP 220 pixels: pure cream/white, completely empty. NO logo, NO wordmark, NO text. Just clean background. The PACK&GO logo will be added via post-processing — DO NOT draw any logo here.
- BOTTOM 130 pixels: solid cream (#fafaf7) strip, completely empty. NO phone numbers, NO website, NO contact text. The contact strip will be composited via post-processing.

CRITICAL — content rules:
- Use Traditional Chinese 繁體中文 for all text. NO simplified Chinese.
- NO Korean, Japanese, or English-only text in the title area.
- All numbers and pricing should be clearly legible.
- DO NOT draw any brand logo or wordmark — top 220px must be empty
- DO NOT write phone numbers, websites, or contact info — bottom 130px must be empty
- Look like Conde Nast Traveler or Wallpaper magazine quality.
`.trim();

  log.info({ title: analysis.title }, "[Poster] Generating PACK&GO poster via gpt-image-2");
  const result = await generateImage({
    prompt,
    size: "1024x1792",
    quality: "medium",
    timeoutMs: 180_000, // 3 min
  });

  // Sharp post-process: composite real PACK&GO logo + reliable footer strip.
  // gpt-image-2 may try to draw a logo and add contact info from the prompt,
  // but those will be hallucinated / typo-prone. We overlay the real assets
  // on top so brand identity is 100% accurate.
  const finalBuffer = await postProcessWithBrandAssets({
    aiBuffer: result.imageBuffer,
    vendorLabel,
  });

  const fileName = `posters/branded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const { url } = await storagePut(fileName, finalBuffer, "image/png");

  log.info(
    { durationMs: result.durationMs, cost: result.cost, url },
    "[Poster] Generated",
  );
  return { url, cost: result.cost, durationMs: result.durationMs };
}

/**
 * Sharp post-process: take the AI-generated poster and composite:
 *   1. Real PACK&GO logo at top-center (~140px tall)
 *   2. A reliable footer strip with phone/website/CST/supplier credit
 *      (rendered via SVG so text is crisp and never typo'd)
 *
 * If logo file isn't available, only the footer strip is added.
 */
async function postProcessWithBrandAssets(args: {
  aiBuffer: Buffer;
  vendorLabel: string;
}): Promise<Buffer> {
  const { aiBuffer, vendorLabel } = args;
  const logoBuffer = await getBrandLogoBuffer();

  // Get AI image dimensions
  const meta = await sharp(aiBuffer).metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1792;

  // Footer strip: cream background with reliable contact info
  const FOOTER_H = 110;
  const escapedVendor = (vendorLabel || "合作供應商").replace(/[<>&"']/g, "");
  const footerSvg = `
    <svg width="${width}" height="${FOOTER_H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${FOOTER_H}" fill="#fafaf7"/>
      <rect width="${width}" height="3" fill="#c9a563"/>
      <text x="${width / 2}" y="${FOOTER_H / 2 - 8}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#0a0a0a" text-anchor="middle">PACK&amp;GO Travel  ·  +1 (510) 634-2307  ·  packgoplay.com</text>
      <text x="${width / 2}" y="${FOOTER_H / 2 + 22}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#6b6b6b" text-anchor="middle">CST #2166984  ·  行程供應商:${escapedVendor}</text>
    </svg>
  `;
  const footerPng = await sharp(Buffer.from(footerSvg)).png().toBuffer();

  // Composite list — start with footer always
  const composites: sharp.OverlayOptions[] = [
    { input: footerPng, top: height - FOOTER_H, left: 0 },
  ];

  // Logo overlay (top-center) if available — sized to ~140px tall, centered
  if (logoBuffer) {
    try {
      const logoResized = await sharp(logoBuffer)
        .resize({ width: 200, height: 200, fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const logoMeta = await sharp(logoResized).metadata();
      const logoWidth = logoMeta.width || 200;
      composites.unshift({
        input: logoResized,
        top: 30,
        left: Math.round((width - logoWidth) / 2),
      });
    } catch (err) {
      log.error({ err }, "[Poster] Logo composite failed (skipping)");
    }
  }

  return await sharp(aiBuffer).composite(composites).png().toBuffer();
}

/* ─────────────────── 2. AI Vision analysis ─────────────────── */

export interface PosterAnalysis {
  title: string;
  destination?: string;
  departureDate?: string;
  durationDays?: number;
  priceFrom?: number;
  priceCurrency?: string;
  highlights: string[];
  themeColors?: string[];
  suitableAudience?: string;
}

/**
 * Use Claude Vision to extract structured info from a poster image.
 * Returns JSON object with title, dates, prices, highlights.
 */
export async function analyzePosterVision(args: {
  imageUrl: string;
  originalCopyText?: string;
  vendor: string;
}): Promise<PosterAnalysis> {
  const systemPrompt = `你是 PACK&GO 旅行社的視覺分析助手。仔細閱讀供應商海報,擷取關鍵旅遊資訊,輸出 JSON。

你必須以 JSON 格式回覆,不要包含任何 markdown code fence,只輸出純 JSON 物件。

JSON 欄位:
- title (string): 行程主標題,例如 "夏威夷 6 天精選團"
- destination (string, 可選): 目的地,例如 "夏威夷 / 歐胡島"
- departureDate (string, 可選): 出發日期 YYYY-MM-DD 或文字 "2026/07/15"
- durationDays (number, 可選): 天數
- priceFrom (number, 可選): 起價數字(僅數字,不含貨幣符號)
- priceCurrency (string, 可選): "USD" / "TWD" 等
- highlights (string[]): 3-6 個賣點,每個簡短 < 20 字
- themeColors (string[], 可選): 海報主色調 hex code
- suitableAudience (string, 可選): "家庭" / "蜜月" / "親子" / "銀髮族"

如果某欄位無法從海報判斷,省略該欄位(不要填空字串)。`;

  const userPrompt = `供應商:${args.vendor}\n${args.originalCopyText ? `\n供應商原文宣傳文:\n${args.originalCopyText}\n` : ""}\n請分析這張海報,輸出 JSON。`;

  const result = await invokeLLM({
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url" as any, image_url: { url: args.imageUrl } } as any,
          { type: "text" as any, text: userPrompt },
        ] as any,
      },
    ],
    model: "claude-haiku-4-5",
    maxTokens: 1024,
    purpose: "poster_vision_analysis",
  } as any);

  // Round 80.21 v13 bug fix: invokeLLM returns { choices: [{message:{content}}] },
  // NOT a top-level content field. Previous code `result.content?.trim()` was
  // always undefined → raw="{}" → parsed = {} → highlights undefined → crash
  // downstream in generatePlatformCopy.
  const rawContent =
    (result as any)?.choices?.[0]?.message?.content ??
    (result as any)?.content ??
    "";
  let raw = (typeof rawContent === "string" ? rawContent : "").trim() || "{}";
  // Strip code fences if present
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(raw) as Partial<PosterAnalysis>;
    return {
      title: parsed.title || "(AI 未提供標題,請手動輸入)",
      destination: parsed.destination,
      departureDate: parsed.departureDate,
      durationDays: parsed.durationDays,
      priceFrom: parsed.priceFrom,
      priceCurrency: parsed.priceCurrency,
      // Defensive defaults — even when LLM forgets these fields, downstream
      // code (generatePlatformCopy.map(highlights)) won't crash.
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      themeColors: Array.isArray(parsed.themeColors) ? parsed.themeColors : undefined,
      suitableAudience: parsed.suitableAudience,
    };
  } catch (err) {
    log.error({ err, raw }, "[Poster] Vision JSON parse failed");
    return {
      title: "(AI 解析失敗,請手動輸入標題)",
      highlights: [],
    };
  }
}

/* ─────────────────── 3. Multi-platform copy generation ─────────────────── */

const PLATFORM_PROMPT_CONFIG: Record<
  Platform,
  { name: string; instructions: string; maxLength: number; useHashtags: boolean }
> = {
  wechat_moments: {
    name: "微信朋友圈",
    instructions:
      "用 PACK&GO 的個人語氣寫一篇朋友圈貼文。語氣親切、像個熟識的朋友推薦。250 字以內。加 2-3 個自然的 emoji。結尾 CTA 是『想了解請私訊我』或『點連結看詳情』。不要過度商業化,不要硬塞 hashtag。",
    maxLength: 300,
    useHashtags: false,
  },
  wechat_group: {
    name: "微信群",
    instructions:
      "用 PACK&GO 群主推薦的語氣。極度簡短(80 字以內)。直接點出 2 個最強賣點 + 價格 + CTA。要讓人 3 秒內讀完想了解。可加 1 個 emoji。",
    maxLength: 100,
    useHashtags: false,
  },
  xiaohongshu: {
    name: "小紅書",
    instructions:
      "用 PACK&GO 旅行社官方帳號的角度寫小紅書筆記,語氣是「跟讀者推薦行程」而非「KOC 種草」。800 字以內。**禁止編造他人見證**(不可寫「我朋友剛去過」「閨蜜跟我說」這種你沒實際發生的事)。**禁止 25 歲女生 KOC 語氣**(姐妹們、絕絕子、yyds、無腦衝)— PACK&GO 客戶是北美華人 40+ 家庭。結構:勾人開頭(具體景點名/季節亮點)→ 重點細節(具體飯店、餐廳、行程亮點)→ 推薦給誰(具體客群,例如「親子家庭」「夫妻週年」「銀髮自由行」)。最後產出 30+ 個 hashtag(放在 hashtags 欄位)。文案要有畫面感,適合搭配照片。",
    maxLength: 1000,
    useHashtags: true,
  },
  line: {
    name: "LINE",
    instructions:
      "極簡 LINE 群組訊息。20 字標題 + 1-2 句話 + CTA 連結佔位 [link]。整篇不超過 60 字。",
    maxLength: 80,
    useHashtags: false,
  },
  facebook: {
    name: "Facebook",
    instructions:
      "FB 動態貼文。中等長度(300-400 字)。第一行 hook 要強(問句或數字)。中間說明賣點。結尾 CTA + 提到網址 packgoplay.com。可加 3-5 個 hashtag(整合在文末或 hashtags 欄位)。語氣比朋友圈正式但不死板。",
    maxLength: 500,
    useHashtags: true,
  },
  instagram: {
    name: "Instagram",
    instructions:
      "IG 貼文文案。短(150 字以內)。視覺優先(假設讀者已被照片吸引,文字補充氣氛)。emoji 適度使用。最後產出 15-20 個 hashtag(放在 hashtags 欄位,用空格分隔)。",
    maxLength: 200,
    useHashtags: true,
  },
  newsletter: {
    name: "Email Newsletter",
    instructions:
      "正式但溫暖的 email 邀請語氣。500 字。結構:問候開頭 + 為什麼推薦這個行程 + 賣點 bullet list(3-5 點)+ 行程詳情 + CTA(包含 packgoplay.com 連結)+ 簽名。輸出純文字,不要 HTML。",
    maxLength: 700,
    useHashtags: false,
  },
};

export interface GeneratedCopy {
  platform: Platform;
  copyText: string;
  hashtags?: string;
}

/**
 * Generate copy for ONE platform. Returns text + optional hashtags.
 */
export async function generatePlatformCopy(args: {
  platform: Platform;
  posterAnalysis: PosterAnalysis;
  vendorLabel: string;
  audienceLabel: string;
  originalCopyText?: string;
}): Promise<GeneratedCopy> {
  const cfg = PLATFORM_PROMPT_CONFIG[args.platform];
  const systemPrompt = `你是 PACK&GO 旅行社的多平台行銷文案專家。

PACK&GO 品牌定位:
- 美國加州合法登記的中文旅行社(CST #2166984)
- 創辦人 Jeff,專注**北美華人 40+ 家庭精品客製**
- 語氣:溫暖、專業、值得信賴、像家人推薦
- 不過度炒作、不誇張保證
- 強調「我們親自把關」、「中文司導隨行」、「PT 時段日內回覆 + 緊急狀況透過當地 partner 24h 處理」

目標讀者:**北美華人 40+ 家庭**(灣區/洛杉磯/紐約)。他們已經跟過多次團、有錢有時間挑剔。文案要像旅遊雜誌(雄獅、縱橫)而不是 25 歲女生的 KOC 帳號。

禁止以下行為(違反扣分):
- ❌ 編造他人見證(「我朋友剛去過」「閨蜜跟我說」「上個月帶老媽去」等)— 你並未實際去過,不可虛構
- ❌ 寫「24 小時應對」當服務承諾(Jeff 一個人,實際是 PT 日內回覆 + 在地 partner 處理緊急,不要寫成 24h hotline)
- ❌ 空洞行銷詞:精緻、難忘、夢幻、絕美、無敵景觀、必嚐、絕對化、頂級、唯一、第一、100%
- ❌ 25 歲女生 KOC 語氣:姐妹們、絕絕子、yyds、種草到飛起、無腦衝、絕了
- ❌ 過度恐嚇:連續用「請務必」「千萬」「一定要」≥ 2 次

寫作改用:具體景點名、具體飯店品牌(Hilton / Ritz-Carlton)、具體菜色、具體歷史細節。讓事實本身有重量。

寫作平台:${cfg.name}
平台規範:${cfg.instructions}

輸出格式:純文字。${cfg.useHashtags ? "另外給我一個 hashtag 字串(用空格分隔,不要加 # 號)。" : ""}

不要 markdown 程式碼框,直接輸出 JSON:
{
  "copyText": "...",
  ${cfg.useHashtags ? '"hashtags": "海島度假 夏威夷 親子旅遊 ..."' : ""}
}`;

  // Defensive — handle missing highlights gracefully (parent should always
  // provide an array but extra safety since this is the line that crashed
  // in the wild before v13).
  const highlights = Array.isArray(args.posterAnalysis.highlights)
    ? args.posterAnalysis.highlights
    : [];
  const highlightsStr = highlights.length > 0
    ? highlights.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "(供應商海報未明列賣點)";
  const userPrompt = `行程資訊:
- 主題:${args.posterAnalysis.title}
- 目的地:${args.posterAnalysis.destination || "(未提供)"}
- 出發日:${args.posterAnalysis.departureDate || "(未提供)"}
- 天數:${args.posterAnalysis.durationDays || "?"} 天
- 起價:${args.posterAnalysis.priceFrom ? `${args.posterAnalysis.priceCurrency || "USD"} ${args.posterAnalysis.priceFrom}` : "(未提供)"}
- 賣點:
${highlightsStr}

供應商:${args.vendorLabel}(這是行程實際提供商,不要在文案中過度強調 PACK&GO 是中介)
目標客群:${args.audienceLabel}

${args.originalCopyText ? `供應商原宣傳文(供參考,但要重寫成 PACK&GO 版本):\n${args.originalCopyText}\n` : ""}

請以 PACK&GO 的角度,為「${cfg.name}」這個平台寫文案,輸出 JSON。`;

  const result = await invokeLLM({
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    model: "claude-haiku-4-5",
    maxTokens: 1024,
    purpose: "poster_platform_copy",
  } as any);

  // Same fix as analyzePosterVision — invokeLLM returns choices[0].message.content
  const rawContent =
    (result as any)?.choices?.[0]?.message?.content ??
    (result as any)?.content ??
    "";
  let raw = (typeof rawContent === "string" ? rawContent : "").trim() || "{}";
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    // v690 UAT B-04 (+v691 重驗): the LLM sometimes answers
    //   {"text": ..., "hashtags": [...]}                              (shape 1)
    //   {"copyText": ..., "hashtags": "..."}                          (shape 2)
    //   {"platform": ..., "content": {"subject_line": ..., "body": …}} (shape 3)
    // instead of the requested format — accept all three so a raw JSON
    // blob never reaches the copyText column. Mirrors the client-side
    // normalizePlatformCopy (client/src/components/workspace/platformCopy.ts).
    const parsed = JSON.parse(raw) as {
      copyText?: string;
      text?: string;
      content?: Record<string, unknown>;
      hashtags?: string | string[];
    };
    let copyText = parsed.copyText || parsed.text || "";
    let rawTags: unknown = parsed.hashtags;
    if (!copyText && parsed.content && typeof parsed.content === "object") {
      const c = parsed.content;
      const parts: string[] = [];
      for (const k of ["subject_line", "subject", "preview_text", "greeting",
        "intro", "body", "body_text", "text", "copyText", "cta", "closing",
        "signature"]) {
        const v = c[k];
        if (typeof v === "string" && v.trim()) parts.push(v.trim());
        else if (Array.isArray(v)) {
          const lines = v.filter((s): s is string => typeof s === "string");
          if (lines.length > 0) parts.push(lines.join("\n"));
        }
      }
      copyText = parts.join("\n\n");
      if (rawTags == null) rawTags = c.hashtags;
    }
    const hashtags = Array.isArray(rawTags)
      ? rawTags.filter((s): s is string => typeof s === "string").join(" ")
      : typeof rawTags === "string"
        ? rawTags
        : undefined;
    // Still nothing extractable → fall through to the raw-text fallback so
    // the admin at least sees SOMETHING editable.
    if (!copyText) {
      return { platform: args.platform, copyText: raw, hashtags };
    }
    return { platform: args.platform, copyText, hashtags };
  } catch (err) {
    log.error({ err, platform: args.platform, raw }, "[Poster] Copy JSON parse failed");
    // Fallback: use raw text directly
    return { platform: args.platform, copyText: raw };
  }
}

/**
 * Generate copy for ALL 7 platforms in parallel.
 * Returns array of 7 results (one per platform). Failed platforms still
 * return a row with placeholder text so admin can fix.
 */
export async function generateAllPlatformCopies(args: {
  posterAnalysis: PosterAnalysis;
  vendor: string;
  audience: string;
  originalCopyText?: string;
}): Promise<GeneratedCopy[]> {
  const vendorLabel = VENDOR_LABEL[args.vendor] ?? "合作供應商";
  const audienceLabel = AUDIENCE_LABEL[args.audience] ?? "一般旅客";

  const results = await Promise.allSettled(
    PLATFORMS.map((platform) =>
      generatePlatformCopy({
        platform,
        posterAnalysis: args.posterAnalysis,
        vendorLabel,
        audienceLabel,
        originalCopyText: args.originalCopyText,
      })
    )
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    log.error({ err: r.reason, platform: PLATFORMS[i] }, "[Poster] copy generation failed");
    return {
      platform: PLATFORMS[i],
      copyText: `(此平台 AI 生成失敗,請手動編輯)\n\n標題:${args.posterAnalysis.title}`,
      hashtags: undefined,
    };
  });
}

/* ─────────────────── 4. Full pipeline ─────────────────── */

/**
 * End-to-end: takes a raw supplier poster + info, returns:
 *   - AI-generated PACK&GO branded poster URL
 *   - structured analysis
 *   - 7 platform copies
 *
 * Pipeline (~30-40s total, mostly parallel):
 *   1. AI Vision analysis (5s) — extract title, dates, prices, highlights
 *   2. PARALLEL:
 *      a. gpt-image-2 generates PACK&GO poster (15-25s, $0.07)
 *      b. 7 LLM calls generate platform copies (15s parallel)
 *
 * Caller should run this async (e.g., via BullMQ) since 30-40s is too long
 * for an HTTP request.
 */
export async function processPosterFull(args: {
  originalImageUrl: string;
  originalCopyText?: string;
  vendor: string;
  audience: string;
}): Promise<{
  brandedImageUrl: string;
  brandedImageCost: number;
  analysis: PosterAnalysis;
  copies: GeneratedCopy[];
}> {
  const vendorLabel = VENDOR_LABEL[args.vendor] ?? "合作供應商";

  // 1. AI Vision analysis (must run first — drives both branded image + copy)
  const analysis = await analyzePosterVision({
    imageUrl: args.originalImageUrl,
    originalCopyText: args.originalCopyText,
    vendor: vendorLabel,
  });

  // 2. Parallel: branded image + 7 platform copies
  const [brandResult, copies] = await Promise.all([
    brandPoster({ analysis, vendorLabel }),
    generateAllPlatformCopies({
      posterAnalysis: analysis,
      vendor: args.vendor,
      audience: args.audience,
      originalCopyText: args.originalCopyText,
    }),
  ]);

  return {
    brandedImageUrl: brandResult.url,
    brandedImageCost: brandResult.cost,
    analysis,
    copies,
  };
}
