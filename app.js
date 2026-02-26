(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";

  const state = {
    sourceTab: "all",
    properties: [],
    loading: false,
    session: loadSession(),
    keyword: "",
    status: "",
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    renderSessionUI();
    loadProperties();
  }

  function cacheElements() {
    Object.assign(els, {
      // buttons
      btnGoRegister: $("#btnGoRegister"),
      btnOpenLogin: $("#btnOpenLogin"),
      btnCloseLogin: $("#btnCloseLogin"),
      btnLogout: $("#btnLogout"),
      btnRefresh: $("#btnRefresh"),

      // views
      viewList: $("#viewList"),

      // forms
      loginModal: $("#loginModal"),
      loginForm: $("#loginForm"),

      // list
      sourceTabs: $("#sourceTabs"),
      searchKeyword: $("#searchKeyword"),
      filterStatus: $("#filterStatus"),
      propertyList: $("#propertyList"),
      emptyState: $("#emptyState"),
      listMeta: $("#listMeta"),

      // counters
      countAll: $("#countAll"),
      countAuction: $("#countAuction"),
      countGongmae: $("#countGongmae"),
      countGeneral: $("#countGeneral"),

      // user
      userSummary: $("#userSummary"),
      userRoleBadge: $("#userRoleBadge"),
    });
  }

  function bindEvents() {

    els.btnGoRegister.addEventListener("click", () => {
      // 별도 등록 페이지로 이동
      window.location.href = "./general-register.html";
    });

    els.btnOpenLogin.addEventListener("click", openLoginModal);
    els.btnCloseLogin.addEventListener("click", closeLoginModal);
    els.loginModal.addEventListener("click", (e) => {
      const close = e.target && e.target.dataset && e.target.dataset.close === "true";
      if (close) closeLoginModal();
    });

    els.loginForm.addEventListener("submit", onSubmitLogin);

    els.btnLogout.addEventListener("click", logout);
    els.btnRefresh.addEventListener("click", loadProperties);

    els.sourceTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      state.sourceTab = btn.dataset.source;
      [...els.sourceTabs.querySelectorAll(".tab")].forEach((t) => t.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderList();
    });

    els.searchKeyword.addEventListener("input", debounce((e) => {
      state.keyword = (e.target.value || "").trim();
      renderList();
    }, 120));

    els.filterStatus.addEventListener("change", (e) => {
      state.status = e.target.value || "";
      renderList();
    });
  }

  function openLoginModal() {
    els.loginModal.classList.remove("hidden");
    els.loginModal.setAttribute("aria-hidden", "false");
  }

  function closeLoginModal() {
    els.loginModal.classList.add("hidden");
    els.loginModal.setAttribute("aria-hidden", "true");
    els.loginForm.reset();
  }

  async function onSubmitLogin(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const password = String(fd.get("password") || "");

    if (!name || !password) return notify("이름/비밀번호를 입력해 주세요.");

    try {
      setFormBusy(els.loginForm, true);
      const res = await api("/auth/login", {
        method: "POST",
        body: { name, password },
      });

      if (!res || !res.token || !res.user) {
        throw new Error("로그인 응답 형식이 올바르지 않습니다.");
      }

      state.session = {
        token: res.token,
        user: res.user,
      };
      saveSession(state.session);
      renderSessionUI();
      closeLoginModal();
      await loadProperties();
      notify(`${res.user.name}님 로그인되었습니다.`);
    } catch (err) {
      console.error(err);
      notify(err.message || "로그인에 실패했습니다.");
    } finally {
      setFormBusy(els.loginForm, false);
    }
  }

  function logout() {
    state.session = null;
    saveSession(null);
    renderSessionUI();
    loadProperties();
  }

  function renderSessionUI() {
    const session = state.session;
    const isLoggedIn = !!(session && session.user);

    els.btnOpenLogin.classList.toggle("hidden", isLoggedIn);
    els.btnLogout.classList.toggle("hidden", !isLoggedIn);

    if (!isLoggedIn) {
      els.userRoleBadge.textContent = "비로그인";
      els.userRoleBadge.className = "badge badge-muted";
      els.userSummary.innerHTML = `
        <div class="muted">로그인하면 관리자/담당자 권한에 따라 조회 범위가 적용됩니다.</div>
      `;
      return;
    }

    const user = session.user;
    const isAdmin = user.role === "admin";
    els.userRoleBadge.textContent = isAdmin ? "관리자" : "담당자";
    els.userRoleBadge.className = `badge ${isAdmin ? "badge-admin" : "badge-agent"}`;

    const regionText = Array.isArray(user.assignedRegions) && user.assignedRegions.length
      ? user.assignedRegions.join(", ")
      : "미지정";

    els.userSummary.innerHTML = `
      <div class="user-kv">
        <div class="row"><span class="label">이름</span><span class="value">${escapeHtml(user.name || "-")}</span></div>
        <div class="row"><span class="label">권한</span><span class="value">${isAdmin ? "관리자 (전체 조회)" : "물건 담당자 (담당 물건만 조회)"}</span></div>
        <div class="row"><span class="label">담당지역</span><span class="value">${escapeHtml(regionText)}</span></div>
      </div>
    `;
  }

  async function loadProperties() {
    state.loading = true;
    els.listMeta.textContent = "불러오는 중...";
    try {
      const isLoggedIn = !!(state.session && state.session.token);
      const role = state.session?.user?.role || "guest";
      const params = new URLSearchParams();

      // 서버가 역할 기반으로 필터링하도록 전달
      if (role === "agent") params.set("scope", "mine");
      if (role === "admin") params.set("scope", "all");
      if (state.sourceTab !== "all") params.set("source", state.sourceTab);

      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await api(`/properties${query}`, {
        method: "GET",
        auth: isLoggedIn,
      });

      const items = Array.isArray(res?.items) ? res.items : [];
      state.properties = items.map(normalizeProperty);
      updateCounters();
      renderList();
    } catch (err) {
      console.error(err);
      state.properties = [];
      updateCounters();
      renderList();
      els.listMeta.textContent = "불러오기 실패";
      notify(err.message || "물건 목록 조회에 실패했습니다.");
    } finally {
      state.loading = false;
    }
  }

  function normalizeProperty(item) {
    return {
      id: item.id ?? "",
      source: item.source ?? "general", // auction | gongmae | general
      address: item.address ?? "",
      salePrice: Number(item.salePrice || 0),
      status: item.status || "review", // active / hold / closed / review
      assignedAgentId: item.assignedAgentId || null,
      assignedAgentName: item.assignedAgentName || "",
      regionGu: item.regionGu || "",
      regionDong: item.regionDong || "",
      createdAt: item.createdAt || "",
      memo: item.memo || "",
      duplicateFlag: !!item.duplicateFlag,
      registrantName: item.registrantName || "",
      phone: item.phone || "",
    };
  }

  function getRoleFilteredProperties() {
    const user = state.session?.user;
    const isAdmin = user?.role === "admin";
    const isAgent = user?.role === "agent";

    // 서버에서 이미 필터링된다는 전제이나, 프론트에서도 방어적으로 필터링
    if (isAdmin) return state.properties.slice();

    if (isAgent) {
      const assignedRegions = Array.isArray(user.assignedRegions) ? user.assignedRegions : [];
      return state.properties.filter((p) => {
        if (p.assignedAgentId && user.id && p.assignedAgentId === user.id) return true;

        const tags = [p.regionGu, p.regionDong].filter(Boolean);
        return assignedRegions.some((r) => tags.includes(r));
      });
    }

    // 비로그인: 공개 가능한 물건만 (기본은 전체 공개로 두되, 서버 정책에 맞춰 변경 가능)
    return state.properties.slice();
  }

  function getFilteredProperties() {
    let list = getRoleFilteredProperties();

    if (state.sourceTab !== "all") {
      list = list.filter((p) => p.source === state.sourceTab);
    }

    if (state.status) {
      list = list.filter((p) => p.status === state.status);
    }

    if (state.keyword) {
      const q = state.keyword.toLowerCase();
      list = list.filter((p) => {
        const hay = [
          p.address,
          p.assignedAgentName,
          p.regionGu,
          p.regionDong,
          p.registrantName,
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }

    return list.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  function updateCounters() {
    const all = getRoleFilteredProperties();
    const counts = {
      all: all.length,
      auction: all.filter((p) => p.source === "auction").length,
      gongmae: all.filter((p) => p.source === "gongmae").length,
      general: all.filter((p) => p.source === "general").length,
    };

    els.countAll.textContent = `전체 ${counts.all}`;
    els.countAuction.textContent = `경매 ${counts.auction}`;
    els.countGongmae.textContent = `공매 ${counts.gongmae}`;
    els.countGeneral.textContent = `일반 ${counts.general}`;
  }

  function renderList() {
    const list = getFilteredProperties();
    els.propertyList.innerHTML = "";

    if (!list.length) {
      els.emptyState.classList.remove("hidden");
    } else {
      els.emptyState.classList.add("hidden");
    }

    const frag = document.createDocumentFragment();
    list.forEach((p) => frag.appendChild(renderCard(p)));
    els.propertyList.appendChild(frag);

    els.listMeta.textContent = `총 ${list.length}건 표시`;
  }

  function renderCard(p) {
    const card = document.createElement("article");
    card.className = "property-card";

    const sourceLabel = sourceToLabel(p.source);
    const sourceClass =
      p.source === "auction" ? "source-auction" :
      p.source === "gongmae" ? "source-gongmae" : "source-general";

    card.innerHTML = `
      <div class="card-top">
        <span class="card-source ${sourceClass}">${sourceLabel}</span>
        <span class="card-status">${statusToLabel(p.status)}</span>
      </div>

      <div class="card-address">${escapeHtml(p.address || "-")}</div>
      <div class="card-price">${formatMoneyKRW(p.salePrice)}</div>

      <div class="card-sub">
        <div class="meta-row">
          <span>담당자</span>
          <span class="v">${escapeHtml(p.assignedAgentName || "미배정")}</span>
        </div>
        <div class="meta-row">
          <span>지역</span>
          <span class="v">${escapeHtml([p.regionGu, p.regionDong].filter(Boolean).join(" / ") || "-")}</span>
        </div>
        <div class="meta-row">
          <span>등록일</span>
          <span class="v">${formatDate(p.createdAt)}</span>
        </div>
      </div>
    `;

    return card;
  }

  // --- API ---
  async function api(path, options = {}) {
    const method = options.method || "GET";
    const auth = !!options.auth;
    const headers = { "Content-Type": "application/json" };
    if (auth && state.session?.token) {
      headers.Authorization = `Bearer ${state.session.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(options.body || {}),
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      const message = data?.message || `API 오류 (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  // --- Utilities ---
  function sourceToLabel(source) {
    if (source === "auction") return "경매";
    if (source === "gongmae") return "공매";
    return "일반";
  }

  function statusToLabel(status) {
    switch (status) {
      case "active": return "진행중";
      case "hold": return "보류";
      case "closed": return "종결";
      case "review": return "검토중";
      default: return status || "-";
    }
  }

  function formatMoneyKRW(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
    }

  function formatDate(v) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function normalizePhone(v) {
    return v.replace(/[^\d]/g, "");
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function notify(msg) {
    // 초기 버전: 가벼운 alert
    window.alert(msg);
  }

  function setFormBusy(form, busy) {
    [...form.querySelectorAll("button, input, textarea, select")].forEach((el) => {
      el.disabled = !!busy;
    });
  }

  function debounce(fn, wait = 200) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function $(sel) {
    return document.querySelector(sel);
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
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
})();
