# 인수인계서 — platform 마커 개편 완료 + 상권분석 기능 설계 진행 중 (2026-05-14)

> 새 창에서 이 문서를 그대로 붙여넣어 작업을 이어가십시오.
> 본 인수인계서는 **두 종류 작업의 분리된 진행 상태** 를 다룹니다:
>   (A) 오늘 완료된 — platform 마커 디자인 A안 적용 + knson 담당자 페이지 마커 통일
>   (B) 진행 중인 — platform 지도 우클릭 → 상권분석 신규 기능 설계 (사용자 추가 결정 대기)

---

## 0. 프로젝트 컨텍스트

- **knson 리포** — 운영 중인 부동산 플랫폼 백엔드(Vercel + Supabase) + 담당자/관리자 페이지
- **platform 리포** — 일반 사용자(회원) 대상 웹 사이트 (지도/매물검색/마이페이지)
- 두 리포는 공유 코어 파일(`knson-core.js`, `knson-data-access.js`, `knson-property-domain.js` 등) 동기화 운영
- **이전 인수인계서(v6.4.6#1)** 의 건축물대장 수집기 작업은 운영 안정. 본 인수인계서는 그 위에서 진행한 새 작업들을 다룸.
- 사용자 작업 규칙 (이전 인수인계서 §10 또는 본문 §6 참고)

---

## 1. 오늘 완료된 작업 (A) — 마커 디자인 A안

### 1-1. 1차 배포 (`marker-redesign-A-2026-05-14.zip`)

| 파일 | 변경 |
|---|---|
| `knson/api/public-listings.js` | markers 배열 응답에 4개 필드 추가 (`appraisalPrice`, `currentPrice`, `exclusivearea`, `bidDate`) — 6줄 |
| `platform/platform-map.js` | 마커 모듈 전면 교체 — A안 SVG 빌더 + 묶음 마커 + 동일좌표 그룹핑 (+250줄) |
| `platform/platform-map.css` | 마커 스타일 SVG 기반으로 갱신 + 묶음 InfoWindow 스타일 + 모바일 반응형 (+47줄) |

### 1-2. 2차 핫픽스 (`marker-redesign-A-hotfix2-2026-05-14.zip`)

| 파일 | 변경 |
|---|---|
| `platform/platform-map.js` | viewBox 우측 padding 3 추가로 ↓N%·D-day 배지 우측 끝 잘림 해결 + xAnchor/yAnchor 동적 계산으로 꼬리 끝이 항상 좌표 정확히 가리키도록 보강 |
| `knson/agent-app.js` | 담당자 페이지 `li_map_buildMarkerSvg` / `li_map_buildClusterSvg` 를 platform 과 동일한 A안 구조로 통일. 즐겨찾기 별 / 핫 불꽃 / 현장실사 체크 배지는 유지 (담당자 페이지 핵심 기능) — 새 카드 폭(96) 에 맞춰 현장실사 배지 cx 92→98 시프트. |

### 1-3. 디자인 명세 (양쪽 공통)

**단일 마커 (A안 — 상단 컬러 헤더형)**
- 흰 카드 본체 96×50, rx=8, 검정 외곽선(`#111827`), 그림자(rect opacity 0.18)
- 상단 컬러 헤더 (출처별 색 + 흰글씨 라벨 + 우상단 면적)
- 본체 중앙 큰 가격 (검정, font-size 17, font-weight 600)
- 꼬리 끝 (48, 59) — 검정 삼각형
- 우측 배지 (할인율 빨강 ↓N%, D-day 검정) — x=100~130, w=30 h=14

**출처별 컬러 매핑**
```
auction        #9333ea (보라)
onbid          #2563eb (파랑)
realtor_naver  #03c75a (네이버 초록)
realtor_direct #c59d45 (금)
general        #64748b (회색)
```

**가격 표시 규칙**
- 경매/공매: `currentPrice` 우선, 없으면 `appraisalPrice`
- 그 외: `appraisalPrice` (= 매매가/감정가)
- 1억 이상: "1.2억" / 1만 이상: "9,500만" / 그 미만: 원 단위

**할인율/D-day 표시 규칙**
- 할인율: `(appraisalPrice - currentPrice) / appraisalPrice × 100`, 1% 미만은 생략
- D-day: `bidDate` 까지 남은 일수. 당일은 "D-day", 365일 초과는 생략. 음수(과거)는 생략

**묶음 마커**
- 동일 좌표(소수점 6자리 기준, ≈0.1m) 다건이면 원형 카운트 마커
- 본체 60×60, 흰 배경 + 검정 외곽선 + 안쪽 컬러 원(출처 1종이면 그 색, 2종 이상이면 회색)
- 클릭 시 InfoWindow 펼침 — 최대 50건, 초과 시 "줌인하여 확인"
- platform: InfoWindow 안 매물 클릭 → `openDetail` (상세 패널)
- knson: InfoWindow 안 매물 클릭 → `openEditModal` (편집 모달)

### 1-4. 검증 완료 사항

- [x] platform 메인 지도에서 출처 5종 마커 정상 표시
- [x] 우측 ↓N%·D-day 배지 잘림 없음
- [x] 마커 꼬리 끝이 좌표 정확히 가리킴 (배지 유무 무관)
- [x] 묶음 마커 동작 (동일 좌표 그룹핑 + InfoWindow + 매물 클릭)
- [x] knson 담당자 페이지 전체리스트 → 지도 토글에서 같은 A안 표시
- [x] knson 측 즐겨찾기/핫/현장실사 배지 새 카드 모서리에 정상 위치
- [x] 모바일 반응형 (768px 이하)

---

## 2. 진행 중인 작업 (B) — 상권분석 기능 설계

### 2-1. 기능 개요 (사용자 명시)

platform 지도에서 **우클릭(또는 모바일 길게 누르기)** → 클릭 지점에 임시 마커 + 우측에 작은 모달(추가 기능 메뉴) → 메뉴에서 **"상권분석"** 선택 → 반경 50m~2km 슬라이더 + 지도에 반경 원 시각화 → 반경 안 건축물 통계 표시

목표 화면 (사용자 참고 이미지 기준):
- 배후세대 총합 + 분류별 (단독주택/빌라/아파트/오피스텔)
- 거주 인구 추정 (총합 + 연령대별 성별 분포 차트)

### 2-2. 확정된 결정 사항

| 항목 | 결정 |
|---|---|
| 우클릭 마커 유지 정책 | **한 번에 1개만** (다른 곳 우클릭 시 이전 마커 사라짐) |
| 추가 기능 메뉴 모달 위치 | 지도 우측 작은 모달 (확장 가능 구조 — "상권분석" 외 추가 기능 자리 준비) |
| 상권분석 결과 표시 위치 | **별도 패널** (상세 패널과 다른 패널) |
| 반경 슬라이더 범위 | 50m ~ 2km |
| 반경 기본값 | **300m** |
| "배후세대" 정의 | **단독주택 + 빌라 + 아파트 + 오피스텔 합산** (상업·업무·근린 제외) |
| 데이터 소스 (배후세대) | knson DB `buildings` 테이블 (이미 적재됨) |
| 모바일 대응 | 우클릭 대신 **길게 누르기(long-press)** 로 대체 |

### 2-3. 보류된 결정 사항 ★ 사용자 추가 설계 후 결정 예정

> 본 결정이 끝나야 코드 작업 가능. 후속 작업자는 사용자 추가 메시지 기다린 뒤 진행.

**[보류 1] 격자 단위 인구 데이터 소스** — 거주 인구 추정 차트(연령/성별)용
- 사용자 의향: 동 단위 면적 안분(부정확)은 제외, 격자 단위 정밀 데이터 선호
- 본 인수인계서 작성 시점 조사 결과:
  - **SGIS Open API (통계청·국가데이터처)** 가 가장 유력 — 100m/250m/500m/1km 격자 인구
  - 단 100m·500m 격자는 "총값만" 가능, **연령/성별 세부 지표는 1km 격자 이상에서만**
  - 공공데이터포털에서 서비스키 발급 필요 (사용자 직접 발급 — Anthropic 계정으로 한국 공공API 등록 불가)
  - SGIS의 "생활권역 통계지도" 가 반경 기반 조회를 정확히 제공하지만, **API 형태로 제공되는지는 신청·매뉴얼 확인 필요**
  - 대안: 국토지리정보원 격자 파일(공공데이터포털) 다운로드 후 DB 자체 적재 — 정확하지만 갱신 부담 큼
- 권장안 (사용자 미확정): SGIS API + 좌표/반경 키로 24시간 DB 캐싱

**[보류 2] 거주 인구 추정 계산 로직**
- DB에 이미 `buildings.est_pop_by_area`(면적 기반 추정 인구), `building_units.est_pop`(호별 추정 인구) 컬럼 존재
- 격자 데이터 없이도 면적 기반 추정으로 fallback 가능
- 사용자 결정 후 적용 방식 확정

**[보류 3] UX 디테일**
- 추가 기능 메뉴 모달 정확한 위치/크기/슬라이드 방향
- 결과 별도 패널의 위치 (좌측? 우측? 어느 영역?)
- 반경 슬라이더 UI (값 표시 형식, 단계)
- 차트 라이브러리 선택 (Chart.js? Recharts? 인라인 SVG?)

### 2-4. 확인된 DB 자산 (코드 작업 시작 시 그대로 활용)

**핵심: `buildings` 테이블 (메인 표제부)**

| 컬럼 | 용도 |
|---|---|
| `id` | PK |
| `latitude`, `longitude`, `geom` | ★ 좌표. `geom` 은 PostGIS geometry 컬럼 — `ST_DWithin` 으로 반경 조회 가능 |
| `purpose_class` | ★ 건물 분류 가공 컬럼 — 실제 값 확인 필요(아래 ❶ 참고) |
| `res_type` | ★ 거주 타입 가공 컬럼 — 실제 값 확인 필요 |
| `main_purps_cd_nm` | 주용도명 (원본 — '단독주택', '공동주택', '업무시설' 등) |
| `hhld_cnt` | 세대수 (정부 표제부 그대로) |
| `fmly_cnt`, `ho_cnt` | 가구수 / 호수 (보조) |
| `unit_count` | 전유부(호) 카운트 |
| `est_pop_by_area` | 면적 기반 추정 인구 (fallback 용) |
| `tot_area`, `arch_area`, `plat_area` | 연면적 / 건축면적 / 대지면적 |
| `grnd_flr_cnt`, `ugrnd_flr_cnt` | 지상/지하 층수 |
| `dong_code` | 행정동 코드 (인구 데이터 조인 용도 가능) |
| `sigungu_cd`, `bjdong_cd`, `bun`, `ji` | 지번 코드 (정부 API 호환) |
| `bld_nm` | 건물명 |
| `use_apr_day` | 사용승인일 |

**보조: `building_units` 테이블 (전유부 = 호별)**

| 컬럼 | 용도 |
|---|---|
| `building_id` (FK to buildings) | 건물 연결 |
| `dong_nm`, `ho_nm`, `flr_no` | 동/호/층 |
| `exclusive_area`, `common_area`, `contract_area` | 전용/공용/계약 면적 |
| `purps_cd_nm` | 호별 용도 |
| `est_pop` | 호별 추정 인구 |

**보조: `building_recap_title` 테이블 (총괄표제부 = 단지 전체)**
- 단지 합산 세대수 (`hhld_cnt`, `fmly_cnt`, `ho_cnt`)
- 주차/엘리베이터/에너지등급 등 단지 단위 지표

**PostGIS 확장 활성화 확인됨** (`postgis`). `postgis_topology` 는 미활성화(상권분석에 불필요).

### 2-5. 후속 작업자가 시작 전 추가 확인해야 할 SQL

> 사용자 추가 결정 받기 전이라도, 분류 컬럼 실제 값 정도는 미리 확인해두면 좋음

```sql
-- ❶ purpose_class 분포 (역삼동 기준)
SELECT purpose_class, COUNT(*) AS cnt
FROM public.buildings
WHERE sigungu_cd='11680' AND bjdong_cd='10100'
GROUP BY purpose_class ORDER BY cnt DESC;

-- ❷ res_type 분포
SELECT res_type, COUNT(*) AS cnt
FROM public.buildings
WHERE sigungu_cd='11680' AND bjdong_cd='10100'
GROUP BY res_type ORDER BY cnt DESC;

-- ❸ main_purps_cd_nm 분포 (원본 정부 코드명)
SELECT main_purps_cd_nm, COUNT(*) AS cnt
FROM public.buildings
WHERE sigungu_cd='11680' AND bjdong_cd='10100'
GROUP BY main_purps_cd_nm ORDER BY cnt DESC LIMIT 30;

-- ❹ geom 컬럼의 GIST 인덱스 존재 여부 (반경 조회 성능 핵심)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='buildings' AND indexdef LIKE '%geom%';

-- ❺ 반경 조회 쿼리 예시 (역삼동 한복판 좌표 + 반경 300m)
--    동작 확인 + 응답 속도 측정용
SELECT id, bld_nm, purpose_class, res_type, hhld_cnt, est_pop_by_area
FROM public.buildings
WHERE ST_DWithin(
    geom::geography,
    ST_SetSRID(ST_MakePoint(127.0356, 37.5009), 4326)::geography,
    300
)
ORDER BY ST_Distance(
    geom::geography,
    ST_SetSRID(ST_MakePoint(127.0356, 37.5009), 4326)::geography
)
LIMIT 10;
```

`geom` 의 SRID 가 4326 (WGS84) 인지 다른지에 따라 `ST_SetSRID` 부분 조정 필요. ❹ 인덱스 결과로 알 수 있음.

---

## 3. API 설계 초안 (사용자 결정 받은 뒤 확정)

### 3-1. 신규 엔드포인트 (knson 측에 추가 예정)

**`GET /api/public-listings?mode=around&lat=...&lng=...&radius=...`**
또는 별도 라우트
**`GET /api/public-area?lat=...&lng=...&radius=...`**

라우트는 작업 시작 시 다시 결정. `public-listings.js` 에 mode 분기 추가하는 게 일관성 좋음.

**요청 파라미터**
- `lat`, `lng` — 중심 좌표
- `radius` — 미터 단위 (50 ~ 2000)

**응답 (잠정)**
```json
{
  "ok": true,
  "center": { "lat": 37.5009, "lng": 127.0356 },
  "radius": 300,
  "buildings": {
    "total": 142,
    "households": {
      "total": 39954,
      "breakdown": [
        { "category": "detached", "label": "단독주택", "count": 7677 },
        { "category": "villa", "label": "빌라/다세대", "count": 9448 },
        { "category": "apartment", "label": "아파트", "count": 13879 },
        { "category": "officetel", "label": "오피스텔", "count": 8950 }
      ]
    },
    "estimatedResidents": 69825
  },
  "population": null  // SGIS API 연결 후 채워질 자리 — 연령/성별 분포
}
```

### 3-2. 보안 / 권한

- 기존 `public-listings.js` 와 동일하게 JWT 검증 (`verifySupabaseUser`) + DBMS 계정 차단
- PII 노출 없음 (집계 통계만 반환)
- 회원 권한 분기 필요 시 추후 결정

### 3-3. 캐싱 정책 (잠정)

- 좌표 (소수점 4자리 ≈ 11m 정밀도) + 반경 조합을 키로 24시간 캐싱
- 캐시 테이블 신설 또는 Vercel KV 활용 검토

---

## 4. 화면 설계 초안 (사용자 결정 받은 뒤 확정)

### 4-1. platform-map.js 추가될 모듈 구조 (예상)

```
- 지도 우클릭 / 길게 누르기 이벤트 핸들러
- 임시 핀 마커 (기존 매물 마커와 시각적으로 구분 — 검정 핀 또는 빨간 핀)
- 추가 기능 메뉴 모달 (작은 카드, 우상단 X)
  - 메뉴 항목: 상권분석 / (추후 확장)
- 상권분석 패널 (별도 패널)
  - 반경 슬라이더 (50~2km, 기본 300m)
  - 반경 원 시각화 (kakao.maps.Circle)
  - 결과 영역
    - 배후세대 카드 (총합 + 4분류)
    - 거주 인구 카드 (총합 + 차트 자리)
```

### 4-2. 신규 CSS 클래스 네이밍 (잠정)

`mv-ctx-*` 우클릭 컨텍스트 메뉴 / `mv-area-*` 상권분석 패널 / `mv-area-chart-*` 차트 영역

---

## 5. 다음 단계 — 새 창에서 작업 재개 절차

1. **사용자에게 보류된 결정 사항 확인 받기** (2-3 의 [보류 1~3])
2. 사용자 결정에 따라 SGIS API 키 발급 받아왔는지 확인 (사용자 직접 등록 필요)
3. 후속 SQL ❶~❺ 결과 받기 (purpose_class / res_type 실제 값 확정)
4. 위 입력값들로 §3 API 설계 / §4 화면 설계 확정안 작성 → 사용자 OK
5. 코드 작업 진행:
   - knson `api/public-listings.js` 에 신규 모드 추가 또는 새 엔드포인트
   - platform `platform-map.js` / `platform-map.css` 에 우클릭 + 상권분석 모듈 추가
   - 보안/검증/문법체크 후 ZIP 패키징
6. 사용자 배포 + 검증
7. 본 인수인계서에 새 버전 번호 추가하며 다음 인계서 작성

---

## 6. 사용자 작업 규칙 (재확인)

이전 인수인계서(v6.4.5/v6.4.6) 와 동일. 핵심 규칙:

1. 운영 중 코드는 **인플레이스 수정** (함수 시그니처 유지, 신규 필드만 누적)
2. 기존 코드 흐름 유지하며 수정 이어가기
3. 관련 파일들 묶어서 확인 — 되돌아가지 않도록
4. 클린 아키텍처, 유지보수성, 성능 우선
5. JS 문법 체크 필수 (`node --check`)
6. 모바일 반응형 (platform 메인 사용자가 모바일 비중 높음)
7. 일상 용어로 설명 (전문 용어 최소화)
8. **결과 받기 전 예상 해결책 금지** — 사용자 실행 결과 받은 후 진행
9. 폴더 포함 ZIP (knson-main/, platform-main/ 분리)
10. **거짓 보고 절대 금지** — 부족한 정보는 즉시 요청
11. 한국어 응답
12. 보안 우선 — 본 채팅 내용 외부 유출 절대 금지

### 본 작업 사이클에서 추가로 학습된 패턴

- 사용자가 "둘 다 묶어서 보내줘" 같이 명시하면 한 ZIP 안에 두 리포 폴더 분리 구조
- 사용자가 "둘 다 한번에 가자" / "OK 진행해줘" 등 명시적 진행 동의 표시 시에만 코드 작업 진입
- 사용자가 "기억했다가 인수인계만들때 반영해" 라고 명시 시 현 시점 코드 작업 중단 + 인수인계서 작성
- 사실 확인 단계에서 사용자가 잘못된 안내를 받았다고 판단되면(예: 본 작업 중 `properties` 가 아니라 `public-listings` 였던 건) **즉시 사과 + 정정** 하여 거짓 보고 누적 방지

---

## 7. 본 인수인계 채팅에서 사용자가 보유한 ZIP 패키지

| 파일 | 내용 | 상태 |
|---|---|---|
| `marker-redesign-A-2026-05-14.zip` | 1차 — knson backend + platform 마커 A안 | 배포 완료 |
| `marker-redesign-A-hotfix2-2026-05-14.zip` | 2차 — platform 미세조정 + knson 담당자 페이지 A안 통일 | 배포 완료 |

---

## 8. 새 창 시작 멘트 가이드

새 창의 첫 응답은 다음 흐름:

1. 인수인계서 받은 사실 확인 (한 줄)
2. **현재 상태 한 문장 요약**: "마커 디자인 A안 양쪽 배포·검증 완료. 상권분석 신규 기능 설계 진행 중이며 사용자 추가 결정(격자 인구 데이터 / 추정 로직 / UX 디테일) 대기 상태."
3. 사용자 다음 지시 받기
4. 사용자가 보류 1~3 의 결정을 보내오면 §5 의 절차로 진행
5. 또는 사용자가 마커 디자인 추가 조정·다른 작업을 우선시할 수도 있음

### 금지 사항

- 보류 결정 사항을 사용자 답변 없이 임의로 추정해 코드 작업 진입 금지
- SGIS API 키를 Anthropic 측이 발급하려는 시도 금지 (사용자 직접 발급)
- knson Edge Function (`index.ts`) 은 본 채팅에서 손대지 않음 — 이전 인수인계서(v6.4.6#1) 의 별도 영역

---

## 9. 점검·트러블슈팅 메모

### 본 작업 사이클에서 학습된 패턴

- **마커 SVG 잘림** — viewBox 의 width 가 content 우측 끝보다 좁으면 정확히 그 차이만큼 잘림. CustomOverlay 사용 시 SVG width 속성과 viewBox width 둘 다 충분히 잡아야 함.
- **CustomOverlay 앵커** — `xAnchor`/`yAnchor` 는 비율(0~1). content 폭이 가변이면 동적 계산 필수. 정적 0.5 사용 시 마커가 좌표에서 벗어남.
- **MarkerImage vs CustomOverlay** — knson 은 SVG `MarkerImage` 방식(offset 픽셀 좌표), platform 은 `CustomOverlay`(yAnchor 비율). 동일 SVG 디자인이라도 앵커 처리 코드는 다름.
- **묶음 그룹핑 임계값** — 현재 소수점 6자리(약 0.1m). 줌 아웃 시 시각적으로 겹쳐 보이는 매물은 묶이지 않음 — 줌 레벨별 동적 묶음이 후속 후보.

### 알려진 한계

- 묶음 InfoWindow 안 매물 클릭 시, platform 측은 markers 배열 객체를 직접 사용하므로 풍부한 데이터(층, 공용면적 등)는 `state.items` 에서 한 번 더 매칭. 매칭 안 되면 markers 객체로 fallback.
- 마커 hover 시 미니 미리보기 툴팁 미구현. 후속 후보.

---

(끝)
