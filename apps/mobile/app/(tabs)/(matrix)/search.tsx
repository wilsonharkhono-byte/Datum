import { useState, useEffect } from "react";
import {
  View,
  TextInput,
  SectionList,
  Pressable,
  ActivityIndicator,
  type SectionListData,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { searchAll, type SearchHit, type SearchResults } from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 2;

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  development: "Pengembangan",
  project: "Proyek",
  card: "Kartu",
  event: "Aktivitas",
  comment: "Komentar",
  attachment: "Lampiran",
};

// Section order mirrors web
const SECTION_KEYS: Array<keyof SearchResults> = [
  "developments",
  "projects",
  "cards",
  "events",
  "comments",
  "attachments",
];

const SECTION_LABELS: Record<keyof SearchResults, string> = {
  developments: "Pengembangan",
  projects: "Proyek",
  cards: "Kartu",
  events: "Aktivitas",
  comments: "Komentar",
  attachments: "Lampiran",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchSection = SectionListData<SearchHit, { title: string; key: string }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRoute(hit: SearchHit): string {
  switch (hit.kind) {
    case "project":
      return `/(tabs)/(matrix)/project/${hit.projectCode}`;
    case "card":
      return `/(tabs)/(matrix)/project/${hit.projectCode}/card/${hit.cardSlug}`;
    case "development":
      // Developments don't have a dedicated mobile route; fall back to matrix
      return "/(tabs)/(matrix)";
    case "event":
    case "comment":
    case "attachment":
      // All carry projectCode + cardSlug pointing to the owning card
      return hit.cardSlug
        ? `/(tabs)/(matrix)/project/${hit.projectCode}/card/${hit.cardSlug}`
        : `/(tabs)/(matrix)/project/${hit.projectCode}`;
    default:
      return "/(tabs)/(matrix)";
  }
}

function buildSections(results: SearchResults): SearchSection[] {
  const sections: SearchSection[] = [];
  for (const key of SECTION_KEYS) {
    const items = results[key];
    if (items.length > 0) {
      sections.push({
        title: SECTION_LABELS[key],
        key,
        data: items,
      });
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SearchSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <View key={i} className="mb-3">
          <Skeleton className="mb-1 h-6 w-1/3" />
          <Skeleton className="mb-1 h-14" />
          <Skeleton className="h-14" />
        </View>
      ))}
    </>
  );
}

function HitRow({ hit, onPress }: { hit: SearchHit; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hit.cardTitle || "(tanpa judul)"}
      testID={`hit-row-${hit.id}`}
      className="mb-2 rounded border border-border bg-surface p-3 active:opacity-80"
    >
      <View className="mb-1 flex-row items-center justify-between">
        <Text variant="label" className="text-primary">
          {KIND_LABEL[hit.kind]}
        </Text>
        {hit.projectCode ? (
          <Text variant="muted" className="text-[11px]">
            {hit.projectCode}
          </Text>
        ) : null}
      </View>
      <Text variant="body" className="text-[14px] font-medium">
        {hit.cardTitle || "(tanpa judul)"}
      </Text>
      {hit.snippet ? (
        <Text variant="muted" className="mt-0.5 text-[12px]" numberOfLines={2}>
          {hit.snippet}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SearchScreen() {
  const router = useRouter();
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Inline debounce — deterministic with jest.useFakeTimers
  useEffect(() => {
    if (rawQuery === debouncedQuery) return;
    const timer = setTimeout(() => setDebouncedQuery(rawQuery), 300);
    return () => clearTimeout(timer);
  }, [rawQuery, debouncedQuery]);

  const isQueryReady = debouncedQuery.trim().length >= MIN_QUERY_LENGTH;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["search", debouncedQuery],
    enabled: isQueryReady,
    queryFn: () => searchAll(supabase, debouncedQuery),
  });

  const sections: SearchSection[] = data ? buildSections(data) : [];
  const totalHits = sections.reduce((n, s) => n + s.data.length, 0);

  function handleHitPress(hit: SearchHit) {
    router.push(buildRoute(hit) as any);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Screen className="pt-2">
      <OfflineBanner />

      {/* Header */}
      <View className="pb-2">
        <Text variant="heading">Cari</Text>
        <Text variant="secondary" className="mt-0.5">
          Pencarian teks di seluruh proyek — proyek, kartu, aktivitas, komentar.
        </Text>
      </View>

      {/* Search input */}
      <View className="mb-3 flex-row items-center rounded border border-border bg-surface px-3 py-2">
        <TextInput
          value={rawQuery}
          onChangeText={setRawQuery}
          placeholder="Ketik untuk mencari…"
          placeholderTextColor="#847E78"
          accessibilityLabel="Cari"
          testID="search-input"
          className="flex-1 text-[14px] text-text"
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {isLoading && isQueryReady ? (
          <ActivityIndicator size="small" testID="search-spinner" />
        ) : null}
      </View>

      {/* State: idle — query too short */}
      {!isQueryReady ? (
        <View className="mt-6 rounded border border-dashed border-border p-6">
          <Text variant="secondary" className="text-center italic">
            Ketik di kotak di atas untuk mencari kartu, aktivitas, atau komentar.
          </Text>
          <Text variant="muted" className="mt-1 text-center text-[12px]">
            Pencarian berbasis teks di seluruh proyek yang Anda akses.
          </Text>
        </View>
      ) : isError ? (
        /* State: error */
        <ErrorState
          message={`Gagal memuat hasil: ${(error as Error).message}`}
          onRetry={refetch}
        />
      ) : isLoading ? (
        /* State: loading skeleton */
        <SearchSkeleton />
      ) : totalHits === 0 ? (
        /* State: empty results */
        <View className="mt-6 rounded border border-dashed border-border p-6">
          <Text variant="secondary" className="text-center italic">
            {`Tidak ada hasil untuk "${debouncedQuery}".`}
          </Text>
          <Text variant="muted" className="mt-1 text-center text-[12px]">
            Coba kata kunci yang lebih pendek atau cek ejaan.
          </Text>
        </View>
      ) : (
        /* State: results */
        <>
          <Text variant="muted" className="mb-2 text-[12px]">
            {totalHits} hasil ditemukan
          </Text>
          <SectionList<SearchHit, { title: string; key: string }>
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View className="mb-1 mt-3">
                <Text variant="label">
                  {section.title} ({section.data.length})
                </Text>
              </View>
            )}
            renderItem={({ item }) => (
              <HitRow hit={item} onPress={() => handleHitPress(item)} />
            )}
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            testID="search-results-list"
          />
        </>
      )}
    </Screen>
  );
}
