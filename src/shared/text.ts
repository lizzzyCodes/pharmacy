/**
 * Normalizes text by converting non-breaking spaces and collapses multiple whitespaces into a single space, then trims.
 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips leading list numbers from headings (e.g., "1. About hydrocortisone" -> "About hydrocortisone").
 */
export function stripHeadingNumbering(heading: string): string {
  return heading.replace(/^\d+\.\s*/, "").trim();
}
