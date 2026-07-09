-- Down for 0113_bank_transaction_links — drop the table.
-- Idempotent (TiDB 原生 IF EXISTS)。安全:這是全新表,down 不影響任何既有資料。

DROP TABLE IF EXISTS `bankTransactionLinks`;
