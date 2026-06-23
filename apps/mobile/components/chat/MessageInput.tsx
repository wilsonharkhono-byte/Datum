/**
 * MessageInput.tsx — text input bar for the mobile assistant.
 *
 * Tanya mode: free text → submit.
 * Catat mode: free text + optional image from the device photo library → submit.
 *
 * expo-image-picker is now a first-class dependency (installed). The attach
 * button is shown unconditionally in Catat mode, using pickImageAsset() from
 * the shared lib/attachments helper.
 *
 * Guard: disabled while sending or when there's neither text nor an attached file.
 */

import { useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Text } from "@/components/ui/Text";
import { pickImageAsset, type PickedAsset } from "@/lib/attachments/pick-and-upload";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AttachedFile = {
  uri: string;
  name: string;
  mime: string;
  size: number;
};

type Props = {
  mode: "tanya" | "catat";
  disabled: boolean;
  sending: boolean;
  onSend: (text: string, file?: AttachedFile) => void;
};

// ─── SendIcon ─────────────────────────────────────────────────────────────────

function SendIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color, fontSize: 16 }}>↑</Text>
    </View>
  );
}

// ─── AttachIcon ───────────────────────────────────────────────────────────────

function AttachIcon() {
  return <Text style={{ fontSize: 18, color: "#9C8B75" }}>📎</Text>;
}

// ─── MessageInput ─────────────────────────────────────────────────────────────

export function MessageInput({ mode, disabled, sending, onSend }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<AttachedFile | undefined>();

  const canSend = !disabled && !sending && (text.trim().length > 0 || !!file);

  async function pickFile() {
    const asset: PickedAsset | null = await pickImageAsset();
    if (!asset) return;

    setFile({
      uri: asset.uri,
      name: asset.name,
      mime: asset.mimeType,
      size: asset.size,
    });
  }

  function handleSend() {
    if (!canSend) return;
    const trimmed = text.trim();
    onSend(trimmed, file);
    setText("");
    setFile(undefined);
  }

  return (
    <View className="border-t border-border/40 bg-bg px-3 pb-4 pt-2">
      {/* File preview chip */}
      {file && (
        <View className="mb-2 flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center gap-1.5 rounded border border-border/50 bg-surface-alt px-2 py-1">
            <Text className="text-[11px] text-text-sec" numberOfLines={1}>
              📎 {file.name}
            </Text>
          </View>
          <Pressable
            onPress={() => setFile(undefined)}
            accessibilityLabel="Hapus lampiran"
            className="px-1"
          >
            <Text className="text-[13px] text-text-muted">✕</Text>
          </Pressable>
        </View>
      )}

      <View className="flex-row items-end gap-2">
        {/* Attach button — Catat mode only */}
        {mode === "catat" && (
          <Pressable
            onPress={() => void pickFile()}
            disabled={disabled || sending}
            accessibilityLabel="Lampirkan file"
            className="mb-1 h-9 w-9 items-center justify-center rounded-full border border-border/50 bg-surface-alt active:opacity-70"
          >
            <AttachIcon />
          </Pressable>
        )}

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={
            mode === "tanya"
              ? "Tanya tentang proyek…"
              : "Deskripsikan catatan lapangan…"
          }
          placeholderTextColor="#9C8B75"
          multiline
          maxLength={mode === "tanya" ? 2000 : 4000}
          editable={!disabled && !sending}
          returnKeyType="default"
          className="min-h-[36px] max-h-[120px] flex-1 rounded-xl border border-border/50 bg-surface px-3 py-2 text-[14px] text-text"
          style={{ textAlignVertical: "center" }}
        />

        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          testID="send-button"
          accessibilityRole="button"
          accessibilityLabel="Kirim"
          className={`mb-0.5 h-9 w-9 items-center justify-center rounded-full ${
            canSend ? "bg-primary active:opacity-80" : "bg-surface-alt"
          }`}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#9C8B75" />
          ) : (
            <SendIcon color={canSend ? "#FDFAF6" : "#9C8B75"} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
