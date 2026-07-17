/**
 * AttachmentViewer — full-screen photo lightbox for a card attachment.
 *
 * Site photos in the timeline are 64x64 thumbnails; this opens the picked image
 * full-screen so a field user can read a marble label, inspect a crack, verify
 * grout colour, etc. Dark scrim, expo-image contentFit="contain", the ai_caption
 * beneath when present. Close via the X button or a scrim tap. Pinch-zoom is out
 * of scope by design — kept deliberately simple.
 */

import { Modal, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Text } from "@/components/ui/Text";

export interface AttachmentViewerProps {
  visible: boolean;
  /** Signed https URL of the image to display. */
  url: string | null;
  /** AI caption shown under the image when present. */
  caption?: string | null;
  onClose: () => void;
}

export function AttachmentViewer({ visible, url, caption, onClose }: AttachmentViewerProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* Scrim — tapping anywhere off the controls closes the viewer. */}
      <Pressable
        className="flex-1 items-center justify-center bg-black/90"
        onPress={onClose}
        accessibilityLabel="Tutup penampil foto"
      >
        {/* Close button (top-right, 44px target). */}
        <View className="absolute right-3 top-12 z-10">
          <Pressable
            onPress={onClose}
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/50 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Tutup"
          >
            <Text className="text-[24px] text-white">×</Text>
          </Pressable>
        </View>

        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width: "100%", height: "78%" }}
            contentFit="contain"
            accessibilityLabel="Foto lampiran"
          />
        ) : null}

        {caption ? (
          <View className="absolute bottom-10 left-0 right-0 px-6">
            <Text className="text-center text-[13px] leading-snug text-white/90">
              {caption}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );
}
