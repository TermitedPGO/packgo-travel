-- Down for 0116_checkout_disclosures — drop the disclosure-evidence table.
-- Idempotent(IF EXISTS)。注意:down 會丟失已落庫的「客戶付款前同意版本」
-- 存證與驗位驗價紀錄 —— 這是合規證據,down 只該用於未上線的環境回滾;
-- prod 一旦有真實結帳列,不應執行本檔。不動任何其他表。

DROP TABLE IF EXISTS `checkoutDisclosures`;
