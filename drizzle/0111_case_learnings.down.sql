-- Down for 0111_case_learnings — drop the table if present.
-- Idempotent (DROP TABLE IF EXISTS, native — no PREPARE/EXECUTE needed).

DROP TABLE IF EXISTS `caseLearnings`;
