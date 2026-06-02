# DATUM

Internal coordination hub for **WHAstudio** finishing-phase projects. Built on Turborepo + Next.js 16 + Expo (React Native) + Supabase, Bahasa-default.

This repo is **Slice 0 (Foundation)** of the [DATUM Phase 1 plan](https://github.com/wilsonharkhono-byte/Datum). See `projects/datum-slice-0-foundation-plan` in the gbrain knowledge base for the executable plan.

---

## What's here

| Path | Purpose |
|---|---|
| `apps/web` | Next.js 16 admin / API (port 3000) |
| `apps/mobile` | Expo / React Native app (iOS + Android via Expo Go or dev build) |
| `packages/db` | Supabase migrations, RLS policies, seed scripts, generated TypeScript types |
| `packages/types` | Hand-written shared domain types (`Role`, `GateCode`, `ReadinessState`, etc.) |
| `whastudio-ai-blueprint.md` | Original DATUM blueprint v1.1 (project source) |
| `whastudio-software-architecture-plan.md` | Original architecture plan v0.2 |
| `assets/` | SAN Finishing Guide + Sistem Kontrol v3.0 PDFs, CAD checklist, sample Trello exports |

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node | **22+** (LTS) | `brew install node@22` or via [nvm](https://github.com/nvm-sh/nvm): `nvm install 22 && nvm alias default 22` |
| pnpm | **11+** | `brew install pnpm` or `npm i -g pnpm@11` |
| Supabase CLI | **2.x** | `brew install supabase/tap/supabase` |
| Git | any recent | already on macOS |

Verify with:
```bash
node -v   # v22.x
pnpm -v   # 11.x
supabase --version
```

---

## First-time setup

### 1. Clone

```bash
git clone https://github.com/wilsonharkhono-byte/Datum.git
cd Datum
```

### 2. Install dependencies

```bash
pnpm install
```

This installs the workspace + downloads all transitive deps. First install takes 1-3 minutes.

### 3. Environment variables

Three `.env*` files hold the Supabase credentials. They are **never committed** (in `.gitignore`).

Create them at the listed paths:

```bash
# Get credentials from https://supabase.com/dashboard/project/_/settings/api
cp .env.example .env
# Edit .env and fill in:
#   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   (public anon key)
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...        (server-only secret)
```

Then create the two per-app local env files (Next.js and Expo each read their own):

```bash
mkdir -p apps/web apps/mobile

cat > apps/web/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2-)
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)
EOF

cat > apps/mobile/.env.local <<EOF
EXPO_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2-)
EXPO_PUBLIC_SUPABASE_ANON_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)
EOF

chmod 600 .env apps/web/.env.local apps/mobile/.env.local
```

### 4. Link Supabase CLI to your project

```bash
cd packages/db/supabase
supabase login                                                       # one-time
supabase link --project-ref nsmyazmxwdvwtdtqjrpx                     # the Datum project
cd ../../..
```

### 5. Apply schema + seed pilot data

```bash
pnpm db:reset    # WARNING: DESTRUCTIVE — drops + reapplies all migrations to the linked DB
pnpm db:seed     # safe to re-run (upserts everywhere)
pnpm db:types    # regenerate TypeScript types after any schema change
```

After `db:seed` you have:
- 2 staff users: Wilson (principal, cost-visible) + Carissa (designer)
- 2 pilot projects: BDG-H1, PKW-PC1012
- 15 areas across the two projects
- 120 `area_gate_status` matrix cells (15 x 8 gates)

---

## Run locally

### Web (port 3000)

```bash
pnpm --filter web dev
```

Open http://localhost:3000 — should redirect you to `/login`.

### Mobile (Expo)

```bash
pnpm --filter mobile start
```

Then either:
- Press `i` for iOS Simulator (Xcode required)
- Press `a` for Android emulator (Android Studio required)
- Scan the QR with Expo Go on a physical device

---

## Test credentials (Slice 0 seed)

| Email | Password | Role | Cost visibility |
|---|---|---|---|
| `wilson@datum.local` | `password123` | Principal | yes |
| `carissa@datum.local` | `password123` | Designer | — |

---

## Tests

```bash
pnpm typecheck                # all 4 packages
pnpm test                     # unit + render tests
pnpm --filter web test:e2e    # Playwright E2E (web)
```

---

## Common pitfalls

- **`pnpm` warns about Node version** — you're on Node 20 or older. Upgrade to Node 22+ (see Prerequisites).
- **`supabase link` asks for DB password** — set it via the Supabase dashboard under Settings > Database, then re-run.
- **`apps/web` build complains about `@datum/db` import** — run `pnpm install` again from repo root, then `pnpm db:types` to regenerate.
- **Expo on physical device can't reach localhost** — Expo Go on a phone needs the dev server to be on the same network. If it can't connect, use a tunnel: `pnpm --filter mobile start --tunnel`.

---

## Repository conventions

- **Bahasa Indonesia is the default UI language.** English exists as fallback in `messages/en.json`.
- **All schema changes go through a new migration** in `packages/db/supabase/migrations/`. Never edit an applied migration after it's deployed — write a new one.
- **Secrets never get committed.** `.env`, `.env.local`, and `.env.*.local` are gitignored. CI reads from GitHub repo secrets.
- **RLS is enforced.** Service-role bypass is used only in seed scripts and inside server API routes — never in client code.
- **Append-only audit.** Nothing is deleted in the DB. Corrections create new rows in `record_revisions` and `project_events`.

---

## Slice 0 scope

This is the **foundation** layer. The matrix UI, AI Assistant, calendar engine, and Inbox arrive in Slices 1-5 — see `projects/datum` in the gbrain knowledge base for the spec and `projects/datum-slice-0-foundation-plan` for this slice's executable plan.

## Stack

Turborepo · pnpm 11 · TypeScript 5 · Next.js 16 · React 19 · Expo SDK · React Native · Supabase (Postgres 15 + Auth + Storage) · @supabase/ssr · Tailwind v4 · Vitest · Playwright · Jest + React Native Testing Library · GitHub Actions
