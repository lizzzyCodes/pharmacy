// Parses data from HTML instead of fetching from NHS
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type {
  Block,
  Callout,
  CalloutLevel,
  Link,
  ParsedPage,
  Section,
} from "../shared/types";
import { cleanText, stripHeadingNumbering } from "../shared/text";
import { NHS_BASE_URL } from "../shared/urls";

export type { Block, Callout, Section, Link, ParsedPage };

// Boxes that are pulled out of the normal text and stored as callouts:
//  - care cards (999 / 111 / pharmacist), warning cards ("Important")
//  - inset text ("If you're told to go to A&E…", "More about side effects")
const CALLOUT_SELECTOR =
  ".nhsuk-card--care, .nhsuk-card--warning, .nhsuk-inset-text";
const CALLOUT_CONTAINER = ".nhsuk-card, .nhsuk-inset-text";

/**
 * Text of an element without screen-reader-only bits like "Non-urgent advice: ".
 */
function extractVisibleText($: CheerioAPI, el: Cheerio<AnyNode>): string {
  const copy = el.clone();
  copy.find(".nhsuk-u-visually-hidden").remove();
  return cleanText(copy.text());
}

/**
 * Determines the alert/callout severity level based on NHS styling classes.
 */
function resolveCalloutLevel(el: Cheerio<Element>): CalloutLevel {
  if (el.hasClass("nhsuk-card--care--emergency")) return "emergency";
  if (el.hasClass("nhsuk-card--care--urgent")) return "urgent";
  if (el.hasClass("nhsuk-card--care--non-urgent")) return "non-urgent";
  if (el.hasClass("nhsuk-card--warning")) return "warning";
  return "info";
}

/**
 * Turn paragraphs, lists, and headings inside an element into Blocks in DOM order.
 */
function extractBlocksFrom(
  $: CheerioAPI,
  root: Cheerio<AnyNode>,
  titleHeading?: Cheerio<AnyNode> // the h2 used as the section's own title — not repeated in its content
): Block[] {
  const blocks: Block[] = [];

  // `summary` = the title of an expandable section (<details>), e.g. "Tablets for skin infections".
  // It becomes a heading block so it's clear which form (tablets / cream / ointment) the text is about.
  // h2 is included for sections with more than one h2 (e.g. co-codamol for children:
  // "Who can take co-codamol" + "Who may not be able to take co-codamol" in one <section>)
  root.find("p, ul, ol, h2, h3, h4, summary").each((_, node) => {
    const el = $(node);

    // the section's own title is stored as section.heading
    if (titleHeading?.length && titleHeading.is(el)) return;

    // Card headings are stored as callout.heading, don't duplicate into content
    if (el.hasClass("nhsuk-card__heading")) return;

    // Skip nested blocks inside a callout card (callouts are collected separately),
    // unless we are parsing that card itself
    const box = el.closest(CALLOUT_CONTAINER);
    if (box.length && !root.closest(CALLOUT_CONTAINER).is(box)) return;

    // Skip lists inside lists being counted twice
    if (
      el.parents("ul, ol").length &&
      (node.tagName === "ul" || node.tagName === "ol")
    ) {
      return;
    }

    if (node.tagName === "p") {
      const text = extractVisibleText($, el);
      if (text) blocks.push({ type: "paragraph", text });
    } else if (node.tagName === "ul" || node.tagName === "ol") {
      const items = el
        .children("li")
        .map((_, li) => extractVisibleText($, $(li)))
        .get()
        .filter(Boolean);
      if (items.length) blocks.push({ type: "list", items });
    } else {
      const text = extractVisibleText($, el);
      if (text) blocks.push({ type: "heading", text });
    }
  });

  return blocks;
}

/**
 * Extracts NHS care cards, warning cards and inset text boxes as callouts.
 */
function extractCalloutsFrom($: CheerioAPI, root: Cheerio<AnyNode>): Callout[] {
  return root
    .find(CALLOUT_SELECTOR)
    .map((_, node) => {
      const box = $(node);

      if (box.hasClass("nhsuk-inset-text")) {
        // Inset boxes: title is an optional h3 ("More about side effects"),
        // otherwise use the screen-reader label ("Information: " → "Information")
        const h3 = box.find("h3").first();
        const label = cleanText(
          box.children(".nhsuk-u-visually-hidden").first().text()
        ).replace(/:$/, "");
        const heading = h3.length
          ? extractVisibleText($, h3)
          : label || "Information";
        const content = extractBlocksFrom($, box).filter(
          (b) => !(b.type === "heading" && b.text === heading)
        );
        return { level: "info" as const, heading, content };
      }

      return {
        level: resolveCalloutLevel(box),
        heading: extractVisibleText(
          $,
          box.find(".nhsuk-card__heading").first()
        ),
        content: extractBlocksFrom($, box.find(".nhsuk-card__content").first()),
      };
    })
    .get();
}

type JsonLdDrug = {
  proprietaryName?: string | string[];
  nonProprietaryName?: string;
};

type JsonLdPage = {
  drug?: JsonLdDrug | JsonLdDrug[];
  lastReviewed?: string[];
  [key: string]: unknown;
};

/**
 * Extracts metadata from schema.org JSON-LD script tags.
 */
function extractJsonLdMetadata($: CheerioAPI): {
  brandNames: string[];
  genericName: string | null;
  lastReviewed: string | null;
} {
  const blocks: JsonLdPage[] = $('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        return JSON.parse($(el).text()) as JsonLdPage;
      } catch {
        return null;
      }
    })
    .get()
    .filter((b): b is JsonLdPage => b !== null);

  const drug = blocks.flatMap((b) =>
    Array.isArray(b.drug) ? b.drug : b.drug ? [b.drug] : []
  )[0];

  const page = blocks.find((b) => b.lastReviewed);
  const brands = drug?.proprietaryName;

  return {
    brandNames: Array.isArray(brands) ? brands : brands ? [brands] : [],
    genericName: drug?.nonProprietaryName ?? null,
    lastReviewed: page?.lastReviewed?.[0] ?? null,
  };
}

/**
 * Links listed under an h2 section (e.g. "Related conditions").
 */
function extractLinksUnderHeading($: CheerioAPI, headingText: string): Link[] {
  const h2 = $("main h2")
    .filter((_, el) => cleanText($(el).text()) === headingText)
    .first();

  if (!h2.length) return [];

  // Single/stub pages: <h2> and <ul> are siblings inside a feature card.
  // Hub pages: the <h2> is wrapped in <div class="beta-hub-related-links-title">, and the <ul> follows that div.
  let list = h2.nextAll("ul").first();
  if (!list.length) list = h2.parent().nextAll("ul").first();

  return list
    .find("a")
    .map((_, a) => ({
      name: cleanText($(a).text()),
      url: new URL($(a).attr("href") ?? "", NHS_BASE_URL).href,
    }))
    .get();
}

/** NHS condition/symptom pages, as opposed to charities and other external resources. */
const isConditionLink = (url: string) =>
  /^https:\/\/www\.nhs\.uk\/(conditions|symptoms)\//.test(url);

/**
 * Related conditions and useful resources.
 * Most pages have separate "Related conditions" / "Useful resources" boxes; some hubs (HRT)
 * have one mixed "Related information" box, which is split by URL.
 */
function extractRelatedLinks($: CheerioAPI): {
  relatedConditions: Link[];
  usefulResources: Link[];
} {
  const mixed = [
    "Related information",
    "Related links",
    "Related resources",
  ].flatMap((h) => extractLinksUnderHeading($, h));
  return {
    relatedConditions: [
      ...extractLinksUnderHeading($, "Related conditions"),
      ...mixed.filter((l) => isConditionLink(l.url)),
    ],
    usefulResources: [
      ...extractLinksUnderHeading($, "Useful resources"),
      ...mixed.filter((l) => !isConditionLink(l.url)),
    ],
  };
}

/**
 * Extracts other medicine pages linked from inside the article.
 */
function extractRelatedMedicineHrefs(
  $: CheerioAPI,
  article: Cheerio<AnyNode>
): string[] {
  const hrefs = article
    .find("a[href^='/medicines/']")
    .map((_, a) => $(a).attr("href") ?? "")
    .get()
    .filter((href) => /^\/medicines\/[^/]+\/$/.test(href));

  return [...new Set(hrefs)];
}

/**
 * Parse one NHS medicine page (hub, sub-page, or single page) into structured data.
 */
export function parsePage(html: string): ParsedPage {
  const $ = cheerio.load(html);
  const main = $("main");

  // H1 title without the "- Brand name: ..." caption.
  // Guide-style pages (e.g. antibiotics, anticoagulants) have "Overview" with a bottom caption naming the topic.
  const h1 = main.find("h1").first().clone();
  const bottomCaption = h1.find(".nhsuk-caption--bottom");
  let title = "";

  if (bottomCaption.length) {
    const bottomCopy = bottomCaption.clone();
    bottomCopy.find(".nhsuk-u-visually-hidden").remove();
    title = cleanText(bottomCopy.text());
  }

  if (!title) {
    h1.find(".nhsuk-caption-xl").remove();
    title = cleanText(h1.text());
  }

  const { brandNames, genericName, lastReviewed } = extractJsonLdMetadata($);
  const description = $('meta[name="description"]').attr("content") ?? "";

  // Content lives in <article><section>...; fall back to main if there's no article
  const article = main.find("article").length ? main.find("article") : main;

  const rawSections: Section[] = article
    .find("section")
    .map((_, node) => {
      const section = $(node);
      const h2 = section.find("h2").not(".nhsuk-card__heading").first();

      return {
        id: h2.attr("id") || section.attr("id") || null,
        heading: stripHeadingNumbering(extractVisibleText($, h2)),
        content: extractBlocksFrom($, section, h2),
        callouts: extractCalloutsFrom($, section),
      };
    })
    .get();

  // Merge sections that have no heading into the previous section
  const sections: Section[] = rawSections.reduce<Section[]>((acc, s) => {
    if (!s.heading && acc.length) {
      const prev = acc[acc.length - 1];
      prev.content.push(...s.content);
      prev.callouts.push(...s.callouts);
    } else {
      acc.push(s);
    }
    return acc;
  }, []);

  return {
    title,
    brandNames,
    genericName,
    summary: cleanText(main.find(".nhsuk-lede-text").first().text()) || null,
    lastReviewed,
    // foam says "discontinued", ranitidine says "not currently available in the UK, or globally"
    discontinued:
      /discontinued|withdrawn|(not currently|no longer) available/i.test(
        description
      ),
    // three hub styles: key-links list (lansoprazole), clickable cards (HRT, insulin),
    // guide contents list (antibiotics)
    isHub:
      main.find(
        ".nhsuk-hub-key-links__list-item, a.nhsuk-card__link, a.nhsuk-contents-list__link"
      ).length > 0,
    // On guide pages the h1 caption is the guide name ("Antibiotics"), so the page's own name
    // ("Side effects") comes from the highlighted item in "Pages in this guide"
    guidePageTitle:
      cleanText(main.find(".nhsuk-contents-list__current").first().text()) ||
      null,
    sections,
    ...extractRelatedLinks($),
    relatedMedicines: extractRelatedMedicineHrefs($, article),
  };
}
