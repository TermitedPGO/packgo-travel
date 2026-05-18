/**
 * 📄 報價單生成器 — server-side wrapper around packgo-quote skill.
 *
 * UI flow:
 *   1. Form with all fields (trip name, dates, hotels, days, pricing)
 *   2. Click 「生成 PDF」→ POSTs to trpc.tools.generateQuote
 *   3. Result shows download link + open-in-new-tab + size + key
 *
 * Density-tuned per Admin design system:
 *   - h-9 inputs, h-7 buttons
 *   - 2-col grid for compact data entry
 *   - Inline add/remove for repeating fields (hotels, days)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageHeader,
  StatusDot,
  EmptyState,
} from "../primitives";
import { Download, ExternalLink, FileText, Plus, Trash2, Loader2 } from "lucide-react";

type Hotel = { date: string; name: string; location: string };
type Day = { day: number; date: string; title: string; description: string };

const DEFAULT_INCLUDES = [
  "行程所列飯店住宿(含稅與每日早餐)",
  "專業中英文司導全程服務",
  "行程內景點門票",
  "全程司導小費、餐補及司導住宿費用",
  "中英文 24 小時緊急聯絡",
];

const DEFAULT_EXCLUDES = [
  "個人旅遊保險(強烈建議自行投保)",
  "簽證費用(美國 ESTA / 加拿大 eTA 等)",
  "未列出之自費活動 / 餐食",
  "個人消費(購物、洗衣、付費電話等)",
];

export default function QuoteToolTab() {
  const [tripName, setTripName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [passengers, setPassengers] = useState("4 大人");
  const [carService, setCarService] = useState("");
  const [hotels, setHotels] = useState<Hotel[]>([
    { date: "", name: "", location: "" },
  ]);
  const [hotelNote, setHotelNote] = useState("");
  const [days, setDays] = useState<Day[]>([
    { day: 1, date: "", title: "", description: "" },
  ]);
  const [totalUSD, setTotalUSD] = useState("");
  const [perPersonUSD, setPerPersonUSD] = useState("");
  const [twdRate, setTwdRate] = useState("32");
  const [includes, setIncludes] = useState(DEFAULT_INCLUDES.join("\n"));
  const [excludes, setExcludes] = useState(DEFAULT_EXCLUDES.join("\n"));
  const [clientName, setClientName] = useState("");
  const [validDays, setValidDays] = useState("5");

  const [result, setResult] = useState<{
    url: string;
    key: string;
    sizeKb: number;
  } | null>(null);

  const generate = trpc.tools.generateQuote.useMutation({
    onSuccess: (data) => {
      if (data.ok) {
        setResult({ url: data.url, key: data.key, sizeKb: data.sizeKb });
      }
    },
  });

  const canSubmit =
    tripName.trim() &&
    departureDate.trim() &&
    passengers.trim() &&
    days.length >= 1 &&
    days.every((d) => d.title.trim() && d.description.trim()) &&
    Number(totalUSD) > 0 &&
    Number(perPersonUSD) > 0 &&
    !generate.isPending;

  const submit = () => {
    setResult(null);
    generate.mutate({
      tripName: tripName.trim(),
      subtitle: subtitle.trim() || undefined,
      departureDate: departureDate.trim(),
      passengers: passengers.trim(),
      carService: carService.trim() || undefined,
      hotels: hotels
        .filter((h) => h.name.trim())
        .map((h) => ({
          date: h.date.trim(),
          name: h.name.trim(),
          location: h.location.trim() || undefined,
        })),
      hotelNote: hotelNote.trim() || undefined,
      days: days.map((d) => ({
        day: d.day,
        date: d.date.trim() || undefined,
        title: d.title.trim(),
        description: d.description.trim(),
      })),
      totalUSD: Number(totalUSD),
      perPersonUSD: Number(perPersonUSD),
      twdRate: Number(twdRate),
      includes: includes
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      excludes: excludes
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      clientName: clientName.trim() || undefined,
      validDays: Number(validDays),
    });
  };

  return (
    <div>
      <PageHeader
        title="報價單生成"
        caption={
          <span className="flex items-center gap-2">
            <StatusDot tone="success" />
            <span>packgo-quote skill · 伺服器端 puppeteer → A4 PDF</span>
          </span>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: form */}
        <div className="lg:col-span-2 space-y-3">
          <Section title="行程基本">
            <Row>
              <Field label="行程名稱 *" full>
                <Input
                  value={tripName}
                  onChange={(e) => setTripName(e.target.value)}
                  placeholder="例:芝加哥 + 尼加拉瀑布 5日精緻私人遊"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
            </Row>
            <Row>
              <Field label="副標題">
                <Input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="例:5天5夜 專屬包車行程"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
              <Field label="客人姓名(可選)">
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="王先生 / 王太太"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
            </Row>
            <Row>
              <Field label="出發日期 *">
                <Input
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  placeholder="2026 年 8 月 22 日 — 8 月 26 日"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
              <Field label="出行人數 *">
                <Input
                  value={passengers}
                  onChange={(e) => setPassengers(e.target.value)}
                  placeholder="4 大人 / 2 大人 1 小孩"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
            </Row>
            <Row>
              <Field label="專屬用車" full>
                <Input
                  value={carService}
                  onChange={(e) => setCarService(e.target.value)}
                  placeholder="GMC Yukon XL 7 人座 / 一車一導"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
            </Row>
          </Section>

          <Section
            title="住宿安排"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setHotels((h) => [...h, { date: "", name: "", location: "" }])
                }
                className="h-7 rounded-lg gap-1 text-xs"
              >
                <Plus className="h-3 w-3" />
                加飯店
              </Button>
            }
          >
            {hotels.map((h, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                <Input
                  value={h.date}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHotels((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, date: v } : x))
                    );
                  }}
                  placeholder="8/22 (週六)"
                  className="rounded-lg h-9 text-sm col-span-3"
                />
                <Input
                  value={h.name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHotels((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, name: v } : x))
                    );
                  }}
                  placeholder="Hilton Chicago Magnificent Mile Suites"
                  className="rounded-lg h-9 text-sm col-span-5"
                />
                <Input
                  value={h.location}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHotels((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, location: v } : x))
                    );
                  }}
                  placeholder="芝加哥市中心"
                  className="rounded-lg h-9 text-sm col-span-3"
                />
                <button
                  onClick={() =>
                    setHotels((arr) => arr.filter((_, j) => j !== i))
                  }
                  disabled={hotels.length <= 1}
                  className="col-span-1 h-9 rounded-lg text-gray-400 hover:text-rose-600 disabled:opacity-30"
                  aria-label="刪除"
                >
                  <Trash2 className="h-3.5 w-3.5 mx-auto" />
                </button>
              </div>
            ))}
            <Input
              value={hotelNote}
              onChange={(e) => setHotelNote(e.target.value)}
              placeholder="飯店補充說明(例:全程標準雙人房 2 間，均含早餐)"
              className="rounded-lg h-9 text-sm mt-1"
            />
          </Section>

          <Section
            title="每日行程"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDays((d) => [
                    ...d,
                    {
                      day: d.length + 1,
                      date: "",
                      title: "",
                      description: "",
                    },
                  ])
                }
                className="h-7 rounded-lg gap-1 text-xs"
              >
                <Plus className="h-3 w-3" />
                加 Day
              </Button>
            }
          >
            {days.map((d, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 p-2 mb-2 bg-gray-50/30"
              >
                <div className="grid grid-cols-12 gap-2 mb-2">
                  <Input
                    type="number"
                    value={d.day}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDays((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, day: v } : x))
                      );
                    }}
                    className="rounded-lg h-9 text-sm col-span-1 text-center font-bold"
                  />
                  <Input
                    value={d.date}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDays((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, date: v } : x))
                      );
                    }}
                    placeholder="8/22 (週六)"
                    className="rounded-lg h-9 text-sm col-span-2"
                  />
                  <Input
                    value={d.title}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDays((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, title: v } : x))
                      );
                    }}
                    placeholder="抵達芝加哥 · 城市初探"
                    className="rounded-lg h-9 text-sm col-span-8"
                  />
                  <button
                    onClick={() => setDays((arr) => arr.filter((_, j) => j !== i))}
                    disabled={days.length <= 1}
                    className="col-span-1 h-9 rounded-lg text-gray-400 hover:text-rose-600 disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5 mx-auto" />
                  </button>
                </div>
                <Textarea
                  value={d.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDays((arr) =>
                      arr.map((x, j) =>
                        j === i ? { ...x, description: v } : x
                      )
                    );
                  }}
                  placeholder="本日行程描述,50-200 字。例如:抵達芝加哥,專車接機後前往飯店辦理入住。如時間許可,可徒步漫遊密歇根大道..."
                  className="rounded-lg text-sm min-h-[60px]"
                />
              </div>
            ))}
          </Section>

          <Section title="報價">
            <Row>
              <Field label="整團總價 USD *">
                <Input
                  type="number"
                  value={totalUSD}
                  onChange={(e) => setTotalUSD(e.target.value)}
                  placeholder="5393"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
              <Field label="每人均價 USD *">
                <Input
                  type="number"
                  value={perPersonUSD}
                  onChange={(e) => setPerPersonUSD(e.target.value)}
                  placeholder="1348"
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
            </Row>
            <Row>
              <Field label="台幣匯率">
                <Input
                  type="number"
                  step="0.5"
                  value={twdRate}
                  onChange={(e) => setTwdRate(e.target.value)}
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
              <Field label="報價有效天數">
                <Input
                  type="number"
                  value={validDays}
                  onChange={(e) => setValidDays(e.target.value)}
                  className="rounded-lg h-9 text-sm"
                />
              </Field>
            </Row>
          </Section>

          <Section title="費用包含 / 不含(一行一條)">
            <Row>
              <Field label="✓ 費用包含">
                <Textarea
                  value={includes}
                  onChange={(e) => setIncludes(e.target.value)}
                  className="rounded-lg text-xs min-h-[140px] font-mono"
                />
              </Field>
              <Field label="✗ 費用不含">
                <Textarea
                  value={excludes}
                  onChange={(e) => setExcludes(e.target.value)}
                  className="rounded-lg text-xs min-h-[140px] font-mono"
                />
              </Field>
            </Row>
          </Section>

          <div className="sticky bottom-2 z-10 flex items-center justify-end gap-2 mt-4">
            <Button
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg gap-2 h-9 px-5 shadow-md"
            >
              {generate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中…
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  生成 PDF
                </>
              )}
            </Button>
          </div>

          {generate.error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p className="font-semibold mb-1">錯誤:</p>
              <p>{generate.error.message}</p>
            </div>
          )}
        </div>

        {/* Right: result panel */}
        <aside className="lg:col-span-1">
          <div className="sticky top-4">
            {result ? (
              <Card className="rounded-xl border-emerald-200 bg-emerald-50/30">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <StatusDot tone="success" />
                    <span className="text-sm font-bold text-gray-900">
                      PDF 已生成
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-600 break-all">
                    {result.key}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    大小:{result.sizeKb} KB
                  </div>
                  <div className="flex flex-col gap-2 pt-1">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 h-9 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      在新分頁打開
                    </a>
                    <a
                      href={result.url}
                      download
                      className="inline-flex items-center justify-center gap-2 h-9 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      下載
                    </a>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={<FileText className="h-8 w-8" />}
                title="填完左邊表單,生成 PDF 會出現在這裡"
                description="完成後可在新分頁打開或直接下載。檔案存到 R2,連結 24 小時有效。"
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl border-gray-200">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
            {title}
          </h3>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">{children}</div>;
}

function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="block text-[11px] font-semibold text-gray-600 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
