import { test, expect } from "@playwright/test";
import path from "path";
import { FilePageCache } from "../src/crawl/cache";
import { MEDICINES_INDEX_BASE_URL } from "../src/shared/urls";

test.describe("FilePageCache", () => {
  const cache = new FilePageCache("/tmp/test-cache");

  test("resolves correct file paths for medicines and subpages", () => {
    expect(cache.resolvePath(MEDICINES_INDEX_BASE_URL)).toBe(
      path.resolve("/tmp/test-cache/index.html")
    );
    expect(cache.resolvePath(MEDICINES_INDEX_BASE_URL + "aspirin/")).toBe(
      path.resolve("/tmp/test-cache/aspirin/index.html")
    );
    expect(
      cache.resolvePath(
        MEDICINES_INDEX_BASE_URL + "lansoprazole/about-lansoprazole/"
      )
    ).toBe(path.resolve("/tmp/test-cache/lansoprazole/about-lansoprazole.html"));
  });
});
