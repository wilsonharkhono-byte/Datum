/**
 * Review queue screen — AI-draft approve / reject.
 *
 * Mirrors web /review page (Bahasa copy, same layout):
 *   - "Inbox principal" header + description
 *   - List of pending card-event drafts (each: project, kind, payload, author)
 *   - Approve & Reject per item (reject can include an optional reason)
 *   - States: loading skeleton | empty | error + retry | offline banner
 *
 * RLS scopes drafts returned by listPendingCardEventDrafts — we show all
 * rows the API returns without further client-side role filtering.
 */

import { FlatList, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ReviewItem } from "@/components/review/ReviewItem";
import { useReviewDrafts } from "@/lib/query/hooks";
import type { PendingDraft } from "@datum/core";

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ReviewSkeleton() {
  return (
    <Screen>
      <OfflineBanner />
      <View className="gap-3 pt-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-1 h-4 w-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </View>
    </Screen>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function ReviewEmpty() {
  return (
    <View
      testID="review-empty"
      className="m-4 rounded border border-dashed border-border/40 bg-surface p-8"
    >
      <Text variant="secondary" className="text-center font-medium">
        Tidak ada draf untuk ditinjau.
      </Text>
      <Text variant="muted" className="mt-1 text-center text-[12px]">
        Inbox ini terisi saat asisten menangkap catatan berisiko tinggi dari mode Catat.
      </Text>
    </View>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function ReviewHeader() {
  return (
    <View className="pb-4 pt-4">
      <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
        Inbox principal
      </Text>
      <Text variant="heading" className="mt-1">
        Perlu dicek
      </Text>
      <Text variant="secondary" className="mt-1">
        Catatan dari mode <Text className="font-bold text-text-sec">Catat</Text> dengan kategori
        berisiko tinggi — permintaan klien, keputusan, vendor, pekerjaan.
        Ketuk <Text className="italic text-text-sec">Setujui &amp; tambah ke kartu</Text> agar
        catatan ini masuk ke timeline kartu, atau{" "}
        <Text className="italic text-text-sec">Tolak</Text> jika AI salah tangkap.
      </Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const {
    data: drafts,
    isLoading,
    isError,
    error,
    refetch,
  } = useReviewDrafts();

  if (isLoading) return <ReviewSkeleton />;

  if (isError) {
    return (
      <Screen>
        <OfflineBanner />
        <ErrorState
          message={`Gagal memuat draf: ${(error as Error).message}`}
          onRetry={() => void refetch()}
        />
      </Screen>
    );
  }

  const items: PendingDraft[] = drafts ?? [];

  return (
    <Screen className="px-0">
      <OfflineBanner />
      <FlatList<PendingDraft>
        data={items}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16 }}
        ListHeaderComponent={<ReviewHeader />}
        ListEmptyComponent={<ReviewEmpty />}
        ItemSeparatorComponent={() => <View className="h-3" />}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <ReviewItem draft={item} />}
        testID="review-list"
      />
    </Screen>
  );
}
