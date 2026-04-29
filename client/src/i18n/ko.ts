/**
 * 한국어 번역 파일 — v78q Sprint 9 #3
 *
 * STATUS: 스캐폴드 (틀잡기) — 본격 번역은 미완료.
 * 현재는 영어 버전(en.ts)을 베이스로 하고, 자주 쓰는 용어부터 한국어로 교체.
 * 완전한 번역이 필요할 경우 scripts/translate-ui-strings.mjs (미구현)에서
 * en.ts 의 leaf 문자열들을 Claude Haiku로 한국어 번역 가능.
 *
 * 작동상 en.ts 를 폴백으로 사용하므로 UI는 깨지지 않음.
 */
import { en } from "./en";

// v78q: 부분적 한국어 오버라이드 (고빈도 공통 용어만).
// 그 외는 en 으로 표시됨 (i18n loader fallback 경유).
const partialKo = {
  common: {
    ...en.common,
    search: "검색",
    bookNow: "지금 예약",
    contactUs: "문의하기",
    learnMore: "자세히 보기",
    back: "뒤로",
    backToHome: "홈으로",
    next: "다음",
    previous: "이전",
    submit: "제출",
    cancel: "취소",
    confirm: "확인",
    save: "저장",
    edit: "편집",
    loading: "로딩 중...",
    days: "일",
    nights: "박",
    person: "명",
    people: "명",
    perPerson: "1인당",
    startingFrom: "부터",
  },
  nav: {
    ...en.nav,
  },
};

export const ko = {
  ...en,
  ...partialKo,
} as typeof en;
