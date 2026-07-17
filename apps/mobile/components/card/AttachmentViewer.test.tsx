/**
 * Tests for AttachmentViewer — the full-screen photo lightbox.
 *
 * Asserts: renders the image (by accessibilityLabel) and caption when visible,
 * closes via the X button, and closes via a scrim tap. expo-image is stubbed to
 * a View that echoes its accessibilityLabel.
 */

import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

jest.mock("expo-image", () => ({
  Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => {
    const { View } = require("react-native");
    return <View accessibilityLabel={accessibilityLabel} />;
  },
}));

import { AttachmentViewer } from "./AttachmentViewer";

describe("AttachmentViewer", () => {
  it("renders the image and caption when visible", () => {
    const { getByLabelText, getByText } = render(
      <AttachmentViewer
        visible
        url="https://signed.example/abc"
        caption="Dinding utara selesai cat"
        onClose={jest.fn()}
      />,
    );
    expect(getByLabelText("Foto lampiran")).toBeTruthy();
    expect(getByText("Dinding utara selesai cat")).toBeTruthy();
  });

  it("calls onClose when the X button is pressed", () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <AttachmentViewer visible url="https://signed.example/abc" onClose={onClose} />,
    );
    fireEvent.press(getByLabelText("Tutup"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the scrim is tapped", () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <AttachmentViewer visible url="https://signed.example/abc" onClose={onClose} />,
    );
    fireEvent.press(getByLabelText("Tutup penampil foto"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
