-- 0083_supplier_product_details — Jeff 2026-05-24: "擴充我的商品 + 成立我自己的 API".
--
-- Stage 1 of supplier deep sync. Adds a 1-row-per-product detail mirror so
-- TourDetail page + InquiryAgent + (future) public API can read full
-- itinerary / hotels / meals / price terms / notices / optional add-ons
-- without round-tripping the supplier API on every customer view.
--
-- Design.md §2.1. One row per supplierProductId (1:1), `raw + parsed`
-- double-store per detail kind so format-change at supplier doesn't lose
-- data, parser bug can be re-run. `parseStatus` enum lets readers know
-- which fields are reliable. `schemaVersion` + `ownerType` are
-- forward-compat for Stage 3 public API.

CREATE TABLE supplierProductDetails (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplierProductId INT NOT NULL,
  supplierId INT NOT NULL,

  -- Itinerary (per-day plan + hotels + meals — all from same endpoint)
  itineraryRaw MEDIUMTEXT,
  itineraryParsed MEDIUMTEXT,
  itineraryFetchedAt TIMESTAMP NULL,
  itineraryParseStatus ENUM('parsed','parse_failed','missing','stale') NOT NULL DEFAULT 'missing',

  -- Price terms (included / excluded / payment / cancellation policy)
  priceTermsRaw MEDIUMTEXT,
  priceTermsParsed MEDIUMTEXT,
  priceTermsFetchedAt TIMESTAMP NULL,
  priceTermsParseStatus ENUM('parsed','parse_failed','missing','stale') NOT NULL DEFAULT 'missing',

  -- Notices (visa / insurance / baggage / general)
  noticesRaw MEDIUMTEXT,
  noticesParsed MEDIUMTEXT,
  noticesFetchedAt TIMESTAMP NULL,
  noticesParseStatus ENUM('parsed','parse_failed','missing','stale') NOT NULL DEFAULT 'missing',

  -- Optional add-ons
  optionalRaw MEDIUMTEXT,
  optionalParsed MEDIUMTEXT,
  optionalFetchedAt TIMESTAMP NULL,
  optionalParseStatus ENUM('parsed','parse_failed','missing','stale') NOT NULL DEFAULT 'missing',

  -- Tour info (Lion only — UV has no equivalent)
  tourInfoRaw MEDIUMTEXT,
  tourInfoParsed MEDIUMTEXT,
  tourInfoFetchedAt TIMESTAMP NULL,
  tourInfoParseStatus ENUM('parsed','parse_failed','missing','stale') NOT NULL DEFAULT 'missing',

  -- API-ready forward-compat
  schemaVersion INT NOT NULL DEFAULT 1,
  ownerType ENUM('supplier','packgo','partner') NOT NULL DEFAULT 'supplier',

  -- Run tracking
  lastEnrichedAt TIMESTAMP NULL,
  enrichmentRunCount INT NOT NULL DEFAULT 0,

  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uniq_product_detail (supplierProductId)
);

-- Hot path: find which products need enrichment (stale or missing)
CREATE INDEX idx_supplier_enriched ON supplierProductDetails(supplierId, lastEnrichedAt);

-- Observability: find parse failures for re-enrich button
CREATE INDEX idx_itinerary_status ON supplierProductDetails(supplierId, itineraryParseStatus);
