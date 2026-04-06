CREATE OR REPLACE FUNCTION public.compute_property_registration_identity_key(p_address text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  compact text;
  m text[];
  dong text := '';
  main_no text := '';
  sub_no text := '';
  floor_key text := '0';
  ho_src text := '';
  ho_key text := '';
begin
  compact := regexp_replace(coalesce(p_address, ''), '\s+', '', 'g');

  m := regexp_match(compact, '([가-힣A-Za-z0-9]+(?:동|읍|면|리))(산?\d+)(?:-(\d+))?');
  if m is null then
    return '';
  end if;

  dong := coalesce(m[1], '');
  main_no := coalesce(m[2], '');
  sub_no := coalesce(m[3], '');

  floor_key := public.normalize_property_floor_key(
    coalesce(
      p_raw->>'floor',
      p_raw->>'층',
      ''
    )
  );

  ho_src := coalesce(
    nullif(btrim(coalesce(p_raw->>'ho', '')), ''),
    nullif(btrim(coalesce(p_raw->>'unit', '')), ''),
    nullif(btrim(coalesce(p_raw->>'room', '')), ''),
    nullif(btrim(coalesce(p_raw->>'detailAddress', '')), ''),
    nullif(btrim(coalesce(p_raw->>'상세주소', '')), ''),
    ''
  );

  if ho_src ~ '([0-9]{1,5})\s*호' then
    ho_key := regexp_replace(ho_src, '^.*?([0-9]{1,5})\s*호.*$', '\1');
  else
    ho_key := '0';
  end if;

  return dong || '|' || main_no || '|' || coalesce(nullif(sub_no, ''), '0') || '|' || floor_key || '|' || coalesce(nullif(ho_key, ''), '0');
end;
$function$;

CREATE OR REPLACE FUNCTION public.compute_property_registration_identity_key_v2(p_address text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  normalized text;
  compact text;
  m text[];
  dong text := '';
  main_no text := '';
  sub_no text := '';
  floor_key text := '0';
  ho_key text := '0';
begin
  normalized := regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g');
  normalized := btrim(normalized);

  m := regexp_match(normalized, '([가-힣A-Za-z0-9]+(?:동|읍|면|리))\s+(산?\d+)(?:-(\d+))?');

  if m is null then
    compact := regexp_replace(coalesce(p_address, ''), '\s+', '', 'g');
    m := regexp_match(compact, '([가-힣A-Za-z0-9]+(?:동|읍|면|리))(산?\d+)(?:-(\d+))?');
  end if;

  if m is null then
    return '';
  end if;

  dong := coalesce(m[1], '');
  main_no := coalesce(m[2], '');
  sub_no := coalesce(m[3], '');

  floor_key := public.normalize_property_floor_key_v2(
    coalesce(
      p_raw->>'floor',
      p_raw->>'층',
      ''
    )
  );

  ho_key := public.extract_property_ho_key_v2(p_raw);

  return dong
    || '|' || main_no
    || '|' || coalesce(nullif(sub_no, ''), '0')
    || '|' || coalesce(nullif(floor_key, ''), '0')
    || '|' || coalesce(nullif(ho_key, ''), '0');
end;
$function$;

CREATE OR REPLACE FUNCTION public.compute_property_registration_confidence_v2(p_address text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  k text;
  ho_key text;
begin
  k := public.compute_property_registration_identity_key_v2(p_address, p_raw);
  if k = '' then
    return null;
  end if;

  ho_key := public.extract_property_ho_key_v2(p_raw);

  if ho_key <> '0' then
    return 'strict';
  end if;

  return 'weak';
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_public_property_numbers()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.source_type = 'general' then
    new.is_general := true;
    if new.submitter_type is null then new.submitter_type := 'owner'; end if;
  elsif new.source_type = 'realtor' then
    new.is_general := false;
    if new.submitter_type is null then new.submitter_type := 'realtor'; end if;
  end if;

  if (new.status is null or btrim(new.status) = '') and new.source_type in ('general', 'realtor') then
    new.status := 'review';
  end if;

  if new.source_type in ('general', 'realtor') and (new.item_no is null or btrim(new.item_no) = '') then
    if new.source_type = 'general' then
      new.item_no := 'G' || nextval('public.properties_general_seq');
    elsif new.source_type = 'realtor' then
      new.item_no := 'R' || nextval('public.properties_realtor_seq');
    end if;
  end if;

  if new.global_id is null or btrim(new.global_id) = '' then
    if new.item_no is not null and btrim(new.item_no) <> '' then
      new.global_id := new.source_type::text || ':' || new.item_no;
    else
      new.global_id := new.source_type::text || ':' || gen_random_uuid()::text;
    end if;
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_staff_property_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_uid uuid := auth.uid();
begin
  -- 서버 API(service_role)로 들어온 수정은 통과
  if v_role = 'service_role' then
    return new;
  end if;

  -- 로그인 사용자 없으면 차단
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  -- 담당자가 자기 배정 물건만 수정 가능
  if coalesce(old.assignee_id, new.assignee_id) is distinct from v_uid then
    raise exception 'not allowed';
  end if;

  -- 담당자는 assignee_id 자체를 바꾸면 안 됨
  if new.assignee_id is distinct from old.assignee_id then
    raise exception 'not allowed';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_properties_identity_key()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.global_id := nullif(btrim(coalesce(new.global_id, '')), '');

  new.registration_identity_key := nullif(
    btrim(
      coalesce(
        new.registration_identity_key,
        new.raw->>'registrationIdentityKey',
        ''
      )
    ),
    ''
  );

  if new.raw is null then
    new.raw := '{}'::jsonb;
  end if;

  if new.registration_identity_key is not null then
    new.raw := jsonb_set(
      new.raw,
      '{registrationIdentityKey}',
      to_jsonb(new.registration_identity_key),
      true
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_properties_identity_key_v2()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.raw is null then
    new.raw := '{}'::jsonb;
  end if;

  new.registration_identity_key_v2 := nullif(
    btrim(public.compute_property_registration_identity_key_v2(new.address, new.raw)),
    ''
  );

  new.registration_identity_confidence := public.compute_property_registration_confidence_v2(new.address, new.raw);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_property_photos_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
