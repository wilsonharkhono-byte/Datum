import { shareToExistingCard, shareToNewCard } from "./add-to-card";

jest.mock("@datum/core", () => ({
  createCard: jest.fn(),
  createCardEvent: jest.fn(),
}));
jest.mock("@/lib/attachments/pick-and-upload", () => ({
  uploadCardAttachment: jest.fn(),
}));

import { createCard, createCardEvent } from "@datum/core";
import { uploadCardAttachment } from "@/lib/attachments/pick-and-upload";

const supabase = {} as never;
const asset = (name: string) => ({
  uri: `file:///${name}`, name, mimeType: "image/jpeg", size: 1000,
});
const base = {
  projectId: "p1", cardId: "c1", cardSlug: "kartu-1",
  loggedByStaffId: "s1", note: "cek pemasangan",
};

beforeEach(() => {
  jest.resetAllMocks();
  (createCardEvent as jest.Mock).mockResolvedValue({ ok: true, eventId: "e1" });
  (uploadCardAttachment as jest.Mock).mockResolvedValue({ ok: true });
});

describe("shareToExistingCard", () => {
  it("creates one photo event with the note as caption, uploads every asset", async () => {
    const res = await shareToExistingCard(supabase, {
      ...base, assets: [asset("a.jpg"), asset("b.jpg")],
    });
    expect(createCardEvent).toHaveBeenCalledWith(supabase, expect.objectContaining({
      cardId: "c1", projectId: "p1", eventKind: "photo",
      payload: { caption: "cek pemasangan" }, loggedByStaffId: "s1",
    }));
    expect(uploadCardAttachment).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      ok: true, cardId: "c1", cardSlug: "kartu-1",
      outcome: { eventId: "e1", uploaded: 2, skipped: [], failed: [] },
    });
  });

  it("sends empty payload when note is blank", async () => {
    await shareToExistingCard(supabase, { ...base, note: "  ", assets: [asset("a.jpg")] });
    expect(createCardEvent).toHaveBeenCalledWith(
      supabase, expect.objectContaining({ payload: {} }),
    );
  });

  it("fails fast when the event cannot be created", async () => {
    (createCardEvent as jest.Mock).mockResolvedValue({ ok: false, error: "RLS" });
    const res = await shareToExistingCard(supabase, { ...base, assets: [asset("a.jpg")] });
    expect(res).toEqual({ ok: false, error: "RLS" });
    expect(uploadCardAttachment).not.toHaveBeenCalled();
  });

  it("partitions per-asset skip and failure without aborting the batch", async () => {
    (uploadCardAttachment as jest.Mock)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, skipped: true, reason: "terlalu besar" })
      .mockResolvedValueOnce({ ok: false, error: "network" });
    const res = await shareToExistingCard(supabase, {
      ...base, assets: [asset("a.jpg"), asset("b.jpg"), asset("c.jpg")],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.outcome.uploaded).toBe(1);
      expect(res.outcome.skipped).toEqual([{ name: "b.jpg", reason: "terlalu besar" }]);
      expect(res.outcome.failed).toEqual([{ name: "c.jpg", error: "network" }]);
    }
  });
});

describe("shareToNewCard", () => {
  it("creates the card then delegates to the existing-card path", async () => {
    (createCard as jest.Mock).mockResolvedValue({ ok: true, id: "c9", slug: "kartu-baru" });
    const res = await shareToNewCard(supabase, {
      projectId: "p1", topicId: "t1", title: "Kartu baru",
      note: "", assets: [asset("a.jpg")], loggedByStaffId: "s1",
    });
    expect(createCard).toHaveBeenCalledWith(supabase, {
      projectId: "p1", topicId: "t1", title: "Kartu baru",
    });
    expect(res).toMatchObject({ ok: true, cardId: "c9", cardSlug: "kartu-baru" });
  });

  it("propagates card-creation failure", async () => {
    (createCard as jest.Mock).mockResolvedValue({ ok: false, error: "judul kosong" });
    const res = await shareToNewCard(supabase, {
      projectId: "p1", topicId: "t1", title: "",
      assets: [asset("a.jpg")], loggedByStaffId: "s1",
    });
    expect(res).toEqual({ ok: false, error: "judul kosong" });
    expect(createCardEvent).not.toHaveBeenCalled();
  });
});
