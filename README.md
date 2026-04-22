# knson Vercel API Step1 (Front + Admin)

최소 동작 API 세트 (CORS/OPTIONS 포함)

## 기본 라우트
- GET `/api/properties`
- POST `/api/auth/login`
- GET/POST `/api/public-listings`오후 5:38 2026-02-25

## 관리자 라우트 (Bearer 토큰 필요)
- GET/POST/PATCH/DELETE `/api/admin/properties`
- GET/POST/PATCH `/api/admin/staff`
- GET/DELETE `/api/admin/staff/[id]?id=...` (Vercel 동적 라우트 대신 쿼리 id 호환)
- GET/POST/PATCH `/api/admin/region-assignments`
- GET/POST/PATCH `/api/admin/realtor-offices`
- PATCH `/api/admin/realtor-offices/[id]/phone?id=...`
- GET/POST `/api/admin/import/properties-csv`
- GET/POST `/api/admin/import/realtor-offices-csv`

## 샘플 계정 (로컬 개발 전용)
운영 환경에선 Supabase Auth 를 사용하며 아래 seed 경로는 실행되지 않는다.  
로컬에서 `hasSupabaseAdminEnv()` 가 false 일 때에만 폴백으로 `api/_lib/store.js` 가
읽는 환경변수로 seed 계정을 구성한다. 값을 비워두면 seed 계정은 생성되지 않는다.

```
KNSN_DEV_ADMIN_NAME=관리자
KNSN_DEV_ADMIN_PASSWORD=<직접 지정한 강한 비밀번호>
KNSN_DEV_AGENT_NAME=담당자1
KNSN_DEV_AGENT_PASSWORD=<직접 지정한 강한 비밀번호>
```

> 보안 주의: 위 값은 절대 레포/커밋에 포함하지 말고 `.env.local` 또는
> Vercel 프로젝트 Environment Variables 에만 설정할 것.

## 중요 메모
- 현재 저장소는 메모리(global) 기반이라 서버 재시작/재배포 시 데이터 초기화됨.
- 다음 단계에서 DB(Vercel Postgres/KV/Supabase 등) 연결 필요.
