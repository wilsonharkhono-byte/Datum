/**
 * MemberRow — renders a single card_member row (with embedded staff).
 * Read-only for this slice; add/remove actions come in the next task.
 */

import { View } from "react-native";
import type { CardMemberWithStaff } from "@datum/core";
import { Text } from "@/components/ui/Text";

const ROLE_LABEL: Record<string, string> = {
  watcher: "Pengamat",
  owner: "Penanggung Jawab",
  reviewer: "Peninjau",
};

export function MemberRow({ member }: { member: CardMemberWithStaff }) {
  const name = member.staff?.full_name ?? `Staff ${member.staff_id?.slice(0, 6) ?? "?"}`;
  const role = ROLE_LABEL[member.role ?? ""] ?? member.role ?? "—";

  return (
    <View className="mb-1.5 flex-row items-center justify-between rounded border border-border/40 bg-surface px-3 py-2">
      <Text className="text-[14px] text-text">{name}</Text>
      <View className="rounded-sm bg-surface-alt px-2 py-0.5">
        <Text className="text-[11px] uppercase tracking-wide text-text-sec">{role}</Text>
      </View>
    </View>
  );
}
