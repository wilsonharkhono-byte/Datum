import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import type { Database } from "../src";

config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const admin = createClient<Database>(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function upsertAuthUser(
  email: string,
  password: string,
  fullName: string,
): Promise<string> {
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing?.users.find((u) => u.email === email);
  if (found) return found.id;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  console.log("Seeding pilot...");

  const wilsonId = await upsertAuthUser(
    "wilson@datum.local",
    "datum-pilot-2026",
    "Wilson Harkhono",
  );
  const carissaId = await upsertAuthUser(
    "carissa@datum.local",
    "datum-pilot-2026",
    "Carissa Tjondro",
  );
  console.log(
    `  Auth users: wilson=${wilsonId.slice(0, 8)}..., carissa=${carissaId.slice(0, 8)}...`,
  );

  const { error: staffErr } = await admin.from("staff").upsert(
    [
      {
        id: wilsonId,
        full_name: "Wilson Harkhono",
        role: "principal" as const,
        cost_visible: true,
        email: "wilson@datum.local",
        active: true,
      },
      {
        id: carissaId,
        full_name: "Carissa Tjondro",
        role: "designer" as const,
        cost_visible: false,
        email: "carissa@datum.local",
        active: true,
      },
    ],
    { onConflict: "id" },
  );
  if (staffErr) throw staffErr;
  console.log("  Staff rows upserted");

  const projects = [
    {
      project_code: "BDG-H1",
      project_name: "Bukit Darmo Golf H-1",
      client_name: "Arin",
      site_address: "Bukit Darmo Golf, Surabaya",
      location: "Surabaya",
      status: "finishing" as const,
      kickoff_date: "2024-07-01",
      target_handover: "2026-09-30",
      principal_id: wilsonId,
      pic_id: null as string | null,
      search_aliases: ["BDG H-1", "Bukit Darmo", "Arin BDG"] as unknown as import("../src").Json,
    },
    {
      project_code: "PKW-PC1012",
      project_name: "Pakuwon PC 10-12 Setiono",
      client_name: "Setiono",
      site_address: "Pakuwon City PC 10-12, Surabaya",
      location: "Surabaya",
      status: "finishing" as const,
      kickoff_date: "2024-10-01",
      target_handover: "2026-12-31",
      principal_id: wilsonId,
      pic_id: null as string | null,
      search_aliases: [
        "Pakuwon PC10-12",
        "Setiono",
        "Pakuwon Setiono",
      ] as unknown as import("../src").Json,
    },
  ];

  const { data: projectRows, error: projectErr } = await admin
    .from("projects")
    .upsert(projects, { onConflict: "project_code" })
    .select("id, project_code");
  if (projectErr) throw projectErr;
  console.log(`  ${projectRows!.length} pilot projects upserted`);

  const assignments = projectRows!.flatMap((p) => [
    {
      project_id: p.id,
      staff_id: wilsonId,
      role_on_project: "principal",
      cost_visible: true,
    },
    {
      project_id: p.id,
      staff_id: carissaId,
      role_on_project: "designer_lead",
      cost_visible: false,
    },
  ]);
  const { error: assignErr } = await admin
    .from("project_staff")
    .upsert(assignments, { onConflict: "project_id,staff_id" });
  if (assignErr) throw assignErr;
  console.log(`  ${assignments.length} project_staff assignments`);

  type AreaType = Database["public"]["Enums"]["area_type"];

  const areasByProject: Record<
    string,
    Array<{
      area_code: string;
      area_name: string;
      floor: string;
      area_type: AreaType;
    }>
  > = {
    "BDG-H1": [
      {
        area_code: "L1-LIVING",
        area_name: "Living Lt.1",
        floor: "Lt.1",
        area_type: "living",
      },
      {
        area_code: "L1-KITCHEN",
        area_name: "Kitchen Lt.1",
        floor: "Lt.1",
        area_type: "kitchen",
      },
      {
        area_code: "L1-PANTRY",
        area_name: "Pantry Lt.1",
        floor: "Lt.1",
        area_type: "kitchen",
      },
      {
        area_code: "L1-KM1",
        area_name: "KM-1 Lt.1",
        floor: "Lt.1",
        area_type: "bathroom",
      },
      {
        area_code: "L1-KM2",
        area_name: "KM-2 Lt.1",
        floor: "Lt.1",
        area_type: "bathroom",
      },
      {
        area_code: "L2-MBR",
        area_name: "Master Bedroom Lt.2",
        floor: "Lt.2",
        area_type: "bedroom",
      },
      {
        area_code: "L2-KM3",
        area_name: "KM-3 Lt.2",
        floor: "Lt.2",
        area_type: "bathroom",
      },
      {
        area_code: "L2-KM4",
        area_name: "KM-4 Lt.2",
        floor: "Lt.2",
        area_type: "bathroom",
      },
      {
        area_code: "GAZEBO",
        area_name: "Gazebo",
        floor: "Garden",
        area_type: "garden",
      },
    ],
    "PKW-PC1012": [
      {
        area_code: "L1-LIVING",
        area_name: "Living Lt.1",
        floor: "Lt.1",
        area_type: "living",
      },
      {
        area_code: "L1-KITCHEN",
        area_name: "Kitchen Lt.1",
        floor: "Lt.1",
        area_type: "kitchen",
      },
      {
        area_code: "L1-KM1",
        area_name: "KM-1 Lt.1",
        floor: "Lt.1",
        area_type: "bathroom",
      },
      {
        area_code: "L2-MBR",
        area_name: "Master Bedroom Lt.2",
        floor: "Lt.2",
        area_type: "bedroom",
      },
      {
        area_code: "L2-KM2",
        area_name: "KM-2 Lt.2",
        floor: "Lt.2",
        area_type: "bathroom",
      },
      {
        area_code: "L3-LOFT",
        area_name: "Loft Lt.3",
        floor: "Lt.3",
        area_type: "living",
      },
    ],
  };

  for (const project of projectRows!) {
    const rows = (areasByProject[project.project_code] ?? []).map((a, i) => ({
      project_id: project.id,
      sort_order: i,
      ...a,
    }));
    if (rows.length === 0) continue;
    const { error } = await admin
      .from("areas")
      .upsert(rows, { onConflict: "project_id,area_code" });
    if (error) throw error;
    console.log(`  ${rows.length} areas seeded for ${project.project_code}`);
  }

  type GateCode = Database["public"]["Enums"]["gate_code"];
  const gateCodes: GateCode[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

  const projectGates = projectRows!.flatMap((p) =>
    gateCodes.map((gate_code) => ({
      project_id: p.id,
      gate_code,
    })),
  );
  const { error: pgErr } = await admin
    .from("project_gates")
    .upsert(projectGates, { onConflict: "project_id,gate_code" });
  if (pgErr) throw pgErr;
  console.log(`  ${projectGates.length} project_gates initialized`);

  const { data: allAreas } = await admin.from("areas").select("id, project_id");
  const cells = (allAreas ?? []).flatMap((a) =>
    gateCodes.map((gate_code) => ({
      project_id: a.project_id,
      area_id: a.id,
      gate_code,
      status: "not_started" as const,
    })),
  );
  const { error: cellErr } = await admin
    .from("area_gate_status")
    .upsert(cells, { onConflict: "project_id,area_id,gate_code" });
  if (cellErr) throw cellErr;
  console.log(`  ${cells.length} area_gate_status cells initialized`);

  console.log("Pilot seed complete.");
  console.log("");
  console.log("Test credentials:");
  console.log("  wilson@datum.local / datum-pilot-2026   (Principal, cost-visible)");
  console.log("  carissa@datum.local / datum-pilot-2026  (Designer)");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
