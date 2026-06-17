"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { compressCoverImage } from "@/lib/projects/image-compress";

export type CoverUploadResult =
  | { ok: true; storagePath: string }
  | { ok: false; error: string };

export async function uploadProjectCover(args: {
  file: File;
  projectId: string;
}): Promise<CoverUploadResult> {
  const supabase = createSupabaseBrowserClient();
  // Downscale + re-encode so we stay under the bucket's 10 MB cap (a raw phone
  // photo easily exceeds it). On decode failure (e.g. HEIC) fall back to the
  // original and let Storage validate it.
  let file = args.file;
  try {
    file = await compressCoverImage(args.file);
  } catch {
    file = args.file;
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${args.projectId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("project-covers")
    .upload(path, file, {
      contentType: file.type || "image/webp",
      upsert: false,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true, storagePath: path };
}
