import { View } from "react-native";

export function Skeleton({ className = "" }: { className?: string }) {
  return <View className={`rounded bg-surface-alt opacity-70 ${className}`} accessibilityLabel="Memuat" />;
}
