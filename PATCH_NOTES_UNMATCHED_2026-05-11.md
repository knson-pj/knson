# URL 매칭 안된 매물 관리 카드 추가 (2026-05-11)

## 목적
탱크옥션 RPC `sync_tankauction_data` 가 source_url 을 채워주지 못한 경매 매물을
관리자 페이지에서 직접 조회하고 일괄 삭제. (취하·종결·잘못된 사건번호 등 정리용)

기존엔 SQL Editor 직접 접근이 필요했지만, 이제 화면에서 안전하게 관리 가능.

## 위치
관리자 페이지 → **물건 등록** 탭 → CSV 업로드 카드 **바로 아래** 새 카드

## 수정 파일 4개

| 파일 | 변경 |
|---|---|
| `admin-index.html` | tab-csv 섹션 안에 `<div class="sub-card csv-unmatched-card">` 카드 추가 |
| `admin-tab-csv.js` | 5개 함수 추가: loadUnmatchedProperties / renderUnmatchedTable / updateUnmatchedControls / toggleUnmatchedRow / toggleUnmatchedSelectAll / deleteSelectedUnmatched |
| `admin-app.js` | els 7개 ID 참조 + 이벤트 5개 + 모듈 함수 래퍼 4개 |
| `admin-styles.css` | `.csv-unmatched-*` 클래스군 + 모바일 반응형(768/480px) |

기존 코드 0줄 삭제 (인플레이스 원칙).

## 동작 흐름

1. **[조회]** 버튼 클릭
   - 권한 체크 (admin only)
   - Supabase JS SDK 로 properties 조회
     - 조건: `source_type='auction'` AND `(source_url IS NULL OR source_url='')`
     - 정렬: 등록일 내림차순, 최대 2,000건
   - 결과를 state.unmatchedProperties 에 캐시 + 테이블 렌더
   - 카운트 칩 갱신 (0건이면 회색, 1건+ 면 노랑)

2. **개별/전체 선택**
   - 행별 체크박스 또는 헤더 전체선택
   - 선택 수에 따라 [선택 삭제 (N건)] 버튼 텍스트 자동 갱신
   - 전체선택 체크박스는 indeterminate (일부 선택) 상태 자동 처리

3. **[선택 삭제]** 버튼 클릭
   - 권한 체크 (admin only)
   - 1차 confirm: "N건을 삭제할까요?"
   - 100건 이상이면 2차 confirm 추가
   - 기존 `api('/admin/properties', { method:'DELETE', body:{ ids } })` 호출
     - 또는 DataAccess.deletePropertiesViaAdminApi fallback (admin-tab-properties.js 와 동일 패턴)
   - 성공 시 화면에서 즉시 제거 + 캐시 무효화
   - 실패 시 alert + 버튼 복구

## 보안 / 권한
- 모든 동작에 `state.session?.user?.role === 'admin'` 체크
- 일반 staff 가 카드 자체는 보이더라도 버튼 클릭 시 차단
- DELETE 호출은 기존 `requireAdmin` 미들웨어가 백엔드에서 한 번 더 검증

## 모바일 반응형
- 768px↓: 컨트롤바 가로 균등 배치, 테이블 패딩 축소, 주소 컬럼 max-width 축소
- 480px↓: 세부유형 / 담당자 컬럼 숨김 (필수 컬럼만 유지)

## 다크모드
기존 토큰(`--surface`, `--border`, `--text`, `--warning`) 기반이라 자동 대응.

## 안전 장치
- 조회 limit 2,000건 — 사용자 예상 100~1,000 규모 안전선 안쪽
- 삭제 전 confirm 1~2단계
- 삭제 후 즉시 캐시 무효화로 다른 탭과 동기화

## 검증 통과
- ✅ JS 문법 `node --check` 통과 (admin-tab-csv.js, admin-app.js)
- ✅ CSS 괄호 1343/1343 짝 맞음
- ✅ HTML tab-csv 섹션 `<div>` 10/10 짝 맞음
- ✅ ID 7개가 HTML / JS / admin-app.js 세 파일에서 정확히 일치

## 배포
운영 레포의 4개 파일을 ZIP 안의 것으로 교체.
캐시 무효화: `admin-index.html` 의 모든 `?v=` 파라미터 새 값으로 갱신 권장 (예: `?v=20260511-unmatched`).

## 롤백
4개 파일을 백업본으로 되돌리기만 하면 즉시 복원. DB / Edge Function 변경 없음.

## 추후 개선 후보
- URL 패턴 매칭 강화: `source_url NOT LIKE '%tankauction%'` 까지 포함하는 옵션
- 삭제 전 매물 상세 미리보기 (행 클릭 시)
- 다른 source_type (onbid 등) 도 같은 패턴으로 정리 카드 추가
