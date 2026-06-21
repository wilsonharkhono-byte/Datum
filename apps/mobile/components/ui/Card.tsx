import { type ReactNode } from "react";
import { View, Pressable } from "react-native";

export function Card({ children, onPress, className = "" }: { children: ReactNode; onPress?: () => void; className?: string }) {
  const base = "bg-surface rounded border border-border/40 p-4";
  if (onPress) return <Pressable onPress={onPress} className={`${base} active:opacity-80 ${className}`}>{children}</Pressable>;
  return <View className={`${base} ${className}`}>{children}</View>;
}
