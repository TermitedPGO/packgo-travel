/**
 * QuoteTaskBody — compact quote block on a workspace quote-lane card
 * (批2 m2, sales mockup p2 的卡上過目層). Shared by 今日待辦 and the
 * per-customer inbox. Shows only what the producer payload really carries:
 * price (Jeff's finalPrice, else supplier 直客價) + custom-trip manual note +
 * the price-source line (報價單必須以後台價格為準 rule, made visible).
 * Renders nothing when the payload doesn't parse — caller falls back to the
 * plain summary. Approval still goes through the shared ReviewTaskDialog.
 */
import { useLocale } from "@/contexts/LocaleContext";
import { parseQuoteCard } from "./quoteTask";
import { Src } from "./ws-ui";

export default function QuoteTaskBody({ payload }: { payload: string }) {
  const { t } = useLocale();
  const info = parseQuoteCard(payload);
  if (!info) return null;

  return (
    <div className="mt-1.5">
      {info.price !== null && (
        <div className="text-[12.5px]">
          <span className="text-gray-500">
            {t(
              info.priceKind === "final"
                ? "workspace.quotePriceFinal"
                : "workspace.quotePriceSupplier",
            )}
          </span>{" "}
          <span className="font-semibold">
            {info.currency} {info.price.toLocaleString()}
          </span>
        </div>
      )}
      {info.isCustomTrip && (
        <div className="text-[12px] text-gray-600">
          {t("workspace.quoteManual")}
        </div>
      )}
      {info.fromSupplier && <Src>{t("workspace.quoteSrcSupplier")}</Src>}
    </div>
  );
}
