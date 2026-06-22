/**
 * AreaGateCard — one collapsible area row in the schedule accordion.
 *
 * Shows the area name + handover target date in the header, and a list of
 * gate rows (A–H) with SANO flag tokens when expanded.  The set-target-date
 * affordance is embedded in the header so the user can update it inline.
 */

import { useState } from "react";
import { View, Pressable, TextInput } from "react-native";
import { Text } from "@/components/ui/Text";
import { Badge, type Flag } from "@/components/ui/Badge";
import type { MatrixArea, MatrixCell, MatrixData } from "@datum/core";
import { gateLabel, ADVANCEABLE } from "@datum/core";
import type { ScheduledCell } from "@datum/core";

// ─── SANO flag mapping ────────────────────────────────────────────────────────
// Maps MatrixCell.status → SANO flag token (used by <Badge>).

const STATUS_FLAG: Record<string, Flag> = {
  passed:           "ok",
  ready_for_handoff: "info",
  in_progress:      "warning",
  blocked:          "critical",
  not_started:      "high",
  not_applicable:   "info",
};

const STATUS_LABEL: Record<string, string> = {
  passed:            "Selesai",
  ready_for_handoff: "Siap serah",
  in_progress:       "Berjalan",
  blocked:           "Terblokir",
  not_started:       "Belum mulai",
  not_applicable:    "N/A",
};

// ─── Jakarta date helpers ─────────────────────────────────────────────────────

const WIB = "Asia/Jakarta";

function todayWIB(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: WIB }).format(new Date());
}

function formatTanggal(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

function daysUntil(iso: string): number {
  const today = todayWIB();
  const d1 = new Date(`${today}T00:00:00Z`);
  const d2 = new Date(`${iso}T00:00:00Z`);
  return Math.round((d2.getTime() - d1.getTime()) / 86_400_000);
}

// ─── GateRow ─────────────────────────────────────────────────────────────────

type GateRowProps = {
  gateCode: string;
  cell: MatrixCell | undefined;
  scheduledCell: ScheduledCell | undefined;
  onAdvance: (gateCode: string) => void;
};

function GateRow({ gateCode, cell, scheduledCell, onAdvance }: GateRowProps) {
  const status = cell?.status ?? "not_started";
  const flag = STATUS_FLAG[status] ?? "high";
  const label = STATUS_LABEL[status] ?? status;
  const isAdvanceable = cell != null && ADVANCEABLE.has(status);

  const targetEnd = scheduledCell?.target_end_date;
  const dateFmt = formatTanggal(targetEnd);
  const today = todayWIB();
  const overdue = targetEnd ? targetEnd < today : false;

  return (
    <View className="flex-row items-start gap-2 border-t border-border/30 px-3 py-2">
      {/* Gate code pill */}
      <View className="mt-0.5 w-7 items-center rounded-sm bg-surface-alt px-1 py-0.5">
        <Text className="text-[12px] font-bold text-text-sec">{gateCode}</Text>
      </View>

      {/* Gate name + date */}
      <View className="flex-1 min-w-0">
        <Text className="text-[13px] text-text" numberOfLines={1}>
          {gateLabel(gateCode)}
        </Text>
        {dateFmt ? (
          <Text className={`text-[11px] mt-0.5 ${overdue ? "text-critical" : "text-text-muted"}`}>
            {overdue ? "Lewat · " : ""}{dateFmt}
          </Text>
        ) : null}
        {cell?.blocking_reason ? (
          <Text className="text-[11px] mt-0.5 text-critical" numberOfLines={2}>
            {cell.blocking_reason}
          </Text>
        ) : null}
      </View>

      {/* Status badge + advance button */}
      <View className="items-end gap-1">
        <Badge flag={flag} label={label} />
        {isAdvanceable ? (
          <Pressable
            onPress={() => onAdvance(gateCode)}
            className="mt-1 rounded border border-ok/50 bg-ok-bg px-2 py-0.5 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel={`Tandai Gate ${gateCode} selesai`}
          >
            <Text className="text-[11px] font-semibold text-ok">Tandai selesai</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ─── AreaGateCard ─────────────────────────────────────────────────────────────

type Props = {
  area: MatrixArea;
  matrix: MatrixData;
  scheduledCells: ScheduledCell[];
  /** Called when user taps "Tandai selesai" on an advanceable gate. */
  onAdvanceGate: (areaId: string, gateCode: string) => void;
  /** Called when user submits a new target date (YYYY-MM-DD) or null to clear. */
  onSetTarget: (areaId: string, targetDate: string | null) => void;
  /** Current area target date (YYYY-MM-DD) if any. */
  targetDate: string | null;
};

export function AreaGateCard({
  area,
  matrix,
  scheduledCells,
  onAdvanceGate,
  onSetTarget,
  targetDate,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [draftDate, setDraftDate] = useState(targetDate ?? "");
  const [saving, setSaving] = useState(false);

  const today = todayWIB();
  const isOverdue = targetDate ? targetDate < today : false;
  const daysLeft = targetDate ? daysUntil(targetDate) : null;
  const dateFmt = formatTanggal(targetDate);

  async function submitTarget() {
    setSaving(true);
    try {
      const val = draftDate.trim() || null;
      await onSetTarget(area.id, val);
      setEditingTarget(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mb-3 rounded border border-border/40 bg-surface overflow-hidden">
      {/* Header */}
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        className="flex-row items-center gap-2 px-3 py-3 active:opacity-80"
        accessibilityRole="button"
        accessibilityLabel={`${area.area_name}, ${expanded ? "tutup" : "buka"}`}
      >
        {/* Area name + floor */}
        <View className="flex-1 min-w-0">
          <Text className="text-[15px] font-semibold text-text" numberOfLines={1}>
            {area.area_name}
          </Text>
          {area.floor ? (
            <Text className="text-[12px] text-text-muted">{area.floor}</Text>
          ) : null}
        </View>

        {/* Target date chip */}
        {dateFmt ? (
          <Pressable
            onPress={() => {
              setEditingTarget((v) => !v);
              setDraftDate(targetDate ?? "");
            }}
            className={`rounded-sm px-2 py-0.5 ${isOverdue ? "bg-critical-bg" : "bg-info-bg"} active:opacity-70`}
            accessibilityRole="button"
            accessibilityLabel={`Target serah terima ${dateFmt}`}
          >
            <Text className={`text-[11px] font-semibold ${isOverdue ? "text-critical" : "text-info"}`}>
              {daysLeft !== null && daysLeft <= 0 ? `Lewat ${Math.abs(daysLeft)} hari` :
               daysLeft !== null && daysLeft === 0 ? "Hari ini" :
               daysLeft !== null && daysLeft <= 7 ? `${daysLeft} hari` : dateFmt}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              setEditingTarget((v) => !v);
              setDraftDate("");
            }}
            className="rounded-sm border border-dashed border-border px-2 py-0.5 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Set target serah terima"
          >
            <Text className="text-[11px] text-text-muted">+ target</Text>
          </Pressable>
        )}

        {/* Chevron */}
        <Text className="text-[14px] text-text-muted ml-1">{expanded ? "▲" : "▼"}</Text>
      </Pressable>

      {/* Inline date editor */}
      {editingTarget ? (
        <View className="flex-row items-center gap-2 border-t border-border/30 bg-bg-oat px-3 py-2">
          <TextInput
            value={draftDate}
            onChangeText={setDraftDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#B0A899"
            className="flex-1 rounded border border-border bg-surface px-2 py-1 text-[13px] text-text"
            keyboardType="numeric"
            maxLength={10}
            editable={!saving}
            accessibilityLabel="Tanggal target serah terima"
          />
          <Pressable
            onPress={submitTarget}
            disabled={saving}
            className="rounded bg-primary px-3 py-1.5 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-[12px] font-semibold text-[#FDFAF6]">
              {saving ? "…" : "Simpan"}
            </Text>
          </Pressable>
          {targetDate ? (
            <Pressable
              onPress={() => { setDraftDate(""); void onSetTarget(area.id, null); setEditingTarget(false); }}
              disabled={saving}
              className="rounded border border-border px-2 py-1.5 active:opacity-70"
            >
              <Text className="text-[12px] text-text-sec">Hapus</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setEditingTarget(false)}
            className="px-1 py-1.5"
          >
            <Text className="text-[12px] text-text-muted">Batal</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Gate rows (collapsed by default) */}
      {expanded ? (
        <View>
          {matrix.gates.map((gateCode) => {
            const cell = matrix.cells.get(`${area.id}|${gateCode}`);
            const sc = scheduledCells.find(
              (s) => s.area_id === area.id && s.gate_code === gateCode,
            );
            return (
              <GateRow
                key={gateCode}
                gateCode={gateCode}
                cell={cell}
                scheduledCell={sc}
                onAdvance={(gc) => onAdvanceGate(area.id, gc)}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
