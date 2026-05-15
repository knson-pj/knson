-- ============================================
-- lottobigag v1.10 데이터베이스 마이그레이션
--   v1.9 → v1.10 (v1.25 보안 강화 — 34추출 번호 비공개화)
--
-- 사장님 정책 결정 (2026-05-15):
--   - 비결제자: 어떤 회차의 34번호도 못 봄
--   - 결제자  : 본인 결제 회차의 34번호를 결제 직후 ~ 그 회차 추첨 시작 시점까지만
--   - 추첨 후 : 결제자에게도 풀 자체는 비공개 (등수 배지·당첨번호·조합 안 적중 강조만 남음)
--   - 관리자  : 관리자 권한 검증 통과 시 운영 도구로 조회 가능 (백엔드 endpoint 경유)
--
-- 구현 방식 (PostgreSQL 컬럼 단위 GRANT):
--   1. engine_history 의 anon/authenticated SELECT 권한 회수
--   2. extract_pool 을 제외한 모든 컬럼에 대해 SELECT 권한 명시 재부여
--   3. extract_pool 은 service_role 만 접근 가능 (백엔드 endpoint 경유 강제)
--
-- 적용 순서 (반드시 준수):
--   1) 백엔드 v1.25 stage1 배포 + 신규 endpoint 검증 (curl/Postman)
--   2) 프론트 v1.25 stage2 배포 (호출처 신규 endpoint 로 교체)
--   3) **본 마이그레이션 적용** (Supabase SQL Editor)
--   4) caching.py 의 current_pool 배열 제거 (stage2 의 contract 단계)
--
--   주의: 본 마이그레이션을 프론트 v1.25 stage2 배포 전에 적용하면
--         운영 중인 v1.24 의 관리자 페이지 / 결과 페이지가 깨짐.
--         (fetchRecentExtractPools / fetchRoundResultForOrder 가 권한 에러로 실패)
--
-- 멱등성: 본 마이그레이션은 안전하게 반복 실행 가능.
--          (revoke 는 권한 없으면 no-op, grant 는 idempotent)
--
-- 선행 조건: schema.sql + migration_v1.1.sql + migration_v1.3.sql + migration_v1.9.sql 적용 완료.
-- ============================================


-- ============================================
-- 1. engine_history 의 기존 SELECT 권한 회수
--    (Supabase 기본 정책: schema public 의 모든 테이블이 anon/authenticated 에게
--     암묵적으로 SELECT 가능 상태로 시작됨)
-- ============================================
revoke select on public.engine_history from anon;
revoke select on public.engine_history from authenticated;


-- ============================================
-- 2. extract_pool 을 제외한 모든 컬럼에 SELECT 권한 명시 재부여
--    (메인/주문/로그 페이지 + 관리자 미완료 회차 카드 — 영향 0)
--
--    컬럼 추가 시 본 GRANT 도 함께 갱신 필요 (다음 마이그레이션 작성 시점).
-- ============================================
grant select (
    round,
    standard_pool_size,
    standard_prize_1,
    standard_prize_2,
    standard_prize_3,
    standard_prize_4,
    standard_prize_5,
    paid_recommend_combos,
    paid_recommend_prize_1,
    paid_recommend_prize_2,
    paid_recommend_prize_3,
    paid_recommend_prize_4,
    paid_recommend_prize_5,
    paid_custom_combos,
    paid_custom_prize_1,
    paid_custom_prize_2,
    paid_custom_prize_3,
    paid_custom_prize_4,
    paid_custom_prize_5,
    extract_main_match,
    extract_bonus_match,
    analysis_phases,
    calculated_at,
    recalculated_at
) on public.engine_history to anon, authenticated;


-- ============================================
-- 3. RLS 정책은 그대로 유지 (Public read using (true))
--    이유: PostgreSQL 의 GRANT 와 RLS 는 AND 조건으로 동작.
--          GRANT 가 없는 컬럼은 RLS 정책이 통과해도 select 불가.
--          (RLS 만 닫으면 다른 컬럼도 함께 닫혀 메인/로그 페이지 깨짐)
-- ============================================
-- 기존 정책 확인 — drop/recreate 안 함 (v1.3 그대로 유지)
--   "Public read engine_history" on public.engine_history for select using (true)


-- ============================================
-- 4. 검증 쿼리 (수동 실행용 — 적용 후 안전 확인)
-- ============================================
-- A. anon 키로 extract_pool 직접 조회 시 권한 거부 확인
--    (Supabase Studio → SQL Editor → 'Run as: anon' 실행 또는 PostgREST 호출)
--
--      select extract_pool from public.engine_history limit 1;
--      → 기대: ERROR — permission denied for column extract_pool
--
-- B. anon 키로 통계 컬럼은 정상 조회 가능 확인
--      select round, standard_pool_size, extract_main_match
--        from public.engine_history limit 1;
--      → 기대: 정상 결과
--
-- C. service_role 키로 extract_pool 전체 컬럼 정상 조회 가능 확인
--    (Studio 의 'Run as: postgres' 또는 service_role 키로 PostgREST 호출)
--      select extract_pool from public.engine_history limit 1;
--      → 기대: 정상 결과 (백엔드 endpoint 가 사용하는 경로)


-- ============================================
-- 5. 영향 범위 (확인된 사실)
-- ============================================
-- 정상 동작 유지 (extract_pool 미사용 호출):
--   - lib/round-logs.ts :: fetchRecentRoundLogs(limit)  [v1.23 함수, 메인/주문 페이지]
--   - app/log/page.tsx                                   [50회차 조회]
--   - app/admin/page.tsx :: 표준풀 재계산 카드 (pendingRes)
--
-- 깨지는 호출 (프론트 v1.25 stage2 에서 백엔드 endpoint 호출로 교체됨):
--   - lib/round-logs.ts :: fetchRecentExtractPools(limit)
--     → 백엔드 GET /api/admin/recent-pools 로 대체 (관리자 페이지)
--   - lib/round-logs.ts :: fetchRoundResultForOrder(round)
--     → 백엔드 GET /api/orders/{orderId}/extract-pool 로 대체 (결과 페이지)
--
-- 백엔드 영향 0:
--   - service_role 키 사용 → 컬럼 권한 회수 영향 받지 않음
--   - api/caching.py :: get_or_compute_extract_engine_info()
--   - api/routers/admin_lotto.py :: process (5-6 백그라운드)


-- ============================================
-- 마이그레이션 끝.
--   다음 단계 — v1.25 stage2 (프론트 변경):
--     · lib/round-logs.ts : fetchRecentExtractPools / fetchRoundResultForOrder 제거
--     · lib/api.ts        : getOrderExtractPool / adminListRecentPools 신규 추가
--     · app/page.tsx      : current_pool → current_pool_size 분기
--     · app/admin/page.tsx: 호출처 교체
--     · app/result/[orderId]/page.tsx: 추첨 전/후 분기 + 카운트다운
--     · components/ExtractEnginePoolCard.tsx: pool prop → poolSize prop 정직화
-- ============================================
