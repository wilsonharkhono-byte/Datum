import { View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session/session";

export default function MoreScreen() {
  const { staff, signOut } = useSession();
  return (
    <Screen className="gap-4">
      <View className="gap-1">
        <Text variant="heading">{staff?.full_name ?? "-"}</Text>
        <Text variant="muted">{staff?.role ?? ""}</Text>
      </View>
      <Button label="Keluar" onPress={signOut} />
    </Screen>
  );
}
