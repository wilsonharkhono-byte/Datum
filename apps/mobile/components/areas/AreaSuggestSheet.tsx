/**
 * AreaSuggestSheet — AI-assisted area detection bottom sheet.
 *
 * Flow:
 *   1. User taps "Deteksi area dengan AI" → this component calls
 *      `POST ${WEB_BASE_URL}/api/areas/suggest` with Authorization: Bearer <token>.
 *   2. The proposal is normalised via normalizeProposal (pure, client-side).
 *   3. User reviews the proposal and can deselect areas/assignments.
 *   4. "Terapkan" calls useApplyAreaProposal.
 *
 * ⚠️  FLAG: this depends on the /api/areas/suggest Next.js route accepting Bearer
 * auth. The current web implementation uses createSupabaseServerClient() which
 * reads the session cookie — it does NOT honour Authorization: Bearer <token>.
 * Until that route is updated to accept a Bearer token, this call will get a 401
 * or empty session. The button is therefore shown but the failure is surfaced as
 * a friendly error — it does NOT block the rest of the Areas manager.
 *
 * If WEB_BASE_URL (EXPO_PUBLIC_WEB_BASE_URL) is unset the entire button is hidden.
 */

import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Modal } from "react-native";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { normalizeProposal, type AreaProposal, type ProposedArea, type ProposedAssignment } from "@datum/core";
import type { Area } from "@datum/db";
import { WEB_BASE_URL } from "@/lib/env";
import { supabase } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
  existingAreas: Area[];
  /** Called when user taps Terapkan and the proposal is applied. */
  onApply: (proposal: Pick<AreaProposal, "areas" | "assignments">) => void;
  isApplying: boolean;
};

// ─── AreaSuggestSheet ─────────────────────────────────────────────────────────

export function AreaSuggestSheet({ projectId, existingAreas, onApply, isApplying }: Props) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AreaProposal | null>(null);

  // Selected areas/assignments the user keeps
  const [selectedAreaCodes, setSelectedAreaCodes] = useState<Set<string>>(new Set());

  // Hide AI button when WEB_BASE_URL is not configured
  if (!WEB_BASE_URL) return null;

  async function handleDetect() {
    setLoading(true);
    setError(null);
    setProposal(null);

    try {
      // Get the current session access token to authenticate the web API call.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setError("Tidak ada sesi aktif — silakan masuk kembali.");
        setLoading(false);
        return;
      }

      const resp = await fetch(`${WEB_BASE_URL}/api/areas/suggest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ⚠️ FLAG: requires /api/areas/suggest to accept Bearer token auth.
          // Currently the web route uses cookie-based auth (createSupabaseServerClient).
          // Until Bearer auth is wired, this will fail with 401/empty session.
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(
          resp.status === 401
            ? "Autentikasi gagal. Rute /api/areas/suggest belum mendukung Bearer token — hubungi tim teknis."
            : `Server error ${resp.status}: ${text.slice(0, 120)}`,
        );
        setLoading(false);
        return;
      }

      const raw: unknown = await resp.json();
      const existingAreasMapped = existingAreas.map((a) => ({
        areaCode: a.area_code,
        areaName: a.area_name,
        floor: a.floor,
        areaType: (a.area_type ?? "general") as import("@datum/core").AreaType,
      }));
      const normalized = normalizeProposal(raw, {
        cards: [], // cards context not available on mobile — normalizer degrades gracefully
        existingAreas: existingAreasMapped,
      });
      setProposal(normalized);
      setSelectedAreaCodes(new Set(normalized.areas.map((a) => a.areaCode)));
      setVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghubungi server AI.");
    } finally {
      setLoading(false);
    }
  }

  function toggleArea(code: string) {
    setSelectedAreaCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleApply() {
    if (!proposal) return;
    const kept = proposal.areas.filter((a) => selectedAreaCodes.has(a.areaCode));
    const keptCodes = new Set(kept.map((a) => a.areaCode));
    const keptAssignments = proposal.assignments.filter((asg) =>
      keptCodes.has(asg.areaCode),
    );
    onApply({ areas: kept, assignments: keptAssignments });
    setVisible(false);
  }

  return (
    <>
      {/* Trigger button */}
      <Pressable
        onPress={handleDetect}
        disabled={loading || isApplying}
        className="mt-2 items-center rounded border border-dashed border-primary/60 bg-primary/5 py-2.5 active:opacity-70 disabled:opacity-40"
        accessibilityRole="button"
        accessibilityLabel="Deteksi area dengan AI"
        testID="ai-suggest-button"
      >
        {loading ? (
          <ActivityIndicator size="small" />
        ) : (
          <Text className="text-[14px] font-medium text-primary">Deteksi area dengan AI</Text>
        )}
      </Pressable>

      {/* Inline error (not modal — doesn't block the rest of the screen) */}
      {error ? (
        <View className="mt-2 rounded border border-critical/40 bg-critical-bg px-3 py-2">
          <Text className="text-[13px] text-critical">{error}</Text>
          <Pressable onPress={() => setError(null)} className="mt-1">
            <Text className="text-[12px] text-text-muted">Tutup</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Review modal */}
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVisible(false)}
      >
        <View className="flex-1 bg-bg">
          {/* Header */}
          <View className="flex-row items-center justify-between border-b border-border/40 px-4 py-4">
            <Text variant="heading">Usulan Area AI</Text>
            <Pressable
              onPress={() => setVisible(false)}
              className="px-2 py-1"
              accessibilityRole="button"
              accessibilityLabel="Tutup"
            >
              <Text className="text-[15px] text-text-muted">Tutup</Text>
            </Pressable>
          </View>

          {!proposal ? null : (
            <>
              <ScrollView className="flex-1 px-4 py-3">
                <Text variant="secondary" className="mb-3">
                  Pilih area yang ingin ditambahkan. Area yang sudah ada ditandai biru.
                </Text>

                {proposal.areas.map((a: ProposedArea) => {
                  const selected = selectedAreaCodes.has(a.areaCode);
                  return (
                    <Pressable
                      key={a.areaCode}
                      onPress={() => toggleArea(a.areaCode)}
                      className={`mb-2 flex-row items-center gap-3 rounded border px-3 py-2.5 active:opacity-70 ${
                        selected
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/30 bg-surface opacity-60"
                      }`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={a.areaName}
                      testID={`proposal-area-${a.areaCode}`}
                    >
                      <View className="flex-1 min-w-0">
                        <Text
                          className={`text-[14px] font-semibold ${selected ? "text-text" : "text-text-sec"}`}
                          numberOfLines={1}
                        >
                          {a.areaName}
                        </Text>
                        <View className="mt-0.5 flex-row gap-2">
                          <Text className="text-[12px] text-text-muted">{a.areaCode}</Text>
                          {a.floor ? (
                            <Text className="text-[12px] text-text-muted">· {a.floor}</Text>
                          ) : null}
                        </View>
                      </View>
                      {a.isExisting ? (
                        <Badge flag="info" label="Ada" />
                      ) : (
                        <Badge flag="ok" label="Baru" />
                      )}
                    </Pressable>
                  );
                })}

                {proposal.assignments.length > 0 ? (
                  <View className="mt-2">
                    <Text variant="label" className="mb-2">
                      Tautan kartu ({proposal.assignments.length})
                    </Text>
                    {proposal.assignments.map((asg: ProposedAssignment) => (
                      <View
                        key={`${asg.cardId}:${asg.areaCode}`}
                        className="mb-1 flex-row items-center gap-2 rounded border border-border/30 bg-surface px-3 py-2"
                      >
                        <Text className="flex-1 text-[13px] text-text-sec" numberOfLines={1}>
                          {asg.cardId}
                        </Text>
                        <Text className="text-[12px] text-text-muted">→ {asg.areaCode}</Text>
                        <Text className="text-[11px] text-text-muted">
                          {Math.round(asg.confidence * 100)}%
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </ScrollView>

              {/* Apply button */}
              <View className="border-t border-border/40 px-4 py-4">
                <Pressable
                  onPress={handleApply}
                  disabled={isApplying || selectedAreaCodes.size === 0}
                  className="items-center rounded bg-primary py-3 active:opacity-80 disabled:opacity-40"
                  accessibilityRole="button"
                  accessibilityLabel="Terapkan area terpilih"
                  testID="proposal-apply-button"
                >
                  {isApplying ? (
                    <ActivityIndicator color="#FDFAF6" />
                  ) : (
                    <Text className="text-[15px] font-semibold text-[#FDFAF6]">
                      Terapkan ({selectedAreaCodes.size} area)
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </Modal>
    </>
  );
}
