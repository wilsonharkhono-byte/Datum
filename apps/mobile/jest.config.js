module.exports = {
  preset: "jest-expo",
  testMatch: [
    "**/tests/**/*.test.tsx",
    "**/tests/**/*.test.ts",
    "**/lib/**/*.test.ts",
    "**/lib/**/*.test.tsx",
    "**/components/**/*.test.ts",
    "**/components/**/*.test.tsx",
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
