/**
 * AreaManagerRow — one area row in the CRUD list.
 *
 * Shows area name, code, floor, and type. Provides edit (inline form),
 * delete (with confirm), and up/down reorder buttons.
 */

import { useState } from "react";
import { View, Pressable, TextInput, Alert } from "react-native";
import { Text } from "@/components/ui/Text";
import { AREA_TYPES, type AreaType } from "@datum/core";
import type { Area } from "@datum/db";

type Props = {
  area: Area;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: (areaId: string, projectId: string) => void;
  onUpdate: (patch: {
    areaId: string;
    projectId: string;
    areaCode: string;
    areaName: string;
    floor?: string;
    areaType: AreaType;
    areaSqm?: number;
    sortOrder?: number;
  }) => void;
  isReordering?: boolean;
  isMutating?: boolean;
};

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

export function AreaManagerRow({
  area,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onDelete,
  onUpdate,
  isReordering,
  isMutating,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(area.area_name);
  const [draftCode, setDraftCode] = useState(area.area_code);
  const [draftFloor, setDraftFloor] = useState(area.floor ?? "");
  const [draftType, setDraftType] = useState<AreaType>(
    (area.area_type as AreaType) ?? "general",
  );

  function openEdit() {
    setDraftName(area.area_name);
    setDraftCode(area.area_code);
    setDraftFloor(area.floor ?? "");
    setDraftType((area.area_type as AreaType) ?? "general");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function submitEdit() {
    if (!draftName.trim() || !draftCode.trim()) return;
    onUpdate({
      areaId: area.id,
      projectId: area.project_id,
      areaCode: draftCode.trim(),
      areaName: draftName.trim(),
      floor: draftFloor.trim() || undefined,
      areaType: draftType,
      sortOrder: area.sort_order ?? undefined,
    });
    setEditing(false);
  }

  function confirmDelete() {
    Alert.alert(
      "Hapus area?",
      `Area "${area.area_name}" akan dihapus permanen. Area yang masih terkait kartu tidak bisa dihapus (RLS).`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus",
          style: "destructive",
          onPress: () => onDelete(area.id, area.project_id),
        },
      ],
    );
  }

  if (editing) {
    return (
      <View
        className="mb-2 rounded border border-primary/50 bg-surface p-3"
        accessibilityLabel={`Edit area ${area.area_name}`}
      >
        {/* Name */}
        <Text variant="label" className="mb-1">
          Nama Area
        </Text>
        <TextInput
          value={draftName}
          onChangeText={setDraftName}
          placeholder="Nama area"
          placeholderTextColor="#B0A899"
          className="mb-2 rounded border border-border bg-bg px-2 py-1.5 text-[14px] text-text"
          maxLength={120}
          editable={!isMutating}
          accessibilityLabel="Nama area"
          testID="edit-area-name-input"
        />

        {/* Code */}
        <Text variant="label" className="mb-1">
          Kode Area
        </Text>
        <TextInput
          value={draftCode}
          onChangeText={setDraftCode}
          placeholder="Kode (e.g. L1-KM)"
          placeholderTextColor="#B0A899"
          className="mb-2 rounded border border-border bg-bg px-2 py-1.5 text-[14px] text-text"
          maxLength={40}
          autoCapitalize="characters"
          editable={!isMutating}
          accessibilityLabel="Kode area"
          testID="edit-area-code-input"
        />

        {/* Floor */}
        <Text variant="label" className="mb-1">
          Lantai (opsional)
        </Text>
        <TextInput
          value={draftFloor}
          onChangeText={setDraftFloor}
          placeholder="Lantai (mis. L1)"
          placeholderTextColor="#B0A899"
          className="mb-3 rounded border border-border bg-bg px-2 py-1.5 text-[14px] text-text"
          maxLength={40}
          editable={!isMutating}
          accessibilityLabel="Lantai area"
          testID="edit-area-floor-input"
        />

        {/* Type picker (simple row buttons) */}
        <Text variant="label" className="mb-1">
          Tipe Area
        </Text>
        <View className="mb-3 flex-row flex-wrap gap-1">
          {AREA_TYPES.map((t) => (
            <Pressable
              key={t}
              onPress={() => setDraftType(t)}
              className={`rounded-sm border px-2 py-0.5 ${
                draftType === t
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface-alt"
              }`}
              accessibilityRole="radio"
              accessibilityLabel={AREA_TYPE_LABELS[t]}
              accessibilityState={{ checked: draftType === t }}
            >
              <Text
                className={`text-[12px] ${draftType === t ? "text-primary font-semibold" : "text-text-sec"}`}
              >
                {AREA_TYPE_LABELS[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Actions */}
        <View className="flex-row gap-2">
          <Pressable
            onPress={submitEdit}
            disabled={isMutating || !draftName.trim() || !draftCode.trim()}
            className="flex-1 items-center rounded bg-primary py-2 active:opacity-80 disabled:opacity-50"
            accessibilityRole="button"
            testID="edit-area-save-button"
          >
            <Text className="text-[14px] font-semibold text-[#FDFAF6]">Simpan</Text>
          </Pressable>
          <Pressable
            onPress={cancelEdit}
            className="flex-1 items-center rounded border border-border py-2 active:opacity-70"
            accessibilityRole="button"
            testID="edit-area-cancel-button"
          >
            <Text className="text-[14px] text-text-sec">Batal</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      className="mb-2 flex-row items-center gap-2 rounded border border-border/40 bg-surface px-3 py-2.5"
      accessibilityLabel={`Area ${area.area_name}`}
    >
      {/* Reorder buttons — gap-6 (24px) keeps each button's vertical hitSlop
          from overlapping its neighbor's (10px top + 10px bottom = 20px < 24px). */}
      <View className="gap-6">
        <Pressable
          onPress={onMoveUp}
          disabled={isFirst || isReordering || isMutating}
          hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }}
          className="items-center justify-center rounded p-1 active:opacity-60 disabled:opacity-30"
          accessibilityRole="button"
          accessibilityLabel={`Pindah ${area.area_name} ke atas`}
          testID={`area-move-up-${area.id}`}
        >
          <Text className="text-[14px] text-text-sec">▲</Text>
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={isLast || isReordering || isMutating}
          hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }}
          className="items-center justify-center rounded p-1 active:opacity-60 disabled:opacity-30"
          accessibilityRole="button"
          accessibilityLabel={`Pindah ${area.area_name} ke bawah`}
          testID={`area-move-down-${area.id}`}
        >
          <Text className="text-[14px] text-text-sec">▼</Text>
        </Pressable>
      </View>

      {/* Area info */}
      <View className="flex-1 min-w-0">
        <Text className="text-[14px] font-semibold text-text" numberOfLines={1}>
          {area.area_name}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-2">
          <Text className="text-[12px] text-text-muted">{area.area_code}</Text>
          {area.floor ? (
            <Text className="text-[12px] text-text-muted">· {area.floor}</Text>
          ) : null}
          <Text className="text-[12px] text-text-muted">
            · {AREA_TYPE_LABELS[(area.area_type as AreaType) ?? "general"]}
          </Text>
        </View>
      </View>

      {/* Edit + Delete */}
      <View className="flex-row gap-1">
        <Pressable
          onPress={openEdit}
          disabled={isMutating}
          className="rounded border border-border px-2 py-1 active:opacity-70 disabled:opacity-40"
          accessibilityRole="button"
          accessibilityLabel={`Edit area ${area.area_name}`}
          testID={`area-edit-${area.id}`}
        >
          <Text className="text-[12px] text-text-sec">Edit</Text>
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          disabled={isMutating}
          className="rounded border border-critical/50 px-2 py-1 active:opacity-70 disabled:opacity-40"
          accessibilityRole="button"
          accessibilityLabel={`Hapus area ${area.area_name}`}
          testID={`area-delete-${area.id}`}
        >
          <Text className="text-[12px] text-critical">Hapus</Text>
        </Pressable>
      </View>
    </View>
  );
}
