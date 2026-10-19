import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

// Parses HTML into JSON
export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] };

export type Callout = {
  level: "emergency" | "urgent" | "non-urgent" | "warning" | "info";
  heading: string;
  content: Block[];
};

export type Section = {
  id: string | null; // the h2 id when there is one, e.g. "side-effects"
  heading: string;
  content: Block[];
  callouts: Callout[];
};

export type ParsedPage = {
  title: string;
  brandNames: string[];
  summary: string | null;
  lastReviewed: string | null;
  sections: Section[];
};

/** Collapse whitespace and non-breaking spaces, then trim. */
const clean = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** Text of an element without screen-reader-only bits like "Non-urgent advice: ". */
function visibleText($: CheerioAPI, el: Cheerio<AnyNode>): string {
  const copy = el.clone();
  copy.find(".nhsuk-u-visually-hidden").remove();
  return clean(copy.text());
}

function calloutLevel(el: Cheerio<Element>): Callout["level"] {
  if (el.hasClass("nhsuk-card--care--emergency")) return "emergency";
  if (el.hasClass("nhsuk-card--care--urgent")) return "urgent";
  if (el.hasClass("nhsuk-card--care--non-urgent")) return "non-urgent";
  if (el.hasClass("nhsuk-card--warning")) return "warning";
  return "info";
}

/** Turn the paragraphs, lists and h3s inside an element into Blocks, in page order. */
function blocksFrom($: CheerioAPI, root: Cheerio<AnyNode>): Block[] {
  const blocks: Block[] = [];
  root.find("p, ul, ol, h3, h4").each((_, node) => {
    const el = $(node);
    // a card's own title is stored as callout.heading, so don't repeat it in the content
    if (el.hasClass("nhsuk-card__heading")) return;
    // skip anything inside a callout card (callouts are collected separately),
    // unless we are reading that card itself
    const card = el.closest(".nhsuk-card");
    if (card.length && !root.closest(".nhsuk-card").is(card)) return;
    // skip list items' nested lists being counted twice
    if (
      el.parents("ul, ol").length &&
      (node.tagName === "ul" || node.tagName === "ol")
    )
      return;

    if (node.tagName === "p") {
      const text = visibleText($, el);
      if (text) blocks.push({ type: "paragraph", text });
    } else if (node.tagName === "ul" || node.tagName === "ol") {
      const items = el
        .children("li")
        .map((_, li) => visibleText($, $(li)))
        .get()
        .filter(Boolean);
      if (items.length) blocks.push({ type: "list", items });
    } else {
      const text = visibleText($, el);
      if (text) blocks.push({ type: "heading", text });
    }
  });
  return blocks;
}

function calloutsFrom($: CheerioAPI, root: Cheerio<AnyNode>): Callout[] {
  return root
    .find(".nhsuk-card--care, .nhsuk-card--warning")
    .map((_, node) => {
      const card = $(node);
      return {
        level: calloutLevel(card),
        heading: visibleText($, card.find(".nhsuk-card__heading").first()),
        content: blocksFrom($, card.find(".nhsuk-card__content").first()),
      };
    })
    .get();
}

/** Metadata from the page's schema.org JSON-LD blocks. */
function readJsonLd($: CheerioAPI) {
  const blocks = $('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        return JSON.parse($(el).text());
      } catch {
        return null; // one broken block shouldn't kill the whole page
      }
    })
    .get()
    .filter(Boolean);

  const drug = blocks.flatMap((b: any) => b.drug ?? [])[0];
  const page = blocks.find((b: any) => b.lastReviewed);
  const brands = drug?.proprietaryName;

  return {
    brandNames: Array.isArray(brands) ? brands : brands ? [brands] : [],
    lastReviewed: page?.lastReviewed?.[0] ?? null,
  };
}

// ---------- Main ----------

/** Parse one NHS medicine page (hub, sub-page, or single page) into structured data. */
export function parsePage(html: string): ParsedPage {
  const $ = cheerio.load(html);
  const main = $("main");

  // h1 without the "- Brand name: ..." caption
  const h1 = main.find("h1").first().clone();
  h1.find(".nhsuk-caption-xl").remove();

  const { brandNames, lastReviewed } = readJsonLd($);

  // Content lives in <article><section>...; fall back to main if there's no article
  const article = main.find("article").length ? main.find("article") : main;

  const sections: Section[] = article
    .find("section")
    .map((_, node) => {
      const section = $(node);
      // usually a direct child, but sometimes wrapped (rosuvastatin's "Find out more" sits in an inset box);
      // ignore card headings, which are callout titles, not section titles
      const h2 = section.find("h2").not(".nhsuk-card__heading").first();
      return {
        // the id is usually on the h2, but some pages (hydrocortisone) put it on the <section>
        // `||` not `??`, so an empty id="" (hydrocortisone rectal foam) becomes null too
        id: h2.attr("id") || section.attr("id") || null,
        // strip "1. " style numbering so "1. About hydrocortisone" → "About hydrocortisone"
        heading: visibleText($, h2).replace(/^\d+\.\s*/, ""),
        content: blocksFrom($, section),
        callouts: calloutsFrom($, section),
      };
    })
    .get()
    // a section with no h2 (e.g. only a callout card) gets merged into the previous one
    .reduce<Section[]>((acc, s) => {
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
    title: clean(h1.text()),
    brandNames,
    summary: clean(main.find(".nhsuk-lede-text").first().text()) || null,
    lastReviewed,
    sections,
  };
}
