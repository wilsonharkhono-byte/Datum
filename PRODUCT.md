# Product

## Register

product

## Users

WHAstudio staff — a small Indonesian interior design & construction studio. Two contexts:

- **Office (desktop)**: Wilson (principal, cost-visible) and designers managing projects, areas, gates, schedules, and team access from a desk.
- **Field (mobile)**: site supervisors on construction sites checking readiness matrices, schedules, and work cards from phones, often outdoors in bright light on flaky connections.

The job to be done: coordinate finishing-phase construction work — which room is ready for which trade, when, and who does what next. Users are in a task, frequently mid-site-visit; the tool must answer fast and stay out of the way.

## Product Purpose

DATUM (Studio Brain) is the internal operations hub for WHAstudio's finishing-phase projects: projects → areas (rooms) → gates (A–H construction phases) → readiness matrix → kanban work cards → AI assistant → Gantt schedule → member access. It replaces Trello + spreadsheets. Success = field and office staff trusting it as the single source of truth for "what's the state of this room / this project right now." Not a shipped SaaS — internal tooling maintained by 1–2 people; correctness and maintainability beat architectural elegance.

## Brand Personality

**Warm, grounded, precise** (from the SANO/WHAstudio brand standard). The visual world of an Indonesian construction-control system: sand, oat, and warm near-black — concrete, raw earth, paper, timber. Feels like a well-made field notebook or a quantity surveyor's spec sheet: quiet confidence, no decoration for its own sake, truth-on-the-page. Keywords: earthen · tactile · documentary · disciplined · low-stimulus · trustworthy. UI language is Bahasa Indonesia by design — do not abstract into i18n keys.

## Anti-references

- Cold blue/white generic SaaS (the brand deliberately rejects it). Never pure black, pure white, or cold gray — every color is tinted warm.
- Dashboard-slop: gradient text, glassmorphism, hero-metric cards, cyan-on-dark.
- Decorative motion / page-load choreography — users are mid-task on site.
- Anything requiring a paid third-party service or heavy new dependency; solutions must stay maintainable by 1–2 people.

## Design Principles

1. **Truth-on-the-page** — status colors (the `--flag-*` system) fire only when something needs attention; the surface stays calm and matte otherwise.
2. **Field-first mobile** — phones on construction sites are a primary client, not an afterthought. Data-heavy surfaces (tables, matrix, Gantt) need real mobile alternatives (card/list fallbacks), not just horizontal scroll. 44px touch targets on phones.
3. **Earned familiarity** — standard affordances (native selects styled via `.select-brand`, segmented controls, chips); consistency screen-to-screen over novelty.
4. **Tokens, not hex** — all color through the CSS custom properties in `apps/web/app/globals.css`; never hardcode hex in components.
5. **Low-stimulus discipline** — motion conveys state (feedback, loading, reveal) at 150–250ms with reduced-motion alternatives; density is welcome where the data needs it.

## Accessibility & Inclusion

- WCAG AA as the working bar: `--text-secondary` passes AA on oat and surface; `--text-muted` is large-sizes-only.
- Visible keyboard focus everywhere (2px `--sand-dark` outline, already global).
- Reduced motion respected (`prefers-reduced-motion` gates existing skeleton pulse; all new motion must do the same).
- Outdoor readability matters: field users in bright sunlight — favor contrast and ≥12px labels over elegance.
- Reflow (WCAG 1.4.10): no horizontally clipped content at 320–375px widths.
