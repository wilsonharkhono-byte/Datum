/**
 * Tabs layout.
 *
 * The Inbox tab carries a live unread-notification badge sourced from
 * useUnreadCount(staffId) + realtime invalidation via useNotificationsRealtime.
 * Guards on missing session so it never crashes pre-login.
 *
 * Visuals mirror the web app: warm surface tab bar, Space Grotesk labels,
 * Ionicons (cross-platform — expo-symbols is iOS-only and renders ☒ on
 * Android).
 */

import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { COLORS } from "@datum/core";
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

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(focused: IconName, unfocused: IconName) {
  return ({ color, focused: isFocused }: { color: ColorValue; focused: boolean }) => (
    <Ionicons name={isFocused ? focused : unfocused} size={22} color={color as string} />
  );
}

export default function TabsLayout() {
  const badge = useInboxBadge();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.text,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
        },
        tabBarLabelStyle: {
          fontFamily: "SpaceGrotesk_500Medium",
          fontSize: 11,
        },
        tabBarBadgeStyle: {
          backgroundColor: COLORS.critical,
          color: COLORS.surface,
          fontFamily: "SpaceGrotesk_600SemiBold",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="(matrix)"
        options={{ title: "Matrix", tabBarIcon: tabIcon("grid", "grid-outline") }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarBadge: badge,
          tabBarIcon: tabIcon("notifications", "notifications-outline"),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{ title: "Asisten", tabBarIcon: tabIcon("sparkles", "sparkles-outline") }}
      />
      <Tabs.Screen
        name="(more)"
        options={{
          title: "Lainnya",
          tabBarIcon: tabIcon("ellipsis-horizontal-circle", "ellipsis-horizontal-circle-outline"),
        }}
      />
    </Tabs>
  );
}
