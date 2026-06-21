import { Pressable, View, Alert } from "react-native";
import { router } from "expo-router";
import { Text } from "@/components/ui/Text";
import { DeadlineChip } from "./DeadlineChip";
import type { CardWithLabels, CardLabelKind, BoardCardView } from "@datum/core";

// Map label kinds to NativeWind Tailwind classes.
// Never use var(--...) strings in React Native — use explicit class names.
const LABEL_BG: Record<CardLabelKind, string> = {
  blocked:        "bg-high-bg",
  needs_decision: "bg-warning-bg",
  awaiting:       "bg-info-bg",
  pending:        "bg-surface-alt",
  done:           "bg-ok-bg",
};
const LABEL_FG: Record<CardLabelKind, string> = {
  blocked:        "text-high",
  needs_decision: "text-warning",
  awaiting:       "text-info",
  pending:        "text-text-muted",
  done:           "text-ok",
};

type MiniCardProps = {
  card: CardWithLabels & { __optimistic?: boolean };
  projectCode: string;
  todayStr?: string; // injected for tests
};

export function MiniCard({ card, projectCode, todayStr }: MiniCardProps) {
  const isOptimistic = card.id.startsWith("optimistic:") || !!(card as BoardCardView).__optimistic;

  const inner = (
    <View className={`min-h-[44px] rounded border border-border bg-surface px-2 py-1.5 ${isOptimistic ? "opacity-70" : ""}`}>
      {/* Labels row */}
      {(card.labels.length > 0 || card.deadline != null) && (
        <View className="mb-1 flex-row flex-wrap gap-1">
          {card.labels.map((l) => (
            <View
              key={`${l.kind}-${l.label}`}
              className={`self-start rounded-sm px-1.5 py-0.5 ${LABEL_BG[l.kind]}`}
            >
              <Text className={`text-[9px] font-bold uppercase tracking-widest ${LABEL_FG[l.kind]}`}>
                {l.label}
              </Text>
            </View>
          ))}
          {card.deadline != null && (
            <DeadlineChip deadline={card.deadline} todayStr={todayStr} />
          )}
        </View>
      )}

      {/* Title */}
      <Text className="text-[13px] font-medium text-text">{card.title}</Text>

      {/* Summary */}
      {card.current_summary != null && (
        <Text numberOfLines={2} className="mt-0.5 text-[11px] text-text-sec">
          {card.current_summary}
        </Text>
      )}

      {/* Last event date */}
      {card.last_event_at != null && (
        <Text className="mt-0.5 text-[10px] text-text-muted">
          {new Date(card.last_event_at).toLocaleDateString("id-ID", { dateStyle: "medium" })}
        </Text>
      )}

      {/* Trello badge */}
      {(card.properties as { trello_card_id?: string } | null)?.trello_card_id != null && (
        <View className="mt-1 self-start rounded bg-surface-alt px-1.5 py-0.5">
          <Text className="text-[9px] uppercase tracking-wide text-text-muted">Trello</Text>
        </View>
      )}
    </View>
  );

  if (isOptimistic) {
    return (
      <View accessibilityState={{ busy: true }} accessibilityLabel="optimistic-card">
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push(`/(tabs)/(matrix)/project/${projectCode}/card/${card.slug}` as never)}
      accessibilityRole="button"
      accessibilityLabel={card.title}
    >
      {inner}
    </Pressable>
  );
}
