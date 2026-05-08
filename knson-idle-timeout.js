// ════════════════════════════════════════════════════════════════════════
// knson-idle-timeout.js — 유휴 시간 자동 로그아웃 (2026-05-08)
// ────────────────────────────────────────────────────────────────────────
// 동작:
//   1) 사용자 활동(마우스/클릭/키보드/스크롤/터치) 감지하여 lastActivityAt 갱신
//   2) localStorage 로 모든 탭 동기화 (한 탭에서 활동 → 다른 탭도 갱신)
//   3) 28분 무활동 시 경고 모달 표시 (남은 2분 카운트다운 + "계속 사용" 버튼)
//   4) 30분 무활동 시 강제 로그아웃 (Supabase signOut + 세션 정리 + 로그인 페이지 이동)
//
// 적용 대상:
//   - admin-index.html, agent-index.html 에서 <script> 로 로드
//   - login.html 에서는 작동 안 함 (세션 없으므로)
//
// 디자인:
//   - inline style 주입 → 별도 CSS 파일 의존 없음
//   - 모달 표시 중에도 일반 활동은 자동 갱신 (모달이 자연스럽게 사라짐)
//   - sessionStorage 의 knson_bms_session_v1 가 있을 때만 작동
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.__knsonIdleTimeoutInitialized) return;
  window.__knsonIdleTimeoutInitialized = true;

  // ── 설정 ─────────────────────────────────────────────────────────────
  const IDLE_TIMEOUT_MS    = 30 * 60 * 1000;       // 30분 무활동 → 강제 로그아웃
  const WARNING_BEFORE_MS  = 2  * 60 * 1000;       // 만료 2분 전 → 경고 모달
  const ACTIVITY_KEY       = 'knson_last_activity_at'; // localStorage 탭간 동기화 키
  const SESSION_KEY        = 'knson_bms_session_v1';
  const ACTIVITY_THROTTLE_MS = 5000;               // 활동 이벤트 throttle (5초)
  const CHECK_INTERVAL_MS  = 1000;                 // 메인 타이머 체크 주기 (1초)

  // ── 가드: 로그인 안 된 상태면 작동 안 함 ───────────────────────────────
  function shouldRun() {
    try {
      const path = String(location.pathname || '').toLowerCase();
      if (path.endsWith('login.html')) return false;
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !!parsed?.token;
    } catch { return false; }
  }
  if (!shouldRun()) return;

  // ── 활동 시각 추적 ───────────────────────────────────────────────────
  let lastActivityAt = readActivity() || Date.now();
  let lastActivityWriteAt = 0;

  function readActivity() {
    try {
      const v = Number(localStorage.getItem(ACTIVITY_KEY) || 0);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch { return 0; }
  }
  function writeActivity(ts) {
    try { localStorage.setItem(ACTIVITY_KEY, String(ts)); } catch {}
  }
  function touch() {
    const now = Date.now();
    lastActivityAt = now;
    if (now - lastActivityWriteAt >= ACTIVITY_THROTTLE_MS) {
      writeActivity(now); // 다른 탭에 알림 (storage event 트리거)
      lastActivityWriteAt = now;
    }
  }

  // 다른 탭의 활동 감지
  window.addEventListener('storage', (e) => {
    if (e.key !== ACTIVITY_KEY || !e.newValue) return;
    const v = Number(e.newValue);
    if (Number.isFinite(v) && v > lastActivityAt) lastActivityAt = v;
  });

  // 활동 이벤트 등록 (passive, throttled)
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'wheel'].forEach((evt) => {
    window.addEventListener(evt, touch, { passive: true, capture: true });
  });

  // ── 스타일 주입 (모달 + 토스트) ─────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('knsonIdleTimeoutStyles')) return;
    const style = document.createElement('style');
    style.id = 'knsonIdleTimeoutStyles';
    style.textContent = `
.knson-idle-modal{
  position:fixed; inset:0; z-index:10000;
  display:none; align-items:center; justify-content:center;
  font-family:inherit;
}
.knson-idle-modal.is-visible{ display:flex; }
.knson-idle-modal-backdrop{
  position:absolute; inset:0; background:rgba(15,23,42,.55);
  backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
}
.knson-idle-modal-card{
  position:relative; z-index:1;
  background:#fff; border-radius:18px;
  padding:28px 28px 24px; min-width:320px; max-width:92vw;
  box-shadow:0 24px 64px rgba(15,23,42,.28);
  text-align:center;
}
.knson-idle-modal-card h3{
  margin:0 0 12px; font-size:18px; font-weight:800;
  color:#111827; letter-spacing:-.02em;
}
.knson-idle-modal-msg{
  margin:0 0 22px; font-size:14px; line-height:1.55;
  color:#374151; font-weight:500;
}
.knson-idle-modal-msg strong{
  display:inline-block; margin-top:6px;
  font-size:28px; font-weight:800; color:#dc2626;
  letter-spacing:-.02em; font-variant-numeric:tabular-nums;
}
.knson-idle-modal-actions{
  display:flex; gap:10px; justify-content:center; flex-wrap:wrap;
}
.knson-idle-modal-btn{
  appearance:none; border:none; cursor:pointer;
  padding:11px 22px; border-radius:10px;
  font-size:14px; font-weight:700; letter-spacing:-.01em;
  font-family:inherit; transition:transform .08s, box-shadow .15s, background-color .15s;
}
.knson-idle-modal-btn:active{ transform:translateY(1px); }
.knson-idle-modal-btn-primary{
  background:#ea580c; color:#fff;
  box-shadow:0 4px 12px rgba(234,88,12,.25);
}
.knson-idle-modal-btn-primary:hover{ background:#c2410c; }
.knson-idle-modal-btn-secondary{
  background:#f3f4f6; color:#374151;
}
.knson-idle-modal-btn-secondary:hover{ background:#e5e7eb; }

.knson-idle-toast{
  position:fixed; left:50%; bottom:36px;
  transform:translateX(-50%) translateY(16px);
  padding:14px 22px; border-radius:12px;
  background:#1f2937; color:#fff;
  font-size:14px; font-weight:700; letter-spacing:-.01em;
  box-shadow:0 12px 32px rgba(15,23,42,.28);
  opacity:0; transition:opacity .22s ease, transform .22s ease;
  z-index:10001; pointer-events:none; font-family:inherit;
  max-width:calc(100vw - 40px); text-align:center;
}
.knson-idle-toast.is-visible{
  opacity:1; transform:translateX(-50%) translateY(0);
}

@media(max-width:640px){
  .knson-idle-modal-card{ padding:24px 20px; min-width:0; width:calc(100vw - 40px); }
  .knson-idle-modal-msg strong{ font-size:24px; }
  .knson-idle-modal-actions{ flex-direction:column; }
  .knson-idle-modal-btn{ width:100%; }
}
`;
    document.head.appendChild(style);
  }

  // ── 경고 모달 ────────────────────────────────────────────────────────
  let modalEl = null;
  let countdownIntervalId = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    injectStyles();
    const root = document.createElement('div');
    root.id = 'knsonIdleModalRoot';
    root.className = 'knson-idle-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'knsonIdleModalTitle');
    root.innerHTML = ''
      + '<div class="knson-idle-modal-backdrop"></div>'
      + '<div class="knson-idle-modal-card">'
      +   '<h3 id="knsonIdleModalTitle">자동 로그아웃 안내</h3>'
      +   '<p class="knson-idle-modal-msg">'
      +     '장시간 활동이 없어 잠시 후 자동 로그아웃됩니다.<br/>'
      +     '<strong id="knsonIdleCountdown">2:00</strong> 후 로그아웃'
      +   '</p>'
      +   '<div class="knson-idle-modal-actions">'
      +     '<button type="button" id="knsonIdleStay" class="knson-idle-modal-btn knson-idle-modal-btn-primary">계속 사용</button>'
      +     '<button type="button" id="knsonIdleLogout" class="knson-idle-modal-btn knson-idle-modal-btn-secondary">지금 로그아웃</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(root);
    document.getElementById('knsonIdleStay').addEventListener('click', () => {
      // 명시적으로 활동 갱신 (다른 탭에도 즉시 알림)
      const now = Date.now();
      lastActivityAt = now;
      writeActivity(now);
      lastActivityWriteAt = now;
      hideWarningModal();
    });
    document.getElementById('knsonIdleLogout').addEventListener('click', () => {
      forceLogout({ reason: 'manual' });
    });
    modalEl = root;
    return root;
  }

  function showWarningModal() {
    const root = ensureModal();
    if (root.classList.contains('is-visible')) return;
    root.classList.add('is-visible');
    updateCountdown();
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    countdownIntervalId = setInterval(updateCountdown, 500);
  }

  function hideWarningModal() {
    if (!modalEl) return;
    modalEl.classList.remove('is-visible');
    if (countdownIntervalId) {
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;
    }
  }

  function updateCountdown() {
    const remaining = Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt));
    // 활동으로 시간이 충분해지면 (경고 임계 이상 + 여유 2초) 모달 자동 닫기
    if (remaining > WARNING_BEFORE_MS + 2000) {
      hideWarningModal();
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const el = document.getElementById('knsonIdleCountdown');
    if (el) el.textContent = m + ':' + String(s).padStart(2, '0');
  }

  // ── 토스트 ──────────────────────────────────────────────────────────
  function showToast(message, duration) {
    injectStyles();
    let el = document.getElementById('knsonIdleToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'knsonIdleToast';
      el.className = 'knson-idle-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    void el.offsetWidth;
    el.classList.add('is-visible');
    setTimeout(() => { el.classList.remove('is-visible'); }, Math.max(800, Number(duration) || 1500));
  }

  // ── 강제 로그아웃 ────────────────────────────────────────────────────
  let isLoggingOut = false;
  async function forceLogout(opts) {
    const o = opts || {};
    if (isLoggingOut) return;
    isLoggingOut = true;
    hideWarningModal();
    const isIdle = o.reason === 'idle';
    if (isIdle) {
      showToast('장시간 미사용으로 자동 로그아웃됩니다.', 1500);
    }

    // Supabase signOut (토큰 invalidate)
    try {
      const sb = (window.KNSN && typeof window.KNSN.initSupabase === 'function')
        ? window.KNSN.initSupabase() : null;
      if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
        await sb.auth.signOut().catch(() => {});
      }
    } catch {}

    // 로컬 세션 정리
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    try { localStorage.removeItem(ACTIVITY_KEY); } catch {}

    // 로그인 페이지로 이동 (idle 사유는 query 로 전달)
    const delay = isIdle ? 1500 : 0;
    setTimeout(() => {
      const suffix = isIdle ? '?reason=idle' : '';
      try { location.replace('./login.html' + suffix); }
      catch { location.href = './login.html' + suffix; }
    }, delay);
  }

  // ── 메인 타이머: 1초마다 무활동 시간 체크 ─────────────────────────────
  setInterval(() => {
    if (isLoggingOut) return;
    // 다른 탭에서 갱신된 활동 시각 동기화 (storage 이벤트 외에도 polling 으로 보장)
    const remoteTs = readActivity();
    if (remoteTs > lastActivityAt) lastActivityAt = remoteTs;

    const elapsed = Date.now() - lastActivityAt;
    if (elapsed >= IDLE_TIMEOUT_MS) {
      forceLogout({ reason: 'idle' });
      return;
    }
    if (elapsed >= IDLE_TIMEOUT_MS - WARNING_BEFORE_MS) {
      showWarningModal();
    }
  }, CHECK_INTERVAL_MS);

  // 페이지 로드 시점 활동 한 번 기록
  touch();
})();
