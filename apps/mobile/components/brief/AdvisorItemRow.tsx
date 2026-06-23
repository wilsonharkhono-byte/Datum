/**
 * AdvisorItemRow — one ranked item in the Hari Ini advisor feed.
 *
 * Severity mapping (AdvisorItemType → SANO Flag):
 *   gate_overdue, blocker          → critical
 *   cascade_risk, decision_needed,
 *   schedule_rot                   → high
 *   gate_soon, gate_ready,
 *   awaiting_client, quote_expiring → warning
 *   stale_card                     → info
 */

import { View, Pressable } from "react-native";
import { Text } from "@/components/ui/Text";
import { Badge, type Flag } from "@/components/ui/Badge";
import type { AdvisorItem, AdvisorItemType } from "@datum/core";

// ─── Type → SANO flag ────────────────────────────────────────────────────────

const TYPE_FLAG: Record<AdvisorItemType, Flag> = {
  gate_overdue:     "critical",
  blocker:          "critical",
  cascade_risk:     "high",
  decision_needed:  "high",
  schedule_rot:     "high",
  gate_soon:        "warning",
  gate_ready:       "warning",
  awaiting_client:  "warning",
  quote_expiring:   "warning",
  stale_card:       "info",
};

// Short Bahasa label shown in the badge.
const TYPE_LABEL: Record<AdvisorItemType, string> = {
  gate_overdue:    "Lewat",
  blocker:         "Blokir",
  cascade_risk:    "Risiko",
  decision_needed: "Keputusan",
  schedule_rot:    "Jadwal",
  gate_soon:       "Gate",
  gate_ready:      "Siap",
  awaiting_client: "Klien",
  quote_expiring:  "Quote",
  stale_card:      "Stagnan",
};

// ─── Component ────────────────────────────────────────────────────────────────

export type AdvisorItemRowProps = {
  item: AdvisorItem;
  rank: number;
  onPress: () => void;
};

export function AdvisorItemRow({ item, rank, onPress }: AdvisorItemRowProps) {
  const flag = TYPE_FLAG[item.type];
  const typeLabel = TYPE_LABEL[item.type];

  return (
    <Pressable
      testID={`advisor-row-${item.type}-${rank}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      className="mb-2 flex-row items-start gap-3 rounded border border-border/40 bg-surface p-3 active:opacity-75"
    >
      {/* Rank number */}
      <Text className="w-5 shrink-0 text-right text-[13px] font-semibold tabular-nums text-text-muted">
        {rank}
      </Text>

      {/* Content */}
      <View className="min-w-0 flex-1 gap-1">
        {/* Title — allow 2 lines on mobile */}
        <Text
          numberOfLines={2}
          className="text-[14px] font-medium text-text"
        >
          {item.title}
        </Text>

        {/* Detail */}
        {item.detail ? (
          <Text numberOfLines={1} className="text-[12px] text-text-sec">
            {item.detail}
          </Text>
        ) : null}

        {/* Bottom row: project chip + age/due label */}
        <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
          <View className="rounded-sm bg-bg-oat px-2 py-0.5">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-text-sec">
              {item.projectCode}
            </Text>
          </View>
          {item.dueLabel ? (
            <Text className="text-[11px] text-text-muted">{item.dueLabel}</Text>
          ) : null}
        </View>
      </View>

      {/* Severity badge (right side) */}
      <Badge flag={flag} label={typeLabel} />
    </Pressable>
  );
}
