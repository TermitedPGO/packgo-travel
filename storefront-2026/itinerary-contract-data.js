(function attachPackGoItineraryContractMeta(root) {
  const meal = (breakfast, lunch, dinner) => ({ breakfast, lunch, dinner });
  const stay = (ratingValue, propertyStatus = "proposed_or_equivalent", ratingSourceStatus = "itinerary_standard_unverified") => ({
    propertyStatus,
    bookingStatus: propertyStatus === "not_applicable" ? "not_applicable" : "unconfirmed",
    roomTypeStatus: propertyStatus === "not_applicable" ? "not_applicable" : "pending",
    rating: {
      value: ratingValue,
      system: ratingValue ? "hotel_classification" : "unverified",
      sourceStatus: ratingSourceStatus,
      verifiedAt: null
    }
  });
  const day = (id, durationMinutes, meals, stayMeta, movementStatus = "demo_estimate") => ({
    id,
    sourceStatus: id.startsWith("TWN-") ? "source_document" : "demo_estimate",
    movement: {
      durationMinutes,
      distanceKm: null,
      status: movementStatus,
      sourceId: null
    },
    meals,
    stay: stayMeta,
    media: {
      sourceStatus: "demo_placeholder",
      rightsStatus: "prototype_only",
      productionAssetId: null
    }
  });

  const contracts = {
    2: {
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "MAD-5D",
      itineraryVersion: "2026-07-16.demo.1",
      productId: "MAD-5D",
      originMarket: "US-CA",
      destinationJurisdictions: ["ES"],
      sourceStatus: "demo_estimate",
      days: [
        day("MAD-5D-D01", 75, meal("self", "self", "included"), stay(4)),
        day("MAD-5D-D02", 145, meal("included", "included", "self"), stay(4)),
        day("MAD-5D-D03", 185, meal("included", "self", "included"), stay(4)),
        day("MAD-5D-D04", 345, meal("included", "included", "self"), stay(4)),
        day("MAD-5D-D05", 245, meal("included", "included", "self"), stay(0, "not_applicable"))
      ]
    },
    3: {
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "UKH-6D",
      itineraryVersion: "2026-07-16.demo.1",
      productId: "UKH-6D",
      originMarket: "US-CA",
      destinationJurisdictions: ["GB"],
      sourceStatus: "demo_estimate",
      days: [
        day("UKH-6D-D01", null, meal("in_flight", "in_flight", "in_flight"), stay(0, "not_applicable"), "flight_schedule_required"),
        day("UKH-6D-D02", 60, meal("included", "self", "included"), stay(4)),
        day("UKH-6D-D03", 120, meal("included", "included", "self"), stay(4)),
        day("UKH-6D-D04", 150, meal("included", "self", "self"), stay(4)),
        day("UKH-6D-D05", 180, meal("included", "self", "included"), stay(4)),
        day("UKH-6D-D06", 75, meal("included", "in_flight", "in_flight"), stay(0, "not_applicable"))
      ]
    },
    21: {
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "JPN-7D",
      itineraryVersion: "2026-07-16.demo.1",
      productId: "JPN-7D",
      originMarket: "US-CA",
      destinationJurisdictions: ["JP"],
      sourceStatus: "demo_estimate",
      days: [
        day("JPN-7D-D01", null, meal("in_flight", "in_flight", "in_flight"), stay(0, "not_applicable"), "flight_schedule_required"),
        day("JPN-7D-D02", 75, meal("included", "self", "included"), stay(4)),
        day("JPN-7D-D03", 210, meal("included", "included", "included"), stay(null)),
        day("JPN-7D-D04", 240, meal("included", "self", "included"), stay(4)),
        day("JPN-7D-D05", 60, meal("included", "included", "self"), stay(4)),
        day("JPN-7D-D06", 120, meal("included", "self", "included"), stay(4)),
        day("JPN-7D-D07", 60, meal("included", "in_flight", "in_flight"), stay(0, "not_applicable"))
      ]
    },
    88: {
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "TWN-8D",
      itineraryVersion: "2026-07-16.source-preview.1",
      productId: "TWN-8D",
      originMarket: "US-CA",
      destinationJurisdictions: ["TW"],
      sourceStatus: "source_document",
      days: [
        day("TWN-8D-D01", 150, meal("included", "included", "included"), stay(null)),
        day("TWN-8D-D02", 240, meal("included", "included_unconfirmed", "included"), stay(null)),
        day("TWN-8D-D03", 180, meal("included", "included", "included"), stay(null)),
        day("TWN-8D-D04", 210, meal("included", "included", "included"), stay(null)),
        day("TWN-8D-D05", 120, meal("included", "included", "included_unconfirmed"), stay(null)),
        day("TWN-8D-D06", 240, meal("included", "included", "included_unconfirmed"), stay(null, "proposed_or_equivalent", "source_document_unverified")),
        day("TWN-8D-D07", 240, meal("included", "included", "included"), stay(5, "proposed_or_equivalent", "source_document_claim")),
        day("TWN-8D-D08", 270, meal("included", "included_unconfirmed", "pending"), stay(0, "not_applicable", "not_applicable"))
      ]
    }
  };

  root.BC_ITINERARY_CONTRACT_META = Object.freeze(contracts);
  if (typeof module !== "undefined" && module.exports) module.exports = contracts;
})(typeof globalThis !== "undefined" ? globalThis : window);
