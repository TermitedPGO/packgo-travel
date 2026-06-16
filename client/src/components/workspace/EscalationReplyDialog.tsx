/**
 * EscalationReplyDialog — 批9 m1 escalation 卡的「編輯並回覆」🔒 dialog.
 *
 * Prefills the AI draft, Jeff edits, the gated checkbox names the recipient,
 * then commandCenter.escalationReply sends in the ORIGINAL Gmail thread.
 * Honest outcomes: sent / dry-run(kill switch)/ failed all surface as-is.
 *
 * 2026-06-15 reply-attachments — a drag/drop + click composer uploads desktop
 * files DIRECTLY to R2 (presigned PUT) and attaches them to this reply. Files
 * >25MB degrade to a download link server-side; the customer always gets the
 * file one way or the other.
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Lock, Paperclip, X, Loader2 } from "lucide-react";
import { BtnB, BtnO } from "./ws-ui";

/** Mirror of server/_core/replyAttachments.ts (whitelist + 50MB cap). */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const ALLOWED_MIME = new Set(Object.values(EXT_TO_MIME));
const ACCEPT = ".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.webp";

/** Browsers sometimes report an empty/wrong type (esp. xlsx) — fall back to
 *  the extension so we send a whitelisted mime to both presign + PUT. */
function resolveMime(file: File): string | null {
  if (file.type && ALLOWED_MIME.has(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AttachmentItem {
  localId: string;
  filename: string;
  size: number;
  status: "uploading" | "done" | "error";
  key?: string;
}

export default function EscalationReplyDialog({
  messageId,
  customerEmail,
  draft,
  onClose,
  onSent,
}: {
  messageId: number;
  customerEmail: string;
  draft: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useLocale();
  const [body, setBody] = useState(draft);
  const [confirmed, setConfirmed] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const presignMut = trpc.commandCenter.createReplyAttachmentUpload.useMutation();

  const replyMut = trpc.commandCenter.escalationReply.useMutation({
    onSuccess: (res) => {
      if (res.sent) {
        toast.success(t("workspace.escReplySent", { email: customerEmail }));
        onSent();
        onClose();
      } else if (res.dryRun) {
        toast.warning(t("workspace.escReplyDryRun"));
      } else {
        toast.error(
          t("workspace.escReplyFailed", {
            msg: res.errorMessage ?? "",
          }),
        );
      }
    },
    onError: (e) =>
      toast.error(t("workspace.escReplyFailed", { msg: e.message })),
  });

  const setStatus = (localId: string, patch: Partial<AttachmentItem>) =>
    setAttachments((prev) =>
      prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)),
    );

  async function uploadOne(file: File) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t("workspace.escReplyAttachTooBig", { name: file.name }));
      return;
    }
    const mimeType = resolveMime(file);
    if (!mimeType) {
      toast.error(t("workspace.escReplyAttachBadType", { name: file.name }));
      return;
    }
    const localId = `${file.name}-${file.size}-${attachments.length}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    setAttachments((prev) => [
      ...prev,
      { localId, filename: file.name, size: file.size, status: "uploading" },
    ]);
    try {
      const { key, putUrl } = await presignMut.mutateAsync({
        filename: file.name,
        mimeType,
        size: file.size,
      });
      // Direct browser → R2 PUT. Content-Type MUST match the signed value.
      const put = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
      setStatus(localId, { status: "done", key });
    } catch {
      setStatus(localId, { status: "error" });
      toast.error(t("workspace.escReplyAttachFailed", { name: file.name }));
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) void uploadOne(f);
  }

  const removeAttachment = (localId: string) =>
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));

  const uploading = attachments.some((a) => a.status === "uploading");
  const ready = attachments.filter((a) => a.status === "done" && a.key);
  const valid = body.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-lg shadow-lg">
        <h3 className="text-sm font-semibold mb-1">
          {t("workspace.escReplyTitle")}
        </h3>
        <p className="text-[11px] text-gray-500 mb-3">
          {t("workspace.escReplyTo", { email: customerEmail })}
        </p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={9}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] leading-relaxed"
        />

        {/* Attachment composer — drag/drop or click */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-3 rounded-lg border border-dashed px-3 py-3 text-center cursor-pointer transition-colors ${
            dragOver ? "border-black bg-gray-50" : "border-gray-300"
          }`}
        >
          <div className="flex items-center justify-center gap-1.5 text-[12px] text-gray-700">
            <Paperclip className="w-3.5 h-3.5" />
            <span>{t("workspace.escReplyAttachHint")}</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {t("workspace.escReplyAttachTypes")}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />

        {attachments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {attachments.map((a) => (
              <li
                key={a.localId}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px]"
              >
                {a.status === "uploading" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 flex-shrink-0" />
                ) : (
                  <Paperclip
                    className={`w-3.5 h-3.5 flex-shrink-0 ${
                      a.status === "error" ? "text-red-500" : "text-gray-500"
                    }`}
                  />
                )}
                <span className="flex-1 min-w-0 truncate text-gray-800">
                  {a.filename}
                </span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  {a.status === "uploading"
                    ? t("workspace.escReplyAttachUploading")
                    : humanSize(a.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.localId)}
                  className="flex-shrink-0 rounded-md p-0.5 hover:bg-gray-100"
                  aria-label={t("workspace.escReplyAttachRemove")}
                >
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 rounded-lg bg-black text-white px-3 py-2.5 flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <label className="flex items-start gap-2 cursor-pointer text-[11px] leading-relaxed">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t("workspace.escReplyConfirm", { email: customerEmail })}
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <BtnO onClick={onClose}>{t("workspace.supCancel")}</BtnO>
          <BtnB
            onClick={() =>
              replyMut.mutate({
                messageId,
                body: body.trim(),
                attachments: ready.map((a) => ({
                  key: a.key!,
                  filename: a.filename,
                })),
              })
            }
            disabled={!valid || !confirmed || uploading || replyMut.isPending}
          >
            {replyMut.isPending
              ? t("workspace.escReplySending")
              : t("workspace.escReplyGo")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
