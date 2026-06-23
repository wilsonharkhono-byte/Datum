/**
 * ProposalCard.tsx — mobile port of the web ProposalCard.
 *
 * Commit sequence (mirrors web):
 *   1. createCard (if proposal.createNew)
 *   2. createCardEvent
 *   3. supabase.storage upload + attachToEvent (if file attached)
 *   4. linkCardToArea (if areaHint and linkArea checked)
 *
 * Uses core mutations directly with the anon supabase client (RLS-scoped).
 * Invalidates board + card queries on success.
 */

import { useState } from "react";
import { View, Pressable, ScrollView, TextInput, Switch } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  createCard,
  createCardEvent,
  linkCardToArea,
  keys,
} from "@datum/core";
import type { Proposal } from "@datum/core";
import { HIGH_RISK_KINDS } from "@datum/types";
import type { EventKind } from "@datum/types";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session/session";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { uploadCardAttachment } from "@/lib/attachments/pick-and-upload";
import type { AttachedFile } from "./MessageInput";

// ─── Kind labels (Indonesian) ─────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  decision: "keputusan",
  drawing: "gambar",
  vendor: "vendor",
  material: "material",
  work: "kerja",
  photo: "foto",
  document: "dokumen",
  client_request: "permintaan klien",
  note: "catatan",
  survey: "survei (lama)",
  vendor_quote: "quote vendor (lama)",
  vendor_pick: "vendor dipilih (lama)",
  worker_assigned: "tukang (lama)",
  progress: "progres (lama)",
  defect: "defect (lama)",
  pending: "menunggu (lama)",
};

// ─── ProposalCard ─────────────────────────────────────────────────────────────

export function ProposalCard({
  proposal,
  pendingFile,
}: {
  proposal: Proposal;
  pendingFile?: AttachedFile;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { staff } = useSession();

  type Status = "pending" | "saving" | "saved" | "discarded" | "error";
  const [status, setStatus] = useState<Status>("pending");
  const [error, setError] = useState<string | null>(null);
  const [attachWarning, setAttachWarning] = useState<string | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [linkArea, setLinkArea] = useState(true);
  const [areaLinked, setAreaLinked] = useState(false);
  const [title, setTitle] = useState(proposal.newCardTitle ?? "");
  const [savedCard, setSavedCard] = useState({
    slug: proposal.cardSlug,
    title: proposal.cardTitle,
  });

  const areaHint = proposal.areaHint ?? null;
  const isHighRisk = HIGH_RISK_KINDS.has(proposal.eventKind as EventKind);
  const conf = Math.round(proposal.confidence * 100);
  const lowConfidence = conf < 50;

  const confColor =
    conf >= 80 ? "text-ok" : conf >= 50 ? "text-warning" : "text-critical";

  async function commit() {
    setError(null);
    setStatus("saving");

    try {
      // 1. Resolve target card
      let cardId = proposal.cardId;
      let cardSlug = proposal.cardSlug;
      let cardTitle = proposal.cardTitle;

      if (proposal.createNew) {
        const finalTitle = (title.trim() || (proposal.newCardTitle ?? "").trim());
        if (!finalTitle) {
          setStatus("error");
          setError("Judul kartu tidak boleh kosong");
          return;
        }
        if (!proposal.topicId) {
          setStatus("error");
          setError("Kolom kartu tidak diketahui — tidak bisa membuat kartu baru");
          return;
        }
        const created = await createCard(supabase, {
          projectId: proposal.projectId,
          topicId: proposal.topicId,
          title: finalTitle,
        });
        if (!created.ok) {
          setStatus("error");
          setError(created.error);
          return;
        }
        cardId = created.id;
        cardSlug = created.slug;
        cardTitle = finalTitle;
      }

      // 2. Create the card event
      const staffId = staff?.id;
      if (!staffId) {
        setStatus("error");
        setError("Tidak ada sesi — silakan masuk kembali");
        return;
      }

      const eventRes = await createCardEvent(supabase, {
        cardId,
        projectId: proposal.projectId,
        eventKind: proposal.eventKind as EventKind,
        payload: {
          ...proposal.payload,
          ...(proposal.rationale?.trim()
            ? { ai_rationale: proposal.rationale }
            : {}),
        },
        loggedByStaffId: staffId,
      });

      if (!eventRes.ok) {
        setStatus("error");
        setError(
          proposal.createNew
            ? `Kartu "${cardTitle}" dibuat, tapi gagal menyimpan catatan: ${eventRes.error}`
            : eventRes.error,
        );
        return;
      }

      // 3. Upload pending file if attached — best-effort, never blocks event save.
      if (pendingFile) {
        const uploadRes = await uploadCardAttachment(supabase, {
          projectId: proposal.projectId,
          cardId,
          cardEventId: eventRes.eventId,
          asset: {
            uri: pendingFile.uri,
            name: pendingFile.name,
            mimeType: pendingFile.mime,
            size: pendingFile.size,
          },
        });

        if (!uploadRes.ok) {
          const msg =
            "skipped" in uploadRes && uploadRes.skipped
              ? uploadRes.reason
              : uploadRes.error;
          // Attachment failure is non-blocking — event was already saved successfully.
          setAttachWarning(`Lampiran gagal diunggah: ${msg}`);
        }
      }

      // 4. Optionally link card to hinted area
      if (areaHint && linkArea) {
        const linkRes = await linkCardToArea(supabase, {
          cardId,
          areaId: areaHint.areaId,
        });
        if (linkRes.ok) {
          setAreaLinked(true);
        } else {
          // Soft failure — event is already saved
          setError(
            `Catatan tersimpan, tapi gagal menautkan ke ${areaHint.areaName}: ${linkRes.error}`,
          );
        }
      }

      // Invalidate queries
      void qc.invalidateQueries({ queryKey: keys.board(proposal.cardSlug.split("-")[0] ?? "") });
      void qc.invalidateQueries({ queryKey: ["card-comments", cardId] });

      setSavedCard({ slug: cardSlug, title: cardTitle });
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Terjadi kesalahan tak terduga");
    }
  }

  function handleSave() {
    // Low-confidence two-tap gate
    if (lowConfidence && !confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    void commit();
  }

  function discard() {
    setConfirmArmed(false);
    setStatus("discarded");
  }

  const isEditing = status === "pending" || status === "error";

  return (
    <View className="rounded-xl border border-border/40 bg-surface p-3">
      {/* Header: card → topic + confidence */}
      <View className="mb-1 flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          {proposal.createNew && isEditing ? (
            <View className="gap-1">
              <Text className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                Kartu baru
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                maxLength={120}
                accessibilityLabel="Judul kartu baru"
                placeholder="Judul kartu…"
                placeholderTextColor="#9C8B75"
                className="rounded border border-border/50 bg-bg px-2 py-1 text-[13px] font-semibold text-text"
              />
              <Text className="text-[11px] text-text-muted">
                · {proposal.topicName}
              </Text>
            </View>
          ) : (
            <Text className="text-[13px] font-semibold text-text" numberOfLines={2}>
              → {proposal.createNew ? savedCard.title : proposal.cardTitle}
              <Text className="font-normal text-text-muted">
                {" "}
                · {proposal.topicName}
              </Text>
            </Text>
          )}
        </View>
        <Text className={`shrink-0 text-[11px] font-semibold uppercase ${confColor}`}>
          {conf}% yakin
        </Text>
      </View>

      {/* Kind label */}
      <Text className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
        {KIND_LABELS[proposal.eventKind] ?? proposal.eventKind}
      </Text>

      {/* Area link toggle */}
      {areaHint && isEditing ? (
        <View className="mb-2 flex-row items-center gap-2 rounded border border-border/40 bg-bg px-2 py-1.5">
          <Switch
            value={linkArea}
            onValueChange={setLinkArea}
            accessibilityLabel={`Tautkan kartu ke area ${areaHint.areaName}`}
          />
          <Text className="flex-1 text-[11px] text-text-sec">
            Tautkan ke area{" "}
            <Text className="font-semibold text-text">{areaHint.areaName}</Text>
            {"  "}
            <Text className="font-mono text-text-muted">{areaHint.areaCode}</Text>
          </Text>
        </View>
      ) : null}

      {/* File chip */}
      {(proposal.fileMeta || pendingFile) && (
        <View className="mb-2 flex-row items-center gap-1.5 self-start rounded border border-border/40 bg-bg px-2 py-1">
          <Text className="text-[10px] text-text-sec">
            📎 {proposal.fileMeta?.name ?? pendingFile?.name} — akan diupload setelah simpan
          </Text>
        </View>
      )}

      {/* Payload preview */}
      <ScrollView
        className="mb-2 max-h-[80px] rounded border border-border/40 bg-bg p-2"
        nestedScrollEnabled
      >
        <Text className="font-mono text-[10px] text-text">
          {JSON.stringify(proposal.payload, null, 2)}
        </Text>
      </ScrollView>

      {/* Rationale */}
      {proposal.rationale ? (
        <Text className="mb-2 text-[10px] italic text-text-sec">
          "{proposal.rationale}"
        </Text>
      ) : null}

      {/* High-risk badge */}
      {isHighRisk && (
        <View className="mb-2">
          <Badge flag="high" label="Berisiko tinggi · principal akan dinotifikasi" />
        </View>
      )}

      {/* Low-confidence warning */}
      {lowConfidence && isEditing && (
        <View className="mb-2 rounded border border-border/40 bg-warning-bg px-2 py-1">
          <Text className="text-[11px] font-semibold text-warning">
            ⚠ Keyakinan AI rendah — periksa isian sebelum menyimpan
          </Text>
        </View>
      )}

      {/* Attachment warning (non-blocking — shown even on success) */}
      {attachWarning ? (
        <View className="mb-2 rounded border border-border/40 bg-warning-bg px-2 py-1" testID="attach-warning">
          <Text className="text-[11px] font-semibold text-warning">
            ⚠ {attachWarning}
          </Text>
        </View>
      ) : null}

      {/* Error message */}
      {error ? (
        <Text className="mb-2 text-[11px] text-critical">{error}</Text>
      ) : null}

      {/* Actions */}
      {isEditing ? (
        <View className="flex-row gap-2 border-t border-border/30 pt-2">
          <Pressable
            onPress={handleSave}
            testID="proposal-save-btn"
            accessibilityRole="button"
            accessibilityLabel={
              confirmArmed
                ? "Konfirmasi simpan proposal"
                : "Simpan proposal ke kartu"
            }
            className={`flex-1 items-center rounded px-3 py-2 ${
              confirmArmed ? "bg-warning" : "bg-primary"
            } active:opacity-80`}
          >
            <Text className="text-[12px] font-bold uppercase tracking-wide text-[#FDFAF6]">
              {confirmArmed ? "Yakin simpan?" : "Simpan ke kartu"}
            </Text>
          </Pressable>
          <Pressable
            onPress={discard}
            accessibilityRole="button"
            accessibilityLabel="Batalkan proposal"
            className="rounded border border-border/50 bg-surface-alt px-3 py-2 active:opacity-80"
          >
            <Text className="text-[12px] font-semibold uppercase tracking-wide text-text-sec">
              Batal
            </Text>
          </Pressable>
        </View>
      ) : status === "saving" ? (
        <Text className="text-[11px] text-text-muted">Menyimpan…</Text>
      ) : status === "saved" ? (
        <View className="gap-1">
          <View className="self-start rounded bg-ok-bg px-2 py-1">
            <Text className="text-[11px] font-semibold text-ok">
              ✓{" "}
              {isHighRisk
                ? "Tersimpan di kartu · principal dinotifikasi"
                : proposal.createNew
                ? "Kartu baru dibuat · catatan tersimpan"
                : "Tersimpan di kartu"}
            </Text>
          </View>
          {areaLinked && areaHint ? (
            <View className="self-start rounded bg-surface-alt px-2 py-0.5">
              <Text className="text-[11px] font-semibold text-text-sec">
                ✓ Ditautkan ke {areaHint.areaName}
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={() =>
              router.push(
                `/(tabs)/(matrix)/project/${savedCard.slug.split("-")[0]}/card/${savedCard.slug}` as never,
              )
            }
            className="self-start rounded border border-border/50 bg-surface-alt px-2 py-1 active:opacity-70"
          >
            <Text className="text-[11px] font-bold uppercase tracking-wide text-text-sec">
              → Buka {savedCard.title}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text className="text-[11px] text-text-muted">Dibatalkan.</Text>
      )}
    </View>
  );
}
