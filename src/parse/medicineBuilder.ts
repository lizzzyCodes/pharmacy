import type {
  Block,
  Callout,
  Medicine,
  MedicinePageType,
  ParsedPage,
  Section,
  SectionData,
  SectionKey,
} from "../shared/types";
import { ALL_SECTION_KEYS } from "../shared/types";
import { buildMedicineUrl } from "../shared/urls";
import { sectionKeyForHeading, sectionKeyForSubpage } from "./sectionKeys";

export type SubPageInput = {
  subSlug: string;
  page: ParsedPage;
};

/**
 * Creates an empty section map initialized with null for all standard keys.
 */
export function createEmptySections(): Record<SectionKey, SectionData | null> {
  return Object.fromEntries(
    ALL_SECTION_KEYS.map((key) => [key, null])
  ) as Record<SectionKey, SectionData | null>;
}

/**
 * Combines several parsed sections (e.g. all sections of one sub-page) into one SectionData.
 * `heading` is the original title from the NHS page, e.g. "What aciclovir is for" or
 * "Side effects of lansoprazole" — kept so the bundle doesn't lose it when mapping to a key.
 */
export function mergeSections(
  url: string,
  sections: Section[],
  heading: string | null = null
): SectionData {
  const content: Block[] = sections.flatMap((section) =>
    // keep a section's own h2 as a heading block unless it's already the merged title
    // (hub sub-pages: the h1 replaces it, so "Who can take co-codamol" would otherwise be lost)
    section.heading && section.heading !== heading
      ? [
          { type: "heading" as const, text: section.heading },
          ...section.content,
        ]
      : section.content
  );

  const callouts: Callout[] = sections.flatMap((section) => section.callouts);

  return { url, heading, content, callouts };
}

/**
 * Extracts the first paragraph of a heading-less intro section — used when a page has no lede.
 */
export function extractIntroParagraph(sections: Section[]): string | null {
  const intro = sections.find((s) => !s.heading);
  const paragraph = intro?.content.find((b) => b.type === "paragraph");
  return paragraph && paragraph.type === "paragraph" ? paragraph.text : null;
}

/**
 * Fallback for sub-page slugs that don't follow the usual "<topic>-of-<medicine>" pattern,
 * e.g. guide pages "/antibiotics/side-effects/" or "/antibiotics/interactions/".
 * Reads the slug as words and applies the heading rules.
 */
function sectionKeyFromSlugWords(subSlug: string): SectionKey | null {
  const key = sectionKeyForHeading(null, subSlug.replace(/-/g, " "));
  return key && key !== "skip" ? key : null;
}

/**
 * Maps one page's own sections onto the standard keys (single pages, group pages, guide overviews).
 * A heading-less intro (antihistamines, ranitidine, hydrocortisone rectal foam) is kept as `about`
 * so its text isn't lost; a real "What X is for" / "About X" section replaces it.
 */
function mapPageSections(
  pageSections: Section[],
  pageUrl: string,
  sections: Record<SectionKey, SectionData | null>,
  otherSections: Record<string, SectionData>
): void {
  const intro = pageSections.find((s) => !s.heading);
  let aboutIsIntro = false;
  if (intro && intro.content.length > 0) {
    sections.about = mergeSections(pageUrl, [intro]);
    aboutIsIntro = true;
  }

  for (const section of pageSections) {
    if (!section.heading) continue; // Intro already handled above

    const key = sectionKeyForHeading(section.id, section.heading);
    if (key === "skip") continue;

    const sectionUrl = section.id ? `${pageUrl}#${section.id}` : pageUrl;
    const data = mergeSections(sectionUrl, [section], section.heading);

    const replacesIntro = key === "about" && aboutIsIntro;
    if (key && (!sections[key] || replacesIntro)) {
      sections[key] = data;
      if (replacesIntro) aboutIsIntro = false;
    } else {
      otherSections[section.heading] = data;
    }
  }
}

/**
 * Assembles a structured Medicine domain model from parsed pages.
 * Pure function: completely isolated from filesystem and network.
 */
export function assembleMedicine(
  slug: string,
  mainPage: ParsedPage,
  subPages: SubPageInput[] = []
): { name: string; medicine: Medicine } {
  if (!mainPage.title) {
    throw new Error(`Missing title on main page for "${slug}"`);
  }

  const mainUrl = buildMedicineUrl(slug);
  const sections = createEmptySections();
  const otherSections: Record<string, SectionData> = {};

  let pageType: MedicinePageType;

  if (subPages.length > 0) {
    // Hub page: each sub-page corresponds to a section
    pageType = "hub";

    // Guide pages (antibiotics): the overview page has its own content as well as sub-pages
    if (mainPage.guidePageTitle) {
      mapPageSections(mainPage.sections, mainUrl, sections, otherSections);
    }

    for (const { subSlug, page } of subPages) {
      const subUrl = buildMedicineUrl(slug, subSlug);
      // guide sub-pages are titled by the guide ("Antibiotics"), so prefer the page's own name ("Side effects")
      const label = page.guidePageTitle ?? (page.title || subSlug);
      const data = mergeSections(subUrl, page.sections, label);
      const key =
        sectionKeyForSubpage(subSlug) ?? sectionKeyFromSlugWords(subSlug);

      if (key) {
        // a full sub-page beats the overview's short summary of it; keep the summary rather than lose it
        const existing = sections[key];
        if (existing?.heading && !otherSections[existing.heading])
          otherSections[existing.heading] = existing;
        sections[key] = data;
      } else {
        otherSections[label] = data;
      }
    }
  } else {
    // Single or group page: map each h2 by ID, then by heading text
    const hasStandardIds = mainPage.sections.some(
      (s) => s.id !== null && sectionKeyForHeading(s.id, "") !== null
    );
    pageType = hasStandardIds ? "single" : "group";
    mapPageSections(mainPage.sections, mainUrl, sections, otherSections);
  }

  const summary = mainPage.summary ?? extractIntroParagraph(mainPage.sections);
  const selfPath = `/medicines/${slug}/`;

  const medicine: Medicine = {
    slug,
    url: mainUrl,
    pageType,
    genericName: mainPage.genericName,
    brandNames: mainPage.brandNames,
    summary,
    // hub main pages have no review date in their JSON-LD; their sub-pages do
    lastReviewed:
      mainPage.lastReviewed ??
      subPages
        .map((p) => p.page.lastReviewed)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ??
      null,
    discontinued: mainPage.discontinued,
    sections,
    otherSections,
    relatedConditions: mainPage.relatedConditions,
    usefulResources: mainPage.usefulResources,
    relatedMedicines: mainPage.relatedMedicines.filter((p) => p !== selfPath),
  };

  return {
    name: mainPage.title,
    medicine,
  };
}
