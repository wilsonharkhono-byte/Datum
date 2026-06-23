/**
 * Create-project screen — mobile parity of apps/web/components/projects/ProjectCreateForm.tsx
 *
 * Date input: plain YYYY-MM-DD TextInput (v1). No date-picker dependency added.
 * Role gating: courtesy UI gate via canManageRole; real gate is core + RLS.
 */

import { useState } from "react";
import {
  View,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { CreateProjectInput, createProject, canManageRole } from "@datum/core";
import { useSession } from "@/lib/session/session";
import { supabase } from "@/lib/supabase/client";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";

// ─── Status options ───────────────────────────────────────────────────────────

type ProjectStatus = "design" | "construction" | "finishing" | "handover" | "closed";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "design", label: "Desain" },
  { value: "construction", label: "Konstruksi" },
  { value: "finishing", label: "Finishing" },
  { value: "handover", label: "Serah terima" },
  { value: "closed", label: "Selesai" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewProjectScreen() {
  const router = useRouter();
  const { staff } = useSession();

  // Form state
  const [projectCode, setProjectCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("design");
  const [targetHandover, setTargetHandover] = useState("");

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Not signed in ──
  if (!staff) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text variant="heading" className="text-center">
            Silakan masuk terlebih dahulu
          </Text>
          <Text variant="secondary" className="text-center">
            Anda harus masuk untuk membuat proyek.
          </Text>
        </View>
      </Screen>
    );
  }

  // ── Courtesy role gate (real gate is core + RLS) ──
  const canCreate = canManageRole(staff.role);

  // Capture non-null staff here so TS knows it can't become null inside async callback
  const currentStaff = staff;

  async function handleSubmit() {
    setGeneralError(null);
    setFieldErrors({});

    // Client-side Zod validation
    const parsed = CreateProjectInput.safeParse({
      projectCode,
      projectName,
      clientName: clientName || null,
      location: location || null,
      status,
      targetHandover: targetHandover || null,
    });

    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !fe[key]) fe[key] = issue.message;
      }
      setFieldErrors(fe);
      return;
    }

    setSubmitting(true);
    try {
      const result = await createProject(supabase, parsed.data, {
        id: currentStaff.id,
        role: currentStaff.role,
      });

      if (result.ok) {
        router.replace(`/(tabs)/(matrix)/project/${result.projectCode}`);
      } else {
        setGeneralError(result.error);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isDisabled = submitting || !projectCode.trim() || !projectName.trim();

  return (
    <Screen className="pb-0">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-8 gap-5"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="pt-4 pb-2">
            <Text variant="label" className="mb-0.5">
              Proyek baru
            </Text>
            <Text variant="heading">Buat proyek</Text>
            <Text variant="secondary" className="mt-1">
              Kode proyek jadi URL-friendly slug. Topik standar akan otomatis di-seed setelah proyek
              dibuat.
            </Text>
          </View>

          {/* Forbidden role notice */}
          {!canCreate && (
            <View
              testID="forbidden-notice"
              className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3"
            >
              <Text variant="secondary" className="text-amber-800">
                Hanya principal atau admin yang bisa membuat proyek baru.
              </Text>
            </View>
          )}

          {/* Kode proyek */}
          <View>
            <Text variant="label" className="mb-1">
              Kode proyek *
            </Text>
            <TextInput
              testID="input-projectCode"
              value={projectCode}
              onChangeText={(t) => setProjectCode(t.toUpperCase())}
              editable={!submitting}
              placeholder="mis. BDG-H2"
              maxLength={40}
              autoCapitalize="characters"
              autoCorrect={false}
              className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text"
            />
            <Text variant="muted" className="mt-1">
              Huruf besar, angka, dan tanda hubung saja
            </Text>
            {fieldErrors.projectCode ? (
              <Text
                testID="error-projectCode"
                variant="muted"
                className="mt-1 text-red-600"
              >
                {fieldErrors.projectCode}
              </Text>
            ) : null}
          </View>

          {/* Nama proyek */}
          <View>
            <Text variant="label" className="mb-1">
              Nama proyek *
            </Text>
            <TextInput
              testID="input-projectName"
              value={projectName}
              onChangeText={setProjectName}
              editable={!submitting}
              placeholder="mis. Bukit Darmo Golf H-2"
              maxLength={120}
              className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text"
            />
            {fieldErrors.projectName ? (
              <Text
                testID="error-projectName"
                variant="muted"
                className="mt-1 text-red-600"
              >
                {fieldErrors.projectName}
              </Text>
            ) : null}
          </View>

          {/* Klien */}
          <View>
            <Text variant="label" className="mb-1">
              Klien
            </Text>
            <TextInput
              testID="input-clientName"
              value={clientName}
              onChangeText={setClientName}
              editable={!submitting}
              placeholder="mis. Pak Sugiarto"
              maxLength={120}
              className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text"
            />
          </View>

          {/* Lokasi */}
          <View>
            <Text variant="label" className="mb-1">
              Lokasi
            </Text>
            <TextInput
              testID="input-location"
              value={location}
              onChangeText={setLocation}
              editable={!submitting}
              placeholder="mis. Citraland Surabaya"
              maxLength={200}
              className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text"
            />
          </View>

          {/* Status awal — segmented selector */}
          <View>
            <Text variant="label" className="mb-2">
              Status awal
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const active = status === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`status-option-${opt.value}`}
                    onPress={() => !submitting && setStatus(opt.value)}
                    className={`rounded-full px-3 py-1.5 ${
                      active ? "bg-primary" : "border border-border bg-surface"
                    }`}
                  >
                    <Text
                      variant="secondary"
                      className={active ? "text-[#FDFAF6]" : ""}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Target serah terima — YYYY-MM-DD TextInput (v1; no date-picker dep) */}
          <View>
            <Text variant="label" className="mb-1">
              Target serah terima
            </Text>
            <TextInput
              testID="input-targetHandover"
              value={targetHandover}
              onChangeText={setTargetHandover}
              editable={!submitting}
              placeholder="YYYY-MM-DD"
              maxLength={10}
              keyboardType="numbers-and-punctuation"
              className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text"
            />
            <Text variant="muted" className="mt-1">
              Format: YYYY-MM-DD
            </Text>
          </View>

          {/* General error */}
          {generalError ? (
            <View
              testID="general-error"
              className="rounded-lg border border-red-400 bg-red-50 px-4 py-3"
            >
              <Text variant="secondary" className="text-red-700">
                {generalError}
              </Text>
            </View>
          ) : null}

          {/* Actions */}
          <View className="flex-row gap-3 pt-2">
            {/* Submit */}
            <Pressable
              testID="btn-submit"
              onPress={handleSubmit}
              disabled={isDisabled || !canCreate}
              className={`min-h-[44px] flex-1 items-center justify-center rounded-lg px-4 ${
                isDisabled || !canCreate ? "bg-surface-alt" : "bg-primary active:opacity-90"
              }`}
            >
              {submitting ? (
                <ActivityIndicator color="#FDFAF6" />
              ) : (
                <Text
                  className={`text-[15px] font-medium ${
                    isDisabled || !canCreate ? "text-text-muted" : "text-[#FDFAF6]"
                  }`}
                >
                  {submitting ? "Menyimpan…" : "Buat proyek"}
                </Text>
              )}
            </Pressable>

            {/* Cancel */}
            <Pressable
              testID="btn-cancel"
              onPress={() => router.back()}
              disabled={submitting}
              className="min-h-[44px] items-center justify-center rounded-lg px-4"
            >
              <Text variant="secondary">Batal</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
