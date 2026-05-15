(() => {
  "use strict";

  const SESSION_KEY = "knson_bms_session_v1";
  const K = window.KNSN || null;

  function loadSession() {
    if (K && typeof K.loadSession === "function") return K.loadSession();
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    if (K && typeof K.saveSession === "function") return K.saveSession(session);
    try {
      if (!session) {
        sessionStorage.removeItem(SESSION_KEY);
        try { localStorage.removeItem(SESSION_KEY); } catch {}
        return null;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      try { localStorage.removeItem(SESSION_KEY); } catch {}
      return session;
    } catch {
      return null;
    }
  }

  function clearSession() {
    if (K && typeof K.clearSession === "function") return K.clearSession();
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    return true;
  }

  function toNumber(value) {
    if (K && typeof K.toNumber === "function") return K.toNumber(value);
    if (value === null || value === undefined) return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    const text = String(value).trim();
    if (!text) return NaN;
    const normalized = text.replace(/,/g, "");
    const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
    if (!match) return NaN;
    const num = Number(match[0]);
    return Number.isFinite(num) ? num : NaN;
  }

  function toNullableNumber(value) {
    const num = toNumber(value);
    return Number.isFinite(num) ? num : null;
  }

  function parseFlexibleNumber(value) {
    const num = toNullableNumber(value);
    return num == null ? null : num;
  }

  function normalizeRole(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "관리자" || v === "admin") return "admin";
    if (v === "기타" || v === "other") return "other";
    return "staff";
  }

  function formatMoneyInputValue(value) {
    if (value === null || value === undefined) return "";
    const raw = String(value).trim();
    if (!raw) return "";
    const digits = raw.replace(/[^\d-]/g, "");
    if (!digits || digits === "-") return "";
    const sign = digits.startsWith("-") ? "-" : "";
    const body = digits.replace(/-/g, "");
    if (!body) return sign;
    return sign + body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function bindAmountInputMask(input) {
    if (!input || input.dataset.amountMaskBound === "true") return;
    input.dataset.amountMaskBound = "true";
    input.addEventListener("input", () => {
      const formatted = formatMoneyInputValue(input.value);
      if (input.value !== formatted) input.value = formatted;
    });
    input.addEventListener("blur", () => {
      input.value = formatMoneyInputValue(input.value);
    });
  }

  function configureFreeDecimalInput(input) {
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "decimal");
    input.removeAttribute("step");
  }

  function configureAmountInput(input) {
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.removeAttribute("step");
    bindAmountInputMask(input);
  }

  function configureFormNumericUx(form, options = {}) {
    if (!form?.elements) return;
    const decimalNames = Array.isArray(options.decimalNames) ? options.decimalNames : [];
    const amountNames = Array.isArray(options.amountNames) ? options.amountNames : [];
    decimalNames.forEach((name) => configureFreeDecimalInput(form.elements[name]));
    amountNames.forEach((name) => configureAmountInput(form.elements[name]));
  }

  function debounce(fn, wait = 150) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
  }

  function parseFlexibleDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const text = String(value).trim();
    if (!text) return null;
    // [FIX 20260504-tzfix] ISO 8601 timestamptz (Supabase created_at 등 "2028-05-03T17:30:00.123456+00:00") 는
    // 아래 .replace(/\./g, "-") 가 milliseconds 구분자(.)를 망가뜨리기 전에 new Date() 로 직접 파싱한다.
    // 기존 로직은 시간/타임존 정보를 잃고 UTC 날짜만 캡처해서, KST 0~9시 사이 created_at 이 전날로 분류되어
    // 대시보드 신규등록 카운트가 서버(KST HEAD count)와 어긋나는 문제가 있었다.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
      const iso = new Date(text);
      if (!Number.isNaN(iso.getTime())) return iso;
    }
    const normalized = text
      .replace(/\./g, "-")
      .replace(/\//g, "-")
      .replace(/년/g, "-")
      .replace(/월/g, "-")
      .replace(/일/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const direct = new Date(normalized);
    if (!Number.isNaN(direct.getTime())) return direct;

    const ymd = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (ymd) {
      const [, y, m, d, hh = "0", mm = "0"] = ymd;
      const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
      const [, y, m, d] = compact;
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = parseFlexibleDate(value);
    if (!date) return String(value || "").trim();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function buildJsonBody(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "rawBody")) return options.rawBody;
    if (Object.prototype.hasOwnProperty.call(options, "json")) return JSON.stringify(options.json || {});
    return JSON.stringify(options.body || {});
  }

  function createApiClient(config = {}) {
    const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
    return async function api(path, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      const headers = { Accept: "application/json", ...(options.headers || {}) };

      if (options.auth) {
        let token = "";
        if (typeof config.getAuthToken === "function") {
          try { token = String(await config.getAuthToken(options) || "").trim(); } catch {}
        }
        if (!token && typeof config.loadSession === "function") {
          try {
            const session = config.loadSession();
            token = String(session?.token || "").trim();
          } catch {}
        }
        if (!token && typeof config.ensureAuthToken === "function") {
          try { token = String(await config.ensureAuthToken(options) || "").trim(); } catch {}
        }
        if (!token) {
          const err = new Error(config.loginRequiredMessage || "로그인이 필요합니다.");
          err.code = "LOGIN_REQUIRED";
          throw err;
        }
        headers.Authorization = `Bearer ${token}`;
      }

      const hasBody = !["GET", "HEAD"].includes(method);
      if (hasBody && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

      let response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: hasBody ? buildJsonBody(options) : undefined,
        });
      } catch (fetchErr) {
        if (typeof config.networkErrorFactory === "function") throw config.networkErrorFactory(fetchErr);
        const detail = String(fetchErr?.message || "").trim();
        const message = detail
          ? `네트워크 연결 또는 서버 응답에 실패했습니다. (${detail})`
          : "네트워크 연결 또는 서버 응답에 실패했습니다.";
        const err = new Error(message);
        err.cause = fetchErr;
        throw err;
      }

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

      if (response.status === 401 && options.auth && !options._retried && typeof config.handleUnauthorized === "function") {
        try {
          const shouldRetry = await config.handleUnauthorized({ path, options, response, data });
          if (shouldRetry) return api(path, { ...options, _retried: true });
        } catch {}
      }

      if (!response.ok) {
        const err = new Error(data?.message || `API 오류 (${response.status})`);
        err.status = response.status;
        if (response.status === 401) err.code = "LOGIN_REQUIRED";
        err.data = data;
        throw err;
      }
      return data;
    };
  }

  window.KNSN_SHARED = {
    loadSession,
    saveSession,
    clearSession,
    toNumber,
    toNullableNumber,
    parseFlexibleNumber,
    normalizeRole,
    formatMoneyInputValue,
    bindAmountInputMask,
    configureFreeDecimalInput,
    configureAmountInput,
    configureFormNumericUx,
    debounce,
    escapeHtml,
    escapeAttr,
    parseFlexibleDate,
    formatDate,
    createApiClient,
  };

  // 비밀번호 표시 토글 (.input-toggle) — 2026-05-15
  // 페이지 어디서든 .input-with-toggle > input + .input-toggle 구조면 자동 동작.
  // 같은 페이지 안에서 여러 번 로드돼도 1회만 바인딩.
  if (typeof document !== "undefined" && !window.__knsonPwdToggleBound) {
    window.__knsonPwdToggleBound = true;

    // 클릭: type 토글 + aria 상태 갱신 + 커서 위치 유지
    document.addEventListener("click", (e) => {
      const btn = e.target && typeof e.target.closest === "function"
        ? e.target.closest(".input-toggle")
        : null;
      if (!btn) return;
      e.preventDefault();
      const wrap = btn.closest(".input-with-toggle");
      const input = wrap && wrap.querySelector("input");
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.setAttribute("aria-pressed", String(!showing));
      btn.setAttribute("aria-label", showing ? "비밀번호 표시" : "비밀번호 숨기기");
      try {
        const len = input.value.length;
        input.focus({ preventScroll: true });
        input.setSelectionRange(len, len);
      } catch {}
    });

    // 폼 reset 시 토글도 기본(마스킹) 상태로 복귀 — 보안 기본값
    document.addEventListener("reset", (e) => {
      const form = e.target;
      if (!form || typeof form.querySelectorAll !== "function") return;
      form.querySelectorAll('.input-toggle[aria-pressed="true"]').forEach((btn) => {
        const wrap = btn.closest(".input-with-toggle");
        const input = wrap && wrap.querySelector("input");
        if (input) input.type = "password";
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-label", "비밀번호 표시");
      });
      // 비번 변경 모달 안내 메시지도 초기화
      if (form.id === "passwordChangeForm") {
        const msgEl = document.getElementById("pwdMsg");
        if (msgEl) {
          msgEl.textContent = "";
          msgEl.removeAttribute("data-state");
        }
        // 변경 버튼도 초기에는 비활성화 (입력 시작하면 validatePwdLive 가 다시 평가)
        const saveBtn = document.getElementById("pwdSave");
        if (saveBtn) saveBtn.disabled = true;
      }
    }, true);
  }

  // 비밀번호 변경 모달 실시간 일치/길이 안내 — 2026-05-15
  if (typeof document !== "undefined" && !window.__knsonPwdMatchBound) {
    window.__knsonPwdMatchBound = true;

    function writePwdMsg(state, text) {
      const msgEl = document.getElementById("pwdMsg");
      if (!msgEl) return;
      msgEl.textContent = text || "";
      if (state) {
        msgEl.setAttribute("data-state", state);
        // 앱 측 setPwdMsg('') 가 'hidden' 클래스를 붙여 display:none 시키므로
        // 메시지를 보여줄 때는 반드시 제거해야 함
        msgEl.classList.remove("hidden");
      } else {
        msgEl.removeAttribute("data-state");
      }
      // 기존 인라인 color 가 있으면 (앱 측 setPwdMsg 가 남긴 것) 비워서
      // CSS data-state 색이 적용되도록 함
      try { msgEl.style.color = ""; } catch {}
    }

    function validatePwdLive() {
      const form = document.getElementById("passwordChangeForm");
      if (!form) return;
      const pwInput = form.querySelector('input[name="newPassword"]');
      const cfInput = form.querySelector('input[name="confirmPassword"]');
      if (!pwInput || !cfInput) return;

      const pw = String(pwInput.value || "");
      const cf = String(cfInput.value || "");
      let canSubmit = false;

      if (!pw && !cf) {
        writePwdMsg("", "");
      } else if (pw.length > 0 && pw.length < 8) {
        writePwdMsg("warning", "비밀번호는 8자 이상이어야 합니다.");
      } else if (!cf) {
        writePwdMsg("warning", "확인 비밀번호도 입력해 주세요.");
      } else if (pw === cf) {
        writePwdMsg("success", "✓ 비밀번호가 일치합니다.");
        canSubmit = true;
      } else {
        writePwdMsg("error", "✕ 비밀번호가 일치하지 않습니다.");
      }

      // 변경 버튼은 두 비번이 일치하고 8자 이상일 때만 활성화
      const saveBtn = document.getElementById("pwdSave");
      if (saveBtn) saveBtn.disabled = !canSubmit;
    }

    // 두 입력 어느 쪽이든 변경되면 검증 — 위임 방식으로 모달이 동적 로드돼도 안전
    document.addEventListener("input", (e) => {
      const t = e.target;
      if (!t || typeof t.matches !== "function") return;
      if (!t.matches(
        '#passwordChangeForm input[name="newPassword"], #passwordChangeForm input[name="confirmPassword"]'
      )) return;
      validatePwdLive();
    });

    // 제출 직전에 우리 data-state 를 비워서 — 앱 측 setPwdMsg(인라인 color)
    // 가 그리는 메시지와 색 충돌이 안 나도록 함
    document.addEventListener("submit", (e) => {
      const f = e.target;
      if (!f || f.id !== "passwordChangeForm") return;
      const msgEl = document.getElementById("pwdMsg");
      if (msgEl) msgEl.removeAttribute("data-state");
    }, true);
  }
})();
