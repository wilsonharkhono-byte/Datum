/**
 * add-to-card.ts — share-sheet orchestration.
 *
 * One photo event carries the whole shared batch (note → payload.caption),
 * then each image uploads via the existing uploadCardAttachment pipeline
 * (validation → Storage → card_attachments row → AI-caption cron).
 * Uploads run sequentially: site photos are large and RN blob memory is finite.
 * Best-effort per asset — one bad image never aborts the batch (matches
 * AddEventForm's never-block-the-event design).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { createCard, createCardEvent } from "@datum/core";
import {
  uploadCardAttachment,
  type PickedAsset,
} from "@/lib/attachments/pick-and-upload";

export type ShareUploadOutcome = {
  eventId: string;
  uploaded: number;
  skipped: { name: string; reason: string }[];
  failed: { name: string; error: string }[];
};

export type ShareToCardResult =
  | { ok: true; cardId: string; cardSlug: string; outcome: ShareUploadOutcome }
  | { ok: false; error: string };

type Client = SupabaseClient<Database>;

export async function shareToExistingCard(
  supabase: Client,
  args: {
    projectId: string;
    cardId: string;
    cardSlug: string;
    note?: string;
    assets: PickedAsset[];
    loggedByStaffId: string;
  },
): Promise<ShareToCardResult> {
  const caption = args.note?.trim();
  const ev = await createCardEvent(supabase, {
    cardId: args.cardId,
    projectId: args.projectId,
    eventKind: "photo",
    payload: caption ? { caption } : {},
    loggedByStaffId: args.loggedByStaffId,
  });
  if (!ev.ok) return { ok: false, error: ev.error };

  const outcome: ShareUploadOutcome = {
    eventId: ev.eventId, uploaded: 0, skipped: [], failed: [],
  };
  for (const asset of args.assets) {
    const res = await uploadCardAttachment(supabase, {
      projectId: args.projectId,
      cardId: args.cardId,
      cardEventId: ev.eventId,
      asset,
    });
    if (res.ok) outcome.uploaded += 1;
    else if ("skipped" in res && res.skipped)
      outcome.skipped.push({ name: asset.name, reason: res.reason });
    else outcome.failed.push({ name: asset.name, error: res.error });
  }
  return { ok: true, cardId: args.cardId, cardSlug: args.cardSlug, outcome };
}

export async function shareToNewCard(
  supabase: Client,
  args: {
    projectId: string;
    topicId: string;
    title: string;
    note?: string;
    assets: PickedAsset[];
    loggedByStaffId: string;
  },
): Promise<ShareToCardResult> {
  const card = await createCard(supabase, {
    projectId: args.projectId,
    topicId: args.topicId,
    title: args.title,
  });
  if (!card.ok) return { ok: false, error: card.error };
  return shareToExistingCard(supabase, {
    projectId: args.projectId,
    cardId: card.id,
    cardSlug: card.slug,
    note: args.note,
    assets: args.assets,
    loggedByStaffId: args.loggedByStaffId,
  });
}
