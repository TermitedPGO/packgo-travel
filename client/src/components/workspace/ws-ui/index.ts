/**
 * ws-ui — 整合工作台設計系統 primitives (B&W card grammar + state language)。
 *
 * Faithful React port of the mockup vocabulary in
 *   PackGo_示意圖/admin-cards-states.html  (one card grammar, one state language)
 *   PackGo_示意圖/admin-full-pages.html     (tcard / greeting / group header)
 *
 * 拆檔結構(CLAUDE.md §9.6 300 行紅線):
 *   chips.tsx  — Badge / BadgeK / WhoChip / Pill / Vault / StateChip / Warn / Src / Kv
 *   card.tsx   — WorkspaceCard + BtnB / BtnO / StatusToggle
 *   layout.tsx — Greeting / GroupHeader
 *
 * Everything here is presentational. No data fetching, no money actions.
 */
export * from "./chips";
export * from "./card";
export * from "./layout";
