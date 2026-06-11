/**
 * Marketing lane label maps — values are i18n KEYS (not translated strings),
 * resolved at render time via t(). Replaces the hardcoded-Chinese
 * MKT_TYPE_LABELS / MKT_PLATFORM_LABELS maps (i18n red line: no hardcoded
 * Chinese in JSX/labels). Unknown values fall back to the raw value at the
 * call site: `const key = MKT_TYPE_I18N[value]; key ? t(key) : value`.
 *
 * Pure .ts (no JSX) so node-env tests can import it directly.
 */

/** contentType → i18n key. Covers MarketingContentType (marketingProducer.ts). */
export const MKT_TYPE_I18N: Record<string, string> = {
  xhs_post: "admin.commandCenter.mktXhsPost",
  wechat_article: "admin.commandCenter.mktWechatArticle",
  edm: "admin.commandCenter.mktEdm",
  poster_copy: "admin.commandCenter.mktPosterCopy",
  social_post: "admin.commandCenter.mktSocialPost",
  other: "admin.commandCenter.mktOther",
};

/** platform → i18n key. Unknown platforms render the raw value. */
export const MKT_PLATFORM_I18N: Record<string, string> = {
  xiaohongshu: "admin.commandCenter.mktComposerPlatformXhs",
  wechat: "admin.commandCenter.mktComposerPlatformWechat",
  instagram: "admin.commandCenter.mktComposerPlatformIg",
  facebook: "admin.commandCenter.mktComposerPlatformFb",
  email: "admin.commandCenter.mktPlatformEmail",
};
