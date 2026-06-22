/**
 * MessageInput.tsx — text input bar for the mobile assistant.
 *
 * Tanya mode: free text → submit.
 * Catat mode: free text + optional image/PDF from the device picker → submit.
 *
 * Guard: disabled while sending or when there's neither text nor an attached file.
 */

import { useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Text } from "@/components/ui/Text";

// ── expo-image-picker ─────────────────────────────────────────────────────────
// expo-image-picker is an optional peer dependency. When it is not installed
// (e.g. on CI or a bare workflow without the module linked) the file-attach
// button is hidden rather than crashing. This avoids a hard dependency on a
// package that may not be linked in all Expo managed-workflow environments.
// Add `expo-image-picker` to `apps/mobile/package.json` dependencies to enable.
let _ImagePicker: {
  requestMediaLibraryPermissionsAsync(): Promise<{ status: string }>;
  launchImageLibraryAsync(opts: {
    mediaTypes: string[];
    allowsEditing: boolean;
    quality: number;
  }): Promise<{ canceled: boolean; assets: { uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number | null }[] }>;
} | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  _ImagePicker = require("expo-image-picker");
} catch {
  // Package not installed — file attachment is disabled
  _ImagePicker = null;
}

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
    if (!_ImagePicker) return; // package not installed

    // Request media library permission on iOS.
    if (Platform.OS !== "web") {
      const { status } =
        await _ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") return;
    }

    const result = await _ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
    });

    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;

    setFile({
      uri: asset.uri,
      name: asset.fileName ?? `foto-${Date.now()}.jpg`,
      mime: asset.mimeType ?? "image/jpeg",
      size: asset.fileSize ?? 0,
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
        {/* Attach button — Catat mode only, when expo-image-picker is installed */}
        {mode === "catat" && !!_ImagePicker && (
          <Pressable
            onPress={pickFile}
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
