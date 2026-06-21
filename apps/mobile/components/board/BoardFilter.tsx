import { useState } from "react";
import { View, TextInput, Pressable, ScrollView } from "react-native";
import { Text } from "@/components/ui/Text";

export type StatusFilter = Set<"active" | "dormant" | "closed">;
export type LabelFilterKind = "needs_decision" | "blocked" | "awaiting" | "overdue";
export type LabelFilter = Set<LabelFilterKind>;

const LABEL_FILTER_LABELS: Record<LabelFilterKind, string> = {
  needs_decision: "Butuh keputusan",
  blocked:        "Terblokir",
  awaiting:       "Menunggu",
  overdue:        "Lewat target",
};

const STATUS_LABELS: Record<"active" | "dormant" | "closed", string> = {
  active:  "Aktif",
  dormant: "Tertunda",
  closed:  "Selesai",
};

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  statuses: StatusFilter;
  onStatusesChange: (s: StatusFilter) => void;
  labelFilter: LabelFilter;
  onLabelFilterChange: (s: LabelFilter) => void;
  matched: number;
  total: number;
};

export function BoardFilter({
  query,
  onQueryChange,
  statuses,
  onStatusesChange,
  labelFilter,
  onLabelFilterChange,
  matched,
  total,
}: Props) {
  const [showFilters, setShowFilters] = useState(false);

  function toggleStatus(s: "active" | "dormant" | "closed") {
    const next = new Set(statuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    if (next.size === 0) next.add(s); // never fully empty
    onStatusesChange(next);
  }

  function toggleLabel(k: LabelFilterKind) {
    const next = new Set(labelFilter);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onLabelFilterChange(next);
  }

  const activeFilters = labelFilter.size + (statuses.size < 3 ? 1 : 0);

  return (
    <View className="border-b border-border bg-surface px-3 py-2">
      {/* Top row: search + filter toggle + count */}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Cari judul atau ringkasan…"
          placeholderTextColor="#847E78"
          className="min-h-[36px] flex-1 rounded border border-border px-3 text-[13px] text-text"
          accessibilityLabel="Cari kartu"
        />
        <Pressable
          onPress={() => setShowFilters((v) => !v)}
          className={`min-h-[36px] flex-row items-center gap-1.5 rounded border px-2.5 ${
            activeFilters > 0 ? "border-accent" : "border-border"
          }`}
          accessibilityRole="button"
          accessibilityLabel="Filter"
          accessibilityState={{ expanded: showFilters }}
        >
          <Text className={`text-[11px] font-semibold uppercase tracking-wide ${activeFilters > 0 ? "text-accent-dark" : "text-text-sec"}`}>
            Filter
          </Text>
          {activeFilters > 0 && (
            <View className="h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1">
              <Text className="text-[9px] text-[#FDFAF6]">{activeFilters}</Text>
            </View>
          )}
        </Pressable>
        <Text className="text-[10px] text-text-muted">
          {matched === total ? `${total}` : `${matched}/${total}`}
        </Text>
      </View>

      {/* Collapsible filter panel */}
      {showFilters && (
        <View className="mt-2 gap-2">
          {/* Status chips */}
          <View>
            <Text className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-text-sec">
              Status
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-1.5">
                {(["active", "dormant", "closed"] as const).map((s) => {
                  const on = statuses.has(s);
                  return (
                    <Pressable
                      key={s}
                      onPress={() => toggleStatus(s)}
                      className={`rounded-full border px-3 py-1 ${on ? "border-accent bg-accent-dark" : "border-border bg-surface"}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Text className={`text-[11px] font-medium ${on ? "text-[#FDFAF6]" : "text-text-sec"}`}>
                        {STATUS_LABELS[s]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Label filter chips */}
          <View>
            <Text className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-text-sec">
              Perlu
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-1.5">
                {(Object.keys(LABEL_FILTER_LABELS) as LabelFilterKind[]).map((k) => {
                  const on = labelFilter.has(k);
                  return (
                    <Pressable
                      key={k}
                      onPress={() => toggleLabel(k)}
                      className={`rounded-full border px-3 py-1 ${on ? "border-accent bg-accent-dark" : "border-border bg-surface"}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Text className={`text-[11px] font-medium ${on ? "text-[#FDFAF6]" : "text-text-sec"}`}>
                        {LABEL_FILTER_LABELS[k]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Clear */}
          <Pressable
            onPress={() => setShowFilters(false)}
            accessibilityRole="button"
          >
            <Text className="text-[11px] text-text-muted">× Tutup filter</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
