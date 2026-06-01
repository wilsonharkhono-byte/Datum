-- 20260601000011_draft_card_event_kind.sql
-- Slice 1.2d: add 'card_event' to draft_type enum so chat-captured high-risk events
-- can be staged as data_drafts before promotion to card_events.
--
-- proposed_payload shape for this type: { kind: <card_event_kind>, payload: {...}, card_id, occurred_at }

alter type public.draft_type add value if not exists 'card_event';
