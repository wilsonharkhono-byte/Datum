/**
 * pick-and-upload.ts — mobile photo attachment helpers.
 *
 * Two exports:
 *   pickImageAsset()            – request permission → launch picker → return asset info
 *   uploadCardAttachment(...)   – validate → upload to Supabase Storage → insert row
 *
 * RN blob pattern: `fetch(fileUri).then(r => r.blob())` is the reliable approach
 * for reading a file:// or content:// URI into an uploadable blob. This is
 * verified on-device only; Jest mocks global `fetch` to return a fake blob.
 *
 * Best-effort design: permission denied → null, cancel → null, upload/DB error →
 * readable PickAndUploadResult, never throws. The calling form must still create
 * the card event regardless of what this module returns.
 */

import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import {
  attachmentStoragePath,
  attachToEvent,
  attachmentSkipReason,
} from "@datum/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PickedAsset = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export type PickAndUploadResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }   // oversize / unsupported — soft skip
  | { ok: false; skipped?: false; error: string };  // upload or DB error — warn user

// ─── pickImageAsset ───────────────────────────────────────────────────────────

/**
 * Request media-library permission and open the image picker.
 *
 * Returns null on permission denied, user cancel, or empty result.
 * Returns a PickedAsset on success.
 */
export async function pickImageAsset(): Promise<PickedAsset | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.85,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0]!;
  return {
    uri: asset.uri,
    name: asset.fileName ?? `foto-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? "image/jpeg",
    size: asset.fileSize ?? 0,
  };
}

// ─── uploadCardAttachment ─────────────────────────────────────────────────────

/**
 * Upload a picked asset to the "card-attachments" Supabase Storage bucket and
 * insert a card_attachments row via core attachToEvent.
 *
 * Storage path mirrors the web convention (via core attachmentStoragePath) so
 * the analyze-attachments cron picks up mobile uploads automatically.
 *
 * @param supabase  Anon client — RLS-scoped to the current session.
 * @param args      cardId / projectId / cardEventId identify the event;
 *                  asset is the output of pickImageAsset().
 */
export async function uploadCardAttachment(
  supabase: SupabaseClient<Database>,
  args: {
    projectId: string;
    cardId: string;
    cardEventId: string;
    asset: PickedAsset;
  },
): Promise<PickAndUploadResult> {
  const { projectId, cardId, cardEventId, asset } = args;

  // 1. Guard: skip unsupported MIME or files that exceed 20 MB.
  const skipReason = attachmentSkipReason(asset.mimeType, asset.size);
  if (skipReason === "oversize") {
    return {
      ok: false,
      skipped: true,
      reason: "File terlalu besar (maks. 20 MB). Lampiran tidak disimpan.",
    };
  }
  if (skipReason === "unsupported") {
    return {
      ok: false,
      skipped: true,
      reason: `Tipe file tidak didukung (${asset.mimeType}). Lampiran tidak disimpan.`,
    };
  }

  // 2. Build the storage path with a fresh UUID.
  const uuid = Crypto.randomUUID();
  const storagePath = attachmentStoragePath({
    projectId,
    cardId,
    cardEventId,
    fileName: asset.name,
    uuid,
  });

  // 3. Read the file as a Blob.
  //    fetch(file://...).blob() is the standard RN pattern for local URIs.
  //    Jest mocks global fetch to return a fake Blob — verified on-device for real uploads.
  let blob: Blob;
  try {
    const response = await fetch(asset.uri);
    blob = await response.blob();
  } catch (e) {
    return {
      ok: false,
      error: `Gagal membaca file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 4. Upload to Supabase Storage bucket "card-attachments".
  const { error: upErr } = await supabase.storage
    .from("card-attachments")
    .upload(storagePath, blob, {
      contentType: asset.mimeType,
      upsert: false,
    });

  if (upErr) {
    return {
      ok: false,
      error: `Upload gagal: ${upErr.message}`,
    };
  }

  // 5. Insert the card_attachments row (sets ai_status="pending" by DB default).
  const attachRes = await attachToEvent(supabase, {
    cardEventId,
    storagePath,
    mimeType: asset.mimeType,
  });

  if (!attachRes.ok) {
    return {
      ok: false,
      error: `Simpan lampiran gagal: ${attachRes.error}`,
    };
  }

  return { ok: true };
}
