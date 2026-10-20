export const NHS_BASE_URL = "https://www.nhs.uk";
export const MEDICINES_INDEX_URL = "https://www.nhs.uk/medicines/";
export const MEDICINES_INDEX_BASE_URL = MEDICINES_INDEX_URL;
export const DEFAULT_SLEEP_TIME_MS = 500;

/**
 * Builds a standardized NHS medicine URL without duplicate slashes.
 */
export function buildMedicineUrl(slug: string, subSlug?: string): string {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, "");
  if (!subSlug) {
    return `${NHS_BASE_URL}/medicines/${cleanSlug}/`;
  }
  const cleanSubSlug = subSlug.replace(/^\/+|\/+$/g, "");
  return `${NHS_BASE_URL}/medicines/${cleanSlug}/${cleanSubSlug}/`;
}

/**
 * Converts a relative or absolute URL to a canonical absolute NHS URL.
 */
export function toAbsoluteUrl(href: string, base: string = NHS_BASE_URL): string {
  return new URL(href, base).href;
}

/**
 * Parses a medicine URL or pathname to extract slug and optional subpage slug.
 */
export function parseMedicinePath(urlOrPath: string): {
  slug?: string;
  subSlug?: string;
  isIndex: boolean;
} {
  const pathname = urlOrPath.startsWith("http")
    ? new URL(urlOrPath).pathname
    : urlOrPath;

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || parts[0] !== "medicines") {
    return { isIndex: false };
  }

  if (parts.length === 1) {
    return { isIndex: true };
  }

  return {
    slug: parts[1],
    subSlug: parts[2],
    isIndex: false,
  };
}

/**
 * Returns true if the pathname corresponds to a single medicine page root (not an index or sub-page).
 * Example: "/medicines/aspirin/" or "/medicines/aspirin"
 */
export function isMedicineRootPath(pathname: string): boolean {
  return /^\/medicines\/[^/]+\/?$/.test(pathname);
}
