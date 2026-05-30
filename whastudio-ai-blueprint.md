# DATUM — WHAstudio AI Project Intelligence System Build Blueprint

**Version:** 1.1
**Date:** May 27, 2026
**Owner:** Wilson (Principal, WHAstudio)
**Maintainer (initial):** Wilson, transitioning to internal team
**Product name:** DATUM

---

## 1. Firm Background & Context

**WHAstudio** is a 70+ person design-build firm based in Surabaya, Indonesia, operating across four integrated disciplines: architecture, interior design, construction, and in-house furniture fabrication. The firm runs approximately **50 active projects simultaneously**, with **30-40 in finishing phase** at any given time.

**Key personnel:**
- **Wilson** — Principal and founder, MArch from Harvard GSD, current bottleneck across design and operational decisions
- **Carissa** — Interior design lead
- **Santoso** — Construction/site lead
- **Site supervisors** — Field staff responsible for daily progress logging
- **PICs** — Project-specific points of contact who interface with clients

**Current strategic priorities (firm-level):**
- Reducing the principal bottleneck (Wilson)
- Building scalable systems
- Eliminating procurement leakage
- Integrating AI into firm operations

**Existing tooling landscape:**
- **Trello** — currently functions as project diary; categorized drawing uploads, material notes, client decisions. Acts as document dump with category labels but no enforced schema or queryable structure.
- **AutoCAD files** — stored on local Synology NAS, accessible on-site and (slowly) over web
- **WhatsApp** — primary informal communication channel for client conversations and urgent coordination, but not a safe query surface for project data
- **Accurate** — accounting system (separate, not integrated into this build)
- **Synology NAS** — local file storage, treated as storage-only in this architecture (not application host)
- **Language** — Bahasa Indonesia is the primary working language across drawings, notes, field communication, and assistant answers

---

## 2. The Core Problem

Information across WHAstudio is **fragmented across channels that don't talk to each other**:
- Client decisions live in WhatsApp threads (group chats, principal DMs, PIC channels)
- Drawing revisions live on the NAS
- Progress notes and material decisions live in Trello
- Vendor quotes and procurement live in email
- Accounting lives in Accurate

The result: **Wilson is the connective tissue.** Every coordination meeting begins with a reconciliation exercise. No one but the principal knows where everything is. This is the operational manifestation of the "principal bottleneck" problem.

The **finishing phase** is where this fragmentation costs the most — client material decisions undocumented, vendor selections scattered, defect lists in someone's notebook, and the AI drawing-reading feature has the clearest payoff because finish schedules are already structured tabular documents.

---

## 3. The Vision

**DATUM** is a project intelligence layer that consolidates scattered information into a single structured database, gives staff an authenticated app to query and add project data, and proactively surfaces what needs attention.

**Not** a checklist app. **Not** a drawing reader. Those are features. The job-to-be-done is: **eliminate the principal as the connective tissue between scattered information.**

### What it does:

1. **Provides an internal Project Assistant.** Authenticated staff use DATUM to ask natural-language questions in Bahasa Indonesia across projects, topics, drawings, decisions, schedules, surveys, invoices, workers, progress, and notes. Answers cite source records and apply cost-visibility rules.

2. **Creates structured drafts from natural language.** Staff can say "Add note: powder room marble approved by client." The assistant creates a draft record with author, timestamp, source, project, topic, and risk classification. Risky items require approval before becoming official.

3. **Uses Trello-style topic cards without Trello-style clutter.** Cards remain big discussion categories, but structured child records live underneath: decisions, drawing updates, survey logs, invoice records, worker assignments, schedule items, progress logs, notes, and attachments.

4. **Reads architectural drawings and company templates.** The CAD checklist becomes the base drawing register. The finishing guide becomes the base gate/lead-time/quality-checkpoint model. Drawing extraction creates drafts for human validation.

5. **Proactively surfaces decisions and timeline risks.** AI reviews approved project state and flagged drafts, then queues reminders or briefs. WhatsApp is used only for system-initiated notifications with authorized recipients — not for inbound database inquiry.

---

## 4. Architecture & Stack

### Stack Decision

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Database & Auth | **Supabase (PostgreSQL)** | Proper relational database, built-in auth with role-based access, scales to 50+ projects without structural awkwardness. Wilson has prior experience. |
| Native App | **React Native (Expo)** | Primary DATUM staff interface for project topics, structured filters, Project Assistant, camera/photo upload, and future offline support. |
| Web Admin | **Next.js on Vercel** | Admin, review queue, imports, heavier validation workflows, and management dashboards. Can share TypeScript logic with the app. |
| AI / Intelligence | **Claude API or OpenAI API behind an internal assistant service** | Natural-language querying, draft creation, drawing parsing, Bahasa Indonesia support, source-grounded answers. Provider should remain swappable. |
| WhatsApp Notifications | **Fonnte or Wablas** (Indonesian WhatsApp API providers) | Outbound notification-only channel for authorized alerts and DATUM links. No inbound WhatsApp behavior in V1. Backup: official WhatsApp Business API via Meta if scale requires. |
| Orchestration | **Python (FastAPI) or Next.js API routes / Supabase Edge Functions** | No n8n — Claude-driven orchestration directly via code. Wilson's Land Scout v8 already proved this pattern works. |
| File Storage | **Supabase Storage** for app uploads (drawings, photos); **NAS** retained for original AutoCAD master files | Keep operational data in cloud; preserve NAS as canonical source for design files. |

### Why NOT Airtable / Trello / n8n

- **Airtable** — was the recommended path before Supabase capability was confirmed. Spreadsheet pretending to be a database; relational limitations would hit at 50-project scale within 6 months.
- **Trello** — no schema enforcement, no query layer. Current source of "little messy" problem.
- **n8n** — visual flow tool; Claude Code handles orchestration logic more cleanly when reasoning is natural-language based (project disambiguation, message parsing).

### Why NOT inbound WhatsApp as the data inquiry surface

WhatsApp is public by nature: anyone can message the number, identity is weak, conversation forwarding is easy, rate limits are awkward, and every automated response creates API and AI cost exposure. Sensitive project data should not be returned into a chat thread that the system does not fully govern.

**Decision:** WhatsApp is outbound notification-only for system-initiated messages. Authorized staff may receive project details in WhatsApp notifications, but staff cannot query the database by chatting with the public WhatsApp number. DATUM does not need an inbound WhatsApp auto-reply in V1. All interactive project inquiry and data entry happens inside DATUM.

### Why NOT raw client chat parsing

Clients message across personal DMs, group chats, and PIC channels — behavior that cannot and should not be forced into a single API number. **PICs act as the translation layer:** they distill client conversations into structured app entries with screenshots or notes as source evidence. This produces cleaner data than parsing raw client chat noise and preserves responsibility for what becomes official.

---

## 5. Data Model (Initial Schema)

### Core tables (Supabase / PostgreSQL):

**`projects`**
- id (uuid), project_code (e.g., "GA7-45"), project_name, client_name, site_address, location, search_aliases (jsonb), status (design / construction / finishing / handover / closed), start_date, target_completion, principal_in_charge, pic_id (FK to staff)

**`staff`**
- id, full_name, role (principal / designer / pic / site_supervisor / admin), whatsapp_number (unique), email, active (bool), permissions (jsonb)

Role assignment detail can be designated later by Wilson. The architecture must support differentiated roles, permissions, and cost visibility from day one, without hardcoding the final staff-role matrix.

**`project_staff`** (junction — many-to-many)
- project_id, staff_id, role_on_project, active_from, active_until

**`rooms`** (project-scoped)
- id, project_id, room_code, room_name (e.g., "Master Bathroom"), floor, area_sqm

**`decisions`** (the main event log)
- id, project_id, room_id (nullable), decision_type (material / vendor / approval / change_order / scope / schedule), item_category (e.g., "keramik lantai", "cat dinding"), current_spec, proposed_spec, status (pending / confirmed / rejected / superseded), logged_by_staff_id, logged_via (app / assistant / dashboard / trello_import / email), raw_input_text, created_at, confirmed_at, source_record_id, attachments (array of storage URLs)

**`vendors`**
- id, vendor_name, category (tile / paint / cabinetry / etc.), contact, notes

**`vendor_decisions`** (junction linking decisions to selected vendors)
- decision_id, vendor_id, quote_amount, currency (IDR), quote_date, attachment_url

**`drawings`**
- id, project_id, drawing_code, drawing_type (floor_plan / finishing_schedule / detail / room_data_sheet), revision, file_url, uploaded_at, parsed (bool), ai_extraction_jsonb

**`checklist_items`** (auto-generated from drawing parsing)
- id, project_id, room_id, item_category, specified_value, status (pending / in_progress / done / blocked), assigned_to_staff_id, due_date, completed_at, completion_photo_url, completion_logged_by

**`reminders`**
- id, project_id, related_decision_id, related_checklist_item_id, reminder_type, scheduled_for, sent_at, recipient_staff_id, message_template, status

**`project_events`** (append-only chronological record)
- id, project_id, topic_id (nullable), event_type, title, body, actor_staff_id, source_type, source_id, visibility_scope, created_at, metadata_jsonb

**`record_revisions`** (history for corrections/superseding information)
- id, project_id, entity_type, entity_id, revision_type (created / corrected / superseded / approved / rejected), previous_payload_jsonb, new_payload_jsonb, actor_staff_id, reason, created_at

**`notification_log`** (audit trail of outbound WhatsApp/app notifications)
- id, provider, recipient_staff_id, phone_number, project_id (nullable), notification_type, template_key, rendered_summary, deep_link_url, status (queued / sent / failed / skipped), provider_message_id, estimated_cost_usd, created_at, sent_at

**`project_topics`** (Trello-style discussion containers)
- id, project_id, title, topic_type (drawing / room / work_package / logistics / interior / general), drawing_group_code, room_id, gate_code, status, created_by_staff_id, source_type, source_id, created_at

**`topic_notes`**
- id, project_id, topic_id, body, note_type (general / meeting / client_conversation / site_instruction / survey / imported_comment), created_by_staff_id, source_type, source_id, official_status (draft / approved / rejected), created_at

**`data_drafts`**
- id, project_id, topic_id, draft_type (note / decision / drawing_update / survey_log / invoice_record / worker_assignment / schedule_item / progress_log), proposed_payload_jsonb, risk_level (low / medium / high), approval_required_role, status (draft / approved / rejected / superseded), created_by_staff_id, approved_by_staff_id, source_type, source_id, created_at, approved_at

**`assistant_sessions`**
- id, staff_id, project_id (nullable), title, created_at, last_message_at

**`assistant_messages`**
- id, session_id, staff_id, role (user / assistant / system), content, sources_jsonb, token_count, estimated_cost_usd, created_at

**`assistant_tool_calls`**
- id, message_id, tool_name, input_jsonb, output_summary, records_accessed_jsonb, status, created_at

**`assistant_query_audit`**
- id, staff_id, project_scope_jsonb, question, answer_summary, records_accessed_jsonb, included_unapproved_drafts (bool), estimated_cost_usd, created_at

**`assistant_usage_limits`**
- id, staff_id, role, daily_message_limit, daily_token_limit, monthly_cost_limit_usd, usage_date, messages_used, tokens_used, estimated_cost_used_usd

### Assistant query governance

All assistant queries are app-authenticated and cost-aware:

1. **Authenticated staff identity** — every message is tied to `staff.id`, Supabase Auth user, role, and project assignments.
2. **Broad project visibility by default** — active staff may access project memory across projects, because cross-project knowledge sharing is part of the operating goal.
3. **Structured data first** — query approved relational records before raw comments or imported Trello history.
4. **Draft visibility rules** — flagged drafts may be included only if clearly labeled "unapproved".
5. **Usage limits** — enforce per-user/per-role cost and message limits before calling an AI model.
6. **Audit trail** — log question, sources accessed, answer summary, token estimate, and staff identity.
7. **Bahasa default** — assistant answers and draft prompts default to Bahasa Indonesia unless a user explicitly asks otherwise.

### Project lookup policy

- DATUM search prioritizes **client name** and **site address** because the team usually refers to projects that way.
- Project codes remain unique secondary identifiers for precision and integrations.
- Example: `GA7-45` should be searchable by `Citraland`, `GA7-45`, client name, and site address.

### Approval and chronology policy

- All active staff may approve visible drafts to reduce bottlenecks.
- Cost-sensitive drafts are visible and approvable only to principals and selected project-manager/PIC roles with cost permission.
- Approving or correcting a record never erases prior information. Corrections create a new `record_revisions` row and a new `project_events` entry.
- Superseded decisions remain searchable as historical context, but the app clearly marks the latest active decision.
- Client decision summaries written by PICs are acceptable official source records. Screenshots, meeting notes, and files are encouraged evidence, but not mandatory.

---

## 6. Internal Assistant & WhatsApp Notification Flows

### Internal Project Assistant flow

```
[Authenticated staff] → asks question or adds data in DATUM
                                ↓
[Assistant API] → POST /api/assistant/message
                                ↓
[Backend handler]
  - Verify Supabase Auth session
  - Resolve staff record and role
  - Check assistant usage limits
  - Apply broad project access plus cost-visibility filtering
                                ↓
[Retrieval layer]
  - Prefer approved structured records
  - Include flagged drafts only if labeled
  - Include raw Trello/notes only as source context
                                ↓
[AI answer or draft creation]
  - Query → answer with source links
  - Data entry → create data_drafts record
  - High-risk official records require approval
                                ↓
[Audit]
  - Store assistant_messages
  - Store assistant_tool_calls
  - Store assistant_query_audit
```

### WhatsApp notification-only flow

```
[System reminder / review queue / morning brief]
                                ↓
[Notification API] → POST /api/notifications/whatsapp/send
                                ↓
[Safety filter]
  - Recipient must be active staff
  - Recipient must be authorized for the notification type
  - Message must use approved templates
  - Cost/invoice details only go to principals or selected PICs/project managers
  - Include app deep link for full source history
                                ↓
[Fonnte/Wablas]
                                ↓
[Staff receives short alert]
  - "Citraland GA7-45: marble decision updated. Open DATUM for full history."
```

### What WhatsApp must not do

- No project database inquiry.
- No open-ended AI answers in WhatsApp.
- No inbound WhatsApp query handling in V1.
- No auto-reply is required in V1.
- Outbound notifications may include project details when generated by the system for authorized staff.
- Cost, invoice, vendor price, VO, and margin information only goes to principals and selected cost-visible PICs/project managers.

### WhatsApp notification policy

- All system event categories may generate WhatsApp notifications if enabled for that role/project.
- Examples: approvals, overdue decisions, schedule risks, client decision updates, drawing updates, survey notes, invoice/cost events for cost-visible roles, and morning briefs.
- DATUM should still prefer in-app notifications for routine updates; WhatsApp is for reminders that need attention outside the app.

### App-first structured filters

The assistant does not replace structured browsing. The native app still needs filters for:
- awaiting decision
- surveyed
- has invoice
- worker assigned
- scheduled
- in progress
- blocked
- finished
- unapproved draft exists

Chat is for cross-data questions. Filters are for reliable operational scanning.

---

## 7. Phased Build Plan

### **Phase 1 — App-First Project Memory (Weeks 1-4)**

**Goal:** Replace scattered Trello/WhatsApp decision memory with DATUM, a structured internal app and assistant. WhatsApp is outbound notification-only from the beginning.

**Deliverables:**
- Supabase project provisioned, core schema deployed
- Staff table seeded with 5-8 pilot users (Wilson, Carissa, 2-3 PICs, 1-2 site supervisors)
- CAD checklist imported as canonical drawing-register template
- Two sample Trello boards imported as source records and draft project topics
- DATUM Expo app with project list, Kanban-style topic view, topic detail, structured filters, and Project Assistant
- Assistant API with authentication, broad project retrieval, cost-visibility filtering, source citations, usage limits, and audit logging
- `data_drafts` workflow for assistant-created notes/decisions/progress records
- Next.js admin/review surface for imports, approvals, and staff/project management
- WhatsApp notification endpoint with authorized templates only; no database query handling
- Append-only chronology via `project_events` and `record_revisions`
- Deployed to Vercel/Supabase; Expo development build or internal preview distributed to pilot team

**Pilot scope:** 2-3 active finishing projects. Import their Trello boards first, then let staff add new notes/decisions through DATUM. Measure query usefulness, draft accuracy, approval load, and whether DATUM becomes easier than searching Trello/WhatsApp.

**Success criteria:** Pilot users can answer "what is the latest decision/status/source?" from the app without asking Wilson or searching WhatsApp. No sensitive project data is returned through WhatsApp.

### **Phase 2 — Drawing Register & Checklist Auto-Generation (Weeks 5-8)**

**Goal:** Use the CAD checklist and drawing uploads to create a validated, project-specific drawing register and finishing checklist.

**Deliverables:**
- Project drawing register generated from CAD checklist template with statuses: required / optional / not applicable / custom / issued / revised / approved
- Drawing upload UI in app/admin (PDF, JPG, PNG)
- AI drawing extraction stored as drafts, not official data
- Carissa-facing validation view: AI extraction shown beside source drawing, with edit/approve workflow
- Checklist progress tracking per room/topic (pending / in progress / done / blocked)
- Field completion via app: photo → project/topic/room → progress draft or approved low-risk update

**Success criteria:** Carissa validates an AI-generated drawing/checklist draft in <15 minutes per project section, and the output links back to drawing source and topic.

### **Phase 3 — Proactive Intelligence (Months 3-4)**

**Goal:** AI looks at project state and tells Wilson/PICs what needs attention without exposing details in unsafe channels.

**Deliverables:**
- Scheduled job (daily/weekly) that reviews active project state: open decisions, unapproved drafts, days-since-last-update, blocked checklist items, upcoming milestone risks
- Wilson's "morning brief" app/admin view: top 10 items across all active projects
- PIC action queue by project
- WhatsApp authorized alerts with deep links: *"Citraland GA7-45: 2 decisions and 1 drawing update need review. Open the app."*
- Bottleneck analytics: stalled decisions, draft aging, slow approvals, vendor/invoice gaps, overdue schedule items

**Success criteria:** Wilson can review the morning brief in <10 minutes and trust that sensitive details stayed inside the app.

### **Phase 4 — Advanced Mobile Operations (Month 5+)**

**Goal:** Improve field adoption and reduce friction for supervisors and PICs.

**Deliverables:**
- Offline-capable site logging with sync when connection returns
- Camera-first flows for progress, defects, and delivery evidence
- Push notifications inside DATUM
- Optional voice-to-draft entry in Bahasa Indonesia
- More granular staff permissions and approval routing

**Decision point:** Build advanced offline/mobile features after Phase 1-3 prove the data model and adoption loop.

---

## 8. Cost Estimate

### Recurring monthly costs (rough):

| Item | Estimated Cost (USD) |
|------|---------------------|
| Supabase Pro | $25 |
| Vercel Pro | $20 (or free tier initially) |
| Expo / app distribution | $0-30 depending on preview/deployment path |
| Fonnte/Wablas WhatsApp notifications | $5-30 depending on reminder volume |
| AI API for internal assistant + drawing parsing | $30-150 during pilot, controlled by usage limits |
| Domain | $1-2 |
| **Total** | **~$100-250/month initially** |

### AI cost control recommendation

Use a tiered AI routing policy:
- **Cheap model first** for classification, search query planning, draft typing, and short answers.
- **Stronger model only when needed** for cross-project synthesis, messy Bahasa notes, drawing interpretation, or high-impact summaries.
- **No AI call for simple filters.** Queries like "show topics with invoices" should hit the database directly.
- **Cache project summaries** daily so repeated questions do not resend large context.
- **Set hard budget caps** by role and company-wide monthly spend.

Recommended pilot cap:
- Start with **$75/month AI budget** for 5-8 pilot users.
- Raise to **$150/month** if assistant quality is useful and usage is frequent.
- Treat anything above **$300/month during pilot** as a signal to improve retrieval/caching before expanding usage.

Rough token economics as of May 2026:
- Very cheap classifiers can be well below **$0.001 per short interaction** when using nano/small models.
- Good everyday assistant answers are likely **$0.003-0.02 per query** if retrieval is tight.
- Complex cross-project synthesis or premium-model reasoning can become **$0.03-0.15+ per query** if the system sends too much context.
- Drawing/image interpretation is harder to estimate and should be separately metered per upload/page.

Practical guardrail:
- During pilot, default to cheap models for 80-90% of assistant work.
- Escalate only when the user asks for synthesis, the confidence score is low, or the answer touches high-impact decisions.
- If a user repeats a question that can be answered by filters, return database results without AI.

### One-time / development:
- Wilson's time (Claude Code as collaborator): 4-8 weeks for Phase 1-2
- If hiring help for frontend later: budget separately

### Why this is cheap:
At 70 staff, comparable SaaS like Procore would cost $5,000+/month. Even Airtable Business at scale is $240+/month and would not give the proactive intelligence layer.

---

## 9. Risks & Load-Bearing Assumptions

### Critical assumption (if false, the project fails):
**Staff will actually use DATUM as the project memory surface.** If staff keep decisions only in WhatsApp/Trello and do not create DATUM notes/drafts, the structured database will stay incomplete. Mitigation: Trello import, familiar Kanban-style topic cards, fast app entry, assistant-assisted drafting, and clear rules that official project memory lives in DATUM.

### Second-order risks:

1. **Assistant data leakage.** A user may ask for cost-sensitive data or the assistant may try to answer from raw imported history. Mitigation: enforce Supabase Auth, cost-visibility permissions, structured-data-first rules, source logging, and deny-by-default cost access.

2. **AI cost creep.** Internal chat can become expensive if everyone uses it for broad questions. Mitigation: per-user/per-role usage limits, cached summaries, structured filters for common queries, and query audit reports.

3. **Draft backlog.** Assistant-created drafts and Trello imports could pile up without review. Mitigation: allow broad staff approval for visible records, keep all changes append-only, and track draft aging.

4. **Client communication remains in chaos.** This system explicitly does not parse all raw client chat. If PICs do not curate client decisions into the app, scattered decision history persists. Mitigation: make "PIC curated decision note with source screenshot" a required workflow for client decisions.

5. **Wilson is sole maintainer.** If Wilson is unavailable, no one can fix breakages. Mitigation: document everything in this blueprint, identify second technical owner within 6 months, keep code simple enough to hand off.

6. **Synology NAS dependency.** If anything operational lives on NAS, downtime breaks the system. Mitigation: NAS is read-only for design master files; all operational data lives in Supabase.

7. **AI hallucination in drawing parsing or assistant answers.** AI might invent a room, misread finish specs, or summarize a decision too strongly. Mitigation: source citations on every answer, draft-before-official workflow, and Carissa-validated drawing extraction.

---

## 10. Next Steps (Immediate)

1. **Wilson decision:** Confirm DATUM app-first stack (Supabase + Expo + Next.js admin + internal assistant + WhatsApp notifications only).

2. **Provision accounts:**
   - Supabase project (Indonesia region: Singapore if available)
   - Vercel account linked to GitHub
   - Expo account / internal distribution path
   - Fonnte or Wablas WhatsApp notification account
   - AI API key (Anthropic/OpenAI; provider can remain swappable)

3. **Define pilot scope:** Pick 2-3 active finishing projects and 5-8 pilot users (Wilson, Carissa, 2-3 PICs, 1-2 site supervisors). Import their Trello boards and set up staff permissions.

4. **Build Phase 1 with Claude Code:** Schema → Trello import → project topics → app filters → internal assistant → data drafts → authorized WhatsApp notifications. Target 4 weeks.

5. **Establish DATUM entry conventions** with pilot users:
   - Every official memory item belongs to a project and topic
   - Client decisions need source evidence or PIC note
   - High-risk records become drafts until approved
   - Photos and attachments should be added inside the topic whenever possible

6. **Set up assistant and draft logging from day 1** — every assistant message, tool call, data draft, source record, and cost estimate is logged.

7. **Schedule Phase 1 retro after 4 weeks of pilot use** to decide Phase 2 go/no-go and incorporate learnings.

---

## 11. Open Questions to Resolve Before Phase 1 Build

- [ ] **Project naming standardization.** Confirm client name, site address, and project code aliases for active projects.
- [ ] **Pilot project selection.** Which 2-3 finishing projects, and which PICs are assigned to them?
- [x] **WhatsApp notification policy.** All system event categories may trigger WhatsApp notifications when enabled; DATUM remains the main retrieval/communication surface.
- [ ] **Cost visibility list.** Which PICs/project managers can see invoices, vendor prices, VO/micro-VO, and margin-sensitive data?
- [ ] **Assistant budget limits.** What monthly cap should trigger automatic downgrade to cheaper models or filter-only mode?
- [ ] **NAS-to-cloud bridge.** Do you want a mechanism to mirror NAS drawing files into Supabase Storage, or upload them manually as needed?
- [x] **Trello migration.** Run Trello and the new app in parallel during pilot, then decide whether to sunset Trello after 8 weeks of stable use.
- [ ] **Client-facing read access.** Do clients eventually get a read-only dashboard view of their own project? (Defer this question to Phase 3+.)

---

**End of blueprint v1.1**
