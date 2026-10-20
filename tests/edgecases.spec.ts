// Edge cases found by comparing medicines.json with the real NHS pages.
// Runs offline: inline HTML snippets + saved pages in tests/fixtures/. No browser is launched.

import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { parsePage } from "../src/parse/parser";
import { assembleMedicine } from "../src/parse/medicineBuilder";
import { extractSubpageUrls } from "../src/crawl/medicinePage";

const FIXTURES = path.resolve(__dirname, "fixtures");
const fixture = (p: string) => readFileSync(path.join(FIXTURES, p), "utf8");

/** Wrap a snippet in the minimum page structure the parser expects. */
const page = (body: string, head = "") =>
  `<html><head>${head}</head><body><main><h1>Test medicine</h1><article>${body}</article></main></body></html>`;

// ---------------------------------------------------------------------------
// Inset text boxes → `info` callouts
// ---------------------------------------------------------------------------

test.describe("inset text", () => {
  const html = page(`
    <section>
      <h2 id="how-its-used-previously-dosage-and-administration">How to use aciclovir</h2>
      <p>Taking an extra aciclovir tablet is unlikely to cause problems.</p>
      <div class="nhsuk-inset-text">
        <span class="nhsuk-u-visually-hidden">Information: </span>
        <p>If you're told to go to A&amp;E, do not drive. Ask someone to drive you or call 999.</p>
        <p>Bring the aciclovir packet or leaflet inside it.</p>
      </div>
    </section>
    <section>
      <h2 id="side-effects">Side effects of aciclovir</h2>
      <p>Like all medicines, aciclovir can cause side effects.</p>
      <div class="nhsuk-inset-text">
        <span class="nhsuk-u-visually-hidden">Information: </span>
        <h3>More about side effects</h3>
        <p>These are not all the side effects of aciclovir.</p>
      </div>
    </section>`);

  test("becomes an info callout and is removed from the normal text", () => {
    const howTo = parsePage(html).sections[0];

    expect(howTo.callouts).toEqual([
      {
        level: "info",
        heading: "Information", // from the screen-reader label, colon removed
        content: [
          {
            type: "paragraph",
            text: "If you're told to go to A&E, do not drive. Ask someone to drive you or call 999.",
          },
          {
            type: "paragraph",
            text: "Bring the aciclovir packet or leaflet inside it.",
          },
        ],
      },
    ]);
    // the A&E advice must not also appear in the dosage text
    expect(JSON.stringify(howTo.content)).not.toContain("A&E");
    expect(howTo.content).toEqual([
      {
        type: "paragraph",
        text: "Taking an extra aciclovir tablet is unlikely to cause problems.",
      },
    ]);
  });

  test("uses its h3 as the title and doesn't repeat it in the content", () => {
    const sideEffects = parsePage(html).sections[1];
    const info = sideEffects.callouts.find((c) => c.level === "info")!;

    expect(info.heading).toBe("More about side effects");
    expect(info.content).toEqual([
      {
        type: "paragraph",
        text: "These are not all the side effects of aciclovir.",
      },
    ]);
  });

  test("real page (rosuvastatin): each section ends with the expected callout levels", () => {
    const { medicine } = assembleMedicine(
      "rosuvastatin",
      parsePage(fixture("rosuvastatin/index.html"))
    );

    expect(
      medicine.sections.howAndWhenToTake?.callouts.map((c) => c.level)
    ).toEqual(["warning", "urgent", "info"]);
    expect(medicine.sections.sideEffects?.callouts.map((c) => c.level)).toEqual(
      ["non-urgent", "urgent", "info"]
    );
    expect(
      JSON.stringify(medicine.sections.howAndWhenToTake?.content)
    ).not.toContain("go to A&E");
  });
});

// ---------------------------------------------------------------------------
// Expandable sections (<details>) keep their title
// ---------------------------------------------------------------------------

test.describe("expandable sections", () => {
  const html = page(`
    <section>
      <h2 id="how-its-used-previously-dosage-and-administration">How to use aciclovir</h2>
      <h3>How to use common types of aciclovir</h3>
      <details class="nhsuk-details nhsuk-expander" open="">
        <summary class="nhsuk-details__summary">
          <span class="nhsuk-details__summary-text">
          Tablets for skin infections
          </span>
        </summary>
        <div class="nhsuk-details__text">
          <p>Aciclovir tablets are used to treat infections such as cold sores.</p>
          <ul><li>start taking the tablets as soon as possible</li></ul>
        </div>
      </details>
      <details class="nhsuk-details nhsuk-expander">
        <summary class="nhsuk-details__summary"><span class="nhsuk-details__summary-text">Cream for cold sores</span></summary>
        <div class="nhsuk-details__text"><p>Aciclovir cream is used to treat cold sores.</p></div>
      </details>
    </section>`);

  test("the <summary> title becomes a heading block, in page order", () => {
    expect(parsePage(html).sections[0].content).toEqual([
      { type: "heading", text: "How to use common types of aciclovir" },
      { type: "heading", text: "Tablets for skin infections" }, // whitespace trimmed
      {
        type: "paragraph",
        text: "Aciclovir tablets are used to treat infections such as cold sores.",
      },
      { type: "list", items: ["start taking the tablets as soon as possible"] },
      { type: "heading", text: "Cream for cold sores" },
      {
        type: "paragraph",
        text: "Aciclovir cream is used to treat cold sores.",
      },
    ]);
  });

  test("closed expanders are read too (content is in the HTML, just hidden)", () => {
    const text = JSON.stringify(parsePage(html).sections[0].content);
    expect(text).toContain("Aciclovir cream is used to treat cold sores."); // the second <details> has no `open`
  });
});

// ---------------------------------------------------------------------------
// Sections keep their original NHS heading
// ---------------------------------------------------------------------------

test.describe("section headings", () => {
  test("single page: heading is the h2 text", () => {
    const { medicine } = assembleMedicine(
      "rosuvastatin",
      parsePage(fixture("rosuvastatin/index.html"))
    );

    expect(medicine.sections.about?.heading).toBe("What rosuvastatin is for");
    expect(medicine.sections.howAndWhenToTake?.heading).toBe(
      "How to take rosuvastatin"
    );
    expect(medicine.sections.interactions?.heading).toBe(
      "Taking rosuvastatin with other medicines, food and drink"
    );
  });

  test("hub: heading is the sub-page title", () => {
    const sub = parsePage(
      fixture(
        "lansoprazole/pregnancy-breastfeeding-and-fertility-while-taking-lansoprazole.html"
      )
    );
    const { medicine } = assembleMedicine(
      "lansoprazole",
      parsePage(fixture("lansoprazole/index.html")),
      [
        {
          subSlug:
            "pregnancy-breastfeeding-and-fertility-while-taking-lansoprazole",
          page: sub,
        },
      ]
    );

    expect(medicine.sections.pregnancyAndBreastfeeding?.heading).toBe(
      "Pregnancy, breastfeeding and fertility while taking lansoprazole" // brand caption removed
    );
  });

  test("hub sub-page with two h2s in one section keeps both as heading blocks (co-codamol for children)", () => {
    const sub = parsePage(`<html><body><main>
      <h1><span role="text">Who can and cannot take co-codamol for children</span></h1>
      <article><section>
        <h2 id="who-can-take">Who can take co-codamol</h2>
        <div class="block-richtext">
          <p>Most children aged 12 years old and over can take co-codamol.</p>
          <h2>Who may not be able to take co-codamol</h2>
          <p>Co-codamol is not suitable for some children.</p>
          <ul><li>lung problems</li></ul>
        </div>
      </section></article></main></body></html>`);

    const { medicine } = assembleMedicine(
      "co-codamol-for-children",
      { ...sub, title: "Co-codamol for children" },
      [{ subSlug: "who-can-and-cannot-take-co-codamol", page: sub }]
    );

    expect(medicine.sections.whoCanAndCannotTake?.heading).toBe(
      "Who can and cannot take co-codamol for children"
    );
    expect(medicine.sections.whoCanAndCannotTake?.content).toEqual([
      { type: "heading", text: "Who can take co-codamol" }, // the section's first h2, replaced as title by the sub-page h1
      {
        type: "paragraph",
        text: "Most children aged 12 years old and over can take co-codamol.",
      },
      { type: "heading", text: "Who may not be able to take co-codamol" }, // a second h2 inside the same section
      {
        type: "paragraph",
        text: "Co-codamol is not suitable for some children.",
      },
      { type: "list", items: ["lung problems"] },
    ]);
  });

  test("single page: a section's h2 is not repeated as a heading block", () => {
    const { medicine } = assembleMedicine(
      "rosuvastatin",
      parsePage(fixture("rosuvastatin/index.html"))
    );
    expect(medicine.sections.sideEffects?.content[0]).not.toEqual({
      type: "heading",
      text: "Side effects of rosuvastatin",
    });
  });

  test("intro used as `about` has no heading (there isn't one on the page)", () => {
    const { medicine } = assembleMedicine(
      "ranitidine",
      parsePage(fixture("ranitidine/index.html"))
    );
    expect(medicine.sections.about?.heading).toBeNull();
    expect(medicine.sections.about?.content).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Boilerplate that is intentionally skipped
// ---------------------------------------------------------------------------

test.describe("boilerplate", () => {
  test("'Find out more about your medicine' (inside an inset box) is not kept anywhere", () => {
    const html = page(`
      <section>
        <h2 id="interactions">Using aciclovir with other medicines, food and drink</h2>
        <p>No medicines are known to affect aciclovir cream.</p>
      </section>
      <section>
        <div class="nhsuk-inset-text">
          <span class="nhsuk-u-visually-hidden">Information: </span>
          <h2>Find out more about your medicine</h2>
          <p>To find out more about your medicine, you can:</p>
          <ul><li>check the leaflet that comes with it</li></ul>
        </div>
      </section>`);
    const { medicine } = assembleMedicine("aciclovir", parsePage(html));

    const everything = JSON.stringify(medicine);
    expect(everything).not.toContain("Find out more about your medicine");
    expect(everything).not.toContain("check the leaflet that comes with it");
    // and it isn't merged into the section before it
    expect(medicine.sections.interactions?.content).toEqual([
      {
        type: "paragraph",
        text: "No medicines are known to affect aciclovir cream.",
      },
    ]);
    expect(medicine.otherSections).toEqual({});
  });

  test("real page (rosuvastatin): no boilerplate leaks into the bundle", () => {
    const { medicine } = assembleMedicine(
      "rosuvastatin",
      parsePage(fixture("rosuvastatin/index.html"))
    );
    const everything = JSON.stringify(medicine);

    for (const junk of [
      "Find out more about your medicine",
      "Find a pharmacy",
      "Cookies on the NHS website",
      "Page last reviewed",
    ]) {
      expect(everything, junk).not.toContain(junk);
    }
  });
});

// ---------------------------------------------------------------------------
// Discontinued / withdrawn wording
// ---------------------------------------------------------------------------

test.describe("discontinued detection", () => {
  const withDescription = (d: string) =>
    page(
      "<section><p>Notice.</p></section>",
      `<meta name="description" content="${d}">`
    );

  const cases: [description: string, expected: boolean][] = [
    [
      "NHS medicines information on hydrocortisone rectal foam – this medicine has been discontinued.",
      true,
    ],
    [
      "NHS medicines information on ranitidine – this medicine is not currently available in the UK, or globally.",
      true,
    ],
    ["This medicine has been withdrawn.", true],
    ["This medicine is no longer available.", true],
    [
      "NHS information about the medicine rosuvastatin, including what it's used for.",
      false,
    ],
  ];

  for (const [description, expected] of cases) {
    test(`${expected ? "flags" : "doesn't flag"}: "${description.slice(
      0,
      60
    )}…"`, () => {
      expect(parsePage(withDescription(description)).discontinued).toBe(
        expected
      );
    });
  }

  test("real pages: foam and ranitidine are flagged, rosuvastatin isn't", () => {
    expect(
      parsePage(fixture("hydrocortisone-rectal-foam/index.html")).discontinued
    ).toBe(true);
    expect(parsePage(fixture("ranitidine/index.html")).discontinued).toBe(true);
    expect(parsePage(fixture("rosuvastatin/index.html")).discontinued).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// Sub-page discovery (crawler) — both hub styles
// ---------------------------------------------------------------------------

test.describe("extractSubpageUrls", () => {
  test("card hub (HRT): finds all 11 of its own sub-pages", () => {
    const urls = extractSubpageUrls(
      fixture("hormone-replacement-therapy-hrt/index.html"),
      "https://www.nhs.uk/medicines/hormone-replacement-therapy-hrt/"
    );
    expect(urls).toHaveLength(11);
    expect(urls).toContain(
      "https://www.nhs.uk/medicines/hormone-replacement-therapy-hrt/side-effects-of-hormone-replacement-therapy-hrt/"
    );
  });

  test("card hub (HRT): skips cards that link to a different medicine (Tibolone)", () => {
    const urls = extractSubpageUrls(
      fixture("hormone-replacement-therapy-hrt/index.html"),
      "https://www.nhs.uk/medicines/hormone-replacement-therapy-hrt/"
    );
    expect(urls.some((u) => u.includes("/medicines/tibolone/"))).toBe(false);
  });

  test("key-links hub: relative links are made absolute and de-duplicated", () => {
    const html = `<main><ul>
      <li class="nhsuk-hub-key-links__list-item"><a href="/medicines/co-codamol-for-adults/about-co-codamol-for-adults/">About</a></li>
      <li class="nhsuk-hub-key-links__list-item"><a href="/medicines/co-codamol-for-adults/about-co-codamol-for-adults/">About (again)</a></li>
      <li class="nhsuk-hub-key-links__list-item"><a href="/medicines/co-codamol-for-adults/">Back to the hub itself</a></li>
      <li class="nhsuk-hub-key-links__list-item"><a href="/conditions/headaches/">A condition page</a></li>
    </ul></main>`;
    expect(
      extractSubpageUrls(
        html,
        "https://www.nhs.uk/medicines/co-codamol-for-adults/"
      )
    ).toEqual([
      "https://www.nhs.uk/medicines/co-codamol-for-adults/about-co-codamol-for-adults/",
    ]);
  });

  test("single, group, signpost and discontinued pages have no sub-pages", () => {
    for (const slug of [
      "rosuvastatin",
      "antihistamines",
      "hydrocortisone",
      "ranitidine",
    ]) {
      expect(
        extractSubpageUrls(
          fixture(`${slug}/index.html`),
          `https://www.nhs.uk/medicines/${slug}/`
        ),
        slug
      ).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Guide pages (antibiotics): overview + "Pages in this guide"
// ---------------------------------------------------------------------------

test.describe("guide pages", () => {
  const ANTIBIOTICS = "https://www.nhs.uk/medicines/antibiotics/";

  /** A guide sub-page as the NHS builds it: h1 = page name + guide name as a bottom caption. */
  const guideSubPage = (current: string, body: string) =>
    parsePage(`<html><body><main>
      <h1><span role="text">${current} <span class="nhsuk-caption-xl nhsuk-caption--bottom">
        <span class="nhsuk-u-visually-hidden"> - </span> Antibiotics </span></span></h1>
      <nav class="nhsuk-contents-list"><ol>
        <li><a class="nhsuk-contents-list__link" href="/medicines/antibiotics/">Overview</a></li>
        <li aria-current="page"><span class="nhsuk-contents-list__current">${current}</span></li>
      </ol></nav>
      <article>${body}</article></main></body></html>`);

  test("crawler finds the 4 guide pages from 'Pages in this guide'", () => {
    const urls = extractSubpageUrls(
      fixture("antibiotics/index.html"),
      ANTIBIOTICS
    );
    expect(urls).toEqual([
      ANTIBIOTICS + "uses/",
      ANTIBIOTICS + "side-effects/",
      ANTIBIOTICS + "interactions/",
      ANTIBIOTICS + "antibiotic-antimicrobial-resistance/",
    ]);
  });

  test("a guide sub-page doesn't list the overview as its own sub-page", () => {
    const sub = `<main><nav class="nhsuk-contents-list"><ol>
      <li><a class="nhsuk-contents-list__link" href="/medicines/antibiotics/">Overview</a></li>
      <li><a class="nhsuk-contents-list__link" href="/medicines/antibiotics/uses/">Uses</a></li></ol></nav></main>`;
    expect(extractSubpageUrls(sub, ANTIBIOTICS)).toEqual([
      ANTIBIOTICS + "uses/",
    ]);
  });

  test("overview page: recognised as a guide hub; title from the caption", () => {
    const page = parsePage(fixture("antibiotics/index.html"));
    expect(page.title).toBe("Antibiotics");
    expect(page.isHub).toBe(true);
    expect(page.guidePageTitle).toBe("Overview");
  });

  test("bundle keeps the overview AND adds each guide page", () => {
    const main = parsePage(fixture("antibiotics/index.html"));
    const { medicine } = assembleMedicine("antibiotics", main, [
      {
        subSlug: "uses",
        page: guideSubPage(
          "Uses",
          "<section><h2>When antibiotics are used</h2><p>For bacterial infections.</p></section>"
        ),
      },
      {
        subSlug: "side-effects",
        page: guideSubPage(
          "Side effects",
          "<section><h2>Common side effects</h2><p>Feeling sick.</p></section>"
        ),
      },
      {
        subSlug: "interactions",
        page: guideSubPage(
          "Interactions",
          "<section><h2>Alcohol</h2><p>Avoid alcohol with metronidazole.</p></section>"
        ),
      },
      {
        subSlug: "antibiotic-antimicrobial-resistance",
        page: guideSubPage(
          "Antibiotic resistance",
          "<section><p>Overuse makes them less effective.</p></section>"
        ),
      },
    ]);

    expect(medicine.pageType).toBe("hub");
    // overview content is still there
    expect(JSON.stringify(medicine.sections.about)).toContain(
      "Antibiotics are used to treat or prevent"
    );
    expect(medicine.otherSections["Types of antibiotics"]).toBeDefined();

    // full guide pages take the standard keys, named after the page (not "Antibiotics")
    expect(medicine.sections.sideEffects?.heading).toBe("Side effects");
    expect(medicine.sections.sideEffects?.url).toBe(
      ANTIBIOTICS + "side-effects/"
    );
    expect(medicine.sections.interactions?.heading).toBe("Interactions");

    // the overview's short summaries aren't lost — they move to otherSections
    expect(medicine.otherSections["Side effects of antibiotics"]).toBeDefined();
    expect(
      medicine.otherSections["Considerations and interactions"]
    ).toBeDefined();

    // pages with no standard key go to otherSections under their own names, without overwriting each other
    expect(medicine.otherSections["Uses"]?.url).toBe(ANTIBIOTICS + "uses/");
    expect(medicine.otherSections["Antibiotic resistance"]?.url).toBe(
      ANTIBIOTICS + "antibiotic-antimicrobial-resistance/"
    );
  });
});
