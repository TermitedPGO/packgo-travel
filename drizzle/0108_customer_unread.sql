-- 0108_customer_unread: customerProfiles 加 lastInboundAt/jeffViewedAt — 來訊未讀通知 (2026-07-01)。
-- 起因:Jeff「每當客人來訊息 我還沒看到明顯得notification」。客人清單列 + 左側導航
-- rail 的「客人」icon 要有真實未讀紅點:lastInboundAt = 這個 profile 最近一封 inbound
-- customerInteraction 的時間(寫入點 touchLastInbound 只往新更新,不倒退);
-- jeffViewedAt = Jeff 上次打開這位客人的時間(markCustomerSeen 設 NOW)。
-- unread = lastInboundAt 非空 且 (jeffViewedAt 空 或 lastInboundAt > jeffViewedAt)。
--
-- customerProfiles.lastInboundAt (TIMESTAMP NULL) — 最近一次客人來訊時間。NULL = 從沒來過訊。
-- customerProfiles.jeffViewedAt  (TIMESTAMP NULL) — Jeff 上次看這位客人的時間。NULL = 沒看過。
--
-- Additive、nullable、no FK。尾段 backfill:從 customerInteractions(direction=inbound)
-- 撈每個 profile 的 MAX(createdAt) 填 lastInboundAt(只填 NULL 的列,重跑 no-op)。
-- Hand-written,idempotent(INFORMATION_SCHEMA guard,mirror 0104/0105/0106/0107)。

-- 1. customerProfiles.lastInboundAt (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'lastInboundAt'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `lastInboundAt` TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customerProfiles.jeffViewedAt (idempotent — only add if missing)
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'jeffViewedAt'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `jeffViewedAt` TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- 3. Backfill lastInboundAt from existing inbound interactions (MAX(createdAt)
--    per profile). Only fills rows still NULL, so re-running is a no-op and a
--    value already advanced by touchLastInbound is never regressed.
UPDATE `customerProfiles` cp
JOIN (
  SELECT `customerProfileId`, MAX(`createdAt`) AS maxInboundAt
  FROM `customerInteractions`
  WHERE `direction` = 'inbound'
  GROUP BY `customerProfileId`
) latest ON latest.`customerProfileId` = cp.`id`
SET cp.`lastInboundAt` = latest.maxInboundAt
WHERE cp.`lastInboundAt` IS NULL;
