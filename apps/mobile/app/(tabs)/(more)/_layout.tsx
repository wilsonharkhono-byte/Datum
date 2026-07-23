import { Stack } from "expo-router";
import { COLORS } from "@datum/core";

/** More stack — same themed header treatment as the Matrix stack. */
export default function MoreLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: COLORS.surface },
        headerTintColor: COLORS.text,
        headerTitleStyle: {
          fontFamily: "SpaceGrotesk_600SemiBold",
          fontSize: 15,
          color: COLORS.text,
        },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Lainnya" }} />
    </Stack>
  );
}
