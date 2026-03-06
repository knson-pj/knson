(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // KNSN Core Utilities (shared across login / main / admin / public register)
  // - Safe session handling across page navigation
  // - Numeric/date parsing helpers (fixes: toNumber is not defined)
  // - Optional Supabase bootstrap (enabled only if meta tags are set)
  // ---------------------------------------------------------------------------

  const API_BASE_FALLBACK = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const KEEP_SESSION_KEY = "knson_nav_keep_session";

  // A안: 브라우저 종료 시 자동 로그아웃(세션 유지 X)
  // - 앱 세션은 sessionStorage에만 저장합니다.
  // - 과거 버전 localStorage 세션은 자동로그인의 원인이므로 정리합니다.
  const SESSION_STORE = (typeof sessionStorage !== "undefined") ? sessionStorage : null;
  const LEGACY_STORE = (typeof localStorage !== "undefined") ? localStorage : null;

  function clearLegacySession() {
    try { LEGACY_STORE && LEGACY_STORE.removeItem(SESSION_KEY); } catch {}
  }

  // 초기 로드 시 과거 세션 정리
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

  // Extract a number from mixed strings like "12,345", "12,345원", "건물 12.3", "  "
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

  // --- Supabase (optional) ----------------------------------------------------
  let _sb = null;

  function getSupabaseConfig() {
    return { url: getMeta("supabase-url"), anonKey: getMeta("supabase-anon-key") };
  }

  function supabaseEnabled() {
    const cfg = getSupabaseConfig();
    return !!(cfg.url && cfg.anonKey);
  }

  function initSupabase() {
    if (_sb) return _sb;
    const cfg = getSupabaseConfig();
    if (!cfg.url || !cfg.anonKey) return null;

    const g = (window.supabase && typeof window.supabase.createClient === "function")
      ? window.supabase
      : null;
    if (!g) return null;

    const { createClient } = g;

    _sb = createClient(cfg.url, cfg.anonKey, {
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

  async function sbSignIn({ name, password }) {
    const sb = initSupabase();
    if (!sb) throw new Error("Supabase가 설정되지 않았습니다.");

    const email = normalizeLoginEmail(name);
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const user = data?.user;
    const session = data?.session;
    if (!user || !session?.access_token) throw new Error("로그인 세션 생성에 실패했습니다.");

    let role = "staff";
    let displayName = name;

    try {
      const profRes = await sb.from("profiles").select("role,name").eq("id", user.id).maybeSingle();
      if (profRes?.data) {
        role = profRes.data.role || role;
        displayName = profRes.data.name || displayName;
      } else {
        await sb.from("profiles").upsert({ id: user.id, name: displayName, role }, { onConflict: "id" });
      }
    } catch {}

    const local = {
      backend: "supabase",
      token: session.access_token,
      user: {
        id: user.id,
        email: user.email,
        name: displayName,
        role,
      },
      at: Date.now(),
    };
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
  // signOut이 실패/경쟁상태여도, 로컬 스토리지의 supabase 세션 키를 강제로 제거해
  // '로그아웃했는데 다시 자동 로그인' 되는 현상을 차단합니다.
  clearSupabaseStorage();
  clearSession();
  try { sessionStorage.removeItem(KEEP_SESSION_KEY); } catch {}
  return true;
}

// 기존 호환용
async function sbSignOut() {
  return sbHardSignOut();
}

async function sbGetSession() {
    const sb = initSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  }

  async function sbSyncLocalSession() {
    const sb = initSupabase();
    if (!sb) return null;

    const sess = await sbGetSession();
    if (!sess?.access_token || !sess?.user) return null;

    const local = loadSession();
    if (!local || local.backend !== "supabase" || local.user?.id !== sess.user.id || local.token !== sess.access_token) {
      let role = local?.user?.role || "staff";
      let displayName = local?.user?.name || (sess.user.email || "");
      try {
        const profRes = await sb.from("profiles").select("role,name").eq("id", sess.user.id).maybeSingle();
        if (profRes?.data) {
          role = profRes.data.role || role;
          displayName = profRes.data.name || displayName;
        }
      } catch {}

      const next = {
        backend: "supabase",
        token: sess.access_token,
        user: {
          id: sess.user.id,
          email: sess.user.email,
          name: displayName,
          role,
        },
        at: Date.now(),
      };
      saveSession(next);
      return next;
    }

    return local;
  }

  window.KNSN = {
    API_BASE_FALLBACK,
    SESSION_KEY,
    KEEP_SESSION_KEY,

    safeJsonParse,
    loadSession,
    saveSession,
    clearSession,

    setKeepSessionOnce,
    isKeepSession,

    toNumber,
    toISODate,
    chunk,

    supabaseEnabled,
    initSupabase,
    normalizeLoginEmail,
    sbSignIn,
    sbSignOut,
    sbHardSignOut,
    sbGetSession,
    sbSyncLocalSession,
  };
})();
