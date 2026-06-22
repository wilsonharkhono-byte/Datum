/**
 * Morning brief screen — "Apa yang butuh perhatian hari ini"
 *
 * Mirrors the web /brief page:
 *   1. Advisor feed  — ranked next-action items (getAdvisorData, already ranked)
 *   2. Six BriefData sections — pendingDrafts, decisionsNeeded, blockers,
 *      defects, awaitingClient, expiringQuotes
 *   3. Gate cascade risks strip
 *   4. Stale-by-project strip
 *
 * States handled: loading skeleton | error + retry | empty advisor | offline.
 */

import { ScrollView, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { AdvisorItemRow } from "@/components/brief/AdvisorItemRow";
import { BriefSection } from "@/components/brief/BriefSection";
import { useBrief, useAdvisor } from "@/lib/query/hooks";

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function BriefSkeleton() {
  return (
    <Screen>
      <OfflineBanner />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Header */}
        <Skeleton className="mt-3 h-5 w-40" />
        <Skeleton className="mt-2 h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-full" />

        {/* Advisor feed skeleton */}
        <Skeleton className="mt-5 h-4 w-32" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="mt-2 h-16" />
        ))}

        {/* Sections skeleton */}
        <View className="mt-6 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── Gate risk row ────────────────────────────────────────────────────────────

type GateRisk = {
  projectCode: string;
  areaId: string;
  areaName: string;
  gateCode: string;
  reason: string;
};

function GateRiskRow({ risk }: { risk: GateRisk }) {
  const router = useRouter();
  return (
    <Pressable
      testID={`gate-risk-${risk.areaId}-${risk.gateCode}`}
      onPress={() => router.push(`/(tabs)/(matrix)/project/${risk.projectCode}/schedule` as any)}
      accessibilityRole="button"
      accessibilityLabel={`Gate ${risk.gateCode} ${risk.areaName}`}
      className="mb-2 rounded border border-border/40 bg-surface p-3 active:opacity-75"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-[13px] font-medium text-text">
          {risk.projectCode} · {risk.areaName}
        </Text>
        <View className="rounded-sm bg-warning-bg px-2 py-0.5">
          <Text className="text-[11px] font-bold uppercase text-warning">
            Gate {risk.gateCode}
          </Text>
        </View>
      </View>
      <Text numberOfLines={2} className="mt-1 text-[12px] text-text-sec">
        {risk.reason}
      </Text>
    </Pressable>
  );
}

// ─── Stale project row ────────────────────────────────────────────────────────

function StaleProjectRow({
  entry,
}: {
  entry: { projectCode: string; projectName: string; staleCount: number };
}) {
  const router = useRouter();
  return (
    <Pressable
      testID={`stale-project-${entry.projectCode}`}
      onPress={() =>
        router.push(`/(tabs)/(matrix)/project/${entry.projectCode}/schedule` as any)
      }
      accessibilityRole="button"
      accessibilityLabel={`${entry.projectCode} ${entry.staleCount} stale`}
      className="mb-2 rounded border border-border/40 bg-surface p-3 active:opacity-75"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-[13px] font-medium text-text">{entry.projectCode}</Text>
        <View className="rounded-sm bg-bg-oat px-2 py-0.5">
          <Text className="text-[11px] font-semibold text-text-sec">
            {entry.staleCount} stale
          </Text>
        </View>
      </View>
      <Text numberOfLines={1} className="mt-0.5 text-[12px] text-text-muted">
        {entry.projectName}
      </Text>
    </Pressable>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BriefScreen() {
  const router = useRouter();

  const {
    data: advisorData,
    isLoading: advisorLoading,
    isError: advisorError,
    error: advisorErr,
    refetch: refetchAdvisor,
  } = useAdvisor();

  const {
    data: brief,
    isLoading: briefLoading,
    isError: briefError,
    error: briefErr,
    refetch: refetchBrief,
  } = useBrief();

  // Loading: show skeleton while either query is in flight on first load.
  if (advisorLoading || briefLoading) {
    return <BriefSkeleton />;
  }

  // Error: surface the first error with retry.
  if (advisorError || briefError) {
    const msg = advisorError
      ? `Gagal memuat advisor: ${(advisorErr as Error).message}`
      : `Gagal memuat ringkasan: ${(briefErr as Error).message}`;
    return (
      <Screen>
        <OfflineBanner />
        <ErrorState
          message={msg}
          onRetry={() => {
            void refetchAdvisor();
            void refetchBrief();
          }}
        />
      </Screen>
    );
  }

  const advisorItems = advisorData?.items ?? [];
  const gateRisks = brief?.gateRisks ?? [];
  const staleByProject = brief?.staleByProject ?? [];

  // Navigate from an advisor item href to the mobile route.
  function navigateAdvisorItem(href: string) {
    // /project/CODE/schedule → schedule sub-route
    const schedMatch = href.match(/^\/project\/([^/]+)\/schedule$/);
    if (schedMatch) {
      router.push(`/(tabs)/(matrix)/project/${schedMatch[1]}/schedule` as any);
      return;
    }
    // /project/CODE/cards/SLUG → card detail
    const cardMatch = href.match(/^\/project\/([^/]+)\/cards\/(.+)$/);
    if (cardMatch) {
      router.push(`/(tabs)/(matrix)/project/${cardMatch[1]}/card/${cardMatch[2]}` as any);
      return;
    }
    // /review
    if (href === "/review") {
      router.push("/(tabs)/(matrix)/review" as any);
    }
  }

  return (
    <Screen className="pt-0">
      <OfflineBanner />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* ── Header ── */}
        <View className="pb-3 pt-4">
          <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            Morning brief
          </Text>
          <Text variant="heading" className="mt-1">
            Apa yang butuh perhatian hari ini
          </Text>
          <Text variant="secondary" className="mt-1">
            Ringkasan lintas-proyek: keputusan, pekerjaan terblokir, defect, permintaan klien, quote kedaluwarsa, dan gate berisiko.
          </Text>
        </View>

        {/* ── Advisor feed: "Hari ini — prioritas" ── */}
        <View className="mb-5 rounded border border-border/40 bg-surface p-3">
          <Text className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            Hari ini — prioritas
          </Text>
          {advisorItems.length === 0 ? (
            <View
              testID="advisor-empty"
              className="rounded border border-dashed border-border/40 p-4"
            >
              <Text variant="secondary" className="italic">
                Tidak ada prioritas mendesak hari ini.
              </Text>
            </View>
          ) : (
            <View testID="advisor-feed">
              {advisorItems.map((item, i) => (
                <AdvisorItemRow
                  key={`${item.type}-${item.href}-${i}`}
                  item={item}
                  rank={i + 1}
                  onPress={() => navigateAdvisorItem(item.href)}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Six BriefData sections ── */}
        {brief ? (
          <>
            <BriefSection
              title="Draft menunggu approval"
              emoji="📝"
              count={brief.pendingDrafts.count}
              items={brief.pendingDrafts.items}
              emptyMessage="Tidak ada draft yang menunggu."
            />
            <BriefSection
              title="Keputusan dibutuhkan"
              emoji="⚖️"
              count={brief.decisionsNeeded.count}
              items={brief.decisionsNeeded.items}
              emptyMessage="Tidak ada keputusan yang menunggu."
            />
            <BriefSection
              title="Pekerjaan terblokir"
              emoji="⏳"
              count={brief.blockers.count}
              items={brief.blockers.items}
              emptyMessage="Tidak ada pekerjaan terblokir."
            />
            <BriefSection
              title="Defect aktif (30 hari)"
              emoji="🚧"
              count={brief.defects.count}
              items={brief.defects.items}
              emptyMessage="Tidak ada defect terbaru."
            />
            <BriefSection
              title="Permintaan klien"
              emoji="📨"
              count={brief.awaitingClient.count}
              items={brief.awaitingClient.items}
              emptyMessage="Tidak ada permintaan klien aktif."
            />
            <BriefSection
              title="Quote akan kedaluwarsa"
              emoji="💸"
              count={brief.expiringQuotes.count}
              items={brief.expiringQuotes.items}
              emptyMessage="Tidak ada quote yang akan kedaluwarsa."
            />
          </>
        ) : null}

        {/* ── Gate cascade risks ── */}
        <View className="mb-4 rounded border border-border/40 bg-surface p-3">
          <Text className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text">
            ⛓️ Gate berisiko (cascade)
          </Text>
          {gateRisks.length === 0 ? (
            <View className="rounded border border-dashed border-border/40 p-4">
              <Text variant="secondary" className="italic">
                Tidak ada gate yang berisiko terlambat berantai.
              </Text>
            </View>
          ) : (
            <View testID="gate-risks">
              {gateRisks.slice(0, 12).map((r) => (
                <GateRiskRow key={`${r.areaId}-${r.gateCode}`} risk={r} />
              ))}
            </View>
          )}
        </View>

        {/* ── Stale by project ── */}
        <View className="mb-4 rounded border border-border/40 bg-surface p-3">
          <Text className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text">
            🔄 Readiness perlu di-recompute
          </Text>
          {staleByProject.length === 0 ? (
            <View className="rounded border border-dashed border-border/40 p-4">
              <Text variant="secondary" className="italic">
                Semua readiness up-to-date.
              </Text>
            </View>
          ) : (
            <View testID="stale-projects">
              {staleByProject.map((p) => (
                <StaleProjectRow key={p.projectCode} entry={p} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
