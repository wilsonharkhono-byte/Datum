/**
 * Tests for card-detail write actions.
 *
 * Strategy: mock @datum/core mutation fns + supabase + env + expo-router +
 * expo-crypto + useSession, then render the components and drive interactions.
 *
 * Covers:
 *  - add-comment calls createComment and invalidates card-comments
 *  - add-event submit calls createCardEvent with the built input
 *  - resolve calls resolveCardEvent
 *  - remove-member calls removeCardMember
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(() => ({ slug: "P1", cardSlug: "test-card" })),
  useRouter: jest.fn(() => ({ back: jest.fn() })),
  Stack: { Screen: () => null },
}));
jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "mock-uuid-1234"),
}));
jest.mock("@/lib/session/session", () => ({
  useSession: jest.fn(() => ({
    status: "authenticated",
    staff: { id: "staff-uuid-self", full_name: "Wilson", role: "principal", email: null },
    signOut: jest.fn(),
  })),
}));
jest.mock("@/lib/realtime/useRealtimeInvalidation", () => ({
  useProjectRealtime: jest.fn(),
}));
jest.mock("expo-image", () => ({
  Image: () => {
    const { View } = require("react-native");
    return <View />;
  },
}));

// ─── Core mutation mocks ──────────────────────────────────────────────────────

const mockCreateComment = jest.fn();
const mockEditComment = jest.fn();
const mockDeleteComment = jest.fn();
const mockCreateCardEvent = jest.fn();
const mockResolveCardEvent = jest.fn();
const mockAddCardMember = jest.fn();
const mockRemoveCardMember = jest.fn();
const mockGetCardWithTimelineByProjectCode = jest.fn();
const mockGetCardComments = jest.fn();
const mockGetCardMembers = jest.fn();
const mockGetCardAttachments = jest.fn();
const mockGetProjectStaff = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual("@datum/core");
  return {
    ...actual,
    createComment:                     (...a: unknown[]) => mockCreateComment(...a),
    editComment:                       (...a: unknown[]) => mockEditComment(...a),
    deleteComment:                     (...a: unknown[]) => mockDeleteComment(...a),
    createCardEvent:                   (...a: unknown[]) => mockCreateCardEvent(...a),
    resolveCardEvent:                  (...a: unknown[]) => mockResolveCardEvent(...a),
    addCardMember:                     (...a: unknown[]) => mockAddCardMember(...a),
    removeCardMember:                  (...a: unknown[]) => mockRemoveCardMember(...a),
    getCardWithTimelineByProjectCode:  (...a: unknown[]) => mockGetCardWithTimelineByProjectCode(...a),
    getCardComments:                   (...a: unknown[]) => mockGetCardComments(...a),
    getCardMembers:                    (...a: unknown[]) => mockGetCardMembers(...a),
    getCardAttachments:                (...a: unknown[]) => mockGetCardAttachments(...a),
    getProjectStaff:                   (...a: unknown[]) => mockGetProjectStaff(...a),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CARD_ID   = "card-uuid-1";
const PROJECT_ID = "project-uuid-1";
const CODE      = "P1";
const SLUG      = "test-card";
const STAFF_ID  = "staff-uuid-self";

import type { CardDetail, CardMemberWithStaff } from "@datum/core";
import type { CardComment } from "@datum/db";
import { keys } from "@datum/core";

const BASE_CARD: CardDetail["card"] = {
  id: CARD_ID,
  project_id: PROJECT_ID,
  topic_id: "topic-uuid",
  title: "Pasang keramik lantai",
  slug: SLUG,
  status: "active",
  current_summary: null,
  properties: null,
  created_by_staff_id: null,
  created_at: "2026-01-01T08:00:00Z",
  updated_at: "2026-01-01T08:00:00Z",
  last_event_at: null,
} as CardDetail["card"];

const DECISION_EVENT = {
  id: "event-decision-1",
  card_id: CARD_ID,
  project_id: PROJECT_ID,
  event_kind: "decision" as const,
  payload: { topic: "Marmer lantai", status: "needs_decision" },
  occurred_at: "2026-01-15T09:00:00Z",
  logged_by_staff_id: STAFF_ID,
  cost_visible: false,
  draft_id: null,
  created_at: "2026-01-15T09:00:00Z",
  search_text: null,
  source_id: null,
  source_kind: "manual" as const,
} as unknown as CardDetail["events"][0];

const FIXTURE_DETAIL: CardDetail = {
  card: BASE_CARD,
  events: [DECISION_EVENT],
};

const FIXTURE_COMMENT: CardComment = {
  id: "comment-1",
  card_id: CARD_ID,
  project_id: PROJECT_ID,
  body: "Pastikan nat sudah kering.",
  created_by_staff_id: STAFF_ID,
  created_at: "2026-01-12T08:00:00Z",
  deleted_at: null,
  edited_at: null,
  mentions: [],
} as CardComment;

const FIXTURE_MEMBER: CardMemberWithStaff = {
  card_id: CARD_ID,
  staff_id: "staff-uuid-other",
  role: "watcher" as const,
  added_at: "2026-01-01T08:00:00Z",
  added_by_staff_id: null,
  removed_at: null,
  staff: { id: "staff-uuid-other", full_name: "Budi Santoso", role: "pic" },
} as unknown as CardMemberWithStaff;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeClient(seed?: () => void): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seed?.();
  return qc;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Import after mocks
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CommentInput, DeletableCommentItem } = require("./CommentInput");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MobileAddEventForm } = require("./AddEventForm");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ResolveButton } = require("./ResolveButton");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RemovableMemberRow } = require("./MemberPicker");

// ─── CommentInput tests ───────────────────────────────────────────────────────

describe("CommentInput — add comment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateComment.mockResolvedValue({ ok: true, commentId: "new-c-1", mentions: [] });
  });

  it("calls createComment with the typed body and invalidates card-comments on success", async () => {
    const qc = makeClient();
    const invalidateSpy = jest.spyOn(qc, "invalidateQueries");

    const { getByLabelText } = render(
      <CommentInput cardId={CARD_ID} projectId={PROJECT_ID} loggedByStaffId={STAFF_ID} />,
      { wrapper: wrapper(qc) },
    );

    const input = getByLabelText("Isi komentar");
    fireEvent.changeText(input, "Komentar test baru");

    const sendBtn = getByLabelText("Kirim komentar");
    fireEvent.press(sendBtn);

    await waitFor(() => expect(mockCreateComment).toHaveBeenCalledTimes(1));

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.anything(), // supabase client
      expect.objectContaining({
        cardId:           CARD_ID,
        projectId:        PROJECT_ID,
        body:             "Komentar test baru",
        createdByStaffId: STAFF_ID,
      }),
    );

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["card-comments", CARD_ID] }),
      ),
    );
  });

  it("shows an error message when createComment fails", async () => {
    mockCreateComment.mockResolvedValue({ ok: false, error: "RLS error" });
    const qc = makeClient();

    const { getByLabelText, findByText } = render(
      <CommentInput cardId={CARD_ID} projectId={PROJECT_ID} loggedByStaffId={STAFF_ID} />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.changeText(getByLabelText("Isi komentar"), "Test gagal");
    fireEvent.press(getByLabelText("Kirim komentar"));

    await findByText("RLS error");
  });
});

// ─── DeletableCommentItem — delete own comment ────────────────────────────────

describe("DeletableCommentItem — delete comment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteComment.mockResolvedValue({ ok: true });
  });

  it("renders delete button only for own comment", () => {
    const qc = makeClient();
    const { getByLabelText, queryByLabelText } = render(
      <DeletableCommentItem
        comment={FIXTURE_COMMENT}
        cardId={CARD_ID}
        ownStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(qc) },
    );
    expect(getByLabelText("Hapus komentar")).toBeTruthy();
    // Does NOT render a delete button for other people's comments
    const qc2 = makeClient();
    const { queryByLabelText: q2 } = render(
      <DeletableCommentItem
        comment={{ ...FIXTURE_COMMENT, created_by_staff_id: "other-staff" }}
        cardId={CARD_ID}
        ownStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(qc2) },
    );
    expect(q2("Hapus komentar")).toBeNull();
  });

  it("calls deleteComment and invalidates card-comments", async () => {
    const qc = makeClient();
    const invalidateSpy = jest.spyOn(qc, "invalidateQueries");

    // Mock Alert.alert to auto-confirm
    const Alert = require("react-native").Alert;
    jest.spyOn(Alert, "alert").mockImplementation((...args: unknown[]) => {
      // Press the destructive button (last one)
      const buttons = args[2] as { onPress?: () => void }[];
      buttons[buttons.length - 1]?.onPress?.();
    });

    const { getByLabelText } = render(
      <DeletableCommentItem
        comment={FIXTURE_COMMENT}
        cardId={CARD_ID}
        ownStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.press(getByLabelText("Hapus komentar"));

    await waitFor(() => expect(mockDeleteComment).toHaveBeenCalledTimes(1));
    expect(mockDeleteComment).toHaveBeenCalledWith(
      expect.anything(), // supabase
      FIXTURE_COMMENT.id,
    );

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["card-comments", CARD_ID] }),
      ),
    );
  });
});

// ─── MobileAddEventForm — add event ──────────────────────────────────────────

describe("MobileAddEventForm — add event", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateCardEvent.mockResolvedValue({ ok: true, eventId: "new-ev-1" });
  });

  it("calls createCardEvent with the built input and invalidates card on success", async () => {
    const qc = makeClient();
    const invalidateSpy = jest.spyOn(qc, "invalidateQueries");

    const { getByLabelText, getByText } = render(
      <MobileAddEventForm
        cardId={CARD_ID}
        projectId={PROJECT_ID}
        code={CODE}
        slug={SLUG}
        loggedByStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(qc) },
    );

    // Expand the form
    fireEvent.press(getByLabelText("Catat aktivitas baru"));

    // Default kind is "note" — fill in body
    const bodyInput = getByLabelText("Catatan");
    fireEvent.changeText(bodyInput, "Progres cat dinding");

    // Submit
    fireEvent.press(getByLabelText("Simpan aktivitas"));

    await waitFor(() => expect(mockCreateCardEvent).toHaveBeenCalledTimes(1));

    const callArg = mockCreateCardEvent.mock.calls[0]![1];
    expect(callArg).toMatchObject({
      cardId:          CARD_ID,
      projectId:       PROJECT_ID,
      eventKind:       "note",
      loggedByStaffId: STAFF_ID,
    });
    // payload.body should be built from the "body" field via collectPayloadFromEntries
    expect(callArg.payload).toMatchObject({ body: "Progres cat dinding" });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: keys.card(CODE, SLUG) }),
      ),
    );
  });

  it("shows an error message when createCardEvent fails", async () => {
    mockCreateCardEvent.mockResolvedValue({ ok: false, error: "Payload tidak valid" });
    const qc = makeClient();

    const { getByLabelText, findByText } = render(
      <MobileAddEventForm
        cardId={CARD_ID}
        projectId={PROJECT_ID}
        code={CODE}
        slug={SLUG}
        loggedByStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.press(getByLabelText("Catat aktivitas baru"));
    fireEvent.changeText(getByLabelText("Catatan"), "Test");
    fireEvent.press(getByLabelText("Simpan aktivitas"));

    await findByText("Payload tidak valid");
  });
});

// ─── ResolveButton — resolve event ───────────────────────────────────────────

describe("ResolveButton — resolve event", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCardEvent.mockResolvedValue({ ok: true });
  });

  it("calls resolveCardEvent with the chosen status and invalidates card", async () => {
    const qc = makeClient();
    const invalidateSpy = jest.spyOn(qc, "invalidateQueries");

    const { getByLabelText } = render(
      <ResolveButton event={DECISION_EVENT} code={CODE} slug={SLUG} />,
      { wrapper: wrapper(qc) },
    );

    // Expand resolve picker
    fireEvent.press(getByLabelText("Tutup isu ini"));

    // Pick "Diputuskan"
    fireEvent.press(getByLabelText("Tandai sebagai Diputuskan"));

    await waitFor(() => expect(mockResolveCardEvent).toHaveBeenCalledTimes(1));

    expect(mockResolveCardEvent).toHaveBeenCalledWith(
      expect.anything(), // supabase
      expect.objectContaining({
        eventId:   DECISION_EVENT.id,
        newStatus: "decided",
      }),
    );

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: keys.card(CODE, SLUG) }),
      ),
    );
  });

  it("does not render for a non-open-loop event", () => {
    const closedEvent = {
      ...DECISION_EVENT,
      payload: { topic: "Already decided", status: "decided", approved_by: "client" },
    } as unknown as CardDetail["events"][0];

    const qc = makeClient();
    const { queryByLabelText } = render(
      <ResolveButton event={closedEvent} code={CODE} slug={SLUG} />,
      { wrapper: wrapper(qc) },
    );

    expect(queryByLabelText("Tutup isu ini")).toBeNull();
  });
});

// ─── RemovableMemberRow — remove member ──────────────────────────────────────

describe("RemovableMemberRow — remove member", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemoveCardMember.mockResolvedValue({ ok: true });
  });

  it("calls removeCardMember and invalidates card-members", async () => {
    const qc = makeClient();
    const invalidateSpy = jest.spyOn(qc, "invalidateQueries");

    const { getByLabelText } = render(
      <RemovableMemberRow
        member={FIXTURE_MEMBER}
        cardId={CARD_ID}
        canRemove
      />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.press(getByLabelText("Hapus Budi Santoso dari anggota"));

    await waitFor(() => expect(mockRemoveCardMember).toHaveBeenCalledTimes(1));

    expect(mockRemoveCardMember).toHaveBeenCalledWith(
      expect.anything(), // supabase
      expect.objectContaining({
        cardId:  CARD_ID,
        staffId: FIXTURE_MEMBER.staff_id,
        role:    FIXTURE_MEMBER.role,
      }),
    );

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["card-members", CARD_ID] }),
      ),
    );
  });

  it("does not show remove button when canRemove is false", () => {
    const qc = makeClient();
    const { queryByLabelText } = render(
      <RemovableMemberRow
        member={FIXTURE_MEMBER}
        cardId={CARD_ID}
        canRemove={false}
      />,
      { wrapper: wrapper(qc) },
    );
    expect(queryByLabelText("Hapus Budi Santoso dari anggota")).toBeNull();
  });
});
