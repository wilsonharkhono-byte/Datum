import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import type { Database } from "../src";
import { deriveDevelopment } from "./lib/derive-development";

config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const admin = createClient<Database>(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, project_name, development_id");
  if (error) throw error;

  // name(lower) -> development id, cached as we create them.
  const byName = new Map<string, string>();
  const { data: existing } = await admin.from("developments").select("id, name");
  for (const d of existing ?? []) byName.set(d.name.toLowerCase(), d.id);

  let created = 0;
  let assigned = 0;
  for (const p of projects ?? []) {
    if (p.development_id) continue; // never override a human assignment
    const label = deriveDevelopment(p.project_name);
    if (!label) continue;

    let devId = byName.get(label.toLowerCase());
    if (!devId) {
      const { data: dev, error: dErr } = await admin
        .from("developments")
        .insert({ name: label })
        .select("id")
        .single();
      if (dErr) throw dErr;
      devId = dev.id;
      byName.set(label.toLowerCase(), devId);
      created++;
    }

    const { error: uErr } = await admin
      .from("projects")
      .update({ development_id: devId })
      .eq("id", p.id);
    if (uErr) throw uErr;
    assigned++;
  }

  console.log(`Developments created: ${created}; projects assigned: ${assigned}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
