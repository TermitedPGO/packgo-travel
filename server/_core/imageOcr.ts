/**
 * imageOcr — read a customer-supplied image (poster / itinerary screenshot /
 * scan) via Claude vision, so the agent can actually understand it instead of
 * bouncing it back as "too large / can't read".
 *
 * 起因(2026-06-13,Jeff):客人 Jenny 附 16.6MB 行程海報,系統因「檔案過大」
 * 退回、叫客人重傳 → 來來回回好幾次。Jeff:「檔案大是我們的問題,我們應該要
 * 考慮怎麼讀。」我們已經有 sharp + invokeLLM 的 image_url 視覺能力(見
 * posterProcessor.analyzePosterVision),只是從沒接到附件閱讀上。
 *
 * 流程:sharp 先縮圖(壓進 Anthropic 視覺上限 + 省 token)→ 一次視覺呼叫把
 * 圖裡的文字逐字 + 行程重點擷取成純文字。永不 throw — 失敗回 {ok:false},
 * 由 caller fallback(只有「真的讀不出」才請客人重傳,不是因為我們的大小限制)。
 */
import sharp from "sharp";
import { invokeLLM } from "./llm";
import { logger } from "./logger";

const log = logger.child({ mod: "imageOcr" });

/** Anthropic 視覺對 >1568px 邊長本來就會縮;先縮到這以內省頻寬 + token。 */
const MAX_EDGE = 1568;
/** 與 posterProcessor 同款:haiku 視覺,OCR 夠用且便宜。 */
const VISION_MODEL = "claude-haiku-4-5";

export interface ImageOcrResult {
  ok: boolean;
  text: string;
}

const SYSTEM_PROMPT = `你是 PACK&GO 旅行社的附件閱讀助手。客人寄來一張圖片(可能是行程海報、行程截圖、或掃描件)。
請逐字擷取圖片裡所有看得到的文字,並在最後用條列整理出可辨識的旅遊重點:
目的地、天數/晚數、出發日期、每日城市或景點、住宿、交通(含火車/航班型號如有)、價格(若有,連幣別)、包含與不含項目。
規則:用圖片本身的語言輸出純文字;不要 markdown 標記;絕對不要編造圖片裡看不到的內容。
若圖片完全沒有可辨識的文字或內容,只回一行:圖片無可辨識內容。`;

/**
 * Downscale + vision-read an image. Returns {ok:true,text} with the extracted
 * content, or {ok:false,text:""} on any failure (bad image / model error /
 * genuinely-empty image) so the caller can fall back to a placeholder.
 */
export async function extractImageText(
  data: Buffer,
  filename: string,
): Promise<ImageOcrResult> {
  let dataUrl: string;
  try {
    const jpeg = await sharp(data)
      .rotate() // respect EXIF orientation
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
    dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), filename },
      "[imageOcr] sharp could not decode image",
    );
    return { ok: false, text: "" };
  }

  try {
    const result = await invokeLLM({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url" as const, image_url: { url: dataUrl } },
            { type: "text" as const, text: `檔名:${filename}。請讀這張圖。` },
          ],
        },
      ],
      model: VISION_MODEL,
      maxTokens: 2048,
      purpose: "attachment_image_ocr",
    } as Parameters<typeof invokeLLM>[0]);

    const raw =
      (result as { choices?: Array<{ message?: { content?: unknown } }> })
        ?.choices?.[0]?.message?.content ?? "";
    const text = (typeof raw === "string" ? raw : "").trim();
    if (!text || /圖片無可辨識內容|no readable (text|content)/i.test(text)) {
      return { ok: false, text: "" };
    }
    return { ok: true, text };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), filename },
      "[imageOcr] vision call failed",
    );
    return { ok: false, text: "" };
  }
}

const PDF_SYSTEM_PROMPT = `你是 PACK&GO 旅行社的附件閱讀助手。這是客人寄來的 PDF(可能是打字的、也可能是掃描/拍照轉成的)。
請逐字擷取所有看得到的文字,並在最後條列旅遊重點:目的地、天數/晚數、出發日期、每日城市或景點、住宿、交通、價格(連幣別)、包含與不含項目、護照/旅客資料(若有)。
用文件本身的語言輸出純文字,不要 markdown,不要編造看不到的內容。若完全無可辨識內容,只回一行:檔案無可辨識內容。`;

/**
 * Read a PDF via Claude's native document support — works on scanned /
 * photographed PDFs too (no text layer), which pdf-parse can't. Used as the
 * fallback when text extraction comes back thin. Never throws.
 */
export async function extractPdfText(
  data: Buffer,
  filename: string,
): Promise<ImageOcrResult> {
  try {
    const dataUrl = `data:application/pdf;base64,${data.toString("base64")}`;
    const result = await invokeLLM({
      system: PDF_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "file_url" as const, file_url: { url: dataUrl, mime_type: "application/pdf" } },
            { type: "text" as const, text: `檔名:${filename}。請讀這份 PDF。` },
          ],
        },
      ],
      model: VISION_MODEL,
      maxTokens: 4096,
      purpose: "attachment_pdf_read",
    } as Parameters<typeof invokeLLM>[0]);

    const raw =
      (result as { choices?: Array<{ message?: { content?: unknown } }> })
        ?.choices?.[0]?.message?.content ?? "";
    const text = (typeof raw === "string" ? raw : "").trim();
    if (!text || /檔案無可辨識內容|no readable (text|content)/i.test(text)) {
      return { ok: false, text: "" };
    }
    return { ok: true, text };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), filename },
      "[imageOcr] pdf read failed",
    );
    return { ok: false, text: "" };
  }
}
