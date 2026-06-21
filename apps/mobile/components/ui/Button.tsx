import { Pressable, ActivityIndicator } from "react-native";
import { Text } from "./Text";

export function Button({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      className={`min-h-[44px] items-center justify-center rounded px-4 ${off ? "bg-surface-alt" : "bg-primary active:opacity-90"}`}
    >
      {loading ? <ActivityIndicator color="#FDFAF6" /> : <Text className={`text-[15px] font-medium ${off ? "text-text-muted" : "text-[#FDFAF6]"}`}>{label}</Text>}
    </Pressable>
  );
}
