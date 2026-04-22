/**
 * EditableText Component
 * 可編輯文字組件 - 點擊即可編輯，支援自動儲存
 */

import React, { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";

export interface EditableTextProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  isEditable?: boolean;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  style?: React.CSSProperties;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span";
}

export const EditableText: React.FC<EditableTextProps> = ({
  value,
  onSave,
  isEditable = false,
  className = "",
  placeholder,
  multiline = false,
  maxLength,
  style,
  as: Component = "span",
}) => {
  const { t } = useLocale();
  const resolvedPlaceholder = placeholder ?? t('common.clickToEditPlaceholder');
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [showEditIcon, setShowEditIcon] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    if (!isEditable) return;
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(editValue);
      setIsEditing(false);
    } catch (error) {
      console.error("儲存失敗:", error);
      // 可以加入 toast 通知
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  // 非編輯模式
  if (!isEditing) {
    return (
      <div
        className={cn(
          "relative flex items-center gap-2 group max-w-full",
          isEditable && "cursor-pointer hover:ring-2 hover:ring-yellow-400 hover:ring-offset-2 rounded-lg px-2 py-1 transition-all duration-200"
        )}
        onMouseEnter={() => setShowEditIcon(true)}
        onMouseLeave={() => setShowEditIcon(false)}
        onClick={handleStartEdit}
        title={isEditable ? t('common.clickToEdit') : undefined}
      >
        <Component className={className} style={style}>
          {value || <span className="text-gray-400 italic">{resolvedPlaceholder}</span>}
        </Component>
        {isEditable && (
          <div className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-yellow-400 text-yellow-900 p-1.5 rounded-lg shadow-lg">
              <Pencil className="h-4 w-4" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // 編輯模式
  return (
    <div className="relative flex items-center gap-2 w-full max-w-full">
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // 延遲執行，讓按鈕點擊事件先觸發
            setTimeout(() => {
              if (!isSaving) handleSave();
            }, 200);
          }}
          maxLength={maxLength}
          className={cn(
            "w-full px-2 py-1 border-2 border-yellow-400 rounded bg-yellow-50 focus:outline-none focus:ring-2 focus:ring-yellow-300",
            className
          )}
          style={style}
          rows={3}
          disabled={isSaving}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setTimeout(() => {
              if (!isSaving) handleSave();
            }, 200);
          }}
          maxLength={maxLength}
          className={cn(
            "w-full px-2 py-1 border-2 border-yellow-400 rounded bg-yellow-50 focus:outline-none focus:ring-2 focus:ring-yellow-300",
            className
          )}
          style={style}
          disabled={isSaving}
        />
      )}
      
      {/* 儲存/取消按鈕 */}
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="p-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
          title={t('common.saveShortcut')}
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          onClick={handleCancel}
          disabled={isSaving}
          className="p-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          title={t('common.cancelShortcut')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
