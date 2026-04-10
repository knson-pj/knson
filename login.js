(() => {
  "use strict";

  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function") ? window.KNSN.getApiBase() : "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";

  const form = document.getElementById("loginForm");
  const msgEl = document.getElementById("loginMsg");
  const btnLogin = document.getElementById("btnLogin");
  const btnPublicRegister = document.getElementById("btnPublicRegister");

  const nextUrl = getNextUrl();

  const urlObj = (() => { try { return new URL(location.href); } catch { return null; } })();
  const isLogoutFlow = !!(urlObj && urlObj.searchParams.get("logout") === "1");

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const sbEnabled = !!(K && K.supabaseEnabled && K.supabaseEnabled() && K.initSupabase());
  const sharedApi = (Shared && typeof Shared.createApiClient === "function")
    ? Shared.createApiClient({
        baseUrl: API_BASE,
        networkErrorFactory: (fetchErr) => {
          const detail = String(fetchErr?.message || "").trim();
          const err = new Error(detail ? `네트워크 연결 또는 서버 응답에 실패했습니다. (${detail})` : "네트워크 연결 또는 서버 응답에 실패했습니다.");
          err.cause = fetchErr;
          return err;
        },
      })
    : null;

  const btnLoginIdleText = String(btnLogin?.dataset?.idleText || btnLogin?.textContent || "SIGN IN").trim();
  const btnLoginBusyText = String(btnLogin?.dataset?.busyText || "로그인 중...").trim();

  (async () => {
    if (isLogoutFlow) {
      try {
        if (sbEnabled && K && typeof K.sbHardSignOut === "function") await K.sbHardSignOut();
        else if (sbEnabled && K && typeof K.sbSignOut === "function") await K.sbSignOut();
      } catch {}
      try { if (Shared && typeof Shared.clearSession === "function") Shared.clearSession(); }
      catch {}
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
    if (sbEnabled) {
      try {
        const synced = await K.sbSyncLocalSession();
        if (synced?.token && synced?.user) {
          location.replace(resolvePostLoginUrl(synced));
          return;
        }
      } catch {}
    } else {
      const existing = loadSession();
      if (existing?.token && existing?.user) {
        location.replace(resolvePostLoginUrl(existing));
        return;
      }
    }
  })();

  btnPublicRegister?.addEventListener("click", () => {
    location.href = "./buypage.html";
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const password = String(fd.get("password") || "");

    if (!name || !password) {
      setMsg("아이디/비밀번호를 입력해 주세요.", "error");
      return;
    }

    try {
      setBusy(true);
      setMsg("", "error");

      if (sbEnabled) {
        const session = await K.sbSignIn({ name, password });
        location.replace(resolvePostLoginUrl(session));
        return;
      }

      const res = await api("/auth/login", {
        method: "POST",
        body: { name, password },
      });

      if (!res?.token || !res?.user) throw new Error("로그인에 실패했습니다.");

      const session = { token: res.token, user: res.user, at: Date.now(), backend: "vercel" };
      saveSession(session);
      location.replace(resolvePostLoginUrl(session));
    } catch (err) {
      setMsg(err?.message || "로그인에 실패했습니다.", "error");
    } finally {
      setBusy(false);
    }
  });

  function setBusy(b) {
    if (!btnLogin) return;
    btnLogin.disabled = !!b;
    btnLogin.classList.toggle("is-busy", !!b);
    btnLogin.textContent = b ? btnLoginBusyText : btnLoginIdleText;
  }

  function setMsg(msg, type = "error") {
    if (!msgEl) return;
    msgEl.textContent = msg || "";
    msgEl.classList.toggle("show", !!msg);
    msgEl.classList.toggle("is-warning", !!msg && type === "warning");
    msgEl.classList.toggle("is-error", !!msg && type !== "warning");
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
    } catch { return null; }
  }

  async function api(path, options = {}) {
    if (sharedApi) return sharedApi(path, options);
    const method = String(options.method || "GET").toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method);
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), Accept: "application/json" },
      body: hasBody ? JSON.stringify(options.body || {}) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  function resolvePostLoginUrl(session) {
    const role = String(session?.user?.role || "").trim().toLowerCase();
    if (role === "admin" || role === "관리자") {
      return "./admin-index.html";
    }
    if (role === "staff" || role === "담당자" || role === "agent") {
      return "./agent-index.html";
    }
    return nextUrl;
  }

  function getNextUrl() {
    try {
      const u = new URL(location.href);
      const next = u.searchParams.get("next");
      if (next && next.startsWith("./")) return next;
    } catch {}
    return "./index.html";
  }
})();
