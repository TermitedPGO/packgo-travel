/**
 * Image Generation Agent
 * Responsible for generating images using Manus API and Unsplash fallback
 */

import { generateImage } from "../_core/imageGeneration";
import { storagePut } from "../storage";
import { createApi } from "unsplash-js";
import { StyleGuide, ImageGenerationResult } from "../../shared/tourTypes";
import { validateStyleConsistency } from "../styleGuide";
import { checkImageGenerationRateLimit } from "../rateLimit";
import { getKeyInstructions } from "./skillLoader";

export interface ImageGenerationAgentResult {
  success: boolean;
  data?: {
    heroImage: ImageGenerationResult;
    highlightImages: ImageGenerationResult[];
    featureImages: ImageGenerationResult[];
  };
  error?: string;
}

/**
 * Image Generation Agent
 * Generates images using Manus API (hero) and Unsplash (highlights)
 */
export class ImageGenerationAgent {
  private unsplashClient: any;
  private skillInstructions: string;
  
  constructor() {
    // Load SKILL.md instructions
    this.skillInstructions = getKeyInstructions('ImageGenerationAgent');
    console.log('[ImageGenerationAgent] SKILL loaded:', this.skillInstructions.length, 'chars');
    
    // Initialize Unsplash client if API key is available
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (accessKey) {
      this.unsplashClient = createApi({ accessKey });
      console.log("[ImageGenerationAgent] Unsplash client initialized");
    } else {
      console.warn("[ImageGenerationAgent] Unsplash API key not found, will use fallback images");
    }
  }
  
  /**
   * Execute image generation
   */
  async execute(
    heroPrompt: string,
    highlightPrompts: string[],
    featurePrompts: string[],
    styleGuide: StyleGuide,
    userId: number
  ): Promise<ImageGenerationAgentResult> {
    console.log("[ImageGenerationAgent] Starting image generation...");
    
    try {
      // Check rate limit
      const rateLimit = await checkImageGenerationRateLimit(userId);
      if (!rateLimit.allowed) {
        throw new Error(`圖片生成請求過於頻繁，請稍後再試`);
      }
      
      // Generate hero image with Manus API
      const heroImage = await this.generateHeroImage(heroPrompt, styleGuide);
      
      // Generate highlight images with Unsplash (cost-effective)
      const highlightImages = await this.generateHighlightImages(
        highlightPrompts,
        styleGuide
      );
      
      // Generate feature images (only for features that need images)
      const featureImages = await this.generateFeatureImages(
        featurePrompts,
        styleGuide
      );
      
      console.log("[ImageGenerationAgent] Image generation completed");
      
      return {
        success: true,
        data: {
          heroImage,
          highlightImages,
          featureImages,
        },
      };
    } catch (error) {
      console.error("[ImageGenerationAgent] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
  
  /**
   * Fetch hero image — now powered by Google Programmable Search (CSE) image
   * search rather than an AI image generator. Rationale: real travel content
   * needs *real* photos of named subjects (e.g. a specific Taiwanese train),
   * not AI-imagined composites. The original prompt is used verbatim (CJK
   * characters are a FEATURE for regional queries, not a problem).
   */
  private async generateHeroImage(
    prompt: string,
    styleGuide: StyleGuide
  ): Promise<ImageGenerationResult> {
    console.log(
      `[ImageGenerationAgent] Hero image via CSE. Prompt: "${prompt.substring(0, 80)}..."`
    );

    try {
      const startMs = Date.now();
      // generateImage() already uploads to R2 internally and returns { url, sourceUrl? }
      const result = await generateImage({ prompt });
      const elapsedMs = Date.now() - startMs;
      console.log(
        `[ImageGenerationAgent] CSE response: elapsed=${elapsedMs}ms, url=${
          result.url ? result.url.substring(0, 60) + "..." : "null"
        }`
      );

      if (!result.url) {
        throw new Error("CSE returned no usable image for hero prompt");
      }

      // Already on R2 — no second upload needed.
      const finalUrl = result.url;

      // Validate style consistency (best-effort; CSE images don't always match a style guide)
      const isConsistent = validateStyleConsistency(finalUrl, styleGuide);
      if (!isConsistent) {
        console.warn("[ImageGenerationAgent] Hero image style inconsistency detected");
      }

      console.log("[ImageGenerationAgent] ✓ Hero image sourced successfully via CSE");

      return {
        url: finalUrl,
        alt: "Hero image",
        source: "ai", // keep "ai" label unchanged to avoid schema churn in callers
        prompt,
      };
    } catch (error) {
      console.error(
        "[ImageGenerationAgent] ✗ CSE hero image sourcing failed (will fallback to Unsplash):",
        error instanceof Error ? error.message : error
      );
      return await this.getUnsplashImage(prompt, "hero");
    }
  }
  
  /**
   * Generate highlight images with Unsplash (cost-effective)
   */
  private async generateHighlightImages(
    prompts: string[],
    styleGuide: StyleGuide
  ): Promise<ImageGenerationResult[]> {
    console.log("[ImageGenerationAgent] Generating highlight images with Unsplash...");
    
    const results: ImageGenerationResult[] = [];
    
    for (const prompt of prompts) {
      try {
        const result = await this.getUnsplashImage(prompt, "highlight");
        results.push(result);
      } catch (error) {
        console.error("[ImageGenerationAgent] Highlight image generation failed:", error);
        // Use fallback image
        results.push(await this.getFallbackImage("highlight"));
      }
    }
    
    console.log("[ImageGenerationAgent] Generated", results.length, "highlight images");
    
    return results;
  }
  
  /**
   * Generate feature images (only for features that need images)
   */
  private async generateFeatureImages(
    prompts: string[],
    styleGuide: StyleGuide
  ): Promise<ImageGenerationResult[]> {
    console.log("[ImageGenerationAgent] Generating feature images...");
    
    const results: ImageGenerationResult[] = [];
    
    for (const prompt of prompts) {
      if (!prompt) {
        // No image needed for this feature
        results.push({
          url: "",
          alt: "",
          source: "fallback",
        });
        continue;
      }
      
      try {
        const result = await this.getUnsplashImage(prompt, "feature");
        results.push(result);
      } catch (error) {
        console.error("[ImageGenerationAgent] Feature image generation failed:", error);
        // Use fallback image
        results.push(await this.getFallbackImage("feature"));
      }
    }
    
    console.log("[ImageGenerationAgent] Generated", results.filter(r => r.url).length, "feature images");
    
    return results;
  }
  
  /**
   * Get image from Unsplash
   */
  private async getUnsplashImage(
    query: string,
    category: "hero" | "highlight" | "feature"
  ): Promise<ImageGenerationResult> {
    if (!this.unsplashClient) {
      return await this.getFallbackImage(category);
    }
    
    try {
      // Extract keywords from prompt
      const keywords = this.extractKeywords(query);
      const searchQuery = keywords.slice(0, 3).join(" ");
      
      console.log("[ImageGenerationAgent] Searching Unsplash for:", searchQuery);
      
      const result = await this.unsplashClient.search.getPhotos({
        query: searchQuery,
        page: 1,
        perPage: 1,
        orientation: category === "hero" ? "landscape" : "landscape",
      });
      
      if (result.type === "success" && result.response.results.length > 0) {
        const photo = result.response.results[0];
        const imageUrl = photo.urls.regular;
        
        // Upload to S3
        const s3Url = await this.uploadImageToS3(imageUrl, category);
        
        return {
          url: s3Url,
          alt: photo.alt_description || query,
          source: "unsplash",
        };
      }
      
      throw new Error("No Unsplash results found");
    } catch (error) {
      console.error("[ImageGenerationAgent] Unsplash search failed:", error);
      return await this.getFallbackImage(category);
    }
  }
  
  /**
   * Upload image to S3
   */
  private async uploadImageToS3(
    imageUrl: string,
    category: string
  ): Promise<string> {
    try {
      // Download image
      const response = await fetch(imageUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Generate unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      const filename = `tours/${category}-${timestamp}-${random}.jpg`;
      
      // Upload to S3
      const result = await storagePut(filename, buffer, "image/jpeg");
      
      console.log("[ImageGenerationAgent] Image uploaded to S3:", result.url);
      
      return result.url;
    } catch (error) {
      console.error("[ImageGenerationAgent] S3 upload failed:", error);
      // Return original URL as fallback
      return imageUrl;
    }
  }
  
  /**
   * Get fallback image (placeholder)
   */
  private async getFallbackImage(
    category: "hero" | "highlight" | "feature"
  ): Promise<ImageGenerationResult> {
    // Use placeholder image service
    const width = category === "hero" ? 1920 : 800;
    const height = category === "hero" ? 1080 : 600;
    const url = `https://via.placeholder.com/${width}x${height}/4A90E2/FFFFFF?text=${category}`;
    
    return {
      url,
      alt: `Placeholder ${category} image`,
      source: "fallback",
    };
  }
  
  /**
   * Extract keywords from prompt
   */
  private extractKeywords(prompt: string): string[] {
    // Remove common words and extract meaningful keywords
    const commonWords = [
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
      "been", "being", "have", "has", "had", "do", "does", "did", "will",
      "would", "should", "could", "may", "might", "must", "can", "shall",
      "professional", "high", "quality", "resolution", "style", "no", "text",
      "watermark", "photography", "cinematic", "travel", "magazine",
    ];
    
    const words = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.includes(word));
    
    return words.slice(0, 5); // Return top 5 keywords
  }
}
