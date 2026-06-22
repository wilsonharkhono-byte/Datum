/**
 * CardDetailScreen — read-only rendering of a card's header, timeline,
 * comments, members, and attachments.
 *
 * Write actions (add-event, add-comment, add-member) are the next task;
 * placeholders are left disabled here.
 *
 * Read approach: SEPARATE queries
 *  - useCard(code, slug)           → card header + timeline events
 *  - useCardComments(cardId)       → comments
 *  - useCardMembers(cardId)        → members (with staff)
 *  - useCardAttachments(cardId)    → attachments keyed by event id
 *
 * `CardDetail` from core returns { card, events } only; comments/members/
 * attachments are separate reads (see @datum/core queries.ts).
 */

import { View, ScrollView } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@datum/core";
import type { CardAttachment } from "@datum/db";

import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MobileEventRow } from "@/components/card/EventRow";
import { CommentItem } from "@/components/card/CommentItem";
import { MemberRow } from "@/components/card/MemberRow";
import {
  useCard,
  useCardComments,
  useCardMembers,
  useCardAttachments,
} from "@/lib/query/hooks";
import { useProjectRealtime } from "@/lib/realtime/useRealtimeInvalidation";

// ─── Status display ───────────────────────────────────────────────────────────

type CardStatus = "active" | "dormant" | "closed";

const STATUS_LABEL: Record<CardStatus, string> = {
  active: "Aktif",
  dormant: "Dihentikan",
  closed: "Selesai",
};

const STATUS_FLAG: Record<CardStatus, "ok" | "warning" | "info"> = {
  active: "ok",
  dormant: "warning",
  closed: "info",
};

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function CardDetailSkeleton() {
  return (
    <View className="gap-3 px-4 py-4">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="mt-4 h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </View>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <View className="mb-2 mt-4 border-b border-border/40 pb-1">
      <Text variant="label">{title}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CardDetailScreen() {
  const { slug: code, cardSlug } = useLocalSearchParams<{ slug: string; cardSlug: string }>();
  const qc = useQueryClient();

  // Primary read: card header + timeline
  const cardQuery = useCard(code, cardSlug);
  const card = cardQuery.data?.card;
  const events = cardQuery.data?.events ?? [];

  // Secondary reads — gated on cardId being known
  const cardId = card?.id;
  const commentsQuery = useCardComments(cardId);
  const membersQuery = useCardMembers(cardId);
  const attachmentsQuery = useCardAttachments(cardId);

  // Realtime — invalidate card + board on project changes
  useProjectRealtime(card?.project_id, code);

  // Attachments keyed by event id
  const attachmentsByEvent: Map<string, CardAttachment[]> = attachmentsQuery.data ?? new Map();

  // ── Loading ──
  if (cardQuery.isPending) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
        <Stack.Screen
          options={{
            title: "Memuat…",
            headerBackTitle: code,
          }}
        />
        <OfflineBanner />
        <CardDetailSkeleton />
      </SafeAreaView>
    );
  }

  // ── Error / not found ──
  if (cardQuery.isError || !card) {
    const msg = !card
      ? "Kartu tidak ditemukan."
      : (cardQuery.error as Error | undefined)?.message ?? "Gagal memuat kartu.";
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
        <Stack.Screen options={{ title: "Error", headerBackTitle: code }} />
        <OfflineBanner />
        <ErrorState
          message={msg}
          onRetry={() => qc.invalidateQueries({ queryKey: keys.card(code, cardSlug) })}
        />
      </SafeAreaView>
    );
  }

  const status = (card.status ?? "active") as CardStatus;
  const statusLabel = STATUS_LABEL[status] ?? status;
  const statusFlag = STATUS_FLAG[status] ?? "info";

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <Stack.Screen
        options={{
          title: card.title,
          headerBackTitle: code,
        }}
      />
      <OfflineBanner />

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 pt-3"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Card header ── */}
        <View className="mb-1 flex-row items-start gap-2">
          <Text variant="heading" className="flex-1">
            {card.title}
          </Text>
          <Badge flag={statusFlag} label={statusLabel} />
        </View>

        {card.current_summary ? (
          <Text variant="secondary" className="mb-3 leading-snug">
            {card.current_summary}
          </Text>
        ) : null}

        {/* ── Aktivitas (timeline) ── */}
        <SectionHeader title="Aktivitas" />

        {events.length === 0 ? (
          <Text variant="muted" className="mb-2 italic">
            Belum ada aktivitas.
          </Text>
        ) : (
          events.map((ev) => (
            <MobileEventRow
              key={ev.id}
              event={ev}
              attachments={attachmentsByEvent.get(ev.id) ?? []}
            />
          ))
        )}

        {/* Placeholder for add-event action (next task) */}
        <View className="mt-2">
          <Button label="+ Catat aktivitas" onPress={() => {}} disabled />
        </View>

        {/* ── Diskusi (comments) ── */}
        <SectionHeader title="Diskusi" />

        {commentsQuery.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : commentsQuery.isError ? (
          <Text variant="muted" className="italic">
            Gagal memuat komentar.
          </Text>
        ) : (commentsQuery.data ?? []).length === 0 ? (
          <Text variant="muted" className="italic">
            Belum ada komentar.
          </Text>
        ) : (
          (commentsQuery.data ?? []).map((c) => <CommentItem key={c.id} comment={c} />)
        )}

        {/* Placeholder for add-comment action (next task) */}
        <View className="mt-2">
          <Button label="+ Tambah komentar" onPress={() => {}} disabled />
        </View>

        {/* ── Anggota (members) ── */}
        <SectionHeader title="Anggota" />

        {membersQuery.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : membersQuery.isError ? (
          <Text variant="muted" className="italic">
            Gagal memuat anggota.
          </Text>
        ) : (membersQuery.data ?? []).length === 0 ? (
          <Text variant="muted" className="italic">
            Belum ada anggota.
          </Text>
        ) : (
          (membersQuery.data ?? []).map((m) => (
            <MemberRow key={`${m.card_id}-${m.staff_id}`} member={m} />
          ))
        )}

        {/* Placeholder for add-member action (next task) */}
        <View className="mt-2">
          <Button label="+ Tambah anggota" onPress={() => {}} disabled />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
