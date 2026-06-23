import { useEffect, useState } from "react";
import { View } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { Text } from "./Text";

export function OfflineBanner() {
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(() => setOnline(onlineManager.isOnline())), []);
  if (online) return null;
  return (
    <View className="bg-warning-bg px-4 py-1">
      <Text className="text-[12px] text-warning">Mode luring — menampilkan data tersimpan.</Text>
    </View>
  );
}
