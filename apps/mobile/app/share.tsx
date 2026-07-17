/**
 * /share — Trello-style "Add to card" for the Android share sheet.
 *
 * An authenticated user shares photos into DATUM; the root layout redirects
 * here. We map the shared files → PickedAsset[], let the user pick a project /
 * topic (defaulting to the last-used target), then either tap an existing card
 * (submits immediately, Trello-style) or create a new card. On success we
 * persist the target, reset the intent, and jump to the card. Partial
 * skip/fail outcomes are surfaced as a summary before we leave the screen.
 *
 * Confirm model: tapping a card row = submit-to-card; the header ✓ and the
 * inline "Buat & lampirkan" button drive the new-card path (disabled until a
 * title is typed).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";

import { useProjects, useBoard } from "@/lib/query/hooks";
import { useSession } from "@/lib/session/session";
import { supabase } from "@/lib/supabase/client";
import { sharedFilesToAssets } from "@/lib/share/intent";
import { getLastShareTarget, setLastShareTarget } from "@/lib/share/prefs";
import { shareToExistingCard, shareToNewCard } from "@/lib/share/add-to-card";
import type { ShareToCardResult } from "@/lib/share/add-to-card";
import { Text } from "@/components/ui/Text";

const CARD_ROUTE = "/(tabs)/(matrix)/project/[slug]/card/[cardSlug]" as const;

type PendingNav = { code: string; cardSlug: string };

export default function ShareScreen() {
  const router = useRouter();
  const { staff } = useSession();
  const { shareIntent, resetShareIntent } = useShareIntentContext();

  const assets = useMemo(
    () => sharedFilesToAssets(shareIntent?.files),
    [shareIntent],
  );

  const projectsQ = useProjects();
  const projects = projectsQ.data ?? [];

  // ── Selection state ──
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [newCardTitle, setNewCardTitle] = useState("");

  // ── Submission state ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);

  // ── Last-used target (best-effort, loaded once) ──
  const [lastTarget, setLastTarget] = useState<Awaited<
    ReturnType<typeof getLastShareTarget>
  > | null>(null);
  const [lastTargetLoaded, setLastTargetLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    getLastShareTarget().then((t) => {
      if (!active) return;
      setLastTarget(t);
      setLastTargetLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedCode = selectedProject?.project_code ?? "";

  const boardQ = useBoard(selectedCode);
  const columns = boardQ.data?.columns ?? [];
  const topics = columns.map((c) => c.topic);
  const activeColumn = columns.find((c) => c.topic.id === selectedTopicId) ?? null;

  // ── Default project selection (once, after last-target resolves) ──
  const projectDefaulted = useRef(false);
  useEffect(() => {
    if (projectDefaulted.current) return;
    if (!lastTargetLoaded || projects.length === 0) return;
    const first = projects[0];
    if (!first) return;
    const preferred =
      lastTarget && projects.find((p) => p.id === lastTarget.projectId);
    setSelectedProjectId(preferred ? preferred.id : first.id);
    projectDefaulted.current = true;
  }, [lastTargetLoaded, lastTarget, projects]);

  // ── Default topic selection whenever the board for the selection loads ──
  useEffect(() => {
    if (selectedTopicId || topics.length === 0) return;
    const first = topics[0];
    if (!first) return;
    const preferred =
      lastTarget && topics.find((t) => t.id === lastTarget.topicId);
    setSelectedTopicId(preferred ? preferred.id : first.id);
  }, [topics, lastTarget, selectedTopicId]);

  function selectProject(id: string) {
    if (id === selectedProjectId) return;
    setSelectedProjectId(id);
    setSelectedTopicId(null); // re-default topic for the new project
    setError(null);
  }

  // ── Submission ──
  function finish(res: ShareToCardResult) {
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    const nav: PendingNav = { code: selectedCode, cardSlug: res.cardSlug };
    const { skipped, failed } = res.outcome;
    void setLastShareTarget({
      projectId: selectedProjectId!,
      projectCode: selectedCode,
      topicId: selectedTopicId!,
    });
    setSubmitting(false);
    if (skipped.length > 0 || failed.length > 0) {
      // Show the summary first; navigate on acknowledgement.
      const parts: string[] = [`${res.outcome.uploaded} foto terunggah`];
      if (skipped.length) parts.push(`${skipped.length} dilewati`);
      if (failed.length) parts.push(`${failed.length} gagal`);
      setSummary(parts.join(" · "));
      setPendingNav(nav);
      return;
    }
    resetShareIntent();
    router.replace({
      pathname: CARD_ROUTE,
      params: { slug: nav.code, cardSlug: nav.cardSlug },
    });
  }

  function acknowledgeAndGo() {
    if (!pendingNav) return;
    resetShareIntent();
    router.replace({
      pathname: CARD_ROUTE,
      params: { slug: pendingNav.code, cardSlug: pendingNav.cardSlug },
    });
  }

  async function submitToCard(card: { id: string; slug: string }) {
    if (!staff || assets.length === 0 || !selectedProjectId || submitting) return;
    setSubmitting(true);
    setError(null);
    setSummary(null);
    const res = await shareToExistingCard(supabase, {
      projectId: selectedProjectId,
      cardId: card.id,
      cardSlug: card.slug,
      note: note.trim() || undefined,
      assets,
      loggedByStaffId: staff.id,
    });
    finish(res);
  }

  async function submitNewCard() {
    const title = newCardTitle.trim();
    if (
      !staff ||
      assets.length === 0 ||
      !selectedProjectId ||
      !selectedTopicId ||
      !title ||
      submitting
    )
      return;
    setSubmitting(true);
    setError(null);
    setSummary(null);
    const res = await shareToNewCard(supabase, {
      projectId: selectedProjectId,
      topicId: selectedTopicId,
      title,
      note: note.trim() || undefined,
      assets,
      loggedByStaffId: staff.id,
    });
    finish(res);
  }

  function cancel() {
    resetShareIntent();
    router.back();
  }

  const canCreateNew = !!newCardTitle.trim() && !!selectedTopicId && !submitting;

  // ── No images shared (e.g. non-image share) ──
  if (assets.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["top", "left", "right"]}>
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text variant="heading" className="text-center">
            Tidak ada gambar
          </Text>
          <Text variant="secondary" className="text-center">
            Bagikan foto dari galeri untuk melampirkannya ke kartu.
          </Text>
          <Pressable
            testID="share-cancel"
            onPress={cancel}
            className="mt-2 min-h-[44px] items-center justify-center rounded-lg border border-border px-5"
          >
            <Text variant="secondary">Tutup</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={["top", "left", "right"]}>
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <Pressable
          testID="share-cancel"
          onPress={cancel}
          disabled={submitting}
          className="min-h-[44px] min-w-[44px] flex-row items-center justify-start"
        >
          <Text variant="secondary">✕ Batal</Text>
        </Pressable>
        <Text variant="heading">Tambah ke kartu</Text>
        <Pressable
          testID="share-confirm"
          onPress={submitNewCard}
          disabled={!canCreateNew}
          className="min-h-[44px] min-w-[44px] flex-row items-center justify-end"
        >
          <Text
            className={`text-[17px] font-semibold ${
              canCreateNew ? "text-primary" : "text-text-muted"
            }`}
          >
            ✓
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-4 pb-10 gap-5 pt-4"
        showsVerticalScrollIndicator={false}
      >
        {/* Thumbnails + count */}
        <View className="gap-2">
          <Text variant="label">{assets.length} foto</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2"
          >
            {assets.map((a, i) => (
              <Image
                key={`${a.uri}-${i}`}
                testID="thumb"
                source={{ uri: a.uri }}
                style={{ width: 72, height: 72, borderRadius: 8 }}
                contentFit="cover"
              />
            ))}
          </ScrollView>
        </View>

        {/* No projects */}
        {!projectsQ.isLoading && projects.length === 0 ? (
          <View testID="empty-projects" className="items-center gap-2 py-8">
            <Text variant="heading">Tidak ada proyek</Text>
            <Text variant="secondary" className="text-center">
              Buat proyek terlebih dahulu untuk melampirkan foto.
            </Text>
          </View>
        ) : (
          <>
            {/* Project picker */}
            <View className="gap-2">
              <Text variant="label">Proyek</Text>
              {projectsQ.isLoading ? (
                <ActivityIndicator testID="projects-loading" />
              ) : (
                <View className="gap-1.5">
                  {projects.map((p) => {
                    const active = p.id === selectedProjectId;
                    return (
                      <Pressable
                        key={p.id}
                        testID={`project-row-${p.id}`}
                        onPress={() => !submitting && selectProject(p.id)}
                        className={`min-h-[44px] flex-row items-center justify-between rounded-lg border px-3 ${
                          active
                            ? "border-primary bg-surface-alt"
                            : "border-border bg-surface"
                        }`}
                      >
                        <Text className={active ? "font-medium" : ""}>
                          {p.project_code} · {p.project_name}
                        </Text>
                        {active ? <Text className="text-primary">✓</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Topic picker + cards for the selected project */}
            <View className="gap-2">
              <Text variant="label">Topik</Text>
              {boardQ.isLoading ? (
                <ActivityIndicator testID="board-loading" />
              ) : boardQ.isError ? (
                <View testID="board-error" className="gap-2">
                  <Text variant="secondary" className="text-red-700">
                    Gagal memuat papan proyek.
                  </Text>
                  <Pressable
                    testID="btn-retry"
                    onPress={() => boardQ.refetch()}
                    className="min-h-[44px] items-center justify-center rounded-lg border border-border px-4"
                  >
                    <Text variant="secondary">Coba lagi</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <View className="flex-row flex-wrap gap-2">
                    {topics.map((t) => {
                      const active = t.id === selectedTopicId;
                      return (
                        <Pressable
                          key={t.id}
                          testID={`topic-row-${t.id}`}
                          onPress={() =>
                            !submitting && setSelectedTopicId(t.id)
                          }
                          className={`min-h-[36px] justify-center rounded-full px-3 py-1.5 ${
                            active
                              ? "bg-primary"
                              : "border border-border bg-surface"
                          }`}
                        >
                          <Text
                            variant="secondary"
                            className={active ? "text-[#FDFAF6]" : ""}
                          >
                            {t.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Catatan (opsional) */}
                  <View className="mt-2 gap-1">
                    <Text variant="label">Catatan (opsional)</Text>
                    <TextInput
                      testID="input-note"
                      value={note}
                      onChangeText={setNote}
                      editable={!submitting}
                      placeholder="mis. Progres cor lantai 2"
                      multiline
                      className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text"
                    />
                  </View>

                  {/* Kartu baru */}
                  <View className="mt-2 gap-1">
                    <Text variant="label">Kartu baru</Text>
                    <View className="flex-row gap-2">
                      <TextInput
                        testID="input-new-card"
                        value={newCardTitle}
                        onChangeText={setNewCardTitle}
                        editable={!submitting}
                        placeholder="Judul kartu baru"
                        className="min-h-[44px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text"
                      />
                      <Pressable
                        testID="btn-create-card"
                        onPress={submitNewCard}
                        disabled={!canCreateNew}
                        className={`min-h-[44px] items-center justify-center rounded-lg px-4 ${
                          canCreateNew ? "bg-primary" : "bg-surface-alt"
                        }`}
                      >
                        <Text
                          className={`text-[15px] font-medium ${
                            canCreateNew ? "text-[#FDFAF6]" : "text-text-muted"
                          }`}
                        >
                          Buat & lampirkan
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Existing cards for the selected topic */}
                  <View className="mt-2 gap-1.5">
                    <Text variant="label">
                      Kartu di topik ini{" "}
                      {activeColumn ? `(${activeColumn.cards.length})` : ""}
                    </Text>
                    {activeColumn && activeColumn.cards.length > 0 ? (
                      activeColumn.cards.map((card) => (
                        <Pressable
                          key={card.id}
                          testID={`card-row-${card.id}`}
                          onPress={() => submitToCard(card)}
                          disabled={submitting}
                          className="min-h-[44px] justify-center rounded-lg border border-border bg-surface px-3 active:bg-surface-alt"
                        >
                          <Text numberOfLines={1}>{card.title}</Text>
                        </Pressable>
                      ))
                    ) : (
                      <Text variant="muted">Belum ada kartu di topik ini.</Text>
                    )}
                  </View>
                </>
              )}
            </View>
          </>
        )}

        {/* Error banner (state preserved for retry) */}
        {error ? (
          <View
            testID="error-banner"
            className="rounded-lg border border-red-400 bg-red-50 px-4 py-3"
          >
            <Text variant="secondary" className="text-red-700">
              {error}
            </Text>
          </View>
        ) : null}

        {/* Partial outcome summary (shown before navigating) */}
        {summary ? (
          <View
            testID="outcome-summary"
            className="gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3"
          >
            <Text variant="secondary" className="text-amber-800">
              {summary}
            </Text>
            <Pressable
              testID="btn-outcome-continue"
              onPress={acknowledgeAndGo}
              className="min-h-[44px] items-center justify-center rounded-lg bg-primary px-4"
            >
              <Text className="text-[15px] font-medium text-[#FDFAF6]">
                Lihat kartu
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* Busy overlay */}
      {submitting ? (
        <View
          testID="busy-overlay"
          className="absolute inset-0 items-center justify-center gap-3 bg-black/20"
        >
          <ActivityIndicator size="large" />
          <Text variant="secondary">Mengunggah…</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
