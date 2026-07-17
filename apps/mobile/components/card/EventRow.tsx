/**
 * MobileEventRow — renders a single card_events row in the timeline.
 *
 * Mirrors web EventRow.tsx:
 *  - kind label in Bahasa (KIND_LABEL map)
 *  - localized date (id-ID)
 *  - one-liner summary via core `summarize`
 *  - high-risk badge
 *  - extracted URLs (with looksLikeImage check → expo-image thumbnail or link chip)
 *  - per-event attachment thumbnails / caption
 */

import { useState } from "react";
import { View, Pressable, Linking, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import type { CardEvent, CardAttachment } from "@datum/db";
import { summarize, extractUrls, looksLikeImage, safeHostname } from "@datum/core";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { useSignedAttachmentUrl } from "@/lib/attachments/useSignedAttachmentUrl";
import { AttachmentViewer } from "./AttachmentViewer";

// ─── Kind label map (Bahasa Indonesia) ────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  decision: "Keputusan",
  drawing: "Gambar",
  vendor: "Vendor",
  material: "Material",
  work: "Kerja",
  photo: "Foto",
  document: "Dokumen",
  client_request: "Permintaan Klien",
  note: "Catatan",
  // Retired kinds — may still appear in old timelines
  survey: "Survei (lama)",
  vendor_quote: "Quote Vendor (lama)",
  vendor_pick: "Vendor Dipilih (lama)",
  worker_assigned: "Tukang (lama)",
  progress: "Progres (lama)",
  defect: "Defect (lama)",
  pending: "Menunggu (lama)",
};

// High-risk kinds — mirror @datum/types HIGH_RISK_KINDS
const HIGH_RISK_KINDS = new Set(["decision", "client_request"]);

function isHighRisk(event: CardEvent): boolean {
  const p = event.payload as Record<string, unknown>;
  if (!HIGH_RISK_KINDS.has(event.event_kind)) return false;
  // decision: open when no approved_by and status is needs_decision
  if (event.event_kind === "decision") {
    return !p.approved_by && p.status === "needs_decision";
  }
  // client_request: open when status is 'open'
  if (event.event_kind === "client_request") {
    return p.status === "open";
  }
  return false;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MobileEventRowProps {
  event: CardEvent;
  /** Attachments for this specific event (pre-keyed by parent). */
  attachments?: CardAttachment[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileEventRow({ event, attachments = [] }: MobileEventRowProps) {
  const summary = summarize(event);
  const urls = extractUrls(event.payload as Record<string, unknown>);
  const highRisk = isHighRisk(event);
  const kindLabel = KIND_LABEL[event.event_kind] ?? event.event_kind;
  const dateStr = new Date(event.occurred_at).toLocaleString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <View className="mb-2 rounded border border-border/40 bg-surface p-3">
      {/* Meta row: kind chip + date */}
      <View className="mb-1 flex-row items-center gap-2">
        <View className="rounded-sm bg-surface-alt px-2 py-0.5">
          <Text className="text-[11px] uppercase tracking-wide text-text-sec">{kindLabel}</Text>
        </View>
        <Text className="text-[11px] text-text-muted">{dateStr}</Text>
        {highRisk ? (
          <Badge flag="high" label="Berisiko tinggi" />
        ) : null}
      </View>

      {/* Summary line */}
      <Text className="text-[14px] text-text leading-snug">{summary}</Text>

      {/* Extracted URLs */}
      {urls.length > 0 ? (
        <View className="mt-2 flex-row flex-wrap gap-2">
          {urls.map((u) => (
            <UrlChip key={u} url={u} />
          ))}
        </View>
      ) : null}

      {/* Attachments */}
      {attachments.length > 0 ? (
        <View className="mt-2 gap-2">
          {attachments.map((att) => (
            <AttachmentItem key={att.id} attachment={att} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── URL chip ─────────────────────────────────────────────────────────────────

function UrlChip({ url }: { url: string }) {
  const isImage = looksLikeImage(url);
  return (
    <Pressable
      onPress={() => Linking.openURL(url)}
      className="flex-row items-center gap-1 rounded border border-border/50 bg-surface-alt px-2 py-1 active:opacity-70"
      accessibilityLabel={`Buka tautan: ${url}`}
    >
      {isImage ? (
        <Image source={{ uri: url }} style={{ width: 48, height: 48, borderRadius: 4 }} contentFit="cover" />
      ) : null}
      <Text className="text-[11px] text-text-sec">{isImage ? "🖼 " : "🔗 "}{safeHostname(url)}</Text>
    </Pressable>
  );
}

// ─── Attachment item ──────────────────────────────────────────────────────────

function AttachmentItem({ attachment }: { attachment: CardAttachment }) {
  const { storage_path, ai_caption, ai_status, mime_type } = attachment;
  const isImg = mime_type?.startsWith("image/") ?? looksLikeImage(storage_path ?? "");

  // storage_path is a schemeless bucket path — resolve to a signed URL before
  // handing it to expo-image, else the thumbnail never loads. Only sign images.
  const { url, isLoading } = useSignedAttachmentUrl(isImg ? storage_path : null);
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <View className="flex-row items-start gap-2">
      {isImg && url ? (
        <>
          <Pressable
            onPress={() => setViewerOpen(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel={ai_caption ? `Lihat foto: ${ai_caption}` : "Lihat foto lampiran"}
          >
            <Image
              source={{ uri: url }}
              style={{ width: 64, height: 64, borderRadius: 6 }}
              contentFit="cover"
            />
          </Pressable>
          <AttachmentViewer
            visible={viewerOpen}
            url={url}
            caption={ai_caption}
            onClose={() => setViewerOpen(false)}
          />
        </>
      ) : isImg && isLoading ? (
        <View
          className="h-16 w-16 items-center justify-center rounded bg-surface-alt"
          accessibilityLabel="Memuat foto"
        >
          <ActivityIndicator size="small" color="#9C8B75" />
        </View>
      ) : (
        // Non-image attachment, or an image whose signing failed — dead paperclip tile.
        <View className="h-12 w-12 items-center justify-center rounded bg-surface-alt">
          <Text className="text-[20px]">📎</Text>
        </View>
      )}
      <View className="flex-1">
        {ai_status === "processing" || ai_status === "pending" ? (
          <Text className="text-[12px] text-text-muted italic">Menganalisis…</Text>
        ) : ai_caption ? (
          <Text className="text-[12px] text-text-sec">{ai_caption}</Text>
        ) : (
          <Text className="text-[12px] text-text-muted">Lampiran</Text>
        )}
      </View>
    </View>
  );
}
