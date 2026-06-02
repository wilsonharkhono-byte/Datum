/**
 * import-trello.ts — Slice 1.7
 *
 * Bulk-imports the two pilot Trello board exports into DATUM.
 * Run: cd packages/db && npx tsx scripts/import-trello.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "../src";

config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const srk = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !srk) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient<Database>(url, srk, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Trello JSON types ──────────────────────────────────────────────────────────

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

interface TrelloAttachment {
  id: string;
  name: string | null;
  url: string | null;
  mimeType: string | null;
  date: string | null;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  due: string | null;
  dueComplete: boolean;
  dateLastActivity: string | null;
  shortUrl: string | null;
  shortLink: string | null;
  closed: boolean;
  attachments: TrelloAttachment[];
  idChecklists: string[];
  idMembers: string[];
}

interface TrelloCheckItem {
  id: string;
  name: string;
  state: string; // "incomplete" | "complete"
}

interface TrelloChecklist {
  id: string;
  idCard: string;
  name: string;
  checkItems: TrelloCheckItem[];
}

interface TrelloAction {
  id: string;
  type: string;
  date: string;
  data: {
    card?: { id: string };
    text?: string;
  };
}

interface TrelloBoard {
  lists: TrelloList[];
  cards: TrelloCard[];
  actions: TrelloAction[];
  checklists: TrelloChecklist[];
}

// ── Import config ──────────────────────────────────────────────────────────────

// Paths are relative to the repo root (3 levels up from packages/db/scripts/)
const REPO_ROOT = resolve(__dirname, "../../..");

const IMPORTS = [
  {
    jsonPath: resolve(REPO_ROOT, "assets/Trello/Bukit Darmo Golf H:1/QQQcBn6d - arin-bdg-h-1.json"),
    projectCode: "BDG-H1",
  },
  {
    jsonPath: resolve(REPO_ROOT, "assets/Trello/Pakuwon PC 10:12/gongzABX - arin-pakuwon-pc10-12-setiono.json"),
    projectCode: "PKW-PC1012",
  },
];

// ── Standard topic mappings: Trello list name prefix → DATUM topic code ────────
// Keys are normalised (uppercase, trimmed). The first match wins.
const STANDARD_TOPIC_MAP: Array<{ prefix: string; code: string }> = [
  { prefix: "A01-03", code: "A01-03" },
  { prefix: "A04", code: "A04" },
  { prefix: "A05", code: "A05" },
  { prefix: "A06", code: "A06" },
  { prefix: "A07-08", code: "A07-08" },
  { prefix: "A09", code: "A09" },
  { prefix: "A10", code: "A10" },
  { prefix: "U01", code: "U01" },
  { prefix: "U02", code: "U02" },
  { prefix: "U03", code: "U03" },
  { prefix: "U04", code: "U04" },
  { prefix: "LANDSCAPE", code: "LANDSCAPE" },
  { prefix: "DAILY PROGRESS", code: "DAILY_PROGRESS" },
  { prefix: "PHOTOS", code: "PHOTOS" },
  { prefix: "LOGISTIK", code: "LOGISTIK" },
];

const SKIP_LIST_NAMES = new Set(["GUIDE - READ ME"]);

// ── Helpers ────────────────────────────────────────────────────────────────────

function matchStandardTopic(listName: string): string | null {
  const upper = listName.toUpperCase().trim();
  for (const { prefix, code } of STANDARD_TOPIC_MAP) {
    if (upper === prefix || upper.startsWith(prefix + " ") || upper.startsWith(prefix + "-") || upper.startsWith(prefix + ":")) {
      return code;
    }
  }
  return null;
}

function slugify(text: string, maxLen = 60): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

function topicCodeFromListName(listName: string): string {
  return listName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

// ── Per-project summary ────────────────────────────────────────────────────────

interface Summary {
  topicsCreated: number;
  cardsCreated: number;
  cardsSkipped: number;
  eventsInserted: number;
  commentsInserted: number;
}

// ── Main import logic ──────────────────────────────────────────────────────────

async function importProject(
  jsonPath: string,
  projectCode: string,
  wilsonId: string,
): Promise<Summary> {
  const summary: Summary = {
    topicsCreated: 0,
    cardsCreated: 0,
    cardsSkipped: 0,
    eventsInserted: 0,
    commentsInserted: 0,
  };

  console.log(`\n──── ${projectCode} ────`);

  // 1. Read JSON
  const board: TrelloBoard = JSON.parse(readFileSync(jsonPath, "utf8"));
  console.log(
    `  Loaded: ${board.lists.length} lists, ${board.cards.length} cards, ` +
      `${board.actions.length} actions, ${board.checklists.length} checklists`,
  );

  // 2. Look up project_id
  const { data: projRow, error: projErr } = await admin
    .from("projects")
    .select("id")
    .eq("project_code", projectCode)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!projRow) {
    console.warn(`  ⚠ Project ${projectCode} not found — skipping`);
    return summary;
  }
  const projectId = projRow.id;
  console.log(`  project_id: ${projectId.slice(0, 8)}...`);

  // 3. Load existing topics for this project
  const { data: existingTopics, error: topicsErr } = await admin
    .from("topics")
    .select("id, code, name, sort_order")
    .eq("project_id", projectId);
  if (topicsErr) throw topicsErr;

  const topicByCode = new Map<string, string>(); // code → id
  const topicByNameUpper = new Map<string, string>(); // name.upper → id
  let maxSortOrder = 0;

  for (const t of existingTopics ?? []) {
    topicByCode.set(t.code.toUpperCase(), t.id);
    topicByNameUpper.set(t.name.toUpperCase().trim(), t.id);
    if (t.sort_order > maxSortOrder) maxSortOrder = t.sort_order;
  }

  // 4. Build trelloListId → topicId map
  const listIdToTopicId = new Map<string, string>();

  for (const list of board.lists) {
    const upperName = list.name.toUpperCase().trim();

    // Skip meta list
    if (SKIP_LIST_NAMES.has(upperName)) {
      console.log(`  Skipping list: "${list.name}"`);
      continue;
    }

    // Try standard mapping
    const standardCode = matchStandardTopic(list.name);
    if (standardCode) {
      const topicId = topicByCode.get(standardCode.toUpperCase());
      if (topicId) {
        listIdToTopicId.set(list.id, topicId);
      } else {
        console.warn(`  ⚠ Standard topic ${standardCode} not found in DB for ${projectCode}`);
      }
      continue;
    }

    // Try name match
    if (topicByNameUpper.has(upperName)) {
      listIdToTopicId.set(list.id, topicByNameUpper.get(upperName)!);
      continue;
    }

    // Create new topic
    const code = topicCodeFromListName(list.name);
    maxSortOrder += 10;

    // Determine topic_type: forum/guide/interior area → 'general', otherwise 'general' too
    // (spec says 'general' for forums/guides/interior areas, 'drawing' otherwise — but rare)
    // Most non-standard lists are interior areas → 'general'
    const topicType = "general" as const;

    const { data: newTopic, error: newTopicErr } = await admin
      .from("topics")
      .insert({
        project_id: projectId,
        code,
        name: list.name,
        topic_type: topicType,
        status: "active",
        sort_order: maxSortOrder,
        created_by_staff_id: wilsonId,
      })
      .select("id")
      .single();

    if (newTopicErr) {
      // Might be duplicate code — try to find it
      const { data: existing } = await admin
        .from("topics")
        .select("id")
        .eq("project_id", projectId)
        .eq("code", code)
        .maybeSingle();
      if (existing) {
        listIdToTopicId.set(list.id, existing.id);
        topicByCode.set(code.toUpperCase(), existing.id);
        topicByNameUpper.set(list.name.toUpperCase().trim(), existing.id);
        console.log(`  Topic already exists: "${list.name}" → ${code}`);
      } else {
        console.error(`  ✗ Failed to create topic for "${list.name}": ${newTopicErr.message}`);
      }
      continue;
    }

    listIdToTopicId.set(list.id, newTopic.id);
    topicByCode.set(code.toUpperCase(), newTopic.id);
    topicByNameUpper.set(list.name.toUpperCase().trim(), newTopic.id);
    summary.topicsCreated++;
    console.log(`  Created topic: "${list.name}" → ${code}`);
  }

  // Build a checklist lookup map
  const checklistMap = new Map<string, TrelloChecklist>();
  for (const cl of board.checklists) {
    checklistMap.set(cl.id, cl);
  }

  // 5. Process cards
  const importedCardIds = new Set<string>(); // Trello card IDs that we imported

  const openCards = board.cards.filter((c) => !c.closed);
  console.log(`  Processing ${openCards.length} open cards...`);

  for (const card of openCards) {
    const topicId = listIdToTopicId.get(card.idList);
    if (!topicId) {
      // List was skipped (Guide/no mapping)
      continue;
    }

    // Idempotency check
    const { data: existing, error: existErr } = await admin
      .from("cards")
      .select("id")
      .eq("project_id", projectId)
      .filter("properties->>trello_card_id", "eq", card.id)
      .maybeSingle();
    if (existErr) {
      console.error(`  ✗ Error checking card "${card.name}": ${existErr.message}`);
      continue;
    }

    let cardId: string;
    let isNew = false;

    if (existing) {
      cardId = existing.id;
      summary.cardsSkipped++;
    } else {
      // Generate slug
      let baseSlug = slugify(card.name);
      if (!baseSlug) baseSlug = `trello-${card.id.slice(0, 8)}`;

      // Deduplicate slug within project
      let slug = baseSlug;
      let attempt = 1;
      while (true) {
        const { data: slugCheck } = await admin
          .from("cards")
          .select("id")
          .eq("project_id", projectId)
          .eq("slug", slug)
          .maybeSingle();
        if (!slugCheck) break;
        attempt++;
        slug = `${baseSlug}-${attempt}`;
      }

      const summary200 = card.desc ? card.desc.slice(0, 200) : null;
      const createdAt = card.dateLastActivity ?? new Date().toISOString();

      const { data: inserted, error: insertErr } = await admin
        .from("cards")
        .insert({
          project_id: projectId,
          topic_id: topicId,
          title: card.name,
          slug,
          current_summary: summary200 || null,
          properties: {
            trello_card_id: card.id,
            trello_url: card.shortUrl ?? null,
          } as unknown as Database["public"]["Tables"]["cards"]["Insert"]["properties"],
          created_by_staff_id: wilsonId,
          created_at: createdAt,
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error(`  ✗ Failed to insert card "${card.name}": ${insertErr.message}`);
        continue;
      }

      cardId = inserted.id;
      isNew = true;
      summary.cardsCreated++;
    }

    importedCardIds.add(card.id);

    // Check if we should insert events (skip if card already has import events)
    if (!isNew) {
      const { data: existingEvents } = await admin
        .from("card_events")
        .select("id")
        .eq("card_id", cardId)
        .eq("source_kind", "import")
        .limit(1);
      if (existingEvents && existingEvents.length > 0) {
        // Already has import events — skip all event imports for this card
        continue;
      }
    }

    const occurredAt = card.dateLastActivity ?? new Date().toISOString();

    // Event: note (card.desc)
    if (card.desc && card.desc.trim().length > 0) {
      const { error: evErr } = await admin.from("card_events").insert({
        card_id: cardId,
        project_id: projectId,
        event_kind: "note",
        payload: { body: card.desc } as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
        occurred_at: occurredAt,
        logged_by_staff_id: wilsonId,
        source_kind: "import",
        cost_visible: false,
      });
      if (evErr) {
        console.error(`  ✗ note event for "${card.name}": ${evErr.message}`);
      } else {
        summary.eventsInserted++;
      }
    }

    // Event: pending (due date)
    if (card.due && !card.dueComplete) {
      const { error: evErr } = await admin.from("card_events").insert({
        card_id: cardId,
        project_id: projectId,
        event_kind: "pending",
        payload: { what: `Due (Trello): ${card.due}` } as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
        occurred_at: card.due,
        logged_by_staff_id: wilsonId,
        source_kind: "import",
        cost_visible: false,
      });
      if (evErr) {
        console.error(`  ✗ pending/due event for "${card.name}": ${evErr.message}`);
      } else {
        summary.eventsInserted++;
      }
    }

    // Events: document (attachments)
    for (const att of card.attachments ?? []) {
      if (!att.url) continue;
      const { error: evErr } = await admin.from("card_events").insert({
        card_id: cardId,
        project_id: projectId,
        event_kind: "document",
        payload: {
          title: att.name ?? "Lampiran Trello",
          notes: att.url,
          doc_type: att.mimeType ?? "",
        } as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
        occurred_at: att.date ?? occurredAt,
        logged_by_staff_id: wilsonId,
        source_kind: "import",
        cost_visible: false,
      });
      if (evErr) {
        console.error(`  ✗ document event for "${card.name}": ${evErr.message}`);
      } else {
        summary.eventsInserted++;
      }
    }

    // Events: pending (checklist items)
    for (const clId of card.idChecklists ?? []) {
      const cl = checklistMap.get(clId);
      if (!cl) continue;
      for (const item of cl.checkItems ?? []) {
        const { error: evErr } = await admin.from("card_events").insert({
          card_id: cardId,
          project_id: projectId,
          event_kind: "pending",
          payload: { what: `[${item.state}] ${item.name}` } as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
          occurred_at: occurredAt,
          logged_by_staff_id: wilsonId,
          source_kind: "import",
          cost_visible: false,
        });
        if (evErr) {
          console.error(`  ✗ checklist event for "${card.name}": ${evErr.message}`);
        } else {
          summary.eventsInserted++;
        }
      }
    }

    // Small rate-limit buffer every 10 cards
    if (summary.cardsCreated % 10 === 0 && summary.cardsCreated > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // 6. Process comments
  const commentActions = board.actions.filter(
    (a) => a.type === "commentCard" && a.data?.card?.id && importedCardIds.has(a.data.card.id),
  );
  console.log(`  Processing ${commentActions.length} comments for imported cards...`);

  // Build a local card lookup: trello card id → datum card id
  // Re-query all imported cards for this project
  const { data: importedCardsInDb } = await admin
    .from("cards")
    .select("id, properties")
    .eq("project_id", projectId)
    .not("properties->>trello_card_id", "is", null);

  const trelloIdToDatumCardId = new Map<string, string>();
  for (const row of importedCardsInDb ?? []) {
    const props = row.properties as Record<string, unknown>;
    const trelloId = props?.trello_card_id as string | undefined;
    if (trelloId) trelloIdToDatumCardId.set(trelloId, row.id);
  }

  for (const action of commentActions) {
    const trelloCardId = action.data.card!.id;
    const datumCardId = trelloIdToDatumCardId.get(trelloCardId);
    if (!datumCardId) continue;

    const body = action.data.text ?? "";
    if (!body.trim()) continue;

    // Idempotency: check body equality
    const { data: existingComment } = await admin
      .from("card_comments")
      .select("id")
      .eq("card_id", datumCardId)
      .eq("body", body)
      .maybeSingle();

    if (existingComment) continue;

    const { error: commentErr } = await admin.from("card_comments").insert({
      card_id: datumCardId,
      project_id: projectId,
      body,
      mentions: [],
      created_by_staff_id: wilsonId,
      created_at: action.date,
    });

    if (commentErr) {
      console.error(`  ✗ comment insert error: ${commentErr.message}`);
    } else {
      summary.commentsInserted++;
    }
  }

  return summary;
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Trello import — Slice 1.7");
  console.log("=========================");

  // Look up Wilson's staff ID
  const { data: staffRows, error: staffErr } = await admin
    .from("staff")
    .select("id, full_name")
    .eq("full_name", "Wilson Harkhono");
  if (staffErr) throw staffErr;
  const wilsonId = staffRows?.[0]?.id;
  if (!wilsonId) {
    throw new Error("Wilson Harkhono staff row not found — run seed-pilot.ts first");
  }
  console.log(`Wilson staff_id: ${wilsonId.slice(0, 8)}...`);

  const results: Record<string, Summary> = {};

  for (const { jsonPath, projectCode } of IMPORTS) {
    try {
      results[projectCode] = await importProject(jsonPath, projectCode, wilsonId);
    } catch (err) {
      console.error(`\n✗ Fatal error importing ${projectCode}:`, err);
    }
  }

  // Summary
  console.log("\n══════════ IMPORT SUMMARY ══════════");
  for (const [code, s] of Object.entries(results)) {
    console.log(`\n${code}:`);
    console.log(`  Topics created:   ${s.topicsCreated}`);
    console.log(`  Cards created:    ${s.cardsCreated}`);
    console.log(`  Cards skipped:    ${s.cardsSkipped}`);
    console.log(`  Events inserted:  ${s.eventsInserted}`);
    console.log(`  Comments inserted: ${s.commentsInserted}`);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
