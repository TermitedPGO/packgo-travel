-- 0113_bank_transaction_links: 新表 bankTransactionLinks — F1 對帳引擎 塊A (2026-07-08)。
--
-- 起因(docs/features/finance-dept/dispatch-f1.md 塊A):每筆 bankTransactions
-- 入帳要嘛對到來源單據(customOrder/invoice/booking),要嘛對到一個內部分類
-- (Stripe 轉撥/業主轉帳/利息/小額入帳),不存在「查無」的第三態。這張表是
-- bankTransactions 與其認領結果之間的多對多連結——監工已代答的裁示 #1:
-- 一筆流水可以拆給多張單(訂金一筆、尾款一筆分兩次入帳但同一筆流水的情境),
-- 故 bankTransactionId 刻意不上 UNIQUE,只上一般 index 供查詢用。
--
-- 欄位:
--   targetType — 'custom_order'/'invoice'/'booking' 三種真實單據 + 'category'
--     (內部分類,不掛任何單據,targetId 為 NULL,改用 categoryCode)。
--   targetId — targetType 為單據類時的外鍵值(概念上的 FK,無實體約束——跟
--     bankTransactions.relatedBookingId 等既有慣例一致,不加 FK 約束)。
--   categoryCode — targetType='category' 時使用,例如 stripe_payout(Stripe
--     轉撥,非收入)/owner_transfer(業主轉帳)/interest(利息)/small_inflow
--     (低於門檻的小額入帳,見噪音閘)。
--   amountAllocated — 這筆連結分配到的金額,同一 bankTransactionId 的
--     SUM(amountAllocated) 由 code 層(server/services/bankTransactionLinkEngine.ts)
--     驗證 <= |bankTransactions.amount|,超額拒收,不在 DB 層用 CHECK 約束
--     (TiDB CHECK 約束支援度不穩,沿用既有慣例把驗證放 code 層)。
--   matchMethod — 'auto:<rule-name>'(如 auto:exact_amount)或 'manual'
--     (Jeff 手動認領),每條自動規則都可追溯是哪條規則產生的連結。
--   matchConfidence — 0-100,manual 一律 100,auto 規則各自給分。
--   claimedBy — 'jeff'(人工點的)或 'system'(規則自動產生)。
--   note — 任意備註(如 Jeff 認領時留的原因)。
--
-- 索引:(bankTransactionId) 給「這筆流水已經被連結多少錢」查詢用;
--   (targetType, targetId) 給「這張單/這個分類底下掛了哪些流水」查詢用。
--
-- Migration 風格:照 docs/MIGRATION_PATTERNS.md Rule 1,CREATE TABLE IF NOT
-- EXISTS,不用 PREPARE/EXECUTE 包裝(0070 事故)。單一 CREATE TABLE 陳述式,
-- 無需分句標記(避免在註解裡寫出 drizzle 切句用的字面 marker,0112 事故)。

CREATE TABLE IF NOT EXISTS `bankTransactionLinks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `bankTransactionId` INT NOT NULL,
  `targetType` ENUM('custom_order', 'invoice', 'booking', 'category') NOT NULL,
  `targetId` INT NULL,
  `categoryCode` VARCHAR(64) NULL,
  `amountAllocated` DECIMAL(14, 2) NOT NULL,
  `matchMethod` VARCHAR(64) NOT NULL,
  `matchConfidence` INT NULL,
  `claimedBy` VARCHAR(32) NOT NULL,
  `note` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_btl_bank_txn` (`bankTransactionId`),
  KEY `idx_btl_target` (`targetType`, `targetId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
