/**
 * General Image Upload API
 * 處理通用圖片上傳（非行程特定的圖片，如首頁 Hero、目的地等）
 * 
 * Routes:
 *   POST /api/upload/image      - 通用圖片上傳（FormData: image file）
 *   POST /api/upload/tour-image - 行程相關圖片上傳（FormData: file + type）
 */
import { Router } from "express";
import { storagePut } from "./storage";
import { randomBytes } from "crypto";
import sharp from "sharp";
import multer from "multer";
import { requireAdmin } from "./_core/requireAdmin";

export const generalImageUploadRouter = Router();

// SECURITY_AUDIT_2026_05_14 P0-4: hero/destination inline-edit uploads
// were anonymous. These feed EditableHero + EditableDestinations which
// are admin-only UI surfaces, so gate at the router level.
generalImageUploadRouter.use(requireAdmin);

// multer 設定:記憶體存儲,最大 10MB
// 2026-05-17 red-team round 5 — strict MIME allowlist. `image/*` accepts
// svg+xml which can embed <script> → stored XSS risk. Restrict to
// raster formats that browsers can't execute code from.
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("只允許 JPEG/PNG/WebP/GIF 格式"));
    }
  },
});

// 圖片尺寸配置
const IMAGE_SIZES: Record<string, { width: number; height: number }> = {
  hero: { width: 1920, height: 1080 },
  destination: { width: 800, height: 600 },
  feature: { width: 800, height: 600 },
  default: { width: 1200, height: 900 },
};

// WebP 品質
const WEBP_QUALITY = 82;

/**
 * 壓縮和優化圖片
 */
async function optimizeImage(
  buffer: Buffer,
  type: string
): Promise<{ buffer: Buffer; format: string; originalSize: number; optimizedSize: number }> {
  const originalSize = buffer.length;
  const sizeConfig = IMAGE_SIZES[type] || IMAGE_SIZES.default;

  try {
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;
    const needsResize = originalWidth > sizeConfig.width || originalHeight > sizeConfig.height;

    let pipeline = sharp(buffer);

    if (needsResize) {
      pipeline = pipeline.resize(sizeConfig.width, sizeConfig.height, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const optimizedBuffer = await pipeline
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();

    const optimizedSize = optimizedBuffer.length;
    console.log(
      `[GeneralImageUpload] Optimized: ${originalSize} -> ${optimizedSize} bytes (${((originalSize - optimizedSize) / originalSize * 100).toFixed(1)}% reduction)`
    );

    return { buffer: optimizedBuffer, format: "webp", originalSize, optimizedSize };
  } catch (error) {
    console.error("[GeneralImageUpload] Optimization failed, using original:", error);
    return { buffer, format: "original", originalSize, optimizedSize: originalSize };
  }
}

/**
 * POST /api/upload/image
 * 通用圖片上傳（FormData with field name "image"）
 * 用於 inline-edit EditableImage 無 tourId 時的 fallback
 */
generalImageUploadRouter.post("/upload/image", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    // 優化圖片
    const optimized = await optimizeImage(file.buffer, "default");
    const ext = optimized.format === "original" ? (file.mimetype.split("/")[1] || "jpg") : optimized.format;

    // 生成唯一檔名
    const randomSuffix = randomBytes(8).toString("hex");
    const fileName = `general-${Date.now()}-${randomSuffix}.${ext}`;
    const fileKey = `uploads/${fileName}`;

    // 上傳到 S3
    const { url } = await storagePut(fileKey, optimized.buffer, `image/${ext}`);

    console.log(`[GeneralImageUpload] Uploaded: ${fileKey} (${url})`);

    res.json({
      url,
      optimization: {
        originalSize: optimized.originalSize,
        optimizedSize: optimized.optimizedSize,
        compressionRatio:
          ((optimized.originalSize - optimized.optimizedSize) / optimized.originalSize * 100).toFixed(1) + "%",
        format: ext,
      },
    });
  } catch (error) {
    console.error("[GeneralImageUpload] Upload error:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

/**
 * POST /api/upload/tour-image
 * 行程相關圖片上傳（FormData with field name "file" + body field "type"）
 * 用於 EditableHero 和 EditableDestinations
 */
generalImageUploadRouter.post("/upload/tour-image", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const imageType = (req.body?.type as string) || "default";

    // 優化圖片
    const optimized = await optimizeImage(file.buffer, imageType);
    const ext = optimized.format === "original" ? (file.mimetype.split("/")[1] || "jpg") : optimized.format;

    // 生成唯一檔名
    const randomSuffix = randomBytes(8).toString("hex");
    const fileName = `${imageType}-${Date.now()}-${randomSuffix}.${ext}`;
    const fileKey = `site-images/${imageType}/${fileName}`;

    // 上傳到 S3
    const { url } = await storagePut(fileKey, optimized.buffer, `image/${ext}`);

    console.log(`[GeneralImageUpload] Tour image uploaded: ${fileKey} (type: ${imageType})`);

    res.json({
      url,
      optimization: {
        originalSize: optimized.originalSize,
        optimizedSize: optimized.optimizedSize,
        compressionRatio:
          ((optimized.originalSize - optimized.optimizedSize) / optimized.originalSize * 100).toFixed(1) + "%",
        format: ext,
      },
    });
  } catch (error) {
    console.error("[GeneralImageUpload] Tour image upload error:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});
