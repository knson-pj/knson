-- =============================================================================
-- knson 동영상 기능 — property_videos 테이블 + RLS (2026-05-04)
-- =============================================================================
--
-- 신규 매물 동영상 메타데이터 저장 테이블.
-- 사진 테이블(property_photos)과 동일한 패턴을 따라 service_role 전용 RLS 로
-- 운영한다. 백엔드 API (/api/properties?video_action=...) 가 service_role 키로
-- DB 와 Storage 에 접근하므로, 클라이언트는 이 테이블에 직접 접근할 수 없다.
--
-- 설계 노트:
--   1) property_id 는 text. property_photos 와 동일 타입으로 맞춰 자유로운 식별자
--      (uuid / global_id / item_no) 를 수용한다.
--   2) storage_path / poster_path 는 Supabase Storage 의 객체 경로.
--      예: properties/{propertyId}/videos/original/{videoId}.mp4
--          properties/{propertyId}/videos/poster/{videoId}.jpg
--   3) duration_sec 는 클라이언트에서 측정한 재생시간(초). 5분(300초) 상한.
--   4) is_primary / sort_order 는 사진과 동일한 의미.
--   5) deleted_at 가 NULL 인 row 만 활성. soft delete + Storage 객체 즉시 제거.
--   6) RLS: service_role 만 ALL 가능. anon/authenticated 는 직접 접근 불가.
-- =============================================================================


create table if not exists public.property_videos (
  id uuid not null default gen_random_uuid(),
  property_id text not null,
  property_global_id text,
  storage_path text not null,
  poster_path text,
  mime_type text,
  duration_sec integer,
  width integer,
  height integer,
  size_bytes bigint,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  uploaded_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  constraint property_videos_pkey primary key (id),
  constraint property_videos_duration_check
    check (duration_sec is null or (duration_sec >= 0 and duration_sec <= 600)),
  constraint property_videos_size_check
    check (size_bytes is null or size_bytes >= 0)
);


-- 활성 동영상을 매물별로 빠르게 조회 + 정렬
create index if not exists property_videos_property_active_idx
  on public.property_videos (property_id, sort_order, created_at)
  where deleted_at is null;

-- 매물별 활성 동영상 개수 카운트용 (5개 상한 검증)
create index if not exists property_videos_property_active_count_idx
  on public.property_videos (property_id)
  where deleted_at is null;


-- updated_at 자동 갱신 트리거
-- (knson 표준: 0005_helper_functions.sql 의 set_updated_at() 재사용)
do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'set_updated_at' and n.nspname = 'public'
  ) and not exists (
    select 1 from pg_trigger
     where tgname = 'property_videos_set_updated_at'
       and tgrelid = 'public.property_videos'::regclass
  ) then
    create trigger property_videos_set_updated_at
      before update on public.property_videos
      for each row execute function public.set_updated_at();
  end if;
end
$$;


-- RLS 활성화
alter table public.property_videos enable row level security;


-- 정책: service_role 만 ALL 가능 (백엔드 API 경로)
-- anon / authenticated 는 직접 접근 불가 — 사진 정책과 동일 철학
drop policy if exists property_videos_all_service on public.property_videos;
create policy property_videos_all_service
  on public.property_videos
  for all
  to service_role
  using (true)
  with check (true);


-- =============================================================================
-- 적용 검증
-- =============================================================================
-- 1) 테이블이 생성됐는지
-- select count(*) from information_schema.tables
--   where table_schema = 'public' and table_name = 'property_videos';
-- → 1 row 기대
--
-- 2) RLS 가 활성화됐는지
-- select relname, relrowsecurity from pg_class
--   where relname = 'property_videos';
-- → relrowsecurity = true 기대
--
-- 3) 정책이 service_role 전용인지
-- select policyname, roles from pg_policies
--   where schemaname = 'public' and tablename = 'property_videos';
-- → property_videos_all_service / {service_role} 기대


-- =============================================================================
-- 롤백 (문제 발생 시)
-- =============================================================================
-- drop trigger if exists property_videos_set_updated_at on public.property_videos;
-- drop policy if exists property_videos_all_service on public.property_videos;
-- drop index if exists public.property_videos_property_active_idx;
-- drop index if exists public.property_videos_property_active_count_idx;
-- drop table if exists public.property_videos;

-- =============================================================================
-- END
-- =============================================================================
