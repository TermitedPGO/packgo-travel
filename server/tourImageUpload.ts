/**
 * Tour Image Upload API
 * 處理行程詳情頁面的圖片上傳，包含自動壓縮和優化功能
 */

import { Router } from "express";
import { storagePut } from "./storage";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { requireAdmin } from "./_core/requireAdmin";

export const tourImageUploadRouter = Router();

// SECURITY_AUDIT_2026_05_14 P0-2: routes were anonymous → drained R2 +
// allowed S3-key pollution under any tourId. All tour-image upload paths
// are admin-only (only Jeff edits tour content).
tourImageUploadRouter.use(requireAdmin);

// 圖片尺寸配置（根據用途）
const IMAGE_SIZES = {
  hero: { width: 1920, height: 1080 },      // Hero 橫幅圖片
  feature: { width: 800, height: 600 },     // 特色卡片圖片
  day: { width: 1200, height: 800 },        // 每日行程圖片
  activity: { width: 800, height: 600 },    // 活動圖片
  thumbnail: { width: 400, height: 300 },   // 縮圖
  default: { width: 1200, height: 900 },    // 預設尺寸
};

// 品質配置
const QUALITY_SETTINGS = {
  webp: 82,    // WebP 品質（較高以保持視覺品質）
  jpeg: 85,    // JPEG 品質
};

/**
 * 根據圖片路徑獲取對應的尺寸配置
 */
function getSizeConfig(imagePath: string): { width: number; height: number } {
  if (imagePath === "hero" || imagePath.includes("hero")) {
    return IMAGE_SIZES.hero;
  }
  if (imagePath.includes("feature")) {
    return IMAGE_SIZES.feature;
  }
  if (imagePath.startsWith("day-") && !imagePath.includes("activity")) {
    return IMAGE_SIZES.day;
  }
  if (imagePath.includes("activity")) {
    return IMAGE_SIZES.activity;
  }
  if (imagePath.includes("thumb")) {
    return IMAGE_SIZES.thumbnail;
  }
  return IMAGE_SIZES.default;
}

/**
 * 壓縮和優化圖片
 * @param buffer - 原始圖片 Buffer
 * @param imagePath - 圖片用途路徑（用於決定尺寸）
 * @returns 優化後的圖片 Buffer 和格式資訊
 */
async function optimizeImage(
  buffer: Buffer,
  imagePath: string
): Promise<{ buffer: Buffer; format: string; originalSize: number; optimizedSize: number }> {
  const originalSize = buffer.length;
  const sizeConfig = getSizeConfig(imagePath);

  try {
    // 獲取原始圖片資訊
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    // 計算是否需要調整大小
    const needsResize = originalWidth > sizeConfig.width || originalHeight > sizeConfig.height;

    // 建立 sharp 處理管線
    let pipeline = sharp(buffer);

    // 如果需要調整大小，進行縮放
    if (needsResize) {
      pipeline = pipeline.resize(sizeConfig.width, sizeConfig.height, {
        fit: "inside",           // 保持比例，不裁切
        withoutEnlargement: true, // 不放大小圖
      });
    }

    // 轉換為 WebP 格式（最佳壓縮比）
    const optimizedBuffer = await pipeline
      .webp({
        quality: QUALITY_SETTINGS.webp,
        effort: 4,  // 壓縮努力程度（0-6，越高越慢但壓縮更好）
      })
      .toBuffer();

    const optimizedSize = optimizedBuffer.length;
    const compressionRatio = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);

    console.log(`[ImageOptimizer] Optimized: ${originalSize} -> ${optimizedSize} bytes (${compressionRatio}% reduction)`);
    console.log(`[ImageOptimizer] Dimensions: ${originalWidth}x${originalHeight} -> ${sizeConfig.width}x${sizeConfig.height} (max)`);

    return {
      buffer: optimizedBuffer,
      format: "webp",
      originalSize,
      optimizedSize,
    };
  } catch (error) {
    console.error("[ImageOptimizer] Optimization failed, using original:", error);
    // 如果優化失敗，返回原始圖片
    return {
      buffer,
      format: "original",
      originalSize,
      optimizedSize: originalSize,
    };
  }
}

/**
 * 上傳行程圖片（帶壓縮）
 * POST /api/tours/:tourId/upload-image
 * Body: { image: base64 string, path: string (e.g., "hero", "day-1-activity-0") }
 */
tourImageUploadRouter.post("/tours/:tourId/upload-image", async (req, res) => {
  try {
    const { tourId } = req.params;
    const { image, path: imagePath, skipOptimization } = req.body;

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Invalid image data" });
    }

    if (!imagePath || typeof imagePath !== "string") {
      return res.status(400).json({ error: "Invalid image path" });
    }

    // Extract base64 data
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid image format" });
    }

    const originalType = matches[1];
    const base64Data = matches[2];
    const originalBuffer = Buffer.from(base64Data, "base64");

    // Validate file size (max 10MB for original)
    if (originalBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Image size exceeds 10MB limit" });
    }

    // 優化圖片（除非明確跳過）
    let finalBuffer: Buffer;
    let finalFormat: string;
    let optimizationInfo = { originalSize: 0, optimizedSize: 0 };

    if (skipOptimization) {
      finalBuffer = originalBuffer;
      finalFormat = originalType;
      optimizationInfo = { originalSize: originalBuffer.length, optimizedSize: originalBuffer.length };
    } else {
      const optimized = await optimizeImage(originalBuffer, imagePath);
      finalBuffer = optimized.buffer;
      finalFormat = optimized.format === "original" ? originalType : optimized.format;
      optimizationInfo = { originalSize: optimized.originalSize, optimizedSize: optimized.optimizedSize };
    }

    // Generate unique filename
    const randomSuffix = randomBytes(8).toString("hex");
    const sanitizedPath = imagePath.replace(/[^a-zA-Z0-9-_]/g, "-");
    const fileName = `tour-${tourId}-${sanitizedPath}-${Date.now()}-${randomSuffix}.${finalFormat}`;
    const fileKey = `tours/${tourId}/${fileName}`;

    // Upload to S3
    const { url } = await storagePut(fileKey, finalBuffer, `image/${finalFormat}`);

    console.log(`[TourImageUpload] Uploaded optimized image for tour ${tourId}: ${url}`);

    res.json({
      url,
      path: imagePath,
      optimization: {
        originalSize: optimizationInfo.originalSize,
        optimizedSize: optimizationInfo.optimizedSize,
        compressionRatio: ((optimizationInfo.originalSize - optimizationInfo.optimizedSize) / optimizationInfo.originalSize * 100).toFixed(1) + "%",
        format: finalFormat,
      },
    });
  } catch (error) {
    console.error("[TourImageUpload] Upload error:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

/**
 * 批量上傳行程圖片（帶壓縮）
 * POST /api/tours/:tourId/upload-images
 * Body: { images: [{ image: base64 string, path: string }], skipOptimization?: boolean }
 */
tourImageUploadRouter.post("/tours/:tourId/upload-images", async (req, res) => {
  try {
    const { tourId } = req.params;
    const { images, skipOptimization } = req.body;

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "Invalid images array" });
    }

    if (images.length > 20) {
      return res.status(400).json({ error: "Maximum 20 images per batch" });
    }

    const results: { url: string; path: string; optimization?: any }[] = [];
    const errors: { path: string; error: string }[] = [];

    // 並行處理所有圖片
    const uploadPromises = images.map(async (item) => {
      try {
        const { image, path: imagePath } = item;

        if (!image || typeof image !== "string") {
          return { error: { path: imagePath || "unknown", error: "Invalid image data" } };
        }

        // Extract base64 data
        const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
          return { error: { path: imagePath, error: "Invalid image format" } };
        }

        const originalType = matches[1];
        const base64Data = matches[2];
        const originalBuffer = Buffer.from(base64Data, "base64");

        // Validate file size (max 10MB)
        if (originalBuffer.length > 10 * 1024 * 1024) {
          return { error: { path: imagePath, error: "Image size exceeds 10MB limit" } };
        }

        // 優化圖片
        let finalBuffer: Buffer;
        let finalFormat: string;
        let optimizationInfo = { originalSize: 0, optimizedSize: 0 };

        if (skipOptimization) {
          finalBuffer = originalBuffer;
          finalFormat = originalType;
          optimizationInfo = { originalSize: originalBuffer.length, optimizedSize: originalBuffer.length };
        } else {
          const optimized = await optimizeImage(originalBuffer, imagePath);
          finalBuffer = optimized.buffer;
          finalFormat = optimized.format === "original" ? originalType : optimized.format;
          optimizationInfo = { originalSize: optimized.originalSize, optimizedSize: optimized.optimizedSize };
        }

        // Generate unique filename
        const randomSuffix = randomBytes(8).toString("hex");
        const sanitizedPath = imagePath.replace(/[^a-zA-Z0-9-_]/g, "-");
        const fileName = `tour-${tourId}-${sanitizedPath}-${Date.now()}-${randomSuffix}.${finalFormat}`;
        const fileKey = `tours/${tourId}/${fileName}`;

        // Upload to S3
        const { url } = await storagePut(fileKey, finalBuffer, `image/${finalFormat}`);

        return {
          success: {
            url,
            path: imagePath,
            optimization: {
              originalSize: optimizationInfo.originalSize,
              optimizedSize: optimizationInfo.optimizedSize,
              compressionRatio: ((optimizationInfo.originalSize - optimizationInfo.optimizedSize) / optimizationInfo.originalSize * 100).toFixed(1) + "%",
              format: finalFormat,
            },
          },
        };
      } catch (err: any) {
        return { error: { path: item.path || "unknown", error: err.message } };
      }
    });

    const uploadResults = await Promise.all(uploadPromises);

    // 分類結果
    for (const result of uploadResults) {
      if (result.success) {
        results.push(result.success);
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    // 計算總體統計
    const totalOriginalSize = results.reduce((sum, r) => sum + (r.optimization?.originalSize || 0), 0);
    const totalOptimizedSize = results.reduce((sum, r) => sum + (r.optimization?.optimizedSize || 0), 0);
    const totalCompressionRatio = totalOriginalSize > 0
      ? ((totalOriginalSize - totalOptimizedSize) / totalOriginalSize * 100).toFixed(1)
      : "0";

    console.log(`[TourImageUpload] Batch upload for tour ${tourId}: ${results.length} success, ${errors.length} failed`);
    console.log(`[TourImageUpload] Total compression: ${totalOriginalSize} -> ${totalOptimizedSize} bytes (${totalCompressionRatio}% reduction)`);

    res.json({
      results,
      errors,
      summary: {
        successCount: results.length,
        errorCount: errors.length,
        totalOriginalSize,
        totalOptimizedSize,
        totalCompressionRatio: totalCompressionRatio + "%",
      },
    });
  } catch (error) {
    console.error("[TourImageUpload] Batch upload error:", error);
    res.status(500).json({ error: "Failed to upload images" });
  }
});

/**
 * 獲取圖片尺寸配置
 * GET /api/tours/image-sizes
 */
tourImageUploadRouter.get("/tours/image-sizes", (req, res) => {
  res.json(IMAGE_SIZES);
});
