# Mobile Members, Settings & Project Creation — Design Spec

Slice: `members-settings` · Date: 2026-06-20 · Status: design (no code)

This spec covers the **management surfaces** of the DATUM mobile app: project
**member/access management**, **project settings** (info + the access/areas tabs
shell), **new-staff creation**, and **new-project creation**. It is grounded in the
real web app (`apps/web`), the shared `foundation` spec
(`docs/superpowers/specs/2026-06-20-mobile-foundation-design.md`), and the locked
architecture brief. It does NOT contain implementation code.

It inherits all conventions from the **foundation** slice: `@datum/core` (isomorphic,
client-injected), NativeWind + SANO tokens, react-query + AsyncStorage persister,
Supabase Realtime → invalidation, Expo Router IA, `useSession()` / role helpers.

---

## 1. Goal & scope

Deliver native parity for the four management flows below. All are RLS-gated; on
mobile they use the **anon** client + the user's JWT, exactly like web.

1. **Project settings shell** — the tabbed settings screen (`Akses & Anggota`,
   `Areas`, `Proyek`), with role-aware tab visibility (principal/admin see all;
   other staff see only `Areas`).
2. **Member / access management** (`Akses` tab) — list active members, remove a
   member, add an existing staff member to the project, with role selection.
3. **Staff creation** (`Buat staf baru` mode) — provision a brand-new staff account
   + invite them to the project, returning copyable credentials.
4. **Project info editing** (`Proyek` tab) — edit name/client/location/status/
   kickoff/target-handover, with kickoff-date schedule recalculation semantics.
5. **New-project creation** — the `/projects/new` flow (principal/admin only).

**Out of scope (owned by other slices):**
- The **Areas** tab body (`AreasManager` — area CRUD) is owned by the **rooms/areas**
  slice. This slice only ships the settings *shell* and routes the `Areas` tab to
  that slice's component. It DOES extract the read helper `getProjectAreas` only if
  the rooms slice has not already (coordination note in §11).
- **Project cover upload** (`uploadProjectCover`, `ProjectEditDialog`) — surfaced on
  web only inside the landing edit dialog; the projects-board/landing slice owns the
  card edit affordance. Mobile cover-image picking (`expo-image-picker`) is deferred
  (§11).
- The board, card detail, schedule, search, brief, review, activity, inbox screens.

**Critical constraint — staff creation needs the service-role key.** Web's
`createStaffWithPassword` uses `createSupabaseAdminClient()` (service-role,
`import "server-only"`, RLS-bypass) to call `admin.auth.admin.createUser`. Per the
foundation spec §7, **the service-role client is NEVER ported to mobile.** Therefore
staff creation on mobile CANNOT call the admin client directly. This slice specifies
a **thin server endpoint** (`/api/staff/create`) that mobile calls, OR — preferred —
defers staff creation to a future server-backed slice and ships the mobile `Akses`
tab with only "add existing staff" + "remove" in v1. Both options are detailed in
§3.5 and §11; the recommendation is the server-endpoint option so mobile reaches
parity.

---

## 2. Web behavior mirrored — exact files & functions

Everything below is read from the real tree; nothing invented.

### 2.1 Routes & page shells
- `apps/web/app/(app)/project/[slug]/members/page.tsx` → `MembersRedirect`: a pure
  `redirect(\`/project/${slug}/settings?tab=akses\`)`. **The web `members` route is
  just an alias for the settings `akses` tab.** Mobile mirrors this: there is no
  separate "members" screen; member management lives in the settings `Akses` tab.
- `apps/web/app/(app)/project/[slug]/settings/page.tsx` → `ProjectSettingsPage`:
  - Loads `caller = getCurrentStaff()`; redirects to `/project/${slug}` if no caller.
  - `canManage = canManageAccess(caller)` (principal/admin).
  - Loads `project` by `project_code = slug.toUpperCase()` selecting
    `id, project_code, project_name, client_name, location, status, target_handover,
    kickoff_date`. Not-found copy: `"Proyek tidak ditemukan: {slug}"`.
  - `requestedTab` from `?tab=`: `areas | proyek | akses` (default `akses`).
  - `activeTab = canManage ? requestedTab : "areas"` — **non-managers are forced to
    the Areas tab.**
  - `activeMode` from `?mode=`: `baru | existing` (default `existing`) — the add-member
    sub-toggle.
  - Loads `areas = getProjectAreas(supabase, project.id)` for everyone; loads
    `members = getProjectMembers(...)` and `staff = getAvailableStaff(...)` **only if
    `canManage`** (RLS would block non-managers anyway).
  - Renders modal-style header (back link `← {project_code}`, "Pengaturan Proyek"),
    title row (`{project_code} · {project_name}`, "Pengaturan"), `SettingsTabs`, then
    one of `AksesTab` / `AreasTab` / `ProyekTab`.
  - **`AksesTab`** (inline): "Anggota aktif" section with active-member count
    (`members.filter(m => !m.active_until).length`) + the help copy ("Hanya anggota di
    daftar ini yang bisa membaca dan menulis…"), `ProjectMembersList`; then "Tambah
    anggota" section with a `seg` toggle (`Staf yang ada` / `Buat staf baru`) →
    `AddProjectMemberForm` or `CreateStaffForm`.
  - **`ProyekTab`** (inline): "Info proyek" heading + help copy → `ProjectInfoForm`.
- `apps/web/app/(app)/projects/new/page.tsx` → `NewProjectPage`: back link
  `← Beranda`, "Proyek baru" / "Buat proyek" header + help copy ("Kode proyek jadi
  URL-friendly slug. Topik standar akan otomatis di-seed setelah proyek dibuat.") →
  `ProjectCreateForm`.

### 2.2 Components mirrored
- `apps/web/components/projects/SettingsTabs.tsx` → `SettingsTabs({activeTab, slug,
  canManage})`: `TABS = [akses "Akses & Anggota", areas "Areas", proyek "Proyek"]`;
  non-managers see only the `areas` tab. Links to `?tab=...`.
- `apps/web/components/projects/ProjectMembersList.tsx` → `ProjectMembersList`:
  - `ROLE_LABELS` map; `fmtRole(r)` → label or raw or `"—"`.
  - `remove(m)`: native `confirm("Hapus {full_name} dari proyek ini?")` (the file
    documents this as a deliberate exception to the no-native-confirm rule), builds
    `FormData` (`projectId, staffId, roleOnProject, projectCode`), calls
    `removeProjectMember`.
  - `active = members.filter(m => !m.active_until)`. Empty copy: "Belum ada anggota
    aktif. Tambah anggota di bawah agar mereka punya akses."
  - Table columns: `Nama | Peran global | Peran di proyek | Sejak | Aksi(hapus)`.
- `apps/web/components/projects/AddProjectMemberForm.tsx` → `AddProjectMemberForm`:
  - `ROLE_OPTIONS` (6 roles); `addable = candidates.filter(s => !existingActiveStaffIds.has(s.id))`.
  - State: `staffId` (default first addable), `role` (default `designer`).
  - `submit`: `FormData` → `addProjectMember`; on ok sets success
    `"{name} ditambahkan sebagai {role}."` and advances to next addable staff.
  - Empty (none addable): "Semua staf aktif sudah jadi anggota proyek ini."
- `apps/web/components/projects/CreateStaffForm.tsx` → `CreateStaffForm`:
  - `ROLE_OPTIONS` (6); `NON_ELEVATED_ROLES` = all except `principal`/`admin`.
  - `availableRoles = callerRole === "principal" ? ROLE_OPTIONS : NON_ELEVATED_ROLES`
    (admins can't mint principal/admin in the picker; server re-checks).
  - **`generateTempPassword()`** — crypto-strong (`crypto.getRandomValues`), four
    Indonesian construction syllables + 4 digits, e.g. `bata-kayu-pasir-semen-0481`.
    `randomInt(maxExclusive)` uses `Uint32Array` + modulo.
  - State: `email, fullName, role(designer), password(generated), roleOnProject(designer),
    costVisible(false)`, plus `error/success/copied/pending`.
  - `submit`: builds `FormData`, snapshots `submittedPassword` (server never echoes
    it), calls `createStaffWithPassword`; on ok shows success card with email +
    submitted password and a "Salin kredensial" button.
  - `copyCredentials()`: writes `"Email: …\nPassword: …\n\nLogin di: {origin}/login"`
    to clipboard; "Tersalin ✓" for 2s.
  - Success card copy: "Staf baru berhasil dibuat" + "Salin kredensial di bawah dan
    kirim ke staf via WhatsApp. Mereka bisa ganti password setelah login pertama."
  - Submit button disabled until `email && fullName && password.length >= 8`.
- `apps/web/components/projects/ProjectInfoForm.tsx` → `ProjectInfoForm`:
  - State seeded from `project`: name/client/location/status/kickoff/target.
  - `submit`: `FormData` → `updateProject`; on ok sets `saved` flag for 3s,
    `queryClient.invalidateQueries({ queryKey: keys.projects() })`, `router.refresh()`.
  - Help copy stresses kickoff_date triggers schedule recalculation; status options
    Desain/Konstruksi/Finishing/Serah terima/Selesai. Saved chip: "Tersimpan".
- `apps/web/components/projects/ProjectCreateForm.tsx` → `ProjectCreateForm`:
  - State: code(uppercased on input)/name/client/location/status(design)/target,
    plus `error` + `fieldErrors`.
  - `submit`: `FormData` → `createProject`; on ok `router.push("/project/{code}")`;
    on error sets `error` + per-field `fieldErrors`.
  - Code help: "Huruf besar, angka, dan tanda hubung saja. Akan jadi URL: /project/[code]".
  - Submit disabled until `code && name`. Cancel → `/`.

### 2.3 Data-access + mutations mirrored (the core extraction targets)
- `apps/web/lib/projects/member-queries.ts`:
  - `getProjectMembers(supabase, projectId): ProjectMemberRow[]` — selects
    `project_staff` (`staff_id, role_on_project, active_from, active_until, staff:staff_id(id,full_name,role,email,active)`),
    `order active_from asc`. `ProjectMemberRow` type exported here.
  - `getAvailableStaff(supabase): Pick<Staff,"id"|"full_name"|"role"|"email">[]` —
    `staff` where `active=true`, `order full_name`.
- `apps/web/lib/projects/member-mutations.ts` (`"use server"`):
  - `addProjectMember(formData)`: parses `AddInput` Zod
    (`projectId uuid, staffId uuid, roleOnProject 1..40, projectCode min 1`); requires
    a signed-in user; **upsert pattern** — if a `(project, staff, role)` row exists and
    is removed (`active_until` set) it un-removes it (`active_until=null, active_from=today`),
    if it exists and is active returns "Anggota sudah aktif dengan peran ini", else
    inserts a fresh row (`active_from=today`). `revalidatePath` members + project.
    Form-invalid copy: "Form tidak valid"; no-session: "Sesi tidak ditemukan".
  - `removeProjectMember(formData)`: parses `RemoveInput`; sets `active_until=today`
    where `(project, staff, role)` and `active_until is null` (soft-remove).
  - `MemberMutationResult = {ok:true} | {ok:false; error}`.
- `apps/web/lib/projects/staff-mutations.ts` (`"use server"`):
  - `createStaffWithPassword(formData): CreateStaffResult` — caller must
    `canManageAccess`; parses `CreateInput` Zod (`email, fullName 2..80, role enum,
    password 8..72, optional projectId/projectCode/roleOnProject/costVisible`);
    **only principals may create principal/admin** (server re-check); uses
    `createSupabaseAdminClient()` to `auth.admin.createUser` (email_confirm true,
    user_metadata.full_name), then inserts `staff` row (id = new auth uid), then
    optionally inserts `project_staff`; rolls back the auth user if the staff insert
    fails. `revalidatePath` settings/members/project. Result returns `staffId, email`
    (NOT the password — client snapshots it).
- `apps/web/lib/projects/mutations.ts` (`"use server"`):
  - `createProject(formData): CreateProjectResult` — parses `CreateProjectInput` Zod
    (`projectCode 2..40 /^[A-Z0-9-]+$/, projectName 1..120, optional client/location,
    status enum default design, optional targetHandover/startDate`); caller must
    `canManageAccess`; requires session; inserts `projects`
    (`principal_id = creator.role==="principal" ? user.id : null`,
    `pic_id = creator.role==="pic" ? user.id : null`); adds the creator to
    `project_staff` (`role_on_project = creator.role`); **the AFTER INSERT trigger
    auto-seeds the 15-topic taxonomy**; `revalidatePath("/")`. Duplicate code (`23505`)
    → "Kode proyek "{code}" sudah dipakai" + `fieldErrors.projectCode`.
  - `updateProject(formData): UpdateProjectResult` — parses `UpdateProjectInput`
    (patch-style: only provided fields update, supports nulling client/location/dates,
    `developmentName` resolves/creates a `developments` row, `coverImagePath`); caller
    must `canManageAccess`; empty patch → ok; `revalidatePath` `/`, project, settings,
    schedule.
  - `PROJECT_STATUS = [design, construction, finishing, handover, closed]`.
- `apps/web/lib/projects/queries.ts` → `getProjectsList`, `getDevelopments`
  (already extracted to `@datum/core` by foundation — reused here for the create-form
  development autocomplete and post-create cache refresh).
- `apps/web/lib/projects/cover.ts` → `coverImageUrl(path)` (moved to core by
  foundation).
- `apps/web/lib/auth/require-role.ts` → `getCurrentStaff`, `canManageAccess`,
  `StaffRole`, `CurrentStaff` (moved to `@datum/core/auth/current-staff` by foundation).
- `apps/web/lib/query/keys.ts` → `keys.projects()` (from `@datum/core/query/keys`).

---

## 3. `@datum/core` surface to extract

Following foundation's strangler recipe (§3.3): move the pure/isomorphic part to a
focused `core/<area>/<verb>.ts` with the Supabase client injected as the first arg,
drop `"use server"` / `server-only`, host the Zod schemas in `core/validation/*`,
then repoint web to a thin `"use server"` wrapper that parses `FormData`, gets the
server client, calls core, and does `revalidatePath`. Mobile imports core directly
and builds the input object from form state.

### 3.1 Module layout added by this slice
```
packages/core/src/
  projects/
    members.ts          # getProjectMembers, getAvailableStaff       (read)
    member-write.ts     # addProjectMember, removeProjectMember       (write)
    create.ts           # createProject                               (write)
    update.ts           # updateProject                               (write)
    staff-create.ts     # createStaffWithPassword (service-role; see §3.5 — NOT for mobile)
  validation/
    members.ts          # AddProjectMemberInput, RemoveProjectMemberInput (Zod)
    project.ts          # CreateProjectInput, UpdateProjectInput, PROJECT_STATUS (Zod)
    staff.ts            # CreateStaffInput, STAFF_ROLES (Zod)
```

### 3.2 Read helpers (used directly by mobile)
```ts
// core/projects/members.ts  (from apps/web/lib/projects/member-queries.ts — already isomorphic)
export type ProjectMemberRow = {
  staff_id: string; role_on_project: string;
  active_from: string; active_until: string | null;
  staff: Pick<Staff, "id" | "full_name" | "role" | "email" | "active"> | null;
};
export function getProjectMembers(supabase: DatumClient, projectId: string): Promise<ProjectMemberRow[]>;
export function getAvailableStaff(
  supabase: DatumClient,
): Promise<Pick<Staff, "id" | "full_name" | "role" | "email">[]>;
```
These two functions are **already** `(supabase, …)` shaped, so the move is verbatim
(lowest-risk, like foundation's `getProjectsList` demonstrator). Web repoint:
`apps/web/lib/projects/member-queries.ts` becomes
`export { getProjectMembers, getAvailableStaff } from "@datum/core"; export type { ProjectMemberRow } from "@datum/core";`.

> Also need a small project-by-slug read for the settings header (web does it inline
> in the page via `supabase.from("projects").select(...).eq("project_code", …)`).
> Extract `getProjectBySlug(supabase, slug): ProjectSettingsRow | null` into
> `core/projects/by-slug.ts` (select `id, project_code, project_name, client_name,
> location, status, target_handover, kickoff_date`; `slug.toUpperCase()`,
> `maybeSingle`). Web's settings page repoints to it.

### 3.3 Write helpers — extract the body, inject the client
The web mutations currently bundle three concerns: FormData parsing, the
`canManageAccess`/session gate, and the DB work. The strangler split moves the **DB
work + Zod** to core and keeps **FormData + revalidate** in web.

```ts
// core/validation/members.ts
export const AddProjectMemberInput = z.object({
  projectId: z.string().uuid(), staffId: z.string().uuid(),
  roleOnProject: z.string().min(1).max(40),
});
export type AddProjectMemberInput = z.infer<typeof AddProjectMemberInput>;
export const RemoveProjectMemberInput = z.object({
  projectId: z.string().uuid(), staffId: z.string().uuid(),
  roleOnProject: z.string().min(1).max(40),
});

// core/projects/member-write.ts
export type MemberMutationResult = { ok: true } | { ok: false; error: string };
export function addProjectMember(
  supabase: DatumClient, input: AddProjectMemberInput,
): Promise<MemberMutationResult>;       // body = upsert/un-remove/insert from member-mutations.ts
export function removeProjectMember(
  supabase: DatumClient, input: RemoveProjectMemberInput,
): Promise<MemberMutationResult>;       // body = soft-remove (active_until=today)
```
Note the `projectCode` field is dropped from the **core** input — it exists in the web
input only to drive `revalidatePath`. The web wrapper keeps `projectCode` in its own
FormData parse and uses it for revalidation after calling core.

```ts
// core/validation/project.ts
export const PROJECT_STATUS = ["design","construction","finishing","handover","closed"] as const;
export const CreateProjectInput = z.object({
  projectCode: z.string().min(2).max(40).regex(/^[A-Z0-9-]+$/, "Hanya huruf besar, angka, dan tanda hubung"),
  projectName: z.string().min(1).max(120),
  clientName: z.string().max(120).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  status: z.enum(PROJECT_STATUS).default("design"),
  targetHandover: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
});
export const UpdateProjectInput = z.object({ /* …patch fields incl. developmentName, coverImagePath… */ });

// core/projects/create.ts
export type CreateProjectResult =
  | { ok: true; projectCode: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
export function createProject(
  supabase: DatumClient, caller: CurrentStaff, input: CreateProjectInput, userId: string,
): Promise<CreateProjectResult>;
// body = insert projects (principal_id/pic_id from caller.role), insert creator into
// project_staff; the AFTER INSERT trigger seeds topics; 23505 → duplicate-code error.

// core/projects/update.ts
export type UpdateProjectResult = { ok: true } | { ok: false; error: string };
export function updateProject(
  supabase: DatumClient, input: z.infer<typeof UpdateProjectInput>,
): Promise<UpdateProjectResult>;  // body = patch builder + development resolve/create
```
`canManageAccess(caller)` is checked **before** calling core (both web wrapper and
mobile screen do this with the core helper). For `createProject`, `caller` + `userId`
are passed in because core can't read `next/headers`; mobile gets them from
`useSession()` + `getCurrentStaff(supabase)`.

**Web repoint pattern** (e.g. members):
```ts
// apps/web/lib/projects/member-mutations.ts  (stays "use server")
"use server";
import { addProjectMember as coreAdd, AddProjectMemberInput } from "@datum/core";
export async function addProjectMember(fd: FormData) {
  const parsed = AddProjectMemberInput.safeParse({ /* fd.get(...) */ });
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };
  const projectCode = String(fd.get("projectCode") ?? "");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };
  const res = await coreAdd(supabase, parsed.data);
  if (res.ok) { revalidatePath(`/project/${projectCode}/members`); revalidatePath(`/project/${projectCode}`); }
  return res;
}
```
Verify after each extraction: `pnpm --filter web typecheck && pnpm --filter web test`.

### 3.4 Shared query keys
This slice needs member + staff cache keys not yet in the foundation factory. Propose
adding to `@datum/core/query/keys.ts` (so web and mobile agree):
```ts
projectMembers: (projectId: string) => ["project-members", projectId] as const,
availableStaff: () => ["available-staff"] as const,
projectSettings: (slug: string) => ["project-settings", slug] as const,
developments: () => ["developments"] as const,
```
These are **not** added to `PERSISTED_KEY_ROOTS` (management data is fetch-on-open,
low value to persist; keeps the offline store small). Coordinate the key additions
with foundation/landing so there's one factory edit (open question §11).

### 3.5 Staff creation — the service-role problem (decision point)
`createStaffWithPassword` MUST run with the service-role key (it calls
`admin.auth.admin.createUser`), which foundation §7 bans from `@datum/core` and
`apps/mobile`. Three options:

- **(A) Web/server-only forever (v1).** Move only the *gate + Zod* into
  `core/validation/staff.ts` for reuse; keep the service-role body in
  `apps/web/lib/projects/staff-mutations.ts`. Mobile's `Akses` tab ships **without**
  the "Buat staf baru" mode (show only "Staf yang ada"). Lowest effort; small parity
  gap.
- **(B) Thin server endpoint (recommended for full parity).** Add
  `apps/web/app/api/staff/create/route.ts` (POST, authenticates the caller's JWT from
  the `Authorization: Bearer` header via the anon client → `getCurrentStaff` →
  `canManageAccess`, then runs the existing service-role body). Mobile POSTs to it with
  the session access token. This keeps service-role on the server while giving mobile
  the full flow. The endpoint reuses `core/validation/staff.ts` + the role gate, so
  validation stays shared.
- **(C) Supabase Edge Function** — same idea as (B) but hosted on Supabase; more infra,
  not justified given a Next server already exists.

**Recommendation: (B).** Spec the mobile screen for both; if (B) isn't built in this
slice, the screen degrades to (A) by hiding the "Buat staf baru" tab. Either way:
```ts
// core/validation/staff.ts  (shared by web action AND the /api/staff/create route)
export const STAFF_ROLES = ["principal","designer","pic","site_supervisor","admin","estimator"] as const;
export const CreateStaffInput = z.object({
  email: z.string().email("Email tidak valid").max(120),
  fullName: z.string().min(2, "Nama minimal 2 huruf").max(80),
  role: z.enum(STAFF_ROLES),
  password: z.string().min(8, "Password minimal 8 karakter").max(72),
  projectId: z.string().uuid().optional(),
  roleOnProject: z.string().min(1).max(40).optional(),
  costVisible: z.boolean().optional(),
});
```
`generateTempPassword()` / `randomInt()` are isomorphic (Web Crypto
`crypto.getRandomValues` exists in RN via the existing polyfills / Expo `expo-crypto`
fallback — verify, §11). Move them to `core/projects/temp-password.ts` so mobile and
web generate identical-format passwords.

---

## 4. Mobile screens — Expo Router routes + components & states

Per foundation's IA tree, these live under the **Matrix** stack
(`app/(tabs)/(matrix)/...`). The web `members` route is an alias → no separate mobile
route; member management is the settings `Akses` tab.

```
app/(tabs)/(matrix)/
  new.tsx                          # web #3 /projects/new — Create project
  project/[slug]/
    settings.tsx                   # web #10 settings — tabbed shell (Akses/Areas/Proyek)
```
`settings.tsx` accepts an optional `?tab=` param (default `akses`) so deep links and
the board overflow menu ("Pengaturan") land on the right tab.

### 4.1 Settings screen (`project/[slug]/settings.tsx`)
- **Header:** native stack header — back chevron → `/project/{slug}`, title
  "Pengaturan", subtitle `{project_code} · {project_name}` (mirrors web modal header).
- **Tabs:** a NativeWind segmented control (`SegmentedTabs`, the RN twin of web's
  `.seg`/`SettingsTabs`): `Akses & Anggota` · `Areas` · `Proyek`. Role-gated:
  non-managers (`!canManageAccess(staff)`) see **only** `Areas` and the screen forces
  `activeTab="areas"` exactly like web `activeTab = canManage ? requestedTab : "areas"`.
- **Tab bodies:**
  - **Akses** (`<AksesTab>`): active-member count chip ("{n} orang"), help text
    ("Hanya anggota di daftar ini…"), `<ProjectMembersList>`; then a `SegmentedTabs`
    sub-toggle (`Staf yang ada` / `Buat staf baru`) → `<AddProjectMemberForm>` or
    `<CreateStaffForm>` (the latter hidden if staff-create option (A), §3.5).
  - **Areas** (`<AreasManager>` from the **rooms slice** — this slice renders a
    placeholder that imports it; coordination §11).
  - **Proyek** (`<ProjectInfoForm>`): native form (see §4.4).

**Components (NativeWind, token-driven, from foundation's `components/ui/`):**
- `ProjectMembersList` (RN port): a `FlatList` of member rows (NOT a wide table —
  mobile uses a card/list row): each row shows `full_name`, `fmtRole(staff.role)` +
  `· fmtRole(role_on_project)`, `Sejak {active_from}`, and a destructive "Hapus"
  `Button`. Removal confirmation uses **`Alert.alert`** (RN native, the analogue of
  web's deliberate `confirm()`), message "Hapus {full_name} dari proyek ini?". Only
  `active = members.filter(m => !m.active_until)` shown.
- `AddProjectMemberForm` (RN port): a staff `Picker`/`Select` (addable candidates) +
  a role `Select` (6 roles, default `designer`) + a "Tambah anggota" `Button`. Success
  inline chip "{name} ditambahkan sebagai {role}." then auto-advance to next addable.
- `CreateStaffForm` (RN port): email + full-name `TextInput`s, global-role `Select`
  (gated by `callerRole`), project-role `Select`, temp-password field + "Acak ulang"
  regenerate button, cost-visible `Switch`, "Buat staf & undang ke proyek" `Button`.
  Success card with email + password (monospace) + "Salin kredensial" (uses
  `expo-clipboard`, "Tersalin ✓" 2s) + "Buat staf lain".

**Every state (Akses tab):**
- **Loading:** `Skeleton` rows for the member list while `getProjectMembers` /
  `getAvailableStaff` queries resolve.
- **Empty (members):** `EmptyState` "Belum ada anggota aktif. Tambah anggota di bawah
  agar mereka punya akses." (verbatim).
- **Empty (addable):** "Semua staf aktif sudah jadi anggota proyek ini." (verbatim).
- **Error:** `ErrorState` with retry — "Gagal memuat anggota: {msg}".
- **Offline:** `OfflineBanner`; member list renders from cache if present; add/remove
  CTAs disabled with a hint (mutations require connectivity — §8).
- **Permission:** non-managers never see the Akses tab (only Areas); if they deep-link
  `?tab=akses`, the screen coerces to `areas` (web parity).

### 4.2 Settings — Proyek tab (`<ProjectInfoForm>`)
- Native form fields: name (`TextInput` required, max 120), client (max 120), location
  (max 200), status (`Select`, 5 options), kickoff date + target-handover
  (`DateTimePicker` / date field; web uses `<input type="date">`), help copy about
  kickoff recalculation. "Simpan perubahan" `Button` (disabled until name non-empty);
  saved chip "Tersimpan" for 3s.
- On save: call `updateProject(supabase, input)` from core, then
  `queryClient.invalidateQueries({ queryKey: keys.projects() })` and
  `keys.projectSettings(slug)` (mobile has no `router.refresh()`; react-query
  invalidation is the equivalent).
- **States:** loading (skeleton form), saving (disabled + spinner on button), error
  (`ErrorState`/inline banner), offline (CTA disabled), permission (only managers reach
  this tab).

### 4.3 New-staff success / clipboard
Mirror web's success card exactly: monospace email + password, "Salin kredensial"
copying `"Email: …\nPassword: …\n\nLogin di: {appUrl}/login"` (the web `origin` is
replaced by the app's configured web URL constant, since RN has no `window.location`).
Show the WhatsApp-sharing help copy. Consider an `expo-sharing` "Bagikan" button as a
native nicety (optional, §11).

### 4.4 New-project screen (`new.tsx`)
- **Header:** back chevron → `/` (landing). Title "Buat proyek", subtitle "Proyek
  baru", help copy "Kode proyek jadi URL-friendly slug. Topik standar akan otomatis
  di-seed setelah proyek dibuat." (verbatim).
- **Form:** `ProjectCreateForm` RN port — code `TextInput` (auto-uppercase via
  `onChangeText`, `autoCapitalize="characters"`, max 40) with the "/project/[code]"
  hint and a per-field error slot; name `TextInput` (required); client + location
  `TextInput`s; status `Select` (Desain…Selesai); target-handover date field.
  "Buat proyek" `Button` (disabled until code && name) + "Batal" → `/`.
- **On success:** `router.push("/project/{projectCode}")` (web parity); invalidate
  `keys.projects()` so the landing list shows the new project.
- **Gating:** the screen is only reachable for `canManageAccess(staff)`; the landing's
  "+ Proyek baru" affordance (landing slice) is hidden otherwise, and `new.tsx`
  guards on mount (redirect to `/` if not a manager) — mirrors web's server-side
  `canManageAccess` check in `createProject`.
- **Every state:** idle form / submitting (button spinner "Menyimpan…") / field errors
  (duplicate code → "Kode proyek "{code}" sudah dipakai" under the code field) / global
  error banner / offline (CTA disabled).

---

## 5. Data fetching

react-query, keys from `@datum/core` (§3.4):
- **Members:** `useQuery({ queryKey: keys.projectMembers(projectId), queryFn: () =>
  getProjectMembers(supabase, projectId), enabled: canManage })`.
- **Available staff:** `useQuery({ queryKey: keys.availableStaff(), queryFn: () =>
  getAvailableStaff(supabase), enabled: canManage && addMode })`.
- **Project (settings header + info form):** `useQuery({ queryKey:
  keys.projectSettings(slug), queryFn: () => getProjectBySlug(supabase, slug) })`.
- **Developments (create-form autocomplete, optional):** `useQuery({ queryKey:
  keys.developments(), queryFn: () => getDevelopments(supabase) })` (reuses
  foundation's extracted `getDevelopments`).
- **Realtime:** member changes are low-frequency; web doesn't subscribe `project_staff`
  in `subscribeToProjectChanges` (it watches cards/events/comments/topics). So mobile
  relies on **mutation-driven invalidation** (after add/remove, invalidate
  `keys.projectMembers`) rather than a realtime channel. No new channel needed.
- **Optimistic updates** (mirror `apps/web/lib/query/mutations.ts` contract):
  - **Remove member:** `onMutate` cancel `keys.projectMembers`, snapshot, optimistically
    set the row's `active_until = today` (drops it from the active filter), rollback on
    error, invalidate on settle.
  - **Add member:** optimistic append of a ghost row (`optimistic:` marker) into
    `keys.projectMembers` + remove the staff from the `availableStaff`-derived addable
    set; rollback on error; invalidate both keys on settle.
  - **Project info save / create project:** simpler — show pending state, invalidate
    `keys.projects()` (+ `keys.projectSettings`) on success (web does the same via
    invalidate + refresh).

---

## 6. Mutations & validation

All mutation **logic** is the core fns in §3.3 returning the discriminated
`{ ok: true … } | { ok: false; error }` shape web already uses. Mobile builds the
input object directly from form state and runs the **same Zod schema** before calling
core (`AddProjectMemberInput.parse`, `CreateProjectInput.parse`, `CreateStaffInput.parse`),
removing FormData coupling from the shared layer (foundation §6).

- **Role gate before mutate:** mobile checks `canManageAccess(staff)` (core helper)
  before rendering management CTAs and before calling `addProjectMember` /
  `removeProjectMember` / `createProject` / staff-create. The DB RLS is the real gate;
  the client check is UX only.
- **createProject** needs `caller: CurrentStaff` + `userId` (from `useSession()` +
  `getCurrentStaff(supabase)`), since core can't read the session itself.
- **Indonesian error copy is preserved** in the Zod messages and result strings (they
  live in core now, shared by both apps) — "Hanya huruf besar, angka, dan tanda
  hubung", "Email tidak valid", "Nama minimal 2 huruf", "Password minimal 8 karakter",
  "Anggota sudah aktif dengan peran ini", "Kode proyek "{code}" sudah dipakai", etc.
- **Staff create** validation is shared (core), but execution is the server endpoint /
  action (service-role) per §3.5 — mobile never runs the service-role body.

---

## 7. RLS & permissions notes (per role)

All RLS is enforced identically for web and mobile (anon key + user JWT). Mobile adds
no new policies.

- **Read of `project_staff` + `staff`:** web only loads members/staff when
  `canManage`; the underlying RLS already restricts these reads, so mobile gates the
  queries with `enabled: canManage` to avoid empty/denied fetches.
- **`canManageAccess` (principal | admin)** governs: seeing the Akses + Proyek tabs,
  adding/removing members, creating projects, creating staff. Non-managers
  (`designer`/`pic`/`site_supervisor`/`estimator`) see **only the Areas tab** (they may
  add/edit areas — rooms slice). This matches the web page's `activeTab` coercion and
  `SettingsTabs` filtering.
- **Elevation guard:** only **principals** may create `principal`/`admin` accounts.
  Enforced in three places that must all stay aligned: the role picker
  (`availableRoles`), the core-shared validation/gate, and the server execution
  (existing `createStaffWithPassword` re-check). Mobile mirrors the picker subset.
- **`createProject`** stamps `principal_id`/`pic_id` from the creator's global role and
  inserts the creator into `project_staff` so RLS grants them access (web parity); the
  topic-seed trigger fires server-side regardless of client.
- **Service-role (`admin.ts`) never on mobile** — staff creation routes through the
  server (option B) which authenticates the JWT, re-checks `canManageAccess`, then uses
  service-role. The lint ban in `@datum/core` / `apps/mobile` (foundation §10) prevents
  accidental import.
- **cost_visible** is set at staff/project-member creation (`CreateStaffForm` checkbox →
  `staff.cost_visible` + `project_staff.cost_visible`); it gates cost rows via RLS. The
  mobile form must persist it the same way; the cost-layer *display* gating is a later
  slice.

---

## 8. Offline behavior

Inherits foundation's offline-first cache (AsyncStorage persister), but management
data is intentionally **not** in `PERSISTED_KEY_ROOTS` (§3.4):

- **Reads:** members/staff/settings queries are fetch-on-open. If offline with no
  in-memory cache, show `OfflineBanner` + the offline empty state ("Sambungan
  terputus — coba lagi saat online"). If a cached copy exists in the current session
  it still renders.
- **Mutations (add/remove member, create project, create staff, save info):** there is
  **no offline mutation queue** in this slice (foundation defers it). All write CTAs
  **disable when `onlineManager` reports offline** with a hint, or surface a clear
  error if the network drops mid-request. Optimistic updates roll back on failure.
- **Create project / staff** especially must be online (project insert + topic-seed
  trigger; staff create hits the server endpoint) — block the CTA offline.
- **Realtime:** N/A here (no member channel); post-reconnect the user can pull-to-refresh
  to re-run the queries.

---

## 9. Edge cases

- **Members route alias:** a deep link to a mobile `members` path (if any external link
  exists) must redirect to `settings?tab=akses` — register a redirect route mirroring
  web's `MembersRedirect`, or simply only expose `settings`.
- **Non-manager deep-links `?tab=akses` or `?tab=proyek`:** coerce to `areas` (web
  parity); never render management UI to them.
- **Project not found:** show "Proyek tidak ditemukan: {slug}" (verbatim) instead of a
  broken shell (web parity).
- **Remove the last active member / remove yourself:** web allows it (soft-remove sets
  `active_until`); RLS may then revoke the remover's own access (creator was added as a
  member). Mobile must handle a subsequent RLS-denied refetch gracefully (treat as
  "access revoked" → bounce to landing), and ideally warn before self-removal.
- **Re-adding a removed member:** the upsert un-removes the soft-deleted row
  (`active_until=null, active_from=today`) rather than erroring; the optimistic add must
  not assume an insert. Re-adding an already-active member returns "Anggota sudah aktif
  dengan peran ini".
- **Same staff, different project-role:** the unique key is `(project, staff, role)`, so
  one person can hold two project-roles; the list keys rows by
  `${staff_id}-${role_on_project}` (web parity) — the FlatList `keyExtractor` must too.
- **Duplicate project code (23505):** surface under the code field, not as a generic
  error.
- **Staff create — email already in Supabase Auth:** server returns "Email ini sudah
  terdaftar di Supabase Auth"; show it inline. **Auth created but staff insert fails:**
  server rolls back the auth user (existing behavior) — mobile just shows the error.
  **Staff created but project-assign fails:** server returns "Staf dibuat tapi gagal
  ditambahkan ke proyek: …" (staff exists globally) — surface as a warning, not a hard
  failure.
- **Temp-password copy fails** (clipboard denied): web shows "Gagal menyalin — silakan
  salin manual"; mobile mirrors and keeps the password visible for manual copy.
- **Web Crypto in RN:** `crypto.getRandomValues` must exist for `generateTempPassword`;
  if the polyfill is absent, fall back to `expo-crypto.getRandomValues` (§11).
- **Date inputs:** web uses `<input type="date">` returning `YYYY-MM-DD`; mobile's
  date picker must emit the same `YYYY-MM-DD` string so the same Zod/DB path works
  (kickoff/target/startDate). Empty date = `null` (web parity in `updateProject`).
- **Kickoff-date change triggers schedule recalc** server-side; mobile should
  invalidate any schedule query keys (schedule slice) after a successful info save.

---

## 10. Testing

- **Core logic — vitest** (`packages/core`, mirrors `packages/db/vitest.config.ts`):
  - `getProjectMembers` / `getAvailableStaff` / `getProjectBySlug`: mock client, assert
    select strings, ordering, `maybeSingle`, and row mapping.
  - `addProjectMember`: three branches — fresh insert, un-remove of a soft-deleted row,
    and "already active" error — with a mock client asserting the upsert query shape.
  - `removeProjectMember`: asserts `active_until=today` + `is("active_until", null)`
    filter (only removes active rows).
  - `createProject`: asserts project insert payload (principal_id/pic_id by role),
    creator `project_staff` insert, `23505` → duplicate-code `fieldErrors`, success
    shape; verify it does NOT itself check the role (caller passed in).
  - `updateProject`: patch-builder (only provided fields), development resolve-vs-create,
    null-clearing of client/location/dates, empty-patch short-circuit.
  - Validation: `CreateProjectInput` regex/length, `AddProjectMemberInput` uuid,
    `CreateStaffInput` email/password bounds, `STAFF_ROLES` enum, the Indonesian
    messages.
  - `generateTempPassword`: format `syl-syl-syl-syl-dddd`, syllables from the list,
    digits 0000–9999; `randomInt` bounds.
  - `canManageAccess` truth table (already in foundation; reused).
- **Mobile screens — @testing-library/react-native** (jest-expo preset, extends
  `apps/mobile/tests/login.test.tsx`):
  - Settings tab visibility: manager sees 3 tabs; non-manager sees only Areas and is
    coerced to it on `?tab=akses`.
  - `ProjectMembersList`: loading skeleton → rows (mock `getProjectMembers`); empty
    state copy; `Alert.alert` fires on Hapus and calls `removeProjectMember` on confirm;
    optimistic removal + rollback on error.
  - `AddProjectMemberForm`: addable filtering, success message + auto-advance, empty
    ("Semua staf aktif…") state.
  - `CreateStaffForm`: role picker subset by `callerRole`, regenerate password, submit
    disabled until valid, success card + clipboard copy ("Tersalin ✓"), error inline.
  - `ProjectInfoForm`: save → invalidate, saved chip, disabled-until-name, offline CTA
    disabled.
  - `new.tsx`: duplicate-code field error, success navigation
    (`router.push("/project/{code}")`), non-manager redirect guard.
- **Web regression after each strangler step:** `pnpm --filter web typecheck &&
  pnpm --filter web test` must stay green (the existing member/project mutation tests,
  if any, plus the settings page render). The `/api/staff/create` route (option B) gets
  a route test asserting JWT auth + `canManageAccess` gate + service-role call.

---

## 11. Dependencies on other slices + Out of scope + Open questions

**Depends on `foundation`** for: `@datum/core` package + strangler recipe + lint bans,
NativeWind + SANO tokens + UI primitives (`Screen/Card/Button/Select/Badge/EmptyState/
ErrorState/Skeleton/OfflineBanner`), react-query provider + AsyncStorage persister,
`onlineManager`/`focusManager`, the Expo Router Matrix-stack skeleton, `useSession()`,
and the already-extracted `getCurrentStaff` / `canManageAccess` / `getProjectsList` /
`getDevelopments` / `coverImageUrl` / shared `keys` factory.

**Coordinates with:**
- **rooms/areas slice** — owns `AreasManager` + `getProjectAreas`. This slice ships the
  settings *shell* and renders the rooms slice's Areas component in the `Areas` tab. If
  the rooms slice has not extracted `getProjectAreas` to core yet, do it here and let
  rooms repoint (whoever lands first owns the extraction; the other re-exports).
- **landing/projects-board slice** — owns the landing "+ Proyek baru" entry point (which
  navigates to this slice's `new.tsx`) and the board overflow-menu "Pengaturan" entry
  (which navigates to this slice's `settings.tsx`). The projects-board spec lists
  "Create project form parity" in its scope (line 24) but also defers "project
  settings/areas/members admin" to other slices — **resolve the create-project
  ownership with that slice; this `members-settings` slice owns the create-project
  screen + `createProject` core extraction.**
- **schedule slice** — after a kickoff-date save, invalidate the schedule query keys it
  defines.
- **query-keys factory** — the new keys in §3.4 should be one coordinated edit to
  `@datum/core/query/keys.ts` shared with foundation/landing.

**Out of scope (this slice):**
- The **Areas** tab body (`AreasManager` area CRUD) — rooms slice.
- **Project cover upload** (`uploadProjectCover`, `ProjectEditDialog`) and mobile image
  picking — landing/projects-board slice + a future upload-UI slice.
- The board, card-detail, schedule, search, brief, review, activity, inbox screens.
- Offline **mutation** queue; cost-layer display gating.
- Any DB migration.

**Open questions (resolve during build):**
1. **Staff creation transport (§3.5).** Decide option B (recommended: thin
   `/api/staff/create` route authenticating the JWT + re-checking `canManageAccess`,
   then service-role) vs option A (web-only; mobile hides "Buat staf baru" in v1). This
   determines whether the mobile `CreateStaffForm` ships now.
2. **Web Crypto in RN.** Confirm `crypto.getRandomValues` is available in the Expo 56 /
   RN 0.85 runtime (via `react-native-get-random-values` or `react-native-url-polyfill`
   already imported in `apps/mobile/lib/supabase/client.ts`); if not, route
   `generateTempPassword` through `expo-crypto`. Per `apps/mobile/AGENTS.md`, verify
   against https://docs.expo.dev/versions/v56.0.0/ before coding.
3. **App login URL for the "Salin kredensial" text** — web uses `window.location.origin`;
   mobile needs a configured web base URL constant (e.g. `EXPO_PUBLIC_WEB_URL`) for the
   "Login di: {url}/login" line. Confirm the production web URL.
4. **`getProjectAreas` ownership** — confirm whether rooms slice already extracts it to
   `@datum/core`; avoid a double extraction.
5. **createProject signature** — passing `caller` + `userId` into core vs. passing a
   pre-resolved `{ principalId, picId, creatorRole }`; pick the shape that keeps the web
   wrapper thinnest while staying free of `next/headers` (open for the strangler step).
6. **Date picker component** — which RN date picker (community `@react-native-community/
   datetimepicker` vs an Expo-friendly alternative) emits `YYYY-MM-DD` cleanly and is
   compatible with Expo 56 / RN 0.85; pin during build.
7. **Whether to persist member/settings queries** — current proposal excludes them from
   `PERSISTED_KEY_ROOTS`; revisit if offline read of the member list proves valuable.
