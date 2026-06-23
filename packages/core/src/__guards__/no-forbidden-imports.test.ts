import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const BANNED = [
  /from\s+["']server-only["']/,
  /from\s+["']next(\/|["'])/,
  /from\s+["']react(\/|["'])/,
  /from\s+["']react-dom(\/|["'])/,
  /from\s+["']react-native(\/|["'])/,
  /from\s+["']expo(\b|\/)/,
  /import\s+["']server-only["']/,
];

// RN-incompatible globals — core must not use these so it stays isomorphic.
const FORBIDDEN_GLOBALS = [
  /\bcrypto\./,
  /\bnew FormData\b/,
  /[:<]\s*FormData\b/,
  /\bFormDataEntryValue\b/,
  /\bwindow\./,
  /\bdocument\./,
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("@datum/core import hygiene", () => {
  it("never imports next/server-only/react/react-native/expo", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const re of BANNED) {
        if (re.test(text)) offenders.push(`${file} matched ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never uses RN-incompatible globals (crypto./FormData/window./document.)", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN_GLOBALS) {
        if (re.test(text)) offenders.push(`${file} matched ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
