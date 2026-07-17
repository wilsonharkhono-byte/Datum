/**
 * CommentInput — text input + send button for adding a card comment.
 * Allows deletion (and optional edit) of own comments when ownStaffId is provided.
 */

import { useState } from "react";
import { View, TextInput, Pressable, ActivityIndicator, Alert } from "react-native";
import { Text } from "@/components/ui/Text";
import { useAddComment, useDeleteComment, useEditComment } from "@/lib/query/mutations";
import type { CardComment } from "@datum/db";

// ─── Add comment input ────────────────────────────────────────────────────────

interface CommentInputProps {
  cardId: string;
  projectId: string;
  loggedByStaffId: string;
}

export function CommentInput({ cardId, projectId, loggedByStaffId }: CommentInputProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const addComment = useAddComment(cardId);

  async function handleSend() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    addComment.mutate(
      { projectId, body: trimmed, createdByStaffId: loggedByStaffId },
      {
        onSuccess: () => setBody(""),
        onError: (e) => setError(e instanceof Error ? e.message : "Gagal menyimpan komentar"),
      },
    );
  }

  return (
    <View className="mt-2">
      <View className="flex-row items-end gap-2">
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Tambah komentar…"
          multiline
          editable={!addComment.isPending}
          textAlignVertical="top"
          className="flex-1 rounded border border-border/60 bg-surface-alt px-3 py-2 text-[14px] text-text min-h-[44px]"
          accessibilityLabel="Isi komentar"
        />
        <Pressable
          onPress={handleSend}
          disabled={addComment.isPending || !body.trim()}
          className={`min-h-[44px] min-w-[44px] items-center justify-center rounded px-3 ${
            addComment.isPending || !body.trim()
              ? "bg-surface-alt"
              : "bg-primary active:opacity-90"
          }`}
          accessibilityLabel="Kirim komentar"
        >
          {addComment.isPending ? (
            <ActivityIndicator color="#FDFAF6" size="small" />
          ) : (
            <Text className="text-[13px] font-medium text-[#FDFAF6]">Kirim</Text>
          )}
        </Pressable>
      </View>
      {error ? (
        <Text className="mt-1 text-[12px] text-red-700">{error}</Text>
      ) : null}
    </View>
  );
}

// ─── Deletable / editable comment item ───────────────────────────────────────

interface DeletableCommentItemProps {
  comment: CardComment;
  cardId: string;
  /** Id of the current viewer — only own comments show delete/edit. */
  ownStaffId: string | null | undefined;
}

export function DeletableCommentItem({
  comment,
  cardId,
  ownStaffId,
}: DeletableCommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const deleteComment = useDeleteComment(cardId);
  const editComment = useEditComment(cardId);

  const isOwn = ownStaffId && comment.created_by_staff_id === ownStaffId;

  const dateStr = new Date(comment.created_at).toLocaleString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function handleDelete() {
    Alert.alert(
      "Hapus komentar?",
      "Tindakan ini tidak dapat dibatalkan.",
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus",
          style: "destructive",
          onPress: () => deleteComment.mutate(comment.id),
        },
      ],
    );
  }

  function handleSaveEdit() {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    editComment.mutate(
      { commentId: comment.id, body: trimmed },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <View className="mb-2 rounded border border-border/40 bg-surface p-3">
      <View className="mb-1 flex-row items-center justify-between gap-2">
        <Text className="text-[12px] font-semibold text-text-sec">
          {`Staff ${comment.created_by_staff_id?.slice(0, 6) ?? "?"}`}
        </Text>
        <View className="flex-row items-center gap-3">
          <Text className="text-[11px] text-text-muted">{dateStr}</Text>
          {isOwn && !editing ? (
            <>
              <Pressable
                onPress={() => { setEditing(true); setEditBody(comment.body); }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                className="min-h-[32px] min-w-[32px] items-center justify-center"
                accessibilityLabel="Edit komentar"
              >
                <Text className="text-[12px] text-text-sec">Edit</Text>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                disabled={deleteComment.isPending}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                className="min-h-[32px] min-w-[32px] items-center justify-center"
                accessibilityLabel="Hapus komentar"
              >
                {deleteComment.isPending ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text className="text-[12px] text-red-600">Hapus</Text>
                )}
              </Pressable>
            </>
          ) : null}
        </View>
      </View>

      {editing ? (
        <View>
          <TextInput
            value={editBody}
            onChangeText={setEditBody}
            multiline
            editable={!editComment.isPending}
            textAlignVertical="top"
            className="rounded border border-border/60 bg-surface-alt px-3 py-2 text-[14px] text-text min-h-[60px]"
            accessibilityLabel="Edit isi komentar"
          />
          <View className="mt-2 flex-row gap-2">
            <Pressable
              onPress={handleSaveEdit}
              disabled={editComment.isPending}
              className="min-h-[36px] items-center justify-center rounded bg-primary px-4 active:opacity-90"
              accessibilityLabel="Simpan edit komentar"
            >
              {editComment.isPending ? (
                <ActivityIndicator color="#FDFAF6" size="small" />
              ) : (
                <Text className="text-[12px] font-medium text-[#FDFAF6]">Simpan</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              disabled={editComment.isPending}
              className="min-h-[36px] items-center justify-center rounded bg-surface-alt px-4"
              accessibilityLabel="Batal edit"
            >
              <Text className="text-[12px] text-text-sec">Batal</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text className="text-[14px] text-text leading-snug">{comment.body}</Text>
      )}
    </View>
  );
}
