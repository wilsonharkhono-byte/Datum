-- 20260601000015_cards_properties_gin.sql
-- Slice 1.7: GIN index on cards.properties so import lookup by trello_card_id is fast.

begin;

create index if not exists cards_properties_gin_idx on public.cards using gin (properties);

commit;
