/**
 * Hotel brand extraction.
 *
 * Round 80.20: Jeff noticed every hotel rendered with brand "?" because
 * neither the Lion API nor our LLM ever populated the `brand` field. This
 * helper does pure regex pattern matching on hotel names — no LLM call —
 * to populate brand for the vast majority of chain hotels we encounter.
 *
 * Matching is case-insensitive and order-sensitive: longer / more
 * specific brands come first so "Hilton Garden Inn" beats "Hilton",
 * "Park Hyatt" beats "Hyatt", etc.
 *
 * The patterns intentionally allow both English and Chinese forms,
 * because Lion sometimes returns mixed names like "希爾頓 Hilton 北京" or
 * "Mercure 蘇黎世市" — we just want to know which brand owns the property.
 *
 * Usage:
 *   const brand = extractHotelBrand("RADISSON HOTEL ZURICH AIRPORT");
 *   // → "Radisson"
 */

interface BrandPattern {
  /** Regex tested against the hotel name */
  re: RegExp;
  /** Canonical brand label (English; how we display it on the page) */
  label: string;
}

// Order matters — longer/more-specific brands must precede shorter ones.
const BRAND_PATTERNS: BrandPattern[] = [
  // Marriott family — specific sub-brands first
  { re: /\bRitz[-\s]?Carlton\b|麗思卡爾頓|里茲卡爾頓/i, label: "Ritz-Carlton" },
  { re: /\bSt[.\s]?Regis\b|瑞吉/i, label: "St. Regis" },
  { re: /\bW\s+Hotel|\bW\s+(Taipei|Hong\s*Kong|Tokyo|Beijing|Shanghai|Seoul|Bangkok|Sydney|Bali)/i, label: "W Hotels" },
  { re: /\bJW\s+Marriott\b/i, label: "JW Marriott" },
  { re: /\bAutograph\s+Collection\b|Autograph/i, label: "Autograph Collection" },
  { re: /\bLuxury\s+Collection\b/i, label: "The Luxury Collection" },
  { re: /\bLe\s+M(?:é|e)ridien\b|寒舍艾美|艾美/i, label: "Le Méridien" },
  { re: /\bSheraton\b|喜來登|喜来登/i, label: "Sheraton" },
  { re: /\bWestin\b|威斯汀/i, label: "Westin" },
  { re: /\bRenaissance\s+Hotel|Renaissance(?:\s|$)/i, label: "Renaissance" },
  { re: /\bCourtyard\b|萬怡/i, label: "Courtyard by Marriott" },
  { re: /\bResidence\s+Inn\b/i, label: "Residence Inn" },
  { re: /\bSpringHill\s+Suites\b/i, label: "SpringHill Suites" },
  { re: /\bAC\s+Hotel/i, label: "AC Hotels" },
  { re: /\bAloft\b/i, label: "Aloft" },
  { re: /\bMoxy\b/i, label: "Moxy" },
  { re: /\bElement\s+by\b|Element\s+Hotel/i, label: "Element" },
  { re: /\bFairfield\s+Inn\b/i, label: "Fairfield" },
  { re: /\bMarriott\b|萬豪|万豪/i, label: "Marriott" },

  // Hilton family
  { re: /\bWaldorf\s+Astoria\b|華爾道夫/i, label: "Waldorf Astoria" },
  { re: /\bConrad\b|康萊德|康莱德/i, label: "Conrad" },
  { re: /\bDouble[Tt]ree\b/i, label: "DoubleTree by Hilton" },
  { re: /\bEmbassy\s+Suites\b/i, label: "Embassy Suites" },
  { re: /\bHilton\s+Garden\s+Inn\b|希爾頓花園/i, label: "Hilton Garden Inn" },
  { re: /\bHampton\s+(?:Inn|by)\b/i, label: "Hampton by Hilton" },
  { re: /\bHomewood\s+Suites\b/i, label: "Homewood Suites" },
  { re: /\bHome2\s+Suites\b/i, label: "Home2 Suites" },
  { re: /\bCanopy\s+by\b/i, label: "Canopy by Hilton" },
  { re: /\bCurio\s+Collection\b/i, label: "Curio Collection" },
  { re: /\bTapestry\s+Collection\b/i, label: "Tapestry Collection" },
  { re: /\bHilton\b|希爾頓|希尔顿/i, label: "Hilton" },

  // Hyatt family
  { re: /\bPark\s+Hyatt\b|柏悅|柏悦/i, label: "Park Hyatt" },
  { re: /\bGrand\s+Hyatt\b|君悅/i, label: "Grand Hyatt" },
  { re: /\bAndaz\b|安達仕/i, label: "Andaz" },
  { re: /\bHyatt\s+Regency\b|凱悅\s*(?:酒店|大飯店)?/i, label: "Hyatt Regency" },
  { re: /\bHyatt\s+Place\b/i, label: "Hyatt Place" },
  { re: /\bHyatt\s+House\b/i, label: "Hyatt House" },
  { re: /\bHyatt\b|凱悅|凯悦/i, label: "Hyatt" },

  // IHG family
  { re: /\bInter[Cc]ontinental\b|洲際/i, label: "InterContinental" },
  { re: /\bCrowne\s+Plaza\b|皇冠假日/i, label: "Crowne Plaza" },
  { re: /\bHoliday\s+Inn\s+Express\b/i, label: "Holiday Inn Express" },
  { re: /\bHoliday\s+Inn\b|假日酒店/i, label: "Holiday Inn" },
  { re: /\bHotel\s+Indigo\b|英迪格/i, label: "Hotel Indigo" },
  { re: /\bRegent\b|麗晶|丽晶|晶華/i, label: "Regent" },
  { re: /\bKimpton\b/i, label: "Kimpton" },
  { re: /\bvoco\b/i, label: "voco" },

  // Accor family
  { re: /\bRaffles\b|萊佛士/i, label: "Raffles" },
  { re: /\bSofitel\b|索菲特/i, label: "Sofitel" },
  { re: /\bPullman\b|鉑爾曼|铂尔曼/i, label: "Pullman" },
  { re: /\bM\s?Gallery\b/i, label: "MGallery" },
  { re: /\bSwiss(?:ô|o)tel\b/i, label: "Swissôtel" },
  { re: /\bMercure\b|美居/i, label: "Mercure" },
  { re: /\bNovotel\b|諾富特|诺富特/i, label: "Novotel" },
  { re: /\bibis\s+budget\b/i, label: "ibis budget" },
  { re: /\bibis\s+styles\b/i, label: "ibis Styles" },
  { re: /\bibis\b|宜必思/i, label: "ibis" },
  { re: /\bAdagio\b/i, label: "Adagio Aparthotel" },
  { re: /\bMantra\b/i, label: "Mantra" },
  { re: /\bMondrian\b/i, label: "Mondrian" },
  { re: /\bHyde\b/i, label: "Hyde" },

  // Wyndham family
  { re: /\bRamada\b/i, label: "Ramada" },
  { re: /\bDays\s+Inn\b/i, label: "Days Inn" },
  { re: /\bSuper\s+8\b/i, label: "Super 8" },
  { re: /\bTRYP\b/i, label: "TRYP" },
  { re: /\bWyndham\s+Grand\b/i, label: "Wyndham Grand" },
  { re: /\bWyndham\b|溫德姆|温德姆/i, label: "Wyndham" },
  { re: /\bHoward\s+Johnson\b/i, label: "Howard Johnson" },

  // Choice family
  { re: /\bComfort\s+(?:Inn|Suites)\b/i, label: "Comfort by Choice" },
  { re: /\bQuality\s+Inn\b/i, label: "Quality Inn" },
  { re: /\bSleep\s+Inn\b/i, label: "Sleep Inn" },
  { re: /\bClarion\b/i, label: "Clarion" },

  // Asian luxury chains
  { re: /\bMandarin\s+Oriental\b|文華東方|文华东方/i, label: "Mandarin Oriental" },
  { re: /\bShangri[-\s]?La\b|香格里拉/i, label: "Shangri-La" },
  { re: /\bPeninsula\b|半島/i, label: "The Peninsula" },
  { re: /\bFour\s+Seasons\b|四季/i, label: "Four Seasons" },
  { re: /\bAman\b|安縵|安缦/i, label: "Aman" },
  { re: /\bRosewood\b|瑰麗|瑰丽/i, label: "Rosewood" },
  { re: /\bSt\.?\s*Regis\b/i, label: "St. Regis" },
  { re: /\bSwissotel\b/i, label: "Swissôtel" },
  { re: /\bOkura\b|大倉|大仓/i, label: "Hotel Okura" },
  { re: /\bImperial\s+Hotel\b|帝國飯店|帝国饭店/i, label: "The Imperial" },
  { re: /\bNew\s+Otani\b|新大谷/i, label: "Hotel New Otani" },
  { re: /\bNikko\b|日航/i, label: "Hotel Nikko" },
  { re: /\bPrince\s+Hotel\b|王子大飯店|王子大饭店/i, label: "Prince Hotel" },
  { re: /\bAscott\b|雅詩閣/i, label: "Ascott" },
  { re: /\bFraser\b/i, label: "Frasers Hospitality" },
  { re: /\bDusit\s+Thani\b/i, label: "Dusit Thani" },
  { re: /\bOberoi\b/i, label: "The Oberoi" },
  { re: /\bTaj\s+Hotel\b|Taj\s+Mahal/i, label: "Taj Hotels" },

  // European brands
  { re: /\bRadisson\s+Blu\b/i, label: "Radisson Blu" },
  { re: /\bRadisson\s+RED\b/i, label: "Radisson RED" },
  { re: /\bRadisson\b/i, label: "Radisson" },
  { re: /\bMillennium\b/i, label: "Millennium Hotels" },
  { re: /\bKempinski\b|凱賓斯基|凯宾斯基/i, label: "Kempinski" },
  { re: /\bMövenpick\b|莫凡彼/i, label: "Mövenpick" },
  { re: /\bSteigenberger\b/i, label: "Steigenberger" },
  { re: /\bMaritim\b/i, label: "Maritim" },
  { re: /\bNH\s+Hotels?\b/i, label: "NH Hotels" },
  { re: /\bMeli(?:á|a)\b/i, label: "Meliá" },
  { re: /\bIberostar\b/i, label: "Iberostar" },
  { re: /\bFairmont\b/i, label: "Fairmont" },

  // Mid-range / value
  { re: /\bBest\s+Western\s+Premier\b/i, label: "Best Western Premier" },
  { re: /\bBest\s+Western\b/i, label: "Best Western" },
  { re: /\bMotel\s+6\b/i, label: "Motel 6" },
  { re: /\bExtended\s+Stay\b/i, label: "Extended Stay America" },
  { re: /\bLa\s+Quinta\b/i, label: "La Quinta" },
  { re: /\bRed\s+Roof\b/i, label: "Red Roof" },
  { re: /\bRed\s+Lion\b/i, label: "Red Lion" },
  { re: /\bChoice\s+Hotels?\b/i, label: "Choice Hotels" },
  { re: /\bOmni\s+Hotel/i, label: "Omni Hotels" },
  { re: /\bLoews\s+Hotel/i, label: "Loews" },
  { re: /\bDrury\s+Inn\b/i, label: "Drury" },
  { re: /\bHomewood\b/i, label: "Homewood Suites" },
  { re: /\bHarrys?\s+Home\b/i, label: "Harrys Home" },
  { re: /\bCitadines\b|馨樂庭/i, label: "Citadines" },

  // Taiwan local chains
  { re: /\b圓山大飯店\b|\bGrand\s+Hotel\s+Taipei\b/i, label: "The Grand Hotel" },
  { re: /\b君品(?:酒店|collection)\b|Palais\s+de\s+Chine/i, label: "Palais de Chine" },
  { re: /\b福華\b/i, label: "Howard" },
  { re: /\b老爺\b/i, label: "Royal" },
  { re: /\b雲品\b|Fleur\s+de\s+Chine/i, label: "Fleur de Chine" },
  { re: /\b涵碧樓\b|The\s+Lalu/i, label: "The Lalu" },
  { re: /\b長榮桂冠\b|Evergreen\s+Laurel/i, label: "Evergreen Laurel" },
  { re: /\b漢來\b|Han\s*-?\s*Lai/i, label: "Han-Lai" },
  { re: /\b國賓\s*(?:大飯店)?\b|Ambassador\s+Hotel/i, label: "Ambassador" },
  { re: /\b兄弟\s*(?:大飯店)?\b|Brother\s+Hotel/i, label: "Brother" },
  { re: /\b劍湖山\b/i, label: "Janfusun" },
  { re: /\b六福\b/i, label: "Leofoo" },
  { re: /\b福容\b|Fullon/i, label: "Fullon" },
  { re: /\b煙波\b|Yen\s+Pin/i, label: "Yen Pin" },
  { re: /\b統一(?:渡假村|時代)\b/i, label: "Uni-Resort" },
  { re: /\b義大\s*(?:皇冠|天悅)/i, label: "E-DA Hotel" },
];

/**
 * Extract a canonical brand label from a hotel name.
 *
 * @param hotelName  The full hotel name (English, Chinese, or mixed).
 * @returns          The brand label, or null when no pattern matches.
 *
 * @example
 *   extractHotelBrand("RADISSON HOTEL ZURICH AIRPORT") // → "Radisson"
 *   extractHotelBrand("Mercure Zurich City")           // → "Mercure"
 *   extractHotelBrand("台北君悅酒店")                    // → "Grand Hyatt"
 *   extractHotelBrand("溫泉旅館")                        // → null (boutique, no chain)
 */
export function extractHotelBrand(hotelName: string | undefined | null): string | null {
  if (!hotelName) return null;
  const trimmed = String(hotelName).trim();
  if (!trimmed) return null;

  for (const { re, label } of BRAND_PATTERNS) {
    if (re.test(trimmed)) return label;
  }
  return null;
}

/**
 * Same as extractHotelBrand but returns a fallback string instead of null.
 * Convenience wrapper for places that always need a string value.
 */
export function getHotelBrandOrFallback(
  hotelName: string | undefined | null,
  fallback = "獨立精品"
): string {
  return extractHotelBrand(hotelName) ?? fallback;
}
