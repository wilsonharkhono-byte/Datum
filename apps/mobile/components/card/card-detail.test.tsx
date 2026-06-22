/**
 * Tests for the card-detail screen and its sub-components.
 *
 * Strategy:
 *  - Seed a QueryClient with CardDetail + comments + members + attachments fixtures
 *  - Render the CardDetailScreen via a thin wrapper
 *  - Assert header, timeline event summary, comment, member, and state variations
 *  - No network — @datum/core query fns are mocked; supabase and env are stubbed
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import { keys } from "@datum/core";
import type { CardDetail, CardMemberWithStaff } from "@datum/core";
import type { CardComment, CardAttachment } from "@datum/db";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
}));

// expo-router: provide useLocalSearchParams + Stack.Screen stub
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(() => ({ slug: "P1", cardSlug: "test-card" })),
  useRouter: jest.fn(() => ({ back: jest.fn() })),
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => null,
  },
}));

// expo-image: stub to a plain View so snapshots don't break
jest.mock("expo-image", () => ({
  Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => {
    const { View } = require("react-native");
    return <View accessibilityLabel={accessibilityLabel} />;
  },
}));

// realtime hook: no-op in tests
jest.mock("@/lib/realtime/useRealtimeInvalidation", () => ({
  useProjectRealtime: jest.fn(),
}));

// session: staff is authenticated for all card-detail tests
jest.mock("@/lib/session/session", () => ({
  useSession: jest.fn(() => ({
    status: "authenticated",
    staff: { id: "staff-uuid-self", full_name: "Wilson", role: "principal", email: null },
    signOut: jest.fn(),
  })),
}));

// Mock @datum/core query fns — actual implementations would call Supabase
const mockGetCardWithTimelineByProjectCode = jest.fn();
const mockGetCardComments = jest.fn();
const mockGetCardMembers = jest.fn();
const mockGetCardAttachments = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual("@datum/core");
  return {
    ...actual,
    getCardWithTimelineByProjectCode: (...args: unknown[]) =>
      mockGetCardWithTimelineByProjectCode(...args),
    getCardComments: (...args: unknown[]) => mockGetCardComments(...args),
    getCardMembers: (...args: unknown[]) => mockGetCardMembers(...args),
    getCardAttachments: (...args: unknown[]) => mockGetCardAttachments(...args),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CARD_ID = "card-uuid-1";
const PROJECT_ID = "project-uuid-1";
const CODE = "P1";
const SLUG = "test-card";

const FIXTURE_DETAIL: CardDetail = {
  card: {
    id: CARD_ID,
    project_id: PROJECT_ID,
    topic_id: "topic-uuid",
    title: "Pasang keramik lantai",
    slug: SLUG,
    status: "active",
    current_summary: "Keramik 60x60 warna krem dipasang di ruang tamu.",
    properties: null,
    created_by_staff_id: null,
    created_at: "2026-01-01T08:00:00Z",
    updated_at: "2026-01-01T08:00:00Z",
    last_event_at: null,
  } as CardDetail["card"],
  events: [
    {
      id: "event-1",
      card_id: CARD_ID,
      project_id: PROJECT_ID,
      event_kind: "note" as const,
      payload: { body: "Mulai pengerjaan hari ini." },
      occurred_at: "2026-01-10T09:00:00Z",
      logged_by_staff_id: null,
      cost_visible: false,
      draft_id: null,
      created_at: "2026-01-10T09:00:00Z",
      search_text: null,
      source_id: null,
      source_kind: "manual" as const,
    } as unknown as CardDetail["events"][0],
    {
      id: "event-2",
      card_id: CARD_ID,
      project_id: PROJECT_ID,
      event_kind: "photo" as const,
      payload: {
        caption: "Foto progres pemasangan",
        url: "https://storage.example.com/photo.jpg",
      },
      occurred_at: "2026-01-11T10:00:00Z",
      logged_by_staff_id: null,
      cost_visible: false,
      draft_id: null,
      created_at: "2026-01-11T10:00:00Z",
      search_text: null,
      source_id: null,
      source_kind: "manual" as const,
    } as unknown as CardDetail["events"][0],
  ],
};

const FIXTURE_COMMENTS: CardComment[] = [
  {
    id: "comment-1",
    card_id: CARD_ID,
    project_id: PROJECT_ID,
    body: "Pastikan nat sudah kering sebelum dilanjutkan.",
    created_by_staff_id: "staff-uuid-1",
    created_at: "2026-01-12T08:00:00Z",
    deleted_at: null,
    edited_at: null,
    mentions: [],
  } as CardComment,
];

const FIXTURE_MEMBERS: CardMemberWithStaff[] = [
  {
    card_id: CARD_ID,
    staff_id: "staff-uuid-2",
    role: "watcher" as const,
    added_at: "2026-01-01T08:00:00Z",
    added_by_staff_id: null,
    removed_at: null,
    staff: { id: "staff-uuid-2", full_name: "Budi Santoso", role: "pic" },
  } as unknown as CardMemberWithStaff,
];

const FIXTURE_ATTACHMENTS: Map<string, CardAttachment[]> = new Map([
  [
    "event-2",
    [
      {
        id: "att-1",
        card_event_id: "event-2",
        storage_path: "cards/photo.jpg",
        mime_type: "image/jpeg",
        ai_caption: "Pemasangan keramik lantai ruang tamu.",
        ai_status: "done",
        ai_attempts: 1,
        ai_error: null,
        ai_extracted: null,
        ai_model: null,
        ai_processed_at: "2026-01-11T10:02:00Z",
        created_at: "2026-01-11T10:01:00Z",
        created_by_staff_id: null,
      } as unknown as CardAttachment,
    ],
  ],
]);

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Import after mocks so the mock wiring is in place
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: CardDetailScreen } = require("../../app/(tabs)/(matrix)/project/[slug]/card/[cardSlug]");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CardDetailScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCardWithTimelineByProjectCode.mockResolvedValue(FIXTURE_DETAIL);
    mockGetCardComments.mockResolvedValue(FIXTURE_COMMENTS);
    mockGetCardMembers.mockResolvedValue(FIXTURE_MEMBERS);
    mockGetCardAttachments.mockResolvedValue(FIXTURE_ATTACHMENTS);
  });

  it("renders card title and summary once loaded", async () => {
    const client = makeClient();
    // Pre-seed to skip loading state
    client.setQueryData(keys.card(CODE, SLUG), FIXTURE_DETAIL);
    client.setQueryData(["card-comments", CARD_ID], FIXTURE_COMMENTS);
    client.setQueryData(["card-members", CARD_ID], FIXTURE_MEMBERS);
    client.setQueryData(["card-attachments", CARD_ID], FIXTURE_ATTACHMENTS);

    const { getByText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });

    expect(getByText("Pasang keramik lantai")).toBeTruthy();
    expect(getByText("Keramik 60x60 warna krem dipasang di ruang tamu.")).toBeTruthy();
  });

  it("renders status badge for active card", async () => {
    const client = makeClient();
    client.setQueryData(keys.card(CODE, SLUG), FIXTURE_DETAIL);
    client.setQueryData(["card-comments", CARD_ID], FIXTURE_COMMENTS);
    client.setQueryData(["card-members", CARD_ID], FIXTURE_MEMBERS);
    client.setQueryData(["card-attachments", CARD_ID], FIXTURE_ATTACHMENTS);

    const { getByText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });
    // NativeWind `uppercase` class is CSS-only — text renders as the raw prop value
    expect(getByText("Aktif")).toBeTruthy();
  });

  it("renders timeline event summaries", async () => {
    const client = makeClient();
    client.setQueryData(keys.card(CODE, SLUG), FIXTURE_DETAIL);
    client.setQueryData(["card-comments", CARD_ID], FIXTURE_COMMENTS);
    client.setQueryData(["card-members", CARD_ID], FIXTURE_MEMBERS);
    client.setQueryData(["card-attachments", CARD_ID], FIXTURE_ATTACHMENTS);

    const { getByText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });

    // event-1: note → body
    expect(getByText("Mulai pengerjaan hari ini.")).toBeTruthy();
    // event-2: photo → caption
    expect(getByText("Foto progres pemasangan")).toBeTruthy();
  });

  it("renders comment body", async () => {
    const client = makeClient();
    client.setQueryData(keys.card(CODE, SLUG), FIXTURE_DETAIL);
    client.setQueryData(["card-comments", CARD_ID], FIXTURE_COMMENTS);
    client.setQueryData(["card-members", CARD_ID], FIXTURE_MEMBERS);
    client.setQueryData(["card-attachments", CARD_ID], FIXTURE_ATTACHMENTS);

    const { getByText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });
    expect(getByText("Pastikan nat sudah kering sebelum dilanjutkan.")).toBeTruthy();
  });

  it("renders member name and role", async () => {
    const client = makeClient();
    client.setQueryData(keys.card(CODE, SLUG), FIXTURE_DETAIL);
    client.setQueryData(["card-comments", CARD_ID], FIXTURE_COMMENTS);
    client.setQueryData(["card-members", CARD_ID], FIXTURE_MEMBERS);
    client.setQueryData(["card-attachments", CARD_ID], FIXTURE_ATTACHMENTS);

    const { getByText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });
    expect(getByText("Budi Santoso")).toBeTruthy();
    // NativeWind `uppercase` is CSS-only — raw prop value renders
    expect(getByText("Pengamat")).toBeTruthy();
  });

  it("renders attachment AI caption for image event", async () => {
    const client = makeClient();
    client.setQueryData(keys.card(CODE, SLUG), FIXTURE_DETAIL);
    client.setQueryData(["card-comments", CARD_ID], FIXTURE_COMMENTS);
    client.setQueryData(["card-members", CARD_ID], FIXTURE_MEMBERS);
    client.setQueryData(["card-attachments", CARD_ID], FIXTURE_ATTACHMENTS);

    const { getByText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });
    expect(getByText("Pemasangan keramik lantai ruang tamu.")).toBeTruthy();
  });

  it("shows loading skeleton when data is not yet fetched", async () => {
    // Don't pre-seed: the query will be in pending state
    const client = makeClient();
    // Make the mock never resolve so we stay in loading
    mockGetCardWithTimelineByProjectCode.mockReturnValue(new Promise(() => {}));

    const { getAllByLabelText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });
    // Skeleton renders with accessibilityLabel="Memuat"; multiple skeletons are expected
    expect(getAllByLabelText("Memuat").length).toBeGreaterThan(0);
  });

  it("shows not-found message when card query returns no data", async () => {
    const client = makeClient();
    // Seed with undefined → card missing
    client.setQueryData(keys.card(CODE, SLUG), undefined);
    // Make the live query fail too
    mockGetCardWithTimelineByProjectCode.mockRejectedValue(new Error("Card not found: test-card"));

    const { findByText } = render(<CardDetailScreen />, { wrapper: wrapper(client) });
    // After the query settles to error state
    await findByText(/kartu tidak ditemukan/i);
  });
});

// ─── MobileEventRow unit tests ────────────────────────────────────────────────

import { MobileEventRow } from "./EventRow";

describe("MobileEventRow", () => {
  it("renders kind label and summary for a note event", () => {
    const event = FIXTURE_DETAIL.events[0]!;
    const { getByText } = render(<MobileEventRow event={event} />);
    expect(getByText("Catatan")).toBeTruthy();
    expect(getByText("Mulai pengerjaan hari ini.")).toBeTruthy();
  });

  it("renders attachment AI caption when provided", () => {
    const event = FIXTURE_DETAIL.events[1]!;
    const attachments = FIXTURE_ATTACHMENTS.get("event-2")!;
    const { getByText } = render(
      <MobileEventRow event={event} attachments={attachments} />,
    );
    expect(getByText("Pemasangan keramik lantai ruang tamu.")).toBeTruthy();
  });
});

// ─── CommentItem unit test ────────────────────────────────────────────────────

import { CommentItem } from "./CommentItem";

describe("CommentItem", () => {
  it("renders comment body", () => {
    const { getByText } = render(<CommentItem comment={FIXTURE_COMMENTS[0]!} />);
    expect(getByText("Pastikan nat sudah kering sebelum dilanjutkan.")).toBeTruthy();
  });
});

// ─── MemberRow unit test ──────────────────────────────────────────────────────

import { MemberRow } from "./MemberRow";

describe("MemberRow", () => {
  it("renders member name and role label", () => {
    const { getByText } = render(<MemberRow member={FIXTURE_MEMBERS[0]!} />);
    expect(getByText("Budi Santoso")).toBeTruthy();
    // NativeWind `uppercase` is CSS-only — raw prop value renders
    expect(getByText("Pengamat")).toBeTruthy();
  });
});
