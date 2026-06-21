import { useState, useRef } from "react";
import { View, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/Text";
import { useAddColumn } from "@/lib/query/mutations";

type Props = { projectId: string; projectCode: string };

export function AddColumnSlide({ projectId, projectCode }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const addColumn = useAddColumn(projectCode);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    setName("");
    setOpen(false);
    addColumn.mutate(
      { projectId, name: trimmed },
      {
        onError: (err) => {
          setName(trimmed);
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
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="min-h-[88px] items-center justify-center rounded border border-dashed border-border p-4"
        accessibilityRole="button"
        accessibilityLabel="Tambah kolom baru"
      >
        <Text className="text-[13px] font-medium text-text-sec">+ tambah kolom</Text>
      </Pressable>
    );
  }

  return (
    <View className="rounded border border-border bg-surface p-3">
      <Text className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-text-sec">
        Nama kolom baru
      </Text>
      <TextInput
        ref={inputRef}
        autoFocus
        value={name}
        onChangeText={setName}
        placeholder="Contoh: Finishing"
        placeholderTextColor="#847E78"
        editable={!addColumn.isPending}
        maxLength={80}
        onSubmitEditing={submit}
        returnKeyType="done"
        className="min-h-[40px] rounded border border-border px-2 py-1 text-[13px] text-text"
      />
      {error != null && (
        <Text className="mt-1 text-[10px] text-critical">{error}</Text>
      )}
      <View className="mt-2 flex-row gap-1">
        <Pressable
          onPress={submit}
          disabled={addColumn.isPending || name.trim().length === 0}
          className={`flex-row items-center justify-center rounded px-3 py-1.5 ${
            addColumn.isPending || name.trim().length === 0 ? "bg-surface-alt" : "bg-primary"
          }`}
          accessibilityRole="button"
        >
          {addColumn.isPending ? (
            <ActivityIndicator size="small" color="#FDFAF6" />
          ) : (
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-[#FDFAF6]">
              Buat
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => { setOpen(false); setName(""); setError(null); }}
          disabled={addColumn.isPending}
          className="rounded px-3 py-1.5"
          accessibilityRole="button"
        >
          <Text className="text-[10px] font-medium text-text-sec">Batal</Text>
        </Pressable>
      </View>
    </View>
  );
}
