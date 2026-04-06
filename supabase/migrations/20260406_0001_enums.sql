do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'source_type'
  ) then
    create type public.source_type as enum ('auction', 'onbid', 'realtor', 'general');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'submitter_type'
  ) then
    create type public.submitter_type as enum ('realtor', 'owner', 'admin');
  end if;
end
$$;
