import type { Page } from "playwright";
import { MEDICINES_INDEX_URL } from "./consts";

export type MedicineLink = { name: string; url: string };

export async function getMedicineLinks(page: Page): Promise<MedicineLink[]> {
  await page.goto(MEDICINES_INDEX_URL, { waitUntil: "domcontentloaded" });

  // fetching all elements storing med name and url
  const links = await page.locator("li a").evaluateAll((elements) =>
    elements.map((el) => ({
      name: el.textContent?.trim() ?? "",
      url: (el as HTMLAnchorElement).href,
    }))
  );

  /**
   * A link is kept only if:
    it has no # (not an A–Z jump link), and
    its path is exactly /medicines/<slug>/ (a real medicine page, not nav or a sub-page), and
    its text isn’t a “see …” alias.
   */
  const medicines = links.filter((link) => {
    const { pathname, hash } = new URL(link.url);
    return (
      !hash &&
      /^\/medicines\/[^/]+\/?$/.test(pathname) &&
      !link.name.includes(", see ")
    );
  });
  const allmeds = [...new Map(medicines.map((m) => [m.url, m])).values()];
  console.log(allmeds, "all meds here [ec]");
  return allmeds;
}
