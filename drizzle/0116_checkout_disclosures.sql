-- 0116_checkout_disclosures: 付款前揭露存證 + 結帳前即時驗位驗價紀錄
-- (checkout-verify 批, 2026-07-11)。
--
-- 起因(外部顧問第二輪審計 §二,Jeff 裁決線三硬前置):現況結帳即請款,
-- 付款前不驗即時位價,且「缺少付款前揭露版本,日後難以證明客戶同意的是
-- 哪個價格、費用與取消條款」。本表在建立 Stripe Checkout Session 之前落列:
--
--   snapshot     — 客戶即將同意的版本(團名/班期/單價與人數/必付費用明細/
--                  取消退款條款文字/幣別),JSON。
--   verification — 即時驗證結果與時間戳(商品在售/餘位/價格/供應商資料
--                  新鮮度),JSON。驗證失敗也落列(status=verification_failed,
--                  無 sessionId)供漏斗量測。
--   completedAt / stripePaymentIntentId — webhook checkout.session.completed
--                  以 stripeSessionId 回填,釘死 Session 與快照的關聯。
--
-- 一列 = 一次結帳嘗試(同 booking 可多列),只新增不覆寫,稽核軌不可變。
--
-- Migration 風格:照 docs/MIGRATION_PATTERNS.md Rule 1,CREATE TABLE IF NOT
-- EXISTS,不套 PREPARE/IF(0070 事故)。單一語句,無需分句標記。

CREATE TABLE IF NOT EXISTS `checkoutDisclosures` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `bookingId` INT NOT NULL,
  `paymentType` VARCHAR(16) NOT NULL,
  `status` ENUM('verification_failed','session_created','completed') NOT NULL,
  `stripeSessionId` VARCHAR(255) NULL,
  `stripePaymentIntentId` VARCHAR(255) NULL,
  `snapshot` JSON NULL,
  `verification` JSON NULL,
  `verifiedAt` TIMESTAMP NOT NULL,
  `completedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_checkoutDisclosures_booking` (`bookingId`, `createdAt`),
  KEY `idx_checkoutDisclosures_session` (`stripeSessionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
