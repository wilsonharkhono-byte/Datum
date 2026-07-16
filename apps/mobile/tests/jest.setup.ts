/**
 * jest.setup.ts — global test setup, run via setupFilesAfterEach so jest.mock
 * calls apply to every suite. Mocks the native expo-share-intent module so
 * suites that render the root layout don't hit real native code.
 */
import React from "react";

jest.mock("expo-share-intent", () => ({
  ShareIntentProvider: ({ children }: { children: React.ReactNode }) => children,
  useShareIntentContext: () => ({
    hasShareIntent: false,
    shareIntent: null,
    resetShareIntent: jest.fn(),
    error: null,
  }),
}));
