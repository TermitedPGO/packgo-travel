/**
 * PDF Image Extractor Service
 *
 * Extracts embedded images from PDF binary data using pdf-lib.
 * Falls back gracefully if extraction fails or no images are found.
 *
 * NOTE: pdf-lib is primarily a PDF creation/modification library.
 * For raw XObject image extraction we inspect the PDF structure directly.
 * Images encoded as DCTDecode (JPEG) or FlateDecode (PNG/raw) are supported.
 */

import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

export interface ExtractedPdfImage {
  data: Buffer; // Raw image bytes
  mimeType: string; // "image/jpeg" | "image/png"
  width: number; // Pixel width (0 if unknown)
  height: number; // Pixel height (0 if unknown)
  pageNumber: number; // 1-based page number
  index: number; // 0-based index within the page
}

/** Minimum dimension to be considered a real content image (not icon/logo) */
const MIN_DIMENSION = 100;

/**
 * Extract all embedded images from a PDF buffer.
 * Returns an empty array (never throws) so callers can safely ignore failures.
 */
export async function extractImagesFromPdf(
  pdfBuffer: Buffer
): Promise<ExtractedPdfImage[]> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const results: ExtractedPdfImage[] = [];
    const pages = pdfDoc.getPages();

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const page = pages[pageIdx];
      const pageNumber = pageIdx + 1;

      try {
        // Access the page's resource dictionary
        const resources = page.node.Resources();
        if (!resources) continue;

        const xObject = resources.lookup(PDFName.of("XObject"));
        if (!xObject || !("entries" in xObject)) continue;

        let imageIndex = 0;
        // Iterate over all XObjects on this page
        for (const [, ref] of (xObject as any).entries()) {
          try {
            const xObj = pdfDoc.context.lookup(ref);
            if (!(xObj instanceof PDFRawStream)) continue;

            const dict = xObj.dict;
            const subtype = dict.lookup(PDFName.of("Subtype"));
            if (!subtype || subtype.toString() !== "/Image") continue;

            // Get dimensions
            const widthObj = dict.lookup(PDFName.of("Width"));
            const heightObj = dict.lookup(PDFName.of("Height"));
            const width = widthObj ? Number(widthObj.toString()) : 0;
            const height = heightObj ? Number(heightObj.toString()) : 0;

            // Skip tiny images (icons, decorations, logos)
            if (width < MIN_DIMENSION || height < MIN_DIMENSION) continue;

            // Determine encoding / MIME type
            const filterObj = dict.lookup(PDFName.of("Filter"));
            const filterName = filterObj ? filterObj.toString() : "";

            let mimeType: string;
            if (filterName.includes("DCTDecode")) {
              mimeType = "image/jpeg";
            } else if (
              filterName.includes("FlateDecode") ||
              filterName.includes("LZWDecode")
            ) {
              mimeType = "image/png";
            } else if (filterName.includes("JPXDecode")) {
              mimeType = "image/jp2";
            } else {
              // Unknown encoding — skip to avoid corrupt data
              continue;
            }

            const imageData = Buffer.from(xObj.contents);
            if (imageData.length < 512) continue; // Too small to be a real image

            results.push({
              data: imageData,
              mimeType,
              width,
              height,
              pageNumber,
              index: imageIndex++,
            });
          } catch {
            // Individual XObject extraction failure — continue with next
          }
        }
      } catch {
        // Page-level failure — continue with next page
      }
    }

    console.log(
      `[PdfImageExtractor] Extracted ${results.length} images from ${pages.length} pages`
    );
    return results;
  } catch (error) {
    console.warn(
      "[PdfImageExtractor] Failed to extract images from PDF:",
      error
    );
    return [];
  }
}

/**
 * Classify an image by its dimensions into a content type.
 * Used to decide whether an image is suitable as a hero banner or a feature card.
 */
export function classifyImageBySize(
  width: number,
  height: number
): "hero" | "feature" | "other" {
  if (width === 0 || height === 0) return "other";
  const ratio = width / height;
  if (ratio > 1.5 && width >= 800) return "hero"; // Wide landscape → hero banner
  if (width >= 400 && height >= 400) return "feature"; // Square-ish large → feature card
  return "other";
}
