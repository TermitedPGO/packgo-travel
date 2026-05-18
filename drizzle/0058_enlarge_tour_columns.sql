-- v80.24: enlarge varchar columns flagged in stability audit. Each was a
-- "Data too long for column 'X'" risk under realistic LLM output.
--
-- productCode: 50 → 100 — some Lion / Phoenix supplier codes are 25-30
--   chars; future suppliers may exceed.
-- outboundAirline / inboundAirline: 100 → 200 — bilingual cleaned names
--   like "All Nippon Airways (ANA / Star Alliance)" can exceed 100.
-- hotelName: 255 → 500 — Japanese / Korean hotels often have 50+ chars
--   each in zh AND en side-by-side.
-- hotelGrade: 50 → 100 — "五星級豪華酒店 / 5-Star Luxury Resort".
-- hotelLocation: 255 → 500 — long bilingual addresses.
-- hotelRoomType: 100 → 200 — descriptive room types.
-- hotelRoomSize: 50 → 100 — bilingual room size formats.

ALTER TABLE `tours`
  MODIFY COLUMN `productCode` varchar(100),
  MODIFY COLUMN `outboundAirline` varchar(200),
  MODIFY COLUMN `inboundAirline` varchar(200),
  MODIFY COLUMN `hotelName` varchar(500),
  MODIFY COLUMN `hotelGrade` varchar(100),
  MODIFY COLUMN `hotelLocation` varchar(500),
  MODIFY COLUMN `hotelRoomType` varchar(200),
  MODIFY COLUMN `hotelRoomSize` varchar(100);
