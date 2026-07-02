/**
 * Inbox tab — Notifikasi + Aktivitas
 *
 * Structure:
 *   - Primary section: Notifications (50 most recent, per-row kind chip,
 *     unread rows tinted, mark-one / mark-all read, realtime via
 *     useNotificationsRealtime).
 *   - Secondary section: Activity feed grouped by day, rendered below
 *     notifications inside the same FlatList via ListFooterComponent.
 *
 * Deep-link parsing: web link paths are mapped to mobile routes:
 *   /project/{code}/cards/{slug}  →  /(tabs)/(matrix)/project/{code}/card/{slug}
 *   /review                       →  /(tabs)/(matrix)/review
 *   (anything else)               →  /(tabs)/(matrix)  (index fallback)
 */

import { useRef, useState } from "react";
import { FlatList, Pressable, SectionList, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Chip } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Button } from "@/components/ui/Button";
import { useNotifications, useUnreadCount, useActivity } from "@/lib/query/hooks";
import { useMarkRead, useMarkAllRead } from "@/lib/query/mutations";
import { useNotificationsRealtime } from "@/lib/realtime/useRealtimeInvalidation";
import { useSession } from "@/lib/session/session";
import type { Notification, ActivityItem } from "@datum/core";

// ─── Constants ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  mention:            "Mention",
  watcher_event:      "Aktivitas",
  card_status:        "Status kartu",
  draft_pending:      "Draft menunggu",
  draft_approved:     "Draft disetujui",
  draft_rejected:     "Draft ditolak",
  review_assigned:    "Review ditugaskan",
  readiness_reminder: "Kesiapan",
};

// ─── Deep-link parser ─────────────────────────────────────────────────────────

/**
 * Map a web notification `link` to a mobile Expo Router route.
 *
 * Web formats:
 *   /project/{code}/cards/{slug}  →  /(tabs)/(matrix)/project/{code}/card/{slug}
 *   /review                       →  /(tabs)/(matrix)/review
 *   (other)                       →  /(tabs)/(matrix)
 */
function parseLink(link: string): string {
  // /project/{code}/cards/{slug}
  const cardMatch = /^\/project\/([^/]+)\/cards\/([^/]+)/.exec(link);
  if (cardMatch) {
    return `/(tabs)/(matrix)/project/${cardMatch[1]}/card/${cardMatch[2]}`;
  }
  // /review
  if (/^\/review/.test(link)) {
    return "/(tabs)/(matrix)/review";
  }
  // Fallback
  return "/(tabs)/(matrix)";
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function InboxSkeleton() {
  return (
    <Screen>
      <OfflineBanner />
      <View className="gap-3 pt-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </View>
    </Screen>
  );
}

// ─── Notification row ─────────────────────────────────────────────────────────

function NotificationRow({
  item,
  staffId,
}: {
  item: Notification;
  staffId: string;
}) {
  const router = useRouter();
  const { mutate: markRead } = useMarkRead(staffId);
  const isUnread = item.read_at === null;

  return (
    <Pressable
      onPress={() => router.push(parseLink(item.link) as never)}
      testID={`notification-row-${item.id}`}
      className={`flex-row items-start gap-3 rounded border p-3 ${
        isUnread
          ? "border-sand/60 bg-sand/20"
          : "border-border/40 bg-surface"
      }`}
    >
      {/* Kind chip */}
      <Chip label={KIND_LABEL[item.kind] ?? item.kind} />

      {/* Body */}
      <View className="flex-1 gap-1">
        <Text className="text-[14px] text-text leading-snug">{item.summary}</Text>
        <Text variant="muted" className="text-[11px]">
          {new Date(item.created_at).toLocaleString("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </Text>
      </View>

      {/* Mark-read button */}
      {isUnread ? (
        <Pressable
          onPress={() => {
            markRead(item.id);
          }}
          testID={`mark-read-${item.id}`}
          hitSlop={8}
          className="min-h-[44px] items-center justify-center px-2"
        >
          <Text className="text-[12px] text-primary">tandai dibaca</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

// ─── Activity day section ─────────────────────────────────────────────────────

function ActivityRow({ item }: { item: ActivityItem }) {
  const router = useRouter();
  const route = `/(tabs)/(matrix)/project/${item.projectCode}/card/${item.cardSlug}` as never;

  return (
    <Pressable
      onPress={() => router.push(route)}
      testID={`activity-row-${item.id}`}
      className="flex-row items-start gap-2 rounded border border-border/30 bg-surface p-3"
    >
      <View className="flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-1">
          <Text className="text-[13px] text-text-sec font-medium" testID={`activity-title-${item.id}`}>
            {item.cardTitle}
          </Text>
          <Text variant="muted" className="text-[11px]">[{item.projectCode}]</Text>
        </View>
        {item.actor ? (
          <Text variant="muted" className="text-[11px]">{item.actor}</Text>
        ) : null}
        <Text variant="secondary" className="text-[12px]">{item.detail}</Text>
      </View>
      <Text variant="muted" className="text-[11px] shrink-0">
        {new Date(item.occurredAt).toLocaleString("id-ID", {
          timeStyle: "short",
        })}
      </Text>
    </Pressable>
  );
}

// ─── Activity section grouped by day ─────────────────────────────────────────

function ActivitySection({ items }: { items: ActivityItem[] }) {
  // Group by local date string
  const grouped = items.reduce<Record<string, ActivityItem[]>>((acc, item) => {
    const day = new Date(item.occurredAt).toLocaleDateString("id-ID");
    if (!acc[day]) acc[day] = [];
    acc[day].push(item);
    return acc;
  }, {});

  const sections = Object.entries(grouped).map(([title, data]) => ({ title, data }));

  if (sections.length === 0) {
    return (
      <View
        testID="activity-empty"
        className="m-2 rounded border border-dashed border-border/40 p-6"
      >
        <Text variant="secondary" className="text-center">Belum ada aktivitas terbaru.</Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      scrollEnabled={false}
      renderSectionHeader={({ section: { title } }) => (
        <View className="bg-bg py-2">
          <Text variant="label" className="text-[11px]">{title}</Text>
        </View>
      )}
      renderItem={({ item }) => <ActivityRow item={item} />}
      ItemSeparatorComponent={() => <View className="h-2" />}
      SectionSeparatorComponent={() => <View className="h-1" />}
      testID="activity-list"
    />
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function NotificationsEmpty() {
  return (
    <View
      testID="notifications-empty"
      className="rounded border border-dashed border-border/40 p-6"
    >
      <Text variant="secondary" className="text-center font-medium italic">
        Tidak ada notifikasi.
      </Text>
      <Text variant="muted" className="mt-1 text-center text-[11px]">
        Notifikasi muncul saat ada @mention, draft yang menunggu approval, atau aktivitas di kartu
        yang Anda tonton.
      </Text>
    </View>
  );
}

// ─── Header (injected as FlatList ListHeaderComponent) ───────────────────────

function InboxHeader({
  unread,
  total,
  staffId,
  markAllBusy,
  onMarkAll,
}: {
  unread: number;
  total: number;
  staffId: string;
  markAllBusy: boolean;
  onMarkAll: () => void;
}) {
  return (
    <View className="pb-4 pt-4">
      <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
        Notifikasi
      </Text>
      <Text variant="heading" className="mt-1">
        Notifikasi
      </Text>
      <Text variant="secondary" className="mt-1">
        @mention di komentar, aktivitas di kartu yang Anda tonton, dan status draft.
      </Text>

      {total > 0 ? (
        <View className="mt-3 flex-row flex-wrap items-center justify-between gap-2">
          <Text variant="secondary" testID="unread-summary">
            {unread} belum dibaca dari {total} terbaru
          </Text>
          {unread > 0 ? (
            <Pressable
              onPress={onMarkAll}
              disabled={markAllBusy}
              testID="mark-all-read"
              className={`min-h-[44px] items-center justify-center rounded border border-border/60 px-3 py-1 ${
                markAllBusy ? "opacity-50" : ""
              }`}
            >
              <Text className="text-[12px] font-semibold uppercase tracking-wide text-text-sec">
                tandai semua dibaca
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function InboxTab() {
  const { staff } = useSession();
  const staffId = staff?.id;

  // Realtime invalidation
  useNotificationsRealtime(staffId);

  const {
    data: notifications,
    isLoading: notifLoading,
    isError: notifError,
    error: notifErr,
    refetch: refetchNotifs,
  } = useNotifications(staffId);

  const {
    data: activityItems,
    isLoading: activityLoading,
  } = useActivity();

  const { mutate: markAll, isPending: markAllBusy } = useMarkAllRead(staffId ?? "");

  if (notifLoading) return <InboxSkeleton />;

  if (notifError) {
    return (
      <Screen>
        <OfflineBanner />
        <ErrorState
          message={`Gagal memuat notifikasi: ${(notifErr as Error).message}`}
          onRetry={() => void refetchNotifs()}
        />
      </Screen>
    );
  }

  const items: Notification[] = notifications ?? [];
  const unread = items.filter((n) => n.read_at === null).length;
  const activity: ActivityItem[] = activityItems ?? [];

  // Activity footer — rendered below the notification list
  const ListFooter = (
    <View className="mt-6">
      <Text variant="label" className="mb-2 text-[11px]">
        Aktivitas terbaru
      </Text>
      {activityLoading ? (
        <View className="gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </View>
      ) : (
        <ActivitySection items={activity} />
      )}
      <View className="h-10" />
    </View>
  );

  return (
    <Screen className="px-0">
      <OfflineBanner />
      <FlatList<Notification>
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        testID="notifications-list"
        ListHeaderComponent={
          <InboxHeader
            unread={unread}
            total={items.length}
            staffId={staffId ?? ""}
            markAllBusy={markAllBusy}
            onMarkAll={() => markAll()}
          />
        }
        ListEmptyComponent={<NotificationsEmpty />}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListFooterComponent={ListFooter}
        renderItem={({ item }) => (
          <NotificationRow item={item} staffId={staffId ?? ""} />
        )}
      />
    </Screen>
  );
}
