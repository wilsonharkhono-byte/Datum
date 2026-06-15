import { describe, expect, it } from "vitest";
import { deriveDevelopment } from "../derive-development";

describe("deriveDevelopment", () => {
  it("strips the trailing unit token", () => {
    expect(deriveDevelopment("Citraland E7-20")).toBe("Citraland");
    expect(deriveDevelopment("Citraland Gc5-26")).toBe("Citraland");
  });
  it("keeps multi-word development names", () => {
    expect(deriveDevelopment("Bukit Darmo Golf I-32")).toBe("Bukit Darmo Golf");
  });
  it("applies the alias map (BDG = Bukit Darmo Golf)", () => {
    expect(deriveDevelopment("Bdg H-16")).toBe("Bukit Darmo Golf");
  });
  it("treats slash-bearing tokens as units", () => {
    expect(deriveDevelopment("Citraland Ga7/45")).toBe("Citraland");
  });
  it("falls back to the whole name when nothing is strippable", () => {
    expect(deriveDevelopment("Kobin Showroom")).toBe("Kobin Showroom");
  });
});
