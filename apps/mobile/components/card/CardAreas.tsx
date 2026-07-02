/**
 * CardAreas — show + link/unlink a card's areas (rooms) on mobile.
 *
 * Mirrors web CardAreas.tsx (apps/web/components/board/CardAreas.tsx):
 *  - Linked areas render as removable chips (area_code · area_name (floor)).
 *  - "+ Tautkan area" opens a picker listing the project's areas not yet
 *    linked; tapping one links it.
 *
 * Read: getProjectAreas (already exposed as useAreas) + getCardAreas (new
 * useCardAreas hook) from @datum/core.
 * Write: linkCardToArea / unlinkCardFromArea from @datum/core, called
 * through mobile's existing supabase client — same pattern as
 * ProposalCard.tsx's area-link call and MemberPicker's add/remove mutations.
 */

import { useState } from "react";
import { View, Pressable, ActivityIndicator, ScrollView } from "react-native";
import type { Area } from "@datum/db";
import { Text } from "@/components/ui/Text";
import { useAreas } from "@/lib/query/hooks";
import { useLinkCardArea, useUnlinkCardArea } from "@/lib/query/mutations";

// ─── Area chip label ──────────────────────────────────────────────────────────

function areaLabel(area: Area): string {
  return `${area.area_code} · ${area.area_name}${area.floor ? ` (${area.floor})` : ""}`;
}

// ─── CardAreas — linked chips + picker ────────────────────────────────────────

interface CardAreasProps {
  cardId: string;
  projectId: string;
  /** project_code (route param) — identity for the useBoard/useRooms query keys. */
  code: string;
  currentAreas: Area[];
}

export function CardAreas({ cardId, projectId, code, currentAreas }: CardAreasProps) {
  const [open, setOpen] = useState(false);
  const linkArea = useLinkCardArea(cardId, projectId, code);
  const unlinkArea = useUnlinkCardArea(cardId, projectId, code);
  const [error, setError] = useState<string | null>(null);

  const areasQuery = useAreas(projectId);
  const linkedIds = new Set(currentAreas.map((a) => a.id));
  const addable = (areasQuery.data ?? []).filter((a) => !linkedIds.has(a.id));

  function handleLink(areaId: string) {
    if (linkArea.isPending) return;
    setError(null);
    linkArea.mutate(
      { areaId },
      {
        onSuccess: (res) => {
          if (res.ok) setOpen(false);
          else setError(res.error);
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Gagal menautkan area"),
      },
    );
  }

  function handleUnlink(areaId: string) {
    if (unlinkArea.isPending) return;
    setError(null);
    unlinkArea.mutate(
      { areaId },
      {
        onSuccess: (res) => {
          if (!res.ok) setError(res.error);
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Gagal melepas tautan area"),
      },
    );
  }

  return (
    <View>
      {currentAreas.length === 0 ? (
        <Text variant="muted" className="mb-2 italic">
          Belum ada area terkait.
        </Text>
      ) : (
        <View className="mb-2 flex-row flex-wrap gap-1.5">
          {currentAreas.map((a) => (
            <View
              key={a.id}
              className="flex-row items-center gap-1.5 rounded bg-surface-alt px-2 py-1"
            >
              <Text className="text-[12px] text-text-sec">{areaLabel(a)}</Text>
              <Pressable
                onPress={() => handleUnlink(a.id)}
                disabled={unlinkArea.isPending}
                className="min-h-[20px] min-w-[20px] items-center justify-center"
                accessibilityLabel={`Lepas tautan area ${a.area_code}`}
              >
                <Text className="text-[12px] text-text-muted">✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {!open ? (
        <Pressable
          onPress={() => setOpen(true)}
          className="min-h-[44px] items-center justify-center rounded border border-dashed border-border/60 px-4"
          accessibilityLabel="Tautkan area ke kartu"
        >
          <Text className="text-[13px] text-text-sec">+ Tautkan area</Text>
        </Pressable>
      ) : (
        <View className="rounded border border-border/60 bg-surface p-3">
          <View className="mb-2 flex-row items-center justify-between">
            <Text variant="label">Pilih area</Text>
            <Pressable
              onPress={() => setOpen(false)}
              className="min-h-[32px] min-w-[32px] items-center justify-center"
              accessibilityLabel="Tutup"
            >
              <Text className="text-[13px] text-text-sec">Tutup</Text>
            </Pressable>
          </View>

          {areasQuery.isPending ? (
            <ActivityIndicator />
          ) : areasQuery.isError ? (
            <Text className="text-[12px] text-text-muted italic">Gagal memuat area.</Text>
          ) : addable.length === 0 ? (
            <Text className="text-[12px] text-text-muted italic">
              Semua area sudah terkait.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 200 }}>
              {addable.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => handleLink(a.id)}
                  disabled={linkArea.isPending}
                  className="min-h-[44px] flex-row items-center justify-between rounded px-2 py-2 active:bg-surface-alt"
                  accessibilityLabel={`Tautkan area ${areaLabel(a)}`}
                >
                  <Text className="text-[14px] text-text">{areaLabel(a)}</Text>
                  {linkArea.isPending ? <ActivityIndicator size="small" /> : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {error ? (
        <Text className="mt-1 text-[12px] text-red-700">{error}</Text>
      ) : null}
    </View>
  );
}
