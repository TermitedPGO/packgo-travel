import React, { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditableTextProps {
  value: string;
  onSave: (value: string) => void;
  isEditing: boolean; // 全局編輯模式
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div";
  /** 是否為深色背景（Hero 區塊用） */
  darkBackground?: boolean;
}

export function EditableText({
  value,
  onSave,
  isEditing,
  className = "",
  inputClassName = "",
  placeholder = "點擊編輯...",
  multiline = false,
  maxLength,
  as: Component = "span",
  darkBackground = false,
}: EditableTextProps) {
  const [isActive, setIsActive] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isActive]);

  const handleSave = () => {
    if (editValue !== value) {
      onSave(editValue);
    }
    setIsActive(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsActive(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  // 非編輯模式：直接顯示文字
  if (!isEditing) {
    return <Component className={className}>{value || placeholder}</Component>;
  }

  // 編輯模式但未激活：顯示可點擊的文字（帶虛線框 + 懸停高亮）
  if (!isActive) {
    return (
      <Component
        className={cn(
          className,
          "cursor-pointer relative group transition-all duration-150",
          // 虛線框：在編輯模式下始終顯示
          darkBackground
            ? "outline outline-1 outline-dashed outline-yellow-400/60 rounded-sm hover:outline-yellow-400 hover:outline-2"
            : "outline outline-1 outline-dashed outline-blue-300/70 rounded-sm hover:outline-blue-500 hover:outline-2",
          // 懸停背景
          darkBackground ? "hover:bg-black/30" : "hover:bg-blue-50/80",
          "px-1 py-0.5",
        )}
        onClick={() => setIsActive(true)}
        title="點擊編輯"
      >
        {value || <span className={darkBackground ? "text-gray-300 italic" : "text-gray-400 italic"}>{placeholder}</span>}
        {/* 懸停時顯示「點擊編輯」提示 */}
        <span className={cn(
          "absolute -top-7 left-0 text-xs px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10",
          darkBackground ? "bg-yellow-400 text-yellow-900" : "bg-blue-600 text-white"
        )}>
          <Pencil className="inline h-3 w-3 mr-1" />
          點擊編輯
        </span>
      </Component>
    );
  }

  // 編輯模式且激活：顯示輸入框（藍色邊框 + 淺藍背景）
  return (
    <div className={cn(
      "flex items-start gap-2 rounded-lg p-2 border-2 shadow-xl backdrop-blur-sm w-full",
      darkBackground ? "bg-white/95 border-yellow-400" : "bg-blue-50 border-blue-500"
    )}>
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={maxLength}
          className={cn(
            "bg-transparent border-none outline-none resize-none min-h-[60px] w-full text-gray-900",
            inputClassName
          )}
          placeholder={placeholder}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={maxLength}
          className={cn(
            "bg-transparent border-none outline-none min-w-[100px] w-full text-gray-900",
            inputClassName
          )}
          placeholder={placeholder}
        />
      )}
      {maxLength && (
        <span className="text-xs text-gray-400 whitespace-nowrap self-end">
          {editValue.length}/{maxLength}
        </span>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
          className="p-1.5 hover:bg-green-100 rounded-lg text-green-600 transition-colors"
          title="儲存 (Enter)"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
          className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors"
          title="取消 (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default EditableText;
