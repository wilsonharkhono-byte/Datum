/**
 * Citation.tsx — inline citation chip for the Tanya assistant answer.
 *
 * Each [card:UUID] citation from the NDJSON stream is rendered as a tappable
 * chip that navigates to the card detail screen. When a snippet is available
 * (fetched via getCardSnippet) a brief preview is also shown inline.
 */

import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getCardSnippet, assistantKeys } from "@datum/core";
import type { Citation as CitationType } from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { Text } from "@/components/ui/Text";

// ─── CitationChip ─────────────────────────────────────────────────────────────

/**
 * A single tappable citation reference. Fetches a snippet from Supabase
 * directly (anon client) to show the card title and a few events inline.
 */
export function CitationChip({
  citation,
  index,
}: {
  citation: CitationType;
  index: number;
}) {
  const router = useRouter();

  // Fetch snippet directly with the anon client — RLS scopes to the session.
  const { data: snippet } = useQuery({
    queryKey: assistantKeys.snippet(citation.cardId, citation.eventIds),
    queryFn: () =>
      getCardSnippet(supabase, {
        cardId: citation.cardId,
        eventIds: citation.eventIds,
      }),
    staleTime: 5 * 60 * 1000,
    enabled: !!citation.cardId,
  });

  const label = snippet ? snippet.card.title : `Sumber ${index + 1}`;

  return (
    <View className="mt-1">
      <Pressable
        onPress={() => {
          if (!snippet) return;
          // Navigate to the card detail screen using expo-router path.
          // The slug is available from the snippet; project code is not available
          // from the citation alone — we push to a search-compatible path where
          // the card slug is unique per project.
          router.push(
            `/(tabs)/(matrix)/project/${snippet.card.slug.split("-")[0]}/card/${snippet.card.slug}` as never,
          );
        }}
        disabled={!snippet}
        accessibilityRole="button"
        accessibilityLabel={`Buka kartu: ${label}`}
        className="self-start rounded border border-border/50 bg-surface-alt px-2 py-0.5 active:opacity-70"
      >
        <Text className="text-[11px] font-medium text-text-sec">
          [{index + 1}] {label}
        </Text>
      </Pressable>

      {snippet && snippet.events.length > 0 && (
        <View className="ml-2 mt-1 border-l-2 border-border/30 pl-2">
          {snippet.events.slice(0, 2).map((ev) => (
            <Text
              key={ev.id}
              className="text-[10px] text-text-muted"
              numberOfLines={1}
            >
              {ev.event_kind} ·{" "}
              {new Date(ev.occurred_at).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "short",
              })}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── CitationList ─────────────────────────────────────────────────────────────

export function CitationList({ citations }: { citations: CitationType[] }) {
  if (citations.length === 0) return null;
  return (
    <View className="mt-2 gap-1">
      <Text className="text-[10px] uppercase tracking-wide text-text-muted">
        Sumber
      </Text>
      {citations.map((c, i) => (
        <CitationChip key={c.cardId} citation={c} index={i} />
      ))}
    </View>
  );
}
