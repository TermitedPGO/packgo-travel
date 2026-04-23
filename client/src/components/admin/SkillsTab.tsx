import { useMemo, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Brain,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Sparkles,
  Tag,
  Loader2,
  Wand2,
  Database,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────
type SkillType =
  | "feature_classification"
  | "tag_rule"
  | "itinerary_structure"
  | "highlight_detection"
  | "transportation_type"
  | "meal_classification"
  | "accommodation_type";

// ── Visual-only (non-localized) skill type colors ─────────
const SKILL_TYPE_COLORS: Record<SkillType, string> = {
  feature_classification: "bg-purple-100 text-purple-800",
  tag_rule: "bg-blue-100 text-blue-800",
  itinerary_structure: "bg-green-100 text-green-800",
  highlight_detection: "bg-yellow-100 text-yellow-800",
  transportation_type: "bg-orange-100 text-orange-800",
  meal_classification: "bg-pink-100 text-pink-800",
  accommodation_type: "bg-indigo-100 text-indigo-800",
};

const SKILL_TYPE_KEYS: Record<SkillType, string> = {
  feature_classification: "categoryFeature",
  tag_rule: "categoryTagRule",
  itinerary_structure: "categoryItinerary",
  highlight_detection: "categoryHighlight",
  transportation_type: "categoryTransport",
  meal_classification: "categoryMeal",
  accommodation_type: "categoryAccommodation",
};

// ── Empty form ─────────────────────────────────────────────
const EMPTY_FORM = {
  skillName: "",
  skillType: "feature_classification" as SkillType,
  description: "",
  keywords: "",
  isActive: true,
  whenToUse: "",
};

export default function SkillsTab() {
  const { t } = useLocale();

  // Localized skill type labels (rebuilt when language changes)
  const SKILL_TYPE_LABELS = useMemo<Record<SkillType, string>>(() => ({
    feature_classification: t(`admin.skillsTab.${SKILL_TYPE_KEYS.feature_classification}`),
    tag_rule: t(`admin.skillsTab.${SKILL_TYPE_KEYS.tag_rule}`),
    itinerary_structure: t(`admin.skillsTab.${SKILL_TYPE_KEYS.itinerary_structure}`),
    highlight_detection: t(`admin.skillsTab.${SKILL_TYPE_KEYS.highlight_detection}`),
    transportation_type: t(`admin.skillsTab.${SKILL_TYPE_KEYS.transportation_type}`),
    meal_classification: t(`admin.skillsTab.${SKILL_TYPE_KEYS.meal_classification}`),
    accommodation_type: t(`admin.skillsTab.${SKILL_TYPE_KEYS.accommodation_type}`),
  }), [t]);

  // ── State ──────────────────────────────────────────────────
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedSkillId, setExpandedSkillId] = useState<number | null>(null);

  // AI learning state
  const [isLearnOpen, setIsLearnOpen] = useState(false);
  const [selectedTourId, setSelectedTourId] = useState<string>("");
  const [isLearning, setIsLearning] = useState(false);
  const [learnResults, setLearnResults] = useState<any>(null);

  // ── Queries ───────────────────────────────────────────────
  const { data: skills, isLoading, refetch } = trpc.skills.list.useQuery();
  const { data: stats } = trpc.skills.getStats.useQuery();
  const { data: tours } = trpc.tours.list.useQuery();

  // ── Mutations ─────────────────────────────────────────────
  const createSkill = trpc.skills.create.useMutation({
    onSuccess: () => {
      toast.success(t("admin.skillsTab.addSuccess"));
      setIsAddOpen(false);
      setForm(EMPTY_FORM);
      refetch();
    },
    onError: (e) => toast.error(t("admin.skillsTab.addErrorWithMsg", { msg: e.message })),
  });

  const updateSkill = trpc.skills.update.useMutation({
    onSuccess: () => {
      toast.success(t("admin.skillsTab.updateSuccess"));
      setIsEditOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      refetch();
    },
    onError: (e) => toast.error(t("admin.skillsTab.updateErrorWithMsg", { msg: e.message })),
  });

  const deleteSkill = trpc.skills.delete.useMutation({
    onSuccess: () => { toast.success(t("admin.skillsTab.deleteSuccess")); refetch(); },
    onError: (e) => toast.error(t("admin.skillsTab.deleteErrorWithMsg", { msg: e.message })),
  });

  const toggleActive = trpc.skills.update.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => toast.error(t("admin.skillsTab.updateErrorWithMsg", { msg: e.message })),
  });

  const initBuiltIn = trpc.skills.initializeBuiltIn.useMutation({
    onSuccess: () => { toast.success(t("admin.skillsTab.initSuccess")); refetch(); },
    onError: (e) => toast.error(t("admin.skillsTab.initErrorWithMsg", { msg: e.message })),
  });

  const aiLearn = trpc.skills.aiLearn.useMutation({
    onSuccess: (result) => {
      setLearnResults(result);
      setIsLearning(false);
      toast.success(t("admin.skillsTab.aiLearnCompletedMsg", { n: String(result.keywordSuggestions?.length || 0) }));
      refetch();
    },
    onError: (e) => { setIsLearning(false); toast.error(t("admin.skillsTab.learnErrorWithMsg", { msg: e.message })); },
  });

  const applyKeywords = trpc.skills.applyLearnedKeywords.useMutation({
    onSuccess: () => { toast.success(t("admin.skillsTab.keywordsApplied")); refetch(); },
    onError: (e) => toast.error(t("admin.skillsTab.applyErrorWithMsg", { msg: e.message })),
  });

  const createSuggested = trpc.skills.createSuggestedSkill.useMutation({
    onSuccess: () => { toast.success(t("admin.skillsTab.skillCreatedShort")); refetch(); },
    onError: (e) => toast.error(t("admin.skillsTab.createErrorWithMsg", { msg: e.message })),
  });

  // ── Utilities ──────────────────────────────────────────────
  const parseKeywords = (json: string | null): string[] => {
    if (!json) return [];
    try { const p = JSON.parse(json); return Array.isArray(p) ? p : []; }
    catch { return []; }
  };

  const openEdit = (skill: NonNullable<typeof skills>[number]) => {
    setEditingId(skill.id);
    setForm({
      skillName: skill.skillName,
      skillType: skill.skillType as SkillType,
      description: skill.description || "",
      keywords: parseKeywords(skill.keywords).join(", "),
      isActive: skill.isActive,
      whenToUse: skill.whenToUse || "",
    });
    setIsEditOpen(true);
  };

  const handleSave = (isEdit: boolean) => {
    const keywords = form.keywords.split(",").map(k => k.trim()).filter(Boolean);
    const payload = {
      skillName: form.skillName,
      skillType: form.skillType,
      description: form.description || undefined,
      keywords,
      rules: {},
      whenToUse: form.whenToUse || undefined,
      isActive: form.isActive,
    };
    if (isEdit && editingId) {
      updateSkill.mutate({ id: editingId, ...payload });
    } else {
      createSkill.mutate(payload);
    }
  };

  const handleLearn = () => {
    if (!selectedTourId) { toast.error(t("admin.skillsTab.selectTourFirst")); return; }
    const tour = tours?.find((tr) => tr.id === Number(selectedTourId));
    if (!tour) return;
    setIsLearning(true);
    const content = [tour.title, tour.description, tour.highlights, tour.dailyItinerary]
      .filter(Boolean).join("\n\n");
    aiLearn.mutate({
      content,
      metadata: {
        title: tour.title,
        source: t("admin.skillsTab.tourIdSource", { id: String(tour.id) }),
        country: tour.destinationCountry || undefined,
      },
    });
  };

  // ── Form component ─────────────────────────────────────────
  const SkillForm = () => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("admin.skillsTab.skillName")} <span className="text-red-500">*</span></Label>
        <Input
          className="rounded-lg"
          value={form.skillName}
          onChange={e => setForm({ ...form, skillName: e.target.value })}
          placeholder={t("admin.skillsTab.formSkillNamePlaceholder")}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t("admin.skillsTab.skillType")} <span className="text-red-500">*</span></Label>
        <Select value={form.skillType} onValueChange={v => setForm({ ...form, skillType: v as SkillType })}>
          <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(SKILL_TYPE_LABELS) as SkillType[]).map((value) => (
              <SelectItem key={value} value={value}>{SKILL_TYPE_LABELS[value]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("admin.skillsTab.description")}</Label>
        <Textarea
          className="rounded-lg"
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder={t("admin.skillsTab.formDescPlaceholder")}
          rows={2}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t("admin.skillsTab.keywordsLabel")}</Label>
        <Input
          className="rounded-lg"
          value={form.keywords}
          onChange={e => setForm({ ...form, keywords: e.target.value })}
          placeholder={t("admin.skillsTab.formKeywordsPlaceholder")}
        />
        <p className="text-xs text-muted-foreground">{t("admin.skillsTab.keywordsHintText")}</p>
      </div>
      <div className="space-y-1.5">
        <Label>{t("admin.skillsTab.whenToUse")}</Label>
        <Textarea
          className="rounded-lg"
          value={form.whenToUse}
          onChange={e => setForm({ ...form, whenToUse: e.target.value })}
          placeholder={t("admin.skillsTab.formWhenPlaceholder")}
          rows={2}
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch
          checked={form.isActive}
          onCheckedChange={v => setForm({ ...form, isActive: v })}
        />
        <Label>{t("admin.skillsTab.enableSkill")}</Label>
      </div>
    </div>
  );

  // ── Main render ────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("admin.skillsTab.title")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("admin.skillsTab.pageSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setIsLearnOpen(true)}>
            <Wand2 className="h-4 w-4 mr-1.5" />
            {t("admin.skillsTab.aiLearningTitle")}
          </Button>
          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => initBuiltIn.mutate()} disabled={initBuiltIn.isPending}>
            {initBuiltIn.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Database className="h-4 w-4 mr-1.5" />}
            {t("admin.skillsTab.loadBuiltIn")}
          </Button>
          <Button size="sm" className="rounded-lg" onClick={() => { setForm(EMPTY_FORM); setIsAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("admin.skillsTab.addSkill")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-xl p-4">
          <p className="text-2xl font-bold">{stats?.totalSkills || 0}</p>
          <p className="text-sm text-muted-foreground">{t("admin.skillsTab.statTotal")}</p>
        </div>
        <div className="border rounded-xl p-4">
          <p className="text-2xl font-bold text-green-600">{stats?.activeSkills || 0}</p>
          <p className="text-sm text-muted-foreground">{t("admin.skillsTab.statActive")}</p>
        </div>
        <div className="border rounded-xl p-4">
          <p className="text-2xl font-bold">{stats?.totalUsage || 0}</p>
          <p className="text-sm text-muted-foreground">{t("admin.skillsTab.statUsage")}</p>
        </div>
      </div>

      {/* Skill list */}
      <div className="border rounded-xl overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[2fr_1fr_2fr_80px_100px] gap-4 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
          <span>{t("admin.skillsTab.skillName")}</span>
          <span>{t("admin.skillsTab.colType")}</span>
          <span>{t("admin.skillsTab.keywordsLabel")}</span>
          <span>{t("admin.skillsTab.colUsage")}</span>
          <span>{t("admin.skillsTab.colActions")}</span>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty */}
        {!isLoading && (!skills || skills.length === 0) && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Brain className="h-12 w-12 text-gray-300 mb-4" />
            <p className="font-medium text-gray-600">{t("admin.skillsTab.emptyMessage")}</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              {t("admin.skillsTab.emptyHint")}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => initBuiltIn.mutate()} disabled={initBuiltIn.isPending}>
                <Database className="h-4 w-4 mr-1.5" />
                {t("admin.skillsTab.loadBuiltIn")}
              </Button>
              <Button size="sm" className="rounded-lg" onClick={() => { setForm(EMPTY_FORM); setIsAddOpen(true); }}>
                <Plus className="h-4 w-4 mr-1.5" />
                {t("admin.skillsTab.addSkill")}
              </Button>
            </div>
          </div>
        )}

        {/* Skills list */}
        {!isLoading && skills && skills.map((skill) => {
          const keywords = parseKeywords(skill.keywords);
          const isExpanded = expandedSkillId === skill.id;
          const typeLabel = SKILL_TYPE_LABELS[skill.skillType as SkillType] || skill.skillType;
          const typeColor = SKILL_TYPE_COLORS[skill.skillType as SkillType] || "bg-gray-100 text-gray-700";

          return (
            <div key={skill.id} className={`border-b last:border-b-0 ${!skill.isActive ? "opacity-50" : ""}`}>
              {/* Main row */}
              <div className="grid grid-cols-[2fr_1fr_2fr_80px_100px] gap-4 px-4 py-3 items-center">
                {/* Name + desc */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {skill.isActive
                      ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />
                    }
                    <span className="font-medium truncate">{skill.skillName}</span>
                  </div>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate pl-6">{skill.description}</p>
                  )}
                </div>

                {/* Type */}
                <div>
                  <Badge className={`text-xs rounded-md ${typeColor}`}>
                    {typeLabel}
                  </Badge>
                </div>

                {/* Keywords */}
                <div className="flex flex-wrap gap-1">
                  {keywords.slice(0, 4).map((kw, i) => (
                    <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md">{kw}</span>
                  ))}
                  {keywords.length > 4 && (
                    <span className="text-xs text-muted-foreground">+{keywords.length - 4}</span>
                  )}
                  {keywords.length === 0 && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>

                {/* Usage */}
                <div className="text-sm text-muted-foreground">
                  {t("admin.skillsTab.usageCountFormat", { n: String(skill.usageCount || 0) })}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <Switch
                    checked={skill.isActive}
                    onCheckedChange={(checked) => toggleActive.mutate({ id: skill.id, isActive: checked })}
                    className="scale-75"
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => openEdit(skill)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (confirm(t("admin.skillsTab.confirmDelete", { name: skill.skillName }))) {
                        deleteSkill.mutate({ id: skill.id });
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {(skill.whenToUse || skill.description) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-md text-muted-foreground"
                      onClick={() => setExpandedSkillId(isExpanded ? null : skill.id)}
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-0 bg-gray-50 border-t">
                  <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
                    {skill.whenToUse && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1 flex items-center gap-1">
                          <Info className="h-3.5 w-3.5" /> {t("admin.skillsTab.whenToUse")}
                        </p>
                        <p className="text-muted-foreground">{skill.whenToUse}</p>
                      </div>
                    )}
                    {keywords.length > 4 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1 flex items-center gap-1">
                          <Tag className="h-3.5 w-3.5" /> {t("admin.skillsTab.allKeywords")}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {keywords.map((kw, i) => (
                            <span key={i} className="text-xs bg-white border px-1.5 py-0.5 rounded-md">{kw}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add skill dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.skillsTab.addSkillTitle")}</DialogTitle>
          </DialogHeader>
          <SkillForm />
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" onClick={() => setIsAddOpen(false)}>{t("admin.skillsTab.cancel")}</Button>
            <Button className="rounded-lg" onClick={() => handleSave(false)} disabled={!form.skillName || createSkill.isPending}>
              {createSkill.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("admin.skillsTab.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit skill dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.skillsTab.editSkillTitle")}</DialogTitle>
          </DialogHeader>
          <SkillForm />
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" onClick={() => setIsEditOpen(false)}>{t("admin.skillsTab.cancel")}</Button>
            <Button className="rounded-lg" onClick={() => handleSave(true)} disabled={!form.skillName || updateSkill.isPending}>
              {updateSkill.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("admin.skillsTab.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI learn dialog */}
      <Dialog open={isLearnOpen} onOpenChange={(open) => { setIsLearnOpen(open); if (!open) { setLearnResults(null); setSelectedTourId(""); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              {t("admin.skillsTab.aiLearningTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Intro */}
            <div className="bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800 rounded-lg">
              <p className="font-medium mb-1">{t("admin.skillsTab.whatIsThis")}</p>
              <p>{t("admin.skillsTab.learnIntro")}</p>
            </div>

            {/* Tour picker */}
            <div className="space-y-1.5">
              <Label>{t("admin.skillsTab.selectTourLabel")}</Label>
              <div className="flex gap-2">
                <Select value={selectedTourId} onValueChange={setSelectedTourId}>
                  <SelectTrigger className="flex-1 rounded-lg">
                    <SelectValue placeholder={t("admin.skillsTab.selectTourPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {tours?.map(tour => (
                      <SelectItem key={tour.id} value={String(tour.id)}>
                        {tour.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button className="rounded-lg" onClick={handleLearn} disabled={isLearning || !selectedTourId}>
                  {isLearning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                  {t("admin.skillsTab.startLearning")}
                </Button>
              </div>
            </div>

            {/* Results */}
            {learnResults && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="font-medium">{t("admin.skillsTab.learnDone")}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("admin.skillsTab.learnSummary", {
                      a: String(learnResults.keywordSuggestions?.length || 0),
                      b: String(learnResults.newSkillSuggestions?.length || 0),
                    })}
                  </span>
                </div>

                {/* Keyword suggestions */}
                {learnResults.keywordSuggestions?.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-medium text-sm flex items-center gap-1">
                      <Tag className="h-4 w-4" /> {t("admin.skillsTab.keywordSuggestionsHeader")}
                    </p>
                    {learnResults.keywordSuggestions.map((s: any, i: number) => (
                      <div key={i} className="border p-3 space-y-2 rounded-lg">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{s.skillName}</p>
                            <p className="text-xs text-muted-foreground">{s.reason}</p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0 rounded-md">
                            {t("admin.skillsTab.confidenceInline", { n: String(Math.round((s.confidence || 0) * 100)) })}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {s.newKeywords?.map((kw: string, j: number) => (
                            <span key={j} className="text-xs bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-md">{kw}</span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg text-green-600 border-green-200 hover:bg-green-50"
                            onClick={() => applyKeywords.mutate({ skillId: s.skillId, newKeywords: s.newKeywords })}
                            disabled={applyKeywords.isPending}
                          >
                            {t("admin.skillsTab.applyKeywordsBtn")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg text-muted-foreground"
                            onClick={() => setLearnResults({
                              ...learnResults,
                              keywordSuggestions: learnResults.keywordSuggestions.filter((_: any, idx: number) => idx !== i),
                            })}
                          >
                            {t("admin.skillsTab.ignore")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* New skill suggestions */}
                {learnResults.newSkillSuggestions?.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-medium text-sm flex items-center gap-1">
                      <Sparkles className="h-4 w-4" /> {t("admin.skillsTab.newSkillSuggestionsTitle")}
                    </p>
                    {learnResults.newSkillSuggestions.map((s: any, i: number) => (
                      <div key={i} className="border p-3 space-y-2 rounded-lg">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{s.skillName}</p>
                            <p className="text-xs text-muted-foreground">{s.description}</p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0 rounded-md">
                            {t("admin.skillsTab.confidenceInline", { n: String(Math.round((s.confidence || 0) * 100)) })}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {s.keywords?.map((kw: string, j: number) => (
                            <span key={j} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-md">{kw}</span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg text-blue-600 border-blue-200 hover:bg-blue-50"
                            onClick={() => createSuggested.mutate({
                              skillName: s.skillName,
                              skillType: s.skillType,
                              category: "technique",
                              description: s.description,
                              keywords: s.keywords,
                              whenToUse: s.whenToUse,
                              corePattern: s.corePattern,
                            })}
                            disabled={createSuggested.isPending}
                          >
                            {t("admin.skillsTab.createSkillBtn")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg text-muted-foreground"
                            onClick={() => setLearnResults({
                              ...learnResults,
                              newSkillSuggestions: learnResults.newSkillSuggestions.filter((_: any, idx: number) => idx !== i),
                            })}
                          >
                            {t("admin.skillsTab.ignore")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* No results */}
                {!learnResults.keywordSuggestions?.length && !learnResults.newSkillSuggestions?.length && (
                  <div className="text-center py-6 text-muted-foreground">
                    <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>{t("admin.skillsTab.allCoveredTitle")}</p>
                    <p className="text-sm mt-1">{t("admin.skillsTab.allCoveredDesc")}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-lg" onClick={() => setIsLearnOpen(false)}>{t("admin.skillsTab.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
