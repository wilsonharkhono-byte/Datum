/// <reference types="nativewind/types" />

// Type the NativeWind global stylesheet side-effect import (`import "./global.css"`).
// Committed so `tsc` passes in clean checkouts/CI without Expo's generated, gitignored
// expo-env.d.ts (which would otherwise supply this via `expo/types`).
declare module "*.css" {}
