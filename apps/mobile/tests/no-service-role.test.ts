import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [join(__dirname, "..", "app"), join(__dirname, "..", "lib"), join(__dirname, "..", "components")];
const BANNED = [/createSupabaseAdminClient/, /SUPABASE_SERVICE_ROLE_KEY/, /service_role/];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("mobile never uses the service-role client", () => {
  it("has no admin/service-role references", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const f of tsFiles(root)) {
        const t = readFileSync(f, "utf8");
        for (const re of BANNED) if (re.test(t)) offenders.push(`${f} matched ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
