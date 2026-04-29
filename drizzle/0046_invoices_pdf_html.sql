-- v78g: store invoice HTML inline so invoices work without R2 storage configured.
-- Mirror of 0045_ai_quotes_pdf_html.sql — same workaround for the same R2 issue.
ALTER TABLE `invoices` ADD COLUMN `pdfHtml` longtext;
