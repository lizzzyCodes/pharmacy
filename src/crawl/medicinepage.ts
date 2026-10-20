import type { Page } from "playwright";
import * as cheerio from "cheerio";
import { fetchPage, type FetchPageOptions } from "./fetchPage";
import type { CrawledMedicine, CrawledPage } from "../shared/types";

export type { CrawledPage, CrawledMedicine };

// Hubs come in two styles:
//  - a key-links list (lansoprazole, peppermint oil, ...)
//  - clickable cards (hormone replacement therapy, insulin)
const SUBPAGE_LINK_SELECTOR =
  ".nhsuk-hub-key-links__list-item a, a.nhsuk-card__link";

/**
 * Extracts unique sub-page URLs from a hub medicine's HTML without launching a browser.
 * Pure function: testable with string inputs.
 */
export function extractSubpageUrls(
  html: string,
  medicineUrl: string
): string[] {
  const $ = cheerio.load(html);
  const basePath = new URL(medicineUrl).pathname;
  const subUrls: string[] = [];

  $(SUBPAGE_LINK_SELECTOR).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, medicineUrl).href;
      const subPath = new URL(absoluteUrl).pathname;

      // Only this medicine's own pages, e.g. HRT's "Tibolone" card links to /medicines/tibolone/ and is skipped
      if (subPath.startsWith(basePath) && subPath !== basePath) {
        subUrls.push(absoluteUrl);
      }
    } catch {
      // Ignore malformed URLs
    }
  });

  return [...new Set(subUrls)];
}

/**
 * Crawls a medicine page and any linked hub sub-pages.
 */
export async function crawlMedicine(
  page: Page,
  url: string,
  options?: FetchPageOptions
): Promise<CrawledMedicine> {
  const mainHtml = await fetchPage(page, url, options);
  const subUrls = extractSubpageUrls(mainHtml, url);

  const subPages: CrawledPage[] = [];
  for (const subUrl of subUrls) {
    const html = await fetchPage(page, subUrl, options);
    subPages.push({ url: subUrl, html });
  }

  return { url, html: mainHtml, subPages };
}
