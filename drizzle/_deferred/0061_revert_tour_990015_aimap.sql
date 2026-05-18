-- v333 — clear tour 990015's aiMapUrl. We're pivoting away from full-AI
-- maps (translation + accuracy issues) to a layered SVG renderer with
-- pre-rendered hillshade PNG. The aiMapUrl column stays available for
-- future use but should no longer point at the obsolete /basemaps/
-- tour-990015.png snapshot.
--
-- Idempotent: only updates the row if it currently points at that file.

UPDATE `tours`
SET
  `aiMapUrl` = NULL,
  `aiMapGeneratedAt` = NULL
WHERE `id` = 990015 AND `aiMapUrl` = '/basemaps/tour-990015.png';
