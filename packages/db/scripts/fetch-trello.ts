/**
 * fetch-trello.ts — Bulk Trello import (fetch phase)
 *
 * Pulls every in-scope board from the WHA Studio Trello workspaces directly via
 * the Trello REST API (using TRELLO_API_KEY / TRELLO_API_TOKEN from the repo .env)
 * and writes each board's raw JSON to assets/Trello/.raw/<shortLink>.json.
 *
 * The raw files are then turned into importer-shaped JSON by normalize-raw.ts.
 *
 * Run: pnpm --filter @datum/db import:trello-fetch
 */

import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { isInScope } from "./lib/select-boards";

config({ path: resolve(__dirname, "../../../.env") });

const KEY = process.env.TRELLO_API_KEY;
const TOKEN = process.env.TRELLO_API_TOKEN;

if (!KEY || !TOKEN) {
  console.error("Missing TRELLO_API_KEY or TRELLO_API_TOKEN in .env");
  process.exit(1);
}

const REPO_ROOT = resolve(__dirname, "../../..");
const RAW_DIR = resolve(REPO_ROOT, "assets/Trello/.raw");

// WHA Studio Trello workspaces (organizations)
const ORG_IDS = [
  "6047c464ad682d7c1686c599", // WHAstudio
  "646c79a83ebb2f64e7cf66e7", // WHA's workspace
];

const AUTH = `key=${KEY}&token=${TOKEN}`;

interface BoardRef {
  id: string;
  name: string;
  shortLink: string;
  closed: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url.replace(/key=[^&]+&token=[^&]+/, "key=***&token=***")}`);
  }
  return (await res.json()) as T;
}

async function listOrgBoards(orgId: string): Promise<BoardRef[]> {
  const url = `https://api.trello.com/1/organizations/${orgId}/boards?fields=name,closed,shortLink&filter=all&${AUTH}`;
  return getJson<BoardRef[]>(url);
}

function boardUrl(idOrShort: string): string {
  const params = [
    "lists=open",
    "cards=open",
    "card_fields=name,desc,idList,due,dueComplete,dateLastActivity,shortUrl,shortLink,closed,idChecklists,idMembers",
    "card_attachments=true",
    "card_attachment_fields=name,url,mimeType,date",
    "card_checklists=all",
    "actions=commentCard",
    "actions_limit=1000",
    "fields=name,shortLink,shortUrl,idOrganization,closed",
  ].join("&");
  return `https://api.trello.com/1/boards/${idOrShort}?${params}&${AUTH}`;
}

async function main() {
  console.log("Trello fetch — bulk import");
  console.log("==========================");
  mkdirSync(RAW_DIR, { recursive: true });

  // 1. Collect in-scope boards across both workspaces
  const inScope: BoardRef[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const orgId of ORG_IDS) {
    const boards = await listOrgBoards(orgId);
    for (const b of boards) {
      const verdict = isInScope({ name: b.name, closed: b.closed });
      if (verdict.include) inScope.push(b);
      else skipped.push({ name: b.name, reason: verdict.reason });
    }
  }

  console.log(`In scope: ${inScope.length} boards. Skipped: ${skipped.length}.`);
  for (const s of skipped) console.log(`  – skip [${s.reason}]: ${s.name}`);
  console.log("");

  // 2. Fetch each board and write raw JSON
  let ok = 0;
  const failed: Array<{ name: string; error: string }> = [];
  for (let i = 0; i < inScope.length; i++) {
    const b = inScope[i]!;
    try {
      const board = await getJson<{ cards?: unknown[]; lists?: unknown[]; actions?: unknown[] }>(boardUrl(b.shortLink));
      writeFileSync(resolve(RAW_DIR, `${b.shortLink}.json`), JSON.stringify(board, null, 2));
      ok++;
      console.log(
        `  ✓ [${i + 1}/${inScope.length}] ${b.shortLink} ${b.name} — ` +
          `${board.lists?.length ?? 0} lists, ${board.cards?.length ?? 0} cards, ${board.actions?.length ?? 0} comments`,
      );
    } catch (e) {
      const error = (e as Error).message;
      failed.push({ name: b.name, error });
      console.error(`  ✗ [${i + 1}/${inScope.length}] ${b.shortLink} ${b.name}: ${error}`);
    }
    // Gentle rate-limit buffer (Trello allows ~100 req/10s per token)
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log("\n══════════ FETCH SUMMARY ══════════");
  console.log(`  In scope:  ${inScope.length}`);
  console.log(`  Written:   ${ok}`);
  console.log(`  Failed:    ${failed.length}`);
  for (const f of failed) console.log(`    ✗ ${f.name}: ${f.error}`);
  console.log(`\nRaw files in ${RAW_DIR}`);
}

main().catch((err) => {
  console.error("Fetch failed:", err);
  process.exit(1);
});
