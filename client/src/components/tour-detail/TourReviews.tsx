/**
 * TourReviews — v80.24 conversion-critical section.
 * Shows verified customer reviews above the pricing block. Premium travel
 * sites (Lion / Six Senses / Black Tomato) all surface this near top of
 * funnel; without it, PACK&GO converts 10-15% lower than peers.
 *
 * Pulls from `trpc.reviews.listVerified` with status='approved'. Falls back
 * to a graceful "be the first to share" prompt when the tour has no reviews
 * yet (don't hide the section — the prompt itself is a soft CTA for past
 * customers).
 */

import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { Star, MessageSquare, Quote, Pencil } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";

interface Props {
  tourId: number;
  themeColor: { primary: string; secondary?: string };
}

export default function TourReviews({ tourId, themeColor }: Props) {
  const { language, t } = useLocale();
  const isEN = language === "en";
  const { user, isAuthenticated } = useAuth();

  const utils = trpc.useUtils();
  const { data: reviews, isLoading } = trpc.reviews.listVerified.useQuery(
    { tourId, limit: 6 },
    { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false }
  );

  // Round 80.25 — open commenting via reviews.createPublic.
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const createMutation = trpc.reviews.createPublic.useMutation({
    onSuccess: () => {
      toast.success(
        isEN
          ? "Thanks! Your review is awaiting moderation."
          : "感謝你！評論已送出，待審核後刊登。"
      );
      setOpen(false);
      setRating(5);
      setTitle("");
      setContent("");
      utils.reviews.listVerified.invalidate({ tourId });
      utils.reviews.myReviews.invalidate();
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });
  const onSubmit = () => {
    if (title.trim().length < 3) {
      toast.error(isEN ? "Title too short (3+ chars)" : "標題太短（至少 3 字）");
      return;
    }
    if (content.trim().length < 10) {
      toast.error(isEN ? "Content too short (10+ chars)" : "內容太短（至少 10 字）");
      return;
    }
    createMutation.mutate({
      tourId,
      rating,
      title: title.trim(),
      content: content.trim(),
      language: isEN ? "en" : "zh-TW",
    });
  };
  const handleOpenChange = (next: boolean) => {
    if (next && !isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    setOpen(next);
  };

  // Graceful loading skeleton — avoids jumping layout
  if (isLoading) {
    return (
      <section className="py-12 lg:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <div className="h-8 w-48 bg-foreground/[0.04] rounded-lg animate-pulse mb-6" />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-44 bg-foreground/[0.04] rounded-xl animate-pulse"
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const list = reviews ?? [];
  const avgRating =
    list.length > 0
      ? list.reduce((acc, r: any) => acc + Number(r.rating || 0), 0) /
        list.length
      : 0;

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <h2
              className="text-2xl md:text-3xl font-serif font-bold mb-2"
              style={{ color: themeColor.primary }}
            >
              {isEN ? "What Our Travelers Say" : "客人怎麼說"}
            </h2>
            {list.length > 0 ? (
              <div className="flex items-center gap-3 text-sm text-foreground/70">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < Math.round(avgRating)
                          ? "fill-[#c9a563] text-[#c9a563]"
                          : "text-foreground/15"
                      }`}
                    />
                  ))}
                </div>
                <span className="font-semibold tabular-nums text-foreground">
                  {avgRating.toFixed(1)}
                </span>
                <span className="text-foreground/55">
                  {isEN
                    ? `Based on ${list.length} verified ${list.length === 1 ? "review" : "reviews"}`
                    : `${list.length} 則經驗證評價`}
                </span>
              </div>
            ) : (
              <p className="text-sm text-foreground/55">
                {isEN
                  ? "Be one of the first to share your journey."
                  : "成為第一位分享旅行回憶的旅人。"}
              </p>
            )}
          </div>
          {/* Round 80.25 — open commenting CTA. Always visible, opens dialog
              for any logged-in user (login redirect if anon). */}
          <Button
            variant="outline"
            onClick={() => handleOpenChange(true)}
            className="rounded-lg gap-2"
          >
            <Pencil className="h-4 w-4" />
            {isEN ? "Write a Review" : "寫評論"}
          </Button>
        </div>

        {list.length === 0 ? (
          <div className="bg-[#FAF8F2] border border-foreground/8 rounded-xl p-8 text-center">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 text-[#c9a563]" />
            <p className="text-foreground font-medium mb-1">
              {isEN
                ? "No reviews yet for this tour."
                : "此行程尚無公開評價。"}
            </p>
            <p className="text-sm text-foreground/60 max-w-md mx-auto mb-4">
              {isEN
                ? "Be the first to share your experience with PACK&GO."
                : "成為第一位分享 PACK&GO 旅行體驗的旅人。"}
            </p>
            <Button
              onClick={() => handleOpenChange(true)}
              className="rounded-lg"
              style={{ backgroundColor: themeColor.primary }}
            >
              {isEN ? "Write the First Review" : "撰寫第一則評論"}
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((r: any) => (
              <article
                key={r.id}
                className="bg-white border border-foreground/10 rounded-xl p-5 hover:shadow-md transition-shadow flex flex-col"
              >
                <Quote
                  className="h-5 w-5 text-[#c9a563]/60 mb-2"
                  aria-hidden="true"
                />
                <div className="flex items-center gap-0.5 mb-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3.5 w-3.5 ${
                        i < r.rating
                          ? "fill-[#c9a563] text-[#c9a563]"
                          : "text-foreground/15"
                      }`}
                    />
                  ))}
                </div>
                {r.title && (
                  <h3 className="font-serif font-bold text-base mb-1.5 text-foreground">
                    {r.title}
                  </h3>
                )}
                <p className="text-sm text-foreground/75 line-clamp-4 leading-relaxed flex-1">
                  {r.content}
                </p>
                <div className="mt-4 pt-3 border-t border-foreground/8 flex items-center gap-2.5">
                  <Avatar className="h-8 w-8">
                    {r.authorAvatar && (
                      <AvatarImage src={r.authorAvatar} alt={r.authorName || "Customer"} />
                    )}
                    <AvatarFallback className="text-[10px] bg-[#FAF8F2] text-foreground/55">
                      {(r.authorName || "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {r.authorName || (isEN ? "PACK&GO Traveler" : "PACK&GO 旅人")}
                    </p>
                    {r.publishedAt && (
                      <p className="text-[10px] text-foreground/45">
                        {new Date(r.publishedAt).toLocaleDateString(
                          isEN ? "en-US" : "zh-TW",
                          { year: "numeric", month: "short" }
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Round 80.25 — Open Commenting Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-xl max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isEN ? "Write a Review" : "撰寫評論"}
            </DialogTitle>
          </DialogHeader>
          {/* Round 80.25 — thank-you note under the title. Welcomes both
              criticism and praise so customers feel safe being honest. */}
          <p className="text-sm text-foreground/65 leading-relaxed bg-[#FAF8F2] border-l-2 border-[#c9a563] px-4 py-3 rounded-lg -mt-1">
            {isEN
              ? "Whether it's praise or critique, every review helps us improve. Thank you for taking the time to share your honest experience."
              : "無論是稱讚還是批評，每一則評論都讓我們做得更好。感謝你願意花時間誠實分享。"}
          </p>
          <div className="space-y-4 pt-2">
            <div>
              <p className="text-xs text-foreground/70 mb-2">
                {isEN ? "Your Rating" : "您的評分"}
              </p>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRating(s)}
                    className="p-1 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`h-7 w-7 ${
                        s <= rating
                          ? "fill-[#c9a563] text-[#c9a563]"
                          : "text-foreground/15"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                isEN
                  ? "Title (e.g. Unforgettable Hokkaido trip)"
                  : "標題(例:北海道之旅讓我念念不忘)"
              }
              maxLength={200}
              className="rounded-lg"
            />
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                isEN
                  ? "Share your experience — itinerary, guide, hotels, meals, transport… (min 10 chars)"
                  : "分享您的體驗 — 行程、領隊、飯店、餐食、交通…(至少 10 字)"
              }
              rows={5}
              maxLength={5000}
              className="rounded-lg"
            />
            <p className="text-[10px] text-foreground/50 text-right">
              {content.length} / 5000
            </p>
            <p className="text-xs text-foreground/55 bg-foreground/[0.04] rounded-lg p-3">
              {isEN
                ? "Reviews enter moderation; published once approved by our team."
                : "評論將進入審核，通過後刊登。"}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="rounded-lg"
            >
              {isEN ? "Cancel" : "取消"}
            </Button>
            <Button
              onClick={onSubmit}
              disabled={createMutation.isPending}
              className="rounded-lg"
              style={{ backgroundColor: themeColor.primary }}
            >
              {createMutation.isPending
                ? isEN
                  ? "Submitting…"
                  : "送出中…"
                : isEN
                  ? "Submit Review"
                  : "送出評論"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
