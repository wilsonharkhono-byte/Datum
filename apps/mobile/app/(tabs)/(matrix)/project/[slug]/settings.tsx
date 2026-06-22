/**
 * SettingsScreen — project settings shell with three tabs:
 *
 *   Akses    — link to the members screen (member management lives there)
 *   Area     — push to the rooms screen's Areas tab (areas CRUD lives there)
 *   Proyek   — project info edit form (ProjectInfoForm)
 *
 * Tab visibility:
 *   - principal / admin (canManageAccess): all three tabs
 *   - everyone else: only "Area" tab (read-only note for others)
 *
 * Role gate: canManageAccess(staff). RLS is the backstop.
 *
 * States: loading skeleton / empty / error / offline-aware.
 */

import { useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { onlineManager } from "@tanstack/react-query";
import { canManageAccess } from "@datum/core";
import type { UpdateProjectInputType } from "@datum/core";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Button } from "@/components/ui/Button";
import { ProjectInfoForm } from "@/components/settings/ProjectInfoForm";
import { useProjectSettings } from "@/lib/query/hooks";
import { useUpdateProject } from "@/lib/query/mutations";
import { useSession } from "@/lib/session/session";

// ─── Tab type ─────────────────────────────────────────────────────────────────

type SettingsTab = "akses" | "area" | "proyek";

// ─── SegmentedControl ─────────────────────────────────────────────────────────

type SegProps = {
  tabs: { key: SettingsTab; label: string }[];
  active: SettingsTab;
  onSelect: (t: SettingsTab) => void;
};

function SegmentedControl({ tabs, active, onSelect }: SegProps) {
  return (
    <View className="flex-row rounded border border-border/50 bg-surface-alt overflow-hidden">
      {tabs.map((t, i) => {
        const isActive = t.key === active;
        return (
          <Pressable
            key={t.key}
            onPress={() => onSelect(t.key)}
            className={`flex-1 items-center py-2 ${isActive ? "bg-primary" : ""} ${i > 0 ? "border-l border-border/50" : ""}`}
            accessibilityState={{ selected: isActive }}
          >
            <Text
              className={`text-[13px] font-medium ${isActive ? "text-[#FDFAF6]" : "text-text-sec"}`}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { staff: currentStaff } = useSession();
  const canManage = canManageAccess(currentStaff);

  const settingsQ = useProjectSettings(slug);
  const updateMutation = useUpdateProject(slug);

  const isOnline = onlineManager.isOnline();

  // Non-managers are forced to "area" tab
  const defaultTab: SettingsTab = canManage ? "akses" : "area";
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);

  // Available tabs depend on role
  const allTabs: { key: SettingsTab; label: string }[] = [
    { key: "akses", label: "Akses" },
    { key: "area", label: "Area" },
    { key: "proyek", label: "Proyek" },
  ];
  const visibleTabs = canManage ? allTabs : allTabs.filter((t) => t.key === "area");

  const isLoading = settingsQ.isLoading;
  const isError = settingsQ.isError;
  const errorMsg = (settingsQ.error as Error | null)?.message ?? "Gagal memuat data";

  async function handleSave(patch: UpdateProjectInputType) {
    await updateMutation.mutateAsync(patch);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Pengaturan Proyek" }} />

      {!isOnline && <OfflineBanner />}

      {isLoading ? (
        <View className="flex-1 px-4 pt-4 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded" />
          ))}
        </View>
      ) : isError ? (
        <ErrorState message={errorMsg} onRetry={() => void settingsQ.refetch()} />
      ) : !settingsQ.data ? (
        <EmptyState message={`Proyek tidak ditemukan: ${slug}`} />
      ) : (
        <View className="flex-1">
          {/* Header */}
          <View className="border-b border-border/50 px-4 pb-3 pt-4">
            <Text variant="label" className="mb-0.5">
              {settingsQ.data.project_code} · {settingsQ.data.project_name}
            </Text>
            <Text variant="heading" className="mb-3">Pengaturan</Text>
            <SegmentedControl
              tabs={visibleTabs}
              active={activeTab}
              onSelect={(t) => {
                // Enforce role gate — non-managers can only view "area"
                if (!canManage && t !== "area") return;
                setActiveTab(t);
              }}
            />
          </View>

          {/* Tab bodies */}
          {activeTab === "akses" ? (
            <ScrollView
              className="flex-1 px-4"
              contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
            >
              <Text variant="secondary" className="mb-4">
                Kelola anggota dan akses proyek — siapa yang bisa membaca dan menulis
                ke kartu, aktivitas, dan komentar proyek ini.
              </Text>
              <Button
                label="Buka Manajemen Anggota →"
                onPress={() =>
                  router.push(
                    `/(tabs)/(matrix)/project/${slug}/members` as never,
                  )
                }
              />
            </ScrollView>
          ) : activeTab === "area" ? (
            <ScrollView
              className="flex-1 px-4"
              contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
            >
              <Text variant="secondary" className="mb-4">
                Areas adalah ruangan atau zona fisik proyek. Mesin readiness
                menghitung status gate per area — kartu yang terkait ke sebuah area
                akan menggerakkan kolom area itu di matrix Gate × Area.
              </Text>
              <Button
                label="Buka Manajemen Area →"
                onPress={() =>
                  router.push(
                    `/(tabs)/(matrix)/project/${slug}/rooms` as never,
                  )
                }
              />
            </ScrollView>
          ) : (
            /* activeTab === "proyek" */
            <View className="flex-1 px-4 pt-4">
              <ProjectInfoForm
                project={settingsQ.data}
                canManage={canManage}
                onSave={handleSave}
                isSaving={updateMutation.isPending}
              />
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
