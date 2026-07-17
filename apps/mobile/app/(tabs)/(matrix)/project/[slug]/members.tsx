/**
 * MembersScreen — project member / access management.
 *
 * Lists active project_staff rows; principal/admin can:
 *   • Remove a member (confirm via Alert.alert).
 *   • Add an existing staff member (picker from getAvailableStaff).
 *
 * Staff creation (Buat staf baru):
 *   Shows a notice button. /api/staff/create does not yet exist — this is
 *   a FLAGGED STUB. See comment below for the roadmap decision.
 *
 * Role gate: canManageAccess(staff) from @datum/core. RLS is the backstop.
 *
 * States: loading skeleton / empty / error / offline-aware.
 */

import { useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { onlineManager } from "@tanstack/react-query";
import { canManageAccess, keys } from "@datum/core";
import type { ProjectMemberRow } from "@datum/core";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Button } from "@/components/ui/Button";
import { ProjectMemberRow as MemberRowCard } from "@/components/members/MemberRow";
import { useProjectMembers, useAvailableStaff, useProjectSettings } from "@/lib/query/hooks";
import { useAddProjectMember, useRemoveProjectMember } from "@/lib/query/mutations";
import { useSession } from "@/lib/session/session";
import { useQueryClient } from "@tanstack/react-query";
import { StaffCreateForm } from "@/components/members/StaffCreateForm";

// ─── Role options for the add-member picker ───────────────────────────────────

const ROLE_OPTIONS = [
  { value: "designer", label: "Desainer" },
  { value: "pic", label: "PIC" },
  { value: "site_supervisor", label: "Supervisor" },
  { value: "estimator", label: "Estimator" },
  { value: "admin", label: "Admin" },
  { value: "principal", label: "Principal" },
];

// ─── AddMemberPicker ──────────────────────────────────────────────────────────

type AddMemberPickerProps = {
  projectId: string;
  activeStaffIds: Set<string>;
};

function AddMemberPicker({ projectId, activeStaffIds }: AddMemberPickerProps) {
  const { data: staff, isLoading } = useAvailableStaff();
  const addMutation = useAddProjectMember(projectId);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [role, setRole] = useState("designer");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const addable = (staff ?? []).filter((s) => !activeStaffIds.has(s.id));

  if (isLoading) {
    return <Skeleton className="h-10 rounded" />;
  }

  if (addable.length === 0) {
    return (
      <Text variant="secondary">
        Semua staf aktif sudah jadi anggota proyek ini.
      </Text>
    );
  }

  async function handleAdd() {
    if (!selectedStaffId) return;
    const person = addable.find((s) => s.id === selectedStaffId);
    try {
      await addMutation.mutateAsync({ staffId: selectedStaffId, roleOnProject: role });
      const label = ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
      setSuccessMsg(`${person?.full_name ?? "Staf"} ditambahkan sebagai ${label}.`);
      setSelectedStaffId(null);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: unknown) {
      Alert.alert("Gagal menambahkan", e instanceof Error ? e.message : "Coba lagi");
    }
  }

  return (
    <View className="gap-3">
      {/* Staff picker */}
      <View>
        <Text variant="label" className="mb-1">Pilih Staf</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-row gap-1.5"
          contentContainerStyle={{ gap: 6 }}
        >
          {addable.map((s) => {
            const active = s.id === selectedStaffId;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSelectedStaffId(active ? null : s.id)}
                className={`rounded border px-3 py-1.5 ${active ? "border-primary bg-primary/15" : "border-border/60 bg-surface"}`}
              >
                <Text className={`text-[13px] ${active ? "text-primary font-medium" : "text-text-sec"}`}>
                  {s.full_name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Role picker */}
      <View>
        <Text variant="label" className="mb-1">Peran di Proyek</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {ROLE_OPTIONS.map((r) => {
            const active = r.value === role;
            return (
              <Pressable
                key={r.value}
                onPress={() => setRole(r.value)}
                className={`rounded px-3 py-1.5 ${active ? "bg-primary" : "border border-border/60 bg-surface"}`}
              >
                <Text className={`text-[13px] font-medium ${active ? "text-[#FDFAF6]" : "text-text-sec"}`}>
                  {r.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <Button
        label="Tambahkan ke Proyek"
        onPress={handleAdd}
        disabled={!selectedStaffId || addMutation.isPending}
        loading={addMutation.isPending}
      />

      {successMsg ? (
        <View className="rounded bg-success/15 px-3 py-2">
          <Text className="text-[13px] text-success">{successMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

// StaffCreateStub removed — replaced by StaffCreateForm (wired to /api/staff/create).

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MembersScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { staff: currentStaff } = useSession();
  const canManage = canManageAccess(currentStaff);
  const queryClient = useQueryClient();

  const settingsQ = useProjectSettings(slug);
  const projectId = settingsQ.data?.id;

  const membersQ = useProjectMembers(projectId);
  const removeMutation = useRemoveProjectMember(projectId ?? "");

  const isOnline = onlineManager.isOnline();

  // Active members only
  const activeMembers = (membersQ.data ?? []).filter((m) => !m.active_until);
  const activeStaffIds = new Set(activeMembers.map((m) => m.staff_id));

  function handleRemove(member: ProjectMemberRow) {
    const name = member.staff?.full_name ?? "staf ini";
    Alert.alert(
      "Hapus Anggota",
      `Hapus ${name} dari proyek ini?`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus",
          style: "destructive",
          onPress: async () => {
            try {
              await removeMutation.mutateAsync({
                staffId: member.staff_id,
                roleOnProject: member.role_on_project,
              });
            } catch (e: unknown) {
              Alert.alert("Gagal menghapus", e instanceof Error ? e.message : "Coba lagi");
            }
          },
        },
      ],
    );
  }

  // Loading state: waiting for project settings (to get projectId)
  const isLoading = settingsQ.isLoading || (!!projectId && membersQ.isLoading);
  const isError = settingsQ.isError || membersQ.isError;
  const errorMsg =
    (settingsQ.error as Error | null)?.message ??
    (membersQ.error as Error | null)?.message ??
    "Gagal memuat data";

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Anggota Proyek" }} />

      {!isOnline && <OfflineBanner />}

      {isLoading ? (
        <View className="flex-1 px-4 pt-4 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded" />
          ))}
        </View>
      ) : isError ? (
        <ErrorState
          message={errorMsg}
          onRetry={() => {
            void settingsQ.refetch();
            void membersQ.refetch();
          }}
        />
      ) : !settingsQ.data ? (
        <EmptyState message={`Proyek tidak ditemukan: ${slug}`} />
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 32, paddingTop: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Project header */}
          <Text variant="label" className="mb-0.5">
            {settingsQ.data.project_code}
          </Text>
          <Text variant="heading" className="mb-4">
            Anggota Proyek
          </Text>

          {/* Help copy */}
          <Text variant="secondary" className="mb-4">
            Hanya anggota di daftar ini yang bisa membaca dan menulis ke kartu,
            aktivitas, dan komentar proyek ini. Principal, admin, dan estimator
            selalu bisa membaca semua proyek.
          </Text>

          {/* Active members section */}
          <View className="mb-2 flex-row items-baseline justify-between">
            <Text variant="label">Anggota Aktif</Text>
            <Text variant="muted">{activeMembers.length} orang</Text>
          </View>

          {activeMembers.length === 0 ? (
            <View className="mb-4 rounded border border-border/40 bg-surface px-3 py-4">
              <Text variant="secondary" className="text-center">
                Belum ada anggota aktif. Tambah anggota di bawah agar mereka punya akses.
              </Text>
            </View>
          ) : (
            <View className="mb-4">
              {activeMembers.map((m) => (
                <MemberRowCard
                  key={`${m.staff_id}-${m.role_on_project}`}
                  member={m}
                  canManage={canManage}
                  onRemove={handleRemove}
                />
              ))}
              {removeMutation.isPending && (
                <ActivityIndicator size="small" className="mt-1" />
              )}
            </View>
          )}

          {/* Add member section — principal/admin only */}
          {canManage ? (
            <View>
              <Text variant="label" className="mb-3">Tambah Anggota</Text>

              <AddMemberPicker
                projectId={projectId!}
                activeStaffIds={activeStaffIds}
              />

              {/* Staff-create form */}
              <View className="mt-4">
                <Text variant="label" className="mb-2">Buat Staf Baru</Text>
                <StaffCreateForm
                  onCreated={() => {
                    // Invalidate the available-staff query so the add-member
                    // picker shows the newly created staff.
                    void queryClient.invalidateQueries({ queryKey: keys.availableStaff() });
                  }}
                />
              </View>
            </View>
          ) : (
            <Text variant="muted" className="mt-2">
              Hanya principal dan admin yang bisa mengelola anggota proyek.
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
