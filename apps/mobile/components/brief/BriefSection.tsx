/**
 * BriefSection — one collapsible section card from BriefData
 * (pendingDrafts, blockers, defects, decisionsNeeded, awaitingClient,
 * expiringQuotes).
 *
 * Shows: heading with count badge, list of BriefItems (tap → card), and an
 * empty-state message when count === 0.
 */

import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/Text";
import type { BriefItem } from "@datum/core";

// ─── Item row ─────────────────────────────────────────────────────────────────

function BriefItemRow({ item }: { item: BriefItem }) {
  const router = useRouter();

  // Translate the web href (/project/CODE/cards/SLUG) to the mobile deep-link
  // (/(tabs)/(matrix)/project/CODE/card/SLUG).
  function handlePress() {
    if (item.cardHref === "#" || item.cardHref === "/review") {
      // drafts go to review tab; everything else is a card
      router.push("/(tabs)/(matrix)/review" as any);
      return;
    }
    // Extract projectCode + cardSlug from "/project/CODE/cards/SLUG"
    const match = item.cardHref.match(/^\/project\/([^/]+)\/cards\/(.+)$/);
    if (match) {
      router.push(`/(tabs)/(matrix)/project/${match[1]}/card/${match[2]}` as any);
    }
  }

  return (
    <Pressable
      testID={`brief-item-${item.id}`}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={item.cardTitle}
      className="mb-2 rounded border border-border/40 bg-surface p-3 active:opacity-75"
    >
      {/* Top row: project code + meta age */}
      <View className="mb-1 flex-row items-center justify-between">
        <View className="rounded-sm bg-bg-oat px-2 py-0.5">
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-text-sec">
            {item.projectCode}
          </Text>
        </View>
        <Text className="text-[11px] text-text-muted">{item.meta}</Text>
      </View>

      {/* Card title */}
      <Text numberOfLines={2} className="text-[13px] font-medium text-text">
        {item.cardTitle}
      </Text>

      {/* Detail */}
      {item.detail ? (
        <Text numberOfLines={2} className="mt-0.5 text-[12px] text-text-sec">
          {item.detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export type BriefSectionProps = {
  title: string;
  emoji: string;
  count: number;
  items: BriefItem[];
  emptyMessage: string;
};

export function BriefSection({
  title,
  emoji,
  count,
  items,
  emptyMessage,
}: BriefSectionProps) {
  return (
    <View className="mb-4 rounded border border-border/40 bg-surface p-3">
      {/* Section heading */}
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-[13px] font-semibold uppercase tracking-wide text-text">
          {emoji} {title}
        </Text>
        <View
          className={`rounded-sm px-2 py-0.5 ${count > 0 ? "bg-high-bg" : "bg-bg-oat"}`}
        >
          <Text
            className={`text-[11px] font-semibold tabular-nums ${count > 0 ? "text-high" : "text-text-muted"}`}
          >
            {count}
          </Text>
        </View>
      </View>

      {/* Items or empty state */}
      {items.length === 0 ? (
        <View className="rounded border border-dashed border-border/40 p-4">
          <Text variant="secondary" className="italic">
            {emptyMessage}
          </Text>
        </View>
      ) : (
        <View>
          {items.map((it) => (
            <BriefItemRow key={it.id} item={it} />
          ))}
        </View>
      )}
    </View>
  );
}
