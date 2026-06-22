/**
 * ProjectInfoForm — edit a project's basic info fields.
 *
 * Fields: projectName, clientName, location, status, kickoffDate, targetHandover.
 * Calls useUpdateProject on submit; shows a "Tersimpan" chip for 3 s on success.
 *
 * canManage gates the edit affordance — if false the form is read-only.
 * RLS on the server is the real backstop; this is a courtesy disable.
 */

import { useState, useEffect } from "react";
import { View, TextInput, Pressable, ScrollView } from "react-native";
import type { ProjectSettingsRow } from "@datum/core";
import { PROJECT_STATUS, type UpdateProjectInputType } from "@datum/core";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";

// ─── Status labels ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  design: "Desain",
  construction: "Konstruksi",
  finishing: "Finishing",
  handover: "Serah Terima",
  closed: "Selesai",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  return (
    <View className="mb-4">
      <Text variant="label" className="mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editable={editable}
        className={`min-h-[44px] rounded border px-3 py-2 text-[15px] text-text ${editable ? "border-border bg-surface" : "border-border/30 bg-surface-alt"}`}
        placeholderTextColor="#9E9488"
        accessibilityLabel={label}
      />
    </View>
  );
}

// ─── Status Picker (segmented) ────────────────────────────────────────────────

type StatusValue = typeof PROJECT_STATUS[number];

function StatusPicker({
  value,
  onChange,
  editable,
}: {
  value: StatusValue;
  onChange: (v: StatusValue) => void;
  editable: boolean;
}) {
  return (
    <View className="mb-4">
      <Text variant="label" className="mb-1">Status</Text>
      <View className="flex-row flex-wrap gap-1.5">
        {PROJECT_STATUS.map((s) => {
          const active = s === value;
          return (
            <Pressable
              key={s}
              onPress={() => editable && onChange(s)}
              disabled={!editable}
              className={`rounded px-3 py-1.5 ${active ? "bg-primary" : "border border-border/60 bg-surface"}`}
              accessibilityState={{ selected: active }}
            >
              <Text
                className={`text-[13px] font-medium ${active ? "text-[#FDFAF6]" : "text-text-sec"}`}
              >
                {STATUS_LABELS[s] ?? s}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  project: ProjectSettingsRow;
  canManage: boolean;
  onSave: (patch: UpdateProjectInputType) => Promise<void>;
  isSaving?: boolean;
};

export function ProjectInfoForm({ project, canManage, onSave, isSaving = false }: Props) {
  const [name, setName] = useState(project.project_name);
  const [client, setClient] = useState(project.client_name ?? "");
  const [location, setLocation] = useState(project.location ?? "");
  const [status, setStatus] = useState<typeof PROJECT_STATUS[number]>(
    PROJECT_STATUS.includes(project.status as typeof PROJECT_STATUS[number])
      ? (project.status as typeof PROJECT_STATUS[number])
      : "design",
  );
  const [kickoff, setKickoff] = useState(project.kickoff_date ?? "");
  const [target, setTarget] = useState(project.target_handover ?? "");
  const [saved, setSaved] = useState(false);

  // Reset form when project changes (e.g., invalidation + refetch).
  useEffect(() => {
    setName(project.project_name);
    setClient(project.client_name ?? "");
    setLocation(project.location ?? "");
    setStatus(
      PROJECT_STATUS.includes(project.status as typeof PROJECT_STATUS[number])
        ? (project.status as typeof PROJECT_STATUS[number])
        : "design",
    );
    setKickoff(project.kickoff_date ?? "");
    setTarget(project.target_handover ?? "");
  }, [
    project.project_name,
    project.client_name,
    project.location,
    project.status,
    project.kickoff_date,
    project.target_handover,
  ]);

  async function handleSave() {
    await onSave({
      projectId: project.id,
      projectName: name.trim() || undefined,
      clientName: client.trim() || null,
      location: location.trim() || null,
      status: status || undefined,
      kickoffDate: kickoff.trim() || null,
      targetHandover: target.trim() || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const canSubmit = canManage && name.trim().length > 0 && !isSaving;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Help copy */}
      <Text variant="secondary" className="mb-4 text-text-sec">
        Detail dasar proyek. Tanggal kickoff menjadi titik anchor jadwal — mengubahnya
        memicu kalkulasi ulang jadwal di server.
      </Text>

      {/* Read-only code */}
      <View className="mb-4">
        <Text variant="label" className="mb-1">Kode Proyek</Text>
        <View className="min-h-[44px] justify-center rounded border border-border/30 bg-surface-alt px-3 py-2">
          <Text className="text-[15px] text-text-muted">{project.project_code}</Text>
        </View>
      </View>

      <Field label="Nama Proyek" value={name} onChangeText={setName} editable={canManage} />
      <Field
        label="Klien"
        value={client}
        onChangeText={setClient}
        placeholder="Nama klien (opsional)"
        editable={canManage}
      />
      <Field
        label="Lokasi"
        value={location}
        onChangeText={setLocation}
        placeholder="Lokasi proyek (opsional)"
        editable={canManage}
      />

      <StatusPicker value={status} onChange={setStatus} editable={canManage} />

      <Field
        label="Tanggal Kickoff (YYYY-MM-DD)"
        value={kickoff}
        onChangeText={setKickoff}
        placeholder="cth: 2024-07-01"
        editable={canManage}
      />
      <Field
        label="Target Serah Terima (YYYY-MM-DD)"
        value={target}
        onChangeText={setTarget}
        placeholder="cth: 2025-06-30"
        editable={canManage}
      />

      {canManage ? (
        <View className="mt-2 flex-row items-center gap-3">
          <View className="flex-1">
            <Button label="Simpan" onPress={handleSave} disabled={!canSubmit} loading={isSaving} />
          </View>
          {saved ? (
            <View className="rounded bg-success/15 px-3 py-1.5">
              <Text className="text-[13px] text-success">Tersimpan</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text variant="muted" className="mt-2">
          Hanya principal dan admin yang bisa mengubah info proyek.
        </Text>
      )}
    </ScrollView>
  );
}
