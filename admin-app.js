(() => {
  const ADMIN_FAST_BUILD = "20260325-dashboard1";
  try { console.info("[admin-app] build", ADMIN_FAST_BUILD); } catch {}

  "use strict";

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
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

  function parseFlexibleNumber(value) {
    if (Shared && typeof Shared.parseFlexibleNumber === "function") return Shared.parseFlexibleNumber(value);
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const s = String(value).trim();
    if (!s) return null;
    const n = toNumber(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function formatMoneyInputValue(value) {
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
    if (Shared && typeof Shared.configureFreeDecimalInput === "function") return Shared.configureFreeDecimalInput(input);
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "decimal");
    input.removeAttribute("step");
  }

  function configureAmountInput(input) {
    if (Shared && typeof Shared.configureAmountInput === "function") return Shared.configureAmountInput(input);
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.removeAttribute("step");
    bindAmountInputMask(input);
  }

  function configureFormNumericUx(form, options = {}) {
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
      area: "",         // "0-5" | "5-10" | ... | "50-"
      priceRange: "",   // "0-1" | "1-3" | ... | "20-"  (억 단위)
      ratio50: "",      // "50" = 50% 이하 (경매/공매만)
    },
    lastGroupSuggestion: null,
    selectedPropertyIds: new Set(),
    propertyPage: 1,
    propertyPageSize: 30,
    propertyMode: "page",
    propertyTotalCount: 0,
    propertySummary: null,
    propertiesFullCache: null,
    geocodeRunning: false,
  };

  const els = {};

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
        renderPropertiesTable,
        setActiveTab,
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
        updatePropertyRowResilient,
        getStaffNameById,
        loadRegistrationLog,
        renderRegistrationLog,
        loadOpinionHistory,
        renderOpinionHistory,
        appendOpinionEntry,
        mergePropertyRaw,
        formatScheduleHtml,
        buildKakaoMapLink,
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
    callAdminModule("dashboard", "bindEvents", []);
    resetStaffForm();
    renderSessionUI();
    setActiveTab(state.activeTab);
    Promise.resolve(ensureLoginThenLoad()).catch((err) => handleAsyncError(err, "초기 로딩 실패"));
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
      sumTodayDetail: $("#sumTodayDetail"),
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
      propAreaFilter: $("#propAreaFilter"),
      propPriceFilter: $("#propPriceFilter"),
      propRatioFilter: $("#propRatioFilter"),
      propKeyword: $("#propKeyword"),
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

      // regions
      agentCountInput: $("#agentCountInput"),
      regionUnitMode: $("#regionUnitMode"),
      btnSuggestGrouping: $("#btnSuggestGrouping"),
      btnSaveAssignments: $("#btnSaveAssignments"),
      groupSuggestBox: $("#groupSuggestBox"),
      assignmentTableBody: $("#assignmentTable tbody"),
      assignmentEmpty: $("#assignmentEmpty"),

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
    if (K && typeof K.initTheme === "function") {
      K.initTheme({ container: document.querySelector(".top-actions"), className: "theme-toggle" });
    }
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
    setModalOpen(true);
    els.passwordChangeModal.classList.remove("hidden");
    els.passwordChangeModal.setAttribute("aria-hidden", "false");
  }

  function closePasswordChangeModal() {
    if (!els.passwordChangeModal) return;
    els.passwordChangeModal.classList.add("hidden");
    els.passwordChangeModal.setAttribute("aria-hidden", "true");
    setModalOpen(false);
    setPwdMsg("");
  }

  function setPwdMsg(text, isError = true) {
    if (!els.pwdMsg) return;
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
    const m = String(msg || "").trim();
    els.globalMsg.textContent = m;
    els.globalMsg.classList.toggle("hidden", !m);
  }


  function handleAsyncError(err, fallbackMsg = "요청 처리 중 오류가 발생했습니다.") {
    console.error(err);
    if (err?.code === "LOGIN_REQUIRED" || err?.status === 401) {
      setGlobalMsg("로그인이 필요합니다. 다시 로그인해 주세요.");
      goLoginPage(true);
      return;
    }
    alert(err?.message || fallbackMsg);
  }

function bindEvents() {
    // login / logout
    if (els.btnAdminLoginOpen) els.btnAdminLoginOpen.addEventListener("click", openLoginModal);
    if (els.btnChangeMyPassword) els.btnChangeMyPassword.addEventListener("click", openPasswordChangeModal);
    if (els.btnAdminLogout) els.btnAdminLogout.addEventListener("click", logout);

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
        const user = state.session?.user;
        if (user?.role !== "admin" && key !== "properties") {
          setGlobalMsg("관리자 권한이 확인되지 않았습니다. 다시 로그인해 주세요.");
          return;
        }
        setGlobalMsg("");
        setActiveTab(key);

        if (state.session?.user?.role === "admin") {
          if (key === "home") renderSummary();
          if (key === "staff") loadStaff().catch((e)=>handleAsyncError(e,"담당자 로드 실패"));
          if (key === "regions") ensureAuxiliaryPropertiesForAdmin().then(() => { renderAssignmentTable(); }).catch((e)=>handleAsyncError(e,"지역 데이터 로드 실패"));
          if (key === "geocoding") ensureAuxiliaryPropertiesForAdmin().then(() => { updateGeocodeStatusBar(); }).catch((e)=>handleAsyncError(e,"지오코딩 데이터 로드 실패"));
          if (key === "workmgmt") refreshWorkMgmt().catch((e)=>handleAsyncError(e,"업무 관리 로드 실패"));
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

    // 요약 카드 클릭 → 필터
    document.querySelectorAll(".summary-card[data-card]").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.card || "";
        const next = state.propertyFilters.activeCard === key ? "" : key; // 같은 카드 재클릭 시 해제
        state.propertyFilters.activeCard = next;
        // active 스타일 토글
        document.querySelectorAll(".summary-card[data-card]").forEach((c) => {
          c.classList.toggle("is-active", c.dataset.card === next && next !== "");
        });
        state.propertyPage = 1;
        loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
      });
    });

    if (els.propStatusFilter) els.propStatusFilter.addEventListener("change", (e) => {
      state.propertyFilters.status = String(e.target.value || "");
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });
    if (els.propAreaFilter) els.propAreaFilter.addEventListener("change", (e) => {
      state.propertyFilters.area = String(e.target.value || "");
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });
    if (els.propPriceFilter) els.propPriceFilter.addEventListener("change", (e) => {
      state.propertyFilters.priceRange = String(e.target.value || "");
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });
    if (els.propRatioFilter) els.propRatioFilter.addEventListener("change", (e) => {
      state.propertyFilters.ratio50 = String(e.target.value || "");
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    });
    if (els.propKeyword) els.propKeyword.addEventListener("input", debounce((e) => {
      state.propertyFilters.keyword = String(e.target.value || "").toLowerCase();
      state.propertyPage = 1;
      loadProperties({ refreshSummary: false }).catch((e)=>handleAsyncError(e,"물건 로드 실패"));
    }, 150));

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

    if (els.btnSuggestGrouping) els.btnSuggestGrouping.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      handleSuggestGrouping();
    });
    if (els.btnSaveAssignments) els.btnSaveAssignments.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      handleSaveAssignments();
    });

    // property edit modal
    if (els.propertyEditModalAdmin) {
      els.propertyEditModalAdmin.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.close === "true") closePropertyEditModal();
      });
    }
    if (els.aemClose) els.aemClose.addEventListener("click", closePropertyEditModal);
    if (els.aemCancel) els.aemCancel.addEventListener("click", closePropertyEditModal);
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
          card.classList.toggle("is-active", !!card.querySelector("input[type=radio]")?.checked);
        });
      });
      els.newPropertyForm.addEventListener("submit", (e) => {
        e.preventDefault();
        submitNewProperty().catch((err) => setNpmMsg(err?.message || "등록 실패"));
      });
    }

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
    await syncSupabaseSessionIfNeeded();
    state.session = loadSession();
    renderSessionUI();
    const user = state.session?.user;
    const loggedIn = !!(state.session?.token && user);

    if (!loggedIn) {
      goLoginPage();
      return;
    }

    // 담당자는 담당자 페이지로 리다이렉트
    if (String(user.role || "").toLowerCase() !== "admin") {
      location.replace("./agent-index.html");
      return;
    }

    await loadAllCoreData();
  }

  function setActiveTab(tab) {
    state.activeTab = tab;

    [...els.adminTabs.querySelectorAll(".tab")].forEach((el) => {
      el.classList.toggle("is-active", el.dataset.tab === tab);
    });

    const map = {
      home: els.tabHome,
      properties: els.tabProperties,
      csv: els.tabCsv,
      staff: els.tabStaff,
      regions: els.tabRegions,
      geocoding: els.tabGeocoding,
      workmgmt: els.tabWorkmgmt,
    };
    Object.entries(map).forEach(([key, panel]) => {
      if (!panel) return;
      panel.classList.toggle("hidden", key !== tab);
    });

    // 탭 전환 시 폼/결과 초기화
    if (tab !== "csv") {
      if (els.csvFileInput) els.csvFileInput.value = "";
      if (els.csvResultBox) {
        els.csvResultBox.textContent = "";
        els.csvResultBox.className = "result-box hidden csv-result-inline";
      }
    }
  }

  function renderSessionUI() {
    const user = state.session?.user;
    const loggedIn = !!(state.session?.token && user);

    els.btnAdminLoginOpen?.classList.toggle("hidden", loggedIn);
    els.btnChangeMyPassword?.classList.toggle("hidden", !loggedIn || !isSupabaseMode());
    els.btnAdminLogout?.classList.toggle("hidden", !loggedIn);

    if (!loggedIn) {
      els.adminUserBadge.textContent = "비로그인";
      els.adminUserBadge.className = "badge badge-muted";
      return;
    }

    els.adminUserBadge.textContent = user.name || user.email || "";
    els.adminUserBadge.className = "badge badge-admin";
    document.body.classList.add("role-admin");

    if (els.summaryPanel) els.summaryPanel.classList.remove("hidden");
  }

  function openLoginModal(){ goLoginPage(); }

  function closeLoginModal() {
    els.adminLoginModal.classList.add("hidden");
    els.adminLoginModal.setAttribute("aria-hidden", "true");
    els.adminLoginForm.reset();
  }

  async function onSubmitAdminLogin(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const password = String(fd.get("password") || "");
    if (!name || !password) return alert("이름/비밀번호를 입력해 주세요.");

    try {
      setFormBusy(e.currentTarget, true);
      const res = await api("/auth/login", {
        method: "POST",
        body: { name, password },
      });

      if (res?.user?.role !== "admin") {
        throw new Error("관리자 권한 계정만 접속 가능합니다.");
      }

      state.session = { token: res.token, user: res.user };
      saveSession(state.session);
      renderSessionUI();
      closeLoginModal();
      setGlobalMsg("");
      await loadAllCoreData();
    } catch (err) {
      console.error(err);
      alert(err.message || "로그인 실패");
    } finally {
      setFormBusy(e.currentTarget, false);
    }
  }
  async function logout() {
    // Supabase 사용 시 auth 세션까지 종료해야 로그아웃이 유지됩니다.
    try {
      if (K && typeof K.supabaseEnabled === "function" && K.supabaseEnabled() && K.initSupabase() && typeof K.sbHardSignOut === "function") {
        await K.sbHardSignOut();
      } else if (typeof K.sbSignOut === "function") {
        await K.sbSignOut();
      }
    } catch {}

    state.session = null;
    saveSession(null);
    renderSessionUI();
    state.properties = [];
    state.staff = [];
    renderAll();
    goLoginPage(true);
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
    // 목록 첫 화면은 실제 존재가 확인된 컬럼 + raw만 가져온다.
    // 속도 개선용 경량 select에서 스키마 불일치(column does not exist)가 반복되어,
    // 가변 스키마 가능성이 큰 상세 필드는 raw 기준으로 파생한다.
    "id", "global_id", "item_no", "source_type", "is_general", "address", "assignee_id",
    "submitter_type", "broker_office_name", "submitter_name", "submitter_phone",
    "memo", "latitude", "longitude", "date_uploaded", "created_at",
    "geocode_status", "geocoded_at", "raw"
  ].join(",");

  function invalidatePropertyCollections() {
    state.propertiesFullCache = null;
    state.propertySummary = null;
  }

  function getAuxiliaryPropertiesSnapshot() {
    return Array.isArray(state.propertiesFullCache) && state.propertiesFullCache.length
      ? state.propertiesFullCache
      : state.properties;
  }

  function hasActivePropertyFilters() {
    const f = state.propertyFilters || {};
    return !!(
      String(f.activeCard || '').trim() ||
      String(f.status || '').trim() ||
      String(f.keyword || '').trim() ||
      String(f.area || '').trim() ||
      String(f.priceRange || '').trim() ||
      String(f.ratio50 || '').trim()
    );
  }

  function shouldUseFullPropertyDataset() {
    return hasActivePropertyFilters();
  }

  async function fetchPropertiesPageLight(sb, page, pageSize, { isAdmin, uid }) {
    const from = Math.max(0, (Math.max(1, Number(page || 1)) - 1) * pageSize);
    const to = from + pageSize - 1;
    const queryBase = () => sb
      .from("properties")
      .select(PROPERTY_LIST_SELECT, { count: "exact" })
      .order("date_uploaded", { ascending: false })
      .range(from, to);

    if (isAdmin) {
      const { data, error, count } = await queryBase();
      if (error) throw error;
      return { items: Array.isArray(data) ? data : [], total: Number(count || 0) };
    }

    const filters = [
      `assignee_id.eq.${uid},raw->>assigneeId.eq.${uid},raw->>assignedAgentId.eq.${uid},raw->>assignee_id.eq.${uid}`,
      `assignee_id.eq.${uid}`,
    ];
    let lastError = null;
    for (const filter of filters) {
      const { data, error, count } = await queryBase().or(filter);
      if (!error) {
        const rows = Array.isArray(data) ? data : [];
        return { items: rows.filter((row) => rowAssignedToUid(row, uid)), total: Number(count || rows.length || 0) };
      }
      lastError = error;
    }
    throw lastError;
  }

  async function fetchAllPropertiesLight(sb, { isAdmin, uid }) {
    const pageSize = 1000;
    const out = [];
    let page = 1;
    while (true) {
      const { items } = await fetchPropertiesPageLight(sb, page, pageSize, { isAdmin, uid });
      out.push(...items);
      if (items.length < pageSize) break;
      page += 1;
    }
    return out;
  }

  async function ensureFullPropertiesCache(sb, { isAdmin, uid, forceRefresh = false } = {}) {
    if (!forceRefresh && Array.isArray(state.propertiesFullCache)) return state.propertiesFullCache;
    const rows = await fetchAllPropertiesLight(sb, { isAdmin, uid });
    state.propertiesFullCache = Array.isArray(rows) ? rows.map(normalizeProperty) : [];
    return state.propertiesFullCache;
  }

  async function fetchPropertySummary(sb) {
    const countRows = async (builder) => {
      let q = sb.from("properties").select("id", { count: "exact", head: true });
      if (typeof builder === "function") q = builder(q) || q;
      const { count, error } = await q;
      if (error) throw error;
      return Number(count || 0);
    };

    const [total, auction, onbid, realtorTotal, realtorDirect, general] = await Promise.all([
      countRows(),
      countRows((q) => q.eq("source_type", "auction")),
      countRows((q) => q.eq("source_type", "onbid")),
      countRows((q) => q.eq("source_type", "realtor")),
      countRows((q) => q.eq("source_type", "realtor").eq("submitter_type", "realtor")),
      countRows((q) => q.eq("source_type", "general")),
    ]);

    return {
      total,
      auction,
      onbid,
      realtor_direct: realtorDirect,
      realtor_naver: Math.max(0, realtorTotal - realtorDirect),
      general,
    };
  }

  async function fetchPropertyDetail(sb, targetId) {
    const col = String(targetId || '').includes(':') ? 'global_id' : 'id';
    const { data, error } = await sb.from('properties').select('*').eq(col, targetId).limit(1).maybeSingle();
    if (error) throw error;
    return data ? normalizeProperty(data) : null;
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

      const needsFull = forceFull || shouldUseFullPropertyDataset() || state.activeTab === 'regions' || state.activeTab === 'geocoding';

      const summaryPromise = (refreshSummary || !state.propertySummary)
        ? fetchPropertySummary(sb).catch((err) => {
            console.warn('property summary load failed', err);
            return state.propertySummary;
          })
        : Promise.resolve(state.propertySummary);

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

      state.propertySummary = await summaryPromise;
      pruneSelectedPropertyIds();
      hydrateAssignedAgentNames();
      renderPropertiesTable();
      renderSummary();
      if (state.activeTab === 'geocoding') updateGeocodeStatusBar();
      if (state.activeTab === 'home') renderSummary();
      return;
    }

    const user = state.session?.user || null;
    const isAdmin = user?.role === "admin";
    const path = isAdmin ? "/properties?scope=all" : "/properties?scope=mine";
    const res = await api(path, { auth: true });
    state.properties = Array.isArray(res?.items) ? res.items.map(normalizeProperty) : [];
    state.propertyMode = 'full';
    state.propertyTotalCount = state.properties.length;
    pruneSelectedPropertyIds();
    hydrateAssignedAgentNames();
    renderPropertiesTable();
    renderSummary();
    updateGeocodeStatusBar();
    if (state.activeTab === "workmgmt") refreshWorkMgmt().catch((e)=>handleAsyncError(e,"업무 관리 로드 실패"));
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
    const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
    const rawSource = (item.sourceType || item.source || item.category || item.source_type || raw.sourceType || "").toString().toLowerCase();
    const sourceType =
      rawSource === "auction" ? "auction" :
      rawSource === "gongmae" || rawSource === "public" || rawSource === "onbid" ? "onbid" :
      rawSource === "realtor" ? "realtor" :
      rawSource === "general" ? "general" :
      "general";

    const itemNo = firstText(item.itemNo, item.caseNo, item.externalId, item.listingId, item.item_no, raw.itemNo, "");
    const address = firstText(item.address, item.location, item.addr, raw.address, "");

    const latitude = toNullableNumber(item.latitude ?? item.lat ?? item.y ?? raw.latitude ?? raw.lat ?? "");
    const longitude = toNullableNumber(item.longitude ?? item.lng ?? item.x ?? raw.longitude ?? raw.lng ?? "");
    const priceMain = toNullableNumber(item.priceMain ?? item.price_main ?? raw.priceMain ?? raw.price_main ?? raw["감정가"] ?? raw["감정가(원)"] ?? item.salePrice ?? item.price ?? item.appraisalPrice);
    const lowprice =
      sourceType === "realtor" || sourceType === "general"
        ? null
        : toNullableNumber(item.lowprice ?? item.low_price ?? raw.lowprice ?? raw.low_price ?? raw["최저가"] ?? raw["최저입찰가(원)"] ?? raw["매각가"] ?? item.currentPrice ?? item.current_price);

    const memoText = firstText(item.memo, raw.memo, "");
    const opinionText = sourceType === "onbid"
      ? sanitizeOnbidOpinion(firstText(item.opinion, raw.opinion, ""), memoText, address)
      : firstText(item.opinion, raw.opinion, memoText, "");

    const assignedAgentId = item.assignedAgentId || item.assigneeId || item.assignee_id || null;
    const assignedAgentName = assignedAgentId
      ? firstText(item.assignedAgentName, item.assigneeName, item.assignee_name, raw.assignedAgentName, raw.assigneeName, raw.assignee_name, "")
      : "";

    return {
      id: String(item.id || item._id || item.globalId || item.global_id || ""),
      globalId: String(item.globalId || item.global_id || (sourceType && itemNo ? `${sourceType}:${itemNo}` : "")),
      sourceType,
      itemNo,
      isGeneral: Boolean(item.isGeneral || item.is_general || item.origin === "general" || sourceType === "general"),
      address,
      assetType: firstText(item.assetType, item.asset_type, item.type, item.propertyType, item.kind, raw.assetType, raw['세부유형'], "-"),
      floor: firstText(item.floor, item.floor_text, item.floor_text, item.floor_korean, raw.floor, raw.floorText, raw["해당층"], extractFloorText(address, raw["물건명"], raw.address)),
      totalfloor: firstText(item.totalfloor, item.total_floor, item.totalfloor_text, item.totalfloor_snake, item.totalfloor_camel, item.totalfloor_korean, raw.totalfloor, raw.total_floor, raw.totalFloor, raw["총층"], ""),
      priceMain,
      lowprice,
      status: firstText(item.status, raw.status, ""),
      latitude,
      longitude,
      assignedAgentId,
      assignedAgentName,
      createdAt: firstText(item.date, item.date_uploaded, item.createdAt, item.created_at, raw.date, raw.createdAt, raw.date_uploaded, ""),
      duplicateFlag: !!item.duplicateFlag,
      regionGu: firstText(item.regionGu, item.region_gu, raw.regionGu, raw.region_gu, ""),
      regionDong: firstText(item.regionDong, item.region_dong, raw.regionDong, raw.region_dong, ""),
      memo: memoText,
      exclusivearea: toNullableNumber(item.exclusivearea ?? item.exclusive_area ?? item.exclusiveArea ?? raw.exclusivearea ?? raw.exclusiveArea ?? raw["전용면적(평)"]),
      commonarea: toNullableNumber(item.commonarea ?? item.common_area ?? item.commonArea ?? raw.commonarea ?? raw.commonArea ?? raw["공용면적(평)"]),
      sitearea: toNullableNumber(item.sitearea ?? item.site_area ?? item.siteArea ?? raw.sitearea ?? raw.siteArea ?? raw["토지면적(평)"]),
      useapproval: firstText(item.useapproval, item.use_approval, raw.useapproval, raw.use_approval, raw.useApproval, raw["사용승인일"], ""),
      dateMain: firstText(item.dateMain, item.date_main, raw.dateMain, raw.date_main, raw["입찰일자"], raw["입찰마감일시"], ""),
      sourceUrl: firstText(item.sourceUrl, item.source_url, raw.sourceUrl, raw.source_url, ""),
      submitterType: firstText(item.submitterType, item.submitter_type, raw.submitterType, ""),
      realtorname: firstText(item.realtorname, item.realtor_name, raw.realtorname, raw.realtorName, item.brokerOfficeName, item.broker_office_name, ""),
      realtorphone: firstText(item.realtorphone, item.realtor_phone, raw.realtorphone, raw.realtorPhone, ""),
      realtorcell: firstText(item.realtorcell, item.realtor_cell, raw.realtorcell, raw.realtorCell, item.submitterPhone, item.submitter_phone, ""),
      rightsAnalysis: firstText(item.rightsAnalysis, item.rights_analysis, raw.rightsAnalysis, raw.rights_analysis, ""),
      siteInspection: firstText(item.siteInspection, item.site_inspection, raw.siteInspection, raw.site_inspection, ""),
      opinion: opinionText,
      geocodeStatus: firstText(item.geocode_status, item.geocodeStatus, raw.geocode_status, ""),
      geocodedAt: firstText(item.geocoded_at, item.geocodedAt, ""),
      isDirectSubmission: !!(
        firstText(item.submitterName, item.submitter_name, raw.submitter_name, raw.submitterName, "") ||
        firstText(item.brokerOfficeName, item.broker_office_name, raw.broker_office_name, raw.brokerOfficeName, "")
      ),
      _raw: item,
    };
  }


  // ---------------------------
  // 신규 물건 등록 모달
  // ---------------------------
  function openNewPropertyModal() {
    if (!els.newPropertyModal || !els.newPropertyForm) return;
    els.newPropertyForm.reset();
    configureFormNumericUx(els.newPropertyForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain"] });
    if (els.npmRealtorFields) els.npmRealtorFields.classList.remove("hidden");
    if (els.npmOwnerFields) els.npmOwnerFields.classList.add("hidden");
    els.newPropertyForm.querySelectorAll(".npm-type-card").forEach((card) => {
      card.classList.toggle("is-active", !!card.querySelector("input[type=radio]")?.checked);
    });
    setNpmMsg("");
    setModalOpen(true);
    els.newPropertyModal.classList.remove("hidden");
    els.newPropertyModal.setAttribute("aria-hidden", "false");
  }

  function closeNewPropertyModal() {
    if (!els.newPropertyModal) return;
    els.newPropertyModal.classList.add("hidden");
    els.newPropertyModal.setAttribute("aria-hidden", "true");
    setModalOpen(false);
    setNpmMsg("");
  }

  function setNpmMsg(text, isError = true) {
    if (!els.npmMsg) return;
    els.npmMsg.style.color = isError ? "#ff8b8b" : "#9ff0b6";
    els.npmMsg.textContent = text || "";
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

  async function insertPropertyRowResilient(sb, row) {
    let current = { ...(row || {}) };
    const removed = new Set();
    for (let i = 0; i < 16; i += 1) {
      const { data, error } = await sb.from("properties").insert(current).select("id").limit(1);
      if (!error) {
        if (Array.isArray(data) && data.length) return data[0];
        return null;
      }
      const missing = extractSchemaMissingColumn(error);
      if (!missing || removed.has(missing) || !(missing in current)) throw error;
      removed.add(missing);
      current = omitKeys(current, [missing]);
    }
    throw new Error("properties insert failed after schema fallback retries");
  }

  async function updatePropertyRowResilient(sb, targetId, patch) {
    let current = { ...(patch || {}) };
    const removed = new Set();
    const col = String(targetId).includes(":") ? "global_id" : "id";
    for (let i = 0; i < 16; i += 1) {
      const { data, error } = await sb.from("properties").update(current).eq(col, targetId).select("id").limit(1);
      if (!error) {
        if (Array.isArray(data) && data.length) return data[0];
        throw Object.assign(new Error("NO_ROWS_UPDATED"), { code: "NO_ROWS_UPDATED" });
      }
      const missing = extractSchemaMissingColumn(error);
      if (!missing || removed.has(missing) || !(missing in current)) throw error;
      removed.add(missing);
      current = omitKeys(current, [missing]);
    }
    throw new Error("properties update failed after schema fallback retries");
  }

  async function submitNewProperty() {
    const f = els.newPropertyForm;
    const fd = new FormData(f);
    const readStr = (k) => String(fd.get(k) || "").trim();
    const readNum = (k) => parseFlexibleNumber(fd.get(k));

    const submitterKind = readStr("submitterKind") || "realtor";
    const sourceType = submitterKind === "realtor" ? "realtor" : "general";
    const address = readStr("address");
    const assetType = readStr("assetType");
    const priceMain = readNum("priceMain");

    if (!address || !assetType || !priceMain) throw new Error("주소, 세부유형, 매매가는 필수입니다.");

    const actorName = String(state.session?.user?.name || state.session?.user?.email || "").trim();
    let submitterName = "", submitterPhone = "", realtorName = null, realtorPhone = null, realtorCell = null;
    if (submitterKind === "realtor") {
      realtorName = readStr("realtorname");
      realtorPhone = readStr("realtorphone") || null;
      realtorCell = readStr("realtorcell");
      submitterName = actorName || readStr("submitterName") || null;
      submitterPhone = realtorCell;
      if (!realtorName || !realtorCell) throw new Error("중개사무소명과 휴대폰번호를 입력해 주세요.");
    } else {
      submitterName = readStr("submitterName") || actorName || "";
      submitterPhone = readStr("submitterPhone");
      if (!submitterName || !submitterPhone) throw new Error("이름과 연락처를 입력해 주세요.");
    }

    const payload = {
      source_type: sourceType,
      is_general: true,
      address,
      asset_type: assetType,
      price_main: priceMain,
      use_approval: readStr("useapproval") || null,
      common_area: readNum("commonarea"),
      exclusive_area: readNum("exclusivearea"),
      site_area: readNum("sitearea"),
      broker_office_name: realtorName,
      submitter_name: submitterName || null,
      submitter_phone: submitterPhone,
      memo: readStr("opinion") || null,
      raw: {
        sourceType,
        submitterType: submitterKind === "realtor" ? "realtor" : "owner",
        address, assetType, priceMain,
        floor: readStr("floor") || null,
        totalfloor: readStr("totalfloor") || null,
        useapproval: readStr("useapproval") || null,
        commonArea: readNum("commonarea"),
        exclusiveArea: readNum("exclusivearea"),
        siteArea: readNum("sitearea"),
        realtorName, realtorPhone, realtorCell,
        submitterName, submitterPhone,
        opinion: readStr("opinion") || null,
        registeredByAdmin: true,
        registeredByName: actorName || null,
      },
    };

    if (els.npmSave) els.npmSave.disabled = true;
    setNpmMsg("");
    try {
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      const regContext = buildRegisterLogContext("관리자 등록", state.session?.user);
      if (sb) {
        await ensureAuxiliaryPropertiesForAdmin();
        const existing = findExistingPropertyByRegistrationKey(payload.raw, getAuxiliaryPropertiesSnapshot());
        if (existing) {
          const merged = buildRegistrationDbRowForExisting(existing, payload, regContext);
          await updatePropertyRowResilient(sb, existing.id || existing.globalId, merged.row);
          setNpmMsg(merged.changes.length ? "기존 물건을 갱신하고 등록 LOG를 추가했습니다." : "동일 물건이 있어 기존 물건에 반영했습니다.", false);
        } else {
          await insertPropertyRowResilient(sb, buildRegistrationDbRowForCreate(payload, regContext));
          setNpmMsg("등록되었습니다.", false);
        }
      } else {
        await api("/public-listings", { method: "POST", body: payload });
        setNpmMsg("등록되었습니다.", false);
      }
      setTimeout(() => { closeNewPropertyModal(); invalidatePropertyCollections(); loadProperties(); }, 700);
    } finally {
      if (els.npmSave) els.npmSave.disabled = false;
    }
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

  function normalizeStaff(item) {
    return {
      id: item.id || "",
      email: item.email || "",
      name: item.name || item.email || "",
      role: normalizeRole(item.role),
      assignedRegions: Array.isArray(item.assignedRegions)
        ? item.assignedRegions
        : (Array.isArray(item.assigned_regions) ? item.assigned_regions : []),
      createdAt: item.createdAt || item.created_at || "",
    };
  }

  function dedupeStaff(items) {
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
    renderAssignmentTable();
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
    commonArea: "공용면적",
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
    memo: "메모/의견",
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
    if (PropertyDomain && typeof PropertyDomain.buildRegisterLogContext === "function") return PropertyDomain.buildRegisterLogContext(route, { user });
    return {
      at: new Date().toISOString(),
      route: String(route || "등록").trim(),
      actor: String(user?.name || user?.email || "").trim(),
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
    const parts = parseAddressIdentityParts(firstText(data?.address, data?.raw?.address, ""));
    const floorKey = parseFloorNumberForLog(firstText(data?.floor, data?.raw?.floor, "")) || "0";
    const hoKey = extractHoNumberForLog(data) || "0";
    if (!parts.dong || !parts.mainNo) return "";
    return `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey}|${hoKey}`;
  }

  function attachRegistrationIdentity(raw, data) {
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
      memo: firstText(item?.memo, item?.opinion, raw.memo, raw.opinion, ""),
      latitude: item?.latitude ?? raw.latitude ?? null,
      longitude: item?.longitude ?? raw.longitude ?? null,
    };
  }

  function buildRegistrationSnapshotFromDbRow(row) {
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
    const raw = item?._raw?.raw || {};
    if (Array.isArray(raw.registrationLog) && raw.registrationLog.length) return raw.registrationLog;
    const createdAt = firstText(raw.firstRegisteredAt, item?.createdAt, item?._raw?.created_at, item?._raw?.createdAt, "");
    if (!createdAt) return [];
    return [{ type: "created", at: createdAt, route: "최초 등록", actor: "" }];
  }

  function appendRegistrationCreateLog(raw, context) {
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
    const base = existingItem?._raw ? { ...existingItem._raw, raw: { ...(existingItem._raw.raw || {}) } } : { ...(incomingRow || {}), raw: { ...(incomingRow?.raw || {}) } };
    const prevSnapshot = existingItem?._raw ? buildRegistrationSnapshotFromItem(existingItem) : buildRegistrationSnapshotFromDbRow(base);
    const nextSnapshot = buildRegistrationSnapshotFromDbRow(incomingRow);
    const changes = buildRegistrationChanges(prevSnapshot, nextSnapshot);
    const nextRow = { ...base };
    ["address","asset_type","exclusive_area","common_area","site_area","use_approval","status","price_main","lowprice","date_main","source_url","broker_office_name","submitter_name","submitter_phone","memo","latitude","longitude","floor","total_floor"].forEach((key) => {
      if (hasMeaningfulValue(incomingRow?.[key])) nextRow[key] = incomingRow[key];
    });
    if (!hasMeaningfulValue(nextRow.item_no) && hasMeaningfulValue(incomingRow?.item_no)) nextRow.item_no = incomingRow.item_no;
    if (!hasMeaningfulValue(nextRow.source_type) && hasMeaningfulValue(incomingRow?.source_type)) nextRow.source_type = incomingRow.source_type;
    if (options.assignIfEmpty && !hasMeaningfulValue(nextRow.assignee_id) && hasMeaningfulValue(incomingRow?.assignee_id)) nextRow.assignee_id = incomingRow.assignee_id;
    const mergedRaw = mergeMeaningfulShallow(base.raw || {}, incomingRow?.raw || {});
    nextRow.raw = attachRegistrationIdentity(appendRegistrationChangeLog(mergedRaw, context, changes), nextSnapshot);
    return { row: nextRow, changes };
  }

  function buildRegistrationDbRowForCreate(row, context) {
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
    container.innerHTML = reversed.map((entry) => {
      const meta = [formatRegLogAt(entry.at || entry.date || ""), entry.route || "", entry.actor || ""].filter(Boolean).map((v) => `<span>${esc(v)}</span>`).join("");
      if (entry.type === "created") {
        return `<div class="reglog-item">
          <div class="reglog-meta">${meta}</div>
          <div class="reglog-badge">최초 등록</div>
        </div>`;
      }
      const changes = (Array.isArray(entry.changes) ? entry.changes : []).filter((change) => change?.field !== "submitterPhone" && change?.label !== "등록자 연락처");
      const rows = changes.length
        ? `<div class="reglog-changes">${changes.map((change) => `<div class="reglog-change-row"><span class="reglog-label">${esc(change.label || "")}</span><span class="reglog-arrow">${esc(change.before || "-")}</span><span class="reglog-sep">→</span><span class="reglog-arrow is-next">${esc(change.after || "-")}</span></div>`).join("")}</div>`
        : `<div class="reglog-badge">변경 없음</div>`;
      return `<div class="reglog-item">
        <div class="reglog-meta">${meta}</div>
        ${rows}
      </div>`;
    }).join("");
  }

  // ---------------------------
  // Opinion History 유틸
  // ---------------------------
  function loadOpinionHistory(item) {
    const raw = item?._raw?.raw || {};
    const hist = raw.opinionHistory;
    if (Array.isArray(hist)) return hist;
    // 기존 opinion 텍스트가 있으면 히스토리 첫 항목으로 변환
    const legacy = String(item?.opinion || raw.opinion || "").trim();
    if (legacy) {
      return [{ date: formatDate(item?.createdAt) || "unknown", text: legacy, author: "" }];
    }
    return [];
  }

  function appendOpinionEntry(history, newText, user) {
    const text = String(newText || "").trim();
    if (!text) return history; // 빈 텍스트면 추가하지 않음
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();
    const author = String(user?.name || user?.email || "").trim();
    return [...history, { date: today, text, author }];
  }

  function renderOpinionHistory(container, history, isAdmin) {
    if (!container) return;
    if (!history.length) {
      container.innerHTML = '<div class="history-empty">등록된 의견이 없습니다.</div>';
      return;
    }
    const reversed = [...history].reverse(); // 최신 순
    container.innerHTML = reversed.map((entry, idx) => {
      const realIdx = history.length - 1 - idx; // 원본 배열 index
      const adminControls = isAdmin
        ? `<div class="history-actions">
            <button type="button" class="history-edit-btn" data-idx="${realIdx}" title="수정">✎</button>
            <button type="button" class="history-del-btn" data-idx="${realIdx}" title="삭제">✕</button>
           </div>`
        : "";
      return `<div class="history-item" data-idx="${realIdx}">
        <div class="history-meta">
          <span class="history-date">${esc(entry.date || "")}</span>
          ${entry.author ? `<span class="history-author">${esc(entry.author)}</span>` : ""}
          ${adminControls}
        </div>
        <div class="history-text" id="historyText_${realIdx}">${esc(entry.text || "")}</div>
        <div class="history-edit-area hidden" id="historyEdit_${realIdx}">
          <textarea class="input history-edit-textarea" rows="3">${esc(entry.text || "")}</textarea>
          <div class="history-edit-btns">
            <button type="button" class="btn btn-primary btn-sm history-save-btn" data-idx="${realIdx}">저장</button>
            <button type="button" class="btn btn-ghost btn-sm history-cancel-btn" data-idx="${realIdx}">취소</button>
          </div>
        </div>
      </div>`;
    }).join("");

    if (!isAdmin) return;

    // 편집 버튼 이벤트 (관리자만)
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
        hist[idx] = { ...hist[idx], text: newText };
        await patchOpinionHistory(item, hist);
        // 로컬 상태 갱신
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
        hist.splice(idx, 1);
        await patchOpinionHistory(item, hist);
        if (item._raw?.raw) item._raw.raw.opinionHistory = hist;
        renderOpinionHistory(container, hist, true);
      });
    });
  }

  async function patchOpinionHistory(item, history) {
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    if (!sb) throw new Error("Supabase 연동 필요");
    const targetId = item.id || item.globalId;
    const col = String(targetId).includes(":") ? "global_id" : "id";
    const latestOpinion = history.length ? history[history.length - 1].text : null;
    const currentRaw = item?._raw?.raw && typeof item._raw.raw === "object" ? { ...item._raw.raw } : {};
    const nextRaw = { ...currentRaw, opinionHistory: history, opinion: latestOpinion, memo: latestOpinion };
    const { error } = await sb.from("properties").update({ memo: latestOpinion, raw: nextRaw }).eq(col, targetId);
    if (error) throw error;
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
    return callAdminModule("staffRegions", "renderAssignmentTable", args);
  }

  // ---------------------------
  // CSV Import (Properties)
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

  // ---------------------------
  // Region Assignments  // ---------------------------
  // Region Assignments

  // ---------------------------
  function getRegionOptionsFromProperties(...args) {
    return callAdminModule("staffRegions", "getRegionOptionsFromProperties", args);
  }
  async function handleSuggestGrouping(...args) {
    return callAdminModule("staffRegions", "handleSuggestGrouping", args);
  }
  function renderGroupSuggestion(...args) {
    return callAdminModule("staffRegions", "renderGroupSuggestion", args);
  }
  async function handleSaveAssignments(...args) {
    return callAdminModule("staffRegions", "handleSaveAssignments", args);
  }

  /**
   * 자동 그룹핑 휴리스틱 (초기 버전)
   * - 주소 기반으로 구/동 추출된 값을 사용
   * - auto 모드에서 X > 구개수 이면 동 단위로 전환
   * - 같은 구 우선 배치 + (가능하면) 인접 구 함께 배치
   */
  function buildAutoRegionGrouping(...args) {
    return callAdminModule("staffRegions", "buildAutoRegionGrouping", args);
  }
function sortGuUnitsByAdjacency(...args) {
    return callAdminModule("staffRegions", "sortGuUnitsByAdjacency", args);
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
    if (v === "auction") return "경매";
    if (v === "gongmae") return "공매";
    return "일반";
  }

  function statusLabel(v) {
    if (v === "active") return "진행중";
    if (v === "hold") return "보류";
    if (v === "closed") return "종결";
    if (v === "review") return "검토중";
    return v || "-";
  }

  function formatMoneyKRW(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
  }

  function formatPercent(base, current, raw = null) {
    const b = Number(base || 0);
    const c = Number(current || 0);
    if (Number.isFinite(b) && Number.isFinite(c) && b > 0 && c > 0) return `${((c / b) * 100).toFixed(1)}%`;
    const rawRate = raw && (raw["최저입찰가율(%)"] || raw.bidRate || raw.rate);
    if (rawRate != null && String(rawRate).trim() !== "") return String(rawRate).trim();
    return "-";
  }

  function formatAreaPyeong(v) {
    if (v == null || v === "") return "-";
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "-";
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function toNullableNumber(v) {
    if (Shared && typeof Shared.toNullableNumber === "function") return Shared.toNullableNumber(v);
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function firstText(...values) {
    if (PropertyDomain && typeof PropertyDomain.pickFirstText === "function") return PropertyDomain.pickFirstText(...values);
    for (const value of values) {
      if (value == null) continue;
      const s = String(value).trim();
      if (s) return s;
    }
    return "";
  }

  function buildKakaoMapLink(p) {
    if (p.latitude == null || p.longitude == null) return "";
    const label = encodeURIComponent(p.address || p.assetType || "매물 위치");
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

  function mergePropertyRaw(item, patch) {
    const currentRaw = item?._raw?.raw && typeof item._raw.raw === "object" ? { ...item._raw.raw } : {};
    const hasOwnAssignee = Object.prototype.hasOwnProperty.call(patch || {}, "assigneeId");
    const assigneeId = hasOwnAssignee
      ? (patch.assigneeId || null)
      : (item?.assignedAgentId ?? currentRaw.assigneeId ?? currentRaw.assignedAgentId ?? currentRaw.assignee_id ?? null);
    const assigneeName = assigneeId ? (getStaffNameById(assigneeId) || "") : null;
    return {
      ...currentRaw,
      itemNo: patch.itemNo ?? currentRaw.itemNo ?? null,
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
      realtorname: patch.realtorname ?? currentRaw.realtorname ?? null,
      realtorphone: patch.realtorphone ?? currentRaw.realtorphone ?? null,
      realtorcell: patch.realtorcell ?? currentRaw.realtorcell ?? null,
      rightsAnalysis: patch.rightsAnalysis ?? currentRaw.rightsAnalysis ?? null,
      siteInspection: patch.siteInspection ?? currentRaw.siteInspection ?? null,
      opinion: patch.opinion ?? currentRaw.opinion ?? null,
      memo: patch.opinion ?? currentRaw.memo ?? null,
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
    const rawObj = p?._raw?.raw && typeof p._raw.raw === 'object' ? p._raw.raw : (p?._raw || {});
    const rawValue = p?.dateMain || rawObj["입찰일자"] || rawObj["입찰마감일시"] || "";
    const display = formatDate(rawValue);
    const dday = computeDdayLabel(rawValue);
    const dateText = (!display || display === "-") ? "-" : display;
    return `<span class="schedule-stack"><span class="schedule-date">${escapeHtml(dateText)}</span>${dday ? `<span class="schedule-dday">${escapeHtml(dday)}</span>` : `<span class="schedule-dday schedule-dday-empty"></span>`}</span>`;
  }

  function formatDate(v) {
    if (!v) return "-";
    const d = parseFlexibleDate(v);
    if (!d) return String(v || "-");
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function normalizePhone(v) {
    return String(v || "").replace(/[^\d]/g, "");
  }

  function formatPhoneDisplay(v) {
    const n = normalizePhone(v);
    if (n.length === 11) return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`;
    if (n.length === 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
    return n;
  }

  function showResultBox(el, text, isError = false) {
    if (!el) return;
    el.classList.remove("hidden");
    el.classList.toggle("is-error", !!isError);
    el.classList.toggle("is-success", !isError);
    el.textContent = text;
  }

  function setFormBusy(form, busy) {
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
    if (Shared && typeof Shared.escapeHtml === "function") return Shared.escapeHtml(v);
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(v) {
    if (Shared && typeof Shared.escapeAttr === "function") return Shared.escapeAttr(v);
    return escapeHtml(v).replaceAll("`", "&#96;");
  }

  function $(sel) {
    return document.querySelector(sel);
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
