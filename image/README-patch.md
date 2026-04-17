# 이미지 최적화 패치 적용 가이드

## 요약
`image/buld.png` (20.64MB) 삭제 + WebP/JPG 대체, `image/logo-main.png` 경량화.
**총 감소: 22MB → 688KB (97% 절감)**

---

## 반영할 파일 목록

기존 knson-main 프로젝트 루트에 그대로 덮어쓰기 하세요.

| 경로 | 작업 | 비고 |
|---|---|---|
| `image/buld.png` | **삭제** | 21.6MB 원본 제거 |
| `image/buld.webp` | **신규** | 206KB (주포맷) |
| `image/buld.jpg` | **신규** | 318KB (구형 브라우저 폴백) |
| `image/logo-main.png` | **덮어쓰기** | 706KB → 82KB (1024→400px) |
| `image/logo-main.webp` | **신규** | 22KB (예비용, 현재 HTML은 PNG 참조) |
| `login.css` | **덮어쓰기** | buld.png 경로를 image-set() 으로 교체 |
| `login.html` | **덮어쓰기** | login.css 캐시 버전만 변경 (v=20260417-imgopt1) |

---

## 변경된 부분 상세

### 1) `login.css` (Line 69~85 근처)

**Before:**
```css
.visual-bg::before {
  content: "";
  position: absolute;
  inset: -5%;
  background:
    linear-gradient(90deg, rgba(3, 10, 20, 0.78) 0%, rgba(3, 10, 20, 0.48) 34%, rgba(3, 10, 20, 0.18) 100%),
    url("./image/buld.png") center center / cover no-repeat;
  filter: blur(4px) brightness(0.64) saturate(0.9);
  transform: scale(1.1);
}
```

**After:**
```css
.visual-bg::before {
  content: "";
  position: absolute;
  inset: -5%;
  /* 폴백: 구형 브라우저용 JPG (318KB) */
  background:
    linear-gradient(90deg, rgba(3, 10, 20, 0.78) 0%, rgba(3, 10, 20, 0.48) 34%, rgba(3, 10, 20, 0.18) 100%),
    url("./image/buld.jpg") center center / cover no-repeat;
  /* 모던 브라우저: WebP 우선 (207KB) — 원본 20.6MB 대비 99% 경량화 */
  background:
    linear-gradient(90deg, rgba(3, 10, 20, 0.78) 0%, rgba(3, 10, 20, 0.48) 34%, rgba(3, 10, 20, 0.18) 100%),
    image-set(
      url("./image/buld.webp") type("image/webp"),
      url("./image/buld.jpg") type("image/jpeg")
    ) center center / cover no-repeat;
  filter: blur(4px) brightness(0.64) saturate(0.9);
  transform: scale(1.1);
}
```

### 2) `login.html` (Line 12)

**Before:**
```html
<link rel="stylesheet" href="./login.css?v=20260410-ui9" />
```

**After:**
```html
<link rel="stylesheet" href="./login.css?v=20260417-imgopt1" />
```

---

## 호환성

- `image-set()` 은 Chrome 88+, Safari 14+, Firefox 89+, Edge 88+ 에서 WebP를 자동 선택
- 그 이전 브라우저는 첫 번째 `background` 선언의 JPG 폴백을 사용
- 이미지는 `blur(4px) brightness(0.64)` 처리되는 장식 배경이라 품질 저하가 시각적으로 인지되지 않음

---

## 배포 후 확인사항

1. 로그인 페이지 (`/login.html`) 좌측 배경이 정상 표시되는지
2. Network 탭에서 `buld.webp` (또는 구형 브라우저는 `buld.jpg`) 가 로드되는지
3. `buld.png` 를 참조하는 다른 파일이 없으므로 추가 작업 불필요
   (검증 완료: `grep -rn "buld.png"` → login.css 외 0건)

---

## Vercel 배포 시

- `vercel.json`의 CSP `img-src 'self' data: blob: ...` 이미 자기 자원 허용 중 → 별도 수정 불필요
- 이전에 `buld.png`를 캐싱한 사용자는 CSS 캐시버전 변경(`?v=20260417-imgopt1`)으로 자동 갱신됨
- Vercel 측에서 이전 `buld.png`는 새 배포 시 자동으로 사라짐
