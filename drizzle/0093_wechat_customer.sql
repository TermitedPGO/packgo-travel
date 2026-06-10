-- 0093_wechat_customer: 批2 m5 微信歸戶(2026-06-10 Jeff 拍板:加歸戶欄 +
-- customerProfiles.wechatId 配對)。
--
-- wechatMessages.customerUserId = users.id(soft ref,nullable)。OA inbound
-- 建立時用 fromOpenId ↔ customerProfiles.wechatId 自動配對;manual_paste
-- 多半配不到,留 NULL 等人工補配。訊息從此可進該客人的 workspace 時間軸。
--
-- IDEMPOTENT (INFORMATION_SCHEMA guards, mirrors 0090). Additive + nullable,
-- no backfill, no FK. Hand-written per repo convention.

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wechatMessages'
    AND COLUMN_NAME = 'customerUserId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `wechatMessages` ADD COLUMN `customerUserId` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @i1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wechatMessages'
    AND INDEX_NAME = 'idx_wm_customer'
);
SET @sql2 = IF(@i1 = 0,
  'ALTER TABLE `wechatMessages` ADD INDEX `idx_wm_customer` (`customerUserId`, `receivedAt`)',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
