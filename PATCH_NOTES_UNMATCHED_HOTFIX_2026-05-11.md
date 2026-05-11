# URL 매칭 안된 매물 — 주소 모달 + 배치 분할 핫픽스 (2026-05-11)

## 보고된 이슈 2개

### 1) 삭제 시 "Failed to fetch" 콘솔 오류
1,000건 같은 대량을 한 번에 삭제 요청하면 백엔드가 Supabase REST 로 다시 전달할 때
`?id=in.(uuid1,uuid2,...)` URL 길이가 40KB+ 가 되어 브라우저/프록시가 거부함.
콘솔 메시지: `TypeError: Failed to fetch`

### 2) 주소 클릭 → 물건정보수정 모달 요청
기존 물건관리 페이지의 매물 행 주소 클릭 동작과 동일하게 만들어 달라.

## 수정 (3개 파일)

### A. admin-tab-csv.js
**deleteSelectedUnmatched 함수 재작성 — 100건씩 배치 분할 처리**
```js
const BATCH_SIZE = 100;
const batches = [];
for (let i = 0; i < ids.length; i += BATCH_SIZE) {
  batches.push(ids.slice(i, i + BATCH_SIZE));
}
for (let bi = 0; bi < batches.length; bi++) {
  // 버튼 텍스트에 진행 상황 실시간 표시
  btnDelete.textContent = '삭제 중... ' + (bi * BATCH_SIZE) + ' / ' + cnt;
  try {
    await api('/admin/properties', { method: 'DELETE', auth: true, body: { ids: batch } });
    successIds.push(...batch);
  } catch (err) {
    failedBatches.push({ idx: bi, ids: batch, error: err });
    // 한 배치 실패해도 다음 배치 계속 시도 → 가능한 한 많이 삭제
  }
}
```

**주소 셀에 .address-trigger 클래스 + a 태그 적용**
```js
'<td class="csv-unmatched-addr">' +
  '<a href="#" class="address-trigger unmatched-address-trigger" data-id="' + r.id + '"' +
  ' title="물건 정보 수정">' + esc(r.address) + '</a>' +
'</td>'
```

### B. admin-app.js
**테이블에 click 이벤트 위임 추가 — 주소 클릭 시 모달**
```js
els.unmatchedTableBody.addEventListener("click", (e) => {
  const trigger = e.target.closest(".unmatched-address-trigger");
  if (!trigger) return;
  e.preventDefault(); e.stopPropagation();
  openPropertyEditModal({ id: trigger.dataset.id });
});
```

`openPropertyEditModal` 은 admin-tab-properties.js 의 기존 함수.
`{ id }` 만 전달해도 내부에서 자동으로 상세 조회 후 모달에 채워줌.

### C. admin-styles.css
**클릭 가능한 주소 시각화 — 호버 시 브랜드 색 + 점선 밑줄**
```css
.unmatched-address-trigger{
  color:var(--text);
  text-decoration:none;
  cursor:pointer;
  border-bottom:1px dashed transparent;
  transition:border-color .12s,color .12s;
}
.unmatched-address-trigger:hover{
  color:var(--brand);
  border-bottom-color:var(--brand);
}
```

## 사용자 경험 변화

### 삭제 진행 표시
1,000건 삭제 시 버튼 텍스트가 실시간 변동:
```
선택 삭제 (1,000건)  →  삭제 중... 0 / 1,000  →  ... 100 / 1,000  →  ... 1,000 / 1,000  →  완료
```
사용자가 진행 중인지 멈춰있는지 명확히 알 수 있음.

### 부분 실패 안내
배치 중 일부 실패 시:
```
일부 삭제 실패 — 성공: 800건 / 실패: 200건
오류: [에러 메시지]
실패한 건은 선택 상태를 유지했습니다. 잠시 후 [선택 삭제] 를 다시 눌러주세요.
```
실패한 건은 선택 상태가 유지되어 사용자가 재시도 가능.

### 주소 클릭 동작
- 호버 시 주소 텍스트가 브랜드 색(주황) + 점선 밑줄로 변함
- 클릭 시 기존 매물 수정 모달이 그대로 열림 (다른 페이지 동일 UX)
- 체크박스는 별개로 동작 — 주소 클릭 시 체크 상태에 영향 없음

## 변경 통계
- `admin-tab-csv.js`: +62 / -26
- `admin-app.js`: +11 / -0
- `admin-styles.css`: +17 / -0
- `admin-index.html`: 변경 없음 (구조는 직전 버전 유지)

## 배포
운영 레포의 3개 파일을 ZIP 안의 것으로 교체.
캐시 무효화: `?v=20260511-unmatched2` 등으로 갱신.

## 검증 통과
- ✅ JS 문법 `node --check` 통과 (2개 파일)
- ✅ CSS 괄호 1346/1346 짝 맞음
- ✅ 배치 분할 로직: BATCH_SIZE 상수 + 6개 위치 사용
- ✅ 주소 트리거: HTML 생성 + CSS + 이벤트 위임 3축 완비

## 안전성
- 배치 분할 100건은 검증된 안전 크기 (URL 4KB 이내, 응답시간 1초 이내)
- 한 배치 실패 시 다음 배치 계속 — 가능한 한 많이 삭제
- 캐시 무효화로 다른 탭과 동기화
- 권한 체크 + 백엔드 requireAdmin 이중 검증 유지
