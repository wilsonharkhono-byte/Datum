/**
 * ReviewItem — a single pending AI draft card in the mobile review queue.
 *
 * Mirrors web's ReviewItem.tsx:
 *   - Shows project code, event kind label, risk badge, timestamp
 *   - AI rationale (if present), original input text (if present)
 *   - renderPayload key/value fields
 *   - Approve button + Reject flow (reject requires optional reason input)
 *   - Optimistic removal: after approve/reject the parent screen re-fetches
 *     (invalidation in useApproveDraft/useRejectDraft); local status tracks
 *     the in-flight UI.
 */

import { useState } from "react";
import { View, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { renderPayload, eventKindLabel, type PendingDraft } from "@datum/core";
import { useApproveDraft, useRejectDraft } from "@/lib/query/mutations";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemStatus = "idle" | "saving" | "approved" | "rejected" | "error";

// ─── Approve button ───────────────────────────────────────────────────────────

function ApproveButton({ onPress, loading }: { onPress: () => void; loading: boolean }) {
  return (
    <Pressable
      testID="approve-button"
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel="Setujui dan tambahkan ke kartu"
      className="flex-row items-center justify-center gap-1.5 rounded bg-ok px-4 py-2.5 active:opacity-80 disabled:opacity-50"
    >
      {loading ? (
        <ActivityIndicator color="#FDFAF6" size="small" />
      ) : (
        <Text className="text-[12px] font-bold uppercase tracking-wide text-[#FDFAF6]">
          Setujui &amp; tambah ke kartu
        </Text>
      )}
    </Pressable>
  );
}

// ─── Reject flow ──────────────────────────────────────────────────────────────

function RejectFlow({
  onReject,
  loading,
}: {
  onReject: (reason?: string) => void;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");

  if (!expanded) {
    return (
      <Pressable
        testID="reject-button"
        onPress={() => setExpanded(true)}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Tolak"
        className="rounded border border-border bg-surface px-3 py-2.5 active:opacity-80"
      >
        <Text className="text-[12px] font-semibold uppercase tracking-wide text-text-sec">
          Tolak
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="mt-1 gap-2">
      <TextInput
        testID="reject-reason-input"
        value={reason}
        onChangeText={setReason}
        placeholder="Alasan (opsional)"
        placeholderTextColor="#8E8070"
        className="rounded border border-border bg-surface px-3 py-2 text-[13px] text-text"
        accessibilityLabel="Alasan penolakan (opsional)"
      />
      <View className="flex-row gap-2">
        <Pressable
          testID="reject-confirm-button"
          onPress={() => onReject(reason.trim() || undefined)}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Konfirmasi tolak"
          className="rounded bg-critical px-3 py-2 active:opacity-80 disabled:opacity-50"
        >
          {loading ? (
            <ActivityIndicator color="#FDFAF6" size="small" />
          ) : (
            <Text className="text-[12px] font-bold uppercase tracking-wide text-[#FDFAF6]">
              Tolak
            </Text>
          )}
        </Pressable>
        <Pressable
          testID="reject-cancel-button"
          onPress={() => { setExpanded(false); setReason(""); }}
          accessibilityRole="button"
          accessibilityLabel="Batal tolak"
          className="px-2 py-2"
        >
          <Text className="text-[12px] text-text-muted">batal</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReviewItem({ draft }: { draft: PendingDraft }) {
  const [status, setStatus] = useState<ItemStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const approveMut = useApproveDraft();
  const rejectMut = useRejectDraft();

  const saving = status === "saving";
  const isHigh = draft.risk_level === "high";
  const fields = renderPayload(draft.proposed_payload.payload);
  const kindLabel = eventKindLabel(draft.proposed_payload.kind);

  const createdAt = new Date(draft.created_at).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // ── Approve handler ──────────────────────────────────────────────────────

  function handleApprove() {
    setErrorMsg(null);
    setStatus("saving");
    approveMut.mutate(
      {
        draftId:       draft.id,
        cardSlug:      null, // filled from result in onSuccess
        projectCode:   draft.projects?.project_code ?? null,
        cardId:        draft.proposed_payload.card_id,
        draftAuthorId: draft.created_by_staff_id,
        eventKind:     draft.proposed_payload.kind,
      },
      {
        onSuccess: (res) => {
          // mutationFn throws on !ok, so res is always the ok branch here
          setStatus("approved");
        },
        onError: (err) => {
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "Gagal menyetujui draf");
        },
      },
    );
  }

  // ── Reject handler ───────────────────────────────────────────────────────

  function handleReject(reason?: string) {
    setErrorMsg(null);
    setStatus("saving");
    rejectMut.mutate(
      { draftId: draft.id, reason },
      {
        onSuccess: () => {
          // mutationFn throws on !ok, so reaching onSuccess means success
          setStatus("rejected");
        },
        onError: (err) => {
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "Gagal menolak draf");
        },
      },
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View
      testID={`review-item-${draft.id}`}
      className="overflow-hidden rounded border border-border/40 bg-surface"
    >
      {/* ── Header band ── */}
      <View className="flex-row items-center justify-between gap-2 border-b border-border/30 bg-surface-alt px-3 py-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">
            {draft.projects?.project_code ?? "(proyek)"}
          </Text>
          <Text className="text-text-muted">·</Text>
          <Text className="text-[13px] font-semibold text-text">{kindLabel}</Text>
          {isHigh ? (
            <Badge flag="high" label="Berisiko tinggi" />
          ) : null}
        </View>
        <Text className="shrink-0 text-[11px] text-text-muted">{createdAt}</Text>
      </View>

      {/* ── Body ── */}
      <View className="gap-3 p-3">
        {/* Author */}
        <Text className="text-[12px] text-text-sec">
          Diusulkan oleh{" "}
          <Text className="font-semibold text-text">
            {draft.created_by?.full_name ?? "(tidak diketahui)"}
          </Text>
        </Text>

        {/* AI rationale */}
        {draft.proposed_payload.rationale ? (
          <View className="rounded border-l-2 border-border bg-bg-oat px-3 py-2">
            <Text className="text-[12px] italic text-text-sec">
              {draft.proposed_payload.rationale}
            </Text>
          </View>
        ) : null}

        {/* Original input text */}
        {draft.original_input_text ? (
          <View className="gap-1">
            <Text className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              Tulisan asli
            </Text>
            <View className="rounded border border-border bg-surface-alt px-3 py-2">
              <Text className="text-[12px] text-text-sec">
                &ldquo;{draft.original_input_text}&rdquo;
              </Text>
            </View>
          </View>
        ) : null}

        {/* Payload fields */}
        {fields.length > 0 ? (
          <View className="gap-1.5">
            {fields.map((f) => (
              <View key={f.key} className="flex-row gap-2">
                <Text className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  {f.label}
                </Text>
                <Text className={`flex-1 text-[13px] text-text ${f.isLongText ? "leading-snug" : ""}`}>
                  {f.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Error */}
        {errorMsg ? (
          <View className="rounded border border-critical bg-critical-bg px-3 py-2">
            <Text className="text-[12px] text-critical">{errorMsg}</Text>
          </View>
        ) : null}

        {/* Actions */}
        {status === "idle" || status === "error" ? (
          <View className="gap-2">
            <ApproveButton onPress={handleApprove} loading={false} />
            <RejectFlow onReject={handleReject} loading={false} />
          </View>
        ) : status === "saving" ? (
          <View className="flex-row items-center gap-2 py-2">
            <ActivityIndicator size="small" />
            <Text className="text-[12px] text-text-sec">Memproses…</Text>
          </View>
        ) : status === "approved" ? (
          <View
            testID="approved-badge"
            className="self-start rounded bg-ok-bg px-3 py-1.5"
          >
            <Text className="text-[12px] font-semibold text-ok">Tersimpan di kartu</Text>
          </View>
        ) : (
          <View testID="rejected-badge">
            <Text className="text-[12px] font-semibold text-text-muted">Ditolak.</Text>
          </View>
        )}
      </View>
    </View>
  );
}
