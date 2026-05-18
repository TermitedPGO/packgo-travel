-- v331 — backfill the AI tour-map URL for the demo tour 990015
-- (Switzerland 8-day). The image was hand-generated via web during
-- architecture exploration and lives at /basemaps/tour-990015.png in
-- the public assets. Idempotent: no-op if the tour doesn't exist.

UPDATE `tours`
SET
  `aiMapUrl` = '/basemaps/tour-990015.png',
  `aiMapGeneratedAt` = CURRENT_TIMESTAMP
WHERE `id` = 990015 AND `aiMapUrl` IS NULL;
