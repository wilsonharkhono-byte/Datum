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

function clientReturningAttachments(rows: unknown[]) {
  const passthru: any = {
    select: () => passthru,
    or: () => passthru,
    ilike: () => passthru,
    is: () => passthru,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    from(table: string) {
      if (table === "card_attachments") {
        const ab: any = {
          select: () => ab,
          ilike: () => ab,
          limit: () => Promise.resolve({ data: rows, error: null }),
        };
        return ab;
      }
      return passthru;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("searchAll attachments group", () => {
  it("returns attachment caption hits", async () => {
    const supabase = clientReturningAttachments([
      {
        id: "a1",
        ai_caption: "Marmer Statuario, urat abu-abu, finish polish",
        mime_type: "image/jpeg",
        card_events: {
          cards: { slug: "master-bath", title: "Master bath", projects: { project_code: "ARIN" } },
        },
      },
    ]);
    const res = await searchAll(supabase, "statuario");
    expect(res.attachments).toHaveLength(1);
    const hit = res.attachments[0]!;
    expect(hit.kind).toBe("attachment");
    expect(hit.projectCode).toBe("ARIN");
    expect(hit.href).toBe("/project/ARIN/cards/master-bath");
    expect(hit.snippet).toContain("Statuario");
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
