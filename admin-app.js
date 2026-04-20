(() => {
  const ADMIN_FAST_BUILD = "20260403-adminfix2-hotfix2";
  try { console.info("[admin-app] build", ADMIN_FAST_BUILD); } catch {}

  "use strict";

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const PropertyRenderers = window.KNSN_PROPERTY_RENDERERS || null;
  const toNumber = (Shared && typeof Shared.toNumber === "function")
    ? Shared.toNumber
    : ((K && typeof K.toNumber === "function") ? K.toNumber : (v) => {
        if (v === null || v === undefined) return NaN;
        if (typeof v === "number") return v;
        const s = String(v).trim();
        if (!s) return NaN;
        const s2 = s.replace(/,/g, "");
        const m = s2.match(/[+-]?\d+(\.\d+)?/);
        if (!m) return NaN;
        const n = Number(m[0]);
        return Number.isFinite(n) ? n : NaN;
      });

  function toUserErrorMessage(err, fallback = "요청 처리 중 오류가 발생했습니다.") {
    const raw = String(err?.message || err || "").trim();
    if (!raw) return fallback;
    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(raw)) return "네트워크 연결 또는 서버 응답에 실패했습니다.";
    if (/not allowed|forbidden|permission/i.test(raw)) return "권한이 없어 요청을 처리할 수 없습니다.";
    if (/schema cache|column .* does not exist|does not exist/i.test(raw)) return "서버 스키마 반영이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
    return raw;
  }

  function parseFlexibleNumber(value) {
    if (PropertyRenderers && typeof PropertyRenderers.parseFlexibleNumber === "function") return PropertyRenderers.parseFlexibleNumber(value);
    if (Shared && typeof Shared.parseFlexibleNumber === "function") return Shared.parseFlexibleNumber(value);
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const s = String(value).trim();
    if (!s) return null;
    const n = toNumber(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function formatMoneyInputValue(value) {
    if (PropertyRenderers && typeof PropertyRenderers.formatMoneyInputValue === "function") return PropertyRenderers.formatMoneyInputValue(value);
    if (Shared && typeof Shared.formatMoneyInputValue === "function") return Shared.formatMoneyInputValue(value);
    if (value === null || value === undefined) return "";
    const raw = String(value).trim();
    if (!raw) return "";
    const digits = raw.replace(/[^\d-]/g, "");
    if (!digits || digits === "-") return "";
    const sign = digits.startsWith("-") ? "-" : "";
    const body = digits.replace(/-/g, "");
    if (!body) return sign;
    return sign + body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function bindAmountInputMask(input) {
    if (PropertyRenderers && typeof PropertyRenderers.bindAmountInputMask === "function") return PropertyRenderers.bindAmountInputMask(input);
    if (Shared && typeof Shared.bindAmountInputMask === "function") return Shared.bindAmountInputMask(input);
    if (!input || input.dataset.amountMaskBound === "true") return;
    input.dataset.amountMaskBound = "true";
    input.addEventListener("input", () => {
      const formatted = formatMoneyInputValue(input.value);
      if (input.value !== formatted) input.value = formatted;
    });
    input.addEventListener("blur", () => {
      input.value = formatMoneyInputValue(input.value);
    });
  }

  function configureFreeDecimalInput(input) {
    if (PropertyRenderers && typeof PropertyRenderers.configureFreeDecimalInput === "function") return PropertyRenderers.configureFreeDecimalInput(input);
    if (Shared && typeof Shared.configureFreeDecimalInput === "function") return Shared.configureFreeDecimalInput(input);
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "decimal");
    input.removeAttribute("step");
  }

  function configureAmountInput(input) {
    if (PropertyRenderers && typeof PropertyRenderers.configureAmountInput === "function") return PropertyRenderers.configureAmountInput(input);
    if (Shared && typeof Shared.configureAmountInput === "function") return Shared.configureAmountInput(input);
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.removeAttribute("step");
    bindAmountInputMask(input);
  }

  function configureFormNumericUx(form, options = {}) {
    if (PropertyRenderers && typeof PropertyRenderers.configureFormNumericUx === "function") return PropertyRenderers.configureFormNumericUx(form, options);
    if (Shared && typeof Shared.configureFormNumericUx === "function") return Shared.configureFormNumericUx(form, options);
    if (!form?.elements) return;
    const decimalNames = Array.isArray(options.decimalNames) ? options.decimalNames : [];
    const amountNames = Array.isArray(options.amountNames) ? options.amountNames : [];
    decimalNames.forEach((name) => configureFreeDecimalInput(form.elements[name]));
    amountNames.forEach((name) => configureAmountInput(form.elements[name]));
  }

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function normalizeRole(value) {
    if (Shared && typeof Shared.normalizeRole === "function") return Shared.normalizeRole(value);
    const v = String(value || '').trim().toLowerCase();
    if (v === '관리자' || v === 'admin') return 'admin';
    if (v === '기타' || v === 'other') return 'other';
    return 'staff';
  }

  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function") ? window.KNSN.getApiBase() : "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const sharedApi = (Shared && typeof Shared.createApiClient === "function")
    ? Shared.createApiClient({
        baseUrl: API_BASE,
        loadSession,
        getAuthToken: async (options = {}) => {
          if (!options.auth) return "";
          if (isSupabaseMode() && K && typeof K.sbGetAccessToken === "function") {
            try {
              const token = await K.sbGetAccessToken();
              if (token) {
                state.session = loadSession() || state.session;
                return String(token).trim();
              }
            } catch {}
          }
          return String(state.session?.token || loadSession()?.token || "").trim();
        },
        ensureAuthToken: async (options = {}) => {
          if (!options.auth || !isSupabaseMode() || !K || typeof K.sbSyncLocalSession !== "function") return "";
          try { await K.sbSyncLocalSession(true); } catch {}
          state.session = loadSession() || state.session;
          return String(state.session?.token || "").trim();
        },
        handleUnauthorized: async ({ path, options }) => {
          if (!options.auth || !isSupabaseMode()) return false;
          try {
            if (K && typeof K.sbGetAccessToken === "function") {
              const nextToken = await K.sbGetAccessToken({ forceRefresh: true });
              if (nextToken) {
                state.session = loadSession() || state.session;
                return true;
              }
            }
            if (K && typeof K.sbSyncLocalSession === "function") {
              await K.sbSyncLocalSession(true);
              state.session = loadSession() || state.session;
              return !!state.session?.token;
            }
          } catch {}
          return false;
        },
        networkErrorFactory: (fetchErr) => {
          const detail = String(fetchErr?.message || "").trim();
          const err = new Error(detail ? `네트워크 연결 또는 서버 응답에 실패했습니다. (${detail})` : "네트워크 연결 또는 서버 응답에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          err.cause = fetchErr;
          return err;
        },
      })
    : null;

  const state = {
    session: loadSession(),
    activeTab: "home",
    properties: [],
    editingProperty: null,
    staff: [],
    propertyFilters: {
      activeCard: "",   // "" | "all" | "auction" | "onbid" | "realtor_naver" | "realtor_direct" | "general"
      status: "",
      keyword: "",
      assignee: "",
      area: "",         // "0-5" | "5-10" | ... | "50-"
      priceRange: "",   // "0-1" | "1-3" | ... | "20-"  (억 단위)
      ratio50: "",      // "50" = 50% 이하 (경매/공매만)
      todayBid: false,  // 오늘 주요일정 물건만 (D 버튼)
      favOnly: false,   // 담당자들이 ★로 선택한 물건만 (★ 버튼)
    },
    lastGroupSuggestion: null,
    selectedPropertyIds: new Set(),
    propertyPage: 1,
    propertyPageSize: 30,
    propertyMode: "page",
    propertyTotalCount: 0,
    propertySummary: null,
    propertyOverview: null,
    propertyOverviewFetchedAt: 0,
    propertyOverviewPromise: null,
    propertiesFullCache: null,
    propertySort: { key: '', direction: 'desc' },
    geocodeRunning: false,
    allFavoritePropertyIds: new Set(),  // 모든 담당자의 ★ property_id 집합 (관리자용)
  };

  const els = {};
  const loadingState = { activeKeys: new Set(), messages: new Map() };

  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};

  function callAdminModule(moduleKey, fnName, args) {
    const mod = AdminModules[moduleKey];
    if (!mod || typeof mod[fnName] !== "function") {
      const msg = `[admin-app] module not ready: ${moduleKey}.${fnName}`;
      console.error(msg);
      setGlobalMsg("관리자 화면 일부 스크립트가 누락되었습니다. 새로고침 후에도 같으면 배포 파일 연결을 확인해 주세요.");
      return undefined;
    }
    return mod[fnName](...(Array.isArray(args) ? args : []));
  }

  function exposeAdminRuntime() {
    window.KNSN_ADMIN_RUNTIME = {
      state,
      els,
      K,
      Shared,
      PropertyDomain,
      API_BASE,
      adminApi: api,
      isSupabaseMode,
      utils: {
        syncSupabaseSessionIfNeeded,
        normalizeStaff,
        dedupeStaff,
        normalizeProperty,
        hydrateAssignedAgentNames,
        renderSummary,
        setAdminLoading,
        renderPropertiesTable,
        setActiveTab,
        getActiveTab: () => state.activeTab,
        setFormBusy,
        showResultBox,
        setGlobalMsg,
        goLoginPage,
        handleAsyncError,
        setModalOpen,
        loadProperties,
        ensureAuxiliaryPropertiesForAdmin,
        getAuxiliaryPropertiesSnapshot,
        buildRegisterLogContext,
        getFilteredProperties,
        getPagedProperties,
        renderAdminPropertiesPagination,
        pruneSelectedPropertyIds,
        togglePropertySelection,
        toggleSelectAllProperties,
        updatePropertySelectionControls,
        buildRegistrationMatchKey,
        buildRegistrationSnapshotFromItem,
        buildRegistrationSnapshotFromDbRow,
        buildRegistrationDbRowForExisting,
        buildRegistrationDbRowForCreate,
        findExistingPropertyByRegistrationKey,
        normalizeRole,
        escapeHtml,
        escapeAttr,
        formatDate,
        toNumber,
        firstText,
        toNullableNumber,
        parseFlexibleDate,
        normalizeAddress,
        extractGuDong,
        normalizeStatus,
        sourceLabel,
        statusLabel,
        formatMoneyKRW,
        formatPercent,
        formatAreaPyeong,
        chunkArray,
        invalidatePropertyCollections,
        parseFlexibleNumber,
        formatMoneyInputValue,
        configureFormNumericUx,
        fetchPropertyDetail,
        insertPropertyRowResilient,
        updatePropertyRowResilient,
        getStaffNameById,
        loadRegistrationLog,
        renderRegistrationLog,
        loadOpinionHistory,
        renderOpinionHistory,
        renderCombinedPropertyLog,
        appendOpinionEntry,
        mergePropertyRaw,
        formatScheduleHtml,
        buildKakaoMapLink,
        isSupabaseMode,
        loadAllCoreData,
        renderAll,
        loadSession,
        saveSession,
        goLoginPage,
        setModalOpen,
        warmPropertyFullCacheForFilters,
      },
    };
    return window.KNSN_ADMIN_RUNTIME;
  }


  function isSupabaseMode() {
    return !!(K && typeof K.supabaseEnabled === "function" && K.supabaseEnabled() && K.initSupabase());
  }
  async function syncSupabaseSessionIfNeeded() {
    if (!isSupabaseMode()) return state.session;
    try {
      const synced = await K.sbSyncLocalSession();
      state.session = synced || loadSession();
      renderSessionUI();
    } catch {}
    return state.session;
  }

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheEls();
    exposeAdminRuntime();
    configureFormNumericUx(els.aemForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea", "latitude", "longitude"], amountNames: ["priceMain", "lowprice"] });
    configureFormNumericUx(els.newPropertyForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain"] });
    setupChrome();
    bindEvents();
    callAdminModule("shell", "bindEvents", []);
    callAdminModule("dashboard", "bindEvents", []);
    callAdminModule("newPropertyModal", "bindEvents", []);
    resetStaffForm();
    renderSessionUI();
    setActiveTab(state.activeTab);
    Promise.resolve(ensureLoginThenLoad()).catch((err) => handleAsyncError(err, "초기 로딩 실패"));
  }



  function setActiveTab(tab) {
    const next = String(tab || '').trim() || 'home';
    const panelMap = {
      home: els.tabHome,
      properties: els.tabProperties,
      csv: els.tabCsv,
      staff: els.tabStaff,
      regions: els.tabRegions,
      geocoding: els.tabGeocoding,
      workmgmt: els.tabWorkmgmt,
      buildings: els.tabBuildings,
      onbidSync: els.tabOnbidSync,
    };
    const active = panelMap[next] ? next : 'home';
    state.activeTab = active;

    if (els.adminTabs) {
      els.adminTabs.querySelectorAll('.tab').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.tab === active);
      });
    }

    Object.entries(panelMap).forEach(([key, el]) => {
      if (!el) return;
      el.classList.toggle('hidden', key !== active);
    });

    if (active === 'properties') {
      syncPropertySourceFilterUi();
    }

    if (active === 'onbidSync') {
      try {
        const mod = AdminModules.onbidSync;
        if (mod && typeof mod.initEvents === 'function') mod.initEvents();
        if (mod && typeof mod.loadOnbidSyncLogs === 'function') mod.loadOnbidSyncLogs().catch(() => {});
      } catch (e) { console.warn('onbidSync tab init failed', e); }
    }

    try {
      const shell = AdminModules.shell;
      if (shell && typeof shell.syncChromeForTab === 'function') shell.syncChromeForTab(active);
    } catch {}
  }

  function cacheEls() {
    Object.assign(els, {
      // top
      adminUserBadge: $("#adminUserBadge"),
      globalMsg: $("#globalMsg"),
      btnAdminLoginOpen: $("#btnAdminLoginOpen"),
      btnChangeMyPassword: $("#btnChangeMyPassword"),
      btnAdminLogout: $("#btnAdminLogout"),

      // login modal
      adminLoginModal: $("#adminLoginModal"),
      btnAdminLoginClose: $("#btnAdminLoginClose"),
      adminLoginForm: $("#adminLoginForm"),

      // password modal
      passwordChangeModal: $("#passwordChangeModal"),
      passwordChangeForm: $("#passwordChangeForm"),
      btnPwdModalClose: $("#pwdModalClose"),
      btnPwdCancel: $("#pwdCancel"),
      pwdMsg: $("#pwdMsg"),
      pwdSave: $("#pwdSave"),

      // tabs
      adminTabs: $("#adminTabs"),

      // summary
      sumTotal: $("#sumTotal"),
      sumAuction: $("#sumAuction"),
      sumGongmae: $("#sumGongmae"),
      sumNaverRealtor: $("#sumNaverRealtor"),
      sumDirectRealtor: $("#sumDirectRealtor"),
      sumGeneral: $("#sumGeneral"),
      sumAgents: $("#sumAgents"),
      sumAgentsCard: $("#sumAgentsCard"),
      summaryPanel: $("#summaryPanel"),
      tabsPanel: $("#tabsPanel"),

      // panels
      tabHome: $("#tab-home"),
      tabProperties: $("#tab-properties"),
      tabCsv: $("#tab-csv"),
      tabStaff: $("#tab-staff"),
      tabRegions: $("#tab-regions"),
      tabWorkmgmt: $("#tab-workmgmt"),

      // home/workmgmt
      sumTodayTotal: $("#sumTodayTotal"),
      sumTodayAuction: $("#sumTodayAuction"),
      sumTodayOnbid: $("#sumTodayOnbid"),
      sumTodayRealtor: $("#sumTodayRealtor"),
      sumTodayDirect: $("#sumTodayDirect"),
      sumTodayGeneral: $("#sumTodayGeneral"),
      sumTodayDetail: $("#sumTodayDetail"),
      homeGeoPending: $("#homeGeoPending"),
      homeProgressAuction: $("#homeProgressAuction"),
      homeProgressOnbid: $("#homeProgressOnbid"),
      homeProgressNaver: $("#homeProgressNaver"),
      homeProgressDirect: $("#homeProgressDirect"),
      homeProgressGeneral: $("#homeProgressGeneral"),
      adminGlobalSearch: $("#adminGlobalSearch"),
      topbarUserName: $("#topbarUserName"),
      adminLoadingOverlay: $("#adminLoadingOverlay"),
      adminLoadingLabel: $("#adminLoadingLabel"),
      workMgmtDate: $("#workMgmtDate"),
      btnWorkMgmtRefresh: $("#btnWorkMgmtRefresh"),
      workMgmtMeta: $("#workMgmtMeta"),
      workMgmtActors: $("#workMgmtActors"),
      workMgmtRows: $("#workMgmtRows"),
      workMgmtEmpty: $("#workMgmtEmpty"),

      // properties table
      btnDeleteSelectedProperties: $("#btnDeleteSelectedProperties"),
      btnDeleteAllProperties: $("#btnDeleteAllProperties"),
      propSelectAll: $("#propSelectAll"),
      propStatusFilter: $("#propStatusFilter"),
      propSourceFilter: $("#propSourceFilter"),
      propAssigneeFilter: $("#propAssigneeFilter"),
      propAreaFilter: $("#propAreaFilter"),
      propPriceFilter: $("#propPriceFilter"),
      propRatioFilter: $("#propRatioFilter"),
      propKeyword: $("#propKeyword"),
      propFavFilter: $("#propFavFilter"),
      propDayFilter: $("#propDayFilter"),
      propertiesTableBody: $("#propertiesTable tbody"),
      propertiesEmpty: $("#propertiesEmpty"),
      adminPropertiesPagination: $("#adminPropertiesPagination"),

      // CSV import
      csvImportSource: $("#csvImportSource"),
      csvFileInput: $("#csvFileInput"),
      btnCsvUpload: $("#btnCsvUpload"),
      csvResultBox: $("#csvResultBox"),

      // staff
      staffForm: $("#staffForm"),
      staffFormHint: $("#staffFormHint"),
      btnStaffSave: $("#btnStaffSave"),
      btnStaffReset: $("#btnStaffReset"),
      staffTableBody: $("#staffTable tbody"),
      staffEmpty: $("#staffEmpty"),

      // property assignment (물건 배정)
      assignStatusBody: $("#assignStatusBody"),
      assignStatusEmpty: $("#assignStatusEmpty"),
      assignSidoFilter: $("#assignSidoFilter"),
      assignGuFilter: $("#assignGuFilter"),
      assignDongFilter: $("#assignDongFilter"),
      assignSourceFilter: $("#assignSourceFilter"),
      assignAreaFilter: $("#assignAreaFilter"),
      assignPriceFilter: $("#assignPriceFilter"),
      assignAgentFilter: $("#assignAgentFilter"),
      assignFilterTotal: $("#assignFilterTotal"),
      assignFilterSummary: $("#assignFilterSummary"),
      btnAutoAssign: $("#btnAutoAssign"),
      autoAssignStatus: $("#autoAssignStatus"),
      autoAssignResult: $("#autoAssignResult"),

      // assignment batch history (배정 이력)
      assignHistoryList: $("#assignHistoryList"),
      assignHistoryEmpty: $("#assignHistoryEmpty"),
      btnAssignHistoryRefresh: $("#btnAssignHistoryRefresh"),

      // auto-assign preview modal
      assignPreviewModal: $("#assignPreviewModal"),
      assignPreviewSummary: $("#assignPreviewSummary"),
      assignPreviewAgents: $("#assignPreviewAgents"),
      assignPreviewFilters: $("#assignPreviewFilters"),
      btnAssignPreviewConfirm: $("#btnAssignPreviewConfirm"),

      // property edit modal
      propertyEditModalAdmin: $("#propertyEditModalAdmin"),
      aemClose: $("#aemClose"),
      aemCancel: $("#aemCancel"),
      aemForm: $("#aemForm"),
      aemSave: $("#aemSave"),
      aemDelete: $("#aemDelete"),
      aemMsg: $("#aemMsg"),
      aemHistoryList: $("#aemHistoryList"),
      aemRegistrationLogList: $("#aemRegistrationLogList"),
      aemTabs: $$("#aemForm [data-aem-tab]"),
      aemSections: $$("#aemForm [data-aem-section-page]"),

      // geocoding tab
      tabGeocoding: $("#tab-geocoding"),
      geocodePending: $("#geocodePending"),
      geocodeOk: $("#geocodeOk"),
      geocodeFailed: $("#geocodeFailed"),
      geocodeProgress: $("#geocodeProgress"),
      geocodeProgressBar: $("#geocodeProgressBar"),
      geocodeRunningText: $("#geocodeRunningText"),
      btnGeocodeRun: $("#btnGeocodeRun"),
      btnGeocodeRetryFailed: $("#btnGeocodeRetryFailed"),
      geoStatPending: $("#geoStatPending"),
      geoStatOk: $("#geoStatOk"),
      geoStatFailed: $("#geoStatFailed"),
      geocodeListWrap: $("#geocodeListWrap"),
      geocodeListTitle: $("#geocodeListTitle"),
      geocodeListBody: $("#geocodeListBody"),
      geocodeListEmpty: $("#geocodeListEmpty"),

      // buildings tab
      tabBuildings: $("#tab-buildings"),

      // onbid sync tab
      tabOnbidSync: $("#tab-onbidSync"),
      btnOnbidSyncStart: $("#btnOnbidSyncStart"),
      btnOnbidSyncRefreshLogs: $("#btnOnbidSyncRefreshLogs"),
      onbidSyncMaxItems: $("#onbidSyncMaxItems"),
      onbidSyncStatus: $("#onbidSyncStatus"),
      onbidSyncResult: $("#onbidSyncResult"),
      onbidSyncLogsBody: $("#onbidSyncLogsBody"),
      onbidSyncLogsEmpty: $("#onbidSyncLogsEmpty"),

      // new property modal
      btnNewProperty: $("#btnNewProperty"),
      newPropertyModal: $("#newPropertyModal"),
      npmClose: $("#npmClose"),
      npmCancel: $("#npmCancel"),
      newPropertyForm: $("#newPropertyForm"),
      npmSave: $("#npmSave"),
      npmMsg: $("#npmMsg"),
      npmRealtorFields: $("#npmRealtorFields"),
      npmOwnerFields: $("#npmOwnerFields"),

    });
  }


  function setupChrome() {
    return callAdminModule("shell", "setupChrome", []);
  }

  
  function setModalOpen(open) {
    document.body.classList.toggle("modal-open", !!open);
  }

  function openPasswordChangeModal() {
    if (!els.passwordChangeModal) return;
    if (!isSupabaseMode()) {
      alert("Supabase 인증에서만 비밀번호 변경이 가능합니다.");
      return;
    }
    if (els.passwordChangeForm) els.passwordChangeForm.reset();
    setPwdMsg("");
    if (PropertyRenderers && typeof PropertyRenderers.setModalVisibility === 'function') {
      PropertyRenderers.setModalVisibility(els.passwordChangeModal, true, { bodyClass: 'modal-open' });
      return;
    }
    setModalOpen(true);
    els.passwordChangeModal.classList.remove("hidden");
    els.passwordChangeModal.setAttribute("aria-hidden", "false");
  }

  function closePasswordChangeModal() {
    if (!els.passwordChangeModal) return;
    if (PropertyRenderers && typeof PropertyRenderers.setModalVisibility === 'function') {
      PropertyRenderers.setModalVisibility(els.passwordChangeModal, false, { bodyClass: 'modal-open' });
    } else {
      els.passwordChangeModal.classList.add("hidden");
      els.passwordChangeModal.setAttribute("aria-hidden", "true");
      setModalOpen(false);
    }
    setPwdMsg("");
  }

  function setPwdMsg(text, isError = true) {
    if (!els.pwdMsg) return;
    if (PropertyRenderers && typeof PropertyRenderers.setTextMessage === 'function') {
      PropertyRenderers.setTextMessage(els.pwdMsg, text, { isError, hiddenClass: '', resetStyle: true });
      return;
    }
    els.pwdMsg.style.color = isError ? "#ff8b8b" : "#9ff0b6";
    els.pwdMsg.textContent = text || "";
  }

  async function changeMyPassword() {
    if (!isSupabaseMode()) throw new Error("Supabase 인증에서만 비밀번호 변경이 가능합니다.");
    const fd = new FormData(els.passwordChangeForm);
    const newPassword = String(fd.get("newPassword") || "");
    const confirmPassword = String(fd.get("confirmPassword") || "");

    if (newPassword.length < 8) {
      setPwdMsg("비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg("새 비밀번호와 확인 값이 일치하지 않습니다.");
      return;
    }

    const sb = K.initSupabase();
    if (!sb) throw new Error("Supabase가 설정되지 않았습니다.");

    if (els.pwdSave) els.pwdSave.disabled = true;
    setPwdMsg("");
    try {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPwdMsg("비밀번호가 변경되었습니다.", false);
      window.setTimeout(() => closePasswordChangeModal(), 500);
    } catch (err) {
      setPwdMsg(err?.message || "비밀번호 변경 실패");
    } finally {
      if (els.pwdSave) els.pwdSave.disabled = false;
    }
  }

  function setGlobalMsg(msg = "") {
    if (!els.globalMsg) return;
    if (PropertyRenderers && typeof PropertyRenderers.setTextMessage === 'function') {
      PropertyRenderers.setTextMessage(els.globalMsg, msg, { isError: true, applyColor: false });
      return;
    }
    const m = String(msg || "").trim();
    els.globalMsg.textContent = m;
    els.globalMsg.classList.toggle("hidden", !m);
  }

  function setAdminLoading(key, active, text = "데이터를 불러오는 중입니다.") {
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
    const currentText = visible
      ? String(loadingState.messages.get(Array.from(loadingState.activeKeys).slice(-1)[0]) || text || "데이터를 불러오는 중입니다.")
      : "데이터를 불러오는 중입니다.";
    if (els.adminLoadingLabel) els.adminLoadingLabel.textContent = currentText;
    els.adminLoadingOverlay.classList.toggle("hidden", !visible);
    els.adminLoadingOverlay.setAttribute("aria-busy", visible ? "true" : "false");
  }

  function setPropertyFiltersLoading(loading) {
    const filterEls = [els.propSourceFilter, els.propAssigneeFilter, els.propAreaFilter, els.propPriceFilter, els.propRatioFilter];
    filterEls.forEach((el) => {
      if (!el) return;
      el.style.opacity = loading ? '0.5' : '';
      el.style.pointerEvents = loading ? 'none' : '';
    });
  }

  function handleAsyncError(err, fallbackMsg = "요청 처리 중 오류가 발생했습니다.") {
    console.error(err);
    if (err?.code === "LOGIN_REQUIRED" || err?.status === 401) {
      setGlobalMsg("로그인이 필요합니다. 다시 로그인해 주세요.");
      goLoginPage(true);
      return;
    }
    alert(toUserErrorMessage(err, fallbackMsg));
  }

function bindEvents() {
    document.querySelectorAll('[data-keep-session-link="true"]').forEach((el) => {
      el.addEventListener('click', () => {
        try {
          if (K && typeof K.setKeepSessionOnce === 'function') K.setKeepSessionOnce();
          else sessionStorage.setItem('knson_nav_keep_session', '1');
        } catch {}
      }, { capture: true });
    });

    // auth / password
    if (els.btnChangeMyPassword) els.btnChangeMyPassword.addEventListener("click", openPasswordChangeModal);

    if (els.passwordChangeModal) {
      els.passwordChangeModal.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.close === "true") closePasswordChangeModal();
      });
    }
    if (els.btnPwdModalClose) els.btnPwdModalClose.addEventListener("click", closePasswordChangeModal);
    if (els.btnPwdCancel) els.btnPwdCancel.addEventListener("click", closePasswordChangeModal);
    if (els.passwordChangeForm) {
      els.passwordChangeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        changeMyPassword().catch(() => {});
      });
    }

    // tabs
    if (els.adminTabs) {
      els.adminTabs.addEventListener("click", async (e) => {
        const btn = e.target.closest(".tab");
        if (!btn) return;

        await syncSupabaseSessionIfNeeded();

        const key = btn.dataset.tab;
        const prevTab = state.activeTab;
        const user = state.session?.user;
        if (user?.role !== "admin" && key !== "properties") {
          setGlobalMsg("관리자 권한이 확인되지 않았습니다. 다시 로그인해 주세요.");
          return;
        }
        setGlobalMsg("");
        setActiveTab(key);

        if (state.session?.user?.role === "admin") {
          if (key === "home") {
            if (!state.propertyOverview) {
              loadProperties({ refreshSummary: true }).catch((e)=>handleAsyncError(e,"대시보드 로드 실패"));
            } else {
              renderSummary();
            }
          }
          if (key === "properties" && (prevTab !== "properties" || !Array.isArray(state.properties) || !state.properties.length || state.propertyMode !== "page")) {
            loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
          }
          if (key === "staff") {
            loadStaff().catch((e)=>handleAsyncError(e,"담당자 로드 실패"));
            // 배정 물건수 카운팅을 위해 전체 물건 스냅샷도 확보
            ensureAuxiliaryPropertiesForAdmin()
              .then(() => { renderStaffTable(); })
              .catch((e) => handleAsyncError(e, "물건 스냅샷 로드 실패"));
          }
          if (key === "regions") {
            loadStaff().catch(()=>{});
            ensureAuxiliaryPropertiesForAdmin().then(() => { refreshAssignmentView(); }).catch((e)=>handleAsyncError(e,"물건 배정 데이터 로드 실패"));
            // 배정 이력도 같이 로드
            try {
              const mod = (window.KNSN_ADMIN_MODULES && window.KNSN_ADMIN_MODULES.staffRegions) || null;
              if (mod && typeof mod.loadAssignmentHistory === 'function') mod.loadAssignmentHistory().catch(()=>{});
            } catch (_) {}
          }
          if (key === "geocoding") {
            // 탭 진입 시 카운팅(대기/완료/실패) 로드 동안 로딩 오버레이 표시
            setAdminLoading("geocoding", true, "지오코딩 현황을 불러오는 중입니다.");
            ensureAuxiliaryPropertiesForAdmin()
              .then(() => { updateGeocodeStatusBar(); })
              .catch((e) => handleAsyncError(e, "지오코딩 데이터 로드 실패"))
              .finally(() => { setAdminLoading("geocoding", false); });
          }
          if (key === "workmgmt") refreshWorkMgmt().catch((e)=>handleAsyncError(e,"업무 관리 로드 실패"));
          if (key === "buildings") { var bldMod = window.KNSN_ADMIN_MODULES?.buildingsTab; if (bldMod && typeof bldMod.init === "function") bldMod.init(); }
        }
      });
    }


    // properties
    if (els.btnDeleteSelectedProperties) els.btnDeleteSelectedProperties.addEventListener("click", () => {
      deleteSelectedProperties().catch((e)=>handleAsyncError(e,"삭제 실패"));
    });
    if (els.btnDeleteAllProperties) els.btnDeleteAllProperties.addEventListener("click", () => {
      deleteAllProperties().catch((e)=>handleAsyncError(e,"전체삭제 실패"));
    });
    if (els.propSelectAll) els.propSelectAll.addEventListener("change", (e) => {
      toggleSelectAllProperties(!!e.target.checked);
    });

    // 요약 카드 클릭 → 필터 (단일 토글)
    document.querySelectorAll(".summary-card[data-card]").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.card || "";
        const current = Array.isArray(state.propertyFilters.activeCard) ? state.propertyFilters.activeCard : [];
        const next = current.length === 1 && current[0] === key ? [] : (key ? [key] : []);
        state.propertyFilters.activeCard = next;
        // 다중 선택 UI 체크 상태 동기화
        const checks = window.KNSN_ADMIN_MODULES?.propertiesTab?._getPropMultiCheckboxes?.('propSourceFilter');
        if (Array.isArray(checks)) {
          checks.forEach(function(item) { item.cb.checked = next.includes(item.value); });
        }
        window.KNSN_ADMIN_MODULES?.propertiesTab?._syncPropMultiAllCheckbox?.('propSourceFilter');
        syncPropertySourceFilterUi();
        state.propertyPage = 1;
        loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
      });
    });

    // propSourceFilter, propAreaFilter, propPriceFilter, propRatioFilter는 다중 선택으로 전환
    // → admin-tab-properties.js의 initPropMultiSelectFilters()에서 이벤트 바인딩
    if (els.propAssigneeFilter) els.propAssigneeFilter.addEventListener("change", (e) => {
      state.propertyFilters.assignee = String(e.target.value || "");
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });

    if (els.propStatusFilter) els.propStatusFilter.addEventListener("change", (e) => {
      state.propertyFilters.status = String(e.target.value || "");
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });
    if (els.propKeyword) els.propKeyword.addEventListener("input", debounce((e) => {
      state.propertyFilters.keyword = String(e.target.value || "").toLowerCase();
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    }, 150));

    // ★ 버튼: 담당자들이 즐겨찾기(★) 한 물건만 보기
    if (els.propFavFilter) els.propFavFilter.addEventListener("click", async () => {
      const turningOn = !state.propertyFilters.favOnly;
      state.propertyFilters.favOnly = turningOn;
      els.propFavFilter.classList.toggle("is-active", state.propertyFilters.favOnly);
      state.propertyPage = 1;
      // 켜질 때 최신 즐겨찾기 목록 동기화 (다른 담당자의 ★ 변경 반영)
      if (turningOn) {
        try { await loadAllFavoritePropertyIds(); } catch (e) { console.warn('favorites load failed', e); }
      }
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });

    // D 버튼: 주요일정이 오늘인 경매/공매 물건만 보기
    if (els.propDayFilter) els.propDayFilter.addEventListener("click", () => {
      state.propertyFilters.todayBid = !state.propertyFilters.todayBid;
      els.propDayFilter.classList.toggle("is-active", state.propertyFilters.todayBid);
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });

    // CSV import (관리자만)
    if (els.btnCsvUpload) els.btnCsvUpload.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return alert("CSV 업로드는 관리자만 가능합니다.");
      handleCsvUpload().catch((e)=>handleAsyncError(e,"업로드 실패"));
    });

    // staff/regions (관리자만)
    if (els.staffForm) els.staffForm.addEventListener("submit", (e) => {
      if (state.session?.user?.role !== "admin") return;
      handleSaveStaff(e);
    });
    if (els.btnStaffReset) els.btnStaffReset.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      resetStaffForm();
    });

    if (els.btnAutoAssign) els.btnAutoAssign.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      handleAutoAssign().catch((e)=>handleAsyncError(e,"자동 배정 실패"));
    });
    // 물건 배정 필터 이벤트는 admin-tab-staff-regions.js의 initMultiSelectFilters()에서 바인딩

    // property edit modal
    if (els.propertyEditModalAdmin) {
      els.propertyEditModalAdmin.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.close === "true") closePropertyEditModal();
      });
    }
    if (els.aemClose) els.aemClose.addEventListener("click", closePropertyEditModal);
    if (els.aemCancel) els.aemCancel.addEventListener("click", closePropertyEditModal);
    if (els.aemTabs?.length) {
      els.aemTabs.forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = String(btn.dataset.aemTab || "basic").trim() || "basic";
          AdminModules.propertiesTab?.setAdminEditSection?.(key);
        });
      });
    }
    if (els.aemForm) {
      els.aemForm.addEventListener("submit", (e) => {
        e.preventDefault();
        savePropertyEditModal();
      });
    }
    if (els.aemDelete) els.aemDelete.addEventListener("click", () => {
      handleDeleteProperty().catch((e)=>handleAsyncError(e,"삭제 실패"));
    });

    // 신규 물건 등록 모달
    if (els.btnNewProperty) els.btnNewProperty.addEventListener("click", openNewPropertyModal);

    // geocoding
    if (els.btnGeocodeRun) els.btnGeocodeRun.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      runGeocoding(false).catch((e) => handleAsyncError(e, "지오코딩 실패"));
    });
    if (els.btnGeocodeRetryFailed) els.btnGeocodeRetryFailed.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      runGeocoding(true).catch((e) => handleAsyncError(e, "지오코딩 재시도 실패"));
    });

    // 지오코딩 통계 카드 클릭 → 해당 물건 리스트
    ["geoStatPending", "geoStatOk", "geoStatFailed"].forEach((elKey) => {
      if (els[elKey]) {
        els[elKey].addEventListener("click", () => {
          const filter = els[elKey].dataset.geoFilter;
          ensureAuxiliaryPropertiesForAdmin().then(() => { renderGeocodeList(filter); }).catch((e)=>handleAsyncError(e, "지오코딩 데이터 로드 실패"));
        });
      }
    });
  }

  async function ensureLoginThenLoad() {
    const out = callAdminModule("shell", "ensureLoginThenLoad", []);
    return out instanceof Promise ? await out : out;
  }

  function syncPropertySourceFilterUi() {
    const raw = state.propertyFilters?.activeCard;
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    document.querySelectorAll(".summary-card[data-card]").forEach((card) => {
      card.classList.toggle("is-active", arr.length === 1 && card.dataset.card === arr[0]);
    });
  }

  async function warmPropertyFullCacheForFilters() {
    if (normalizeRole(state.session?.user?.role) !== "admin") return;
    if (Array.isArray(state.propertiesFullCache) && state.propertiesFullCache.length) {
      if (state.activeTab === "properties") renderPropertiesTable();
      return;
    }
    if (!isSupabaseMode()) return;
    const sb = K.initSupabase();
    if (!sb) return;
    const synced = await syncSupabaseSessionIfNeeded().catch(() => state.session);
    const currentSession = synced || state.session || loadSession() || null;
    if (currentSession) state.session = currentSession;
    const user = currentSession?.user || null;
    const uid = String(user?.id || "").trim();
    await ensureFullPropertiesCache(sb, { isAdmin: true, uid, forceRefresh: false });
    if (state.activeTab === "properties") renderPropertiesTable();
  }

  function renderSessionUI() {
    return callAdminModule("shell", "renderSessionUI", []);
  }

  function openLoginModal() {
    return callAdminModule("shell", "openLoginModal", []);
  }

  function closeLoginModal() {
    return callAdminModule("shell", "closeLoginModal", []);
  }

  async function onSubmitAdminLogin(e) {
    const out = callAdminModule("shell", "onSubmitAdminLogin", [e]);
    return out instanceof Promise ? await out : out;
  }

  async function logout() {
    const out = callAdminModule("shell", "logout", []);
    return out instanceof Promise ? await out : out;
  }

  async function loadAllCoreData() {
    try {
      const user = state.session?.user;
      const isAdmin = normalizeRole(user?.role) === "admin";

      if (isAdmin) {
        const [staffResult, propsResult] = await Promise.allSettled([
          loadStaff(),
          loadProperties(),
        ]);

        if (staffResult.status === "rejected") {
          console.warn("초기 담당자 로드 실패", staffResult.reason);
        }
        if (propsResult.status === "rejected") {
          throw propsResult.reason;
        }
        return;
      }

      await loadProperties();
    } catch (err) {
      console.error(err);
      // 인증 문제는 팝업으로 괴롭히지 말고 로그인 모달로 유도
      if (err?.code === "LOGIN_REQUIRED" || err?.status === 401) {
        try { state.session = loadSession(); } catch {}
        renderSessionUI();
        goLoginPage(true);
        setGlobalMsg("세션이 만료되었거나 인증이 필요합니다. 다시 로그인해 주세요.");
        return;
      }
      alert(err?.message || "데이터 로드 실패");
    }
  }

  function rowAssignedToUid(row, uid) {
    const target = String(uid || '').trim();
    if (!target) return false;
    const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
    return [row?.assignee_id, row?.assigneeId, row?.assignedAgentId, raw.assignee_id, raw.assigneeId, raw.assignedAgentId]
      .some((v) => String(v || '').trim() === target);
  }

  const PROPERTY_LIST_SELECT = [
    "id", "global_id", "item_no", "source_type", "source_url", "is_general", "address", "assignee_id",
    "submitter_type", "broker_office_name", "submitter_name", "submitter_phone",
    "asset_type", "floor", "total_floor", "common_area", "exclusive_area", "site_area", "use_approval",
    "status", "price_main", "lowprice", "date_main", "rights_analysis", "site_inspection",
    "memo", "latitude", "longitude", "date_uploaded", "created_at", "raw",
    "geocode_status", "geocoded_at"
  ].join(",");

  const PROPERTY_HOME_SUMMARY_SELECT = [
    "id", "source_type", "source_url", "is_general", "submitter_type", "submitter_name",
    "broker_office_name", "date_uploaded", "created_at", "raw"
  ].join(",");

  function invalidatePropertyCollections() {
    state.propertiesFullCache = null;
    state.homeSummarySnapshot = null;
    state.propertySummary = null;
    state.propertyOverview = null;
  }

  function getAuxiliaryPropertiesSnapshot() {
    if (Array.isArray(state.propertiesFullCache) && state.propertiesFullCache.length) return state.propertiesFullCache;
    if (Array.isArray(state.homeSummarySnapshot) && state.homeSummarySnapshot.length) return state.homeSummarySnapshot;
    return state.properties;
  }

  function hasActivePropertyFilters() {
    const f = state.propertyFilters || {};
    const toArr = (v) => Array.isArray(v) ? v : (v ? [String(v)] : []);
    return !!(
      toArr(f.activeCard).filter(Boolean).length ||
      String(f.status || '').trim() ||
      String(f.assignee || '').trim() ||
      String(f.keyword || '').trim() ||
      toArr(f.area).filter(Boolean).length ||
      toArr(f.priceRange).filter(Boolean).length ||
      toArr(f.ratio50).filter(Boolean).length ||
      !!f.todayBid ||
      !!f.favOnly
    );
  }

  function hasLocalOnlyPropertyFilters() {
    const f = state.propertyFilters || {};
    const toArr = (v) => Array.isArray(v) ? v : (v ? [String(v)] : []);
    return !!(
      String(f.assignee || '').trim() ||
      String(f.keyword || '').trim() ||
      toArr(f.area).filter(Boolean).length ||
      toArr(f.priceRange).filter(Boolean).length ||
      toArr(f.ratio50).filter(Boolean).length ||
      !!f.todayBid ||   // D 버튼: dateMain 매칭은 DB select 에 필터 없음 → 로컬 처리
      !!f.favOnly       // ★ 버튼: user_favorites 조인 없음 → 로컬 처리
    );
  }

  function getServerBackedPropertyFilters() {
    const f = state.propertyFilters || {};
    const raw = f.activeCard;
    const activeCard = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : '') : String(raw || '').trim();
    return {
      activeCard,
      status: String(f.status || '').trim(),
    };
  }

  function shouldUseFullPropertyDataset() {
    return hasLocalOnlyPropertyFilters();
  }

  // 모든 담당자의 ★ property_id 집합을 조회해 state.allFavoritePropertyIds 에 캐시.
  // 관리자 페이지의 ★ 필터 (favOnly) 에서 사용.
  async function loadAllFavoritePropertyIds() {
    try {
      const res = await api('/admin/properties?mode=all_favorites', { auth: true });
      const ids = Array.isArray(res?.propertyIds) ? res.propertyIds : [];
      state.allFavoritePropertyIds = new Set(ids.map((v) => String(v || '')).filter(Boolean));
      return state.allFavoritePropertyIds;
    } catch (err) {
      console.warn('loadAllFavoritePropertyIds failed', err);
      // 실패해도 기존 캐시 유지
      return state.allFavoritePropertyIds || new Set();
    }
  }

  async function fetchPropertiesPageLight(sb, page, pageSize, { isAdmin, uid }) {
    if (DataAccess && typeof DataAccess.fetchPropertiesPageLight === "function") {
      return DataAccess.fetchPropertiesPageLight(sb, page, pageSize, {
        isAdmin,
        uid,
        select: PROPERTY_LIST_SELECT,
        filters: getServerBackedPropertyFilters(),
        totalFallback: isAdmin && !hasActivePropertyFilters() ? Number(state.propertySummary?.total || 0) : 0,
      });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchPropertiesPageLight 를 찾을 수 없습니다.");
  }

  async function fetchAllPropertiesLight(sb, { isAdmin, uid }) {
    if (DataAccess && typeof DataAccess.fetchAllProperties === "function") {
      return DataAccess.fetchAllProperties(sb, {
        isAdmin,
        uid,
        select: PROPERTY_LIST_SELECT,
        pageSize: 1000,
        filters: getServerBackedPropertyFilters(),
      });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchAllProperties 를 찾을 수 없습니다.");
  }

  async function ensureFullPropertiesCache(sb, { isAdmin, uid, forceRefresh = false } = {}) {
    if (!forceRefresh && Array.isArray(state.propertiesFullCache)) return state.propertiesFullCache;
    const rows = await fetchAllPropertiesLight(sb, { isAdmin, uid });
    state.propertiesFullCache = Array.isArray(rows) ? rows.map(normalizeProperty) : [];
    return state.propertiesFullCache;
  }

  function buildPropertySummaryFromRows(rows) {
    if (PropertyDomain && typeof PropertyDomain.summarizeSourceBuckets === "function") {
      return PropertyDomain.summarizeSourceBuckets(rows);
    }
    const cached = Array.isArray(rows) ? rows : [];
    const summary = {
      total: cached.length,
      auction: 0,
      onbid: 0,
      realtor_naver: 0,
      realtor_direct: 0,
      general: 0,
    };
    for (const item of cached) {
      const type = String(item?.sourceType || '').trim();
      if (type === 'auction') summary.auction += 1;
      else if (type === 'onbid') summary.onbid += 1;
      else if (type === 'realtor') {
        if (item?.isDirectSubmission) summary.realtor_direct += 1;
        else summary.realtor_naver += 1;
      } else if (type === 'general') summary.general += 1;
    }
    return summary;
  }

  function appendSummaryBucket(summary, item) {
    if (!summary || !item) return summary;
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === "function") {
      const bucket = PropertyDomain.getSourceBucket(item);
      summary.total = Number(summary.total || 0) + 1;
      if (bucket && Object.prototype.hasOwnProperty.call(summary, bucket)) {
        summary[bucket] = Number(summary[bucket] || 0) + 1;
      }
      return summary;
    }
    const type = String(item?.sourceType || '').trim();
    summary.total += 1;
    if (type === 'auction') summary.auction += 1;
    else if (type === 'onbid') summary.onbid += 1;
    else if (type === 'realtor') {
      if (item?.isDirectSubmission) summary.realtor_direct += 1;
      else summary.realtor_naver += 1;
    } else if (type === 'general') summary.general += 1;
    return summary;
  }

  async function fetchExactHomeSummary(sb) {
    if (DataAccess && typeof DataAccess.fetchExactHomeSummary === "function") {
      return DataAccess.fetchExactHomeSummary(sb, { normalizeRow: normalizeProperty, pageSize: 1000 });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchExactHomeSummary 를 찾을 수 없습니다.");
  }

  async function fetchPropertySummary(sb) {
    if (DataAccess && typeof DataAccess.fetchPropertySummary === "function") {
      return DataAccess.fetchPropertySummary(sb, {
        cachedRows: Array.isArray(state.propertiesFullCache) && state.propertiesFullCache.length ? state.propertiesFullCache : null,
        normalizeRow: normalizeProperty,
      });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchPropertySummary 를 찾을 수 없습니다.");
  }

  function buildOverviewFromSummary(summary) {
    const safe = summary && typeof summary === 'object' ? summary : {};
    return {
      summary: {
        total: Number(safe.total || 0),
        auction: Number(safe.auction || 0),
        onbid: Number(safe.onbid || 0),
        realtor_naver: Number(safe.realtor_naver || 0),
        realtor_direct: Number(safe.realtor_direct || 0),
        general: Number(safe.general || 0),
      },
      today: {
        total: Number(safe?.today?.total || 0),
        auction: Number(safe?.today?.auction || 0),
        onbid: Number(safe?.today?.onbid || 0),
        realtor: Number(safe?.today?.realtor || 0),
        realtor_naver: Number(safe?.today?.realtor_naver || 0),
        realtor_direct: Number(safe?.today?.realtor_direct || 0),
        general: Number(safe?.today?.general || 0),
      },
      geoPending: Number(safe?.geoPending || safe?.geo_pending || 0),
      filterCounts: safe?.filterCounts && typeof safe.filterCounts === 'object' ? safe.filterCounts : null,
      generatedAt: safe?.generatedAt || safe?.generated_at || new Date().toISOString(),
      fallback: true,
    };
  }

  const OVERVIEW_AREA_OPTIONS = ['', '0-5', '5-10', '10-20', '20-30', '30-50', '50-100', '100-'];
  const OVERVIEW_PRICE_OPTIONS = ['', '0-1', '1-3', '3-5', '5-10', '10-20', '20-'];
  const OVERVIEW_RATIO_OPTIONS = ['', '50'];

  function getOverviewAreaMatch(value, area) {
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = parseFloat(minStr) || 0;
    const max = maxStr ? parseFloat(maxStr) : Infinity;
    const numericArea = Number(area);
    if (!Number.isFinite(numericArea) || numericArea <= 0) return false;
    return numericArea >= min && (max === Infinity || numericArea < max);
  }

  function getOverviewCurrentPriceValue(row) {
    if (PropertyDomain && typeof PropertyDomain.getCurrentPriceValue === 'function') {
      return Number(PropertyDomain.getCurrentPriceValue(row) || 0) || 0;
    }
    if (!row || row.lowprice == null || row.lowprice === '') return Number(row?.priceMain || row?.price_main || 0) || 0;
    return Number(row.lowprice || row.low_price || 0) || 0;
  }

  function getOverviewPriceMatch(value, row) {
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = (parseFloat(minStr) || 0) * 100000000;
    const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
    const sourceType = String(row?.sourceType || row?.source_type || '').trim();
    const isAuctionType = sourceType === 'auction' || sourceType === 'onbid';
    const price = isAuctionType ? getOverviewCurrentPriceValue(row) : (Number(row?.priceMain || row?.price_main || 0) || 0);
    if (!price || price <= 0) return false;
    return price >= min && (max === Infinity || price < max);
  }

  function getOverviewRatioMatch(value, row) {
    if (!value) return true;
    const sourceType = String(row?.sourceType || row?.source_type || '').trim();
    if (sourceType !== 'auction' && sourceType !== 'onbid') return false;
    const appraisal = Number(row?.priceMain || row?.price_main || 0) || 0;
    const current = getOverviewCurrentPriceValue(row);
    if (!appraisal || appraisal <= 0 || !current || current <= 0) return false;
    return (current / appraisal) <= 0.5;
  }

  function createEmptyOverview() {
    return {
      summary: { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 },
      today: { total: 0, auction: 0, onbid: 0, realtor: 0, realtor_naver: 0, realtor_direct: 0, general: 0 },
      geoPending: 0,
      filterCounts: {
        source: { '': 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 },
        area: { '': 0, '0-5': 0, '5-10': 0, '10-20': 0, '20-30': 0, '30-50': 0, '50-100': 0, '100-': 0 },
        price: { '': 0, '0-1': 0, '1-3': 0, '3-5': 0, '5-10': 0, '10-20': 0, '20-': 0 },
        ratio: { '': 0, '50': 0 },
      },
      generatedAt: new Date().toISOString(),
      fallback: true,
    };
  }

  function appendRowToOverview(overview, row) {
    const normalized = normalizeProperty(row);
    const bucket = PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function'
      ? PropertyDomain.getSourceBucket(normalized)
      : (normalized.sourceType === 'realtor' ? (normalized.isDirectSubmission ? 'realtor_direct' : 'realtor_naver') : String(normalized.sourceType || 'general'));
    overview.summary.total += 1;
    if (Object.prototype.hasOwnProperty.call(overview.summary, bucket)) overview.summary[bucket] += 1;
    overview.filterCounts.source[''] += 1;
    if (Object.prototype.hasOwnProperty.call(overview.filterCounts.source, bucket)) overview.filterCounts.source[bucket] += 1;

    overview.filterCounts.area[''] += 1;
    OVERVIEW_AREA_OPTIONS.slice(1).forEach((value) => {
      if (getOverviewAreaMatch(value, normalized?.exclusivearea)) overview.filterCounts.area[value] += 1;
    });

    overview.filterCounts.price[''] += 1;
    OVERVIEW_PRICE_OPTIONS.slice(1).forEach((value) => {
      if (getOverviewPriceMatch(value, normalized)) overview.filterCounts.price[value] += 1;
    });

    overview.filterCounts.ratio[''] += 1;
    OVERVIEW_RATIO_OPTIONS.slice(1).forEach((value) => {
      if (getOverviewRatioMatch(value, normalized)) overview.filterCounts.ratio[value] += 1;
    });

    const rawCreatedAt = normalized?.createdAt || normalized?._raw?.created_at || normalized?._raw?.date_uploaded || normalized?._raw?.raw?.firstRegisteredAt || normalized?._raw?.raw?.createdAt || '';
    const d = new Date(rawCreatedAt);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;
      const now = new Date();
      const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (dateKey === todayKey) {
        overview.today.total += 1;
        if (bucket === 'auction') overview.today.auction += 1;
        else if (bucket === 'onbid') overview.today.onbid += 1;
        else if (bucket === 'general') overview.today.general += 1;
        else if (bucket === 'realtor_naver' || bucket === 'realtor_direct') overview.today.realtor += 1;
      }
    }

    const status = String(normalized?.geocodeStatus || normalized?._raw?.geocode_status || '').trim().toLowerCase();
    const lat = normalized?.latitude ?? normalized?._raw?.latitude;
    const lng = normalized?.longitude ?? normalized?._raw?.longitude;
    const hasCoords = lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '';
    const address = String(normalized?.address || normalized?._raw?.address || '').trim();
    if (!hasCoords && address && status !== 'failed' && status !== 'ok') overview.geoPending += 1;
  }

  function buildOverviewFromRows(rows) {
    const overview = createEmptyOverview();
    (Array.isArray(rows) ? rows : []).forEach((row) => appendRowToOverview(overview, row));
    return overview;
  }

  function isOverviewSummaryComplete(summary) {
    if (!summary || typeof summary !== 'object') return false;
    const total = Number(summary.total || 0);
    const subtotal = Number(summary.auction || 0) + Number(summary.onbid || 0) + Number(summary.realtor_naver || 0) + Number(summary.realtor_direct || 0) + Number(summary.general || 0);
    return total > 0 && subtotal === total;
  }

  async function fetchBrowserOverviewCounts(sb) {
    if (!sb) return null;
    try {
      if (DataAccess && typeof DataAccess.fetchBrowserOverviewCounts === "function") {
        return await DataAccess.fetchBrowserOverviewCounts(sb);
      }
      if (DataAccess && typeof DataAccess.fetchExactHomeSummary === "function") {
        const summary = await DataAccess.fetchExactHomeSummary(sb, { normalizeRow: normalizeProperty, pageSize: 1000 });
        if (summary && typeof summary === 'object') {
          const overview = createEmptyOverview();
          overview.summary.total = Number(summary.total || 0);
          overview.summary.auction = Number(summary.auction || 0);
          overview.summary.onbid = Number(summary.onbid || 0);
          overview.summary.realtor_naver = Number(summary.realtor_naver || 0);
          overview.summary.realtor_direct = Number(summary.realtor_direct || 0);
          overview.summary.general = Number(summary.general || 0);
          overview.filterCounts.source[''] = overview.summary.total;
          overview.filterCounts.source.auction = overview.summary.auction;
          overview.filterCounts.source.onbid = overview.summary.onbid;
          overview.filterCounts.source.realtor_naver = overview.summary.realtor_naver;
          overview.filterCounts.source.realtor_direct = overview.summary.realtor_direct;
          overview.filterCounts.source.general = overview.summary.general;
          overview.generatedAt = new Date().toISOString();
          return overview;
        }
      }
      if (DataAccess && typeof DataAccess.fetchAllProperties === "function") {
        const rows = await DataAccess.fetchAllProperties(sb, {
          isAdmin: true,
          uid: '',
          select: '*',
          pageSize: 1000,
          filters: null,
        });
        const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeProperty).filter(Boolean);
        if (normalizedRows.length) return buildOverviewFromRows(normalizedRows);
      }
    } catch (err) {
      console.warn('browser overview exact-count fallback failed', err);
    }
    return null;
  }

  async function fetchBrowserOverviewFallback(sb) {
    if (!sb) return null;
    try {
      if (DataAccess && typeof DataAccess.fetchBrowserOverviewFallback === "function") {
        return await DataAccess.fetchBrowserOverviewFallback(sb);
      }
      if (DataAccess && typeof DataAccess.fetchAllProperties === "function") {
        const rows = await DataAccess.fetchAllProperties(sb, {
          isAdmin: true,
          uid: '',
          select: '*',
          pageSize: 1000,
          filters: null,
        });
        const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeProperty).filter(Boolean);
        if (normalizedRows.length) return buildOverviewFromRows(normalizedRows);
      }
    } catch (err) {
      console.warn('browser overview fallback failed', err);
    }
    return null;
  }

  function normalizeOverviewPayload(res) {
    const candidate = (res?.overview && typeof res.overview === 'object')
      ? res.overview
      : (res && typeof res === 'object' ? res : null);
    if (!candidate || typeof candidate !== 'object') return null;

    if (candidate.summary && typeof candidate.summary === 'object') {
      return {
        summary: {
          total: Number(candidate.summary.total || 0),
          auction: Number(candidate.summary.auction || 0),
          onbid: Number(candidate.summary.onbid || 0),
          realtor_naver: Number(candidate.summary.realtor_naver || 0),
          realtor_direct: Number(candidate.summary.realtor_direct || 0),
          general: Number(candidate.summary.general || 0),
        },
        today: {
          total: Number(candidate?.today?.total || 0),
          auction: Number(candidate?.today?.auction || 0),
          onbid: Number(candidate?.today?.onbid || 0),
          realtor: Number(candidate?.today?.realtor || 0),
          realtor_naver: Number(candidate?.today?.realtor_naver || 0),
          realtor_direct: Number(candidate?.today?.realtor_direct || 0),
          general: Number(candidate?.today?.general || 0),
        },
        geoPending: Number(candidate?.geoPending || candidate?.geo_pending || 0),
        filterCounts: candidate?.filterCounts && typeof candidate.filterCounts === 'object' ? candidate.filterCounts : null,
        generatedAt: candidate?.generatedAt || candidate?.generated_at || new Date().toISOString(),
      };
    }

    const hasRootSummary = ['total', 'auction', 'onbid', 'realtor_naver', 'realtor_direct', 'general'].some((key) => Object.prototype.hasOwnProperty.call(candidate, key));
    if (hasRootSummary) return buildOverviewFromSummary(candidate);

    if (Array.isArray(candidate.items)) {
      const rows = candidate.items.map(normalizeProperty);
      state.homeSummarySnapshot = rows.slice();
      return buildOverviewFromRows(rows);
    }

    return null;
  }

  async function fetchAdminPropertyOverview({ forceRefresh = false, sb = null } = {}) {
    const now = Date.now();
    if (!forceRefresh && state.propertyOverview && (now - Number(state.propertyOverviewFetchedAt || 0) < 10000)) {
      return state.propertyOverview;
    }
    if (state.propertyOverviewPromise) return state.propertyOverviewPromise;

    state.propertyOverviewPromise = (async () => {
      const cacheBust = Date.now();
      let overview = null;
      try {
        let res = null;
        if (DataAccess && typeof DataAccess.fetchPropertyOverviewViaApi === 'function') {
          res = await DataAccess.fetchPropertyOverviewViaApi(api, { cacheBust, auth: true });
        } else {
          res = await api(`/admin/properties?mode=overview&_ts=${cacheBust}`, { auth: true });
        }
        overview = normalizeOverviewPayload(res);
      } catch (err) {
        console.warn('server overview request failed', err);
      }

      if (sb && !isOverviewSummaryComplete(overview?.summary)) {
        try {
          const exactOverview = await fetchBrowserOverviewCounts(sb);
          if (exactOverview?.summary && Number(exactOverview.summary.total || 0) >= 0) {
            overview = {
              ...(overview && typeof overview === 'object' ? overview : {}),
              ...exactOverview,
              filterCounts: {
                ...(overview?.filterCounts && typeof overview.filterCounts === 'object' ? overview.filterCounts : {}),
                ...(exactOverview?.filterCounts && typeof exactOverview.filterCounts === 'object' ? exactOverview.filterCounts : {}),
              },
            };
          }
        } catch (err) {
          console.warn('browser overview exact-count fallback failed', err);
        }
      } else if ((!overview || !overview.summary || Number(overview.summary.total || 0) <= 0) && sb) {
        try {
          const browserOverview = await fetchBrowserOverviewFallback(sb);
          if (browserOverview?.summary && Number(browserOverview.summary.total || 0) > 0) {
            overview = browserOverview;
          }
        } catch (err) {
          console.warn('browser overview fallback failed', err);
        }
      }

      if (!overview || !overview.summary) {
        throw new Error('대시보드 집계 응답 형식이 올바르지 않습니다.');
      }

      state.propertyOverview = overview;
      state.propertySummary = overview.summary;
      state.propertyOverviewFetchedAt = Date.now();
      return overview;
    })();

    try {
      return await state.propertyOverviewPromise;
    } finally {
      state.propertyOverviewPromise = null;
    }
  }

  async function fetchPropertyDetail(sb, targetId) {
    if (DataAccess && typeof DataAccess.fetchPropertyDetail === "function") {
      return DataAccess.fetchPropertyDetail(sb, targetId, { select: "*", normalizeRow: normalizeProperty });
    }
    throw new Error("KNSN_DATA_ACCESS.fetchPropertyDetail 를 찾을 수 없습니다.");
  }

  async function fetchPropertiesBatch(sb, from, pageSize, { isAdmin, uid }) {
    const page = Math.floor(Math.max(0, Number(from || 0)) / Math.max(1, Number(pageSize || 1))) + 1;
    const { items } = await fetchPropertiesPageLight(sb, page, pageSize, { isAdmin, uid });
    return Array.isArray(items) ? items : [];
  }

  async function fetchAllPropertiesPaged(sb, { isAdmin, uid }) {
    return fetchAllPropertiesLight(sb, { isAdmin, uid });
  }

  async function loadProperties(options = {}) {
    const refreshSummary = options.refreshSummary !== false;
    const forceFull = !!options.forceFull;
    const forceRefreshFull = !!options.forceRefreshFull;
    const silent = !!options.silent;
    const loadingText = state.activeTab === "home"
      ? "대시보드 데이터를 불러오는 중입니다."
      : "물건 리스트를 불러오는 중입니다.";

    if (!silent) setAdminLoading("properties", true, loadingText);
    if (!silent) setPropertyFiltersLoading(true);
    try {
      // Supabase가 설정되어 있으면 Supabase DB를 우선 사용합니다.
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;

      if (sb) {
      const synced = await syncSupabaseSessionIfNeeded().catch(() => state.session);
      const currentSession = synced || loadSession() || state.session || null;
      if (currentSession) state.session = currentSession;

      const user = currentSession?.user || null;
      const uid = String(user?.id || "").trim();
      const isAdmin = user?.role === "admin";

      if (!isAdmin && !uid) {
        state.properties = [];
        state.propertyMode = 'page';
        state.propertyTotalCount = 0;
        renderPropertiesTable();
        renderSummary();
        return;
      }

      const needsFull = forceFull || shouldUseFullPropertyDataset() || state.activeTab === 'regions' || state.activeTab === 'geocoding' || state.activeTab === 'workmgmt';
      const shouldLoadOverview = isAdmin && (refreshSummary || !state.propertySummary || !state.propertyOverview);
      const overviewPromise = shouldLoadOverview
        ? fetchAdminPropertyOverview({ forceRefresh: refreshSummary || !state.propertyOverview, sb }).catch((err) => {
            console.warn('property overview load failed', err);
            return state.propertyOverview;
          })
        : Promise.resolve(state.propertyOverview);

      if (state.activeTab === 'home' && !needsFull && isAdmin) {
        const overview = await overviewPromise;
        if (overview?.summary) {
          state.propertyOverview = overview;
          state.propertySummary = overview.summary;
          state.propertyTotalCount = Number(overview.summary.total || 0);
        }
        state.properties = [];
        state.propertyMode = 'page';
        pruneSelectedPropertyIds();
        renderSummary();
        return;
      }

      if (needsFull) {
        const data = await ensureFullPropertiesCache(sb, { isAdmin, uid, forceRefresh: forceRefreshFull });
        state.properties = Array.isArray(data) ? data.slice() : [];
        state.propertyMode = 'full';
        state.propertyTotalCount = state.properties.length;
      } else {
        let pageData = await fetchPropertiesPageLight(sb, state.propertyPage, state.propertyPageSize, { isAdmin, uid });
        const maxPage = Math.max(1, Math.ceil(Number(pageData?.total || 0) / state.propertyPageSize));
        if (state.propertyPage > maxPage) {
          state.propertyPage = maxPage;
          pageData = await fetchPropertiesPageLight(sb, state.propertyPage, state.propertyPageSize, { isAdmin, uid });
        }
        state.properties = Array.isArray(pageData?.items) ? pageData.items.map(normalizeProperty) : [];
        state.propertyMode = 'page';
        state.propertyTotalCount = Number(pageData?.total || 0);
      }

      const overview = await overviewPromise;
      if (overview?.summary) {
        state.propertyOverview = overview;
        state.propertySummary = overview.summary;
        if (state.propertyMode === 'page' && !hasActivePropertyFilters() && !String(state?.propertySort?.key || '').trim()) {
          state.propertyTotalCount = Number(overview.summary.total || state.propertyTotalCount || 0);
        }
      }
      pruneSelectedPropertyIds();
      hydrateAssignedAgentNames();
      renderPropertiesTable();
      if (isAdmin && state.propertyMode === "page" && !Array.isArray(state.propertiesFullCache)) { Promise.resolve().then(() => warmPropertyFullCacheForFilters()).catch(() => {}); }
      renderSummary();
      if (state.activeTab === 'geocoding') updateGeocodeStatusBar();
      if (state.activeTab === 'home') renderSummary();
      return;
    }

    const user = state.session?.user || null;
    const isAdmin = user?.role === "admin";
    const scope = isAdmin ? "all" : "mine";
    const res = await DataAccess.fetchScopedPropertiesViaApi(api, { scope, auth: true });
    state.properties = Array.isArray(res?.items) ? res.items.map(normalizeProperty) : [];
    state.propertyMode = 'full';
    state.propertyTotalCount = state.properties.length;
    pruneSelectedPropertyIds();
    hydrateAssignedAgentNames();
    renderPropertiesTable();
    renderSummary();
    updateGeocodeStatusBar();
    if (state.activeTab === "workmgmt") refreshWorkMgmt().catch((e)=>handleAsyncError(e,"업무 관리 로드 실패"));
    } finally {
      if (!silent) setAdminLoading("properties", false);
      if (!silent) setPropertyFiltersLoading(false);
    }
  }


  async function ensureAuxiliaryPropertiesForAdmin(options = {}) {
    const sb = isSupabaseMode() ? K.initSupabase() : null;
    if (!sb) return getAuxiliaryPropertiesSnapshot();
    const user = state.session?.user || loadSession()?.user || null;
    const uid = String(user?.id || '').trim();
    const isAdmin = user?.role === 'admin';
    return ensureFullPropertiesCache(sb, { isAdmin, uid, forceRefresh: !!options.forceRefresh });
  }
  async function loadStaff(...args) {
    return callAdminModule("staffRegions", "loadStaff", args);
  }

  function normalizeProperty(item) {
    const base = (PropertyDomain && typeof PropertyDomain.buildNormalizedPropertyBase === "function")
      ? PropertyDomain.buildNormalizedPropertyBase(item)
      : null;
    if (!base) return item;

    const opinionText = base.sourceType === "onbid"
      ? ((PropertyDomain && typeof PropertyDomain.sanitizeOnbidOpinion === "function")
          ? PropertyDomain.sanitizeOnbidOpinion(base.opinion, base.memo, base.address)
          : base.opinion)
      : base.opinion;

    return {
      id: base.id,
      globalId: base.globalId,
      sourceType: base.sourceType,
      itemNo: base.itemNo,
      isGeneral: base.isGeneral,
      address: base.address,
      sourceNoteLabel: base.sourceNoteLabel,
      sourceNoteText: base.sourceNoteText,
      assetType: base.assetType,
      floor: base.floor,
      totalfloor: base.totalfloor,
      priceMain: base.priceMain,
      lowprice: base.lowprice,
      status: base.status,
      latitude: base.latitude,
      longitude: base.longitude,
      assignedAgentId: base.assignedAgentId || null,
      assignedAgentName: base.assignedAgentId ? base.assignedAgentName : "",
      createdAt: base.createdAt,
      duplicateFlag: base.duplicateFlag,
      regionGu: base.regionGu,
      regionDong: base.regionDong,
      memo: base.memo,
      exclusivearea: base.exclusivearea,
      commonarea: base.commonarea,
      sitearea: base.sitearea,
      useapproval: base.useapproval,
      dateMain: base.dateMain,
      sourceUrl: base.sourceUrl,
      submitterType: base.submitterType,
      realtorname: base.realtorname,
      realtorphone: base.realtorphone,
      realtorcell: base.realtorcell,
      rightsAnalysis: base.rightsAnalysis,
      siteInspection: base.siteInspection,
      opinion: opinionText,
      geocodeStatus: base.geocodeStatus,
      geocodedAt: base.geocodedAt,
      isDirectSubmission: base.isDirectSubmission,
      _raw: item,
    };
  }

  function normalizePropertyDuplicateError(err) {
    if (!isPropertyDuplicateError(err)) return err;
    const normalized = new Error("동일 물건이 이미 등록되어 있습니다");
    normalized.code = "PROPERTY_DUPLICATE";
    normalized.cause = err;
    return normalized;
  }

  async function insertPropertyRowResilient(sb, row) {
    if (DataAccess && typeof DataAccess.insertPropertyRowResilient === "function") {
      return DataAccess.insertPropertyRowResilient(sb, row, { select: "id", maxRetries: 16 });
    }
    throw new Error("KNSN_DATA_ACCESS.insertPropertyRowResilient 를 찾을 수 없습니다.");
  }

  async function updatePropertyRowResilient(sb, targetId, patch) {
    if (DataAccess && typeof DataAccess.updatePropertyRowResilient === "function") {
      return DataAccess.updatePropertyRowResilient(sb, targetId, patch, { select: "id", maxRetries: 16 });
    }
    throw new Error("KNSN_DATA_ACCESS.updatePropertyRowResilient 를 찾을 수 없습니다.");
  }

  function openNewPropertyModal(...args) {
    return callAdminModule("newPropertyModal", "openNewPropertyModal", args);
  }

    async function submitNewProperty(...args) {
    return callAdminModule("newPropertyModal", "submitNewProperty", args);
  }

  function normalizeStaff(item) {
    if (PropertyDomain && typeof PropertyDomain.normalizeStaffMember === "function") {
      return PropertyDomain.normalizeStaffMember(item);
    }
    return {
      id: item.id || "",
      email: item.email || "",
      name: item.name || item.email || "",
      position: String(item.position || item.jobTitle || item.job_title || "").trim(),
      phone: String(item.phone || item.mobile || item.mobile_phone || item.phone_number || "").trim(),
      role: normalizeRole(item.role),
      assignedRegions: Array.isArray(item.assignedRegions)
        ? item.assignedRegions
        : (Array.isArray(item.assigned_regions) ? item.assigned_regions : []),
      createdAt: item.createdAt || item.created_at || "",
      lastSignInAt: item.lastSignInAt || item.last_sign_in_at || "",
    };
  }

  function dedupeStaff(items) {
    if (PropertyDomain && typeof PropertyDomain.dedupeStaffMembers === "function") {
      return PropertyDomain.dedupeStaffMembers(items);
    }
    const seenIds = new Set();
    const seenEmails = new Set();
    const out = [];

    for (const raw of Array.isArray(items) ? items : []) {
      const item = normalizeStaff(raw);
      const idKey = String(item.id || "").trim();
      const emailKey = String(item.email || "").trim().toLowerCase();
      if (idKey && seenIds.has(idKey)) continue;
      if (emailKey && seenEmails.has(emailKey)) continue;
      if (idKey) seenIds.add(idKey);
      if (emailKey) seenEmails.add(emailKey);
      out.push(item);
    }

    return out;
  }

  function getStaffNameById(id) {
    const key = String(id || "").trim();
    if (!key) return "";
    return state.staff.find((s) => String(s.id) === key)?.name || "";
  }

  function hydrateAssignedAgentNames() {
    state.properties = state.properties.map((p) => ({
      ...p,
      assignedAgentName: p.assignedAgentName || getStaffNameById(p.assignedAgentId),
    }));
  }

  // ---------------------------
  // Summary / Render
  // ---------------------------
  function renderAll() {
    renderPropertiesTable();
    renderStaffTable();
    refreshAssignmentView();
    renderSummary();
  }

  function renderSummary(...args) {
    return callAdminModule("dashboard", "renderSummary", args);
  }
  async function refreshWorkMgmt(...args) {
    return callAdminModule("dashboard", "refreshWorkMgmt", args);
  }
  function getFilteredProperties(...args) {
    return callAdminModule("propertiesTab", "getFilteredProperties", args);
  }
  function getPagedProperties(...args) {
    return callAdminModule("propertiesTab", "getPagedProperties", args);
  }


  // ---------------------------
  // Registration Log 유틸
  // ---------------------------
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
    priceMain: "감정가(매매가)",
    lowprice: "현재가격",
    dateMain: "주요일정",
    sourceUrl: "원문링크",
    realtorName: "중개사무소명",
    realtorPhone: "유선전화",
    realtorCell: "휴대폰번호",
    submitterName: "등록자명",
    assigneeName: "담당자",
    latitude: "위도",
    longitude: "경도",
  };

  function hasMeaningfulValue(value) {
    if (PropertyDomain && typeof PropertyDomain.hasMeaningfulValue === "function") return PropertyDomain.hasMeaningfulValue(value);
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  }

  function formatRegLogAt(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    }
    return s.replace("T", " ").slice(0, 16);
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

  function normalizeCompareValue(field, value) {
    if (PropertyDomain && typeof PropertyDomain.normalizeCompareValue === "function") {
      return PropertyDomain.normalizeCompareValue(field, value, {
        numericFields: ["priceMain", "lowprice", "commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"],
      });
    }
    if (value === null || value === undefined) return "";
    if (["priceMain", "lowprice", "commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"].includes(field)) {
      const n = toNullableNumber(value);
      return n == null ? "" : String(n);
    }
    return String(value).trim().replace(/\s+/g, " ");
  }

  function formatFieldValueForLog(field, value) {
    if (PropertyDomain && typeof PropertyDomain.formatFieldValueForLog === "function") {
      return PropertyDomain.formatFieldValueForLog(field, value, {
        amountFields: ["priceMain", "lowprice"],
        numericFields: ["commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"],
      });
    }
    if (value === null || value === undefined) return "";
    if (["priceMain", "lowprice"].includes(field)) {
      const n = toNullableNumber(value);
      return n == null ? "" : Number(n).toLocaleString("ko-KR");
    }
    if (["commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"].includes(field)) {
      const n = toNullableNumber(value);
      if (n == null) return "";
      return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    }
    return String(value).trim();
  }

  function parseFloorNumberForLog(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    let m = s.match(/^(?:B|b|지하)\s*(\d+)$/);
    if (m) return `b${m[1]}`;
    m = s.match(/(-?\d+)/);
    return m ? String(Number(m[1])) : "";
  }

  function compactAddressText(value) {
    return String(value || "").trim().replace(/\s+/g, "");
  }

  function parseAddressIdentityParts(address) {
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
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationMatchKey === "function") {
      return PropertyDomain.buildRegistrationMatchKey(data);
    }
    const parts = parseAddressIdentityParts(firstText(data?.address, data?.raw?.address, ""));
    const floorKey = parseFloorNumberForLog(firstText(data?.floor, data?.raw?.floor, "")) || "0";
    const hoKey = extractHoNumberForLog(data) || "0";
    if (!parts.dong || !parts.mainNo) return "";
    return `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey}|${hoKey}`;
  }

  function attachRegistrationIdentity(raw, data) {
    if (PropertyDomain && typeof PropertyDomain.attachRegistrationIdentity === "function") {
      return PropertyDomain.attachRegistrationIdentity(raw, data);
    }
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
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationSnapshot === "function") {
      return PropertyDomain.buildRegistrationSnapshot(item);
    }
    const raw = item?._raw?.raw || {};
    return {
      itemNo: firstText(item?.itemNo, raw.itemNo, ""),
      address: firstText(item?.address, raw.address, ""),
      assetType: firstText(item?.assetType, raw.assetType, raw["세부유형"], ""),
      floor: firstText(item?.floor, raw.floor, ""),
      totalfloor: firstText(item?.totalfloor, raw.totalfloor, raw.total_floor, raw.totalFloor, ""),
      commonArea: item?.commonarea ?? raw.commonArea ?? raw.commonarea ?? null,
      exclusiveArea: item?.exclusivearea ?? raw.exclusiveArea ?? raw.exclusivearea ?? null,
      siteArea: item?.sitearea ?? raw.siteArea ?? raw.sitearea ?? null,
      useapproval: firstText(item?.useapproval, raw.useapproval, raw.useApproval, ""),
      status: firstText(item?.status, raw.status, ""),
      priceMain: item?.priceMain ?? raw.priceMain ?? null,
      lowprice: item?.lowprice ?? raw.lowprice ?? null,
      dateMain: firstText(item?.dateMain, raw.dateMain, ""),
      sourceUrl: firstText(item?.sourceUrl, raw.sourceUrl, ""),
      realtorName: firstText(item?.realtorname, raw.realtorName, raw.realtorname, item?._raw?.broker_office_name, item?._raw?.brokerOfficeName, ""),
      realtorPhone: firstText(item?.realtorphone, raw.realtorPhone, raw.realtorphone, ""),
      realtorCell: firstText(item?.realtorcell, raw.realtorCell, raw.realtorcell, item?._raw?.submitter_phone, item?._raw?.submitterPhone, ""),
      submitterName: firstText(raw.registeredByName, item?._raw?.registeredByName, item?._raw?.submitter_name, item?._raw?.submitterName, raw.submitterName, raw.submitter_name, ""),
      assigneeName: firstText(item?.assignedAgentName, item?.assigneeName, item?._raw?.assignee_name, raw.assigneeName, raw.assignedAgentName, raw.assignee_name, ""),
      memo: firstText(item?.memo, item?.opinion, raw.memo, raw.opinion, ""),
      latitude: item?.latitude ?? raw.latitude ?? null,
      longitude: item?.longitude ?? raw.longitude ?? null,
    };
  }

  function buildRegistrationSnapshotFromDbRow(row) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationSnapshot === "function") {
      return PropertyDomain.buildRegistrationSnapshot(row);
    }
    const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
    return {
      itemNo: firstText(row?.item_no, row?.itemNo, raw.itemNo, ""),
      address: firstText(row?.address, raw.address, ""),
      assetType: firstText(row?.asset_type, row?.assetType, raw.assetType, raw["세부유형"], ""),
      floor: firstText(raw.floor, row?.floor, ""),
      totalfloor: firstText(raw.totalfloor, row?.total_floor, row?.totalfloor, ""),
      commonArea: row?.common_area ?? row?.commonArea ?? raw.commonArea ?? null,
      exclusiveArea: row?.exclusive_area ?? row?.exclusiveArea ?? raw.exclusiveArea ?? null,
      siteArea: row?.site_area ?? row?.siteArea ?? raw.siteArea ?? null,
      useapproval: firstText(row?.use_approval, raw.useapproval, raw.useApproval, ""),
      status: firstText(row?.status, raw.status, ""),
      priceMain: row?.price_main ?? row?.priceMain ?? raw.priceMain ?? null,
      lowprice: row?.lowprice ?? row?.low_price ?? raw.lowprice ?? null,
      dateMain: firstText(row?.date_main, row?.dateMain, raw.dateMain, ""),
      sourceUrl: firstText(row?.source_url, row?.sourceUrl, raw.sourceUrl, ""),
      realtorName: firstText(row?.broker_office_name, raw.realtorName, raw.realtorname, ""),
      realtorPhone: firstText(raw.realtorPhone, raw.realtorphone, ""),
      realtorCell: firstText(row?.submitter_phone, raw.realtorCell, raw.realtorcell, raw.submitterPhone, raw.submitter_phone, ""),
      submitterName: firstText(raw.registeredByName, row?.submitter_name, raw.submitterName, raw.submitter_name, ""),
      assigneeName: firstText(row?.assignee_name, row?.assigneeName, raw.assigneeName, raw.assignedAgentName, raw.assignee_name, ""),
      memo: firstText(row?.memo, raw.memo, raw.opinion, ""),
      latitude: row?.latitude ?? raw.latitude ?? null,
      longitude: row?.longitude ?? raw.longitude ?? null,
      raw,
      addressRaw: firstText(row?.address, raw.address, ""),
    };
  }

  function buildRegistrationChanges(prevSnapshot, nextSnapshot) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationChanges === "function") {
      return PropertyDomain.buildRegistrationChanges(prevSnapshot, nextSnapshot, REG_LOG_LABELS, {
        amountFields: ["priceMain", "lowprice"],
        numericFields: ["priceMain", "lowprice", "commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"],
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

  function loadRegistrationLog(item) {
    if (PropertyDomain && typeof PropertyDomain.loadRegistrationLog === "function") {
      return PropertyDomain.loadRegistrationLog(item, { defaultRoute: "최초 등록" });
    }
    const raw = item?._raw?.raw || {};
    if (Array.isArray(raw.registrationLog) && raw.registrationLog.length) return raw.registrationLog;
    const createdAt = firstText(raw.firstRegisteredAt, item?.createdAt, item?._raw?.created_at, item?._raw?.createdAt, "");
    if (!createdAt) return [];
    return [{ type: "created", at: createdAt, route: "최초 등록", actor: "" }];
  }

  function appendRegistrationCreateLog(raw, context) {
    if (PropertyDomain && typeof PropertyDomain.ensureRegistrationCreatedLog === "function") {
      return PropertyDomain.ensureRegistrationCreatedLog(raw, context);
    }
    const nextRaw = { ...(raw || {}) };
    const firstAt = firstText(nextRaw.firstRegisteredAt, context?.at, new Date().toISOString());
    const current = Array.isArray(nextRaw.registrationLog) ? nextRaw.registrationLog.slice() : [];
    if (!current.length) {
      current.push({ type: "created", at: firstAt, route: context?.route || "등록", actor: context?.actor || "" });
    }
    nextRaw.firstRegisteredAt = firstAt;
    nextRaw.registrationLog = current;
    return nextRaw;
  }

  function appendRegistrationChangeLog(raw, context, changes) {
    if (PropertyDomain && typeof PropertyDomain.appendRegistrationLog === "function") {
      return PropertyDomain.appendRegistrationLog(raw, context, changes);
    }
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
        numericFields: ["priceMain", "lowprice", "commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"],
        copyFields: ["address","asset_type","exclusive_area","common_area","site_area","use_approval","status","price_main","lowprice","date_main","source_url","broker_office_name","submitter_name","submitter_phone","memo","latitude","longitude","floor","total_floor","assignee_id","assignee_name"],
        assignIfEmpty: !!options.assignIfEmpty,
      });
    }
    const base = existingItem?._raw ? { ...existingItem._raw, raw: { ...(existingItem._raw.raw || {}) } } : { ...(incomingRow || {}), raw: { ...(incomingRow?.raw || {}) } };
    const prevSnapshot = existingItem?._raw ? buildRegistrationSnapshotFromItem(existingItem) : buildRegistrationSnapshotFromDbRow(base);
    const nextSnapshot = buildRegistrationSnapshotFromDbRow(incomingRow);
    const changes = buildRegistrationChanges(prevSnapshot, nextSnapshot);
    const nextRow = { ...base };
    ["address","asset_type","exclusive_area","common_area","site_area","use_approval","status","price_main","lowprice","date_main","source_url","broker_office_name","submitter_name","submitter_phone","memo","latitude","longitude","floor","total_floor","assignee_id","assignee_name"].forEach((key) => {
      if (hasMeaningfulValue(incomingRow?.[key])) nextRow[key] = incomingRow[key];
    });
    if (!hasMeaningfulValue(nextRow.item_no) && hasMeaningfulValue(incomingRow?.item_no)) nextRow.item_no = incomingRow.item_no;
    if (!hasMeaningfulValue(nextRow.source_type) && hasMeaningfulValue(incomingRow?.source_type)) nextRow.source_type = incomingRow.source_type;
    if (hasMeaningfulValue(incomingRow?.assignee_id)) nextRow.assignee_id = incomingRow.assignee_id;
    else if (options.assignIfEmpty && !hasMeaningfulValue(nextRow.assignee_id) && hasMeaningfulValue(incomingRow?.assignee_id)) nextRow.assignee_id = incomingRow.assignee_id;
    const mergedRaw = mergeMeaningfulShallow(base.raw || {}, incomingRow?.raw || {});
    if (hasMeaningfulValue(incomingRow?.assignee_id)) {
      mergedRaw.assigneeId = incomingRow.assignee_id;
      mergedRaw.assignee_id = incomingRow.assignee_id;
    }
    if (hasMeaningfulValue(incomingRow?.assignee_name)) {
      mergedRaw.assigneeName = incomingRow.assignee_name;
      mergedRaw.assignedAgentName = incomingRow.assignee_name;
      mergedRaw.assignee_name = incomingRow.assignee_name;
    }
    nextRow.raw = attachRegistrationIdentity(appendRegistrationChangeLog(mergedRaw, context, changes), nextSnapshot);
    return { row: nextRow, changes };
  }

  function buildRegistrationDbRowForCreate(row, context) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationDbRowForCreate === "function") {
      return PropertyDomain.buildRegistrationDbRowForCreate(row, context);
    }
    return {
      ...(row || {}),
      raw: attachRegistrationIdentity(appendRegistrationCreateLog(row?.raw || {}, context), row),
    };
  }

  function findExistingPropertyByRegistrationKey(data, items, ignoreId = "") {
    const targetKey = buildRegistrationMatchKey(data);
    if (!targetKey) return null;
    const ignore = String(ignoreId || "").trim();
    for (const item of Array.isArray(items) ? items : []) {
      const currentId = String(item?.id || item?.globalId || "").trim();
      if (ignore && currentId === ignore) continue;
      if (buildRegistrationMatchKey(buildRegistrationSnapshotFromItem(item)) === targetKey) return item;
    }
    return null;
  }

  function renderRegistrationLog(container, history) {
    if (!container) return;
    const list = Array.isArray(history) ? history : [];
    if (!list.length) {
      container.innerHTML = '<div class="history-empty">등록 LOG가 없습니다.</div>';
      return;
    }
    const reversed = list.slice().reverse();
    container.innerHTML = `<div class="reglog-list">${reversed.map((entry) => {
      const atText = formatRegLogAt(entry.at || entry.date || "");
      const routeText = String(entry.route || '').trim();
      const actorText = String(entry.actor || '').trim();
      const meta = `
        <div class="reglog-meta" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;">
          ${atText ? `<span class="reglog-chip" style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#f5f6f8;color:#475467;font-size:12px;font-weight:700;">${esc(atText)}</span>` : ''}
          ${routeText ? `<span class="reglog-chip is-route" style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#fff4e8;color:#b54708;font-size:12px;font-weight:700;">${esc(routeText)}</span>` : ''}
          ${actorText ? `<span class="reglog-chip is-actor" style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#eef4ff;color:#175cd3;font-size:12px;font-weight:700;">${esc(actorText)}</span>` : ''}
        </div>`;
      if (entry.type === "created") {
        return `<div class="reglog-item" style="padding:12px 14px;border:1px solid #eaecf0;border-radius:14px;background:#ffffff;box-shadow:0 1px 2px rgba(16,24,40,.04);margin-bottom:10px;">
          ${meta}
          <div class="reglog-summary" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="reglog-badge" style="display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;background:#ecfdf3;color:#027a48;font-size:12px;font-weight:800;">최초 등록</span>
            <span style="color:#667085;font-size:13px;">물건이 처음 등록되었습니다.</span>
          </div>
        </div>`;
      }
      const changes = (Array.isArray(entry.changes) ? entry.changes : []).filter((change) => change?.field !== "submitterPhone" && change?.label !== "등록자 연락처");
      const rows = changes.length
        ? `<div class="reglog-changes" style="display:flex;flex-direction:column;gap:8px;">${changes.map((change) => `<div class="reglog-change-row" style="display:grid;grid-template-columns:minmax(84px,120px) minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:start;padding:10px 12px;border-radius:12px;background:#f8fafc;">
              <span class="reglog-label" style="font-size:12px;font-weight:800;color:#344054;">${esc(change.label || "")}</span>
              <span class="reglog-before" style="min-width:0;color:#667085;font-size:13px;word-break:break-word;">${esc(change.before || "-")}</span>
              <span class="reglog-sep" style="color:#98a2b3;font-weight:800;">→</span>
              <span class="reglog-after" style="min-width:0;color:#101828;font-size:13px;font-weight:700;word-break:break-word;">${esc(change.after || "-")}</span>
            </div>`).join("")}</div>`
        : `<div class="reglog-summary" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="reglog-badge" style="display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;background:#f2f4f7;color:#344054;font-size:12px;font-weight:800;">변경 없음</span>
            <span style="color:#667085;font-size:13px;">저장되었지만 변경 항목은 없습니다.</span>
          </div>`;
      return `<div class="reglog-item" style="padding:12px 14px;border:1px solid #eaecf0;border-radius:14px;background:#ffffff;box-shadow:0 1px 2px rgba(16,24,40,.04);margin-bottom:10px;">
        ${meta}
        ${rows}
      </div>`;
    }).join("")}</div>`;
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


  function sanitizeLogSyncPayload(sync) {
    if (!sync || typeof sync !== 'object') return null;
    const cleanEntry = (entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const normalized = (PropertyDomain && typeof PropertyDomain.normalizeOpinionHistoryEntry === 'function')
        ? PropertyDomain.normalizeOpinionHistoryEntry(entry)
        : normalizeOpinionHistoryEntry(entry);
      if (!normalized) return null;
      return {
        kind: String(normalized.kind || '').trim(),
        title: String(normalized.title || '').trim(),
        at: String(normalized.at || normalized.date || '').trim(),
        date: String(normalized.date || '').trim(),
        text: String(normalized.text || '').trim(),
        author: String(normalized.author || '').trim(),
        authorRole: String(normalized.authorRole || normalized.actorRole || '').trim(),
      };
    };
    const mode = String(sync.mode || '').trim().toLowerCase();
    if (!mode) return null;
    return {
      mode,
      beforeEntry: cleanEntry(sync.beforeEntry),
      afterEntry: cleanEntry(sync.afterEntry),
    };
  }

  function renderCombinedPropertyLog(container, opinionHistory, registrationLog) {
    if (!container) return;
    const groups = (PropertyDomain && typeof PropertyDomain.buildCombinedPropertyLogGroups === "function")
      ? PropertyDomain.buildCombinedPropertyLogGroups(opinionHistory, registrationLog, { formatAt: formatRegLogAt })
      : [];
    if (!Array.isArray(groups) || !groups.length) {
      container.innerHTML = '<div class="history-empty">통합 LOG가 없습니다.</div>';
      return;
    }
    container.innerHTML = groups.map((group, groupIndex) => {
      const summaryBadges = (Array.isArray(group.badges) ? group.badges : []).map((badge) => renderCombinedLogBadge(badge)).join('');
      const itemsHtml = (Array.isArray(group.items) ? group.items : []).map((entry) => {
        const badgeHtml = (Array.isArray(entry.badges) ? entry.badges : [{ badgeClass: entry.badgeClass, badgeLabel: entry.badgeLabel }]).map((badge) => renderCombinedLogBadge(badge)).join('');
        const canEdit = entry.kind !== 'registration' && Number.isInteger(entry.sourceIndex);
        const actionHtml = canEdit ? `<div class="history-actions"><button type="button" class="history-edit-btn" data-log-kind="opinion" data-log-idx="${entry.sourceIndex}" title="수정">✎</button><button type="button" class="history-del-btn" data-log-kind="opinion" data-log-idx="${entry.sourceIndex}" title="삭제">✕</button></div>` : '';
        const entryMeta = [entry.at ? `<span class="agent-combined-log-author">${esc(formatRegLogAt(entry.at))}</span>` : '', renderCombinedLogActorChip(entry), actionHtml].filter(Boolean).join('');
        if (entry.kind !== 'registration') {
          return `<div class="agent-combined-log-entry" data-log-kind="opinion" data-log-idx="${entry.sourceIndex}">` +
            `<div class="agent-combined-log-entry-head">${badgeHtml}${entryMeta}</div>` +
            `<div class="agent-combined-log-body"><div class="agent-combined-log-text" id="combinedLogText_${entry.sourceIndex}">${esc(entry.text || '')}</div><div class="history-edit-area hidden" id="combinedLogEdit_${entry.sourceIndex}"><textarea class="input history-edit-textarea" rows="3">${esc(entry.text || '')}</textarea><div class="history-edit-btns"><button type="button" class="btn btn-primary btn-sm history-save-btn" data-log-kind="opinion" data-log-idx="${entry.sourceIndex}">저장</button><button type="button" class="btn btn-ghost btn-sm history-cancel-btn" data-log-kind="opinion" data-log-idx="${entry.sourceIndex}">취소</button></div></div></div>` +
          `</div>`;
        }
        const changesHtml = Array.isArray(entry.changes) && entry.changes.length
          ? `<div class="agent-combined-log-changes">${entry.changes.map((change) => `<div class="agent-combined-log-change"><span class="agent-combined-log-label">${esc(change.label || '')}</span><span class="agent-combined-log-value">${esc(change.before || '-')}</span><span class="agent-combined-log-arrow">→</span><span class="agent-combined-log-value">${esc(change.after || '-')}</span></div>`).join('')}</div>`
          : '<div class="agent-combined-log-text">변경 없음</div>';
        return `<div class="agent-combined-log-entry">` +
          `<div class="agent-combined-log-entry-head">${badgeHtml}${entryMeta}</div>` +
          `<div class="agent-combined-log-body">${changesHtml}</div>` +
        `</div>`;
      }).join('');
      return `<div class="agent-combined-log-item">` +
        `<div class="agent-combined-log-head"><span class="agent-combined-log-date">${esc(group.displayDate || formatRegLogAt(group.at) || '')}</span><div class="agent-combined-log-summary">${summaryBadges}</div><button type="button" class="agent-combined-log-toggle" data-group-toggle="${groupIndex}" aria-expanded="false">▼</button></div>` +
        `<div class="agent-combined-log-group-body hidden" data-group-body="${groupIndex}">${itemsHtml}</div>` +
      `</div>`;
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

    container.querySelectorAll('.history-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.logIdx);
        container.querySelector(`#combinedLogText_${idx}`)?.classList.add('hidden');
        container.querySelector(`#combinedLogEdit_${idx}`)?.classList.remove('hidden');
      });
    });
    container.querySelectorAll('.history-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.logIdx);
        container.querySelector(`#combinedLogText_${idx}`)?.classList.remove('hidden');
        container.querySelector(`#combinedLogEdit_${idx}`)?.classList.add('hidden');
      });
    });
    container.querySelectorAll('.history-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.logIdx);
        const editArea = container.querySelector(`#combinedLogEdit_${idx} textarea`);
        const newText = String(editArea?.value || '').trim();
        if (!newText) return;
        const item = state.editingProperty;
        if (!item) return;
        const hist = loadOpinionHistory(item);
        if (!hist[idx]) return;
        const beforeEntry = hist[idx] ? { ...hist[idx] } : null;
        hist[idx] = { ...hist[idx], text: newText };
        await patchOpinionHistory(item, hist, { mode: 'edit', beforeEntry, afterEntry: hist[idx] });
        if (item._raw?.raw) item._raw.raw.opinionHistory = hist;
        renderCombinedPropertyLog(container, hist, loadRegistrationLog(item));
      });
    });
    container.querySelectorAll('.history-del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 LOG를 삭제할까요?')) return;
        const idx = Number(btn.dataset.logIdx);
        const item = state.editingProperty;
        if (!item) return;
        const hist = loadOpinionHistory(item);
        const beforeEntry = hist[idx] ? { ...hist[idx] } : null;
        hist.splice(idx, 1);
        await patchOpinionHistory(item, hist, { mode: 'delete', beforeEntry });
        if (item._raw?.raw) item._raw.raw.opinionHistory = hist;
        renderCombinedPropertyLog(container, hist, loadRegistrationLog(item));
      });
    });
  }

  // ---------------------------
  // Opinion History 유틸
  // ---------------------------
  function normalizeOpinionHistoryEntry(entry) {
    if (PropertyDomain && typeof PropertyDomain.normalizeOpinionHistoryEntry === "function") {
      return PropertyDomain.normalizeOpinionHistoryEntry(entry);
    }
    if (!entry || typeof entry !== "object") return null;
    const text = String(entry.text || entry.note || "").trim();
    if (!text) return null;
    const kind = String(entry.kind || entry.type || "opinion").trim() || "opinion";
    const title = String(entry.title || entry.label || "").trim();
    const date = String(entry.date || entry.at || "").trim();
    const author = String(entry.author || entry.actor || "").trim();
    return { ...entry, kind, title, date, at: date || String(entry.at || "").trim(), text, author };
  }

  function buildOpinionHistoryEntry(kind, text, user, options = {}) {
    if (PropertyDomain && typeof PropertyDomain.buildOpinionHistoryEntry === "function") {
      return PropertyDomain.buildOpinionHistoryEntry(kind, text, user, options);
    }
    const body = String(text || "").trim();
    if (!body) return null;
    const at = String(options.at || new Date().toISOString()).trim() || new Date().toISOString();
    const fallbackDate = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();
    const author = String(options.author || user?.name || user?.email || "").trim();
    const titleMap = {
      opinion: "담당자의견",
      siteInspection: "현장실사",
      dailyIssue: "금일이슈사항",
    };
    return {
      kind: String(kind || "opinion").trim() || "opinion",
      title: String(options.title || titleMap[kind] || "담당자의견").trim(),
      date: String(options.date || formatDate(at) || fallbackDate).trim() || fallbackDate,
      at,
      text: body,
      author,
    };
  }

  function loadOpinionHistory(item) {
    if (PropertyDomain && typeof PropertyDomain.loadOpinionHistory === "function") {
      return PropertyDomain.loadOpinionHistory(item);
    }
    const raw = item?._raw?.raw || {};
    const hist = raw.opinionHistory;
    if (Array.isArray(hist) && hist.length) {
      return hist.map((entry) => normalizeOpinionHistoryEntry(entry)).filter(Boolean);
    }
    const legacy = String(item?.opinion || raw.opinion || "").trim();
    if (legacy) {
      const entry = buildOpinionHistoryEntry("opinion", legacy, { name: "" }, { at: item?.createdAt || raw.firstRegisteredAt || new Date().toISOString() });
      return entry ? [entry] : [];
    }
    return [];
  }

  function appendOpinionEntry(history, newText, user, options = {}) {
    if (PropertyDomain && typeof PropertyDomain.appendOpinionEntry === "function") {
      return PropertyDomain.appendOpinionEntry(history, newText, user, options);
    }
    const entry = buildOpinionHistoryEntry(options.kind || "opinion", newText, user, options);
    if (!entry) return Array.isArray(history) ? history : [];
    return [...(Array.isArray(history) ? history : []), entry];
  }

  function getOpinionHistoryMeta(entry) {
    if (PropertyDomain && typeof PropertyDomain.getOpinionHistoryMeta === "function") {
      return PropertyDomain.getOpinionHistoryMeta(entry);
    }
    const kind = String(entry?.kind || "opinion").trim();
    if (kind === "siteInspection") return { badgeClass: "is-site", badgeLabel: "현장실사", title: "현장실사" };
    if (kind === "dailyIssue") return { badgeClass: "is-edit", badgeLabel: "금일이슈사항", title: "금일이슈사항" };
    return { badgeClass: "is-opinion", badgeLabel: "담당자의견", title: "담당자의견" };
  }

  function renderOpinionHistory(container, history, isAdmin) {
    if (!container) return;
    if (!history.length) {
      container.innerHTML = '<div class="history-empty">등록된 의견이 없습니다.</div>';
      return;
    }
    const reversed = [...history].reverse();
    container.innerHTML = reversed.map((entry, idx) => {
      const realIdx = history.length - 1 - idx;
      const meta = getOpinionHistoryMeta(entry);
      const isEditable = (!entry?.kind || entry.kind === 'opinion') && isAdmin;
      const adminControls = isEditable
        ? `<div class="history-actions">
            <button type="button" class="history-edit-btn" data-idx="${realIdx}" title="수정">✎</button>
            <button type="button" class="history-del-btn" data-idx="${realIdx}" title="삭제">✕</button>
           </div>`
        : "";
      return `<div class="history-item" data-idx="${realIdx}">
        <div class="history-meta">
          <span class="reglog-badge ${esc(meta.badgeClass)}">${esc(entry.title || meta.badgeLabel)}</span>
          <span class="history-date">${esc(entry.date || "")}</span>
          ${entry.author ? `<span class="history-author">${esc(entry.author)}</span>` : ""}
          ${adminControls}
        </div>
        <div class="history-text" id="historyText_${realIdx}">${esc(entry.text || "")}</div>
        ${isEditable ? `<div class="history-edit-area hidden" id="historyEdit_${realIdx}">
          <textarea class="input history-edit-textarea" rows="3">${esc(entry.text || "")}</textarea>
          <div class="history-edit-btns">
            <button type="button" class="btn btn-primary btn-sm history-save-btn" data-idx="${realIdx}">저장</button>
            <button type="button" class="btn btn-ghost btn-sm history-cancel-btn" data-idx="${realIdx}">취소</button>
          </div>
        </div>` : ""}
      </div>`;
    }).join("");

    if (!isAdmin) return;

    container.querySelectorAll(".history-edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        container.querySelector(`#historyText_${idx}`)?.classList.add("hidden");
        container.querySelector(`#historyEdit_${idx}`)?.classList.remove("hidden");
      });
    });
    container.querySelectorAll(".history-cancel-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        container.querySelector(`#historyText_${idx}`)?.classList.remove("hidden");
        container.querySelector(`#historyEdit_${idx}`)?.classList.add("hidden");
      });
    });
    container.querySelectorAll(".history-save-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.idx);
        const editArea = container.querySelector(`#historyEdit_${idx} textarea`);
        const newText = String(editArea?.value || "").trim();
        if (!newText) return;
        const item = state.editingProperty;
        if (!item) return;
        const hist = loadOpinionHistory(item);
        const beforeEntry = hist[idx] ? { ...hist[idx] } : null;
        hist[idx] = { ...hist[idx], text: newText };
        await patchOpinionHistory(item, hist, { mode: 'edit', beforeEntry, afterEntry: hist[idx] });
        if (item._raw?.raw) item._raw.raw.opinionHistory = hist;
        renderOpinionHistory(container, hist, true);
      });
    });
    container.querySelectorAll(".history-del-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("이 의견을 삭제할까요?")) return;
        const idx = Number(btn.dataset.idx);
        const item = state.editingProperty;
        if (!item) return;
        const hist = loadOpinionHistory(item);
        const beforeEntry = hist[idx] ? { ...hist[idx] } : null;
        hist.splice(idx, 1);
        await patchOpinionHistory(item, hist, { mode: 'delete', beforeEntry });
        if (item._raw?.raw) item._raw.raw.opinionHistory = hist;
        renderOpinionHistory(container, hist, true);
      });
    });
  }

  async function patchOpinionHistory(item, history, sync = null) {
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    if (!sb) throw new Error("Supabase 연동 필요");
    const targetId = item.id || item.globalId;
    const list = Array.isArray(history) ? history : [];
    const latestTextByKind = (kind, options = {}) => {
      const latest = [...list].reverse().find((entry) => String(entry?.kind || 'opinion').trim() === kind);
      const text = String(latest?.text || '').trim();
      if (!text) return null;
      if (options.todayOnly) {
        const key = String(latest?.date || latest?.at || '').trim().slice(0, 10);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        if (key !== today) return null;
      }
      return text;
    };
    const latestOpinion = latestTextByKind('opinion');
    const latestSiteInspection = latestTextByKind('siteInspection');
    const latestDailyIssue = latestTextByKind('dailyIssue', { todayOnly: true });
    const currentRaw = item?._raw?.raw && typeof item._raw.raw === "object" ? { ...item._raw.raw } : {};
    const nextRaw = {
      ...currentRaw,
      opinionHistory: list,
      opinion: latestOpinion,
      memo: latestOpinion,
      siteInspection: latestSiteInspection,
      dailyIssue: latestDailyIssue,
      daily_issue: latestDailyIssue,
    };
    const payload = {
      memo: latestOpinion,
      raw: nextRaw,
      siteInspection: latestSiteInspection,
      dailyIssue: latestDailyIssue,
    };
    const logSync = sanitizeLogSyncPayload(sync);
    if (typeof api === 'function') {
      await api('/properties', { method: 'PATCH', auth: true, body: { targetId, patch: payload, logSync } });
    } else {
      await updatePropertyRowResilient(sb, targetId, {
        memo: latestOpinion,
        raw: nextRaw,
        site_inspection: latestSiteInspection,
        daily_issue: latestDailyIssue,
      });
    }
    if (item && typeof item === 'object') {
      item.opinion = latestOpinion;
      item.memo = latestOpinion;
      item.siteInspection = latestSiteInspection;
      item.dailyIssue = latestDailyIssue;
      item.daily_issue = latestDailyIssue;
      if (item._raw && typeof item._raw === 'object') {
        item._raw.memo = latestOpinion;
        item._raw.site_inspection = latestSiteInspection;
        item._raw.daily_issue = latestDailyIssue;
        item._raw.raw = nextRaw;
      }
    }
  }

  function esc(v) {
    return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function renderAdminPropertiesPagination(...args) {
    return callAdminModule("propertiesTab", "renderAdminPropertiesPagination", args);
  }
  function pruneSelectedPropertyIds(...args) {
    return callAdminModule("propertiesTab", "pruneSelectedPropertyIds", args);
  }
  function togglePropertySelection(...args) {
    return callAdminModule("propertiesTab", "togglePropertySelection", args);
  }
  function toggleSelectAllProperties(...args) {
    return callAdminModule("propertiesTab", "toggleSelectAllProperties", args);
  }
  function updatePropertySelectionControls(...args) {
    return callAdminModule("propertiesTab", "updatePropertySelectionControls", args);
  }
  async function deleteSelectedProperties(...args) {
    return callAdminModule("propertiesTab", "deleteSelectedProperties", args);
  }
  async function deleteAllProperties(...args) {
    return callAdminModule("propertiesTab", "deleteAllProperties", args);
  }
  function renderPropertiesTable(...args) {
    return callAdminModule("propertiesTab", "renderPropertiesTable", args);
  }


  // ---------------------------
  // Property Edit Modal
  // ---------------------------
  async function ensureStaffForPropertyModal(...args) {
    return callAdminModule("propertiesTab", "ensureStaffForPropertyModal", args);
  }


  function formatModalAreaValue(sourceType, value) {
    if (value == null || value === "") return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (String(sourceType || "") === "onbid") return n.toFixed(2);
    return Number.isInteger(n) ? String(n) : String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function toggleBrokerFieldsBySource(sourceType) {
    const hide = ["auction", "onbid"].includes(String(sourceType || ""));
    ["realtorname", "realtorphone", "realtorcell"].forEach((name) => {
      const el = els.aemForm?.elements?.[name];
      const field = el?.closest?.('.field');
      if (field) field.classList.toggle('hidden', hide);
    });
  }
  async function openPropertyEditModal(...args) {
    return callAdminModule("propertiesTab", "openPropertyEditModal", args);
  }
  function populateAssigneeSelect(...args) {
    return callAdminModule("propertiesTab", "populateAssigneeSelect", args);
  }
  function closePropertyEditModal(...args) {
    return callAdminModule("propertiesTab", "closePropertyEditModal", args);
  }


  function toInputDateTimeLocal(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function setAemMsg(text, isError = true) {
    if (!els.aemMsg) return;
    els.aemMsg.style.color = isError ? "#ff8b8b" : "#9ff0b6";
    els.aemMsg.textContent = text || "";
  }
  async function savePropertyEditModal(...args) {
    return callAdminModule("propertiesTab", "savePropertyEditModal", args);
  }
  async function updatePropertyAdmin(...args) {
    return callAdminModule("propertiesTab", "updatePropertyAdmin", args);
  }
  async function handleDeleteProperty(...args) {
    return callAdminModule("propertiesTab", "handleDeleteProperty", args);
  }


  // ---------------------------
  // Staff CRUD
  // ---------------------------
  function setStaffFormMode(...args) {
    return callAdminModule("staffRegions", "setStaffFormMode", args);
  }
  function fillStaffForm(...args) {
    return callAdminModule("staffRegions", "fillStaffForm", args);
  }
  function resetStaffForm(...args) {
    return callAdminModule("staffRegions", "resetStaffForm", args);
  }
  async function handleSaveStaff(...args) {
    return callAdminModule("staffRegions", "handleSaveStaff", args);
  }
  function renderStaffTable(...args) {
    return callAdminModule("staffRegions", "renderStaffTable", args);
  }
  function renderAssignmentTable(...args) {
    return callAdminModule("staffRegions", "renderAssignmentStatus", args);
  }

  // ---------------------------
  // Property Assignment (물건 배정)
  // ---------------------------
  function refreshAssignmentView(...args) {
    return callAdminModule("staffRegions", "refreshAssignmentView", args);
  }
  async function handleAutoAssign(...args) {
    return callAdminModule("staffRegions", "handleAutoAssign", args);
  }
  // ---------------------------
  async function handleCsvUpload(...args) {
    return callAdminModule("csvTab", "handleCsvUpload", args);
  }
  function mapPropertyCsvRow(...args) {
    return callAdminModule("csvTab", "mapPropertyCsvRow", args);
  }
  function buildSupabasePropertyRow(...args) {
    return callAdminModule("csvTab", "buildSupabasePropertyRow", args);
  }
  function dedupePropertyRowsByGlobalId(...args) {
    return callAdminModule("csvTab", "dedupePropertyRowsByGlobalId", args);
  }
  async function upsertPropertiesResilient(...args) {
    return callAdminModule("csvTab", "upsertPropertiesResilient", args);
  }

  function readCsvFileText(...args) {
    return callAdminModule("csvTab", "readCsvFileText", args);
  }

  // ---------------------------
  // CSV Parser (simple, quotes support)
  // ---------------------------
  function parseCsv(...args) {
    return callAdminModule("csvTab", "parseCsv", args);
  }

  // ---------------------------
  // API
  // ---------------------------
  async function api(path, options = {}) {
    if (sharedApi) return sharedApi(path, options);
    const method = (options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json" };

    if (options.auth) {
      const token = String(state.session?.token || loadSession()?.token || "").trim();
      if (!token) {
        const err = new Error("로그인이 필요합니다.");
        err.code = "LOGIN_REQUIRED";
        throw err;
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const hasBody = !["GET", "HEAD"].includes(method);
    if (hasBody) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body || {}) : undefined,
      });
    } catch (fetchErr) {
      const detail = String(fetchErr?.message || "").trim();
      const err = new Error(detail ? `네트워크 연결 또는 서버 응답에 실패했습니다. (${detail})` : "네트워크 연결 또는 서버 응답에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      err.cause = fetchErr;
      throw err;
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      const err = new Error(data?.message || `API 오류 (${res.status})`);
      err.status = res.status;
      if (res.status === 401) err.code = "LOGIN_REQUIRED";
      throw err;
    }
    return data;
  }

  // ---------------------------
  // Geocoding (Kakao Maps JS SDK)
  // ---------------------------
  let _geocodeKakaoReady = null;
  let _geocoder = null;
  function getKakaoAppKey(...args) {
    return callAdminModule("geocodingTab", "getKakaoAppKey", args);
  }
  function loadKakaoMapsSDK(...args) {
    return callAdminModule("geocodingTab", "loadKakaoMapsSDK", args);
  }
  async function ensureKakaoGeocoder(...args) {
    return callAdminModule("geocodingTab", "ensureKakaoGeocoder", args);
  }
  function geocodeOneAddress(...args) {
    return callAdminModule("geocodingTab", "geocodeOneAddress", args);
  }
  function normalizeAddressForGeocode(...args) {
    return callAdminModule("geocodingTab", "normalizeAddressForGeocode", args);
  }
  function getGeocodeStats(...args) {
    return callAdminModule("geocodingTab", "getGeocodeStats", args);
  }
  function updateGeocodeStatusBar(...args) {
    return callAdminModule("geocodingTab", "updateGeocodeStatusBar", args);
  }
  function renderGeocodeList(...args) {
    return callAdminModule("geocodingTab", "renderGeocodeList", args);
  }
  function sleep(...args) {
    return callAdminModule("geocodingTab", "sleep", args);
  }
  async function saveGeocodeResult(...args) {
    return callAdminModule("geocodingTab", "saveGeocodeResult", args);
  }
  async function runGeocoding(...args) {
    return callAdminModule("geocodingTab", "runGeocoding", args);
  }

  // ---------------------------
  // Utils
  // ---------------------------
  function normalizeAddress(v) {
    return String(v || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[(),]/g, "")
      .trim();
  }

  function extractGuDong(address) {
    const text = String(address || "").replace(/\s+/g, " ").trim();

    // 예: 서울특별시 강남구 역삼동 / 서울 강남구 역삼동 / 강남구 역삼동
    const guMatch = text.match(/([가-힣]+구)\b/);
    const dongMatch = text.match(/([가-힣0-9]+동)\b/);

    return {
      gu: guMatch ? guMatch[1] : "",
      dong: dongMatch ? dongMatch[1] : "",
    };
  }

  function normalizeStatus(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["active", "진행", "진행중", "진행중인"].includes(s)) return "active";
    if (["hold", "보류"].includes(s)) return "hold";
    if (["closed", "종결", "완료"].includes(s)) return "closed";
    if (["review", "검토", "검토중"].includes(s)) return "review";
    return "review";
  }

  function sourceLabel(v) {
    if (PropertyRenderers && typeof PropertyRenderers.sourceLabel === 'function') return PropertyRenderers.sourceLabel(v, '일반');
    if (v === "auction") return "경매";
    if (v === "gongmae" || v === "onbid") return "공매";
    if (v === "realtor") return "중개";
    return "일반";
  }

  function statusLabel(v) {
    if (PropertyRenderers && typeof PropertyRenderers.statusLabel === 'function') return PropertyRenderers.statusLabel(v, '-');
    if (v === "active") return "진행중";
    if (v === "hold") return "보류";
    if (v === "closed") return "종결";
    if (v === "review") return "검토중";
    return v || "-";
  }

  function formatMoneyKRW(n) {
    if (PropertyRenderers && typeof PropertyRenderers.formatMoneyKRW === 'function') return PropertyRenderers.formatMoneyKRW(n, '-');
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
  }

  function formatPercent(base, current, raw = null) {
    if (PropertyRenderers && typeof PropertyRenderers.formatPercent === 'function') return PropertyRenderers.formatPercent(base, current, raw, '-');
    const b = Number(base || 0);
    const c = Number(current || 0);
    if (Number.isFinite(b) && Number.isFinite(c) && b > 0 && c > 0) return `${((c / b) * 100).toFixed(1)}%`;
    const rawRate = raw && (raw["최저입찰가율(%)"] || raw.bidRate || raw.rate);
    if (rawRate != null && String(rawRate).trim() !== "") return String(rawRate).trim();
    return "-";
  }

  function formatAreaPyeong(v) {
    if (PropertyRenderers && typeof PropertyRenderers.formatAreaPyeong === 'function') return PropertyRenderers.formatAreaPyeong(v, '-');
    if (v == null || v === "") return "-";
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "-";
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function toNullableNumber(v) {
    if (PropertyRenderers && typeof PropertyRenderers.toNullableNumber === 'function') return PropertyRenderers.toNullableNumber(v);
    if (Shared && typeof Shared.toNullableNumber === "function") return Shared.toNullableNumber(v);
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function firstText(...values) {
    if (PropertyRenderers && typeof PropertyRenderers.firstText === 'function') return PropertyRenderers.firstText(...values);
    if (PropertyDomain && typeof PropertyDomain.pickFirstText === "function") return PropertyDomain.pickFirstText(...values);
    for (const value of values) {
      if (value == null) continue;
      const s = String(value).trim();
      if (s) return s;
    }
    return "";
  }

  function buildKakaoMapLink(p) {
    if (PropertyRenderers && typeof PropertyRenderers.buildKakaoMapLink === 'function') return PropertyRenderers.buildKakaoMapLink(p, { fallbackLabel: '매물 위치' });
    if (p.latitude == null || p.longitude == null) return "";
    const label = encodeURIComponent(p.address || p.assetType || "매물 위치");
    return `https://map.kakao.com/link/map/${label},${p.latitude},${p.longitude}`;
  }

  function mergePropertyRaw(item, patch) {
    const currentRaw = item?._raw?.raw && typeof item._raw.raw === "object" ? { ...item._raw.raw } : {};
    const hasOwnAssignee = Object.prototype.hasOwnProperty.call(patch || {}, "assigneeId");
    const hasOwnDailyIssue = Object.prototype.hasOwnProperty.call(patch || {}, "dailyIssue");
    const hasOwnOpinion = Object.prototype.hasOwnProperty.call(patch || {}, "opinion");
    const assigneeId = hasOwnAssignee
      ? (patch.assigneeId || null)
      : (item?.assignedAgentId ?? currentRaw.assigneeId ?? currentRaw.assignedAgentId ?? currentRaw.assignee_id ?? null);
    const assigneeName = assigneeId ? (getStaffNameById(assigneeId) || "") : null;
    const sourceNoteLabel = currentRaw.sourceNoteLabel ?? currentRaw.importedSourceLabel ?? null;
    const sourceNoteText = currentRaw.sourceNoteText ?? currentRaw.importedSourceText ?? null;
    return {
      ...currentRaw,
      itemNo: patch.itemNo ?? currentRaw.itemNo ?? null,
      sourceBucket: patch.sourceBucket ?? currentRaw.sourceBucket ?? null,
      sourceType: patch.sourceType ?? currentRaw.sourceType ?? currentRaw.source_type ?? null,
      source_type: patch.sourceType ?? currentRaw.source_type ?? currentRaw.sourceType ?? null,
      isDirectSubmission: patch.isDirectSubmission ?? currentRaw.isDirectSubmission ?? null,
      submitterDisplayType: patch.submitterDisplayType ?? currentRaw.submitterDisplayType ?? null,
      submitterType: patch.submitterType ?? currentRaw.submitterType ?? currentRaw.submitter_type ?? null,
      submitter_type: patch.submitterType ?? currentRaw.submitter_type ?? currentRaw.submitterType ?? null,
      registeredByAdmin: patch.registeredByAdmin ?? currentRaw.registeredByAdmin ?? false,
      registeredByAgent: patch.registeredByAgent ?? currentRaw.registeredByAgent ?? false,
      address: patch.address ?? currentRaw.address ?? null,
      assetType: patch.assetType ?? currentRaw.assetType ?? null,
      floor: patch.floor ?? currentRaw.floor ?? null,
      totalfloor: patch.totalfloor ?? currentRaw.totalfloor ?? null,
      commonArea: patch.commonarea ?? currentRaw.commonArea ?? null,
      exclusiveArea: patch.exclusivearea ?? currentRaw.exclusiveArea ?? null,
      siteArea: patch.sitearea ?? currentRaw.siteArea ?? null,
      useapproval: patch.useapproval ?? currentRaw.useapproval ?? null,
      lowprice: patch.lowprice ?? currentRaw.lowprice ?? null,
      dateMain: patch.dateMain ?? currentRaw.dateMain ?? null,
      sourceUrl: patch.sourceUrl ?? currentRaw.sourceUrl ?? null,
      importedSourceLabel: currentRaw.importedSourceLabel ?? sourceNoteLabel,
      importedSourceText: currentRaw.importedSourceText ?? sourceNoteText,
      sourceNoteLabel,
      sourceNoteText,
      realtorname: patch.realtorname ?? currentRaw.realtorname ?? null,
      realtorphone: patch.realtorphone ?? currentRaw.realtorphone ?? null,
      realtorcell: patch.realtorcell ?? currentRaw.realtorcell ?? null,
      rightsAnalysis: patch.rightsAnalysis ?? currentRaw.rightsAnalysis ?? null,
      siteInspection: patch.siteInspection ?? currentRaw.siteInspection ?? null,
      dailyIssue: hasOwnDailyIssue ? (patch.dailyIssue || null) : (currentRaw.dailyIssue ?? currentRaw.daily_issue ?? null),
      daily_issue: hasOwnDailyIssue ? (patch.dailyIssue || null) : (currentRaw.daily_issue ?? currentRaw.dailyIssue ?? null),
      opinion: hasOwnOpinion ? (patch.opinion || null) : (currentRaw.opinion ?? null),
      memo: hasOwnOpinion ? (patch.opinion || null) : (currentRaw.memo ?? null),
      opinionHistory: patch.opinionHistory ?? currentRaw.opinionHistory ?? [],
      assigneeId,
      assignee_id: assigneeId,
      assignedAgentId: assigneeId,
      assigneeName: assigneeName,
      assignedAgentName: assigneeName,
    };
  }

  function parseFlexibleDate(value) {
    const s = String(value || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (m) return new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
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

  function formatScheduleHtml(p) {
    if (PropertyRenderers && typeof PropertyRenderers.formatScheduleHtml === 'function') {
      return PropertyRenderers.formatScheduleHtml(p, { rawKeys: ['입찰일자', '입찰마감일시'] });
    }
    const rawObj = p?._raw?.raw && typeof p._raw.raw === 'object' ? p._raw.raw : (p?._raw || {});
    const rawValue = p?.dateMain || rawObj["입찰일자"] || rawObj["입찰마감일시"] || "";
    const display = formatDate(rawValue);
    const dday = computeDdayLabel(rawValue);
    const dateText = (!display || display === "-") ? "-" : display;
    return `<span class="schedule-stack"><span class="schedule-date">${escapeHtml(dateText)}</span>${dday ? `<span class="schedule-dday">${escapeHtml(dday)}</span>` : `<span class="schedule-dday schedule-dday-empty"></span>`}</span>`;
  }

  function formatDate(v) {
    if (PropertyRenderers && typeof PropertyRenderers.formatDateValue === 'function') return PropertyRenderers.formatDateValue(v, '-');
    if (!v) return "-";
    const d = parseFlexibleDate(v);
    if (!d) return String(v || "-");
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function normalizePhone(v) {
    if (PropertyRenderers && typeof PropertyRenderers.normalizePhone === 'function') return PropertyRenderers.normalizePhone(v);
    return String(v || "").replace(/[^\d]/g, "");
  }

  function formatPhoneDisplay(v) {
    if (PropertyRenderers && typeof PropertyRenderers.formatPhoneDisplay === 'function') return PropertyRenderers.formatPhoneDisplay(v);
    const n = normalizePhone(v);
    if (n.length === 11) return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`;
    if (n.length === 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
    return n;
  }

  function showResultBox(el, text, isError = false) {
    if (!el) return;
    if (PropertyRenderers && typeof PropertyRenderers.setResultBoxState === 'function') {
      PropertyRenderers.setResultBoxState(el, text, { isError });
      return;
    }
    el.classList.remove("hidden");
    el.classList.toggle("is-error", !!isError);
    el.classList.toggle("is-success", !isError);
    el.textContent = text;
  }

  function setFormBusy(form, busy) {
    if (PropertyRenderers && typeof PropertyRenderers.setFormBusyState === 'function') {
      PropertyRenderers.setFormBusyState(form, busy);
      return;
    }
    if (!form || typeof form.querySelectorAll !== "function") return;
    [...form.querySelectorAll("button, input, select, textarea")].forEach((el) => {
      el.disabled = !!busy;
    });
  }

  function debounce(fn, wait = 150) {
    if (Shared && typeof Shared.debounce === "function") return Shared.debounce(fn, wait);
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(v) {
    if (PropertyRenderers && typeof PropertyRenderers.escapeHtml === 'function') return PropertyRenderers.escapeHtml(v);
    if (Shared && typeof Shared.escapeHtml === "function") return Shared.escapeHtml(v);
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(v) {
    if (PropertyRenderers && typeof PropertyRenderers.escapeAttr === 'function') return PropertyRenderers.escapeAttr(v);
    if (Shared && typeof Shared.escapeAttr === "function") return Shared.escapeAttr(v);
    return escapeHtml(v).replaceAll("`", "&#96;");
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function $$(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  function goLoginPage(withLogout = false) {
    const next = encodeURIComponent("./admin-index.html");
    const extra = withLogout ? "&logout=1" : "";
    location.href = `./login.html?next=${next}${extra}`;
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

  function saveSession(v) {
    if (Shared && typeof Shared.saveSession === "function") return Shared.saveSession(v);
    try {
      if (!v) {
        sessionStorage.removeItem(SESSION_KEY);
        try { localStorage.removeItem(SESSION_KEY); } catch {}
        return;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    } catch {}
  }
})();
