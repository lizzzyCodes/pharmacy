import { chromium, type Browser } from "playwright";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { crawlMedicine } from "./medicinePage";
import { getMedicineLinks } from "./indexPage";
import type { MedicineLink } from "../shared/types";

export type CrawlerOptions = {
  limit?: number;
  outputFile?: string;
  failuresFile?: string;
};

export type CrawledManifest = Record<
  string,
  { url: string; subPages: string[] }
>;

export type CrawlFailure = {
  name: string;
  url: string;
  error: string;
};

export async function crawlAllMedicines(
  options: CrawlerOptions = {}
): Promise<{ manifest: CrawledManifest; failures: CrawlFailure[] }> {
  const limit = options.limit ?? (Number(process.env.LIMIT) || Infinity);
  const outputFile =
    options.outputFile ?? path.resolve("output/crawled-manifest.json");
  const failuresFile =
    options.failuresFile ?? path.resolve("output/crawled-failures.json");

  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    const allMedicines: MedicineLink[] = await getMedicineLinks(page);
    const medicines = allMedicines.slice(0, limit);
    console.log(`Found ${medicines.length} medicines to crawl`);

    const manifest: CrawledManifest = {};
    const failures: CrawlFailure[] = [];

    for (const [index, med] of medicines.entries()) {
      const progress = `[${index + 1}/${medicines.length}]`;
      try {
        const result = await crawlMedicine(page, med.url);
        manifest[med.name] = {
          url: result.url,
          subPages: result.subPages.map((s) => s.url),
        };
        console.log(
          `${progress} ${med.name}: main page + ${result.subPages.length} sub-pages`
        );
      } catch (err: unknown) {
        const errorMessage = (err as Error).message;
        failures.push({
          name: med.name,
          url: med.url,
          error: errorMessage,
        });
        console.warn(`${progress} FAILED ${med.name}: ${errorMessage}`);
      }
    }

    if (outputFile) {
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, JSON.stringify(manifest, null, 2), "utf8");
    }

    if (failures.length && failuresFile) {
      await mkdir(path.dirname(failuresFile), { recursive: true });
      await writeFile(failuresFile, JSON.stringify(failures, null, 2), "utf8");
    }

    console.log(
      `Done: ${Object.keys(manifest).length} saved to ${outputFile}, ${failures.length
      } failed`
    );

    return { manifest, failures };
  } finally {
    await browser.close();
  }
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith("crawl/index.ts")) {
  crawlAllMedicines().catch((err) => {
    console.error("Crawler failed:", err);
    process.exit(1);
  });
}
