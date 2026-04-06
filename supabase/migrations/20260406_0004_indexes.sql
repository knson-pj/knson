-- properties
create index if not exists properties_assignee_idx on public.properties using btree (assignee_id);
create index if not exists properties_general_idx on public.properties using btree (is_general);
create index if not exists properties_source_idx on public.properties using btree (source_type);
create index if not exists properties_source_submitter_idx on public.properties using btree (source_type, submitter_type);
create index if not exists properties_submitter_type_idx on public.properties using btree (submitter_type);

-- Canonical global_id unique index. The live DB had a duplicate (`properties_global_id_uq`) which is intentionally omitted here.
create unique index if not exists uq_properties_global_id
  on public.properties using btree (global_id)
  where (nullif(btrim(global_id), ''::text) is not null);

create unique index if not exists uq_properties_registration_identity_key
  on public.properties using btree (registration_identity_key)
  where (nullif(btrim(registration_identity_key), ''::text) is not null);

create unique index if not exists uq_properties_registration_identity_key_v2_strict
  on public.properties using btree (registration_identity_key_v2)
  where ((registration_identity_confidence = 'strict'::text) and (nullif(btrim(registration_identity_key_v2), ''::text) is not null));

-- property_activity_logs
create index if not exists idx_property_activity_logs_actor_date
  on public.property_activity_logs using btree (actor_id, action_date desc, created_at desc);

create index if not exists idx_property_activity_logs_identity_key
  on public.property_activity_logs using btree (property_identity_key)
  where (property_identity_key is not null);

create index if not exists idx_property_activity_logs_property_id
  on public.property_activity_logs using btree (property_id)
  where (property_id is not null);

-- property_photos
create index if not exists idx_property_photos_global
  on public.property_photos using btree (property_global_id, deleted_at);

create index if not exists idx_property_photos_property
  on public.property_photos using btree (property_id, deleted_at, sort_order);

create unique index if not exists uq_property_photos_primary_per_property
  on public.property_photos using btree (property_id)
  where ((is_primary = true) and (deleted_at is null));
