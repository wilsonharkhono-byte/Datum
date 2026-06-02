/**
 * import-trello-attachments.ts — Slice 1.8f
 *
 * Scans card_events of kind 'document'/'drawing' whose payload.notes or
 * payload.file_ref contains a Trello attachment URL, then fetches each one
 * (using Trello API credentials), uploads the file to the card-attachments
 * Supabase Storage bucket, and inserts a card_attachments row.
 *
 * Idempotent: events that already have a card_attachments row are skipped.
 *
 * Run:
 *   cd packages/db && npx tsx scripts/import-trello-attachments.ts
 *   or:
 *   pnpm --filter @datum/db import:trello-attachments
 *
 * Optional: IMPORT_LIMIT=<n> to process only the first N candidates.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Database } from "../src";

config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
const trelloKey = process.env.TRELLO_API_KEY;
const trelloToken = process.env.TRELLO_API_TOKEN;

if (!url || !srk) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}
if (!trelloKey || !trelloToken) {
  console.error("\nMissing TRELLO_API_KEY or TRELLO_API_TOKEN in .env.");
  console.error("Get them from https://trello.com/power-ups/admin (Key + Token link).");
  console.error("Without them, this script can't fetch private Trello attachment URLs.");
  console.error("Aborting.\n");
  process.exit(1);
}

const admin = createClient<Database>(url, srk, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = "card-attachments";
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

type CandidateRow = {
  event_id: string;
  card_id: string;
  project_id: string;
  url: string;
};

async function listCandidates(): Promise<CandidateRow[]> {
  // Find card_events where payload.notes (or payload.file_ref) contains a trello.com URL
  // AND there's no existing card_attachment for this event yet.
  const { data: events, error } = await admin
    .from("card_events")
    .select("id, card_id, project_id, payload")
    .or("event_kind.eq.document,event_kind.eq.drawing");
  if (error) throw error;

  const candidates: CandidateRow[] = [];
  for (const e of events ?? []) {
    const p = e.payload as { notes?: string; file_ref?: string } | null;
    const text = (p?.notes ?? p?.file_ref ?? "") + "";
    const m = text.match(/https:\/\/trello\.com\/[^\s)]+/);
    if (!m) continue;
    candidates.push({
      event_id: e.id,
      card_id: e.card_id,
      project_id: e.project_id,
      url: m[0],
    });
  }

  if (candidates.length === 0) return [];

  // Filter out events that already have at least one card_attachment
  const eventIds = candidates.map((c) => c.event_id);
  const { data: existing } = await admin
    .from("card_attachments")
    .select("card_event_id")
    .in("card_event_id", eventIds);
  const haveAttachment = new Set((existing ?? []).map((a) => a.card_event_id));
  return candidates.filter((c) => !haveAttachment.has(c.event_id));
}

function trelloAuthHeader(): string {
  // Attachment download endpoints REQUIRE the OAuth Authorization header.
  // Query-param auth (?key=&token=) works for most REST endpoints but NOT
  // for /attachments/.../download/... — that returns 401 silently.
  // See https://support.atlassian.com/trello/docs/downloading-attachments-using-the-trello-rest-api/
  return `OAuth oauth_consumer_key="${trelloKey}", oauth_token="${trelloToken}"`;
}

function extractFilenameFromUrl(rawUrl: string): string {
  // Trello URL pattern: .../download/<filename>
  const m = rawUrl.match(/\/download\/([^/?#]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]!);
    } catch {
      return m[1]!;
    }
  }
  return `trello-${Date.now()}.bin`;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function inferMime(filename: string, headerMime: string | null): string {
  if (headerMime) {
    const base = headerMime.split(";")[0]?.trim() ?? "";
    if (ALLOWED_MIMES.has(base)) return base;
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

async function fetchAndStore(c: CandidateRow): Promise<
  | { ok: true; storagePath: string; mime: string }
  | { ok: false; reason: string }
> {
  const filename = extractFilenameFromUrl(c.url);

  let res: Response;
  try {
    res = await fetch(c.url, {
      redirect: "follow",
      headers: { Authorization: trelloAuthHeader() },
    });
  } catch (e) {
    return {
      ok: false,
      reason: `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > 20_000_000) {
    return { ok: false, reason: `too large (${contentLength} bytes)` };
  }

  const mime = inferMime(filename, res.headers.get("content-type"));
  if (!ALLOWED_MIMES.has(mime)) {
    return { ok: false, reason: `mime not allowed: ${mime}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20_000_000) {
    return { ok: false, reason: `too large after read (${buf.length} bytes)` };
  }

  const storagePath = `${c.project_id}/${c.card_id}/${c.event_id}/${randomUUID()}-${safeName(filename)}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: mime, upsert: false });
  if (upErr) {
    return { ok: false, reason: `storage upload failed: ${upErr.message}` };
  }

  const { error: insErr } = await admin.from("card_attachments").insert({
    card_event_id: c.event_id,
    storage_path: storagePath,
    mime_type: mime,
  });
  if (insErr) {
    // Clean up orphaned storage object so we stay consistent
    void admin.storage.from(BUCKET).remove([storagePath]);
    return {
      ok: false,
      reason: `card_attachments insert failed: ${insErr.message}`,
    };
  }

  return { ok: true, storagePath, mime };
}

async function main() {
  console.log("Scanning for unfetched Trello attachments...");
  const candidates = await listCandidates();
  console.log(
    `Found ${candidates.length} candidate events with Trello URLs and no attachment yet.\n`,
  );

  if (candidates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const limit = Number(process.env.IMPORT_LIMIT ?? candidates.length);
  const todo = candidates.slice(0, limit);
  console.log(
    `Processing ${todo.length}${limit < candidates.length ? ` (limited from ${candidates.length} via IMPORT_LIMIT)` : ""}...\n`,
  );

  let ok = 0;
  const failures: { url: string; reason: string }[] = [];

  for (let i = 0; i < todo.length; i++) {
    const c = todo[i]!;
    const res = await fetchAndStore(c);
    if (res.ok) {
      ok++;
      if (i % 10 === 0 || i === todo.length - 1) {
        console.log(`[${i + 1}/${todo.length}] ${ok} ok / ${failures.length} failed`);
      }
    } else {
      failures.push({ url: c.url, reason: res.reason });
      console.warn(
        `[${i + 1}/${todo.length}] FAIL ${c.url.slice(0, 80)}... — ${res.reason}`,
      );
    }
    // Gentle rate limit: 100ms between Trello requests
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\nDone. ${ok} uploaded, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log("\nFirst 10 failures:");
    for (const f of failures.slice(0, 10)) {
      console.log(`  - ${f.reason}: ${f.url.slice(0, 100)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
