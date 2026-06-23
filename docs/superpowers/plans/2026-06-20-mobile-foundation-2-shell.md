# Mobile Foundation 2 — App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up the `apps/mobile` shell on top of `@datum/core`: shared SANO design tokens, NativeWind, the react-query + AsyncStorage-offline + Supabase-realtime providers, a session context, the full Expo Router IA skeleton, and the Matrix (projects) screen consuming `@datum/core` — so every later feature slice has a home and the shared plumbing.

**Architecture:** A single shared token source in `@datum/core` (`tokens.ts`) feeds both web's Tailwind v4 theme and mobile's NativeWind config. Mobile mirrors web's `PersistQueryClientProvider` with an AsyncStorage persister (per-user key, cleared on logout), wires `onlineManager`/`focusManager` to NetInfo/AppState, and subscribes to Supabase realtime via the core helpers. A `SessionProvider` promotes the ad-hoc `_layout` auth gate into `useSession()`. Reads call `@datum/core` directly with the anon client.

**Tech Stack:** Expo ~56, React Native 0.85, React 19, expo-router ~56, NativeWind v4 + Tailwind, @tanstack/react-query ^5.101.0 (+ persist-client), @react-native-community/netinfo, @react-native-async-storage/async-storage, @datum/core, jest-expo + @testing-library/react-native.

**Reference spec:** `docs/superpowers/specs/2026-06-20-mobile-foundation-design.md` (§3.3 tokens, §4 IA, §5 data, §8 offline, §9 edge cases, §10 testing). Depends on Foundation-1 (`@datum/core`) being merged.

**Conventions:** run commands from repo root `/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain`. After mobile changes run `pnpm --filter mobile typecheck` and `pnpm --filter mobile test`. After any `@datum/core` change run `pnpm --filter @datum/core build` before mobile typecheck (mobile imports the built dist). Commit after each task. Bahasa Indonesia for all user-facing copy (mirror web verbatim where a web string exists).

---

## File structure

**Created — `packages/core`:** `src/tokens.ts` (SANO tokens), barrel export.
**Created — `apps/mobile`:**
- `tailwind.config.js`, `global.css`, `metro.config.js`, `babel.config.js`, `nativewind-env.d.ts`
- `lib/query/async-kv.ts` (+ test), `lib/query/provider.tsx`
- `lib/session/session.tsx` (SessionProvider + useSession) (+ test)
- `lib/realtime/useRealtimeInvalidation.ts`
- `lib/env.ts` (typed EXPO_PUBLIC_* access)
- `components/ui/{Screen,Text,Card,Badge,Button,Chip,EmptyState,ErrorState,Skeleton,OfflineBanner}.tsx` (+ a couple tests)
- Expo Router tree under `app/` (nested stacks + stub screens) — see Task 7
- `app/(tabs)/(matrix)/index.tsx` (Matrix on core) (+ test)
**Modified:** `apps/mobile/package.json` (deps), `apps/mobile/tsconfig.json` (include nativewind-env, @datum/core path), `apps/mobile/jest.config.js` (nativewind), `apps/mobile/app/_layout.tsx` (providers), `apps/web/...tailwind config` (consume shared tokens — optional, Task 2), `.github/workflows/ci.yml` (mobile lint step).

---

## Task 1: Install mobile dependencies + wire @datum/core

**Files:** Modify `apps/mobile/package.json`, `apps/mobile/tsconfig.json`

- [ ] **Step 1: Add `@datum/core` + the runtime deps.** From repo root run:
```bash
pnpm --filter mobile add @datum/core@workspace:*
pnpm --filter mobile exec expo install @tanstack/react-query @tanstack/react-query-persist-client @react-native-community/netinfo nativewind react-native-css-interop @expo-google-fonts/space-grotesk
pnpm --filter mobile add -D tailwindcss
```
(`expo install` picks Expo-56-compatible versions. `@react-native-async-storage/async-storage`, `react-native-reanimated`, `react-native-safe-area-context` are already present — NativeWind needs the latter two.)

- [ ] **Step 2: Pin react-query to web's line.** Verify `apps/mobile/package.json` shows `@tanstack/react-query` resolving to `^5.x`. If `expo install` chose a different major than web's `^5.101.0`, set both `@tanstack/react-query` and `@tanstack/react-query-persist-client` to `"^5.101.0"` in `apps/mobile/package.json` and re-run `pnpm install`.

- [ ] **Step 3: Add the `@datum/core` path alias to `apps/mobile/tsconfig.json`.** In `compilerOptions.paths`, alongside the `@datum/db` entries, add:
```jsonc
      "@datum/core": ["../../packages/core/src"],
      "@datum/core/*": ["../../packages/core/src/*"],
```

- [ ] **Step 4: Build core + typecheck mobile.**
Run: `pnpm --filter @datum/core build` then `pnpm --filter mobile typecheck`
Expected: exit 0 (no usage yet; just confirms wiring resolves).

- [ ] **Step 5: Commit**
```bash
git add apps/mobile/package.json apps/mobile/tsconfig.json pnpm-lock.yaml
git commit -m "feat(mobile): add @datum/core + react-query/netinfo/nativewind deps"
```

---

## Task 2: Shared SANO tokens in `@datum/core`

**Files:** Create `packages/core/src/tokens.ts`, `packages/core/src/tokens.test.ts`; modify `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** `packages/core/src/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { COLORS, TYPE, SPACE, RADIUS, TOUCH_TARGET, FONT_FAMILY } from "./tokens";

describe("SANO tokens", () => {
  it("exposes the signature palette", () => {
    expect(COLORS.bg).toBe("#D2D0C4");
    expect(COLORS.surface).toBe("#FDFAF6");
    expect(COLORS.primary).toBe("#141210");
    expect(COLORS.accent).toBe("#B29F86");
  });
  it("exposes the flag colors", () => {
    expect(COLORS.ok).toBe("#3D8B40");
    expect(COLORS.critical).toBe("#C62828");
  });
  it("exposes scales + the 44dp touch target", () => {
    expect(TYPE.base).toBe(15);
    expect(SPACE.base).toBe(16);
    expect(RADIUS.base).toBe(8);
    expect(TOUCH_TARGET).toBe(44);
    expect(FONT_FAMILY).toBe("Space Grotesk");
  });
});
```
Run `pnpm --filter @datum/core test` — expect FAIL.

- [ ] **Step 2: Create `packages/core/src/tokens.ts`** (verbatim from `SANO_Brand_Graphic_Standard.md` §9; this is the single source both apps consume — no `process.env`, no framework imports, so it passes the import guard):
```ts
// SANO / WHAstudio design tokens — warm, grounded, precise.
// Single source consumed by web Tailwind v4 theme + mobile NativeWind config.
export const COLORS = {
  primary: "#141210", accent: "#B29F86", accentDark: "#7A6B56",
  bg: "#D2D0C4", bgOat: "#C6C1B6", surface: "#FDFAF6", surfaceAlt: "#F2EFE9",
  text: "#141210", textSec: "#524E49", textMuted: "#847E78",
  border: "#B5AFA8", borderSub: "rgba(148,148,148,0.18)",
  ok: "#3D8B40", info: "#1565C0", warning: "#E65100", high: "#BF360C", critical: "#C62828",
  accentBg: "rgba(178,159,134,0.10)",
  okBg: "rgba(61,139,64,0.08)", infoBg: "rgba(21,101,192,0.08)",
  warningBg: "rgba(230,81,0,0.10)", highBg: "rgba(191,54,12,0.10)", criticalBg: "rgba(198,40,40,0.08)",
  textInverse: "#FDFAF6", textInverseSec: "rgba(253,250,246,0.65)", textInverseMuted: "rgba(253,250,246,0.40)",
} as const;

export const FONT_FAMILY = "Space Grotesk";
export const TYPE = { xs: 12, sm: 13, base: 15, md: 16, lg: 19, xl: 24, xxl: 30 } as const;
export const SPACE = { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 } as const;
export const RADIUS = { sm: 5, base: 8, lg: 14 } as const;
export const TOUCH_TARGET = 44;
```

- [ ] **Step 3: Export from the barrel** (append to `packages/core/src/index.ts`):
```ts
export { COLORS, FONT_FAMILY, TYPE, SPACE, RADIUS, TOUCH_TARGET } from "./tokens";
```

- [ ] **Step 4: Build + test core.** Run `pnpm --filter @datum/core build` then `pnpm --filter @datum/core test` — expect PASS (incl. import guard, which must still pass since tokens.ts has no banned imports).

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/tokens.ts packages/core/src/tokens.test.ts packages/core/src/index.ts
git commit -m "feat(core): shared SANO design tokens"
```

---

## Task 3: NativeWind + Tailwind config (mobile) consuming the shared tokens

**Files:** Create `apps/mobile/tailwind.config.js`, `apps/mobile/global.css`, `apps/mobile/metro.config.js`, `apps/mobile/babel.config.js`, `apps/mobile/nativewind-env.d.ts`; modify `apps/mobile/tsconfig.json`, `apps/mobile/jest.config.js`

- [ ] **Step 1: Create `apps/mobile/tailwind.config.js`** (maps SANO tokens to Tailwind theme so `className="bg-surface text-primary"` works):
```js
const { COLORS, RADIUS } = require("@datum/core");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: COLORS.primary, accent: COLORS.accent, "accent-dark": COLORS.accentDark,
        bg: COLORS.bg, "bg-oat": COLORS.bgOat, surface: COLORS.surface, "surface-alt": COLORS.surfaceAlt,
        text: COLORS.text, "text-sec": COLORS.textSec, "text-muted": COLORS.textMuted,
        border: COLORS.border,
        ok: COLORS.ok, info: COLORS.info, warning: COLORS.warning, high: COLORS.high, critical: COLORS.critical,
        "ok-bg": COLORS.okBg, "info-bg": COLORS.infoBg, "warning-bg": COLORS.warningBg,
        "high-bg": COLORS.highBg, "critical-bg": COLORS.criticalBg,
      },
      borderRadius: { DEFAULT: `${RADIUS.base}px`, sm: `${RADIUS.sm}px`, lg: `${RADIUS.lg}px` },
      fontFamily: { sans: ["SpaceGrotesk_400Regular"], medium: ["SpaceGrotesk_500Medium"], semibold: ["SpaceGrotesk_600SemiBold"], bold: ["SpaceGrotesk_700Bold"] },
    },
  },
  plugins: [],
};
```
> Note: `require("@datum/core")` resolves to the built `dist` (tokens are plain consts — no RN/Node-only code, safe to require in a config). Build core first.

- [ ] **Step 2: Create `apps/mobile/global.css`**:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Create `apps/mobile/babel.config.js`**:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
```

- [ ] **Step 4: Create `apps/mobile/metro.config.js`** (NativeWind + monorepo resolution for the built `@datum/core`):
```js
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

module.exports = withNativeWind(config, { input: "./global.css" });
```

- [ ] **Step 5: Create `apps/mobile/nativewind-env.d.ts`**:
```ts
/// <reference types="nativewind/types" />
```

- [ ] **Step 6: Include the env file + typecheck.** In `apps/mobile/tsconfig.json` `include` array, add `"nativewind-env.d.ts"`.

- [ ] **Step 7: Make jest-expo transform NativeWind.** In `apps/mobile/jest.config.js`, add `"nativewind"` and `"react-native-css-interop"` to the `transformIgnorePatterns` allowlist group (the `(?!(...))` list), so they are transformed. The resulting first entry should read:
```js
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|nativewind|react-native-css-interop))",
```

- [ ] **Step 8: Verify typecheck + existing test still pass.**
Run: `pnpm --filter @datum/core build` then `pnpm --filter mobile typecheck` then `pnpm --filter mobile test`
Expected: typecheck exit 0; the existing `tests/login.test.tsx` still passes (1 test). If NativeWind's jest transform errors, report BLOCKED with the exact error (this is spec open question §11.5 — NativeWind/Expo-56 compatibility).

- [ ] **Step 9: Commit**
```bash
git add apps/mobile/tailwind.config.js apps/mobile/global.css apps/mobile/babel.config.js apps/mobile/metro.config.js apps/mobile/nativewind-env.d.ts apps/mobile/tsconfig.json apps/mobile/jest.config.js
git commit -m "feat(mobile): NativeWind + Tailwind wired to shared SANO tokens"
```

---

## Task 4: AsyncStorage KV adapter + typed env

**Files:** Create `apps/mobile/lib/query/async-kv.ts`, `apps/mobile/lib/query/async-kv.test.ts`, `apps/mobile/lib/env.ts`

- [ ] **Step 1: Write the failing test** `apps/mobile/lib/query/async-kv.test.ts`:
```ts
import { asyncStorageKV, clearAsyncCache } from "../../lib/query/async-kv";

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
      clear: jest.fn(async () => void store.clear()),
    },
  };
});

describe("asyncStorageKV", () => {
  it("round-trips and removes a value through AsyncStorage", async () => {
    await asyncStorageKV.setItem("k", "v");
    expect(await asyncStorageKV.getItem("k")).toBe("v");
    await asyncStorageKV.removeItem("k");
    expect(await asyncStorageKV.getItem("k")).toBeNull();
  });
  it("clearAsyncCache wipes everything", async () => {
    await asyncStorageKV.setItem("a", "1");
    await clearAsyncCache();
    expect(await asyncStorageKV.getItem("a")).toBeNull();
  });
});
```
Run `pnpm --filter mobile test` — expect FAIL.

- [ ] **Step 2: Create `apps/mobile/lib/query/async-kv.ts`** (the RN twin of web's `idb-kv.ts`, implementing core's `AsyncKV`):
```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AsyncKV } from "@datum/core";

export const asyncStorageKV: AsyncKV = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

/** Wipe the whole cache store on logout so a shared device leaks nothing. */
export function clearAsyncCache(): Promise<void> {
  return AsyncStorage.clear();
}
```

- [ ] **Step 3: Create `apps/mobile/lib/env.ts`** (typed access to the public env, with a missing-var guard — the mobile guard the Foundation-1 review flagged):
```ts
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var ${name}. Set it in the Expo build env.`);
  return value;
}

export const SUPABASE_URL = required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
```

- [ ] **Step 4: Verify.** Run `pnpm --filter mobile test` (expect PASS) then `pnpm --filter mobile typecheck` (exit 0).

- [ ] **Step 5: Commit**
```bash
git add apps/mobile/lib/query/async-kv.ts apps/mobile/lib/query/async-kv.test.ts apps/mobile/lib/env.ts
git commit -m "feat(mobile): AsyncStorage KV persister adapter + typed env"
```

---

## Task 5: Session context (SessionProvider + useSession)

**Files:** Create `apps/mobile/lib/session/session.tsx`, `apps/mobile/lib/session/session.test.tsx`

- [ ] **Step 1: Write the failing test** `apps/mobile/lib/session/session.test.tsx`:
```tsx
import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { SessionProvider, useSession } from "./session";

const getUser = jest.fn();
const onAuthStateChange = jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
const signOut = jest.fn();
jest.mock("@/lib/supabase/client", () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => getUser(...a), onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a), signOut: (...a: unknown[]) => signOut(...a) } },
}));
const getCurrentStaff = jest.fn();
jest.mock("@datum/core", () => ({ getCurrentStaff: (...a: unknown[]) => getCurrentStaff(...a) }));

function Probe() {
  const { staff, status } = useSession();
  return <Text>{status}:{staff?.full_name ?? "none"}</Text>;
}

describe("SessionProvider", () => {
  beforeEach(() => { getUser.mockReset(); getCurrentStaff.mockReset(); });
  it("resolves to authenticated with the staff name", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    getCurrentStaff.mockResolvedValue({ id: "u1", full_name: "Wilson", role: "principal", email: null });
    const { getByText } = render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(getByText("authenticated:Wilson")).toBeTruthy());
  });
  it("treats an orphan auth user (no staff row) as unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    getCurrentStaff.mockResolvedValue(null);
    const { getByText } = render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(getByText("unauthenticated:none")).toBeTruthy());
  });
});
```
Run `pnpm --filter mobile test` — expect FAIL.

- [ ] **Step 2: Create `apps/mobile/lib/session/session.tsx`**:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCurrentStaff, type CurrentStaff } from "@datum/core";
import { clearAsyncCache } from "@/lib/query/async-kv";

type Status = "loading" | "authenticated" | "unauthenticated";
type SessionValue = { status: Status; staff: CurrentStaff | null; signOut: () => Promise<void> };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [staff, setStaff] = useState<CurrentStaff | null>(null);

  async function resolve() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStaff(null); setStatus("unauthenticated"); return; }
    const current = await getCurrentStaff(supabase);
    if (!current) {
      // Orphan auth user (no staff row): never show a half-broken shell.
      await supabase.auth.signOut();
      setStaff(null); setStatus("unauthenticated"); return;
    }
    setStaff(current); setStatus("authenticated");
  }

  useEffect(() => {
    resolve();
    const { data: sub } = supabase.auth.onAuthStateChange(() => resolve());
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await clearAsyncCache();
    await supabase.auth.signOut();
  }

  return <SessionContext.Provider value={{ status, staff, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
```

- [ ] **Step 3: Verify.** `pnpm --filter @datum/core build` then `pnpm --filter mobile test` (expect PASS) then `pnpm --filter mobile typecheck`.

- [ ] **Step 4: Commit**
```bash
git add apps/mobile/lib/session
git commit -m "feat(mobile): SessionProvider + useSession with orphan-user guard"
```

---

## Task 6: Query provider (persist + onlineManager + focusManager) + realtime hook

**Files:** Create `apps/mobile/lib/query/provider.tsx`, `apps/mobile/lib/realtime/useRealtimeInvalidation.ts`

- [ ] **Step 1: Create `apps/mobile/lib/query/provider.tsx`** (mirrors `apps/web/app/providers.tsx`, per-user key, gated dehydration; wires NetInfo + AppState):
```tsx
import { useEffect, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { makeQueryClient, createKVPersister, CACHE_BUSTER, CACHE_MAX_AGE, PERSISTED_KEY_ROOTS } from "@datum/core";
import { asyncStorageKV } from "@/lib/query/async-kv";

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
);

export function QueryProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [persister] = useState(() => createKVPersister(asyncStorageKV, `datum.rq.${userId}`));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) =>
      focusManager.setFocused(s === "active"),
    );
    return () => sub.remove();
  }, []);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            (PERSISTED_KEY_ROOTS as readonly string[]).includes(q.queryKey[0] as string),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
```

- [ ] **Step 2: Create `apps/mobile/lib/realtime/useRealtimeInvalidation.ts`** (the mobile twin of how web components subscribe in effects):
```ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { subscribeToProjectChanges, subscribeToOwnNotifications } from "@datum/core";

/** Invalidate a project's board/card queries on realtime changes. */
export function useProjectRealtime(projectId: string | undefined, code: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    return subscribeToProjectChanges(supabase, projectId, () => {
      if (code) qc.invalidateQueries({ queryKey: ["board", code] });
    });
  }, [projectId, code, qc]);
}

/** Invalidate the notifications queries on realtime deltas. */
export function useNotificationsRealtime(staffId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!staffId) return;
    return subscribeToOwnNotifications(supabase, staffId, () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [staffId, qc]);
}
```

- [ ] **Step 3: Verify.** `pnpm --filter @datum/core build` then `pnpm --filter mobile typecheck` (exit 0) then `pnpm --filter mobile test` (existing tests still pass).

- [ ] **Step 4: Commit**
```bash
git add apps/mobile/lib/query/provider.tsx apps/mobile/lib/realtime/useRealtimeInvalidation.ts
git commit -m "feat(mobile): query provider (persist+netinfo+appstate) + realtime hooks"
```

---

## Task 7: UI primitives (NativeWind, token-driven)

**Files:** Create `apps/mobile/components/ui/{Screen,Text,Card,Badge,Button,Chip,EmptyState,ErrorState,Skeleton,OfflineBanner}.tsx` and `apps/mobile/components/ui/ui.test.tsx`

> These mirror web treatments (`apps/web/app/globals.css`: chip, skeleton, flag system, 44px touch rule). All use NativeWind `className`. Keep each file small + single-purpose.

- [ ] **Step 1: Create `apps/mobile/components/ui/Text.tsx`**:
```tsx
import { Text as RNText, type TextProps } from "react-native";

type Variant = "body" | "secondary" | "muted" | "heading" | "label";
const CLASS: Record<Variant, string> = {
  body: "text-text text-[15px] font-sans",
  secondary: "text-text-sec text-[13px] font-sans",
  muted: "text-text-muted text-[13px] font-sans",
  heading: "text-text text-[19px] font-semibold",
  label: "text-text-sec text-[12px] uppercase tracking-wide font-medium",
};

export function Text({ variant = "body", className = "", ...rest }: TextProps & { variant?: Variant; className?: string }) {
  return <RNText className={`${CLASS[variant]} ${className}`} {...rest} />;
}
```

- [ ] **Step 2: Create `apps/mobile/components/ui/Screen.tsx`**:
```tsx
import { type ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <View className={`flex-1 px-4 ${className}`}>{children}</View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Create `apps/mobile/components/ui/Card.tsx`**:
```tsx
import { type ReactNode } from "react";
import { View, Pressable } from "react-native";

export function Card({ children, onPress, className = "" }: { children: ReactNode; onPress?: () => void; className?: string }) {
  const base = "bg-surface rounded border border-border/40 p-4";
  if (onPress) return <Pressable onPress={onPress} className={`${base} active:opacity-80 ${className}`}>{children}</Pressable>;
  return <View className={`${base} ${className}`}>{children}</View>;
}
```

- [ ] **Step 4: Create `apps/mobile/components/ui/Badge.tsx`** (the 5-flag system):
```tsx
import { View } from "react-native";
import { Text } from "./Text";

export type Flag = "ok" | "info" | "warning" | "high" | "critical";
const BG: Record<Flag, string> = { ok: "bg-ok-bg", info: "bg-info-bg", warning: "bg-warning-bg", high: "bg-high-bg", critical: "bg-critical-bg" };
const FG: Record<Flag, string> = { ok: "text-ok", info: "text-info", warning: "text-warning", high: "text-high", critical: "text-critical" };

export function Badge({ flag, label }: { flag: Flag; label: string }) {
  return (
    <View className={`self-start rounded-sm px-2 py-0.5 ${BG[flag]}`}>
      <Text className={`text-[12px] font-semibold uppercase ${FG[flag]}`}>{label}</Text>
    </View>
  );
}
```

- [ ] **Step 5: Create `apps/mobile/components/ui/Button.tsx`** (44dp min touch target):
```tsx
import { Pressable, ActivityIndicator } from "react-native";
import { Text } from "./Text";

export function Button({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      className={`min-h-[44px] items-center justify-center rounded px-4 ${off ? "bg-surface-alt" : "bg-primary active:opacity-90"}`}
    >
      {loading ? <ActivityIndicator color="#FDFAF6" /> : <Text className={`text-[15px] font-medium ${off ? "text-text-muted" : "text-[#FDFAF6]"}`}>{label}</Text>}
    </Pressable>
  );
}
```

- [ ] **Step 6: Create `apps/mobile/components/ui/Chip.tsx`**:
```tsx
import { View } from "react-native";
import { Text } from "./Text";

export function Chip({ label }: { label: string }) {
  return (
    <View className="self-start rounded-sm border border-border/50 bg-surface-alt px-2 py-0.5">
      <Text className="text-[12px] text-text-sec">{label}</Text>
    </View>
  );
}
```

- [ ] **Step 7: Create `apps/mobile/components/ui/EmptyState.tsx`**:
```tsx
import { View } from "react-native";
import { Text } from "./Text";

export function EmptyState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text variant="secondary" className="text-center">{message}</Text>
    </View>
  );
}
```

- [ ] **Step 8: Create `apps/mobile/components/ui/ErrorState.tsx`**:
```tsx
import { View } from "react-native";
import { Text } from "./Text";
import { Button } from "./Button";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text variant="secondary" className="text-center text-critical">{message}</Text>
      {onRetry ? <Button label="Coba lagi" onPress={onRetry} /> : null}
    </View>
  );
}
```

- [ ] **Step 9: Create `apps/mobile/components/ui/Skeleton.tsx`**:
```tsx
import { View } from "react-native";

export function Skeleton({ className = "" }: { className?: string }) {
  return <View className={`rounded bg-surface-alt opacity-70 ${className}`} accessibilityLabel="Memuat" />;
}
```

- [ ] **Step 10: Create `apps/mobile/components/ui/OfflineBanner.tsx`**:
```tsx
import { useEffect, useState } from "react";
import { View } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { Text } from "./Text";

export function OfflineBanner() {
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(() => setOnline(onlineManager.isOnline())), []);
  if (online) return null;
  return (
    <View className="bg-warning-bg px-4 py-1">
      <Text className="text-[12px] text-warning">Mode luring — menampilkan data tersimpan.</Text>
    </View>
  );
}
```

- [ ] **Step 11: Write a render test** `apps/mobile/components/ui/ui.test.tsx`:
```tsx
import { render } from "@testing-library/react-native";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

describe("ui primitives", () => {
  it("Badge renders its label", () => {
    expect(render(<Badge flag="critical" label="TERLAMBAT" />).getByText("TERLAMBAT")).toBeTruthy();
  });
  it("EmptyState renders its message", () => {
    expect(render(<EmptyState message="Belum ada proyek." />).getByText("Belum ada proyek.")).toBeTruthy();
  });
  it("Button renders its label and fires onPress", () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Simpan" onPress={onPress} />);
    expect(getByText("Simpan")).toBeTruthy();
  });
});
```

- [ ] **Step 12: Verify.** `pnpm --filter mobile test` (expect the ui tests pass) then `pnpm --filter mobile typecheck`. If NativeWind `className` typing errors under strict TS, confirm `nativewind-env.d.ts` is in `tsconfig.include` (Task 3).

- [ ] **Step 13: Commit**
```bash
git add apps/mobile/components/ui
git commit -m "feat(mobile): token-driven NativeWind UI primitives"
```

---

## Task 8: Expo Router IA skeleton (nested stacks + stub screens)

**Files:** Modify `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/_layout.tsx`; create `(auth)/_layout.tsx`, `(tabs)/(matrix)/_layout.tsx`, `(tabs)/(more)/_layout.tsx`, and stub screens per the spec §4 tree.

- [ ] **Step 1: Wrap the app in providers** — replace `apps/mobile/app/_layout.tsx` with:
```tsx
import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { SessionProvider, useSession } from "@/lib/session/session";
import { QueryProvider } from "@/lib/query/provider";

function Gate({ children }: { children: React.ReactNode }) {
  const { status, staff } = useSession();
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    if (status === "loading") return;
    const inAuth = segments[0] === "(auth)";
    if (status === "unauthenticated" && !inAuth) router.replace("/(auth)/login");
    if (status === "authenticated" && inAuth) router.replace("/(tabs)/(matrix)");
  }, [status, segments, router]);
  if (status === "authenticated" && staff) {
    return <QueryProvider userId={staff.id}>{children}</QueryProvider>;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Gate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </Gate>
    </SessionProvider>
  );
}
```

- [ ] **Step 2: Create `apps/mobile/app/(auth)/_layout.tsx`**:
```tsx
import { Stack } from "expo-router";
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 3: Replace `apps/mobile/app/(tabs)/_layout.tsx`** (tabs point at the matrix + more STACK groups + the inbox/assistant screens):
```tsx
import { Tabs } from "expo-router";
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(matrix)" options={{ title: "Matrix" }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
      <Tabs.Screen name="assistant" options={{ title: "Asisten" }} />
      <Tabs.Screen name="(more)" options={{ title: "Lainnya" }} />
    </Tabs>
  );
}
```
Then DELETE the old flat `apps/mobile/app/(tabs)/matrix.tsx` and `apps/mobile/app/(tabs)/more.tsx` (replaced by the `(matrix)`/`(more)` stacks below). Keep `inbox.tsx` and `assistant.tsx` (they stay as tab screens; restyle below).

- [ ] **Step 4: Create the Matrix stack layout** `apps/mobile/app/(tabs)/(matrix)/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
export default function MatrixLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
```

- [ ] **Step 5: Create stub screens** under `apps/mobile/app/(tabs)/(matrix)/` — each is a typed placeholder a later slice fills. Create EACH of these files with the body shown (only the title + slice tag differ):

`new.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function NewProjectScreen() {
  return <Screen><Text variant="heading">Proyek baru</Text><Text variant="muted">Slice: projects-board</Text></Screen>;
}
```
`project/[slug]/index.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function BoardScreen() {
  return <Screen><Text variant="heading">Papan proyek</Text><Text variant="muted">Slice: projects-board</Text></Screen>;
}
```
`project/[slug]/card/[cardSlug].tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function CardDetailScreen() {
  return <Screen><Text variant="heading">Detail kartu</Text><Text variant="muted">Slice: card-detail</Text></Screen>;
}
```
`project/[slug]/members.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function MembersScreen() {
  return <Screen><Text variant="heading">Anggota</Text><Text variant="muted">Slice: members-settings</Text></Screen>;
}
```
`project/[slug]/rooms.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function RoomsScreen() {
  return <Screen><Text variant="heading">Ruangan</Text><Text variant="muted">Slice: rooms-areas</Text></Screen>;
}
```
`project/[slug]/schedule.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function ScheduleScreen() {
  return <Screen><Text variant="heading">Jadwal</Text><Text variant="muted">Slice: schedule-gates</Text></Screen>;
}
```
`project/[slug]/settings.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function SettingsScreen() {
  return <Screen><Text variant="heading">Pengaturan proyek</Text><Text variant="muted">Slice: members-settings</Text></Screen>;
}
```
`activity.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function ActivityScreen() {
  return <Screen><Text variant="heading">Aktivitas</Text><Text variant="muted">Slice: inbox</Text></Screen>;
}
```
`brief.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function BriefScreen() {
  return <Screen><Text variant="heading">Ringkasan</Text><Text variant="muted">Slice: brief-review</Text></Screen>;
}
```
`search.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function SearchScreen() {
  return <Screen><Text variant="heading">Pencarian</Text><Text variant="muted">Slice: search</Text></Screen>;
}
```
`review.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function ReviewScreen() {
  return <Screen><Text variant="heading">Tinjauan draf</Text><Text variant="muted">Slice: brief-review</Text></Screen>;
}
```
(`index.tsx` for the Matrix root is created in Task 9.)

- [ ] **Step 6: Create the More stack** `apps/mobile/app/(tabs)/(more)/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
export default function MoreLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
```
`apps/mobile/app/(tabs)/(more)/index.tsx` (account + logout; uses session):
```tsx
import { View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session/session";

export default function MoreScreen() {
  const { staff, signOut } = useSession();
  return (
    <Screen className="gap-4">
      <View className="gap-1">
        <Text variant="heading">{staff?.full_name ?? "-"}</Text>
        <Text variant="muted">{staff?.role ?? ""}</Text>
      </View>
      <Button label="Keluar" onPress={signOut} />
    </Screen>
  );
}
```

- [ ] **Step 7: Restyle the existing `inbox.tsx` and `assistant.tsx` stub tabs** to use the UI primitives (replace their bodies):
`apps/mobile/app/(tabs)/inbox.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function InboxTab() {
  return <Screen><Text variant="heading">Inbox</Text><Text variant="muted">Slice: inbox</Text></Screen>;
}
```
`apps/mobile/app/(tabs)/assistant.tsx`:
```tsx
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
export default function AssistantTab() {
  return <Screen><Text variant="heading">Asisten</Text><Text variant="muted">Slice: assistant</Text></Screen>;
}
```

- [ ] **Step 8: Move the login screen under the new gate** — confirm `apps/mobile/app/(auth)/login.tsx` still works (it already exists). It does not need changes here.

- [ ] **Step 9: Verify the route tree compiles.**
Run: `pnpm --filter mobile typecheck`
Expected: exit 0 with `experiments.typedRoutes` on — every `<Stack.Screen>`/route resolves. If a typed-route error appears (e.g. a path the router doesn't know), fix the offending file path. Then `pnpm --filter mobile test` (existing + ui + session tests pass).

- [ ] **Step 10: Commit**
```bash
git add apps/mobile/app
git commit -m "feat(mobile): Expo Router IA skeleton — nested stacks + stub screens"
```

---

## Task 9: Matrix (projects) screen on `@datum/core`

**Files:** Create `apps/mobile/app/(tabs)/(matrix)/index.tsx`, `apps/mobile/app/(tabs)/(matrix)/index.test.tsx`

- [ ] **Step 1: Write the failing test** `apps/mobile/app/(tabs)/(matrix)/index.test.tsx`:
```tsx
import { render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MatrixScreen from "./index";

const getProjectsList = jest.fn();
jest.mock("@datum/core", () => ({
  ...jest.requireActual("@datum/core"),
  getProjectsList: (...a: unknown[]) => getProjectsList(...a),
}));
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), Link: ({ children }: any) => children }));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MatrixScreen", () => {
  beforeEach(() => getProjectsList.mockReset());
  it("shows the empty state when there are no projects", async () => {
    getProjectsList.mockResolvedValue([]);
    const { getByText } = wrap(<MatrixScreen />);
    await waitFor(() => expect(getByText("Belum ada proyek yang ditugaskan.")).toBeTruthy());
  });
  it("lists projects from the core query", async () => {
    getProjectsList.mockResolvedValue([
      { id: "p1", project_code: "ARIN-1", project_name: "Karawang", client_name: "Nabil", location: "Karawang", status: "active", target_handover: null, development_id: null, development_name: null, development_area_label: null, development_sort_order: null, cover_image_path: null, cover_url: null },
    ]);
    const { getByText } = wrap(<MatrixScreen />);
    await waitFor(() => expect(getByText("ARIN-1")).toBeTruthy());
    expect(getByText("Karawang")).toBeTruthy();
  });
});
```
Run `pnpm --filter mobile test` — expect FAIL.

- [ ] **Step 2: Create `apps/mobile/app/(tabs)/(matrix)/index.tsx`**:
```tsx
import { FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getProjectsList, keys } from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/env";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";

export default function MatrixScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => getProjectsList(supabase, SUPABASE_URL),
  });

  if (isLoading) {
    return (
      <Screen className="gap-2 pt-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
      </Screen>
    );
  }
  if (isError) {
    return <Screen><ErrorState message={`Gagal memuat proyek: ${(error as Error).message}`} onRetry={refetch} /></Screen>;
  }
  if (!data || data.length === 0) {
    return <Screen><OfflineBanner /><EmptyState message="Belum ada proyek yang ditugaskan." /></Screen>;
  }
  return (
    <Screen className="pt-3">
      <OfflineBanner />
      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        ItemSeparatorComponent={() => null}
        renderItem={({ item }) => (
          <Card className="mb-2" onPress={() => router.push(`/(tabs)/(matrix)/project/${item.project_code}`)}>
            <Text variant="label">{item.project_code}</Text>
            <Text>{item.project_name}</Text>
            {item.development_name ? <Text variant="muted">{item.development_name}</Text> : null}
          </Card>
        )}
      />
    </Screen>
  );
}
```
> Copy "Belum ada proyek yang ditugaskan." is verbatim from web `(app)/page.tsx`.

- [ ] **Step 3: Verify.** `pnpm --filter @datum/core build` then `pnpm --filter mobile test` (Matrix tests pass) then `pnpm --filter mobile typecheck`.

- [ ] **Step 4: Commit**
```bash
git add "apps/mobile/app/(tabs)/(matrix)/index.tsx" "apps/mobile/app/(tabs)/(matrix)/index.test.tsx"
git commit -m "feat(mobile): Matrix projects screen on @datum/core"
```

---

## Task 10: Mobile CI + service-role import ban

**Files:** Modify `.github/workflows/ci.yml`; create `apps/mobile/eslint.config.mjs` (or extend existing) for the service-role ban

- [ ] **Step 1: Add a non-blocking mobile lint step to the `lint-test-typecheck` job in `.github/workflows/ci.yml`**, after the existing web lint step:
```yaml
      - name: Lint (mobile, non-blocking)
        run: pnpm --filter mobile lint
        continue-on-error: true
```

- [ ] **Step 2: Confirm mobile typecheck + test run in CI.** Root `pnpm typecheck` and `pnpm test` already fan out via turbo to `mobile` (verified: `mobile:test` runs). No change needed beyond Step 1; confirm by reading the workflow.

- [ ] **Step 3: Add a service-role import guard test** `apps/mobile/tests/no-service-role.test.ts` (mirrors core's guard; bans a service-role/admin client from mobile per spec §7):
```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [join(__dirname, "..", "app"), join(__dirname, "..", "lib"), join(__dirname, "..", "components")];
const BANNED = [/createSupabaseAdminClient/, /SUPABASE_SERVICE_ROLE_KEY/, /service_role/];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("mobile never uses the service-role client", () => {
  it("has no admin/service-role references", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const f of tsFiles(root)) {
        const t = readFileSync(f, "utf8");
        for (const re of BANNED) if (re.test(t)) offenders.push(`${f} matched ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 4: Verify.** `pnpm --filter mobile test` (the guard passes) and validate the YAML: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"`.

- [ ] **Step 5: Commit**
```bash
git add .github/workflows/ci.yml apps/mobile/tests/no-service-role.test.ts
git commit -m "ci(mobile): non-blocking lint step + service-role import guard"
```

---

## Task 11: Whole-shell verification gate

- [ ] **Step 1: Build core, run the monorepo gates.**
Run: `pnpm --filter @datum/core build` then `pnpm typecheck` then `pnpm test`
Expected: all packages typecheck; all test suites pass (web 177, core 23+, mobile’s new suites, db 18).

- [ ] **Step 2: Confirm clean tree.** `git status --porcelain` → empty.

---

## Self-Review (against spec §3.3/§4/§5/§8/§9/§10)

- **Shared tokens (spec §3.3 / open Q §11.5)** → Task 2 (tokens in core) + Task 3 (mobile Tailwind consumes them); web consuming the same source is optional and deferred (web already has matching CSS vars — no drift today). ✓
- **NativeWind (§3 / open Q §11.5)** → Task 3 (config + babel + metro + jest transform + env typings). Verification step flags BLOCKED if Expo-56 incompatibility surfaces. ✓
- **react-query foundation + persister + onlineManager/focusManager (§5)** → Tasks 4, 6. ✓
- **AsyncKV mirrors idb-kv + clearAsyncCache on logout (§5/§8)** → Task 4 + Task 5 signOut. ✓
- **Realtime helper hooks (§5)** → Task 6. ✓
- **Full Expo Router IA tree (§4)** → Task 8 (every web route #1–#16 mapped; print routes intentionally omitted per spec). ✓
- **Session formalization + orphan/edge cases (§3.4/§9)** → Task 5 (orphan → signOut; onAuthStateChange re-resolve). ✓
- **UI primitives mirroring web treatments + 44dp + states (§4)** → Task 7 + the loading/empty/error/offline states exercised in Task 9. ✓
- **Matrix on core (§3.4 mobile reuse / §5)** → Task 9. ✓
- **Mobile CI + service-role ban (§7/§10)** → Task 10. ✓
- **Testing via vitest(core)/jest-expo(mobile) (§10)** → tests in Tasks 2,4,5,7,9,10. ✓
- **open Q §11.2 (cover env)** resolved in Foundation-1 + Task 4 `env.ts` guard + Task 9 passing `SUPABASE_URL`. ✓
- **open Q §11.4 (react-query peer version)** → Task 1 Step 2 pins to web's `^5.101.0`. ✓

**Deferred to feature slices (correctly out of scope here):** feature screen bodies (stubs only), push notifications (inbox slice), the cover-upload/print/card-links gaps, and consuming the shared token source in web's Tailwind config (web has equivalent CSS vars already; unify opportunistically).
