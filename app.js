(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";

  const state = {
    source: "all",          // all | auction | gongmae | general
    properties: [],
    session: loadSession(),
    keyword: "",
    status: "",
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    // 로그인 세션 없으면 로그인 페이지로
    if (!state.session?.token || !state.session?.user) {
      redirectToLogin();
      return;
    }

    cacheElements();
    bindEvents();
    bindAutoLogoutOnLeave();

    // initial load
    loadProperties();
  }

  function cacheElements() {
    Object.assign(els, {
      btnLogout: $("#btnLogout"),
      btnFilter: $("#btnFilter"),
      btnFilterClose: $("#btnFilterClose"),
      filterPanel: $("#filterPanel"),

      tabText: $("#tabText"),
      tabMap: $("#tabMap"),
      textView: $("#textView"),
      mapView: $("#mapView"),

      statTotal: $("#statTotal"),
      statAuction: $("#statAuction"),
      statGongmae: $("#statGongmae"),
      statGeneral: $("#statGeneral"),

      statTotalCard: $("#statTotalCard"),
      statAuctionCard: $("#statAuctionCard"),
      statGongmaeCard: $("#statGongmaeCard"),
      statGeneralCard: $("#statGeneralCard"),

      searchKeyword: $("#searchKeyword"),
      filterStatus: $("#filterStatus"),
      btnRefresh: $("#btnRefresh"),

      tableBody: $("#tableBody"),
      emptyState: $("#emptyState"),
    });
  }

  function bindEvents() {
    // logout
    els.btnLogout.addEventListener("click", () => {
      clearSession();
      redirectToLogin(true);
    });

    // view switch
    els.tabText.addEventListener("click", () => setView("text"));
    els.tabMap.addEventListener("click", () => setView("map"));

    // filter panel
    els.btnFilter.addEventListener("click", () => openFilter(true));
    els.btnFilterClose.addEventListener("click", () => openFilter(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") openFilter(false);
    });

    // stats click => source filter
    const bindCard = (el, source) => {
      el.addEventListener("click", () => {
        state.source = source;
        loadProperties();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          state.source = source;
          loadProperties();
        }
      });
    };
    bindCard(els.statTotalCard, "all");
    bindCard(els.statAuctionCard, "auction");
    bindCard(els.statGongmaeCard, "gongmae");
    bindCard(els.statGeneralCard, "general");

    // filters
    els.searchKeyword.addEventListener("input", debounce((e) => {
      state.keyword = (e.target.value || "").trim();
      render();
    }, 120));

    els.filterStatus.addEventListener("change", (e) => {
      state.status = e.target.value || "";
      render();
    });

    els.btnRefresh.addEventListener("click", () => loadProperties());
  }

  function setView(view) {
    const isText = view === "text";
    els.tabText.classList.toggle("is-active", isText);
    els.tabMap.classList.toggle("is-active", !isText);
    els.tabText.setAttribute("aria-selected", isText ? "true" : "false");
    els.tabMap.setAttribute("aria-selected", !isText ? "true" : "false");

    els.textView.classList.toggle("hidden", !isText);
    els.mapView.classList.toggle("hidden", isText);
  }

  function openFilter(open) {
    els.filterPanel.classList.toggle("hidden", !open);
    els.filterPanel.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function bindAutoLogoutOnLeave() {
    // 요구사항: 로그인 이후 페이지를 나가면 자동 로그아웃
    window.addEventListener("pagehide", clearSession);
    window.addEventListener("beforeunload", clearSession);
  }

  async function loadProperties() {
    try {
      const role = state.session?.user?.role || "guest";
      const params = new URLSearchParams();

      if (role === "agent") params.set("scope", "mine");
      if (role === "admin") params.set("scope", "all");

      if (state.source && state.source !== "all") params.set("source", state.source);

      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await api(`/properties${query}`, { method: "GET", auth: true });
      const items = Array.isArray(res?.items) ? res.items : [];
      state.properties = items.map(normalizeProperty);

      updateStats();
      render();
    } catch (err) {
      console.error(err);
      // 인증 문제면 로그인으로
      const msg = String(err?.message || "");
      if (msg.includes("401") || msg.includes("로그인")) {
        clearSession();
        redirectToLogin(true);
        return;
      }
      alert(err.message || "물건 목록 조회에 실패했습니다.");
      state.properties = [];
      updateStats();
      render();
    }
  }

  function normalizeProperty(item) {
    // 서버에 더 많은 컬럼이 있으면 그대로 활용할 수 있도록 방어적으로 매핑
    return {
      id: item.id ?? "",
      source: item.source ?? "general",
      address: item.address ?? "",
      salePrice: num(item.salePrice),
      status: item.status || "review",
      assignedAgentName: item.assignedAgentName || "",
      regionGu: item.regionGu || "",
      regionDong: item.regionDong || "",
      createdAt: item.createdAt || "",
      // optional extended fields
      type: item.type || item.propertyType || "",
      floor: item.floor || item.floorText || "",
      areaPyeong: item.areaPyeong || item.area || "",
      appraisalPrice: num(item.appraisalPrice) || null,
      currentPrice: num(item.currentPrice) || null,
      bidDate: item.bidDate || "",
      regDate: item.regDate || "",
      analysisDone: !!item.analysisDone,
      fieldDone: !!item.fieldDone,
      memo: item.memo || "",
    };
  }

  function updateStats() {
    const all = state.properties;
    els.statTotal.textContent = String(all.length);
    els.statAuction.textContent = String(all.filter(p => p.source === "auction").length);
    els.statGongmae.textContent = String(all.filter(p => p.source === "gongmae").length);
    els.statGeneral.textContent = String(all.filter(p => p.source === "general").length);
  }

  function render() {
    const rows = getFilteredRows();
    els.tableBody.innerHTML = "";

    els.emptyState.classList.toggle("hidden", rows.length > 0);

    const frag = document.createDocumentFragment();
    for (const p of rows) frag.appendChild(renderRow(p));
    els.tableBody.appendChild(frag);
  }

  function getFilteredRows() {
    let list = state.properties.slice();

    if (state.status) list = list.filter(p => p.status === state.status);

    if (state.keyword) {
      const q = state.keyword.toLowerCase();
      list = list.filter(p => {
        const hay = [p.address, p.assignedAgentName, p.regionGu, p.regionDong, p.type].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }

    // createdAt desc
    return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function renderRow(p) {
    const tr = document.createElement("tr");

    const kindClass = p.source === "auction" ? "kind-auction" : p.source === "gongmae" ? "kind-gongmae" : "kind-general";
    const kindLabel = p.source === "auction" ? "경매" : p.source === "gongmae" ? "공매" : "일반";

    const locText = formatLocation(p);

    const mapBtn = document.createElement("button");
    mapBtn.className = "loc-pin";
    mapBtn.type = "button";
    mapBtn.title = "지도에서 보기";
    mapBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 22s7-6.1 7-13a7 7 0 1 0-14 0c0 6.9 7 13 7 13z" fill="currentColor"/>
        <circle cx="12" cy="9" r="2.5" fill="#fff"/>
      </svg>
    `;
    mapBtn.addEventListener("click", () => {
      const q = encodeURIComponent(p.address || locText || "");
      window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank", "noopener");
    });

    const typeWrap = document.createElement("div");
    typeWrap.className = "locline";
    typeWrap.appendChild(mapBtn);
    const typeText = document.createElement("div");
    typeText.textContent = p.type || "-";
    typeWrap.appendChild(typeText);

    const appraisal = p.appraisalPrice ?? (p.salePrice || null);
    const current = p.currentPrice ?? null;

    tr.innerHTML = `
      <td class="${kindClass} kind-chip">${kindLabel}</td>
      <td>${escapeHtml(locText || "-")}</td>
      <td class="col-type-cell"></td>
      <td>${escapeHtml(p.floor || "-")}</td>
      <td>${escapeHtml(p.areaPyeong ? String(p.areaPyeong) : "-")}</td>
      <td>${appraisal ? escapeHtml(formatMoneyKRW(appraisal)) : "-"}</td>
      <td>${current ? escapeHtml(formatMoneyKRW(current)) : "-"}</td>
      <td>${escapeHtml(calcRate(appraisal, current))}</td>
      <td>${escapeHtml(formatShortDate(p.bidDate) || "-")}</td>
      <td>${escapeHtml(formatShortDate(p.regDate || p.createdAt) || "-")}</td>
      <td>${escapeHtml(p.assignedAgentName || "-")}</td>
      <td>${p.analysisDone ? '<span class="check">✓</span>' : '-'}</td>
      <td>${p.fieldDone ? '<span class="check">✓</span>' : '-'}</td>
      <td>${p.memo ? `<a class="op-link" href="#" data-id="${escapeAttr(p.id)}">보기</a>` : '-'}</td>
    `;

    // inject typeWrap into 3rd cell
    tr.querySelector(".col-type-cell").appendChild(typeWrap);

    // memo viewer
    const link = tr.querySelector("a.op-link");
    if (link) {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        alert(p.memo);
      });
    }

    return tr;
  }

  function formatLocation(p) {
    if (p.regionGu || p.regionDong) {
      const left = p.regionGu || "";
      const right = p.regionDong || "";
      const mid = left && right ? " / " : "";
      return `${left}${mid}${right}`.trim();
    }
    return p.address || "";
  }

  function calcRate(appraisal, current) {
    if (!appraisal || !current || !isFinite(appraisal) || !isFinite(current) || appraisal <= 0) return "-";
    const r = (current / appraisal) * 100;
    return `${r.toFixed(2)} %`;
  }

  // --- API (GET preflight 최소화) ---
  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json" };

    const hasBody = !["GET", "HEAD"].includes(method);
    if (hasBody) headers["Content-Type"] = "application/json";

    if (options.auth && state.session?.token) {
      headers.Authorization = `Bearer ${state.session.token}`;
    }

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
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const message = data?.message || `API 오류 (${res.status})`;
      throw new Error(message);
    }

    return data;
  }

  // --- Utilities ---
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoneyKRW(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
  }

  function formatShortDate(v) {
    if (!v) return "";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  function escapeAttr(v) {
    return escapeHtml(v).replaceAll("`", "&#96;");
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

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    state.session = null;
  }

  function redirectToLogin(replace = false) {
    const url = `./login.html?next=${encodeURIComponent("./index.html")}`;
    if (replace) location.replace(url);
    else location.href = url;
  }
})();
