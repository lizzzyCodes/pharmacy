import { test, expect } from "@playwright/test";
import { assembleMedicine } from "../src/parse/medicineBuilder";
import type { ParsedPage, Section } from "../src/shared/types";
import { ALL_SECTION_KEYS } from "../src/shared/types";
import {
  ASPIRIN_URL,
  LANSOPRAZOLE_URL,
  ABOUT_LANSOPRAZOLE_URL,
} from "./consts";

function createMockPage(overrides: Partial<ParsedPage> = {}): ParsedPage {
  return {
    title: "Sample Medicine",
    brandNames: [],
    genericName: null,
    summary: null,
    lastReviewed: null,
    discontinued: false,
    isHub: false,
    sections: [],
    relatedConditions: [],
    usefulResources: [],
    relatedMedicines: [],
    ...overrides,
  };
}

/** A section with one paragraph — keeps the tests short. */
function section(id: string | null, heading: string, text: string): Section {
  return { id, heading, content: [{ type: "paragraph", text }], callouts: [] };
}

test.describe("medicineBuilder assembler", () => {
  test("assembles a single-page medicine correctly", () => {
    const mainPage = createMockPage({
      title: "Aspirin",
      summary: "Aspirin is used for pain relief.",
      sections: [section("side-effects", "Side effects", "Mild stomach ache.")],
    });

    const result = assembleMedicine("aspirin", mainPage);

    expect(result.name).toBe("Aspirin");
    expect(result.medicine.slug).toBe("aspirin");
    expect(result.medicine.url).toBe(ASPIRIN_URL);
    expect(result.medicine.pageType).toBe("single");
    expect(result.medicine.sections.sideEffects).toEqual({
      url: ASPIRIN_URL + "#side-effects",
      heading: "Side effects", // original h2 text is kept
      content: [{ type: "paragraph", text: "Mild stomach ache." }],
      callouts: [],
    });
    expect(result.medicine.sections.about).toBeNull();
  });

  test("always has all 7 section keys, even when the page has none", () => {
    const result = assembleMedicine(
      "aspirin",
      createMockPage({ title: "Aspirin" })
    );

    expect(Object.keys(result.medicine.sections).sort()).toEqual(
      [...ALL_SECTION_KEYS].sort()
    );
    expect(
      Object.values(result.medicine.sections).every((s) => s === null)
    ).toBe(true);
  });

  test("maps sections by heading text when there are no ids (group page)", () => {
    const mainPage = createMockPage({
      title: "Antihistamines",
      sections: [
        section(null, "Side effects of antihistamines", "Drowsiness."),
        section(
          null,
          "Taking antihistamines with other medicines, food or alcohol",
          "Avoid alcohol."
        ),
      ],
    });

    const { medicine } = assembleMedicine("antihistamines", mainPage);

    expect(medicine.pageType).toBe("group");
    expect(medicine.sections.sideEffects?.heading).toBe(
      "Side effects of antihistamines"
    );
    // "Taking … with other medicines" is interactions, not "how to take"
    expect(medicine.sections.interactions?.heading).toBe(
      "Taking antihistamines with other medicines, food or alcohol"
    );
    expect(medicine.sections.howAndWhenToTake).toBeNull();
  });

  test("keeps unrecognised sections in otherSections, keyed by their heading", () => {
    const mainPage = createMockPage({
      title: "Antihistamines",
      sections: [
        section(null, "How antihistamines work", "They block histamine."),
      ],
    });

    const { medicine } = assembleMedicine("antihistamines", mainPage);

    expect(medicine.otherSections["How antihistamines work"]).toEqual({
      url: "https://www.nhs.uk/medicines/antihistamines/",
      heading: "How antihistamines work",
      content: [{ type: "paragraph", text: "They block histamine." }],
      callouts: [],
    });
  });

  test("skips 'Find out more about your medicine' boilerplate", () => {
    const mainPage = createMockPage({
      title: "Aspirin",
      sections: [
        section("side-effects", "Side effects", "Mild stomach ache."),
        section(
          null,
          "Find out more about your medicine",
          "Check the leaflet."
        ),
      ],
    });

    const { medicine } = assembleMedicine("aspirin", mainPage);

    expect(medicine.otherSections).toEqual({});
    expect(JSON.stringify(medicine)).not.toContain("Check the leaflet.");
  });

  test("if two sections map to the same key, the first wins and the second goes to otherSections", () => {
    const mainPage = createMockPage({
      title: "Aspirin",
      sections: [
        section("side-effects", "Side effects", "First."),
        section(null, "Side effects in children", "Second."),
      ],
    });

    const { medicine } = assembleMedicine("aspirin", mainPage);

    expect(medicine.sections.sideEffects?.heading).toBe("Side effects");
    expect(medicine.otherSections["Side effects in children"]).toBeDefined(); // not lost, not overwriting
  });

  // -------------------------------------------------------------------------
  // Intro text (pages with no lede, e.g. antihistamines, ranitidine)
  // -------------------------------------------------------------------------

  test("falls back to intro text when lede summary is missing", () => {
    const mainPage = createMockPage({
      title: "Group Med",
      summary: null,
      sections: [section(null, "", "Introductory description text.")],
    });

    const result = assembleMedicine("group-med", mainPage);
    expect(result.medicine.summary).toBe("Introductory description text.");
  });

  test("keeps the whole intro as `about` (with no heading) so a notice isn't cut to one line", () => {
    const mainPage = createMockPage({
      title: "Ranitidine",
      discontinued: true,
      sections: [
        {
          id: null,
          heading: "",
          content: [
            {
              type: "paragraph",
              text: "Ranitidine is not currently available in the UK or globally.",
            },
            { type: "paragraph", text: "It was used for indigestion." },
            { type: "paragraph", text: "Talk to your doctor or a pharmacist." },
          ],
          callouts: [],
        },
      ],
    });

    const { medicine } = assembleMedicine("ranitidine", mainPage);

    expect(medicine.discontinued).toBe(true);
    expect(medicine.summary).toBe(
      "Ranitidine is not currently available in the UK or globally."
    );
    expect(medicine.sections.about?.heading).toBeNull(); // the intro has no title on the page
    expect(medicine.sections.about?.content).toHaveLength(3);
  });

  test("a real 'What X is for' section replaces the intro as `about`", () => {
    const mainPage = createMockPage({
      title: "Aspirin",
      sections: [
        section(null, "", "Intro paragraph."),
        section("what-its-for", "What aspirin is for", "Aspirin treats pain."),
      ],
    });

    const { medicine } = assembleMedicine("aspirin", mainPage);

    expect(medicine.sections.about?.heading).toBe("What aspirin is for");
    expect(medicine.sections.about?.content).toEqual([
      { type: "paragraph", text: "Aspirin treats pain." },
    ]);
    expect(medicine.otherSections).toEqual({}); // the intro isn't duplicated elsewhere
  });

  // -------------------------------------------------------------------------
  // Hub pages
  // -------------------------------------------------------------------------

  test("assembles a hub medicine with subpages", () => {
    const mainPage = createMockPage({
      title: "Lansoprazole",
      isHub: true,
      summary: "Lansoprazole reduces stomach acid.",
    });

    const subPageAbout = createMockPage({
      title: "About lansoprazole",
      sections: [section(null, "", "About Lansoprazole details.")],
    });

    const result = assembleMedicine("lansoprazole", mainPage, [
      { subSlug: "about-lansoprazole", page: subPageAbout },
    ]);

    expect(result.name).toBe("Lansoprazole");
    expect(result.medicine.pageType).toBe("hub");
    expect(result.medicine.url).toBe(LANSOPRAZOLE_URL);
    expect(result.medicine.sections.about).toEqual({
      url: ABOUT_LANSOPRAZOLE_URL,
      heading: "About lansoprazole", // the sub-page's own title
      content: [{ type: "paragraph", text: "About Lansoprazole details." }],
      callouts: [],
    });
  });

  test("hub: a sub-page with several h2s keeps each one as a heading block", () => {
    const subPage = createMockPage({
      title: "Pregnancy, breastfeeding and fertility while taking lansoprazole",
      sections: [
        section(
          "pregnancy",
          "Lansoprazole and pregnancy",
          "Usually omeprazole instead."
        ),
        section(
          "breastfeeding",
          "Lansoprazole and breastfeeding",
          "Tell your doctor."
        ),
      ],
    });

    const { medicine } = assembleMedicine(
      "lansoprazole",
      createMockPage({ title: "Lansoprazole", isHub: true }),
      [
        {
          subSlug:
            "pregnancy-breastfeeding-and-fertility-while-taking-lansoprazole",
          page: subPage,
        },
      ]
    );

    expect(medicine.sections.pregnancyAndBreastfeeding?.content).toEqual([
      { type: "heading", text: "Lansoprazole and pregnancy" },
      { type: "paragraph", text: "Usually omeprazole instead." },
      { type: "heading", text: "Lansoprazole and breastfeeding" },
      { type: "paragraph", text: "Tell your doctor." },
    ]);
  });

  test("hub: unknown sub-pages go to otherSections under the sub-page title (e.g. HRT products)", () => {
    const product = createMockPage({
      title: "Vaginal oestrogen",
      sections: [section(null, "", "Brands include Vagifem.")],
    });

    const { medicine } = assembleMedicine(
      "hormone-replacement-therapy-hrt",
      createMockPage({
        title: "Hormone replacement therapy (HRT)",
        isHub: true,
      }),
      [{ subSlug: "vaginal-oestrogen", page: product }]
    );

    expect(medicine.otherSections["Vaginal oestrogen"]?.url).toBe(
      "https://www.nhs.uk/medicines/hormone-replacement-therapy-hrt/vaginal-oestrogen/"
    );
  });

  test("hub: 'when-to-take-…' sub-pages map to howAndWhenToTake (HRT)", () => {
    const whenToTake = createMockPage({
      title: "When to take HRT",
      sections: [section(null, "", "Start when symptoms begin.")],
    });

    const { medicine } = assembleMedicine(
      "hormone-replacement-therapy-hrt",
      createMockPage({
        title: "Hormone replacement therapy (HRT)",
        isHub: true,
      }),
      [
        {
          subSlug: "when-to-take-hormone-replacement-therapy-hrt",
          page: whenToTake,
        },
      ]
    );

    expect(medicine.sections.howAndWhenToTake?.heading).toBe(
      "When to take HRT"
    );
  });

  test("passes metadata through and removes self-links from relatedMedicines", () => {
    const mainPage = createMockPage({
      title: "Hydrocortisone",
      genericName: "Hydrocortisone",
      brandNames: ["Brand A"],
      relatedMedicines: [
        "/medicines/hydrocortisone/",
        "/medicines/hydrocortisone-tablets/",
      ],
    });

    const { medicine } = assembleMedicine("hydrocortisone", mainPage);

    expect(medicine.genericName).toBe("Hydrocortisone");
    expect(medicine.brandNames).toEqual(["Brand A"]);
    expect(medicine.relatedMedicines).toEqual([
      "/medicines/hydrocortisone-tablets/",
    ]);
  });

  test("throws if main page title is missing", () => {
    const mainPage = createMockPage({ title: "" });
    expect(() => assembleMedicine("invalid", mainPage)).toThrow(
      /Missing title/
    );
  });
});
