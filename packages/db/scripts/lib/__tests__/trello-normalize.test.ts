import { describe, expect, it } from "vitest";
import { deriveScope, deriveProjectMeta } from "../trello-normalize";

describe("deriveScope", () => {
  it("maps prefixes to scope", () => {
    expect(deriveScope("AR.IN - BDG H-1")).toBe("arin");
    expect(deriveScope("ARCH - BDG H-16")).toBe("arch");
    expect(deriveScope("INTR - CITRALAND M-8")).toBe("intr");
    expect(deriveScope("WHA - WORKING DRAWINGS")).toBe("wha");
  });
  it("defaults unknown prefixes to arin", () => {
    expect(deriveScope("PAKUWON AB1/28")).toBe("arin");
  });
});

describe("deriveProjectMeta", () => {
  it("splits site and client on the trailing ' - ' token", () => {
    const m = deriveProjectMeta("AR.IN - BUKIT DARMO GOLF I-23 - YENI KALIM");
    expect(m.scope).toBe("arin");
    expect(m.project_name).toBe("Bukit Darmo Golf I-23");
    expect(m.client_name).toBe("Yeni Kalim");
    expect(m.site_address).toBe("Bukit Darmo Golf I-23");
    expect(m.project_code).toBe("ARIN-BUKIT-DARMO-GOLF-I-23");
    expect(m.search_aliases).toContain("Yeni Kalim");
    expect(m.search_aliases).toContain("Bukit Darmo Golf I-23");
  });
  it("splits on the trailing underscore token", () => {
    const m = deriveProjectMeta("AR.IN - KARAWANG_NABIL");
    expect(m.project_name).toBe("Karawang");
    expect(m.client_name).toBe("Nabil");
    expect(m.project_code).toBe("ARIN-KARAWANG");
  });
  it("leaves client null when the trailing token looks like a unit", () => {
    const m = deriveProjectMeta("AR.IN - CITRALAND GA7/45");
    expect(m.client_name).toBeNull();
    expect(m.project_name).toBe("Citraland Ga7/45");
    expect(m.project_code).toBe("ARIN-CITRALAND-GA7-45");
  });
  it("keeps ARCH/INTR/WHA scope prefixes in the code", () => {
    expect(deriveProjectMeta("ARCH - BDG H-16").project_code).toBe("ARCH-BDG-H-16");
    expect(deriveProjectMeta("INTR - CITRALAND M-8").project_code).toBe("INTR-CITRALAND-M-8");
    expect(deriveProjectMeta("WHA - WORKING DRAWINGS").project_code).toBe("WHA-WORKING-DRAWINGS");
  });
});
