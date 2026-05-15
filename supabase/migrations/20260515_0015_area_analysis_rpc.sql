-- =============================================================================
-- 2026-05-15 #0015 — 상권분석 (area analysis) RPC 함수
-- =============================================================================
-- platform 회원이 매물 상세 패널에서 "상권분석" 버튼을 누를 때 호출되는
-- 반경 기반 건물 조회 함수.
--
-- 입력: 중심 좌표(WGS84 lat/lng) + 반경(m, 50~2000)
-- 출력: 반경 안 모든 건물의 분류·세대수·추정인구 + 오피스텔 호 보유 여부
--
-- 성능:
--   - public.buildings.geom 의 GIST 인덱스(idx_buildings_geom) 활용
--   - ST_DWithin 은 geography 캐스팅하여 미터 단위 정확 거리 계산
--   - building_units 의 오피스텔 호 보유 여부는 EXISTS subquery 로 한 번에 처리
--
-- 보안:
--   - SECURITY DEFINER 미사용 (호출자 권한 그대로) — RLS 통과
--   - STABLE — 동일 입력에 동일 출력, 부작용 없음
--   - 입력값 범위 가드(반경 50~2000) — 클라이언트 우회 대비
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_buildings_around(
  p_lat double precision,
  p_lng double precision,
  p_radius double precision
)
RETURNS TABLE (
  id bigint,
  lat double precision,
  lng double precision,
  purpose_class text,
  res_type text,
  main_purps_cd_nm text,
  bld_nm text,
  hhld_cnt integer,
  fmly_cnt integer,
  unit_count integer,
  est_pop_by_area numeric,
  has_officetel_unit boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH guard AS (
    -- 입력값 범위 가드 (클라이언트 우회 대비)
    SELECT
      CASE WHEN p_lat  BETWEEN  33.0 AND  39.0 THEN p_lat  ELSE NULL END AS lat,
      CASE WHEN p_lng  BETWEEN 124.0 AND 132.0 THEN p_lng  ELSE NULL END AS lng,
      CASE WHEN p_radius BETWEEN 50 AND 2000   THEN p_radius ELSE 300 END AS radius
  )
  SELECT
    b.id,
    b.latitude  AS lat,
    b.longitude AS lng,
    b.purpose_class,
    b.res_type,
    b.main_purps_cd_nm,
    b.bld_nm,
    b.hhld_cnt,
    b.fmly_cnt,
    b.unit_count,
    b.est_pop_by_area,
    EXISTS (
      SELECT 1
      FROM public.building_units u
      WHERE u.building_id = b.id
        AND u.purps_cd_nm ILIKE '%오피스텔%'
    ) AS has_officetel_unit
  FROM public.buildings b, guard g
  WHERE g.lat IS NOT NULL
    AND g.lng IS NOT NULL
    AND b.geom IS NOT NULL
    AND ST_DWithin(
      b.geom::geography,
      ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
      g.radius
    )
$function$;

-- 익명/인증된 사용자/서비스 키 모두 RPC 호출 가능
-- (실제 호출은 platform API 서버에서만 service_role 키로 진행되지만,
--  RLS 정책상 buildings 테이블을 읽을 수 있는 권한이 있는 주체는 모두 허용)
GRANT EXECUTE ON FUNCTION public.public_buildings_around(double precision, double precision, double precision)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.public_buildings_around(double precision, double precision, double precision) IS
  '상권분석 — 좌표(WGS84) + 반경(m) 안 모든 건물 메타 + 오피스텔 호 보유 여부 반환. ST_DWithin geography 사용.';
