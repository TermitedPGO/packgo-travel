# 客人版手機對齊 progress(監工視角)

> 先讀 proposal.md(範圍與 25 張對照表)、design.md(批次細節)。
> 每批動工前才補 `tasks/c<N>-*.md`,跑完一批更新本表。監工不信自我宣稱,逐批獨立驗證(tsc / Vitest / 三寬截圖 / i18n guard)。

## 批次狀態

| 批 | 主題 | 張數 | 狀態 | 驗證 |
|----|------|------|------|------|
| C1 | 轉換主流程(首頁/詳情/訂團/付款/確認) | 5 | ⏳ 待動工 | 無 |
| C2 | 找團+AI(搜尋/AI找團頁/靈感/收藏) | 4 | ⏳ 待動工 | 無 |
| C3 | 訂後自助(訂單×3/客製/聯絡/緊急) | 6 | ⏳ 待動工 | 無 |
| C4 | 會員/帳戶(登入/會員中心/設定/訂閱/PackPoint/評價) | 6 | ⏳ 待動工 | 無 |
| C5 | 新功能+長尾(通知/地圖/簽證/關於) | 4 | ⏳ 待動工 | 無 |

## 與後台軌的交錯(2026-06-10 建議,一次一軌,批次邊界換軌)

```
1. ship 批2(admin,已 build 完)
2. admin-pwa P0+P1+P4(~3-4d,殼+polish 同船)
3. customer-mobile C1 → C2
4. admin 批6 → customer C3 → admin 批4 → customer C4
   → admin 批5、7 → customer C5 → admin 批3、8
5. admin-pwa P5 Capacitor(Apple 帳號 + /admin flip 後)
```

## 每批完成定義(DoD)

- [ ] tsc --noEmit 0 err
- [ ] 新邏輯有 Vitest;新頁有 i18n 字面量 guard 測試
- [ ] 360/390/430 三寬截圖無爆版、無橫向捲動、點擊區 ≥44px
- [ ] 公開頁 SEO helmet 在;`curl -A Googlebot` ld+json 不歸零(C1/C2)
- [ ] 觸到的 >300 行檔已拆(拆檔與改版分開 commit)
- [ ] ship 時 bump SW `CACHE_VERSION`
- [ ] 錢路批(C1):Stripe test mode happy path + Jeff 親驗

## 記錄

- 2026-06-10:計畫落檔(proposal/design/progress)。源起:Jeff 拿 25 張手機示意圖對照現站,拍板全對齊。事實修正兩件:收藏後端全在只缺頁、付款是 hosted Checkout。尚未動工。
- 2026-06-10:示意圖資料夾重整改名。頂層按裝置分兩資料夾:`網站/`(後台_00~13 桌面藍圖)+ `手機/`(客人_00~05,原 customer-1~5 升為現役藍圖);_archive 舊版迭代 6 檔 Jeff 拍板清理(移入垃圾桶)。proposal 補 §6 三個示意圖缺口(全站導航/詳情長內容收法/未入圖頁),C1 動工前拍板導航。
