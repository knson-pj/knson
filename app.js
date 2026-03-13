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
    source: "all", // all | auction | onbid | realtor | general
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

  const K = window.KNSN || null;

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
    // 브라우저 종료 시에는 sessionStorage 기반 세션이 자동으로 종료됩니다.
    // 내부 이동/새로고침 시 예기치 않은 로그아웃을 막기 위해 pagehide 강제 로그아웃은 사용하지 않습니다.
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

  async function fetchAllPropertiesPaged(sb, { isAdmin, uid }) {
    const pageSize = 1000;
    const out = [];
    let from = 0;
    while (true) {
      let q = sb.from("properties").select("*").order("date_uploaded", { ascending: false }).range(from, from + pageSize - 1);
      if (!isAdmin) q = q.eq("assignee_id", uid);
      const { data, error } = await q;
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  async function loadProperties() {
    try {
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      const user = state.session?.user;

      if (sb) {
        try { await K.sbSyncLocalSession(); } catch {}
        try { state.session = loadSession(); } catch {}
        const uid = state.session?.user?.id;
        const isAdmin = isAdminUser(state.session?.user);

        const data = await fetchAllPropertiesPaged(sb, { isAdmin, uid });
        state.items = Array.isArray(data) ? data.map(normalizeItem) : [];
      } else {
        const scope = isAdminUser(state.session.user) ? "all" : "mine";
        const res = await api(`/properties?scope=${encodeURIComponent(scope)}`, { auth: true });
        state.items = Array.isArray(res?.items) ? res.items.map(normalizeItem) : [];
      }

      renderKPIs();
      renderTable();

      if (state.view === "map") {
        await ensureKakaoMap();
        await renderKakaoMarkers();
      }
      closeFilter();
    } catch (err) {
      console.error(err);
      state.items = [];
      renderKPIs();
      renderTable();
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
      p.priceMain ?? p.price_main ?? raw.priceMain ?? raw.price_main ?? p.appraisalPrice ?? p.appraisal_price ?? p.salePrice ?? p.sale_price
    );
    const lowprice =
      source === "realtor" || source === "general"
        ? null
        : toNullableNumber(
            p.lowprice ?? p.low_price ?? raw.lowprice ?? raw.low_price ?? p.currentPrice ?? p.current_price ?? raw.currentPrice ?? raw.current_price
          );

    const rightsAnalysisRaw = firstText(p.rightsAnalysis, p.rights_analysis, raw.rightsAnalysis, raw.rights_analysis, "");
    const siteInspectionRaw = firstText(p.siteInspection, p.site_inspection, raw.siteInspection, raw.site_inspection, "");

    return {
      id: p.id || p.global_id || "",
      itemNo: firstText(p.itemNo, p.item_no, raw.itemNo, raw.item_no, ""),
      source,
      status: firstText(p.status, raw.status, ""),
      address,
      type: firstText(p.assetType, p.asset_type, p.type, p.propertyType, p.kind, raw.assetType, raw.asset_type, raw["세부유형"], "-"),
      floor: firstText(p.floor, p.floor_text, raw.floor, raw.floorText, extractFloorText(address, raw["물건명"], raw.address)),
      totalFloor: firstText(p.totalfloor, p.total_floor, raw.totalfloor, raw.total_floor, raw.totalFloor, ""),
      useapproval: firstText(p.useapproval, p.use_approval, raw.useapproval, raw.use_approval, raw.useApproval, ""),
      exclusivearea: toNullableNumber(p.exclusivearea ?? p.exclusive_area ?? raw.exclusivearea ?? raw.exclusiveArea ?? raw["전용면적(평)"] ?? p.areaPyeong ?? p.areaPy ?? p.area ?? p.area_m2),
      commonarea: toNullableNumber(p.commonarea ?? p.common_area ?? raw.commonarea ?? raw.commonArea ?? raw["공용면적(평)"]),
      appraisalPrice: priceMain,
      currentPrice: lowprice,
      bidDate: firstText(p.dateMain, p.date_main, raw.dateMain, raw.date_main, p.bidDate, p.bid_date, ""),
      createdAt: firstText(p.date, p.date_uploaded, p.createdAt, p.created_at, raw.date, raw.createdAt, ""),
      assignedAgentName: firstText(p.assignedAgentName, p.assigneeName, p.assignee_name, p.agentName, p.manager, raw.assignedAgentName, raw.assigneeName, raw.assignee_name, "-"),
      rightsAnalysis: rightsAnalysisRaw || ((p.analysisDone ?? p.analysis_done) ? "완료" : ""),
      siteInspection: siteInspectionRaw || ((p.siteVisit ?? p.site_visit ?? p.fieldDone ?? p.field_done) ? "완료" : ""),
      opinion: firstText(p.opinion, raw.opinion, p.memo, raw.memo, p.comment, ""),
      statusLabel: statusLabel(firstText(p.status, raw.status, "")),
      regionGu: firstText(p.regionGu, p.region_gu, raw.regionGu, raw.region_gu, ""),
      regionDong: firstText(p.regionDong, p.region_dong, raw.regionDong, raw.region_dong, ""),
      latitude: lat,
      longitude: lng,
      raw,
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

  function renderTable() {
    if (!els.tableBody) return;

    const rows = getFilteredRows();
    els.tableBody.innerHTML = "";

    if (!rows.length) {
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
    const kindClass = p.source === "auction" ? "kind-auction" : p.source === "onbid" ? "kind-gongmae" : p.source === "realtor" ? "kind-realtor" : "kind-general";
    const kindLabel = p.source === "auction" ? "경매" : p.source === "onbid" ? "공매" : p.source === "realtor" ? "중개" : "일반";
    const appraisal = p.appraisalPrice != null ? formatMoneyEok(p.appraisalPrice) : "-";
    const current = p.currentPrice != null ? formatMoneyEok(p.currentPrice) : "-";
    const rate = calcRate(p.appraisalPrice, p.currentPrice);
    const moveLink = buildKakaoMapLink(p);
    const locationCell = moveLink
      ? `<a class="map-link" href="${escapeAttr(moveLink)}" target="_blank" rel="noopener noreferrer">이동</a>`
      : "-";

    tr.innerHTML = `
      <td class="kind-chip ${kindClass}">${escapeHtml(kindLabel)}</td>
      <td>${escapeHtml(p.statusLabel || "-")}</td>
      <td class="text-cell">${escapeHtml(p.address || "-")}</td>
      <td>${escapeHtml(p.type || "-")}</td>
      <td>${escapeHtml(String(p.floor || "-"))}</td>
      <td>${escapeHtml(String(p.totalFloor || "-"))}</td>
      <td>${escapeHtml(formatShortDate(p.useapproval) || "-")}</td>
      <td>${p.exclusivearea != null ? escapeHtml(formatAreaPyeong(p.exclusivearea)) : "-"}</td>
      <td>${escapeHtml(appraisal)}</td>
      <td>${escapeHtml(current)}</td>
      <td>${escapeHtml(rate)}</td>
      <td>${escapeHtml(formatShortDate(p.bidDate) || "-")}</td>
      <td>${locationCell}</td>
      <td>${escapeHtml(formatShortDate(p.createdAt) || "-")}</td>
      <td>${escapeHtml(p.assignedAgentName || "-")}</td>
      <td class="text-cell">${escapeHtml(p.rightsAnalysis || "-")}</td>
      <td class="text-cell">${escapeHtml(p.siteInspection || "-")}</td>
      <td class="text-cell opinion-cell">${escapeHtml(p.opinion || "-")}</td>
    `;

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
    const a = Number(appraisal || 0);
    const c = Number(current || 0);
    if (!Number.isFinite(a) || !Number.isFinite(c) || a <= 0 || c <= 0) return "-";
    return `${((c / a) * 100).toFixed(1)}%`;
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
    const valid = rows.filter((r) => (r.address || "").trim().length > 0 || (r.latitude != null && r.longitude != null));
    if (!valid.length) return;

    let firstPos = null;

    for (const it of valid.slice(0, 200)) {
      const pos = (it.latitude != null && it.longitude != null) ? { lat: it.latitude, lng: it.longitude } : await geocodeCached(it.address);
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

  function escapeAttr(v) {
    return escapeHtml(v);
  }

  function escapeAttr(v) {
    return escapeHtml(v);
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
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { localStorage.removeItem(SESSION_KEY); } catch {}
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
