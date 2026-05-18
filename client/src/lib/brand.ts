/**
 * PACK&GO brand constants — single source of truth for contact info,
 * brand colors, and trust badges. Centralized so we don't have
 * `Jeffhsieh09@gmail.com` hardcoded across 8 files.
 *
 * Anything that touches buyer-facing strings (email, phone, license, address)
 * MUST import from here. If you find a hardcoded brand value elsewhere,
 * pull it into this file and import.
 */

export const BRAND = {
  name: "PACK&GO",
  legalName: "PACK&GO LLC",
  tagline: "Curated Journeys, Lasting Memories",
  taglineZh: "讓每一次旅行都成為難忘的回憶",
} as const;

export const CONTACT = {
  // v80.24: dropped personal Gmail. If you don't have a domain email yet,
  // forward `support@packgo.us` → your inbox via Google Workspace.
  email: "support@packgo.us",
  // Backup email shown only on internal admin pages, never on buyer-facing UI.
  emailBackup: "jeffhsieh09@gmail.com",
  phone: "+1 (510) 634-2307",
  phoneDisplay: "+1 510 634 2307",
  whatsapp: "+15106342307",
  website: "https://packgoplay.com",
  websiteDisplay: "packgoplay.com",
  // v80.24: corrected to actual CST/legal-registered address. Earlier draft
  // had "39159 Paseo Padre Pkwy" which was wrong — Cedar Blvd is the address
  // on Newark business license #115594 + CST #2166984 + privacy policy.
  address: {
    street: "39055 Cedar Blvd #126",
    city: "Newark",
    state: "CA",
    zip: "94560",
    country: "USA",
  },
  newarkBusinessLicense: "115594",
  hoursPT: "Mon-Fri 9:00-18:00 PT",
  hoursZh: "週一至週五 9:00-18:00 PT",
} as const;

/**
 * Travel-agency licenses we display as trust signals on every tour page.
 * CST (California Seller of Travel) is required by California law; TCRF
 * (Travel Consumer Restitution Fund) covers consumer protection.
 */
export const LICENSES = {
  cst: "CST# 2166984",
  cstFull: "California Seller of Travel #2166984",
  tcrf: "TCRF Member",
  iata: "", // Add if/when registered
} as const;

/**
 * Refund policy displayed in the static block on every tour page.
 * Centralized so changing terms cascades site-wide. If you ever change
 * these, also update `客戶條款` page and `tourPrint.cancel*` i18n keys.
 */
export const REFUND_POLICY = {
  zh: [
    "出發前 30 天以上取消：全額退費（扣除已支付實際成本）",
    "出發前 14-29 天取消：退費 70%",
    "出發前 7-13 天取消：退費 50%",
    "出發前 1-6 天取消：退費 30%",
    "出發當天或行程開始後取消：恕不退費",
  ],
  en: [
    "30+ days before departure: Full refund (less actual costs paid)",
    "14-29 days before: 70% refund",
    "7-13 days before: 50% refund",
    "1-6 days before: 30% refund",
    "Day of departure or after: No refund",
  ],
} as const;

/**
 * Brand color palette — must match CLAUDE.md design tokens.
 * Use CSS variables (`var(--c-gold)`) when possible; this object is for
 * places where Tailwind arbitrary values can't reach (canvas, charts).
 */
export const COLORS = {
  black: "#1A1A1A",
  cream: "#FAF8F2",
  gold: "#C9A563",
  goldDark: "#8A6F3A",
  goldLight: "#E5D4A8",
} as const;
