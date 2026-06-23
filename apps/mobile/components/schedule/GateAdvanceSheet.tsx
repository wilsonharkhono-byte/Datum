/**
 * GateAdvanceSheet — bottom sheet to confirm marking a gate as passed.
 *
 * Loads the Lampiran-A QA checklist (via useGateCheckpoints) as a skippable
 * reminder, shows a completed-date input, then calls useAdvanceGate on confirm.
 *
 * Ticking checklist items is NEVER required — it is purely a reminder. The
 * checked IDs are persisted as an audit trail but never block the advance.
 */

import { useState } from "react";
import { View, Pressable, ScrollView, TextInput, Modal, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { gateLabel } from "@datum/core";
import { useGateCheckpoints } from "@/lib/query/hooks";
import { useAdvanceGate } from "@/lib/query/mutations";

// ─── Today in WIB as YYYY-MM-DD ───────────────────────────────────────────────

function todayWIB(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdvanceTarget = {
  projectId: string;
  areaId: string;
  areaName: string;
  gateCode: string;
};

type Props = {
  target: AdvanceTarget;
  onClose: () => void;
  onConfirmed: () => void;
};

// ─── GateAdvanceSheet ─────────────────────────────────────────────────────────

export function GateAdvanceSheet({ target, onClose, onConfirmed }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [completedDate, setCompletedDate] = useState(todayWIB());
  const [submitError, setSubmitError] = useState<string | null>(null);

  const checkpointsQuery = useGateCheckpoints(target.gateCode);
  const advanceMutation = useAdvanceGate(target.projectId);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    setSubmitError(null);
    advanceMutation.mutate(
      {
        areaId: target.areaId,
        gateCode: target.gateCode as never,
        completedDate: completedDate || undefined,
        checkedTemplateIds: checked.size > 0 ? [...checked] : undefined,
      },
      {
        onSuccess: () => {
          onConfirmed();
        },
        onError: (err) => {
          setSubmitError(err instanceof Error ? err.message : "Gagal menyimpan");
        },
      },
    );
  }

  const checkpoints = checkpointsQuery.data;
  const pending = advanceMutation.isPending;
  const totalCount = checkpoints?.length ?? 0;
  const tickedCount = checked.size;

  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* Scrim */}
      <Pressable
        className="flex-1 bg-black/40"
        onPress={onClose}
        accessibilityLabel="Tutup"
      />

      {/* Sheet */}
      <View className="rounded-t-2xl bg-surface border-t border-border shadow-lg max-h-[88%]">
        {/* Header */}
        <View className="flex-row items-start justify-between gap-3 border-b border-border/50 bg-bg-oat px-4 py-3">
          <View className="flex-1 min-w-0">
            <Text className="text-[10px] font-semibold uppercase tracking-widest text-text-sec">
              Tandai gate selesai
            </Text>
            <Text className="mt-0.5 text-[15px] font-semibold text-text" numberOfLines={2}>
              Gate {target.gateCode} · {target.areaName}
            </Text>
            <Text className="mt-0.5 text-[11px] text-text-muted">
              {gateLabel(target.gateCode)}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            className="h-11 w-11 items-center justify-center rounded active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Tutup"
          >
            <Text className="text-[20px] text-text-muted">×</Text>
          </Pressable>
        </View>

        {/* Scrollable body */}
        <ScrollView className="flex-1 px-4 py-3" keyboardShouldPersistTaps="handled">
          {/* QA reminder label */}
          <Text className="mb-2 text-[11px] text-text-muted">
            Pengingat QA (Lampiran A) — opsional, boleh dilewati.
            {totalCount > 0 ? ` ${tickedCount}/${totalCount} dicentang.` : ""}
          </Text>

          {/* Checkpoint list */}
          {checkpointsQuery.isLoading ? (
            <View className="gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-4/5" />
            </View>
          ) : !checkpoints || checkpoints.length === 0 ? (
            <View className="rounded border border-dashed border-border px-3 py-3">
              <Text className="text-[11px] italic text-text-muted">
                Tidak ada item periksa untuk gate ini. Lanjut konfirmasi saja.
              </Text>
            </View>
          ) : (
            <View className="gap-1.5">
              {checkpoints.map((cp) => {
                const on = checked.has(cp.id);
                return (
                  <Pressable
                    key={cp.id}
                    onPress={() => toggle(cp.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={cp.itemText}
                    className={`flex-row items-start gap-2.5 rounded border px-3 py-2 ${
                      on ? "border-ok bg-ok-bg" : "border-border bg-surface active:opacity-80"
                    }`}
                  >
                    {/* Checkbox */}
                    <View
                      className={`mt-0.5 h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                        on ? "border-ok bg-ok" : "border-text-sec bg-surface"
                      }`}
                    >
                      {on ? <Text className="text-[10px] text-[#FDFAF6] font-bold">✓</Text> : null}
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text className="text-[13px] text-text">{cp.itemText}</Text>
                      {cp.required ? (
                        <Text className="text-[10px] font-semibold uppercase text-text-sec">
                          · wajib
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Completed date */}
          <View className="mt-4">
            <Text className="mb-1 text-[11px] font-semibold text-text-sec">
              Tanggal selesai
            </Text>
            <TextInput
              value={completedDate}
              onChangeText={setCompletedDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#B0A899"
              className="min-h-[44px] rounded border border-border bg-surface px-3 py-2 text-[13px] text-text"
              keyboardType="numeric"
              maxLength={10}
              editable={!pending}
              accessibilityLabel="Tanggal selesai"
            />
          </View>

          {/* Error */}
          {submitError ? (
            <View className="mt-3 rounded border border-critical/40 bg-critical-bg px-3 py-2">
              <Text className="text-[11px] text-critical">{submitError}</Text>
            </View>
          ) : null}

          {/* Bottom padding so footer doesn't overlap */}
          <View className="h-4" />
        </ScrollView>

        {/* Footer */}
        <View className="flex-row gap-2 border-t border-border/50 bg-surface px-4 py-3">
          <View className="flex-1">
            <Button
              label={pending ? "Menyimpan…" : "Tandai selesai"}
              onPress={confirm}
              disabled={pending}
              loading={pending}
            />
          </View>
          <Pressable
            onPress={onClose}
            disabled={pending}
            className="min-h-[44px] items-center justify-center rounded border border-border bg-surface px-4 active:opacity-70 disabled:opacity-50"
            accessibilityRole="button"
            accessibilityLabel="Batal"
          >
            <Text className="text-[13px] font-semibold text-text-sec">Batal</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
