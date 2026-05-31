"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type UploadResult =
  | { ok: true; storagePath: string; mimeType: string }
  | { ok: false; error: string };

export async function uploadCardAttachment(args: {
  file: File;
  projectId: string;
  cardId: string;
  cardEventId: string;
}): Promise<UploadResult> {
  const supabase = createSupabaseBrowserClient();
  const safeName = args.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${args.projectId}/${args.cardId}/${args.cardEventId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("card-attachments")
    .upload(path, args.file, {
      contentType: args.file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true, storagePath: path, mimeType: args.file.type || "application/octet-stream" };
}
