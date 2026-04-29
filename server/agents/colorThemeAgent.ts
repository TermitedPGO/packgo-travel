/**
 * Color Theme Agent
 * Responsible for generating color themes based on destination
 */

import { ColorTheme } from "../../shared/tourTypes";
import { getKeyInstructions } from "./skillLoader";

export interface ColorThemeResult {
  success: boolean;
  data?: ColorTheme;
  error?: string;
}

/**
 * Color Theme Agent
 * Generates color themes based on destination characteristics
 */
export class ColorThemeAgent {
  private skillInstructions: string;

  constructor() {
    this.skillInstructions = getKeyInstructions('ColorThemeAgent');
    console.log('[ColorThemeAgent] SKILL loaded:', this.skillInstructions.length, 'chars');
  }
  /**
   * Execute color theme generation
   */
  async execute(
    destinationCountry: string,
    destinationCity?: string
  ): Promise<ColorThemeResult> {
    console.log("[ColorThemeAgent] Starting color theme generation...");
    console.log("[ColorThemeAgent] Destination:", destinationCountry, destinationCity);
    
    try {
      // Generate color theme based on destination
      const colorTheme = this.generateColorTheme(destinationCountry, destinationCity);
      
      console.log("[ColorThemeAgent] Color theme generated:", colorTheme);
      
      return {
        success: true,
        data: colorTheme,
      };
    } catch (error) {
      console.error("[ColorThemeAgent] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
  
  /**
   * Generate color theme based on destination
   */
  private generateColorTheme(
    destinationCountry: string,
    destinationCity?: string
  ): ColorTheme {
    // Check for city-specific themes
    if (destinationCity) {
      const cityTheme = this.getCityTheme(destinationCity);
      if (cityTheme) return cityTheme;
    }
    
    // Check for country-specific themes
    const countryTheme = this.getCountryTheme(destinationCountry);
    if (countryTheme) return countryTheme;
    
    // Return default theme
    return this.getDefaultTheme();
  }
  
  /**
   * Get city-specific theme
   */
  private getCityTheme(city: string): ColorTheme | null {
    const cityThemes: Record<string, ColorTheme> = {
      "北海道": {
        primary: "#4A90E2", // Blue (snow, sky)
        secondary: "#7FB3D5", // Light blue
        accent: "#F39C12", // Orange (sunset)
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#ECF0F1", // Light gray
        backgroundDark: "#BDC3C7", // Medium gray
      },
      "京都": {
        primary: "#E74C3C", // Red (temples)
        secondary: "#FFB6C1", // Pink (cherry blossoms)
        accent: "#D4AF37", // Gold
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#FFF5E6", // Cream
        backgroundDark: "#F5DEB3", // Wheat
      },
      "東京": {
        primary: "#9B59B6", // Purple (modern)
        secondary: "#3498DB", // Blue
        accent: "#E74C3C", // Red
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#F8F9FA", // Light gray
        backgroundDark: "#E9ECEF", // Medium gray
      },
    };
    
    return cityThemes[city] || null;
  }
  
  /**
   * Get country-specific theme
   */
  private getCountryTheme(country: string): ColorTheme | null {
    const countryThemes: Record<string, ColorTheme> = {
      "日本": {
        primary: "#E74C3C", // Red
        secondary: "#FFB6C1", // Pink
        accent: "#D4AF37", // Gold
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#FFF5E6", // Cream
        backgroundDark: "#F5DEB3", // Wheat
      },
      "韓國": {
        primary: "#3498DB", // Blue
        secondary: "#E74C3C", // Red
        accent: "#F39C12", // Orange
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#F8F9FA", // Light gray
        backgroundDark: "#E9ECEF", // Medium gray
      },
      "泰國": {
        primary: "#F39C12", // Orange (temples)
        secondary: "#27AE60", // Green (tropical)
        accent: "#E74C3C", // Red
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#FFF9E6", // Light yellow
        backgroundDark: "#FFE5B4", // Peach
      },
      "法國": {
        primary: "#3498DB", // Blue (flag)
        secondary: "#E74C3C", // Red (flag)
        accent: "#D4AF37", // Gold
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#F8F9FA", // Light gray
        backgroundDark: "#E9ECEF", // Medium gray
      },
      "義大利": {
        primary: "#27AE60", // Green (flag)
        secondary: "#E74C3C", // Red (flag)
        accent: "#D4AF37", // Gold
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#FFF9E6", // Light yellow
        backgroundDark: "#FFE5B4", // Peach
      },
      "美國": {
        primary: "#3498DB", // Blue (flag)
        secondary: "#E74C3C", // Red (flag)
        accent: "#F39C12", // Orange
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#F8F9FA", // Light gray
        backgroundDark: "#E9ECEF", // Medium gray
      },
      "澳洲": {
        primary: "#2980B9", // Blue (ocean)
        secondary: "#E67E22", // Orange (outback)
        accent: "#27AE60", // Green
        text: "#2C3E50", // Dark blue-gray
        textLight: "#7F8C8D", // Gray
        background: "#F0F8FF", // Alice blue
        backgroundDark: "#D6EAF8", // Light blue
      },
      "紐西蘭": {
        primary: "#27AE60", // Green (landscape)
        secondary: "#2980B9", // Blue (lakes)
        accent: "#D4AF37", // Gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F0FFF4",
        backgroundDark: "#D5F5E3",
      },
      "越南": {
        primary: "#E67E22", // Orange (lantern)
        secondary: "#27AE60", // Green (jungle)
        accent: "#D4AF37", // Gold (temples)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FFF8DC",
        backgroundDark: "#FADBD8",
      },
      "菲律賓": {
        primary: "#2980B9", // Ocean blue
        secondary: "#F39C12", // Sunset orange
        accent: "#27AE60", // Palm green
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "新加坡": {
        primary: "#E74C3C", // Red (flag)
        secondary: "#2C3E50", // Skyline dark
        accent: "#D4AF37", // Gold (Marina Bay)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "馬來西亞": {
        primary: "#27AE60", // Tropical green
        secondary: "#2980B9", // Blue
        accent: "#F39C12", // Spice orange
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F9F5EB",
        backgroundDark: "#F5E6C8",
      },
      "印尼": {
        primary: "#E74C3C", // Red (flag)
        secondary: "#F39C12", // Warm orange (Bali sunset)
        accent: "#27AE60", // Green
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FFF9E6",
        backgroundDark: "#FFE5B4",
      },
      "印度": {
        primary: "#E67E22", // Saffron
        secondary: "#8E44AD", // Deep purple
        accent: "#D4AF37", // Gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FFF5E1",
        backgroundDark: "#F4D03F",
      },
      "土耳其": {
        primary: "#E74C3C", // Red (flag)
        secondary: "#1ABC9C", // Turquoise (origin)
        accent: "#D4AF37", // Gold (mosques)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDEBD0",
        backgroundDark: "#F5CBA7",
      },
      "埃及": {
        primary: "#D4AF37", // Gold (pyramids)
        secondary: "#E67E22", // Sand
        accent: "#2980B9", // Nile blue
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FEF9E7",
        backgroundDark: "#F5CBA7",
      },
      "摩洛哥": {
        primary: "#C0392B", // Terracotta
        secondary: "#1ABC9C", // Tile turquoise
        accent: "#D4AF37", // Gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDEBD0",
        backgroundDark: "#E8B38A",
      },
      "德國": {
        primary: "#1A1A1A", // Black (flag)
        secondary: "#E74C3C", // Red (flag)
        accent: "#D4AF37", // Gold (flag)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "英國": {
        primary: "#1F3A93", // Royal blue
        secondary: "#C0392B", // Red
        accent: "#D4AF37", // Gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "愛爾蘭": {
        primary: "#27AE60", // Emerald green
        secondary: "#E67E22", // Orange (flag)
        accent: "#D4AF37", // Gold (Celtic)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F0FFF4",
        backgroundDark: "#D5F5E3",
      },
      "西班牙": {
        primary: "#C0392B", // Red (flag)
        secondary: "#F39C12", // Yellow (flag)
        accent: "#8E44AD", // Flamenco purple
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FFF9E6",
        backgroundDark: "#FAD7A0",
      },
      "葡萄牙": {
        primary: "#27AE60", // Green (flag)
        secondary: "#C0392B", // Red (flag)
        accent: "#D4AF37", // Azulejo gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E8DAEF",
      },
      "希臘": {
        primary: "#2980B9", // Aegean blue
        secondary: "#FFFFFF", // White (buildings)
        accent: "#D4AF37", // Gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "荷蘭": {
        primary: "#E67E22", // Orange (Dutch)
        secondary: "#2980B9", // Delft blue
        accent: "#27AE60", // Tulip green
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5CBA7",
      },
      "比利時": {
        primary: "#1A1A1A", // Black (flag)
        secondary: "#F4D03F", // Yellow (flag)
        accent: "#C0392B", // Red (flag)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "奧地利": {
        primary: "#C0392B", // Red (flag)
        secondary: "#D4AF37", // Imperial gold
        accent: "#2980B9", // Alpine blue
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5E6C8",
      },
      "捷克": {
        primary: "#C0392B", // Red (flag)
        secondary: "#1F3A93", // Blue (flag)
        accent: "#D4AF37", // Golden city
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "瑞士": {
        primary: "#C0392B", // Red (flag)
        secondary: "#FFFFFF", // Snow white
        accent: "#27AE60", // Alpine green
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "匈牙利": {
        primary: "#C0392B", // Red (flag)
        secondary: "#27AE60", // Green (flag)
        accent: "#D4AF37", // Danube gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5E6C8",
      },
      "波蘭": {
        primary: "#C0392B", // Red (flag)
        secondary: "#FFFFFF", // White (flag)
        accent: "#D4AF37", // Amber
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "克羅埃西亞": {
        primary: "#2980B9", // Adriatic blue
        secondary: "#C0392B", // Red (flag)
        accent: "#D4AF37", // Golden coast
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "冰島": {
        primary: "#2980B9", // Glacier blue
        secondary: "#1ABC9C", // Aurora
        accent: "#FFFFFF", // Snow
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "挪威": {
        primary: "#1F3A93", // Deep blue
        secondary: "#C0392B", // Red (flag)
        accent: "#FFFFFF", // Snow
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "瑞典": {
        primary: "#1F3A93", // Blue (flag)
        secondary: "#F4D03F", // Yellow (flag)
        accent: "#27AE60", // Forest green
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "丹麥": {
        primary: "#C0392B", // Red (flag)
        secondary: "#FFFFFF", // White (flag)
        accent: "#2980B9", // Harbor blue
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "芬蘭": {
        primary: "#2980B9", // Lake blue
        secondary: "#FFFFFF", // Snow
        accent: "#27AE60", // Forest green
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "加拿大": {
        primary: "#C0392B", // Red (flag)
        secondary: "#FFFFFF", // White (flag)
        accent: "#27AE60", // Maple forest
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "秘魯": {
        primary: "#C0392B", // Red (flag)
        secondary: "#D4AF37", // Inca gold
        accent: "#27AE60", // Andes green
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5E6C8",
      },
      "智利": {
        primary: "#C0392B", // Red (flag)
        secondary: "#1F3A93", // Blue (flag)
        accent: "#FFFFFF", // White
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "巴西": {
        primary: "#27AE60", // Green (flag)
        secondary: "#F4D03F", // Yellow (flag)
        accent: "#1F3A93", // Blue (flag)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F0FFF4",
        backgroundDark: "#D5F5E3",
      },
      "阿根廷": {
        primary: "#74B9FF", // Sky blue (flag)
        secondary: "#FFFFFF", // White (flag)
        accent: "#D4AF37", // Sol de mayo
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "墨西哥": {
        primary: "#27AE60", // Green (flag)
        secondary: "#C0392B", // Red (flag)
        accent: "#D4AF37", // Gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5CBA7",
      },
      "南非": {
        primary: "#27AE60", // Green (flag)
        secondary: "#D4AF37", // Gold (flag)
        accent: "#C0392B", // Red (flag)
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5CBA7",
      },
      // Multi-country / regional "buckets" — used when tour spans multiple
      // countries and masterAgent sets destinationCountry to one of these.
      "北歐": {
        primary: "#2980B9", // Glacier blue
        secondary: "#1ABC9C", // Aurora
        accent: "#FFFFFF", // Snow
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#EBF5FB",
        backgroundDark: "#D6EAF8",
      },
      "東歐": {
        primary: "#C0392B", // Imperial red
        secondary: "#D4AF37", // Baroque gold
        accent: "#1F3A93", // Royal blue
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5E6C8",
      },
      "南歐": {
        primary: "#C0392B", // Mediterranean red
        secondary: "#2980B9", // Sea blue
        accent: "#D4AF37", // Sun gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#FDF2E9",
        backgroundDark: "#F5CBA7",
      },
      "西歐": {
        primary: "#1F3A93", // Royal blue
        secondary: "#C0392B", // Crimson
        accent: "#D4AF37", // Gold
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
      "中歐": {
        primary: "#8E44AD", // Bohemian purple
        secondary: "#D4AF37", // Baroque gold
        accent: "#27AE60", // Forest
        text: "#2C3E50",
        textLight: "#7F8C8D",
        background: "#F8F9FA",
        backgroundDark: "#E9ECEF",
      },
    };

    return countryThemes[country] || null;
  }
  
  /**
   * Get default theme (Pack&Go Brand Colors)
   * ⚠️ Tech Lead 審查意見：
   * 當使用者輸入「冰島」或「南極」等未定義地點時，系統不應崩潰或變全白。
   * 務必在 getDestinationColors 中加入 Default 配色方案（Pack&Go 品牌標準色），
   * 當查無地點時自動降級使用。
   */
  private getDefaultTheme(): ColorTheme {
    // Pack&Go 品牌標準色（用於未知目的地）
    return {
      primary: "#1A1A1A",   // 深灰黑（專業、穩重）
      secondary: "#F5F5F5", // 淺灰白（乾淨、現代）
      accent: "#E63946",    // 紅色（活力、冒險）
      text: "#2C3E50",      // 深藍灰（文字）
      textLight: "#7F8C8D", // 灰色（次要文字）
      background: "#F8F9FA", // 淺灰色（背景）
      backgroundDark: "#E9ECEF", // 中灰色（深色背景）
    };
  }
}
