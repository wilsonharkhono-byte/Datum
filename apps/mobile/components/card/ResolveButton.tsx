/**
 * ResolveButton — affordance for resolving an open-loop event (decision /
 * client_request) inline in the timeline.
 *
 * Shows only when the event is still "open" per isDecisionOpen / isClientRequestOpen.
 * On press: shows a simple status picker (matching ResolveEventInput.newStatus enum),
 * then calls useResolveEvent.
 */

import { useState } from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import type { CardEvent } from "@datum/db";
import { Text } from "@/components/ui/Text";
import { useResolveEvent } from "@/lib/query/mutations";
import type { ResolveStatus } from "@datum/core";

// ─── Open-loop detection (mirrors @datum/types helpers) ───────────────────────

function isOpenDecision(payload: Record<string, unknown>): boolean {
  if (payload.status) return payload.status === "needs_decision";
  return !payload.approved_by;
}

function isOpenClientRequest(payload: Record<string, unknown>): boolean {
  return (payload.status ?? "open") === "open";
}

export function isEventOpenLoop(event: CardEvent): boolean {
  const p = event.payload as Record<string, unknown>;
  if (event.event_kind === "decision") return isOpenDecision(p);
  if (event.event_kind === "client_request") return isOpenClientRequest(p);
  return false;
}

// ─── Status options per kind ──────────────────────────────────────────────────

const DECISION_STATUSES: { value: ResolveStatus; label: string }[] = [
  { value: "decided",    label: "Diputuskan" },
  { value: "superseded", label: "Digantikan" },
];

const CLIENT_REQUEST_STATUSES: { value: ResolveStatus; label: string }[] = [
  { value: "answered", label: "Terjawab" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ResolveButtonProps {
  event: CardEvent;
  code: string;
  slug: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResolveButton({ event, code, slug }: ResolveButtonProps) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveEvent = useResolveEvent(code, slug);

  if (!isEventOpenLoop(event)) return null;

  const options =
    event.event_kind === "decision" ? DECISION_STATUSES : CLIENT_REQUEST_STATUSES;

  function handleResolve(newStatus: ResolveStatus) {
    setError(null);
    resolveEvent.mutate(
      { eventId: event.id, newStatus },
      {
        onSuccess: () => setExpanded(false),
        onError: (e) => setError(e instanceof Error ? e.message : "Gagal menutup isu"),
      },
    );
  }

  return (
    <View className="mt-2">
      {!expanded ? (
        <Pressable
          onPress={() => setExpanded(true)}
          className="min-h-[36px] items-center justify-center rounded border border-border/60 bg-surface-alt px-3 active:opacity-70"
          accessibilityLabel="Tutup isu ini"
        >
          <Text className="text-[12px] text-text-sec">Tutup isu ini</Text>
        </Pressable>
      ) : (
        <View className="rounded border border-border/60 bg-surface-alt p-2">
          <Text variant="label" className="mb-1">Ubah status menjadi:</Text>
          <View className="flex-row flex-wrap gap-2">
            {options.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => handleResolve(opt.value)}
                disabled={resolveEvent.isPending}
                className="min-h-[36px] items-center justify-center rounded bg-primary px-4 active:opacity-90"
                accessibilityLabel={`Tandai sebagai ${opt.label}`}
              >
                {resolveEvent.isPending ? (
                  <ActivityIndicator color="#FDFAF6" size="small" />
                ) : (
                  <Text className="text-[12px] font-medium text-[#FDFAF6]">{opt.label}</Text>
                )}
              </Pressable>
            ))}
            <Pressable
              onPress={() => setExpanded(false)}
              disabled={resolveEvent.isPending}
              className="min-h-[36px] items-center justify-center rounded bg-surface px-3 active:opacity-70"
              accessibilityLabel="Batal"
            >
              <Text className="text-[12px] text-text-sec">Batal</Text>
            </Pressable>
          </View>
          {error ? (
            <Text className="mt-1 text-[11px] text-red-700">{error}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
