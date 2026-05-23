/**
 * Receipt camera FAB — Mobile Phase 6 (2026-05-22).
 *
 * Persistent bottom-right floating action button (above bottom nav).
 * Tap → device camera (HTML5 `<input capture>`) → upload to R2 →
 * Claude vision OCR → suggest matching bankTransaction → 1-tap attach.
 *
 * Cost-controlled: each tap is ~$0.003. Daily cap enforced server-side.
 */

import { useRef, useState } from "react";
import { Camera, Loader2, X, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type OcrResult = {
  amount: number | null;
  date: string | null;
  vendor: string | null;
  currency: string | null;
  confidence: number;
};

type Match = {
  id: number;
  date: any;
  amount: any;
  merchantName: string | null;
  score: number;
};

export default function ReceiptCameraFAB() {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    uploadUrl: string;
    ocr: OcrResult;
    matches: Match[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const utils = trpc.useUtils();
  const upload = trpc.plaid.receiptUploadAndMatch.useMutation({
    onSuccess: (r) => setResult(r as any),
    onError: (e) => toast.error(`OCR 失敗: ${e.message}`),
  });
  const attach = trpc.plaid.transactionUpdate.useMutation({
    onSuccess: () => {
      utils.plaid.transactionsList.invalidate();
      toast.success("收據已連結");
      setResult(null);
      setOpen(false);
    },
    onError: (e) => toast.error(`連結失敗: ${e.message}`),
  });

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("檔案超過 10MB");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
      ] as const;
      const ct = file.type || "image/jpeg";
      if (!(allowed as readonly string[]).includes(ct)) {
        toast.error("只接受 JPG / PNG / WebP / PDF");
        return;
      }
      await upload.mutateAsync({
        contentType: ct as (typeof allowed)[number],
        base64Data: dataUrl,
        originalFilename: file.name,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-teal-600 text-white shadow-lg z-40 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-70"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        aria-label="拍收據"
      >
        {uploading ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <Camera className="w-6 h-6" />
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setOpen(true);
            void handleFile(f);
          }
          // Reset so the same file can be re-selected later
          e.target.value = "";
        }}
      />

      {/* Result modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">收據分析</h2>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setOpen(false);
                }}
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-gray-100"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {upload.isPending && !result ? (
              <div className="py-8 text-center">
                <Loader2 className="w-8 h-8 mx-auto animate-spin text-teal-600 mb-2" />
                <p className="text-sm text-gray-600">AI 看圖中…</p>
              </div>
            ) : result ? (
              <ResultBody
                result={result}
                onAttach={(txnId, receiptUrl) =>
                  attach.mutate({ transactionId: txnId, receiptUrl })
                }
                attachPending={attach.isPending}
              />
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

function ResultBody({
  result,
  onAttach,
  attachPending,
}: {
  result: { uploadUrl: string; ocr: OcrResult; matches: Match[] };
  onAttach: (txnId: number, receiptUrl: string) => void;
  attachPending: boolean;
}) {
  const { ocr, matches, uploadUrl } = result;
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
          AI 看到
        </h3>
        <ul className="text-sm text-gray-700 space-y-0.5">
          <li>
            <span className="text-gray-500">金額：</span>
            {ocr.amount !== null ? `${ocr.currency ?? "$"}${ocr.amount}` : "(看不清)"}
          </li>
          <li>
            <span className="text-gray-500">日期：</span>
            {ocr.date ?? "(看不清)"}
          </li>
          <li>
            <span className="text-gray-500">商家：</span>
            {ocr.vendor ?? "(看不清)"}
          </li>
          <li>
            <span className="text-gray-500">信心：</span>
            {ocr.confidence}%
          </li>
        </ul>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
          配對的 BofA 交易
        </h3>
        {matches.length === 0 ? (
          <div className="text-sm text-gray-500 py-2">
            沒有金額相近的交易。手動到 BankLedger 選一筆 attach。
          </div>
        ) : (
          <ul className="space-y-2">
            {matches.map((m) => {
              const amt = Math.abs(parseFloat(String(m.amount)) || 0);
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-lg border border-gray-200"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 font-medium truncate">
                      {m.merchantName ?? "(unknown)"}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      ${amt.toFixed(2)} ·{" "}
                      {new Date(m.date).toLocaleDateString("zh-TW")} · score{" "}
                      {m.score}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAttach(m.id, uploadUrl)}
                    disabled={attachPending}
                    className="px-3 h-9 rounded-md bg-teal-600 text-white text-xs font-medium flex items-center gap-1 active:bg-teal-700 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> 附上
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <a
        href={uploadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-xs text-teal-700 underline pb-2"
      >
        查看原始圖
      </a>
    </div>
  );
}
