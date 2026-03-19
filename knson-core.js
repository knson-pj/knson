(() => {
  "use strict";

  const API_BASE_FALLBACK = "https://knson.vercel.app/api";
  const API_BASE_KEY = "knson_api_base_v1";
  const SESSION_KEY = "knson_bms_session_v1";
  const KEEP_SESSION_KEY = "knson_nav_keep_session";
  const THEME_KEY = "knson_theme_v1";

  const SESSION_STORE = (typeof sessionStorage !== "undefined") ? sessionStorage : null;
  const LEGACY_STORE = (typeof localStorage !== "undefined") ? localStorage : null;

  function clearLegacySession() {
    try { LEGACY_STORE && LEGACY_STORE.removeItem(SESSION_KEY); } catch {}
  }
  clearLegacySession();

  function safeJsonParse(str) {
    try { return JSON.parse(str); } catch { return null; }
  }

  function loadSession() {
    let raw = null;
    try { raw = SESSION_STORE ? SESSION_STORE.getItem(SESSION_KEY) : null; } catch {}
    const s = raw ? safeJsonParse(raw) : null;
    if (!s || typeof s !== "object") return null;
    return s;
  }

  function saveSession(session) {
    try {
      if (!SESSION_STORE) return;
      if (!session) { SESSION_STORE.removeItem(SESSION_KEY); return; }
      SESSION_STORE.setItem(SESSION_KEY, JSON.stringify(session));
      clearLegacySession();
    } catch {}
  }

  function clearSession() {
    try { SESSION_STORE && SESSION_STORE.removeItem(SESSION_KEY); } catch {}
    clearLegacySession();
  }

  function setKeepSessionOnce(ms = 15000) {
    try {
      sessionStorage.setItem(KEEP_SESSION_KEY, "1");
      window.setTimeout(() => {
        try { sessionStorage.removeItem(KEEP_SESSION_KEY); } catch {}
      }, ms);
    } catch {}
  }

  function isKeepSession() {
    try { return sessionStorage.getItem(KEEP_SESSION_KEY) === "1"; } catch { return false; }
  }

  function toNumber(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim();
    if (!s) return NaN;
    const s2 = s.replace(/,/g, "").replace(/\s+/g, " ");
    const m = s2.match(/[+-]?\d+(\.\d+)?/);
    if (!m) return NaN;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : NaN;
  }

  function toISODate(value) {
    if (!value) return null;
    const s = String(value).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m1 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (m1) {
      const yy = Number(m1[1]);
      const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
      return `${yyyy}-${m1[2]}-${m1[3]}`;
    }
    const m2 = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
    const m3 = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
    return null;
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? String(el.getAttribute("content") || "").trim() : "";
  }

  function normalizeApiBase(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.replace(/\/+$/, "");
  }

  function getStoredApiBase() {
    try {
      return normalizeApiBase(localStorage.getItem(API_BASE_KEY) || "");
    } catch {
      return "";
    }
  }

  function storeApiBase(value) {
    const next = normalizeApiBase(value);
    if (!next) return;
    try { localStorage.setItem(API_BASE_KEY, next); } catch {}
  }

  function resolveApiBase() {
    const metaApiBase = normalizeApiBase(getMeta("api-base"));
    if (metaApiBase) {
      storeApiBase(metaApiBase);
      return metaApiBase;
    }

    const storedApiBase = getStoredApiBase();

    try {
      const loc = window.location;
      const origin = normalizeApiBase(loc.origin || "");
      const host = String(loc.hostname || "").toLowerCase();
      const isLocal = host === "localhost" || host === "127.0.0.1";
      const isGithubPages = host.endsWith("github.io");
      const isFile = String(loc.protocol || "") === "file:";
      const isVercel = host.endsWith(".vercel.app");

      if (isLocal || isGithubPages || isFile) {
        return storedApiBase || API_BASE_FALLBACK;
      }

      if (origin) {
        const sameOriginApi = `${origin}/api`;
        storeApiBase(sameOriginApi);
        return sameOriginApi;
      }

      if (isVercel) return storedApiBase || API_BASE_FALLBACK;
    } catch {}

    return storedApiBase || API_BASE_FALLBACK;
  }

  function getApiBase() {
    return resolveApiBase();
  }

  function getStoredSupabaseConfig() {
    try {
      return {
        url: String(localStorage.getItem("knson_supabase_url") || "").trim(),
        anonKey: String(localStorage.getItem("knson_supabase_key") || "").trim(),
      };
    } catch {
      return { url: "", anonKey: "" };
    }
  }

  function storeSupabaseConfig(url, anonKey) {
    try {
      if (url) localStorage.setItem("knson_supabase_url", url);
      if (anonKey) localStorage.setItem("knson_supabase_key", anonKey);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Theme helpers
  // ---------------------------------------------------------------------------
  function getStoredTheme() {
    try {
      const raw = localStorage.getItem(THEME_KEY);
      if (raw === "light" || raw === "dark") return raw;
    } catch {}
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    try { document.documentElement.setAttribute("data-theme", next); } catch {}
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    const btns = document.querySelectorAll("[data-theme-toggle]");
    btns.forEach((btn) => {
      btn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
      btn.innerHTML = next === "dark"
        ? '<span class="theme-icon">☀</span>'
        : '<span class="theme-icon">☾</span>';
    });
    return next;
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || getStoredTheme();
    return applyTheme(current === "dark" ? "light" : "dark");
  }

  function mountThemeToggle(container, opts = {}) {
    if (!container) return null;
    let btn = container.querySelector("[data-theme-toggle]");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = opts.className || "btn-theme";
      btn.setAttribute("data-theme-toggle", "true");
      btn.setAttribute("aria-label", "라이트/다크 모드 전환");
      container.prepend(btn);
      btn.addEventListener("click", () => toggleTheme());
    }
    applyTheme(getStoredTheme());
    return btn;
  }

  function initTheme(opts = {}) {
    applyTheme(getStoredTheme());
    if (opts && opts.container) mountThemeToggle(opts.container, opts);
    return document.documentElement.getAttribute("data-theme") || "light";
  }

  // ---------------------------------------------------------------------------
  // Supabase (optional)
  // ---------------------------------------------------------------------------
  let _sb = null;
  let _authMeCache = { token: "", at: 0, user: null };
  let _syncCache = { token: "", at: 0, session: null };
  let _syncPromise = null;

  function getSupabaseConfig() {
    const metaUrl = getMeta("supabase-url");
    const metaAnonKey = getMeta("supabase-anon-key");
    if (metaUrl && metaAnonKey) {
      storeSupabaseConfig(metaUrl, metaAnonKey);
      return { url: metaUrl, anonKey: metaAnonKey };
    }
    return getStoredSupabaseConfig();
  }

  function supabaseEnabled() {
    const cfg = getSupabaseConfig();
    return !!(cfg.url && cfg.anonKey);
  }

  function initSupabase() {
    if (_sb) return _sb;
    const cfg = getSupabaseConfig();
    if (!cfg.url || !cfg.anonKey) return null;
    const g = (window.supabase && typeof window.supabase.createClient === "function") ? window.supabase : null;
    if (!g) return null;

    _sb = g.createClient(cfg.url, cfg.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: SESSION_STORE || undefined,
      },
    });

    return _sb;
  }

  function normalizeLoginEmail(nameOrEmail) {
    const s = String(nameOrEmail || "").trim();
    if (!s) return "";
    if (s.includes("@")) return s;
    return `${s}@knson.local`;
  }
  function normalizeRoleValue(role) {
    const s = String(role || "").trim().toLowerCase();
    if (!s) return "";
    if (["admin", "관리자"].includes(s)) return "admin";
    if (["agent", "staff", "담당자"].includes(s)) return "staff";
    if (["other", "기타"].includes(s)) return "other";
    return "";
  }

  function mergeRoleValues(...roles) {
    const normalized = roles.map((v) => normalizeRoleValue(v)).filter(Boolean);
    if (normalized.includes("admin")) return "admin";
    if (normalized.includes("staff")) return "staff";
    if (normalized.includes("other")) return "other";
    return "";
  }

  function pickRoleFromAuthUser(user, fallback = "staff") {
    return mergeRoleValues(
      user?.app_metadata?.role,
      user?.user_metadata?.role,
      user?.role,
      fallback
    ) || "staff";
  }

  function pickDisplayNameFromAuthUser(user, fallback = "") {
    return String(
      user?.user_metadata?.display_name ||
      user?.email ||
      fallback ||
      ""
    ).trim();
  }

  async function fetchSessionUserFromApi(accessToken) {
    const token = String(accessToken || "").trim();
    if (!token) return null;

    if (_authMeCache.token === token && (Date.now() - _authMeCache.at) < 10000) {
      return _authMeCache.user || null;
    }

    try {
      const res = await fetch(`${getApiBase()}/auth/me`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) return null;
      const user = data?.user || null;
      _authMeCache = { token, at: Date.now(), user };
      return user;
    } catch {
      return null;
    }
  }

  async function buildLocalSupabaseSession(sess, fallbackLocal = null) {
    const sb = initSupabase();
    if (!sb || !sess?.access_token || !sess?.user) return null;

    const authUser = sess.user;
    const apiUser = await fetchSessionUserFromApi(sess.access_token);

    const fallbackRole = normalizeRoleValue(fallbackLocal?.user?.role || "");
    const authRole = pickRoleFromAuthUser(authUser, "");
    let role = mergeRoleValues(apiUser?.role, authRole, fallbackRole) || "staff";
    let displayName = String(
      apiUser?.name ||
      pickDisplayNameFromAuthUser(authUser, fallbackLocal?.user?.name || "") ||
      ""
    ).trim();

    if (!apiUser) {
      try {
        const profRes = await sb.from("profiles").select("role,name").eq("id", authUser.id).maybeSingle();
        if (profRes?.data) {
          role = mergeRoleValues(profRes.data.role, authRole, fallbackRole) || role;
          displayName = String(profRes.data.name || displayName || "").trim();
        }
      } catch {}
    }

    return {
      backend: "supabase",
      token: sess.access_token,
      user: {
        id: authUser.id,
        email: authUser.email,
        name: displayName || authUser.email || "",
        role: role || "staff",
      },
      at: Date.now(),
    };
  }

  async function sbSignIn({ name, password }) {
    const sb = initSupabase();
    if (!sb) throw new Error("Supabase가 설정되지 않았습니다.");

    const email = normalizeLoginEmail(name);
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const session = data?.session;
    if (!session?.access_token || !data?.user) throw new Error("로그인 세션 생성에 실패했습니다.");

    const local = await buildLocalSupabaseSession(session, null);
    if (!local) throw new Error("로그인 세션 생성에 실패했습니다.");

    saveSession(local);
    return local;
  }

  function getSupabaseProjectRef() {
    const cfg = getSupabaseConfig();
    if (!cfg.url) return "";
    try {
      const u = new URL(cfg.url);
      const host = u.hostname || "";
      return (host.split(".")[0] || "").trim();
    } catch {
      return "";
    }
  }

  function clearSupabaseStorage() {
    const ref = getSupabaseProjectRef();
    if (!ref) return;
    const prefix = `sb-${ref}-`;
    const stores = [];
    try { if (LEGACY_STORE) stores.push(LEGACY_STORE); } catch {}
    try { if (SESSION_STORE) stores.push(SESSION_STORE); } catch {}
    for (const st of stores) {
      try {
        for (let i = st.length - 1; i >= 0; i--) {
          const k = st.key(i);
          if (k && k.startsWith(prefix)) st.removeItem(k);
        }
      } catch {}
    }
  }

  async function sbHardSignOut() {
    const sb = initSupabase();
    if (sb) {
      try { await sb.auth.signOut(); } catch {}
    }
    clearSupabaseStorage();
    clearSession();
    try { sessionStorage.removeItem(KEEP_SESSION_KEY); } catch {}
    return true;
  }

  async function sbSignOut() { return sbHardSignOut(); }

  async function sbGetSession() {
    const sb = initSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  }

  async function sbGetAccessToken(options = {}) {
    const force = !!options.forceRefresh;
    const sb = initSupabase();
    if (!sb) return '';
    try {
      const sess = await sbGetSession();
      const token = String(sess?.access_token || '').trim();
      if (!token) return '';
      if (force) {
        const next = await sbSyncLocalSession(true).catch(() => null);
        return String(next?.token || token || '').trim();
      }
      const local = loadSession();
      if (!local || local.token !== token) {
        saveSession({
          backend: 'supabase',
          token,
          user: local?.user || { id: sess?.user?.id || '', email: sess?.user?.email || '', name: sess?.user?.email || '', role: local?.user?.role || 'staff' },
          at: Date.now(),
        });
      }
      return token;
    } catch {
      return '';
    }
  }

  async function sbSyncLocalSession(force = false) {
    const sb = initSupabase();
    if (!sb) return null;

    const sess = await sbGetSession();
    if (!sess?.access_token || !sess?.user) {
      clearSession();
      _syncCache = { token: "", at: 0, session: null };
      return null;
    }

    const local = loadSession();
    const sameTokenRecent = (
      !force &&
      _syncCache.token === sess.access_token &&
      (Date.now() - _syncCache.at) < 8000 &&
      _syncCache.session
    );
    if (sameTokenRecent) {
      if (local && local.token === _syncCache.token) return local;
      saveSession(_syncCache.session);
      return _syncCache.session;
    }

    if (_syncPromise && !force) return _syncPromise;

    _syncPromise = (async () => {
      const next = await buildLocalSupabaseSession(sess, local);
      if (!next) return null;

      const changed = (
        !local ||
        local.backend !== next.backend ||
        local.token !== next.token ||
        local.user?.id !== next.user.id ||
        local.user?.role !== next.user.role ||
        local.user?.name !== next.user.name ||
        local.user?.email !== next.user.email
      );

      if (changed) saveSession(next);
      _syncCache = { token: next.token, at: Date.now(), session: next };
      return changed ? next : (local || next);
    })();

    try {
      return await _syncPromise;
    } finally {
      _syncPromise = null;
    }
  }

  window.KNSN = {
    API_BASE_FALLBACK,
    API_BASE_KEY,
    SESSION_KEY,
    KEEP_SESSION_KEY,
    THEME_KEY,

    safeJsonParse,
    loadSession,
    saveSession,
    clearSession,
    setKeepSessionOnce,
    isKeepSession,
    toNumber,
    toISODate,
    chunk,

    getApiBase,
    getStoredTheme,
    applyTheme,
    toggleTheme,
    mountThemeToggle,
    initTheme,

    supabaseEnabled,
    initSupabase,
    normalizeLoginEmail,
    fetchSessionUserFromApi,
    sbSignIn,
    sbSignOut,
    sbHardSignOut,
    sbGetSession,
    sbGetAccessToken,
    sbSyncLocalSession,
  };
})();