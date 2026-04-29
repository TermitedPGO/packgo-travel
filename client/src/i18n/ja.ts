/**
 * 日本語翻訳ファイル — v78q Sprint 9 #3
 *
 * STATUS: スキャフォールド（足場）— 本格的な翻訳は未着手。
 * 現状は英語版（en.ts）を流用し、必要なキーから日本語に置き換えていく。
 * 完全な翻訳が必要な場合は scripts/translate-ui-strings.mjs（未実装）で
 * en.ts の各リーフ文字列を Claude Haiku 経由で日本語化できる。
 *
 * 動作上は en.ts のフォールバックで埋まるので、UI が壊れることはない。
 */
import { en } from "./en";

// v78q: 部分的な日本語上書き（高頻度な共通用語のみ）。
// それ以外は en で表示される（i18n loader のフォールバック経由）。
const partialJa = {
  common: {
    ...en.common,
    search: "検索",
    bookNow: "今すぐ予約",
    contactUs: "お問い合わせ",
    learnMore: "詳細を見る",
    back: "戻る",
    backToHome: "ホームに戻る",
    next: "次へ",
    previous: "前へ",
    submit: "送信",
    cancel: "キャンセル",
    confirm: "確認",
    save: "保存",
    edit: "編集",
    loading: "読み込み中...",
    days: "日",
    nights: "泊",
    person: "名",
    people: "名",
    perPerson: "お一人様",
    startingFrom: "から",
  },
  nav: {
    ...en.nav,
  },
};

export const ja = {
  ...en,
  ...partialJa,
} as typeof en;
