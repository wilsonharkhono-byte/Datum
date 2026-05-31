-- DATUM Slice 1.0 — RLS for all Slice 1 tables (read + write)

------------------------------------------------------------------------
-- Enable RLS on all 15 new tables
------------------------------------------------------------------------
alter table public.topics                 enable row level security;
alter table public.topic_notes            enable row level security;
alter table public.drawings               enable row level security;
alter table public.drawing_revisions      enable row level security;
alter table public.attachments            enable row level security;
alter table public.area_gate_checkpoints  enable row level security;
alter table public.area_gate_blockers     enable row level security;
alter table public.decisions              enable row level security;
alter table public.material_items         enable row level security;
alter table public.material_milestones    enable row level security;
alter table public.vendors                enable row level security;
alter table public.vendor_quotes          enable row level security;
alter table public.invoices               enable row level security;
alter table public.data_drafts            enable row level security;
alter table public.review_queue           enable row level security;

------------------------------------------------------------------------
-- Topics + topic_notes (project-scoped; reads + writes by assigned staff)
------------------------------------------------------------------------
create policy topics_read on public.topics
  for select using (public.current_can_read_project(project_id));
create policy topics_insert on public.topics
  for insert with check (public.current_can_read_project(project_id));
create policy topics_update on public.topics
  for update using (public.current_can_read_project(project_id));

create policy topic_notes_read on public.topic_notes
  for select using (public.current_can_read_project(project_id));
create policy topic_notes_insert on public.topic_notes
  for insert with check (public.current_can_read_project(project_id));
create policy topic_notes_update_author_or_approver on public.topic_notes
  for update using (
    created_by_staff_id = auth.uid()
    or public.current_has_cross_project_read()
  );

------------------------------------------------------------------------
-- Drawings register
------------------------------------------------------------------------
create policy drawings_read on public.drawings
  for select using (public.current_can_read_project(project_id));
create policy drawings_insert on public.drawings
  for insert with check (public.current_can_read_project(project_id));
create policy drawings_update on public.drawings
  for update using (public.current_can_read_project(project_id));

create policy drawing_revisions_read on public.drawing_revisions
  for select using (
    exists (
      select 1 from public.drawings d
      where d.id = drawing_id and public.current_can_read_project(d.project_id)
    )
  );
create policy drawing_revisions_insert on public.drawing_revisions
  for insert with check (
    exists (
      select 1 from public.drawings d
      where d.id = drawing_id and public.current_can_read_project(d.project_id)
    )
  );

------------------------------------------------------------------------
-- Attachments
------------------------------------------------------------------------
create policy attachments_read on public.attachments
  for select using (public.current_can_read_project(project_id));
create policy attachments_insert on public.attachments
  for insert with check (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- Area-gate checkpoints + blockers
------------------------------------------------------------------------
create policy area_gate_checkpoints_read on public.area_gate_checkpoints
  for select using (public.current_can_read_project(project_id));
create policy area_gate_checkpoints_insert on public.area_gate_checkpoints
  for insert with check (public.current_can_read_project(project_id));
create policy area_gate_checkpoints_update on public.area_gate_checkpoints
  for update using (public.current_can_read_project(project_id));

create policy area_gate_blockers_read on public.area_gate_blockers
  for select using (public.current_can_read_project(project_id));
create policy area_gate_blockers_insert on public.area_gate_blockers
  for insert with check (public.current_can_read_project(project_id));
create policy area_gate_blockers_update on public.area_gate_blockers
  for update using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- Decisions
------------------------------------------------------------------------
create policy decisions_read on public.decisions
  for select using (public.current_can_read_project(project_id));
create policy decisions_insert on public.decisions
  for insert with check (public.current_can_read_project(project_id));
create policy decisions_update on public.decisions
  for update using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- Material items (rows visible project-scoped; unit_price column-level filter deferred to 1.3)
------------------------------------------------------------------------
create policy material_items_read on public.material_items
  for select using (public.current_can_read_project(project_id));
create policy material_items_insert on public.material_items
  for insert with check (public.current_can_read_project(project_id));
create policy material_items_update on public.material_items
  for update using (public.current_can_read_project(project_id));

create policy material_milestones_read on public.material_milestones
  for select using (
    exists (
      select 1 from public.material_items mi
      where mi.id = material_item_id and public.current_can_read_project(mi.project_id)
    )
  );
create policy material_milestones_insert on public.material_milestones
  for insert with check (
    exists (
      select 1 from public.material_items mi
      where mi.id = material_item_id and public.current_can_read_project(mi.project_id)
    )
  );

------------------------------------------------------------------------
-- Vendors (catalog readable by all authenticated; writes by privileged roles)
------------------------------------------------------------------------
create policy vendors_read_authenticated on public.vendors
  for select using (auth.uid() is not null);
create policy vendors_write_privileged on public.vendors
  for insert with check (public.current_has_cross_project_read());
create policy vendors_update_privileged on public.vendors
  for update using (public.current_has_cross_project_read());

------------------------------------------------------------------------
-- Vendor quotes + invoices (COST-SENSITIVE — only cost-visible users)
------------------------------------------------------------------------
create policy vendor_quotes_read_cost_visible on public.vendor_quotes
  for select using (
    public.current_can_read_project(project_id)
    and public.current_cost_visible_for(project_id)
  );
create policy vendor_quotes_insert_cost_visible on public.vendor_quotes
  for insert with check (
    public.current_can_read_project(project_id)
    and public.current_cost_visible_for(project_id)
  );
create policy vendor_quotes_update_cost_visible on public.vendor_quotes
  for update using (
    public.current_can_read_project(project_id)
    and public.current_cost_visible_for(project_id)
  );

create policy invoices_read_cost_visible on public.invoices
  for select using (
    public.current_can_read_project(project_id)
    and public.current_cost_visible_for(project_id)
  );
create policy invoices_insert_cost_visible on public.invoices
  for insert with check (
    public.current_can_read_project(project_id)
    and public.current_cost_visible_for(project_id)
  );
create policy invoices_update_cost_visible on public.invoices
  for update using (
    public.current_can_read_project(project_id)
    and public.current_cost_visible_for(project_id)
  );

------------------------------------------------------------------------
-- data_drafts + review_queue
------------------------------------------------------------------------
create policy data_drafts_read on public.data_drafts
  for select using (public.current_can_read_project(project_id));
create policy data_drafts_insert on public.data_drafts
  for insert with check (public.current_can_read_project(project_id));
create policy data_drafts_update_author_or_approver on public.data_drafts
  for update using (
    created_by_staff_id = auth.uid()
    or public.current_has_cross_project_read()
  );

create policy review_queue_read on public.review_queue
  for select using (public.current_can_read_project(project_id));
create policy review_queue_insert on public.review_queue
  for insert with check (public.current_can_read_project(project_id));
create policy review_queue_update on public.review_queue
  for update using (public.current_can_read_project(project_id));
