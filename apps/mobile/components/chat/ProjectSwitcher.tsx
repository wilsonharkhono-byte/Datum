/**
 * ProjectSwitcher — horizontal chip-row project picker for the assistant screen.
 *
 * Persists the selected project id in AsyncStorage under
 * `datum.assistant.projectId` and restores it on mount.
 *
 * States:
 *   loading  → skeleton chips
 *   empty    → "Belum ada proyek" notice
 *   ready    → scrollable row of project_code chips; selected chip is highlighted
 */

import { useEffect, useRef, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ProjectListItem } from "@datum/core";

// ─── Constants ────────────────────────────────────────────────────────────────

export const ASYNC_STORAGE_KEY = "datum.assistant.projectId";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectSwitcherProps {
  projects: ProjectListItem[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (project: ProjectListItem) => void;
}

// ─── ProjectSwitcher ──────────────────────────────────────────────────────────

export function ProjectSwitcher({
  projects,
  isLoading,
  selectedId,
  onSelect,
}: ProjectSwitcherProps) {
  if (isLoading) {
    return (
      <View
        className="flex-row gap-2 px-4 py-2"
        testID="project-switcher-loading"
        accessibilityLabel="Memuat proyek"
      >
        {[56, 72, 64].map((w) => (
          <Skeleton key={w} className={`h-7 w-[${w}px] rounded-full`} />
        ))}
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View
        className="items-center px-4 py-3"
        testID="project-switcher-empty"
      >
        <Text variant="muted" className="text-[13px]">
          Tidak ada proyek tersedia
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-2 px-4 py-2"
      testID="project-switcher"
    >
      {projects.map((p) => {
        const active = p.id === selectedId;
        return (
          <Pressable
            key={p.id}
            onPress={() => onSelect(p)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={p.project_name}
            testID={`project-chip-${p.project_code}`}
            className={`rounded-full border px-3 py-1 ${
              active
                ? "border-primary bg-primary"
                : "border-border/50 bg-surface-alt"
            }`}
          >
            <Text
              className={`text-[12px] font-semibold ${
                active ? "text-[#FDFAF6]" : "text-text-sec"
              }`}
            >
              {p.project_code}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── useProjectSelection ──────────────────────────────────────────────────────

/**
 * Manages selected project state with AsyncStorage persistence.
 *
 * Returns:
 *   selectedId    — null while restoring; string once resolved (may be "")
 *   isRestoring   — true during the initial AsyncStorage read
 *   select(p)     — call when user picks a project (persists + updates state)
 */
export function useProjectSelection(projects: ProjectListItem[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  // Track whether we've auto-defaulted after first load
  const defaulted = useRef(false);

  // Restore persisted id on mount
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ASYNC_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled) setSelectedId(stored ?? "");
      })
      .catch(() => {
        if (!cancelled) setSelectedId("");
      })
      .finally(() => {
        if (!cancelled) setIsRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Once projects load and we have a resolved selectedId, auto-default to the
  // first project if the stored id is empty or no longer valid.
  useEffect(() => {
    if (isRestoring || projects.length === 0 || defaulted.current) return;
    const valid = projects.some((p) => p.id === selectedId);
    if (!valid) {
      const first = projects[0];
      if (first) {
        defaulted.current = true;
        setSelectedId(first.id);
        void AsyncStorage.setItem(ASYNC_STORAGE_KEY, first.id);
      }
    } else {
      defaulted.current = true;
    }
  }, [isRestoring, projects, selectedId]);

  function select(project: ProjectListItem) {
    setSelectedId(project.id);
    void AsyncStorage.setItem(ASYNC_STORAGE_KEY, project.id);
  }

  return { selectedId, isRestoring, select };
}
