module.exports = {
  preset: "jest-expo",
  // The first async test in a suite pays the one-time cost of transforming the
  // react-native/expo module graph before its own logic runs; on slower CI
  // runners that cold start alone can approach Jest's 5s default and flake the
  // streaming-assistant tests. 20s gives headroom without masking real hangs.
  testTimeout: 20000,
  testMatch: [
    "**/tests/**/*.test.tsx",
    "**/tests/**/*.test.ts",
    "**/lib/**/*.test.ts",
    "**/lib/**/*.test.tsx",
    "**/components/**/*.test.ts",
    "**/components/**/*.test.tsx",
    "**/app/**/*.test.ts",
    "**/app/**/*.test.tsx",
  ],
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|nativewind|react-native-css-interop))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};
