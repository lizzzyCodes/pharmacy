import { chromium } from "playwright";
import { mkdir, writeFile } from "fs/promises";
import { crawlMedicine } from "./medicinepage";
import { getMedicineLinks } from "./indexPage"; // adjust the path to wherever yours lives

// While testing: LIMIT=5 npm start  → only the first 5 medicines
const LIMIT = Number(process.env.LIMIT) || Infinity;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. Every medicine on https://www.nhs.uk/medicines/
  const medicines = (await getMedicineLinks(page)).slice(0, LIMIT);
  console.log(`Found ${medicines.length} medicines`);

  // 2. Collect results in memory
  const bundle: Record<string, { url: string; subPages: string[] }> = {};
  const failures: { name: string; url: string; error: string }[] = [];

  for (const [i, med] of medicines.entries()) {
    const progress = `[${i + 1}/${medicines.length}]`;
    try {
      const result = await crawlMedicine(page, med.url);
      bundle[med.name] = {
        url: result.url,
        subPages: result.subPages.map((s) => s.url),
      };
      console.log(
        `${progress} ${med.name}: main page + ${result.subPages.length} sub-pages`
      );
    } catch (err) {
      failures.push({
        name: med.name,
        url: med.url,
        error: (err as Error).message,
      });
      console.warn(`${progress} FAILED ${med.name}: ${(err as Error).message}`);
    }
  }

  await browser.close();

  // 3. Write once, at the end
  await mkdir("output", { recursive: true });
  await writeFile("output/medicines.json", JSON.stringify(bundle, null, 2));
  if (failures.length) {
    await writeFile("output/failures.json", JSON.stringify(failures, null, 2));
  }

  console.log(
    `Done: ${Object.keys(bundle).length} saved, ${failures.length} failed`
  );
}

main();
