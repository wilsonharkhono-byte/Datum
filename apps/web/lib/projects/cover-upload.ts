"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type CoverUploadResult =
  | { ok: true; storagePath: string }
  | { ok: false; error: string };

export async function uploadProjectCover(args: {
  file: File;
  projectId: string;
}): Promise<CoverUploadResult> {
  const supabase = createSupabaseBrowserClient();
  const safeName = args.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${args.projectId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("project-covers")
    .upload(path, args.file, {
      contentType: args.file.type || "image/jpeg",
      upsert: false,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true, storagePath: path };
}
