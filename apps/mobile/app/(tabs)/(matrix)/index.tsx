import { useMemo, useState } from "react";
import {
  View,
  TextInput,
  ScrollView,
  SectionList,
  Pressable,
  type SectionListData,
} from "react-native";
import { useRouter } from "expo-router";
import { filterProjects, groupProjects, type ProjectGroup, type ProjectListItem } from "@datum/core";
import { useProjects, useDevelopments } from "@/lib/query/hooks";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ProjectCard } from "@/components/projects/ProjectCard";

// ---------------------------------------------------------------------------
// Status filter pills (mirrors web STATUS_FILTERS)
// ---------------------------------------------------------------------------
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "design", label: "Desain" },
  { value: "construction", label: "Konstruksi" },
  { value: "finishing", label: "Finishing" },
  { value: "handover", label: "Serah terima" },
  { value: "closed", label: "Selesai" },
];

// ---------------------------------------------------------------------------
// Types for SectionList
// ---------------------------------------------------------------------------
type Section = SectionListData<ProjectListItem, ProjectGroup>;

// ---------------------------------------------------------------------------
// Header component (memoisation not critical at this scale)
// ---------------------------------------------------------------------------
function LandingHeader({
  projectCount,
  devCount,
}: {
  projectCount: number;
  devCount: number;
}) {
  const router = useRouter();
  return (
    <View className="pb-3 pt-2">
      <Text variant="heading">Proyek</Text>
      <Text variant="secondary" className="mt-0.5">
        {projectCount} proyek aktif · {devCount} pengembangan
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Buat proyek baru"
        onPress={() => router.push("/(tabs)/(matrix)/new" as any)}
        className="mt-3 self-start rounded bg-primary px-3 py-1.5 active:opacity-80"
      >
        <Text className="text-[12px] font-semibold uppercase tracking-wide text-surface">
          + Buat proyek
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filter bar (search + status pills)
// ---------------------------------------------------------------------------
function FilterBar({
  query,
  onQuery,
  status,
  onStatus,
}: {
  query: string;
  onQuery: (q: string) => void;
  status: string;
  onStatus: (s: string) => void;
}) {
  return (
    <View className="bg-bg pb-2 pt-1">
      {/* Search input */}
      <View className="mb-2 flex-row items-center rounded border border-border bg-surface px-3 py-2">
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Cari proyek, klien, atau lokasi…"
          placeholderTextColor="#847E78"
          accessibilityLabel="Cari proyek"
          className="flex-1 text-[14px] text-text"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>
      {/* Status pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 px-1">
        <View className="flex-row gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = status === f.value;
            return (
              <Pressable
                key={f.value}
                testID={`filter-pill-${f.value}`}
                onPress={() => onStatus(f.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={f.label}
                className={`rounded px-2.5 py-1 ${
                  active
                    ? "bg-primary"
                    : "border border-border bg-surface"
                } active:opacity-80`}
              >
                <Text
                  className={`text-[11px] font-semibold uppercase tracking-wide ${
                    active ? "text-surface" : "text-text-sec"
                  }`}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section header (collapsible)
// ---------------------------------------------------------------------------
function SectionHeader({
  group,
  collapsed,
  onToggle,
}: {
  group: ProjectGroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`${group.name}, ${group.projects.length} proyek`}
      className="flex-row items-center justify-between bg-primary px-4 py-2.5 active:opacity-80"
    >
      <Text className="text-[11px] font-semibold uppercase tracking-widest text-surface">
        {collapsed ? "▸" : "▾"} {group.name} · {group.projects.length}
      </Text>
      {group.area_label ? (
        <Text className="text-[11px] text-surface/60">{group.area_label}</Text>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function MatrixScreen() {
  const { data: projects, isLoading: projLoading, isError, error, refetch } = useProjects();
  const { data: developments } = useDevelopments();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo<ProjectGroup[]>(() => {
    if (!projects) return [];
    return groupProjects(filterProjects(projects, { query, status }));
  }, [projects, query, status]);

  // Build SectionList sections, omitting collapsed groups' data
  const sections = useMemo<Section[]>(
    () =>
      groups.map((g) => {
        const key = g.id ?? "__ungrouped__";
        const isCollapsed = collapsed.has(key);
        return {
          ...g,
          data: isCollapsed ? [] : g.projects,
        } as Section;
      }),
    [groups, collapsed],
  );

  const totalFiltered = groups.reduce((n, g) => n + g.projects.length, 0);
  const activeCount = projects?.filter((p) => p.status !== "closed").length ?? 0;
  const devCount = developments?.length ?? 0;

  function toggleCollapse(groupId: string | null) {
    const key = groupId ?? "__ungrouped__";
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // --- Loading state ---
  if (projLoading) {
    return (
      <Screen className="gap-2 pt-3">
        <OfflineBanner />
        <LandingHeader projectCount={0} devCount={0} />
        {[0, 1, 2].map((i) => (
          <View key={i} className="mb-2 overflow-hidden rounded border border-border/40">
            <Skeleton className="h-8" />
            <Skeleton className="mx-3 mt-3 h-24" />
            <Skeleton className="mx-3 mb-3 mt-2 h-12" />
          </View>
        ))}
      </Screen>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <Screen>
        <OfflineBanner />
        <ErrorState
          message={`Gagal memuat proyek: ${(error as Error).message}`}
          onRetry={refetch}
        />
      </Screen>
    );
  }

  // --- No projects at all ---
  if (!projects || projects.length === 0) {
    return (
      <Screen>
        <OfflineBanner />
        <LandingHeader projectCount={0} devCount={devCount} />
        <EmptyState message="Belum ada proyek yang ditugaskan." />
      </Screen>
    );
  }

  // --- Filtered empty (have projects, but filter returns nothing) ---
  const FilteredEmpty = totalFiltered === 0 ? (
    <View className="rounded border border-dashed border-border p-6">
      <Text variant="secondary" className="text-center">
        Tidak ada proyek yang cocok dengan filter.
      </Text>
    </View>
  ) : null;

  return (
    <Screen className="pt-0">
      <OfflineBanner />
      <SectionList<ProjectListItem, ProjectGroup>
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        // Sticky filter bar + header via ListHeaderComponent
        ListHeaderComponent={
          <>
            <LandingHeader projectCount={activeCount} devCount={devCount} />
            <FilterBar
              query={query}
              onQuery={setQuery}
              status={status}
              onStatus={setStatus}
            />
            {FilteredEmpty}
          </>
        }
        renderSectionHeader={({ section }) => {
          const group = section as unknown as ProjectGroup;
          const key = group.id ?? "__ungrouped__";
          // Don't render section headers if filter returns nothing
          if (totalFiltered === 0) return null;
          return (
            <View className="mb-0.5 mt-3 overflow-hidden rounded-t border border-border/40">
              <SectionHeader
                group={group}
                collapsed={collapsed.has(key)}
                onToggle={() => toggleCollapse(group.id)}
              />
            </View>
          );
        }}
        renderSectionFooter={({ section }) => {
          const group = section as unknown as ProjectGroup;
          if (totalFiltered === 0) return null;
          const key = group.id ?? "__ungrouped__";
          const isCollapsed = collapsed.has(key);
          if (isCollapsed) return null;
          // Bottom rounded border for the section container
          return <View className="mb-3 rounded-b border-x border-b border-border/40 px-3 pb-3" />;
        }}
        renderItem={({ item, section }) => {
          const group = section as unknown as ProjectGroup;
          const key = group.id ?? "__ungrouped__";
          const isCollapsed = collapsed.has(key);
          if (isCollapsed || totalFiltered === 0) return null;
          return (
            <View className="border-x border-border/40 px-3 pt-3">
              <ProjectCard project={item} />
            </View>
          );
        }}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
