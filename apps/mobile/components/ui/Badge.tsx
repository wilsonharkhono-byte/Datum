import { View } from "react-native";
import { Text } from "./Text";

export type Flag = "ok" | "info" | "warning" | "high" | "critical";
const BG: Record<Flag, string> = { ok: "bg-ok-bg", info: "bg-info-bg", warning: "bg-warning-bg", high: "bg-high-bg", critical: "bg-critical-bg" };
const FG: Record<Flag, string> = { ok: "text-ok", info: "text-info", warning: "text-warning", high: "text-high", critical: "text-critical" };

export function Badge({ flag, label }: { flag: Flag; label: string }) {
  return (
    <View className={`self-start rounded-sm px-2 py-0.5 ${BG[flag]}`}>
      <Text className={`text-[12px] font-semibold uppercase ${FG[flag]}`}>{label}</Text>
    </View>
  );
}
