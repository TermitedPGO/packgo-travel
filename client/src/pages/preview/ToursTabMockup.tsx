/**
 * Tours Tab Redesign — Visual Mockup
 *
 * Static preview at /preview/tours-tab-mockup. Shows the proposed new layout
 * for admin → 行程管理. NOT wired to data — purely for design sign-off.
 *
 * Design principles (vs current):
 *   1. AI 生成 is the PRIMARY action (Jeff uses it 90% of the time)
 *   2. Stats tiles surface at-a-glance: Active / Draft / Featured / Revenue
 *   3. One unified edit dialog with tabs replaces 3 overlapping dialogs
 *   4. Inline status toggle + featured star — no need to open dropdown
 *   5. Bulk action floating bar when items selected
 *   6. Cleaner row design: thumbnail + title + chips, less density
 *   7. Filter bar collapsed to one line — pills instead of selects
 */
import { useState } from "react";
import { Link } from "wouter";
import {
  Plane, Search, Sparkles, Plus, Star, Eye, EyeOff, Edit,
  MoreHorizontal, Calendar, Copy, Trash2, ArrowUpRight,
  CheckSquare, X, Filter, TrendingUp, Sparkle,
} from "lucide-react";

interface MockTour {
  id: number;
  title: string;
  image: string;
  country: string;
  city: string;
  days: number;
  price: number;
  category: "group" | "custom" | "package" | "cruise" | "theme";
  status: "active" | "inactive" | "soldout";
  featured: boolean;
  isAi: boolean;
  qaScore?: number;
}

const MOCK_TOURS: MockTour[] = [
  {
    id: 1,
    title: "加東楓葉盛宴｜五大賞楓區、四大城市、雙遊船、尼加拉瀑布景觀房10日深度之旅",
    image: "https://images.unsplash.com/photo-1539750290796-a1f4e36d33d5?w=400",
    country: "加拿大",
    city: "多倫多",
    days: 10,
    price: 89000,
    category: "group",
    status: "active",
    featured: true,
    isAi: true,
    qaScore: 96,
  },
  {
    id: 2,
    title: "鳴日x藍皮｜時光漫旅・月光海音樂會・藝術美學之旅｜花東3日",
    image: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=400",
    country: "台灣",
    city: "花東",
    days: 3,
    price: 39900,
    category: "theme",
    status: "active",
    featured: false,
    isAi: true,
    qaScore: 88,
  },
  {
    id: 3,
    title: "日本秋楓精華 7 日｜東京・京都・大阪",
    image: "https://images.unsplash.com/photo-1480796927426-f609979314bd?w=400",
    country: "日本",
    city: "東京",
    days: 7,
    price: 68000,
    category: "group",
    status: "active",
    featured: true,
    isAi: false,
  },
  {
    id: 4,
    title: "歐洲法瑞義 12 日經典之旅",
    image: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=400",
    country: "法國",
    city: "巴黎",
    days: 12,
    price: 125000,
    category: "group",
    status: "inactive",
    featured: false,
    isAi: true,
    qaScore: 72,
  },
];

const STATS = [
  { label: "上架中", value: 28, sub: "active tours", icon: Eye, accent: "text-foreground" },
  { label: "草稿", value: 4, sub: "drafts pending", icon: Edit, accent: "text-foreground/60" },
  { label: "精選", value: 6, sub: "featured", icon: Star, accent: "text-[#c9a563]" },
  { label: "本月轉換", value: "3.2%", sub: "click → booking", icon: TrendingUp, accent: "text-foreground" },
];

export default function ToursTabMockup() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "draft">("all");
  const [showFeaturedOnly, setShowFeaturedOnly] = useState(false);
  const [view, setView] = useState<"list" | "card">("list");

  const toggleSelect = (id: number) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Mock admin shell */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Banner */}
        <div className="mb-8 p-4 bg-foreground text-white rounded-xl flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/60 mb-1">Internal preview</p>
            <h1 className="text-lg font-semibold">Tours Tab Redesign Mockup</h1>
          </div>
          <Link
            href="/admin"
            className="text-xs text-white/70 hover:text-white inline-flex items-center gap-1"
          >
            開啟現有版本對比
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">行程管理</h2>
            <p className="text-sm text-gray-500 mt-1">建立、編輯、上下架你的行程組合 · 共 <span className="font-semibold text-foreground">32</span> 筆</p>
          </div>
          {/* Actions — AI 生成 is PRIMARY (gold gradient), 手動 is secondary */}
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 h-10 px-4 text-sm font-medium text-foreground border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              <Plus className="w-4 h-4" />
              手動新增
            </button>
            <button className="flex items-center gap-2 h-10 px-5 text-sm font-semibold bg-foreground text-white rounded-lg hover:bg-foreground/85 transition-colors shadow-sm relative">
              <Sparkles className="w-4 h-4 text-[#c9a563]" />
              AI 自動生成
              <span className="absolute -top-2 -right-2 bg-[#c9a563] text-foreground text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full">
                推薦
              </span>
            </button>
          </div>
        </div>

        {/* ── Stat tiles ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {STATS.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div
                key={i}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:border-foreground/30 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-3.5 h-3.5 ${stat.accent}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {stat.label}
                  </span>
                </div>
                <p className="text-2xl font-bold text-foreground tabular-nums">{stat.value}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{stat.sub}</p>
              </div>
            );
          })}
        </div>

        {/* ── Filter bar (one line) ──────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜尋標題、目的地、產品代碼..."
              className="w-full pl-9 pr-3 h-9 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-foreground/40"
            />
          </div>
          {/* Status pills */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { key: "all", label: "全部", count: 32 },
              { key: "active", label: "上架中", count: 28 },
              { key: "inactive", label: "下架", count: 4 },
              { key: "draft", label: "草稿", count: 4 },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key as any)}
                className={`px-3 h-7 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                  statusFilter === f.key
                    ? "bg-white text-foreground shadow-sm"
                    : "text-gray-600 hover:text-foreground"
                }`}
              >
                {f.label}
                <span className={`text-[10px] tabular-nums ${
                  statusFilter === f.key ? "text-foreground/60" : "text-gray-400"
                }`}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>
          {/* Featured toggle */}
          <button
            onClick={() => setShowFeaturedOnly(!showFeaturedOnly)}
            className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
              showFeaturedOnly
                ? "border-[#c9a563] bg-[#c9a563]/10 text-[#8a6f3a]"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${showFeaturedOnly ? "fill-current" : ""}`} />
            僅精選
          </button>
          {/* View toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setView("list")}
              className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
                view === "list" ? "bg-white text-foreground shadow-sm" : "text-gray-600"
              }`}
            >
              列表
            </button>
            <button
              onClick={() => setView("card")}
              className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
                view === "card" ? "bg-white text-foreground shadow-sm" : "text-gray-600"
              }`}
            >
              卡片
            </button>
          </div>
        </div>

        {/* ── Tour list (list view) ──────────────────────────────────────── */}
        {view === "list" && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="divide-y divide-gray-100">
              {MOCK_TOURS.map((tour) => {
                const isSelected = selectedIds.includes(tour.id);
                return (
                  <div
                    key={tour.id}
                    className={`flex items-center gap-4 p-4 transition-colors ${
                      isSelected ? "bg-[#c9a563]/5" : "hover:bg-gray-50"
                    }`}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleSelect(tour.id)}
                      className="flex-shrink-0 w-5 h-5 rounded border-2 border-gray-300 hover:border-foreground transition-colors flex items-center justify-center"
                      style={isSelected ? { background: "var(--foreground)", borderColor: "var(--foreground)" } : {}}
                    >
                      {isSelected && <CheckSquare className="w-3 h-3 text-white" />}
                    </button>

                    {/* Thumbnail */}
                    <img
                      src={tour.image}
                      alt={tour.title}
                      className="w-20 h-14 object-cover rounded-lg flex-shrink-0"
                    />

                    {/* Title + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {tour.isAi && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-[#8a6f3a] bg-[#c9a563]/10 px-1.5 py-0.5 rounded-md">
                            <Sparkle className="w-2.5 h-2.5" />
                            AI
                            {tour.qaScore && <span className="ml-0.5">QA {tour.qaScore}</span>}
                          </span>
                        )}
                        <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded-md ${
                          tour.status === "active"
                            ? "bg-foreground/5 text-foreground"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {tour.status === "active" ? "上架中" : "下架"}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground line-clamp-1">{tour.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">📍 {tour.country} · {tour.city}</span>
                        <span>·</span>
                        <span>{tour.days} 天</span>
                        <span>·</span>
                        <span className="font-semibold text-foreground tabular-nums">NT$ {tour.price.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Inline actions — common ones surfaced */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        title="精選"
                        className={`p-1.5 rounded-lg hover:bg-gray-100 transition-colors ${
                          tour.featured ? "text-[#c9a563]" : "text-gray-300 hover:text-gray-500"
                        }`}
                      >
                        <Star className={`w-4 h-4 ${tour.featured ? "fill-current" : ""}`} />
                      </button>
                      <button
                        title={tour.status === "active" ? "下架" : "上架"}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-foreground"
                      >
                        {tour.status === "active" ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      <div className="w-px h-5 bg-gray-200 mx-1" />
                      <button className="px-3 h-8 text-xs font-medium text-foreground border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5">
                        <Edit className="w-3.5 h-3.5" />
                        編輯
                      </button>
                      <button
                        title="更多"
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-foreground"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Tour list (card view) ──────────────────────────────────────── */}
        {view === "card" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {MOCK_TOURS.map((tour) => {
              const isSelected = selectedIds.includes(tour.id);
              return (
                <div
                  key={tour.id}
                  className={`bg-white border-2 rounded-xl overflow-hidden transition-colors ${
                    isSelected ? "border-[#c9a563]" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="relative">
                    <img
                      src={tour.image}
                      alt={tour.title}
                      className="w-full h-40 object-cover"
                    />
                    {/* Featured + Status overlays */}
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button className="p-1.5 bg-white/90 backdrop-blur rounded-lg hover:bg-white transition-colors">
                        <Star className={`w-4 h-4 ${tour.featured ? "fill-[#c9a563] text-[#c9a563]" : "text-gray-400"}`} />
                      </button>
                    </div>
                    <button
                      onClick={() => toggleSelect(tour.id)}
                      className="absolute top-2 left-2 w-5 h-5 rounded border-2 bg-white/90 backdrop-blur hover:bg-white transition-colors flex items-center justify-center"
                      style={isSelected ? { background: "var(--foreground)", borderColor: "var(--foreground)" } : { borderColor: "rgba(0,0,0,0.2)" }}
                    >
                      {isSelected && <CheckSquare className="w-3 h-3 text-white" />}
                    </button>
                    {tour.isAi && (
                      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-[#8a6f3a] bg-white/90 backdrop-blur px-2 py-1 rounded-md">
                        <Sparkle className="w-2.5 h-2.5" />
                        AI {tour.qaScore && `· QA ${tour.qaScore}`}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug mb-2 min-h-[40px]">
                      {tour.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                      <span>{tour.country} · {tour.city}</span>
                      <span>·</span>
                      <span>{tour.days} 天</span>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                      <span className="text-base font-bold text-foreground tabular-nums">
                        NT$ {tour.price.toLocaleString()}
                      </span>
                      <button className="px-3 h-8 text-xs font-medium text-foreground border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5">
                        <Edit className="w-3.5 h-3.5" />
                        編輯
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Bulk action floating bar ───────────────────────────────────── */}
        {selectedIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-sm font-semibold">
              已選 <span className="text-[#c9a563]">{selectedIds.length}</span> 筆
            </span>
            <div className="w-px h-5 bg-white/20 mx-1" />
            <button className="flex items-center gap-1.5 text-sm hover:text-[#c9a563] transition-colors">
              <Eye className="w-4 h-4" />
              批量上架
            </button>
            <button className="flex items-center gap-1.5 text-sm hover:text-[#c9a563] transition-colors">
              <EyeOff className="w-4 h-4" />
              批量下架
            </button>
            <button className="flex items-center gap-1.5 text-sm hover:text-red-400 transition-colors">
              <Trash2 className="w-4 h-4" />
              批量刪除
            </button>
            <div className="w-px h-5 bg-white/20 mx-1" />
            <button
              onClick={() => setSelectedIds([])}
              className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
              取消
            </button>
          </div>
        )}

        {/* ── Decision panel ─────────────────────────────────────────────── */}
        <div className="mt-12 bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
            這次 redesign 解決的痛點
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="font-semibold text-foreground mb-1">❌ 之前: 3 個 edit dialog</p>
              <p className="text-gray-600 text-xs">basic / preview / fullEdit 重疊,要先打開一個再切換到另一個</p>
              <p className="text-foreground text-xs mt-1">✅ 改成 1 個 dialog + tabs (基本 / 行程 / 出發 / 費用 / 飯店餐食)</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="font-semibold text-foreground mb-1">❌ 之前: action 全在 ⋯ menu 裡</p>
              <p className="text-gray-600 text-xs">改 status / 改精選 / 改日期都要 ⋯ → 點 → 點,3 click</p>
              <p className="text-foreground text-xs mt-1">✅ 精選 ★ + 上下架 👁 inline,1 click 搞定</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="font-semibold text-foreground mb-1">❌ 之前: 14 個 dialog state hook</p>
              <p className="text-gray-600 text-xs">isCreate/isEdit/isEdit2/isFullEdit/isDeparture/isAiPreview...</p>
              <p className="text-foreground text-xs mt-1">✅ 收斂成 dialog reducer + 1 個 activeTour state</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="font-semibold text-foreground mb-1">❌ 之前: 沒有總覽 stats</p>
              <p className="text-gray-600 text-xs">不知道現在多少上架、多少草稿、本月轉換率</p>
              <p className="text-foreground text-xs mt-1">✅ 4 個 stat tile 在頂端,daily 第一眼資訊</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="font-semibold text-foreground mb-1">❌ 之前: AI 生成跟手動同層級</p>
              <p className="text-gray-600 text-xs">明明 90% 用 AI,UI 沒突顯</p>
              <p className="text-foreground text-xs mt-1">✅ AI 生成黑底+金 sparkle+「推薦」badge,手動 outline secondary</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="font-semibold text-foreground mb-1">❌ 之前: filter 跟 search 一個塊佔一行</p>
              <p className="text-gray-600 text-xs">4 個 filter 元素佔太多空間,row 分散</p>
              <p className="text-foreground text-xs mt-1">✅ 一行: 搜尋 + 狀態 pill (含 count) + 精選 toggle + 列表/卡片</p>
            </div>
          </div>
        </div>

        {/* Open questions */}
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
            Jeff 要決定的事
          </h3>
          <ol className="space-y-3 text-sm text-gray-700">
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">01</span>
              <div>
                <strong className="text-foreground">列表 vs 卡片預設哪個?</strong>{" "}
                <span className="text-gray-500">desktop 我建議列表(密度高、daily 操作快),你呢</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">02</span>
              <div>
                <strong className="text-foreground">stat tile 的 4 個指標對嗎?</strong>{" "}
                <span className="text-gray-500">現在: 上架 / 草稿 / 精選 / 本月轉換 — 你日常最看哪幾個</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">03</span>
              <div>
                <strong className="text-foreground">編輯 dialog 的 tab 順序?</strong>{" "}
                <span className="text-gray-500">建議 基本 / 行程 / 出發 / 費用 / 飯店餐食</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">04</span>
              <div>
                <strong className="text-foreground">AI 生成從 modal 改 side panel(從右側滑進)?</strong>{" "}
                <span className="text-gray-500">不擋畫面、生成中可以看 list — 但工作量大</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">05</span>
              <div>
                <strong className="text-foreground">「Categories pill」(group/custom/...) 還要顯示嗎?</strong>{" "}
                <span className="text-gray-500">現在我隱藏了 — 你的 inventory 90% 是 group,顯示沒意義</span>
              </div>
            </li>
          </ol>
        </div>

        <p className="text-xs text-gray-400 mt-8 text-center">
          Round 80.10 · PACK&GO Internal · 2026-05-01
        </p>
      </div>
    </main>
  );
}
