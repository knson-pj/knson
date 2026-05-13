/* ═══════════════════════════════════════════════════
   agent-app.js  —  담당자 전용 페이지 (배정된 물건 관리)
   ═══════════════════════════════════════════════════ */
(function () {
  "use strict";

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const PropertyRenderers = window.KNSN_PROPERTY_RENDERERS || null;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function toUserErrorMessage(err, fallback = "요청 처리 중 오류가 발생했습니다.") {
    const raw = String(err?.message || err || "").trim();
    if (!raw) return fallback;
    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(raw)) return "네트워크 연결 또는 서버 응답에 실패했습니다.";
    if (/not allowed|forbidden|permission/i.test(raw)) return "권한이 없어 요청을 처리할 수 없습니다.";
    if (/schema cache|column .* does not exist|does not exist/i.test(raw)) return "서버 스키마 반영이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
    return raw;
  }

  function loadSession() { return (Shared && typeof Shared.loadSession === "function") ? Shared.loadSession() : (K ? K.loadSession() : null); }
  function isSupabaseMode() { return !!(K && K.supabaseEnabled && K.supabaseEnabled()); }
  const API_BASE = K && typeof K.getApiBase === "function" ? K.getApiBase() : "https://knson.vercel.app/api";
  const sharedApiJson = (Shared && typeof Shared.createApiClient === "function")
    ? Shared.createApiClient({
        baseUrl: API_BASE,
        getAuthToken: () => getSessionToken(),
        ensureAuthToken: async () => {
          if (isSupabaseMode() && K && typeof K.sbSyncLocalSession === "function") {
            try { await K.sbSyncLocalSession(); } catch {}
            state.session = loadSession() || state.session;
          }
          return getSessionToken();
        },
        networkErrorFactory: (fetchErr) => {
          const detail = String(fetchErr?.message || "").trim();
          const err = new Error(detail ? `네트워크 연결 또는 서버 응답에 실패했습니다. (${detail})` : "네트워크 연결 또는 서버 응답에 실패했습니다.");
          err.cause = fetchErr;
          return err;
        },
      })
    : null;

  const parseFlexibleNumber = (PropertyRenderers && typeof PropertyRenderers.parseFlexibleNumber === "function")
    ? PropertyRenderers.parseFlexibleNumber
    : (Shared && typeof Shared.parseFlexibleNumber === "function")
    ? Shared.parseFlexibleNumber
    : function parseFlexibleNumber(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        const s = String(value).trim();
        if (!s) return null;
        const n = Number(s.replace(/,/g, ""));
        return Number.isFinite(n) ? n : null;
      };

  const formatMoneyInputValue = (PropertyRenderers && typeof PropertyRenderers.formatMoneyInputValue === "function")
    ? PropertyRenderers.formatMoneyInputValue
    : (Shared && typeof Shared.formatMoneyInputValue === "function")
    ? Shared.formatMoneyInputValue
    : function formatMoneyInputValue(value) {
        if (value === null || value === undefined) return "";
        const raw = String(value).trim();
        if (!raw) return "";
        const digits = raw.replace(/[^\d-]/g, "");
        if (!digits || digits === "-") return "";
        const sign = digits.startsWith("-") ? "-" : "";
        const body = digits.replace(/-/g, "");
        if (!body) return sign;
        return sign + body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      };

  const bindAmountInputMask = (PropertyRenderers && typeof PropertyRenderers.bindAmountInputMask === "function")
    ? PropertyRenderers.bindAmountInputMask
    : (Shared && typeof Shared.bindAmountInputMask === "function")
    ? Shared.bindAmountInputMask
    : function bindAmountInputMask(input) {
        if (!input || input.dataset.amountMaskBound === "true") return;
        input.dataset.amountMaskBound = "true";
        input.addEventListener("input", () => {
          const formatted = formatMoneyInputValue(input.value);
          if (input.value !== formatted) input.value = formatted;
        });
        input.addEventListener("blur", () => {
          input.value = formatMoneyInputValue(input.value);
        });
      };

  const configureFreeDecimalInput = (PropertyRenderers && typeof PropertyRenderers.configureFreeDecimalInput === "function")
    ? PropertyRenderers.configureFreeDecimalInput
    : (Shared && typeof Shared.configureFreeDecimalInput === "function")
    ? Shared.configureFreeDecimalInput
    : function configureFreeDecimalInput(input) {
        if (!input) return;
        input.setAttribute("type", "text");
        input.setAttribute("inputmode", "decimal");
        input.removeAttribute("step");
      };

  const configureAmountInput = (PropertyRenderers && typeof PropertyRenderers.configureAmountInput === "function")
    ? PropertyRenderers.configureAmountInput
    : (Shared && typeof Shared.configureAmountInput === "function")
    ? Shared.configureAmountInput
    : function configureAmountInput(input) {
        if (!input) return;
        input.setAttribute("type", "text");
        input.setAttribute("inputmode", "numeric");
        input.removeAttribute("step");
        bindAmountInputMask(input);
      };

  const configureFormNumericUx = (PropertyRenderers && typeof PropertyRenderers.configureFormNumericUx === "function")
    ? PropertyRenderers.configureFormNumericUx
    : (Shared && typeof Shared.configureFormNumericUx === "function")
    ? Shared.configureFormNumericUx
    : function configureFormNumericUx(form, options = {}) {
        if (!form?.elements) return;
        const decimalNames = Array.isArray(options.decimalNames) ? options.decimalNames : [];
        const amountNames = Array.isArray(options.amountNames) ? options.amountNames : [];
        decimalNames.forEach((name) => configureFreeDecimalInput(form.elements[name]));
        amountNames.forEach((name) => configureAmountInput(form.elements[name]));
      };

  const FAVS_KEY_PREFIX = "knson_favs_v1_";
  const FIRES_KEY_PREFIX = "knson_fires_v1_";
  const DAILY_REPORT_NOTE_PREFIX = "knson_daily_report_note_v1_";

  function getFavsKey() {
    const uid = state.session?.user?.id || state.session?.user?.email || "guest";
    return FAVS_KEY_PREFIX + uid;
  }
  function getFiresKey() {
    const uid = state.session?.user?.id || state.session?.user?.email || "guest";
    return FIRES_KEY_PREFIX + uid;
  }

  // localStorage 캐시 (초기 표시용, 진실은 DB)
  function loadFavoritesCache() {
    try {
      const raw = localStorage.getItem(getFavsKey());
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }

  function saveFavoritesCache() {
    try {
      localStorage.setItem(getFavsKey(), JSON.stringify([...state.favorites]));
    } catch {}
  }

  function loadFiresCache() {
    try {
      const raw = localStorage.getItem(getFiresKey());
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }

  function saveFiresCache() {
    try {
      localStorage.setItem(getFiresKey(), JSON.stringify([...state.fires]));
    } catch {}
  }

  // 최초 로드: localStorage 우선 (즉시 UI), DB 에서 동기화 (뒤에서)
  function loadFavorites() {
    return loadFavoritesCache();
  }
  function loadFires() {
    return loadFiresCache();
  }

  // DB 에서 ★/🔥 목록 조회 → state.favorites / state.fires 갱신 (kind 분리)
  async function syncFavoritesFromDb() {
    try {
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) return false;
      const uid = String(state.session?.user?.id || "").trim();
      if (!uid) return false;
      const { data, error } = await sb
        .from('user_favorites')
        .select('property_id, kind')
        .eq('user_id', uid);
      if (error) { console.warn('favorites load failed', error); return false; }
      const starIds = new Set();
      const fireIds = new Set();
      (Array.isArray(data) ? data : []).forEach((r) => {
        const pid = String(r?.property_id || '').trim();
        if (!pid) return;
        const kind = String(r?.kind || 'star').trim().toLowerCase();
        if (kind === 'fire') fireIds.add(pid);
        else starIds.add(pid); // 기본 'star' (kind 컬럼이 없거나 비정상값이면 star 로 간주)
      });
      state.favorites = starIds;
      state.fires = fireIds;
      saveFavoritesCache();
      saveFiresCache();
      return true;
    } catch (e) {
      console.warn('syncFavoritesFromDb error', e);
      return false;
    }
  }

  // localStorage → DB 1회 마이그레이션 (최초 1번만, ★ 만 대상)
  async function migrateLocalFavoritesToDb() {
    try {
      const migKey = 'knson_favs_migrated_v1_' + (state.session?.user?.id || state.session?.user?.email || 'guest');
      if (localStorage.getItem(migKey) === '1') return;
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) return;
      const uid = String(state.session?.user?.id || "").trim();
      if (!uid) return;
      const local = loadFavoritesCache();
      if (!local.size) { localStorage.setItem(migKey, '1'); return; }
      const rows = [...local].map((pid) => ({ user_id: uid, property_id: String(pid), kind: 'star' }));
      // upsert (이미 있는 건 무시)
      const { error } = await sb.from('user_favorites').upsert(rows, { onConflict: 'user_id,property_id', ignoreDuplicates: true });
      if (!error) localStorage.setItem(migKey, '1');
    } catch (e) {
      console.warn('migrateLocalFavoritesToDb error', e);
    }
  }

  // ★ / 🔥 토글: DB upsert/delete + 낙관적 UI 업데이트
  // kind = 'star' | 'fire'  (★과 🔥는 상호 배타 — 같은 물건에 둘 다 걸 수 없음)
  function toggleFavorite(id, kind = 'star') {
    const pid = String(id || '').trim();
    if (!pid) return;
    const targetKind = (kind === 'fire') ? 'fire' : 'star';
    const mySet = (targetKind === 'fire') ? state.fires : state.favorites;
    const otherSet = (targetKind === 'fire') ? state.favorites : state.fires;
    const willAdd = !mySet.has(pid);
    // 1) 낙관적 UI 업데이트 (같은 kind 면 toggle, 다른 kind 에 이미 있었다면 제거)
    const hadOther = otherSet.has(pid);
    if (willAdd) {
      mySet.add(pid);
      if (hadOther) otherSet.delete(pid); // 배타
    } else {
      mySet.delete(pid);
    }
    saveFavoritesCache();
    saveFiresCache();
    // 2) DB 동기화 (비동기, 실패 시 롤백)
    (async () => {
      try {
        const sb = isSupabaseMode() ? K.initSupabase() : null;
        if (!sb) return;
        const uid = String(state.session?.user?.id || "").trim();
        if (!uid) return;
        if (willAdd) {
          // 먼저 기존(어떤 kind든) 삭제 → 새 kind 로 insert (배타 보장)
          const delRes = await sb.from('user_favorites')
            .delete()
            .eq('user_id', uid)
            .eq('property_id', pid);
          if (delRes.error) throw delRes.error;
          const insRes = await sb.from('user_favorites')
            .insert({ user_id: uid, property_id: pid, kind: targetKind });
          if (insRes.error) throw insRes.error;
        } else {
          // 해제: 해당 kind 만 정확히 삭제
          const { error } = await sb.from('user_favorites')
            .delete()
            .eq('user_id', uid)
            .eq('property_id', pid)
            .eq('kind', targetKind);
          if (error) throw error;
        }
      } catch (e) {
        console.warn('toggleFavorite DB sync failed, rolling back', e);
        // 롤백
        if (willAdd) {
          mySet.delete(pid);
          if (hadOther) otherSet.add(pid);
        } else {
          mySet.add(pid);
        }
        saveFavoritesCache();
        saveFiresCache();
        try { renderTable(); } catch {}
      }
    })();
  }

  const state = {
    session: loadSession(),
    properties: [],
    favorites: new Set(),           // 즐겨찾기(★, kind='star') property id 집합
    fires: new Set(),               // 강추매물(🔥, kind='fire') property id 집합 — ★과 배타
    filters: {
      activeCard: "",
      status: "",
      keyword: "",
      area: "",
      priceRange: "",
      ratio50: "",
      favOnly: false,
      fireOnly: false,        // 🔥 강추매물만
      todayBid: false,        // 당일 입찰기일 필터
      todayAssigned: false,   // 오늘 내게 배정된 물건만 (A 버튼)
    },
    page: 1,
    pageSize: 30,
    propertySort: { key: '', direction: 'desc' },
    listViewMode: 'list',  // 'list' | 'map' — 전체리스트 보기 방식 (2026-05-13)
    editingProperty: null,
    dailyReport: {
      dateKey: "",
      counts: { total: 0, rightsAnalysis: 0, siteInspection: 0, dailyIssue: 0, newProperty: 0 },
      loadedAt: 0,
      loading: false,
      selectedPropertyKey: "",
    },
  };

  const loadingState = { activeKeys: new Set(), messages: new Map() };

  const els = {};

  const SOURCE_FILTER_OPTIONS = (PropertyDomain && Array.isArray(PropertyDomain.PROPERTY_SOURCE_FILTER_OPTIONS) ? PropertyDomain.PROPERTY_SOURCE_FILTER_OPTIONS : [
    { value: '', label: '전체' },
    { value: 'auction', label: '경매' },
    { value: 'onbid', label: '공매' },
    { value: 'realtor_naver', label: '네이버중개' },
    { value: 'realtor_direct', label: '일반중개' },
    { value: 'general', label: '일반' },
  ]);

  const AREA_FILTER_OPTIONS = (PropertyDomain && Array.isArray(PropertyDomain.PROPERTY_AREA_FILTER_OPTIONS) ? PropertyDomain.PROPERTY_AREA_FILTER_OPTIONS : [
    { value: '', label: '전체 면적' },
    { value: '0-5', label: '5평 미만' },
    { value: '5-10', label: '5~10평' },
    { value: '10-20', label: '10~20평' },
    { value: '20-30', label: '20~30평' },
    { value: '30-50', label: '30~50평' },
    { value: '50-100', label: '50평~100평미만' },
    { value: '100-', label: '100평 이상' },
  ]);

  const PRICE_FILTER_OPTIONS = (PropertyDomain && Array.isArray(PropertyDomain.PROPERTY_PRICE_FILTER_OPTIONS) ? PropertyDomain.PROPERTY_PRICE_FILTER_OPTIONS : [
    { value: '', label: '전체 가격' },
    { value: '0-1', label: '1억 미만' },
    { value: '1-3', label: '1~3억' },
    { value: '3-5', label: '3~5억' },
    { value: '5-10', label: '5~10억' },
    { value: '10-20', label: '10~20억' },
    { value: '20-', label: '20억 이상' },
  ]);

  const RATIO_FILTER_OPTIONS = (PropertyDomain && Array.isArray(PropertyDomain.PROPERTY_RATIO_FILTER_OPTIONS) ? PropertyDomain.PROPERTY_RATIO_FILTER_OPTIONS : [
    { value: '', label: '전체 비율' },
    { value: '50', label: '50% 이하' },
  ]);

  function isPlainSourceFilterSelected(value) {
    if (PropertyRenderers && typeof PropertyRenderers.isPlainSourceFilterSelected === 'function') {
      return PropertyRenderers.isPlainSourceFilterSelected(value);
    }
    const key = String(value || '').trim();
    return key === 'realtor_naver' || key === 'realtor_direct' || key === 'general';
  }

  function truncateAddressText(value, maxLength = 30) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    const limit = Number(maxLength || 0);
    if (!text) return '';
    if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
    return `${text.slice(0, limit)}...`;
  }

  function renderAgentPropertiesHead(usePlainLayout) {
    const headRow = els.agPropertiesHeadRow || document.getElementById('agPropertiesHeadRow');
    if (!headRow) return;
    headRow.innerHTML = usePlainLayout
      ? `
        <th class="fav-col"></th>
        <th>물건번호</th><th>구분</th><th>주소</th><th>유형</th>
        <th>층수</th><th>전용면적(평)</th><th>계약면적(평)</th><th>토지면적(평)</th><th>사용승인</th>
        <th class="sortable-th" data-agent-sort="priceMain">감정가(매각가)</th><th>진행상태</th><th>담당자 의견</th><th>현장실사</th><th>등록일</th>
      `
      : `
        <th class="fav-col"></th>
        <th>물건번호</th><th>구분</th><th>주소</th><th>유형</th>
        <th>층수</th><th>전용면적(평)</th>
        <th class="sortable-th" data-agent-sort="priceMain">감정가(매각가)</th><th class="sortable-th" data-agent-sort="currentPrice">현재가격</th><th class="sortable-th" data-agent-sort="ratio">비율</th>
        <th>주요일정</th><th>진행상태</th><th>담당자 의견</th><th>현장실사</th><th>등록일</th>
      `;
    bindAgentSortHeaders();
  }

  function getAgentSortValue(row, sortKey) {
    if (sortKey === 'priceMain') return Number(row?.priceMain || 0) || 0;
    if (sortKey === 'currentPrice') return Number(row?.lowprice ?? row?.priceMain ?? 0) || 0;
    if (sortKey === 'ratio') {
      var base = Number(row?.priceMain || 0) || 0;
      var cur = Number(row?.lowprice ?? row?.priceMain ?? 0) || 0;
      return base > 0 ? cur / base : 0;
    }
    return 0;
  }

  function applyAgentPropertySort(rows) {
    var sortKey = String(state.propertySort?.key || '').trim();
    if (!sortKey) return rows;
    var dir = String(state.propertySort?.direction || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    var sorted = rows.slice();
    sorted.sort(function(a, b) {
      var av = getAgentSortValue(a, sortKey);
      var bv = getAgentSortValue(b, sortKey);
      if (bv === av) return 0;
      return (bv > av ? 1 : -1) * dir;
    });
    return sorted;
  }

  function bindAgentSortHeaders() {
    var headers = document.querySelectorAll('[data-agent-sort]');
    headers.forEach(function(th) {
      if (th.dataset.boundAgSort === '1') return;
      th.dataset.boundAgSort = '1';
      th.addEventListener('click', function() {
        var key = String(th.dataset.agentSort || '').trim();
        if (!key) return;
        var prev = state.propertySort || {};
        if (prev.key === key) {
          state.propertySort = { key: key, direction: prev.direction === 'desc' ? 'asc' : 'desc' };
        } else {
          state.propertySort = { key: key, direction: 'desc' };
        }
        headers.forEach(function(node) {
          var isMe = node === th;
          node.classList.toggle('is-active', isMe);
          node.classList.toggle('sort-asc', isMe && state.propertySort.direction === 'asc');
        });
        state.page = 1;
        renderTable();
      });
    });
    headers.forEach(function(node) {
      var isMe = node.dataset.agentSort === String(state.propertySort?.key || '');
      node.classList.toggle('is-active', isMe);
      node.classList.toggle('sort-asc', isMe && String(state.propertySort?.direction || '') === 'asc');
    });
  }

  // ── Init ──
  function init() {
    cacheEls();
    configureFormNumericUx(els.newPropertyForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain"] });
    bindEvents();
    setupChrome();
    // 모바일/데스크톱 경계(768px) 교차 시 테이블 재렌더 (카드 ↔ 테이블 전환)
    let _lastMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 768px)').matches : false;
    let _rerenderT = null;
    window.addEventListener('resize', function(){
      if (_rerenderT) clearTimeout(_rerenderT);
      _rerenderT = setTimeout(function(){
        const nowMobile = window.matchMedia('(max-width: 768px)').matches;
        if (nowMobile !== _lastMobile) {
          _lastMobile = nowMobile;
          if (typeof renderTable === 'function') { try { renderTable(); } catch(_){} }
        }
        // 카카오맵 크기 재계산 (스케쥴 뷰의 지도 컨테이너가 모바일/데스크톱에서 높이 다름)
        try {
          if (_scheduleState && _scheduleState.map && typeof _scheduleState.map.relayout === 'function') {
            _scheduleState.map.relayout();
            // 마커/bounds 재설정
            if (typeof sch_renderMap === 'function') sch_renderMap();
          }
        } catch(_){}
      }, 180);
    });
    ensureLoginThenLoad();
  }

  function cacheEls() {
    els.agentUserBadge = $("#agentUserBadge");
    els.btnAgentLogout = $("#btnAgentLogout");
    els.btnChangeMyPassword = $("#btnChangeMyPassword");
    els.btnDailyReport = $("#btnDailyReport");
    els.globalMsg = $("#globalMsg");
    els.adminLoadingOverlay = $("#adminLoadingOverlay");
    els.adminLoadingLabel = $("#adminLoadingLabel");

    els.dailyReportModal = $("#dailyReportModal");
    els.dailyReportClose = $("#dailyReportClose");
    els.dailyReportDone = $("#dailyReportDone");
    els.dailyReportTotal = $("#dailyReportTotal");
    els.dailyReportLead = $("#dailyReportLead");
    els.dailyReportFlow = $("#dailyReportFlow");
    els.dailyReportNote = $("#dailyReportNote");

    // Summary
    els.agSumTotal = $("#agSumTotal");
    els.agSumAuction = $("#agSumAuction");
    els.agSumGongmae = $("#agSumGongmae");
    els.agSumNaverRealtor = $("#agSumNaverRealtor");
    els.agSumDirectRealtor = $("#agSumDirectRealtor");
    els.agSumGeneral = $("#agSumGeneral");
    els.agHomeProgressAuction = $("#agHomeProgressAuction");
    els.agHomeProgressOnbid = $("#agHomeProgressOnbid");
    els.agHomeProgressNaver = $("#agHomeProgressNaver");
    els.agHomeProgressDirect = $("#agHomeProgressDirect");
    els.agHomeProgressGeneral = $("#agHomeProgressGeneral");
    els.agTodayAssignedTotal = $("#agTodayAssignedTotal");
    els.agTodayAssignedAuction = $("#agTodayAssignedAuction");
    els.agTodayAssignedOnbid = $("#agTodayAssignedOnbid");
    els.agTodayAssignedNaver = $("#agTodayAssignedNaver");
    els.agTodayAssignedDirect = $("#agTodayAssignedDirect");
    els.agTodayAssignedGeneral = $("#agTodayAssignedGeneral");
    els.agTodayAssignedDetail = $("#agTodayAssignedDetail");

    // 내 관리율 카드 (2026-05-08)
    els.agMyRatioCard      = $("#agMyRatioCard");
    els.agMyRatioTotal     = $("#agMyRatioTotal");
    els.agMyRatioManaged   = $("#agMyRatioManaged");
    els.agMyRatioPercent   = $("#agMyRatioPercent");
    els.agMyRatioNew       = $("#agMyRatioNew");
    els.agMyRatioUpdate    = $("#agMyRatioUpdate");
    els.agMyRatioIssue     = $("#agMyRatioIssue");
    els.agMyRatioSiteinsp  = $("#agMyRatioSiteinsp");
    els.agMyRatioOpinion   = $("#agMyRatioOpinion");
    els.agMyRatioPhoto     = $("#agMyRatioPhoto");
    els.agMyRatioVideo     = $("#agMyRatioVideo");

    // Table
    els.agTableBody = $("#agTableBody");
    els.agEmpty = $("#agEmpty");
    els.agPagination = $("#agPagination");

    // List/Map view toggle (2026-05-13 신규)
    els.agViewToggle = $("#agViewToggle");
    els.agListMapWrap = $("#agListMapWrap");
    els.agMapContainer = $("#agMapContainer");
    els.agMapEmpty = $("#agMapEmpty");
    els.agMapWarnBadge = $("#agMapWarnBadge");
    els.agMapWarnCount = $("#agMapWarnCount");
    els.agMapEmptyState = $("#agMapEmptyState");

    // Filters
    els.agSourceFilter = $("#agSourceFilter");
    els.agAreaFilter = $("#agAreaFilter");
    els.agPriceFilter = $("#agPriceFilter");
    els.agRatioFilter = $("#agRatioFilter");
    els.agKeyword = $("#agKeyword");
    els.agFavFilter = $("#agFavFilter");
    els.agFireFilter = $("#agFireFilter");
    els.agDayFilter = $("#agDayFilter");
    els.agAssignedFilter = $("#agAssignedFilter");
    els.btnNewProperty = $("#btnNewProperty");
    els.newPropertyModal = $("#newPropertyModal");
    els.npmClose = $("#npmClose");
    els.npmCancel = $("#npmCancel");
    els.newPropertyForm = $("#newPropertyForm");
    els.npmSave = $("#npmSave");
    els.npmMsg = $("#npmMsg");
    els.npmRealtorFields = $("#npmRealtorFields");
    els.npmOwnerFields = $("#npmOwnerFields");
    els.npmDupPreview = $("#npmDupPreview");

    // Edit modal
    els.agEditModal = $("#agEditModal");
    els.agEditForm = $("#agEditForm");
    els.agEditClose = $("#agEditClose");
    els.agEditCancel = $("#agEditCancel");
    els.agEditSave = $("#agEditSave");
    els.agEditMsg = $("#agEditMsg");
    els.agHistoryList = $("#agHistoryList");
    els.agRegistrationLogList = $("#agRegistrationLogList");
    els.agCombinedLogList = $("#agCombinedLogList");
    els.agEditTabs = $$("#agEditForm [data-edit-tab]");
    els.agEditSections = $$("#agEditForm [data-edit-section]");

    // Password modal
    els.pwdModal = $("#passwordChangeModal");
    els.pwdForm = $("#passwordChangeForm");
    els.pwdClose = $("#pwdModalClose");
    els.pwdCancel = $("#pwdCancel");
    els.pwdMsg = $("#pwdMsg");
  }

  function getTodayDateKey(input) {
    const d = input ? new Date(input) : new Date();
    if (!d || Number.isNaN(d.getTime())) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(d);
      const year = parts.find((p) => p.type === "year")?.value || "";
      const month = parts.find((p) => p.type === "month")?.value || "";
      const day = parts.find((p) => p.type === "day")?.value || "";
      return year && month && day ? `${year}-${month}-${day}` : "";
    } catch {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  function getDailyReportNoteKey() {
    const uid = state.session?.user?.id || state.session?.user?.email || "guest";
    return `${DAILY_REPORT_NOTE_PREFIX}${uid}_${getTodayDateKey()}`;
  }

  function loadDailyReportNote() {
    try {
      return String(localStorage.getItem(getDailyReportNoteKey()) || "");
    } catch {
      return "";
    }
  }

  function saveDailyReportNote(value) {
    try {
      localStorage.setItem(getDailyReportNoteKey(), String(value || ""));
    } catch {}
  }

  function getActorIdentity(user) {
    if (PropertyDomain && typeof PropertyDomain.getActorIdentity === "function") {
      return PropertyDomain.getActorIdentity(user);
    }
    return {
      id: String(user?.id || user?.email || "").trim(),
      name: String(user?.name || user?.email || "").trim(),
    };
  }

  const DAILY_REPORT_ACTION_KEYS = {
    rightsAnalysis: "rights_analysis",
    siteInspection: "site_inspection",
    dailyIssue: "daily_issue",
    opinion: "opinion",
    newProperty: "new_property",
  };

  function emptyDailyReportCounts() {
    return { total: 0, rightsAnalysis: 0, siteInspection: 0, dailyIssue: 0, opinion: 0, newProperty: 0 };
  }

  function getSessionToken() {
    return String(state.session?.token || "").trim();
  }

  function extractApiErrorText(data, status) {
    const parts = [];
    const push = (value) => {
      const text = String(value || "").trim();
      if (!text) return;
      if (parts.includes(text)) return;
      parts.push(text);
    };

    if (data && typeof data === "object") {
      push(data.message);
      const details = data.details;
      if (typeof details === "string") {
        push(details);
      } else if (details && typeof details === "object") {
        push(details.message);
        push(details.hint);
        push(details.details);
        push(details.error_description);
        push(details.error);
      }
    } else {
      push(data);
    }

    if (!parts.length) push(`요청 실패 (${status})`);
    return toUserErrorMessage(parts.join("\n"), `요청 실패 (${status})`);
  }

  async function apiJson(path, options = {}) {
    if (sharedApiJson) {
      const data = await sharedApiJson(path, {
        method: options.method || (options.json !== undefined ? "POST" : "GET"),
        headers: options.headers || {},
        json: options.json,
        auth: options.auth !== false,
      });
      if (data?.ok === false) {
        const err = new Error(extractApiErrorText(data, 200));
        err.serverData = data;
        err.serverCode = (data && typeof data === "object") ? (data.code || null) : null;
        err.serverDebug = (data && typeof data === "object") ? (data.debug || null) : null;
        throw err;
      }
      return data;
    }
    const base = API_BASE;
    const token = getSessionToken();
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.json !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${base}${path}`, {
      method: options.method || (options.json !== undefined ? "POST" : "GET"),
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
    if (!res.ok || data?.ok === false) {
      const err = new Error(extractApiErrorText(data, res.status));
      err.serverData = data;
      err.httpStatus = res.status;
      err.serverCode = (data && typeof data === "object") ? (data.code || null) : null;
      err.serverDebug = (data && typeof data === "object") ? (data.debug || null) : null;
      throw err;
    }
    return data;
  }

  async function api(path, options = {}) {
    return apiJson(path, {
      method: options.method || (options.body !== undefined || options.json !== undefined ? "POST" : "GET"),
      headers: options.headers || {},
      auth: options.auth !== false,
      json: options.body !== undefined ? options.body : options.json,
    });
  }

  function setGlobalMsg(text, isError = true) {
    if (!els.globalMsg) return;
    if (PropertyRenderers && typeof PropertyRenderers.setTextMessage === 'function') {
      PropertyRenderers.setTextMessage(els.globalMsg, text, {
        isError,
        applyColor: false,
        resetStyle: true,
      });
      if (!isError && String(text || '').trim()) els.globalMsg.style.color = 'var(--text)';
      return;
    }
    const msg = String(text || "").trim();
    if (!msg) {
      els.globalMsg.classList.add("hidden");
      els.globalMsg.textContent = "";
      els.globalMsg.style.color = "";
      return;
    }
    els.globalMsg.textContent = msg;
    els.globalMsg.classList.remove("hidden");
    if (isError) {
      els.globalMsg.style.color = "";
      els.globalMsg.style.borderColor = "";
      els.globalMsg.style.background = "";
    } else {
      els.globalMsg.style.color = "var(--text)";
    }
  }

  function setAgentLoading(key, active, text = "데이터를 불러오는 중입니다.") {
    const targetKey = String(key || "global").trim() || "global";
    if (!els.adminLoadingOverlay) return;
    if (active) {
      loadingState.activeKeys.add(targetKey);
      loadingState.messages.set(targetKey, String(text || "데이터를 불러오는 중입니다."));
    } else {
      loadingState.activeKeys.delete(targetKey);
      loadingState.messages.delete(targetKey);
    }
    const visible = loadingState.activeKeys.size > 0;
    const keys = Array.from(loadingState.activeKeys);
    const currentText = visible
      ? String(loadingState.messages.get(keys[keys.length - 1]) || text || "데이터를 불러오는 중입니다.")
      : "데이터를 불러오는 중입니다.";
    if (els.adminLoadingLabel) els.adminLoadingLabel.textContent = currentText;
    els.adminLoadingOverlay.classList.toggle("hidden", !visible);
    els.adminLoadingOverlay.setAttribute("aria-busy", visible ? "true" : "false");
  }

  let agentSaveFlashTimer = null;
  function flashAgentSaveNotice(text, duration = 1500) {
    const msg = String(text || '').trim();
    if (!msg) return;
    window.clearTimeout(agentSaveFlashTimer);
    setAgentLoading('flashSaveNotice', true, msg);
    agentSaveFlashTimer = window.setTimeout(() => {
      setAgentLoading('flashSaveNotice', false);
    }, Number(duration) > 0 ? Number(duration) : 1500);
  }

  async function refreshDailyReportSummary(options = {}) {
    const dateKey = String(options.dateKey || getTodayDateKey()).trim();
    if (!dateKey) return state.dailyReport.counts || emptyDailyReportCounts();
    if (state.dailyReport.loading && !options.force) return state.dailyReport.counts || emptyDailyReportCounts();
    if (!options.force && state.dailyReport?.dateKey === dateKey && Array.isArray(state.dailyReport?.items)) {
      return state.dailyReport.counts || emptyDailyReportCounts();
    }
    state.dailyReport.loading = true;
    const showLoading = options.silent !== true;
    if (showLoading) setAgentLoading("daily-report", true, "일일업무일지를 불러오는 중입니다.");
    try {
      const includeAssignedFallback = options.includeAssignedFallback === true;
      const data = await DataAccess.fetchDailyReportViaApi(api, { dateKey, auth: true, includeAssignedFallback });
      const nextCounts = { ...emptyDailyReportCounts(), ...(data?.counts || {}) };
      state.dailyReport = {
        ...state.dailyReport,
        dateKey,
        counts: nextCounts,
        items: Array.isArray(data?.items) ? data.items : [],
        loadedAt: Date.now(),
        loading: false,
      };
      renderDailyReport();
      return nextCounts;
    } catch (err) {
      state.dailyReport.loading = false;
      if (!options.silent) throw err;
      return state.dailyReport.counts || emptyDailyReportCounts();
    } finally {
      if (showLoading) setAgentLoading("daily-report", false);
    }
  }

  function getDailyReportActorName() {
    return String(state.session?.user?.name || state.session?.user?.email || "나").trim() || "나";
  }

  function getPropertyBucket(itemOrRow, fallbackSourceType) {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === "function") {
      return PropertyDomain.getSourceBucket(
        itemOrRow || { sourceType: fallbackSourceType },
        String(fallbackSourceType || itemOrRow?.sourceType || itemOrRow?.property_source_type || "").trim()
      );
    }
    const source = String(fallbackSourceType || itemOrRow?.sourceType || itemOrRow?.property_source_type || "").trim();
    return source || "general";
  }

  function getPropertyKindLabel(sourceType, itemOrRow = null) {
    const bucket = getPropertyBucket(itemOrRow, sourceType);
    if (PropertyDomain && typeof PropertyDomain.getSourceBucketLabel === "function") {
      return PropertyDomain.getSourceBucketLabel(bucket);
    }
    const map = {
      auction: "경매",
      onbid: "공매",
      realtor_naver: "네이버중개",
      realtor_direct: "일반중개",
      realtor: "중개",
      general: "일반",
    };
    return map[String(bucket || "").trim()] || "일반";
  }

  function getPropertyKindClass(sourceType, itemOrRow = null) {
    const bucket = getPropertyBucket(itemOrRow, sourceType);
    if (PropertyDomain && typeof PropertyDomain.getSourceBucketClass === "function") {
      return PropertyDomain.getSourceBucketClass(bucket);
    }
    const map = {
      auction: "auction",
      onbid: "onbid",
      realtor_naver: "realtor-naver",
      realtor_direct: "realtor-direct",
      realtor: "realtor",
      general: "general",
    };
    return map[String(bucket || "").trim()] || "general";
  }


  function getSubmitterDisplayLabel(itemOrRow = null) {
    if (!itemOrRow) return '소유자/일반';
    // raw 가 저장된 여러 가능한 위치 모두 체크 (경매/공매/중개 경로별로 다를 수 있음)
    const candidateContainers = [
      itemOrRow?._raw?.raw,  // 일반 케이스
      itemOrRow?._raw,        // raw 중첩 없는 경우
      itemOrRow?.raw,         // 최상위 raw
      itemOrRow,              // 직접 item 객체
    ].filter((c) => c && typeof c === 'object');

    // 1순위: 명시적 플래그 (신규 업로드부터 자동 부착됨)
    for (const c of candidateContainers) {
      if (c.registeredByAdmin === true) return '관리자';
      if (c.registeredByAgent === true) return '담당자';
    }

    // 2순위: registrationLog 의 첫 created 엔트리 actorRole (레거시 호환)
    for (const c of candidateContainers) {
      const logs = Array.isArray(c.registrationLog) ? c.registrationLog : null;
      if (!logs) continue;
      const firstCreated = logs.find((e) => e && e.type === 'created');
      const logRole = String(firstCreated?.actorRole || '').trim().toLowerCase();
      if (logRole === 'admin') return '관리자';
      if (logRole === 'staff' || logRole === 'agent') return '담당자';
    }

    // 3순위: 등록 경로 (registrationLog.route) 로 추론.
    //   registrationLog 가 오래전에 쌓여서 actorRole 이 빈 경우를 구제.
    //   "CSV 업로드" 문자열이 포함된 route 는 관리자 업로드로 간주.
    for (const c of candidateContainers) {
      const logs = Array.isArray(c.registrationLog) ? c.registrationLog : null;
      if (!logs) continue;
      const firstCreated = logs.find((e) => e && e.type === 'created');
      const route = String(firstCreated?.route || '').trim();
      if (route.includes('CSV') || route.includes('csv') || route.includes('업로드')) return '관리자';
    }

    // 4순위: submitter_type 기반 (공인중개사 vs 소유자/일반)
    const submitterType = String(
      itemOrRow?.submitterType || itemOrRow?.submitter_type
      || candidateContainers.find((c) => c.submitter_type || c.submitterType)?.submitter_type
      || candidateContainers.find((c) => c.submitter_type || c.submitterType)?.submitterType
      || ''
    ).trim().toLowerCase();
    if (submitterType === 'realtor') return '공인중개사';

    // 5순위: 경매/공매 구분이면 대부분 관리자 업로드.
    //   (경매/공매는 담당자가 수동 등록하는 케이스가 드물고, CSV 업로드 외 진입 경로가 사실상 없음)
    const sourceType = String(
      itemOrRow?.sourceType || itemOrRow?.source_type
      || candidateContainers.find((c) => c.source_type || c.sourceType)?.source_type
      || candidateContainers.find((c) => c.source_type || c.sourceType)?.sourceType
      || ''
    ).trim().toLowerCase();
    if (sourceType === 'auction' || sourceType === 'onbid') return '관리자';

    return '소유자/일반';
  }


  function setAgentEditMsg(text, isError = true) {
    if (!els.agEditMsg) return;
    if (PropertyRenderers && typeof PropertyRenderers.setFeedbackBoxMessage === 'function') {
      PropertyRenderers.setFeedbackBoxMessage(els.agEditMsg, text, { kind: isError ? 'error' : 'success' });
      return;
    }
    els.agEditMsg.innerHTML = '';
  }

  function refreshAgentPropertiesInBackground(options = {}) {
    Promise.resolve()
      .then(() => loadProperties({ silent: options.silent !== false }))
      .catch((err) => console.warn('agent properties refresh failed', err));
  }

  function findPropertyForActivityRow(row) {
    const propertyId = String(row?.property_id || "").trim();
    const propertyItemNo = String(row?.property_item_no || "").trim();
    const propertyAddress = String(row?.property_address || "").trim();
    const identityKey = String(row?.property_identity_key || "").trim();
    return state.properties.find((item) => {
      const raw = item?._raw || {};
      const rawInner = raw?.raw || {};
      return (
        (propertyId && [item.id, item.globalId, raw.id, raw.global_id].map((v) => String(v || "").trim()).includes(propertyId)) ||
        (propertyItemNo && String(item.itemNo || "").trim() === propertyItemNo) ||
        (propertyAddress && String(item.address || "").trim() === propertyAddress) ||
        (identityKey && String(rawInner.registrationIdentityKey || "").trim() === identityKey)
      );
    }) || null;
  }

  function groupDailyReportItems(items) {
    const groups = [];
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach((row) => {
      const key = String(row?.property_id || row?.property_identity_key || row?.property_item_no || row?.property_address || row?.id || "").trim();
      if (!key) return;
      let group = map.get(key);
      if (!group) {
        const matched = findPropertyForActivityRow(row);
        group = {
          key,
          item: matched,
          row,
          counts: { rights_analysis: 0, site_inspection: 0, daily_issue: 0, opinion: 0, new_property: 0 },
        };
        map.set(key, group);
        groups.push(group);
      }
      const action = String(row?.action_type || "").trim();
      if (group.counts[action] !== undefined) group.counts[action] += 1;
    });
    return groups;
  }

  function buildDailyReportPropertyTitle(group) {
    const item = group?.item;
    const row = group?.row || {};
    const address = String(item?.address || row?.property_address || "-").trim();
    const floor = String(item?.floor || "").trim();
    const area = item?.exclusivearea != null && item?.exclusivearea !== "" ? `${fmtArea(item.exclusivearea)}평` : "";
    const meta = [floor, area].filter(Boolean).join(" | ");
    return meta ? `${address} | ${meta}` : address;
  }

  function getDailyReportRowKey(row) {
    return String(row?.property_id || row?.property_identity_key || row?.property_item_no || row?.property_address || row?.id || "").trim();
  }

  function getDailyLogContent(row, matched) {
    const note = String(row?.note || '').trim();
    if (note) return note;
    const raw = matched?._raw?.raw || {};
    const action = String(row?.action_type || '').trim();
    if (action === 'rights_analysis') {
      return firstText(matched?.rightsAnalysis, raw.rightsAnalysis, raw.rights_analysis, '입력 내용 없음');
    }
    if (action === 'site_inspection') {
      return firstText(matched?.siteInspection, raw.siteInspection, raw.site_inspection, '입력 내용 없음');
    }
    if (action === 'daily_issue') {
      return firstText(matched?.dailyIssue, raw.dailyIssue, raw.daily_issue, '입력 내용 없음');
    }
    if (action === 'opinion') {
      return firstText(matched?.opinion, raw.opinion, raw.memo, '입력 내용 없음');
    }
    if (action === 'new_property') {
      return firstText(raw.opinion, raw.memo, matched?.opinion, '신규 등록');
    }
    const changed = Array.isArray(row?.changed_fields) ? row.changed_fields.map((v) => String(v || '').trim()).filter(Boolean) : [];
    return changed.length ? changed.join(', ') : '입력 내용 없음';
  }


  function renderDailyReport() {
    const counts = state.dailyReport?.counts || emptyDailyReportCounts();
    const total = Number(counts.total || 0);
    if (els.dailyReportTotal) els.dailyReportTotal.textContent = String(total);
    if (els.dailyReportLead) {
      els.dailyReportLead.textContent = `금일은 총 ${total}건 정보를 수정등록 하셨네요.`;
    }
    if (els.dailyReportFlow) {
      const groups = groupDailyReportItems(state.dailyReport?.items || []);
      if (!groups.length) {
        els.dailyReportFlow.innerHTML = '<div class="daily-report-flow-empty">아직 오늘 기록된 업무가 없습니다.</div>';
      } else {
        const actorName = esc(getDailyReportActorName());
        els.dailyReportFlow.innerHTML = `
          <div class="daily-report-flow-inner">
            <div class="daily-report-agent-col">
              <div class="daily-report-agent-node">${actorName}</div>
            </div>
            <div class="daily-report-tree-col">
              ${groups.map((group) => {
                const item = group.item || {};
                const kindTarget = item && Object.keys(item).length ? item : (group.row || {});
                const kindLabel = getPropertyKindLabel(item?.sourceType || group.row?.property_source_type, kindTarget);
                const kindClass = getPropertyKindClass(item?.sourceType || group.row?.property_source_type, kindTarget);
                const title = buildDailyReportPropertyTitle(group);
                const actions = [
                  ["rights_analysis", "권리분석"],
                  ["site_inspection", "현장조사"],
                  ["daily_issue", "금일이슈사항"],
                  ["new_property", "신규물건등록"],
                ].filter(([key]) => Number(group.counts[key] || 0) > 0);
                return `
                <div class="daily-report-row">
                  <div class="daily-report-prop-node">
                    <span class="daily-report-prop-kind ${kindClass}">${esc(kindLabel)}</span>
                    <span class="daily-report-prop-title">${esc(title)}</span>
                  </div>
                  <div class="daily-report-actions-col">
                    ${actions.map(([key, label]) => `<div class="daily-report-action-node"><span>${esc(label)}</span> <strong>${Number(group.counts[key] || 0)}건</strong></div>`).join("")}
                  </div>
                </div>`;
              }).join("")}
            </div>
          </div>`;
      }
    }
  }

  async function openDailyReportModal() {
    if (els.dailyReportNote) els.dailyReportNote.value = loadDailyReportNote();
    renderDailyReport();
    if (!els.dailyReportModal) return;
    document.body.classList.add("modal-open");
    els.dailyReportModal.classList.remove("hidden");
    els.dailyReportModal.setAttribute("aria-hidden", "false");
    try {
      const todayKey = getTodayDateKey();
      await refreshDailyReportSummary({ force: state.dailyReport?.dateKey !== todayKey, dateKey: todayKey, includeAssignedFallback: false });
      setGlobalMsg("");
    } catch (err) {
      setGlobalMsg(toUserErrorMessage(err, "일일업무일지 조회 실패"));
    }
  }

  function closeDailyReportModal() {
    if (els.dailyReportModal) {
      els.dailyReportModal.classList.add("hidden");
      els.dailyReportModal.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("modal-open");
  }

  function buildActivityLogEntries(actionKeys, propertyLike, options = {}) {
    const identityKey = String(
      options.identityKey ||
      propertyLike?.registrationIdentityKey ||
      propertyLike?._raw?.raw?.registrationIdentityKey ||
      buildRegistrationMatchKey(propertyLike) ||
      ""
    ).trim();
    const propertyId = String(options.propertyId || propertyLike?.id || propertyLike?.globalId || propertyLike?.global_id || "").trim();
    const propertyItemNo = String(propertyLike?.itemNo || propertyLike?.item_no || propertyLike?._raw?.item_no || "").trim();
    const propertyAddress = String(propertyLike?.address || propertyLike?.location || propertyLike?._raw?.address || propertyLike?.raw?.address || "").trim();
    return (Array.isArray(actionKeys) ? actionKeys : []).filter(Boolean).map((key) => ({
      actionType: DAILY_REPORT_ACTION_KEYS[key] || String(key || "").trim(),
      propertyId: propertyId || null,
      propertyIdentityKey: identityKey || null,
      propertyItemNo: propertyItemNo || null,
      propertyAddress: propertyAddress || null,
      changedFields: Array.isArray(options.changedFields?.[key]) ? options.changedFields[key] : [],
      note: key === "dailyIssue"
        ? (String(options.dailyIssueText || "").trim() || null)
        : key === "opinion"
          ? (String(options.opinionText || "").trim() || null)
          : key === "siteInspection"
            ? (String(options.siteInspectionText || "").trim() || null)
            : null,
      actionDate: String(options.actionDate || getTodayDateKey(options.at)).trim() || getTodayDateKey(),
    }));
  }

  async function recordDailyReportEntries(entries) {
    const safeEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.actionType);
    if (!safeEntries.length) return;
    if (DataAccess && typeof DataAccess.recordDailyReportEntriesViaApi === 'function') {
      await DataAccess.recordDailyReportEntriesViaApi(api, safeEntries, { auth: true });
    } else {
      throw new Error('KNSN_DATA_ACCESS.recordDailyReportEntriesViaApi 를 찾을 수 없습니다.');
    }
    if (els.dailyReportModal && !els.dailyReportModal.classList.contains('hidden')) {
      await refreshDailyReportSummary({ force: true, silent: true });
    }
  }

  function setupChrome() {
    if (K && typeof K.mountThemeToggle === "function") {
      const themeHost = document.querySelector(".sidebar-bottom") || document.querySelector(".top-actions");
      K.mountThemeToggle(themeHost, { className: "theme-toggle sidebar-bottom-btn" });
    }
  }

  const matchesAreaFilterValue = (value, area) => {
    if (PropertyDomain && typeof PropertyDomain.matchesAreaFilter === 'function') {
      return PropertyDomain.matchesAreaFilter(value, area);
    }
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = parseFloat(minStr) || 0;
    const max = maxStr ? parseFloat(maxStr) : Infinity;
    const numericArea = Number(area);
    if (!Number.isFinite(numericArea) || numericArea <= 0) return false;
    return numericArea >= min && (max === Infinity || numericArea < max);
  }

  const matchesPriceRangeValue = (value, row) => {
    if (PropertyDomain && typeof PropertyDomain.matchesPriceRangeFilter === 'function') {
      return PropertyDomain.matchesPriceRangeFilter(value, row);
    }
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = (parseFloat(minStr) || 0) * 100000000;
    const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
    const isAuctionType = row?.sourceType === 'auction' || row?.sourceType === 'onbid';
    const price = isAuctionType ? (row?.lowprice ?? row?.priceMain) : row?.priceMain;
    const numericPrice = Number(price || 0) || 0;
    if (!numericPrice || numericPrice <= 0) return false;
    return numericPrice >= min && (max === Infinity || numericPrice < max);
  }

  const matchesRatioFilterValue = (value, row) => {
    if (PropertyDomain && typeof PropertyDomain.matchesRatioFilter === 'function') {
      return PropertyDomain.matchesRatioFilter(value, row);
    }
    if (!value) return true;
    if (row?.sourceType !== 'auction' && row?.sourceType !== 'onbid') return false;
    const base = Number(row?.priceMain || 0) || 0;
    const current = Number((row?.lowprice ?? row?.priceMain ?? 0)) || 0;
    if (!base || base <= 0 || !current || current <= 0) return false;
    return (current / base) <= 0.5;
  }

  function formatOptionLabel(label, count) {
    return `${label} (${Number(count || 0).toLocaleString('ko-KR')})`;
  }

  function applySelectOptionCounts(selectEl, options, counts) {
    if (!selectEl) return;
    options.forEach((optionDef, index) => {
      const optionEl = selectEl.options[index];
      if (!optionEl) return;
      optionEl.textContent = formatOptionLabel(optionDef.label, counts[optionDef.value] || 0);
    });
  }

  function syncSourceFilterUi() {
    const active = String(state.filters?.activeCard || '').trim();
    if (els.agSourceFilter) els.agSourceFilter.value = active;
    document.querySelectorAll('.summary-card[data-card]').forEach((card) => {
      card.classList.toggle('is-active', !!active && card.dataset.card === active);
    });
  }

  // ── 전체리스트 진입 시 필터 일괄 초기화 ─────────────────────────────────
  // [추가 2026-04-27] 다른 메뉴에서 '전체리스트' 뷰로 들어올 때 호출.
  // sidebar 의 인라인 switchView() 에서 prevView !== 'list' && next === 'list'
  // 일 때만 발동. 정렬(propertySort)은 보존 — 사용자의 작업 흐름 선호이지 필터
  // 누적과는 다른 카테고리.
  function resetListFiltersOnEnter() {
    const f = state.filters;
    if (f) {
      f.activeCard = "";
      f.status = "";
      f.keyword = "";
      f.area = "";
      f.priceRange = "";
      f.ratio50 = "";
      f.favOnly = false;
      f.fireOnly = false;
      f.todayBid = false;
      f.todayAssigned = false;
    }
    state.page = 1;

    // 단일 select / keyword input 초기화
    if (els.agSourceFilter) els.agSourceFilter.value = '';
    if (els.agAreaFilter) els.agAreaFilter.value = '';
    if (els.agPriceFilter) els.agPriceFilter.value = '';
    if (els.agRatioFilter) els.agRatioFilter.value = '';
    if (els.agKeyword) els.agKeyword.value = '';

    // 토글 버튼 4종 (★ / 🔥 / D / n) is-active 해제
    if (els.agFavFilter) els.agFavFilter.classList.remove('is-active');
    if (els.agFireFilter) els.agFireFilter.classList.remove('is-active');
    if (els.agDayFilter) els.agDayFilter.classList.remove('is-active');
    if (els.agAssignedFilter) els.agAssignedFilter.classList.remove('is-active');

    // summary-card active 동기화 + 테이블 재렌더
    syncSourceFilterUi();
    try { renderTable(); } catch (_) {}
  }

  // sidebar 인라인 스크립트가 호출할 수 있도록 window 에 노출
  window.knsnAgentResetListFilters = resetListFiltersOnEnter;

  function bindEvents() {
    // 내 관리율 토글 (2026-05-08)
    bindMyRatioToggle();

    // Logout
    if (els.btnAgentLogout) {
      els.btnAgentLogout.addEventListener("click", async () => {
        try {
          if (K && K.supabaseEnabled && K.supabaseEnabled()) {
            const sb = K.initSupabase();
            if (sb) await sb.auth.signOut().catch(() => {});
          }
        } catch {}
        try { sessionStorage.removeItem("knson_bms_session_v1"); } catch {}
        location.replace("./login.html");
      });
    }

    // 요약 카드 클릭 → 필터
    document.querySelectorAll(".summary-card[data-card]").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.card || "";
        const next = state.filters.activeCard === key ? "" : key;
        state.filters.activeCard = next;
        syncSourceFilterUi();
        state.page = 1;
        renderTable();
      });
    });

    // Filters
    if (els.agSourceFilter) els.agSourceFilter.addEventListener("change", (e) => { state.filters.activeCard = String(e.target.value || ''); syncSourceFilterUi(); state.page = 1; renderTable(); });
    if (els.agAreaFilter) els.agAreaFilter.addEventListener("change", (e) => { state.filters.area = e.target.value; state.page = 1; renderTable(); });
    if (els.agPriceFilter) els.agPriceFilter.addEventListener("change", (e) => { state.filters.priceRange = e.target.value; state.page = 1; renderTable(); });
    if (els.agRatioFilter) els.agRatioFilter.addEventListener("change", (e) => { state.filters.ratio50 = e.target.value; state.page = 1; renderTable(); });
    if (els.agKeyword) els.agKeyword.addEventListener("input", debounce((e) => { state.filters.keyword = String(e.target.value || "").trim(); state.page = 1; renderTable(); }, 150));
    // ── 상호 배타 필터 (★ / 🔥 / D / n 는 단독 선택만 가능) ─────────────────
    // [수정 내역 2026-04-27] 기존에는 4개 버튼이 각자 독립 토글되어 동시 활성화되면
    // AND 누적 필터로 동작 → 모든 행이 사라지는 사용자 혼란 발생. 관리자페이지의
    // setExclusivePropertyFilter (admin-app.js) 와 동일 패턴으로 통일해 단독 선택만
    // 가능하도록 수정. 이미 활성화된 버튼을 다시 누르면 해제되어 전체 보기로 복귀.
    // which ∈ { null, 'favOnly', 'fireOnly', 'todayBid', 'todayAssigned' }
    //   null 을 넘기면 4개 모두 해제.
    function setExclusiveAgListFilter(which) {
      const keys = ['favOnly', 'fireOnly', 'todayBid', 'todayAssigned'];
      keys.forEach((k) => { state.filters[k] = (which === k); });
      if (els.agFavFilter) els.agFavFilter.classList.toggle('is-active', which === 'favOnly');
      if (els.agFireFilter) els.agFireFilter.classList.toggle('is-active', which === 'fireOnly');
      if (els.agDayFilter) els.agDayFilter.classList.toggle('is-active', which === 'todayBid');
      if (els.agAssignedFilter) els.agAssignedFilter.classList.toggle('is-active', which === 'todayAssigned');
    }

    if (els.agFavFilter) els.agFavFilter.addEventListener("click", () => {
      const turningOn = !state.filters.favOnly;
      setExclusiveAgListFilter(turningOn ? 'favOnly' : null);
      state.page = 1;
      renderTable();
    });

    if (els.agFireFilter) els.agFireFilter.addEventListener("click", () => {
      const turningOn = !state.filters.fireOnly;
      setExclusiveAgListFilter(turningOn ? 'fireOnly' : null);
      state.page = 1;
      renderTable();
    });

    if (els.agDayFilter) els.agDayFilter.addEventListener("click", () => {
      const turningOn = !state.filters.todayBid;
      setExclusiveAgListFilter(turningOn ? 'todayBid' : null);
      state.page = 1;
      renderTable();
    });

    if (els.agAssignedFilter) els.agAssignedFilter.addEventListener("click", () => {
      const turningOn = !state.filters.todayAssigned;
      setExclusiveAgListFilter(turningOn ? 'todayAssigned' : null);
      state.page = 1;
      renderTable();
    });

    if (els.btnDailyReport) els.btnDailyReport.addEventListener("click", openDailyReportModal);
    if (els.dailyReportClose) els.dailyReportClose.addEventListener("click", closeDailyReportModal);
    if (els.dailyReportDone) els.dailyReportDone.addEventListener("click", closeDailyReportModal);
    if (els.dailyReportModal) {
      els.dailyReportModal.addEventListener("click", (e) => {
        if (e.target?.dataset?.close === "true") closeDailyReportModal();
      });
    }
    if (els.dailyReportNote) {
      els.dailyReportNote.addEventListener("input", debounce(() => {
        saveDailyReportNote(els.dailyReportNote.value || "");
      }, 120));
    }

    // 신규 물건 등록 모달
    if (els.btnNewProperty) els.btnNewProperty.addEventListener("click", openNewPropertyModal);
    if (els.npmClose) els.npmClose.addEventListener("click", closeNewPropertyModal);
    if (els.npmCancel) els.npmCancel.addEventListener("click", closeNewPropertyModal);
    if (els.newPropertyModal) {
      els.newPropertyModal.addEventListener("click", (e) => {
        if (e.target?.dataset?.close === "true") closeNewPropertyModal();
      });
    }
    if (els.newPropertyForm) {
      els.newPropertyForm.addEventListener("change", (e) => {
        if (e.target.name !== "submitterKind") return;
        const isRealtor = e.target.value === "realtor";
        if (els.npmRealtorFields) els.npmRealtorFields.classList.toggle("hidden", !isRealtor);
        if (els.npmOwnerFields) els.npmOwnerFields.classList.toggle("hidden", isRealtor);
        els.newPropertyForm.querySelectorAll(".npm-type-card").forEach((card) => {
          const radio = card.querySelector("input[type=radio]");
          card.classList.toggle("is-active", !!radio?.checked);
        });
      });
      els.newPropertyForm.addEventListener("submit", (e) => {
        e.preventDefault();
        submitNewProperty().catch((err) => setNpmMsg(toUserErrorMessage(err, "등록 실패")));
      });
    }

    // Edit modal
    if (els.agEditClose) els.agEditClose.addEventListener("click", closeEditModal);
    if (els.agEditCancel) els.agEditCancel.addEventListener("click", closeEditModal);
    if (els.agEditModal) {
      els.agEditModal.addEventListener("click", (e) => {
        if (e.target?.dataset?.close === "true") closeEditModal();
      });
    }
    if (els.agEditTabs?.length) {
      els.agEditTabs.forEach((btn) => {
        btn.addEventListener("click", () => setAgentEditSection(btn.dataset.editTab || "basic"));
      });
    }
    if (els.agEditForm) els.agEditForm.addEventListener("submit", (e) => { e.preventDefault(); saveProperty(); });

    // Password modal
    if (els.btnChangeMyPassword) els.btnChangeMyPassword.addEventListener("click", openPwdModal);
    if (els.pwdClose) els.pwdClose.addEventListener("click", closePwdModal);
    if (els.pwdCancel) els.pwdCancel.addEventListener("click", closePwdModal);
    if (els.pwdForm) els.pwdForm.addEventListener("submit", (e) => { e.preventDefault(); changePassword(); });
  }

  // ── Auth ──
  async function ensureLoginThenLoad() {
    const user = state.session?.user;
    if (!user) { location.replace("./login.html"); return; }

    // 관리자면 관리자 페이지로 보냄
    if (String(user.role || "").toLowerCase() === "admin") {
      location.replace("./admin-index.html");
      return;
    }

    renderSessionUI();

    if (isSupabaseMode()) {
      try { await K.sbSyncLocalSession(); state.session = loadSession(); } catch {}
    }

    // 세션 확정 후 즐겨찾기 로드 (userId 기반 키)
    state.favorites = loadFavorites();
    state.fires = loadFires();

    await loadProperties();

    // DB 에서 최신 favorites 동기화 (비동기, 실패해도 무시)
    //   1) localStorage 에 있고 DB 에 없던 건 DB 에 업로드 (1회성 마이그레이션)
    //   2) DB 에서 최신 목록 내려받아 UI 반영
    (async () => {
      try {
        await migrateLocalFavoritesToDb();
        const synced = await syncFavoritesFromDb();
        if (synced) { try { renderTable(); } catch {} }
      } catch (e) { console.warn('favorites sync error', e); }
    })();
  }

  function renderSessionUI() {
    const user = state.session?.user;
    if (!user) return;
    if (els.agentUserBadge) els.agentUserBadge.textContent = user.name || user.email || "";
    if (els.btnAgentLogout) els.btnAgentLogout.classList.remove("hidden");
    if (els.btnChangeMyPassword && isSupabaseMode()) els.btnChangeMyPassword.classList.remove("hidden");
  }

  // ── Load Data ──
  function rowAssignedToUid(row, uid) {
    const target = String(uid || "").trim();
    if (!target) return false;
    const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
    return [row?.assignee_id, row?.assigneeId, row?.assignedAgentId, row?.assigned_agent_id, raw.assignee_id, raw.assigneeId, raw.assignedAgentId, raw.assigned_agent_id]
      .some((v) => String(v || "").trim() === target);
  }

  async function fetchPropertiesBatch(sb, from, pageSize, uid) {
    if (DataAccess && typeof DataAccess.fetchPropertiesBatch === "function") {
      return DataAccess.fetchPropertiesBatch(sb, from, pageSize, { isAdmin: false, uid, select: "*", orderColumn: "date_uploaded", ascending: false, clientSideFilter: true });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchPropertiesBatch 를 찾을 수 없습니다.");
  }

  async function fetchAllAssignedProperties(sb, uid) {
    if (DataAccess && typeof DataAccess.fetchAllProperties === "function") {
      return DataAccess.fetchAllProperties(sb, { isAdmin: false, uid, select: "*", pageSize: 1000 });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchAllProperties 를 찾을 수 없습니다.");
  }

  async function loadProperties(options = {}) {
    const showLoading = options.silent !== true;
    if (showLoading) {
      setAgentLoading("properties", true, state.view === "home" ? "담당자 홈 데이터를 불러오는 중입니다." : "담당 물건을 불러오는 중입니다.");
    }
    try {
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) { state.properties = []; renderAll(); return; }

      const uid = String(state.session?.user?.id || "").trim();
      if (!uid) { state.properties = []; renderAll(); return; }

      try { await K.sbSyncLocalSession(); state.session = loadSession() || state.session; } catch {}
      const rows = await fetchAllAssignedProperties(sb, uid);
      state.properties = Array.isArray(rows) ? rows.map(normalizeProperty) : [];
      renderAll();
    } catch (err) {
      console.error("loadProperties error:", err);
      state.properties = [];
      renderAll();
    } finally {
      if (showLoading) setAgentLoading("properties", false);
    }
  }

  // ── Normalize ──
  const REG_LOG_LABELS = {
    itemNo: "물건번호",
    address: "주소",
    assetType: "세부유형",
    floor: "층수",
    totalfloor: "총층",
    commonArea: "계약면적",
    exclusiveArea: "전용면적",
    siteArea: "토지면적",
    useapproval: "사용승인일",
    status: "진행상태",
    priceMain: "매매가",
    lowprice: "현재가격",
    dateMain: "주요일정",
    status: "진행상태",
    sourceUrl: "원문링크",
    realtorName: "중개사무소명",
    realtorPhone: "유선전화",
    realtorCell: "휴대폰번호",
    submitterName: "등록자명",
    submitterPhone: "등록자 연락처",
  };

  function hasMeaningfulValue(value) {
    if (PropertyDomain && typeof PropertyDomain.hasMeaningfulValue === "function") return PropertyDomain.hasMeaningfulValue(value);
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  }

  function normalizeCompareValue(field, value) {
    if (PropertyDomain && typeof PropertyDomain.normalizeCompareValue === "function") {
      return PropertyDomain.normalizeCompareValue(field, value, {
        numericFields: ["priceMain", "commonArea", "exclusiveArea", "siteArea"],
      });
    }
    if (value === null || value === undefined) return "";
    if (["priceMain", "commonArea", "exclusiveArea", "siteArea"].includes(field)) {
      const n = toNum(value);
      return n == null ? "" : String(n);
    }
    return String(value).trim().replace(/\s+/g, " ");
  }

  function formatFieldValueForLog(field, value) {
    if (PropertyDomain && typeof PropertyDomain.formatFieldValueForLog === "function") {
      return PropertyDomain.formatFieldValueForLog(field, value, {
        amountFields: ["priceMain"],
        numericFields: ["commonArea", "exclusiveArea", "siteArea"],
      });
    }
    if (value === null || value === undefined) return "";
    if (["priceMain"].includes(field)) {
      const n = toNum(value);
      return n == null ? "" : Number(n).toLocaleString("ko-KR");
    }
    if (["commonArea", "exclusiveArea", "siteArea"].includes(field)) {
      const n = toNum(value);
      if (n == null) return "";
      return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    }
    return String(value).trim();
  }

  function buildRegisterLogContext(route, user) {
    const actorUser = user && typeof user === 'object' && user.user ? user.user : user;
    if (PropertyDomain && typeof PropertyDomain.buildRegisterLogContext === "function") return PropertyDomain.buildRegisterLogContext(route, { user: actorUser });
    return {
      at: new Date().toISOString(),
      route: String(route || "등록").trim(),
      actor: String(actorUser?.name || actorUser?.email || "").trim(),
      actorRole: String(actorUser?.role || '').trim(),
    };
  }

  function parseFloorNumberForLog(value) {
    if (PropertyDomain && typeof PropertyDomain.parseFloorNumberForLog === "function") return PropertyDomain.parseFloorNumberForLog(value);
    const s = String(value || "").trim();
    if (!s) return "";
    let m = s.match(/^(?:B|b|지하)\s*(\d+)$/);
    if (m) return `b${m[1]}`;
    m = s.match(/(-?\d+)/);
    return m ? String(Number(m[1])) : "";
  }

  function compactAddressText(value) {
    if (PropertyDomain && typeof PropertyDomain.compactAddressText === "function") return PropertyDomain.compactAddressText(value);
    return String(value || "").trim().replace(/\s+/g, "");
  }

  function parseAddressIdentityParts(address) {
    if (PropertyDomain && typeof PropertyDomain.parseAddressIdentityParts === "function") return PropertyDomain.parseAddressIdentityParts(address);
    const text = String(address || "").trim().replace(/\s+/g, " ");
    const compact = compactAddressText ? compactAddressText(text) : text.replace(/\s+/g, "");
    if (!compact) return { dong: "", mainNo: "", subNo: "" };

    const suffixSet = new Set(["동", "읍", "면", "리"]);
    let end = -1;
    for (let i = compact.length - 1; i >= 0; i -= 1) {
      if (suffixSet.has(compact[i])) {
        end = i;
        break;
      }
    }
    if (end < 0) return { dong: "", mainNo: "", subNo: "" };

    let start = 0;
    for (let i = end - 1; i >= 0; i -= 1) {
      if (/[시군구읍면리동]/.test(compact[i])) {
        start = i + 1;
        break;
      }
    }

    const dong = compact.slice(start, end + 1);
    if (!/^[가-힣A-Za-z0-9]+(?:동|읍|면|리)$/.test(dong)) {
      return { dong: "", mainNo: "", subNo: "" };
    }

    const tail = compact.slice(end + 1);
    const lot = tail.match(/(산?\d+)(?:-(\d+))?/);
    if (!lot) return { dong, mainNo: "", subNo: "" };
    return { dong, mainNo: lot[1] || "", subNo: lot[2] || "" };
  }

  function extractHoNumberForLog(data) {
    if (PropertyDomain && typeof PropertyDomain.extractHoNumberForLog === "function") return PropertyDomain.extractHoNumberForLog(data);
    const explicitValues = [data?.ho, data?.unit, data?.room, data?.raw?.ho, data?.raw?.unit, data?.raw?.room];
    for (const value of explicitValues) {
      const s = String(value || "").trim();
      if (!s) continue;
      let m = s.match(/(\d{1,5})\s*호/);
      if (m) return String(Number(m[1]));
      if (!/층|동/.test(s)) {
        m = s.match(/^\D*(\d{1,5})\D*$/);
        if (m) return String(Number(m[1]));
      }
    }
    const texts = [
      data?.address, data?.raw?.address, data?.raw?.물건명, data?.raw?.상세주소,
      data?.memo, data?.raw?.memo, data?.raw?.opinion, data?.raw?.detailAddress
    ].filter(Boolean).join(" ");
    const m = texts.match(/(\d{1,5})\s*호/);
    return m ? String(Number(m[1])) : "";
  }

  function buildRegistrationMatchKey(data) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationMatchKey === "function") return PropertyDomain.buildRegistrationMatchKey(data);
    const parts = parseAddressIdentityParts(firstText(data?.address, data?.raw?.address, ""));
    const floorKey = parseFloorNumberForLog(firstText(data?.floor, data?.raw?.floor, "")) || "0";
    const hoKey = extractHoNumberForLog(data) || "0";
    if (!parts.dong || !parts.mainNo) return "";
    return `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey}|${hoKey}`;
  }

  function attachRegistrationIdentity(raw, data) {
    if (PropertyDomain && typeof PropertyDomain.attachRegistrationIdentity === "function") return PropertyDomain.attachRegistrationIdentity(raw, data);
    const nextRaw = { ...(raw || {}) };
    const parts = parseAddressIdentityParts(firstText(data?.address, data?.raw?.address, nextRaw.address, ""));
    const floorKey = parseFloorNumberForLog(firstText(data?.floor, data?.raw?.floor, nextRaw.floor, ""));
    const hoKey = extractHoNumberForLog(data);
    const key = parts.dong && parts.mainNo ? `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey || "0"}|${hoKey || "0"}` : "";
    nextRaw.registrationIdentityKey = key;
    nextRaw.registrationIdentity = {
      dong: parts.dong || "",
      mainNo: parts.mainNo || "",
      subNo: parts.subNo || "",
      floor: floorKey || "",
      ho: hoKey || "",
    };
    return nextRaw;
  }
  function buildRegistrationSnapshotFromItem(item) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationSnapshot === "function") return PropertyDomain.buildRegistrationSnapshot(item);
    const raw = item?._raw?.raw || {};
    return {
      itemNo: firstText(item?.itemNo, raw.itemNo, ""),
      address: firstText(item?.address, raw.address, ""),
      assetType: firstText(item?.assetType, raw.assetType, raw["세부유형"], ""),
      floor: firstText(item?.floor, raw.floor, ""),
      totalfloor: firstText(item?.totalfloor, raw.totalfloor, raw.total_floor, raw.totalFloor, ""),
      commonArea: raw.commonArea ?? null,
      exclusiveArea: item?.exclusivearea ?? raw.exclusiveArea ?? null,
      siteArea: raw.siteArea ?? null,
      useapproval: firstText(raw.useapproval, raw.useApproval, ""),
      status: firstText(item?.status, raw.status, ""),
      priceMain: item?.priceMain ?? raw.priceMain ?? null,
      sourceUrl: firstText(raw.sourceUrl, item?._raw?.source_url, ""),
      realtorName: firstText(raw.realtorName, raw.realtorname, item?._raw?.broker_office_name, ""),
      realtorPhone: firstText(raw.realtorPhone, raw.realtorphone, ""),
      realtorCell: firstText(raw.realtorCell, raw.realtorcell, item?._raw?.submitter_phone, ""),
      submitterName: firstText(item?._raw?.submitter_name, raw.submitterName, raw.submitter_name, ""),
      submitterPhone: firstText(item?._raw?.submitter_phone, raw.submitterPhone, raw.submitter_phone, ""),
      memo: firstText(item?._raw?.memo, raw.memo, raw.opinion, ""),
    };
  }

  function buildRegistrationSnapshotFromDbRow(row) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationSnapshot === "function") return PropertyDomain.buildRegistrationSnapshot(row);
    const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
    return {
      itemNo: firstText(row?.item_no, raw.itemNo, ""),
      address: firstText(row?.address, raw.address, ""),
      assetType: firstText(row?.asset_type, raw.assetType, raw["세부유형"], ""),
      floor: firstText(raw.floor, row?.floor, ""),
      totalfloor: firstText(raw.totalfloor, row?.total_floor, row?.totalfloor, ""),
      commonArea: row?.common_area ?? raw.commonArea ?? null,
      exclusiveArea: row?.exclusive_area ?? raw.exclusiveArea ?? null,
      siteArea: row?.site_area ?? raw.siteArea ?? null,
      useapproval: firstText(row?.use_approval, raw.useapproval, raw.useApproval, ""),
      status: firstText(row?.status, raw.status, ""),
      priceMain: row?.price_main ?? raw.priceMain ?? null,
      sourceUrl: firstText(row?.source_url, raw.sourceUrl, ""),
      realtorName: firstText(row?.broker_office_name, raw.realtorName, raw.realtorname, ""),
      realtorPhone: firstText(raw.realtorPhone, raw.realtorphone, ""),
      realtorCell: firstText(row?.submitter_phone, raw.realtorCell, raw.realtorcell, raw.submitterPhone, raw.submitter_phone, ""),
      submitterName: firstText(row?.submitter_name, raw.submitterName, raw.submitter_name, ""),
      submitterPhone: firstText(row?.submitter_phone, raw.submitterPhone, raw.submitter_phone, ""),
      memo: firstText(row?.memo, raw.memo, raw.opinion, ""),
      raw,
    };
  }

  function buildRegistrationChanges(prevSnapshot, nextSnapshot) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationChanges === "function") {
      return PropertyDomain.buildRegistrationChanges(prevSnapshot, nextSnapshot, REG_LOG_LABELS, {
        amountFields: ["priceMain"],
        numericFields: ["priceMain", "commonArea", "exclusiveArea", "siteArea"],
      });
    }
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationChanges === "function") {
      return PropertyDomain.buildRegistrationChanges(prevSnapshot, nextSnapshot, REG_LOG_LABELS, {
        amountFields: ["priceMain"],
        numericFields: ["priceMain", "commonArea", "exclusiveArea", "siteArea"],
      });
    }
    const changes = [];
    Object.keys(REG_LOG_LABELS).forEach((field) => {
      const nextValue = nextSnapshot?.[field];
      if (!hasMeaningfulValue(nextValue)) return;
      const prevNorm = normalizeCompareValue(field, prevSnapshot?.[field]);
      const nextNorm = normalizeCompareValue(field, nextValue);
      if (prevNorm === nextNorm) return;
      changes.push({
        field,
        label: REG_LOG_LABELS[field],
        before: formatFieldValueForLog(field, prevSnapshot?.[field]) || "-",
        after: formatFieldValueForLog(field, nextValue) || "-",
      });
    });
    return changes;
  }

  function appendRegistrationCreateLog(raw, context) {
    if (PropertyDomain && typeof PropertyDomain.ensureRegistrationCreatedLog === "function") return PropertyDomain.ensureRegistrationCreatedLog(raw, context);
    if (PropertyDomain && typeof PropertyDomain.ensureRegistrationCreatedLog === "function") return PropertyDomain.ensureRegistrationCreatedLog(raw, context);
    const nextRaw = { ...(raw || {}) };
    const firstAt = firstText(nextRaw.firstRegisteredAt, context?.at, new Date().toISOString());
    const current = Array.isArray(nextRaw.registrationLog) ? nextRaw.registrationLog.slice() : [];
    if (!current.length) current.push({ type: "created", at: firstAt, route: context?.route || "등록", actor: context?.actor || "" });
    nextRaw.firstRegisteredAt = firstAt;
    nextRaw.registrationLog = current;
    return nextRaw;
  }

  function appendRegistrationChangeLog(raw, context, changes) {
    if (PropertyDomain && typeof PropertyDomain.appendRegistrationLog === "function") return PropertyDomain.appendRegistrationLog(raw, context, changes);
    if (PropertyDomain && typeof PropertyDomain.appendRegistrationLog === "function") return PropertyDomain.appendRegistrationLog(raw, context, changes);
    const nextRaw = appendRegistrationCreateLog(raw, context);
    if (Array.isArray(changes) && changes.length) {
      nextRaw.registrationLog = [...nextRaw.registrationLog, {
        type: "changed",
        at: context?.at || new Date().toISOString(),
        route: context?.route || "등록",
        actor: context?.actor || "",
        changes: changes.map((entry) => ({ ...entry })),
      }];
    }
    return nextRaw;
  }

  function mergeMeaningfulShallow(baseObj, incomingObj) {
    const out = { ...(baseObj || {}) };
    Object.entries(incomingObj || {}).forEach(([key, value]) => {
      if (!hasMeaningfulValue(value)) return;
      out[key] = value;
    });
    return out;
  }

  function buildRegistrationDbRowForExisting(existingItem, incomingRow, context, options = {}) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationDbRowForExisting === "function") {
      return PropertyDomain.buildRegistrationDbRowForExisting(existingItem, incomingRow, context, {
        labels: REG_LOG_LABELS,
        amountFields: ["priceMain", "lowprice"],
        numericFields: ["priceMain", "lowprice", "commonArea", "exclusiveArea", "siteArea"],
        copyFields: ["address","asset_type","floor","total_floor","exclusive_area","common_area","site_area","use_approval","status","price_main","lowprice","date_main","broker_office_name","submitter_name","submitter_phone","memo"],
        assignIfEmpty: !!options.assignIfEmpty,
      });
    }
    const base = existingItem?._raw ? { ...existingItem._raw, raw: { ...(existingItem._raw.raw || {}) } } : { ...(incomingRow || {}), raw: { ...(incomingRow?.raw || {}) } };
    const prevSnapshot = existingItem?._raw ? buildRegistrationSnapshotFromItem(existingItem) : buildRegistrationSnapshotFromDbRow(base);
    const nextSnapshot = buildRegistrationSnapshotFromDbRow(incomingRow);
    const changes = buildRegistrationChanges(prevSnapshot, nextSnapshot);
    const nextRow = { ...base };
    ["address","asset_type","exclusive_area","common_area","site_area","use_approval","price_main","broker_office_name","submitter_name","submitter_phone","memo"].forEach((key) => {
      if (hasMeaningfulValue(incomingRow?.[key])) nextRow[key] = incomingRow[key];
    });
    if (options.assignIfEmpty && !hasMeaningfulValue(nextRow.assignee_id) && hasMeaningfulValue(incomingRow?.assignee_id)) nextRow.assignee_id = incomingRow.assignee_id;
    if (!hasMeaningfulValue(nextRow.item_no) && hasMeaningfulValue(incomingRow?.item_no)) nextRow.item_no = incomingRow.item_no;

    const normalizeSource = (value) => (PropertyDomain && typeof PropertyDomain.normalizeSourceType === "function")
      ? PropertyDomain.normalizeSourceType(value, { fallback: "" })
      : String(value || "").trim().toLowerCase();
    const normalizeSubmitter = (value) => {
      const v = String(value || "").trim().toLowerCase();
      if (v === "realtor") return "realtor";
      if (v === "owner" || v === "general") return "owner";
      return "";
    };
    const sourcePriority = { "": 0, general: 1, realtor: 2, onbid: 3, auction: 4 };

    const currentSourceType = normalizeSource(nextRow.source_type || nextRow.sourceType || base?.raw?.source_type || base?.raw?.sourceType || "");
    const incomingSourceType = normalizeSource(incomingRow?.source_type || incomingRow?.sourceType || incomingRow?.raw?.source_type || incomingRow?.raw?.sourceType || "");
    if (hasMeaningfulValue(incomingRow?.source_type) && sourcePriority[incomingSourceType] > sourcePriority[currentSourceType]) {
      nextRow.source_type = incomingSourceType;
    } else if (!hasMeaningfulValue(nextRow.source_type) && hasMeaningfulValue(incomingRow?.source_type)) {
      nextRow.source_type = incomingRow.source_type;
    }

    const currentSubmitterType = normalizeSubmitter(nextRow.submitter_type || nextRow.submitterType || base?.raw?.submitter_type || base?.raw?.submitterType || "");
    const incomingSubmitterType = normalizeSubmitter(incomingRow?.submitter_type || incomingRow?.submitterType || incomingRow?.raw?.submitter_type || incomingRow?.raw?.submitterType || "");
    if (incomingSubmitterType === "realtor" || (!hasMeaningfulValue(nextRow.submitter_type) && incomingSubmitterType)) {
      nextRow.submitter_type = incomingSubmitterType;
    }

    const mergedRaw = mergeMeaningfulShallow(base.raw || {}, incomingRow?.raw || {});
    if (incomingSourceType) {
      mergedRaw.sourceType = incomingSourceType;
      mergedRaw.source_type = incomingSourceType;
    }
    if (incomingSubmitterType) {
      mergedRaw.submitterType = incomingSubmitterType;
      mergedRaw.submitter_type = incomingSubmitterType;
    }

    nextRow.raw = attachRegistrationIdentity(appendRegistrationChangeLog(mergedRaw, context, changes), nextSnapshot);
    return { row: nextRow, changes };
  }

  function buildRegistrationDbRowForCreate(row, context) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationDbRowForCreate === "function") return PropertyDomain.buildRegistrationDbRowForCreate(row, context);
    return { ...(row || {}), raw: attachRegistrationIdentity(appendRegistrationCreateLog(row?.raw || {}, context), row) };
  }

  function findExistingPropertyByRegistrationKey(data, items) {
    const targetKey = buildRegistrationMatchKey(data);
    if (!targetKey) return null;
    for (const item of Array.isArray(items) ? items : []) {
      if (buildRegistrationMatchKey(buildRegistrationSnapshotFromItem(item)) === targetKey) return item;
    }
    return null;
  }

  async function findExistingPropertyForRegistration(sb, data) {
    if (DataAccess && typeof DataAccess.findExistingPropertyForRegistration === "function") {
      return DataAccess.findExistingPropertyForRegistration(sb, data, { limit: 500, normalizeRow: normalizeProperty });
    }
    return null;
  }

  function normalizeProperty(item) {
    const base = (PropertyDomain && typeof PropertyDomain.buildNormalizedPropertyBase === "function")
      ? PropertyDomain.buildNormalizedPropertyBase(item)
      : null;
    if (!base) return item;

    return {
      id: base.id,
      globalId: base.globalId,
      sourceType: base.sourceType,
      sourceUrl: base.sourceUrl,
      itemNo: base.itemNo,
      address: base.address,
      sourceNoteLabel: base.sourceNoteLabel,
      sourceNoteText: base.sourceNoteText,
      assetType: base.assetType,
      floor: base.floor,
      totalfloor: base.totalfloor,
      useapproval: base.useapproval,
      commonarea: base.commonarea,
      exclusivearea: base.exclusivearea,
      sitearea: base.sitearea,
      priceMain: base.priceMain,
      lowprice: base.lowprice,
      status: base.status,
      dateMain: base.dateMain,
      rightsAnalysis: base.rightsAnalysis,
      siteInspection: base.siteInspection,
      opinion: base.opinion,
      createdAt: base.createdAt,
      isDirectSubmission: base.isDirectSubmission,
      result_status: item?.result_status || null,
      result_price: item?.result_price || null,
      result_date: item?.result_date || null,
      _raw: item,
    };
  }

  // ── Render ──
  let _myRatioInitialLoaded = false;
  function renderAll() {
    renderSummary();
    renderTable();
    if (els.dailyReportModal && !els.dailyReportModal.classList.contains("hidden")) renderDailyReport();
    // 내 관리율: 첫 렌더 시 한 번 fetch (이후는 토글로만 갱신)
    if (!_myRatioInitialLoaded && els.agMyRatioCard) {
      _myRatioInitialLoaded = true;
      loadMyRatio(myRatioState.period);
    }
  }

  function extractDateKeyFromValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    return getTodayDateKey(parsed);
  }

  function countSourceSummary(rows) {
    if (PropertyDomain && typeof PropertyDomain.summarizeSourceBuckets === "function") {
      return PropertyDomain.summarizeSourceBuckets(rows);
    }
    const list = Array.isArray(rows) ? rows : [];
    return {
      total: list.length,
      auction: list.filter((r) => r.sourceType === "auction").length,
      onbid: list.filter((r) => r.sourceType === "onbid").length,
      realtor_naver: list.filter((r) => r.sourceType === "realtor" && !r.isDirectSubmission).length,
      realtor_direct: list.filter((r) => r.sourceType === "realtor" && r.isDirectSubmission).length,
      general: list.filter((r) => r.sourceType === "general").length,
    };
  }

  function renderSummary() {
    const p = Array.isArray(state.properties) ? state.properties : [];
    const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
    const summary = countSourceSummary(p);
    if (els.agSumTotal) els.agSumTotal.textContent = fmt(summary.total);
    if (els.agSumAuction) els.agSumAuction.textContent = fmt(summary.auction);
    if (els.agSumGongmae) els.agSumGongmae.textContent = fmt(summary.onbid);
    if (els.agSumNaverRealtor) els.agSumNaverRealtor.textContent = fmt(summary.realtor_naver);
    if (els.agSumDirectRealtor) els.agSumDirectRealtor.textContent = fmt(summary.realtor_direct);
    if (els.agSumGeneral) els.agSumGeneral.textContent = fmt(summary.general);

    const totalForRatio = Math.max(Number(summary.total) || 0, 1);
    const setProgress = (el, value) => {
      if (!el) return;
      const ratio = Math.max(8, Math.min(100, Math.round(((Number(value) || 0) / totalForRatio) * 100)));
      el.style.width = `${ratio}%`;
    };
    setProgress(els.agHomeProgressAuction, summary.auction);
    setProgress(els.agHomeProgressOnbid, summary.onbid);
    setProgress(els.agHomeProgressNaver, summary.realtor_naver);
    setProgress(els.agHomeProgressDirect, summary.realtor_direct);
    setProgress(els.agHomeProgressGeneral, summary.general);

    const todayKey = getTodayDateKey();
    const todayAssignedRows = p.filter((item) => {
      const raw = item?._raw || {};
      const candidate = item?.createdAt || raw?.date_uploaded || raw?.created_at || raw?.date || raw?.createdAt || "";
      return extractDateKeyFromValue(candidate) === todayKey;
    });
    const todayAssigned = countSourceSummary(todayAssignedRows);
    if (els.agTodayAssignedTotal) els.agTodayAssignedTotal.textContent = fmt(todayAssigned.total);
    if (els.agTodayAssignedAuction) els.agTodayAssignedAuction.textContent = fmt(todayAssigned.auction);
    if (els.agTodayAssignedOnbid) els.agTodayAssignedOnbid.textContent = fmt(todayAssigned.onbid);
    if (els.agTodayAssignedNaver) els.agTodayAssignedNaver.textContent = fmt(todayAssigned.realtor_naver);
    if (els.agTodayAssignedDirect) els.agTodayAssignedDirect.textContent = fmt(todayAssigned.realtor_direct);
    if (els.agTodayAssignedGeneral) els.agTodayAssignedGeneral.textContent = fmt(todayAssigned.general);
    if (els.agTodayAssignedDetail) {
      els.agTodayAssignedDetail.textContent = todayAssigned.total
        ? "금일 등록일 기준으로 집계됩니다."
        : "오늘 새로 배정된 물건이 없습니다.";
    }

    // 내 관리율 카드 — 총배정은 즉시 표시 (state.properties 기반)
    // 활동 통계는 비동기 fetch (loadMyRatio 가 별도 호출)
    if (els.agMyRatioTotal) els.agMyRatioTotal.textContent = fmt(summary.total);
  }

  // ═══ 내 관리율 카드 (2026-05-08) ════════════════════════════════════
  // 본인 actor_id 기준 활동 통계를 fetch 하여 카드에 렌더링한다.
  // 토글: 오늘 / 이번주 / 이번달 (KST 기준)
  // 백엔드: GET /api/properties?daily_report=1&self=1&aggregate=by_actor&start_date=...&end_date=...
  const myRatioState = { period: "today", loading: false, lastLoadedAt: 0 };

  function getKstYmd(date) {
    // KST(UTC+9) 기준 'YYYY-MM-DD' 생성
    const d = (date instanceof Date) ? date : new Date();
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    const kst = new Date(utcMs + 9 * 60 * 60000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(kst.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function computeMyRatioRange(period) {
    // 모두 KST 기준. 결과는 YYYY-MM-DD 문자열 (start, end 포함)
    const nowKstStr = getKstYmd(new Date());
    const [yy, mm, dd] = nowKstStr.split("-").map((v) => parseInt(v, 10));
    if (period === "today") {
      return { start: nowKstStr, end: nowKstStr };
    }
    if (period === "month") {
      const start = `${yy}-${String(mm).padStart(2, "0")}-01`;
      // 다음달 1일에서 -1일 = 이번달 마지막일
      const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); // mm = 1-12, mm월의 마지막일
      const end = `${yy}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { start, end };
    }
    // week: 월요일 ~ 일요일 (KST)
    // KST 기준 요일 산출 (0=일, 1=월, ...)
    const baseUtc = Date.UTC(yy, mm - 1, dd);
    const dow = new Date(baseUtc).getUTCDay(); // 0=일 ~ 6=토
    const offsetToMonday = (dow === 0) ? -6 : (1 - dow); // 월요일까지 offset
    const monMs = baseUtc + offsetToMonday * 24 * 60 * 60 * 1000;
    const sunMs = monMs + 6 * 24 * 60 * 60 * 1000;
    const fmt = (ms) => {
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };
    return { start: fmt(monMs), end: fmt(sunMs) };
  }

  function renderMyRatioPlaceholders(text) {
    const ids = [
      "agMyRatioManaged", "agMyRatioPercent",
      "agMyRatioNew", "agMyRatioUpdate", "agMyRatioIssue",
      "agMyRatioSiteinsp", "agMyRatioOpinion", "agMyRatioPhoto", "agMyRatioVideo",
    ];
    ids.forEach((id) => { if (els[id]) els[id].textContent = text; });
  }

  function renderMyRatioCounts(counts, totalAssigned) {
    const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
    const c = counts || {};
    const managed = Number(c.managed || 0);
    const ratio = totalAssigned > 0 ? (managed / totalAssigned) * 100 : 0;
    const ratioText = totalAssigned > 0 ? `${ratio.toFixed(1)}%` : "0%";

    if (els.agMyRatioManaged) els.agMyRatioManaged.textContent = fmt(managed);
    if (els.agMyRatioPercent) els.agMyRatioPercent.textContent = ratioText;
    if (els.agMyRatioNew)      els.agMyRatioNew.textContent      = fmt(c.newProperty);
    if (els.agMyRatioUpdate)   els.agMyRatioUpdate.textContent   = fmt(c.propertyUpdate);
    if (els.agMyRatioIssue)    els.agMyRatioIssue.textContent    = fmt(c.dailyIssue);
    if (els.agMyRatioSiteinsp) els.agMyRatioSiteinsp.textContent = fmt(c.siteInspection);
    if (els.agMyRatioOpinion)  els.agMyRatioOpinion.textContent  = fmt(c.opinion);
    if (els.agMyRatioPhoto)    els.agMyRatioPhoto.textContent    = fmt(c.photoUpload);
    if (els.agMyRatioVideo)    els.agMyRatioVideo.textContent    = fmt(c.videoUpload);
  }

  async function loadMyRatio(period) {
    if (!els.agMyRatioCard) return;
    if (myRatioState.loading) return;
    myRatioState.loading = true;
    myRatioState.period = period || myRatioState.period || "today";

    const range = computeMyRatioRange(myRatioState.period);
    renderMyRatioPlaceholders("…");

    try {
      const qs = new URLSearchParams({
        daily_report: "1",
        self: "1",
        aggregate: "by_actor",
        start_date: range.start,
        end_date: range.end,
      });
      const data = await api(`/properties?${qs.toString()}`, { method: "GET", auth: true });
      const actor = (data && Array.isArray(data.actors) && data.actors[0]) || null;
      const counts = actor && actor.counts ? actor.counts : {};
      const totalAssigned = Array.isArray(state.properties) ? state.properties.length : 0;
      renderMyRatioCounts(counts, totalAssigned);
      myRatioState.lastLoadedAt = Date.now();
    } catch (err) {
      console.error("loadMyRatio failed", err);
      renderMyRatioPlaceholders("-");
    } finally {
      myRatioState.loading = false;
    }
  }

  function bindMyRatioToggle() {
    if (!els.agMyRatioCard) return;
    const buttons = els.agMyRatioCard.querySelectorAll(".agent-myratio-toggle-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.period || "today";
        if (next === myRatioState.period) return;
        buttons.forEach((b) => {
          const isActive = b === btn;
          b.classList.toggle("is-active", isActive);
          b.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        loadMyRatio(next);
      });
    });
  }

  function getFilteredProps(options = {}) {
    const keywordFields = ['address', 'itemNo', 'opinion'];
    if (PropertyDomain && typeof PropertyDomain.applyPropertyFilters === 'function') {
      return PropertyDomain.applyPropertyFilters(state.properties, state.filters, {
        ignoreKeys: options?.ignoreKeys,
        keywordFields,
        todayKey: getTodayDateKey(),
        isFavorite: (row) => state.favorites.has(row?.id),
        isFire: (row) => state.fires.has(row?.id),
      });
    }
    let rows = state.properties;
    const f = state.filters;
    const ignoreKeys = new Set(Array.isArray(options?.ignoreKeys) ? options.ignoreKeys : []);
    if (!ignoreKeys.has('activeCard') && f.activeCard && f.activeCard !== 'all') {
      rows = rows.filter((r) => {
        if (PropertyDomain && typeof PropertyDomain.matchesSourceSelection === 'function') return PropertyDomain.matchesSourceSelection(r, f.activeCard);
        return true;
      });
    }
    if (!ignoreKeys.has('area') && f.area) rows = rows.filter((r) => matchesAreaFilterValue(f.area, r.exclusivearea));
    if (!ignoreKeys.has('priceRange') && f.priceRange) rows = rows.filter((r) => matchesPriceRangeValue(f.priceRange, r));
    if (!ignoreKeys.has('ratio50') && f.ratio50) rows = rows.filter((r) => matchesRatioFilterValue(f.ratio50, r));
    if (!ignoreKeys.has('todayBid') && f.todayBid) rows = rows.filter((r) => String(r.dateMain || '').trim().startsWith(getTodayDateKey()));
    if (!ignoreKeys.has('todayAssigned') && f.todayAssigned) {
      const todayKey = getTodayDateKey();
      rows = rows.filter((r) => {
        const val = r?.assignedAt || r?.assigned_at || r?._raw?.assigned_at || r?._raw?.assignedAt || '';
        if (!val) return false;
        const s = String(val).trim();
        if (s.length <= 10) return s.startsWith(todayKey);
        // ISO 타임스탬프 → KST 날짜로 변환
        try {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
          }).formatToParts(new Date(s));
          const y = parts.find((p) => p.type === 'year')?.value || '';
          const m = parts.find((p) => p.type === 'month')?.value || '';
          const d = parts.find((p) => p.type === 'day')?.value || '';
          return !!(y && m && d) && `${y}-${m}-${d}` === todayKey;
        } catch { return s.startsWith(todayKey); }
      });
    }
    if (!ignoreKeys.has('favOnly') && f.favOnly) rows = rows.filter((r) => state.favorites.has(r.id));
    if (!ignoreKeys.has('fireOnly') && f.fireOnly) rows = rows.filter((r) => state.fires.has(r.id));
    if (!ignoreKeys.has('keyword') && f.keyword) rows = rows.filter((r) => PropertyDomain && typeof PropertyDomain.matchesKeyword === 'function' ? PropertyDomain.matchesKeyword(r, f.keyword, { fields: keywordFields }) : true);
    return rows;
  }

  function updateFilterOptionCounts() {
    const sourceRows = getFilteredProps({ ignoreKeys: ['activeCard'] });
    const areaRows = getFilteredProps({ ignoreKeys: ['area'] });
    const priceRows = getFilteredProps({ ignoreKeys: ['priceRange'] });
    const ratioRows = getFilteredProps({ ignoreKeys: ['ratio50'] });
    const sourceCounts = { '': sourceRows.length, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    sourceRows.forEach((row) => {
      const bucket = PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function'
        ? PropertyDomain.getSourceBucket(row)
        : (row.sourceType === 'realtor' ? (row.isDirectSubmission ? 'realtor_direct' : 'realtor_naver') : String(row.sourceType || 'general'));
      if (Object.prototype.hasOwnProperty.call(sourceCounts, bucket)) sourceCounts[bucket] += 1;
    });

    const areaCounts = { '': areaRows.length, '0-5': 0, '5-10': 0, '10-20': 0, '20-30': 0, '30-50': 0, '50-100': 0, '100-': 0 };
    areaRows.forEach((row) => {
      AREA_FILTER_OPTIONS.slice(1).forEach((optionDef) => {
        if (matchesAreaFilterValue(optionDef.value, row?.exclusivearea)) areaCounts[optionDef.value] += 1;
      });
    });

    const priceCounts = { '': priceRows.length, '0-1': 0, '1-3': 0, '3-5': 0, '5-10': 0, '10-20': 0, '20-': 0 };
    priceRows.forEach((row) => {
      PRICE_FILTER_OPTIONS.slice(1).forEach((optionDef) => {
        if (matchesPriceRangeValue(optionDef.value, row)) priceCounts[optionDef.value] += 1;
      });
    });

    const ratioCounts = { '': ratioRows.length, '50': 0 };
    ratioRows.forEach((row) => {
      if (matchesRatioFilterValue('50', row)) ratioCounts['50'] += 1;
    });

    applySelectOptionCounts(els.agSourceFilter, SOURCE_FILTER_OPTIONS, sourceCounts);
    applySelectOptionCounts(els.agAreaFilter, AREA_FILTER_OPTIONS, areaCounts);
    applySelectOptionCounts(els.agPriceFilter, PRICE_FILTER_OPTIONS, priceCounts);
    applySelectOptionCounts(els.agRatioFilter, RATIO_FILTER_OPTIONS, ratioCounts);
    if (els.agSourceFilter) els.agSourceFilter.value = String(state.filters?.activeCard || '');
    if (els.agAreaFilter) els.agAreaFilter.value = String(state.filters?.area || '');
    if (els.agPriceFilter) els.agPriceFilter.value = String(state.filters?.priceRange || '');
    if (els.agRatioFilter) els.agRatioFilter.value = String(state.filters?.ratio50 || '');
  }

  function renderTable() {
    if (!els.agTableBody) return;
    renderAgentPropertiesHead(isPlainSourceFilterSelected(state.filters?.activeCard));
    updateFilterOptionCounts();
    const rows = applyAgentPropertySort(getFilteredProps());
    const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.pageSize;
    const paged = rows.slice(start, start + state.pageSize);

    els.agTableBody.innerHTML = "";
    if (!paged.length) {
      if (els.agEmpty) {
        // 필터 상태에 따라 메시지 다르게 표시 (어떤 필터 때문에 비어있는지 사용자가 바로 알 수 있도록)
        // [수정 내역 2026-04-27] 4개 단독 선택 필터(★/🔥/D/n) 모두 라벨 표시
        const f = state.filters || {};
        const activeFilters = [];
        if (f.favOnly) activeFilters.push('관심물건(★)');
        if (f.fireOnly) activeFilters.push('강추매물(🔥)');
        if (f.todayBid) activeFilters.push('당일 입찰기일(D)');
        if (f.todayAssigned) activeFilters.push('오늘 내 배정(n)');
        if (f.keyword) activeFilters.push(`검색어 "${String(f.keyword).trim()}"`);
        if (f.activeCard && f.activeCard !== 'all' && f.activeCard !== '') activeFilters.push('구분 필터');
        if (f.area) activeFilters.push('면적 필터');
        if (f.priceRange) activeFilters.push('가격 필터');
        if (f.ratio50) activeFilters.push('비율 필터');
        if (activeFilters.length) {
          els.agEmpty.textContent = `조건에 맞는 물건이 없습니다. (적용 필터: ${activeFilters.join(', ')})`;
        } else {
          els.agEmpty.textContent = '배정된 물건이 없습니다.';
        }
        els.agEmpty.classList.remove("hidden");
      }
      renderPagination(0);
      return;
    }
    if (els.agEmpty) els.agEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    for (const p of paged) frag.appendChild(renderRow(p));
    els.agTableBody.appendChild(frag);
    renderPagination(totalPages);

    // 지도 모드일 때 필터 결과를 지도에도 반영 (2026-05-13)
    try { if (typeof li_map_renderIfActive === 'function') li_map_renderIfActive(); } catch (_) {}
  }


function renderRow(p) {
  const tr = document.createElement("tr");
  tr.style.cursor = "pointer";
  const listView = (PropertyDomain && typeof PropertyDomain.buildPropertyListViewModel === 'function')
    ? PropertyDomain.buildPropertyListViewModel(p)
    : null;
  const bucket = listView?.sourceBucket || getPropertyBucket(p, p.sourceType);
  const kindLabel = listView?.kindLabel || getPropertyKindLabel(p.sourceType, p);
  const kindClass = listView?.kindClass || ((PropertyRenderers && typeof PropertyRenderers.getSourceBucketClass === 'function')
    ? PropertyRenderers.getSourceBucketClass(bucket)
    : ({
        auction: "kind-auction",
        onbid: "kind-gongmae",
        realtor_naver: "kind-realtor-naver",
        realtor_direct: "kind-realtor-direct",
        general: "kind-general",
      }[bucket] || "kind-general"));
  const usePlainLayout = isPlainSourceFilterSelected(state.filters?.activeCard);
  const appraisalValue = listView?.appraisalPriceValue ?? p.priceMain;
  const currentValue = listView?.currentPriceValue ?? p.lowprice;
  const ratioValue = listView?.ratioValue ?? -1;
  const appraisal = appraisalValue != null ? formatEok(appraisalValue) : "-";
  const current = !usePlainLayout && currentValue != null ? formatEok(currentValue) : "";
  const rate = !usePlainLayout ? (ratioValue >= 0 ? `${Math.round(ratioValue * 100)}%` : calcRate(p.priceMain, p.lowprice)) : "";
  const statusLabel = normalizeStatus(p.status);
  const isFav = state.favorites.has(p.id);
  const isFire = state.fires.has(p.id);
  const addressText = truncateAddressText(listView?.address || p.address || '-', 30) || '-';
  const fullAddress = String(listView?.address || p.address || '').trim();
  const assetTypeText = truncateDisplayText(listView?.assetType || p.assetType || "-", 7) || "-";
  const floorText = truncateDisplayText(listView?.floorText || getFloorDisplayValue(p) || "-", 7) || "-";
  const scheduleHtml = !usePlainLayout
    ? ((PropertyRenderers && typeof PropertyRenderers.formatScheduleHtml === 'function'
        ? PropertyRenderers.formatScheduleHtml(p)
        : '') || formatScheduleHtmlLocal(p))
    : '';
  const opinionText = p.opinion ? '✓' : '-';
  const createdAtText = formatDate(listView?.createdAtValue || p.createdAt || p.date || p.dateUploaded || p.date_uploaded || p._raw?.date_uploaded || "") || "-";
  const commonText = (listView?.commonAreaValue != null ? fmtArea(listView.commonAreaValue) : (p.commonarea != null ? fmtArea(p.commonarea) : "-"));
  const siteText = (listView?.siteAreaValue != null ? fmtArea(listView.siteAreaValue) : (p.sitearea != null ? fmtArea(p.sitearea) : "-"));
  const useapprovalText = formatDate(listView?.useApprovalValue || p.useapproval || p._raw?.useapproval || p._raw?.use_approval || p._raw?.useApproval || "") || "-";

  // ── 모바일(≤768px): 단일 td 에 카드 레이아웃 HTML 을 넣는 방식 ──
  // CSS 만으로 15개 td 를 의미 있는 카드로 재배치하기 어려워 JS 에서 분기.
  const isMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px)').matches;

  if (isMobile) {
    tr.classList.add('ag-row-mobile');
    const favTd = document.createElement('td');
    favTd.className = 'ag-card-td';
    favTd.setAttribute('colspan', '15');

    // 카드 내부 정보 블록들 구성 (값 있는 것만)
    const exclusiveArea = p.exclusivearea != null ? fmtArea(p.exclusivearea) : null;
    const metaParts = [assetTypeText, floorText, exclusiveArea ? exclusiveArea + '평' : null].filter((v) => v && v !== '-');
    const priceParts = [];
    if (appraisal && appraisal !== '-') priceParts.push('감정가 ' + appraisal);
    if (current)  priceParts.push('현재가 ' + current);
    if (rate)     priceParts.push(rate);
    const tailParts = [];
    if (scheduleHtml && scheduleHtml !== '-') tailParts.push('📅 ' + scheduleHtml);
    if (statusLabel && statusLabel !== '-') tailParts.push(statusLabel);
    const footerParts = [];
    if (p.opinion) footerParts.push('의견 ✓');
    if (p.siteInspection) footerParts.push('실사 ✓');
    if (createdAtText && createdAtText !== '-') footerParts.push('등록 ' + createdAtText);

    const _srcUrl = p.sourceUrl || p.source_url || '';
    const _itemNoHtml = _srcUrl
      ? '<a href="' + esc(_srcUrl) + '" target="_blank" rel="noopener" class="item-no-link">' + esc(p.itemNo || "-") + '</a>'
      : esc(p.itemNo || "-");

    favTd.innerHTML = `
      <div class="ag-card">
        <div class="ag-card-head">
          <button type="button" class="btn-fav${isFav ? ' is-active' : ''}" title="${isFav ? '관심 해제' : '관심 등록'}">${isFav ? '★' : '☆'}</button>
          <button type="button" class="btn-fire${isFire ? ' is-active' : ''}" title="${isFire ? '강추매물 해제' : '강추매물 등록'}">🔥</button>
          <span class="kind-text ${kindClass}">${esc(kindLabel)}</span>
          <span class="ag-card-itemno">#${_itemNoHtml}</span>
        </div>
        <div class="ag-card-addr">${esc(addressText)}</div>
        ${metaParts.length ? `<div class="ag-card-meta">${metaParts.map(esc).join(' · ')}</div>` : ''}
        ${priceParts.length ? `<div class="ag-card-price">${priceParts.map(esc).join('  ·  ')}</div>` : ''}
        ${tailParts.length ? `<div class="ag-card-tail">${tailParts.join(' · ')}</div>` : ''}
        ${footerParts.length ? `<div class="ag-card-footer">${footerParts.map(esc).join(' · ')}</div>` : ''}
      </div>
    `;
    tr.appendChild(favTd);

    // 관심(★) 버튼: 이벤트 바인딩
    const favBtnM = favTd.querySelector('.btn-fav');
    const fireBtnM = favTd.querySelector('.btn-fire');
    const refreshFavUiM = () => {
      const nowFav = state.favorites.has(p.id);
      if (favBtnM) {
        favBtnM.textContent = nowFav ? '★' : '☆';
        favBtnM.title = nowFav ? '관심 해제' : '관심 등록';
        favBtnM.classList.toggle('is-active', nowFav);
      }
    };
    const refreshFireUiM = () => {
      const nowFire = state.fires.has(p.id);
      if (fireBtnM) {
        fireBtnM.title = nowFire ? '강추매물 해제' : '강추매물 등록';
        fireBtnM.classList.toggle('is-active', nowFire);
      }
    };
    if (favBtnM) {
      favBtnM.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(p.id, 'star');
        refreshFavUiM();
        refreshFireUiM(); // ★↔🔥 배타: 🔥 가 해제됐을 수도 있으므로 같이 갱신
        if (state.filters.favOnly || state.filters.fireOnly) { state.page = 1; renderTable(); }
      });
    }
    if (fireBtnM) {
      fireBtnM.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(p.id, 'fire');
        refreshFireUiM();
        refreshFavUiM();
        if (state.filters.favOnly || state.filters.fireOnly) { state.page = 1; renderTable(); }
      });
    }
    tr.addEventListener("click", () => openEditModal(p));
    tr.querySelectorAll(".item-no-link").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));
    return tr;
  }

  // ── 데스크톱: 기존 15-컬럼 테이블 로직 그대로 ──
  const favTd = document.createElement("td");
  favTd.className = "fav-col";
  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = "btn-fav" + (isFav ? " is-active" : "");
  favBtn.textContent = isFav ? "★" : "☆";
  favBtn.title = isFav ? "관심 해제" : "관심 등록";
  const fireBtn = document.createElement("button");
  fireBtn.type = "button";
  fireBtn.className = "btn-fire" + (isFire ? " is-active" : "");
  fireBtn.textContent = "🔥";
  fireBtn.title = isFire ? "강추매물 해제" : "강추매물 등록";
  const refreshFavUi = () => {
    const nowFav = state.favorites.has(p.id);
    favBtn.textContent = nowFav ? "★" : "☆";
    favBtn.title = nowFav ? "관심 해제" : "관심 등록";
    favBtn.classList.toggle("is-active", nowFav);
  };
  const refreshFireUi = () => {
    const nowFire = state.fires.has(p.id);
    fireBtn.title = nowFire ? "강추매물 해제" : "강추매물 등록";
    fireBtn.classList.toggle("is-active", nowFire);
  };
  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(p.id, 'star');
    refreshFavUi();
    refreshFireUi(); // ★↔🔥 배타
    if (state.filters.favOnly || state.filters.fireOnly) { state.page = 1; renderTable(); }
  });
  fireBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(p.id, 'fire');
    refreshFireUi();
    refreshFavUi();
    if (state.filters.favOnly || state.filters.fireOnly) { state.page = 1; renderTable(); }
  });
  favTd.appendChild(favBtn);
  favTd.appendChild(fireBtn);
  tr.appendChild(favTd);

  const _srcUrl = p.sourceUrl || p.source_url || '';
  const _itemNoHtml = _srcUrl ? '<a href="' + esc(_srcUrl) + '" target="_blank" rel="noopener" class="item-no-link">' + esc(p.itemNo || "-") + '</a>' : esc(p.itemNo || "-");

  tr.insertAdjacentHTML("beforeend",
    usePlainLayout
      ? "<td>" + _itemNoHtml + "</td>" +
        '<td><span class="kind-text ' + kindClass + '">' + esc(kindLabel) + "</span></td>" +
        '<td class="text-cell" title="' + escAttr(fullAddress) + '">' + esc(addressText) + "</td>" +
        "<td>" + esc(assetTypeText) + "</td>" +
        "<td>" + esc(floorText) + "</td>" +
        "<td>" + (p.exclusivearea != null ? fmtArea(p.exclusivearea) : "-") + "</td>" +
        "<td>" + esc(commonText) + "</td>" +
        "<td>" + esc(siteText) + "</td>" +
        "<td>" + esc(useapprovalText) + "</td>" +
        "<td>" + esc(appraisal) + "</td>" +
        "<td>" + esc(statusLabel) + "</td>" +
        "<td>" + esc(opinionText) + "</td>" +
        "<td>" + (p.siteInspection ? "✓" : "-") + "</td>" +
        "<td>" + esc(createdAtText) + "</td>"
      : "<td>" + _itemNoHtml + "</td>" +
        '<td><span class="kind-text ' + kindClass + '">' + esc(kindLabel) + "</span></td>" +
        '<td class="text-cell" title="' + escAttr(fullAddress) + '">' + esc(addressText) + "</td>" +
        "<td>" + esc(assetTypeText) + "</td>" +
        "<td>" + esc(floorText) + "</td>" +
        "<td>" + (p.exclusivearea != null ? fmtArea(p.exclusivearea) : "-") + "</td>" +
        "<td>" + esc(appraisal) + "</td>" +
        "<td>" + esc(current) + "</td>" +
        "<td>" + esc(rate) + "</td>" +
        '<td class="schedule-cell">' + (scheduleHtml || '-') + "</td>" +
        "<td>" + esc(statusLabel) + "</td>" +
        "<td>" + esc(opinionText) + "</td>" +
        "<td>" + (p.siteInspection ? "✓" : "-") + "</td>" +
        "<td>" + esc(createdAtText) + "</td>"
  );

  tr.addEventListener("click", () => openEditModal(p));
  tr.querySelectorAll(".item-no-link").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));
  return tr;
}

function renderPagination(totalPages) {
    if (!els.agPagination) return;
    els.agPagination.innerHTML = "";
    if (totalPages <= 1) { els.agPagination.classList.add("hidden"); return; }
    els.agPagination.classList.remove("hidden");

    const cur = state.page;
    const go = (page) => {
      state.page = Math.max(1, Math.min(totalPages, page));
      renderTable();
    };

    const frag = document.createDocumentFragment();
    const addBtn = (label, page, disabled, active, title = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = active ? "pager-num is-active" : (typeof label === "number" ? "pager-num" : "pager-btn");
      b.textContent = String(label);
      b.disabled = disabled;
      if (title) b.title = title;
      if (!disabled) b.addEventListener("click", () => go(page));
      frag.appendChild(b);
    };

    addBtn("<<", cur - 20, cur - 20 < 1, false, "20페이지 뒤로");
    addBtn("<", cur - 10, cur - 10 < 1, false, "10페이지 뒤로");
    addBtn("이전", cur - 1, cur <= 1);

    const blockSize = 10;
    const blockStart = Math.floor((cur - 1) / blockSize) * blockSize + 1;
    const blockEnd = Math.min(totalPages, blockStart + blockSize - 1);
    for (let p = blockStart; p <= blockEnd; p++) addBtn(p, p, false, p === cur);

    addBtn("다음", cur + 1, cur >= totalPages);
    addBtn(">", cur + 10, cur + 10 > totalPages, false, "10페이지 앞으로");
    addBtn(">>", cur + 20, cur + 20 > totalPages, false, "20페이지 앞으로");

    els.agPagination.appendChild(frag);
  }

  // ── Edit Modal ──
  function getAgentEditableSnapshot(item) {
    const raw = item?._raw?.raw || {};
    const row = item?._raw || {};
    const normalizedSourceType = PropertyDomain && typeof PropertyDomain.normalizeSourceType === "function"
      ? PropertyDomain.normalizeSourceType(item?.sourceType || row?.source_type || raw.sourceType || raw.source_type || "", { fallback: "" })
      : String(item?.sourceType || row?.source_type || raw.sourceType || raw.source_type || "").trim().toLowerCase();
    const preserveImportedMemo = PropertyDomain && typeof PropertyDomain.usesDedicatedSourceNote === "function"
      ? PropertyDomain.usesDedicatedSourceNote(normalizedSourceType)
      : ["auction", "realtor"].includes(String(normalizedSourceType || "").trim().toLowerCase());
    const sourceNoteInfo = PropertyDomain && typeof PropertyDomain.extractDedicatedSourceNote === "function"
      ? PropertyDomain.extractDedicatedSourceNote(normalizedSourceType, item, raw)
      : { label: "", text: "" };
    const stripSourceEcho = (value) => {
      if (PropertyDomain && typeof PropertyDomain.stripDedicatedSourceNoteEcho === 'function') {
        return PropertyDomain.stripDedicatedSourceNoteEcho(value, sourceNoteInfo.text);
      }
      return String(value || '').trim();
    };
    return {
      floor: firstText(raw.floor, row.floor, item?.floor, ""),
      totalfloor: firstText(raw.totalfloor, raw.total_floor, raw.totalFloor, row.total_floor, row.totalfloor, item?.totalfloor, ""),
      useapproval: firstText(raw.useapproval, raw.useApproval, row.use_approval, item?.useapproval, ""),
      commonarea: raw.commonArea ?? raw.commonarea ?? row.common_area ?? row.commonarea ?? item?.commonarea ?? null,
      exclusivearea: raw.exclusiveArea ?? raw.exclusivearea ?? row.exclusive_area ?? row.exclusivearea ?? item?.exclusivearea ?? null,
      sitearea: raw.siteArea ?? raw.sitearea ?? row.site_area ?? row.sitearea ?? item?.sitearea ?? null,
      priceMain: raw.priceMain ?? row.price_main ?? item?.priceMain ?? null,
      currentPrice: raw.currentPrice ?? raw.lowprice ?? row.lowprice ?? row.low_price ?? item?.lowprice ?? null,
      dateMain: firstText(raw.dateMain, row.date_main, item?.dateMain, ""),
      rightsAnalysis: firstText(raw.rightsAnalysis, raw.rights_analysis, item?.rightsAnalysis, ""),
      siteInspection: stripSourceEcho(firstText(raw.siteInspection, raw.site_inspection, item?.siteInspection, "")),
      dailyIssue: stripSourceEcho(firstText(raw.dailyIssue, raw.daily_issue, "")),
      opinion: stripSourceEcho(preserveImportedMemo
        ? firstText(raw.opinion, item?.opinion, "")
        : firstText(raw.opinion, raw.memo, row.memo, item?.opinion, "")),
      sourceNoteLabel: sourceNoteInfo.label,
      sourceNoteText: sourceNoteInfo.text,
      realtorName: firstText(raw.realtorName, raw.realtorname, row.broker_office_name, item?._raw?.broker_office_name, ""),
      realtorPhone: firstText(raw.realtorPhone, raw.realtorphone, item?._raw?.realtor_phone, ""),
      realtorCell: firstText(raw.realtorCell, raw.realtorcell, row.submitter_phone, item?._raw?.submitter_phone, ""),
      submitterName: firstText(row.submitter_name, raw.submitterName, raw.submitter_name, ""),
      submitterPhone: firstText(row.submitter_phone, raw.submitterPhone, raw.submitter_phone, ""),
    };
  }

  function maybeAssignInitialColumnValue(patch, key, nextValue, currentValue) {
    // [수정 내역] 원래는 "기존 값이 비어있을 때만 최초 할당" 의도였으나, 담당자가
    // 이미 값이 있는 컬럼(floor / common_area / price_main 등)을 수정해도 patch 에
    // 누락되어 DB 반영이 되지 않는 버그의 원인이었다. 담당자 수정이 정상 반영되어야
    // 하므로 단순 대입으로 동작을 변경한다. 함수 이름은 호출부 호환을 위해 유지.
    //   nextValue 가 null / 빈 문자열 → patch[key] = null (명시적 비움)
    //   그 외 값                     → patch[key] = nextValue
    // currentValue 인자는 이제 사용하지 않지만 호출부 시그니처 호환을 위해 남긴다.
    void currentValue;
    if (nextValue == null || nextValue === "") {
      patch[key] = null;
      return;
    }
    patch[key] = nextValue;
  }

  function setAgentEditSection(sectionKey) {
    const activeKey = String(sectionKey || "basic").trim() || "basic";
    if (Array.isArray(els.agEditTabs)) {
      els.agEditTabs.forEach((btn) => {
        const isActive = btn.dataset.editTab === activeKey;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
      });
    }
    if (Array.isArray(els.agEditSections)) {
      els.agEditSections.forEach((section) => {
        section.classList.toggle("is-active", section.dataset.editSection === activeKey);
      });
    }
  }


  function arrangeAgentOpinionFields(form) {
    if (!form || !PropertyRenderers || typeof PropertyRenderers.findFieldShell !== 'function') return null;
    const grid = form.querySelector('[data-opinion-grid="agent"]') || form.querySelector('[data-edit-section="opinion"] .edit-opinion-grid');
    const ensureShell = (fieldName, label) => {
      const shell = PropertyRenderers.findFieldShell(form, fieldName, { shellSelectors: [`[data-opinion-field="${fieldName}"]`, '[data-ag-field]', '.form-field', '.field'] });
      if (!shell) return null;
      PropertyRenderers.ensureTextareaField?.(form, fieldName, shell, { textareaClass: 'ag-textarea', rows: 8 });
      PropertyRenderers.setFieldLabel?.(shell, label);
      shell.classList.remove('hidden');
      shell.hidden = false;
      shell.style.display = '';
      shell.style.gridColumn = '';
      shell.classList.add('edit-opinion-field');
      return shell;
    };
    const dailyIssueShell = ensureShell('dailyIssue', '금일 이슈사항');
    const siteShell = ensureShell('siteInspection', '현장실사');
    const opinionShell = ensureShell('opinion', '담당자 의견');
    if (grid) {
      if (dailyIssueShell) grid.appendChild(dailyIssueShell);
      if (siteShell) grid.appendChild(siteShell);
      if (opinionShell) grid.appendChild(opinionShell);
    }
    return { dailyIssueShell, siteShell, opinionShell };
  }

  function applyAgentSourceNoteField(form, view) {
    if (!form) return;
    const wrap = form.querySelector('[data-ag-source-note]');
    const label = wrap?.querySelector('[data-ag-source-note-label]');
    const text = String(view?.sourceNoteText || '').trim();
    setVal(form, 'sourceNoteDisplay', text);
    if (wrap) wrap.classList.toggle('hidden', !text);
    if (label) label.textContent = view?.sourceNoteLabel || '원본 참고';
  }

  function applyAgentEditFormMode(item, view) {
    const form = els.agEditForm;
    if (!form) return;
    const bucket = getPropertyBucket(item, item?.sourceType || view?.sourceType || "");
    const isRealtor = bucket === "realtor_naver" || bucket === "realtor_direct" || String(item?.sourceType || "").trim() === "realtor";
    const isGeneral = bucket === "general" || String(item?.sourceType || "").trim() === "general";
    const hideForPlain = isRealtor || isGeneral;
    form.querySelectorAll('[data-ag-field="dateMain"], [data-ag-field="currentPrice"]').forEach((node) => {
      node.classList.toggle("hidden", hideForPlain);
    });
    // 진행상태: 경매/공매는 readonly, 나머지는 select로 변경
    const statusWrap = form.querySelector('[data-ag-field="status"]');
    if (statusWrap) {
      statusWrap.classList.remove("hidden");
      const currentStatus = form.elements["status"]?.value || "";
      const isAuctionType = bucket === "auction" || bucket === "onbid";
      if (isAuctionType) {
        // 경매/공매: readonly input
        if (form.elements["status"]?.tagName === "SELECT") {
          const inp = document.createElement("input");
          inp.name = "status"; inp.className = "input"; inp.type = "text"; inp.readOnly = true;
          inp.value = currentStatus;
          form.elements["status"].replaceWith(inp);
        } else {
          form.elements["status"].readOnly = true;
        }
      } else {
        // 중개/일반: select
        const el = form.elements["status"];
        if (el?.tagName !== "SELECT") {
          const sel = document.createElement("select");
          sel.name = "status"; sel.className = "input";
          ["", "관찰", "협상", "보류"].forEach((v) => {
            const opt = document.createElement("option");
            opt.value = v; opt.textContent = v || "선택";
            sel.appendChild(opt);
          });
          if (currentStatus && !["관찰","협상","보류"].includes(currentStatus)) {
            const opt = document.createElement("option");
            opt.value = currentStatus; opt.textContent = currentStatus;
            sel.insertBefore(opt, sel.options[1]);
          }
          sel.value = currentStatus;
          el.replaceWith(sel);
        }
      }
    }
    form.querySelectorAll('[data-ag-section="brokerInfo"]').forEach((node) => node.classList.toggle("hidden", !isRealtor));
    form.querySelectorAll('[data-ag-section="ownerInfo"]').forEach((node) => node.classList.toggle("hidden", !isGeneral));
    const isAuction = bucket === "auction";
    const isOnbid = bucket === "onbid";
    form.querySelectorAll('[data-ag-section="auctionInfo"]').forEach((node) => node.classList.toggle("hidden", !isAuction));
    form.querySelectorAll('[data-ag-section="resultInfo"]').forEach((node) => node.classList.toggle("hidden", !(isAuction || isOnbid)));
    setVal(form, "brokerOfficeDisplay", view?.realtorName || "-");
    setVal(form, "brokerPhoneDisplay", view?.realtorPhone || "-");
    setVal(form, "brokerCellDisplay", view?.realtorCell || "-");
    const _agRaw = item?._raw?.raw && typeof item._raw.raw === "object" ? item._raw.raw : (item?.raw && typeof item.raw === "object" ? item.raw : {});
    if (!form.elements["brokerPhoneDisplay"]?.value || form.elements["brokerPhoneDisplay"]?.value === "-") setVal(form, "brokerPhoneDisplay", _agRaw["중개사 유선전화"] || _agRaw["중개사무소전화"] || _agRaw["대표전화"] || _agRaw.realtorPhone || "-");
    if (!form.elements["brokerCellDisplay"]?.value || form.elements["brokerCellDisplay"]?.value === "-") setVal(form, "brokerCellDisplay", _agRaw["중개사 휴대폰"] || _agRaw["휴대폰번호"] || _agRaw["휴대폰"] || _agRaw.realtorCell || "-");
    const agBrokerMemoEl = form.elements["brokerMemoDisplay"];
    // [수정 내역] "매물특징" 은 네이버중개 CSV 업로드 시 import 된 원본 메모에만
    // 바인딩되어야 한다. 기존 fallback 첫 번째가 _agRaw.memo(담당자 의견) 여서
    // 담당자가 의견을 저장하면 매물특징 칸에도 같은 텍스트가 뜨는 버그가 있었다.
    if (agBrokerMemoEl) agBrokerMemoEl.value = _agRaw.importedSourceText || _agRaw.sourceNoteText || _agRaw["매물특징"] || _agRaw.brokerMemo || "";
    const agAuctionInfoEl = form.elements["auctionInfoDisplay"];
    if (agAuctionInfoEl) agAuctionInfoEl.value = _agRaw["경매현황"] || _agRaw.auctionStatus || _agRaw.auction_status || "";
    const agAuctionBigoEl = form.elements["auctionBigoDisplay"];
    if (agAuctionBigoEl) agAuctionBigoEl.value = _agRaw["비고"] || "";
    setVal(form, "ownerNameDisplay", view?.submitterName || "-");
    setVal(form, "ownerPhoneDisplay", view?.submitterPhone || "-");
    arrangeAgentOpinionFields(form);
  }

  function openEditModal(item) {
    state.editingProperty = item;
    if (!els.agEditForm) return;
    const f = els.agEditForm;
    const view = getAgentEditableSnapshot(item);
    const kindLabel = getPropertyKindLabel(item.sourceType, item);

    configureFormNumericUx(f, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain", "currentPrice", "resultPrice"] });

    setVal(f, "itemNo", item.itemNo);
    setVal(f, "sourceType", kindLabel || "일반");
    setVal(f, "submitterType", getSubmitterDisplayLabel(item));
    setVal(f, "assetType", item.assetType === "-" ? "" : item.assetType);
    setVal(f, "status", item.status);
    setVal(f, "address", item.address);
    applyAgentSourceNoteField(f, view);
    setVal(f, "floor", view.floor);
    setVal(f, "totalfloor", view.totalfloor);
    setVal(f, "useapproval", formatDate(view.useapproval));
    setVal(f, "commonarea", view.commonarea != null ? fmtArea(view.commonarea) : "");
    setVal(f, "exclusivearea", view.exclusivearea != null ? fmtArea(view.exclusivearea) : "");
    setVal(f, "sitearea", view.sitearea != null ? fmtArea(view.sitearea) : "");
    setVal(f, "priceMain", view.priceMain != null ? formatMoneyInputValue(view.priceMain) : "");
    setVal(f, "currentPrice", view.currentPrice != null ? formatMoneyInputValue(view.currentPrice) : "");
    setVal(f, "dateMain", formatDate(view.dateMain) || "");
    setVal(f, "rightsAnalysis", view.rightsAnalysis);
    setVal(f, "siteInspection", getEditorHistoryText(item, "siteInspection") || view.siteInspection || "");
    setVal(f, "opinion", getEditorHistoryText(item, "opinion") || view.opinion || "");
    setVal(f, "dailyIssue", getEditorHistoryText(item, "dailyIssue", { todayOnly: true }) || "");
    setVal(f, "resultStatus", item?._raw?.result_status || item?.result_status || item?.resultStatus || (item?.status === '낙찰' || item?._raw?.status === '낙찰' ? '낙찰' : '') || "");
    setVal(f, "resultPrice", item?._raw?.result_price != null ? formatMoneyInputValue(item._raw.result_price) : (item?.result_price != null ? formatMoneyInputValue(item.result_price) : ""));
    setVal(f, "resultDate", formatDate(item?._raw?.result_date || item?.result_date || item?.resultDate || ""));
    // fallback: DB에서 직접 조회
    if (!f.elements["resultPrice"]?.value && isSupabaseMode()) {
      const _sb = K.initSupabase();
      const _tid = String(item?._raw?.id || item?.id || item?.globalId || "").trim();
      if (_sb && _tid) {
        (async () => {
          try {
            const { data } = await _sb.from("properties").select("result_status,result_price,result_date").or("id.eq." + _tid + ",global_id.eq." + _tid).limit(1).maybeSingle();
            if (data) {
              if (data.result_status && !f.elements["resultStatus"]?.value) setVal(f, "resultStatus", data.result_status);
              if (data.result_price != null && !f.elements["resultPrice"]?.value) setVal(f, "resultPrice", formatMoneyInputValue(data.result_price));
              if (data.result_date && !f.elements["resultDate"]?.value) setVal(f, "resultDate", formatDate(data.result_date));
            }
          } catch (_) {}
        })();
      }
    }

    ["itemNo", "sourceType", "assetType", "status", "address"].forEach((name) => {
      const el = f.elements[name];
      if (el) {
        el.readOnly = true;
        el.classList.add("agent-lock-input");
      }
    });

    setAgentEditMsg('', true);
    renderCombinedPropertyLog(els.agCombinedLogList, loadOpinionHistory(item), loadRegistrationLog(item));
    applyAgentEditFormMode(item, view);
    arrangeAgentOpinionFields(f);
    setAgentEditSection("basic");
    if (PropertyRenderers && typeof PropertyRenderers.setModalVisibility === 'function') {
      PropertyRenderers.setModalVisibility(els.agEditModal, true);
    } else {
      els.agEditModal.classList.remove("hidden");
      els.agEditModal.setAttribute("aria-hidden", "false");
    }
    // 모바일 pull-to-refresh 방지: body + html 스크롤 잠금
    document.body.classList.add('modal-open-lock');
    document.documentElement.classList.add('modal-open-lock-html');
    const PhotoManager = window.KNSN_PROPERTY_PHOTOS || null;
    const propertyId = String(item?._raw?.id || item?.id || '').trim();
    if (PhotoManager && propertyId && typeof PhotoManager.mountSection === 'function') {
      PhotoManager.mountSection({ form: f, propertyId, api }).catch((err) => {
        console.warn('agent photo section mount failed', err);
      });
    }
    // 동영상 모듈 마운트 (사진 직후, 동일 propertyId / api 사용)
    const VideoManager = window.KNSN_PROPERTY_VIDEOS || null;
    if (VideoManager && propertyId && typeof VideoManager.mountSection === 'function') {
      VideoManager.mountSection({ form: f, propertyId, api }).catch((err) => {
        console.warn('agent video section mount failed', err);
      });
    }
  }

  function closeEditModal() {
    state.editingProperty = null;
    if (els.agEditModal) {
      if (PropertyRenderers && typeof PropertyRenderers.setModalVisibility === 'function') {
        PropertyRenderers.setModalVisibility(els.agEditModal, false);
      } else {
        els.agEditModal.classList.add("hidden");
        els.agEditModal.setAttribute("aria-hidden", "true");
      }
    }
    // 모바일 body + html 스크롤 잠금 해제
    document.body.classList.remove('modal-open-lock');
    document.documentElement.classList.remove('modal-open-lock-html');
  }

  async function saveProperty() {
    const item = state.editingProperty;
    if (!item) return;
    const f = els.agEditForm;
    const readStr = (name) => String((f.elements[name]?.value) || "").trim();
    const readNum = (name) => parseFlexibleNumber(f.elements[name]?.value);
    const newOpinionText = readStr("opinion");
    const newDailyIssueText = readStr("dailyIssue");
    const newSiteInspectionText = readStr("siteInspection");
    let opinionHistory = Array.isArray(loadOpinionHistory(item)) ? loadOpinionHistory(item) : [];
    opinionHistory = appendHistoryIfChanged(item, opinionHistory, "siteInspection", newSiteInspectionText, state.session?.user);
    opinionHistory = appendHistoryIfChanged(item, opinionHistory, "opinion", newOpinionText, state.session?.user);
    opinionHistory = appendHistoryIfChanged(item, opinionHistory, "dailyIssue", newDailyIssueText, state.session?.user);

    const currentUserId = String(state.session?.user?.id || "").trim();
    const patch = {};
    const bucket = getPropertyBucket(item, item?.sourceType || "");
    const hidePlainFields = ["realtor_naver", "realtor_direct", "general"].includes(bucket);
    const prev = getAgentEditableSnapshot(item);
    let rightsVal = readStr("rightsAnalysis") || null;
    const siteVal = readStr("siteInspection") || null;
    const floorVal = readStr("floor") || null;
    const totalFloorVal = readStr("totalfloor") || null;
    const useApprovalVal = readStr("useapproval") || null;
    const commonAreaVal = readNum("commonarea");
    const exclusiveAreaVal = readNum("exclusivearea");
    const siteAreaVal = readNum("sitearea");
    const priceMainVal = readNum("priceMain");
    const currentPriceVal = readNum("currentPrice");
    const dateMainVal = hidePlainFields ? (String(prev.dateMain || "").trim() || null) : (readStr("dateMain") || null);

    patch.memo = newOpinionText || null;

    try {
      if (els.agEditSave) els.agEditSave.disabled = true;
      // 저장 버튼 클릭 직후 사용자에게 즉시 진행 상태를 피드백한다.
      // 기존에는 서버 PATCH + activity log POST 가 끝난 뒤에야 완료 팝업이 떠서
      // 3 초 가량 "아무 반응 없음" 상태로 보이던 문제를 해결한다.
      setAgentLoading('save', true, '저장 중입니다...');
      if (!currentUserId) throw new Error("로그인 정보가 만료되었습니다. 다시 로그인해 주세요.");
      if (!K || typeof K.initSupabase !== "function") throw new Error("Supabase 클라이언트를 초기화할 수 없습니다.");
      const sb = K.initSupabase();
      if (!sb) throw new Error("Supabase 클라이언트를 초기화할 수 없습니다.");
      try { if (typeof K.sbSyncLocalSession === "function") await K.sbSyncLocalSession(); } catch {}

      const targetId = String(item?._raw?.id || item.id || item.globalId || "").trim();
      const targetCol = item?._raw?.id ? "id" : "global_id";
      if (!targetId) throw new Error("수정 대상 물건 식별자를 찾을 수 없습니다.");

      const existingRaw = sanitizePropertyRawForSave(item._raw?.raw || {});
      const sourceNoteInfo = PropertyDomain && typeof PropertyDomain.extractDedicatedSourceNote === "function"
        ? PropertyDomain.extractDedicatedSourceNote(item?.sourceType || item?._raw?.source_type || existingRaw.source_type || existingRaw.sourceType || "", item, existingRaw)
        : { label: "", text: "" };
      const normalizedSourceType = (PropertyDomain && typeof PropertyDomain.normalizeSourceType === "function")
        ? PropertyDomain.normalizeSourceType(
            item?.sourceType || item?._raw?.source_type || existingRaw.source_type || existingRaw.sourceType || "",
            { fallback: "" }
          )
        : String(item?.sourceType || item?._raw?.source_type || existingRaw.source_type || existingRaw.sourceType || "").trim().toLowerCase();
      const normalizedSubmitterType = (PropertyDomain && typeof PropertyDomain.normalizeSubmitterType === "function")
        ? PropertyDomain.normalizeSubmitterType(
            item?._raw?.submitter_type || existingRaw.submitter_type || existingRaw.submitterType || "",
            { fallback: "" }
          )
        : String(item?._raw?.submitter_type || existingRaw.submitter_type || existingRaw.submitterType || "").trim().toLowerCase();
      if (normalizedSourceType) {
        patch.source_type = normalizedSourceType;
        patch.is_general = normalizedSourceType === "general";
      }
      if (normalizedSubmitterType) patch.submitter_type = normalizedSubmitterType;

      const newRaw = sanitizePropertyRawForSave(existingRaw, {
        ...(normalizedSourceType ? {
          sourceType: normalizedSourceType,
          source_type: normalizedSourceType,
          is_general: normalizedSourceType === "general",
        } : {}),
        ...(normalizedSubmitterType ? {
          submitterType: normalizedSubmitterType,
          submitter_type: normalizedSubmitterType,
        } : {}),
        ...(sourceNoteInfo?.label ? { importedSourceLabel: existingRaw.importedSourceLabel || sourceNoteInfo.label, sourceNoteLabel: existingRaw.sourceNoteLabel || sourceNoteInfo.label } : {}),
        ...(sourceNoteInfo?.text ? { importedSourceText: existingRaw.importedSourceText || sourceNoteInfo.text, sourceNoteText: existingRaw.sourceNoteText || sourceNoteInfo.text } : {}),
        floor: floorVal,
        totalfloor: totalFloorVal,
        useapproval: useApprovalVal,
        commonArea: commonAreaVal,
        exclusiveArea: exclusiveAreaVal,
        siteArea: siteAreaVal,
        priceMain: priceMainVal,
        currentPrice: currentPriceVal,
        dateMain: dateMainVal,
        rightsAnalysis: rightsVal,
        siteInspection: newSiteInspectionText || null,
        opinion: patch.memo,
        memo: patch.memo,
        dailyIssue: newDailyIssueText || null,
        daily_issue: newDailyIssueText || null,
        opinionHistory,
      });
      const regContext = buildRegisterLogContext('담당자 수정', { user: state.session?.user });
      const mergedLogRow = buildRegistrationDbRowForExisting(item, {
        address: item.address,
        asset_type: item.assetType,
        floor: floorVal,
        total_floor: totalFloorVal,
        common_area: commonAreaVal,
        exclusive_area: exclusiveAreaVal,
        site_area: siteAreaVal,
        use_approval: useApprovalVal,
        status: readStr('status') || null,
        price_main: priceMainVal,
        lowprice: currentPriceVal,
        date_main: dateMainVal,
        broker_office_name: item._raw?.broker_office_name || null,
        submitter_name: item._raw?.submitter_name || null,
        submitter_phone: item._raw?.submitter_phone || null,
        memo: patch.memo,
        source_type: normalizedSourceType || item._raw?.source_type || null,
        submitter_type: normalizedSubmitterType || item._raw?.submitter_type || null,
        raw: newRaw,
      }, regContext, { assignIfEmpty: false });
      if (mergedLogRow?.row?.raw) newRaw.registrationLog = mergedLogRow.row.raw.registrationLog || newRaw.registrationLog;

      maybeAssignInitialColumnValue(patch, "use_approval", useApprovalVal, item?._raw?.use_approval);
      maybeAssignInitialColumnValue(patch, "common_area", commonAreaVal, item?._raw?.common_area);
      maybeAssignInitialColumnValue(patch, "exclusive_area", exclusiveAreaVal, item?._raw?.exclusive_area);
      maybeAssignInitialColumnValue(patch, "site_area", siteAreaVal, item?._raw?.site_area);
      maybeAssignInitialColumnValue(patch, "price_main", priceMainVal, item?._raw?.price_main);
      maybeAssignInitialColumnValue(patch, "date_main", dateMainVal, item?._raw?.date_main);

      // [수정 내역] 물건상세 탭의 모든 필드를 DB 컬럼에 직접 매핑한다.
      // 기존에는 floor / total_floor / lowprice / status 가 patch 에 누락되어
      // raw jsonb 에만 저장되고 실제 컬럼은 stale 인 상태였다. 관리자 저장 경로
      // (admin-tab-properties.js updatePropertyAdmin) 와 동일 수준으로 맞춘다.
      patch.status = readStr("status") || null;
      patch.floor = floorVal;
      patch.total_floor = totalFloorVal;
      patch.lowprice = currentPriceVal;

      const resultStatusVal = readStr("resultStatus") || null;
      const resultPriceVal = readNum("resultPrice");
      const resultDateVal = readStr("resultDate") || null;
      if (resultStatusVal != null) patch.result_status = resultStatusVal;
      if (resultPriceVal != null) patch.result_price = resultPriceVal;
      if (resultDateVal) patch.result_date = resultDateVal;

      const workCategories = [];
      const changedFields = {};
      if (rightsVal && rightsVal !== String(prev.rightsAnalysis || "").trim()) {
        workCategories.push("rightsAnalysis");
        changedFields.rightsAnalysis = ["rightsAnalysis"];
      }
      if (siteVal && siteVal !== String(prev.siteInspection || "").trim()) {
        workCategories.push("siteInspection");
        changedFields.siteInspection = ["siteInspection"];
      }
      if (newDailyIssueText && newDailyIssueText !== String(prev.dailyIssue || '').trim()) {
        workCategories.push("dailyIssue");
        changedFields.dailyIssue = ["dailyIssue"];
      }
      if (newOpinionText && newOpinionText !== String(prev.opinion || '').trim()) {
        workCategories.push("opinion");
        changedFields.opinion = ["opinion"];
      }
      patch.raw = newRaw;
      Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

      const updatedRow = await updatePropertyRowResilient(sb, targetId, patch);
      if (!updatedRow) {
        throw new Error("수정 가능한 물건을 찾지 못했습니다. assignee_id 배정 상태를 다시 확인해 주세요.");
      }

      let activityError = "";
      if (workCategories.length) {
        try {
          await recordDailyReportEntries(buildActivityLogEntries(workCategories, {
            ...item,
            floor: floorVal || item.floor,
            totalfloor: totalFloorVal || item.totalfloor,
            rightsAnalysis: rightsVal || item.rightsAnalysis,
            siteInspection: siteVal || item.siteInspection,
            opinion: patch.memo || item.opinion,
            dailyIssue: newDailyIssueText || item.dailyIssue,
            _raw: { ...(item._raw || {}), raw: newRaw },
          }, {
            propertyId: updatedRow?.id || item.id || item.globalId || targetId,
            identityKey: newRaw.registrationIdentityKey || buildRegistrationMatchKey({ ...item, raw: newRaw, _raw: { ...(item._raw || {}), raw: newRaw } }),
            changedFields,
            dailyIssueText: newDailyIssueText,
            opinionText: newOpinionText,
            siteInspectionText: siteVal,
          }));
        } catch (logErr) {
          const baseMsg = logErr?.message || "일일업무일지 기록 실패";
          const codeTag = logErr?.serverCode ? ` [${logErr.serverCode}]` : "";
          activityError = `${baseMsg}${codeTag}`;
          // 운영 진단용: 서버가 돌려준 원본 code/debug/raw 를 콘솔에 기록한다.
          // (사용자에게 노출되지는 않지만 F12 콘솔에서 바로 확인 가능)
          try {
            console.warn('[activity_log][save_failed]', {
              message: baseMsg,
              serverCode: logErr?.serverCode || null,
              serverDebug: logErr?.serverDebug || null,
              httpStatus: logErr?.httpStatus || null,
              serverData: logErr?.serverData || null,
            });
          } catch {}
        }
      }

      setAgentEditMsg('', false);
      // [수정 내역] 백그라운드 refresh(50ms 후 시작 + 서버 fetch 수백 ms)가 끝나기 전에
      // 사용자가 모달을 다시 열 수 있다. 그 시점에 item 객체는 여전히 이전 값(예: 기존
      // opinion 텍스트)을 갖고 있어 getAgentEditableSnapshot 의 firstText fallback 이
      // stale 값을 반환한다. 저장 직후 item 및 item._raw 의 관련 필드를 서버 전송 값으로
      // 즉시 동기화해 모달 재오픈 시 UI 가 정확히 반영되도록 한다.
      // patch.memo 는 null(공백 저장) 또는 신규 opinion 텍스트. patch.raw 는 newRaw.
      try {
        if (item) {
          item.opinion = patch.memo;
          item.dailyIssue = newDailyIssueText || null;
          item.siteInspection = newSiteInspectionText || null;
          item.memo = patch.memo;
          if (patch.status !== undefined) item.status = patch.status;
          if (patch.floor !== undefined) item.floor = patch.floor;
          if (patch.total_floor !== undefined) item.totalfloor = patch.total_floor;
          if (patch.lowprice !== undefined) item.lowprice = patch.lowprice;
          if (item._raw && typeof item._raw === 'object') {
            item._raw.memo = patch.memo;
            item._raw.raw = newRaw;
            if (patch.status !== undefined) item._raw.status = patch.status;
            if (patch.floor !== undefined) item._raw.floor = patch.floor;
            if (patch.total_floor !== undefined) item._raw.total_floor = patch.total_floor;
            if (patch.lowprice !== undefined) item._raw.lowprice = patch.lowprice;
          }
        }
      } catch (syncErr) {
        // 로컬 동기화 실패는 저장 자체에 영향 없음. 경고만 남기고 background refresh 대기.
        try { console.warn('[saveProperty] local item sync failed', syncErr); } catch {}
      }
      closeEditModal();
      flashAgentSaveNotice('저장되었습니다.', 1500);
      if (activityError) setGlobalMsg(`저장은 완료되었지만 업무일지 기록에 실패했습니다. ${activityError}`);
      else setGlobalMsg('', false);
      window.setTimeout(() => refreshAgentPropertiesInBackground({ silent: true }), 50);
    } catch (err) {
      setAgentEditMsg(toUserErrorMessage(err, '저장 실패'));
    } finally {
      setAgentLoading('save', false);
      if (els.agEditSave) els.agEditSave.disabled = false;
    }
  }

  // ── Password Change ──
  function openPwdModal() {
    if (els.pwdModal) {
      if (PropertyRenderers && typeof PropertyRenderers.setModalVisibility === 'function') {
        PropertyRenderers.setModalVisibility(els.pwdModal, true);
      } else {
        els.pwdModal.classList.remove("hidden"); els.pwdModal.setAttribute("aria-hidden", "false");
      }
    }
    if (els.pwdMsg) els.pwdMsg.textContent = "";
  }
  function closePwdModal() {
    if (els.pwdModal) {
      if (PropertyRenderers && typeof PropertyRenderers.setModalVisibility === 'function') {
        PropertyRenderers.setModalVisibility(els.pwdModal, false);
      } else {
        els.pwdModal.classList.add("hidden"); els.pwdModal.setAttribute("aria-hidden", "true");
      }
    }
  }
  async function changePassword() {
    const f = els.pwdForm;
    const pw = String(f.elements.newPassword?.value || "").trim();
    const pw2 = String(f.elements.confirmPassword?.value || "").trim();
    if (!pw || pw.length < 8) { if (els.pwdMsg) els.pwdMsg.textContent = "비밀번호는 8자 이상이어야 합니다."; return; }
    if (pw !== pw2) { if (els.pwdMsg) els.pwdMsg.textContent = "비밀번호가 일치하지 않습니다."; return; }
    try {
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) throw new Error("Supabase 연동 필요");
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      alert("비밀번호가 변경되었습니다.");
      closePwdModal();
    } catch (err) {
      if (els.pwdMsg) els.pwdMsg.textContent = toUserErrorMessage(err, "변경 실패");
    }
  }


  function truncateDisplayText(value, maxLength) {
    if (PropertyRenderers && typeof PropertyRenderers.truncateDisplayText === 'function') {
      return PropertyRenderers.truncateDisplayText(value, maxLength);
    }
    return String(value ?? '').trim();
  }

  function getFloorDisplayValue(item) {
    if (PropertyRenderers && typeof PropertyRenderers.getFloorDisplayValue === 'function') {
      return PropertyRenderers.getFloorDisplayValue(item);
    }
    return String(item?.floor || item?._raw?.floor || '').trim();
  }

  function firstText(...args) {
    if (PropertyRenderers && typeof PropertyRenderers.firstText === 'function') return PropertyRenderers.firstText(...args);
    if (PropertyDomain && typeof PropertyDomain.pickFirstText === "function") return PropertyDomain.pickFirstText(...args);
    for (const v of args) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return "";
  }

  function toNum(v) {
    if (PropertyRenderers && typeof PropertyRenderers.toNullableNumber === 'function') return PropertyRenderers.toNullableNumber(v);
    if (Shared && typeof Shared.toNullableNumber === "function") return Shared.toNullableNumber(v);
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function esc(v) {
    if (PropertyRenderers && typeof PropertyRenderers.escapeHtml === 'function') return PropertyRenderers.escapeHtml(v);
    if (Shared && typeof Shared.escapeHtml === "function") return Shared.escapeHtml(v);
    return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function escAttr(v) {
    if (PropertyRenderers && typeof PropertyRenderers.escapeAttr === 'function') return PropertyRenderers.escapeAttr(v);
    if (Shared && typeof Shared.escapeAttr === "function") return Shared.escapeAttr(v);
    return esc(v).replace(/'/g, "&#39;");
  }

  function formatEok(n) {
    if (PropertyRenderers && typeof PropertyRenderers.formatMoneyEok === 'function') {
      return PropertyRenderers.formatMoneyEok(n, '-');
    }
    if (n == null) return "-";
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "-";
    if (v >= 100000000) return (v / 100000000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1") + " 억원";
    if (v >= 10000) return (v / 10000).toFixed(0) + " 만원";
    return v.toLocaleString() + " 원";
  }

  function fmtArea(v) {
    if (PropertyRenderers && typeof PropertyRenderers.formatAreaPyeong === 'function') return PropertyRenderers.formatAreaPyeong(v, '-');
    const n = toNum(v);
    if (n == null || n <= 0) return "-";
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function calcRate(appraisal, current) {
    if (PropertyRenderers && typeof PropertyRenderers.formatPercent === 'function') return PropertyRenderers.formatPercent(appraisal, current, null, '-');
    const a = Number(appraisal || 0);
    const c = Number(current || 0);
    if (!a || !c || a <= 0) return "-";
    return (c / a * 100).toFixed(1) + "%";
  }

  function normalizeStatus(v) {
    if (PropertyRenderers && typeof PropertyRenderers.statusLabel === 'function') return PropertyRenderers.statusLabel(v, '-');
    const s = String(v || "").trim().toLowerCase();
    if (!s) return "-";
    const map = { active: "진행중", hold: "보류", closed: "종결", review: "검토중" };
    return map[s] || v || "-";
  }

  function formatDate(v) {
    if (PropertyRenderers && typeof PropertyRenderers.formatDateValue === 'function') return PropertyRenderers.formatDateValue(v, '');
    if (Shared && typeof Shared.formatDate === "function") return Shared.formatDate(v);
    const s = String(v || "").trim();
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }


  function parseFlexibleDateLocal(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      const datePart = raw.slice(0, 10);
      const [y, m, d] = datePart.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  function computeDdayLabel(value) {
    const target = parseFlexibleDateLocal(value);
    if (!target) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diffDays === 0) return 'D-Day';
    if (diffDays > 0) return `D-${diffDays}`;
    return `D+${Math.abs(diffDays)}`;
  }


  function formatScheduleHtmlLocal(item) {
    const raw = item?._raw?.raw && typeof item._raw.raw === 'object'
      ? item._raw.raw
      : (item?._raw && typeof item._raw === 'object' ? item._raw : (item?.raw && typeof item.raw === 'object' ? item.raw : {}));
    const rawValue = item?.dateMain
      || item?.date_main
      || item?.bidDate
      || raw['입찰일자']
      || raw['입찰마감일시']
      || raw.dateMain
      || raw.date_main
      || raw.bidDate
      || '';
    const dateText = formatDate(rawValue);
    if (!dateText) return '-';
    const dday = computeDdayLabel(rawValue);
    return `<span class="schedule-stack"><span class="schedule-date">${esc(dateText)}</span>${dday ? `<span class="schedule-dday">${esc(dday)}</span>` : '<span class="schedule-dday schedule-dday-empty"></span>'}</span>`;
  }

  function formatScheduleCountdown(value) {
    if (PropertyRenderers && typeof PropertyRenderers.formatScheduleCountdown === 'function') {
      return PropertyRenderers.formatScheduleCountdown(value, '-');
    }
    const dateText = formatDate(value);
    if (!dateText) return '-';
    const dday = computeDdayLabel(value);
    return dday ? `${dateText} (${dday})` : dateText;
  }

  function setVal(form, name, value) {
    if (PropertyRenderers && typeof PropertyRenderers.setFormValue === 'function') {
      PropertyRenderers.setFormValue(form, name, value, { emptyValue: '' });
      return;
    }
    const el = form.elements[name];
    if (!el) return;
    el.value = value || "";
  }

  // ══════════════════════════════════════════════════════════════════════
  // 신규 물건 등록 모달 — 주소 기반 중복 감지 프리뷰
  // 2026-04-24 추가: 사용자가 주소/층을 입력하는 동안 DB 내 동일/유사
  // 매물이 있는지 실시간 감지해 모달 내 인라인 영역에 안내한다.
  //
  // 매칭 키: buildRegistrationMatchKey 재사용 (저장 시 로직과 완전 동일)
  //   → 주소 표기 변형(서울특별시/서울시, 동번지 붙임 등) 자동 흡수
  //
  // 탐색 2단계:
  //   ① 클라이언트(state.properties) 즉시 → 본인 담당 매물에서 찾으면 0ms 로 표시
  //   ② 서버(Supabase) debounce 450ms → 다른 담당자/미배정 포함 DB 전체
  //
  // 상태 분기:
  //   idle / searching / parse-fail / new / own / unassigned / other-staff / building
  // ══════════════════════════════════════════════════════════════════════

  const npmDupState = { generation: 0, lastAddress: "", lastFloor: "", blockedForSave: false };

  function getNpmFormInput(name) {
    return els.newPropertyForm?.querySelector(`input[name="${name}"]`) || null;
  }

  function escapeHtmlForPreview(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }

  function resetNpmDupPreview() {
    npmDupState.generation++;
    npmDupState.lastAddress = "";
    npmDupState.lastFloor = "";
    npmDupState.blockedForSave = false;
    const box = els.npmDupPreview;
    if (box) {
      box.hidden = true;
      box.dataset.state = "idle";
      box.innerHTML = "";
    }
    if (els.npmSave) els.npmSave.disabled = false;
  }

  function renderNpmDupPreview(state) {
    const box = els.npmDupPreview;
    if (!box) return;
    const kind = state?.kind || "idle";
    box.dataset.state = kind;
    box.hidden = false;

    const setSaveBlocked = (blocked) => {
      npmDupState.blockedForSave = !!blocked;
      if (els.npmSave) els.npmSave.disabled = !!blocked;
    };

    if (kind === "idle") {
      box.hidden = true;
      box.innerHTML = "";
      setSaveBlocked(false);
      return;
    }
    if (kind === "searching") {
      box.innerHTML = `<div class="npm-dup-head">🔍 중복 확인 중…</div>`;
      setSaveBlocked(false);
      return;
    }
    if (kind === "parse-fail") {
      box.innerHTML = `<div class="npm-dup-head">💡 주소 확인</div>
        <div class="npm-dup-body">지번 주소로 입력해 주세요 <span class="npm-dup-sub">(예: 서울 강남구 역삼동 736-20)</span></div>`;
      setSaveBlocked(false);
      return;
    }
    if (kind === "new") {
      box.innerHTML = `<div class="npm-dup-head">✅ 신규 매물입니다</div>`;
      setSaveBlocked(false);
      return;
    }
    if (kind === "own") {
      const addr = escapeHtmlForPreview(state?.match?.address || "");
      box.innerHTML = `<div class="npm-dup-head">⚠️ 본인이 관리중인 매물입니다</div>
        <div class="npm-dup-body"><em>${addr}</em></div>
        <div class="npm-dup-actions"><button type="button" class="npm-dup-btn" data-npm-dup-action="edit">편집으로 이동</button></div>`;
      setSaveBlocked(false);
      return;
    }
    if (kind === "unassigned") {
      const addr = escapeHtmlForPreview(state?.match?.address || "");
      box.innerHTML = `<div class="npm-dup-head">ℹ️ DB에 등록된 미배정 건입니다. 저장 시 본인에게 배정됩니다</div>
        <div class="npm-dup-body"><em>${addr}</em></div>`;
      setSaveBlocked(false);
      return;
    }
    if (kind === "other-staff") {
      const addr = escapeHtmlForPreview(state?.match?.address || "");
      const staffName = escapeHtmlForPreview(state?.match?.assigneeName || "알 수 없음");
      box.innerHTML = `<div class="npm-dup-head">🚫 다른 담당자(${staffName})에게 배정된 매물입니다. 해당 담당자에게 문의하세요</div>
        <div class="npm-dup-body"><em>${addr}</em></div>`;
      setSaveBlocked(true);
      return;
    }
    if (kind === "building") {
      const own = Number(state?.counts?.own || 0);
      const unassigned = Number(state?.counts?.unassigned || 0);
      const others = Array.isArray(state?.counts?.others) ? state.counts.others : [];
      const othersCount = others.reduce((acc, g) => acc + Number(g.count || 0), 0);
      const total = own + unassigned + othersCount;
      const lines = [];
      if (own > 0) lines.push(`<li><span class="npm-dup-list-label">본인 담당</span><span>${own}건</span></li>`);
      if (unassigned > 0) lines.push(`<li><span class="npm-dup-list-label">미배정</span><span>${unassigned}건</span></li>`);
      if (othersCount > 0) {
        const names = others.map((g) => `${escapeHtmlForPreview(g.name || "알 수 없음")} ${g.count}건`).join(", ");
        lines.push(`<li><span class="npm-dup-list-label">타 담당자</span><span>${names}</span></li>`);
      }
      box.innerHTML = `<div class="npm-dup-head">🏢 이 건물에 이미 ${total}건 등록됨</div>
        <ul class="npm-dup-list">${lines.join("")}</ul>
        <div class="npm-dup-sub">층·호까지 입력하시면 정확히 어느 매물인지 확인됩니다.</div>`;
      setSaveBlocked(false);
      return;
    }
  }

  // 같은 건물 매물 그룹핑 (본인/미배정/타담당자별 카운트)
  function summarizeBuildingMatches(rows, currentUserId) {
    const myId = String(currentUserId || "").trim();
    let own = 0, unassigned = 0;
    const otherMap = new Map(); // assignee_id → { name, count }
    for (const row of Array.isArray(rows) ? rows : []) {
      const aid = String(row?.assignee_id || "").trim();
      if (!aid) { unassigned += 1; continue; }
      if (myId && aid === myId) { own += 1; continue; }
      const name = String(row?.assignee_name || row?.assigneeName || "").trim() || "알 수 없음";
      const ent = otherMap.get(aid) || { name, count: 0 };
      ent.count += 1;
      otherMap.set(aid, ent);
    }
    return { own, unassigned, others: Array.from(otherMap.values()) };
  }

  // address 에서 건물 레벨 파싱 (dong + mainNo + subNo)
  function buildBuildingKey(address) {
    const parts = (PropertyDomain && typeof PropertyDomain.parseAddressIdentityParts === "function")
      ? PropertyDomain.parseAddressIdentityParts(address || "")
      : parseAddressIdentityParts(address || "");
    if (!parts?.dong || !parts?.mainNo) return "";
    return `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}`;
  }

  // 클라이언트 state.properties 에서 같은 건물 매물 전수 탐색
  function findBuildingMatchesLocal(address) {
    const target = buildBuildingKey(address);
    if (!target) return [];
    const out = [];
    for (const item of Array.isArray(state?.properties) ? state.properties : []) {
      const snap = buildRegistrationSnapshotFromItem(item);
      if (buildBuildingKey(snap?.address || item?.address) === target) {
        out.push(item?._raw || item);
      }
    }
    return out;
  }

  // 서버 API 경유로 같은 건물 매물 조회 (담당자 RLS 우회용)
  // 주의: 담당자 세션으로 sb.from('properties') 을 직접 치면 본인 매물만 반환되므로
  // /api/properties (action=search_duplicates) 로 service_role 서버 경로를 사용한다.
  async function findBuildingMatchesRemote(_sb, address) {
    if (!DataAccess || typeof DataAccess.searchBuildingDuplicatesViaApi !== "function") return [];
    try {
      const result = await DataAccess.searchBuildingDuplicatesViaApi(api, { address });
      return Array.isArray(result?.matches) ? result.matches : [];
    } catch (err) {
      console.warn("[findBuildingMatchesRemote] 실패:", err?.message || err);
      return [];
    }
  }

  // 건물 매물 목록에서 정확 매칭(주소+층+호) 찾기
  function pickExactMatchFromBuilding(rows, payload) {
    const targetKey = buildRegistrationMatchKey(payload);
    if (!targetKey) return null;
    for (const row of Array.isArray(rows) ? rows : []) {
      const rowRaw = row?.raw || row?._raw?.raw || {};
      const snap = { address: row?.address || "", floor: row?.floor || rowRaw?.floor || "", raw: rowRaw };
      if (buildRegistrationMatchKey(snap) === targetKey) return row;
    }
    return null;
  }

  // 매칭된 row 에서 담당자 상태(own/unassigned/other-staff) 판정
  function classifyMatchForCurrentUser(row, currentUserId) {
    const aid = String(row?.assignee_id || "").trim();
    const myId = String(currentUserId || "").trim();
    if (!aid) return "unassigned";
    if (myId && aid === myId) return "own";
    return "other-staff";
  }

  async function runNpmDuplicateCheck() {
    const box = els.npmDupPreview;
    if (!box) return;
    const address = (getNpmFormInput("address")?.value || "").trim();
    const floor = (getNpmFormInput("floor")?.value || "").trim();

    // 주소 없으면 침묵
    if (!address) { renderNpmDupPreview({ kind: "idle" }); return; }

    // 주소 파싱 실패 → 안내
    const buildingKey = buildBuildingKey(address);
    if (!buildingKey) { renderNpmDupPreview({ kind: "parse-fail" }); return; }

    const myGen = ++npmDupState.generation;
    npmDupState.lastAddress = address;
    npmDupState.lastFloor = floor;

    // 1단계: 클라이언트 즉시 탐색 (본인 담당 매물 전수)
    const currentUserId = String(state?.session?.user?.id || "").trim();
    const localBuilding = findBuildingMatchesLocal(address);
    const payloadForKey = { address, floor, raw: {} };
    const localExact = pickExactMatchFromBuilding(localBuilding, payloadForKey);
    if (localExact) {
      // 본인 소유일 것이 확실 (state.properties 에는 본인 매물만 존재)
      const kind = classifyMatchForCurrentUser(localExact, currentUserId);
      const match = {
        id: localExact?.id || localExact?._raw?.id,
        address: localExact?.address || localExact?._raw?.address,
        assigneeName: localExact?.assignee_name || localExact?.assigneeName || "",
      };
      renderNpmDupPreview({ kind, match });
      // 로컬에서 본인 매물 확정된 경우라도 서버 탐색 계속 진행할 필요 없음
      if (kind === "own") return;
    }

    // 2단계: 서버 API 탐색 (RLS 우회를 위해 /api/properties 경유)
    renderNpmDupPreview({ kind: "searching" });

    const remoteBuilding = await findBuildingMatchesRemote(null, address);
    // 레이스 방어: 최신 요청이 아니면 무시
    if (myGen !== npmDupState.generation) return;

    // 로컬 + 서버 중복 제거 (id 기준 병합)
    const merged = new Map();
    for (const r of localBuilding) {
      const id = String(r?.id || r?._raw?.id || "").trim();
      if (id) merged.set(id, r?._raw || r);
    }
    for (const r of remoteBuilding) {
      const id = String(r?.id || "").trim();
      if (id && !merged.has(id)) merged.set(id, r);
    }
    const allBuilding = Array.from(merged.values());

    if (allBuilding.length === 0) {
      renderNpmDupPreview({ kind: "new" });
      return;
    }

    // 정확 매칭 시도 (층까지 포함)
    const exact = pickExactMatchFromBuilding(allBuilding, payloadForKey);
    if (exact) {
      const kind = classifyMatchForCurrentUser(exact, currentUserId);
      const match = {
        id: exact?.id,
        address: exact?.address,
        assigneeName: exact?.assignee_name || exact?.assigneeName || "",
      };
      renderNpmDupPreview({ kind, match });
      return;
    }

    // 정확 매칭 없음 → 건물 단위 집계
    const summary = summarizeBuildingMatches(allBuilding, currentUserId);
    renderNpmDupPreview({ kind: "building", counts: summary });
  }

  const runNpmDuplicateCheckDebounced = debounce(runNpmDuplicateCheck, 450);

  function handleNpmDupInputChange() {
    // 입력 즉시 blockedForSave 해제 (사용자가 수정 중임 — 서버 완료까지 저장 허용)
    npmDupState.blockedForSave = false;
    if (els.npmSave) els.npmSave.disabled = false;
    runNpmDuplicateCheckDebounced();
  }

  // 프리뷰의 [편집으로 이동] 버튼 위임 핸들러
  function bindNpmDupPreviewActions() {
    const box = els.npmDupPreview;
    if (!box || box.dataset.bound === "1") return;
    box.dataset.bound = "1";
    box.addEventListener("click", (e) => {
      const btn = e.target?.closest?.('[data-npm-dup-action]');
      if (!btn) return;
      const action = btn.getAttribute("data-npm-dup-action");
      if (action === "edit") {
        // 현재 주소/층으로 로컬 매칭 재조회 → 본인 매물이면 해당 아이템으로 편집 모달 열기
        const address = (getNpmFormInput("address")?.value || "").trim();
        const floor = (getNpmFormInput("floor")?.value || "").trim();
        const building = findBuildingMatchesLocal(address);
        const exactRaw = pickExactMatchFromBuilding(building, { address, floor, raw: {} });
        if (!exactRaw) {
          setNpmMsg("매물 정보를 찾을 수 없습니다. 다시 확인해 주세요.", true);
          return;
        }
        // state.properties 배열에서 id 매칭되는 정규화 item 찾기
        const id = String(exactRaw?.id || "").trim();
        const normalized = Array.isArray(state?.properties)
          ? state.properties.find((it) => String(it?.id || it?._raw?.id || "") === id)
          : null;
        if (!normalized) {
          setNpmMsg("편집 모달을 열 수 없습니다. 페이지를 새로고침해 주세요.", true);
          return;
        }
        // 신규 모달 닫고 편집 모달 열기
        closeNewPropertyModal();
        try { openEditModal(normalized); } catch (err) {
          console.error("[npm-dup] openEditModal failed:", err);
        }
      }
    });
  }

  // 신규 물건 등록 모달
  // ── 신규 물건 등록 모달 ──
  function openNewPropertyModal() {
    if (!els.newPropertyModal || !els.newPropertyForm) return;
    els.newPropertyForm.reset();
    configureFormNumericUx(els.newPropertyForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain"] });
    if (els.npmRealtorFields) els.npmRealtorFields.classList.remove("hidden");
    if (els.npmOwnerFields) els.npmOwnerFields.classList.add("hidden");
    els.newPropertyForm.querySelectorAll(".npm-type-card").forEach((card) => {
      const radio = card.querySelector("input[type=radio]");
      card.classList.toggle("is-active", !!radio?.checked);
    });
    setNpmMsg("");
    // 중복 감지 프리뷰 초기화 + 이벤트 바인딩 (최초 1회)
    resetNpmDupPreview();
    bindNpmDupPreviewActions();
    const addrInput = getNpmFormInput("address");
    const floorInput = getNpmFormInput("floor");
    if (addrInput && addrInput.dataset.npmDupBound !== "1") {
      addrInput.dataset.npmDupBound = "1";
      addrInput.addEventListener("input", handleNpmDupInputChange);
    }
    if (floorInput && floorInput.dataset.npmDupBound !== "1") {
      floorInput.dataset.npmDupBound = "1";
      floorInput.addEventListener("input", handleNpmDupInputChange);
    }
    document.body.classList.add("modal-open");
    els.newPropertyModal.classList.remove("hidden");
    els.newPropertyModal.setAttribute("aria-hidden", "false");
  }

  function closeNewPropertyModal() {
    if (!els.newPropertyModal) return;
    els.newPropertyModal.classList.add("hidden");
    els.newPropertyModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    setNpmMsg("");
    resetNpmDupPreview();
  }

  function setNpmMsg(text, isError = true) {
    if (!els.npmMsg) return;
    if (PropertyRenderers && typeof PropertyRenderers.setFeedbackBoxMessage === 'function') {
      PropertyRenderers.setFeedbackBoxMessage(els.npmMsg, text, { kind: isError ? 'error' : 'success' });
      return;
    }
    els.npmMsg.innerHTML = '';
  }

  function extractSchemaMissingColumn(err) {
    const msg = String(err?.message || err || "");
    const m = msg.match(/Could not find the '([^']+)' column of 'properties' in the schema cache/i);
    return m ? String(m[1] || "").trim() : "";
  }

  function omitKeys(obj, keys) {
    const drop = new Set((Array.isArray(keys) ? keys : []).map((v) => String(v || "").trim()).filter(Boolean));
    return Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => !drop.has(k) && v !== undefined));
  }

  function sanitizeJsonValue(value, depth = 0, seen) {
    if (PropertyDomain && typeof PropertyDomain.sanitizeJsonValue === "function") {
      return PropertyDomain.sanitizeJsonValue(value, depth, seen);
    }
    if (value == null) return value;
    if (depth > 6) return undefined;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") return value;
    if (t !== "object") return undefined;
    const bag = seen || new WeakSet();
    if (bag.has(value)) return undefined;
    bag.add(value);
    try {
      if (Array.isArray(value)) {
        const out = [];
        for (const item of value.slice(0, 500)) {
          const v = sanitizeJsonValue(item, depth + 1, bag);
          if (v !== undefined) out.push(v);
        }
        return out;
      }
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "raw") continue;
        const sv = sanitizeJsonValue(v, depth + 1, bag);
        if (sv !== undefined) out[k] = sv;
      }
      return out;
    } finally {
      bag.delete(value);
    }
  }

  function sanitizePropertyRawForSave(raw, overrides = {}) {
    if (PropertyDomain && typeof PropertyDomain.sanitizePropertyRawForSave === "function") {
      return PropertyDomain.sanitizePropertyRawForSave(raw, overrides);
    }
    const base = raw && typeof raw === "object" ? (sanitizeJsonValue(raw, 0) || {}) : {};
    if (base && typeof base === "object") delete base.raw;
    const merged = { ...(base || {}), ...(overrides || {}) };
    if (Array.isArray(merged.opinionHistory)) {
      merged.opinionHistory = merged.opinionHistory.slice(-200).map((entry) => ({
        date: String(entry?.date || "").trim(),
        text: String(entry?.text || "").trim(),
        author: String(entry?.author || "").trim(),
      })).filter((entry) => entry.date || entry.text || entry.author);
    }
    return merged;
  }

  const PROPERTY_DUPLICATE_INDEX_NAMES = new Set([
    "uq_properties_global_id",
    "uq_properties_registration_identity_key",
    "uq_properties_registration_identity_key_v2_strict",
  ]);

  function collectPropertyErrorTexts(err) {
    const texts = [];
    const push = (value) => {
      if (value == null) return;
      const s = String(value).trim();
      if (s) texts.push(s);
    };
    const queue = [err];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      push(current.message);
      push(current.details);
      push(current.hint);
      push(current.code);
      push(current.constraint);
      push(current.error);
      push(current.error_description);
      if (current.cause && typeof current.cause === "object") queue.push(current.cause);
      if (current.data && typeof current.data === "object") queue.push(current.data);
      if (current.originalError && typeof current.originalError === "object") queue.push(current.originalError);
    }
    return texts;
  }

  function isPropertyDuplicateError(err) {
    const code = String(err?.code || err?.data?.code || "").trim();
    const constraint = String(err?.constraint || err?.data?.constraint || "").trim();
    if (PROPERTY_DUPLICATE_INDEX_NAMES.has(constraint)) return true;
    const joined = collectPropertyErrorTexts(err).join('\n');
    for (const indexName of PROPERTY_DUPLICATE_INDEX_NAMES) {
      if (joined.includes(indexName)) return true;
    }
    if (code === "23505" && /registration_identity_key(_v2)?|global_id/i.test(joined)) return true;
    if (/duplicate key value violates unique constraint/i.test(joined) && /registration_identity_key(_v2)?|global_id/i.test(joined)) return true;
    return false;
  }

  function normalizePropertyDuplicateError(err) {
    if (!isPropertyDuplicateError(err)) return err;
    const normalized = new Error("동일 물건이 이미 등록되어 있습니다");
    normalized.code = "PROPERTY_DUPLICATE";
    normalized.cause = err;
    return normalized;
  }

  async function insertPropertyRowResilient(_sb, row) {
    if (!DataAccess || typeof DataAccess.createPropertyViaApi !== "function") {
      throw new Error("KNSN_DATA_ACCESS.createPropertyViaApi 를 찾을 수 없습니다.");
    }
    const saveRes = await DataAccess.createPropertyViaApi(api, row, { auth: true });
    return saveRes?.item || null;
  }

  async function updatePropertyRowResilient(_sb, targetId, patch) {
    if (!DataAccess || typeof DataAccess.updatePropertyViaApi !== "function") {
      throw new Error("KNSN_DATA_ACCESS.updatePropertyViaApi 를 찾을 수 없습니다.");
    }
    const saveRes = await DataAccess.updatePropertyViaApi(api, targetId, patch, { auth: true });
    return saveRes?.item || { id: targetId };
  }

  async function submitNewProperty() {
    const f = els.newPropertyForm;
    const fd = new FormData(f);
    const readStr = (k) => String(fd.get(k) || "").trim();
    const readNum = (k) => parseFlexibleNumber(fd.get(k));

    const actorName = String(state.session?.user?.name || state.session?.user?.email || "").trim();
    const submitterKind = readStr("submitterKind") || "realtor";
    let submitterName = "", submitterPhone = "", realtorName = null, realtorPhone = null, realtorCell = null;
    if (submitterKind === "realtor") {
      realtorName = readStr("realtorname");
      realtorPhone = readStr("realtorphone") || null;
      realtorCell = readStr("realtorcell");
      submitterName = actorName || readStr("submitterName") || null;
      submitterPhone = realtorCell;
    } else {
      submitterName = readStr("submitterName") || actorName || "";
      submitterPhone = readStr("submitterPhone");
    }

    const currentUserId = String(state.session?.user?.id || "").trim() || null;
    const submissionPackage = PropertyDomain?.buildRegistrationSubmissionPackage?.({
      submitterKind,
      address: readStr("address"),
      assetType: readStr("assetType"),
      priceMain: readNum("priceMain"),
      floor: readStr("floor") || null,
      totalFloor: readStr("totalfloor") || null,
      useApproval: readStr("useapproval") || null,
      commonArea: readNum("commonarea"),
      exclusiveArea: readNum("exclusivearea"),
      siteArea: readNum("sitearea"),
      realtorName,
      realtorPhone,
      realtorCell,
      submitterName,
      submitterPhone,
      opinion: readStr("opinion") || null,
      assigneeId: currentUserId,
    }, {
      actorName,
      registrationKind: "agent",
      requiredMessage: "주소, 세부유형, 매매가는 필수입니다.",
      realtorMessage: "중개사무소명과 휴대폰번호를 입력해 주세요.",
      ownerMessage: "이름과 연락처를 입력해 주세요.",
    }) || null;
    const validationMessage = String(submissionPackage?.validationMessage || "").trim();
    if (validationMessage) throw new Error(validationMessage);
    const payload = submissionPackage?.payload || null;
    if (!payload) throw new Error("등록 데이터를 준비하지 못했습니다.");

    if (els.npmSave) els.npmSave.disabled = true;
    setNpmMsg("");
    try {
      // 신규 물건 등록도 saveProperty 와 동일하게 클릭 즉시 진행 상태를 표시한다.
      setAgentLoading('save', true, '등록 중입니다...');
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) throw new Error("Supabase 연동이 필요합니다.");
      const regContext = buildRegisterLogContext("담당자 등록", state.session?.user);
      let existing = await findExistingPropertyForRegistration(sb, payload.raw);
      if (!existing) existing = findExistingPropertyByRegistrationKey(payload.raw, state.properties);
      let savedPropertyId = null;
      let savedIdentityKey = "";
      let activityError = "";
      if (existing) {
        const merged = buildRegistrationDbRowForExisting(existing, payload, regContext, { assignIfEmpty: true });
        const updated = await updatePropertyRowResilient(sb, existing.id || existing.globalId, merged.row);
        savedPropertyId = updated?.id || existing.id || existing.globalId || null;
        savedIdentityKey = merged.row?.raw?.registrationIdentityKey || existing?._raw?.raw?.registrationIdentityKey || buildRegistrationMatchKey(merged.row) || "";
        setNpmMsg(merged.changes.length ? "기존 물건을 갱신하고 등록 LOG를 추가했습니다." : "동일 물건이 있어 기존 물건에 반영했습니다.", false);
      } else {
        const createRow = buildRegistrationDbRowForCreate(payload, regContext);
        const inserted = await insertPropertyRowResilient(sb, createRow);
        savedPropertyId = inserted?.id || null;
        savedIdentityKey = createRow?.raw?.registrationIdentityKey || buildRegistrationMatchKey(createRow) || "";
        setNpmMsg("등록되었습니다.", false);
      }
      try {
        // [FIX 20260506-loglog] 신규 등록 시 동시에 입력된 의견(opinion) 도
        // property_activity_logs 에 별도 row 로 기록한다.
        // 기존: ["newProperty"] 만 호출 → 신규 등록 + 동시 의견 작성 케이스에서
        //       opinion activity row 가 생성되지 않아 업무관리 탭에 표시되지 않는 버그.
        // 수정: payload.memo (= core.opinion) 또는 payload.raw.opinion 에 본문이 있으면
        //       "opinion" 카테고리도 함께 push 한다. opinion 도 changedFields 에 동봉
        //       해야 buildActivityLogEntries 가 entry 를 만들어낸다.
        const newPropertyOpinionText = String(payload?.memo || payload?.raw?.opinion || "").trim();
        const initialCategories = ["newProperty"];
        const initialChangedFields = { newProperty: ["registration"] };
        if (newPropertyOpinionText) {
          initialCategories.push("opinion");
          initialChangedFields.opinion = ["opinion"];
        }
        await recordDailyReportEntries(buildActivityLogEntries(initialCategories, payload, {
          propertyId: savedPropertyId,
          identityKey: savedIdentityKey,
          changedFields: initialChangedFields,
          opinionText: newPropertyOpinionText,
        }));
      } catch (logErr) {
        const baseMsg = logErr?.message || "일일업무일지 기록 실패";
        const codeTag = logErr?.serverCode ? ` [${logErr.serverCode}]` : "";
        activityError = `${baseMsg}${codeTag}`;
        try {
          console.warn('[activity_log][new_property_failed]', {
            message: baseMsg,
            serverCode: logErr?.serverCode || null,
            serverDebug: logErr?.serverDebug || null,
            httpStatus: logErr?.httpStatus || null,
            serverData: logErr?.serverData || null,
          });
        } catch {}
      }
      if (activityError) setGlobalMsg(`물건 등록은 완료되었지만 업무일지 기록에 실패했습니다. ${activityError}`);
      else setGlobalMsg("");
      setTimeout(() => { closeNewPropertyModal(); window.setTimeout(() => refreshAgentPropertiesInBackground(), 2400); }, 2200);
    } finally {
      setAgentLoading('save', false);
      if (els.npmSave) els.npmSave.disabled = false;
    }
  }

  function loadRegistrationLog(item) {
    if (PropertyDomain && typeof PropertyDomain.loadRegistrationLog === "function") return PropertyDomain.loadRegistrationLog(item, { defaultRoute: "최초 등록" });
    const raw = item?._raw?.raw || {};
    if (Array.isArray(raw.registrationLog) && raw.registrationLog.length) return raw.registrationLog;
    const createdAt = firstText(raw.firstRegisteredAt, item?.createdAt, item?._raw?.created_at, item?._raw?.createdAt, "");
    if (!createdAt) return [];
    return [{ type: "created", at: createdAt, route: "최초 등록", actor: "" }];
  }

  function formatRegLogAt(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
  }

  // 모달 LOG 탭의 개별 entry 메타 표시용 — 시간만 (그룹 헤더에 이미 날짜가 있어 중복 방지)
  function formatRegLogAtTimeOnly(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mi}`;
  }

  function toTimelineTimestamp(value) {
    const s = String(value || "").trim();
    if (!s) return Number.POSITIVE_INFINITY;
    const time = Date.parse(s);
    if (Number.isFinite(time)) return time;
    const normalized = s.replace(/\./g, "-").replace(/\s+/g, "T");
    const nextTime = Date.parse(normalized);
    if (Number.isFinite(nextTime)) return nextTime;
    return Number.POSITIVE_INFINITY;
  }

  function buildCombinedPropertyLog(opinionHistory, registrationLog) {
    if (PropertyDomain && typeof PropertyDomain.buildCombinedPropertyLog === "function") {
      return PropertyDomain.buildCombinedPropertyLog(opinionHistory, registrationLog);
    }
    const opinions = Array.isArray(opinionHistory) ? opinionHistory : [];
    const regLogs = Array.isArray(registrationLog) ? registrationLog : [];
    const rows = [];

    opinions.forEach((entry, idx) => {
      const text = String(entry?.text || "").trim();
      if (!text) return;
      const at = String(entry?.date || entry?.at || "").trim();
      rows.push({
        kind: "opinion",
        sortAt: toTimelineTimestamp(at),
        at,
        badgeClass: "is-opinion",
        badgeLabel: "담당의견",
        author: String(entry?.author || "").trim(),
        text,
        order: idx,
      });
    });

    regLogs.forEach((entry, idx) => {
      const at = String(entry?.at || entry?.date || "").trim();
      const route = String(entry?.route || "").trim();
      const actor = String(entry?.actor || "").trim();
      const type = String(entry?.type || "").trim();
      const changes = (Array.isArray(entry?.changes) ? entry.changes : []).filter((change) => change?.field !== "submitterPhone" && change?.label !== "등록자 연락처");
      rows.push({
        kind: "registration",
        sortAt: toTimelineTimestamp(at),
        at,
        badgeClass: "is-registration",
        badgeLabel: "등록LOG",
        author: actor,
        title: type === "created" ? "최초 등록" : (route || "등록 정보 변경"),
        route,
        changes,
        order: idx,
      });
    });

    return rows.sort((a, b) => {
      if (a.sortAt !== b.sortAt) return a.sortAt - b.sortAt;
      return a.order - b.order;
    });
  }

  function inferCombinedLogActorRole(entry) {
    const explicit = String(entry?.authorRole || entry?.actorRole || '').trim().toLowerCase();
    if (['admin', '관리자', 'administrator', 'manager', 'master', 'superadmin', 'super_admin'].includes(explicit)) return 'is-admin';
    if (['staff', 'agent', '담당자', 'employee', 'member'].includes(explicit)) return 'is-staff';
    const route = String(entry?.route || '').trim();
    if (/관리자/.test(route)) return 'is-admin';
    if (/담당자/.test(route)) return 'is-staff';
    return 'is-neutral';
  }

  function renderCombinedLogActorChip(entry) {
    const name = String(entry?.author || entry?.actor || entry?.actor_name || entry?.actorName || '').trim();
    if (!name) return '';
    const roleClass = inferCombinedLogActorRole(entry);
    const icon = roleClass === 'is-admin' ? 'shield' : 'person';
    return `<span class="agent-combined-log-actor-badge ${roleClass}"><span class="material-symbols-outlined chip-icon" aria-hidden="true">${icon}</span><span class="chip-text">${esc(name)}</span></span>`;
  }

  function renderCombinedLogBadge(badge) {
    const badgeClass = String(badge?.badgeClass || '').trim();
    const badgeLabel = String(badge?.badgeLabel || '').trim();
    if (!badgeLabel) return '';
    let icon = 'inventory_2';
    let extraClass = '';
    if (badgeClass === 'is-site') icon = 'fact_check';
    else if (badgeClass === 'is-edit') { icon = 'warning'; extraClass = ' is-filled'; }
    else if (badgeClass === 'is-opinion') icon = 'chat';
    else if (badgeClass === 'is-rights') icon = 'gavel';
    else if (badgeClass === 'is-assignee') icon = 'person_add';
    else if (badgeClass === 'is-new') icon = 'inventory_2';
    return `<span class="agent-combined-log-badge ${esc(badgeClass)}"><span class="material-symbols-outlined chip-icon${extraClass}" aria-hidden="true">${icon}</span><span class="chip-text">${esc(badgeLabel)}</span></span>`;
  }

  function renderCombinedPropertyLog(container, opinionHistory, registrationLog) {
    if (!container) return;
    const groups = (PropertyDomain && typeof PropertyDomain.buildCombinedPropertyLogGroups === "function")
      ? PropertyDomain.buildCombinedPropertyLogGroups(opinionHistory, registrationLog, { formatAt: formatRegLogAt })
      : [];
    if (!groups.length) {
      container.innerHTML = '<div class="history-empty">표시할 LOG가 없습니다.</div>';
      return;
    }
    container.innerHTML = groups.map((group, groupIndex) => {
      const summaryBadges = (Array.isArray(group.badges) ? group.badges : []).map((badge) => renderCombinedLogBadge(badge)).join('');
      const itemsHtml = (Array.isArray(group.items) ? group.items : []).map((entry) => {
        const badgeHtml = (Array.isArray(entry.badges) ? entry.badges : [{ badgeClass: entry.badgeClass, badgeLabel: entry.badgeLabel }]).map((badge) => renderCombinedLogBadge(badge)).join('');
        const entryMeta = [entry.at ? `<span class="agent-combined-log-author">${esc(formatRegLogAtTimeOnly(entry.at))}</span>` : '', renderCombinedLogActorChip(entry)].filter(Boolean).join('');
        if (entry.kind !== "registration") {
          return `<div class="agent-combined-log-entry"><div class="agent-combined-log-entry-head">${badgeHtml}${entryMeta}</div><div class="agent-combined-log-body"><div class="agent-combined-log-text">${esc(entry.text || "")}</div></div></div>`;
        }
        const changesHtml = entry.changes?.length
          ? `<div class="agent-combined-log-changes">${entry.changes.map((change) => `<div class="agent-combined-log-change"><span class="agent-combined-log-label">${esc(change.label || "")}</span><span class="agent-combined-log-value">${esc(change.before || "-")}</span><span class="agent-combined-log-arrow">→</span><span class="agent-combined-log-value">${esc(change.after || "-")}</span></div>`).join("")}</div>`
          : '<div class="agent-combined-log-text">변경 없음</div>';
        return `<div class="agent-combined-log-entry"><div class="agent-combined-log-entry-head">${badgeHtml}${entryMeta}</div><div class="agent-combined-log-body">${changesHtml}</div></div>`;
      }).join('');
      return `<div class="agent-combined-log-item"><div class="agent-combined-log-head"><span class="agent-combined-log-date">${esc(group.displayDate || formatRegLogAt(group.at) || '')}</span><div class="agent-combined-log-summary">${summaryBadges}</div><button type="button" class="agent-combined-log-toggle" data-group-toggle="${groupIndex}" aria-expanded="false">▼</button></div><div class="agent-combined-log-group-body hidden" data-group-body="${groupIndex}">${itemsHtml}</div></div>`;
    }).join('');
    container.querySelectorAll('[data-group-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-group-toggle');
        const body = container.querySelector(`[data-group-body="${key}"]`);
        const willOpen = body?.classList.contains('hidden');
        body?.classList.toggle('hidden', !willOpen);
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        btn.textContent = willOpen ? '▲' : '▼';
      });
    });
  }

  function renderRegistrationLog(container, history) {
    if (!container) return;
    const list = Array.isArray(history) ? history : [];
    if (!list.length) {
      container.innerHTML = '<div class="history-empty">등록 LOG가 없습니다.</div>';
      return;
    }
    const reversed = list.slice().reverse();
    container.innerHTML = reversed.map((entry) => {
      const meta = [formatRegLogAt(entry.at || entry.date || ""), entry.route || "", entry.actor || ""]
        .filter(Boolean)
        .map((v) => `<span>${esc(v)}</span>`)
        .join("");
      if (entry.type === "created") {
        return `<div class="reglog-item"><div class="reglog-meta">${meta}</div><div class="reglog-badge">최초 등록</div></div>`;
      }
      const changes = (Array.isArray(entry.changes) ? entry.changes : []).filter((change) => change?.field !== "submitterPhone" && change?.label !== "등록자 연락처");
      const rows = changes.length
        ? `<div class="reglog-changes">${changes.map((change) => `<div class="reglog-change-row"><span class="reglog-label">${esc(change.label || "")}</span><span class="reglog-arrow">${esc(change.before || "-")}</span><span class="reglog-sep">→</span><span class="reglog-arrow is-next">${esc(change.after || "-")}</span></div>`).join("")}</div>`
        : `<div class="reglog-badge">변경 없음</div>`;
      return `<div class="reglog-item"><div class="reglog-meta">${meta}</div>${rows}</div>`;
    }).join("");
  }

  // ── Opinion History 유틸 ──
  function loadOpinionHistory(item) {
    if (PropertyDomain && typeof PropertyDomain.loadOpinionHistory === "function") return PropertyDomain.loadOpinionHistory(item);
    if (PropertyDomain && typeof PropertyDomain.loadOpinionHistory === "function") return PropertyDomain.loadOpinionHistory(item);
    const raw = item?._raw?.raw || {};
    const hist = raw.opinionHistory;
    if (Array.isArray(hist)) return hist;
    const legacy = String(item?.opinion || raw.opinion || "").trim();
    if (legacy) {
      return [{ date: formatDate(item?.createdAt) || "unknown", text: legacy, author: "" }];
    }
    return [];
  }

  function appendOpinionEntry(history, newText, user, options = {}) {
    if (PropertyDomain && typeof PropertyDomain.appendOpinionEntry === "function") return PropertyDomain.appendOpinionEntry(history, newText, user, options);
    const text = String(newText || "").trim();
    if (!text) return Array.isArray(history) ? history : [];
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const author = String(user?.name || user?.email || "").trim();
    const authorRole = String(options.authorRole || user?.role || "").trim();
    return [...(Array.isArray(history) ? history : []), { date: today, text, author, authorRole, kind: String(options.kind || "opinion").trim() || "opinion" }];
  }

  function getHistoryDateKey(entry) {
    const value = String(entry?.date || entry?.at || '').trim();
    if (!value) return '';
    const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  function getLatestHistoryEntry(item, kind) {
    const target = String(kind || '').trim();
    const history = loadOpinionHistory(item);
    return [...(Array.isArray(history) ? history : [])].reverse().find((entry) => String(entry?.kind || 'opinion').trim() === target) || null;
  }

  function getEditorHistoryText(item, kind, options = {}) {
    const entry = getLatestHistoryEntry(item, kind);
    const text = String(entry?.text || '').trim();
    if (!text) return '';
    if (options.todayOnly && getHistoryDateKey(entry) !== getTodayDateKey()) return '';
    return text;
  }

  function appendHistoryIfChanged(item, history, kind, nextText, user, options = {}) {
    const text = String(nextText || '').trim();
    const safeHistory = Array.isArray(history) ? history : [];
    const current = String(getEditorHistoryText(item, kind, { todayOnly: false }) || '').trim();
    // 변경 없음 (같은 텍스트) → 추가하지 않는다.
    if (current === text) return safeHistory;
    // [수정 내역] 빈 값으로 "지움" 이벤트 기록: 이전에 값이 있었던 경우에만 append.
    // 빈 상태에서 빈 저장은 로그를 남길 필요가 없어 그대로 스킵한다.
    // (기존에는 `if (!text) return history` 로 항상 스킵 → 모달 재오픈 시
    //  getEditorHistoryText 가 이전 텍스트를 반환해 "저장 안 됨"으로 오인되던 문제.)
    if (!text && !current) return safeHistory;
    return appendOpinionEntry(safeHistory, text, user, { ...options, kind });
  }

  function getLatestHistoryText(item, kind) {
    const history = loadOpinionHistory(item);
    const target = String(kind || '').trim();
    const latest = [...(Array.isArray(history) ? history : [])].reverse().find((entry) => String(entry?.kind || 'opinion').trim() === target);
    const raw = item?._raw?.raw || {};
    if (latest && String(latest.text || '').trim()) return String(latest.text || '').trim();
    if (target === 'dailyIssue') return String(raw.dailyIssue || raw.daily_issue || '').trim();
    return '';
  }

  function renderOpinionHistory(container, history, isAdmin) {
    if (!container) return;
    if (!history.length) {
      container.innerHTML = '<div class="history-empty">등록된 의견이 없습니다.</div>';
      return;
    }
    const reversed = [...history].reverse();
    container.innerHTML = reversed.map((entry) =>
      `<div class="history-item">
        <div class="history-meta">
          <span class="history-date">${esc(entry.date || "")}</span>
          ${entry.author ? `<span class="history-author">${esc(entry.author)}</span>` : ""}
        </div>
        <div class="history-text">${esc(entry.text || "")}</div>
      </div>`
    ).join("");
    // isAdmin=false → 편집 버튼 없음 (담당자 읽기 전용)
  }

  function debounce(fn, ms) {
    if (Shared && typeof Shared.debounce === "function") return Shared.debounce(fn, ms);
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }


  function formatDailyLogTime(row) {
    const raw = String(row?.created_at || row?.createdAt || row?.action_at || row?.actionAt || row?.updated_at || row?.updatedAt || row?.action_date || "").trim();
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" }).format(d);
  }

  function getDailyActionMeta(actionType) {
    const key = String(actionType || "").trim();
    if (key === "rights_analysis") return { badgeClass: "is-rights", badgeLabel: "권리분석", title: "권리분석" };
    if (key === "site_inspection") return { badgeClass: "is-site", badgeLabel: "현장실사", title: "현장실사" };
    if (key === "daily_issue") return { badgeClass: "is-edit", badgeLabel: "금일이슈사항", title: "금일이슈사항" };
    if (key === "opinion") return { badgeClass: "is-opinion", badgeLabel: "담당자의견", title: "담당자의견" };
    if (key === "new_property") return { badgeClass: "is-new", badgeLabel: "신규등록", title: "신규 물건 등록" };
    return { badgeClass: "is-edit", badgeLabel: "업무", title: "업무 수정" };
  }

  function buildDailyReportPropertyMeta(group) {
    const item = group?.item || {};
    const row = group?.row || {};
    const assetType = String(item?.assetType || row?.property_asset_type || row?.asset_type || "").trim();
    const floor = String(item?.floor || row?.property_floor || row?.floor || "").trim();
    const areaValue = item?.exclusivearea ?? row?.property_exclusive_area ?? row?.exclusive_area ?? null;
    const areaText = areaValue != null && areaValue !== "" ? `${fmtArea(areaValue)}평` : "";
    const itemNo = String(item?.itemNo || row?.property_item_no || row?.item_no || "").trim();
    return [assetType, floor, areaText, itemNo].filter(Boolean).join(' · ') || '세부 정보 없음';
  }

  function renderDailyReport() {
    const counts = state.dailyReport?.counts || emptyDailyReportCounts();
    const total = Number(counts.total || 0);
    if (els.dailyReportTotal) els.dailyReportTotal.textContent = String(total);
    if (els.dailyReportLead) {
      els.dailyReportLead.textContent = `금일은 총 ${total}건 정보를 수정등록 하셨네요.`;
    }

    const actorEl = document.getElementById('agWorkActors');
    const propertiesEl = document.getElementById('agWorkProperties');
    const logsEl = document.getElementById('agWorkLogs');
    const emptyEl = document.getElementById('agWorkEmpty');
    const statsEl = document.getElementById('agWorkStats');
    const dateInput = document.getElementById('agWorkDate');
    if (dateInput && !dateInput.value) dateInput.value = state.dailyReport?.dateKey || getTodayDateKey();

    const groups = groupDailyReportItems(state.dailyReport?.items || []);
    const actorName = esc(getDailyReportActorName());
    const propertyCount = groups.length;
    const updateCount = total;
    const selectedKey = (() => {
      const saved = String(state.dailyReport?.selectedPropertyKey || '').trim();
      if (saved && groups.some((entry) => entry.key === saved)) return saved;
      return groups[0]?.key || '';
    })();
    state.dailyReport.selectedPropertyKey = selectedKey;

    if (actorEl) {
      actorEl.innerHTML = `
        <button type="button" class="workmgmt-actor-card is-active">
          <div class="workmgmt-actor-head">
            <div class="workmgmt-actor-avatar">${actorName.slice(0,1) || '담'}</div>
            <div>
              <div class="workmgmt-actor-name">${actorName}</div>
              <div class="workmgmt-actor-sub">담당자 업무 현황</div>
            </div>
          </div>
          <div class="workmgmt-actor-chips">
            <span class="workmgmt-chip is-soft">${propertyCount} 관리 물건</span>
            <span class="workmgmt-chip is-brand">${updateCount} 업데이트</span>
          </div>
        </button>`;
    }

    if (propertiesEl) {
      if (!groups.length) {
        propertiesEl.innerHTML = '<div class="workmgmt-empty">표시할 관리 물건이 없습니다.</div>';
      } else {
        propertiesEl.innerHTML = groups.map((group) => {
          const item = group.item || {};
          const row = group.row || {};
          const kindTarget = item && Object.keys(item).length ? item : row;
          const bucketLabel = getPropertyKindLabel(item?.sourceType || row?.property_source_type, kindTarget);
          const bucketClassRaw = getPropertyKindClass(item?.sourceType || row?.property_source_type, kindTarget);
          const bucketClass = /auction/.test(bucketClassRaw) ? 'is-auction' : /onbid/.test(bucketClassRaw) ? 'is-onbid' : /general/.test(bucketClassRaw) ? 'is-general' : 'is-realtor';
          const title = esc(String(item?.address || row?.property_address || '-').trim());
          const meta = esc(buildDailyReportPropertyMeta(group));
          const actionSummary = [];
          if (group.counts.rights_analysis) actionSummary.push(`권리 ${group.counts.rights_analysis}건`);
          if (group.counts.site_inspection) actionSummary.push(`현장 ${group.counts.site_inspection}건`);
          if (group.counts.daily_issue) actionSummary.push(`이슈 ${group.counts.daily_issue}건`);
          if (group.counts.opinion) actionSummary.push(`의견 ${group.counts.opinion}건`);
          if (group.counts.new_property) actionSummary.push(`신규 ${group.counts.new_property}건`);
          const totalActions = Object.values(group.counts).reduce((sum, v) => sum + Number(v || 0), 0);
          const activeClass = selectedKey === group.key ? ' is-active' : '';
          return `
            <button type="button" class="workmgmt-property-card${activeClass}" data-daily-prop-key="${escAttr(group.key)}">
              <div class="workmgmt-property-body is-compact">
                <div class="workmgmt-property-top">
                  <span class="workmgmt-property-type ${bucketClass}">${esc(bucketLabel)}</span>
                  <span class="workmgmt-property-mark">${selectedKey === group.key ? '●' : '○'}</span>
                </div>
                <div class="workmgmt-property-title">${title}</div>
                <div class="workmgmt-property-address">${meta}</div>
                <div class="workmgmt-property-meta-row">
                  <span class="workmgmt-property-meta-text">업무 ${totalActions}건</span>
                  <span class="workmgmt-property-amount">${esc(actionSummary.join(' · ') || '업데이트 없음')}</span>
                </div>
              </div>
            </button>`;
        }).join('');
        propertiesEl.querySelectorAll('[data-daily-prop-key]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = String(btn.getAttribute('data-daily-prop-key') || '').trim();
            state.dailyReport.selectedPropertyKey = key;
            renderDailyReport();
          });
        });
      }
    }

    const rows = (Array.isArray(state.dailyReport?.items) ? [...state.dailyReport.items] : [])
      .filter((row) => !selectedKey || getDailyReportRowKey(row) === selectedKey);
    rows.sort((a, b) => String(b?.created_at || b?.updated_at || b?.action_date || '').localeCompare(String(a?.created_at || a?.updated_at || a?.action_date || '')));
    if (logsEl) {
      if (!rows.length) {
        logsEl.innerHTML = '';
      } else {
        logsEl.innerHTML = rows.map((row) => {
          const meta = getDailyActionMeta(row?.action_type);
          const matched = findPropertyForActivityRow(row) || null;
          const content = getDailyLogContent(row, matched);
          return `
            <article class="workmgmt-log-card">
              <div class="workmgmt-log-top">
                <span class="workmgmt-log-badge ${meta.badgeClass}">${meta.badgeLabel}</span>
                <span class="workmgmt-log-time">${esc(formatDailyLogTime(row) || '')}</span>
              </div>
              <div class="workmgmt-log-desc">${esc(content || '입력 내용 없음')}</div>
            </article>`;
        }).join('');
      }
    }

    if (emptyEl) emptyEl.classList.toggle('hidden', rows.length > 0);

    if (statsEl) {
      statsEl.innerHTML = `
        <article class="workmgmt-stat-card is-brand"><div class="workmgmt-stat-label">총 업무</div><div class="workmgmt-stat-value">${Number(total || 0)}</div></article>
        <article class="workmgmt-stat-card is-soft"><div class="workmgmt-stat-label">권리분석</div><div class="workmgmt-stat-value">${Number(counts.rightsAnalysis || 0)}</div></article>
        <article class="workmgmt-stat-card is-warm"><div class="workmgmt-stat-label">현장조사</div><div class="workmgmt-stat-value">${Number(counts.siteInspection || 0)}</div></article>
        <article class="workmgmt-stat-card is-danger"><div class="workmgmt-stat-label">신규등록</div><div class="workmgmt-stat-value">${Number(counts.newProperty || 0)}</div></article>`;
    }
  }

  async function refreshAgentDailyReportView(options = {}) {
    const dateInput = document.getElementById('agWorkDate');
    const dateKey = String(options.dateKey || dateInput?.value || getTodayDateKey()).trim() || getTodayDateKey();
    if (dateInput) dateInput.value = dateKey;
    try {
      await refreshDailyReportSummary({ force: options.force !== false, dateKey, includeAssignedFallback: options.includeAssignedFallback === true });
      setGlobalMsg('');
    } catch (err) {
      setGlobalMsg(toUserErrorMessage(err, '일일업무일지 조회 실패'));
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    const dateInput = document.getElementById('agWorkDate');
    const refreshBtn = document.getElementById('btnAgWorkRefresh');
    if (dateInput && !dateInput.value) dateInput.value = getTodayDateKey();
    if (refreshBtn) refreshBtn.addEventListener('click', function(){ refreshAgentDailyReportView({ force:true }); });
    if (dateInput) dateInput.addEventListener('change', function(){ refreshAgentDailyReportView({ force:true, dateKey: this.value }); });
    window.refreshAgentDailyReportView = function(){ refreshAgentDailyReportView({ force:true }); };
  });

  // ═══════════════════════════════════════════════════════════════
  // 오늘의 스케쥴링 (Schedule)
  // - 기준 물건(경매/공매, 또는 '전체 보기' 시 전체)을 선택하면
  //   해당 물건 좌표 기준으로 나머지 배정 물건을 거리순 나열
  // ═══════════════════════════════════════════════════════════════
  const _scheduleState = {
    selectedAnchorId: null,
    showAll: false,
    // 페이지네이션
    page: 1,
    pageSize: 10,
    // 체크박스로 선택된 주변 물건 id (기준별로 유지하면 복잡해지므로 단순히 전역 Set)
    checkedIds: new Set(),
    // 카카오맵 인스턴스/마커 캐시
    map: null,
    mapReady: false,
    mapMarkers: [],
    mapInfowindow: null,
  };

  function sch_toFiniteNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function sch_getLatLng(p) {
    if (!p) return null;
    // normalizeProperty 가 최상위에 latitude/longitude 를 포함시키지 않으므로
    // _raw (원본 DB row) 를 우선 폴백으로 확인
    const raw = p._raw || p.raw || {};
    const lat = sch_toFiniteNumber(
      p.latitude ?? p.lat ?? raw.latitude ?? raw.lat
    );
    const lng = sch_toFiniteNumber(
      p.longitude ?? p.lng ?? raw.longitude ?? raw.lng
    );
    if (lat === null || lng === null) return null;
    return { lat, lng };
  }
  // Haversine 공식 → 단위: 미터 (도보 거리 표시용이라 정확도 필요)
  function sch_haversineMeters(a, b) {
    const R = 6371000; // 지구 반지름 m
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function sch_formatDistance(meters) {
    if (!Number.isFinite(meters)) return '-';
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(meters < 10000 ? 2 : 1).replace(/\.0+$/, '') + ' km';
  }

  function sch_getBucket(p) {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function') {
      return PropertyDomain.getSourceBucket(p);
    }
    const st = String(p?.sourceType || p?.source_type || '').trim();
    if (st === 'realtor') return p?.isDirectSubmission ? 'realtor_direct' : 'realtor_naver';
    return st || 'general';
  }

  function sch_getBucketLabel(p) {
    const b = sch_getBucket(p);
    return ({
      auction: '경매', onbid: '공매',
      realtor_naver: '네이버중개', realtor_direct: '일반중개',
      general: '일반',
    })[b] || '일반';
  }

  function sch_getBucketClass(p) {
    const b = sch_getBucket(p);
    if (b === 'auction') return 'is-auction';
    if (b === 'onbid') return 'is-onbid';
    if (b === 'general') return 'is-general';
    return 'is-realtor';
  }

  function sch_getAssignedProperties() {
    return Array.isArray(state.properties) ? state.properties : [];
  }

  function sch_isAnchorCandidate(p) {
    if (_scheduleState.showAll) return true;
    const b = sch_getBucket(p);
    return b === 'auction' || b === 'onbid';
  }

  // 기준 물건 카드 렌더
  function sch_renderAnchorList() {
    const listEl = document.getElementById('schAnchorList');
    const emptyEl = document.getElementById('schAnchorEmpty');
    const countEl = document.getElementById('schAnchorCount');
    if (!listEl) return;

    const props = sch_getAssignedProperties();
    const anchors = props.filter(sch_isAnchorCandidate);

    if (countEl) {
      const labelMode = _scheduleState.showAll ? '전체' : '경매/공매';
      countEl.textContent = `${anchors.length}건 (${labelMode})`;
    }

    if (!anchors.length) {
      listEl.innerHTML = '';
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.textContent = _scheduleState.showAll
          ? '배정받은 물건이 없습니다.'
          : '배정받은 기준 물건(경매/공매)이 없습니다. 전체 보기를 켜면 다른 구분도 기준으로 선택할 수 있습니다.';
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    // 이전 선택이 현재 리스트에 없으면 초기화
    if (_scheduleState.selectedAnchorId && !anchors.some((p) => String(p.id || p.globalId) === _scheduleState.selectedAnchorId)) {
      _scheduleState.selectedAnchorId = null;
    }
    // 기본 선택: 첫 번째
    if (!_scheduleState.selectedAnchorId && anchors.length) {
      _scheduleState.selectedAnchorId = String(anchors[0].id || anchors[0].globalId);
    }

    listEl.innerHTML = anchors.map((p) => {
      const id = String(p.id || p.globalId || '');
      const sel = id === _scheduleState.selectedAnchorId;
      const label = sch_getBucketLabel(p);
      const cls = sch_getBucketClass(p);
      const addr = esc(String(p.address || '-'));
      const assetType = esc(String(p.assetType || ''));
      const area = p.exclusivearea != null && p.exclusivearea !== '' ? `${fmtArea(p.exclusivearea)}평` : '';
      const price = formatEok(p.priceMain);
      const ll = sch_getLatLng(p);
      const noCoord = !ll;

      const meta = [assetType, area, price !== '-' ? price : ''].filter(Boolean).join(' · ') || '세부 정보 없음';

      return `
        <button type="button" class="sch-anchor-card ${sel ? 'is-active' : ''}" data-anchor-id="${escAttr(id)}"
          style="text-align:left;display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:8px;background:${sel ? 'var(--brand-soft,#fff7ed)' : 'var(--surface,#fff)'};border:1px solid ${sel ? 'var(--brand,#ea580c)' : 'var(--border,#e5e7eb)'};cursor:pointer;${noCoord ? 'opacity:.6;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <span class="workmgmt-chip ${cls}" style="font-size:10px;padding:2px 6px;">${label}</span>
            ${noCoord ? '<span style="font-size:10px;color:#b45309;">⚠ 좌표 없음</span>' : ''}
          </div>
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${addr}</div>
          <div style="font-size:11px;color:var(--muted,#999);">${esc(meta)}</div>
        </button>
      `;
    }).join('');

    // 클릭 핸들러
    listEl.querySelectorAll('.sch-anchor-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.anchorId || '';
        if (!id) return;
        _scheduleState.selectedAnchorId = id;
        // 기준 변경 시 페이지/체크박스 초기화
        _scheduleState.page = 1;
        _scheduleState.checkedIds = new Set();
        sch_renderAnchorList();
        sch_renderNearbyList();
        sch_renderMap();
      });
    });
  }

  // 선택된 기준 물건 헤더 + 주변 거리순 렌더 (페이지네이션 + 체크박스)
  function sch_renderNearbyList() {
    const headEl = document.getElementById('schSelectedHead');
    const listEl = document.getElementById('schNearbyList');
    const emptyEl = document.getElementById('schNearbyEmpty');
    const pagerEl = document.getElementById('schNearbyPagination');
    const noCoordEl = document.getElementById('schNearbyNoCoord');
    if (!headEl || !listEl) return;

    const props = sch_getAssignedProperties();
    const anchor = props.find((p) => String(p.id || p.globalId) === _scheduleState.selectedAnchorId);

    if (!anchor) {
      headEl.innerHTML = `<div style="font-size:13px;color:var(--muted,#999);">기준 물건을 선택하세요.</div>`;
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.add('hidden');
      if (pagerEl) pagerEl.style.display = 'none';
      if (noCoordEl) noCoordEl.style.display = 'none';
      return;
    }

    const anchorLL = sch_getLatLng(anchor);
    // 기준 물건 카드는 상단 지도에서 ★ 마커로 충분히 식별되므로 헤더 카드는 생략.
    // 타이틀만 표시. 단, 기준 좌표가 없으면 안내 배지를 덧붙임.
    headEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div style="font-weight:600;font-size:13px;">주변 방문 동선 (거리순)</div>
        ${anchorLL ? '' : '<span style="font-size:10px;color:#b45309;">⚠ 기준 물건 좌표 없음 — 거리 계산 불가</span>'}
      </div>
    `;

    if (!anchorLL) {
      listEl.innerHTML = '';
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.textContent = '기준 물건에 좌표가 없어 거리 계산이 불가합니다. 다른 기준 물건을 선택해 주세요.';
      }
      if (pagerEl) pagerEl.style.display = 'none';
      if (noCoordEl) noCoordEl.style.display = 'none';
      return;
    }

    // 기준 제외 나머지 물건을 좌표 있는 것만 거리 계산 + 정렬
    const selectedId = String(anchor.id || anchor.globalId);
    const withDist = [];
    const noCoord = [];
    props.forEach((p) => {
      const pid = String(p.id || p.globalId);
      if (pid === selectedId) return;
      const ll = sch_getLatLng(p);
      if (!ll) { noCoord.push(p); return; }
      const d = sch_haversineMeters(anchorLL, ll);
      withDist.push({ p, d });
    });
    withDist.sort((a, b) => a.d - b.d);

    if (!withDist.length && !noCoord.length) {
      listEl.innerHTML = '';
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.textContent = '주변 방문 대상 물건이 없습니다.';
      }
      if (pagerEl) pagerEl.style.display = 'none';
      if (noCoordEl) noCoordEl.style.display = 'none';
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    // ── 페이지네이션 ──
    const pageSize = _scheduleState.pageSize || 10;
    const totalPages = Math.max(1, Math.ceil(withDist.length / pageSize));
    if (_scheduleState.page < 1) _scheduleState.page = 1;
    if (_scheduleState.page > totalPages) _scheduleState.page = totalPages;
    const curPage = _scheduleState.page;
    const startIdx = (curPage - 1) * pageSize;
    const pageRows = withDist.slice(startIdx, startIdx + pageSize);

    const rowsHtml = pageRows.map((entry, relIdx) => {
      const p = entry.p;
      const absIdx = startIdx + relIdx; // 전체 기준 0-based
      const displayIdx = absIdx + 1;    // 화면 표시용 1-based
      const bucketLabel = sch_getBucketLabel(p);
      const bucketCls = sch_getBucketClass(p);
      const addr = esc(String(p.address || '-'));
      const dist = sch_formatDistance(entry.d);
      const meta = esc([
        p.assetType,
        p.exclusivearea != null && p.exclusivearea !== '' ? `${fmtArea(p.exclusivearea)}평` : '',
        formatEok(p.priceMain) !== '-' ? formatEok(p.priceMain) : '',
      ].filter(Boolean).join(' · '));
      const pid = String(p.id || p.globalId || '');
      const checked = _scheduleState.checkedIds.has(pid) ? 'checked' : '';
      return `
        <div class="sch-nearby-card" data-nearby-id="${escAttr(pid)}"
          style="display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:8px;background:var(--surface,#fff);border:1px solid var(--border,#e5e7eb);">
          <div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:42px;">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--brand,#ea580c);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${displayIdx}</div>
            <div style="font-size:10px;color:var(--muted,#999);white-space:nowrap;">${dist}</div>
          </div>
          <div class="sch-nearby-body" style="flex:1 1 auto;min-width:0;cursor:pointer;">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:3px;">
              <span class="workmgmt-chip ${bucketCls}" style="font-size:10px;padding:2px 6px;">${bucketLabel}</span>
            </div>
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${addr}</div>
            <div style="font-size:11px;color:var(--muted,#999);">${meta}</div>
          </div>
          <label class="sch-nearby-check" style="flex:0 0 auto;display:flex;align-items:center;cursor:pointer;padding:6px;" title="지도에 표시">
            <input type="checkbox" class="sch-check-input" data-check-id="${escAttr(pid)}" ${checked} style="width:18px;height:18px;cursor:pointer;" />
          </label>
        </div>
      `;
    }).join('');

    listEl.innerHTML = rowsHtml;

    // 좌표 없는 물건 경고
    if (noCoordEl) {
      if (noCoord.length) {
        noCoordEl.textContent = `⚠ 좌표 없는 물건 ${noCoord.length}건은 거리 계산 불가로 목록에서 제외됨.`;
        noCoordEl.style.display = 'block';
      } else {
        noCoordEl.style.display = 'none';
      }
    }

    // 페이지네이션 렌더
    if (pagerEl) {
      if (totalPages > 1) {
        pagerEl.innerHTML = sch_buildPaginationHtml(curPage, totalPages);
        pagerEl.style.display = 'flex';
        pagerEl.querySelectorAll('[data-page]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const target = String(btn.dataset.page || '').trim();
            if (!target || btn.hasAttribute('disabled')) return;
            let next = curPage;
            if (target === 'first') next = 1;
            else if (target === 'prev')  next = Math.max(1, curPage - 1);
            else if (target === 'next')  next = Math.min(totalPages, curPage + 1);
            else if (target === 'last')  next = totalPages;
            else next = Math.max(1, Math.min(totalPages, parseInt(target, 10) || curPage));
            if (next !== curPage) {
              _scheduleState.page = next;
              sch_renderNearbyList();
            }
          });
        });
      } else {
        pagerEl.innerHTML = '';
        pagerEl.style.display = 'none';
      }
    }

    // 카드 본문 클릭 → 편집 모달 / 체크박스는 별도 처리
    listEl.querySelectorAll('.sch-nearby-body').forEach((body) => {
      body.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = body.closest('.sch-nearby-card');
        const pid = card?.dataset.nearbyId || '';
        if (!pid) return;
        const found = sch_getAssignedProperties().find((p) => String(p.id || p.globalId) === pid);
        if (found && typeof openEditModal === 'function') openEditModal(found);
      });
    });
    listEl.querySelectorAll('.sch-check-input').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const pid = cb.dataset.checkId || '';
        if (!pid) return;
        if (cb.checked) _scheduleState.checkedIds.add(pid);
        else _scheduleState.checkedIds.delete(pid);
        sch_updateMapSelectedCount();
        sch_renderMap();
      });
    });
    // 체크박스 라벨 클릭 이벤트 버블링 방지
    listEl.querySelectorAll('.sch-nearby-check').forEach((lbl) => {
      lbl.addEventListener('click', (e) => e.stopPropagation());
    });

    sch_updateMapSelectedCount();
  }

  // 페이지네이션 HTML (이미지 스타일 참고: << < 이전 1 2 3 … 다음 > >>)
  function sch_buildPaginationHtml(current, total) {
    const btnStyle = 'min-width:32px;height:30px;border-radius:6px;border:1px solid var(--border,#e5e7eb);background:var(--surface,#fff);color:var(--text,#333);font-size:12px;cursor:pointer;padding:0 8px;';
    const activeStyle = 'min-width:32px;height:30px;border-radius:6px;border:1px solid var(--brand,#ea580c);background:var(--brand,#ea580c);color:#fff;font-size:12px;font-weight:600;padding:0 8px;';
    const disabledStyle = btnStyle + 'opacity:.4;cursor:not-allowed;';

    const parts = [];
    const atStart = current === 1;
    const atEnd = current === total;

    parts.push(`<button type="button" data-page="first" ${atStart ? 'disabled' : ''} style="${atStart ? disabledStyle : btnStyle}">«</button>`);
    parts.push(`<button type="button" data-page="prev"  ${atStart ? 'disabled' : ''} style="${atStart ? disabledStyle : btnStyle}">‹</button>`);
    parts.push(`<button type="button" data-page="prev"  ${atStart ? 'disabled' : ''} style="${atStart ? disabledStyle : btnStyle}">이전</button>`);

    // 번호: 최대 7개. current 중심 윈도우.
    const windowSize = 7;
    let from = Math.max(1, current - Math.floor(windowSize / 2));
    let to = from + windowSize - 1;
    if (to > total) { to = total; from = Math.max(1, to - windowSize + 1); }
    for (let i = from; i <= to; i++) {
      const s = i === current ? activeStyle : btnStyle;
      parts.push(`<button type="button" data-page="${i}" style="${s}">${i}</button>`);
    }

    parts.push(`<button type="button" data-page="next" ${atEnd ? 'disabled' : ''} style="${atEnd ? disabledStyle : btnStyle}">다음</button>`);
    parts.push(`<button type="button" data-page="next" ${atEnd ? 'disabled' : ''} style="${atEnd ? disabledStyle : btnStyle}">›</button>`);
    parts.push(`<button type="button" data-page="last" ${atEnd ? 'disabled' : ''} style="${atEnd ? disabledStyle : btnStyle}">»</button>`);

    return parts.join('');
  }

  function sch_updateMapSelectedCount() {
    const countEl = document.getElementById('schMapSelectedCount');
    if (countEl) countEl.textContent = `선택 ${_scheduleState.checkedIds.size}건`;
  }

  // ═══════════════════════════════════════════════════════════════
  // 카카오맵
  // ═══════════════════════════════════════════════════════════════
  function sch_getKakaoKey() {
    const meta = document.querySelector('meta[name="kakao-app-key"]');
    return (meta?.getAttribute('content') || '').trim();
  }

  function sch_loadKakaoSdk() {
    return new Promise((resolve, reject) => {
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve());
        return;
      }
      const key = sch_getKakaoKey();
      if (!key) { reject(new Error('Kakao app key not set')); return; }
      // 이미 script 태그가 있으면 중복 삽입 방지
      const exists = document.querySelector('script[data-kakao-sdk]');
      if (exists) {
        exists.addEventListener('load', () => {
          if (window.kakao?.maps?.load) window.kakao.maps.load(() => resolve());
          else reject(new Error('Kakao SDK load 실패'));
        });
        exists.addEventListener('error', () => reject(new Error('Kakao SDK 네트워크 오류')));
        return;
      }
      const s = document.createElement('script');
      s.dataset.kakaoSdk = '1';
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`;
      s.async = true;
      s.onload = () => {
        if (!window.kakao?.maps?.load) { reject(new Error('Kakao SDK 로드 실패')); return; }
        window.kakao.maps.load(() => resolve());
      };
      s.onerror = () => reject(new Error('Kakao SDK 네트워크 오류'));
      document.head.appendChild(s);
    });
  }

  async function sch_ensureMap() {
    if (_scheduleState.map) return _scheduleState.map;
    const container = document.getElementById('schMap');
    const emptyEl = document.getElementById('schMapEmpty');
    if (!container) return null;
    try {
      await sch_loadKakaoSdk();
    } catch (err) {
      console.error('[schedule] kakao sdk failed:', err);
      container.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'block';
      return null;
    }
    const center = new kakao.maps.LatLng(37.5665, 126.978);
    _scheduleState.map = new kakao.maps.Map(container, { center, level: 6 });
    _scheduleState.mapReady = true;
    return _scheduleState.map;
  }

  function sch_clearMarkers() {
    (_scheduleState.mapMarkers || []).forEach((m) => {
      try { m.setMap(null); } catch (_) {}
    });
    _scheduleState.mapMarkers = [];
    if (_scheduleState.mapInfowindow) {
      try { _scheduleState.mapInfowindow.close(); } catch (_) {}
    }
  }

  async function sch_renderMap() {
    const map = await sch_ensureMap();
    if (!map) return;
    sch_clearMarkers();

    const props = sch_getAssignedProperties();
    const anchor = props.find((p) => String(p.id || p.globalId) === _scheduleState.selectedAnchorId);
    const anchorLL = anchor ? sch_getLatLng(anchor) : null;

    const bounds = new kakao.maps.LatLngBounds();
    let hasAny = false;

    // 기준 물건 마커 (빨간색)
    if (anchorLL) {
      const pos = new kakao.maps.LatLng(anchorLL.lat, anchorLL.lng);
      const marker = new kakao.maps.Marker({
        map,
        position: pos,
        image: new kakao.maps.MarkerImage(
          'data:image/svg+xml;utf8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
              <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z" fill="#dc2626"/>
              <circle cx="18" cy="18" r="7" fill="#fff"/>
              <text x="18" y="22" text-anchor="middle" font-size="11" font-weight="700" fill="#dc2626">★</text>
            </svg>
          `),
          new kakao.maps.Size(36, 46),
          { offset: new kakao.maps.Point(18, 46) }
        ),
        zIndex: 100,
      });
      _scheduleState.mapMarkers.push(marker);
      bounds.extend(pos);
      hasAny = true;

      const infowindowContent = `<div style="padding:6px 10px;font-size:12px;font-weight:600;color:#dc2626;white-space:nowrap;">기준: ${esc(String(anchor.address || ''))}</div>`;
      kakao.maps.event.addListener(marker, 'click', () => {
        if (_scheduleState.mapInfowindow) { try { _scheduleState.mapInfowindow.close(); } catch (_) {} }
        _scheduleState.mapInfowindow = new kakao.maps.InfoWindow({ content: infowindowContent, removable: true });
        _scheduleState.mapInfowindow.open(map, marker);
      });
    }

    // 체크된 주변 물건 마커 (주황색 + 순번)
    // 거리순 정렬 후 체크된 것만 필터해서 번호 매김 (전체 거리순 기준 순번 유지)
    if (anchorLL) {
      const selectedId = String(anchor.id || anchor.globalId);
      const withDist = [];
      props.forEach((p) => {
        const pid = String(p.id || p.globalId);
        if (pid === selectedId) return;
        const ll = sch_getLatLng(p);
        if (!ll) return;
        withDist.push({ p, ll, d: sch_haversineMeters(anchorLL, ll), pid });
      });
      withDist.sort((a, b) => a.d - b.d);

      withDist.forEach((entry, idx) => {
        if (!_scheduleState.checkedIds.has(entry.pid)) return;
        const pos = new kakao.maps.LatLng(entry.ll.lat, entry.ll.lng);
        const num = idx + 1;
        const marker = new kakao.maps.Marker({
          map,
          position: pos,
          image: new kakao.maps.MarkerImage(
            'data:image/svg+xml;utf8,' + encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
                <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="#ea580c"/>
                <circle cx="16" cy="16" r="10" fill="#fff"/>
                <text x="16" y="20" text-anchor="middle" font-size="12" font-weight="700" fill="#ea580c">${num}</text>
              </svg>
            `),
            new kakao.maps.Size(32, 40),
            { offset: new kakao.maps.Point(16, 40) }
          ),
          zIndex: 50,
        });
        _scheduleState.mapMarkers.push(marker);
        bounds.extend(pos);
        hasAny = true;

        const label = sch_getBucketLabel(entry.p);
        const dist = sch_formatDistance(entry.d);
        const infowindowContent = `
          <div style="padding:6px 10px;font-size:12px;white-space:nowrap;line-height:1.5;">
            <div style="font-weight:600;color:#ea580c;margin-bottom:2px;">${num}. ${esc(label)} · ${dist}</div>
            <div>${esc(String(entry.p.address || ''))}</div>
          </div>
        `;
        kakao.maps.event.addListener(marker, 'click', () => {
          if (_scheduleState.mapInfowindow) { try { _scheduleState.mapInfowindow.close(); } catch (_) {} }
          _scheduleState.mapInfowindow = new kakao.maps.InfoWindow({ content: infowindowContent, removable: true });
          _scheduleState.mapInfowindow.open(map, marker);
        });
      });
    }

    if (hasAny) {
      try {
        map.setBounds(bounds, 40, 40, 40, 40);
        // 단일 마커면 setBounds 가 과하게 줌인하므로 약간 조정
        if (_scheduleState.mapMarkers.length === 1) {
          setTimeout(() => { try { map.setLevel(4); } catch (_) {} }, 0);
        }
      } catch (_) {}
    }
  }

  function sch_clearAllChecks() {
    _scheduleState.checkedIds = new Set();
    sch_updateMapSelectedCount();
    sch_renderNearbyList();
    sch_renderMap();
  }

  async function refreshAgentScheduleView(options = {}) {
    // state.properties 가 비어있으면 먼저 로드 시도
    const props = sch_getAssignedProperties();
    if (!props.length && typeof loadProperties === 'function') {
      try { await loadProperties(); } catch (_) {}
    }
    sch_renderAnchorList();
    sch_renderNearbyList();
    // 지도는 탭 보이는 상태에서만 제대로 초기화됨 → 비동기
    setTimeout(() => { sch_renderMap(); }, 50);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const showAllCb = document.getElementById('schAnchorShowAll');
    if (showAllCb) {
      showAllCb.addEventListener('change', function () {
        _scheduleState.showAll = !!this.checked;
        // 전체 보기 토글 시 선택/페이지/체크 초기화
        _scheduleState.selectedAnchorId = null;
        _scheduleState.page = 1;
        _scheduleState.checkedIds = new Set();
        sch_renderAnchorList();
        sch_renderNearbyList();
        sch_renderMap();
      });
    }
    const clearBtn = document.getElementById('schMapClearSelection');
    if (clearBtn) clearBtn.addEventListener('click', sch_clearAllChecks);

    window.refreshAgentScheduleView = function () { refreshAgentScheduleView({ force: true }); };
  });

  // ────────────────────────────────────────────────────────────────────
  // 전체리스트 지도 보기 모듈 (2026-05-13 신규)
  //   - 토글: [리스트 / 지도] 같은 영역에서 전환
  //   - 현재 필터 결과를 그대로 마커로 표시 (renderTable hook 으로 동기화)
  //   - 같은 좌표 매물은 묶음 마커, 클릭 시 InfoWindow 로 펼침
  //   - 좌표 미확보 매물은 지도 우상단 경고 배지로 안내
  //   - 마커 단일 클릭 → openEditModal 즉시 호출
  // ────────────────────────────────────────────────────────────────────
  const LI_MAP_BUCKET_FILL = {
    auction: '#9333ea',
    onbid: '#2563eb',
    realtor_naver: '#03c75a',
    realtor_direct: '#c59d45',
    general: '#64748b',
  };
  const LI_MAP_BUCKET_TEXT = {
    auction: '#9333ea',
    onbid: '#2563eb',
    realtor_naver: '#03a449',
    realtor_direct: '#a47a1f',
    general: '#475569',
  };
  const LI_MAP_BUCKET_LABEL = {
    auction: '경매',
    onbid: '공매',
    realtor_naver: '네이버',
    realtor_direct: '일반중개',
    general: '일반',
  };

  const _listMapState = {
    map: null,
    mapReady: false,
    markers: [],
    infowindow: null,
    sdkFailed: false,
    pendingRender: false,
    resizeBound: false,
  };

  function li_map_getBucket(p) {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function') {
      return PropertyDomain.getSourceBucket(p);
    }
    const st = String(p?.sourceType || p?.source_type || '').trim();
    if (st === 'realtor') return p?.isDirectSubmission ? 'realtor_direct' : 'realtor_naver';
    return st || 'general';
  }

  function li_map_getLatLng(p) {
    if (!p) return null;
    const raw = p._raw || p.raw || {};
    const lat = Number(p.latitude ?? p.lat ?? raw.latitude ?? raw.lat);
    const lng = Number(p.longitude ?? p.lng ?? raw.longitude ?? raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
  }

  // 마커 본체에 표시할 짧은 가격 — "23.2억" 형태. 1억 미만은 "9,500만". 0이면 빈 문자열.
  function li_map_formatPriceShort(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v >= 100000000) {
      const eok = v / 100000000;
      if (eok >= 100) return Math.round(eok) + '억';
      return eok.toFixed(1).replace(/\.0$/, '') + '억';
    }
    if (v >= 10000) return Math.round(v / 10000).toLocaleString() + '만';
    return v.toLocaleString();
  }

  function li_map_formatAreaShort(area) {
    const v = Number(area);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v >= 100) return Math.round(v) + '평';
    return v.toFixed(1).replace(/\.0$/, '') + '평';
  }

  function li_map_computeDiscount(p) {
    const appr = Number(p?.priceMain);
    const cur = Number(p?.lowprice);
    if (!Number.isFinite(appr) || appr <= 0) return null;
    if (!Number.isFinite(cur) || cur <= 0) return null;
    if (cur >= appr) return null;
    const pct = Math.round((1 - cur / appr) * 100);
    return pct >= 1 ? pct : null;
  }

  function li_map_computeDday(p) {
    const raw = p?.dateMain || p?._raw?.date_main || '';
    if (!raw) return null;
    const target = new Date(String(raw).slice(0, 10) + 'T00:00:00');
    if (!Number.isFinite(target.getTime())) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - now.getTime()) / 86400000);
    if (diff < 0) return null;
    if (diff === 0) return 'D-day';
    if (diff > 365) return null;
    return 'D-' + diff;
  }

  // 단일 매물 마커 SVG 빌더 — 시안 V2 디자인
  function li_map_buildMarkerSvg(p) {
    const bucket = li_map_getBucket(p);
    const fill = LI_MAP_BUCKET_FILL[bucket] || LI_MAP_BUCKET_FILL.general;
    const textColor = LI_MAP_BUCKET_TEXT[bucket] || LI_MAP_BUCKET_TEXT.general;
    const label = LI_MAP_BUCKET_LABEL[bucket] || '일반';

    const areaText = li_map_formatAreaShort(p?.exclusivearea);
    const priceVal = (p?.lowprice != null && Number(p.lowprice) > 0) ? p.lowprice : p?.priceMain;
    const priceText = li_map_formatPriceShort(priceVal) || '-';

    const hasFav = state.favorites.has(p?.id);
    const hasFire = !hasFav && state.fires.has(p?.id);
    const hasInsp = !!(p?.siteInspection && String(p.siteInspection).trim());
    const discount = li_map_computeDiscount(p);
    const dday = li_map_computeDday(p);

    const hasLeftBadge = hasFav || hasFire;
    const hasTopRightBadge = hasInsp;
    const hasRightInfo = (discount !== null) || (dday !== null);

    const left = hasLeftBadge ? -11 : -1;
    const right = hasRightInfo ? 128 : (hasTopRightBadge ? 102 : 91);
    const top = (hasLeftBadge || hasTopRightBadge) ? -11 : -1;
    const bottom = 65;
    const width = right - left;
    const height = bottom - top;
    const viewBox = left + ' ' + top + ' ' + width + ' ' + height;
    // anchor: 포인터 끝 (46, 64) → SVG 픽셀 좌표
    const anchorX = 46 - left;
    const anchorY = 64 - top;

    let badges = '';

    if (hasFav) {
      badges += '<circle cx="-2" cy="-2" r="9" fill="#fbbf24" stroke="#fff" stroke-width="1.5"/>';
      badges += '<path d="M-2 -7 L-0.5 -3.5 L3 -3.2 L0.5 -1 L1.2 2.5 L-2 0.7 L-5.2 2.5 L-4.5 -1 L-7 -3.2 L-3.5 -3.5 Z" fill="#fff"/>';
    } else if (hasFire) {
      badges += '<circle cx="-2" cy="-2" r="9" fill="#ea580c" stroke="#fff" stroke-width="1.5"/>';
      badges += '<path d="M-2 -8 C-3.5 -5 -5 -3 -4 -0.5 C-3.5 1 -2 1 -2.5 -0.5 C-2.8 -1.5 -1.5 -2 -1.5 -0.5 C-1.5 1.5 0 3 2.5 2.5 C5 1 5 -1 4 -3.5 C3 -5 1 -5.5 1 -7 C1 -7.5 0 -8 -1 -8 Z" fill="#fff"/>';
    }
    if (hasInsp) {
      badges += '<circle cx="92" cy="-2" r="9" fill="#16a34a" stroke="#fff" stroke-width="1.5"/>';
      badges += '<path d="M87.5 -2 L91 1.2 L96.5 -5.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    if (discount !== null && dday !== null) {
      badges += '<rect x="94" y="14" width="32" height="16" rx="3.5" fill="#dc2626"/>';
      badges += '<text x="110" y="25.5" text-anchor="middle" font-size="9.5" font-weight="500" fill="#fff" font-family="-apple-system,system-ui,sans-serif">↓' + discount + '%</text>';
      badges += '<rect x="94" y="33" width="32" height="16" rx="3.5" fill="#1f2937"/>';
      badges += '<text x="110" y="44.5" text-anchor="middle" font-size="9.5" font-weight="500" fill="#fff" font-family="-apple-system,system-ui,sans-serif">' + esc(dday) + '</text>';
    } else if (discount !== null) {
      badges += '<rect x="94" y="22" width="32" height="16" rx="3.5" fill="#dc2626"/>';
      badges += '<text x="110" y="33.5" text-anchor="middle" font-size="9.5" font-weight="500" fill="#fff" font-family="-apple-system,system-ui,sans-serif">↓' + discount + '%</text>';
    } else if (dday !== null) {
      badges += '<rect x="94" y="22" width="32" height="16" rx="3.5" fill="#1f2937"/>';
      badges += '<text x="110" y="33.5" text-anchor="middle" font-size="9.5" font-weight="500" fill="#fff" font-family="-apple-system,system-ui,sans-serif">' + esc(dday) + '</text>';
    }

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '" width="' + width + '" height="' + height + '">'
      + '<rect x="1" y="1" width="90" height="56" rx="9" fill="#fff" stroke="#cfd4dc" stroke-width="0.7"/>'
      + '<text x="9" y="18" font-size="11.5" font-weight="500" fill="' + textColor + '" font-family="-apple-system,system-ui,sans-serif">' + esc(label) + '</text>'
      + '<text x="83" y="18" text-anchor="end" font-size="10" fill="#6b7280" font-family="-apple-system,system-ui,sans-serif">' + esc(areaText) + '</text>'
      + '<text x="46" y="44" text-anchor="middle" font-size="17" font-weight="500" fill="#111827" font-family="-apple-system,system-ui,sans-serif">' + esc(priceText) + '</text>'
      + '<path d="M41 57 L51 57 L46 64 Z" fill="' + fill + '"/>'
      + badges
      + '</svg>';

    return { svg: svg, width: width, height: height, anchorX: anchorX, anchorY: anchorY };
  }

  // 묶음 마커(같은 좌표 N건) SVG — 시안 D 디자인 (원형 카운트)
  function li_map_buildClusterSvg(items) {
    const buckets = new Set(items.map(li_map_getBucket));
    const color = buckets.size === 1 ? (LI_MAP_BUCKET_FILL[items[0] ? li_map_getBucket(items[0]) : 'general'] || '#475569') : '#475569';
    const count = items.length;
    const fontSize = count >= 100 ? 12 : 14;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="60" height="60">'
      + '<circle cx="30" cy="30" r="26.5" fill="none" stroke="' + color + '" stroke-width="1" opacity="0.35"/>'
      + '<circle cx="30" cy="30" r="22" fill="' + color + '" stroke="#fff" stroke-width="3"/>'
      + '<text x="30" y="35" text-anchor="middle" font-size="' + fontSize + '" fill="#fff" font-family="-apple-system,system-ui,sans-serif" font-weight="500">' + count + '</text>'
      + '</svg>';
    return { svg: svg, width: 60, height: 60, anchorX: 30, anchorY: 30 };
  }

  function li_map_svgToDataUri(svg) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function li_map_loadKakaoSdk() {
    return new Promise((resolve, reject) => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.load) {
        window.kakao.maps.load(() => resolve());
        return;
      }
      const meta = document.querySelector('meta[name="kakao-app-key"]');
      const key = (meta?.getAttribute('content') || '').trim();
      if (!key) { reject(new Error('Kakao app key not set')); return; }
      const exists = document.querySelector('script[data-kakao-sdk]');
      if (exists) {
        exists.addEventListener('load', () => {
          if (window.kakao?.maps?.load) window.kakao.maps.load(() => resolve());
          else reject(new Error('Kakao SDK load 실패'));
        });
        exists.addEventListener('error', () => reject(new Error('Kakao SDK 네트워크 오류')));
        return;
      }
      const s = document.createElement('script');
      s.dataset.kakaoSdk = '1';
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(key) + '&autoload=false&libraries=services';
      s.async = true;
      s.onload = () => {
        if (!window.kakao?.maps?.load) { reject(new Error('Kakao SDK 로드 실패')); return; }
        window.kakao.maps.load(() => resolve());
      };
      s.onerror = () => reject(new Error('Kakao SDK 네트워크 오류'));
      document.head.appendChild(s);
    });
  }

  async function li_map_ensureMap() {
    if (_listMapState.map) return _listMapState.map;
    const container = els.agMapContainer;
    if (!container) return null;
    if (_listMapState.sdkFailed) return null;
    try {
      await li_map_loadKakaoSdk();
    } catch (err) {
      console.error('[list-map] kakao sdk failed:', err);
      _listMapState.sdkFailed = true;
      if (els.agMapEmpty) els.agMapEmpty.classList.remove('hidden');
      container.style.display = 'none';
      return null;
    }
    const center = new kakao.maps.LatLng(37.5665, 126.978);
    _listMapState.map = new kakao.maps.Map(container, { center: center, level: 7 });
    _listMapState.mapReady = true;
    // 지도 외부 클릭 시 InfoWindow 닫힘 동작은 카카오 기본 동작에 위임
    return _listMapState.map;
  }

  function li_map_clearMarkers() {
    if (Array.isArray(_listMapState.markers)) {
      for (const m of _listMapState.markers) {
        try { m.setMap(null); } catch (_) {}
      }
    }
    _listMapState.markers = [];
    if (_listMapState.infowindow) {
      try { _listMapState.infowindow.close(); } catch (_) {}
      _listMapState.infowindow = null;
    }
  }

  // 좌표 기준 그룹핑 — 소수점 6자리 (약 0.1m 정밀도) 동일 시 같은 그룹
  function li_map_groupByCoord(properties) {
    const groups = new Map();
    const noCoord = [];
    for (const p of properties) {
      const ll = li_map_getLatLng(p);
      if (!ll) { noCoord.push(p); continue; }
      const key = ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6);
      let g = groups.get(key);
      if (!g) {
        g = { key: key, coord: ll, items: [] };
        groups.set(key, g);
      }
      g.items.push(p);
    }
    return { groups: Array.from(groups.values()), noCoord: noCoord };
  }

  function li_map_openSingleMarkerEdit(p) {
    if (typeof openEditModal === 'function') {
      try { openEditModal(p); } catch (e) { console.error('[list-map] openEditModal failed', e); }
    }
  }

  function li_map_openClusterInfowindow(map, marker, group) {
    if (_listMapState.infowindow) {
      try { _listMapState.infowindow.close(); } catch (_) {}
    }
    const items = group.items.slice(0, 50);  // 너무 많은 경우 최대 50건
    const rows = items.map((p) => {
      const bucket = li_map_getBucket(p);
      const color = LI_MAP_BUCKET_TEXT[bucket] || '#475569';
      const label = LI_MAP_BUCKET_LABEL[bucket] || '일반';
      const priceVal = (p?.lowprice != null && Number(p.lowprice) > 0) ? p.lowprice : p?.priceMain;
      const priceText = li_map_formatPriceShort(priceVal) || '-';
      const areaText = li_map_formatAreaShort(p?.exclusivearea);
      const addr = String(p?.address || '').trim();
      const addrShort = addr.length > 18 ? addr.slice(0, 18) + '…' : addr;
      const pid = escAttr(p?.id || '');
      return '<button type="button" class="ag-map-cluster-row" data-property-id="' + pid + '">'
        + '<span class="ag-map-cluster-row-kind" style="color:' + color + ';">' + esc(label) + '</span>'
        + '<span class="ag-map-cluster-row-addr">' + esc(addrShort) + '</span>'
        + '<span class="ag-map-cluster-row-price">' + esc(priceText) + (areaText ? ' · ' + esc(areaText) : '') + '</span>'
        + '</button>';
    }).join('');
    const more = group.items.length > items.length
      ? '<div class="ag-map-cluster-more">외 ' + (group.items.length - items.length) + '건은 줌인하여 확인</div>'
      : '';
    const content = '<div class="ag-map-cluster-popup">'
      + '<div class="ag-map-cluster-head">동일 위치 ' + group.items.length + '건</div>'
      + '<div class="ag-map-cluster-list">' + rows + '</div>'
      + more
      + '</div>';

    const iw = new kakao.maps.InfoWindow({ content: content, removable: true, zIndex: 200 });
    iw.open(map, marker);
    _listMapState.infowindow = iw;

    // InfoWindow DOM은 비동기로 attach 됨 → 잠시 후 클릭 핸들러 부착
    setTimeout(() => {
      const wraps = document.querySelectorAll('.ag-map-cluster-row');
      wraps.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pid = btn.getAttribute('data-property-id');
          const found = (Array.isArray(state.properties) ? state.properties : []).find(
            (it) => String(it?.id || '') === pid
          );
          if (found) li_map_openSingleMarkerEdit(found);
          try { iw.close(); } catch (_) {}
          _listMapState.infowindow = null;
        });
      });
    }, 30);
  }

  function li_map_updateWarnBadge(noCoordCount) {
    if (!els.agMapWarnBadge) return;
    if (noCoordCount > 0) {
      if (els.agMapWarnCount) els.agMapWarnCount.textContent = String(noCoordCount);
      els.agMapWarnBadge.classList.remove('hidden');
    } else {
      els.agMapWarnBadge.classList.add('hidden');
    }
  }

  function li_map_updateEmptyState(hasAny) {
    if (!els.agMapEmptyState) return;
    if (hasAny) els.agMapEmptyState.classList.add('hidden');
    else els.agMapEmptyState.classList.remove('hidden');
  }

  async function li_map_render() {
    const map = await li_map_ensureMap();
    if (!map) return;
    li_map_clearMarkers();

    // 현재 필터를 그대로 적용 (renderTable 과 같은 결과)
    const rows = (typeof getFilteredProps === 'function') ? getFilteredProps() : (Array.isArray(state.properties) ? state.properties : []);
    const grouped = li_map_groupByCoord(rows);

    li_map_updateWarnBadge(grouped.noCoord.length);
    li_map_updateEmptyState(grouped.groups.length > 0 || grouped.noCoord.length > 0);

    if (!grouped.groups.length) {
      // 좌표 있는 매물이 0건이면 마커 없음. 지도는 그대로 둠.
      return;
    }

    const bounds = new kakao.maps.LatLngBounds();

    for (const g of grouped.groups) {
      const pos = new kakao.maps.LatLng(g.coord.lat, g.coord.lng);
      let img;
      let marker;

      if (g.items.length === 1) {
        const p = g.items[0];
        const built = li_map_buildMarkerSvg(p);
        img = new kakao.maps.MarkerImage(
          li_map_svgToDataUri(built.svg),
          new kakao.maps.Size(built.width, built.height),
          { offset: new kakao.maps.Point(built.anchorX, built.anchorY) }
        );
        marker = new kakao.maps.Marker({ map: map, position: pos, image: img, zIndex: 10 });
        kakao.maps.event.addListener(marker, 'click', () => {
          li_map_openSingleMarkerEdit(p);
        });
      } else {
        const built = li_map_buildClusterSvg(g.items);
        img = new kakao.maps.MarkerImage(
          li_map_svgToDataUri(built.svg),
          new kakao.maps.Size(built.width, built.height),
          { offset: new kakao.maps.Point(built.anchorX, built.anchorY) }
        );
        marker = new kakao.maps.Marker({ map: map, position: pos, image: img, zIndex: 20 });
        kakao.maps.event.addListener(marker, 'click', () => {
          li_map_openClusterInfowindow(map, marker, g);
        });
      }
      _listMapState.markers.push(marker);
      bounds.extend(pos);
    }

    // 처음 진입 또는 마커가 한 개일 때 외에는 bounds 자동 적용
    if (grouped.groups.length > 1) {
      try { map.setBounds(bounds, 40, 40, 40, 40); } catch (_) {
        try { map.setBounds(bounds); } catch (_) {}
      }
    } else if (grouped.groups.length === 1) {
      try {
        map.setCenter(new kakao.maps.LatLng(grouped.groups[0].coord.lat, grouped.groups[0].coord.lng));
      } catch (_) {}
    }
  }

  function li_map_isActive() {
    return state.listViewMode === 'map';
  }

  function li_map_renderIfActive() {
    if (!li_map_isActive()) return;
    // 비동기 — DOM이 보인 직후 호출 시 지도 컨테이너 크기 0 문제 회피
    setTimeout(() => { li_map_render(); }, 30);
  }

  function li_map_setViewMode(mode) {
    const normalized = mode === 'map' ? 'map' : 'list';
    if (state.listViewMode === normalized) return;
    state.listViewMode = normalized;

    const panel = document.querySelector('#ag-view-list .agent-list-panel');
    if (panel) panel.classList.toggle('is-map-mode', normalized === 'map');

    // 토글 버튼 active 상태 갱신
    if (els.agViewToggle) {
      els.agViewToggle.querySelectorAll('[data-view-mode]').forEach((btn) => {
        const isActive = btn.getAttribute('data-view-mode') === normalized;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    if (normalized === 'map') {
      // 지도 모드 진입: 컨테이너가 화면에 보인 직후 지도 초기화/렌더
      setTimeout(() => {
        li_map_render().then(() => {
          // 컨테이너가 늦게 보였을 때 카카오 지도 relayout
          if (_listMapState.map && typeof _listMapState.map.relayout === 'function') {
            try { _listMapState.map.relayout(); } catch (_) {}
          }
        });
      }, 50);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    // 토글 버튼 클릭 이벤트
    const toggleEl = document.getElementById('agViewToggle');
    if (toggleEl) {
      toggleEl.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-view-mode]');
        if (!btn) return;
        const mode = btn.getAttribute('data-view-mode');
        li_map_setViewMode(mode);
      });
    }
    // 창 크기 변동 시 지도 relayout (탭이 보이는 상태에서)
    window.addEventListener('resize', function () {
      if (!li_map_isActive()) return;
      if (_listMapState.map && typeof _listMapState.map.relayout === 'function') {
        try { _listMapState.map.relayout(); } catch (_) {}
      }
    });
  });
  // ───────── 전체리스트 지도 보기 모듈 끝 ─────────

  // ── Start ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
