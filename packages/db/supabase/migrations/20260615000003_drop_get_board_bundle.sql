-- Drop the unused get_board_bundle RPC.
--
-- The board read was reverted to direct per-table queries (the bundled RPC
-- failed for authenticated users — evaluating the cards-layer RLS for every
-- sub-select inside one function erred). Nothing calls this function anymore,
-- and leaving an unused SECURITY DEFINER (RLS-bypassing) function exposed to the
-- `authenticated` role via PostgREST is needless surface. Remove it.
drop function if exists public.get_board_bundle(text);
