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
      fontFamily: {
        sans: ["SpaceGrotesk_400Regular"],
        normal: ["SpaceGrotesk_400Regular"],
        medium: ["SpaceGrotesk_500Medium"],
        semibold: ["SpaceGrotesk_600SemiBold"],
        bold: ["SpaceGrotesk_700Bold"],
      },
    },
  },
  corePlugins: {
    // Emit plain hex colors instead of rgb(... / var(--tw-*-opacity)) —
    // the CSS-variable path is fragile in native release builds and a
    // failed var() resolves text to default black (invisible on primary).
    textOpacity: false,
    backgroundOpacity: false,
    borderOpacity: false,
    // font-medium/semibold/bold map to Space Grotesk font FILES above
    // (Android does not synthesize weights for custom fonts). The default
    // fontWeight plugin emits colliding font-weight rules that win the
    // cascade and silently drop the custom font — disable it.
    fontWeight: false,
  },
  plugins: [],
};
