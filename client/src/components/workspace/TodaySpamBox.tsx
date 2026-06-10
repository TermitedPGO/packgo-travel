/**
 * TodaySpamBox — 疑似垃圾匣 section of 今日待辦 (批1 m3a; extracted from
 * WorkspaceToday in the m3b file split, §9.6 300-line rule).
 *
 * design.md §2 rule 4: spam 永不靜默丟 — every spam-classified inbound stays
 * visible; 確認垃圾 mutes (dims) but never deletes; 救回 creates a REAL
 * inquiry and runs the normal inbound draft path (agent failure reported
 * honestly: the inquiry exists, the AI draft does not).
 */
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { formatRelTime } from "./relTime";
import { BtnO, GroupHeader, Src, WorkspaceCard } from "./ws-ui";

export default function TodaySpamBox() {
  const { t } = useLocale();
  const spamQ = trpc.commandCenter.spamList.useQuery({ limit: 30 });
  const utils = trpc.useUtils();

  const spamRescue = trpc.commandCenter.spamRescue.useMutation({
    onSuccess: (res) => {
      if (res.agentError) {
        // honest: the inquiry exists, the AI draft does not
        toast.error(`${t("workspace.spamRescueAgentFail")}: ${res.agentError}`);
      } else {
        toast.success(t("workspace.spamRescued"));
      }
      utils.commandCenter.spamList.invalidate();
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const spamConfirm = trpc.commandCenter.spamConfirm.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.spamConfirmed"));
      utils.commandCenter.spamList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = spamQ.data ?? [];

  return (
    <div>
      <GroupHeader
        title={t("workspace.spamBox")}
        count={rows.filter((s) => !s.verdict).length}
      />
      <Src>{t("workspace.spamNote")}</Src>
      {rows.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-2">
          {t("workspace.spamEmpty")}
        </div>
      ) : (
        <div className="space-y-2.5 mt-2">
          {rows.map((s) => (
            <WorkspaceCard
              key={s.id}
              type={t("workspace.spamBadge")}
              who={s.email ?? t("workspace.spamUnknownSender")}
              time={formatRelTime(s.createdAt, t)}
              state={s.verdict ? "done" : "none"}
            >
              <div>{s.summary ?? ""}</div>
              {s.verdict === "rescued" && (
                <div className="text-[11px] text-gray-500 mt-1">
                  {t("workspace.spamRescued")}
                </div>
              )}
              {s.verdict === "confirmed_spam" && (
                <div className="text-[11px] text-gray-500 mt-1">
                  {t("workspace.spamConfirmed")}
                </div>
              )}
              {!s.verdict && (
                <div className="flex gap-2 mt-2">
                  <BtnO
                    disabled={spamRescue.isPending || spamConfirm.isPending}
                    onClick={() => spamRescue.mutate({ interactionId: s.id })}
                  >
                    {t("workspace.spamRescue")}
                  </BtnO>
                  <BtnO
                    disabled={spamRescue.isPending || spamConfirm.isPending}
                    onClick={() => spamConfirm.mutate({ interactionId: s.id })}
                  >
                    {t("workspace.spamConfirm")}
                  </BtnO>
                </div>
              )}
            </WorkspaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
