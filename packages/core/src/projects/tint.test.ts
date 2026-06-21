import { describe, expect, it } from "vitest";
import { developmentTint, TINTS } from "./tint";

describe("developmentTint", () => {
  it("is deterministic for the same name", () => {
    expect(developmentTint("Citraland")).toEqual(developmentTint("Citraland"));
  });
  it("always returns a tint from the palette", () => {
    for (const name of ["Citraland", "Pakuwon", "Bukit Darmo Golf", "", "Kobin"]) {
      expect(TINTS).toContainEqual(developmentTint(name));
    }
  });
  it("uses the neutral tint for empty/ungrouped", () => {
    expect(developmentTint("")).toEqual(TINTS[0]);
  });
});
