"use client";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Board as BoardData, BoardColumn } from "@/lib/cards/queries";
import { optimisticReducer } from "@/lib/cards/optimisticBoard";
import { OptimisticBoardProvider, type OptimisticBoardApi } from "@/lib/cards/optimisticBoardContext";
import { useBoard } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";
import { Column } from "./Column";
import { AddColumnForm } from "./AddColumnForm";
import { BoardFilter, type StatusFilter, type LabelFilter } from "./BoardFilter";
import { BoardTabs } from "./BoardTabs";
import { subscribeToProjectChanges } from "@/lib/cards/realtime";

export function Board({ initialBoard }: { initialBoard: BoardData }) {
  const code = initialBoard.project.project_code;
  const queryClient = useQueryClient();
  const { data: board } = useBoard(code, initialBoard);
  const liveBoard = board ?? initialBoard;
  const [optimisticBoard, addOptimistic] = useOptimistic(liveBoard, optimisticReducer);
  const [, startTransition] = useTransition();
  const api: OptimisticBoardApi = useMemo(
    () => ({
      addOptimisticCard: (topicId, title) =>
        startTransition(() => addOptimistic({ type: "add-card", topicId, title })),
    }),
    [addOptimistic],
  );
  useEffect(() => {
    return subscribeToProjectChanges(initialBoard.project.id, () => {
      queryClient.invalidateQueries({ queryKey: keys.board(code) });
    });
  }, [initialBoard.project.id, code, queryClient]);
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<StatusFilter>(new Set(["active"]));
  const [labelFilter, setLabelFilter] = useState<LabelFilter>(new Set());

  const filteredColumns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const includeAllColumns = q === "" && labelFilter.size === 0;
    // Use WIB (Asia/Jakarta) calendar-day semantics so overdue flips at WIB
    // midnight, consistent with the deadline chip in MiniCard.
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const cols: BoardColumn[] = [];
    for (const col of optimisticBoard.columns) {
      const matchedCards = col.cards.filter((c) => {
        if (!statuses.has(c.status as "active" | "dormant" | "closed")) return false;
        if (labelFilter.size > 0) {
          const overdueMatch =
            labelFilter.has("overdue") &&
            c.deadline != null &&
            c.deadline.targetEndDate < todayStr;
          const labelMatch = c.labels.some(
            (l) => labelFilter.has(l.kind as "needs_decision" | "blocked" | "awaiting"),
          );
          if (!overdueMatch && !labelMatch) return false;
        }
        if (!q) return true;
        const hay = `${c.title} ${c.current_summary ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
      if (includeAllColumns || matchedCards.length > 0) {
        cols.push({ topic: col.topic, cards: matchedCards });
      }
    }
    return cols;
  }, [optimisticBoard.columns, query, statuses, labelFilter]);

  const totalCards = optimisticBoard.columns.reduce((n, c) => n + c.cards.length, 0);
  const matchedTotal = filteredColumns.reduce((n, c) => n + c.cards.length, 0);

  // --- Mobile column carousel (below md) ------------------------------------
  // Columns render as a horizontal snap carousel; the BoardTabs strip above
  // tracks and controls which column is in view. Refs live in Maps keyed by
  // topic id so they survive columns mounting/unmounting under filters,
  // optimistic adds, and realtime cache invalidation/refetch.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);

  // Re-observe whenever the visible column set changes: the observer holds
  // direct element references, so stale ones must be dropped and new columns
  // (e.g. after a filter change or refresh) picked up.
  useEffect(() => {
    const root = scrollerRef.current;
    if (root == null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.getAttribute("data-topic-id");
          if (id != null) setActiveTopicId(id);
        }
      },
      { root, threshold: 0.6 },
    );
    for (const el of columnRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [filteredColumns]);

  // If the previously active column got filtered out, fall back to the first
  // visible one rather than showing no highlight.
  const activeTabId =
    activeTopicId != null && filteredColumns.some((c) => c.topic.id === activeTopicId)
      ? activeTopicId
      : (filteredColumns[0]?.topic.id ?? null);

  function jumpToColumn(topicId: string) {
    setActiveTopicId(topicId);
    const el = columnRefs.current.get(topicId);
    if (el == null) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }

  return (
    <OptimisticBoardProvider value={api}>
    <div className="flex h-full flex-col">
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
      <BoardTabs
        tabs={filteredColumns.map((c) => ({
          id: c.topic.id,
          name: c.topic.name,
          count: c.cards.length,
        }))}
        activeId={activeTabId}
        onSelect={jumpToColumn}
      />
      <div
        ref={scrollerRef}
        className="flex flex-1 snap-x snap-mandatory flex-row gap-3 overflow-x-auto overflow-y-hidden bg-[var(--surface-alt)] p-3 md:snap-none md:flex-row md:gap-2 md:overflow-x-auto md:overflow-y-hidden"
      >
        {filteredColumns.length === 0 ? (
          <div className="m-auto text-sm italic text-[var(--text-muted)]">
            Tidak ada kartu cocok. Coba ubah filter atau kata kunci.
          </div>
        ) : (
          filteredColumns.map((col) => (
            <Column
              key={col.topic.id}
              column={col}
              projectId={liveBoard.project.id}
              projectCode={liveBoard.project.project_code}
              containerRef={(el) => {
                if (el) columnRefs.current.set(col.topic.id, el);
                else columnRefs.current.delete(col.topic.id);
              }}
            />
          ))
        )}
        {/* On mobile the add-column form becomes its own carousel slide; at
            md+ the wrapper dissolves (display: contents) so the desktop board
            row is byte-for-byte what it was. */}
        <div className="w-[86vw] max-w-[22rem] shrink-0 snap-center md:contents">
          <AddColumnForm
            projectId={liveBoard.project.id}
            projectCode={liveBoard.project.project_code}
          />
        </div>
      </div>
    </div>
    </OptimisticBoardProvider>
  );
}
