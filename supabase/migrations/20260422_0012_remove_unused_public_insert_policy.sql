-- =============================================================================
-- knson 보안: 사용되지 않는 공개 INSERT 정책 제거 (2026-04-22)
-- =============================================================================
--
-- 배경:
--   properties_insert_public_open 정책은 anon + authenticated 역할에
--   properties 테이블 INSERT 를 허용한다.
--   원래 설계 의도는 "로그인 없이 공개 등록(general-register.html, buypage.html)에서
--   브라우저가 직접 anon key 로 insert 할 수 있도록" 하는 것이었을 가능성이 높다.
--
-- 2026-04-22 코드 플로우 전수조사 결과:
--   1) general-register.js L123: DataAccess.submitPublicListingViaApi → /api/public-listings
--      POST 로 넘어감. 브라우저가 직접 supabase-js 로 insert 하지 않음.
--   2) buypage.html: 마케팅/소개 페이지이며 등록 버튼은 general-register.html 로 리다이렉트.
--      자체 INSERT 경로 없음.
--   3) api/public-listings.js: supabaseRest() 호출 시 service_role 키 사용.
--      service_role 은 RLS 를 우회하므로 properties_insert_public_open 정책이
--      이 경로에 영향을 주지 않는다.
--   4) 프런트 전체 코드(grep  \.from\(['\"]properties['\"]\)\.(insert|upsert))에서
--      properties 에 insert 하는 모든 호출자는 admin-app / admin-tab-csv /
--      admin-tab-new-property / agent-app / admin-tab-properties 등 로그인이 필요한
--      관리자·담당자 경로로만 확인됨. 공개 경로 없음.
--
-- 결론:
--   properties_insert_public_open 정책은 현재 코드베이스에서 실질적으로 사용되지 않으며,
--   향후 누군가 프런트에 anon 직접 insert 코드를 추가하면 그 순간부터 스팸 주입 구멍이
--   된다. 공격 표면을 제거하기 위해 정책을 삭제한다.
--
-- 삭제 후 정책 매트릭스 (properties INSERT):
--   - properties_insert_admin      : admin 만 가능
--   - properties_insert_staff_own  : 담당자는 자기 배정으로만 가능
--   - (service_role 은 RLS 우회)   : 백엔드 API 경로 유지
--
-- 영향:
--   기존 공개 등록(일반/중개) 플로우는 /api/public-listings 에서 service_role 로 처리되므로
--   이 정책이 삭제돼도 기능상 변화 없음.
--
-- 운영 DB 적용 시 주의:
--   1) 반드시 백업 후 적용할 것.
--   2) 적용 후 일반등록 테스트: general-register.html 에서 중개/소유자 각 1건 등록 시도 → 정상 등록 확인.
--   3) 문제 생기면 파일 하단의 롤백 블록 실행.
-- =============================================================================


drop policy if exists properties_insert_public_open on public.properties;


-- =============================================================================
-- 적용 검증 쿼리
-- =============================================================================
-- select policyname from pg_policies
--   where schemaname = 'public'
--     and tablename = 'properties'
--     and policyname = 'properties_insert_public_open';
-- → 0 rows 기대
--
-- select count(*) from pg_policies
--   where schemaname = 'public' and tablename = 'properties';
-- → 기존 7 → 6 으로 감소 기대


-- =============================================================================
-- 롤백 (이전 상태로 복원)
-- =============================================================================
-- create policy properties_insert_public_open
--   on public.properties
--   for insert
--   to anon, authenticated
--   with check (
--     (assignee_id is null)
--     and (
--       (source_type = 'realtor'::source_type and submitter_type = 'realtor'::submitter_type)
--       or (source_type = 'general'::source_type and submitter_type = 'owner'::submitter_type)
--     )
--   );

-- =============================================================================
-- END
-- =============================================================================
