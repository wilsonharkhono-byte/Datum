// packages/db/scripts/normalize-raw.ts
// Reads every assets/Trello/.raw/<shortLink>.json (a raw Trello board API response)
// and writes a normalized importer-shaped file to assets/Trello/<sanitized-name>/<shortLink>.json.

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeBoard } from "./lib/trello-normalize";

const REPO_ROOT = resolve(__dirname, "../../..");
const RAW_DIR = resolve(REPO_ROOT, "assets/Trello/.raw");
const OUT_ROOT = resolve(REPO_ROOT, "assets/Trello");

function sanitizeFolder(name: string): string {
  return name.replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}

function main() {
  if (!existsSync(RAW_DIR)) {
    console.error(`No raw dir at ${RAW_DIR}. Run the fetch step first.`);
    process.exit(1);
  }
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Normalizing ${files.length} raw boards...`);

  let written = 0;
  for (const f of files) {
    const raw = JSON.parse(readFileSync(resolve(RAW_DIR, f), "utf8"));
    if (!raw?.id || !raw?.name) {
      console.warn(`  ⚠ skip ${f}: missing id/name`);
      continue;
    }
    const board = normalizeBoard(raw);
    const dir = resolve(OUT_ROOT, sanitizeFolder(board._meta.board_name));
    mkdirSync(dir, { recursive: true });
    const outPath = resolve(dir, `${board._meta.short_link}.json`);
    writeFileSync(outPath, JSON.stringify(board, null, 2));
    written++;
    console.log(`  ✓ ${board._meta.project_code}  (${(board.cards as unknown[]).length} cards)`);
  }
  console.log(`Done. ${written} normalized board files written.`);
}

main();
