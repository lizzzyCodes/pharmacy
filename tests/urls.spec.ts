import { test, expect } from "@playwright/test";
import {
  buildMedicineUrl,
  toAbsoluteUrl,
  parseMedicinePath,
  isMedicineRootPath,
} from "../src/shared/urls";
import { ASPIRIN_URL, ABOUT_LANSOPRAZOLE_URL } from "./consts";
import { MEDICINES_INDEX_BASE_URL } from "../src/shared/urls";

test.describe("urls utility", () => {
  test("buildMedicineUrl creates clean URLs without double slashes", () => {
    expect(buildMedicineUrl("aspirin")).toBe(ASPIRIN_URL);
    expect(buildMedicineUrl("/aspirin/")).toBe(ASPIRIN_URL);
    expect(buildMedicineUrl("lansoprazole", "about-lansoprazole")).toBe(
      ABOUT_LANSOPRAZOLE_URL
    );
    expect(buildMedicineUrl("/lansoprazole/", "/about-lansoprazole/")).toBe(
      ABOUT_LANSOPRAZOLE_URL
    );
  });

  test("toAbsoluteUrl converts relative paths to absolute NHS URLs", () => {
    expect(toAbsoluteUrl("/medicines/paracetamol/")).toBe(
      "https://www.nhs.uk/medicines/paracetamol/"
    );
    expect(toAbsoluteUrl("https://www.nhs.uk/medicines/paracetamol/")).toBe(
      "https://www.nhs.uk/medicines/paracetamol/"
    );
  });

  test("parseMedicinePath parses slugs correctly", () => {
    expect(parseMedicinePath(MEDICINES_INDEX_BASE_URL)).toEqual({
      isIndex: true,
    });
    expect(parseMedicinePath(ASPIRIN_URL)).toEqual({
      slug: "aspirin",
      subSlug: undefined,
      isIndex: false,
    });
    expect(parseMedicinePath(ABOUT_LANSOPRAZOLE_URL)).toEqual({
      slug: "lansoprazole",
      subSlug: "about-lansoprazole",
      isIndex: false,
    });
  });

  test("isMedicineRootPath validates medicine main paths", () => {
    expect(isMedicineRootPath("/medicines/aspirin/")).toBe(true);
    expect(isMedicineRootPath("/medicines/aspirin")).toBe(true);
    expect(isMedicineRootPath("/medicines/aspirin/about-aspirin/")).toBe(false);
    expect(isMedicineRootPath("/medicines/")).toBe(false);
    expect(isMedicineRootPath("/conditions/")).toBe(false);
  });
});
