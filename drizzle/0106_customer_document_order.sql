-- 0106_customer_document_order: customerDocuments 加 customOrderId — 讓文件能掛到專案 (2026-06-30)。
-- 起因:小 claude 對等(見 memory feedback_ops_ai_parity_with_cli)。客人在專案對話框丟 PDF,
-- 要能被歸檔進「那個專案」的文件庫,而不是只讀一次就丟。ops AI 讀完 PDF → 建/改單(0105/update)
-- + 把 PDF 收進對的專案 = 完整「給一資料夾 AI 幫你歸檔」。
--
-- customerDocuments.customOrderId (INT NULL) — 這份文件掛在哪張 customOrder(專案)。
--   NULL = 未分類(客人層級文件:護照、一般上傳)。文件 tab 選專案 chip 時用它篩。
--   soft ref(no FK),mirror customerInteractions.customOrderId (0104)。
-- idx_doc_order (customOrderId, uploadedAt) — 專案內文件依時間查。
--
-- Additive、nullable、no backfill、no FK。Hand-written,idempotent
-- (INFORMATION_SCHEMA / STATISTICS guard,mirror 0104/0105)。

-- 1. customerDocuments.customOrderId (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerDocuments'
    AND COLUMN_NAME = 'customOrderId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerDocuments` ADD COLUMN `customOrderId` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customerDocuments idx_doc_order (customOrderId, uploadedAt)
SET @i1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerDocuments'
    AND INDEX_NAME = 'idx_doc_order'
);
SET @sqlI1 = IF(@i1 = 0,
  'ALTER TABLE `customerDocuments` ADD INDEX `idx_doc_order` (`customOrderId`, `uploadedAt`)',
  'SELECT 1'
);
PREPARE sI1 FROM @sqlI1;
EXECUTE sI1;
DEALLOCATE PREPARE sI1;
