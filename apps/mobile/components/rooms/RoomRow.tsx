/**
 * RoomRow — one urgency-sorted room in the Rooms glance list.
 *
 * Shows: area name + floor, stage gate pill, blocker count badge,
 * next-action hint, and relative last-activity time. Maps RoomStage status
 * to SANO flag tokens (no raw hex colours).
 */

import { View, Pressable } from "react-native";
import { Text } from "@/components/ui/Text";
import { Badge, type Flag } from "@/components/ui/Badge";
import type { Room, RoomStage } from "@datum/core";

// ─── SANO flag mapping ────────────────────────────────────────────────────────

function stageFlag(stage: RoomStage, blockers: number): Flag {
  if (blockers > 0) return "critical";
  if (stage.kind === "active") {
    return stage.status === "blocked" ? "critical" : "warning";
  }
  if (stage.kind === "passed") return "ok";
  return "high"; // none — not started
}

function stageLabel(stage: RoomStage, blockers: number): string {
  if (blockers > 0) return `${blockers} blocker`;
  if (stage.kind === "active") {
    return stage.status === "blocked"
      ? `Gate ${stage.gate} terblokir`
      : `Gate ${stage.gate} berjalan`;
  }
  if (stage.kind === "passed") return `Gate ${stage.gate} selesai`;
  return "Belum mulai";
}

function actionFlag(tone: Room["action"]["tone"]): Flag {
  const map: Record<Room["action"]["tone"], Flag> = {
    urgent: "critical",
    active: "warning",
    ready: "ok",
    idle: "info",
  };
  return map[tone];
}

// ─── RoomRow ─────────────────────────────────────────────────────────────────

type Props = {
  room: Room;
  relTime: string | null;
  onPress?: () => void;
  testID?: string;
};

export function RoomRow({ room, relTime, onPress, testID }: Props) {
  const flag = stageFlag(room.stage, room.blockers);
  const label = stageLabel(room.stage, room.blockers);

  return (
    <Pressable
      onPress={onPress}
      className="mb-2 rounded border border-border/40 bg-surface px-3 py-3 active:opacity-80"
      accessibilityRole="button"
      accessibilityLabel={`${room.areaName}, ${label}`}
      testID={testID}
    >
      {/* Row 1: area name + floor + stage badge */}
      <View className="flex-row items-start gap-2">
        <View className="flex-1 min-w-0">
          <Text className="text-[15px] font-semibold text-text" numberOfLines={1}>
            {room.areaName}
          </Text>
          {room.floor ? (
            <Text className="text-[12px] text-text-muted">{room.floor}</Text>
          ) : null}
        </View>
        <Badge flag={flag} label={label} />
      </View>

      {/* Row 2: next-action hint */}
      <View className="mt-1.5 flex-row items-center gap-2">
        <View
          className="flex-1 min-w-0 rounded-sm px-2 py-0.5"
          style={undefined}
        >
          <Badge flag={actionFlag(room.action.tone)} label={room.action.text} />
        </View>
      </View>

      {/* Row 3: cards + last activity */}
      <View className="mt-1.5 flex-row items-center gap-3">
        {room.activeCards > 0 ? (
          <Text className="text-[12px] text-text-muted">
            {room.activeCards} kartu aktif
          </Text>
        ) : null}
        {relTime ? (
          <Text className="text-[12px] text-text-muted">{relTime}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
