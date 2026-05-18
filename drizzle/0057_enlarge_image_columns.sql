-- Round 80.22: enlarge tours image URL columns to fit R2 pre-signed URLs.
-- R2/S3 pre-signed URLs include X-Amz-Signature, X-Amz-Date, X-Amz-Expires
-- and other query params, easily reaching 1500-2000 chars. Old varchar(512)
-- truncated them and caused "Data too long for column 'heroImage'" errors
-- on PDF tour generation.

ALTER TABLE `tours`
  MODIFY COLUMN `imageUrl` varchar(2048),
  MODIFY COLUMN `heroImage` varchar(2048),
  MODIFY COLUMN `hotelWebsite` varchar(2048);
