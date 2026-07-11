-- Down for 0115_tours_hero_image_credit — drop the attribution column.
-- Idempotent(TiDB 原生 IF EXISTS)。注意:down 會丟失已落庫的攝影師署名資料,
-- 但不動任何既有欄位或列;重跑 rebuildCatalog 可從 Unsplash 重新解析回填。

ALTER TABLE `tours` DROP COLUMN IF EXISTS `heroImageCredit`;
