import { useState, useRef } from "react";
import { View, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/Text";
import { useAddCard } from "@/lib/query/mutations";

type Props = {
  projectId: string;
  topicId: string;
  projectCode: string;
};

export function AddCardForm({ projectId, topicId, projectCode }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const addCard = useAddCard(projectCode);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    setTitle("");
    setOpen(false);
    addCard.mutate(
      { projectId, topicId, title: trimmed },
      {
        onError: (err) => {
          setTitle(trimmed);
          setOpen(true);
          setError((err as Error).message);
        },
      },
    );
  }

  if (!open) {
    return (
      <Pressable
        onPress={() => {
          setOpen(true);
          // focus input on next frame
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="mt-1 min-h-[44px] items-center justify-center rounded border border-dashed border-border px-2 py-2"
        accessibilityRole="button"
        accessibilityLabel="Tambah kartu baru"
      >
        <Text className="text-[12px] font-medium text-text-sec">+ tambah kartu</Text>
      </Pressable>
    );
  }

  return (
    <View className="mt-1 rounded border border-border bg-surface p-2">
      <TextInput
        ref={inputRef}
        autoFocus
        value={title}
        onChangeText={setTitle}
        placeholder="Judul kartu — contoh: Master bathroom"
        placeholderTextColor="#847E78"
        editable={!addCard.isPending}
        maxLength={120}
        onSubmitEditing={submit}
        returnKeyType="done"
        className="min-h-[40px] rounded border border-border px-2 py-1 text-[13px] text-text"
      />
      {error != null && (
        <Text className="mt-1 text-[10px] text-critical">{error}</Text>
      )}
      <View className="mt-1.5 flex-row gap-1">
        <Pressable
          onPress={submit}
          disabled={addCard.isPending || title.trim().length === 0}
          className={`flex-row items-center justify-center rounded px-3 py-1 ${
            addCard.isPending || title.trim().length === 0 ? "bg-surface-alt" : "bg-primary"
          }`}
          accessibilityRole="button"
          accessibilityLabel="Simpan kartu"
        >
          {addCard.isPending ? (
            <ActivityIndicator size="small" color="#FDFAF6" />
          ) : (
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-[#FDFAF6]">
              Simpan
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            setOpen(false);
            setTitle("");
            setError(null);
          }}
          disabled={addCard.isPending}
          className="rounded px-3 py-1"
          accessibilityRole="button"
          accessibilityLabel="Batal"
        >
          <Text className="text-[10px] font-medium text-text-sec">Batal</Text>
        </Pressable>
      </View>
    </View>
  );
}
