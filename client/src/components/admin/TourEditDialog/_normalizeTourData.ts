/**
 * v2 Wave 2 Module 2.12 — tourData normalizer.
 *
 * Originally inline inside the giant 2,156 LOC `useEffect`. Extracted here so
 * the context provider keeps under 400 LOC and so the parser is unit-test
 * targetable in isolation (no DOM / no React).
 *
 * Behaviour-preserving — every branch matches the pre-split logic byte for
 * byte, including the `typeName`-based flight `type` re-inference at the end.
 */

function ensureArray(val: any): any[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return [val];
  return [];
}

/**
 * Normalise the raw tour row pulled from the API into the shape the editor
 * expects (arrays vs objects, defaults for missing keys, flight-type
 * re-inference from typeName).
 */
export function normalizeTourData(tourData: any): any {
  const parsed = { ...tourData };

  // 解析 itineraryDetailed
  if (typeof parsed.itineraryDetailed === "string") {
    try {
      parsed.itineraryDetailed = JSON.parse(parsed.itineraryDetailed);
    } catch {
      parsed.itineraryDetailed = [];
    }
  }
  if (!Array.isArray(parsed.itineraryDetailed)) {
    parsed.itineraryDetailed = [];
  }

  // 解析 costExplanation
  if (typeof parsed.costExplanation === "string") {
    try {
      parsed.costExplanation = JSON.parse(parsed.costExplanation);
    } catch {
      parsed.costExplanation = {
        included: [],
        excluded: [],
        additionalCosts: [],
        notes: "",
      };
    }
  }
  if (!parsed.costExplanation || typeof parsed.costExplanation !== "object") {
    parsed.costExplanation = {
      included: [],
      excluded: [],
      additionalCosts: [],
      notes: "",
    };
  }

  // 解析 noticeDetailed
  if (typeof parsed.noticeDetailed === "string") {
    try {
      parsed.noticeDetailed = JSON.parse(parsed.noticeDetailed);
    } catch {
      parsed.noticeDetailed = {
        preparation: [],
        culturalNotes: [],
        healthSafety: [],
        emergency: [],
      };
    }
  }
  if (!parsed.noticeDetailed || typeof parsed.noticeDetailed !== "object") {
    parsed.noticeDetailed = {
      preparation: [],
      culturalNotes: [],
      healthSafety: [],
      emergency: [],
    };
  }
  parsed.noticeDetailed = {
    preparation: ensureArray(parsed.noticeDetailed.preparation),
    culturalNotes: ensureArray(parsed.noticeDetailed.culturalNotes),
    healthSafety: ensureArray(parsed.noticeDetailed.healthSafety),
    emergency: ensureArray(parsed.noticeDetailed.emergency),
  };

  // 解析 flights (交通資訊)
  if (typeof parsed.flights === "string") {
    try {
      parsed.flights = JSON.parse(parsed.flights);
    } catch {
      parsed.flights = { type: "FLIGHT", typeName: "" };
    }
  }
  if (!parsed.flights || typeof parsed.flights !== "object") {
    parsed.flights = { type: "FLIGHT", typeName: "" };
  }
  // 修復：根據 typeName 推斷正確的 type（解決 AI 生成時 type/typeName 不一致的問題）
  const flightTypeNameLower = (parsed.flights.typeName || "").toLowerCase();
  if (
    flightTypeNameLower.includes("飛機") ||
    flightTypeNameLower.includes("flight") ||
    flightTypeNameLower.includes("airline") ||
    flightTypeNameLower.includes("air")
  ) {
    parsed.flights.type = "FLIGHT";
  } else if (
    flightTypeNameLower.includes("郵輪") ||
    flightTypeNameLower.includes("cruise") ||
    flightTypeNameLower.includes("ship")
  ) {
    parsed.flights.type = "CRUISE";
  } else if (
    flightTypeNameLower.includes("巴士") ||
    flightTypeNameLower.includes("bus") ||
    flightTypeNameLower.includes("客車")
  ) {
    parsed.flights.type = "BUS";
  } else if (
    flightTypeNameLower.includes("自駕") ||
    flightTypeNameLower.includes("租車") ||
    flightTypeNameLower.includes("car") ||
    flightTypeNameLower.includes("drive")
  ) {
    parsed.flights.type = "CAR";
  }
  // 如果 type 不是已知類型，保持原有值（防止覆蓋正確設定）

  // 解析 images (照片陣列)
  if (typeof parsed.images === "string") {
    try {
      parsed.images = JSON.parse(parsed.images);
    } catch {
      parsed.images = [];
    }
  }
  if (!Array.isArray(parsed.images)) {
    parsed.images = [];
  }

  return parsed;
}
