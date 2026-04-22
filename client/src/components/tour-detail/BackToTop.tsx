/**
 * BackToTop Component
 * 浮動返回頂部按鈕，滾動超過 500px 時顯示
 */

import React, { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import { ensureReadableOnWhite } from "@/lib/colorUtils";
import { useLocale } from "@/contexts/LocaleContext";

export interface BackToTopProps {
  colorTheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export const BackToTop: React.FC<BackToTopProps> = ({ colorTheme }) => {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.pageYOffset > 500) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener("scroll", toggleVisibility);

    return () => {
      window.removeEventListener("scroll", toggleVisibility);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <>
      {isVisible && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 z-50 p-4 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110"
          style={{
            backgroundColor: colorTheme.accent,
            color: "white",
          }}
          aria-label={t('common.backToTop')}
        >
          <ArrowUp className="h-6 w-6" />
        </button>
      )}
    </>
  );
};
