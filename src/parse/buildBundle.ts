import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { parsePage } from "./parser";
import {
  assembleMedicine,
  createEmptySections,
  mergeSections,
  extractIntroParagraph,
  type SubPageInput,
} from "./medicineBuilder";
import type { Bundle, Medicine, SectionData } from "../shared/types";

export type { SectionData, Medicine, Bundle };
export const emptySections = createEmptySections;
export const merge = mergeSections;
export const introText = extractIntroParagraph;

export type BuildMedicineResult = {
  name: string;
  medicine: Medicine;
};

/**
 * Builds a single Medicine object by reading its cached HTML files.
 */
export async function buildMedicine(
  cacheDir: string,
  slug: string
): Promise<BuildMedicineResult> {
  const dir = path.join(cacheDir, slug);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".html"));

  if (!files.includes("index.html")) {
    throw new Error(`Missing index.html for medicine "${slug}"`);
  }

  const mainHtml = await readFile(path.join(dir, "index.html"), "utf8");
  const mainPage = parsePage(mainHtml);

  const subFiles = files.filter((f) => f !== "index.html").sort();
  const subPages: SubPageInput[] = [];

  for (const file of subFiles) {
    const subSlug = file.replace(/\.html$/, "");
    const subHtml = await readFile(path.join(dir, file), "utf8");
    const parsedSubPage = parsePage(subHtml);
    subPages.push({ subSlug, page: parsedSubPage });
  }

  return assembleMedicine(slug, mainPage, subPages);
}

export type BuildOptions = {
  cacheDir?: string;
  outputFile?: string | null;
};

export type BuildFailure = {
  slug: string;
  error: string;
};

export type BuildBundleResult = {
  bundle: Bundle;
  failures: BuildFailure[];
};

/**
 * Builds the complete medicine bundle by reading all cached directories.
 */
export async function buildBundle({
  cacheDir = path.resolve("cache"),
  outputFile = path.resolve("output/medicines.json"),
}: BuildOptions = {}): Promise<BuildBundleResult> {
  const entries = await readdir(cacheDir, { withFileTypes: true });
  const slugs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const bundle: Bundle = {};
  const failures: BuildFailure[] = [];

  for (const slug of slugs) {
    try {
      const { name, medicine } = await buildMedicine(cacheDir, slug);
      if (bundle[name]) {
        throw new Error(`Duplicate name "${name}" (also in ${bundle[name].slug})`);
      }
      bundle[name] = medicine;
    } catch (err: unknown) {
      failures.push({ slug, error: (err as Error).message });
    }
  }

  // Sort medicine names alphabetically for deterministic outputs
  const sortedBundle: Bundle = Object.fromEntries(
    Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))
  );

  if (outputFile) {
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, JSON.stringify(sortedBundle, null, 2), "utf8");
    console.log(
      `Wrote ${Object.keys(sortedBundle).length} medicines to ${outputFile}`
    );
    if (failures.length) {
      console.warn(`Failed (${failures.length}):`, failures);
    }
  }

  return { bundle: sortedBundle, failures };
}
