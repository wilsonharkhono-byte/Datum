import { Stack } from "expo-router";
import { COLORS } from "@datum/core";

/**
 * Matrix stack. Headers carry the web app's warm surface + Space Grotesk;
 * the landing screen hides the header entirely (it has its own in-page
 * "Proyek" heading, like the web landing) — without this it titled itself
 * with the raw route name "index".
 */
export default function MatrixLayout() {
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
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
