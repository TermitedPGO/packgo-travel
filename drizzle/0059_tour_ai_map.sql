-- v331 — AI tour-map columns. When `aiMapUrl` is non-NULL, the tour
-- detail page renders this image instead of the SVG canvas. The image
-- is generated via gpt-image-2 from the tour itinerary and uploaded
-- to R2 by `server/services/tourMapGenerator.ts`.
--
-- aiMapUrl         — public R2 URL of the painted PNG.
-- aiMapPrompt      — the exact prompt used (kept for re-runs / audit).
-- aiMapGeneratedAt — when the current image was rendered (so admin UI
--                    can show "regenerated 2 hours ago").

ALTER TABLE `tours`
  ADD COLUMN `aiMapUrl` varchar(2048) DEFAULT NULL,
  ADD COLUMN `aiMapPrompt` text DEFAULT NULL,
  ADD COLUMN `aiMapGeneratedAt` timestamp NULL DEFAULT NULL;
