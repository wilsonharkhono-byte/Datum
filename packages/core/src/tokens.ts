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
