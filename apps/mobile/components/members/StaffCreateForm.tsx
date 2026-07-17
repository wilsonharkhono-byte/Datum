/**
 * StaffCreateForm — create a new staff account via /api/staff/create.
 *
 * Fields:
 *   - fullName  (required, min 2 chars)
 *   - email     (required, valid email)
 *   - role      (picker from STAFF_ROLES)
 *   - password  (temp password, min 8 chars — admin shares it via WhatsApp)
 *
 * On success:
 *   - Shows the temp password prominently with a copy affordance.
 *   - Calls onCreated() so the parent can invalidate the available-staff query.
 *
 * On error (401/403/400):
 *   - Shows a readable Bahasa message.
 *
 * When WEB_BASE_URL is not set:
 *   - Renders a graceful "tersedia di web" notice instead of the form.
 *
 * Gate: caller must pass canManage=true (route re-checks; this is a courtesy).
 */

import { useState } from "react";
import {
  View,
  TextInput,
  ScrollView,
  Pressable,
  Clipboard,
  Alert,
} from "react-native";
// NOTE: StaffCreateForm itself renders no outer ScrollView — it is always
// mounted inside the screen's own scrollable container (members.tsx), and a
// same-axis (vertical) ScrollView nested inside another breaks reliable
// keyboard-avoidance/scroll-to-focused-input. The role picker below is a
// horizontal ScrollView, a different axis, so it's unaffected and stays.
import { CreateStaffInput, STAFF_ROLES } from "@datum/core";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { WEB_BASE_URL } from "@/lib/env";
import { supabase } from "@/lib/supabase/client";

// ─── Role labels ──────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  principal: "Principal",
  designer: "Desainer",
  pic: "PIC",
  site_supervisor: "Supervisor",
  admin: "Admin",
  estimator: "Estimator",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  error,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  error?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address";
}) {
  return (
    <View className="mb-4">
      <Text variant="label" className="mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9E9488"
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
        className={`min-h-[44px] rounded border px-3 py-2 text-[15px] text-text ${error ? "border-critical bg-critical/5" : "border-border bg-surface"}`}
        accessibilityLabel={label}
      />
      {error ? (
        <Text className="mt-1 text-[12px] text-critical">{error}</Text>
      ) : null}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  /** Called after a successful create so the parent can invalidate queries. */
  onCreated: () => void;
};

type SuccessResult = {
  staffId: string;
  email: string;
  tempPassword: string;
};

export function StaffCreateForm({ onCreated }: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<typeof STAFF_ROLES[number]>("designer");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuccessResult | null>(null);
  const [copied, setCopied] = useState(false);

  // ── No WEB_BASE_URL: graceful fallback ─────────────────────────────────────
  if (!WEB_BASE_URL) {
    return (
      <View className="rounded border border-dashed border-border/60 px-3 py-4">
        <Text variant="secondary" className="text-center">
          Buat staf baru tersedia di web.
        </Text>
        <Text variant="muted" className="mt-1 text-center text-[11px]">
          Set EXPO_PUBLIC_WEB_BASE_URL di environment untuk mengaktifkan fitur ini di mobile.
        </Text>
      </View>
    );
  }

  // ── Success state ───────────────────────────────────────────────────────────
  if (result) {
    return (
      <View className="gap-3">
        <View className="rounded bg-success/15 px-4 py-4">
          <Text className="mb-1 text-[14px] font-semibold text-success">
            Staf berhasil dibuat
          </Text>
          <Text className="text-[13px] text-text-sec">
            {result.email} telah terdaftar. Bagikan password sementara berikut via WhatsApp:
          </Text>
        </View>

        {/* Temp password — prominent + copyable */}
        <View className="rounded border border-border bg-surface px-4 py-3">
          <Text variant="label" className="mb-1">Password Sementara</Text>
          <Text
            className="font-mono text-[18px] tracking-widest text-text"
            selectable
            accessibilityLabel="Password sementara"
          >
            {result.tempPassword}
          </Text>
        </View>

        <Pressable
          onPress={() => {
            Clipboard.setString(result.tempPassword);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
          }}
          className="rounded border border-border/60 bg-surface px-3 py-2.5 active:bg-surface-alt"
          accessibilityLabel="Salin password sementara"
        >
          <Text className="text-center text-[14px] text-primary">
            {copied ? "Tersalin ✓" : "Salin Password"}
          </Text>
        </Pressable>

        <Button
          label="Tutup"
          onPress={() => {
            setResult(null);
            setFullName("");
            setEmail("");
            setRole("designer");
            setPassword("");
            onCreated();
          }}
        />
      </View>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setFieldErrors({});
    setServerError(null);

    // Client-side validation
    const parsed = CreateStaffInput.safeParse({ email, fullName, role, password });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const key = issue.path[0];
        if (typeof key === "string" && !errs[key]) {
          errs[key] = issue.message;
        }
      }
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setServerError("Sesi tidak ditemukan. Silakan masuk kembali.");
        return;
      }

      const res = await fetch(`${WEB_BASE_URL}/api/staff/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(parsed.data),
      });

      const json = await res.json() as { ok: boolean; staffId?: string; email?: string; tempPassword?: string; error?: string };

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          setServerError("Sesi tidak valid. Silakan masuk kembali.");
        } else if (res.status === 403) {
          setServerError(json.error ?? "Anda tidak memiliki akses untuk membuat staf baru.");
        } else {
          setServerError(json.error ?? "Terjadi kesalahan. Coba lagi.");
        }
        return;
      }

      setResult({
        staffId: json.staffId!,
        email: json.email!,
        tempPassword: json.tempPassword!,
      });
    } catch (e: unknown) {
      setServerError(
        e instanceof Error ? e.message : "Gagal menghubungi server. Periksa koneksi internet.",
      );
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    fullName.trim().length >= 2 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    !loading;

  return (
    <View>
      <Text variant="secondary" className="mb-4">
        Buat akun staf baru. Admin akan menerima password sementara yang bisa
        dibagikan via WhatsApp — staf bisa menggantinya setelah masuk pertama kali.
      </Text>

      <Field
        label="Nama Lengkap"
        value={fullName}
        onChangeText={setFullName}
        placeholder="Nama staf"
        autoCapitalize="words"
        error={fieldErrors.fullName}
      />

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="staf@datum.com"
        autoCapitalize="none"
        keyboardType="email-address"
        error={fieldErrors.email}
      />

      {/* Role picker */}
      <View className="mb-4">
        <Text variant="label" className="mb-1">Peran Global</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {STAFF_ROLES.map((r) => {
            const active = r === role;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                className={`rounded px-3 py-1.5 ${active ? "bg-primary" : "border border-border/60 bg-surface"}`}
                accessibilityState={{ selected: active }}
                accessibilityLabel={ROLE_LABELS[r] ?? r}
              >
                <Text
                  className={`text-[13px] font-medium ${active ? "text-[#FDFAF6]" : "text-text-sec"}`}
                >
                  {ROLE_LABELS[r] ?? r}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {fieldErrors.role ? (
          <Text className="mt-1 text-[12px] text-critical">{fieldErrors.role}</Text>
        ) : null}
      </View>

      <Field
        label="Password Sementara"
        value={password}
        onChangeText={setPassword}
        placeholder="Min. 8 karakter"
        secureTextEntry={false}
        error={fieldErrors.password}
      />

      {serverError ? (
        <View className="mb-4 rounded bg-critical/10 px-3 py-3">
          <Text className="text-[13px] text-critical">{serverError}</Text>
        </View>
      ) : null}

      <Button
        label="Buat Staf"
        onPress={handleSubmit}
        disabled={!canSubmit}
        loading={loading}
      />
    </View>
  );
}
