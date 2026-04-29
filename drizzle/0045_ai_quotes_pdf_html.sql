-- v78f: store quote HTML inline so quotes work without R2 storage configured.
-- Resolves: R2 bucket "packgo-assets" missing → all storagePut calls returned
-- AccessDenied. Inline HTML lets quotes render via /api/aiQuotes/:id/view.
ALTER TABLE `aiQuotes` ADD COLUMN `pdfHtml` longtext;
