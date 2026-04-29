/**
 * WechatAssistTab — admin view of v78 WeChat draft-and-approve flow.
 *
 * Lists pending messages where AI has produced a draft reply. Admin can
 * read inbound, edit the draft, approve (sends), or skip.
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { LoadingRow } from "@/components/ui/spinner";
import {
  CheckCircle2,
  XCircle,
  MessageSquare,
  Sparkles,
  Plus,
  Calendar,
} from "lucide-react";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

export default function WechatAssistTab() {
  const { language, t } = useLocale();
  const dateLocale = language === "zh-TW" ? zhTW : enUS;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editedDraft, setEditedDraft] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [composeFrom, setComposeFrom] = useState("");

  const utils = trpc.useUtils();
  const { data: messages, isLoading } = trpc.wechatAssist.listPending.useQuery({
    limit: 100,
  });

  const selected = messages?.find((m: any) => m.id === selectedId);

  useEffect(() => {
    if (selected) setEditedDraft(selected.aiDraftText || "");
  }, [selectedId, selected?.aiDraftText]);

  const draftReplyMutation = trpc.wechatAssist.draftReply.useMutation({
    onSuccess: () => {
      utils.wechatAssist.listPending.invalidate();
      toast.success(t("wechatAssistTab.toastDraftReady"));
      setIsComposing(false);
      setComposeText("");
      setComposeFrom("");
    },
    onError: (err) => toast.error(t("wechatAssistTab.toastFailed") + err.message),
  });

  const approveMutation = trpc.wechatAssist.approve.useMutation({
    onSuccess: () => {
      utils.wechatAssist.listPending.invalidate();
      toast.success(t("wechatAssistTab.toastApproved"));
      setSelectedId(null);
    },
    onError: (err) => toast.error(t("wechatAssistTab.toastFailed") + err.message),
  });

  const skipMutation = trpc.wechatAssist.skip.useMutation({
    onSuccess: () => {
      utils.wechatAssist.listPending.invalidate();
      toast.success(t("wechatAssistTab.toastSkipped"));
      setSelectedId(null);
    },
    onError: (err) => toast.error(t("wechatAssistTab.toastFailed") + err.message),
  });

  const fmtDate = (d: Date | string | null) => {
    if (!d) return "—";
    try {
      return format(new Date(d), "MM/dd HH:mm", { locale: dateLocale });
    } catch {
      return "—";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("wechatAssistTab.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("wechatAssistTab.subtitle")}
          </p>
        </div>
        <Button
          className="rounded-lg gap-1.5"
          onClick={() => setIsComposing(true)}
        >
          <Plus className="h-4 w-4" />
          {t("wechatAssistTab.addMessage")}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">{t("wechatAssistTab.pendingTitle")}</h3>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {isLoading && (
              <div className="p-4">
                <LoadingRow colSpan={1} />
              </div>
            )}
            {!isLoading && (!messages || messages.length === 0) && (
              <div className="px-4 py-12 text-center text-sm text-gray-500">
                {t("wechatAssistTab.emptyPending")}
              </div>
            )}
            {messages?.map((m: any) => {
              const isSelected = selectedId === m.id;
              const confidence = Number(m.aiConfidence) || 0;
              const confidenceColor =
                confidence >= 0.8
                  ? "text-green-700 bg-green-100"
                  : confidence >= 0.6
                  ? "text-amber-700 bg-amber-100"
                  : "text-red-700 bg-red-100";
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    isSelected ? "bg-blue-50 border-l-4 border-l-blue-500" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-sm font-medium text-gray-900">
                      {m.fromDisplayName || t("wechatAssistTab.unknownUser")}
                    </div>
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded ${confidenceColor}`}
                    >
                      {Math.round(confidence * 100)}%
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 line-clamp-2 mb-1">
                    {m.inboundText}
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {fmtDate(m.receivedAt)}
                    {Array.isArray(m.detectedIntent) &&
                      m.detectedIntent.length > 0 && (
                        <span className="ml-2 text-gray-500">
                          {t("wechatAssistTab.intentLabel")}{m.detectedIntent.join(", ")}
                        </span>
                      )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          {!selected ? (
            <div className="px-4 py-24 text-center">
              <MessageSquare className="h-12 w-12 mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">{t("wechatAssistTab.selectMessageHint")}</p>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  {t("wechatAssistTab.inboundLabel", { name: selected.fromDisplayName || t("wechatAssistTab.unknownLabel") })}
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">
                  {selected.inboundText}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  {t("wechatAssistTab.aiDraftLabel")}
                </div>
                <Textarea
                  rows={10}
                  value={editedDraft}
                  onChange={(e) => setEditedDraft(e.target.value)}
                  className="rounded-lg font-mono text-sm"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg gap-1"
                  onClick={() => {
                    navigator.clipboard.writeText(editedDraft);
                    toast.success(t("wechatAssistTab.toastCopied"));
                  }}
                >
                  {t("wechatAssistTab.copyText")}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-lg gap-1"
                    onClick={() =>
                      skipMutation.mutate({ messageId: selected.id })
                    }
                    disabled={skipMutation.isPending}
                  >
                    <XCircle className="h-4 w-4" />
                    {t("wechatAssistTab.skip")}
                  </Button>
                  <Button
                    className="rounded-lg gap-1 bg-green-600 hover:bg-green-700"
                    onClick={() =>
                      approveMutation.mutate({
                        messageId: selected.id,
                        finalText: editedDraft,
                      })
                    }
                    disabled={approveMutation.isPending || !editedDraft.trim()}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {t("wechatAssistTab.approve")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isComposing} onOpenChange={setIsComposing}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("wechatAssistTab.composeDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t("wechatAssistTab.composeDialogBody")}
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {t("wechatAssistTab.composeNameLabel")}
              </label>
              <Input
                placeholder={t("wechatAssistTab.composeNamePlaceholder")}
                value={composeFrom}
                onChange={(e) => setComposeFrom(e.target.value)}
                className="rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {t("wechatAssistTab.composeMessageLabel")}
              </label>
              <Textarea
                rows={6}
                placeholder={t("wechatAssistTab.composeMessagePlaceholder")}
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                className="rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="rounded-lg"
                onClick={() => setIsComposing(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                className="rounded-lg"
                disabled={
                  !composeText.trim() || draftReplyMutation.isPending
                }
                onClick={() =>
                  draftReplyMutation.mutate({
                    inboundText: composeText,
                    source: "manual_paste",
                    fromDisplayName: composeFrom || undefined,
                  })
                }
              >
                {draftReplyMutation.isPending ? t("wechatAssistTab.composeSubmitting") : t("wechatAssistTab.composeSubmit")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
