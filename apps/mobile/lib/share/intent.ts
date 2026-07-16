/**
 * intent.ts — pure decision + mapping helpers for the share intent flow.
 * Kept free of the native expo-share-intent module so Jest covers them
 * without native mocks. The provider holds the intent while the user logs
 * in; redirect only fires once authenticated (resume-after-login).
 */
import type { PickedAsset } from "@/lib/attachments/pick-and-upload";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export function shouldRedirectToShare(input: {
  hasShareIntent: boolean;
  status: SessionStatus;
  firstSegment: string | undefined;
}): boolean {
  return (
    input.hasShareIntent &&
    input.status === "authenticated" &&
    input.firstSegment !== "share"
  );
}

/**
 * Minimal structural type for expo-share-intent files (v7).
 *
 * The public `ShareIntentFile` (v7 build/ExpoShareIntentModule.types.d.ts) is
 * `{ fileName; mimeType; path; size: number | null; width; height; duration }`.
 * The size field is named `size` (the iOS-only native type uses `fileSize`, but
 * that is normalized to `size` by the time it reaches useShareIntentContext).
 * `fileSize` is read as a defensive fallback anyway.
 */
export type ShareIntentFileLike = {
  path: string;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  fileSize?: number | null;
};

export function sharedFilesToAssets(
  files: ShareIntentFileLike[] | null | undefined,
): PickedAsset[] {
  if (!files) return [];
  return files
    .filter((f) => (f.mimeType ?? "").startsWith("image/"))
    .map((f) => ({
      uri: f.path,
      name: f.fileName ?? `foto-${Date.now()}.jpg`,
      mimeType: f.mimeType ?? "image/jpeg",
      size: f.size ?? f.fileSize ?? 0,
    }));
}
