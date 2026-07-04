# AUDIT_SECURITY.md — Security & Trust-Boundary Audit (2026-07-04)

Read-only audit of `apps/web` + `packages/db` migrations + `packages/core`, framed
around the correct trust boundary for a Supabase app: **RLS is the security
boundary; the `packages/db` query layer is not.** Every finding assumes an
authenticated attacker who calls the Supabase REST + Realtime API directly with
the public anon key and their own JWT, bypassing the Next.js app entirely.

This report merges two independent passes (a full-file RLS sweep of all ~60
migrations + a targeted app-surface pass). Every headline finding below was
**personally re-verified in source** — the verification command/line is cited.
No secret values are printed anywhere in this document.

---

## REMEDIATION STATUS (2026-07-04)

Findings 1–5 are **fixed and behaviorally verified**. Five migrations were added
(`packages/db/supabase/migrations/20260704000001`–`…000005`) and exercised against
a local ephemeral Postgres by emulating each role via `SET ROLE authenticated` +
JWT claims (exactly as PostgREST does). 18/18 assertions passed — each exploit is
blocked and each legitimate path still works — inside a rolled-back transaction
(prod untouched). ⚠️ **These take effect only after Wilson runs `supabase db push`
to prod.** No TypeScript / generated-types change is required.

| Finding | Migration | Fix | Verified |
|---|---|---|---|
| 1 (CRITICAL) | `…000001` | BEFORE UPDATE trigger on `staff` rejects role/cost_visible change unless caller is principal/admin (service-role/no-JWT exempt) | self-promote blocked; own-name edit + manager change + admin flow all still work |
| 2 | `…000002` | `notifications_insert` requires `actor_staff_id = current_staff_id()`, project readable, in-app `/…` link (no `//host`) | actor-spoof / external-link / cross-project blocked; legit self-actor allowed |
| 3 | `…000003` | `compute_project_schedule` + `seed_area_steps` gain `current_can_read_project` guard; `seed_default_topics` + `mark_areas_stale_for_card` EXECUTE revoked from client roles (trigger-only) | foreign-project RPC + revoked RPCs blocked; own-project allowed |
| 4 | `…000004` | `project_staff` INSERT/UPDATE → `current_can_manage_projects()` (was cross-project-read, incl. estimator). **Behavior change: estimators can no longer manage rosters.** | estimator write blocked; principal write allowed |
| 5 | `…000005` | Revoke table-level SELECT on `material_items` from authenticated/anon; re-grant SELECT on all columns except `unit_price`,`currency` | cost columns blocked; non-cost columns still readable |

**Finding 6 (area_gate_status member writes) — NOT YET FIXED.** Its safe fix is a
gate-ordering `BEFORE` trigger (which also implements AUDIT_LOGIC.md #1's DB-side
predecessor enforcement); a blunt RLS tightening would break the legitimate
recompute-on-event path that runs under ordinary members' sessions. Left for a
focused follow-up alongside the logic-audit remediation.

Findings 7 (public covers bucket), 8 (anon `developments`), 9 (no-auth routes)
are Low / by-design and were not changed.

---

## STEP 1 — Trust boundary map

- **User-controlled:** every HTTP body/query param to Server Actions + `/api/*`
  routes; **and — critically — every direct PostgREST/Realtime/RPC call.** The
  anon key (`NEXT_PUBLIC_SUPABASE_*` / `EXPO_PUBLIC_*`) ships to every browser and
  phone, so any authenticated staff member can issue arbitrary
  `GET/POST/PATCH /rest/v1/<table>` and `POST /rest/v1/rpc/<fn>` calls. The app's
  Zod validation and query functions are **not** in this path.
- **Reaches Supabase under the caller's JWT (RLS enforced):** the SSR cookie
  client (`lib/supabase/server.ts`) and the Bearer client
  (`lib/supabase/from-request.ts`, anon key + forwarded JWT). RLS is the only
  thing between these and the data.
- **Reaches Supabase as service-role (RLS BYPASSED):** `createSupabaseAdminClient()`
  ([apps/web/lib/supabase/admin.ts](apps/web/lib/supabase/admin.ts)) — `import
  "server-only"`, key from `SUPABASE_SERVICE_ROLE_KEY` (not `NEXT_PUBLIC`). Used
  only by `/api/staff/create` and the three `/api/cron/*` routes; each gates auth
  **before** constructing the admin client. **Verified not shipped to the
  browser** (`grep service_role apps/web/.next/static` → no hits).

**Key-exposure verdict: CLEAN.** service_role is never `NEXT_PUBLIC`, never in a
client component, never in the static bundle. The anon key is public *by design*
— which makes **RLS the entire ballgame.**

### The authorization model (how the predicates work)

All project scoping flows through `SECURITY DEFINER` helpers in
`20260531000002_rls_policies.sql` (all `stable`, all `set search_path = public`,
all `revoke from public` + `grant to authenticated` — correctly hardened):

- `current_is_assigned(project)` → active `project_staff` row for `auth.uid()`.
- `current_has_cross_project_read()` → **`staff.role IN ('principal','admin','estimator')`** — true for ALL projects.
- `current_can_read_project(p)` = cross-read OR assigned.
- `current_cost_visible_for(p)` → `staff.cost_visible` OR `project_staff.cost_visible`.
- `current_can_manage_projects()` → `staff.role IN ('principal','admin')`.

For ordinary roles (`designer`, `pic`, `site_supervisor`) these genuinely require
project membership — the model is properly tenant-scoped. **But every predicate
ultimately reads `staff.role` / `staff.cost_visible`, and the `staff` self-update
policy lets a user rewrite those columns (Finding 1). That is the systemic
weakness the rest of the model rests on.**

RLS coverage baseline is otherwise strong: **all 44 tables have RLS enabled**
(1:1 `create table` ↔ `enable row level security`). No table is ever left
unprotected. SECURITY DEFINER `search_path` hardening is consistently correct
(the one gap, `seed_topics_on_project_insert` in `…000005`, was fixed in
`…000006`).

---

## STEP 3 — Ranked findings (exploitability × impact, worst first)

| # | Sev | Where (file:line) | Vulnerability | Exploit (direct REST/RPC, anon key + attacker JWT) | Fix |
|---|-----|-------------------|---------------|----------------------------------------------------|-----|
| **1** | 🔴 **CRITICAL** | `20260531000002_rls_policies.sql:116-118` (`staff_update_self`) — **VERIFIED; no later migration or trigger locks it (only trigger on `staff` is `trg_staff_updated_at`, a timestamp updater).** | **Privilege escalation via self-update of `role`/`cost_visible`.** `for update using (id = auth.uid()) with check (id = auth.uid())` pins only row identity — the `role` and `cost_visible` columns are unfrozen, and they are the sole inputs to `current_has_cross_project_read()`, `current_can_manage_projects()`, `current_cost_visible_for()`. | Any logged-in staffer: `PATCH /rest/v1/staff?id=eq.<self>` `{"role":"admin","cost_visible":true}`. Instantly gains firm-wide cross-project read, project/area/roster/step-library management, and all cost data. **Defeats essentially the entire RLS model.** | Freeze privileged columns in the with-check (`role = (select role from staff where id = auth.uid()) and cost_visible = (...)`), **or** drop `staff` UPDATE from RLS entirely and route role/cost changes through a `current_can_manage_projects()`-gated SECURITY DEFINER RPC. |
| **2** | 🟠 **Med–High** | `20260601000014_notifications.sql:52-53` (`notifications_insert`) — VERIFIED | **Notification spoofing / in-app phishing.** `with check (auth.uid() is not null)` — any authenticated staffer can insert a notification for ANY `recipient_staff_id` with attacker-controlled `summary`, `link` (free-text in-app URL), and `actor_staff_id`. | `POST /rest/v1/notifications {recipient_staff_id:<victim>, kind:"mention", summary:"Approve pembayaran di sini", link:"/project/…/evil", actor_staff_id:<trusted>}`. Victim sees a forged "system" notification and clicks a link the attacker chose; also enables queue flooding. (SELECT is correctly scoped to recipient.) | With-check tying the row to the actor + project: `actor_staff_id = current_staff_id() AND (project_id IS NULL OR current_can_read_project(project_id))`, constrain `link` to an in-app prefix, or make inserts service-role/producer-RPC only. |
| **3** | 🟠 **Med** | `20260601000019:7,50-51` (`compute_project_schedule`), `20260620000003:61-62` / `20260625000001:156` (`seed_area_steps`), `20260601000006:29` (`seed_default_topics`), `20260601000013:24` (`mark_areas_stale_for_card`) — **VERIFIED: all `grant execute … to authenticated`, all SECURITY DEFINER, all jump `begin`→`insert` with no membership guard** (contrast `resolve_card_event` `20260611000002:26` which *does* check). | **Cross-project writes via unguarded SECURITY DEFINER RPCs.** Each takes an arbitrary project/area id and mutates that project's rows *as the definer*, bypassing RLS, with no `current_can_read_project` check. | `POST /rest/v1/rpc/compute_project_schedule {"p_project_id":"<any-project>"}` overwrites another project's gate target dates; `seed_area_steps`/`seed_default_topics` inject rows into foreign projects; `mark_areas_stale_for_card` flips foreign staleness. Bounded (idempotent/deterministic, no exfiltration) but unauthorized cross-tenant writes. | Add `if not current_can_read_project(p_project_id) then raise exception 'not authorized'` at the top of each (the `resolve_card_event` pattern), or convert to SECURITY INVOKER and rely on target-table write policies. |
| **4** | 🟠 **Med** | `20260601000017_project_staff_write_rls.sql:11-19` — VERIFIED | **`project_staff` INSERT/UPDATE open to `estimator`.** Gated by `current_has_cross_project_read()`, which *includes* `estimator`. An estimator can assign anyone (incl. self) to any project and set `cost_visible=true` on that assignment — power otherwise reserved to `current_can_manage_projects()` (principal/admin). | Estimator: `POST /rest/v1/project_staff {project_id:<any>, staff_id:<self>, cost_visible:true}` → self-assign + cost visibility on any project. (Also trivially reachable post-Finding 1.) | Gate `project_staff` writes on `current_can_manage_projects()` instead of `current_has_cross_project_read()`. |
| **5** | 🟡 **Med** | `20260531100005_rls_new_tables.sql:105-106` (`material_items_read`) — VERIFIED (grep: no cost gate ever added) | **Cost data (`unit_price`, `currency`, `quantity`) leaks to non-cost-visible staff.** Row policy gates only on `current_can_read_project` — the `current_cost_visible_for` branch promised in the `20260531100002:141` / `20260531100003:2` comments was never implemented. `vendor_quotes`/`invoices`/cost-flagged `card_events` ARE correctly gated; this table is the hole. | Non-cost member: `GET /rest/v1/material_items?project_id=eq.<id>&select=name,unit_price` reads every unit price the `cost_visible` flag is meant to hide. | Postgres RLS can't filter columns — move cost columns to a cost-gated child table (like `vendor_quotes`), or `REVOKE SELECT(unit_price,…) FROM authenticated` + a `current_cost_visible_for`-gated view. |
| **6** | 🟡 **Med** | `20260603000001_area_gate_status_write_rls.sql:19-29` — VERIFIED (pairs with AUDIT_LOGIC.md #1/#2) | **Any project member can forge readiness/gate state directly.** INSERT/UPDATE granted to `current_can_read_project` — every reader can write `status`/`score`/`actual_end_date`/`stale`. No DB-side sequence invariant; the app's `markGatePassed` predecessor guard is bypassed on a direct REST call. | Member: `PATCH /rest/v1/area_gate_status?…` sets Gate H `status=passed, actual_end_date=today` while Gate B is `blocked`. Dashboards/briefs/schedule/reminders now show fabricated "done." Integrity, not exfiltration. | Route writes through the recompute/advance path only (service-role or gated RPC), drop the broad member-write policy, add a `BEFORE UPDATE` trigger enforcing gate ordering. |
| **7** | 🟢 **Low** | `20260615000004:44-55` (`project-covers` bucket) — VERIFIED `public=true` | **Public storage bucket.** Cover images are world-readable at `/storage/v1/object/public/project-covers/<project_id>/<file>` with no auth. Intentional per comment ("non-confidential renders"); writes principal/admin only. | Not enumerable (needs 2 UUIDs), but URLs leak via caching/referrers/sharing → permanent unauthenticated read of that client render. | Acceptable iff covers are truly non-confidential. If any client work is sensitive: private bucket + signed URLs (as `card-attachments` already does). Document "never upload confidential imagery as a cover." |
| **8** | 🟢 **Low** | `20260615000004:23-24` (`developments_select`) — VERIFIED `using (true)`, no `TO authenticated` | **Anon-readable config.** No `TO` clause → applies to `anon`; Supabase's default base grants let unauthenticated callers `GET /rest/v1/developments` and read project-group/neighbourhood names + area labels. Sibling config (`gates`) uses `auth.uid() is not null`. | `GET /rest/v1/developments?select=name` with only the anon key, no login. Low sensitivity. | `for select to authenticated using (true)`. |
| **9** | 🟢 **Low** | `apps/web/app/api/cards/[cardId]/next-deadline/route.ts:4-11`; `apps/web/app/api/assistant/snippet/route.ts:5-15` — VERIFIED (both use RLS-scoped clients) | **No explicit auth gate — RLS-only defense.** Neither calls `getUser()`; both pass a URL-supplied `cardId` to a query. Safe today (RLS-scoped client returns null/404 to an unauthenticated caller) but no 401 and no defense-in-depth. | Latent: the day either helper is refactored onto an admin client (as cron paths already use), `GET /api/cards/<guessed-uuid>/next-deadline` becomes instant cross-project IDOR. | Add an explicit `getUser()`→401 gate, matching `board/[code]`, `card/[code]/[slug]`, `assistant/message`. |

### Sound / verified-clean subsystems (one line each)

- **service_role isolation** — `server-only` admin client, key not `NEXT_PUBLIC`, absent from static bundle. VERIFIED.
- **Bearer auth** ([from-request.ts](apps/web/lib/supabase/from-request.ts)) — anon key + forwarded JWT; `auth.getUser()` validates against GoTrue, so forged/expired tokens → 401, never service-role. VERIFIED.
- **`/api/staff/create`** — auth (`getCurrentStaff`→401) → authz (`canManageAccess`→403) → Zod → role-escalation guard (only principals mint principal/admin) → admin client last. VERIFIED. *(Note: this app-layer guard is undercut by Finding 1, which lets a user self-mint admin directly in the DB, skipping this route.)*
- **Cron routes** — all three check `CRON_SECRET` Bearer **before** constructing the admin client. VERIFIED.
- **`card-attachments` storage** — private bucket, path-prefix scoped to a readable `project_id`, update restricted to `owner = auth.uid()`, no delete. VERIFIED.
- **Cost gating that IS correct** — `vendor_quotes`, `invoices`, cost-flagged `card_events`/`card_attachments`, `get_board_bundle`. VERIFIED. (Only `material_items` was missed — Finding 5.)
- **`push_tokens` / notifications-READ / assistant tables** — self-scoped to `staff_id = auth.uid()` / `current_staff_id()`. VERIFIED.
- **UPDATE policies without WITH CHECK** (`cards_update`, `topics_update`, …) — Postgres applies `USING` as the new-row check when `WITH CHECK` is omitted, so these do NOT allow moving a row into an unreadable project. VERIFIED (not a finding).
- **Hardened DEFINER RPCs (the correct pattern)** — `resolve_card_event` (`current_can_read_project` check), `apply_learned_*` / `*_standard_step` (internal `current_can_manage_projects()`), `claim_*_for_analysis`/`_step_inference` (EXECUTE revoked from anon AND authenticated → service-role only). VERIFIED.
- **`get_board_bundle`** — briefly DEFINER + anon-granted (`20260614000001`), re-gated (`…000002`), then **dropped** (`…000003`). No residual exposure. VERIFIED.
- **Realtime** — publication covers cards/card_events/card_comments/topics/card_attachments/area_gate_status/areas/card_areas; Realtime respects the same table RLS, so no *separate* bypass — but every RLS gap above (esp. 1, 5, 6) is equally reachable over the socket.

---

## UNVERIFIED — cannot confirm from the repo (flag to Wilson)

- **UNVERIFIED-CRITICAL — is prod actually running these migrations?** This audit
  trusts that every RLS migration is *applied* in the live Supabase project.
  Memory notes several slices with a pending `supabase db push`. **If any table
  reached prod before its RLS migration, that table is wide open.** Confirm with
  `supabase migration list` (from `packages/db`) against prod before trusting any
  row above. Most likely way the real system diverges from this paper audit.
- **Role/column GRANTs to `anon`/`authenticated` are Supabase-managed, not in-repo.**
  The real exposure of `using(true)` (#8) and the `REVOKE`-based fix for #5 both
  depend on default grants I can't see. Verify in Dashboard → Database → Roles.

---

## Fix first (3)

1. **Finding 1 (CRITICAL) — pin `role`/`cost_visible` in the `staff` self-update
   policy (or move those columns behind a manager-gated RPC).** Everything else is
   moot until this is closed: it lets any authenticated user self-promote to admin
   in one REST call and hands them the whole model (cross-project read, project/
   roster/step management, all cost data). One-policy fix, highest leverage.
2. **Finding 2 — scope `notifications` INSERT (actor + project) or make it
   service-role only.** One-line change; today any staffer forges system
   notifications with attacker-chosen links into any colleague's queue.
3. **Confirm prod migration state (`supabase migration list`).** Not code — the
   prerequisite for trusting everything else. A missed push turns a "verified"
   policy into a wide-open table.

Then, close together as one small RLS PR: **Finding 3** (add `current_can_read_project`
guards to the 4 unguarded RPCs), **Finding 4** (`project_staff` writes →
`current_can_manage_projects()`), **Finding 6** (`area_gate_status` member writes),
and **Finding 5** (split/mask `material_items` price columns).

## Real vs theoretical

- **Real, exploitable now by any authenticated staffer via direct REST/RPC:**
  #1 (self-promote to admin — critical), #2 (notification spoof), #3 (cross-project
  RPC writes), #5 (cost leak), #6 (forged gate state). #4 is real for any
  `estimator`. None require an app bug — only the public anon key + a normal login.
- **Real but low impact / needs a leaked URL:** #7 (public covers bucket), #8
  (anon reads development names).
- **Theoretical / latent:** #9 — safe under current code; becomes real only if the
  two routes are refactored onto an admin client. Cheap defense-in-depth, not urgent.
- **Meta-risk over all of it:** the UNVERIFIED prod-migration question — everything
  here is only as true as the last successful `db push`.
