import { View } from "react-native";
import { Text } from "@/components/ui/Text";
import type { CardDeadline } from "@datum/core";

/** Helper isolated so tests can mock it cleanly. */
export function getJakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

type Tier = "critical" | "warning" | "sand";

const BG: Record<Tier, string> = {
  critical: "bg-critical-bg",
  warning: "bg-warning-bg",
  sand: "bg-surface-alt",
};
const FG: Record<Tier, string> = {
  critical: "text-critical",
  warning: "text-warning",
  sand: "text-text-muted",
};

/**
 * Compact gate-deadline chip: "B lewat 3 hari" / "B hari ini" / "B · 12 hari".
 * Uses WIB (Asia/Jakarta) calendar-day semantics.
 */
export function DeadlineChip({ deadline, todayStr }: { deadline: CardDeadline; todayStr?: string }) {
  const today = todayStr ?? getJakartaToday();
  const daysLeft = Math.round(
    (Date.parse(deadline.targetEndDate) - Date.parse(today)) / 86_400_000,
  );
  const overdue = daysLeft < 0;
  const urgent = !overdue && daysLeft <= 14;
  const tier: Tier = overdue ? "critical" : urgent ? "warning" : "sand";

  const text = overdue
    ? `${deadline.gateCode} lewat ${-daysLeft} hari`
    : daysLeft === 0
      ? `${deadline.gateCode} hari ini`
      : `${deadline.gateCode} · ${daysLeft} hari`;

  return (
    <View className={`self-start rounded-sm px-1.5 py-0.5 ${BG[tier]}`}>
      <Text className={`text-[9px] font-bold uppercase tracking-widest ${FG[tier]}`}>
        {text}
      </Text>
    </View>
  );
}
