import { useState, useEffect } from "react";
import { MessageCircle, X } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

interface AIAssistantButtonProps {
  onClick: () => void;
  isOpen: boolean;
}

export default function AIAssistantButton({ onClick, isOpen }: AIAssistantButtonProps) {
  const { t } = useLocale();
  const [showBubble, setShowBubble] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [bubbleAnimation, setBubbleAnimation] = useState(true);

  // Hide bubble after 8 seconds, show again every 30 seconds
  useEffect(() => {
    if (isOpen) {
      setShowBubble(false);
      return;
    }

    const hideTimer = setTimeout(() => {
      setShowBubble(false);
    }, 8000);

    const showInterval = setInterval(() => {
      setShowBubble(true);
      setBubbleAnimation(true);
      setTimeout(() => setShowBubble(false), 8000);
    }, 30000);

    return () => {
      clearTimeout(hideTimer);
      clearInterval(showInterval);
    };
  }, [isOpen]);

  // Animate bubble entrance
  useEffect(() => {
    if (showBubble) {
      setBubbleAnimation(true);
    }
  }, [showBubble]);

  if (isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Speech Bubble */}
      {showBubble && (
        <div
          className={`relative bg-white border-2 border-black px-4 py-3 max-w-[200px] transition-all duration-500 ${
            bubbleAnimation ? "animate-bounce-in opacity-100" : "opacity-0"
          }`}
          style={{
            animation: bubbleAnimation ? "bounceIn 0.5s ease-out" : "none",
          }}
        >
          <p className="text-sm font-medium text-black">
            {t('aiAdvisor.bubblePrompt')}
          </p>
          {/* Arrow pointing down */}
          <div
            className="absolute -bottom-3 right-8 w-0 h-0"
            style={{
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderTop: "12px solid black",
            }}
          />
          <div
            className="absolute -bottom-2 right-8 w-0 h-0"
            style={{
              borderLeft: "8px solid transparent",
              borderRight: "8px solid transparent",
              borderTop: "10px solid white",
              marginLeft: "2px",
            }}
          />
          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowBubble(false);
            }}
            className="absolute -top-2 -right-2 w-5 h-5 bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Main Button with Character */}
      <button
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`relative group transition-all duration-300 ${
          isHovered ? "scale-110" : "scale-100"
        }`}
        aria-label={t('common.openAiAdvisor')}
      >
        {/* Character Avatar */}
        <div
          className={`w-16 h-16 border-2 border-black bg-white flex items-center justify-center overflow-hidden transition-all duration-300 ${
            isHovered ? "shadow-lg" : "shadow-md"
          }`}
        >
          <img
            src="/ai-assistant-avatar.png"
            alt={t('aiAdvisor.title')}
            className={`w-14 h-14 object-contain transition-transform duration-300 ${
              isHovered ? "scale-110" : "scale-100"
            }`}
          />
        </div>

        {/* Notification Badge */}
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-black text-white text-xs font-bold flex items-center justify-center animate-pulse">
          <MessageCircle className="h-3 w-3" />
        </div>

        {/* Hover Ring Effect */}
        <div
          className={`absolute inset-0 border-2 border-black transition-all duration-300 ${
            isHovered ? "scale-125 opacity-50" : "scale-100 opacity-0"
          }`}
        />
      </button>

      {/* Custom Styles */}
      <style>{`
        @keyframes bounceIn {
          0% {
            opacity: 0;
            transform: scale(0.3) translateY(20px);
          }
          50% {
            opacity: 1;
            transform: scale(1.05) translateY(-5px);
          }
          70% {
            transform: scale(0.95) translateY(2px);
          }
          100% {
            transform: scale(1) translateY(0);
          }
        }
        
        .animate-bounce-in {
          animation: bounceIn 0.5s ease-out;
        }
      `}</style>
    </div>
  );
}
