import type { Page } from "playwright";
import { defaultCache, type CacheStorage } from "./cache";
import { DEFAULT_SLEEP_TIME_MS } from "../shared/urls";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type FetchPageOptions = {
  cache?: CacheStorage;
  sleepMs?: number;
};

/**
 * Fetches the HTML of a page using Playwright, backed by cache and polite rate limiting.
 */
export async function fetchPage(
  page: Page,
  url: string,
  options: FetchPageOptions = {}
): Promise<string> {
  const cache = options.cache ?? defaultCache;
  const sleepMs = options.sleepMs ?? DEFAULT_SLEEP_TIME_MS;

  const cached = await cache.get(url);
  if (cached !== null) {
    return cached;
  }

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const html = await page.content();

  await cache.set(url, html);

  if (sleepMs > 0) {
    await sleep(sleepMs);
  }

  return html;
}
