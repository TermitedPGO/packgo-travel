/**
 * PreDepartureNotices — batch 6 m3: per-customer draft review queue.
 * Embeds inside DepartureDetailSheet. Generate → review each → approve/skip.
 */
import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge, BadgeK, Vault } from "./ws-ui";
import { BtnB, BtnO } from "./ws-ui";

export default function PreDepartureNotices({
  departureId,
}: {
  departureId: number;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const listQ = trpc.preDepartureNotifications.list.useQuery({ departureId });
  const generate = trpc.preDepartureNotifications.generate.useMutation({
    onSuccess: (r) => {
      if (r.skipped) {
        toast.info(t("workspace.pdnNone").split(".")[0]);
      } else {
        toast.success(`${r.created} drafts`);
      }
      utils.preDepartureNotifications.list.invalidate({ departureId });
    },
    onError: (e) => toast.error(e.message),
  });

  const invalidate = () =>
    utils.preDepartureNotifications.list.invalidate({ departureId });

  const items = listQ.data ?? [];

  return (
    <section>
      <h3 className="text-sm font-bold mb-2">{t("workspace.pdnTitle")}</h3>

      <div className="rounded-lg bg-black text-white text-xs px-3 py-2.5 font-medium mb-3">
        <Vault>{t("workspace.pdnLockBar")}</Vault>
      </div>

      {items.length === 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">{t("workspace.pdnNone")}</p>
          <BtnB
            disabled={generate.isPending}
            onClick={() => generate.mutate({ departureId })}
          >
            {generate.isPending
              ? t("workspace.pdnGenerating")
              : t("workspace.pdnGenerate")}
          </BtnB>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((n) => (
            <NoticeCard
              key={n.id}
              item={n}
              departureId={departureId}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function NoticeCard({
  item,
  departureId,
  onChanged,
}: {
  item: {
    id: number;
    recipientName: string;
    recipientEmail: string;
    subject: string;
    content: string;
    status: string;
    sentAt: Date | string | null;
  };
  departureId: number;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(item.content);
  const [confirmSend, setConfirmSend] = useState(false);

  const approve = trpc.preDepartureNotifications.approve.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.pdnSent"));
      setConfirmSend(false);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const edit = trpc.preDepartureNotifications.edit.useMutation({
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const skip = trpc.preDepartureNotifications.skip.useMutation({
    onSuccess: onChanged,
    onError: (e) => toast.error(e.message),
  });

  const isDraft = item.status === "draft";
  const isSent = item.status === "sent";
  const isSkipped = item.status === "skipped";

  return (
    <div
      className={`rounded-xl border p-3 text-xs ${
        isSkipped ? "border-gray-200 opacity-50" : "border-gray-300"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-medium">{item.recipientName}</span>
        {isSent && <Badge>{t("workspace.pdnSent")}</Badge>}
        {isSkipped && <Badge>{t("workspace.pdnSkipped")}</Badge>}
        {isDraft && <BadgeK>{t("workspace.pdnDraft")}</BadgeK>}
        {item.status === "approved" && (
          <Badge>{t("workspace.pdnApproved")}</Badge>
        )}
      </div>

      {item.subject && (
        <div className="text-gray-500 mb-1">{item.subject}</div>
      )}

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs resize-none"
          />
          <div className="flex gap-2">
            <BtnB
              disabled={edit.isPending}
              onClick={() => edit.mutate({ id: item.id, content: editContent })}
            >
              OK
            </BtnB>
            <BtnO onClick={() => setEditing(false)}>
              {t("workspace.cancel")}
            </BtnO>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-gray-700 mb-2">
          {item.content.slice(0, 300)}
          {item.content.length > 300 && "..."}
        </div>
      )}

      {isSent && item.sentAt && (
        <div className="text-[10px] text-gray-400">
          {t("workspace.pdnSentAt")}{" "}
          {new Date(item.sentAt).toLocaleString()}
        </div>
      )}

      {isDraft && !editing && !confirmSend && (
        <div className="flex gap-2 mt-2">
          <BtnB onClick={() => setConfirmSend(true)}>
            {t("workspace.pdnApprove")}
          </BtnB>
          <BtnO onClick={() => setEditing(true)}>
            {t("workspace.pdnEdit")}
          </BtnO>
          <BtnO
            disabled={skip.isPending}
            onClick={() => skip.mutate({ id: item.id })}
          >
            {t("workspace.pdnSkip")}
          </BtnO>
        </div>
      )}

      {confirmSend && (
        <div className="mt-2 rounded-lg border border-gray-300 p-2 space-y-2">
          <p className="font-medium">{t("workspace.pdnConfirmApprove")}</p>
          <div className="flex gap-2">
            <BtnB
              disabled={approve.isPending}
              onClick={() => approve.mutate({ id: item.id })}
            >
              {t("workspace.pdnConfirmSend")}
            </BtnB>
            <BtnO onClick={() => setConfirmSend(false)}>
              {t("workspace.cancel")}
            </BtnO>
          </div>
        </div>
      )}
    </div>
  );
}
