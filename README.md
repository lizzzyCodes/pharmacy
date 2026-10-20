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

The scraper is a **decoupled pipeline** with a strict boundary between network I/O and parsing:

```
                 ┌──────────── CRAWL (Playwright) ────────────┐   ┌──────── PARSE (cheerio) ────────┐
nhs.uk/medicines ─▶ A–Z index ─▶ each medicine ─▶ its sub-pages ─▶ cache/<slug>/*.html ─▶ parse ─▶ assemble ─▶ output/medicines.json
                    (links)       (index.html)    (hub pages only)     (raw HTML on disk)                            │
                                                                                                         npm run verify
```

### Layered separation

1. **Crawl layer (`src/crawl/`)**

   - **Network and I/O only:** browser automation (Playwright), navigation and rate limiting.
   - **Cache abstraction:** behind the `CacheStorage` interface (`FilePageCache` in `src/crawl/cache.ts`). If a page is already cached on disk, no browser navigation or network request happens.
   - **Lightweight link extraction:** `medicinePage.ts` reads sub-page links from the downloaded HTML string with cheerio rather than from the live tab, so a cached page and a freshly downloaded page behave the same.

2. **Parse and domain layer (`src/parse/`)**

   - **Pure functions, no network, no browser:** works on cached HTML strings with cheerio.
   - **Domain assembler:** `medicineBuilder.ts` (`assembleMedicine`) maps sections onto the schema, detects the layout (`hub`, `single`, `group`) and applies fallback summaries, with no disk I/O.
   - **One place for the section taxonomy:** `sectionKeys.ts` holds all classification rules: sub-page slug prefixes, heading patterns, `h2` ids and skip rules.
   - **I/O orchestration:** `buildBundle.ts` reads `cache/`, delegates parsing and assembly, sorts keys alphabetically and writes `output/medicines.json`.

3. **Shared core (`src/shared/`)**
   - **Domain types (`types.ts`):** `Medicine`, `SectionData`, `Block`, `Callout`, `ParsedPage`, shared by both phases.
   - **URL utilities (`urls.ts`):** canonical URL builders that prevent duplicate-slash errors (`medicines//aspirin/`).
   - **Text utilities (`text.ts`):** whitespace and `&nbsp;` normalisation, stripping heading numbers.

### Tool choices

- **Playwright** (recommended in the brief) handles navigation: it opens pages and saves `page.content()`.
- **cheerio** handles parsing. The parser works on cached HTML _strings_, and cheerio parses them in Node without launching a browser. That keeps parsing fast and lets tests run without Chromium.
- **Plain Playwright rather than Crawlee.** At ~250 medicines the queueing, retries and concurrency are small enough to write by hand and show explicitly. For a larger crawl I'd use Crawlee's `PlaywrightCrawler`.
- **Sequential crawl with a delay** between requests. Slower, but polite to a public health site. One browser and one tab are reused for the whole run.

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
    "lastReviewed": "…",               // ISO date; for hubs, the latest date from their sub-pages
    "discontinued": false,
    "sections": {                      // always all 7 keys; null when the page has no such section
      "about":                     { "url": "…", "heading": "About lansoprazole", "content": [ … ], "callouts": [ … ] },
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

**Callouts** are NHS care cards, warning cards and inset boxes, with their urgency kept:

```jsonc
"callouts": [
  { "level": "urgent", "heading": "Call NHS 111 if:", "content": [{ "type": "list", "items": ["…"] }] },
  { "level": "info",   "heading": "Information",      "content": [{ "type": "heading", "text": "Levemir is being discontinued" }, …] }
]
// level: "emergency" (999) | "urgent" (111) | "non-urgent" (pharmacist/GP) | "warning" ("Important") | "info" (inset text)
```

### Shape decisions

- **Flat, not nested.** "Beclometasone inhalers", "…nasal spray" and "…skin cream" are separate entries, because their dosing and side effects differ. Merging them would mix safety information. They share `genericName`, so consumers can group them if they want.
- **A fixed set of section keys.** `sectionKeys.ts` defines the schema. Hub sub-pages, single-page `h2` ids and group-page headings all map onto it, so `med.sections.sideEffects` works for every medicine. Unrecognised sections go into `otherSections` rather than being dropped.
- **`heading` is the section's title on the NHS page** (a hub sub-page's title, or the `h2` on a single page), so mapping to a fixed key doesn't lose the original wording ("Side effects of lansoprazole"). It's `null` for untitled intro text (Ranitidine's withdrawal notice, the Antihistamines intro); titles are never invented. Sub-headings inside a section stay as `heading` blocks in `content`, in page order.
- **Links, not crawled content, for related conditions.** Following `/conditions/…` links would crawl far beyond the medicines section, and those pages link back and forth to each other. They're stored as `{ name, url }`.

---

## Page layouts handled

The 253 medicine pages come in seven layouts. The crawler detects which one each page uses on every run, rather than assuming.

| Layout                   | Count | Example                                | How it's detected / handled                                                                                                                                                                                                                                                                                        |
| ------------------------ | ----: | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hub: key-links list**  |   131 | Lansoprazole, Peppermint oil           | `.nhsuk-hub-key-links__list-item`. Each sub-page becomes a section, keyed by its URL slug (`side-effects-of-…` → `sideEffects`)                                                                                                                                                                                    |
| **Hub: clickable cards** |     2 | HRT, Insulin                           | `a.nhsuk-card__link`. Same as above. Extra pages (types of insulin, HRT products) go to `otherSections`                                                                                                                                                                                                            |
| **Hub: guide**           |     2 | Antibiotics, Anticoagulant medicines   | `a.nhsuk-contents-list__link` ("Pages in this guide"). The overview's own sections are mapped too; a full sub-page (e.g. Side effects) replaces the overview's short summary of it, which moves to `otherSections`. Sub-page names come from `.nhsuk-contents-list__current`, because their `h1` is the guide name |
| **Single page**          |   111 | Rosuvastatin, Warfarin                 | Sections keyed by `h2` id (`#side-effects`, `#what-its-for`, …)                                                                                                                                                                                                                                                    |
| **Group / overview**     |     4 | Antihistamines, Statins                | No `h2` ids and no lede. Mapped by heading text; the intro becomes `summary` and `about`                                                                                                                                                                                                                           |
| **Signpost**             |     1 | Hydrocortisone                         | Ids on `<section>` not `h2`, numbered headings ("1. About…"). Links to the form-specific pages via `relatedMedicines`                                                                                                                                                                                              |
| **Discontinued notice**  |     2 | Hydrocortisone rectal foam, Ranitidine | A single heading-less notice. `discontinued: true`, and the whole notice is kept in `about`                                                                                                                                                                                                                        |

(`verify` reports `pageType` counts as hub 135 / single 111 / group 7. "Group" is a catch-all for pages without standard section ids, so it covers the last three rows; use `discontinued` to tell the notices apart.)

---

## Edge cases handled

**A–Z index**

- Navigation, breadcrumb and `#a`…`#z` jump links are filtered out by URL shape: only `/medicines/<slug>/` is kept.
- **11 alias entries** such as "Tegretol, see Carbamazepine (Tegretol)" point to medicines already in the list and are skipped.
- Duplicate links are de-duplicated by URL.

**Crawling**

- **Three hub styles** are recognised: key-links list, clickable cards and guide contents list.
- Only a medicine's **own** sub-pages are followed (`path.startsWith('/medicines/<slug>/')`). For example, HRT's "Tibolone" card links to a different medicine and is ignored.
- Hubs with **6 sub-pages instead of 7** (Co-codamol for children, Methylphenidate for children) leave the missing section as `null`.
- Duplicate sub-page links (Co-codamol) are de-duplicated.
- Sub-page links are read from the **HTML string**, not the live tab, so a cached page and a freshly downloaded page behave the same.
- One failing medicine doesn't stop the run. Failures are logged and retried on the next run.

**Parsing**

- **Junk excluded:** cookie banner, "Find a pharmacy" buttons, "Page last reviewed" footer, sibling navigation, and "Find out more about your medicine" boilerplate. Content is scoped to `main article`.
- **Screen-reader text removed** from headings and callouts (e.g. "Urgent advice: ").
- **Brand caption removed** from the `h1` ("Lansoprazole - Brand name: Zoton FasTabs" → "Lansoprazole"). Brands come from JSON-LD instead.
- **Guide pages** take the medicine's title from the `h1`'s bottom caption, and each sub-page's own name from the highlighted "Pages in this guide" item.
- **JSON-LD is used for metadata only** (brand names, generic name, review date). It **omits some sections**: Lansoprazole's fertility section and "Tell your doctor" card aren't in it, so content always comes from the DOM.
- **Several `h2`s in one `<section>`** (Co-codamol for children: "Who can take…" and "Who may not be able to take…"): the extra `h2`s are kept as heading blocks. Before this fix they were silently dropped; heading blocks across the bundle went from 4,607 to 5,680.
- **Expandable sections** (`<details>`): the `<summary>` ("Tablets for skin infections") is kept as a heading block, so it's clear which form the text is about (Aciclovir).
- **Inset text boxes** ("If you're told to go to A&E…", "Levemir is being discontinued") become `info` callouts. The title is the box's `h3`, or else its screen-reader label ("Information").
- **Wrapped headings:** Rosuvastatin's "Find out more" `h2` sits inside an inset box and is still recognised as its own section, not merged into the previous one.
- **Card titles aren't duplicated:** the "Important" warning card keeps its title only in `callout.heading`.
- **Intro text with no heading** is kept whole as `about` (Ranitidine's 3-paragraph notice), not cut down to the one-line summary. A real "What X is for" section replaces it.
- **Repeated section keys:** when two sections map to the same key, the first wins and the second goes to `otherSections`. Nothing is overwritten.
- **Empty `id=""`** attributes become `null`. `&nbsp;` and whitespace are normalised.
- **Heading text mapping** checks "Taking X **with other medicines**" (→ `interactions`) before "how to **take**" (→ `howAndWhenToTake`).
- **Discontinued detection** matches "discontinued", "withdrawn" and "not currently / no longer available" (Ranitidine uses the last of these).
- **Single-page pregnancy info** is an `h3` inside "Who can and cannot take", so on single pages it lives under `whoCanAndCannotTake` and `pregnancyAndBreastfeeding` is `null`.
- **Hub related links use different markup:** the heading is wrapped in `div.beta-hub-related-links-title`, so the list is found after the wrapper. HRT's single "Related information" box is split by URL: NHS `/conditions/` pages → `relatedConditions`, everything else → `usefulResources`.
- **Hub review dates:** hub main pages have no `lastReviewed` in their JSON-LD, so the most recent date from their sub-pages is used.

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

**`npm test`** runs the automated test suite in a few seconds via the Playwright test runner:

- **Edge-case tests** (`tests/edgecases.spec.ts`): one test per edge case above, against real NHS HTML saved in `tests/fixtures/<slug>/`: inset callouts, expanders, multi-`h2` sections, boilerplate skipping, discontinued detection, hub link extraction (HRT's Tibolone excluded, duplicates removed), and guide pages (Antibiotics).
- **Medicine assembler tests** (`tests/medicineBuilder.spec.ts`): pure domain logic for single, hub and group medicines: section mapping, `otherSections`, intro handling, `when-to-take` sub-pages, and metadata.
- **HTML parser tests** (`tests/parser.spec.ts`): section extraction, callout urgency, JSON-LD metadata and guide-style bottom captions.
- **Section taxonomy tests** (`tests/sectionKeys.spec.ts`): slug prefixes, heading patterns, `h2` id lookups and skip rules.
- **URL and cache utility tests** (`tests/urls.spec.ts`, `tests/cache.spec.ts`): URL building (no duplicate slashes), path parsing and cache paths.
- **Integration tests** (`tests/integration.spec.ts`): the bundle builder against real cached HTML (`aspirin`, `lansoprazole`, `antihistamines`).

**Why fixtures, not `cache/`?** `cache/` is gitignored and changes whenever the NHS does. Fixtures are a frozen copy of the few pages the tests need, committed so `npm test` passes on a fresh clone with no network, and a site change can't break a test that was passing.

**`npm run typecheck`** runs `tsc --noEmit` across the project.

---

## Selector strategy

Selectors prefer, in order: **semantic HTML** (`main`, `article`, `section`, `h1`/`h2`), **schema.org JSON-LD**, **content ids** (`#side-effects`) and **URL patterns** (`/medicines/<slug>/`). Where nothing semantic exists, such as the urgency of a care card or which links are hub sub-pages, they use **NHS.UK design-system component classes** (`.nhsuk-card--care--urgent`, `.nhsuk-contents-list__link`). Those come from a versioned design system shared across the site. No layout classes, `nth-child` or XPath are used.

Playwright's `getByRole`/`getByText` advice targets testing your own UI. For scraping someone else's site, text is the most likely thing to change (content is reviewed every few years), while roles and semantic structure are protected by UK public-sector accessibility requirements.

---

## Known limitations

- **Nested hubs (HRT, Insulin):** product pages such as "Long-acting insulin" or "Combined HRT" are hubs themselves. The crawler goes one level deep, so their `otherSections` entries contain only the list of their sub-page names, not the sub-pages' content. Fix: a recursive crawl, depth 2, de-duplicated by URL, with products stored in their own nested map.
- **Tables** (≈4 pages) are flattened into text blocks rather than stored as rows and columns.
- **Single-page medicines** keep pregnancy/breastfeeding info under `whoCanAndCannotTake` rather than splitting it into `pregnancyAndBreastfeeding`.
- **`pageType: "group"` is a catch-all** for pages without standard section ids (overviews, the signpost page, discontinued notices).
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

- Scanned all medicine pages to compare structure, then worked through real HTML for each layout: hub (Lansoprazole), single page (Rosuvastatin), group (Antihistamines), signpost (Hydrocortisone), discontinued (Hydrocortisone rectal foam, Ranitidine), card hub (HRT, Insulin) and guide (Antibiotics).
- Noticed live site changes between runs (a new medicine; Lorazepam changing from a hub to a single page).

**Data shape**

- Chose a flat bundle with a fixed set of 7 section keys, plus `otherSections` for anything unrecognised.
- Kept related forms of a drug separate, linked by `genericName`, rather than nesting them.
- Used schema.org JSON-LD for metadata only, after finding it omits some content sections.

**Parser, tests & verification**

- Built the cheerio parser and bundle builder, fixing issues as each new fixture exposed them: ids on `<section>`, numbered headings, wrapped `h2`s, duplicated card titles, empty ids, and "not currently available" wording.
- I checked the bundle against the live NHS pages in a browser, medicine by medicine. Each mismatch I found (missing inset boxes and expander titles, dropped Co-codamol headings, guide pages treated as group pages, empty related links on hubs) became a fix plus an edge-case test.
- Wrote parser and bundle tests against saved fixtures (no browser needed) and a `verify` script for the real bundle.
- Debugged a build script that pointed at a module which defined `buildBundle()` but never called it.

**Selector strategy & write-up**

- Discussed Playwright's `getByRole`/`getByText` guidance versus scraping a third-party site, and settled on semantic HTML, JSON-LD, ids and URL patterns first.

## Attribution

Medicine content © Crown copyright, from [nhs.uk](https://www.nhs.uk/medicines/). Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
This dataset is for a technical exercise and is **not medical advice**. Always check the NHS website or speak to a pharmacist or doctor.
