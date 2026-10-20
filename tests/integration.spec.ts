import { test, expect } from "@playwright/test";
import path from "path";
import { buildMedicine } from "../src/parse/buildBundle";
import { MEDICINES_INDEX_BASE_URL } from "../src/shared/urls";

test.describe("Integration: buildMedicine with real cached data", () => {
  const cacheDir = path.resolve("cache");

  test("builds single-page medicine (aspirin)", async () => {
    const { name, medicine } = await buildMedicine(cacheDir, "aspirin");

    expect(name).toBe("Aspirin");
    expect(medicine.slug).toBe("aspirin");
    expect(medicine.url).toBe(MEDICINES_INDEX_BASE_URL + "aspirin/");
    expect(medicine.url).not.toContain("//aspirin");
    expect(medicine.pageType).toBe("single");
    expect(medicine.sections.about).not.toBeNull();
    expect(medicine.sections.sideEffects).not.toBeNull();
  });

  test("builds hub-page medicine with subpages (lansoprazole)", async () => {
    const { name, medicine } = await buildMedicine(cacheDir, "lansoprazole");

    expect(name).toBe("Lansoprazole");
    expect(medicine.slug).toBe("lansoprazole");
    expect(medicine.url).toBe(MEDICINES_INDEX_BASE_URL + "lansoprazole/");
    expect(medicine.url).not.toContain("//lansoprazole");
    expect(medicine.pageType).toBe("hub");
    expect(medicine.sections.about).not.toBeNull();
    expect(medicine.sections.whoCanAndCannotTake).not.toBeNull();
    expect(medicine.sections.howAndWhenToTake).not.toBeNull();
    expect(medicine.sections.sideEffects).not.toBeNull();
    expect(medicine.sections.pregnancyAndBreastfeeding).not.toBeNull();
    expect(medicine.sections.interactions).not.toBeNull();
    expect(medicine.sections.commonQuestions).not.toBeNull();
  });

  test("builds group-page medicine (antihistamines)", async () => {
    const { name, medicine } = await buildMedicine(cacheDir, "antihistamines");

    expect(name).toBe("Antihistamines");
    expect(medicine.slug).toBe("antihistamines");
    expect(medicine.pageType).toBe("group");
  });
});
