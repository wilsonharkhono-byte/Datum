/**
 * MemberRow — renders a single project_staff row in the members list.
 *
 * Shows the staff name, their global role, their role on this project,
 * and (if canManage is true) a "Hapus" remove button.
 *
 * The remove tap calls onRemove — the parent owns the confirmation dialog
 * (Alert.alert) so this component stays pure/testable.
 */

import { View, Pressable } from "react-native";
import type { ProjectMemberRow } from "@datum/core";
import { Text } from "@/components/ui/Text";

// ─── Role labels ──────────────────────────────────────────────────────────────

const GLOBAL_ROLE_LABEL: Record<string, string> = {
  principal: "Principal",
  designer: "Desainer",
  pic: "PIC",
  site_supervisor: "Supervisor",
  admin: "Admin",
  estimator: "Estimator",
};

export function fmtRole(role: string | null | undefined): string {
  if (!role) return "—";
  return GLOBAL_ROLE_LABEL[role] ?? role;
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  member: ProjectMemberRow;
  canManage: boolean;
  onRemove: (member: ProjectMemberRow) => void;
};

export function ProjectMemberRow({ member, canManage, onRemove }: Props) {
  const name = member.staff?.full_name ?? `Staff ${member.staff_id.slice(0, 6)}`;
  const globalRole = fmtRole(member.staff?.role);
  const projectRole = member.role_on_project || "—";
  const since = member.active_from ? member.active_from.slice(0, 10) : "—";

  return (
    <View className="mb-2 rounded border border-border/40 bg-surface px-3 py-2.5">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-[14px] font-medium text-text">{name}</Text>
          <Text className="mt-0.5 text-[12px] text-text-sec">
            {globalRole} · {projectRole}
          </Text>
          <Text className="mt-0.5 text-[11px] text-text-muted">Sejak {since}</Text>
        </View>

        {canManage ? (
          <Pressable
            onPress={() => onRemove(member)}
            hitSlop={8}
            className="rounded px-2.5 py-1 active:bg-critical/10"
            accessibilityLabel={`Hapus ${name} dari proyek`}
          >
            <Text className="text-[13px] text-critical">Hapus</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
