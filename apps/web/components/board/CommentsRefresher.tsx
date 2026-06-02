"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function CommentsRefresher({ cardId }: { cardId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const ch = supabase
      .channel(`card-comments:${cardId}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "card_comments", filter: `card_id=eq.${cardId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [cardId, router]);
  return null;
}
