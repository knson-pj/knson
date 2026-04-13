(() => {
  "use strict";

  // ---- Config ----
  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function") ? window.KNSN.getApiBase() : "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const GEO_CACHE_KEY = "knson_geo_cache_v1";

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
  const SOURCE_COLORS = {
    auction: { label: "경매", short: "경", solid: "#D778F7", bg: "#F7E5FF", border: "#E4B7FF" },
    onbid: { label: "공매", short: "$", solid: "#59A7FF", bg: "#E7F2FF", border: "#BFD9FF" },
    realtor_naver: { label: "네이버중개", short: "N", solid: "#17C964", bg: "#E7F8EE", border: "#B8E8CB" },
    realtor_direct: { label: "일반중개", short: "중", solid: "#D4A72C", bg: "#FFF4D6", border: "#E7CF87" },
    realtor: { label: "중개", short: "중", solid: "#0FA68B", bg: "#E3F8F4", border: "#AEE6DA" },
    general: { label: "일반", short: "일", solid: "#F6B04A", bg: "#FFF1DD", border: "#F7D39E" },
  };

  function toUserErrorMessage(err, fallback = "요청 처리 중 오류가 발생했습니다.") {
    const raw = String(err?.message || err || "").trim();
    if (!raw) return fallback;
    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(raw)) {
      return "네트워크 연결 또는 서버 응답에 실패했습니다.";
    }
    if (/not allowed|forbidden|permission/i.test(raw)) {
      return "권한이 없어 요청을 처리할 수 없습니다.";
    }
    if (/schema cache|column .* does not exist|does not exist/i.test(raw)) {
      return "서버 스키마 반영이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
    }
    return raw;
  }

  // ---- State ----
  const state = {
    session: loadSession(),
    items: [],
    view: "map", // map (default) | text (removed)
    source: "all", // all | auction | onbid | realtor | realtor_naver | realtor_direct | general
    keyword: "",
    status: "",

    // kakao
    kakaoReady: null,
    map: null,
    geocoder: null,
    markers: [],
    geoCache: loadGeoCache(),
    staffAssignments: [],
    mapSummary: null,
    mapMarkers: [],
    useServerMap: false,
    mapDetailCache: new Map(),
    mapRequestToken: 0,
    lastMapQueryKey: "",
    mapQueryCache: new Map(),
    page: 1,
    pageSize: 30,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);
  const sharedApi = (Shared && typeof Shared.createApiClient === "function")
    ? Shared.createApiClient({
        baseUrl: API_BASE,
        loadSession,
        getAuthToken: async (options = {}) => options.auth ? String(state.session?.token || loadSession()?.token || "").trim() : "",
        networkErrorFactory: () => new Error("서버 연결에 실패했습니다. (네트워크/CORS 확인)"),
      })
    : null;

  async function init() {
    // Keep session when moving to admin page (prevents pagehide auto-logout)
    try {
      const adminLink = document.querySelector(".admin-link");
      if (adminLink) {
        adminLink.addEventListener("click", () => {
          if (K && typeof K.setKeepSessionOnce === "function") K.setKeepSessionOnce();
          else {
            try { sessionStorage.setItem("knson_nav_keep_session","1"); setTimeout(()=>{try{sessionStorage.removeItem("knson_nav_keep_session")}catch{}},15000); } catch {}
          }
        }, { capture: true });
      }
    } catch {}

    cacheEls();
    setupChrome();

    // Supabase 사용 시, 저장된 세션/role을 먼저 동기화해서
    // (로그아웃 루프/관리자 링크 숨김 등) 상태 불일치를 줄입니다.
    if (K && typeof K.supabaseEnabled === "function" && K.supabaseEnabled() && K.initSupabase()) {
      try { await K.sbSyncLocalSession(); } catch {}
      try { state.session = loadSession(); } catch {}
    }


    // 로그인 없으면 즉시 로그인 페이지
    if (!state.session?.token || !state.session?.user) {
      redirectToLogin(true);
      return;
    }

    // admin link: 관리자/담당자 모두 접근 가능(권한에 따라 admin 페이지에서 탭이 달라짐)
    if (els.adminLink) {
      els.adminLink.style.display = "inline-flex";
      els.adminLink.classList.add("is-visible");
    }

    // 지도뷰 기본 활성화
    document.body.classList.add("is-map-view");

    bindEvents();
    loadProperties();
  }

  function cacheEls() {
    els.btnLogout = document.getElementById("btnLogout");
    els.adminLink = document.querySelector(".admin-link");

    // Views (stat view removed — map is the only view)
    els.mapView = document.getElementById("mapView");

    // Map view
    els.mvPropertyList = document.getElementById("mvPropertyList");
    els.mvSummary = document.getElementById("mvSummary");
    els.mvKeyword = document.getElementById("mvKeyword");
    els.mvSourceFilter = document.getElementById("mvSourceFilter");
    els.mvStatusFilter = document.getElementById("mvStatusFilter");
    els.mvDetail = document.getElementById("mvDetail");
    els.mvDetailClose = document.getElementById("mvDetailClose");
    els.mvDetailGrade = document.getElementById("mvDetailGrade");
    els.mvDetailBody = document.getElementById("mvDetailBody");
    els.mvZoomIn = document.getElementById("mvZoomIn");
    els.mvZoomOut = document.getElementById("mvZoomOut");
  }

  function setupChrome() {
    if (K && typeof K.initTheme === "function") {
      const topRight = document.querySelector(".topbar-right");
      K.initTheme({ container: topRight, className: "theme-toggle" });
    }

    const right = document.querySelector(".topbar-right");
    if (right && !right.querySelector(".user-chip")) {
      const chip = document.createElement("span");
      chip.className = "user-chip";
      const user = state.session?.user;
      chip.textContent = user?.name ? `${user.name}${user.role ? ` · ${user.role === "admin" ? "관리자" : "담당자"}` : ""}` : "로그인";
      right.prepend(chip);
    }
  }


  function bindEvents() {
    // 방어: DOM 구조가 바뀌어도 에러 안 나게
    if (els.btnLogout) {
      els.btnLogout.addEventListener("click", async () => {
        await logoutNow({ redirect: true });
      });
    }

    const themeBtn = document.querySelector("[data-theme-toggle]");
    if (themeBtn && K && typeof K.mountThemeToggle === "function") {
      K.mountThemeToggle(document.querySelector(".topbar-right"), { className: "theme-toggle" });
    }

    // 관리자페이지로 이동할 때는 '페이지 떠나면 자동 로그아웃' 규칙에서 예외 처리
    if (els.adminLink) {
      els.adminLink.addEventListener("click", () => {
        try { sessionStorage.setItem("knson_nav_keep_session", "1"); } catch {}
      });
    }

    // Map sidebar filters
    if (els.mvKeyword) {
      els.mvKeyword.addEventListener("input", debounce(async (e) => {
        state.keyword = String(e.target.value || "").trim();
        await refreshMapDataMaybe();
      }, 200));
    }
    if (els.mvSourceFilter) {
      els.mvSourceFilter.addEventListener("change", async (e) => {
        state.source = String(e.target.value || "") || "all";
        await refreshMapDataMaybe();
      });
    }
    if (els.mvStatusFilter) {
      els.mvStatusFilter.addEventListener("change", async (e) => {
        state.status = String(e.target.value || "");
        await refreshMapDataMaybe();
      });
    }
    if (els.mvSummary) {
      els.mvSummary.addEventListener("click", async (e) => {
        const trigger = e.target.closest(".mv-summary-link[data-source]");
        if (!trigger) return;
        const nextSource = String(trigger.dataset.source || "all").trim() || "all";
        state.source = nextSource;
        if (els.mvSourceFilter) els.mvSourceFilter.value = nextSource === "all" ? "" : nextSource;
        await refreshMapDataMaybe();
      });
    }

    // Map zoom
    if (els.mvZoomIn) els.mvZoomIn.addEventListener("click", () => { if (state.map) state.map.setLevel(state.map.getLevel() - 1); });
    if (els.mvZoomOut) els.mvZoomOut.addEventListener("click", () => { if (state.map) state.map.setLevel(state.map.getLevel() + 1); });

    // Map detail close
    if (els.mvDetailClose) els.mvDetailClose.addEventListener("click", closeMapDetail);

    // map view에서 창 크기 바뀌면 리레이아웃
    window.addEventListener(
      "resize",
      debounce(() => {
        if (state.map && window.kakao?.maps) {
          state.map.relayout();
        }
      }, 150)
    );
  }

  function setView(view) {
    state.view = "map"; // always map — stat view removed
    document.body.classList.add("is-map-view");

    if (els.mapView) {
      els.mapView.classList.remove("hidden");
      els.mapView.classList.add("is-active");
    }

    // Sync sidebar filters with main state
    if (els.mvKeyword) els.mvKeyword.value = state.keyword || "";
    if (els.mvSourceFilter) els.mvSourceFilter.value = state.source === "all" ? "" : (state.source || "");
    if (els.mvStatusFilter) els.mvStatusFilter.value = state.status || "";
    renderMapSidebar();
    if (shouldUseServerMap()) {
      Promise.resolve().then(async () => {
        try {
          await ensureKakaoMap();
          await refreshMapDataMaybe();
        } catch {}
      });
    }
  }

  // ---- Data ----

  function shouldUseServerMap() {
    return !!state.useServerMap;
  }

  async function refreshMapDataMaybe() {
    if (shouldUseServerMap()) {
      await loadAdminMapData();
      renderMapSidebar();
      await renderKakaoMarkers();
      return;
    }
    renderMapSidebar();
    await renderKakaoMarkers();
  }

  async function loadAdminMapData() {
    if (!state.map || !window.kakao?.maps) return;
    const bounds = state.map.getBounds();
    if (!bounds) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const params = {
      mode: 'map',
      offset: String(Math.max(0, (state.page - 1) * state.pageSize)),
      limit: String(Math.max(120, state.pageSize * 6)),
      markerLimit: '600',
      swLat: String(sw.getLat()),
      swLng: String(sw.getLng()),
      neLat: String(ne.getLat()),
      neLng: String(ne.getLng()),
    };
    if (state.status) params.status = state.status;
    if (state.keyword) params.q = state.keyword;
    if (state.source && state.source !== 'all') params.source = state.source;

    const queryKey = new URLSearchParams(params).toString();
    const applyMapPayload = (res) => {
      const items = Array.isArray(res?.items) ? res.items : [];
      const markers = Array.isArray(res?.markers) ? res.markers : [];
      const summary = res?.summary && typeof res.summary === 'object' ? res.summary : null;
      state.items = items.map((item) => {
        const row = item && typeof item === 'object' ? item : {};
        return {
          ...row,
          sourceBucket: String(row.sourceBucket || row.source || 'general').trim() || 'general',
        };
      });
      state.mapMarkers = markers.map((item) => ({
        ...item,
        sourceBucket: String(item?.sourceBucket || item?.source || 'general').trim() || 'general',
      }));
      state.mapSummary = summary;
    };

    if (state.lastMapQueryKey === queryKey && state.mapQueryCache.has(queryKey)) {
      applyMapPayload(state.mapQueryCache.get(queryKey));
      return;
    }

    const requestToken = ++state.mapRequestToken;
    const res = await DataAccess.fetchAdminMapDataViaApi(api, params, { auth: true });
    if (requestToken !== state.mapRequestToken) return;
    state.lastMapQueryKey = queryKey;
    state.mapQueryCache.set(queryKey, res || {});
    if (state.mapQueryCache.size > 12) {
      const firstKey = state.mapQueryCache.keys().next().value;
      if (firstKey) state.mapQueryCache.delete(firstKey);
    }
    applyMapPayload(res || {});
  }

  function rowAssignedToUid(row, uid) {
    const target = String(uid || '').trim();
    if (!target) return false;
    const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
    return [row?.assignee_id, row?.assigneeId, row?.assignedAgentId, raw.assignee_id, raw.assigneeId, raw.assignedAgentId]
      .some((v) => String(v || '').trim() === target);
  }

  async function fetchPropertiesBatch(sb, from, pageSize, { isAdmin, uid }) {
    if (DataAccess && typeof DataAccess.fetchPropertiesBatch === "function") {
      return DataAccess.fetchPropertiesBatch(sb, from, pageSize, { isAdmin, uid, orderColumn: "date_uploaded", ascending: false, clientSideFilter: true });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchPropertiesBatch 를 찾을 수 없습니다.");
  }

  async function fetchAllPropertiesPaged(sb, { isAdmin, uid }) {
    if (DataAccess && typeof DataAccess.fetchAllProperties === "function") {
      return DataAccess.fetchAllProperties(sb, { isAdmin, uid, pageSize: 1000 });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchAllProperties 를 찾을 수 없습니다.");
  }

  async function loadProperties() {
    try {
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      let isAdmin = isAdminUser(state.session?.user);
      let staffPromise = Promise.resolve([]);
      state.useServerMap = false;
      state.mapSummary = null;
      state.mapMarkers = [];

      if (sb) {
        try { await K.sbSyncLocalSession(); } catch {}
        try { state.session = loadSession(); } catch {}
        const uid = state.session?.user?.id;
        isAdmin = isAdminUser(state.session?.user);
        if (isAdmin) staffPromise = loadStaffAssignments();

        if (isAdmin) {
          state.useServerMap = true;
          await ensureKakaoMap();
          await loadAdminMapData();
        } else {
          const data = await fetchPropertiesBatch(sb, 0, 300, { isAdmin, uid });
          state.items = Array.isArray(data) ? data.map(normalizeItem) : [];
        }
      } else {
        isAdmin = isAdminUser(state.session?.user);
        if (isAdmin) {
          staffPromise = loadStaffAssignments();
          state.useServerMap = true;
          await ensureKakaoMap();
          await loadAdminMapData();
        } else {
          const scope = isAdmin ? "all" : "mine";
          const res = await DataAccess.fetchScopedPropertiesViaApi(api, { scope, auth: true });
          state.items = Array.isArray(res?.items) ? res.items.map(normalizeItem) : [];
        }
      }

      try { state.staffAssignments = await staffPromise; } catch { state.staffAssignments = []; }

      // 지도 렌더링 (stat 차트 렌더링 제거됨)
      await ensureKakaoMap();
      await renderKakaoMarkers();
    } catch (err) {
      console.error(err);
      state.items = [];
      state.mapSummary = null;
      state.mapMarkers = [];
      alert(toUserErrorMessage(err, "목록을 불러오지 못했습니다."));
    }
  }

  function normalizeItem(p) {
    const base = (PropertyDomain && typeof PropertyDomain.buildNormalizedPropertyBase === "function")
      ? PropertyDomain.buildNormalizedPropertyBase(p)
      : null;
    if (!base) return p;

    const sourceContext = {
      ...p,
      raw: p && p.raw && typeof p.raw === "object" ? p.raw : base.raw,
      globalId: (p && (p.globalId || p.global_id)) || base.globalId,
      global_id: (p && (p.global_id || p.globalId)) || base.globalId,
      sourceType: p && (p.sourceType || p.source_type || p.source || p.category || p.rawSource || p.raw_source),
      source_type: p && (p.source_type || p.sourceType || p.source || p.category || p.rawSource || p.raw_source),
      sourceUrl: (p && (p.sourceUrl || p.source_url)) || base.sourceUrl,
      source_url: (p && (p.source_url || p.sourceUrl)) || base.sourceUrl,
      submitterType: (p && (p.submitterType || p.submitter_type)) || base.submitterType,
      submitter_type: (p && (p.submitter_type || p.submitterType)) || base.submitterType,
      brokerOfficeName: (p && (p.brokerOfficeName || p.broker_office_name)) || base.brokerOfficeName,
      broker_office_name: (p && (p.broker_office_name || p.brokerOfficeName)) || base.brokerOfficeName,
      isGeneral: (p && (p.isGeneral ?? p.is_general)) ?? base.isGeneral,
      is_general: (p && (p.is_general ?? p.isGeneral)) ?? base.isGeneral,
      isDirectSubmission: base.isDirectSubmission,
      is_direct_submission: base.isDirectSubmission,
    };

    return {
      id: base.id || "",
      itemNo: base.itemNo,
      source: base.sourceType,
      status: base.status,
      address: base.address,
      type: base.assetType,
      floor: base.floor,
      totalFloor: base.totalfloor,
      useapproval: base.useapproval,
      exclusivearea: base.exclusivearea,
      commonarea: base.commonarea,
      appraisalPrice: base.priceMain,
      currentPrice: base.lowprice,
      bidDate: base.dateMain,
      createdAt: base.createdAt,
      assignedAgentId: base.assignedAgentId,
      assignedAgentName: base.assignedAgentName || "-",
      rightsAnalysis: base.rightsAnalysis,
      siteInspection: base.siteInspection,
      opinion: base.opinion,
      statusLabel: statusLabel(base.status),
      regionGu: base.regionGu,
      regionDong: base.regionDong,
      latitude: base.latitude,
      longitude: base.longitude,
      isDirectSubmission: base.isDirectSubmission,
      result_status: p?.result_status || null,
      result_price: p?.result_price || null,
      result_date: p?.result_date || null,
      sourceBucket: (PropertyDomain && typeof PropertyDomain.getSourceBucket === "function") ? PropertyDomain.getSourceBucket(sourceContext) : base.sourceType,
      raw: base.raw,
      valuation: null, // 가격평가 결과 (lazy load)
    };
  }

  function matchesSourceFilter(item) {
    if (PropertyDomain && typeof PropertyDomain.matchesSourceSelection === "function") {
      return PropertyDomain.matchesSourceSelection(item, state.source);
    }
    const bucket = String(item?.sourceBucket || item?.source || "general").trim() || "general";
    if (state.source === "all") return true;
    if (state.source === "realtor") return bucket === "realtor_naver" || bucket === "realtor_direct";
    return bucket === state.source;
  }

  function matchesStatusFilter(item) {
    if (!state.status) return true;
    return String(item?.status || "") === state.status;
  }

  function matchesKeywordFilter(item) {
    if (PropertyDomain && typeof PropertyDomain.matchesKeyword === "function") {
      return PropertyDomain.matchesKeyword(item, state.keyword, {
        fields: ["address", "assignedAgentName", "regionGu", "regionDong", "type", "rightsAnalysis", "siteInspection", "opinion"],
      });
    }
    if (!state.keyword) return true;
    const q = state.keyword.toLowerCase();
    const hay = [item?.address, item?.assignedAgentName, item?.regionGu, item?.regionDong, item?.type, item?.rightsAnalysis, item?.siteInspection, item?.opinion]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function getFilteredRows() {
    const list = state.items.slice();
    const filtered = (PropertyDomain && typeof PropertyDomain.applyPropertyFilters === 'function')
      ? PropertyDomain.applyPropertyFilters(list, { activeCard: state.source, status: state.status, keyword: state.keyword }, {
          keywordFields: ["address", "assignedAgentName", "regionGu", "regionDong", "type", "rightsAnalysis", "siteInspection", "opinion"],
        })
      : list.filter((p) => matchesSourceFilter(p) && matchesStatusFilter(p) && matchesKeywordFilter(p));
    return filtered.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function getFilteredMapMarkers() {
    const list = Array.isArray(state.mapMarkers) ? state.mapMarkers.slice() : [];
    return (PropertyDomain && typeof PropertyDomain.applyPropertyFilters === 'function')
      ? PropertyDomain.applyPropertyFilters(list, { activeCard: state.source, status: state.status, keyword: state.keyword }, {
          keywordFields: ["address", "assignedAgentName", "regionGu", "regionDong", "type", "rightsAnalysis", "siteInspection", "opinion"],
        })
      : list.filter((p) => matchesSourceFilter(p) && matchesStatusFilter(p) && matchesKeywordFilter(p));
  }

  function renderKPIs() {
    const summary = shouldUseServerMap() && state.mapSummary ? state.mapSummary : null;
    const all = state.items;

    const localSummary = (!summary && PropertyDomain && typeof PropertyDomain.summarizeSourceBuckets === "function")
      ? PropertyDomain.summarizeSourceBuckets(all)
      : null;
    const totalCount = summary ? Number(summary.total || 0) : Number(localSummary?.total || all.length || 0);
    const auctionCount = summary ? Number(summary.auction || 0) : Number(localSummary?.auction || 0);
    const onbidCount = summary ? Number(summary.onbid || 0) : Number(localSummary?.onbid || 0);
    const realtorCount = summary ? Number(summary.realtor_naver || 0) + Number(summary.realtor_direct || 0) : Number(localSummary?.realtor_naver || 0) + Number(localSummary?.realtor_direct || 0);
    const generalCount = summary ? Number(summary.general || 0) : Number(localSummary?.general || 0);

    if (els.statTotal) els.statTotal.textContent = String(totalCount);
    if (els.statAuction) els.statAuction.textContent = String(auctionCount);
    if (els.statGongmae) els.statGongmae.textContent = String(onbidCount);
    if (els.statRealtor) els.statRealtor.textContent = String(realtorCount);
    if (els.statGeneral) els.statGeneral.textContent = String(generalCount);

    const setActive = (card, on) => {
      if (!card) return;
      card.classList.toggle("is-selected", on);
    };

    setActive(els.statTotalCard, state.source === "all");
    setActive(els.statAuctionCard, state.source === "auction");
    setActive(els.statGongmaeCard, state.source === "onbid");
    setActive(els.statRealtorCard, state.source === "realtor");
    setActive(els.statGeneralCard, state.source === "general");
  }


  async function loadStaffAssignments() {
    if (!isAdminUser(state.session?.user)) return [];
    try {
      if (!(DataAccess && typeof DataAccess.fetchAdminStaffViaApi === 'function' && typeof DataAccess.fetchRegionAssignmentsViaApi === 'function')) {
        throw new Error('KNSN_DATA_ACCESS staff/region assignments 래퍼를 찾을 수 없습니다.');
      }
      const [staffSettled, assignSettled] = await Promise.allSettled([
        DataAccess.fetchAdminStaffViaApi(api, { auth: true }),
        DataAccess.fetchRegionAssignmentsViaApi(api, { auth: true }),
      ]);

      const staffItems = staffSettled.status === 'fulfilled' && Array.isArray(staffSettled.value?.items)
        ? staffSettled.value.items
        : [];
      const assignItems = assignSettled.status === 'fulfilled' && Array.isArray(assignSettled.value?.items)
        ? assignSettled.value.items
        : [];

      if (PropertyDomain && typeof PropertyDomain.buildStaffAssignmentEntries === 'function') {
        return PropertyDomain.buildStaffAssignmentEntries(staffItems, assignItems);
      }
      return [];
    } catch (err) {
      console.warn('loadStaffAssignments failed', err);
      return [];
    }
  }

  function renderAgentChart() {
    if (!els.agentChart || !els.agentChartEmpty) return;
    const rows = Array.isArray(state.items) ? state.items.slice() : [];
    const entries = (PropertyDomain && typeof PropertyDomain.buildAgentChartEntries === 'function')
      ? PropertyDomain.buildAgentChartEntries(rows, state.staffAssignments)
      : [];
    els.agentChart.innerHTML = '';
    if (els.agentChartMeta) els.agentChartMeta.textContent = `${entries.length}명`;
    if (!entries.length) {
      els.agentChart.classList.add('hidden');
      els.agentChartEmpty.classList.remove('hidden');
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'agent-bench-grid';
    const max = Math.max(...entries.map((entry) => entry.total), 1);
    const segPct = (count, total) => total ? ((count / total) * 100).toFixed(2) : '0';

    entries.forEach((entry) => {
      const card = document.createElement('article');
      card.className = 'agent-bench-card';
      const fillPct = entry.total ? Math.max(12, Math.round((entry.total / max) * 100)) : 8;
      card.innerHTML = `
        <div class="agent-bench-score">${entry.total}건</div>
        <div class="agent-bench-plot">
          <div class="agent-bench-column" style="height:${fillPct}%">
            ${entry.auction ? `<span class="agent-bench-seg seg-auction" style="height:${segPct(entry.auction, entry.total)}%" title="경매 ${entry.auction}건"></span>` : ''}
            ${entry.onbid ? `<span class="agent-bench-seg seg-onbid" style="height:${segPct(entry.onbid, entry.total)}%" title="공매 ${entry.onbid}건"></span>` : ''}
            ${entry.realtor ? `<span class="agent-bench-seg seg-realtor" style="height:${segPct(entry.realtor, entry.total)}%" title="중개 ${entry.realtor}건"></span>` : ''}
            ${entry.general ? `<span class="agent-bench-seg seg-general" style="height:${segPct(entry.general, entry.total)}%" title="일반 ${entry.general}건"></span>` : ''}
          </div>
        </div>
        <div class="agent-bench-name" title="${escapeAttr(entry.name)}">${escapeHtml(entry.name)}</div>
      `;
      grid.appendChild(card);
    });

    els.agentChart.appendChild(grid);
    els.agentChart.classList.remove('hidden');
    els.agentChartEmpty.classList.add('hidden');
  }


  // ---- Statistics Charts ----
  function renderStatCharts() {
    renderInflowChart("day");
    renderSourceDistChart();
    renderStatusDistChart();
    renderRegionDistChart();
    renderTypeDistChart();
    renderPriceDistChart();
    renderAreaDistChart();
  }

  let _inflowSelectedBar = null; // 일간모드 선택된 바 key

  function renderInflowChart(period) {
    const el = els.inflowChart || document.getElementById("inflowChart");
    if (!el) return;

    _inflowSelectedBar = null; // 탭 변경 시 선택 해제
    const items = state.items;
    if (!items.length) { el.innerHTML = '<div class="stat-empty">데이터가 없습니다.</div>'; return; }

    // 기간별 키 생성 함수
    function makeKey(d) {
      if (period === "day") return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
      if (period === "week") { const sw = new Date(d); sw.setDate(d.getDate() - d.getDay()); return sw.getFullYear() + "-" + String(sw.getMonth()+1).padStart(2,"0") + "-" + String(sw.getDate()).padStart(2,"0"); }
      if (period === "month") return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
      return String(d.getFullYear());
    }

    // 아이템별 키 매핑
    const itemsByKey = new Map();
    items.forEach((p) => {
      const d = parseFlexibleDate(p.createdAt);
      if (!d) return;
      const key = makeKey(d);
      if (!itemsByKey.has(key)) itemsByKey.set(key, []);
      itemsByKey.get(key).push(p);
    });

    const sorted = [...itemsByKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const maxCount = period === "day" ? 30 : period === "week" ? 16 : period === "month" ? 12 : 10;
    const sliced = sorted.slice(-maxCount);
    if (!sliced.length) { el.innerHTML = '<div class="stat-empty">표시할 데이터가 없습니다.</div>'; return; }

    const maxVal = Math.max(...sliced.map((s) => s[1].length), 1);
    const formatLabel = (key) => {
      if (period === "day") return key.slice(5);
      if (period === "week") return key.slice(5) + "~";
      if (period === "month") return key.slice(2);
      return key;
    };

    function buildBreakdown(targetItems, label) {
      const regionCount = { "\uC11C\uC6B8": 0, "\uACBD\uAE30": 0, "\uC778\uCC9C": 0, "\uAE30\uD0C0": 0 };
      const sourceCount = { "\uACBD\uB9E4": 0, "\uACF5\uB9E4": 0, "\uB124\uC774\uBC84\uC911\uAC1C": 0, "\uC77C\uBC18\uC911\uAC1C": 0, "\uC77C\uBC18": 0 };

      targetItems.forEach((p) => {
        const addr = String(p.address || "");
        if (addr.includes("\uC11C\uC6B8")) regionCount["\uC11C\uC6B8"]++;
        else if (addr.match(/\uACBD\uAE30|\uC218\uC6D0|\uC131\uB0A8|\uACE0\uC591|\uC6A9\uC778|\uD654\uC131|\uC548\uC0B0|\uC548\uC591|\uD3C9\uD0DD|\uC2DC\uD765|\uD30C\uC8FC|\uAE40\uD3EC|\uAD11\uBA85|\uD558\uB0A8|\uACFC\uCC9C|\uC758\uC655|\uAD70\uD3EC|\uC624\uC0B0|\uC774\uCC9C|\uC591\uD3C9|\uC5EC\uC8FC|\uB3D9\uB450\uCC9C|\uAD6C\uB9AC|\uB0A8\uC591\uC8FC|\uC758\uC815\uBD80|\uD3EC\uCC9C|\uC591\uC8FC/)) regionCount["\uACBD\uAE30"]++;
        else if (addr.includes("\uC778\uCC9C")) regionCount["\uC778\uCC9C"]++;
        else regionCount["\uAE30\uD0C0"]++;

        const bucket = String(p.sourceBucket || ((PropertyDomain && typeof PropertyDomain.getSourceBucket === "function")
          ? PropertyDomain.getSourceBucket({ sourceType: p.source, sourceUrl: p.sourceUrl, isDirectSubmission: p.isDirectSubmission, raw: p.raw })
          : (p.source === "realtor" ? (p.isDirectSubmission ? "realtor_direct" : "realtor_naver") : p.source)) || "general");
        if (bucket === "auction") sourceCount["\uACBD\uB9E4"]++;
        else if (bucket === "onbid") sourceCount["\uACF5\uB9E4"]++;
        else if (bucket === "realtor_naver") sourceCount["\uB124\uC774\uBC84\uC911\uAC1C"]++;
        else if (bucket === "realtor_direct") sourceCount["\uC77C\uBC18\uC911\uAC1C"]++;
        else sourceCount["\uC77C\uBC18"]++;
      });

      const regionChips = [
        { label: "\uC11C\uC6B8", val: regionCount["\uC11C\uC6B8"], color: "#F37022" },
        { label: "\uACBD\uAE30", val: regionCount["\uACBD\uAE30"], color: "#3498DB" },
        { label: "\uC778\uCC9C", val: regionCount["\uC778\uCC9C"], color: "#2ECC71" },
        { label: "\uAE30\uD0C0", val: regionCount["\uAE30\uD0C0"], color: "#9A8E82" },
      ];
      const sourceChips = [
        { label: "\uACBD\uB9E4", val: sourceCount["\uACBD\uB9E4"], color: "#D778F7" },
        { label: "\uACF5\uB9E4", val: sourceCount["\uACF5\uB9E4"], color: "#59A7FF" },
        { label: "\uB124\uC774\uBC84\uC911\uAC1C", val: sourceCount["\uB124\uC774\uBC84\uC911\uAC1C"], color: "#4AD8BA" },
        { label: "\uC77C\uBC18\uC911\uAC1C", val: sourceCount["\uC77C\uBC18\uC911\uAC1C"], color: "#0FA68B" },
        { label: "\uC77C\uBC18", val: sourceCount["\uC77C\uBC18"], color: "#F6B04A" },
      ];

      const chipHtml = (chips) => chips.filter((c) => c.val > 0).map((c) =>
        '<span class="inflow-bd-chip"><span class="dot" style="background:' + c.color + '"></span><span class="label">' + escapeHtml(c.label) + '</span><span class="val">' + c.val.toLocaleString() + '</span></span>'
      ).join("");

      const titleSuffix = label ? ' (' + escapeHtml(label) + ')' : '';

      return '<div class="inflow-breakdown">' +
        '<div class="inflow-bd-group">' +
          '<div class="inflow-bd-title">\uC9C0\uC5ED\uBCC4' + titleSuffix + '</div>' +
          '<div class="inflow-bd-items">' + chipHtml(regionChips) + '</div>' +
        '</div>' +
        '<div class="inflow-bd-group">' +
          '<div class="inflow-bd-title">\uAD6C\uBD84\uBCC4' + titleSuffix + '</div>' +
          '<div class="inflow-bd-items">' + chipHtml(sourceChips) + '</div>' +
        '</div>' +
      '</div>';
    }

    function renderBars(selectedKey) {
      return sliced.map(([key, arr]) => {
        const count = arr.length;
        const pct = Math.max(4, Math.round((count / maxVal) * 100));
        const isSelected = selectedKey === key;
        return '<div class="inflow-bar-col' + (isSelected ? ' is-selected' : '') + '" data-bar-key="' + key + '">' +
          '<div class="inflow-bar-val">' + count.toLocaleString() + '</div>' +
          '<div class="inflow-bar' + (isSelected ? ' is-selected' : '') + '" style="height:' + pct + '%"></div>' +
          '<div class="inflow-bar-label">' + escapeHtml(formatLabel(key)) + '</div>' +
          '</div>';
      }).join("");
    }

    function fullRender(selectedKey) {
      let breakdownItems, breakdownLabel;
      if (selectedKey && itemsByKey.has(selectedKey)) {
        breakdownItems = itemsByKey.get(selectedKey);
        breakdownLabel = formatLabel(selectedKey);
      } else {
        breakdownItems = sliced.flatMap(([, arr]) => arr);
        const periodLabel = period === "day" ? "" : period === "week" ? "\uCD5C\uADFC 16\uC8FC" : period === "month" ? "\uCD5C\uADFC 12\uAC1C\uC6D4" : "\uC804\uCCB4";
        breakdownLabel = periodLabel;
      }

      el.innerHTML =
        '<div class="inflow-chart">' + renderBars(selectedKey) + '</div>' +
        buildBreakdown(breakdownItems, breakdownLabel);

      // 바 클릭 이벤트 바인딩
      el.querySelectorAll(".inflow-bar-col").forEach((col) => {
        col.style.cursor = "pointer";
        col.addEventListener("click", () => {
          const barKey = col.dataset.barKey;
          if (_inflowSelectedBar === barKey) {
            _inflowSelectedBar = null;
            fullRender(null);
          } else {
            _inflowSelectedBar = barKey;
            fullRender(barKey);
          }
        });
      });
    }

    fullRender(null);
  }

  function renderDonutSVG(data, total, centerLabel) {
    if (!data.length || !total) return '<div class="stat-empty">데이터가 없습니다.</div>';
    const R = 60, STROKE = 20, C = 2 * Math.PI * R;
    let offset = 0;
    const arcs = data.map((d) => {
      const pct = d.count / total;
      const len = pct * C;
      const html = '<circle cx="80" cy="80" r="' + R + '" fill="none" stroke="' + d.color + '" ' +
        'stroke-width="' + STROKE + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(2) + '"/>';
      offset += len;
      return html;
    });

    const legend = data.map((d) => {
      const pct = Math.round((d.count / total) * 100);
      return '<div class="donut-legend-item">' +
        '<span class="donut-legend-dot" style="background:' + d.color + '"></span>' +
        '<span>' + escapeHtml(d.label) + '</span>' +
        '<span class="donut-legend-pct">' + d.count.toLocaleString() + ' (' + pct + '%)</span>' +
        '</div>';
    }).join("");

    return '<div class="donut-wrap">' +
      '<div class="donut-svg-wrap">' +
        '<svg viewBox="0 0 160 160">' + arcs.join("") + '</svg>' +
        '<div class="donut-center"><div class="donut-center-num">' + total.toLocaleString() + '</div><div class="donut-center-label">' + escapeHtml(centerLabel) + '</div></div>' +
      '</div>' +
      '<div class="donut-legend">' + legend + '</div>' +
      '</div>';
  }

  function renderSourceDistChart() {
    const el = els.sourceDistChart || document.getElementById("sourceDistChart");
    if (!el) return;
    const items = state.items;
    const data = [
      { label: "경매", count: items.filter((p) => (p.sourceBucket || p.source) === "auction").length, color: "#D778F7" },
      { label: "공매", count: items.filter((p) => (p.sourceBucket || p.source) === "onbid").length, color: "#59A7FF" },
      { label: "중개", count: items.filter((p) => ["realtor_naver", "realtor_direct", "realtor"].includes(String(p.sourceBucket || p.source || ""))).length, color: "#4AD8BA" },
      { label: "일반", count: items.filter((p) => (p.sourceBucket || p.source) === "general").length, color: "#F6B04A" },
    ];
    el.innerHTML = renderDonutSVG(data, items.length, "전체 물건");
  }

  function renderStatusDistChart() {
    const el = document.getElementById("statusDistChart");
    if (!el) return;
    const items = state.items;
    const statusMap = { active: "진행중", hold: "보류", closed: "종결", review: "검토중" };
    const colors = { active: "#2ECC71", hold: "#F39C12", closed: "#9A8E82", review: "#3498DB" };
    const counter = new Map();
    items.forEach((p) => {
      const st = String(p.statusLabel || "").trim();
      const key = Object.entries(statusMap).find(([, v]) => v === st)?.[0] || "etc";
      counter.set(key, (counter.get(key) || 0) + 1);
    });
    const data = [];
    for (const [key, label] of Object.entries(statusMap)) {
      const count = counter.get(key) || 0;
      if (count > 0) data.push({ label, count, color: colors[key] || "#9A8E82" });
    }
    const etcCount = counter.get("etc") || 0;
    if (etcCount > 0) data.push({ label: "기타", count: etcCount, color: "#645A50" });
    el.innerHTML = renderDonutSVG(data, items.length, "진행상태");
  }

  function renderRegionDistChart() {
    const el = els.regionDistChart || document.getElementById("regionDistChart");
    if (!el) return;
    const counter = new Map();
    state.items.forEach((p) => {
      const region = extractAddressRegion(p.address);
      if (region) counter.set(region, (counter.get(region) || 0) + 1);
    });
    const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!sorted.length) { el.innerHTML = '<div class="stat-empty">지역 데이터가 없습니다.</div>'; return; }
    const maxVal = Math.max(sorted[0][1], 1);
    el.innerHTML = '<div class="hbar-chart">' +
      sorted.map(([label, count]) => {
        const pct = Math.max(2, Math.round((count / maxVal) * 100));
        return '<div class="hbar-row">' +
          '<div class="hbar-label">' + escapeHtml(label) + '</div>' +
          '<div class="hbar-track"><div class="hbar-fill c-accent" style="width:' + pct + '%"></div></div>' +
          '<div class="hbar-count">' + count.toLocaleString() + '</div>' +
          '</div>';
      }).join("") +
      '</div>';
  }

  function extractAddressRegion(address) {
    const a = String(address || "").trim();
    if (!a) return "";
    if (a.match(/^서울|서울특별시/)) return "서울";
    if (a.match(/^경기|경기도/) || a.match(/^(수원|성남|고양|용인|화성|안산|안양|평택|시흥|파주|김포|광명|하남|과천|의왕|군포|오산|이천|양평|여주|동두천|구리|남양주|의정부|포천|양주|광주시|부천)/)) return "경기";
    if (a.match(/^인천|인천광역시/)) return "인천";
    if (a.match(/^부산|부산광역시/)) return "부산";
    if (a.match(/^대구|대구광역시/)) return "대구";
    if (a.match(/^대전|대전광역시/)) return "대전";
    if (a.match(/^광주광역시|^광주시/)) return "광주";
    if (a.match(/^울산|울산광역시/)) return "울산";
    if (a.match(/^세종|세종특별자치시/)) return "세종";
    if (a.match(/^충청북도|^충북|^청주|^충주|^제천/)) return "충북";
    if (a.match(/^충청남도|^충남|^천안|^아산|^논산|^당진|^서산/)) return "충남";
    if (a.match(/^전라북도|^전북|^전주|^익산|^군산/)) return "전북";
    if (a.match(/^전라남도|^전남|^목포|^순천|^여수/)) return "전남";
    if (a.match(/^경상북도|^경북|^포항|^경주|^구미|^안동/)) return "경북";
    if (a.match(/^경상남도|^경남|^창원|^김해|^진주|^양산/)) return "경남";
    if (a.match(/^강원|^강원도|^춘천|^원주|^강릉/)) return "강원";
    if (a.match(/^제주|^제주특별자치도/)) return "제주";
    // fallback: 첫 시/도 추출
    const m = a.match(/^([가-힣]{2,4}(?:특별시|광역시|특별자치시|특별자치도|도))/);
    return m ? m[1].replace(/특별시|광역시|특별자치시|특별자치도/, "").replace(/도$/, "") || m[1] : "";
  }

  function renderTypeDistChart() {
    const el = els.typeDistChart || document.getElementById("typeDistChart");
    if (!el) return;
    const counter = new Map();
    state.items.forEach((p) => {
      const t = String(p.type || "").trim();
      if (t && t !== "-") counter.set(t, (counter.get(t) || 0) + 1);
    });
    const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!sorted.length) { el.innerHTML = '<div class="stat-empty">유형 데이터가 없습니다.</div>'; return; }
    const maxVal = Math.max(sorted[0][1], 1);
    el.innerHTML = '<div class="hbar-chart">' +
      sorted.map(([label, count]) => {
        const pct = Math.max(2, Math.round((count / maxVal) * 100));
        return '<div class="hbar-row">' +
          '<div class="hbar-label">' + escapeHtml(label.length > 8 ? label.slice(0, 8) + ".." : label) + '</div>' +
          '<div class="hbar-track"><div class="hbar-fill c-accent" style="width:' + pct + '%"></div></div>' +
          '<div class="hbar-count">' + count.toLocaleString() + '</div>' +
          '</div>';
      }).join("") +
      '</div>';
  }

  function renderPriceDistChart() {
    const el = els.priceDistChart || document.getElementById("priceDistChart");
    if (!el) return;
    const ranges = [
      { label: "1억 미만", min: 0, max: 100000000 },
      { label: "1~3억", min: 100000000, max: 300000000 },
      { label: "3~5억", min: 300000000, max: 500000000 },
      { label: "5~10억", min: 500000000, max: 1000000000 },
      { label: "10~20억", min: 1000000000, max: 2000000000 },
      { label: "20~50억", min: 2000000000, max: 5000000000 },
      { label: "50억 이상", min: 5000000000, max: Infinity },
    ];
    const counts = ranges.map(() => 0);
    state.items.forEach((p) => {
      const price = p.appraisalPrice || p.currentPrice || 0;
      if (!price) return;
      for (let i = 0; i < ranges.length; i++) {
        if (price >= ranges[i].min && price < ranges[i].max) { counts[i]++; break; }
      }
    });
    const maxVal = Math.max(...counts, 1);
    el.innerHTML = '<div class="hbar-chart">' +
      ranges.map((r, i) => {
        const pct = Math.max(2, Math.round((counts[i] / maxVal) * 100));
        return '<div class="hbar-row">' +
          '<div class="hbar-label">' + r.label + '</div>' +
          '<div class="hbar-track"><div class="hbar-fill c-accent" style="width:' + pct + '%"></div></div>' +
          '<div class="hbar-count">' + counts[i].toLocaleString() + '</div>' +
          '</div>';
      }).join("") +
      '</div>';
  }

  function renderAreaDistChart() {
    const el = document.getElementById("areaDistChart");
    if (!el) return;
    const ranges = [
      { label: "5평 미만", min: 0, max: 5 },
      { label: "5~10평", min: 5, max: 10 },
      { label: "10~20평", min: 10, max: 20 },
      { label: "20~30평", min: 20, max: 30 },
      { label: "30~50평", min: 30, max: 50 },
      { label: "50~100평", min: 50, max: 100 },
      { label: "100평 이상", min: 100, max: Infinity },
    ];
    const counts = ranges.map(() => 0);
    state.items.forEach((p) => {
      const area = p.exclusivearea;
      if (area == null || area <= 0) return;
      for (let i = 0; i < ranges.length; i++) {
        if (area >= ranges[i].min && area < ranges[i].max) { counts[i]++; break; }
      }
    });
    const maxVal = Math.max(...counts, 1);
    el.innerHTML = '<div class="hbar-chart">' +
      ranges.map((r, i) => {
        const pct = Math.max(2, Math.round((counts[i] / maxVal) * 100));
        return '<div class="hbar-row">' +
          '<div class="hbar-label">' + r.label + '</div>' +
          '<div class="hbar-track"><div class="hbar-fill c-accent" style="width:' + pct + '%"></div></div>' +
          '<div class="hbar-count">' + counts[i].toLocaleString() + '</div>' +
          '</div>';
      }).join("") +
      '</div>';
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

  function calcRate(appraisal, current, raw = null) {
    if (KNSN_PROPERTY_RENDERERS && typeof KNSN_PROPERTY_RENDERERS.formatPercent === 'function') {
      return KNSN_PROPERTY_RENDERERS.formatPercent(appraisal, current, raw, '-');
    }
    const a = Number(appraisal || 0);
    const c = Number(current || 0);
    if (Number.isFinite(a) && Number.isFinite(c) && a > 0 && c > 0) return `${((c / a) * 100).toFixed(1)}%`;
    const rawRate = raw && (raw["최저입찰가율(%)"] || raw.bidRate || raw.rate);
    if (rawRate != null && String(rawRate).trim() !== "") return String(rawRate).trim();
    return "-";
  }

  function statusLabel(v) {
    if (KNSN_PROPERTY_RENDERERS && typeof KNSN_PROPERTY_RENDERERS.statusLabel === 'function') return KNSN_PROPERTY_RENDERERS.statusLabel(v, '-');
    const s = String(v || "").trim().toLowerCase();
    if (!s) return "-";
    if (["active", "진행", "진행중", "진행중인"].includes(s)) return "진행중";
    if (["hold", "보류"].includes(s)) return "보류";
    if (["closed", "종결", "완료"].includes(s)) return "종결";
    if (["review", "검토", "검토중"].includes(s)) return "검토중";
    return String(v || "-");
  }

  function firstText(...values) {
    if (KNSN_PROPERTY_RENDERERS && typeof KNSN_PROPERTY_RENDERERS.firstText === 'function') return KNSN_PROPERTY_RENDERERS.firstText(...values);
    for (const value of values) {
      if (value == null) continue;
      const s = String(value).trim();
      if (s) return s;
    }
    return "";
  }

  function toNullableNumber(v) {
    if (KNSN_PROPERTY_RENDERERS && typeof KNSN_PROPERTY_RENDERERS.toNullableNumber === 'function') return KNSN_PROPERTY_RENDERERS.toNullableNumber(v);
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function formatAreaPyeong(v) {
    const n = toNullableNumber(v);
    if (n == null || n <= 0) return "-";
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function buildKakaoMapLink(p) {
    if (KNSN_PROPERTY_RENDERERS && typeof KNSN_PROPERTY_RENDERERS.buildKakaoMapLink === 'function') return KNSN_PROPERTY_RENDERERS.buildKakaoMapLink(p, { fallbackLabel: '매물 위치' });
    if (p.latitude == null || p.longitude == null) return "";
    const label = encodeURIComponent(p.address || p.type || "매물 위치");
    return `https://map.kakao.com/link/map/${label},${p.latitude},${p.longitude}`;
  }

  function getSourceStyle(itemOrSource) {
    const key = typeof itemOrSource === "string"
      ? itemOrSource
      : ((itemOrSource && (itemOrSource.sourceBucket || itemOrSource.source || itemOrSource.sourceType)) || "general");
    return SOURCE_COLORS[key] || SOURCE_COLORS.general;
  }

  function shortType(type) {
    const t = String(type || "").trim();
    if (!t || t === "-") return "매물";
    if (t.length <= 4) return t;
    if (t.includes("오피스텔")) return "오피스텔";
    if (t.includes("근린") || t.includes("근생")) return "근생";
    if (t.includes("사무")) return "사무실";
    if (t.includes("상가")) return "상가";
    if (t.includes("공장")) return "공장";
    if (t.includes("토지") || t.includes("대지")) return "토지";
    if (t.includes("빌딩") || t.includes("건물")) return "빌딩";
    return t.slice(0, 4);
  }

  function ensureMapDom() {
    if (!els.mapView) return { mapEl: null, hintEl: null };
    return {
      mapEl: document.getElementById("kakaoMap"),
      hintEl: document.getElementById("mapHint"),
    };
  }

  async function ensureKakaoMap() {
    const { mapEl, hintEl } = ensureMapDom();
    if (!mapEl) return;

    const key = getKakaoKey();
    if (!key) {
      if (hintEl) {
        hintEl.classList.remove("hidden");
        hintEl.textContent = "카카오 JavaScript 키가 필요합니다.";
      }
      return;
    }

    if (!state.kakaoReady) {
      state.kakaoReady = loadKakaoSdk(key);
    }
    await state.kakaoReady;

    if (state.map && state.geocoder) {
      state.map.relayout();
      return;
    }

    const center = new kakao.maps.LatLng(37.5665, 126.9780);
    state.map = new kakao.maps.Map(mapEl, { center, level: 8 });
    state.geocoder = new kakao.maps.services.Geocoder();

    // 맵 이동/줌 완료 시 현재 뷰포트 기준으로 데이터/마커 재동기화
    kakao.maps.event.addListener(state.map, "idle", debounce(async () => {
      if (shouldUseServerMap()) {
        await refreshMapDataMaybe();
      } else {
        await renderKakaoMarkers();
      }
    }, 350));
  }

  function clearMapMarkers() {
    for (const m of state.markers) { try { m.setMap(null); } catch {} }
    state.markers = [];
  }

  function createMarkerOverlay(item, position) {
    const src = getSourceStyle(item);

    const el = document.createElement("div");
    el.className = "mv-marker";
    el.setAttribute("data-id", item.id || "");
    el.innerHTML =
      '<div class="mv-marker-body" style="background:' + src.bg + ';border-color:' + src.border + '">' +
        '<div class="mv-marker-stripe" style="background:' + src.solid + '"></div>' +
        '<div class="mv-marker-src" style="background:' + src.solid + '">' + escapeHtml(src.short) + '</div>' +
        '<div class="mv-marker-type">' + escapeHtml(shortType(item.type)) + '</div>' +
      '</div>' +
      '<div class="mv-marker-arrow" style="border-top-color:' + src.bg + '"></div>';

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      void openMapDetail(item);
      // 선택 마커 강조
      document.querySelectorAll(".mv-marker.is-active").forEach((m) => m.classList.remove("is-active"));
      el.classList.add("is-active");
      // 사이드바 선택 동기화
      highlightSidebarCard(item.id);
    });

    return new kakao.maps.CustomOverlay({
      position,
      content: el,
      yAnchor: 1.3,
      zIndex: 3,
    });
  }

  async function renderKakaoMarkers() {
    if (!state.map || !window.kakao?.maps) return;

    clearMapMarkers();

    const serverMarkers = shouldUseServerMap() ? getFilteredMapMarkers() : [];
    const rows = serverMarkers.length
      ? serverMarkers
      : getFilteredRows().filter((r) => r.latitude != null && r.longitude != null);

    if (!rows.length) {
      renderMapSidebar();
      return;
    }

    const target = shouldUseServerMap()
      ? rows.slice(0, 500)
      : (() => {
          const bounds = state.map.getBounds();
          const sw = bounds.getSouthWest();
          const ne = bounds.getNorthEast();
          const inBounds = rows.filter((r) =>
            r.latitude >= sw.getLat() && r.latitude <= ne.getLat() &&
            r.longitude >= sw.getLng() && r.longitude <= ne.getLng()
          );
          return inBounds.length > 0 ? inBounds.slice(0, 500) : rows.slice(0, 200);
        })();

    for (const it of target) {
      const pos = new kakao.maps.LatLng(it.latitude, it.longitude);
      const overlay = createMarkerOverlay(it, pos);
      overlay.setMap(state.map);
      state.markers.push(overlay);
    }

    renderMapSidebar();
  }

  function renderMapSidebar() {
    if (!els.mvPropertyList) return;

    const rows = getFilteredRows();

    els.mvPropertyList.innerHTML = "";
    if (!rows.length) {
      els.mvPropertyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">표시할 매물이 없습니다.</div>';
      renderMapSummary(0);
      return;
    }

    const frag = document.createDocumentFragment();
    const max = Math.min(rows.length, 300);
    for (let i = 0; i < max; i++) {
      const p = rows[i];
      frag.appendChild(createSidebarCard(p));
    }
    els.mvPropertyList.appendChild(frag);
    renderMapSummary(rows.length);
  }

  function createSidebarCard(p) {
    const src = getSourceStyle(p);
    const kindLabel = src.label;
    const appraisal = p.appraisalPrice != null ? formatMoneyEok(p.appraisalPrice) : "";
    const current = p.currentPrice != null ? formatMoneyEok(p.currentPrice) : "";
    const rate = calcRate(p.appraisalPrice, p.currentPrice, p.raw);

    const card = document.createElement("div");
    card.className = "mv-card";
    card.setAttribute("data-id", p.id || "");

    let priceHtml = "";
    if ((p.sourceBucket || p.source) === "auction" || (p.sourceBucket || p.source) === "onbid") {
      priceHtml = '<div class="mv-card-price">' +
        (appraisal ? '<span>감정가</span><strong>' + escapeHtml(appraisal) + '</strong>' : '') +
        (current ? '<span>현재가</span><strong>' + escapeHtml(current) + '</strong>' : '') +
        '</div>';
      if (rate && rate !== "-") priceHtml += '<div class="mv-card-gap">비율 ' + escapeHtml(rate) + '</div>';
    } else {
      priceHtml = '<div class="mv-card-price">' +
        (appraisal ? '<span>매매가</span><strong>' + escapeHtml(appraisal) + '</strong>' : '') +
        '</div>';
    }

    // 평가 배지
    const Valuation = window.KNSN_VALUATION;
    const gradeBadge = Valuation ? Valuation.renderGradeBadge(p.valuation) : '';

    card.innerHTML =
      '<div class="mv-card-top">' +
        '<span class="mv-badge mv-badge-' + (p.sourceBucket || p.source) + '">' + escapeHtml(kindLabel) + '</span>' +
        gradeBadge +
      '</div>' +
      '<div class="mv-card-addr">' + escapeHtml(p.address || "-") + '</div>' +
      '<div class="mv-card-info">' + escapeHtml((p.type || "") + (p.floor ? " · " + p.floor + "층" : "") + (p.exclusivearea != null ? " · 전용 " + formatAreaPyeong(p.exclusivearea) + "평" : "")) + '</div>' +
      priceHtml;

    card.addEventListener("click", async () => {
      await openMapDetail(p);
      highlightSidebarCard(p.id);
      // 지도 중심 이동
      if (state.map && p.latitude != null && p.longitude != null) {
        state.map.panTo(new kakao.maps.LatLng(p.latitude, p.longitude));
      }
      // 마커 강조
      document.querySelectorAll(".mv-marker.is-active").forEach((m) => m.classList.remove("is-active"));
      const markerEl = document.querySelector('.mv-marker[data-id="' + (p.id || "") + '"]');
      if (markerEl) markerEl.classList.add("is-active");
    });

    return card;
  }

  function highlightSidebarCard(id) {
    document.querySelectorAll(".mv-card.is-selected").forEach((c) => c.classList.remove("is-selected"));
    const card = els.mvPropertyList?.querySelector('.mv-card[data-id="' + (id || "") + '"]');
    if (card) {
      card.classList.add("is-selected");
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function renderMapSummary(total) {
    if (!els.mvSummary) return;
    const buildLink = (label, value, sourceKey, extraClass = '') => {
      const active = state.source === sourceKey || (sourceKey === 'all' && state.source === 'all');
      const classes = ['mv-summary-link'];
      if (extraClass) classes.push(extraClass);
      if (active) classes.push('is-active');
      return '<button type="button" class="' + classes.join(' ') + '" data-source="' + sourceKey + '">' +
        '<span class="mv-summary-label">' + label + '</span>' +
        '<strong>' + Number(value || 0) + '</strong>' +
        (sourceKey === 'all' ? '건' : '') +
        '</button>';
    };

    if (shouldUseServerMap() && state.mapSummary) {
      const counts = state.mapSummary;
      const summaryTotal = Number(counts.total || total || 0);
      els.mvSummary.innerHTML = [
        buildLink('전체', summaryTotal, 'all', 'mv-summary-all'),
        buildLink('경매', Number(counts.auction || 0), 'auction', 'mv-summary-auction'),
        buildLink('공매', Number(counts.onbid || 0), 'onbid', 'mv-summary-onbid'),
        buildLink('네이버중개', Number(counts.realtor_naver || 0), 'realtor_naver', 'mv-summary-realtor-naver'),
        buildLink('일반중개', Number(counts.realtor_direct || 0), 'realtor_direct', 'mv-summary-realtor-direct'),
        buildLink('일반', Number(counts.general || 0), 'general', 'mv-summary-general'),
      ].join('');
      return;
    }
    const rows = Array.isArray(state.items) ? state.items : [];
    const counts = (PropertyDomain && typeof PropertyDomain.summarizeSourceBuckets === "function")
      ? PropertyDomain.summarizeSourceBuckets(rows)
      : { total: rows.length, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    els.mvSummary.innerHTML = [
      buildLink('전체', total, 'all', 'mv-summary-all'),
      buildLink('경매', counts.auction, 'auction', 'mv-summary-auction'),
      buildLink('공매', counts.onbid, 'onbid', 'mv-summary-onbid'),
      buildLink('네이버중개', counts.realtor_naver, 'realtor_naver', 'mv-summary-realtor-naver'),
      buildLink('일반중개', counts.realtor_direct, 'realtor_direct', 'mv-summary-realtor-direct'),
      buildLink('일반', counts.general, 'general', 'mv-summary-general'),
    ].join('');
  }

  // ---- Map Detail Popup ----
  async function fetchMapDetail(item) {
    const targetId = String(item?.globalId || item?.id || '').trim();
    if (!targetId) return item;
    if (state.mapDetailCache.has(targetId)) return state.mapDetailCache.get(targetId);
    const detail = await DataAccess.fetchAdminPropertyDetailViaApi(api, targetId, { auth: true });
    const normalized = detail?.item && typeof detail.item === 'object' ? detail.item : item;
    state.mapDetailCache.set(targetId, normalized);
    return normalized;
  }

  function renderMapDetail(item) {
    if (!els.mvDetail || !els.mvDetailGrade || !els.mvDetailBody) return;

    const src = getSourceStyle(item);
    els.mvDetailGrade.innerHTML =
      '<span class="mv-detail-source-badge mv-badge-' + (item.sourceBucket || item.source) + '" style="font-size:12px;padding:3px 10px;">' + escapeHtml(src.label) + '</span>';

    const kindLine = [item.type || '-', item.floor ? item.floor + '층' : '', item.exclusivearea != null ? ('전용 ' + formatAreaPyeong(item.exclusivearea) + '평') : '']
      .filter(Boolean)
      .join(' · ');

    const appraisal = item.appraisalPrice != null ? formatMoneyEok(item.appraisalPrice) : '-';
    const current = item.currentPrice != null ? formatMoneyEok(item.currentPrice) : '-';
    const rate = calcRate(item.appraisalPrice, item.currentPrice, item.raw);

    let body = '';
    body += '<div class="mv-detail-addr">' + escapeHtml(item.address || '-') + '</div>';
    body += '<div class="mv-detail-sub">' + escapeHtml(kindLine || '-') + '</div>';

    body += '<div class="mv-detail-section">';
    body += '<div class="mv-detail-stitle">A. 기본 정보</div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">물건번호</span><span class="mv-detail-rv">' + escapeHtml(item.itemNo || '-') + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">구분</span><span class="mv-detail-rv">' + escapeHtml(src.label) + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">진행상태</span><span class="mv-detail-rv">' + escapeHtml(item.statusLabel || statusLabel(item.status) || '-') + '</span></div>';
    body += '</div>';

    body += '<div class="mv-detail-section">';
    body += '<div class="mv-detail-stitle">B. 가격 / 면적</div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">감정가(매각가)</span><span class="mv-detail-rv">' + escapeHtml(appraisal) + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">현재가</span><span class="mv-detail-rv">' + escapeHtml(current) + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">비율</span><span class="mv-detail-rv">' + escapeHtml(rate) + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">공용면적</span><span class="mv-detail-rv">' + escapeHtml(formatAreaPyeong(item.commonarea)) + '평</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">전용면적</span><span class="mv-detail-rv">' + escapeHtml(formatAreaPyeong(item.exclusivearea)) + '평</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">토지면적</span><span class="mv-detail-rv">' + escapeHtml(formatAreaPyeong(item.sitearea)) + '평</span></div>';
    body += '</div>';

    body += '<div class="mv-detail-section">';
    body += '<div class="mv-detail-stitle">C. 검토 현황</div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">권리분석</span><span class="mv-detail-rv">' + (item.rightsAnalysis ? '<span class="positive">✓ 완료</span>' : '-') + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">현장실사</span><span class="mv-detail-rv">' + (item.siteInspection ? '<span class="positive">✓ 완료</span>' : '-') + '</span></div>';
    if (item.opinion) {
      body += '<div style="margin-top:6px;font-size:11px;color:var(--muted);line-height:1.5;word-break:keep-all;">' +
        '<strong style="color:var(--text)">의견:</strong> ' + escapeHtml(item.opinion) + '</div>';
    }
    body += '</div>';

    if (item.latitude != null && item.longitude != null) {
      const mapLink = buildKakaoMapLink(item);
      body += '<div class="mv-detail-section">';
      body += '<div class="mv-detail-stitle">D. 위치</div>';
      body += '<div class="mv-detail-row"><span class="mv-detail-rl">좌표</span><span class="mv-detail-rv">' + Number(item.latitude).toFixed(5) + ', ' + Number(item.longitude).toFixed(5) + '</span></div>';
      if (mapLink) {
        body += '<div style="margin-top:6px;"><a href="' + escapeAttr(mapLink) + '" target="_blank" rel="noopener noreferrer" style="color:#F37022;font-size:11px;font-weight:700;text-decoration:none;">카카오맵에서 보기 →</a></div>';
      }
      body += '</div>';
    }

    els.mvDetailBody.innerHTML = body;

    // 가격평가 상세 표시 (비동기)
    const Valuation = window.KNSN_VALUATION;
    if (Valuation && item.id) {
      const valWrap = document.createElement('div');
      valWrap.className = 'mv-detail-section';
      valWrap.innerHTML = '<div class="mv-detail-stitle">E. 가격평가</div><div style="font-size:12px;color:var(--muted);">평가 정보 조회 중...</div>';
      els.mvDetailBody.appendChild(valWrap);

      Valuation.fetchValuation(item.id).then(function(val) {
        item.valuation = val;
        if (val && val.grade) {
          valWrap.innerHTML = '<div class="mv-detail-stitle">E. 가격평가</div>' + Valuation.renderValuationDetail(val);
        } else {
          valWrap.innerHTML = '<div class="mv-detail-stitle">E. 가격평가</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">아직 평가되지 않은 매물입니다.</div>' +
            '<button type="button" onclick="window.__runValuation(\'' + (item.id || '') + '\')" ' +
            'style="padding:6px 14px;background:#534AB7;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">' +
            '평가 실행</button>';
        }
      }).catch(function() {
        valWrap.innerHTML = '<div class="mv-detail-stitle">E. 가격평가</div><div style="font-size:12px;color:var(--muted);">평가 정보를 불러올 수 없습니다.</div>';
      });
    }

    // 인구 데이터 표시 (비동기)
    const dongName = extractDongFromAddress(item.address);
    if (dongName) {
      const popWrap = document.createElement('div');
      popWrap.className = 'mv-detail-section';
      popWrap.innerHTML = '<div class="mv-detail-stitle">F. 인구 현황</div><div style="font-size:12px;color:var(--muted);">인구 데이터 조회 중...</div>';
      els.mvDetailBody.appendChild(popWrap);

      fetchPopulationData(dongName).then(function(pop) {
        if (!pop) {
          popWrap.innerHTML = '<div class="mv-detail-stitle">F. 인구 현황</div><div style="font-size:12px;color:var(--muted);">해당 지역의 인구 데이터가 없습니다.</div>';
          return;
        }
        const fmtN = (n) => n != null ? Number(n).toLocaleString() : '-';
        const totalPop = Number(pop.total_pop || 0);
        const hhCount = Number(pop.household_count || 0);
        const malePop = Number(pop.male_pop || 0);
        const femalePop = Number(pop.female_pop || 0);
        const perHh = hhCount > 0 ? (totalPop / hhCount).toFixed(1) : '-';
        const maleRatio = totalPop > 0 ? ((malePop / totalPop) * 100).toFixed(1) : '-';
        const femaleRatio = totalPop > 0 ? ((femalePop / totalPop) * 100).toFixed(1) : '-';
        const src = pop.source === 'cache' ? '캐시' : '행안부 API';

        let html = '<div class="mv-detail-stitle">F. 인구 현황 <span style="font-size:9px;color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;">(' + escapeHtml(dongName) + ')</span></div>';
        html += '<div class="mv-detail-row"><span class="mv-detail-rl">총 인구</span><span class="mv-detail-rv">' + fmtN(totalPop) + '명</span></div>';
        html += '<div class="mv-detail-row"><span class="mv-detail-rl">세대수</span><span class="mv-detail-rv">' + fmtN(hhCount) + '세대</span></div>';
        html += '<div class="mv-detail-row"><span class="mv-detail-rl">세대당 인구</span><span class="mv-detail-rv">' + escapeHtml(perHh) + '명</span></div>';
        html += '<div class="mv-detail-row"><span class="mv-detail-rl">남성</span><span class="mv-detail-rv">' + fmtN(malePop) + '명 (' + escapeHtml(maleRatio) + '%)</span></div>';
        html += '<div class="mv-detail-row"><span class="mv-detail-rl">여성</span><span class="mv-detail-rv">' + fmtN(femalePop) + '명 (' + escapeHtml(femaleRatio) + '%)</span></div>';

        // 인구 막대 시각화
        if (totalPop > 0) {
          const mPct = Math.round((malePop / totalPop) * 100);
          html += '<div style="margin-top:6px;display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--line);">';
          html += '<div style="width:' + mPct + '%;background:#59A7FF;"></div>';
          html += '<div style="width:' + (100 - mPct) + '%;background:#FF7EB3;"></div>';
          html += '</div>';
          html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-top:2px;"><span>남 ' + mPct + '%</span><span>여 ' + (100 - mPct) + '%</span></div>';
        }

        html += '<div style="margin-top:6px;font-size:9px;color:var(--muted);">출처: ' + escapeHtml(src) + ' · ' + escapeHtml(pop.data_date || '') + '</div>';
        popWrap.innerHTML = html;
      }).catch(function() {
        popWrap.innerHTML = '<div class="mv-detail-stitle">F. 인구 현황</div><div style="font-size:12px;color:var(--muted);">인구 정보를 불러올 수 없습니다.</div>';
      });
    }

    // ── G. 반경 배후 분석 섹션 ──
    if (item.latitude != null && item.longitude != null) {
      const raWrap = document.createElement('div');
      raWrap.className = 'mv-detail-section ra-section';
      raWrap.innerHTML = buildRadiusAnalysisUI(item);
      els.mvDetailBody.appendChild(raWrap);
      bindRadiusAnalysisEvents(raWrap, item);

      // 300m 자동 분석 실행
      setTimeout(function() {
        var defaultBtn = raWrap.querySelector('.ra-radius-btn[data-radius="300"]');
        if (defaultBtn) {
          defaultBtn.classList.add('is-active');
          runRadiusAnalysis(item, 300, raWrap);
        }
      }, 100);
    }

    els.mvDetail.classList.remove("hidden");
  }

  // 평가 실행 글로벌 함수
  window.__runValuation = async function(propertyId) {
    const Valuation = window.KNSN_VALUATION;
    if (!Valuation) return;
    const btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = '평가 중...'; }
    try {
      const result = await Valuation.requestEvaluation(propertyId);
      if (result && result.grade) {
        alert('평가 완료: ' + result.grade + ' 등급' + (result.annual_yield ? ' (수익률 ' + result.annual_yield.toFixed(1) + '%)' : ''));
        // 상세 팝업 갱신
        const item = state.items.find(function(i) { return i.id === propertyId; });
        if (item) { item.valuation = result; }
      } else {
        alert('평가 실패: ' + (result?.error || '비교사례 부족'));
      }
    } catch (err) {
      alert('평가 오류: ' + err.message);
    }
    if (btn) { btn.disabled = false; btn.textContent = '평가 실행'; }
  };

  async function openMapDetail(item) {
    if (!els.mvDetail || !els.mvDetailGrade || !els.mvDetailBody) return;
    const src = getSourceStyle(item);
    els.mvDetailGrade.innerHTML =
      '<span class="mv-detail-source-badge mv-badge-' + (item.sourceBucket || item.source) + '" style="font-size:12px;padding:3px 10px;">' + escapeHtml(src.label) + '</span>';
    els.mvDetailBody.innerHTML = '<div class="mv-detail-section"><div class="mv-detail-stitle">불러오는 중</div><div style="font-size:12px;color:var(--muted);">해당 물건의 상세 정보를 서버에서 불러오고 있습니다.</div></div>';
    els.mvDetail.classList.remove("hidden");
    try {
      const detail = shouldUseServerMap() ? await fetchMapDetail(item) : item;
      renderMapDetail(detail || item);
    } catch (err) {
      els.mvDetailBody.innerHTML = '<div class="mv-detail-section"><div class="mv-detail-stitle">오류</div><div style="font-size:12px;color:var(--muted);">' + escapeHtml(toUserErrorMessage(err, '상세 정보를 불러오지 못했습니다.')) + '</div></div>';
    }
  }

  // ── 반경 배후 분석 ──
  let _radiusCircle = null;  // 카카오맵 Circle overlay
  let _radiusAnalysisCache = new Map(); // key: `${lat},${lng},${radius}` → result

  function getVworldProxyUrl() {
    const meta = document.querySelector('meta[name="vworld-proxy-url"]');
    return meta?.getAttribute("content")?.trim() || "";
  }

  function getSupabaseAnonKey() {
    return document.querySelector('meta[name="supabase-anon-key"]')?.getAttribute("content") || "";
  }

  function buildRadiusAnalysisUI(item) {
    const radii = [
      { value: 100, label: '100m' },
      { value: 300, label: '300m' },
      { value: 500, label: '500m' },
      { value: 1000, label: '1km' },
      { value: 2000, label: '2km' },
      { value: 3000, label: '3km' },
    ];
    let html = '<div class="mv-detail-stitle">G. 반경 배후 분석</div>';
    html += '<div class="ra-desc">매물 좌표 기준 반경 내 배후세대·거주인구를 분석합니다.</div>';
    html += '<div class="ra-radius-bar">';
    radii.forEach(function(r) {
      html += '<button type="button" class="ra-radius-btn" data-radius="' + r.value + '">' + escapeHtml(r.label) + '</button>';
    });
    html += '</div>';
    html += '<div class="ra-result" id="raResult"></div>';
    return html;
  }

  function bindRadiusAnalysisEvents(wrap, item) {
    const btns = wrap.querySelectorAll('.ra-radius-btn');
    btns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        // 토글: 이미 선택된 반경 클릭 시 해제
        const radius = parseInt(btn.dataset.radius, 10);
        const isActive = btn.classList.contains('is-active');

        // 모든 버튼 비활성화
        btns.forEach(function(b) { b.classList.remove('is-active'); });

        if (isActive) {
          // 해제 모드
          clearRadiusCircle();
          const resultEl = wrap.querySelector('#raResult');
          if (resultEl) resultEl.innerHTML = '';
          return;
        }

        // 활성화
        btn.classList.add('is-active');
        runRadiusAnalysis(item, radius, wrap);
      });
    });
  }

  function clearRadiusCircle() {
    if (_radiusCircle) {
      try { _radiusCircle.setMap(null); } catch {}
      _radiusCircle = null;
    }
  }

  function drawRadiusCircle(lat, lng, radius) {
    clearRadiusCircle();
    if (!state.map || !window.kakao?.maps) return;

    const center = new kakao.maps.LatLng(lat, lng);
    _radiusCircle = new kakao.maps.Circle({
      center: center,
      radius: radius,
      strokeWeight: 2,
      strokeColor: '#F37022',
      strokeOpacity: 0.8,
      strokeStyle: 'solid',
      fillColor: '#F37022',
      fillOpacity: 0.08,
    });
    _radiusCircle.setMap(state.map);

    // 지도 범위를 원에 맞게 조정
    const bounds = _radiusCircle.getBounds();
    if (bounds) {
      state.map.setBounds(bounds, 50, 50, 50, 420);
    }
  }

  async function runRadiusAnalysis(item, radius, wrap) {
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    const resultEl = wrap.querySelector('#raResult');
    if (!resultEl) return;

    // 지도에 원 표시
    drawRadiusCircle(lat, lng, radius);

    const cacheKey = lat.toFixed(6) + ',' + lng.toFixed(6) + ',' + radius;
    if (_radiusAnalysisCache.has(cacheKey)) {
      renderRadiusResult(resultEl, _radiusAnalysisCache.get(cacheKey), radius);
      return;
    }

    resultEl.innerHTML = '<div class="ra-loading"><div class="ra-spinner"></div><span>반경 ' + radius + 'm 배후 분석 중... (법정동 폴리곤 + 인구 조회)</span></div>';

    const proxyUrl = getVworldProxyUrl();
    if (!proxyUrl) {
      resultEl.innerHTML = '<div class="ra-error">Vworld 프록시 URL이 설정되지 않았습니다.</div>';
      return;
    }

    const anonKey = getSupabaseAnonKey();
    const authHeaders = anonKey ? { 'Authorization': 'Bearer ' + anonKey } : {};

    try {
      // 통합 분석 API 호출 (서버에서 법정동 폴리곤 + 면적비율 + 인구 보정 모두 처리)
      var analysisUrl = proxyUrl + '?mode=radiusAnalysis&lat=' + lat + '&lng=' + lng + '&radius=' + radius;
      var analysisRes = await fetch(analysisUrl, { headers: authHeaders });
      if (!analysisRes.ok) throw new Error('분석 요청 실패 (' + analysisRes.status + ')');
      var analysisData = await analysisRes.json();

      if (!analysisData?.ok) {
        throw new Error(analysisData?.error || '분석 실패');
      }

      var analysisResult = {
        center: { lat: lat, lng: lng },
        radius: radius,
        circleAreaM2: analysisData.circleAreaM2 || 0,
        dongs: analysisData.dongs || [],
        totals: analysisData.totals || null,
        timestamp: Date.now(),
      };

      _radiusAnalysisCache.set(cacheKey, analysisResult);
      if (_radiusAnalysisCache.size > 30) {
        var firstKey = _radiusAnalysisCache.keys().next().value;
        if (firstKey) _radiusAnalysisCache.delete(firstKey);
      }

      renderRadiusResult(resultEl, analysisResult, radius);
    } catch (err) {
      console.error('radius analysis error:', err);
      resultEl.innerHTML = '<div class="ra-error">분석 중 오류: ' + escapeHtml(err.message || '알 수 없는 오류') + '</div>';
    }
  }

  function renderRadiusResult(container, result, radius) {
    var dongs = result?.dongs || [];
    var totals = result?.totals || null;

    if (!dongs.length || !totals) {
      container.innerHTML = '<div class="ra-empty">반경 내 분석 데이터가 없습니다.</div>';
      return;
    }

    var fmtN = function(n) { return Number(n || 0).toLocaleString(); };
    var totalPop = totals.estPop || 0;
    var totalHh = totals.estHh || 0;
    var totalMale = totals.estMale || 0;
    var totalFemale = totals.estFemale || 0;
    var perHh = totalHh > 0 ? (totalPop / totalHh).toFixed(1) : '-';
    var maleRatio = totalPop > 0 ? Math.round((totalMale / totalPop) * 100) : 0;
    var circleAreaM2 = result.circleAreaM2 || 0;

    var html = '';

    // 요약 카드
    html += '<div class="ra-summary">';
    html += '<div class="ra-summary-title">반경 ' + (radius >= 1000 ? (radius / 1000) + 'km' : radius + 'm') + ' 배후 분석 결과 <span style="font-size:9px;color:var(--muted);font-weight:400;">(면적 비례 보정)</span></div>';
    html += '<div class="ra-kpi-grid">';
    html += '<div class="ra-kpi"><div class="ra-kpi-val">' + fmtN(totalPop) + '</div><div class="ra-kpi-label">추정 거주인구</div></div>';
    html += '<div class="ra-kpi"><div class="ra-kpi-val">' + fmtN(totalHh) + '</div><div class="ra-kpi-label">추정 배후세대</div></div>';
    html += '<div class="ra-kpi"><div class="ra-kpi-val">' + escapeHtml(perHh) + '</div><div class="ra-kpi-label">세대당 인구</div></div>';
    html += '<div class="ra-kpi"><div class="ra-kpi-val">' + dongs.length + '</div><div class="ra-kpi-label">포함 행정동</div></div>';
    html += '</div>';
    html += '</div>';

    // 성별 분포 바
    if (totalPop > 0) {
      html += '<div class="ra-gender-bar">';
      html += '<div class="ra-gender-track">';
      html += '<div class="ra-gender-fill ra-male" style="width:' + maleRatio + '%"></div>';
      html += '<div class="ra-gender-fill ra-female" style="width:' + (100 - maleRatio) + '%"></div>';
      html += '</div>';
      html += '<div class="ra-gender-labels">';
      html += '<span class="ra-gender-label"><span class="ra-dot ra-dot-male"></span>남 ' + fmtN(totalMale) + '명 (' + maleRatio + '%)</span>';
      html += '<span class="ra-gender-label"><span class="ra-dot ra-dot-female"></span>여 ' + fmtN(totalFemale) + '명 (' + (100 - maleRatio) + '%)</span>';
      html += '</div>';
      html += '</div>';
    }

    // 행정동별 상세 (면적비율 포함)
    var dongDetails = dongs.filter(function(d) { return (d.estPop || 0) > 0; });
    dongDetails.sort(function(a, b) { return (b.estPop || 0) - (a.estPop || 0); });

    if (dongDetails.length > 0) {
      html += '<div class="ra-dong-list">';
      html += '<div class="ra-dong-header"><span>행정동</span><span>추정인구</span><span>면적비</span></div>';
      var maxPop = dongDetails[0].estPop || 1;
      dongDetails.forEach(function(d) {
        var barPct = Math.max(4, Math.round(((d.estPop || 0) / maxPop) * 100));
        var ratioStr = d.areaRatio != null ? (d.areaRatio * 100).toFixed(1) + '%' : '-';
        html += '<div class="ra-dong-row">';
        html += '<span class="ra-dong-name">' + escapeHtml(d.name || '?') + '</span>';
        html += '<span class="ra-dong-pop">';
        html += '<span class="ra-dong-bar-track"><span class="ra-dong-bar-fill" style="width:' + barPct + '%"></span></span>';
        html += '<span class="ra-dong-num">' + fmtN(d.estPop) + '</span>';
        html += '</span>';
        html += '<span class="ra-dong-hh">' + escapeHtml(ratioStr) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // 출처
    var dataDate = dongs.find(function(d) { return d.dataDate; })?.dataDate || '';
    html += '<div class="ra-footer">';
    html += '추정방식: 법정동 폴리곤-반경 원 교차면적 비례 보정<br>';
    html += '출처: 행안부 주민등록 인구통계 · Vworld 행정구역';
    if (dataDate) html += ' · ' + escapeHtml(dataDate);
    if (circleAreaM2 > 0) html += '<br>반경 원 면적: ' + fmtN(Math.round(circleAreaM2)) + '㎡';
    html += '</div>';

    container.innerHTML = html;
  }

  function closeMapDetail() {
    if (els.mvDetail) els.mvDetail.classList.add("hidden");
    clearRadiusCircle();
    document.querySelectorAll(".mv-marker.is-active").forEach((m) => m.classList.remove("is-active"));
    document.querySelectorAll(".mv-card.is-selected").forEach((c) => c.classList.remove("is-selected"));
  }

  // ---- 인구 데이터 (Supabase Edge Function 프록시 경유) ----
  const _popCache = new Map();

  const DONG_CODE_MAP = {
    '역삼동':'1168010100','삼성동':'1168010300','대치동':'1168010500','논현동':'1168010800',
    '압구정동':'1168011000','청담동':'1168011100','신사동':'1168011200','도곡동':'1168010600',
    '개포동':'1168010700','세곡동':'1168010900',
    '서초동':'1165010100','반포동':'1165010400','잠원동':'1165010500','방배동':'1165010700',
    '양재동':'1165010800','내곡동':'1165011000',
    '잠실동':'1171010100','신천동':'1171010200','가락동':'1171010300','문정동':'1171010600',
    '방이동':'1171010800','오금동':'1171010900','석촌동':'1171010400',
    '영등포동':'1156010100','여의도동':'1156010400','당산동':'1156010500','문래동':'1156010200',
    '양평동':'1156010700','신길동':'1156010800','대림동':'1156010900',
    '서교동':'1144010600','합정동':'1144010500','상수동':'1144010700','망원동':'1144010800',
    '연남동':'1144010900','성산동':'1144011100',
    '삼청동':'1111014000','종로동':'1111011100','사직동':'1111012500','인사동':'1111012100',
    '명동':'1114011500','회현동':'1114012400','을지로동':'1114011200',
    '이태원동':'1117010200','한남동':'1117010300','용산동':'1117010800',
    '성수동':'1120010800','금호동':'1120010100','옥수동':'1120010200',
    '자양동':'1121510200','구의동':'1121510100','화양동':'1121510300',
    '마곡동':'1150010500','등촌동':'1150010200','화곡동':'1150010300',
    '구로동':'1153010100','신도림동':'1153010300','가리봉동':'1153010200',
    '신림동':'1162010200','봉천동':'1162010100',
    '노량진동':'1159010100','상도동':'1159010300',
    '천호동':'1174010100','길동':'1174010500','명일동':'1174010300',
    '상계동':'1135010100','공릉동':'1135010300',
    '불광동':'1138010100','갈현동':'1138010200',
    '연희동':'1141010100','신촌동':'1141010700',
    '전농동':'1123010100','답십리동':'1123010300',
    '정릉동':'1129010800','길음동':'1129010600',
    '목동':'1147010100','신정동':'1147010200',
    '가산동':'1154510100','독산동':'1154510200',
    '창동':'1132010200','방학동':'1132010100',
    '면목동':'1126010100','상봉동':'1126010200',
    '미아동':'1130510100','번동':'1130510200',
    '정자동':'4113510900','서현동':'4113510700','수내동':'4113510600',
    '야탑동':'4113510300','이매동':'4113510400','판교동':'4113511200',
    '인계동':'4111110700','매탄동':'4111110600',
    '일산동':'4128110300','풍동':'4128510100',
    '송도동':'2826010500','부평동':'2823710100',
  };

  function extractDongFromAddress(address) {
    const a = String(address || "").trim();
    if (!a) return "";
    const m = a.match(/([가-힣0-9]+동)\b/);
    return m ? m[1] : "";
  }

  function getPopProxyUrl() {
    const meta = document.querySelector('meta[name="pop-proxy-url"]');
    return meta?.getAttribute("content")?.trim() || "";
  }

  function parsePopulationXml(xmlText) {
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xmlText)) !== null) {
      const b = m[1];
      const g = (t) => { const r = b.match(new RegExp("<" + t + ">([^<]*)</" + t + ">")); return r ? r[1].trim() : ""; };
      items.push({
        statsYm: g("statsYm"), ctpvNm: g("ctpvNm"), sggNm: g("sggNm"),
        stdgNm: g("stdgNm"), admmCd: g("admmCd"), stdgCd: g("stdgCd"),
        totNmprCnt: g("totNmprCnt"), hhCnt: g("hhCnt"),
        maleNmprCnt: g("maleNmprCnt"), femlNmprCnt: g("femlNmprCnt"),
      });
    }
    return items;
  }

  function aggregatePopulationItems(items, dongCode) {
    if (!items.length) return null;
    let totalPop = 0, hhCount = 0, malePop = 0, femalePop = 0;
    let regionName = "", dongName = "";
    for (const r of items) {
      totalPop += parseInt(r.totNmprCnt || 0, 10) || 0;
      hhCount += parseInt(r.hhCnt || 0, 10) || 0;
      malePop += parseInt(r.maleNmprCnt || 0, 10) || 0;
      femalePop += parseInt(r.femlNmprCnt || 0, 10) || 0;
      if (!regionName && r.ctpvNm) regionName = (r.ctpvNm + " " + (r.sggNm || "")).trim();
      if (!dongName && r.stdgNm) dongName = r.stdgNm;
    }
    return {
      region_name: regionName, dong_name: dongName, dong_code: dongCode,
      total_pop: totalPop, household_count: hhCount,
      male_pop: malePop, female_pop: femalePop,
      data_date: items[0]?.statsYm || "", source: "api",
    };
  }

  async function fetchPopulationData(dongName) {
    if (!dongName) return null;
    if (_popCache.has(dongName)) return _popCache.get(dongName);

    const proxyUrl = getPopProxyUrl();
    if (!proxyUrl) return null;

    const dongCode = DONG_CODE_MAP[dongName];
    if (!dongCode) return null;

    // 3~6개월 전 후보 시도
    const candidates = [];
    const now = new Date();
    for (let offset = 3; offset <= 6; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      candidates.push(String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0"));
    }

    for (const ym of candidates) {
      try {
        const url = proxyUrl + "?stdgCd=" + dongCode
          + "&srchFrYm=" + ym + "&srchToYm=" + ym
          + "&lv=4&regSeCd=1&numOfRows=100&pageNo=1";

        // Supabase Edge Function은 anon key 인증 필요
        const anonKey = document.querySelector('meta[name="supabase-anon-key"]')?.getAttribute("content") || "";
        const fetchOpts = anonKey ? { headers: { "Authorization": "Bearer " + anonKey } } : {};

        const res = await fetch(url, fetchOpts);
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || text.length < 50) continue;

        const codeMatch = text.match(/<resultCode>([^<]*)<\/resultCode>/);
        if (codeMatch && codeMatch[1] !== "0") continue;

        const items = parsePopulationXml(text);
        const data = aggregatePopulationItems(items, dongCode);
        if (data && data.total_pop > 0) {
          _popCache.set(dongName, data);
          return data;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function getKakaoKey() {
    const meta = document.querySelector('meta[name="kakao-app-key"]');
    const key = meta?.getAttribute("content")?.trim();
    return key || "";
  }

  function loadKakaoSdk(appKey) {
    return new Promise((resolve, reject) => {
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve());
        return;
      }
      const s = document.createElement("script");
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
      s.async = true;
      s.onload = () => {
        if (!window.kakao?.maps?.load) { reject(new Error("Kakao SDK 로드 실패")); return; }
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
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) return cached;
    const pos = await geocodeAddress(a);
    if (pos) { state.geoCache[key] = pos; saveGeoCache(state.geoCache); }
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
    return String(v || "").toLowerCase().replace(/\s+/g, " ").replace(/[(),]/g, "").trim();
  }

  // ---- API (GET preflight 최소화) ----
  async function api(path, options = {}) {
    if (sharedApi) return sharedApi(path, options);
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
    const n = Shared && typeof Shared.toNumber === "function"
      ? Shared.toNumber(v)
      : (K && typeof K.toNumber === "function" ? K.toNumber(v) : Number(String(v ?? "").replace(/[^0-9.-]/g, "")));
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoneyEok(n) {
    if (window.KNSN_PROPERTY_RENDERERS && typeof window.KNSN_PROPERTY_RENDERERS.formatMoneyEok === 'function') {
      return window.KNSN_PROPERTY_RENDERERS.formatMoneyEok(n, '-');
    }
    const num = Number(n || 0);
    if (!Number.isFinite(num) || num <= 0) return "-";
    const eok = num / 100000000;
    const fixed = eok.toFixed(2);
    return `${fixed.replace(/\.00$/, "")} 억원`;
  }

  function fitTextHtml(value, sm = 10, xs = 18, micro = 30) {
    const text = String(value == null ? "-" : value);
    const len = text.replace(/\s+/g, "").length;
    let cls = "fit-text";
    if (len >= micro) cls += " fit-micro";
    else if (len >= xs) cls += " fit-xs";
    else if (len >= sm) cls += " fit-sm";
    return `<span class="${cls}">${escapeHtml(text)}</span>`;
  }

  function formatScheduleHtml(p) {
    if (window.KNSN_PROPERTY_RENDERERS && typeof window.KNSN_PROPERTY_RENDERERS.formatScheduleHtml === 'function') {
      return window.KNSN_PROPERTY_RENDERERS.formatScheduleHtml(p, { rawKeys: ['입찰일자', '입찰마감일시'] });
    }
    const rawValue = p?.bidDate || p?.raw?.["입찰일자"] || p?.raw?.["입찰마감일시"] || "";
    const display = formatShortDate(rawValue) || String(rawValue || "").trim();
    const dday = computeDdayLabel(rawValue);
    const dateText = display || '-';
    return `<span class="schedule-stack"><span class="schedule-date">${escapeHtml(dateText)}</span>${dday ? `<span class="schedule-dday">${escapeHtml(dday)}</span>` : `<span class="schedule-dday schedule-dday-empty"></span>`}</span>`;
  }

  function computeDdayLabel(value) {
    const d = parseFlexibleDate(value);
    if (!d) return "";
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((target - startToday) / 86400000);
    if (diff === 0) return "D-Day";
    if (diff > 0) return `D-${diff}`;
    return `D+${Math.abs(diff)}`;
  }

  function parseFlexibleDate(value) {
    if (Shared && typeof Shared.parseFlexibleDate === "function") return Shared.parseFlexibleDate(value);
    const s = String(value || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (m) return new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatShortDate(v) {
    if (window.KNSN_PROPERTY_RENDERERS && typeof window.KNSN_PROPERTY_RENDERERS.formatDateValue === 'function') {
      const full = window.KNSN_PROPERTY_RENDERERS.formatDateValue(v, '');
      return full ? full.slice(2) : '';
    }
    if (!v) return "";
    const d = parseFlexibleDate(v);
    if (!d) return String(v);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function escapeHtml(v) {
    if (KNSN_PROPERTY_RENDERERS && typeof KNSN_PROPERTY_RENDERERS.escapeHtml === 'function') return KNSN_PROPERTY_RENDERERS.escapeHtml(v);
    if (Shared && typeof Shared.escapeHtml === "function") return Shared.escapeHtml(v);
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(v) {
    if (KNSN_PROPERTY_RENDERERS && typeof KNSN_PROPERTY_RENDERERS.escapeAttr === 'function') return KNSN_PROPERTY_RENDERERS.escapeAttr(v);
    if (Shared && typeof Shared.escapeAttr === "function") return Shared.escapeAttr(v);
    return escapeHtml(v);
  }

  function debounce(fn, wait = 200) {
    if (Shared && typeof Shared.debounce === "function") return Shared.debounce(fn, wait);
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
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

  function clearSession() {
    if (Shared && typeof Shared.clearSession === "function") Shared.clearSession();
    else {
      try { sessionStorage.removeItem(SESSION_KEY); } catch {}
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    }
    state.session = null;
  }


  async function logoutNow({ redirect = true } = {}) {
    // Supabase 사용 시 supabase.auth 세션도 같이 종료해야 로그아웃이 유지됩니다.
    try {
      if (K && typeof K.supabaseEnabled === "function" && K.supabaseEnabled() && K.initSupabase() && typeof K.sbHardSignOut === "function") {
        await K.sbHardSignOut();
      } else if (typeof K.sbSignOut === "function") {
        await K.sbSignOut();
      }
    } catch {}
    clearSession();
    if (redirect) redirectToLogin(true, { logout: true });
  }

  function redirectToLogin(replace = false, opts = {}) {
    const extra = opts && opts.logout ? "&logout=1" : "";
    const url = `./login.html?next=${encodeURIComponent("./index.html")}${extra}`;
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
