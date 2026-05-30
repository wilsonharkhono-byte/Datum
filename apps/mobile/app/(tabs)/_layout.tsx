import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="matrix" options={{ title: "Matrix" }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
      <Tabs.Screen name="assistant" options={{ title: "Asisten" }} />
      <Tabs.Screen name="more" options={{ title: "Lainnya" }} />
    </Tabs>
  );
}
