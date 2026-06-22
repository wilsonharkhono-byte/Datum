/**
 * MemberPicker — add/remove card members on mobile.
 *
 * Add flow: loads project staff list, displays non-member staff, tapping one
 * adds them as "watcher" (matching web default).
 *
 * Remove flow: shown inline on MemberRow via a remove button.
 */

import { useState } from "react";
import { View, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getProjectStaff } from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { Text } from "@/components/ui/Text";
import { useAddMember, useRemoveMember } from "@/lib/query/mutations";
import type { CardMemberWithStaff } from "@datum/core";

// ─── MemberPicker — pick a new member from project staff ─────────────────────

interface MemberPickerProps {
  cardId: string;
  projectId: string;
  addedByStaffId: string;
  existingMemberIds: string[];
}

export function MemberPicker({
  cardId,
  projectId,
  addedByStaffId,
  existingMemberIds,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const addMember = useAddMember(cardId);

  const staffQuery = useQuery({
    queryKey: ["project-staff", projectId],
    queryFn: () => getProjectStaff(supabase, projectId),
    enabled: open,
  });

  const candidates = (staffQuery.data ?? []).filter(
    (s) => !existingMemberIds.includes(s.id),
  );

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        className="mt-2 min-h-[44px] items-center justify-center rounded border border-dashed border-border/60 px-4"
        accessibilityLabel="Tambah anggota kartu"
      >
        <Text className="text-[13px] text-text-sec">+ Tambah anggota</Text>
      </Pressable>
    );
  }

  return (
    <View className="mt-2 rounded border border-border/60 bg-surface p-3">
      <View className="mb-2 flex-row items-center justify-between">
        <Text variant="label">Pilih anggota</Text>
        <Pressable
          onPress={() => setOpen(false)}
          className="min-h-[32px] min-w-[32px] items-center justify-center"
          accessibilityLabel="Tutup"
        >
          <Text className="text-[13px] text-text-sec">Tutup</Text>
        </Pressable>
      </View>

      {staffQuery.isPending ? (
        <ActivityIndicator />
      ) : staffQuery.isError ? (
        <Text className="text-[12px] text-text-muted italic">Gagal memuat staf.</Text>
      ) : candidates.length === 0 ? (
        <Text className="text-[12px] text-text-muted italic">
          Semua staf sudah menjadi anggota.
        </Text>
      ) : (
        <ScrollView style={{ maxHeight: 200 }}>
          {candidates.map((staff) => (
            <Pressable
              key={staff.id}
              onPress={() => {
                if (addMember.isPending) return;
                addMember.mutate(
                  {
                    staffId: staff.id,
                    role: "watcher",
                    addedByStaffId,
                  },
                  { onSuccess: () => setOpen(false) },
                );
              }}
              disabled={addMember.isPending}
              className="min-h-[44px] flex-row items-center justify-between rounded px-2 py-2 active:bg-surface-alt"
              accessibilityLabel={`Tambah ${staff.full_name ?? staff.id} sebagai anggota`}
            >
              <Text className="text-[14px] text-text">
                {staff.full_name ?? `Staff ${staff.id.slice(0, 6)}`}
              </Text>
              {addMember.isPending ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text className="text-[12px] text-text-muted">Pengamat</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── RemovableMemberRow — row with optional remove button ─────────────────────

const ROLE_LABEL: Record<string, string> = {
  watcher: "Pengamat",
  owner: "Penanggung Jawab",
  reviewer: "Peninjau",
  assignee: "Ditugaskan",
};

interface RemovableMemberRowProps {
  member: CardMemberWithStaff;
  cardId: string;
  /** Allow remove only when viewer can manage this card (non-null own staff). */
  canRemove?: boolean;
}

export function RemovableMemberRow({
  member,
  cardId,
  canRemove = false,
}: RemovableMemberRowProps) {
  const removeMember = useRemoveMember(cardId);
  const name =
    member.staff?.full_name ?? `Staff ${member.staff_id?.slice(0, 6) ?? "?"}`;
  const roleLabel = ROLE_LABEL[member.role ?? ""] ?? member.role ?? "—";

  return (
    <View className="mb-1.5 flex-row items-center justify-between rounded border border-border/40 bg-surface px-3 py-2">
      <View className="flex-1 flex-row items-center gap-2">
        <Text className="text-[14px] text-text">{name}</Text>
        <View className="rounded-sm bg-surface-alt px-2 py-0.5">
          <Text className="text-[11px] uppercase tracking-wide text-text-sec">
            {roleLabel}
          </Text>
        </View>
      </View>
      {canRemove ? (
        <Pressable
          onPress={() =>
            removeMember.mutate({
              staffId: member.staff_id,
              role: (member.role ?? "watcher") as import("@datum/core").CardMemberRole,
            })
          }
          disabled={removeMember.isPending}
          className="min-h-[32px] min-w-[32px] items-center justify-center"
          accessibilityLabel={`Hapus ${name} dari anggota`}
        >
          {removeMember.isPending ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text className="text-[12px] text-red-600">Hapus</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
