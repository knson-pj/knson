(() => {
  "use strict";

  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function")
    ? window.KNSN.getApiBase()
    : "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const PLATFORM_URL = "https://knson-pj.github.io/platform"; // 2026-05-15: 외부 Platform 페이지

  const form = document.getElementById("loginForm");
  const msgEl = document.getElementById("loginMsg");
  const btnLogin = document.getElementById("btnLogin");
  const btnAdminLogin = document.getElementById("btnAdminLogin");
  const loginModeEl = document.getElementById("loginMode");

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const sbEnabled = !!(K && K.supabaseEnabled && K.supabaseEnabled() && K.initSupabase());
  const sharedApi = (Shared && typeof Shared.createApiClient === "function")
    ? Shared.createApiClient({
        baseUrl: API_BASE,
        networkErrorFactory: (fetchErr) => {
          const detail = String(fetchErr?.message || "").trim();
          const err = new Error(detail
            ? `네트워크 연결 또는 서버 응답에 실패했습니다. (${detail})`
            : "네트워크 연결 또는 서버 응답에 실패했습니다.");
          err.cause = fetchErr;
          return err;
        },
      })
    : null;

  const btnLoginIdleText = String(btnLogin?.dataset?.idleText || btnLogin?.textContent || "플랫폼 로그인 →").trim();
  const btnLoginBusyText = String(btnLogin?.dataset?.busyText || "로그인 중...").trim();
  const btnAdminIdleText = String(btnAdminLogin?.textContent || "관리자시스템 로그인 →").trim();
  const btnAdminBusyText = "로그인 중...";

  const urlObj = (() => {
    try { return new URL(location.href); }
    catch { return null; }
  })();
  const isLogoutFlow = !!(urlObj && urlObj.searchParams.get("logout") === "1");

  (async () => {
    if (isLogoutFlow) {
      try {
        if (sbEnabled && K && typeof K.sbHardSignOut === "function") await K.sbHardSignOut();
        else if (sbEnabled && K && typeof K.sbSignOut === "function") await K.sbSignOut();
      } catch {}
      try {
        if (Shared && typeof Shared.clearSession === "function") Shared.clearSession();
      } catch {}
      if (!Shared || typeof Shared.clearSession !== "function") {
        try { sessionStorage.removeItem(SESSION_KEY); } catch {}
        try { localStorage.removeItem(SESSION_KEY); } catch {}
      }
      try {
        if (urlObj) {
          urlObj.searchParams.delete("logout");
          history.replaceState({}, "", urlObj.pathname + (urlObj.searchParams.toString() ? ("?" + urlObj.searchParams.toString()) : ""));
        }
      } catch {}
      setMsg("로그아웃 되었습니다", "warning");
      return;
    }

    const existing = await getExistingSession();
    if (existing?.token && existing?.user) {
      location.replace(resolveTargetUrl(existing, "platform"));
    }
  })();

  btnAdminLogin?.addEventListener("click", () => {
    setMode("admin");
  });

  btnLogin?.addEventListener("click", () => {
    setMode("platform");
    form?.requestSubmit?.();
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const password = String(fd.get("password") || "");
    const mode = getMode();

    if (!name || !password) {
      setMsg("아이디/비밀번호를 입력해 주세요.", "error");
      return;
    }

    try {
      setBusy(true, mode);
      setMsg("", "error");

      let session;
      if (sbEnabled) {
        session = await K.sbSignIn({ name, password });
      } else {
        const res = await api("/auth/login", {
          method: "POST",
          body: { name, password },
        });
        if (!res?.token || !res?.user) throw new Error("로그인에 실패했습니다.");
        session = { token: res.token, user: res.user, at: Date.now(), backend: "vercel" };
        saveSession(session);
      }

      if (mode === "admin") {
        const role = normalizeRole(session?.user?.role);
        if (role === "admin") {
          location.replace("./admin-index.html");
          return;
        }
        if (role === "staff" || role === "agent") {
          location.replace("./agent-index.html");
          return;
        }
        throw new Error("관리자시스템은 관리자 또는 담당자 계정만 로그인할 수 있습니다.");
      }

      const platformRole = normalizeRole(session?.user?.role);
      if (platformRole !== "admin") {
        // 플랫폼 접근은 관리자(admin) 계정만 허용 — 세션 즉시 정리해서 F5 우회 차단
        try {
          if (sbEnabled && K && typeof K.sbHardSignOut === "function") await K.sbHardSignOut();
          else if (sbEnabled && K && typeof K.sbSignOut === "function") await K.sbSignOut();
        } catch {}
        try {
          if (Shared && typeof Shared.clearSession === "function") Shared.clearSession();
          else {
            sessionStorage.removeItem(SESSION_KEY);
            try { localStorage.removeItem(SESSION_KEY); } catch {}
          }
        } catch {}
        if (platformRole === "staff" || platformRole === "agent") {
          throw new Error("담당자는 <strong>임직원 시스템 로그인</strong>을 이용해주세요.");
        }
        throw new Error("플랫폼은 관리자 계정만 이용할 수 있습니다.");
      }

      // admin 만 도달 — 외부 Platform 으로 이동
      location.replace(PLATFORM_URL);
    } catch (err) {
      setMsg(err?.message || "로그인에 실패했습니다.", "error");
    } finally {
      setBusy(false, mode);
      setMode("admin");
    }
  });

  function setMode(mode) {
    if (loginModeEl) loginModeEl.value = mode === "admin" ? "admin" : "platform";
  }

  function getMode() {
    return loginModeEl?.value === "admin" ? "admin" : "platform";
  }

  function setBusy(isBusy, mode) {
    const busy = !!isBusy;
    if (btnLogin) {
      btnLogin.disabled = busy;
      btnLogin.classList.toggle("is-busy", busy && mode === "platform");
      btnLogin.textContent = busy && mode === "platform" ? btnLoginBusyText : btnLoginIdleText;
    }
    if (btnAdminLogin) {
      btnAdminLogin.disabled = busy;
      btnAdminLogin.classList.toggle("is-busy", busy && mode === "admin");
      btnAdminLogin.textContent = busy && mode === "admin" ? btnAdminBusyText : btnAdminIdleText;
    }
  }

  function setMsg(msg, type = "error") {
    if (!msgEl) return;
    const text = String(msg || "");
    if (!text) {
      msgEl.textContent = "";
      msgEl.classList.remove("show", "is-warning", "is-error");
      return;
    }
    // XSS 방지: 먼저 전체 escape → 허용된 태그(<strong>)만 복원
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    const html = escaped
      .replace(/&lt;strong&gt;/g, "<strong>")
      .replace(/&lt;\/strong&gt;/g, "</strong>");
    msgEl.innerHTML = html;
    msgEl.classList.toggle("show", true);
    msgEl.classList.toggle("is-warning", type === "warning");
    msgEl.classList.toggle("is-error", type !== "warning");
  }

  async function getExistingSession() {
    if (sbEnabled) {
      try {
        const synced = await K.sbSyncLocalSession();
        if (synced?.token && synced?.user) return synced;
      } catch {}
    }
    return loadSession();
  }

  function saveSession(session) {
    if (Shared && typeof Shared.saveSession === "function") return Shared.saveSession(session);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    } catch {}
  }

  function loadSession() {
    if (Shared && typeof Shared.loadSession === "function") return Shared.loadSession();
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function api(path, options = {}) {
    if (sharedApi) return sharedApi(path, options);
    const method = String(options.method || "GET").toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method);
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
      },
      body: hasBody ? JSON.stringify(options.body || {}) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  function normalizeRole(role) {
    const value = String(role || "").trim().toLowerCase();
    if (value === "관리자") return "admin";
    if (value === "담당자") return "staff";
    return value;
  }

  function resolveTargetUrl(session, mode) {
    const normalizedMode = mode === "admin" ? "admin" : "platform";
    if (normalizedMode === "platform") return "./index.html";

    const role = normalizeRole(session?.user?.role);
    if (role === "admin") return "./admin-index.html";
    if (role === "staff" || role === "agent") return "./agent-index.html";
    return "./index.html";
  }

  // ── 자동 로그아웃 안내 (?reason=idle) — 2026-05-08 ─────────────────
  // knson-idle-timeout.js 가 30분 무활동 시 ?reason=idle 로 redirect 시키면
  // 로그인 페이지에서 사용자에게 안내 메시지 표시.
  (function showIdleNoticeIfPresent() {
    try {
      const params = new URLSearchParams(location.search);
      const reason = params.get("reason");
      if (reason === "idle" && msgEl) {
        msgEl.textContent = "장시간 미사용으로 자동 로그아웃되었습니다. 다시 로그인해 주세요.";
      }
    } catch {}
  })();

  // ── 비밀번호 표시 토글 (눈알 아이콘) — 2026-05-15 ─────
  (function bindPasswordToggle() {
    const input = document.getElementById("loginPassword");
    const btn = document.getElementById("togglePassword");
    if (!input || !btn) return;

    btn.addEventListener("click", () => {
      const showing = input.type === "text";
      const next = showing ? "password" : "text";
      input.type = next;
      btn.setAttribute("aria-pressed", String(!showing));
      btn.setAttribute("aria-label", showing ? "비밀번호 표시" : "비밀번호 숨기기");
      // 클릭 후에도 포커스가 input 에 있도록 유지 (UX)
      try {
        const len = input.value.length;
        input.focus({ preventScroll: true });
        input.setSelectionRange(len, len);
      } catch {}
    });
  })();
})();
