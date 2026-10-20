# NHS Medicines → JSON bundle

Crawls the [NHS medicines A–Z](https://www.nhs.uk/medicines/) and turns every medicine page into one JSON bundle: a map whose keys are medicine names and whose values are structured details about that medicine.

**Output:** [`output/medicines.json`](output/medicines.json): 253 medicines, crawled 19 October 2026.

---

## Quick start

```bash
npm install
npx playwright install chromium   # one-time browser download

npm start          # crawl (cache-aware) + build output/medicines.json
npm run verify     # sanity-check the bundle
npm test           # parser tests (offline, against saved HTML)
```

The first crawl downloads ~1,190 pages with a polite delay between requests, so it takes 15–20 minutes. Later runs read from `cache/` and finish in seconds.

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `npm start`         | `crawl` then `bundle`                                                |
| `npm run crawl`     | Fetch every medicine page into `cache/` (skips pages already cached) |
| `npm run bundle`    | Parse `cache/` → `output/medicines.json` (no browser, no network)    |
| `npm run verify`    | Run sanity checks on the bundle; exits non-zero if any fail          |
| `npm test`          | Playwright test runner: parser tests on fixtures + a live smoke test |
| `npm run typecheck` | `tsc --noEmit`                                                       |
| `LIMIT=5 npm start` | Only crawl the first 5 medicines (quick check)                       |

---

## Architecture

The scraper is designed around a **clean, decoupled pipeline** with a strict boundary between network I/O and domain parsing:

```
                 ┌──────────── CRAWL (Playwright) ────────────┐   ┌──────── PARSE (cheerio) ────────┐
nhs.uk/medicines ─▶ A–Z index ─▶ each medicine ─▶ its sub-pages ─▶ cache/<slug>/*.html ─▶ parse ─▶ assemble ─▶ output/medicines.json
                    (links)       (index.html)    (hub pages only)     (raw HTML on disk)                            │
                                                                                                         npm run verify
```

### Layered Separation

1. **Crawl Layer (`src/crawl/`)**:

   - **Network & I/O Only**: Responsible solely for browser automation (Playwright), network navigation, and rate limiting.
   - **Cache Storage Abstraction**: Decoupled behind the `CacheStorage` interface (`FilePageCache` in `src/crawl/cache.ts`). If a page is already cached on disk, no browser navigation or network request occurs.
   - **Lightweight Extraction**: Instead of slow browser DOM evaluations across tabs, `medicinePage.ts` uses Cheerio in memory to extract sub-page links from the downloaded HTML string.

2. **Parse & Domain Layer (`src/parse/`)**:

   - **Pure Functions, Zero Network, Zero Browser**: Works strictly on cached HTML strings using `cheerio`. Launches no browser and makes zero network calls.
   - **Pure Domain Assembler**: `medicineBuilder.ts` contains the core business logic (`assembleMedicine`), merging sections, detecting layouts (`hub`, `single`, `group`), and applying fallback summaries without performing any disk I/O.
   - **Single Source of Truth for Section Taxonomy**: `sectionKeys.ts` centralizes all classification rules (sub-page URL slug prefixes, heading regex patterns, `h2` IDs, and skip rules) in one place.
   - **I/O Orchestration**: `buildBundle.ts` reads the `cache/` directory, delegates parsing and domain assembly, sorts keys alphabetically, and writes `output/medicines.json`.

3. **Shared Core (`src/shared/`)**:
   - **Domain Types (`types.ts`)**: Central schema definitions (`Medicine`, `SectionData`, `Block`, `Callout`, `ParsedPage`, etc.) shared across both crawl and parse phases.
   - **Safe URL Utilities (`urls.ts`)**: Canonical URL builders and path parsers that prevent duplicate-slash errors (e.g. `medicines//aspirin/`) and validate route patterns.
   - **Text Utilities (`text.ts`)**: Reusable string cleaners for collapsing whitespace, normalizing `&nbsp;`, and stripping leading heading numbers.

### Tool choices

- **Playwright** (recommended in the brief) handles navigation: it opens pages and saves `page.content()`.
- **cheerio** handles parsing. The parser works on cached HTML _strings_, and cheerio parses them in Node without launching a browser. That keeps parsing fast and lets tests run without Chromium.
- **Plain Playwright rather than Crawlee.** At ~250 medicines the queueing, retries and concurrency are small enough to write by hand and show explicitly. For a larger crawl I'd use Crawlee's `PlaywrightCrawler`.
- **Sequential crawl with a delay** between requests. It is slower but polite to a public health site. One browser and one tab are reused for the whole run.

---

## Bundle shape

The bundle is a **flat map** of medicine name to details, sorted alphabetically. Every medicine has **the same shape**, whatever layout its NHS page uses.

```jsonc
{
  "Lansoprazole": {
    "slug": "lansoprazole",
    "url": "https://www.nhs.uk/medicines/lansoprazole/",
    "pageType": "hub",                 // "hub" | "single" | "group"
    "genericName": "Lansoprazole",     // from schema.org JSON-LD; links different forms of one drug
    "brandNames": ["Zoton FasTabs"],
    "summary": "Find out how lansoprazole treats heartburn, acid reflux and stomach ulcers…",
    "lastReviewed": null,
    "discontinued": false,
    "sections": {                      // always all 7 keys; null when the page has no such section
      "about":                     { "url": "…", "content": [ … ], "callouts": [ … ] },
      "whoCanAndCannotTake":       { … },
      "howAndWhenToTake":          { … },
      "sideEffects":               { … },
      "pregnancyAndBreastfeeding": { … },
      "interactions":              { … },
      "commonQuestions":           { … }
    },
    "otherSections": { },              // anything that didn't map to a standard key (kept, not dropped)
    "relatedConditions": [],
    "usefulResources":   [],
    "relatedMedicines":  []
  }
}
```

**Content blocks** keep the page's structure instead of flattening it to text:

```jsonc
"content": [
  { "type": "heading",   "text": "Common side effects" },
  { "type": "paragraph", "text": "These common side effects happen in more than 1 in 100 people…" },
  { "type": "list",      "items": ["headaches", "feeling sick", "diarrhoea"] }
]
```

**Callouts** are NHS care cards, with their urgency kept:

```jsonc
"callouts": [
  { "level": "urgent", "heading": "Call NHS 111 if:", "content": [{ "type": "list", "items": ["…"] }] }
]
// level: "emergency" (999) | "urgent" (111) | "non-urgent" (pharmacist/GP) | "warning" ("Important") | "info"
```

### Shape decisions

- **Flat, not nested.** "Beclometasone inhalers", "…nasal spray" and "…skin cream" are separate entries, because their dosing and side effects differ. Merging them would mix safety information. They share `genericName`, so consumers can group them if they want.
- **A fixed set of section keys.** `sectionKeys.ts` defines the schema. Hub sub-pages, single-page `h2` ids and group-page headings all map onto it, so `med.sections.sideEffects` works for every medicine. Unrecognised sections go into `otherSections` rather than being dropped.
- **Links, not crawled content, for related conditions.** Following `/conditions/…` links would crawl far beyond the medicines section, and those pages link back and forth to each other. They're stored as `{ name, url }`.

---

## Page layouts handled

The 253 medicine pages come in six layouts. The crawler detects which one each page uses on every run, rather than assuming.

| Layout                   | Count | Example                                | How it's detected / handled                                                                                                     |
| ------------------------ | ----: | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Hub: key-links list**  |   131 | Lansoprazole, Peppermint oil           | `.nhsuk-hub-key-links__list-item`. Each sub-page becomes a section, keyed by its URL slug (`side-effects-of-…` → `sideEffects`) |
| **Hub: clickable cards** |     2 | HRT, Insulin                           | `a.nhsuk-card__link`. Same as above. Extra pages (types of insulin, HRT products) go to `otherSections`                         |
| **Single page**          |   111 | Rosuvastatin, Warfarin                 | Sections keyed by `h2` id (`#side-effects`, `#what-its-for`, …)                                                                 |
| **Group / overview**     |     6 | Antihistamines, Antibiotics, Statins   | No `h2` ids and no lede. Mapped by heading text; the intro paragraph becomes `summary` and `about`                              |
| **Signpost**             |     1 | Hydrocortisone                         | Ids on `<section>` not `h2`, numbered headings ("1. About…"). Links to the form-specific pages via `relatedMedicines`           |
| **Discontinued notice**  |     2 | Hydrocortisone rectal foam, Ranitidine | A single heading-less notice. `discontinued: true`, and the notice is kept in `about`                                           |

(`verify` reports `pageType` counts as hub 133 / single 111 / group 9; "group" covers the last three rows.)

---

## Edge cases handled

**A–Z index**

- Navigation, breadcrumb and `#a`…`#z` jump links are filtered out by URL shape: only `/medicines/<slug>/` is kept.
- **11 alias entries** such as "Tegretol, see Carbamazepine (Tegretol)" point to medicines already in the list and are skipped.
- Duplicate links are de-duplicated by URL.
- **Hub related links use different markup:** the heading is wrapped in `div.beta-hub-related-links-title`, so the list is found after the wrapper. HRT's single "Related information" box is split by URL: NHS `/conditions/` pages → `relatedConditions`, everything else → `usefulResources`.
- **Hub review dates:** hub main pages have no `lastReviewed` in their JSON-LD, so the most recent date from their sub-pages is used.

**Crawling**

- Only a medicine's **own** sub-pages are followed (`path.startsWith('/medicines/<slug>/')`). For example, HRT's "Tibolone" card links to a different medicine and is ignored.
- Hubs with **6 sub-pages instead of 7** (Co-codamol for children, Methylphenidate for children) leave the missing section as `null`.
- Duplicate sub-page links (Co-codamol) are de-duplicated.
- Sub-page links are read from the **HTML string**, not the live tab, so a cached page and a freshly downloaded page behave the same.
- One failing medicine doesn't stop the run. Failures are logged and retried on the next run.

**Parsing**

- **Junk excluded:** cookie banner, "Find a pharmacy" buttons, "Page last reviewed" footer, sibling navigation, and "Find out more about your medicine" boilerplate. Content is scoped to `main article`.
- **Screen-reader text removed** from headings and callouts (e.g. "Urgent advice: ").
- **Brand caption removed** from the `h1` ("Lansoprazole - Brand name: Zoton FasTabs" → "Lansoprazole"). Brands come from JSON-LD instead.
- **Guide-style pages** (e.g. Antibiotics) take their title from the `h1`'s bottom caption.
- **JSON-LD is used for metadata only** (brand names, generic name, review date). It **omits some sections**: Lansoprazole's fertility section and "Tell your doctor" card aren't in it, so content always comes from the DOM.
- **Wrapped headings:** Rosuvastatin's "Find out more" `h2` sits inside an inset box and is still recognised as its own section, not merged into the previous one.
- **Card titles aren't duplicated:** the "Important" warning card keeps its title only in `callout.heading`.
- **Empty `id=""`** attributes become `null`. `&nbsp;` and whitespace are normalised.
- **Heading text mapping** checks "Taking X **with other medicines**" (→ `interactions`) before "how to **take**" (→ `howAndWhenToTake`).
- **Discontinued detection** matches "discontinued", "withdrawn" and "not currently / no longer available" (Ranitidine uses the last of these).
- **Single-page pregnancy info** is an `h3` inside "Who can and cannot take", so on single pages it lives under `whoCanAndCannotTake` and `pregnancyAndBreastfeeding` is `null`.

**Site changes between runs.** Between 17 and 19 Oct 2026 one medicine was added (252 → 253) and **Lorazepam changed from a hub to a single page**. Page type is detected per run, so no code changes were needed.

---

## Verification & testing

**`npm run verify`** checks the real bundle after every build:

```
✅ at least 240 medicines — found 253
✅ every medicine has all 7 section keys
✅ every medicine has a name
✅ no non-discontinued medicine is completely empty
✅ ≥85% have a sideEffects section — 249/253 (98%)
✅ almost all have a summary — missing: Hydrocortisone
✅ no "Cookies on the NHS website" / "Find a pharmacy" / "Page last reviewed" in content
   discontinued: Hydrocortisone rectal foam, Ranitidine
   no sideEffects (2): Hydrocortisone, Insulin    ← expected: signpost page / card hub without a side-effects page
```

**`npm test`** runs the automated test suite (60 tests in ~2s via Playwright):

- **HTML parser tests** (`tests/parser.spec.ts`): Semantic section extraction, callout card urgency, schema.org JSON-LD metadata, discontinued medicine detection, and guide-style bottom captions.
- **Medicine assembler tests** (`tests/medicineBuilder.spec.ts`): Pure domain logic assembling single-page, hub-page, and group-page medicines, with fallback summary handling.
- **Section taxonomy tests** (`tests/sectionKeys.spec.ts`): Sub-page slug prefixes, heading regex patterns, `h2` ID lookups, and boilerplate ignore rules.
- **URL & cache utility tests** (`tests/urls.spec.ts`, `tests/cache.spec.ts`): Clean URL generation (no duplicate slashes), absolute URL resolution, path parsing, and cache directory path resolution.
- **Integration tests** (`tests/integration.spec.ts`): End-to-end bundling verification executing `buildMedicine` against real cached HTML (`aspirin`, `lansoprazole`, `antihistamines`).

**`npm run typecheck`** runs `tsc --noEmit` to verify type safety across the entire project.

---

## Selector strategy

Selectors prefer, in order: **semantic HTML** (`main`, `article`, `section`, `h1`/`h2`), **schema.org JSON-LD**, **content ids** (`#side-effects`) and **URL patterns** (`/medicines/<slug>/`). Where nothing semantic exists, such as the urgency of a care card, they use **NHS.UK design-system component classes** (`.nhsuk-card--care--urgent`). Those come from a versioned design system shared across the site. No layout classes, `nth-child` or XPath are used.

Playwright's `getByRole`/`getByText` advice targets testing your own UI. For scraping someone else's site, text is the most likely thing to change (content is reviewed every few years), while roles and semantic structure are protected by UK public-sector accessibility requirements.

---

## Known limitations

- **Tables** (≈4 pages) are flattened into text blocks rather than stored as rows and columns.
- **Single-page medicines** keep pregnancy/breastfeeding info under `whoCanAndCannotTake` rather than splitting it into `pregnancyAndBreastfeeding`.
- **Related conditions are links only**; condition pages aren't crawled.
- **Counts reflect the crawl date.** The NHS updates pages continuously.
- Bundle keys come from each page's `h1` (e.g. "Aciclovir"), not the A–Z link text ("Aciclovir (Zovirax)"). Brands are in `brandNames`.

## If this ran daily

- **Layered selectors with fallbacks** (already used for section ids: `h2` id → `section` id → heading text → `otherSections`). For callout urgency, also read the accessible label ("Urgent advice:") before falling back to the class.
- **Fail loudly:** run `verify` after each build and alert on failure, so the scraper never silently produces worse data.
- **Diff against the previous run:** flag changes like "Lorazepam: 7 sub-pages → 0" for review.
- **Re-fetch on a schedule** using each page's `lastReviewed` / `dateModified` instead of re-crawling everything.
- **Bounded concurrency** (e.g. `p-limit`, 2–3 tabs) and retry with backoff.

---

## How AI was used

I used Claude (an AI assistant) as a pair-programmer and reviewer throughout the project.

**Planning & architecture**

- Chose TypeScript + Playwright, and a **crawl → cache → parse → bundle** pipeline so parsing runs offline and is testable.
- Weighed trade-offs: crawl-then-parse vs inline parsing, cheerio vs in-browser `$$eval`, plain Playwright vs Crawlee, sequential vs concurrent crawling.

**Crawler**

- Built the A–Z link filter (no `#` jump links, nav links or ", see" aliases), a cache-first `fetchPage`, and `crawlMedicine`, which follows only a medicine's own sub-pages.
- Fixed a cache-hit bug where sub-page links were read from the live tab instead of the saved HTML.

**Investigating the site**

- Scanned all medicine pages to compare structure, then worked through real HTML for each layout: hub (Lansoprazole), single page (Rosuvastatin), group (Antihistamines), signpost (Hydrocortisone), discontinued (Hydrocortisone rectal foam, Ranitidine) and card hub (HRT, Insulin).
- Noticed live site changes between runs (a new medicine; Lorazepam changing from a hub to a single page).

**Data shape**

- Chose a flat bundle with a fixed set of 7 section keys, plus `otherSections` for anything unrecognised.
- Kept related forms of a drug separate, linked by `genericName`, rather than nesting them.
- Used schema.org JSON-LD for metadata only, after finding it omits some content sections.

**Parser, tests & verification**

- Built the cheerio parser and bundle builder, fixing issues as each new fixture exposed them: ids on `<section>`, numbered headings, wrapped `h2`s, duplicated card titles, empty ids, and "not currently available" wording.
- Wrote parser and bundle tests against saved fixtures (no browser needed) and a `verify` script for the real bundle.
- Debugged a build script that pointed at a module which defined `buildBundle()` but never called it.

**Selector strategy & write-up**

- Discussed Playwright's `getByRole`/`getByText` guidance versus scraping a third-party site, and settled on semantic HTML, JSON-LD, ids and URL patterns first.

## Attribution

Medicine content © Crown copyright, from [nhs.uk](https://www.nhs.uk/medicines/). Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
This dataset is for a technical exercise and is **not medical advice**. Always check the NHS website or speak to a pharmacist or doctor.
