/**
 * useSignedAttachmentUrl — resolve a schemeless card-attachments storage_path
 * into a signed https URL that expo-image can actually load.
 *
 * card_attachments rows store a bucket-relative `storage_path` (no scheme), so
 * feeding it straight to <Image source={{ uri }}> renders blank. Core's
 * signAttachment() mints a signed URL with a 10-minute TTL. We cache the result
 * keyed by storage path with an 8-minute staleTime — under the TTL so the URL
 * refreshes before it expires, but long enough that expo-image's uri-keyed cache
 * isn't defeated by a fresh signature on every render/remount.
 */

import { useQuery } from "@tanstack/react-query";
import { signAttachment } from "@datum/core";
import { supabase } from "@/lib/supabase/client";

/** 8 minutes — comfortably under signAttachment's 10-minute signed-URL TTL. */
const SIGNED_URL_STALE_MS = 8 * 60 * 1000;

export interface SignedAttachmentUrl {
  /** The signed https URL, or null while loading / on failure. */
  url: string | null;
  /** True while the signature is being fetched for a real storage path. */
  isLoading: boolean;
  /** True when signing failed (show a dead/paperclip tile instead of a broken image). */
  isError: boolean;
}

export function useSignedAttachmentUrl(
  storagePath: string | null | undefined,
): SignedAttachmentUrl {
  const query = useQuery({
    queryKey: ["signed-attachment", storagePath],
    enabled: !!storagePath,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_STALE_MS,
    retry: false,
    queryFn: async () => {
      const res = await signAttachment(supabase, storagePath!);
      if (!res.ok) throw new Error(res.error);
      return res.url;
    },
  });

  return {
    url: query.data ?? null,
    isLoading: !!storagePath && query.isLoading,
    isError: query.isError,
  };
}
