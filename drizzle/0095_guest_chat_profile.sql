-- 0095_guest_chat_profile: guest-customer-chat (2026-06-15) — email 訪客也有
-- per-customer AI 聊天窗。
--
-- customerChatMessages 原本只有 customerUserId (NOT NULL = 註冊 users.id)。
-- 訪客只有 customerProfiles.id、沒帳號,所以:
--   1. customerUserId 放寬成 NULL (註冊客戶照舊填它)
--   2. 新增 customerProfileId INT NULL (訪客 thread 填它)
--   3. 每列剛好一個 key 有值 (app 層保證,不下 CHECK — 沿用 repo 不加 FK/約束慣例)
--   4. 新增 (customerProfileId, createdAt) index,訪客 thread 撈歷史用
--
-- IDEMPOTENT (INFORMATION_SCHEMA guards, mirrors 0090/0093)。Additive +
-- nullable,no backfill,no FK。Hand-written per repo convention。

-- 1. customerProfileId 欄位
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerChatMessages'
    AND COLUMN_NAME = 'customerProfileId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerChatMessages` ADD COLUMN `customerProfileId` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customerUserId 放寬成 nullable (僅當它目前還是 NOT NULL)
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerChatMessages'
    AND COLUMN_NAME = 'customerUserId'
    AND IS_NULLABLE = 'NO'
);
SET @sql2 = IF(@c2 = 1,
  'ALTER TABLE `customerChatMessages` MODIFY COLUMN `customerUserId` INT NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- 3. (customerProfileId, createdAt) index
SET @i1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerChatMessages'
    AND INDEX_NAME = 'idx_ccm_profile'
);
SET @sql3 = IF(@i1 = 0,
  'ALTER TABLE `customerChatMessages` ADD INDEX `idx_ccm_profile` (`customerProfileId`, `createdAt`)',
  'SELECT 1'
);
PREPARE s3 FROM @sql3;
EXECUTE s3;
DEALLOCATE PREPARE s3;
