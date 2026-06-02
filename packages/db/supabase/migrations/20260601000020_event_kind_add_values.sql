-- 20260601000020a_event_kind_add_values.sql
-- Slice 1.9-taxonomy step 1: add the two new enum values 'vendor' and 'work'.
-- Postgres requires ALTER TYPE ADD VALUE to run outside a transaction.

alter type public.card_event_kind add value if not exists 'vendor';
alter type public.card_event_kind add value if not exists 'work';
