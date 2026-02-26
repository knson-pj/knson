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

## 샘플 계정
- 관리자: `관리자` / `admin1234`
- 담당자: `담당자1` / `agent1234`

## 중요 메모
- 현재 저장소는 메모리(global) 기반이라 서버 재시작/재배포 시 데이터 초기화됨.
- 다음 단계에서 DB(Vercel Postgres/KV/Supabase 등) 연결 필요.
