-- Rollback for 0079_skill_runs.sql
-- Loses all skill execution audit history when applied.
DROP TABLE IF EXISTS skillRuns;
