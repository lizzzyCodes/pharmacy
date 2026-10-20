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
    sections.length > 1 && section.heading
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

    for (const { subSlug, page } of subPages) {
      const subUrl = buildMedicineUrl(slug, subSlug);
      const data = mergeSections(subUrl, page.sections, page.title || null);
      const key = sectionKeyForSubpage(subSlug);

      if (key) {
        sections[key] = data;
      } else {
        const sectionTitle = page.title || subSlug;
        otherSections[sectionTitle] = data;
      }
    }
  } else {
    // Single or group page: map each h2 by ID, then by heading text
    const hasStandardIds = mainPage.sections.some(
      (s) => s.id !== null && sectionKeyForHeading(s.id, "") !== null
    );
    pageType = hasStandardIds ? "single" : "group";

    // Heading-less intro (antihistamines, ranitidine, hydrocortisone rectal foam):
    // keep it as `about` so its text isn't lost. A real "What X is for" / "About X"
    // section later on the page replaces it.
    const intro = mainPage.sections.find((s) => !s.heading);
    let aboutIsIntro = false;
    if (intro && intro.content.length > 0) {
      sections.about = mergeSections(mainUrl, [intro]);
      aboutIsIntro = true;
    }

    for (const section of mainPage.sections) {
      if (!section.heading) continue; // Intro already handled above

      const key = sectionKeyForHeading(section.id, section.heading);
      if (key === "skip") continue;

      const sectionUrl = section.id ? `${mainUrl}#${section.id}` : mainUrl;
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

  const summary = mainPage.summary ?? extractIntroParagraph(mainPage.sections);
  const selfPath = `/medicines/${slug}/`;

  const medicine: Medicine = {
    slug,
    url: mainUrl,
    pageType,
    genericName: mainPage.genericName,
    brandNames: mainPage.brandNames,
    summary,
    lastReviewed: mainPage.lastReviewed,
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
