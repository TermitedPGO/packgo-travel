import { useEffect } from "react";

interface SEOConfig {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: "website" | "article" | "product";
  keywords?: string;
  jsonLd?: Record<string, unknown>;
}

const SITE_NAME = "PACK&GO 旅行社";
const BASE_URL = "https://packgo-d3xjbq67.manus.space";
const DEFAULT_IMAGE = `${BASE_URL}/og-image.jpg`;

/**
 * Hook to dynamically update SEO meta tags for each page.
 * Restores defaults on unmount to prevent stale meta from persisting.
 */
export function useSEO(config: SEOConfig) {
  useEffect(() => {
    const {
      title,
      description,
      image = DEFAULT_IMAGE,
      url = window.location.href,
      type = "website",
      keywords,
      jsonLd,
    } = config;

    const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | 專業旅遊規劃、團體旅遊、客製行程`;

    // Update <title>
    document.title = fullTitle;

    // Helper to set/create a meta tag
    const setMeta = (selector: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        const attr = selector.startsWith("meta[name")
          ? "name"
          : selector.startsWith("meta[property")
          ? "property"
          : "name";
        const val = selector.match(/["']([^"']+)["']/)?.[1] || "";
        el.setAttribute(attr, val);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    // Standard meta
    if (description) setMeta(`meta[name="description"]`, description);
    if (keywords) setMeta(`meta[name="keywords"]`, keywords);

    // Open Graph
    setMeta(`meta[property="og:title"]`, fullTitle);
    setMeta(`meta[property="og:type"]`, type);
    setMeta(`meta[property="og:url"]`, url);
    if (description) setMeta(`meta[property="og:description"]`, description);
    setMeta(`meta[property="og:image"]`, image);

    // Twitter Card
    setMeta(`meta[name="twitter:title"]`, fullTitle);
    if (description) setMeta(`meta[name="twitter:description"]`, description);
    setMeta(`meta[name="twitter:image"]`, image);

    // Canonical URL
    let canonical = document.querySelector<HTMLLinkElement>(`link[rel="canonical"]`);
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;

    // JSON-LD structured data
    if (jsonLd) {
      const existingScript = document.querySelector(`script[type="application/ld+json"][data-dynamic]`);
      if (existingScript) existingScript.remove();
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute("data-dynamic", "true");
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    // Cleanup: restore defaults on unmount
    return () => {
      document.title = `${SITE_NAME} | 專業旅遊規劃、團體旅遊、客製行程`;
      setMeta(`meta[property="og:title"]`, `${SITE_NAME} | 專業旅遊規劃`);
      setMeta(`meta[property="og:type"]`, "website");
      setMeta(`meta[property="og:url"]`, BASE_URL);
      setMeta(`meta[property="og:image"]`, DEFAULT_IMAGE);
      setMeta(`meta[name="twitter:title"]`, `${SITE_NAME} | 專業旅遊規劃`);
      setMeta(`meta[name="twitter:image"]`, DEFAULT_IMAGE);
      const dynamicScript = document.querySelector(`script[type="application/ld+json"][data-dynamic]`);
      if (dynamicScript) dynamicScript.remove();
    };
  }, [config.title, config.description, config.image, config.url, config.type, config.keywords]);
}
