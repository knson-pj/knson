-- =============================================================================
-- knson 보안 RLS 패치 (2026-04-22)
-- =============================================================================
--
-- 이 migration 은 현재 운영 Supabase DB 에 존재하는 4건의 RLS 정책 구멍을 봉쇄한다.
-- 모두 idempotent 하며, 중복 실행해도 동일 상태로 수렴한다.
--
-- 전제 조건 (운영 DB 확인 완료, 2026-04-22):
--   1) public.enforce_staff_property_update() 트리거 함수 본문에
--      "if is_admin() then return new; end if;" 분기가 이미 존재한다.
--   2) public.is_admin() 함수는 JWT app_metadata/user_metadata 및 profiles.role
--      세 가지를 모두 확인한다.
--   3) 백엔드 API (/api/*) 는 전부 service_role 키로 Supabase REST 를 호출한다.
--   4) 프런트 코드는 브라우저 session 의 authenticated JWT 로 직접 호출한다.
--
-- 따라서 이 패치는:
--   - admin 직접 update (admin-tab-properties.js) → RLS properties_update_admin
--     통과 → 트리거 is_admin() 통과 → 정상 동작 유지
--   - staff 자기 물건 update → RLS properties_update_staff_own 통과 → 트리거 통과
--   - 비정상 update (다른 staff 물건, anon insert 등) → 차단
--
-- 운영 DB 적용 시 주의:
--   1) 반드시 백업 후 적용할 것.
--   2) 적용 후 admin / staff / anon 각 역할로 1건씩 실제 CRUD 테스트.
--   3) 롤백이 필요하면 이 파일 하단의 주석처리된 rollback 블록 참고.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- ① properties: "Allow authenticated users to update properties" 정책 제거
-- ─────────────────────────────────────────────────────────────────────────────
-- 이 정책은 authenticated 역할 전체에 qual=true, with_check=true 로 풀려 있어
-- properties_update_admin / properties_update_staff_own 의 좁은 조건을 사실상
-- 무력화하는 defense-in-depth 실패 상태였다.
--
-- 트리거(enforce_staff_property_update)가 admin / service_role / staff-own 을
-- 전부 올바르게 처리하므로, 이 정책을 제거해도 운영 기능에는 영향 없다.
-- 드롭 후 RLS 는 다시 (properties_update_admin OR properties_update_staff_own)
-- 로 좁혀진다.

drop policy if exists "Allow authenticated users to update properties" on public.properties;


-- ─────────────────────────────────────────────────────────────────────────────
-- ② market_transactions: WRITE 정책을 service_role 전용으로 축소
-- ─────────────────────────────────────────────────────────────────────────────
-- service_insert_mt / service_update_mt 는 이름은 "service" 지만 {public} role
-- 에 적용되어 있어 anon key 만으로 누구나 INSERT/UPDATE 가능했다.
-- market_transactions 는 국토부 MOLIT API 로 수집되는 실거래 데이터라 외부 주입은
-- 절대 허용하면 안 된다. 쓰기는 service_role (백엔드 API) 전용으로 제한한다.
-- 기존 mt_all_service (service_role ALL) 가 이미 쓰기 경로를 덮으므로 아래 정책
-- 은 보강 겸 명시용으로 재작성한다.

drop policy if exists service_insert_mt on public.market_transactions;
drop policy if exists service_update_mt on public.market_transactions;

create policy mt_insert_service
  on public.market_transactions
  for insert
  to service_role
  with check (true);

create policy mt_update_service
  on public.market_transactions
  for update
  to service_role
  using (true)
  with check (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- ③ valuation_results: WRITE 정책을 service_role 전용으로 축소
-- ─────────────────────────────────────────────────────────────────────────────
-- service_insert_vr / service_update_vr 도 동일한 패턴으로 {public} 에 풀려 있어
-- anon 이 가짜 평가 결과를 INSERT 할 수 있었다. 이 경우 프런트 knson-valuation.js
-- 의 fetchValuation 이 그 가짜 결과를 그대로 표시하게 되므로, 매물 등급 위조가 가능.
-- 쓰기는 service_role 전용으로 축소한다.

drop policy if exists service_insert_vr on public.valuation_results;
drop policy if exists service_update_vr on public.valuation_results;

create policy vr_insert_service
  on public.valuation_results
  for insert
  to service_role
  with check (true);

create policy vr_update_service
  on public.valuation_results
  for update
  to service_role
  using (true)
  with check (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- ④ onbid_sync_logs: SELECT 를 실제로 admin 전용으로 제한
-- ─────────────────────────────────────────────────────────────────────────────
-- onbid_sync_logs_admin_select 는 이름은 admin_select 지만 qual=true 라
-- 모든 authenticated 사용자(staff 포함)가 sync 로그를 조회할 수 있었다.
-- 의도된 admin 전용 상태로 되돌린다.

drop policy if exists onbid_sync_logs_admin_select on public.onbid_sync_logs;

create policy onbid_sync_logs_admin_select
  on public.onbid_sync_logs
  for select
  to authenticated
  using (public.is_admin());


-- =============================================================================
-- 적용 검증 쿼리 (이 migration 적용 직후 수동 실행 권장)
-- =============================================================================
--
-- 1) 위험했던 정책이 없어졌는지 확인
-- select tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and policyname in (
--       'Allow authenticated users to update properties',
--       'service_insert_mt',
--       'service_update_mt',
--       'service_insert_vr',
--       'service_update_vr'
--     );
-- → 0 rows 기대
--
-- 2) 새 정책이 정확히 생성됐는지 확인
-- select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and policyname in (
--       'mt_insert_service', 'mt_update_service',
--       'vr_insert_service', 'vr_update_service',
--       'onbid_sync_logs_admin_select'
--     );
-- → 5 rows 기대
--
-- 3) 관리자 UI 에서 기존 매물 수정이 정상 동작하는지 확인
-- 4) 담당자(staff) UI 에서 자기 배정 물건 수정이 정상 동작하는지 확인
-- 5) 담당자가 남의 물건을 수정하려고 하면 차단되는지 확인 (개발자 콘솔에서)


-- =============================================================================
-- 롤백 (문제가 생기면 아래 블록을 실행해서 이전 상태로 복원)
-- =============================================================================
-- 주의: 롤백은 "보안 구멍이 다시 열린" 상태로 되돌리는 것이므로 반드시 임시 수단으로만 사용.
--
-- -- ① 정책 복원 (이름 동일, 내용 동일 - 변경 전 상태)
-- create policy "Allow authenticated users to update properties"
--   on public.properties
--   for update
--   to authenticated
--   using (true)
--   with check (true);
--
-- -- ② market_transactions 정책 원복
-- drop policy if exists mt_insert_service on public.market_transactions;
-- drop policy if exists mt_update_service on public.market_transactions;
-- create policy service_insert_mt
--   on public.market_transactions
--   for insert
--   to public
--   with check (true);
-- create policy service_update_mt
--   on public.market_transactions
--   for update
--   to public
--   using (true);
--
-- -- ③ valuation_results 정책 원복
-- drop policy if exists vr_insert_service on public.valuation_results;
-- drop policy if exists vr_update_service on public.valuation_results;
-- create policy service_insert_vr
--   on public.valuation_results
--   for insert
--   to public
--   with check (true);
-- create policy service_update_vr
--   on public.valuation_results
--   for update
--   to public
--   using (true);
--
-- -- ④ onbid_sync_logs 정책 원복
-- drop policy if exists onbid_sync_logs_admin_select on public.onbid_sync_logs;
-- create policy onbid_sync_logs_admin_select
--   on public.onbid_sync_logs
--   for select
--   to authenticated
--   using (true);

-- =============================================================================
-- END
-- =============================================================================
