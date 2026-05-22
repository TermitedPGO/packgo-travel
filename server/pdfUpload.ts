/**
 * PDF Upload API
 * 處理 PDF 檔案上傳，用於 AI 行程生成
 */

import { Router, Request, Response } from "express";
import { storagePut } from "./storage";
import { randomBytes } from "crypto";
import multer from "multer";
import { requireAdmin } from "./_core/requireAdmin";

export const pdfUploadRouter = Router();

// SECURITY_AUDIT_2026_05_14 P0-3: 100MB PDF uploads were anonymous.
// Tour generation from PDF is an admin-only workflow today, so locking
// these to admin breaks nothing.
//
// 2026-05-22 — moved from router-level to per-route middleware (see
// avatarUpload.ts header — router was intercepting /api/trpc/*).

// 設定 multer 使用記憶體儲存，不限制檔案大小
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB 上限
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // 只接受 PDF 檔案
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

/**
 * 上傳 PDF 檔案
 * POST /api/pdf/upload
 * Body: multipart/form-data with 'pdf' field
 * Returns: { url: string, key: string, filename: string, size: number }
 */
pdfUploadRouter.post("/pdf/upload", requireAdmin, upload.single("pdf"), async (req: Request, res: Response) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      return res.status(400).json({ error: "No PDF file provided" });
    }

    console.log(`[PDFUpload] Received PDF: ${file.originalname}, size: ${file.size} bytes`);

    // 生成唯一的檔案名稱
    const randomSuffix = randomBytes(8).toString("hex");
    const timestamp = Date.now();
    const sanitizedName = file.originalname
      .replace(/\.pdf$/i, "")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff-_]/g, "-")
      .substring(0, 50);
    const fileName = `${sanitizedName}-${timestamp}-${randomSuffix}.pdf`;
    const fileKey = `pdf-uploads/${fileName}`;

    // 上傳到 S3
    const { url } = await storagePut(fileKey, file.buffer, "application/pdf");

    console.log(`[PDFUpload] Uploaded PDF to S3: ${url}`);

    res.json({
      url,
      key: fileKey,
      filename: file.originalname,
      size: file.size,
    });
  } catch (error: any) {
    console.error("[PDFUpload] Upload error:", error);
    res.status(500).json({ error: error.message || "Failed to upload PDF" });
  }
});

/**
 * 上傳 PDF 檔案（Base64 格式）
 * POST /api/pdf/upload-base64
 * Body: { pdf: base64 string, filename: string }
 * Returns: { url: string, key: string, filename: string, size: number }
 */
pdfUploadRouter.post("/pdf/upload-base64", requireAdmin, async (req, res) => {
  try {
    const { pdf, filename } = req.body;

    if (!pdf || typeof pdf !== "string") {
      return res.status(400).json({ error: "Invalid PDF data" });
    }

    // 支援 data URL 格式或純 base64
    let base64Data = pdf;
    if (pdf.startsWith("data:application/pdf;base64,")) {
      base64Data = pdf.replace("data:application/pdf;base64,", "");
    }

    const buffer = Buffer.from(base64Data, "base64");

    console.log(`[PDFUpload] Received Base64 PDF: ${filename || "unnamed"}, size: ${buffer.length} bytes`);

    // 生成唯一的檔案名稱
    const randomSuffix = randomBytes(8).toString("hex");
    const timestamp = Date.now();
    const sanitizedName = (filename || "document")
      .replace(/\.pdf$/i, "")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff-_]/g, "-")
      .substring(0, 50);
    const fileName = `${sanitizedName}-${timestamp}-${randomSuffix}.pdf`;
    const fileKey = `pdf-uploads/${fileName}`;

    // 上傳到 S3
    const { url } = await storagePut(fileKey, buffer, "application/pdf");

    console.log(`[PDFUpload] Uploaded PDF to S3: ${url}`);

    res.json({
      url,
      key: fileKey,
      filename: filename || "document.pdf",
      size: buffer.length,
    });
  } catch (error: any) {
    console.error("[PDFUpload] Upload error:", error);
    res.status(500).json({ error: error.message || "Failed to upload PDF" });
  }
});
