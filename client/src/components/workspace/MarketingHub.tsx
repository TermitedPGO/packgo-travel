/**
 * MarketingHub — 整合工作台行銷頁 (Batch 4 m1).
 *
 * Replaces the NewsletterTabV2 placeholder in WorkspaceCompany.
 * 3 sub-views: Campaigns / Posters / Newsletter.
 * Uses ws-ui card grammar for campaign list.
 */
import { useState, useMemo, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  Image,
  Mail,
  Megaphone,
  Trash2,
  Pencil,
  Send,
  Lock,
  Users,
  Sparkles,
} from "lucide-react";
import {
  WorkspaceCard,
  BtnB,
  BtnO,
  Kv,
  type CardState,
} from "./ws-ui";
import { formatRelTime } from "./relTime";

const PosterDistribution = lazy(() => import("./PosterDistribution"));
const PosterGenerator = lazy(() => import("./PosterGenerator"));

type MarketingView = "campaigns" | "posters" | "newsletter" | "ai_generate";

type CampaignRow = {
  id: number;
  name: string;
  type: "social_post" | "email_newsletter" | "poster";
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  createdAt: Date;
};

const TYPE_LABELS: Record<string, string> = {
  social_post: "workspace.mktTypeSocial",
  email_newsletter: "workspace.mktTypeEmail",
  poster: "workspace.mktTypePoster",
};

function campaignState(status: string): CardState {
  if (status === "draft") return "decide";
  if (status === "scheduled") return "wait";
  if (status === "sending") return "running";
  if (status === "sent") return "done";
  if (status === "cancelled") return "done";
  return "none";
}

export default function MarketingHub() {
  const { t } = useLocale();
  const [view, setView] = useState<MarketingView>("campaigns");

  const VIEWS: { id: MarketingView; label: string; icon: typeof Megaphone }[] =
    [
      { id: "campaigns", label: t("workspace.mktCampaigns"), icon: Megaphone },
      { id: "posters", label: t("workspace.mktPosters"), icon: Image },
      { id: "newsletter", label: t("workspace.mktNewsletter"), icon: Mail },
      { id: "ai_generate", label: t("workspace.mktGenTab"), icon: Sparkles },
    ];

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
              view === v.id
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <v.icon className="w-3.5 h-3.5" />
            {v.label}
          </button>
        ))}
      </div>

      {view === "campaigns" && <CampaignList />}
      {view === "posters" && (
        <Suspense fallback={<p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>}>
          <PosterDistribution />
        </Suspense>
      )}
      {view === "newsletter" && <NewsletterView />}
      {view === "ai_generate" && (
        <Suspense fallback={<p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>}>
          <PosterGenerator />
        </Suspense>
      )}
    </div>
  );
}

function CampaignList() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const campaignsQ = trpc.marketing.listCampaigns.useQuery({
    page: 1,
    pageSize: 50,
  });

  const deleteMut = trpc.marketing.deleteCampaign.useMutation({
    onSuccess: () => {
      utils.marketing.listCampaigns.invalidate();
      toast.success(t("workspace.mktDeleted"));
    },
  });

  const campaigns = (campaignsQ.data ?? []) as CampaignRow[];

  const sorted = useMemo(
    () =>
      [...campaigns].sort((a, b) => {
        const sa = campaignState(a.status);
        const sb = campaignState(b.status);
        const order: Record<CardState, number> = {
          decide: 0,
          running: 1,
          wait: 2,
          err: 3,
          done: 4,
          none: 5,
        };
        return order[sa] - order[sb];
      }),
    [campaigns],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t("workspace.mktCampaigns")}
          {campaigns.length > 0 && (
            <span className="ml-1.5 text-gray-400 font-normal">
              {campaigns.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <BtnO onClick={() => campaignsQ.refetch()}>
            <RefreshCw
              className={`w-3 h-3 inline mr-1 ${campaignsQ.isFetching ? "animate-spin" : ""}`}
            />
            {t("workspace.refresh")}
          </BtnO>
          <BtnB onClick={() => setShowCreate(true)}>
            <Plus className="w-3 h-3 inline mr-1" />
            {t("workspace.mktNewCampaign")}
          </BtnB>
        </div>
      </div>

      {campaignsQ.isLoading && (
        <p className="text-xs text-gray-400">{t("workspace.loading")}</p>
      )}

      {!campaignsQ.isLoading && sorted.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">
          {t("workspace.mktNoCampaigns")}
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((c) => (
          <CampaignCard
            key={c.id}
            campaign={c}
            onEdit={() => setEditId(c.id)}
            onDelete={() => {
              if (c.status !== "draft") {
                toast.error(t("workspace.mktDeleteDraftOnly"));
                return;
              }
              deleteMut.mutate({ campaignId: c.id });
            }}
            t={t}
          />
        ))}
      </div>

      {(showCreate || editId !== null) && (
        <CampaignDialog
          campaignId={editId}
          onClose={() => {
            setShowCreate(false);
            setEditId(null);
          }}
          t={t}
        />
      )}
    </div>
  );
}

function CampaignCard({
  campaign,
  onEdit,
  onDelete,
  t,
}: {
  campaign: CampaignRow;
  onEdit: () => void;
  onDelete: () => void;
  t: (k: string) => string;
}) {
  const state = campaignState(campaign.status);
  const typeKey = TYPE_LABELS[campaign.type] ?? "workspace.mktTypeSocial";

  return (
    <WorkspaceCard
      type={t(typeKey)}
      emphasize={campaign.status === "draft"}
      whoCompany
      state={state}
      time={campaign.createdAt ? formatRelTime(campaign.createdAt, t) : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[13px] truncate">{campaign.name}</p>
          <Kv
            k={t("workspace.mktStatus")}
            v={t(`workspace.mktSt_${campaign.status}`)}
            muted={state === "done"}
          />
        </div>
        {campaign.status === "draft" && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onEdit}
              className="p-1 rounded-md hover:bg-gray-100"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-500" />
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded-md hover:bg-gray-100"
            >
              <Trash2 className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>
        )}
      </div>
    </WorkspaceCard>
  );
}

function CampaignDialog({
  campaignId,
  onClose,
  t,
}: {
  campaignId: number | null;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const utils = trpc.useUtils();
  const isEdit = campaignId !== null;

  const existingQ = trpc.marketing.getCampaign.useQuery(
    { campaignId: campaignId! },
    { enabled: isEdit },
  );

  const [name, setName] = useState("");
  const [type, setType] = useState<"social_post" | "email_newsletter" | "poster">("social_post");

  const existing = existingQ.data;
  const prefilled = existing && isEdit;
  if (prefilled && name === "" && existing.name) {
    setName(existing.name);
    setType(existing.type as typeof type);
  }

  const createMut = trpc.marketing.createCampaign.useMutation({
    onSuccess: () => {
      utils.marketing.listCampaigns.invalidate();
      toast.success(t("workspace.mktCreated"));
      onClose();
    },
  });

  const updateMut = trpc.marketing.updateCampaign.useMutation({
    onSuccess: () => {
      utils.marketing.listCampaigns.invalidate();
      toast.success(t("workspace.mktUpdated"));
      onClose();
    },
  });

  const busy = createMut.isPending || updateMut.isPending;

  function handleSubmit() {
    if (!name.trim()) return;
    if (isEdit) {
      updateMut.mutate({ campaignId: campaignId!, name, status: "draft" });
    } else {
      createMut.mutate({ name, type });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md shadow-lg">
        <h3 className="text-sm font-semibold mb-4">
          {isEdit
            ? t("workspace.mktEditCampaign")
            : t("workspace.mktNewCampaign")}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.mktCampaignName")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              placeholder={t("workspace.mktNamePlaceholder")}
            />
          </div>

          {!isEdit && (
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">
                {t("workspace.mktType")}
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              >
                <option value="social_post">
                  {t("workspace.mktTypeSocial")}
                </option>
                <option value="email_newsletter">
                  {t("workspace.mktTypeEmail")}
                </option>
                <option value="poster">{t("workspace.mktTypePoster")}</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <BtnO onClick={onClose}>{t("workspace.mktCancel")}</BtnO>
          <BtnB onClick={handleSubmit} disabled={busy || !name.trim()}>
            {isEdit ? t("workspace.mktSave") : t("workspace.mktCreate")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}

function NewsletterView() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [sendCampaignId, setSendCampaignId] = useState<number | null>(null);

  const statsQ = trpc.marketing.subscriberStats.useQuery();
  const campaignsQ = trpc.marketing.listCampaigns.useQuery({
    page: 1,
    pageSize: 50,
  });

  const emailCampaigns = useMemo(
    () =>
      ((campaignsQ.data ?? []) as CampaignRow[]).filter(
        (c) => c.type === "email_newsletter",
      ),
    [campaignsQ.data],
  );

  const sorted = useMemo(
    () =>
      [...emailCampaigns].sort((a, b) => {
        const order: Record<string, number> = {
          draft: 0,
          scheduled: 1,
          sending: 2,
          sent: 3,
          cancelled: 4,
        };
        return (order[a.status] ?? 5) - (order[b.status] ?? 5);
      }),
    [emailCampaigns],
  );

  return (
    <div className="space-y-4">
      {/* Subscriber stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-gray-400" />
            <span className="text-[11px] text-gray-500">
              {t("workspace.mktNlActive")}
            </span>
          </div>
          <p className="text-2xl font-bold">
            {statsQ.isLoading ? "—" : (statsQ.data?.active ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-gray-400" />
            <span className="text-[11px] text-gray-500">
              {t("workspace.mktNlTotal")}
            </span>
          </div>
          <p className="text-2xl font-bold">
            {statsQ.isLoading ? "—" : (statsQ.data?.total ?? 0)}
          </p>
        </div>
      </div>

      {/* Email campaigns header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t("workspace.mktNlSendHistory")}
          {sorted.length > 0 && (
            <span className="ml-1.5 text-gray-400 font-normal">
              {sorted.length}
            </span>
          )}
        </h3>
        <BtnO onClick={() => campaignsQ.refetch()}>
          <RefreshCw
            className={`w-3 h-3 inline mr-1 ${campaignsQ.isFetching ? "animate-spin" : ""}`}
          />
          {t("workspace.refresh")}
        </BtnO>
      </div>

      {/* Email campaign cards */}
      {campaignsQ.isLoading && (
        <p className="text-xs text-gray-400">{t("workspace.loading")}</p>
      )}

      {!campaignsQ.isLoading && sorted.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">
          {t("workspace.mktNlNoLogs")}
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((c) => (
          <NewsletterCampaignCard
            key={c.id}
            campaign={c}
            canSend={c.status === "draft" || c.status === "scheduled"}
            onSend={() => setSendCampaignId(c.id)}
            t={t}
          />
        ))}
      </div>

      {sendCampaignId !== null && (
        <SendNewsletterDialog
          campaignId={sendCampaignId}
          subscriberCount={statsQ.data?.active ?? 0}
          onClose={() => setSendCampaignId(null)}
          onSent={() => {
            utils.marketing.listCampaigns.invalidate();
            setSendCampaignId(null);
          }}
          t={t}
        />
      )}
    </div>
  );
}

function NewsletterCampaignCard({
  campaign,
  canSend,
  onSend,
  t,
}: {
  campaign: CampaignRow;
  canSend: boolean;
  onSend: () => void;
  t: (k: string) => string;
}) {
  const state = campaignState(campaign.status);

  return (
    <WorkspaceCard
      type={t("workspace.mktTypeEmail")}
      emphasize={campaign.status === "draft"}
      whoCompany
      state={state}
      time={
        campaign.createdAt ? formatRelTime(campaign.createdAt, t) : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[13px] truncate">{campaign.name}</p>
          <Kv
            k={t("workspace.mktStatus")}
            v={t(`workspace.mktSt_${campaign.status}`)}
            muted={state === "done"}
          />
        </div>
        {canSend && (
          <button
            onClick={onSend}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black text-white text-[11px] font-medium flex-shrink-0"
          >
            <Send className="w-3 h-3" />
            {t("workspace.mktNlSend")}
          </button>
        )}
      </div>
    </WorkspaceCard>
  );
}

function SendNewsletterDialog({
  campaignId,
  subscriberCount,
  onClose,
  onSent,
  t,
}: {
  campaignId: number;
  subscriberCount: number;
  onClose: () => void;
  onSent: () => void;
  t: (k: string) => string;
}) {
  const [subject, setSubject] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const sendMut = trpc.marketing.sendNewsletter.useMutation({
    onSuccess: (data) => {
      toast.success(
        `${t("workspace.mktNlSentSuccess")} (${data.sent ?? subscriberCount})`,
      );
      onSent();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function handleSend() {
    if (!subject.trim() || !htmlContent.trim()) return;
    sendMut.mutate({ campaignId, subject, htmlContent });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg shadow-lg overflow-hidden">
        <div className="p-5 space-y-4">
          <h3 className="text-sm font-semibold">
            {t("workspace.mktNlSendEmail")}
          </h3>

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.mktNlSubject")}
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              placeholder={t("workspace.mktNlSubjectPlaceholder")}
            />
          </div>

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.mktNlContent")}
            </label>
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-mono"
              placeholder="<h1>Hello</h1><p>...</p>"
            />
          </div>
        </div>

        {/* 🔒 gated confirm bar */}
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 flex-shrink-0" />
            <label className="text-[12px] flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="rounded-md"
              />
              {t("workspace.mktNlConfirmMsg").replace(
                "{n}",
                String(subscriberCount),
              )}
            </label>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 text-[11px] font-medium"
            >
              {t("workspace.mktCancel")}
            </button>
            <button
              onClick={handleSend}
              disabled={
                !confirmed ||
                !subject.trim() ||
                !htmlContent.trim() ||
                sendMut.isPending
              }
              className="px-3 py-1.5 rounded-lg bg-white text-black text-[11px] font-medium disabled:opacity-40"
            >
              <Send className="w-3 h-3 inline mr-1" />
              {sendMut.isPending
                ? t("workspace.mktNlSending")
                : t("workspace.mktNlConfirmSend")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
