/**
 * GuestCustomerPane — 批9 m3 email 訪客的輕量 inbox。
 *
 * A guest is a customerProfiles row with an email and no account yet
 * (Jeff 拍板:訪客也進 sidebar)。Shows their inquiry history read-only;
 * replying happens through the 今日待辦 escalation / 審核 cards (m1) —
 * no separate send path here. Once they register, m2 歸戶 promotes them
 * to a full customer inbox automatically.
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Mail, UserRound, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge, Pill, Src } from "./ws-ui";
import { formatRelTime } from "./relTime";
import { cleanDisplayText } from "./cleanText";
import CustomerChat from "./CustomerChat";

const OPEN_STATUSES = new Set(["new", "in_progress"]);

export default function GuestCustomerPane({
  profileId,
}: {
  profileId: number;
}) {
  const { t } = useLocale();
  const itemsQ = trpc.admin.guestOpenItems.useQuery({ profileId });

  const data = itemsQ.data;
  const inquiries = data?.inquiries ?? [];
  // Gmail-originated history lives here (the pipeline never writes inquiries).
  const interactions = data?.interactions ?? [];
  const open = inquiries.filter(i => OPEN_STATUSES.has(i.status));
  const closed = inquiries.filter(i => !OPEN_STATUSES.has(i.status));
  const totalCount = inquiries.length + interactions.length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-2xl space-y-4">
          {/* header */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center flex-shrink-0">
              <UserRound className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold break-all">
                  {data?.email ?? "…"}
                </span>
                <Badge>{t("workspace.guestBadge")}</Badge>
              </div>
              <div className="text-[11px] text-gray-500">
                {t("workspace.guestSub", { n: totalCount })}
                {data?.firstSeenAt
                  ? ` · ${t("workspace.guestFirstSeen")} ${formatRelTime(data.firstSeenAt, t)}`
                  : ""}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-500">
            {t("workspace.guestHint")}
          </div>

          {itemsQ.isLoading && (
            <p className="text-xs text-gray-400 py-4">
              {t("workspace.loading")}
            </p>
          )}

          {!itemsQ.isLoading && totalCount === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
              {t("workspace.guestNoItems")}
            </div>
          )}

          {interactions.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[12px] font-semibold">
                {t("workspace.guestEmailHistory", { n: interactions.length })}
              </h3>
              {interactions.map(it => (
                <InteractionRow key={it.id} interaction={it} />
              ))}
            </section>
          )}

          {open.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[12px] font-semibold">
                {t("workspace.guestOpenInquiries", { n: open.length })}
              </h3>
              {open.map(i => (
                <InquiryRow key={i.id} inquiry={i} open />
              ))}
            </section>
          )}

          {closed.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[12px] font-semibold text-gray-500">
                {t("workspace.guestPastInquiries", { n: closed.length })}
              </h3>
              {closed.map(i => (
                <InquiryRow key={i.id} inquiry={i} />
              ))}
            </section>
          )}
        </div>
      </div>

      {/* guest-customer-chat (2026-06-15) — per-guest AI workspace, scoped to
          profileId. Internal Jeff↔Agent (NOT a send-to-guest channel; replies
          still go through the 今日待辦 escalation cards). */}
      <CustomerChat
        customerProfileId={profileId}
        customerName={data?.email ?? ""}
        label={t("workspace.guestChatLabel")}
      />
    </div>
  );
}

function InteractionRow({
  interaction,
}: {
  interaction: {
    id: number;
    direction: string;
    channel: string;
    content: string;
    contentSummary: string | null;
    classification: string | null;
    createdAt: Date | string;
  };
}) {
  const { t } = useLocale();
  const inbound = interaction.direction === "inbound";
  return (
    <div className="bg-white rounded-xl border border-gray-200 border-l-2 border-l-black p-3">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        {inbound ? (
          <ArrowDownLeft className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ArrowUpRight className="w-3.5 h-3.5 text-gray-400" />
        )}
        <span className="text-[11px] font-medium">
          {inbound ? t("workspace.guestInbound") : t("workspace.guestOutbound")}
        </span>
        {interaction.classification && (
          <Pill>{interaction.classification}</Pill>
        )}
        <span className="text-[10px] text-gray-400">
          {formatRelTime(interaction.createdAt, t)}
        </span>
      </div>
      {interaction.contentSummary && (
        <p className="text-[12px] text-gray-700 font-medium break-words">
          {interaction.contentSummary}
        </p>
      )}
      <p className="text-[12px] text-gray-500 line-clamp-4 whitespace-pre-wrap break-words mt-0.5">
        {cleanDisplayText(interaction.content)}
      </p>
    </div>
  );
}

function InquiryRow({
  inquiry,
  open,
}: {
  inquiry: {
    id: number;
    inquiryType: string;
    subject: string;
    message: string;
    status: string;
    createdAt: Date | string;
  };
  open?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-3 ${
        open ? "border-l-2 border-l-black" : "opacity-60"
      }`}
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Mail className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[12.5px] font-medium break-words">
          {inquiry.subject}
        </span>
        <Pill>{t(`workspace.guestSt_${inquiry.status}`)}</Pill>
        <span className="text-[10px] text-gray-400">
          {formatRelTime(inquiry.createdAt, t)}
        </span>
      </div>
      <p className="text-[12px] text-gray-600 line-clamp-3 whitespace-pre-wrap break-words">
        {inquiry.message}
      </p>
      <Src>{t("workspace.guestReplyWhere")}</Src>
    </div>
  );
}
