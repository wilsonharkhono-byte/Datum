const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Keep colocated test/spec files out of the native bundle. expo-router's
// require.context over app/ matches every *.tsx, so *.test.tsx routes would
// otherwise be bundled — they import @testing-library/react-native → Node's
// "console" module and break `expo export:embed` on EAS. Jest reads
// jest.config.js (not this file), so unit tests are unaffected.
config.resolver.blockList = [
  ...config.resolver.blockList,
  /.*\.(test|spec)\.[jt]sx?$/,
];

module.exports = withNativeWind(config, { input: "./global.css" });
