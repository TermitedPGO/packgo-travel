# Task 03:切片1.1 — Codex 12 輪兩結構 P0 修正(opus,分支上)

- [ ] ledger 先於分類:發現即入帳(每頁 INSERT IGNORE 最小欄),eligibility 降級為下游分類器;route 欄+六終態;noise 留稽核態
- [ ] receipt route:receipt classifier 先於 noise 終態;route=receipt→既有 handler(history 模式);shadow 記 would_route;legacy 唯一副作用 writer;切換防雙寫
- [ ] liveness:發現無上限;逐頁落帳後游標 CAS 推進到已落帳前綴;backlog>3×cap 收斂測試+page-2 crash+continuation 失效
- [ ] 0117 就地修訂(fromAddress NULL、route/classifiedAt/wouldRoute),down 同步,註記
- [ ] 12 輪 §五收據驗收五條全測:真格式 noreply 收據路由/一般 noreply 噪音不進收據/legacy+shadow 零雙寫/duplicate push 與 backfill 零重複/收據 handler 失敗重試出卡
- [ ] tsc 0+gmail 套件綠+全套綠(pre-push);新測試 5 次穩
