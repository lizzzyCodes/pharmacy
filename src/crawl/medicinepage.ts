import type { Page } from "playwright";
import { fetchPage } from "./fetchPage";

export type CrawledPage = { url: string; html: string };
export type CrawledMedicine = CrawledPage & { subPages: CrawledPage[] };

export async function crawlMedicine(
  page: Page,
  url: string
): Promise<CrawledMedicine> {
  const mainHtml = await fetchPage(page, url);

  // Make sure the tab shows THIS medicine, even if mainHtml came from the cache.
  // Block network requests while we do it so the page's scripts, CSS and images don't load.
  await page.route("**/*", (route) => route.abort());
  await page.setContent(mainHtml, { waitUntil: "domcontentloaded" });
  await page.unroute("**/*");

  // Sub-page links on the hub (empty for single-page medicines like rosuvastatin)
  const hrefs = await page
    .locator(".nhsuk-hub-key-links__list-item a")
    .evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));

  const base = new URL(url).pathname;
  const uniqueSubUrls = [...new Set(hrefs.map((h) => new URL(h, url).href))] // relative → absolute
    .filter((subUrl) => {
      const path = new URL(subUrl).pathname;
      return path.startsWith(base) && path !== base;
    });

  const subPages: CrawledPage[] = [];
  for (const subUrl of uniqueSubUrls) {
    subPages.push({ url: subUrl, html: await fetchPage(page, subUrl) });
  }

  return { url, html: mainHtml, subPages };
}
