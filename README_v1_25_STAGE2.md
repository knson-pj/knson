# v1.25 Stage 2 — 프론트 전환 + SQL 마이그레이션 (배포 + 검증 가이드)

> **목적**: 34추출 번호 비공개화 정책 완성 (사장님 합의 2026-05-15).
> Stage 1 (백엔드 신규 endpoint 추가)이 완료된 상태에서, 프론트의 클라이언트 직접 조회를 모두 백엔드 endpoint 경유로 전환 + DB 컬럼 권한 회수.
>
> **새 정책 (수정 반영)**:
> - 추첨 전: 본인 결제 회차의 풀 34개 전체 표시 + amber 카운트다운 ("추첨 시작 시 적중하지 않은 번호는 사라집니다")
> - 추첨 후: 같은 34칸 그리드 자리 유지하되 적중 자리만 숫자 + amber 강조, 미적중 자리는 점선 빈 박스
> - 미적중 풀 번호 자체는 클라이언트에 절대 전달 X (백엔드 응답에서 `null` 마스킹)

---

## 변경 파일 일람 (9개 파일)

### 백엔드 (Python) — 1개 인플레이스 수정

| 파일 | 변경 종류 | 핵심 변경 |
|---|---|---|
| `lottobigag/api/routers/orders.py` | 인플레이스 (Stage 1 endpoint 수정) | `GET /api/orders/{order_id}/extract-pool` 응답 구조 변경 — 추첨 후 410 Gone 제거. 추첨 전/후 모두 200 응답. 추첨 후엔 `pool_positional` 적중 자리만 숫자 + 미적중 자리 `null` 마스킹. `winning_nums`/`bonus`/`hit_count`/`bonus_in_pool` 신규 필드 추가. |

> **`caching.py` 미포함 안내**: Stage 1과 100% 동일하므로 본 ZIP 에서 제외. 사장님이 Stage 1 단계에서 이미 배포하신 상태 그대로 유지하시면 됩니다. (Stage 3 에서 contract 단계로 `current_pool` 배열 제거 시 별도 변경 예정)

### 프론트엔드 (Next.js) — 1개 신규 + 7개 인플레이스 수정

| 파일 | 변경 종류 | 핵심 변경 |
|---|---|---|
| `lottobigag_front/components/PoolCountdown.tsx` | **신규** | 결과 페이지 추첨 전 카운트다운 컴포넌트. amber 톤, 시계 아이콘, 1초 간격 실시간 갱신, 모바일 반응형. |
| `lottobigag_front/lib/round-logs.ts` | 인플레이스 (v1.24 함수 제거) | `fetchRecentExtractPools` / `fetchRoundResultForOrder` + 관련 타입 제거. v1.23 `fetchRecentRoundLogs` 그대로 유지. |
| `lottobigag_front/lib/api.ts` | 인플레이스 확장 | `getOrderExtractPool(orderId)` + `adminListRecentPools(limit)` 신규 함수 + `OrderExtractPool`/`AdminPoolRow` 타입 추가. `ExtractEngineInfo`에 `current_pool_size` 필드 추가, `current_pool` 은 `@deprecated` 표시. |
| `lottobigag_front/components/ExtractEnginePoolCard.tsx` | 인플레이스 정직화 | `pool: number[]` prop → `poolSize: number` prop. length 만 쓰던 컴포넌트가 prop 시그니처도 정직하게 정렬. |
| `lottobigag_front/app/page.tsx` | 인플레이스 분기 변경 | `extractInfo.current_pool.length > 0` → `extractInfo.current_pool_size > 0`. ExtractEnginePoolCard 호출도 `pool=` → `poolSize=`. |
| `lottobigag_front/app/order/page.tsx` | 인플레이스 분기 변경 | 위와 동일 패턴. |
| `lottobigag_front/app/admin/page.tsx` | 인플레이스 호출 교체 | `fetchRecentExtractPools(5)` (Supabase 직접) → `adminListRecentPools(5)` (백엔드 endpoint 경유, Bearer 토큰 + ADMIN_USER_IDS 검증). |
| `lottobigag_front/app/result/[orderId]/page.tsx` | 인플레이스 재설계 (핵심) | `fetchRoundResultForOrder` 제거 → `getOrderExtractPool` 호출. 화면 분기 재작성: 추첨 전 = 풀 34개 + PoolCountdown, 추첨 후 = 34칸 그리드 자리 유지(`pool_positional`의 null은 점선 빈 박스). 등수 계산은 백엔드 응답의 `winning_nums`/`bonus` 사용. |

### Supabase 마이그레이션 — Stage 1과 동일 (재포함)

| 파일 | 변경 종류 | 핵심 변경 |
|---|---|---|
| `lottobigag/supabase/migration_v1.10.sql` | 신규 (Stage 1 ZIP의 그것) | `engine_history.extract_pool` 컬럼의 anon/authenticated SELECT 권한 회수. 다른 컬럼은 명시적 grant 로 그대로 유지. |

---

## 적용 순서 (반드시 준수)

```
Step 1 — 백엔드 배포 (Cloudtype)
    └ orders.py 변경 → 자동 배포
    └ 신규 endpoint 응답 구조 변경: 추첨 후 410 → 200 + 마스킹된 풀
    └ ※ v1.24 운영 페이지가 호출하는 endpoint 아님 → 운영 영향 0

Step 2 — 프론트 배포 (Vercel)
    └ 7개 프론트 파일 + 1개 신규 컴포넌트 (PoolCountdown.tsx)
    └ 자동 배포 (atomic swap, 무중단)
    └ 이 시점부터 결과 페이지/관리자 페이지가 백엔드 endpoint 경유

Step 3 — SQL 마이그레이션 적용 (Supabase SQL Editor)
    └ migration_v1.10.sql 실행
    └ ※ 반드시 Step 2 직후에 실행 (이전에 실행하면 v1.24 운영 페이지 깨짐)

Step 4 — 검증 (사장님 사이트 직접 확인)
    └ 본 README §검증§ 참조
```

---

## 검증 가이드

### 1. 메인 페이지 (`/`) — 정상 작동 확인

- 분석 카드 정상 노출 (k=34 길이 표시)
- 백테스트 로그 4줄 정상 (v1.23 그대로)
- 누적 통계 5등급 카드 정상

### 2. 주문 페이지 (`/order`) — 정상 작동 확인

- 우측 보조 패널의 ExtractEnginePoolCard 정상 노출
- 직전 회차 카드(PrevRoundCard) 정상

### 3. 결과 페이지 (`/result/[orderId]`, paid 상태) — **핵심 검증**

#### 3-A. 추첨 전 결제 회차 (`draw_completed=false`)

- 풀 카드 안에 **amber 카운트다운 박스**
  - 메시지: "추첨 시작 시 적중하지 않은 번호는 사라집니다"
  - 남은 시간: "X시간 XX분 XX초" 1초마다 갱신
- 34개 번호 그리드 (sm:12열, 모바일 10열) — 모든 칸이 숫자
- 각 구매 조합: "추첨 대기 중" 점선 회색 배지 + 평범한 LottoBall

#### 3-B. 추첨 후 결제 회차 (`draw_completed=true`)

- **당첨번호 카드** (풀 카드 안 상단) — 6+1 LottoBall
- 풀 카드 헤더 우측에 **"적중 N / 34"** amber 배지
- "추첨 후 적중하지 않은 번호는 사라졌습니다" 안내
- **34칸 그리드 자리 유지**:
  - 적중 자리: 숫자 + amber 배경 + amber ring (1.5px)
  - 미적중 자리: 회색 배경 + 점선 border + 가운데 점(·)
- 각 구매 조합: 등수 배지 (1~5등/미당첨) + 본인 조합 안 적중 LottoBall 금색 ring + 미당첨 LottoBall 흐림

#### 3-C. 보안 검증 — 미적중 번호 비공개

- 브라우저 DevTools → Network 탭 → `/api/orders/{id}/extract-pool` 응답 확인
- 추첨 후 응답의 `pool_positional` 안에 **`null` 값이 다수 포함**되어야 함 (미적중 자리)
- 미적중 자리의 실제 번호는 **응답 본문에 없어야** 함 (보안 정책 검증)

### 4. 관리자 페이지 (`/admin`) — 정상 작동 확인

- 좌측 운영 영역의 "📋 회차별 34추출 번호 — 최근 5회차" 카드 정상 노출
- 5회차 모두 풀 그리드 + 당첨번호 + 매칭 통계 표시
- ※ 이 페이지는 보안 정책상 관리자에게는 풀 전체 노출 OK (사장님 운영 도구)

### 5. SQL 마이그레이션 적용 후 — 클라이언트 직접 조회 차단 검증

- 브라우저 DevTools → Console 에서:
  ```javascript
  const sb = (await import('@/lib/supabase')).createSupabaseClient();
  const r = await sb.from('engine_history').select('extract_pool').limit(1);
  console.log(r);  // → error 객체에 "permission denied for column extract_pool" 기대
  ```
- 정상 차단되면 보안 정책 완성

---

## 운영 영향 검증

| 영역 | 영향 | 검증 결과 기대 |
|---|---|---|
| 메인 페이지 누적 통계 | 0 (extractInfo는 그대로) | ✓ |
| 메인 페이지 직전 회차 카드 (v1.23) | 0 (fetchRecentRoundLogs 유지) | ✓ |
| 메인 페이지 백테스트 로그 4줄 | 0 (extract_pool 미사용) | ✓ |
| 적중로그 페이지 (`/log`) | 0 (engine_history 의 통계 컬럼만 사용) | ✓ |
| 관리자 페이지 표준풀 재계산 카드 | 0 (extract_main_match 만 사용) | ✓ |
| 관리자 페이지 회차별 풀 카드 | 호출처 교체 (Supabase → 백엔드 endpoint) | ✓ 동일 데이터 표시 |
| 결과 페이지 추첨 전 | 신규 풀 + 카운트다운 표시 (v1.24 의 placeholder 대체) | ✓ |
| 결과 페이지 추첨 후 | 적중만 표시 + 자리 유지 (v1.24 의 풀 그리드 대체) | ✓ |

---

## 다음 단계 (Stage 3 — 선택, 사장님 지시 시)

**caching.py contract 단계** — `current_pool` 배열 응답에서 완전 제거.

- Stage 2 안정 운영 24시간 이상 확인 후 진행 권장
- 변경 파일 1개 (`api/caching.py` — `current_pool` 줄 제거, `current_pool_size`만 유지)
- 영향 0 (이미 프론트가 `current_pool_size`만 사용)
- 운영 영향: 메인 API 응답 크기 약 200bytes 감소 (34개 정수 배열 제거)

---

**작성**: 2026-05-15 KST · v1.25 Stage 2
**선행 문서**: `HANDOVER_v1_24_INTEGRATED.md`, `README_v1_25_STAGE1.md`
**다음 단계**: Stage 3 (caching.py contract, 선택)
