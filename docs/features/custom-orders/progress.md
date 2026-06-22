# 訂製單 (Custom Orders) — Stage 3 進度總覽

> 監工看這份。子模組細節在 tasks/module-*.md。設計在 design.md。
> 鐵律(CLAUDE.md §9.6):每模組有 vitest、commit 前 tsc 0 err、i18n parity、green 即 commit。
> 紅線(碰錢碰法律):supplierCost 絕不外洩、客人信無破折號、Trust 時間戳≠認列、送出 confirm gate。

## 依賴圖

```
M1 schema/db ─┐
M2 state machine ─┴─→ M3 router+seam ─┐
M1 ───────────────→ M4 email ─────────┴─→ M5 UI
M1 ───────────────────────────────────→ M6 docs
```

M1、M2 先做(可並行)。M3、M4 接著(可並行)。M5 等 M3。M6 等 M1(UI 部分等 M5)。

## 狀態

| 模組 | 檔案 | 狀態 |
|------|------|------|
| M1 schema + migration + db | schema.ts / 0099 / _journal / db/customOrder.ts | ☑ done (11 tests) |
| M2 state machine | routers/customOrderStateMachine.ts | ☑ done (35 tests) |
| M3 router + payment seam | routers/adminCustomerOrders.ts / _core/paymentProvider.ts / routers.ts | ☑ done (17+4 tests) |
| M4 email | email/templates/customOrder.ts | ☑ done (12 tests) |
| M5 UI | CustomOrderSheet/Detail/Fields + CustomerDetail + DetailTabs + i18n | ☑ done |
| M6 docs | adminCustomersDocs.ts + customerDocs wiring + types.ts + i18n | ☑ done (16 tests) |
| Verify | tsc 0 err + 110 vitest green + i18n parity + adversarial review 修完 | ☑ done |

驗證結果:tsc --noEmit = 0 errors(全專案)。vitest 新模組 110 passed + 鄰近 62 passed,無 regression。
i18n parity green。本機無 DB,訂單流前端 click-through 無法本機跑,留 prod 驗。
7 維度並行對抗式 review:0 P0;確認的 3 P1 + 6 P2 + 紅線 nit 全修(見 design.md §十)。
唯一跳過:確認信 departureDate 顯示維持 ISO(純 taste)。下一步:commit on green;部署 Jeff 跑 `pnpm ship`。

## 收尾驗證(Verify,監工獨立驗,不信自我宣稱)

- tsc --noEmit 0 err(OOM 用 NODE_OPTIONS=--max-old-space-size=6144)
- vitest 新模組全綠
- 並行 adversarial review:supplierCost 外洩 / 信破折號+口氣 / Trust≠認列 / confirm gate / i18n parity / CLAUDE.md 合規(圓角、tRPC-only、繁中)
- 修掉確認的問題 → commit on green
- 部署 Jeff 親自 `pnpm ship`(Claude 不碰 flyctl)
