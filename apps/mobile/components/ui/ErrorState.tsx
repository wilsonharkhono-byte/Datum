import { View } from "react-native";
import { Text } from "./Text";
import { Button } from "./Button";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text variant="secondary" className="text-center text-critical">{message}</Text>
      {onRetry ? <Button label="Coba lagi" onPress={onRetry} /> : null}
    </View>
  );
}
