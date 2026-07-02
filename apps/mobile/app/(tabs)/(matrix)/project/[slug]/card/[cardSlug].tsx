/**
 * CardDetailScreen — card header, timeline, comments, members, and write actions.
 *
 * Read approach: SEPARATE queries
 *  - useCard(code, slug)           → card header + timeline events
 *  - useCardComments(cardId)       → comments
 *  - useCardMembers(cardId)        → members (with staff)
 *  - useCardAttachments(cardId)    → attachments keyed by event id
 *  - useCardAreas(cardId)          → linked areas
 *  - useAreas(projectId)           → project areas (picker candidates)
 *
 * Write actions (this task):
 *  - MobileAddEventForm            → useAddEvent (collapsed "+ Catat aktivitas")
 *  - CommentInput / DeletableCommentItem → useAddComment / useDeleteComment / useEditComment
 *  - MemberPicker / RemovableMemberRow  → useAddMember / useRemoveMember
 *  - ResolveButton                 → useResolveEvent (shown on open-loop events)
 *  - CardAreas                     → useLinkCardArea / useUnlinkCardArea
 *
 * Attachment upload is scoped to "view + caption" (existing read screen).
 * Native file picker is a TODO noted in MobileAddEventForm.
 *
 * NOTE: Gate recompute + high-risk principal notifications are web-only side
 * effects. Mobile-created events won't fire those — acceptable per spec.
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
import { MobileEventRow } from "@/components/card/EventRow";
import { MobileAddEventForm } from "@/components/card/AddEventForm";
import { CommentInput, DeletableCommentItem } from "@/components/card/CommentInput";
import { MemberPicker, RemovableMemberRow } from "@/components/card/MemberPicker";
import { ResolveButton } from "@/components/card/ResolveButton";
import { CardAreas } from "@/components/card/CardAreas";
import {
  useCard,
  useCardComments,
  useCardMembers,
  useCardAttachments,
  useCardAreas,
} from "@/lib/query/hooks";
import { useProjectRealtime } from "@/lib/realtime/useRealtimeInvalidation";
import { useSession } from "@/lib/session/session";

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
  const { staff } = useSession();

  // Primary read: card header + timeline
  const cardQuery = useCard(code, cardSlug);
  const card = cardQuery.data?.card;
  const events = cardQuery.data?.events ?? [];

  // Secondary reads — gated on cardId being known
  const cardId = card?.id;
  const commentsQuery = useCardComments(cardId);
  const membersQuery = useCardMembers(cardId);
  const attachmentsQuery = useCardAttachments(cardId);
  const areasQuery = useCardAreas(cardId);

  // Realtime — invalidate card + board on project changes
  useProjectRealtime(card?.project_id, code);

  // Attachments keyed by event id
  const attachmentsByEvent: Map<string, CardAttachment[]> = attachmentsQuery.data ?? new Map();

  // Member staff ids for MemberPicker deduplication
  const existingMemberIds = (membersQuery.data ?? []).map((m) => m.staff_id);

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

        {/* ── Area terkait ── */}
        <SectionHeader title="Area terkait" />

        {areasQuery.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : areasQuery.isError ? (
          <Text variant="muted" className="italic">
            Gagal memuat area.
          </Text>
        ) : cardId ? (
          <CardAreas
            cardId={cardId}
            projectId={card.project_id}
            currentAreas={areasQuery.data ?? []}
          />
        ) : null}

        {/* ── Aktivitas (timeline) ── */}
        <SectionHeader title="Aktivitas" />

        {events.length === 0 ? (
          <Text variant="muted" className="mb-2 italic">
            Belum ada aktivitas.
          </Text>
        ) : (
          events.map((ev) => (
            <View key={ev.id}>
              <MobileEventRow
                event={ev}
                attachments={attachmentsByEvent.get(ev.id) ?? []}
              />
              {/* Resolve affordance — only for open-loop events */}
              {staff ? (
                <ResolveButton event={ev} code={code} slug={cardSlug} />
              ) : null}
            </View>
          ))
        )}

        {/* Add event form */}
        {staff && cardId ? (
          <MobileAddEventForm
            cardId={cardId}
            projectId={card.project_id}
            code={code}
            slug={cardSlug}
            loggedByStaffId={staff.id}
          />
        ) : null}

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
          (commentsQuery.data ?? []).map((c) => (
            <DeletableCommentItem
              key={c.id}
              comment={c}
              cardId={cardId ?? ""}
              ownStaffId={staff?.id}
            />
          ))
        )}

        {/* Add comment */}
        {staff && cardId ? (
          <CommentInput
            cardId={cardId}
            projectId={card.project_id}
            loggedByStaffId={staff.id}
          />
        ) : null}

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
            <RemovableMemberRow
              key={`${m.card_id}-${m.staff_id}-${m.role}`}
              member={m}
              cardId={cardId ?? ""}
              canRemove={!!staff}
            />
          ))
        )}

        {/* Add member */}
        {staff && cardId ? (
          <MemberPicker
            cardId={cardId}
            projectId={card.project_id}
            addedByStaffId={staff.id}
            existingMemberIds={existingMemberIds}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
