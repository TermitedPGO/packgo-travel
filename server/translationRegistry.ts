/**
 * translationRegistry.ts — v78p Sprint 8 #3
 *
 * One place to declare which DB entities are translatable, what fields, and
 * how nested JSON paths get translated. Lets us add a new entity (e.g. FAQs,
 * homepage content, destinations) without rewriting translateTour() or
 * touching the BullMQ worker.
 *
 * Old design (translation.ts): translateTour() hardcoded a 15-element field
 * array + 3 nested JSON loops. Adding a new entity required forking the whole
 * function. This registry decouples "what to translate" from "how to translate".
 *
 * Usage (planned, after refactor):
 *   import { translateEntity } from "./translationRegistry";
 *   await translateEntity("tour", tourId, ["en"], "zh-TW", userId);
 */

export type TranslatableEntityType =
  | "tour"
  | "tour_departure"
  | "page"
  | "ui_element"
  | "notification"
  | "destination"
  | "homepage_content"
  | "faq"
  | "inquiry";

/**
 * Path within a JSON field. e.g. for hotels JSON [{name, description, ...}]:
 *   { walk: "$[*]", fields: ["name", "description"] }
 *
 * For dailyItinerary [{title, description, activities: [{name, description}]}]:
 *   [
 *     { walk: "$[*]", fields: ["title", "description"] },
 *     { walk: "$[*].activities[*]", fields: ["name", "description"] }
 *   ]
 *
 * Simple JSONPath subset: $ = root, [*] = each array elem, .name = property.
 */
export interface JsonFieldRule {
  walk: string;            // JSONPath-lite: "$[*]" or "$[*].activities[*]"
  fields: string[];        // string fields to translate at each matched node
}

export interface TranslatableEntity {
  type: TranslatableEntityType;
  /** drizzle table name (string for runtime lookup) */
  tableName: string;
  /** column to use as the entity id (always 'id' for our tables) */
  idColumn: string;
  /** simple scalar fields (string columns) to translate */
  scalarFields: string[];
  /** JSON columns + nested-path translation rules */
  jsonFields: Array<{ name: string; rules: JsonFieldRule[] }>;
  /** optional WHERE filter so we don't translate inactive/deleted rows */
  whereFilter?: { column: string; value: any };
}

/**
 * Registry of all translatable entities.
 *
 * Adding a new entity:
 *   1. Add an entry here
 *   2. Make sure translations table allows the new entityType enum value
 *      (drizzle schema: translations.entityType)
 *   3. Frontend: use `trpc.translation.getEntityTranslations` (planned tRPC)
 */
export const TRANSLATABLE_ENTITIES: Record<TranslatableEntityType, TranslatableEntity | null> = {
  tour: {
    type: "tour",
    tableName: "tours",
    idColumn: "id",
    scalarFields: [
      "title",
      "description",
      "highlights",
      "includes",
      "excludes",
      "notes",
      "heroSubtitle",
      "poeticTitle",
      "poeticSubtitle",
    ],
    jsonFields: [
      // Marketing / overview JSON columns
      { name: "keyFeatures", rules: [{ walk: "$[*]", fields: ["keyword", "title", "description"] }] },
      { name: "costExplanation", rules: [{ walk: "$.included[*]" as any, fields: [] }, { walk: "$.excluded[*]" as any, fields: [] }] },
      { name: "noticeDetailed", rules: [
        { walk: "$.preparation[*]" as any, fields: [] },
        { walk: "$.duringTrip[*]" as any, fields: [] },
        { walk: "$.afterTrip[*]" as any, fields: [] },
      ] },
      { name: "flights", rules: [
        { walk: "$.outbound" as any, fields: ["vehicleNo", "departureTime", "arrivalTime", "duration", "departurePoint", "arrivalPoint"] },
        { walk: "$.inbound" as any, fields: ["vehicleNo", "departureTime", "arrivalTime", "duration", "departurePoint", "arrivalPoint"] },
      ] },
      { name: "poeticContent", rules: [{ walk: "$" as any, fields: ["intro", "accommodation", "dining", "transportation", "scenery"] }] },
      // Day-by-day
      { name: "itineraryDetailed", rules: [
        { walk: "$[*]", fields: ["title", "description"] },
        { walk: "$[*].activities[*]", fields: ["title", "description"] },
      ] },
      { name: "dailyItinerary", rules: [
        { walk: "$[*]", fields: ["title", "description"] },
        { walk: "$[*].activities[*]", fields: ["name", "description"] },
      ] },
      // Hotels & meals
      { name: "hotels", rules: [{ walk: "$[*]", fields: ["name", "description", "stars"] }] },
      { name: "meals", rules: [{ walk: "$[*]", fields: ["name", "description", "cuisine"] }] },
    ],
    whereFilter: { column: "status", value: "active" },
  },

  // Full-page CMS content — homepage hero, mission statements etc.
  homepage_content: {
    type: "homepage_content",
    tableName: "homepageContent",
    idColumn: "id",
    scalarFields: ["heroTitle", "heroSubtitle", "missionStatement", "ctaText"],
    jsonFields: [],
  },

  // Destination cards (e.g. country/city write-ups on destination pages)
  destination: {
    type: "destination",
    tableName: "destinations",
    idColumn: "id",
    scalarFields: ["name", "tagline", "description"],
    jsonFields: [],
  },

  // FAQ entries — if/when we move FAQs to DB instead of i18n keys
  faq: null, // not yet — hold for future

  // Existing entityTypes already in the schema enum
  tour_departure: {
    type: "tour_departure",
    tableName: "tourDepartures",
    idColumn: "id",
    scalarFields: ["notes", "specialOffer"],
    jsonFields: [],
  },

  // v78q: Customer inquiries — admin reads them in EN even when customer wrote ZH
  // (subject + message). Contact info stays untranslated (PII).
  inquiry: {
    type: "inquiry" as any,
    tableName: "inquiries",
    idColumn: "id",
    scalarFields: ["subject", "message"],
    jsonFields: [],
  },

  page: null,           // pending
  ui_element: null,     // pending
  notification: null,   // pending
} as Record<string, TranslatableEntity | null>;

/**
 * Walk a "JSONPath-lite" expression and apply a transformer fn to each
 * matched leaf-string field. Mutates `obj` in place. Returns a count of
 * fields matched.
 *
 * Supported syntax:
 *   $        → root
 *   $.foo    → property
 *   $[*]     → each array element
 *   $.foo[*] → each element of array at .foo
 */
export async function applyToJsonPath(
  obj: any,
  rules: JsonFieldRule[],
  transform: (str: string) => Promise<string>
): Promise<number> {
  if (!obj) return 0;
  let count = 0;

  for (const rule of rules) {
    const path = rule.walk.replace(/^\$/, "").trim(); // strip leading $
    const segments: Array<{ kind: "prop" | "wildcard"; key?: string }> = [];
    // Tokenize: ".foo" or "[*]"
    let i = 0;
    while (i < path.length) {
      if (path[i] === ".") {
        const j = path.slice(i + 1).search(/[\.\[]/);
        const end = j < 0 ? path.length : i + 1 + j;
        segments.push({ kind: "prop", key: path.slice(i + 1, end) });
        i = end;
      } else if (path[i] === "[") {
        const close = path.indexOf("]", i);
        if (path.slice(i, close + 1) === "[*]") {
          segments.push({ kind: "wildcard" });
        }
        i = close + 1;
      } else {
        i++;
      }
    }

    // Recursively walk
    const walk = async (node: any, segIdx: number): Promise<void> => {
      if (node == null) return;
      if (segIdx >= segments.length) {
        // We're at a leaf node — apply rule.fields
        if (typeof node === "object" && !Array.isArray(node)) {
          for (const f of rule.fields) {
            if (typeof node[f] === "string" && node[f].trim()) {
              node[f] = await transform(node[f]);
              count++;
            }
          }
        }
        return;
      }
      const seg = segments[segIdx];
      if (seg.kind === "wildcard") {
        if (Array.isArray(node)) {
          for (const item of node) await walk(item, segIdx + 1);
        }
      } else if (seg.kind === "prop" && seg.key) {
        await walk(node[seg.key], segIdx + 1);
      }
    };

    await walk(obj, 0);
  }

  return count;
}
