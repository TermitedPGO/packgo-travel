/**
 * PDF Text Extractor
 * 三層策略提取 PDF 文字內容：
 * 1. pdf-parse（純 Node.js，速度最快）
 * 2. pdftotext（系統工具，處理複雜排版）
 * 3. 直接傳 PDF URL 給 LLM（最後備援）
 */
import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";
import * as http from "http";

export interface PdfTextResult {
  text: string;
  pageCount: number;
  method: "pdf-parse" | "pdftotext" | "llm-direct";
  hasText: boolean; // false 表示可能是掃描版 PDF
  charCount: number;
}

/**
 * 從 URL 下載 PDF 到暫存目錄
 */
async function downloadPdf(url: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fsSync.createWriteStream(tmpFile);

    protocol
      .get(url, (response) => {
        // 處理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          const redirectUrl = response.headers.location!;
          downloadPdf(redirectUrl).then(resolve).catch(reject);
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(tmpFile);
        });
      })
      .on("error", (err) => {
        fs.unlink(tmpFile).catch(() => {});
        reject(err);
      });
  });
}

/**
 * 方法一：使用 pdf-parse 提取文字（純 Node.js）
 *
 * pdf-attachment-reliability (2026-07-15):pdf-parse 一律走
 * `_core/pdfParse.ts` 單一 adapter(v2 class API:new PDFParse({data}) →
 * getText → destroy)。此檔不再自行解析 pdf-parse 模組形狀 — 上次就是
 * 這裡與 attachmentParser 各養一套 resolver,v1→v2 升版後兩套一起爛。
 */
async function extractWithPdfParse(pdfBuffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const { extractPdfTextPrimary } = await import("../_core/pdfParse");
  return extractPdfTextPrimary(pdfBuffer); // 內建 50 頁上限
}

/**
 * 方法二：使用系統 pdftotext 提取文字（處理複雜排版）
 */
async function extractWithPdftotext(pdfFilePath: string): Promise<string> {
  try {
    // -layout 保留排版，-enc UTF-8 確保中文正確
    const result = execSync(`pdftotext -layout -enc UTF-8 "${pdfFilePath}" -`, {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 30000,
    });
    return result.toString("utf-8");
  } catch (error) {
    console.warn("[PdfTextExtractor] pdftotext failed:", error);
    return "";
  }
}

/**
 * 判斷提取的文字是否有效（非空白、非亂碼）
 */
function isValidText(text: string): boolean {
  if (!text || text.trim().length < 50) return false;

  // 計算中文字符比例（旅遊 PDF 通常含大量中文）
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = text.replace(/\s/g, "").length;

  if (totalChars === 0) return false;

  // 有意義的文字：中文比例 > 5% 或總字符數 > 200
  return chineseChars / totalChars > 0.05 || totalChars > 200;
}

/**
 * 主要入口：從 PDF URL 提取文字
 * 依序嘗試三種方法，回傳最佳結果
 */
export async function extractTextFromPdf(pdfUrl: string): Promise<PdfTextResult> {
  console.log(`[PdfTextExtractor] Starting text extraction from: ${pdfUrl}`);
  let tmpFilePath: string | null = null;

  try {
    // 下載 PDF 到暫存目錄
    console.log("[PdfTextExtractor] Downloading PDF...");
    tmpFilePath = await downloadPdf(pdfUrl);
    const pdfBuffer = await fs.readFile(tmpFilePath);
    console.log(`[PdfTextExtractor] PDF downloaded: ${pdfBuffer.length} bytes`);

    // === 方法一：pdf-parse ===
    try {
      console.log("[PdfTextExtractor] Trying pdf-parse...");
      const { text, pageCount } = await extractWithPdfParse(pdfBuffer);

      if (isValidText(text)) {
        console.log(
          `[PdfTextExtractor] pdf-parse succeeded: ${text.length} chars, ${pageCount} pages`
        );
        return {
          text: text.trim(),
          pageCount,
          method: "pdf-parse",
          hasText: true,
          charCount: text.trim().length,
        };
      }
      console.log(
        `[PdfTextExtractor] pdf-parse text insufficient (${text.length} chars), trying pdftotext...`
      );
    } catch (err) {
      console.warn("[PdfTextExtractor] pdf-parse failed:", err);
    }

    // === 方法二：pdftotext（系統工具）===
    try {
      console.log("[PdfTextExtractor] Trying pdftotext...");
      const text = await extractWithPdftotext(tmpFilePath);

      if (isValidText(text)) {
        // 取得頁數
        let pageCount = 0;
        try {
          const info = execSync(`pdfinfo "${tmpFilePath}" 2>/dev/null | grep "Pages:" | awk '{print $2}'`);
          pageCount = parseInt(info.toString().trim()) || 0;
        } catch {}

        console.log(
          `[PdfTextExtractor] pdftotext succeeded: ${text.length} chars, ${pageCount} pages`
        );
        return {
          text: text.trim(),
          pageCount,
          method: "pdftotext",
          hasText: true,
          charCount: text.trim().length,
        };
      }
      console.log(
        `[PdfTextExtractor] pdftotext text insufficient (${text.length} chars), falling back to LLM direct`
      );
    } catch (err) {
      console.warn("[PdfTextExtractor] pdftotext failed:", err);
    }

    // === 方法三：直接傳給 LLM（掃描版 PDF 備援）===
    console.log("[PdfTextExtractor] Falling back to LLM direct mode (scanned PDF)");
    return {
      text: "",
      pageCount: 0,
      method: "llm-direct",
      hasText: false,
      charCount: 0,
    };
  } finally {
    // 清理暫存檔案
    if (tmpFilePath) {
      fs.unlink(tmpFilePath).catch(() => {});
    }
  }
}

/**
 * 截斷文字以符合 LLM token 限制
 * 保留前後各 30% 的內容（行程通常在前半，費用在後半）
 */
export function truncateForLLM(text: string, maxChars: number = 80000): string {
  if (text.length <= maxChars) return text;

  const frontPart = Math.floor(maxChars * 0.6);
  const backPart = maxChars - frontPart;

  return (
    text.slice(0, frontPart) +
    "\n\n[... 中間內容已省略 ...]\n\n" +
    text.slice(-backPart)
  );
}
