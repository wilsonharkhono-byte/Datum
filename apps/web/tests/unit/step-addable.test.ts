import { describe, expect, it } from "vitest";
import { addableCatalog } from "@/lib/steps/queries";

describe("addableCatalog", () => {
  it("returns catalog steps whose code is not already on the area", () => {
    const catalog = [
      { code: "B1", name: "Pilih material" },
      { code: "B4", name: "Waterproofing" },
      { code: "B5", name: "Screeding" },
    ];
    expect(addableCatalog(catalog, ["B1", "B5"])).toEqual([{ code: "B4", name: "Waterproofing" }]);
  });

  it("excludes a code that exists even if removed (it lives in the removed list)", () => {
    const catalog = [{ code: "B1", name: "Pilih material" }];
    // B1 already has a row (removed or not) → not addable from catalog.
    expect(addableCatalog(catalog, ["B1"])).toEqual([]);
  });
});
