import { View } from "react-native";
import { Text } from "./Text";

export function EmptyState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text variant="secondary" className="text-center">{message}</Text>
    </View>
  );
}
