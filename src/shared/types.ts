// Core Domain Types for Pharmacy NHS Scraper & Parser

export type Link = {
  name: string;
  url: string;
};

// Aliased for crawler backwards compatibility
export type MedicineLink = Link;

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] };

export type CalloutLevel =
  | "emergency"
  | "urgent"
  | "non-urgent"
  | "warning"
  | "info";

export type Callout = {
  level: CalloutLevel;
  heading: string;
  content: Block[];
};

export type Section = {
  id: string | null;
  heading: string;
  content: Block[];
  callouts: Callout[];
};

export type ParsedPage = {
  title: string;
  brandNames: string[];
  genericName: string | null;
  summary: string | null;
  lastReviewed: string | null;
  discontinued: boolean;
  isHub: boolean;
  sections: Section[];
  relatedConditions: Link[];
  usefulResources: Link[];
  relatedMedicines: string[];
  guidePageTitle: string | null;
};

export const ALL_SECTION_KEYS = [
  "about",
  "whoCanAndCannotTake",
  "howAndWhenToTake",
  "sideEffects",
  "pregnancyAndBreastfeeding",
  "interactions",
  "commonQuestions",
] as const;

export type SectionKey = (typeof ALL_SECTION_KEYS)[number];

export type SectionData = {
  url: string;
  content: Block[];
  heading: string | null;
  callouts: Callout[];
};

export type MedicinePageType = "hub" | "single" | "group";

export type Medicine = {
  slug: string;
  url: string;
  pageType: MedicinePageType;
  genericName: string | null;
  brandNames: string[];
  summary: string | null;
  lastReviewed: string | null;
  discontinued: boolean;
  sections: Record<SectionKey, SectionData | null>;
  otherSections: Record<string, SectionData>;
  relatedConditions: Link[];
  usefulResources: Link[];
  relatedMedicines: string[];
};

export type Bundle = Record<string, Medicine>;

export type CrawledPage = {
  url: string;
  html: string;
};

export type CrawledMedicine = CrawledPage & {
  subPages: CrawledPage[];
};
