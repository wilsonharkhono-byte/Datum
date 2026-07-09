-- 20260708000002_whatsapp_messages.sql
-- WhatsApp (Meta Cloud API) send log — Phase 1, one-way, own team only.
-- Records every outbound template-message attempt made by the server-side
-- sendWhatsAppTemplate() fan-out (apps/web/lib/notifications/whatsapp-send.ts),
-- alongside the existing in-app `notifications` and Expo `push_tokens` channels.
-- No webhook yet: status only ever reaches 'sent' or 'failed' here; the
-- 'delivered'/'read' states are reserved for a future webhook-driven update.
-- Service-role only — no RLS policies, matching other server-only tables
-- (e.g. record_revisions).

begin;

create table if not exists public.whatsapp_messages (
  id             uuid primary key default gen_random_uuid(),
  recipient_kind text not null check (recipient_kind in ('staff','vendor')),
  staff_id       uuid references public.staff(id) on delete set null,
  vendor_id      uuid references public.vendors(id) on delete set null,
  phone          text not null,
  template_name  text not null,
  payload        jsonb not null default '{}'::jsonb,
  wamid          text unique,
  status         text not null default 'queued'
                 check (status in ('queued','sent','delivered','read','failed')),
  error          text,
  dedupe_key     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists whatsapp_messages_dedupe_idx on public.whatsapp_messages (dedupe_key, created_at desc);

alter table public.whatsapp_messages enable row level security;
-- no policies: service-role only, matching other server-only tables

commit;
