(() => {
  "use strict";

  // ---- Config ----
  const API_BASE = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const GEO_CACHE_KEY = "knson_geo_cache_v1";

  // ---- State ----
  const state = {
    session: loadSession(),
    items: [],
    view: "text", // text | map
    source: "all", // all | auction | gongmae | general
    keyword: "",
    status: "",

    // kakao
    kakaoReady: null,
    map: null,
    geocoder: null,
    markers: [],
    geoCache: loadGeoCache(),
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheEls();

    // 로그인 없으면 즉시 로그인 페이지
    if (!state.session?.token || !state.session?.user) {
      redirectToLogin(true);
      return;
    }

    // admin link: admin만 노출
    const isAdmin = isAdminUser(state.session.user);
    if (els.adminLink) {
      els.adminLink.style.display = isAdmin ? "inline-flex" : "none";
    }

    bindEvents();
    loadProperties();
  }

  function cacheEls() {
    els.btnLogout = document.getElementById("btnLogout");
    els.adminLink = document.querySelector(".admin-link");

    // KPI
    els.statTotal = document.getElementById("statTotal");
    els.statAuction = document.getElementById("statAuction");
    els.statGongmae = document.getElementById("statGongmae");
    els.statGeneral = document.getElementById("statGeneral");

    els.statTotalCard = document.getElementById("statTotalCard");
    els.statAuctionCard = document.getElementById("statAuctionCard");
    els.statGongmaeCard = document.getElementById("statGongmaeCard");
    els.statGeneralCard = document.getElementById("statGeneralCard");

    // Views
    els.tabText = document.getElementById("tabText");
    els.tabMap = document.getElementById("tabMap");
    els.textView = document.getElementById("textView");
    els.mapView = document.getElementById("mapView");

    // Table
    els.tableWrap = document.querySelector(".table-wrap");
    els.tableBody = document.getElementById("tableBody");
    els.emptyState = document.getElementById("emptyState");

    // Filters
    els.btnFilter = document.getElementById("btnFilter");
    els.filterPanel = document.getElementById("filterPanel");
    els.btnFilterClose = document.getElementById("btnFilterClose");
    els.searchKeyword = document.getElementById("searchKeyword");
    els.filterStatus = document.getElementById("filterStatus");
    els.btnRefresh = document.getElementById("btnRefresh");
  }

  function bindEvents() {
    // 방어: DOM 구조가 바뀌어도 에러 안 나게
    if (els.btnLogout) {
      els.btnLogout.addEventListener("click", () => {
        clearSession();
        redirectToLogin(true);
      });
    }

    // KPI 카드 클릭 → 소스 필터
    const bindCard = (el, source) => {
      if (!el) return;
      el.addEventListener("click", () => {
        state.source = source;
        renderKPIs();
        renderTable();
        if (state.view === "map") renderKakaoMarkers();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      });
    };

    bindCard(els.statTotalCard, "all");
    bindCard(els.statAuctionCard, "auction");
    bindCard(els.statGongmaeCard, "gongmae");
    bindCard(els.statGeneralCard, "general");

    // 탭
    if (els.tabText) {
      els.tabText.addEventListener("click", () => setView("text"));
    }
    if (els.tabMap) {
      els.tabMap.addEventListener("click", async () => {
        setView("map");
        await ensureKakaoMap();
        await renderKakaoMarkers();
      });
    }

    // 필터 패널
    if (els.btnFilter && els.filterPanel) {
      els.btnFilter.addEventListener("click", () => openFilter());
    }
    if (els.btnFilterClose && els.filterPanel) {
      els.btnFilterClose.addEventListener("click", () => closeFilter());
    }

    if (els.searchKeyword) {
      els.searchKeyword.addEventListener(
        "input",
        debounce((e) => {
          state.keyword = String(e.target.value || "").trim();
          renderKPIs();
          renderTable();
        }, 120)
      );
    }

    if (els.filterStatus) {
      els.filterStatus.addEventListener("change", (e) => {
        state.status = String(e.target.value || "");
        renderKPIs();
        renderTable();
      });
    }

    if (els.btnRefresh) {
      els.btnRefresh.addEventListener("click", () => loadProperties());
    }

    // map view에서 창 크기 바뀌면 리레이아웃
    window.addEventListener(
      "resize",
      debounce(() => {
        if (state.view === "map" && state.map && window.kakao?.maps) {
          state.map.relayout();
        }
      }, 150)
    );
  }

  function setView(view) {
    state.view = view;
    if (els.tabText) {
      els.tabText.classList.toggle("is-active", view === "text");
      els.tabText.setAttribute("aria-selected", view === "text" ? "true" : "false");
    }
    if (els.tabMap) {
      els.tabMap.classList.toggle("is-active", view === "map");
      els.tabMap.setAttribute("aria-selected", view === "map" ? "true" : "false");
    }

    if (els.textView) els.textView.classList.toggle("hidden", view !== "text");
    if (els.mapView) els.mapView.classList.toggle("hidden", view !== "map");
  }

  function openFilter() {
    if (!els.filterPanel) return;
    els.filterPanel.classList.remove("hidden");
    els.filterPanel.setAttribute("aria-hidden", "false");
    if (els.searchKeyword) els.searchKeyword.focus();
  }

  function closeFilter() {
    if (!els.filterPanel) return;
    els.filterPanel.classList.add("hidden");
    els.filterPanel.setAttribute("aria-hidden", "true");
  }

  // ---- Data ----
  async function loadProperties() {
    try {
      const role = state.session?.user?.role;
      const scope = isAdminUser(state.session.user) ? "all" : "mine";
      const res = await api(`/properties?scope=${encodeURIComponent(scope)}`, { auth: true });
      state.items = Array.isArray(res?.items) ? res.items.map(normalizeItem) : [];

      renderKPIs();
      renderTable();

      if (state.view === "map") {
        await ensureKakaoMap();
        await renderKakaoMarkers();
      }

      // 필터 패널 닫기(선택)
      closeFilter();
    } catch (err) {
      console.error(err);
      state.items = [];
      renderKPIs();
      renderTable();
      // 네트워크 오류는 alert로 충분
      alert(err?.message || "목록을 불러오지 못했습니다.");
    }
  }

  function normalizeItem(p) {
    const source = p.source || p.category || "general"; // auction | gongmae | general
    const address = p.address || p.location || "";

    return {
      id: p.id || "",
      source,
      address,
      // 테이블
      type: p.type || p.propertyType || p.kind || "-",
      floor: p.floor || p.floorText || "-",
      areaPyeong: toAreaPy(p.areaPyeong ?? p.areaPy ?? p.area ?? p.area_m2),
      appraisalPrice: toNumber(p.appraisalPrice ?? p.appraisal_price ?? p.salePrice ?? p.sale_price),
      currentPrice: toNumber(p.currentPrice ?? p.current_price),
      bidDate: p.bidDate || p.bid_date || "-",
      createdAt: p.createdAt || p.created_at || "",
      assignedAgentName: p.assignedAgentName || p.agentName || p.manager || "-",
      analysisDone: !!(p.analysisDone ?? p.analysis_done),
      fieldDone: !!(p.siteVisit ?? p.site_visit ?? p.fieldDone ?? p.field_done),
      memo: p.memo || p.comment || "",
      status: p.status || "", // optional
      regionGu: p.regionGu || "",
      regionDong: p.regionDong || "",
    };
  }

  // ---- Render ----
  function getFilteredRows() {
    let list = state.items.slice();

    if (state.source !== "all") {
      list = list.filter((p) => p.source === state.source);
    }

    if (state.status) {
      list = list.filter((p) => String(p.status || "") === state.status);
    }

    if (state.keyword) {
      const q = state.keyword.toLowerCase();
      list = list.filter((p) => {
        const hay = [p.address, p.assignedAgentName, p.regionGu, p.regionDong, p.type]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    // 최신등록 우선
    return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function renderKPIs() {
    // KPI는 전체(필터 전) 기준으로 유지
    const all = state.items;

    if (els.statTotal) els.statTotal.textContent = String(all.length);
    if (els.statAuction) els.statAuction.textContent = String(all.filter((p) => p.source === "auction").length);
    if (els.statGongmae) els.statGongmae.textContent = String(all.filter((p) => p.source === "gongmae").length);
    if (els.statGeneral) els.statGeneral.textContent = String(all.filter((p) => p.source === "general").length);

    // 선택 상태 시각화
    const setActive = (card, on) => {
      if (!card) return;
      card.classList.toggle("is-selected", on);
    };

    setActive(els.statTotalCard, state.source === "all");
    setActive(els.statAuctionCard, state.source === "auction");
    setActive(els.statGongmaeCard, state.source === "gongmae");
    setActive(els.statGeneralCard, state.source === "general");
  }

  function renderTable() {
    if (!els.tableBody) return;

    const rows = getFilteredRows();
    els.tableBody.innerHTML = "";

    if (!rows.length) {
      // 요구사항: 빈 데이터 의미없이 보여주지 않기
      if (els.tableWrap) els.tableWrap.classList.add("hidden");
      if (els.emptyState) {
        els.emptyState.classList.remove("hidden");
        els.emptyState.textContent = "등록된 물건이 없습니다.";
      }
      return;
    }

    if (els.tableWrap) els.tableWrap.classList.remove("hidden");
    if (els.emptyState) els.emptyState.classList.add("hidden");

    const frag = document.createDocumentFragment();
    for (const p of rows) frag.appendChild(renderRow(p));
    els.tableBody.appendChild(frag);
  }

  function renderRow(p) {
    const tr = document.createElement("tr");

    const kindClass = p.source === "auction" ? "kind-auction" : p.source === "gongmae" ? "kind-gongmae" : "kind-general";
    const kindLabel = p.source === "auction" ? "경매" : p.source === "gongmae" ? "공매" : "일반";

    const locText = formatLocation(p);
    const appraisal = p.appraisalPrice ? formatMoneyEok(p.appraisalPrice) : "-";
    const current = p.currentPrice ? formatMoneyEok(p.currentPrice) : "-";
    const rate = calcRate(p.appraisalPrice, p.currentPrice);

    tr.innerHTML = `
      <td class="kind-chip ${kindClass}">${escapeHtml(kindLabel)}</td>
      <td>${escapeHtml(locText || "-")}</td>
      <td>${escapeHtml(p.type || "-")}</td>
      <td>${escapeHtml(String(p.floor || "-"))}</td>
      <td>${p.areaPyeong ? escapeHtml(String(p.areaPyeong)) : "-"}</td>
      <td>${escapeHtml(appraisal)}</td>
      <td>${escapeHtml(current)}</td>
      <td>${escapeHtml(rate)}</td>
      <td>${escapeHtml(formatShortDate(p.bidDate) || "-")}</td>
      <td>${escapeHtml(formatShortDate(p.createdAt) || "-")}</td>
      <td>${escapeHtml(p.assignedAgentName || "-")}</td>
      <td>${p.analysisDone ? '<span class="check">✓</span>' : "-"}</td>
      <td>${p.fieldDone ? '<span class="check">✓</span>' : "-"}</td>
      <td>${p.memo ? `<button class="btn-view" type="button">보기</button>` : "-"}</td>
    `;

    const btn = tr.querySelector(".btn-view");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        alert(p.memo);
      });
    }

    return tr;
  }

  function formatLocation(p) {
    // 화면 샘플처럼: 구/동 있으면 "서울 / 미아동" 형태를 우선
    if (p.regionGu || p.regionDong) {
      const left = p.regionGu || "";
      const right = p.regionDong || "";
      const mid = left && right ? " / " : "";
      return `${left}${mid}${right}`.trim();
    }
    return p.address || "";
  }

  function calcRate(appraisal, current) {
    const a = Number(appraisal || 0);
    const c = Number(current || 0);
    if (!Number.isFinite(a) || !Number.isFinite(c) || a <= 0 || c <= 0) return "-";
    return `${((c / a) * 100).toFixed(2)} %`;
  }

  // ---- Kakao Map ----
  function ensureMapDom() {
    if (!els.mapView) return { mapEl: null, hintEl: null };

    let mapEl = document.getElementById("kakaoMap");
    let hintEl = document.getElementById("mapHint");

    // 기존 placeholder 제거하고 실제 컨테이너 삽입
    if (!mapEl) {
      els.mapView.innerHTML = `
        <div class="map-wrap">
          <div id="mapHint" class="map-hint hidden"></div>
          <div id="kakaoMap" class="kakao-map"></div>
        </div>
      `;
      mapEl = document.getElementById("kakaoMap");
      hintEl = document.getElementById("mapHint");
    }

    return { mapEl, hintEl };
  }

  async function ensureKakaoMap() {
    const { mapEl, hintEl } = ensureMapDom();
    if (!mapEl) return;

    const key = getKakaoKey();
    if (!key) {
      if (hintEl) {
        hintEl.classList.remove("hidden");
        hintEl.textContent = "카카오 JavaScript 키가 필요합니다. index.html의 <meta name=\"kakao-app-key\">에 키를 넣어주세요.";
      }
      return;
    }

    if (!state.kakaoReady) {
      state.kakaoReady = loadKakaoSdk(key);
    }

    await state.kakaoReady;

    // 이미 생성돼 있으면 종료
    if (state.map && state.geocoder) return;

    const center = new kakao.maps.LatLng(37.5665, 126.9780); // Seoul
    state.map = new kakao.maps.Map(mapEl, {
      center,
      level: 6,
    });

    state.geocoder = new kakao.maps.services.Geocoder();
  }

  async function renderKakaoMarkers() {
    if (state.view !== "map") return;
    if (!state.map || !state.geocoder || !window.kakao?.maps) return;

    // clear markers
    for (const m of state.markers) m.setMap(null);
    state.markers = [];

    const rows = getFilteredRows();
    const valid = rows.filter((r) => (r.address || "").trim().length > 0);
    if (!valid.length) return;

    let firstPos = null;

    for (const it of valid.slice(0, 200)) {
      const pos = await geocodeCached(it.address);
      if (!pos) continue;

      if (!firstPos) firstPos = pos;

      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(pos.lat, pos.lng),
        map: state.map,
      });

      state.markers.push(marker);
    }

    if (firstPos) {
      state.map.setCenter(new kakao.maps.LatLng(firstPos.lat, firstPos.lng));
    }
  }

  function getKakaoKey() {
    const meta = document.querySelector('meta[name="kakao-app-key"]');
    const key = meta?.getAttribute("content")?.trim();
    return key || "";
  }

  function loadKakaoSdk(appKey) {
    return new Promise((resolve, reject) => {
      // 이미 로드됨
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve());
        return;
      }

      const s = document.createElement("script");
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
      s.async = true;
      s.onload = () => {
        if (!window.kakao?.maps?.load) {
          reject(new Error("Kakao SDK 로드 실패"));
          return;
        }
        window.kakao.maps.load(() => resolve());
      };
      s.onerror = () => reject(new Error("Kakao SDK 네트워크 오류"));
      document.head.appendChild(s);
    });
  }

  async function geocodeCached(address) {
    const a = String(address || "").trim();
    if (!a) return null;

    const key = normalizeAddressKey(a);
    const cached = state.geoCache[key];
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
      return cached;
    }

    const pos = await geocodeAddress(a);
    if (pos) {
      state.geoCache[key] = pos;
      saveGeoCache(state.geoCache);
    }
    return pos;
  }

  function geocodeAddress(address) {
    return new Promise((resolve) => {
      if (!state.geocoder) return resolve(null);
      state.geocoder.addressSearch(address, (result, status) => {
        if (status !== kakao.maps.services.Status.OK) return resolve(null);
        const r = result?.[0];
        if (!r) return resolve(null);
        resolve({ lat: Number(r.y), lng: Number(r.x) });
      });
    });
  }

  function normalizeAddressKey(v) {
    return String(v || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[(),]/g, "")
      .trim();
  }

  // ---- API (GET preflight 최소화) ----
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

  // ---- Utils ----
  function isAdminUser(user) {
    const r = String(user?.role || "").toLowerCase();
    return r === "admin" || r === "관리자";
  }

  function toNumber(v) {
    const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function toAreaPy(v) {
    if (v == null || v === "") return "";
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return "";

    // m2면 평으로 변환(대략)
    if (n > 200) {
      const py = n / 3.3058;
      return Math.round(py);
    }

    return Math.round(n);
  }

  function formatMoneyEok(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num) || num <= 0) return "-";
    // 단순: 1억=100,000,000
    const eok = num / 100000000;
    const fixed = eok >= 10 ? eok.toFixed(2) : eok.toFixed(2);
    return `${fixed.replace(/\.00$/, "")} 억원`;
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

  function debounce(fn, wait = 200) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
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
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    state.session = null;
  }

  function redirectToLogin(replace = false) {
    const url = `./login.html?next=${encodeURIComponent("./index.html")}`;
    if (replace) location.replace(url);
    else location.href = url;
  }

  function loadGeoCache() {
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveGeoCache(cache) {
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache || {}));
    } catch {}
  }
})();
