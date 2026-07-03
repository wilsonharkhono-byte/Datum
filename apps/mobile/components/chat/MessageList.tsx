/**
 * MessageList.tsx — scrollable chat history for the mobile assistant.
 *
 * Message union mirrors the web ChatDock shape:
 *   user        — outgoing text bubble
 *   assistant   — streaming / complete answer with citations
 *   proposal    — Catat proposal (rendered by ProposalCard)
 */

import { useRef, useEffect } from "react";
import { FlatList, View, ActivityIndicator } from "react-native";
import { stripCitationTokens, stripActionTail } from "@datum/core";
import type { Citation } from "@datum/core";
import type { Proposal } from "@datum/core";
import { Text } from "@/components/ui/Text";
import { CitationList } from "./Citation";
import { ProposalCard } from "./ProposalCard";

// ─── Message type ─────────────────────────────────────────────────────────────

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      streaming: boolean;
      error?: string;
      queued?: boolean;
      citations: Citation[];
    }
  | { id: string; role: "proposal"; proposal: Proposal };

// ─── PendingDots ──────────────────────────────────────────────────────────────

function PendingDots() {
  return (
    <View className="flex-row items-center gap-1 py-1">
      <ActivityIndicator size="small" color="#9C8B75" />
      <Text className="text-[13px] text-text-muted">Mengetik…</Text>
    </View>
  );
}

// ─── UserBubble ───────────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <View className="mb-2 items-end">
      <View className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2">
        <Text className="text-[14px] leading-5 text-[#FDFAF6]">{text}</Text>
      </View>
    </View>
  );
}

// ─── AssistantBubble ─────────────────────────────────────────────────────────

function AssistantBubble({
  msg,
}: {
  msg: Extract<ChatMessage, { role: "assistant" }>;
}) {
  // Web's ChatDock finalizes the stored bubble with the action tail already
  // stripped once a stream completes (see ChatDock.tsx), but mobile renders
  // the raw accumulated stream text directly and has no action-chip UI yet
  // (Phase 3 Task 3 docstring on stripActionTail) — strip both defensively
  // here so a raw <action>...</action> tag never leaks into the bubble.
  const visibleText = stripActionTail(stripCitationTokens(msg.content));

  if (msg.queued) {
    return (
      <View className="mb-2 max-w-[85%] rounded-2xl rounded-tl-sm border border-border/30 bg-surface px-3 py-2">
        <Text className="text-[13px] italic text-text-muted">
          Antrian — akan dikirim saat online
        </Text>
      </View>
    );
  }

  if (msg.error) {
    return (
      <View className="mb-2 max-w-[85%] rounded-2xl rounded-tl-sm border border-border/30 bg-critical-bg px-3 py-2">
        <Text className="text-[13px] text-critical">{msg.error}</Text>
      </View>
    );
  }

  return (
    <View className="mb-2 max-w-[85%]">
      <View className="rounded-2xl rounded-tl-sm border border-border/30 bg-surface px-3 py-2">
        {msg.streaming && visibleText === "" ? (
          <PendingDots />
        ) : (
          <>
            <Text className="text-[14px] leading-5 text-text">{visibleText}</Text>
            {msg.streaming && (
              <Text className="text-[14px] leading-5 text-text-muted">▊</Text>
            )}
          </>
        )}
      </View>
      {!msg.streaming && msg.citations.length > 0 && (
        <CitationList citations={msg.citations} />
      )}
    </View>
  );
}

// ─── MessageList ──────────────────────────────────────────────────────────────

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const listRef = useRef<FlatList>(null);

  // Auto-scroll to bottom when a new message arrives or content updates.
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text variant="heading" className="mb-2 text-center">
          Tanya Tanya atau Catat
        </Text>
        <Text variant="muted" className="text-center leading-5">
          Tanya pertanyaan tentang proyek, atau alihkan ke Catat untuk
          merekam catatan lapangan dengan AI.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ padding: 12 }}
      renderItem={({ item: msg }) => {
        if (msg.role === "user") return <UserBubble text={msg.text} />;
        if (msg.role === "assistant") return <AssistantBubble msg={msg} />;
        if (msg.role === "proposal")
          return (
            <View className="mb-2">
              <ProposalCard proposal={msg.proposal} />
            </View>
          );
        return null;
      }}
      onContentSizeChange={() =>
        listRef.current?.scrollToEnd({ animated: false })
      }
    />
  );
}
