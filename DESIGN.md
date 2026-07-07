---
name: DATUM (Studio Brain)
description: Internal operations hub for WHAstudio's finishing-phase construction projects — warm, grounded, precise.
colors:
  oat: "#d2d0c4"
  oat-deep: "#c6c1b6"
  paper: "#fdfaf6"
  linen: "#f2efe9"
  ink: "#141210"
  ink-secondary: "#524e49"
  ink-muted: "#847e78"
  sand: "#b29f86"
  sand-dark: "#7a6b56"
  sand-tint: "#b29f861f"
  border-taupe: "#b5afa8"
  border-sub: "#9494942e"
  flag-ok: "#3d8b40"
  flag-info: "#1565c0"
  flag-warning: "#e65100"
  flag-high: "#bf360c"
  flag-critical: "#c62828"
  flag-ok-bg: "#3d8b4014"
  flag-info-bg: "#1565c014"
  flag-warning-bg: "#e651001a"
  flag-high-bg: "#bf360c1a"
  flag-critical-bg: "#c6282814"
typography:
  headline:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.sand-dark}"
  button-primary-disabled:
    backgroundColor: "{colors.ink-muted}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-outline-hover:
    backgroundColor: "{colors.linen}"
  button-accent:
    backgroundColor: "{colors.sand-tint}"
    textColor: "{colors.sand-dark}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    typography: "{typography.label}"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
    typography: "{typography.label}"
  chip-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  chip-sand:
    backgroundColor: "{colors.sand-dark}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    typography: "{typography.body}"
  table-header:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px"
---

# Design System: DATUM (Studio Brain)

## 1. Overview

**Creative North Star: "The Field Notebook"**

DATUM looks and behaves like a well-made field notebook in the hands of a quantity surveyor: warm paper surfaces on an oat ground, one engineered typeface, dense tabular truth, and color that appears only when something on site needs attention. It is the visual world of an Indonesian construction-control system — sand, oat, and warm near-black; concrete, raw earth, paper, and timber. The register is product, not marketing: quiet confidence, no decoration for its own sake, truth-on-the-page. UI language is Bahasa Indonesia by design.

The system explicitly rejects cold blue/white generic SaaS. It rejects dashboard-slop — gradient text, glassmorphism, hero-metric cards, cyan-on-dark — and it rejects decorative motion and page-load choreography, because its users are mid-task on a construction site, often outdoors in bright light on a phone with a flaky connection. Density is welcome where the data needs it; the surface stays calm and matte everywhere else. Emphasis is earned through weight, spacing, and the sand accent — never through extra colors or extra boxes.

Motion exists only to convey state — feedback, reveal, transition — at 150–250ms on exponential ease-out curves (`--ease-out-quart`, `--ease-out-quint`), and every animation is gated behind `prefers-reduced-motion`. Layout is mobile-first with a hard split at 768px: data-heavy surfaces (tables, the area × gate matrix, the Gantt) get real stacked-card alternatives on phones, not horizontal scroll. Every interactive target on a phone is at least 44px tall.

**Key Characteristics:**
- Warm-tinted everything — no pure black, no pure white, no cold gray, anywhere.
- One typeface (Space Grotesk) at varied weights; hierarchy from weight + tracking, not families.
- Solid near-black data-table headers — the signature graphic device.
- Status color (the 5-step flag ladder) fires only when something needs attention.
- Flat, matte surfaces; shadows are warm, subtle, and state-driven.
- Field-first mobile: stacked-card fallbacks, 44px touch targets, outdoor-readable contrast.
- State-conveying motion only, 150–250ms, reduced-motion respected.

## 2. Colors

A palette of earthen warm neutrals anchored by one sand accent and a disciplined five-flag status ladder — every single value tinted warm, never neutral-cold.

### Primary
- **Sand** (#b29f86): The brand's warmth. Rules, dividers, active-state tints, selection highlight (at 45% mix), and the `--sand-tint` (12% alpha) background for accented buttons and selected rows.
- **Deep Sand** (#7a6b56): The working accent. Accent text on light surfaces (passes contrast where Sand does not): section eyebrows, form labels, the global 2px keyboard-focus outline, hover borders, and the warm base of every shadow in the system.

### Neutral
- **Oat** (#d2d0c4): The page background and the signature surface. Everything sits on oat, never on white.
- **Deep Oat** (#c6c1b6): Darker oat for section dividers, segmented-control troughs, kanban column bodies, and skeleton ghosts.
- **Warm Paper** (#fdfaf6): Cards, panels, tables, inputs — the content surface. Deliberately not #fff.
- **Linen** (#f2efe9): Inactive and secondary surfaces — disabled states, floor-group rows, hover fills.
- **Warm Ink** (#141210): Warm near-black. Headlines, body text, solid table headers, active chip fills. Never #000.
- **Ink Secondary** (#524e49): Secondary text — 5.0:1 on oat, 5.9:1 on paper (WCAG AA).
- **Ink Muted** (#847e78): Placeholders and timestamps — large sizes only; it fails AA small.
- **Taupe Border** (#b5afa8): The visible 1px border on cards, tables, inputs, and outline buttons.
- **Subtle Border** (#9494942e): Hairline card borders where the taupe line would be too loud.

### Status (the Flag System)
A 5-step severity ladder, used **only** to signal state — never decoratively. Each flag pairs with an 8–10% tint background for badges, banners, and rows.

- **OK Green** (#3d8b40, tint #3d8b4014): confirmed / passed / success banners.
- **Info Blue** (#1565c0, tint #1565c014): informational status, ready-for-handoff.
- **Warning Amber** (#e65100, tint #e651001a): approaching deadlines, in-progress attention.
- **High Orange** (#bf360c, tint #bf360c1a): blocked, escalating.
- **Critical Red** (#c62828, tint #c6282814): overdue, errors, destructive actions.

All five are darkened versions of their hue so they hold contrast on warm-light surfaces.

### Named Rules
**The Warm Tint Rule.** Every color in the system is tinted warm — toward sand. Pure #000, pure #fff, and cold gray are forbidden. If a swatch would look at home in a cold blue SaaS demo, it is off-brand.

**The Flag Silence Rule.** Status colors fire only when something needs attention. A calm project reads as oat, paper, and ink; if a screen is colorful, something is genuinely wrong on site. Color is never decoration.

**The Token Rule.** All color flows through the CSS custom properties in `apps/web/app/globals.css`. Hardcoding hex in components is prohibited.

## 3. Typography

**Display/Body/Label Font:** Space Grotesk (with system-ui, sans-serif fallback)
**Data Font:** the platform mono stack (ui-monospace) for area/project codes; Space Grotesk with `tabular-nums` for numeric columns.

**Character:** One geometric-humanist sans, engineered yet approachable — precise like a spec sheet, warm like handwriting on site paper. Hierarchy comes entirely from weight, size, case, and tracking; never from a second family.

### Hierarchy
- **Headline** (600, 1.25rem / 20px, 1.3): Page and screen titles — `PROJECT-CODE · Project Name`.
- **Title** (600, 0.875rem / 14px, 1.4): Card titles, subsection headings, disclosure triggers.
- **Body** (400, 0.875rem / 14px, 1.5; `leading-relaxed` 1.625 for prose): The default working size. This is a dense product register on a fixed rem scale — no fluid clamps, no display sizes.
- **Label** (600, 11px, 0.06–0.1em tracking, UPPERCASE): Section eyebrows and form labels, usually in Deep Sand (#7a6b56). The signature "tracked caps" treatment.
- **Table Header** (700, 10px, 0.025–0.08em tracking, UPPERCASE): White-on-ink column headers.
- **Data** (500, 12px, mono): Area and project codes (`LIVING-LT1`); numeric cells set `tabular-nums`, right-aligned.

Note: 10px uppercase currently appears on some form labels and table headers. Table headers may stay at 10px (bold, white-on-ink carries them); form labels are being raised to 11–12px for outdoor readability — do not introduce new 10px form labels.

### Named Rules
**The One Family Rule.** Space Grotesk is the only typeface. A second font family is forbidden — vary weight (300–700), case, and tracking instead.

**The Tracked Caps Rule.** Anything that names a section, a column, or a field is uppercase, semibold-or-bolder, and letter-spaced (0.06–0.1em). Small but assertive; this is how the notebook labels its margins.

## 4. Elevation

This system is flat by default. Surfaces are matte planes separated by 1px taupe borders and warm background steps (oat → deep oat → paper → linen) — not by shadow stacks. Cards on the web carry a border and no shadow at rest. When shadows do appear, they are a response to state — an active segment, a pressed chip, a focused input, an opened menu — and every one of them is mixed from warm brown (#7a6b56 or #5a4a3a), never neutral gray or black. If a shadow reads gray, it is wrong.

### Shadow Vocabulary
- **Active-segment lift** (`box-shadow: inset 0 -2px 0 var(--sand-dark), 0 1px 0 color-mix(in oklch, var(--foreground) 10%, transparent), 0 3px 6px -1px color-mix(in oklch, #7a6b56 30%, transparent)`): the `.seg-active` tab — a paper surface that lifts out of the deep-oat trough, underlined in deep sand.
- **Pressed-chip weight** (`box-shadow: 0 1px 3px color-mix(in oklch, #7a6b56 35%, transparent)`): the `.chip-on` / `.chip-sand` active fill — just enough weight to feel set into the page.
- **Focus glow** (`box-shadow: 0 0 0 3px color-mix(in oklch, var(--sand) 28%, transparent), 0 6px 16px -6px color-mix(in oklch, var(--sand-dark) 45%, transparent), inset 0 1px 0 color-mix(in oklch, #ffffff 60%, transparent)`): the `.input-strong` focused state — a sand ring plus a warm lift, a confident tactile target.
- **Warm card shadow** (`0 2px 6px rgba(90, 74, 58, 0.07)`): the native-app card elevation (#5a4a3a at 7%); on the web, reserve it for floating menus and sheets.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (active, focus, overlay) — and they are always warm-mixed from #7a6b56, never gray, never black.

## 5. Components

Component character in one phrase: standard affordances, confidently set — earned familiarity over novelty, tactile without being showy.

### Buttons
- **Shape:** Softly squared (4px radius). Never pill-shaped, never sharp 0px.
- **Primary:** Solid Warm Ink fill (#141210) with Warm Paper text (#fdfaf6), uppercase semibold 12px tracked label, ~8px × 16px padding, min-height 40–44px. Hover shifts the fill to Deep Sand (#7a6b56). Disabled fills with Ink Muted (#847e78).
- **Outline (secondary):** 1px Taupe Border (#b5afa8), Warm Ink text, transparent-to-paper background; hover fills Linen (#f2efe9). Destructive variants keep the outline shape but set text to Critical Red (#c62828) with a critical-tint hover.
- **Accent (AI / special actions):** Sand-tint background (#b29f861f), 1px Sand border, Deep Sand bold uppercase text, usually with a 13px inline spark icon. Hover deepens the border and lifts the fill to paper.
- **Hover / Focus:** All state changes ease at 120ms; keyboard focus is the global 2px Deep Sand outline, offset 2px, applied instantly (never transitioned).

### Chips
- **Style:** Pill-shaped (999px — the one permitted pill), 1px taupe border on paper, uppercase semibold 11px tracked label in Ink Secondary. Min-height 36px on desktop, 44px on phones.
- **State:** Active (`.chip-on`) flips to a solid Warm Ink fill with paper text and the warm pressed shadow; the sand variant (`.chip-sand`) fills Deep Sand. A compact variant (10px, 32–36px tall) exists only for mobile column-jump navigation strips.

### Cards / Containers
- **Corner Style:** 4px (list cards) to 8px (panels, `rounded-lg`).
- **Background:** Warm Paper (#fdfaf6) on the oat ground; editing states swap to Linen (#f2efe9) with a Deep Sand border.
- **Shadow Strategy:** none at rest — 1px border does the work (see Elevation).
- **Border:** 1px Taupe (#b5afa8); dashed taupe for empty states with italic secondary text.
- **Internal Padding:** 8–12px for dense list cards, 16px for panels.
- **Meaning:** semantics ride on small label chips and 8px dots inside the card — never on a colored left border. Work cards (kanban) stack: label/deadline chips (8.5px bold uppercase micro-chips) → 12px medium title → 10px secondary summary → 10px muted date; hover swaps the border to Deep Sand.

### Inputs / Fields
- **Style:** 1px Taupe stroke on Warm Paper (forms sitting on paper use an Oat input well), 4–6px radius, 14px text, 8px × 12px padding. Labels above: 11px uppercase tracked Deep Sand. Code fields go mono 12px; numeric fields right-align with `tabular-nums`.
- **Focus:** border shifts to Deep Sand; the assistant-grade `.input-strong` adds the sand focus glow and brightens to white.
- **Error / Disabled:** errors render as flag banners (1px Critical border, critical tint bg, critical text, entering with `.flag-pop`); success banners mirror in OK Green. Disabled drops to 50–55% opacity, `cursor: not-allowed`.
- **Selects:** always the brand-styled native `<select>` (`.select-brand`) — platform a11y kept, look replaced: paper surface, taupe border, a Deep Sand CSS-triangle caret pair.

### Navigation
- **Segmented control** (`.seg`): a Deep Oat pill trough (8px radius, 3px padding) holding uppercase 11px buttons; the active segment is a paper surface with the warm active-lift shadow and a deep-sand inset underline, weight jumping 500 → 700.
- **Filter ladders** use chips (Aktif / Tertunda / Selesai); mobile kanban navigation uses the compact chip strip with scroll-snap columns (86vw cards, snap-center).
- **Menus & sheets:** overflow menus enter with `.menu-pop` (160ms, scale 0.98 from anchor corner); the mobile assistant sheet slides up with `.sheet-in` (240ms quint). Disclosure panels expand via the `.reveal` grid-rows pattern (240ms) with content removed from the tab order when collapsed.

### Data Table (signature component)
The most recognizable graphic device in the system: a **solid Warm Ink header row** (#141210) with Warm Paper text — 10px bold uppercase tracked — over paper body rows divided by 1px taupe rules. Group rows (floors) run Linen with Deep Sand uppercase labels. Numeric columns right-align in `tabular-nums`; code columns go mono. Row hover fills Linen. Below 768px the table is **hidden entirely** and replaced by stacked cards — the table never pans horizontally on a phone.

### Named Rules
**The Card Fallback Rule.** Every data-dense surface (table, matrix, Gantt, board) ships a real stacked-card mobile alternative behind the 768px breakpoint. Horizontal panning is not a mobile strategy.

**The 44px Field Rule.** On phones, every interactive target is at least 44px tall. Site supervisors wear gloves and squint in sunlight; elegance never outranks tappability.

## 6. Do's and Don'ts

### Do:
- **Do** route every color through the CSS custom properties in `apps/web/app/globals.css` — tokens, not hex, in components.
- **Do** tint every neutral warm, toward sand. Oat (#d2d0c4) ground, Warm Paper (#fdfaf6) surfaces, Warm Ink (#141210) text.
- **Do** use the solid near-black table header (white 10px uppercase on #141210) as the primary data device.
- **Do** reserve color for status meaning (the 5-flag ladder) and the sand accent; everything else stays neutral.
- **Do** ship stacked-card mobile fallbacks for tables, the matrix, and the Gantt (`md:hidden` pattern), with 44px touch targets on phones.
- **Do** keep motion state-conveying only: 150–250ms, `--ease-out-quart`/`--ease-out-quint`, always gated behind `prefers-reduced-motion`.
- **Do** keep shadows warm (mixed from #7a6b56) and radii soft (4/6/8px).
- **Do** write UI copy in Bahasa Indonesia, directly in the components.
- **Do** hold WCAG AA: `--text-secondary` for small secondary text, `--text-muted` at large sizes only, visible 2px Deep Sand focus outlines everywhere.

### Don't:
- **Don't** use cold blue/white generic SaaS styling — the brand deliberately rejects it. Never pure black (#000), pure white (#fff), or cold gray; every color is tinted warm.
- **Don't** ship dashboard-slop: gradient text, glassmorphism, hero-metric cards, or cyan-on-dark.
- **Don't** add decorative motion or page-load choreography — users are mid-task on site.
- **Don't** reach for a paid third-party service or a heavy new dependency; every solution must stay maintainable by 1–2 people.
- **Don't** introduce a second font family. Space Grotesk, weights 300–700, is the entire typographic voice.
- **Don't** use bright/neon stoplight status colors — only the darkened flag set (#3d8b40 / #1565c0 / #e65100 / #bf360c / #c62828).
- **Don't** carry meaning with a colored left border on cards — the 4px-stripe pattern was explicitly retired as lazy. Use the dot or a label chip.
- **Don't** default to pill buttons or sharp 0px corners; the pill radius belongs to filter chips alone.
- **Don't** let tables, the matrix, or the Gantt clip or pan horizontally on a 320–375px screen — reflow into cards instead.
- **Don't** abstract UI text into i18n keys — Bahasa Indonesia is by design.
