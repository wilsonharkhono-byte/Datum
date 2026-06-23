/**
 * RoomsScreen — Ruangan (urgency glance) + Areas manager + AI detect.
 *
 * Two sections toggled by a segmented control:
 *   "Ruangan"  — read-only sorted list of rooms with stage/blocker/next-action
 *   "Area"     — CRUD list of areas with add/edit/delete/reorder + AI suggest
 *
 * Param `slug` = project_code (same convention as schedule/board screens).
 * projectId is resolved from the rooms query result (avoids an extra round-trip).
 */

import { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  RefreshControl,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { RoomRow } from "@/components/rooms/RoomRow";
import { AreaManagerRow } from "@/components/areas/AreaManagerRow";
import { AreaSuggestSheet } from "@/components/areas/AreaSuggestSheet";
import { useRooms, useAreas } from "@/lib/query/hooks";
import {
  useCreateArea,
  useUpdateArea,
  useDeleteArea,
  useReorderAreas,
  useApplyAreaProposal,
} from "@/lib/query/mutations";
import { useAreaGatesRealtime } from "@/lib/realtime/useRealtimeInvalidation";
import { relativeTimeId, AREA_TYPES, type AreaType } from "@datum/core";
import type { Area } from "@datum/db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Tab = "rooms" | "areas";

const AREA_TYPE_LABELS: Record<AreaType, string> = {
  bathroom: "Kamar Mandi",
  kitchen: "Dapur",
  bedroom: "Kamar Tidur",
  living: "Ruang Tamu",
  dining: "Ruang Makan",
  garden: "Taman",
  circulation: "Sirkulasi",
  utility: "Utilitas",
  general: "Umum",
};

// Move an item in an array, returning new array
function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = [...arr];
  // splice always returns an array; the item must exist given valid index
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const item = next.splice(from, 1)[0]!;
  next.splice(to, 0, item);
  return next;
}

// ─── AddAreaForm ──────────────────────────────────────────────────────────────

type AddAreaFormProps = {
  projectId: string;
  onSubmit: (input: {
    areaCode: string;
    areaName: string;
    floor?: string;
    areaType: AreaType;
  }) => void;
  isPending: boolean;
};

function AddAreaForm({ onSubmit, isPending }: AddAreaFormProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [floor, setFloor] = useState("");
  const [areaType, setAreaType] = useState<AreaType>("general");
  const [expanded, setExpanded] = useState(false);

  function handleSubmit() {
    if (!name.trim() || !code.trim()) return;
    onSubmit({
      areaCode: code.trim(),
      areaName: name.trim(),
      floor: floor.trim() || undefined,
      areaType,
    });
    setName("");
    setCode("");
    setFloor("");
    setAreaType("general");
    setExpanded(false);
  }

  if (!expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        className="mb-3 items-center rounded border border-dashed border-border py-2.5 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel="Tambah area baru"
        testID="add-area-open-button"
      >
        <Text className="text-[14px] text-text-sec">+ Tambah Area</Text>
      </Pressable>
    );
  }

  return (
    <View className="mb-3 rounded border border-border/60 bg-surface p-3">
      <Text variant="label" className="mb-2">
        Area Baru
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Nama area"
        placeholderTextColor="#B0A899"
        className="mb-2 rounded border border-border bg-bg px-2 py-1.5 text-[14px] text-text"
        maxLength={120}
        editable={!isPending}
        accessibilityLabel="Nama area"
        testID="add-area-name-input"
      />

      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Kode (mis. L1-KM)"
        placeholderTextColor="#B0A899"
        className="mb-2 rounded border border-border bg-bg px-2 py-1.5 text-[14px] text-text"
        maxLength={40}
        autoCapitalize="characters"
        editable={!isPending}
        accessibilityLabel="Kode area"
        testID="add-area-code-input"
      />

      <TextInput
        value={floor}
        onChangeText={setFloor}
        placeholder="Lantai (opsional)"
        placeholderTextColor="#B0A899"
        className="mb-2 rounded border border-border bg-bg px-2 py-1.5 text-[14px] text-text"
        maxLength={40}
        editable={!isPending}
        accessibilityLabel="Lantai"
        testID="add-area-floor-input"
      />

      {/* Type picker */}
      <View className="mb-3 flex-row flex-wrap gap-1">
        {AREA_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setAreaType(t)}
            className={`rounded-sm border px-2 py-0.5 ${
              areaType === t
                ? "border-primary bg-primary/10"
                : "border-border bg-surface-alt"
            }`}
            accessibilityRole="radio"
            accessibilityLabel={AREA_TYPE_LABELS[t]}
            accessibilityState={{ checked: areaType === t }}
          >
            <Text
              className={`text-[12px] ${areaType === t ? "text-primary font-semibold" : "text-text-sec"}`}
            >
              {AREA_TYPE_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="flex-row gap-2">
        <Pressable
          onPress={handleSubmit}
          disabled={isPending || !name.trim() || !code.trim()}
          className="flex-1 items-center rounded bg-primary py-2 active:opacity-80 disabled:opacity-40"
          accessibilityRole="button"
          testID="add-area-submit-button"
        >
          {isPending ? (
            <ActivityIndicator size="small" color="#FDFAF6" />
          ) : (
            <Text className="text-[14px] font-semibold text-[#FDFAF6]">Tambah</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => setExpanded(false)}
          className="flex-1 items-center rounded border border-border py-2 active:opacity-70"
          accessibilityRole="button"
        >
          <Text className="text-[14px] text-text-sec">Batal</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── RoomsScreen ─────────────────────────────────────────────────────────────

export default function RoomsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("rooms");
  const [refreshing, setRefreshing] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────

  const roomsQ = useRooms(slug ?? "");
  const projectId = roomsQ.data?.projectId;
  const areasQ = useAreas(projectId);

  // Live realtime: area_gate_status / areas / card_areas changes invalidate
  // rooms + areas + matrix + areaTargets. Refetch-on-focus stays as fallback.
  useAreaGatesRealtime(projectId, slug ?? undefined);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createArea = useCreateArea(projectId ?? "", slug ?? "");
  const updateArea = useUpdateArea(projectId ?? "", slug ?? "");
  const deleteArea = useDeleteArea(projectId ?? "", slug ?? "");
  const reorderAreas = useReorderAreas(projectId ?? "", slug ?? "");
  const applyProposal = useApplyAreaProposal(projectId ?? "", slug ?? "");

  // ── Refresh ───────────────────────────────────────────────────────────────

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([roomsQ.refetch(), areasQ.refetch()]);
    setRefreshing(false);
  }, [roomsQ, areasQ]);

  // ── Reorder helpers ───────────────────────────────────────────────────────

  function moveArea(areas: Area[], fromIndex: number, toIndex: number) {
    if (!projectId) return;
    const reordered = moveItem(areas, fromIndex, toIndex);
    reorderAreas.mutate({
      projectId,
      areaIds: reordered.map((a) => a.id),
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const now = Date.now();
  const rooms = roomsQ.data?.rooms ?? [];
  const areas = areasQ.data ?? [];

  const isRoomsLoading = roomsQ.isLoading;
  const isAreasLoading = areasQ.isLoading && activeTab === "areas";

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Ruangan & Area" }} />

      {/* Segmented control */}
      <View className="flex-row border-b border-border/40 px-4 pb-0 pt-3">
        {(["rooms", "areas"] as Tab[]).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`mr-4 pb-2.5 ${
              activeTab === tab
                ? "border-b-2 border-primary"
                : "border-b-2 border-transparent"
            }`}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Text
              className={`text-[15px] font-semibold ${
                activeTab === tab ? "text-primary" : "text-text-muted"
              }`}
            >
              {tab === "rooms" ? "Ruangan" : "Area"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Tab: Rooms ───────────────────────────────────────────────────── */}
      {activeTab === "rooms" && (
        <ScrollView
          className="flex-1 px-4 pt-3"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          testID="rooms-scroll"
        >
          {isRoomsLoading ? (
            <>
              <Skeleton className="mb-2 h-20 w-full" />
              <Skeleton className="mb-2 h-20 w-full" />
              <Skeleton className="mb-2 h-16 w-full" />
            </>
          ) : roomsQ.isError ? (
            <ErrorState
              message={`Gagal memuat data ruangan: ${(roomsQ.error as Error)?.message ?? "kesalahan tidak diketahui"}`}
              onRetry={() => void roomsQ.refetch()}
            />
          ) : rooms.length === 0 ? (
            <EmptyState message="Belum ada ruangan. Tambahkan area untuk melihat status di sini." />
          ) : (
            <>
              <Text variant="secondary" className="mb-3">
                {rooms.length} ruangan · diurutkan berdasarkan urgensi
              </Text>
              {rooms.map((room) => (
                <RoomRow
                  key={room.areaId}
                  room={room}
                  relTime={relativeTimeId(room.lastActivityAt, now)}
                  testID={`room-row-${room.areaId}`}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Tab: Areas ───────────────────────────────────────────────────── */}
      {activeTab === "areas" && (
        <ScrollView
          className="flex-1 px-4 pt-3"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          testID="areas-scroll"
        >
          {/* Add area form */}
          {projectId ? (
            <AddAreaForm
              projectId={projectId}
              onSubmit={(input) =>
                createArea.mutate({
                  areaCode: input.areaCode,
                  areaName: input.areaName,
                  floor: input.floor,
                  areaType: input.areaType,
                })
              }
              isPending={createArea.isPending}
            />
          ) : null}

          {/* AI suggest (only when WEB_BASE_URL is set) */}
          {projectId ? (
            <AreaSuggestSheet
              projectId={projectId}
              existingAreas={areas}
              onApply={({ areas: proposedAreas, assignments }) =>
                applyProposal.mutate({
                  projectId,
                  areas: proposedAreas.map((a) => ({
                    areaCode: a.areaCode,
                    areaName: a.areaName,
                    floor: a.floor ?? undefined,
                    areaType: a.areaType,
                  })),
                  assignments: assignments.map((asg) => ({
                    cardId: asg.cardId,
                    areaCode: asg.areaCode,
                  })),
                })
              }
              isApplying={applyProposal.isPending}
            />
          ) : null}

          {/* Apply error */}
          {applyProposal.isError ? (
            <View className="mt-2 rounded border border-critical/40 bg-critical-bg px-3 py-2">
              <Text className="text-[13px] text-critical">
                Gagal menerapkan usulan: {(applyProposal.error as Error)?.message}
              </Text>
            </View>
          ) : null}

          {/* Apply success */}
          {applyProposal.isSuccess ? (
            <View className="mt-2 rounded border border-ok/40 bg-ok-bg px-3 py-2">
              <Text className="text-[13px] text-ok">
                Usulan berhasil diterapkan · {(applyProposal.data as { createdAreas?: number; linkedCards?: number })?.createdAreas ?? 0} area baru,{" "}
                {(applyProposal.data as { createdAreas?: number; linkedCards?: number })?.linkedCards ?? 0} kartu ditautkan
              </Text>
            </View>
          ) : null}

          {/* Mutation errors */}
          {(createArea.isError || updateArea.isError || deleteArea.isError) ? (
            <View className="mt-2 rounded border border-critical/40 bg-critical-bg px-3 py-2">
              <Text className="text-[13px] text-critical">
                {(createArea.error ?? updateArea.error ?? deleteArea.error) instanceof Error
                  ? ((createArea.error ?? updateArea.error ?? deleteArea.error) as Error).message
                  : "Operasi area gagal."}
              </Text>
            </View>
          ) : null}

          {/* Areas list */}
          {isAreasLoading ? (
            <>
              <Skeleton className="mb-2 h-14 w-full" />
              <Skeleton className="mb-2 h-14 w-full" />
            </>
          ) : areasQ.isError ? (
            <ErrorState
              message={`Gagal memuat area: ${(areasQ.error as Error)?.message ?? "kesalahan tidak diketahui"}`}
              onRetry={() => void areasQ.refetch()}
            />
          ) : areas.length === 0 ? (
            <EmptyState message="Belum ada area. Tambah area di atas atau gunakan deteksi AI." />
          ) : (
            <>
              <Text variant="secondary" className="mb-2">
                {areas.length} area
              </Text>
              {areas.map((area, idx) => (
                <AreaManagerRow
                  key={area.id}
                  area={area}
                  isFirst={idx === 0}
                  isLast={idx === areas.length - 1}
                  onMoveUp={() => moveArea(areas, idx, idx - 1)}
                  onMoveDown={() => moveArea(areas, idx, idx + 1)}
                  onDelete={(areaId, projectIdArg) =>
                    deleteArea.mutate({ areaId, projectId: projectIdArg })
                  }
                  onUpdate={(patch) => updateArea.mutate(patch)}
                  isReordering={reorderAreas.isPending}
                  isMutating={
                    createArea.isPending ||
                    updateArea.isPending ||
                    deleteArea.isPending
                  }
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
