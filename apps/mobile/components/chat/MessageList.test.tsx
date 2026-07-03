/**
 * MessageList.test.tsx — Fix 3 (launch-phase03 final wave): mobile renders
 * the raw accumulated stream text directly (no action-chip UI yet), so a
 * confirm-gated action tail (`<action>{json}</action>`, Phase 3 Task 3) must
 * be stripped defensively alongside citation tokens — mirrors the web
 * MessageList's `stripActionTail(stripCitationTokens(...))` composition
 * (apps/web/components/chat/MessageList.tsx).
 *
 * Only exercises `assistant`-role bubbles with no citations, so this stays a
 * focused render test without needing CitationList's router/query providers.
 */
import { render } from "@testing-library/react-native";

// Citation.tsx (pulled in by MessageList for CitationList) eagerly
// instantiates the real Supabase client at module load, which throws
// without env vars in the test environment — same mock this codebase's
// other component tests use (e.g. tests/login.test.tsx).
jest.mock("@/lib/supabase/client", () => ({
  supabase: { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) } },
}));

import { MessageList, type ChatMessage } from "./MessageList";

function assistantMessage(content: string): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content,
    streaming: false,
    citations: [],
  };
}

describe("MessageList — action-tail stripping", () => {
  it("strips a trailing <action> tag from the rendered assistant bubble", () => {
    const { queryByText, getByText } = render(
      <MessageList
        messages={[
          assistantMessage(
            'Sudah saya catat. <action>{"type":"update_step","areaName":"KM-1","stepName":"Keramik","status":"done"}</action>',
          ),
        ]}
      />,
    );
    expect(getByText("Sudah saya catat.")).toBeTruthy();
    expect(queryByText(/<action>/)).toBeNull();
    expect(queryByText(/update_step/)).toBeNull();
  });

  it("strips both a citation token and a trailing action tag together", () => {
    const { queryByText, getByText } = render(
      <MessageList
        messages={[
          assistantMessage(
            "Lihat kartu ini [card:11111111-1111-1111-1111-111111111111] untuk detail. <action>{\"type\":\"remind\",\"message\":\"x\"}</action>",
          ),
        ]}
      />,
    );
    expect(getByText("Lihat kartu ini untuk detail.")).toBeTruthy();
    expect(queryByText(/\[card:/)).toBeNull();
    expect(queryByText(/<action>/)).toBeNull();
  });

  it("renders plain text unchanged when there is no action tail or citation", () => {
    const { getByText } = render(
      <MessageList messages={[assistantMessage("Halo, ada yang bisa dibantu?")]} />,
    );
    expect(getByText("Halo, ada yang bisa dibantu?")).toBeTruthy();
  });
});
