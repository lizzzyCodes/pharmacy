import type { Page } from "playwright";
import * as cheerio from "cheerio";
import { fetchPage, type FetchPageOptions } from "./fetchPage";
import {
  MEDICINES_INDEX_URL,
  NHS_BASE_URL,
  isMedicineRootPath,
} from "../shared/urls";
import { cleanText } from "../shared/text";
import type { MedicineLink } from "../shared/types";

export type { MedicineLink };

/**
 * Extracts and filters medicine links from the NHS medicines A-Z index HTML.
 * Pure function: testable without Playwright.
 */
export function parseMedicineIndexHtml(html: string): MedicineLink[] {
  const $ = cheerio.load(html);
  const links: MedicineLink[] = [];

  $("li a").each((_, el) => {
    const name = cleanText($(el).text());
    const href = $(el).attr("href");
    if (!href || !name) return;

    try {
      const parsedUrl = new URL(href, NHS_BASE_URL);
      const isMedicinePage =
        !parsedUrl.hash &&
        isMedicineRootPath(parsedUrl.pathname) &&
        !name.includes(", see ");

      if (isMedicinePage) {
        links.push({ name, url: parsedUrl.href });
      }
    } catch {
      // Ignore invalid URLs
    }
  });

  // Deduplicate by URL
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

/**
 * Fetches the NHS medicines index page and returns all valid medicine links.
 */
export async function getMedicineLinks(
  page: Page,
  options?: FetchPageOptions
): Promise<MedicineLink[]> {
  const html = await fetchPage(page, MEDICINES_INDEX_URL, options);
  return parseMedicineIndexHtml(html);
}
