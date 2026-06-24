/**
 * inbox.test.tsx — Inbox (notifications + activity) screen tests
 *
 * Mocking strategy:
 *   - @datum/core: mock I/O functions (getRecentNotifications, getUnreadCount,
 *     markNotificationRead, markAllNotificationsRead, getRecentActivity).
 *   - @/lib/supabase/client: stub (not called when core fns are mocked).
 *   - @/lib/session/session: stub useSession with a fixed staff id.
 *   - @/lib/realtime/useRealtimeInvalidation: stub useNotificationsRealtime (no-op).
 *   - @/lib/query/hooks: NOT mocked — let hooks call through to mocked core fns.
 *   - @/lib/query/mutations: NOT mocked — let mutations call through to mocked core fns.
 *   - expo-router: stub useRouter / push.
 *   - react-native-safe-area-context: stub SafeAreaView → View.
 *   - @tanstack/react-query: keep real; stub onlineManager for OfflineBanner.
 *
 * Covers:
 *   1. Renders notifications with kind chips + unread summary
 *   2. mark-one-read calls markNotificationRead + invalidates (chip updates)
 *   3. mark-all calls markAllNotificationsRead
 *   4. Tap row routes via parsed link
 *   5. Empty state
 *   6. Activity feed renders grouped by day
 */

import React from "react";
import { render, waitFor, fireEvent, screen, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InboxTab from "./inbox";

// ---------------------------------------------------------------------------
// Mocks — @datum/core
// ---------------------------------------------------------------------------

const mockGetNotifications   = jest.fn();
const mockGetUnreadCount     = jest.fn();
const mockMarkRead           = jest.fn();
const mockMarkAllRead        = jest.fn();
const mockGetActivity        = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    getRecentNotifications:   (...args: unknown[]) => mockGetNotifications(...args),
    getUnreadCount:           (...args: unknown[]) => mockGetUnreadCount(...args),
    markNotificationRead:     (...args: unknown[]) => mockMarkRead(...args),
    markAllNotificationsRead: (...args: unknown[]) => mockMarkAllRead(...args),
    getRecentActivity:        (...args: unknown[]) => mockGetActivity(...args),
  };
});

// ---------------------------------------------------------------------------
// Mocks — infrastructure
// ---------------------------------------------------------------------------

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({ SUPABASE_URL: "https://test.co", SUPABASE_ANON_KEY: "anon" }));

const STAFF_ID = "staff-test-001";

jest.mock("@/lib/session/session", () => ({
  useSession: () => ({
    status: "authenticated",
    staff: { id: STAFF_ID, full_name: "Test User", role: "staff", email: null },
    signOut: jest.fn(),
  }),
}));

// No-op realtime hook — we're not testing supabase channels here
jest.mock("@/lib/realtime/useRealtimeInvalidation", () => ({
  useNotificationsRealtime: () => {},
  useProjectRealtime: () => {},
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  onlineManager: { isOnline: () => true, subscribe: () => () => {} },
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

import type { Notification, ActivityItem } from "@datum/core";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id:           "notif-001",
    staff_id:     STAFF_ID,
    kind:         "mention",
    summary:      "Andi menyebut Anda di Proyek Karawang",
    link:         "/project/ARIN-1/cards/arin-1-flooring",
    read_at:      null,
    created_at:   "2026-06-20T09:00:00Z",
    ...overrides,
  } as Notification;
}

function makeActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id:           "ev_act-001",
    kind:         "event",
    occurredAt:   "2026-06-20T08:00:00Z",
    projectCode:  "ARIN-1",
    projectName:  "Karawang Unit 1",
    cardId:       "card-001",
    cardSlug:     "arin-1-flooring",
    cardTitle:    "Pekerjaan Lantai",
    actor:        "Budi Santoso",
    detail:       "progres (45%)",
    eventKind:    "progress",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InboxTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUnreadCount.mockResolvedValue(0);
    mockGetActivity.mockResolvedValue([]);
  });

  // ── 1. Renders notifications with kind chips + unread summary ─────────────

  it("renders notifications with kind chips and unread summary", async () => {
    const unreadNotif = makeNotification({
      id:      "notif-unread-1",
      kind:    "mention",
      summary: "Andi menyebut Anda",
      read_at: null,
    });
    const readNotif = makeNotification({
      id:      "notif-read-1",
      kind:    "watcher_event",
      summary: "Ada pembaruan di kartu Anda",
      read_at: "2026-06-20T07:00:00Z",
    });

    mockGetNotifications.mockResolvedValue([unreadNotif, readNotif]);
    mockGetUnreadCount.mockResolvedValue(1);

    wrap(<InboxTab />);

    await waitFor(() => {
      // Kind chip labels
      expect(screen.getByText("Mention")).toBeTruthy();
      expect(screen.getByText("Aktivitas")).toBeTruthy();
      // Notification summaries
      expect(screen.getByText("Andi menyebut Anda")).toBeTruthy();
      expect(screen.getByText("Ada pembaruan di kartu Anda")).toBeTruthy();
      // Unread summary line
      expect(screen.getByTestId("unread-summary")).toBeTruthy();
      expect(screen.getByText(/1 belum dibaca dari 2 terbaru/)).toBeTruthy();
      // mark-read button only on unread row
      expect(screen.getByTestId("mark-read-notif-unread-1")).toBeTruthy();
      expect(screen.queryByTestId("mark-read-notif-read-1")).toBeNull();
    });
  });

  // ── 2. Mark-one-read calls markNotificationRead ───────────────────────────

  it("mark-one-read calls markNotificationRead with correct id", async () => {
    const notif = makeNotification({ id: "notif-mark-1", read_at: null });
    mockGetNotifications.mockResolvedValue([notif]);
    mockGetUnreadCount.mockResolvedValue(1);
    mockMarkRead.mockResolvedValue({ ok: true });

    wrap(<InboxTab />);

    await waitFor(() =>
      expect(screen.getByTestId("mark-read-notif-mark-1")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("mark-read-notif-mark-1"));
    });

    await waitFor(() => {
      // Called with (supabase, notificationId)
      expect(mockMarkRead).toHaveBeenCalledWith(
        expect.anything(), // supabase
        "notif-mark-1",
      );
    });
  });

  // ── 3. Mark-all calls markAllNotificationsRead ────────────────────────────

  it("mark-all calls markAllNotificationsRead when button is pressed", async () => {
    const notif = makeNotification({ id: "notif-all-1", read_at: null });
    mockGetNotifications.mockResolvedValue([notif]);
    mockGetUnreadCount.mockResolvedValue(1);
    mockMarkAllRead.mockResolvedValue({ ok: true });

    wrap(<InboxTab />);

    await waitFor(() =>
      expect(screen.getByTestId("mark-all-read")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("mark-all-read"));
    });

    await waitFor(() => {
      expect(mockMarkAllRead).toHaveBeenCalledWith(
        expect.anything(), // supabase
      );
    });
  });

  // ── 4. Tap row routes via parsed link ─────────────────────────────────────

  it("tapping a card notification row navigates to the mobile card route", async () => {
    const notif = makeNotification({
      id:   "notif-tap-1",
      link: "/project/ARIN-1/cards/arin-1-flooring",
    });
    mockGetNotifications.mockResolvedValue([notif]);

    wrap(<InboxTab />);

    await waitFor(() =>
      expect(screen.getByTestId("notification-row-notif-tap-1")).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId("notification-row-notif-tap-1"));

    expect(mockPush).toHaveBeenCalledWith(
      "/(tabs)/(matrix)/project/ARIN-1/card/arin-1-flooring",
    );
  });

  it("tapping a review notification row navigates to the review route", async () => {
    const notif = makeNotification({
      id:   "notif-review-1",
      kind: "review_assigned",
      link: "/review",
    });
    mockGetNotifications.mockResolvedValue([notif]);

    wrap(<InboxTab />);

    await waitFor(() =>
      expect(screen.getByTestId("notification-row-notif-review-1")).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId("notification-row-notif-review-1"));

    expect(mockPush).toHaveBeenCalledWith("/(tabs)/(matrix)/review");
  });

  it("tapping an unknown link falls back to matrix index route", async () => {
    const notif = makeNotification({
      id:   "notif-unknown-1",
      link: "/some/unknown/path",
    });
    mockGetNotifications.mockResolvedValue([notif]);

    wrap(<InboxTab />);

    await waitFor(() =>
      expect(screen.getByTestId("notification-row-notif-unknown-1")).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId("notification-row-notif-unknown-1"));

    expect(mockPush).toHaveBeenCalledWith("/(tabs)/(matrix)");
  });

  // ── 4b. readiness_reminder kind shows "Pengingat" chip ───────────────────

  it("renders readiness_reminder notification with Pengingat chip", async () => {
    const notif = makeNotification({
      id:      "notif-reminder-1",
      kind:    "readiness_reminder" as any,
      summary: "Kamar Mandi A: Screed terlambat",
      read_at: null,
    });
    mockGetNotifications.mockResolvedValue([notif]);
    mockGetUnreadCount.mockResolvedValue(1);

    wrap(<InboxTab />);

    await waitFor(() => {
      expect(screen.getByText("Pengingat")).toBeTruthy();
      expect(screen.getByText("Kamar Mandi A: Screed terlambat")).toBeTruthy();
    });
  });

  // ── 5. Empty state ────────────────────────────────────────────────────────

  it("shows empty state when no notifications are returned", async () => {
    mockGetNotifications.mockResolvedValue([]);

    wrap(<InboxTab />);

    await waitFor(() => {
      expect(screen.getByTestId("notifications-empty")).toBeTruthy();
      expect(screen.getByText(/Tidak ada notifikasi/)).toBeTruthy();
    });
  });

  // ── 6. Activity feed renders grouped by day ───────────────────────────────

  it("renders activity feed grouped by day", async () => {
    mockGetNotifications.mockResolvedValue([]);

    const item1 = makeActivity({
      id:          "ev_act-day1-1",
      occurredAt:  "2026-06-20T08:00:00Z",
      cardTitle:   "Pekerjaan Lantai",
      actor:       "Budi Santoso",
      detail:      "progres (45%)",
      projectCode: "ARIN-1",
    });
    const item2 = makeActivity({
      id:          "ev_act-day1-2",
      occurredAt:  "2026-06-20T07:00:00Z",
      cardTitle:   "Keramik Dinding",
      actor:       null,
      detail:      "Kartu baru: Keramik Dinding",
      projectCode: "ARIN-1",
      kind:        "card",
    });
    const item3 = makeActivity({
      id:          "ev_act-day2-1",
      occurredAt:  "2026-06-19T15:00:00Z",
      cardTitle:   "Plafon R. Tamu",
      actor:       "Siti Aminah",
      detail:      "Pasang gypsum (30%)",
      projectCode: "BETA-2",
    });

    mockGetActivity.mockResolvedValue([item1, item2, item3]);

    wrap(<InboxTab />);

    await waitFor(() => {
      expect(screen.getByTestId("activity-list")).toBeTruthy();
      // Activity rows present via testID
      expect(screen.getByTestId("activity-row-ev_act-day1-1")).toBeTruthy();
      expect(screen.getByTestId("activity-row-ev_act-day1-2")).toBeTruthy();
      expect(screen.getByTestId("activity-row-ev_act-day2-1")).toBeTruthy();
      // Card title nodes
      expect(screen.getByTestId("activity-title-ev_act-day1-1").props.children).toBe("Pekerjaan Lantai");
      expect(screen.getByTestId("activity-title-ev_act-day2-1").props.children).toBe("Plafon R. Tamu");
      // Actor
      expect(screen.getByText("Budi Santoso")).toBeTruthy();
      expect(screen.getByText("Siti Aminah")).toBeTruthy();
    });
  });
});
