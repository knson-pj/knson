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
  const DAILY_REPORT_NOTE_PREFIX = "knson_daily_report_note_v1_";

  function getFavsKey() {
    const uid = state.session?.user?.id || state.session?.user?.email || "guest";
    return FAVS_KEY_PREFIX + uid;
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(getFavsKey());
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(getFavsKey(), JSON.stringify([...state.favorites]));
    } catch {}
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    saveFavorites();
  }

  const state = {
    session: loadSession(),
    properties: [],
    favorites: new Set(),           // 즐겨찾기 property id 집합
    filters: {
      activeCard: "",
      status: "",
      keyword: "",
      area: "",
      priceRange: "",
      ratio50: "",
      favOnly: false,
      todayBid: false,        // 당일 입찰기일 필터
    },
    page: 1,
    pageSize: 30,
    propertySort: { key: '', direction: 'desc' },
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

    // Table
    els.agTableBody = $("#agTableBody");
    els.agEmpty = $("#agEmpty");
    els.agPagination = $("#agPagination");

    // Filters
    els.agSourceFilter = $("#agSourceFilter");
    els.agAreaFilter = $("#agAreaFilter");
    els.agPriceFilter = $("#agPriceFilter");
    els.agRatioFilter = $("#agRatioFilter");
    els.agKeyword = $("#agKeyword");
    els.agFavFilter = $("#agFavFilter");
    els.agDayFilter = $("#agDayFilter");
    els.btnNewProperty = $("#btnNewProperty");
    els.newPropertyModal = $("#newPropertyModal");
    els.npmClose = $("#npmClose");
    els.npmCancel = $("#npmCancel");
    els.newPropertyForm = $("#newPropertyForm");
    els.npmSave = $("#npmSave");
    els.npmMsg = $("#npmMsg");
    els.npmRealtorFields = $("#npmRealtorFields");
    els.npmOwnerFields = $("#npmOwnerFields");

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
      if (data?.ok === false) throw new Error(extractApiErrorText(data, 200));
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
      throw new Error(extractApiErrorText(data, res.status));
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
    const raw = itemOrRow?._raw?.raw && typeof itemOrRow._raw.raw === 'object' ? itemOrRow._raw.raw : (itemOrRow?._raw || {});
    if (raw?.registeredByAdmin) return '관리자';
    if (raw?.registeredByAgent) return '담당자';
    // 레거시 fallback: 플래그 없는 기존 레코드는 registrationLog 첫 엔트리의 actorRole 로 판별
    // (이 fallback 덕분에 이미 업로드된 CSV 건도 배포 즉시 '관리자' 로 올바르게 표시됨)
    const logs = Array.isArray(raw?.registrationLog) ? raw.registrationLog : [];
    const firstCreated = logs.find((e) => e && e.type === 'created');
    const logRole = String(firstCreated?.actorRole || '').trim().toLowerCase();
    if (logRole === 'admin') return '관리자';
    if (logRole === 'staff' || logRole === 'agent') return '담당자';
    const submitterType = String(
      itemOrRow?.submitterType || itemOrRow?.submitter_type || raw?.submitter_type || raw?.submitterType || ''
    ).trim().toLowerCase();
    return submitterType === 'realtor' ? '공인중개사' : '소유자/일반';
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
        : (key === "opinion" ? (String(options.opinionText || "").trim() || null) : null),
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

  function bindEvents() {
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
    if (els.agFavFilter) els.agFavFilter.addEventListener("click", () => {
      state.filters.favOnly = !state.filters.favOnly;
      els.agFavFilter.classList.toggle("is-active", state.filters.favOnly);
      state.page = 1;
      renderTable();
    });

    if (els.agDayFilter) els.agDayFilter.addEventListener("click", () => {
      state.filters.todayBid = !state.filters.todayBid;
      els.agDayFilter.classList.toggle("is-active", state.filters.todayBid);
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

    await loadProperties();
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
  function renderAll() {
    renderSummary();
    renderTable();
    if (els.dailyReportModal && !els.dailyReportModal.classList.contains("hidden")) renderDailyReport();
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
  }

  function getFilteredProps(options = {}) {
    const keywordFields = ['address', 'itemNo', 'opinion'];
    if (PropertyDomain && typeof PropertyDomain.applyPropertyFilters === 'function') {
      return PropertyDomain.applyPropertyFilters(state.properties, state.filters, {
        ignoreKeys: options?.ignoreKeys,
        keywordFields,
        todayKey: getTodayDateKey(),
        isFavorite: (row) => state.favorites.has(row?.id),
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
    if (!ignoreKeys.has('favOnly') && f.favOnly) rows = rows.filter((r) => state.favorites.has(r.id));
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
      if (els.agEmpty) els.agEmpty.classList.remove("hidden");
      renderPagination(0);
      return;
    }
    if (els.agEmpty) els.agEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    for (const p of paged) frag.appendChild(renderRow(p));
    els.agTableBody.appendChild(frag);
    renderPagination(totalPages);
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
  const addressText = truncateAddressText(listView?.address || p.address || '-', 30) || '-';
  const fullAddress = String(listView?.address || p.address || '').trim();
  const assetTypeText = truncateDisplayText(listView?.assetType || p.assetType || "-", 7) || "-";
  const floorText = truncateDisplayText(listView?.floorText || getFloorDisplayValue(p) || "-", 7) || "-";
  const scheduleHtml = !usePlainLayout
    ? ((PropertyRenderers && typeof PropertyRenderers.formatScheduleHtml === 'function'
        ? PropertyRenderers.formatScheduleHtml(p)
        : '') || formatScheduleHtmlLocal(p))
    : '';
  const opinionText = !usePlainLayout && p.opinion ? '✓' : '';
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
    if (opinionText) footerParts.push('의견 ' + opinionText);
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

    // 관심 버튼: 이벤트 바인딩
    const favBtnM = favTd.querySelector('.btn-fav');
    if (favBtnM) {
      favBtnM.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(p.id);
        const nowFav = state.favorites.has(p.id);
        favBtnM.textContent = nowFav ? '★' : '☆';
        favBtnM.title = nowFav ? '관심 해제' : '관심 등록';
        favBtnM.classList.toggle('is-active', nowFav);
        if (state.filters.favOnly) { state.page = 1; renderTable(); }
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
  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(p.id);
    const nowFav = state.favorites.has(p.id);
    favBtn.textContent = nowFav ? "★" : "☆";
    favBtn.title = nowFav ? "관심 해제" : "관심 등록";
    favBtn.classList.toggle("is-active", nowFav);
    if (state.filters.favOnly) { state.page = 1; renderTable(); }
  });
  favTd.appendChild(favBtn);
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
        "<td>" + (p.rightsAnalysis ? "✓" : "-") + "</td>" +
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
    const currentText = currentValue == null ? "" : String(currentValue).trim();
    const hasCurrent = currentText !== "";
    if (nextValue == null || nextValue === "") {
      if (!hasCurrent) patch[key] = null;
      return;
    }
    if (!hasCurrent) patch[key] = nextValue;
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
    if (agBrokerMemoEl) agBrokerMemoEl.value = _agRaw.memo || _agRaw.importedSourceText || _agRaw.sourceNoteText || _agRaw["매물특징"] || "";
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
        status: hidePlainFields ? prev.status : (readStr('status') || null),
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
          }));
        } catch (logErr) {
          activityError = logErr?.message || "일일업무일지 기록 실패";
        }
      }

      setAgentEditMsg('', false);
      closeEditModal();
      flashAgentSaveNotice('저장되었습니다.', 1500);
      if (activityError) setGlobalMsg(`저장은 완료되었지만 업무일지 기록에 실패했습니다. ${activityError}`);
      else setGlobalMsg('', false);
      window.setTimeout(() => refreshAgentPropertiesInBackground({ silent: true }), 50);
    } catch (err) {
      setAgentEditMsg(toUserErrorMessage(err, '저장 실패'));
    } finally {
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
        await recordDailyReportEntries(buildActivityLogEntries(["newProperty"], payload, {
          propertyId: savedPropertyId,
          identityKey: savedIdentityKey,
          changedFields: { newProperty: ["registration"] },
        }));
      } catch (logErr) {
        activityError = logErr?.message || "일일업무일지 기록 실패";
      }
      if (activityError) setGlobalMsg(`물건 등록은 완료되었지만 업무일지 기록에 실패했습니다. ${activityError}`);
      else setGlobalMsg("");
      setTimeout(() => { closeNewPropertyModal(); window.setTimeout(() => refreshAgentPropertiesInBackground(), 2400); }, 2200);
    } finally {
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
        const entryMeta = [entry.at ? `<span class="agent-combined-log-author">${esc(formatRegLogAt(entry.at))}</span>` : '', renderCombinedLogActorChip(entry)].filter(Boolean).join('');
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
    if (!text) return Array.isArray(history) ? history : [];
    const current = String(getEditorHistoryText(item, kind, { todayOnly: false }) || '').trim();
    if (current === text) return Array.isArray(history) ? history : [];
    return appendOpinionEntry(history, text, user, { ...options, kind });
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

  // ── Start ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
