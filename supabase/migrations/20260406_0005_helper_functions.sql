CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select
    coalesce(lower(auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'
    or coalesce(lower(auth.jwt() -> 'user_metadata' ->> 'role'), '') = 'admin'
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role, '')) = 'admin'
    );
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_profiles_role_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- SQL Editor / 서비스 키처럼 auth.uid()가 NULL인 컨텍스트는 통과(관리자 운영용)
  if auth.uid() is null then
    return new;
  end if;

  if (tg_op = 'INSERT') then
    -- 사용자가 자기 프로필을 만들 때 role은 항상 staff로 강제
    new.role := 'staff';
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    -- role 변경은 관리자만 허용
    if new.role is distinct from old.role then
      if not public.is_admin() then
        raise exception 'not allowed: cannot change role';
      end if;
    end if;
    return new;
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.normalize_property_floor_key(p_floor text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  s text := btrim(coalesce(p_floor, ''));
  n int;
begin
  if s = '' then
    return '0';
  end if;

  if s ~* '^(B|지하)\s*([0-9]{1,2})\s*층?$' then
    return 'b' || regexp_replace(s, '^(?:B|b|지하)\s*([0-9]{1,2}).*$', '\1');
  end if;

  if s ~ '^[0-9]{1,2}\s*층?$' then
    n := regexp_replace(s, '[^0-9]', '', 'g')::int;
    if n between 1 and 99 then
      return n::text;
    end if;
  end if;

  return '0';
end;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_property_floor_key_v2(p_floor text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  s text := btrim(coalesce(p_floor, ''));
  n int;
begin
  if s = '' then
    return '0';
  end if;

  if s ~* '^(B|지하)\s*([0-9]{1,2})\s*층?$' then
    return 'b' || regexp_replace(s, '^(?:B|b|지하)\s*([0-9]{1,2}).*$', '\1');
  end if;

  if s ~ '^[0-9]{1,2}\s*층?$' then
    n := regexp_replace(s, '[^0-9]', '', 'g')::int;
    if n between 1 and 99 then
      return n::text;
    end if;
  end if;

  return '0';
end;
$function$;

CREATE OR REPLACE FUNCTION public.extract_property_ho_key_v2(p_raw jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  s text := '';
begin
  if p_raw is null then
    return '0';
  end if;

  s := coalesce(
    nullif(btrim(coalesce(p_raw->>'ho', '')), ''),
    nullif(btrim(coalesce(p_raw->>'unit', '')), ''),
    nullif(btrim(coalesce(p_raw->>'room', '')), ''),
    ''
  );

  if s <> '' then
    if s ~ '^[0-9]{1,5}$' then
      return s;
    end if;

    if s ~ '([0-9]{1,5})\s*호' then
      return regexp_replace(s, '^.*?([0-9]{1,5})\s*호.*$', '\1');
    end if;
  end if;

  s := coalesce(
    nullif(btrim(coalesce(p_raw->>'detailAddress', '')), ''),
    nullif(btrim(coalesce(p_raw->>'상세주소', '')), ''),
    ''
  );

  if s ~ '([0-9]{1,5})\s*호' then
    return regexp_replace(s, '^.*?([0-9]{1,5})\s*호.*$', '\1');
  end if;

  return '0';
end;
$function$;
