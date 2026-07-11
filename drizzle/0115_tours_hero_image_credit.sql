-- 0115_tours_hero_image_credit: tours 加 heroImageCredit — 線三重建圖片層署名合規 (2026-07-10)。
--
-- 起因(docs/features/public-site/progress.md 批次 R2 / 指揮回令 P2):重建管線的對客
-- hero 改用 Unsplash 商用授權照(供應商行銷照不上客人頁),Unsplash API 條款要求
-- 公開展示時附攝影師署名。本欄持久化署名資料:
--
--   heroImageCredit — JSON 字串 {name, username, profileUrl},NULL = 非 stock 圖
--     或無署名資料(UI 遇 NULL 不渲染署名行)。
--
-- 寫入方:server/services/catalogRebuild(stockPhotoResolver 命中時隨 promote 寫入);
-- 讀取方:客人行程頁 hero 角落 "Photo by {name} on Unsplash"。
--
-- Migration 風格:照 docs/MIGRATION_PATTERNS.md Rule 1,TiDB 原生 ADD COLUMN
-- IF NOT EXISTS,不套 PREPARE/IF(0070 事故)。單一語句,無需分句標記。

ALTER TABLE `tours` ADD COLUMN IF NOT EXISTS `heroImageCredit` TEXT NULL;
