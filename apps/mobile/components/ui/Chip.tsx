import { View } from "react-native";
import { Text } from "./Text";

export function Chip({ label }: { label: string }) {
  return (
    <View className="self-start rounded-sm border border-border/50 bg-surface-alt px-2 py-0.5">
      <Text className="text-[12px] text-text-sec">{label}</Text>
    </View>
  );
}
