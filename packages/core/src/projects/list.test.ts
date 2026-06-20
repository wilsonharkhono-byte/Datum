import { describe, it, expect, vi } from "vitest";
import { coverImageUrl } from "./cover";
import { getProjectsList, getDevelopments } from "./list";
import type { DatumClient } from "../client";

describe("coverImageUrl", () => {
  it("returns null for empty paths", () => {
    expect(coverImageUrl(null, "https://x.co")).toBeNull();
    expect(coverImageUrl(undefined, "https://x.co")).toBeNull();
    expect(coverImageUrl("", "https://x.co")).toBeNull();
  });
  it("builds an encoded public URL from the injected base", () => {
    expect(coverImageUrl("a b/c.png", "https://x.co")).toBe(
      "https://x.co/storage/v1/object/public/project-covers/a%20b/c.png",
    );
  });
});

function listClient(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
    })),
  } as unknown as DatumClient;
}

function developmentsClient(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: () => ({ order: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    })),
  } as unknown as DatumClient;
}

describe("getProjectsList", () => {
  it("maps rows and resolves development + cover_url", async () => {
    const rows = [
      {
        id: "p1", project_code: "ARIN-1", project_name: "Karawang",
        client_name: "Nabil", location: "Karawang", status: "active",
        target_handover: null, development_id: "d1", cover_image_path: "x/y.png",
        developments: { name: "Citraland", area_label: "West", sort_order: 2 },
      },
    ];
    const out = await getProjectsList(listClient(rows), "https://x.co");
    expect(out[0]!.development_name).toBe("Citraland");
    expect(out[0]!.development_sort_order).toBe(2);
    expect(out[0]!.cover_url).toBe("https://x.co/storage/v1/object/public/project-covers/x/y.png");
  });
});

describe("getDevelopments", () => {
  it("returns rows verbatim", async () => {
    const rows = [{ id: "d1", name: "Citraland", area_label: "West", sort_order: 1 }];
    expect(await getDevelopments(developmentsClient(rows))).toEqual(rows);
  });
});
