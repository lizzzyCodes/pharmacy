// Sanity-check output/medicines.json after a run.
// Usage: npm run verify            (exits with code 1 if any check fails)

import { readFileSync } from "fs";
import { ALL_KEYS } from "./parse/sectionKeys";
import type { Bundle } from "./parse/buildBundle";

const FILE = process.argv[2] ?? "output/medicines.json";
const MIN_MEDICINES = Number(process.env.MIN_MEDICINES ?? 240); // ~253 on 19 Oct 2026

const bundle: Bundle = JSON.parse(readFileSync(FILE, "utf8"));
const meds = Object.entries(bundle);
let failed = 0;

function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

// --- overall ---
check(
  meds.length >= MIN_MEDICINES,
  `at least ${MIN_MEDICINES} medicines`,
  `found ${meds.length}`
);

const byType = meds.reduce<Record<string, number>>(
  (acc, [, m]) => ((acc[m.pageType] = (acc[m.pageType] ?? 0) + 1), acc),
  {}
);
console.log("   page types:", byType);

// --- shape: every medicine has every key ---
const badShape = meds
  .filter(([, m]) => ALL_KEYS.some((k) => !(k in m.sections)))
  .map(([n]) => n);
check(
  badShape.length === 0,
  "every medicine has all 7 section keys",
  badShape.join(", ")
);

const noTitle = meds.filter(([n]) => !n.trim()).length;
check(noTitle === 0, "every medicine has a name");

// --- content: most medicines have real content ---
const empty = meds
  .filter(
    ([, m]) =>
      !m.discontinued &&
      Object.values(m.sections).every((s) => s === null) &&
      Object.keys(m.otherSections).length === 0
  )
  .map(([n]) => n);
check(
  empty.length === 0,
  "no non-discontinued medicine is completely empty",
  empty.join(", ")
);

const withSideEffects = meds.filter(([, m]) => m.sections.sideEffects).length;
const pct = Math.round((withSideEffects / meds.length) * 100);
check(
  pct >= 85,
  "≥85% have a sideEffects section",
  `${withSideEffects}/${meds.length} (${pct}%)`
);

const noSummary = meds.filter(([, m]) => !m.summary).map(([n]) => n);
check(
  noSummary.length <= 5,
  "almost all have a summary",
  noSummary.length ? `missing: ${noSummary.join(", ")}` : ""
);

// --- junk that should never leak in ---
const text = JSON.stringify(bundle);
for (const junk of [
  "Cookies on the NHS website",
  "Find a pharmacy",
  "Page last reviewed",
]) {
  check(!text.includes(junk), `no "${junk}" in content`);
}

// --- informational ---
const discontinued = meds.filter(([, m]) => m.discontinued).map(([n]) => n);
console.log(
  "   discontinued:",
  discontinued.length ? discontinued.join(", ") : "none"
);
const missingSideEffects = meds
  .filter(([, m]) => !m.sections.sideEffects && !m.discontinued)
  .map(([n]) => n);
console.log(
  `   no sideEffects (${missingSideEffects.length}):`,
  missingSideEffects.join(", ")
);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
