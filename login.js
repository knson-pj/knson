(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";

  const form = document.getElementById("loginForm");
  const msgEl = document.getElementById("loginMsg");
  const btnLogin = document.getElementById("btnLogin");
  const btnPublicRegister = document.getElementById("btnPublicRegister");

  const nextUrl = getNextUrl();

  const K = window.KNSN || null;
  const sbEnabled = !!(K && K.supabaseEnabled && K.supabaseEnabled() && K.initSupabase());

  // 이미 로그인되어 있으면 바로 이동
  (async () => {
    if (sbEnabled) {
      try {
        const synced = await K.sbSyncLocalSession();
        if (synced?.token && synced?.user) {
          location.replace(nextUrl);
          return;
        }
      } catch {}
    } else {
      const existing = loadSession();
      if (existing?.token && existing?.user) {
        location.replace(nextUrl);
        return;
      }
    }
  })();

  btnPublicRegister.addEventListener("click", () => {
    location.href = "./general-register.html";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const password = String(fd.get("password") || "");

    if (!name || !password) {
      setMsg("아이디/비밀번호를 입력해 주세요.");
      return;
    }

    try {
      setBusy(true);
      setMsg("");

      if (sbEnabled) {
        await K.sbSignIn({ name, password });
        location.replace(nextUrl);
        return;
      }

      const res = await api("/auth/login", {
        method: "POST",
        body: { name, password },
      });

      if (!res?.token || !res?.user) throw new Error("로그인에 실패했습니다.");

      saveSession({ token: res.token, user: res.user, at: Date.now(), backend: "vercel" });
      location.replace(nextUrl);
    } catch (err) {
      setMsg(err?.message || "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  });

  function setBusy(b) {
    btnLogin.disabled = !!b;
    btnLogin.classList.toggle("is-busy", !!b);
    btnLogin.textContent = b ? "SIGNING..." : "SIGN IN";
  }

  function setMsg(msg) {
    msgEl.textContent = msg || "";
    msgEl.classList.toggle("show", !!msg);
  }

  function saveSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
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
