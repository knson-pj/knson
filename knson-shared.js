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
})();
