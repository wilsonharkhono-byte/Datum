/**
 * Tests for MobileAddEventForm's attachment-upload failure/retry path (audit V-2).
 *
 * The card event is created BEFORE the attachment uploads. If the upload fails,
 * the old code silently closed the form and dropped the photo. The fix keeps the
 * form open in a dedicated "upload failed" state:
 *   - upload error   → warning + "Coba unggah lagi" (retry) + "Tutup"
 *   - skip (oversize/unsupported) → reason + "Tutup" only (no retry)
 *   - retry re-invokes ONLY uploadCardAttachment against the SAME eventId; it must
 *     NOT re-run createCardEvent (which would double-create the event).
 *
 * Strategy: mock @datum/core (createCardEvent) + @/lib/attachments/pick-and-upload
 * (pickImageAsset + uploadCardAttachment), then drive pick → submit → retry.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

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
jest.mock("@/lib/session/session", () => ({
  useSession: jest.fn(() => ({
    status: "authenticated",
    staff: { id: "staff-uuid-self", full_name: "Wilson", role: "principal", email: null },
    signOut: jest.fn(),
  })),
}));

const mockCreateCardEvent = jest.fn();
jest.mock("@datum/core", () => {
  const actual = jest.requireActual("@datum/core");
  return {
    ...actual,
    createCardEvent: (...a: unknown[]) => mockCreateCardEvent(...a),
  };
});

const mockPickImageAsset = jest.fn();
const mockUploadCardAttachment = jest.fn();
jest.mock("@/lib/attachments/pick-and-upload", () => ({
  pickImageAsset: (...a: unknown[]) => mockPickImageAsset(...a),
  uploadCardAttachment: (...a: unknown[]) => mockUploadCardAttachment(...a),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CARD_ID = "card-uuid-1";
const PROJECT_ID = "project-uuid-1";
const CODE = "P1";
const SLUG = "test-card";
const STAFF_ID = "staff-uuid-self";

const ASSET = {
  uri: "file:///foto.jpg",
  name: "foto.jpg",
  mimeType: "image/jpeg",
  size: 500_000,
};

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

// Import after mocks
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MobileAddEventForm } = require("./AddEventForm");

async function pickAndSubmit(getByLabelText: (l: string) => unknown) {
  fireEvent.press(getByLabelText("Catat aktivitas baru") as never);
  fireEvent.changeText(getByLabelText("Catatan") as never, "Progres cat dinding");
  // Pick a photo
  fireEvent.press(getByLabelText("Lampirkan foto") as never);
  await waitFor(() => expect(mockPickImageAsset).toHaveBeenCalled());
  // Submit
  fireEvent.press(getByLabelText("Simpan aktivitas") as never);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MobileAddEventForm — attachment upload failure/retry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateCardEvent.mockResolvedValue({ ok: true, eventId: "new-ev-1" });
    mockPickImageAsset.mockResolvedValue(ASSET);
  });

  it("keeps the form open with a retry button when the upload errors", async () => {
    mockUploadCardAttachment.mockResolvedValue({ ok: false, error: "Upload gagal: timeout" });

    const { getByLabelText, findByText, findByLabelText } = render(
      <MobileAddEventForm
        cardId={CARD_ID}
        projectId={PROJECT_ID}
        code={CODE}
        slug={SLUG}
        loggedByStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(makeClient()) },
    );

    await pickAndSubmit(getByLabelText);

    await waitFor(() => expect(mockUploadCardAttachment).toHaveBeenCalledTimes(1));
    // Warning + retry affordance visible; form did NOT silently close.
    await findByText("Upload gagal: timeout");
    await findByLabelText("Coba unggah lagi");
  });

  it("retry re-invokes ONLY uploadCardAttachment against the same eventId (no double event)", async () => {
    mockUploadCardAttachment
      .mockResolvedValueOnce({ ok: false, error: "Upload gagal: timeout" })
      .mockResolvedValueOnce({ ok: true });

    const { getByLabelText, findByLabelText, queryByLabelText } = render(
      <MobileAddEventForm
        cardId={CARD_ID}
        projectId={PROJECT_ID}
        code={CODE}
        slug={SLUG}
        loggedByStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(makeClient()) },
    );

    await pickAndSubmit(getByLabelText);
    const retryBtn = await findByLabelText("Coba unggah lagi");

    // The event was created exactly once by the initial submit.
    expect(mockCreateCardEvent).toHaveBeenCalledTimes(1);

    fireEvent.press(retryBtn);

    // Retry uploads again against the SAME eventId…
    await waitFor(() => expect(mockUploadCardAttachment).toHaveBeenCalledTimes(2));
    expect(mockUploadCardAttachment).toHaveBeenLastCalledWith(
      expect.anything(), // supabase
      expect.objectContaining({ cardEventId: "new-ev-1", asset: ASSET }),
    );
    // …and createCardEvent is STILL only called once — no double event.
    expect(mockCreateCardEvent).toHaveBeenCalledTimes(1);

    // On retry success the form closes back to the trigger.
    await waitFor(() => expect(queryByLabelText("Coba unggah lagi")).toBeNull());
    expect(getByLabelText("Catat aktivitas baru")).toBeTruthy();
  });

  it("shows a Tutup-only state (no retry) when the upload is skipped as oversize/unsupported", async () => {
    mockUploadCardAttachment.mockResolvedValue({
      ok: false,
      skipped: true,
      reason: "File terlalu besar (maks. 20 MB). Lampiran tidak disimpan.",
    });

    const { getByLabelText, findByText, queryByLabelText } = render(
      <MobileAddEventForm
        cardId={CARD_ID}
        projectId={PROJECT_ID}
        code={CODE}
        slug={SLUG}
        loggedByStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(makeClient()) },
    );

    await pickAndSubmit(getByLabelText);

    await findByText(/File terlalu besar/);
    // No retry for a skip — retry can't succeed.
    expect(queryByLabelText("Coba unggah lagi")).toBeNull();
    expect(getByLabelText("Tutup tanpa lampiran")).toBeTruthy();
  });

  it("Tutup abandons the attachment and closes the form", async () => {
    mockUploadCardAttachment.mockResolvedValue({ ok: false, error: "Upload gagal: timeout" });

    const { getByLabelText, findByLabelText, queryByLabelText } = render(
      <MobileAddEventForm
        cardId={CARD_ID}
        projectId={PROJECT_ID}
        code={CODE}
        slug={SLUG}
        loggedByStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(makeClient()) },
    );

    await pickAndSubmit(getByLabelText);
    await findByLabelText("Coba unggah lagi");

    fireEvent.press(getByLabelText("Tutup tanpa lampiran"));

    await waitFor(() => expect(queryByLabelText("Coba unggah lagi")).toBeNull());
    expect(getByLabelText("Catat aktivitas baru")).toBeTruthy();
    // No extra upload attempts from abandoning.
    expect(mockUploadCardAttachment).toHaveBeenCalledTimes(1);
  });

  it("closes normally on a successful upload (happy path unchanged)", async () => {
    mockUploadCardAttachment.mockResolvedValue({ ok: true });

    const { getByLabelText, queryByLabelText } = render(
      <MobileAddEventForm
        cardId={CARD_ID}
        projectId={PROJECT_ID}
        code={CODE}
        slug={SLUG}
        loggedByStaffId={STAFF_ID}
      />,
      { wrapper: wrapper(makeClient()) },
    );

    await pickAndSubmit(getByLabelText);

    await waitFor(() => expect(mockUploadCardAttachment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryByLabelText("Coba unggah lagi")).toBeNull());
    expect(getByLabelText("Catat aktivitas baru")).toBeTruthy();
    expect(mockCreateCardEvent).toHaveBeenCalledTimes(1);
  });
});
