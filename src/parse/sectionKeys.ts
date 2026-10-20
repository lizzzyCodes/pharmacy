import { ALL_SECTION_KEYS, type SectionKey } from "../shared/types";

export { ALL_SECTION_KEYS, type SectionKey };
export const ALL_KEYS = ALL_SECTION_KEYS;

const BY_ID: Record<string, SectionKey> = {
  "what-its-for": "about",
  "who-its-for": "whoCanAndCannotTake",
  "how-its-used-previously-dosage-and-administration": "howAndWhenToTake",
  "side-effects": "sideEffects",
  interactions: "interactions",
};

// Order matters: "Taking X with other medicines" must be checked before "how to take".
const BY_HEADING: [RegExp, SectionKey][] = [
  [/with other medicines|interactions/i, "interactions"],
  [/side effects/i, "sideEffects"],
  [/^who (can|should)/i, "whoCanAndCannotTake"],
  [/^how (and when )?to (take|use)/i, "howAndWhenToTake"],
  [/pregnan|breastfeed/i, "pregnancyAndBreastfeeding"],
  [/common questions/i, "commonQuestions"],
  [/^(what .* (is|are) for|about )/i, "about"],
];

// Sub-page filename prefix → key (hub medicines like lansoprazole).
// Order matters: "taking-" must not be confused with "how-and-when-to-take-".
const SUBPAGE_PREFIXES: [prefix: string, key: SectionKey][] = [
  ["about-", "about"],
  ["who-can-and-cannot-", "whoCanAndCannotTake"],
  ["how-and-when-", "howAndWhenToTake"],
  ["when-to-take-", "howAndWhenToTake"],
  ["side-effects-", "sideEffects"],
  ["pregnancy-", "pregnancyAndBreastfeeding"],
  ["taking-", "interactions"],
  ["common-questions-", "commonQuestions"],
];

// Headings that are just links/boilerplate — drop them.
const SKIP_PATTERNS = [
  /^find out more about your medicine$/i,
  /^related conditions$/i,
  /^useful resources$/i,
];

/**
 * Returns true if the heading represents boilerplate navigation or links to skip.
 */
export function isSkipHeading(heading: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(heading));
}

/**
 * Resolves a SectionKey for a sub-page filename or slug (e.g., "about-lansoprazole" -> "about").
 */
export function sectionKeyForSubpage(subSlug: string): SectionKey | null {
  const match = SUBPAGE_PREFIXES.find(([prefix]) => subSlug.startsWith(prefix));
  return match ? match[1] : null;
}

/**
 * Map a section to one of the standard JSON keys based on id or heading text.
 * 1. Try the h2 id (single pages like warfarin / rosuvastatin)
 * 2. Fall back to the heading text (group pages like antihistamines, which have no ids)
 */
export function sectionKeyFor(
  id: string | null,
  heading: string
): SectionKey | "skip" | null {
  if (id && BY_ID[id]) return BY_ID[id];
  if (isSkipHeading(heading)) return "skip";
  return BY_HEADING.find(([re]) => re.test(heading))?.[1] ?? null;
}

export const sectionKeyForHeading = sectionKeyFor;
