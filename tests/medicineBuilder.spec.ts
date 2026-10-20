import { test, expect } from "@playwright/test";
import { assembleMedicine } from "../src/parse/medicineBuilder";
import type { ParsedPage } from "../src/shared/types";
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

test.describe("medicineBuilder assembler", () => {
  test("assembles a single-page medicine correctly", () => {
    const mainPage = createMockPage({
      title: "Aspirin",
      summary: "Aspirin is used for pain relief.",
      sections: [
        {
          id: "side-effects",
          heading: "Side effects",
          content: [{ type: "paragraph", text: "Mild stomach ache." }],
          callouts: [],
        },
      ],
    });

    const result = assembleMedicine("aspirin", mainPage);

    expect(result.name).toBe("Aspirin");
    expect(result.medicine.slug).toBe("aspirin");
    expect(result.medicine.url).toBe(ASPIRIN_URL);
    expect(result.medicine.pageType).toBe("single");
    expect(result.medicine.sections.sideEffects).toEqual({
      url: ASPIRIN_URL + "#side-effects",
      content: [{ type: "paragraph", text: "Mild stomach ache." }],
      callouts: [],
    });
    expect(result.medicine.sections.about).toBeNull();
  });

  test("assembles a hub medicine with subpages", () => {
    const mainPage = createMockPage({
      title: "Lansoprazole",
      isHub: true,
      summary: "Lansoprazole reduces stomach acid.",
    });

    const subPageAbout = createMockPage({
      title: "About lansoprazole",
      sections: [
        {
          id: null,
          heading: "",
          content: [{ type: "paragraph", text: "About Lansoprazole details." }],
          callouts: [],
        },
      ],
    });

    const result = assembleMedicine("lansoprazole", mainPage, [
      { subSlug: "about-lansoprazole", page: subPageAbout },
    ]);

    expect(result.name).toBe("Lansoprazole");
    expect(result.medicine.pageType).toBe("hub");
    expect(result.medicine.url).toBe(LANSOPRAZOLE_URL);
    expect(result.medicine.sections.about).toEqual({
      url: ABOUT_LANSOPRAZOLE_URL,
      content: [{ type: "paragraph", text: "About Lansoprazole details." }],
      callouts: [],
    });
  });

  test("falls back to intro text when lede summary is missing", () => {
    const mainPage = createMockPage({
      title: "Group Med",
      summary: null,
      sections: [
        {
          id: null,
          heading: "",
          content: [
            { type: "paragraph", text: "Introductory description text." },
          ],
          callouts: [],
        },
      ],
    });

    const result = assembleMedicine("group-med", mainPage);
    expect(result.medicine.summary).toBe("Introductory description text.");
  });

  test("throws if main page title is missing", () => {
    const mainPage = createMockPage({ title: "" });
    expect(() => assembleMedicine("invalid", mainPage)).toThrow(
      /Missing title/
    );
  });
});
