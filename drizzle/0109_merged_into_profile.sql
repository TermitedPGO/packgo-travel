-- 0109_merged_into_profile: customerProfiles 加 mergedIntoProfileId — 合併轉寄指標 (2026-07-02)。
-- 起因:leslie(#2460001)要併進 Emerald(#2760016),但 Gmail 收信歸檔認人是
-- 「email 找到就用,不管 status」。合併後來源卡 status=blocked(隱藏),
-- leslie 之後再來信會歸到隱藏卡上,列表看不到、未讀紅點也不亮 — 客人來信
-- 直接消失在 Jeff 視野外。修法:合併時在來源卡寫下結構化指標
-- mergedIntoProfileId = 目標卡 id,所有歸檔入口(收信/寄信/附件/詢問)認人後
-- 先跟著指標走到最終卡再落資料。
--
-- customerProfiles.mergedIntoProfileId (INT NULL, no FK) — 這張卡已整份併入
-- 哪張卡。NULL = 沒被併過。restoreCustomer(取消隱藏)會清掉它。
--
-- Additive、nullable、no FK。Hand-written,idempotent(INFORMATION_SCHEMA
-- guard,mirror 0104-0108)。

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'mergedIntoProfileId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `mergedIntoProfileId` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
