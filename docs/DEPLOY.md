# DEPLOY — Production deploy & migration runbook

Solo-operator runbook for shipping DATUM to production. Keep it tight; follow the order.

## Overview

- **Monorepo:** pnpm workspaces.
  - `apps/web` — Next.js 16, deployed on **Vercel** (Pro plan).
  - `packages/db` — Supabase migrations (`packages/db/supabase/migrations`) + generated types (`packages/db/src/types.generated.ts`).
- **Production = the `main` branch.** Vercel auto-deploys on push to `main`; PRs get preview deploys.
- **CI** (`.github/workflows/ci.yml`) runs typecheck + tests (plus e2e on PRs). **CI does NOT deploy** — Vercel handles deploys independently.

## Deploy

1. Merge / push to `main`.
2. Vercel auto-builds and promotes the new deployment to production. No manual deploy command.
3. If the change depends on a new DB migration, run the migration (see below). App code tolerates un-applied migrations, so deploy order is flexible — but the feature stays dormant until you push the migration.

## Database migrations

Migrations live in `packages/db/supabase/migrations`. To apply them to the linked Supabase project:

```bash
pnpm db:migrate     # runs `supabase db push`
```

> **GOTCHA — use a globally-installed Supabase CLI v2.**
> The workspace-pinned `supabase` dependency is **v1**, and running the push through pnpm can fail on PG17 config. Use a global Supabase CLI **v2** for `db:migrate` (push) and `db:types`. Verify with `supabase --version`.

**Deploy ↔ migration ordering:** the app is written to tolerate un-applied migrations. For example, the `analyze-attachments` cron returns `{ "skipped": "migration_pending" }` (HTTP **200**) when its `claim_attachments_for_analysis` RPC is absent, instead of erroring. So you may **deploy first, then run `pnpm db:migrate`**.

> ⚠️ **Footgun:** Features that depend on new schema stay **dormant** until the migration is pushed, and there is **no automatic alert** when a migration is pending. Don't forget to run `pnpm db:migrate` after deploying a schema-dependent change.

## Type generation

After **any** schema change, regenerate the TypeScript types and commit them:

```bash
pnpm db:types     # runs `supabase gen types typescript --linked`
```

Then commit `packages/db/src/types.generated.ts`.

> ⚠️ **Footgun:** There is **NO CI check** that the generated types match the migrations. Regenerating is a **manual step**. If you change schema and skip `pnpm db:types`, the committed types silently drift out of sync — nothing will warn you.

## Environment variables

Set these in the **Vercel project env** AND in **local `.env`** (see `.env.example`):

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-only secret; never commit |
| `ANTHROPIC_API_KEY` | yes | chat assistant + attachment captions |
| `ANTHROPIC_MODEL` | optional | model override; defaults in code |
| `CRON_SECRET` | yes | cron auth — Vercel sends `Authorization: Bearer $CRON_SECRET`; without it the cron route returns 401 and does nothing |
| `TRELLO_API_KEY` / `TRELLO_API_TOKEN` | only for import scripts | not needed for the app/cron |

**Sentry (optional):** all Sentry vars are optional. The SDK is **disabled** until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set, so it ships as a no-op before the DSN exists. Setting `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` enables source-map upload at build time on Vercel.

## Rollback

- **Vercel dashboard → instant rollback** to a previous deployment.
- ⚠️ Rolling back **code does NOT roll back DB migrations**. Treat migrations as **forward-only** and avoid destructive ones, so an older deployment still runs against the current schema.

## Incident checklist — attachment captions stopped appearing

1. **Check Vercel function logs** for the `[cron/analyze-attachments]` prefix.
2. **Verify the migration is applied** — confirm the `claim_attachments_for_analysis` RPC exists in Supabase (if missing, the cron returns `{ "skipped": "migration_pending" }`).
3. **Verify `CRON_SECRET` is set** in the Vercel project env (a missing/wrong secret → 401, cron does nothing).
4. **Inspect `card_attachments`** rows in Supabase — check the `ai_status` and `ai_error` columns for per-attachment failures.
