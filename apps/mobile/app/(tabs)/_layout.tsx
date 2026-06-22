/**
 * Tabs layout.
 *
 * The Inbox tab carries a live unread-notification badge sourced from
 * useUnreadCount(staffId) + realtime invalidation via useNotificationsRealtime.
 * Guards on missing session so it never crashes pre-login.
 */

import { Tabs } from "expo-router";
import { useUnreadCount } from "@/lib/query/hooks";
import { useNotificationsRealtime } from "@/lib/realtime/useRealtimeInvalidation";
import { useSession } from "@/lib/session/session";

/** Returns the live unread badge value (undefined = no badge). */
function useInboxBadge(): number | undefined {
  const { staff } = useSession();
  const staffId = staff?.id;

  // Keep count live via realtime channel
  useNotificationsRealtime(staffId);

  const { data: count } = useUnreadCount(staffId);

  if (!staffId || !count || count === 0) return undefined;
  return count;
}

export default function TabsLayout() {
  const badge = useInboxBadge();

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(matrix)" options={{ title: "Matrix" }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarBadge: badge,
        }}
      />
      <Tabs.Screen name="assistant" options={{ title: "Asisten" }} />
      <Tabs.Screen name="(more)" options={{ title: "Lainnya" }} />
    </Tabs>
  );
}
