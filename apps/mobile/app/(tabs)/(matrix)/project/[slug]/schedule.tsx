/**
 * Schedule & Readiness screen — per-area accordion (v1 locked design).
 *
 * Param `slug` = project_code (same URL segment as the board/matrix screens).
 * projectId is resolved from the already-cached board query so we avoid a
 * redundant round-trip.
 *
 * REALTIME GAP: The `area_gate_status` table does not yet have a Supabase
 * realtime publication. Gate-status changes (from cron recomputes or other
 * clients) will not push to this screen automatically. Kept fresh via:
 *   1. refetchOnWindowFocus on matrix + schedule queries.
 *   2. Pull-to-refresh (RefreshControl below).
 * Once the publication is enabled (DB migration needed), hook into
 * subscribeToProjectChanges in @datum/core/realtime and invalidate
 * keys.matrix(projectId) + keys.schedule(projectId).
 */

import { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  RefreshControl,
  Pressable,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { AreaGateCard } from "@/components/schedule/AreaGateCard";
import { GateAdvanceSheet, type AdvanceTarget } from "@/components/schedule/GateAdvanceSheet";
import { useBoard } from "@/lib/query/hooks";
import { useMatrix, useScheduleCells } from "@/lib/query/hooks";
import { useSetAreaTarget } from "@/lib/query/mutations";

// ─── RulesExplainer (light inline accordion) ──────────────────────────────────

function RulesExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <View className="mb-4 rounded border border-border/40 bg-surface">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between px-3 py-2.5 active:opacity-80"
        accessibilityRole="button"
        accessibilityLabel={`Aturan kesiapan, ${open ? "tutup" : "buka"}`}
      >
        <Text className="text-[13px] font-semibold text-text-sec">Aturan kesiapan</Text>
        <Text className="text-[13px] text-text-muted">{open ? "▲" : "▼"}</Text>
      </Pressable>
      {open ? (
        <View className="border-t border-border/30 px-3 pb-3 pt-2 gap-2">
          <Text className="text-[12px] text-text-sec font-semibold">Status sel</Text>
          <View className="gap-1">
            {[
              ["Belum mulai",  "Belum ada pekerjaan terkait gate ini"],
              ["Berjalan",     "Ada pekerjaan aktif"],
              ["Siap serah",   "Semua pekerjaan terkait selesai — bisa ditandai lewat"],
              ["Terblokir",    "Ada pekerjaan yang terblokir; perlu diselesaikan dulu"],
              ["Selesai",      "Gate telah dikonfirmasi selesai"],
            ].map(([s, d]) => (
              <View key={s} className="flex-row gap-2">
                <Text className="text-[11px] w-24 font-semibold text-text-sec">{s}</Text>
                <Text className="flex-1 text-[11px] text-text-muted">{d}</Text>
              </View>
            ))}
          </View>
          <Text className="mt-1 text-[11px] text-text-muted">
            Gate A–H mengikuti alur konstruksi: MEP Rough-in → Kamar Mandi → Plafon →
            Lantai & Kusen → Cat & Ironwork → Furniture → MEP Fit-out → Serah Terima.
            Rekomputasi status dijalankan oleh server setiap beberapa menit.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ScheduleSkeleton() {
  return (
    <View className="gap-3">
      {[0, 1, 2].map((i) => (
        <View key={i} className="rounded border border-border/30 bg-surface p-3 gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </View>
      ))}
    </View>
  );
}

// ─── ScheduleScreen ───────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const { slug: code } = useLocalSearchParams<{ slug: string }>();

  // Resolve projectId from the already-cached board query (avoids extra fetch).
  const boardQuery = useBoard(code ?? "");
  const projectId = boardQuery.data?.project.id;

  const matrixQuery = useMatrix(projectId);
  const scheduleQuery = useScheduleCells(projectId);
  const setTargetMutation = useSetAreaTarget(projectId ?? "");

  const [advanceTarget, setAdvanceTarget] = useState<AdvanceTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      matrixQuery.refetch(),
      scheduleQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [matrixQuery, scheduleQuery]);

  // Derive area target dates from scheduled cells
  const scheduledCells = scheduleQuery.data ?? [];

  function handleAdvanceGate(areaId: string, gateCode: string) {
    const area = matrixQuery.data?.areas.find((a) => a.id === areaId);
    if (!area || !projectId) return;
    setAdvanceTarget({
      projectId,
      areaId,
      areaName: area.area_name,
      gateCode,
    });
  }

  function handleSetTarget(areaId: string, targetDate: string | null) {
    return new Promise<void>((resolve) => {
      setTargetMutation.mutate(
        { areaId, targetDate },
        { onSettled: () => resolve() },
      );
    });
  }

  // Derive per-area target date from scheduled cells (first cell with target)
  function areaTargetDate(areaId: string): string | null {
    const cell = scheduledCells.find((c) => c.area_id === areaId && c.target_end_date);
    // area_gate_status cells carry target_end_date per gate. The "H" (Serah Terima)
    // gate's target_end_date is the canonical handover target for the area.
    const serahCell = scheduledCells.find((c) => c.area_id === areaId && c.gate_code === "H");
    return serahCell?.target_end_date ?? cell?.target_end_date ?? null;
  }

  // Loading: wait for board (to get projectId) then matrix
  const isLoading = boardQuery.isLoading || (!!projectId && matrixQuery.isLoading);
  const isError = matrixQuery.isError;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: code ? `${code} · Jadwal` : "Jadwal" }} />
      <OfflineBanner />

      {isLoading ? (
        <View className="flex-1 px-4 pt-4">
          <ScheduleSkeleton />
        </View>
      ) : isError ? (
        <ErrorState
          message="Gagal memuat jadwal. Periksa koneksi dan coba lagi."
          onRetry={onRefresh}
        />
      ) : !projectId ? (
        <ErrorState
          message={`Proyek tidak ditemukan: ${code}`}
          onRetry={() => boardQuery.refetch()}
        />
      ) : !matrixQuery.data ? (
        <ErrorState
          message="Data matriks tidak tersedia."
          onRetry={onRefresh}
        />
      ) : matrixQuery.data.areas.length === 0 ? (
        <ScrollView
          className="flex-1 px-4"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <EmptyState
            message={`Belum ada area di proyek ${code}. Tambah ruangan terlebih dahulu di layar Papan.`}
          />
        </ScrollView>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Project header */}
          <View className="mb-3">
            <Text variant="heading">{matrixQuery.data.project_name}</Text>
            <Text variant="muted">{matrixQuery.data.areas.length} area · tarik untuk perbarui</Text>
          </View>

          {/* Rules explainer */}
          <RulesExplainer />

          {/* Per-area accordion */}
          {matrixQuery.data.areas.map((area) => (
            <AreaGateCard
              key={area.id}
              area={area}
              matrix={matrixQuery.data!}
              scheduledCells={scheduledCells}
              onAdvanceGate={handleAdvanceGate}
              onSetTarget={handleSetTarget}
              targetDate={areaTargetDate(area.id)}
            />
          ))}
        </ScrollView>
      )}

      {/* Gate advance confirmation sheet */}
      {advanceTarget ? (
        <GateAdvanceSheet
          target={advanceTarget}
          onClose={() => setAdvanceTarget(null)}
          onConfirmed={() => {
            setAdvanceTarget(null);
            // Matrix will refresh via onSettled invalidation in useAdvanceGate.
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
