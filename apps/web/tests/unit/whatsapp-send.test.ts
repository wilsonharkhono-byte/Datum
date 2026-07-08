/**
 * whatsapp-send.test.ts
 *
 * Unit tests for normalizeWhatsAppNumber + sendWhatsAppTemplate
 * (apps/web/lib/notifications/whatsapp-send.ts).
 *
 * Mocking strategy (mirrors push-send.test.ts):
 *   - server-only    → aliased to empty stub via vitest.config.ts
 *   - global fetch   → vi.stubGlobal("fetch", ...)
 *   - admin client   → a hand-built fake passed directly into sendWhatsAppTemplate
 *     (the module takes `admin` as a parameter, unlike sendExpoPush which
 *     constructs its own — so no module mock is needed for the client).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeWhatsAppNumber,
  sendWhatsAppTemplate,
  WHATSAPP_TEMPLATES,
} from "@/lib/notifications/whatsapp-send";

// ─── normalizeWhatsAppNumber ──────────────────────────────────────────────────

describe("normalizeWhatsAppNumber", () => {
  it("converts a leading 08 to 628", () => {
    expect(normalizeWhatsAppNumber("081234567890")).toBe("6281234567890");
  });

  it("strips a leading + from a 62-prefixed number", () => {
    expect(normalizeWhatsAppNumber("+6281234567890")).toBe("6281234567890");
  });

  it("keeps a bare 62-prefixed number as-is", () => {
    expect(normalizeWhatsAppNumber("6281234567890")).toBe("6281234567890");
  });

  it("strips spaces, dashes, and parens before normalizing", () => {
    expect(normalizeWhatsAppNumber("0812-3456 (7890)")).toBe("6281234567890");
    expect(normalizeWhatsAppNumber("+62 812-3456-7890")).toBe("6281234567890");
  });

  it("returns null for an unrecognized country prefix", () => {
    expect(normalizeWhatsAppNumber("+15551234567")).toBeNull();
  });

  it("returns null for garbage / non-numeric input", () => {
    expect(normalizeWhatsAppNumber("not-a-number")).toBeNull();
    expect(normalizeWhatsAppNumber("")).toBeNull();
  });

  it("returns null for input that is too short", () => {
    expect(normalizeWhatsAppNumber("081234")).toBeNull();
  });
});

// ─── sendWhatsAppTemplate ─────────────────────────────────────────────────────

/** Build a minimal fake admin client with a chainable .from() the test controls. */
function makeFakeAdmin(opts: {
  staffRows?: Array<{ id: string; whatsapp_number: string | null }>;
  staffError?: { message: string } | null;
  dedupeRows?: Array<{ id: string }>;
  dedupeError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const {
    staffRows = [],
    staffError = null,
    dedupeRows = [],
    dedupeError = null,
    insertError = null,
  } = opts;

  const insertSpy = vi.fn().mockResolvedValue({ error: insertError });

  const from = vi.fn((table: string) => {
    if (table === "staff") {
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: staffRows, error: staffError }),
      };
    }
    if (table === "whatsapp_messages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: dedupeRows, error: dedupeError }),
        insert: insertSpy,
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, insertSpy };
}

const OPTS = { template: WHATSAPP_TEMPLATES.readinessReminder, bodyParams: ["Test reminder message"] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendWhatsAppTemplate", () => {
  it("no-ops when WHATSAPP_ACCESS_TOKEN is missing", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffRows: [{ id: "s1", whatsapp_number: "081234567890" }] });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("no-ops when WHATSAPP_PHONE_NUMBER_ID is missing", async () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffRows: [{ id: "s1", whatsapp_number: "081234567890" }] });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("skips recipients with a null whatsapp_number", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffRows: [{ id: "s1", whatsapp_number: null }] });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips recipients with an empty whatsapp_number", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffRows: [{ id: "s1", whatsapp_number: "" }] });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips recipients with an unnormalizable whatsapp_number", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffRows: [{ id: "s1", whatsapp_number: "garbage" }] });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips the send when a same-day dedupe row already exists", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({
      staffRows: [{ id: "s1", whatsapp_number: "081234567890" }],
      dedupeRows: [{ id: "existing-msg" }],
    });

    await sendWhatsAppTemplate({ from } as never, ["s1"], { ...OPTS, dedupeKey: "dedupe-abc" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends when dedupeKey is omitted (no dedupe check performed)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffRows: [{ id: "s1", whatsapp_number: "081234567890" }] });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("POSTs the correct Meta Cloud API payload and inserts a sent row with wamid", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.XYZ" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { from, insertSpy } = makeFakeAdmin({
      staffRows: [{ id: "s1", whatsapp_number: "081234567890" }],
    });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v23.0/test-phone-id/messages");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "6281234567890",
      type: "template",
      template: {
        name: WHATSAPP_TEMPLATES.readinessReminder,
        language: { code: "id" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Test reminder message" }] },
        ],
      },
    });

    expect(insertSpy).toHaveBeenCalledOnce();
    const insertedRow = insertSpy.mock.calls[0][0];
    expect(insertedRow).toMatchObject({
      recipient_kind: "staff",
      staff_id: "s1",
      phone: "6281234567890",
      template_name: WHATSAPP_TEMPLATES.readinessReminder,
      status: "sent",
      wamid: "wamid.XYZ",
    });
  });

  it("inserts a failed row with the error text when the Meta API responds with an error status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid parameter" } }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { from, insertSpy } = makeFakeAdmin({
      staffRows: [{ id: "s1", whatsapp_number: "081234567890" }],
    });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(insertSpy).toHaveBeenCalledOnce();
    const insertedRow = insertSpy.mock.calls[0][0];
    expect(insertedRow).toMatchObject({
      recipient_kind: "staff",
      staff_id: "s1",
      phone: "6281234567890",
      template_name: WHATSAPP_TEMPLATES.readinessReminder,
      status: "failed",
    });
    expect(insertedRow.error).toContain("Invalid parameter");
  });

  it("inserts a failed row with the error text when fetch rejects (network error)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);
    const { from, insertSpy } = makeFakeAdmin({
      staffRows: [{ id: "s1", whatsapp_number: "081234567890" }],
    });

    await sendWhatsAppTemplate({ from } as never, ["s1"], OPTS);

    expect(insertSpy).toHaveBeenCalledOnce();
    const insertedRow = insertSpy.mock.calls[0][0];
    expect(insertedRow.status).toBe("failed");
    expect(insertedRow.error).toContain("network down");
  });

  it("never throws — swallows and logs staff query errors", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffError: { message: "permission denied" } });

    await expect(sendWhatsAppTemplate({ from } as never, ["s1"], OPTS)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws — swallows unexpected errors end-to-end", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({ staffRows: [{ id: "s1", whatsapp_number: "081234567890" }] });

    await expect(sendWhatsAppTemplate({ from } as never, ["s1"], OPTS)).resolves.toBeUndefined();
  });

  it("no-ops immediately when staffIds is empty", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { from } = makeFakeAdmin({});

    await sendWhatsAppTemplate({ from } as never, [], OPTS);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
