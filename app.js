(() => {
  "use strict";

  // ---- Config ----
  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function") ? window.KNSN.getApiBase() : "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const GEO_CACHE_KEY = "knson_geo_cache_v1";

  // ---- State ----
  const state = {
    session: loadSession(),
    items: [],
    view: "text", // text | map
    source: "all", // all | auction | onbid | realtor | general
    keyword: "",
    status: "",

    // kakao
    kakaoReady: null,
    map: null,
    geocoder: null,
    markers: [],
    geoCache: loadGeoCache(),
    staffAssignments: [],
    page: 1,
    pageSize: 30,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
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
    els.statRealtor = document.getElementById("statRealtor");
    els.statGeneral = document.getElementById("statGeneral");

    els.statTotalCard = document.getElementById("statTotalCard");
    els.statAuctionCard = document.getElementById("statAuctionCard");
    els.statGongmaeCard = document.getElementById("statGongmaeCard");
    els.statRealtorCard = document.getElementById("statRealtorCard");
    els.statGeneralCard = document.getElementById("statGeneralCard");

    // Views
    els.tabText = document.getElementById("tabText");
    els.tabMap = document.getElementById("tabMap");
    els.textView = document.getElementById("textView");
    els.mapView = document.getElementById("mapView");

    // Filters (map sidebar only)
    els.agentChart = document.getElementById("agentChart");
    els.agentChartEmpty = document.getElementById("agentChartEmpty");
    els.agentChartMeta = document.getElementById("agentChartMeta");

    // Stats charts
    els.inflowChart = document.getElementById("inflowChart");
    els.inflowTabs = document.getElementById("inflowTabs");
    els.sourceDistChart = document.getElementById("sourceDistChart");
    els.regionDistChart = document.getElementById("regionDistChart");
    els.typeDistChart = document.getElementById("typeDistChart");
    els.priceDistChart = document.getElementById("priceDistChart");
    els.statMenu = document.getElementById("statMenu");
    els.statTabProperties = document.getElementById("statTabProperties");
    els.statTabAgents = document.getElementById("statTabAgents");

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

    // KPI 카드 클릭 → 소스 필터 (지도 뷰에서만 작동)
    const bindCard = (el, source) => {
      if (!el) return;
      el.addEventListener("click", () => {
        state.source = source;
        renderKPIs();
        if (state.view === "map") { renderMapSidebar(); renderKakaoMarkers(); }
      });
    };

    bindCard(els.statTotalCard, "all");
    bindCard(els.statAuctionCard, "auction");
    bindCard(els.statGongmaeCard, "onbid");
    bindCard(els.statRealtorCard, "realtor");
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

    // Inflow chart period tabs
    if (els.inflowTabs) {
      els.inflowTabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".stat-period-tab");
        if (!btn) return;
        els.inflowTabs.querySelectorAll(".stat-period-tab").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        renderInflowChart(btn.dataset.period || "day");
      });
    }

    // Stat menu tabs (매물현황 / 담당자현황)
    if (els.statMenu) {
      els.statMenu.addEventListener("click", (e) => {
        const btn = e.target.closest(".stat-menu-item");
        if (!btn) return;
        els.statMenu.querySelectorAll(".stat-menu-item").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        const tab = btn.dataset.statTab;
        if (els.statTabProperties) els.statTabProperties.classList.toggle("hidden", tab !== "properties");
        if (els.statTabAgents) els.statTabAgents.classList.toggle("hidden", tab !== "agents");
      });
    }

    // Map sidebar filters
    if (els.mvKeyword) {
      els.mvKeyword.addEventListener("input", debounce((e) => {
        state.keyword = String(e.target.value || "").trim();
        if (state.view === "map") { renderMapSidebar(); renderKakaoMarkers(); }
      }, 150));
    }
    if (els.mvSourceFilter) {
      els.mvSourceFilter.addEventListener("change", (e) => {
        state.source = String(e.target.value || "") || "all";
        renderKPIs();
        if (state.view === "map") { renderMapSidebar(); renderKakaoMarkers(); }
      });
    }
    if (els.mvStatusFilter) {
      els.mvStatusFilter.addEventListener("change", (e) => {
        state.status = String(e.target.value || "");
        if (state.view === "map") { renderMapSidebar(); renderKakaoMarkers(); }
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
        if (state.view === "map" && state.map && window.kakao?.maps) {
          state.map.relayout();
        }
      }, 150)
    );
  }

  function setView(view) {
    state.view = view;
    const isMap = view === "map";

    // Body class for CSS overrides
    document.body.classList.toggle("is-map-view", isMap);

    if (els.tabText) {
      els.tabText.classList.toggle("is-active", !isMap);
      els.tabText.setAttribute("aria-selected", !isMap ? "true" : "false");
    }
    if (els.tabMap) {
      els.tabMap.classList.toggle("is-active", isMap);
      els.tabMap.setAttribute("aria-selected", isMap ? "true" : "false");
    }

    if (els.textView) els.textView.classList.toggle("hidden", isMap);
    if (els.mapView) {
      els.mapView.classList.toggle("hidden", !isMap);
      els.mapView.classList.toggle("is-active", isMap);
    }

    // Sync sidebar filters with main state
    if (isMap) {
      if (els.mvKeyword) els.mvKeyword.value = state.keyword || "";
      if (els.mvSourceFilter) els.mvSourceFilter.value = state.source === "all" ? "" : (state.source || "");
      if (els.mvStatusFilter) els.mvStatusFilter.value = state.status || "";
      renderMapSidebar();
    }
  }

  // ---- Data ----

  function rowAssignedToUid(row, uid) {
    const target = String(uid || '').trim();
    if (!target) return false;
    const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
    return [row?.assignee_id, row?.assigneeId, row?.assignedAgentId, raw.assignee_id, raw.assigneeId, raw.assignedAgentId]
      .some((v) => String(v || '').trim() === target);
  }

  async function fetchPropertiesBatch(sb, from, pageSize, { isAdmin, uid }) {
    const queryBase = () => sb.from("properties").select("*").order("date_uploaded", { ascending: false }).range(from, from + pageSize - 1);
    if (isAdmin) {
      const { data, error } = await queryBase();
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }

    const filters = [
      `assignee_id.eq.${uid},raw->>assigneeId.eq.${uid},raw->>assignedAgentId.eq.${uid},raw->>assignee_id.eq.${uid}`,
      `assignee_id.eq.${uid}`,
    ];

    let lastError = null
    for (const filter of filters) {
      const { data, error } = await queryBase().or(filter)
      if (!error) {
        const rows = Array.isArray(data) ? data : [];
        return rows.filter((row) => rowAssignedToUid(row, uid));
      }
      lastError = error;
    }
    throw lastError;
  }

  async function fetchAllPropertiesPaged(sb, { isAdmin, uid }) {
    const pageSize = 1000;
    const out = [];
    let from = 0;
    while (true) {
      const rows = await fetchPropertiesBatch(sb, from, pageSize, { isAdmin, uid });
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  async function loadProperties() {
    try {
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      let isAdmin = isAdminUser(state.session?.user);
      let staffPromise = Promise.resolve([]);

      if (sb) {
        try { await K.sbSyncLocalSession(); } catch {}
        try { state.session = loadSession(); } catch {}
        const uid = state.session?.user?.id;
        isAdmin = isAdminUser(state.session?.user);
        if (isAdmin) staffPromise = loadStaffAssignments();

        const data = await fetchAllPropertiesPaged(sb, { isAdmin, uid });
        state.items = Array.isArray(data) ? data.map(normalizeItem) : [];
      } else {
        isAdmin = isAdminUser(state.session?.user);
        if (isAdmin) staffPromise = loadStaffAssignments();
        const scope = isAdmin ? "all" : "mine";
        const res = await api(`/properties?scope=${encodeURIComponent(scope)}`, { auth: true });
        state.items = Array.isArray(res?.items) ? res.items.map(normalizeItem) : [];
      }

      try { state.staffAssignments = await staffPromise; } catch { state.staffAssignments = []; }

      renderKPIs();
      renderAgentChart();
      renderStatCharts();

      if (state.view === "map") {
        await ensureKakaoMap();
        await renderKakaoMarkers();
      }
    } catch (err) {
      console.error(err);
      state.items = [];
      renderKPIs();
      renderAgentChart();
      renderStatCharts();
      alert(err?.message || "목록을 불러오지 못했습니다.");
    }
  }

  function normalizeItem(p) {
    const raw = p?.raw && typeof p.raw === "object" ? p.raw : {};
    const rawSource = (p.sourceType || p.source_type || p.source || p.category || raw.sourceType || "").toString().toLowerCase();
    const source =
      rawSource === "auction" ? "auction" :
      rawSource === "gongmae" || rawSource === "public" || rawSource === "onbid" ? "onbid" :
      rawSource === "realtor" ? "realtor" :
      rawSource === "general" ? "general" :
      "general";

    const lat = toNullableNumber(p.latitude ?? p.lat ?? raw.latitude ?? raw.lat ?? "");
    const lng = toNullableNumber(p.longitude ?? p.lng ?? raw.longitude ?? raw.lng ?? "");
    const address = firstText(p.address, p.location, raw.address, raw.location, "");
    const priceMain = toNullableNumber(
      p.priceMain ?? p.price_main ?? raw.priceMain ?? raw.price_main ?? raw["감정가"] ?? raw["감정가(원)"] ?? p.appraisalPrice ?? p.appraisal_price ?? p.salePrice ?? p.sale_price
    );
    const lowprice =
      source === "realtor" || source === "general"
        ? null
        : toNullableNumber(
            p.lowprice ?? p.low_price ?? raw.lowprice ?? raw.low_price ?? raw["최저가"] ?? raw["최저입찰가(원)"] ?? raw["매각가"] ?? p.currentPrice ?? p.current_price ?? raw.currentPrice ?? raw.current_price
          );

    const rightsAnalysisRaw = firstText(p.rightsAnalysis, p.rights_analysis, raw.rightsAnalysis, raw.rights_analysis, "");
    const siteInspectionRaw = firstText(p.siteInspection, p.site_inspection, raw.siteInspection, raw.site_inspection, "");
    const memoText = firstText(p.memo, raw.memo, "");
    const opinionText = source === "onbid"
      ? sanitizeOnbidOpinion(firstText(p.opinion, raw.opinion, ""), memoText, address)
      : firstText(p.opinion, raw.opinion, memoText, p.comment, "");

    return {
      id: p.id || p.global_id || "",
      itemNo: firstText(p.itemNo, p.item_no, raw.itemNo, raw.item_no, ""),
      source,
      status: firstText(p.status, raw.status, ""),
      address,
      type: firstText(p.assetType, p.asset_type, p.type, p.propertyType, p.kind, raw.assetType, raw.asset_type, raw["세부유형"], "-"),
      floor: firstText(p.floor, p.floor_text, raw.floor, raw.floorText, raw["해당층"], extractFloorText(address, raw["물건명"], raw.address)),
      totalFloor: firstText(p.totalfloor, p.total_floor, raw.totalfloor, raw.total_floor, raw.totalFloor, raw["총층"], ""),
      useapproval: firstText(p.useapproval, p.use_approval, raw.useapproval, raw.use_approval, raw.useApproval, raw["사용승인일"], ""),
      exclusivearea: toNullableNumber(p.exclusivearea ?? p.exclusive_area ?? raw.exclusivearea ?? raw.exclusiveArea ?? raw["전용면적(평)"] ?? raw["전용면적"] ?? p.areaPyeong ?? p.areaPy ?? p.area ?? p.area_m2),
      commonarea: toNullableNumber(p.commonarea ?? p.common_area ?? raw.commonarea ?? raw.commonArea ?? raw["공용면적(평)"] ?? raw["공급/계약면적(평)"] ?? raw["공급면적(평)"]),
      appraisalPrice: priceMain,
      currentPrice: lowprice,
      bidDate: firstText(p.dateMain, p.date_main, raw.dateMain, raw.date_main, raw["입찰일자"], raw["입찰마감일시"], p.bidDate, p.bid_date, ""),
      createdAt: firstText(p.date, p.date_uploaded, p.createdAt, p.created_at, raw.date, raw.createdAt, ""),
      assignedAgentId: firstText(p.assignedAgentId, p.assigneeId, p.assignee_id, p.agentId, raw.assignedAgentId, raw.assigneeId, raw.assignee_id, ""),
      assignedAgentName: firstText(p.assignedAgentName, p.assigneeName, p.assignee_name, p.agentName, p.manager, raw.assignedAgentName, raw.assigneeName, raw.assignee_name, "-"),
      rightsAnalysis: rightsAnalysisRaw || ((p.analysisDone ?? p.analysis_done) ? "완료" : ""),
      siteInspection: siteInspectionRaw || ((p.siteVisit ?? p.site_visit ?? p.fieldDone ?? p.field_done) ? "완료" : ""),
      opinion: opinionText,
      statusLabel: statusLabel(firstText(p.status, raw.status, "")),
      regionGu: firstText(p.regionGu, p.region_gu, raw.regionGu, raw.region_gu, ""),
      regionDong: firstText(p.regionDong, p.region_dong, raw.regionDong, raw.region_dong, ""),
      latitude: lat,
      longitude: lng,
      // 부직센 직접 등록 여부: submitter_name 또는 broker_office_name이 있으면 부직센(일반중개)
      isDirectSubmission: !!(
        firstText(p.submitter_name, p.submitterName, raw.submitter_name, raw.submitterName, "") ||
        firstText(p.broker_office_name, p.brokerOfficeName, raw.broker_office_name, raw.brokerOfficeName, "")
      ),
      raw,
    };
  }

  function sanitizeOnbidOpinion(opinion, memo, address) {
    const addressText = String(address || "").trim();

    const cleanCandidate = (value) => {
      let text = String(value || "").trim();
      if (!text) return "";
      if (!addressText) return text;

      const compactText = text.replace(/\s+/g, "");
      const compactAddress = addressText.replace(/\s+/g, "");
      if (!compactAddress) return text;
      if (compactText === compactAddress) return "";
      if (compactText.includes(compactAddress) || compactAddress.includes(compactText)) {
        const escaped = addressText
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\s*");
        if (escaped) {
          text = text
            .replace(new RegExp(escaped, "gi"), "")
            .replace(/^[\s,;:/|·-]+|[\s,;:/|·-]+$/g, "")
            .trim();
        }
        if (!text) return "";
      }
      return text;
    };

    const explicit = cleanCandidate(opinion);
    if (explicit) return explicit;
    return cleanCandidate(memo);
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
        const hay = [p.address, p.assignedAgentName, p.regionGu, p.regionDong, p.type, p.rightsAnalysis, p.siteInspection, p.opinion]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function renderKPIs() {
    const all = state.items;

    if (els.statTotal) els.statTotal.textContent = String(all.length);
    if (els.statAuction) els.statAuction.textContent = String(all.filter((p) => p.source === "auction").length);
    if (els.statGongmae) els.statGongmae.textContent = String(all.filter((p) => p.source === "onbid").length);
    if (els.statRealtor) els.statRealtor.textContent = String(all.filter((p) => p.source === "realtor").length);
    if (els.statGeneral) els.statGeneral.textContent = String(all.filter((p) => p.source === "general").length);

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
      const [staffSettled, assignSettled] = await Promise.allSettled([
        api('/admin/staff', { auth: true }),
        api('/admin/region-assignments', { auth: true }),
      ]);

      const map = new Map();
      const staffItems = staffSettled.status === 'fulfilled' && Array.isArray(staffSettled.value?.items)
        ? staffSettled.value.items
        : [];
      const assignItems = assignSettled.status === 'fulfilled' && Array.isArray(assignSettled.value?.items)
        ? assignSettled.value.items
        : [];
      const assignById = new Map(assignItems.map((row) => [String(row?.id || '').trim(), row]));

      staffItems.forEach((row) => {
        const role = normalizeRole(row?.role);
        if (role !== 'staff') return;
        const id = String(row?.id || '').trim();
        if (!id) return;
        const assignRow = assignById.get(id);
        const name = String(row?.name || row?.email || '').trim() || `담당자 ${map.size + 1}`;
        map.set(id, {
          id,
          role: 'staff',
          email: String(row?.email || '').trim(),
          name,
          regions: normalizeAssignedRegions(assignRow?.assignedRegions || assignRow?.regions || row?.assignedRegions || row?.regions || row?.assigned_regions),
        });
      });

      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    } catch (err) {
      console.warn('loadStaffAssignments failed', err);
      return [];
    }
  }

  function normalizeRole(value) {
    if (Shared && typeof Shared.normalizeRole === 'function') return Shared.normalizeRole(value);
    const v = String(value || '').trim().toLowerCase();
    if (v === '관리자' || v === 'admin') return 'admin';
    if (v === '기타' || v === 'other') return 'other';
    return 'staff';
  }

  function normalizeAssignedRegions(values) {
    if (!Array.isArray(values)) return [];
    const out = [];
    const seen = new Set();
    for (const value of values) {
      const token = normalizeRegionToken(value);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }

  function normalizeRegionToken(value) {
    const s = String(value || '').trim().replace(/\s+/g, ' ');
    return s || '';
  }

  function extractAddressRegionParts(address) {
    const text = String(address || '').replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return { gu: '', dong: '' };
    const gu = (text.match(/[가-힣]+(?:구|군|시)/) || [])[0] || '';
    const dong = (text.match(/[가-힣0-9]+(?:동|읍|면|가)/) || [])[0] || '';
    return { gu, dong };
  }

  function getPropertyRegionTokens(row) {
    const tokens = [];
    const seen = new Set();
    const add = (v) => {
      const token = normalizeRegionToken(v);
      if (!token || seen.has(token)) return;
      seen.add(token);
      tokens.push(token);
    };
    add(row.regionGu);
    add(row.regionDong);
    const addrParts = extractAddressRegionParts(row.address);
    add(addrParts.gu);
    add(addrParts.dong);
    return tokens;
  }

  function buildAgentChartEntries(rows) {
    const staff = (Array.isArray(state.staffAssignments) ? state.staffAssignments : []).filter((row) => normalizeRole(row?.role) === 'staff');
    const byId = new Map();

    const ensureEntry = (id, name, regions = []) => {
      const key = String(id || '').trim() || String(name || '').trim();
      if (!key) return null;
      if (!byId.has(key)) {
        byId.set(key, {
          id: key,
          name: String(name || key).trim() || '담당자',
          regions: normalizeAssignedRegions(regions),
          auction: 0,
          onbid: 0,
          realtor: 0,
          general: 0,
          total: 0,
        });
      }
      const entry = byId.get(key);
      if ((!entry.name || entry.name === entry.id) && name) entry.name = String(name).trim() || entry.name;
      if ((!entry.regions || !entry.regions.length) && Array.isArray(regions) && regions.length) {
        entry.regions = normalizeAssignedRegions(regions);
      }
      return entry;
    };

    staff.forEach((staffRow) => ensureEntry(staffRow.id, staffRow.name, staffRow.regions || []));

    rows.forEach((row) => {
      let entry = null;
      const assignedId = String(row.assignedAgentId || '').trim();
      const assignedName = String(row.assignedAgentName || '').trim();
      if (assignedId && byId.has(assignedId)) {
        entry = byId.get(assignedId);
      } else if (assignedName) {
        const found = [...byId.values()].find((item) => item.name === assignedName);
        if (found) entry = found;
      }
      if (!entry) {
        const tokens = getPropertyRegionTokens(row);
        const matched = staff.find((item) => item.regions?.length && item.regions.some((region) => tokens.includes(region)));
        if (matched) entry = ensureEntry(matched.id, matched.name, matched.regions || []);
      }
      if (!entry) return;
      const src = ['auction', 'onbid', 'realtor', 'general'].includes(row.source) ? row.source : 'general';
      entry[src] = (entry[src] || 0) + 1;
      entry.total += 1;
    });

    return [...byId.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko'));
  }

  function renderAgentChart() {
    if (!els.agentChart || !els.agentChartEmpty) return;
    const rows = Array.isArray(state.items) ? state.items.slice() : [];
    const entries = buildAgentChartEntries(rows);
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

        if (p.source === "auction") sourceCount["\uACBD\uB9E4"]++;
        else if (p.source === "onbid") sourceCount["\uACF5\uB9E4"]++;
        else if (p.source === "realtor") {
          if (p.isDirectSubmission) sourceCount["\uC77C\uBC18\uC911\uAC1C"]++;
          else sourceCount["\uB124\uC774\uBC84\uC911\uAC1C"]++;
        }
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
      { label: "경매", count: items.filter((p) => p.source === "auction").length, color: "#D778F7" },
      { label: "공매", count: items.filter((p) => p.source === "onbid").length, color: "#59A7FF" },
      { label: "중개", count: items.filter((p) => p.source === "realtor").length, color: "#4AD8BA" },
      { label: "일반", count: items.filter((p) => p.source === "general").length, color: "#F6B04A" },
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
    const a = Number(appraisal || 0);
    const c = Number(current || 0);
    if (Number.isFinite(a) && Number.isFinite(c) && a > 0 && c > 0) return `${((c / a) * 100).toFixed(1)}%`;
    const rawRate = raw && (raw["최저입찰가율(%)"] || raw.bidRate || raw.rate);
    if (rawRate != null && String(rawRate).trim() !== "") return String(rawRate).trim();
    return "-";
  }

  function statusLabel(v) {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return "-";
    if (["active", "진행", "진행중", "진행중인"].includes(s)) return "진행중";
    if (["hold", "보류"].includes(s)) return "보류";
    if (["closed", "종결", "완료"].includes(s)) return "종결";
    if (["review", "검토", "검토중"].includes(s)) return "검토중";
    return String(v || "-");
  }

  function firstText(...values) {
    for (const value of values) {
      if (value == null) continue;
      const s = String(value).trim();
      if (s) return s;
    }
    return "";
  }

  function toNullableNumber(v) {
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
    if (p.latitude == null || p.longitude == null) return "";
    const label = encodeURIComponent(p.address || p.type || "매물 위치");
    return `https://map.kakao.com/link/map/${label},${p.latitude},${p.longitude}`;
  }

  function extractFloorText(...texts) {
    const joined = texts.filter(Boolean).join(" ");
    if (!joined) return "";
    const basement = joined.match(/(?:지하|제?비)(\d+)층?/);
    if (basement) return `B${basement[1]}`;
    const direct = joined.match(/(?:제)?(\d+)층/);
    if (direct) return direct[1];
    const room = joined.match(/(?:제)?(\d{1,3})호/);
    if (room) return room[1];
    return "";
  }

  // ---- Kakao Map (Enhanced) ----
  const SOURCE_COLORS = {
    auction: { bg: "rgba(215,120,247,0.88)", border: "rgba(215,120,247,0.4)", solid: "#D778F7", label: "경매", short: "경" },
    onbid:   { bg: "rgba(89,167,255,0.88)", border: "rgba(89,167,255,0.4)", solid: "#59A7FF", label: "공매", short: "공" },
    realtor: { bg: "rgba(74,216,186,0.88)", border: "rgba(74,216,186,0.4)", solid: "#4AD8BA", label: "중개", short: "중" },
    general: { bg: "rgba(246,176,74,0.88)", border: "rgba(246,176,74,0.4)", solid: "#F6B04A", label: "일반", short: "일" },
  };

  function getSourceStyle(source) { return SOURCE_COLORS[source] || SOURCE_COLORS.general; }

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

    // 맵 이동/줌 완료 시 마커 재렌더링 (뷰포트 기반)
    kakao.maps.event.addListener(state.map, "idle", debounce(() => {
      if (state.view === "map") renderKakaoMarkers();
    }, 300));
  }

  function clearMapMarkers() {
    for (const m of state.markers) { try { m.setMap(null); } catch {} }
    state.markers = [];
  }

  function createMarkerOverlay(item, position) {
    const src = getSourceStyle(item.source);

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
      openMapDetail(item);
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
    if (state.view !== "map") return;
    if (!state.map || !window.kakao?.maps) return;

    clearMapMarkers();

    const rows = getFilteredRows();
    // 좌표 있는 건만 (지오코딩 완료건)
    const withCoords = rows.filter((r) => r.latitude != null && r.longitude != null);
    if (!withCoords.length) return;

    // 현재 맵 bounds 기준 뷰포트 내 항목만 렌더링 (최대 500)
    const bounds = state.map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const inBounds = withCoords.filter((r) =>
      r.latitude >= sw.getLat() && r.latitude <= ne.getLat() &&
      r.longitude >= sw.getLng() && r.longitude <= ne.getLng()
    );

    const target = inBounds.length > 0 ? inBounds.slice(0, 500) : withCoords.slice(0, 100);

    for (const it of target) {
      const pos = new kakao.maps.LatLng(it.latitude, it.longitude);
      const overlay = createMarkerOverlay(it, pos);
      overlay.setMap(state.map);
      state.markers.push(overlay);
    }

    // 사이드바도 업데이트
    renderMapSidebar();
  }

  function renderMapSidebar() {
    if (!els.mvPropertyList) return;

    const rows = getFilteredRows();
    const withCoords = rows.filter((r) => r.latitude != null && r.longitude != null);

    els.mvPropertyList.innerHTML = "";
    if (!withCoords.length) {
      els.mvPropertyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">표시할 매물이 없습니다.</div>';
      renderMapSummary(0);
      return;
    }

    const frag = document.createDocumentFragment();
    const max = Math.min(withCoords.length, 300);
    for (let i = 0; i < max; i++) {
      const p = withCoords[i];
      frag.appendChild(createSidebarCard(p));
    }
    els.mvPropertyList.appendChild(frag);
    renderMapSummary(withCoords.length);
  }

  function createSidebarCard(p) {
    const src = getSourceStyle(p.source);
    const kindLabel = src.label;
    const appraisal = p.appraisalPrice != null ? formatMoneyEok(p.appraisalPrice) : "";
    const current = p.currentPrice != null ? formatMoneyEok(p.currentPrice) : "";
    const rate = calcRate(p.appraisalPrice, p.currentPrice, p.raw);

    const card = document.createElement("div");
    card.className = "mv-card";
    card.setAttribute("data-id", p.id || "");

    let priceHtml = "";
    if (p.source === "auction" || p.source === "onbid") {
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

    card.innerHTML =
      '<div class="mv-card-top">' +
        '<span class="mv-badge mv-badge-' + p.source + '">' + escapeHtml(kindLabel) + '</span>' +
      '</div>' +
      '<div class="mv-card-addr">' + escapeHtml(p.address || "-") + '</div>' +
      '<div class="mv-card-info">' + escapeHtml((p.type || "") + (p.floor ? " · " + p.floor + "층" : "") + (p.exclusivearea != null ? " · 전용 " + formatAreaPyeong(p.exclusivearea) + "평" : "")) + '</div>' +
      priceHtml;

    card.addEventListener("click", () => {
      openMapDetail(p);
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
    const rows = state.items;
    const auction = rows.filter((r) => r.source === "auction").length;
    const onbid = rows.filter((r) => r.source === "onbid").length;
    const realtor = rows.filter((r) => r.source === "realtor").length;
    const general = rows.filter((r) => r.source === "general").length;
    els.mvSummary.innerHTML =
      '<span>전체 <strong>' + total + '</strong>건</span>' +
      '<span>경매 <strong>' + auction + '</strong></span>' +
      '<span>공매 <strong>' + onbid + '</strong></span>' +
      '<span>중개 <strong>' + realtor + '</strong></span>' +
      '<span>일반 <strong>' + general + '</strong></span>';
  }

  // ---- Map Detail Popup ----
  function openMapDetail(item) {
    if (!els.mvDetail || !els.mvDetailGrade || !els.mvDetailBody) return;

    const src = getSourceStyle(item.source);
    els.mvDetailGrade.innerHTML =
      '<span class="mv-detail-source-badge mv-badge-' + item.source + '" style="font-size:12px;padding:3px 10px;">' + escapeHtml(src.label) + '</span>';

    const appraisal = item.appraisalPrice != null ? formatMoneyEok(item.appraisalPrice) : "-";
    const current = item.currentPrice != null ? formatMoneyEok(item.currentPrice) : "-";
    const rate = calcRate(item.appraisalPrice, item.currentPrice, item.raw);
    const bidDate = formatShortDate(item.bidDate) || "-";
    const dday = computeDdayLabel(item.bidDate);

    // 감정가대비 계산 (경매/공매만)
    let appraisalGapHtml = "";
    if ((item.source === "auction" || item.source === "onbid") && item.appraisalPrice && item.currentPrice) {
      const gap = ((item.currentPrice - item.appraisalPrice) / item.appraisalPrice * 100).toFixed(1);
      appraisalGapHtml =
        '<div class="mv-detail-dual-sep"></div>' +
        '<div class="mv-detail-dual-item">' +
          '<span class="label">감정가대비</span>' +
          '<span class="val" style="color:#59A7FF">' + gap + '%</span>' +
        '</div>';
    }

    let body = '';

    // 기본 정보
    body += '<div class="mv-detail-addr">' + escapeHtml(item.address || "-") + '</div>';
    body += '<div class="mv-detail-sub">' +
      escapeHtml((item.type || "-") + (item.floor ? " · " + item.floor + "층" : "") + (item.totalFloor ? "/" + item.totalFloor + "층" : "") +
        (item.exclusivearea != null ? " · 전용 " + formatAreaPyeong(item.exclusivearea) + "평" : "")) + '<br/>' +
      escapeHtml("감정가 " + appraisal + (current !== "-" ? " → 현재가 " + current : "") + (rate !== "-" ? " (" + rate + ")" : "")) +
      (dday ? " · " + escapeHtml(dday) : "") + '<br/>' +
      escapeHtml("담당자: " + (item.assignedAgentName || "-")) +
      '</div>';

    // A. 가격 분석
    body += '<div class="mv-detail-section">';
    body += '<div class="mv-detail-stitle">A. 가격 분석</div>';
    if (appraisalGapHtml) {
      body += '<div class="mv-detail-dual">' +
        '<div class="mv-detail-dual-item"><span class="label">비율</span><span class="val" style="color:#F37022">' + escapeHtml(rate) + '</span></div>' +
        appraisalGapHtml +
        '</div>';
    }
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">감정가(매각가)</span><span class="mv-detail-rv">' + escapeHtml(appraisal) + '</span></div>';
    if (item.source === "auction" || item.source === "onbid") {
      body += '<div class="mv-detail-row"><span class="mv-detail-rl">현재가격</span><span class="mv-detail-rv">' + escapeHtml(current) + '</span></div>';
    }
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">주요일정</span><span class="mv-detail-rv">' + escapeHtml(bidDate) + (dday ? ' <span style="color:#F37022;font-size:10px;">' + escapeHtml(dday) + '</span>' : '') + '</span></div>';
    body += '</div>';

    // B. 물건 정보
    body += '<div class="mv-detail-section">';
    body += '<div class="mv-detail-stitle">B. 물건 정보</div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">유형</span><span class="mv-detail-rv">' + escapeHtml(item.type || "-") + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">층수</span><span class="mv-detail-rv">' + escapeHtml((item.floor || "-") + (item.totalFloor ? " / " + item.totalFloor + "층" : "")) + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">전용면적</span><span class="mv-detail-rv">' + (item.exclusivearea != null ? escapeHtml(formatAreaPyeong(item.exclusivearea) + " 평") : "-") + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">사용승인일</span><span class="mv-detail-rv">' + escapeHtml(formatShortDate(item.useapproval) || "-") + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">진행상태</span><span class="mv-detail-rv">' + escapeHtml(item.statusLabel || "-") + '</span></div>';
    body += '</div>';

    // C. 권리분석/현장실사/의견
    body += '<div class="mv-detail-section">';
    body += '<div class="mv-detail-stitle">C. 검토 현황</div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">권리분석</span><span class="mv-detail-rv">' + (item.rightsAnalysis ? '<span class="positive">✓ 완료</span>' : '-') + '</span></div>';
    body += '<div class="mv-detail-row"><span class="mv-detail-rl">현장실사</span><span class="mv-detail-rv">' + (item.siteInspection ? '<span class="positive">✓ 완료</span>' : '-') + '</span></div>';
    if (item.opinion) {
      body += '<div style="margin-top:6px;font-size:11px;color:var(--muted);line-height:1.5;word-break:keep-all;">' +
        '<strong style="color:var(--text)">의견:</strong> ' + escapeHtml(item.opinion) + '</div>';
    }
    body += '</div>';

    // D. 위치
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
    els.mvDetail.classList.remove("hidden");
  }

  function closeMapDetail() {
    if (els.mvDetail) els.mvDetail.classList.add("hidden");
    document.querySelectorAll(".mv-marker.is-active").forEach((m) => m.classList.remove("is-active"));
    document.querySelectorAll(".mv-card.is-selected").forEach((c) => c.classList.remove("is-selected"));
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
    if (Shared && typeof Shared.toNumber === "function") {
      const n = Shared.toNumber(v);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoneyEok(n) {
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
    if (!v) return "";
    const d = parseFlexibleDate(v);
    if (!d) return String(v);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function escapeHtml(v) {
    if (Shared && typeof Shared.escapeHtml === "function") return Shared.escapeHtml(v);
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(v) {
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
