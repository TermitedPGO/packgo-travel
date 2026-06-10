-- 0090_spam_verdict: spam 匣鐵律(design.md §2 rule 4)— spam 永不靜默丟掉真客人。
--
-- customerInteractions rows classified "spam" by the InquiryAgent stay stored
-- (gmailPipeline already writes every inbound), but Jeff had no way to record
-- his own verdict. This column is that verdict:
--   NULL             = 疑似垃圾, sits in the workspace spam 匣 awaiting Jeff
--   'rescued'        = 其實是客人 → a real inquiry was created + InquiryAgent
--                      drafted a reply (same path as a normal inbound)
--   'confirmed_spam' = Jeff confirmed junk — muted but STILL KEPT, never deleted
--
-- IDEMPOTENT (INFORMATION_SCHEMA guard, mirrors 0085-0088). Additive +
-- nullable, no backfill, no FK. Hand-written per repo convention.

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerInteractions'
    AND COLUMN_NAME = 'spamVerdict'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerInteractions` ADD COLUMN `spamVerdict` ENUM(''rescued'',''confirmed_spam'') NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
