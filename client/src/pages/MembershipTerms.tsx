import MarketingLayout from "@/components/layouts/MarketingLayout";
import SEO from "@/components/SEO";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";

/**
 * 免費會員條款(暫行版)。
 *
 * 2026-07-25 Jeff 裁定:會員制為免費單層,砍掉 Plus 與 Concierge 付費層,
 * 本頁隨之從「付費會員條款與自動續訂揭露」整頁重寫。舊版被移除的原因:
 *   一,舊版引用了不存在的條號 §17602.5(b),並引用已於 2025-07-08 被
 *       第八巡迴上訴法院整份撤銷的 FTC Negative Option Rule。
 *   二,收費會員將落入 Cal. B&P Code §17550.27(Seller of Travel
 *       Discount Program):10 萬美元保證金、年費上限、續約授權時窗。
 *   三,免費制不收錢,無自動續訂,加州自動續訂法(現行 AB 2863)的
 *       揭露與取消義務整組不適用。
 *
 * 2026-07-26 R2(P1-4):初版誤用 isEN 三元硬編碼中英文,違反 CLAUDE.md
 * 的 i18n 硬紅線,改走 t('membershipTerms.*')。R3(P1-2)補齊:R2 漏了
 * SEO title/description 仍硬編碼,本版連 SEO 一併走 i18n,並由
 * Membership.test.ts 的零硬編碼守門鎖住。
 *
 * 本頁只陳述可查證的事實,不做法律宣稱。Packpoint 的倍率、上限、效期
 * 尚未定案,定案前不得在本頁或任何對客文案寫具體數字。
 * 正式條款需經律師審閱後取代本暫行版;審閱時請一併帶上
 * PACKGO_AI交流/網站專案/會員方案_研究報告_2026-07-25.md。
 */
export default function MembershipTerms() {
  const { t } = useLocale();

  return (
    <MarketingLayout
      title={t("membershipTerms.pageTitle")}
      subtitle={t("membershipTerms.pageSubtitle")}
    >
      <SEO
        title={t("membershipTerms.seoTitle")}
        description={t("membershipTerms.seoDesc")}
        image="/images/hero-sakura.webp"
        url="/membership-terms"
      />

      <h2>{t("membershipTerms.s1Title")}</h2>
      <p>{t("membershipTerms.s1Body")}</p>

      <h2>{t("membershipTerms.s2Title")}</h2>
      <p>{t("membershipTerms.s2Body")}</p>

      <h2>{t("membershipTerms.s3Title")}</h2>
      <p>{t("membershipTerms.s3Body")}</p>

      <p className="text-sm text-muted-foreground">
        {t("membershipTerms.interimPrefix")}
        <Link href="/terms-of-service">{t("membershipTerms.tosLinkText")}</Link>
        {t("membershipTerms.interimAnd")}
        <Link href="/privacy-policy">{t("membershipTerms.privacyLinkText")}</Link>
        {t("membershipTerms.interimSuffix")}
      </p>
    </MarketingLayout>
  );
}
