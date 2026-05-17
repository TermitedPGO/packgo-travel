import MarketingLayout from "@/components/layouts/MarketingLayout";
import SEO from "@/components/SEO";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";

/**
 * Membership Terms & Auto-Renewal Disclosure — PACK&GO Travel LLC
 *
 * Drafted to satisfy California Auto-Renewal Law (AB 390 / SB 313),
 * Cal. Bus. & Prof. Code §§17600 – 17606, and FTC Negative Option Rule
 * (16 CFR Part 425), including:
 *
 *   §17602(a)(1)  — Clear & conspicuous disclosure of the auto-renewal terms
 *                   "in visual proximity" to the request for consent
 *   §17602(a)(2)  — Affirmative consent to the auto-renewal offer (separate
 *                   from any other ToS acceptance)
 *   §17602(a)(3)  — Acknowledgement / receipt of the cancellation policy
 *   §17602(b)     — Cancellation must be available online if signup was online,
 *                   with an "easy-to-use online method" (no phone-only escape)
 *   §17602(c)     — Free-trial reminder must be sent 3-21 days before charge
 *                   (PACK&GO sends at trial day -3 via Stripe trial_will_end
 *                   webhook → sendTrialEndingReminder email)
 *   §17602.5(b)   — Any "material change" requires a separate clear &
 *                   conspicuous notice + affirmative consent
 *
 * Counsel review is recommended before relying on this text in a contested
 * matter. Last reviewed: 2026-05-16.
 */
export default function MembershipTerms() {
  const { language } = useLocale();
  const isEN = language === "en";

  return (
    <MarketingLayout
      title={isEN ? "Membership Terms & Auto-Renewal Disclosure" : "會員條款與自動續訂揭露"}
      subtitle={
        isEN
          ? "Pack & Go, LLC · CST #2166984 · Effective 2026-05-16"
          : "Pack & Go, LLC · 加州旅行社註冊 CST #2166984 · 生效日 2026-05-16"
      }
    >
      <SEO
        title={{
          zh: "會員條款與自動續訂揭露｜PACK&GO Travel LLC",
          en: "Membership Terms & Auto-Renewal Disclosure | PACK&GO Travel LLC",
        }}
        description={{
          zh: "PACK&GO Plus 與 Concierge 會員條款,符合加州 AB 390 自動續訂法。10 天免費試用,可隨時 1-click 取消。",
          en: "PACK&GO Plus and Concierge membership terms, compliant with California AB 390 auto-renewal law. 10-day free trial, 1-click cancel anytime.",
        }}
        image="/images/hero-sakura.webp"
        url="/membership-terms"
      />

      {/* AB 390 §17602(a)(1): MUST be clear and conspicuous + in visual
          proximity to the consent request. Stripe Checkout is the consent
          surface, but the disclosure also lives here as the link
          customers click before signing up. */}
      <div className="not-prose mb-8 rounded-xl border-2 border-[#c9a563]/40 bg-[#c9a563]/[0.06] p-6">
        <h2 className="text-lg font-bold mb-3 text-foreground">
          {isEN ? "Clear & Conspicuous Disclosure (Required by CA Bus. & Prof. Code §17602)" : "明確與顯著揭露(加州 Bus. & Prof. Code §17602 要求)"}
        </h2>
        <ul className="space-y-2 text-sm leading-relaxed">
          <li>
            {isEN
              ? "When you start a Plus or Concierge free trial, PACK&GO collects your payment method UPFRONT but charges $0 during the 10-day trial."
              : "您開始 Plus 或 Concierge 免費試用時,PACK&GO 會先收集您的付款方式,但 10 天試用期內不會收取任何費用。"}
          </li>
          <li>
            <strong>
              {isEN
                ? "After 10 days, your card will be automatically charged"
                : "10 天後,您的卡將自動扣款"}
            </strong>{" "}
            {isEN
              ? "for the membership you selected — Plus $29/month or $279/year; Concierge $149/month or $1,490/year."
              : "您選擇的會員方案 — Plus $29/月 或 $279/年;Concierge $149/月 或 $1,490/年。"}
          </li>
          <li>
            {isEN
              ? "Membership automatically renews each month or year at the same rate, until you cancel."
              : "會員每月或每年依相同費率自動續訂,直到您取消為止。"}
          </li>
          <li>
            <strong>
              {isEN
                ? "You can cancel anytime online — no phone call required"
                : "您可隨時於線上取消 — 無需電話聯絡"}
            </strong>
            : <Link href="/membership" className="text-[#8a6f3a] underline font-medium">
              {isEN ? "/membership" : "/membership"}
            </Link>{" "}
            {isEN
              ? "→ Manage subscription → Cancel."
              : "→ 管理訂閱 → 取消。"}
          </li>
          <li>
            {isEN
              ? "You will receive an email reminder 3 days before the first auto-charge, with the exact amount, charge date, and one-click cancellation link."
              : "首次自動扣款前 3 天,您將收到 email 提醒,包含確切金額、扣款日期、與 1-click 取消連結。"}
          </li>
          <li>
            {isEN
              ? "Cancelling during the trial = $0 charged. Cancelling after the trial stops future renewals but does not refund the current paid period (industry standard for digital memberships)."
              : "試用期間取消 = 扣款 $0。試用後取消會停止未來自動續訂,但不退還當期已扣款項(數位會員業界慣例)。"}
          </li>
        </ul>
      </div>

      <h2>{isEN ? "1. Membership Tiers" : "1. 會員等級"}</h2>
      <p>
        {isEN
          ? "PACK&GO offers two paid membership tiers in addition to free guest access:"
          : "PACK&GO 提供兩個付費會員等級,以及免費訪客存取:"}
      </p>

      <h3>{isEN ? "Plus" : "Plus 會員"}</h3>
      <ul>
        <li>{isEN ? "$29 USD / month or $279 USD / year (save $69 annually)" : "$29 美元 / 月 或 $279 美元 / 年(年付省 $69)"}</li>
        <li>{isEN ? "AI travel companion remembers your preferences (food, accommodation, pace, interests, avoidances)" : "AI 旅遊顧問記住您的偏好(飲食、住宿、節奏、興趣、避免事項)"}</li>
        <li>{isEN ? "Personalized tour recommendations based on past travel + wishlist" : "依據過往旅程 + 願望清單的個性化行程推薦"}</li>
        <li>{isEN ? "Priority email response (within 24 hours)" : "Email 優先回覆(24 小時內)"}</li>
        <li>{isEN ? "Auto-populated dietary / accommodation preferences in every quote" : "每次報價自動套用飲食 / 住宿偏好"}</li>
        <li>{isEN ? "Personalized newsletter segmented by your interests" : "依您興趣分眾的個性化 newsletter"}</li>
        <li>{isEN ? "1 family profile saved (spouse + children preferences)" : "保存 1 個家庭檔案(配偶 + 子女偏好)"}</li>
      </ul>

      <h3>{isEN ? "Concierge" : "Concierge 會員"}</h3>
      <ul>
        <li>{isEN ? "$149 USD / month or $1,490 USD / year (save $298 annually)" : "$149 美元 / 月 或 $1,490 美元 / 年(年付省 $298)"}</li>
        <li>{isEN ? "All Plus features, plus:" : "包含所有 Plus 功能,加上:"}</li>
        <li>{isEN ? "Birthday / anniversary reminders + personal gift suggestions" : "生日 / 紀念日提醒 + 個人禮物建議"}</li>
        <li>{isEN ? "24/7 AI trip-time concierge (in-trip questions, hotel queries, schedule adjustments)" : "24/7 AI 旅程中關懷(旅程中問題、飯店查詢、行程調整)"}</li>
        <li>{isEN ? "Unlimited family profiles (children, parents, extended family preferences)" : "無限家庭檔案(子女、長輩、大家族偏好)"}</li>
        <li>{isEN ? "Discretionary refund consideration (case-by-case beyond standard cancellation policy)" : "酌情退款考量(超出標準取消政策的個案處理)"}</li>
        <li>{isEN ? "Direct WhatsApp / WeChat line with Jeff Hsieh, PACK&GO founder" : "與 PACK&GO 創辦人 Jeff Hsieh 直接 WhatsApp / WeChat 聯絡"}</li>
        <li>{isEN ? "Concierge is limited to 30 members at a time; waitlist applies when full" : "Concierge 同時限 30 位會員;額滿啟動等待名單"}</li>
      </ul>

      <h2>{isEN ? "2. Free Trial (10 Days)" : "2. 免費試用(10 天)"}</h2>
      <p>
        {isEN
          ? "New Plus and Concierge subscribers receive a 10-day free trial of the selected tier. During the trial, all features are unlocked and your card is NOT charged. The trial begins on the day you complete checkout and ends at 11:59 PM Pacific Time on the 10th calendar day."
          : "新 Plus 或 Concierge 訂閱者享有 10 天該等級的免費試用。試用期間所有功能解鎖,您的卡不會被扣款。試用從完成結帳當日開始,於第 10 個日曆日太平洋時間晚上 11:59 結束。"}
      </p>
      <p>
        {isEN
          ? "Each customer is entitled to ONE free trial per tier per lifetime. If you previously trialed Plus, you can still trial Concierge once, but you cannot trial Plus a second time on the same account."
          : "每位客戶每等級終身享一次免費試用。若您之前試用過 Plus,仍可試用 Concierge 一次,但無法在同帳戶第二次試用 Plus。"}
        {" "}
        {isEN
          ? "Attempting to create multiple accounts to bypass this limit is fraud and may result in account termination."
          : "嘗試以多帳戶繞過此限制屬於詐欺行為,可能導致帳戶終止。"}
      </p>

      <h2>{isEN ? "3. Trial → Paid Auto-Charge" : "3. 試用 → 付費自動扣款"}</h2>
      <p>
        {isEN
          ? "At the end of the 10-day trial, your card on file will be automatically charged the membership fee for the tier and billing period you selected at checkout:"
          : "10 天試用結束時,您的卡將自動扣款您結帳時選擇的等級與計費週期費用:"}
      </p>
      <ul>
        <li>{isEN ? "Plus monthly: $29.00 USD on trial day 10" : "Plus 月付:試用第 10 天扣款 $29.00 美元"}</li>
        <li>{isEN ? "Plus yearly: $279.00 USD on trial day 10" : "Plus 年付:試用第 10 天扣款 $279.00 美元"}</li>
        <li>{isEN ? "Concierge monthly: $149.00 USD on trial day 10" : "Concierge 月付:試用第 10 天扣款 $149.00 美元"}</li>
        <li>{isEN ? "Concierge yearly: $1,490.00 USD on trial day 10" : "Concierge 年付:試用第 10 天扣款 $1,490.00 美元"}</li>
      </ul>
      <p>
        {isEN
          ? "All amounts are in U.S. Dollars. PACK&GO does not charge sales tax on membership fees (intangible service)."
          : "所有金額為美元。PACK&GO 不對會員費收取銷售稅(無形服務)。"}
      </p>
      <p>
        <strong>
          {isEN
            ? "Reminder email (AB 390 §17602(c) compliance):"
            : "提醒 email(符合 AB 390 §17602(c)):"}
        </strong>{" "}
        {isEN
          ? "Three days before the auto-charge, you will receive an email to your registered address with: (a) the exact charge amount, (b) the charge date, (c) the tier and billing period, and (d) a one-click link to cancel before the charge."
          : "自動扣款前 3 天,您將收到 email 至註冊信箱,內含:(a) 確切扣款金額、(b) 扣款日期、(c) 等級與計費週期、(d) 扣款前 1-click 取消連結。"}
      </p>

      <h2>{isEN ? "4. Auto-Renewal" : "4. 自動續訂"}</h2>
      <p>
        {isEN
          ? "After the trial converts, your membership automatically renews at the same rate and billing period until you cancel. Monthly memberships renew every 30 days; yearly memberships renew every 365 days. You will receive an email receipt after each renewal charge."
          : "試用轉為付費後,您的會員依相同費率與計費週期自動續訂,直到您取消為止。月會員每 30 天續訂一次;年會員每 365 天續訂一次。每次續訂扣款後您將收到 email 收據。"}
      </p>
      <p>
        {isEN
          ? "If we change the price for your tier, you will receive at least 30 days' written notice and an opportunity to cancel before the new rate takes effect (AB 390 §17602.5(b))."
          : "若我們調整您的會員等級價格,將提前至少 30 天書面通知,並提供新費率生效前的取消機會(AB 390 §17602.5(b))。"}
      </p>

      <h2>{isEN ? "5. How to Cancel" : "5. 如何取消"}</h2>
      <p>
        {isEN
          ? "You may cancel your membership at any time through any of the following methods:"
          : "您可隨時透過以下任一方式取消會員:"}
      </p>
      <ol>
        <li>
          <strong>{isEN ? "Online (recommended, 10 seconds):" : "線上(推薦,10 秒完成):"}</strong>
          {" "}
          <Link href="/membership" className="text-[#8a6f3a] underline">
            /membership
          </Link>
          {" "}→ {isEN ? "Click \"Manage Subscription\" → Click \"Cancel Subscription\"" : "點「管理訂閱」→ 點「取消訂閱」"}
        </li>
        <li>
          <strong>{isEN ? "Email:" : "Email:"}</strong>{" "}
          <a href="mailto:jeffhsieh09@gmail.com" className="text-[#8a6f3a] underline">
            jeffhsieh09@gmail.com
          </a>{" "}
          {isEN
            ? "with subject \"Cancel Membership\" — we'll process within 24 hours."
            : ",主旨「取消會員」— 我們會於 24 小時內處理。"}
        </li>
        <li>
          <strong>{isEN ? "Phone:" : "電話:"}</strong>{" "}
          +1 (510) 634-2307 ({isEN ? "during business hours" : "營業時間內"})
        </li>
      </ol>
      <p>
        {isEN
          ? "We do NOT require you to call to cancel. The online method takes 10 seconds and matches the simplicity of signup (AB 390 §17602(b))."
          : "我們不要求您必須打電話取消。線上方式 10 秒完成,難度與註冊相同(AB 390 §17602(b))。"}
      </p>

      <h2>{isEN ? "6. Refund Policy" : "6. 退費政策"}</h2>
      <ul>
        <li>
          <strong>{isEN ? "Cancel during trial:" : "試用期間取消:"}</strong>{" "}
          {isEN ? "$0 charged. No refund needed because no money was taken." : "扣款 $0。無需退款,因為未收取任何費用。"}
        </li>
        <li>
          <strong>{isEN ? "Cancel after trial:" : "試用後取消:"}</strong>{" "}
          {isEN
            ? "Membership remains active until end of current paid period (no pro-rata refund). Auto-renewal stops at next billing date."
            : "會員資格維持至當期計費週期結束(不退還已付期間)。自動續訂於下次計費日停止。"}
        </li>
        <li>
          <strong>{isEN ? "Annual plan mid-year cancellation:" : "年付方案中途取消:"}</strong>{" "}
          {isEN
            ? "We will issue a pro-rata refund for unused full months if cancellation happens within 60 days of the most recent renewal AND no Concierge consultations have been used in the period being refunded."
            : "若於最近續訂後 60 天內取消,且該退款期間未使用任何 Concierge 諮詢,我們將按未使用完整月份比例退款。"}
        </li>
        <li>
          <strong>{isEN ? "Concierge unique entitlement:" : "Concierge 特別權益:"}</strong>{" "}
          {isEN
            ? "Free trial cancellation must be at least 1 hour before the auto-charge time to guarantee no charge."
            : "Concierge 試用取消必須在自動扣款前至少 1 小時完成,以確保不被扣款。"}
        </li>
      </ul>

      <h2>{isEN ? "7. Frozen Membership (After Cancellation)" : "7. 取消後的會員凍結"}</h2>
      <p>
        {isEN
          ? "When you cancel, your CRM profile (preferences, family details, AI-extracted facts) is preserved for 12 months in a frozen state. During this period:"
          : "您取消會員時,您的 CRM 檔案(偏好、家庭細節、AI 抽取的事實)將被凍結保存 12 個月。期間:"}
      </p>
      <ul>
        <li>{isEN ? "Your data is NOT used by AI agents to personalize responses" : "AI agents 不會使用您的資料進行個性化回應"}</li>
        <li>{isEN ? "Your data is NOT shared with newsletter or marketing campaigns" : "您的資料不會分享至 newsletter 或行銷活動"}</li>
        <li>{isEN ? "Your data continues to exist in our database for compliance + re-subscription convenience" : "您的資料持續存在於我們的資料庫,符合法規 + 方便重新訂閱"}</li>
        <li>{isEN ? "If you re-subscribe within 12 months, your full profile + AI memory is restored instantly" : "若您於 12 個月內重新訂閱,您的完整檔案 + AI 記憶將立即還原"}</li>
        <li>{isEN ? "After 12 months of frozen state, you may request permanent deletion or we may delete automatically" : "凍結 12 個月後,您可要求永久刪除,或我們可能自動刪除"}</li>
      </ul>
      <p>
        {isEN
          ? "You may also request immediate permanent deletion at any time via email — see Privacy Policy for details."
          : "您也可隨時透過 email 要求立即永久刪除 — 詳見隱私權政策。"}
      </p>

      <h2>{isEN ? "8. Contact" : "8. 聯絡方式"}</h2>
      <p>
        <strong>Pack & Go, LLC</strong>
        <br />
        37270 Cherry St, Newark, CA 94560
        <br />
        California Seller of Travel Registration # 2166984
        <br />
        Email:{" "}
        <a href="mailto:jeffhsieh09@gmail.com" className="text-[#8a6f3a] underline">
          jeffhsieh09@gmail.com
        </a>
        <br />
        {isEN ? "Phone" : "電話"}: +1 (510) 634-2307
      </p>

      <div className="not-prose mt-12 rounded-xl border border-foreground/15 bg-foreground/[0.02] p-5 text-xs text-foreground/60 leading-relaxed">
        <p>
          {isEN
            ? "This Membership Terms & Auto-Renewal Disclosure is intended to comply with California Business & Professions Code §§17600-17606 (Automatic Renewal Law / AB 390) and the FTC Negative Option Rule, 16 CFR Part 425. Pack & Go, LLC is also subject to California Seller of Travel requirements (CST #2166984). For questions about this policy, contact us at the address above. Last reviewed by counsel: pending — current draft 2026-05-16."
            : "本《會員條款與自動續訂揭露》旨在符合加州 Business & Professions Code §§17600-17606(自動續訂法 / AB 390)與 FTC Negative Option Rule, 16 CFR Part 425。Pack & Go, LLC 同時受加州旅行銷售法規(CST #2166984)規範。如對本政策有疑問,請聯絡上述地址。最近律師審查日期:待定 — 目前為 2026-05-16 草稿。"}
        </p>
      </div>
    </MarketingLayout>
  );
}
