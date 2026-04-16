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
   * Generate hero image with Manus API
   */
  private async generateHeroImage(
    prompt: string,
    styleGuide: StyleGuide
  ): Promise<ImageGenerationResult> {
    // Fix 5 (Round 62): Ensure prompt is in English for better Forge API image matching
    // CJK characters in prompts often produce poor results; translate common patterns
    const ensureEnglishPrompt = (p: string): string => {
      // If prompt already looks mostly English (< 20% CJK chars), keep as-is
      const cjkCount = (p.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
      if (cjkCount / p.length < 0.2) return p;
      // Strip CJK characters and keep the English portion if any
      const englishPart = p.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, ' ').trim();
      if (englishPart.length > 20) return englishPart;
      // Fallback: generic travel photography prompt
      return 'Professional travel photography, scenic landscape, vibrant colors, high quality, no text, no watermark';
    };
    const englishPrompt = ensureEnglishPrompt(prompt);
    console.log(`[ImageGenerationAgent] Generating hero image with Forge API. Original prompt length: ${prompt.length}, English prompt: "${englishPrompt.substring(0, 80)}..."`);
    
    // Fix 5 (Round 62): try/catch with detailed Forge API logging
    try {
      const forgeStartMs = Date.now();
      // Generate image with Manus API (Forge)
      const result = await generateImage({ prompt: englishPrompt });
      const forgeElapsedMs = Date.now() - forgeStartMs;
      console.log(`[ImageGenerationAgent] Forge API response: elapsed=${forgeElapsedMs}ms, url=${result.url ? result.url.substring(0, 60) + '...' : 'null'}`);
      
      if (!result.url) {
        throw new Error("Forge API returned empty URL for hero image");
      }
      
      // Download and upload to S3
      const s3Url = await this.uploadImageToS3(result.url, "hero");
      console.log(`[ImageGenerationAgent] Hero image uploaded to S3: ${s3Url.substring(0, 60)}...`);
      
      // Validate style consistency
      const isConsistent = validateStyleConsistency(s3Url, styleGuide);
      if (!isConsistent) {
        console.warn("[ImageGenerationAgent] Hero image style inconsistency detected");
      }
      
      console.log("[ImageGenerationAgent] ✓ Hero image generated successfully via Forge API");
      
      return {
        url: s3Url,
        alt: "Hero image",
        source: "ai",
        prompt: englishPrompt,
      };
    } catch (error) {
      // Fix 5 (Round 62): Log Forge API failure details before falling back
      console.error(`[ImageGenerationAgent] ✗ Forge API hero image generation failed (will fallback to Unsplash):`, error instanceof Error ? error.message : error);
      
      // Fallback to Unsplash using the English prompt
      return await this.getUnsplashImage(englishPrompt, "hero");
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
