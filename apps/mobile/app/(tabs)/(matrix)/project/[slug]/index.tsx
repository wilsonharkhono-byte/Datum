import { useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  FlatList,
  Dimensions,
  Alert,
  type ViewToken,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Column } from "@/components/board/Column";
import { AddColumnSlide } from "@/components/board/AddColumnSlide";
import { BoardFilter, type StatusFilter, type LabelFilter, type LabelFilterKind } from "@/components/board/BoardFilter";
import { BoardTabs } from "@/components/board/BoardTabs";
import { getJakartaToday } from "@/components/board/DeadlineChip";
import { useBoard } from "@/lib/query/hooks";
import { useMoveCard } from "@/lib/query/mutations";
import { useProjectRealtime } from "@/lib/realtime/useRealtimeInvalidation";
import type { BoardColumn, CardWithLabels } from "@datum/core";

const SCREEN_W = Dimensions.get("window").width;
const COLUMN_W = Math.round(SCREEN_W * 0.86);

// ─── filtering ────────────────────────────────────────────────────────────────

function filterColumns(
  columns: BoardColumn[],
  query: string,
  statuses: StatusFilter,
  labelFilter: LabelFilter,
  todayStr: string,
): BoardColumn[] {
  const q = query.trim().toLowerCase();
  const includeAllColumns = q === "" && labelFilter.size === 0;

  const out: BoardColumn[] = [];
  for (const col of columns) {
    const matchedCards = col.cards.filter((c) => {
      if (!statuses.has(c.status as "active" | "dormant" | "closed")) return false;
      if (labelFilter.size > 0) {
        const overdueMatch =
          labelFilter.has("overdue") &&
          c.deadline != null &&
          c.deadline.targetEndDate < todayStr;
        const labelMatch = c.labels.some(
          (l) => labelFilter.has(l.kind as LabelFilterKind),
        );
        if (!overdueMatch && !labelMatch) return false;
      }
      if (!q) return true;
      const hay = `${c.title} ${c.current_summary ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    if (includeAllColumns || matchedCards.length > 0) {
      out.push({ topic: col.topic, cards: matchedCards });
    }
  }
  return out;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BoardScreen() {
  const { slug: code } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const boardQuery = useBoard(code);
  const board = boardQuery.data;

  // Realtime subscription
  useProjectRealtime(board?.project.id, code);

  // Filter state
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<StatusFilter>(new Set(["active"]));
  const [labelFilter, setLabelFilter] = useState<LabelFilter>(new Set());
  const todayStr = getJakartaToday();

  const filteredColumns = useMemo(() => {
    if (!board) return [];
    return filterColumns(board.columns, query, statuses, labelFilter, todayStr);
  }, [board, query, statuses, labelFilter, todayStr]);

  const totalCards = useMemo(
    () => (board ? board.columns.reduce((n, c) => n + c.cards.length, 0) : 0),
    [board],
  );
  const matchedTotal = useMemo(
    () => filteredColumns.reduce((n, c) => n + c.cards.length, 0),
    [filteredColumns],
  );

  // Carousel state
  const flatListRef = useRef<FlatList>(null);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);

  // Derive active tab — if the current active was filtered out, fall back to first
  const activeTabId =
    activeTopicId != null && filteredColumns.some((c) => c.topic.id === activeTopicId)
      ? activeTopicId
      : (filteredColumns[0]?.topic.id ?? null);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.item && "topic" in first.item) {
        setActiveTopicId((first.item as BoardColumn).topic.id);
      }
    },
  ).current;

  function jumpToColumn(topicId: string) {
    setActiveTopicId(topicId);
    const idx = filteredColumns.findIndex((c) => c.topic.id === topicId);
    if (idx >= 0) {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true });
    }
  }

  // Move card action sheet
  const moveCard = useMoveCard(code);

  function showMoveSheet(card: CardWithLabels) {
    if (!board) return;
    const options = board.columns
      .filter((c) => c.topic.id !== card.topic_id)
      .map((c) => c.topic.name);
    const topicIds = board.columns
      .filter((c) => c.topic.id !== card.topic_id)
      .map((c) => c.topic.id);

    Alert.alert(
      "Pindahkan kartu",
      `"${card.title}"`,
      [
        ...options.map((name, i) => ({
          text: name,
          onPress: () => {
            moveCard.mutate({
              cardId: card.id,
              newTopicId: topicIds[i]!,
              projectId: board.project.id,
            });
          },
        })),
        { text: "Batal", style: "cancel" },
      ],
    );
  }

  // ─── States ───────────────────────────────────────────────────────────────

  if (boardQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
        <Stack.Screen options={{ title: code ?? "Papan" }} />
        <View className="flex-1 flex-row gap-2 p-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-full w-[86vw]" />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (boardQuery.isError || board == null) {
    const msg =
      boardQuery.error instanceof Error &&
      boardQuery.error.message.includes("not found")
        ? `Proyek tidak ditemukan: ${code}`
        : `Gagal memuat papan. ${boardQuery.error instanceof Error ? boardQuery.error.message : ""}`;
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
        <Stack.Screen options={{ title: "Papan", headerBackTitle: "Kembali" }} />
        <ErrorState message={msg} onRetry={() => boardQuery.refetch()} />
      </SafeAreaView>
    );
  }

  const headerTitle = `${board.project.project_code} · ${board.project.project_name ?? ""}`;

  // Build carousel items: filtered columns + a trailing AddColumn slide
  type CarouselItem =
    | { type: "column"; col: BoardColumn }
    | { type: "add-column" };

  const carouselItems: CarouselItem[] = [
    ...filteredColumns.map((col): CarouselItem => ({ type: "column", col })),
    { type: "add-column" },
  ];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerBackTitle: "Kembali",
          headerTitleStyle: { fontSize: 14 },
        }}
      />

      <OfflineBanner />

      <BoardFilter
        query={query}
        onQueryChange={setQuery}
        statuses={statuses}
        onStatusesChange={setStatuses}
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
        matched={matchedTotal}
        total={totalCards}
      />

      {filteredColumns.length > 0 && (
        <BoardTabs
          tabs={filteredColumns.map((c) => ({
            id: c.topic.id,
            name: c.topic.name,
            count: c.cards.length,
          }))}
          activeId={activeTabId}
          onSelect={jumpToColumn}
        />
      )}

      {filteredColumns.length === 0 && query !== "" && (
        <EmptyState message="Tidak ada kartu cocok. Coba ubah filter atau kata kunci." />
      )}

      <FlatList<CarouselItem>
        ref={flatListRef}
        data={carouselItems}
        keyExtractor={(item) =>
          item.type === "column" ? item.col.topic.id : "__add-column__"
        }
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={COLUMN_W + 12} // column width + gap
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 6, gap: 12, paddingVertical: 8 }}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        getItemLayout={(_data, index) => ({
          length: COLUMN_W + 12,
          offset: (COLUMN_W + 12) * index,
          index,
        })}
        renderItem={({ item }) => {
          if (item.type === "add-column") {
            return (
              <View style={{ width: COLUMN_W }}>
                <AddColumnSlide
                  projectId={board.project.id}
                  projectCode={board.project.project_code}
                />
              </View>
            );
          }
          return (
            <View style={{ width: COLUMN_W }}>
              <Column
                column={item.col}
                projectId={board.project.id}
                projectCode={board.project.project_code}
                todayStr={todayStr}
              />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
