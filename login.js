(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";

  const form = document.getElementById("loginForm");
  const msgEl = document.getElementById("loginMsg");
  const btnLogin = document.getElementById("btnLogin");
  const btnPublicRegister = document.getElementById("btnPublicRegister");

  const nextUrl = getNextUrl();

  // 이미 로그인되어 있으면 바로 이동
  const existing = loadSession();
  if (existing?.token && existing?.user) {
    location.replace(nextUrl);
    return;
  }

  btnPublicRegister.addEventListener("click", () => {
    location.href = "./general-register.html";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const password = String(fd.get("password") || "");

    if (!name || !password) {
      setMsg("이름/비밀번호를 입력해 주세요.");
      return;
    }

    try {
      setBusy(true);
      setMsg("");

      const res = await api("/auth/login", {
        method: "POST",
        body: { name, password },
      });

      if (!res?.token || !res?.user) {
        throw new Error("로그인 응답 형식이 올바르지 않습니다.");
      }

      saveSession({ token: res.token, user: res.user });
      location.replace(nextUrl);
    } catch (err) {
      console.error(err);
      setMsg(err?.message || "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  });

  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();

    const headers = { Accept: "application/json" };
    const hasBody = !["GET", "HEAD"].includes(method);
    if (hasBody) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body || {}) : undefined,
      });
    } catch {
      throw new Error("서버 연결에 실패했습니다. (네트워크/CORS 확인)");
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      throw new Error(data?.message || `API 오류 (${res.status})`);
    }
    return data;
  }

  function setBusy(busy) {
    btnLogin.disabled = busy;
    btnPublicRegister.disabled = busy;
    [...form.querySelectorAll("input")].forEach((i) => (i.disabled = busy));
  }

  function setMsg(text) {
    msgEl.textContent = text || "";
  }

  function getNextUrl() {
    try {
      const u = new URL(location.href);
      const next = u.searchParams.get("next");
      if (next && typeof next === "string") {
        // 상대경로만 허용
        if (next.startsWith("http://") || next.startsWith("https://")) return "./index.html";
        return next;
      }
    } catch {}
    return "./index.html";
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
})();
