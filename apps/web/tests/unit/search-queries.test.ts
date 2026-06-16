import { describe, expect, it } from "vitest";
import { searchAll } from "@/lib/search/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

function clientReturning(projects: unknown[], developments: unknown[] = []) {
  const builder: any = {
    select: () => builder, or: () => builder, ilike: () => builder,
    is: () => builder, contains: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    from(table: string) {
      if (table === "projects") {
        const pb: any = { select: () => pb, or: () => pb, limit: () => Promise.resolve({ data: projects, error: null }) };
        return pb;
      }
      if (table === "developments") {
        const db: any = { select: () => db, ilike: () => db, limit: () => Promise.resolve({ data: developments, error: null }) };
        return db;
      }
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("searchAll projects group", () => {
  it("returns matching projects as project hits", async () => {
    const supabase = clientReturning([
      { id: "p1", project_code: "ARIN-KARAWANG", project_name: "Karawang", client_name: "Nabil", location: "Karawang" },
    ]);
    const res = await searchAll(supabase, "nabil");
    expect(res.projects).toHaveLength(1);
    const hit = res.projects[0]!;
    expect(hit.kind).toBe("project");
    expect(hit.projectCode).toBe("ARIN-KARAWANG");
    expect(hit.href).toBe("/project/ARIN-KARAWANG");
  });
});

describe("searchAll developments tier", () => {
  it("returns matching developments as tier hits", async () => {
    const supabase = clientReturning([], [
      { id: "d1", name: "Citraland", area_label: "Surabaya Barat" },
    ]);
    const res = await searchAll(supabase, "citra");
    expect(res.developments).toHaveLength(1);
    const hit = res.developments[0]!;
    expect(hit.kind).toBe("development");
    expect(hit.href).toBe("/?dev=d1");
    expect(hit.cardTitle).toBe("Citraland");
  });
});
