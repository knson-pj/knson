# knson 보안 패치 배포 가이드 (2026-04-22)

## 🎯 이 패치가 봉쇄하는 보안 이슈

| # | 이슈 | 봉쇄 경로 |
|---|---|---|
| 1 | `/api/admin/valuation/*` 3개 엔드포인트 인증 누락 → 익명이 평가 트리거·MOLIT API 소진·가짜 등급 주입 가능 | `requireSupabaseAdmin` 인증 추가 |
| 2 | `index.html` / `login.html` anon key 불일치 | 신형 publishable key 로 통일 |
| 3 | `store.js` 하드코딩 평문 비밀번호 | 환경변수 기반 seed 로 전환 |
| 4 | RLS `"Allow authenticated users to update properties"` 모든 authenticated update 허용 | 정책 제거 (트리거가 이미 admin/staff-own 보호) |
| 5 | RLS `market_transactions` INSERT/UPDATE {public} | service_role 전용으로 축소 |
| 6 | RLS `valuation_results` INSERT/UPDATE {public} → 가짜 A등급 주입 공격 | service_role 전용으로 축소 |
| 7 | RLS `onbid_sync_logs_admin_select` 이름만 admin, 실제는 모든 authenticated | `using (is_admin())` 으로 실제 제한 |
| 8 | RLS `properties_insert_public_open` 데드코드 공격 표면 | 정책 제거 (API 가 service_role 로 처리) |
| 9 | `/api/public-listings` 무제한 스팸 등록 가능 | L1 정책 제거 + L2 API 방어 + L3 프런트 honeypot |

---

## 📦 포함된 파일 12개 (신규 3 + 수정 9)

```
knson-security-patch/
├── DEPLOY.md                                                           ← 이 파일
│
├── api/
│   ├── _lib/
│   │   ├── rate-limit.js                                              🆕 신규 — IP/phone token bucket 유틸
│   │   └── store.js                                                    ✏️ 수정 — 평문 비밀번호 제거
│   │
│   ├── admin/valuation/
│   │   ├── evaluate.js                                                 ✏️ 수정 — requireSupabaseAdmin 추가
│   │   ├── market-data.js                                              ✏️ 수정 — requireSupabaseAdmin 추가
│   │   └── rental-data.js                                              ✏️ 수정 — requireSupabaseAdmin 추가
│   │
│   └── public-listings.js                                              ✏️ 수정 — honeypot + rate limit + 검증 강화
│
├── supabase/migrations/
│   ├── 20260422_0011_security_fixes.sql                               🆕 신규 — RLS 4건 봉쇄
│   └── 20260422_0012_remove_unused_public_insert_policy.sql           🆕 신규 — 공개 INSERT 정책 제거
│
├── general-register.html                                               ✏️ 수정 — honeypot 필드 3개 + timestamp hidden
├── general-register.js                                                 ✏️ 수정 — 폼 로드시각 기록 + honeypot 전송
├── index.html                                                          ✏️ 수정 — anon key 통일
└── README.md                                                           ✏️ 수정 — dev seed 환경변수 안내
```

**Vercel function 갯수 변동 없음**: 12/12 그대로 유지. 새로 추가된 `api/_lib/rate-limit.js` 는 `_lib` 경로라 Vercel function 으로 카운트되지 않습니다.

---

## 🚀 배포 순서 (권장)

배포 작업을 두 축으로 분리합니다:

| 축 | 대상 | 실행 주체 |
|---|---|---|
| **A축** | Supabase DB migration 2건 | 사용자 직접 Supabase SQL Editor 실행 |
| **B축** | Vercel 코드 배포 9건 | git commit → push → Vercel auto deploy |

두 축은 서로 독립적이고, **어느 쪽을 먼저 해도 안전**하게 설계했습니다 (in-place/backward-compatible).

### ▶️ A축: Supabase DB 업데이트 (migration 2건)

**A-1. 백업 먼저**  
Supabase Dashboard → Database → Backups → "Take a new backup" 실행.

**A-2. migration ① 적용**: `supabase/migrations/20260422_0011_security_fixes.sql`
- Dashboard → SQL Editor → New query
- 파일 내용 전부 복사해서 붙여넣고 Run
- 기대: 에러 없이 완료

**A-3. migration ① 검증** (같은 SQL Editor 에서 추가 실행)
```sql
-- 위험했던 정책이 전부 사라졌는지
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public'
  AND policyname IN (
    'Allow authenticated users to update properties',
    'service_insert_mt','service_update_mt',
    'service_insert_vr','service_update_vr'
  );
-- → 0 rows 기대

-- 새 정책 5건이 정확히 생겼는지
SELECT tablename, policyname, cmd, roles FROM pg_policies
WHERE schemaname='public'
  AND policyname IN (
    'mt_insert_service','mt_update_service',
    'vr_insert_service','vr_update_service',
    'onbid_sync_logs_admin_select'
  );
-- → 5 rows 기대. onbid_sync_logs_admin_select 가 `using (is_admin())` 인지 qual 확인
```

**A-4. migration ② 적용**: `supabase/migrations/20260422_0012_remove_unused_public_insert_policy.sql`
- 같은 방식으로 실행

**A-5. migration ② 검증**
```sql
SELECT policyname FROM pg_policies
WHERE schemaname='public' AND tablename='properties'
  AND policyname='properties_insert_public_open';
-- → 0 rows 기대

SELECT count(*) FROM pg_policies
WHERE schemaname='public' AND tablename='properties';
-- → 7 → 6 으로 감소 기대
```

### ▶️ B축: Vercel 코드 배포 (9건)

**B-1. 기존 레포에 12개 파일 덮어쓰기**  
ZIP 안의 파일들을 원래 레포의 같은 경로에 그대로 덮어씁니다. git 에는 이 12개 파일만 변경으로 나타납니다.

**B-2. (선택) 환경변수 — 로컬 dev 전용**  
운영 Vercel 에는 설정 불필요. 로컬 dev 에서 Supabase 없이 테스트할 때만 `.env.local`:
```
KNSN_DEV_ADMIN_NAME=관리자
KNSN_DEV_ADMIN_PASSWORD=<강한 비번>
KNSN_DEV_AGENT_NAME=담당자1
KNSN_DEV_AGENT_PASSWORD=<강한 비번>
```
설정 안 하면 로컬 fallback 인증은 비활성화(= 더 안전).

**B-3. commit + push**
```bash
git add .
git commit -m "security: valuation auth + RLS fixes + public-insert spam defense"
git push
```
Vercel 자동 배포 트리거됨.

**B-4. 배포 완료 후 수동 검증**
1. 관리자 로그인 → 매물 관리 탭에서 기존 물건 수정 → 정상 동작 확인
2. 담당자 로그인 → 자기 배정 물건 수정 → 정상 동작 확인
3. 로그아웃 상태로 `general-register.html` 접속 → 중개/소유자 각 1건 등록 → 201 성공 확인
4. 브라우저 DevTools Network 탭으로 확인: `form_loaded_at` 필드가 실제로 POST body 에 포함되는지

---

## 🔙 롤백 가이드

### A축 롤백 (DB migration)

각 migration 파일 **하단에 주석처리된 롤백 블록**이 들어 있습니다. 문제가 생기면 해당 블록의 주석(`-- `)을 제거하고 Supabase SQL Editor 에서 실행하면 정책이 이전 상태로 복원됩니다.

단 주의: 롤백은 "보안 구멍이 다시 열린 상태"로 되돌리는 것이므로 임시 수단으로만 쓰세요. 근본 문제 해결 후 다시 정방향 migration 을 적용.

### B축 롤백 (코드)

git revert 로 커밋 되돌리기:
```bash
git revert HEAD
git push
```
Vercel 자동으로 이전 상태 배포됨.

---

## 🧪 배포 전 자체 검증 결과

패치 작성 과정에서 다음 테스트를 수행했습니다:

| 테스트 | 결과 |
|---|---|
| 모든 JS 파일 `node --check` 문법 검증 | ✅ 전건 통과 |
| `rate-limit.js` 단위 테스트 (윈도우, 다중 bucket, IP 추출 등) | ✅ 20/20 |
| `public-listings.js` 통합 테스트 (honeypot, dwell, URL, 길이, 음수, 전화, backward-compat, rate limit) | ✅ 16/16 |
| E2E 시나리오 (정상 사용자 + 3가지 봇 시나리오) | ✅ 7/7 |
| Vercel function 갯수 (12개 한도) | ✅ 12/12 유지 |

---

## 📌 중요 주의사항

1. **Supabase 백업은 반드시**. A축 migration 적용 전 스냅샷 백업 필수.
2. **A축과 B축의 순서는 유연**. 어느 쪽 먼저 해도 되지만, 기왕이면 A → B 순서가 안전(프런트 배포 후 바로 테스트 가능).
3. **A축과 B축 사이 공백 기간**에도 기존 기능은 정상 동작. Backward-compatible 설계 덕분.
4. **`api/_lib/rate-limit.js` 는 인메모리 token bucket**. Vercel cold start 마다 초기화되므로 완벽한 rate limit 은 아닙니다. 향후 트래픽 증가 시 Upstash Redis 로 스왑 가능하게 인터페이스가 추상화돼 있음.
5. **anon key 변경 후** 만약 로그인이 깨지면 즉시 `index.html` L8 을 이전 JWT 로 되돌리고 원인 조사 (하지만 `login.html` 에서 이미 동일 publishable key 로 동작 확인됨).

---

## 📞 배포 후 문제 발생 시 확인할 것

- 관리자 매물 수정 실패 → A축 migration ① 이 ① 항목(정책 제거) 만 적용되고 트리거가 is_admin 통과 분기를 갖지 않았을 가능성. 트리거 본문 확인:
  ```sql
  SELECT pg_get_functiondef('public.enforce_staff_property_update()'::regprocedure);
  ```
  `if is_admin() then return new; end if;` 분기가 있어야 함. 없으면 즉시 A축 롤백.

- 공개 등록 실패 (200 silent drop 대신 정상 사용자도 차단) → 프런트 캐시 이슈일 가능성. 브라우저 강제 새로고침 (Ctrl+Shift+R). HTML 파일에 `?v=` 버전 파라미터 업데이트 고려.

- Rate limit 오탐 (정상 사용자가 429) → `api/public-listings.js` 상단 `RATE_LIMIT_BUCKETS_IP` 수치 완화. 예: `max: 5` → `max: 10`.
