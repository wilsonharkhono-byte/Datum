import { useRef, useEffect } from "react";
import { ScrollView, Pressable, View } from "react-native";
import { Text } from "@/components/ui/Text";

type Tab = { id: string; name: string; count: number };

type Props = {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function BoardTabs({ tabs, activeId, onSelect }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const chipRefs = useRef<Map<string, View>>(new Map());
  const parentRef = useRef<ScrollView>(null);

  // Scroll the active chip into view when activeId changes.
  // React Native ScrollView doesn't expose scrollToItem by ref, so we use
  // measure() to get x offset and scrollTo().
  useEffect(() => {
    if (activeId == null || scrollRef.current == null) return;
    const chipEl = chipRefs.current.get(activeId);
    if (!chipEl) return;
    chipEl.measureLayout(
      // @ts-expect-error measureLayout accepts a ref handle
      scrollRef.current,
      (x: number) => {
        scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
      },
      () => {},
    );
  }, [activeId]);

  if (tabs.length === 0) return null;

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      className="border-b border-border bg-surface"
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
      accessibilityLabel="Lompat ke kolom"
    >
      {tabs.map((tab) => {
        const on = tab.id === activeId;
        return (
          <Pressable
            key={tab.id}
            ref={(el) => {
              if (el) chipRefs.current.set(tab.id, el);
              else chipRefs.current.delete(tab.id);
            }}
            onPress={() => onSelect(tab.id)}
            className={`max-w-[240px] min-h-[44px] flex-row items-center gap-1 rounded-full border px-3 ${
              on ? "border-accent bg-accent-dark" : "border-border bg-surface"
            }`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${tab.name}, ${tab.count} kartu`}
          >
            <Text
              numberOfLines={1}
              className={`shrink text-[11px] font-medium ${on ? "text-surface" : "text-text-sec"}`}
            >
              {tab.name}
            </Text>
            <Text className={`text-[10px] opacity-70 ${on ? "text-[#FDFAF6]" : "text-text-muted"}`}>
              {tab.count}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
