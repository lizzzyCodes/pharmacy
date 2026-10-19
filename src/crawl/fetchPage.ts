import type { Page } from "playwright";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { SLEEP_TIME } from "./consts";

const CACHE_DIR = path.resolve("cache");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// https://www.nhs.uk/medicines/lansoprazole/about-lansoprazole/
//   → cache/lansoprazole/about-lansoprazole.html
function cachePath(url: string): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean); // ["medicines","lansoprazole","about-lansoprazole"]
  const [, slug, sub] = parts;
  return path.join(CACHE_DIR, slug, `${sub ?? "index"}.html`);
}

export async function fetchPage(page: Page, url: string): Promise<string> {
  const file = cachePath(url);

  try {
    return await readFile(file, "utf8"); // already saved → no network
  } catch {}

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const html = await page.content();

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");

  await sleep(SLEEP_TIME); // be polite: pause between real requests
  return html;
}
