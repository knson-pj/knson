(() => {
  const ADMIN_FAST_BUILD = "20260324-adminfast4";
  try { console.info("[admin-app] build", ADMIN_FAST_BUILD); } catch {}

  "use strict";

  const K = window.KNSN || null;
  const toNumber = (K && typeof K.toNumber === "function") ? K.toNumber : (v) => {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim();
    if (!s) return NaN;
    const s2 = s.replace(/,/g, "");
    const m = s2.match(/[+-]?\d+(\.\d+)?/);
    if (!m) return NaN;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : NaN;
  };

  function parseFlexibleNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const s = String(value).trim();
    if (!s) return null;
    const n = toNumber(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function formatMoneyInputValue(value) {
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
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "decimal");
    input.removeAttribute("step");
  }

  function configureAmountInput(input) {
    if (!input) return;
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.removeAttribute("step");
    bindAmountInputMask(input);
  }

  function configureFormNumericUx(form, options = {}) {
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
    const v = String(value || '').trim().toLowerCase();
    if (v === '관리자' || v === 'admin') return 'admin';
    if (v === '기타' || v === 'other') return 'other';
    return 'staff';
  }

  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function") ? window.KNSN.getApiBase() : "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";

  const state = {
    session: loadSession(),
    activeTab: "properties",
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
    configureFormNumericUx(els.aemForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea", "latitude", "longitude"], amountNames: ["priceMain", "lowprice"] });
    configureFormNumericUx(els.newPropertyForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain"] });
    setupChrome();
    bindEvents();
    resetStaffForm();
    renderSessionUI();
    ensureLoginThenLoad();
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
      tabProperties: $("#tab-properties"),
      tabCsv: $("#tab-csv"),
      tabStaff: $("#tab-staff"),
      tabRegions: $("#tab-regions"),

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
          if (key === "staff") loadStaff().catch((e)=>handleAsyncError(e,"담당자 로드 실패"));
          if (key === "regions") ensureAuxiliaryPropertiesForAdmin().then(() => { renderAssignmentTable(); }).catch((e)=>handleAsyncError(e,"지역 데이터 로드 실패"));
          if (key === "geocoding") ensureAuxiliaryPropertiesForAdmin().then(() => { updateGeocodeStatusBar(); }).catch((e)=>handleAsyncError(e,"지오코딩 데이터 로드 실패"));
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
      properties: els.tabProperties,
      csv: els.tabCsv,
      staff: els.tabStaff,
      regions: els.tabRegions,
      geocoding: els.tabGeocoding,
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
  }


  async function ensureAuxiliaryPropertiesForAdmin(options = {}) {
    const sb = isSupabaseMode() ? K.initSupabase() : null;
    if (!sb) return getAuxiliaryPropertiesSnapshot();
    const user = state.session?.user || loadSession()?.user || null;
    const uid = String(user?.id || '').trim();
    const isAdmin = user?.role === 'admin';
    return ensureFullPropertiesCache(sb, { isAdmin, uid, forceRefresh: !!options.forceRefresh });
  }

  async function loadStaff() {
    await syncSupabaseSessionIfNeeded();

    const res = await api("/admin/staff", { auth: true });
    state.staff = dedupeStaff(res?.items || []);
    renderStaffTable();
    renderAssignmentTable();
    renderSummary();
    hydrateAssignedAgentNames();
    renderPropertiesTable();
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

  function renderSummary() {
    const props = getAuxiliaryPropertiesSnapshot();
    const staff = state.staff;
    const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
    const summary = state.propertySummary || {
      total: props.length,
      auction: props.filter((p) => p.sourceType === "auction").length,
      onbid: props.filter((p) => p.sourceType === "onbid").length,
      realtor_naver: props.filter((p) => p.sourceType === "realtor" && !p.isDirectSubmission).length,
      realtor_direct: props.filter((p) => p.sourceType === "realtor" && p.isDirectSubmission).length,
      general: props.filter((p) => p.sourceType === "general").length,
    };

    if (els.sumTotal) els.sumTotal.textContent = fmt(summary.total);
    if (els.sumAuction) els.sumAuction.textContent = fmt(summary.auction);
    if (els.sumGongmae) els.sumGongmae.textContent = fmt(summary.onbid);
    if (els.sumNaverRealtor) els.sumNaverRealtor.textContent = fmt(summary.realtor_naver);
    if (els.sumDirectRealtor) els.sumDirectRealtor.textContent = fmt(summary.realtor_direct);
    if (els.sumGeneral) els.sumGeneral.textContent = fmt(summary.general);

    if (els.sumAgents) els.sumAgents.textContent = fmt(staff.filter(s => normalizeRole(s.role) === "staff").length);
  }

  function getFilteredProperties() {
    const f = state.propertyFilters;
    const kw = (f.keyword || "").toLowerCase().trim();

    return state.properties.filter((p) => {
      // 카드 클릭 필터
      if (f.activeCard && f.activeCard !== "all") {
        if (f.activeCard === "realtor_naver") {
          if (p.sourceType !== "realtor" || p.isDirectSubmission) return false;
        } else if (f.activeCard === "realtor_direct") {
          if (p.sourceType !== "realtor" || !p.isDirectSubmission) return false;
        } else if (["auction", "onbid", "general"].includes(f.activeCard)) {
          if (p.sourceType !== f.activeCard) return false;
        }
      }

      // 상태 필터
      if (f.status) {
        if ((p.status || "") !== f.status && !(p.status || "").includes(f.status)) return false;
      }

      // 면적 필터 (전용면적 평)
      if (f.area) {
        const [minStr, maxStr] = f.area.split("-");
        const min = parseFloat(minStr) || 0;
        const max = maxStr ? parseFloat(maxStr) : Infinity;
        const area = p.exclusivearea;
        if (area == null || area <= 0) return false;
        if (area < min || (max !== Infinity && area >= max)) return false;
      }

      // 가격대 필터: 경매/공매 → 현재가(lowprice), 중개/일반 → 매각가(priceMain)
      if (f.priceRange) {
        const [minStr, maxStr] = f.priceRange.split("-");
        const min = (parseFloat(minStr) || 0) * 100000000;
        const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
        const isAuctionType = p.sourceType === "auction" || p.sourceType === "onbid";
        const price = isAuctionType ? (p.lowprice ?? p.priceMain) : p.priceMain;
        if (!price || price <= 0) return false;
        if (price < min || (max !== Infinity && price >= max)) return false;
      }

      // 50% 이하 비율 필터 (경매/공매만)
      if (f.ratio50) {
        if (p.sourceType !== "auction" && p.sourceType !== "onbid") return false;
        if (!p.priceMain || !p.lowprice || p.priceMain <= 0) return false;
        if ((p.lowprice / p.priceMain) > 0.5) return false;
      }

      // 키워드 필터
      if (kw) {
        const hay = [
          p.itemNo, p.address, p.assetType, p.floor, p.totalfloor,
          p.rightsAnalysis, p.siteInspection, p.opinion,
          (p.assignedAgentName || getStaffNameById(p.assignedAgentId)),
          p.regionGu, p.regionDong, p.status,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(kw)) return false;
      }

      return true;
    });
  }


  function getPagedProperties(rows) {
    const totalPages = Math.max(1, Math.ceil(rows.length / state.propertyPageSize));
    if (state.propertyPage > totalPages) state.propertyPage = totalPages;
    if (state.propertyPage < 1) state.propertyPage = 1;
    const start = (state.propertyPage - 1) * state.propertyPageSize;
    return { totalPages, rows: rows.slice(start, start + state.propertyPageSize) };
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
    return {
      at: new Date().toISOString(),
      route: String(route || "등록").trim(),
      actor: String(user?.name || user?.email || "").trim(),
    };
  }

  function normalizeCompareValue(field, value) {
    if (value === null || value === undefined) return "";
    if (["priceMain", "lowprice", "commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"].includes(field)) {
      const n = toNullableNumber(value);
      return n == null ? "" : String(n);
    }
    return String(value).trim().replace(/\s+/g, " ");
  }

  function formatFieldValueForLog(field, value) {
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

  function renderAdminPropertiesPagination(totalPages) {
    if (!els.adminPropertiesPagination) return;
    els.adminPropertiesPagination.innerHTML = "";
    if (totalPages <= 1) {
      els.adminPropertiesPagination.classList.add("hidden");
      return;
    }
    els.adminPropertiesPagination.classList.remove("hidden");

    const cur = state.propertyPage;
    const scrollTop = () => {
      const wrap = els.propertiesTableBody?.closest(".table-wrap");
      if (wrap) window.scrollTo({ top: wrap.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
    };
    const go = async (page) => {
      state.propertyPage = Math.max(1, Math.min(totalPages, page));
      if (state.propertyMode === 'page') {
        try {
          await loadProperties({ refreshSummary: false });
        } catch (err) {
          handleAsyncError(err, '물건 목록 로드 실패');
        }
      } else {
        renderPropertiesTable();
      }
      scrollTop();
    };

    const frag = document.createDocumentFragment();
    const addBtn = (label, page, disabled = false, active = false, title = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = active ? "pager-num is-active" : (typeof label === "number" ? "pager-num" : "pager-btn");
      b.textContent = String(label);
      b.disabled = disabled;
      if (title) b.title = title;
      if (!disabled) b.addEventListener("click", () => { void go(page); });
      frag.appendChild(b);
    };

    addBtn("<<", cur - 20, cur - 20 < 1, false, "20페이지 뒤로");
    addBtn("<", cur - 10, cur - 10 < 1, false, "10페이지 뒤로");
    addBtn("이전", cur - 1, cur <= 1);

    const blockSize = 10;
    const blockStart = Math.floor((cur - 1) / blockSize) * blockSize + 1;
    const blockEnd = Math.min(totalPages, blockStart + blockSize - 1);
    for (let p = blockStart; p <= blockEnd; p++) {
      addBtn(p, p, false, p === cur);
    }

    addBtn("다음", cur + 1, cur >= totalPages);
    addBtn(">", cur + 10, cur + 10 > totalPages, false, "10페이지 앞으로");
    addBtn(">>", cur + 20, cur + 20 > totalPages, false, "20페이지 앞으로");

    els.adminPropertiesPagination.appendChild(frag);
  }

  function pruneSelectedPropertyIds() {
    const valid = new Set(state.properties.map((p) => String(p.id || p.globalId || "")).filter(Boolean));
    state.selectedPropertyIds = new Set([...state.selectedPropertyIds].filter((id) => valid.has(String(id))));
    updatePropertySelectionControls();
  }

  function togglePropertySelection(id, checked) {
    const key = String(id || "").trim();
    if (!key) return;
    if (checked) state.selectedPropertyIds.add(key);
    else state.selectedPropertyIds.delete(key);
    updatePropertySelectionControls();
  }

  function toggleSelectAllProperties(checked) {
    const rows = state.propertyMode === 'page' ? state.properties : getPagedProperties(getFilteredProperties()).rows;
    rows.forEach((p) => {
      const key = String(p.id || p.globalId || "").trim();
      if (!key) return;
      if (checked) state.selectedPropertyIds.add(key);
      else state.selectedPropertyIds.delete(key);
    });
    renderPropertiesTable();
  }

  function updatePropertySelectionControls() {
    const rows = state.propertyMode === 'page' ? state.properties : getPagedProperties(getFilteredProperties()).rows;
    const ids = rows.map((p) => String(p.id || p.globalId || "").trim()).filter(Boolean);
    const selectedVisible = ids.filter((id) => state.selectedPropertyIds.has(id));
    if (els.propSelectAll) {
      els.propSelectAll.checked = ids.length > 0 && selectedVisible.length === ids.length;
      els.propSelectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < ids.length;
    }
    if (els.btnDeleteSelectedProperties) {
      const cnt = state.selectedPropertyIds.size;
      els.btnDeleteSelectedProperties.disabled = cnt === 0;
      els.btnDeleteSelectedProperties.textContent = cnt > 0 ? `선택 삭제 (${cnt})` : '선택 삭제';
    }
  }

  async function deleteSelectedProperties() {
    const ids = [...state.selectedPropertyIds].filter(Boolean);
    if (!ids.length) {
      alert('삭제할 물건을 먼저 선택해 주세요.');
      return;
    }
    const ok = window.confirm(`선택한 ${ids.length}건의 물건을 삭제할까요?`);
    if (!ok) return;

    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    if (sb) {
      for (const chunk of chunkArray(ids, 100)) {
        const pureIds = chunk.filter((v) => !String(v).includes(':'));
        const globalIds = chunk.filter((v) => String(v).includes(':'));
        if (pureIds.length) {
          const { error } = await sb.from('properties').delete().in('id', pureIds);
          if (error) throw error;
        }
        if (globalIds.length) {
          const { error } = await sb.from('properties').delete().in('global_id', globalIds);
          if (error) throw error;
        }
      }
    } else {
      await api('/admin/properties', { method: 'DELETE', auth: true, body: { ids } });
    }

    state.selectedPropertyIds.clear();
    invalidatePropertyCollections();
    await loadProperties();
  }


  async function deleteAllProperties() {
    const total = Number(state.propertySummary?.total || state.propertyTotalCount || (Array.isArray(state.properties) ? state.properties.length : 0));
    if (!total) {
      alert('삭제할 물건이 없습니다.');
      return;
    }
    const ok = window.confirm(`현재 등록된 물건 ${total.toLocaleString('ko-KR')}건을 전체삭제할까요? 이 작업은 되돌릴 수 없습니다.`);
    if (!ok) return;
    const ok2 = window.confirm('정말로 전체삭제를 진행할까요?');
    if (!ok2) return;

    await api('/admin/properties', { method: 'DELETE', auth: true, body: { all: true } });

    state.selectedPropertyIds.clear();
    invalidatePropertyCollections();
    await loadProperties();
    alert('전체삭제가 완료되었습니다.');
  }

  function renderPropertiesTable() {
    const pageMode = state.propertyMode === 'page';
    const rows = pageMode ? state.properties : getFilteredProperties();
    const totalPages = pageMode
      ? Math.max(1, Math.ceil(Number(state.propertyTotalCount || 0) / state.propertyPageSize))
      : Math.max(1, Math.ceil(rows.length / state.propertyPageSize));
    const displayRows = pageMode ? rows : getPagedProperties(rows).rows;

    els.propertiesTableBody.innerHTML = "";

    if (!rows.length) {
      els.propertiesEmpty.classList.remove("hidden");
      updatePropertySelectionControls();
      renderAdminPropertiesPagination(0);
      return;
    }
    els.propertiesEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    for (const p of displayRows) {
      const rowId = String(p.id || p.globalId || "").trim();
      const tr = document.createElement("tr");
      if (rowId && state.selectedPropertyIds.has(rowId)) tr.classList.add('row-selected');
      const kindLabel = p.sourceType === "auction" ? "경매" : p.sourceType === "onbid" ? "공매" : p.sourceType === "realtor" ? "중개" : "일반";
      const moveLink = buildKakaoMapLink(p);
      const currentPrice = p.lowprice != null ? formatMoneyKRW(p.lowprice) : "-";
      const rate = formatPercent(p.priceMain, p.lowprice, p._raw || {});

      tr.innerHTML = `
        <td class="check-col"><label class="check-wrap"><input class="prop-row-check" type="checkbox" data-prop-id="${escapeAttr(rowId)}" ${rowId && state.selectedPropertyIds.has(rowId) ? 'checked' : ''} /><span></span></label></td>
        <td>${escapeHtml(p.itemNo || "-")}</td>
        <td><span class="kind-text ${escapeAttr(p.sourceType === "auction" ? "kind-auction" : p.sourceType === "onbid" ? "kind-gongmae" : p.sourceType === "realtor" ? "kind-realtor" : "kind-general")}">${escapeHtml(kindLabel)}</span></td>
        <td class="text-cell"><button type="button" class="address-trigger">${escapeHtml(p.address || "-")}</button></td>
        <td>${escapeHtml(p.assetType || "-")}</td>
        <td>${escapeHtml(String(p.floor || "-"))}</td>
        <td>${escapeHtml(String(p.totalfloor || "-"))}</td>
        <td>${escapeHtml(formatDate(p.useapproval) || "-")}</td>
        <td>${p.commonarea != null ? escapeHtml(formatAreaPyeong(p.commonarea)) : "-"}</td>
        <td>${p.exclusivearea != null ? escapeHtml(formatAreaPyeong(p.exclusivearea)) : "-"}</td>
        <td>${p.priceMain != null ? formatMoneyKRW(p.priceMain) : "-"}</td>
        <td>${escapeHtml(currentPrice)}</td>
        <td>${escapeHtml(rate)}</td>
        <td class="schedule-cell">${formatScheduleHtml(p)}</td>
        <td>${escapeHtml(statusLabel(p.status) || p.status || "-")}</td>
        <td>${moveLink ? `<a class="map-link" href="${escapeAttr(moveLink)}" target="_blank" rel="noopener noreferrer">이동</a>` : "-"}</td>
        <td>${escapeHtml(formatDate(p.createdAt) || "-")}</td>
        <td>${escapeHtml((p.assignedAgentName || getStaffNameById(p.assignedAgentId)) || "미배정")}</td>
        <td class="text-cell">${escapeHtml(p.rightsAnalysis || "-")}</td>
        <td class="text-cell">${escapeHtml(p.siteInspection || "-")}</td>
        <td class="text-cell opinion-cell">${escapeHtml(p.opinion || "-")}</td>
      `;

      const checkbox = tr.querySelector('.prop-row-check');
      if (checkbox) {
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', (e) => {
          togglePropertySelection(rowId, !!e.target.checked);
          tr.classList.toggle('row-selected', !!e.target.checked);
        });
      }

      const addressTrigger = tr.querySelector('.address-trigger');
      if (addressTrigger) {
        addressTrigger.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          void openPropertyEditModal(p);
        });
      }
      frag.appendChild(tr);
    }
    els.propertiesTableBody.appendChild(frag);
    updatePropertySelectionControls();
    renderAdminPropertiesPagination(totalPages);
  }

  // ---------------------------
  // Property Edit Modal
  // ---------------------------
  async function ensureStaffForPropertyModal() {
    try {
      await syncSupabaseSessionIfNeeded();
      const res = await api("/admin/staff", { auth: true });
      state.staff = dedupeStaff(res?.items || []);
      renderSummary();
    } catch (err) {
      console.warn("ensureStaffForPropertyModal failed", err);
    }
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

  async function openPropertyEditModal(item) {
    if (!els.propertyEditModalAdmin || !els.aemForm) return;

    const user = state.session?.user;
    const isAdmin = user?.role === "admin";

    let workingItem = item;

    if (!isAdmin) {
      const myId = user?.id || "";
      const assignedId = workingItem?.assignedAgentId || "";
      if (assignedId && myId && assignedId !== myId) {
        alert("본인에게 배정된 물건만 수정할 수 있습니다.");
        return;
      }
    }
    const sb = isSupabaseMode() ? K.initSupabase() : null;
    const detailTargetId = String(workingItem?.id || workingItem?.globalId || '').trim();
    if (sb && detailTargetId) {
      try {
        const detailed = await fetchPropertyDetail(sb, detailTargetId);
        if (detailed) workingItem = detailed;
      } catch (err) {
        console.warn('property detail load failed', err);
      }
    }

    state.editingProperty = workingItem;

    if (isAdmin) {
      await ensureStaffForPropertyModal();
    }

    const f = els.aemForm;
    const setVal = (name, v) => {
      const el = f.elements[name];
      if (!el) return;
      el.value = v == null ? "" : String(v);
    };

    setVal("itemNo", workingItem.itemNo);
    setVal("sourceType", workingItem.sourceType);
    populateAssigneeSelect(workingItem.assignedAgentId || workingItem.assigneeId || workingItem.assignee_id || "");
    setVal("submitterType", workingItem.submitterType);
    setVal("address", workingItem.address);
    setVal("assetType", workingItem.assetType);
    setVal("floor", workingItem.floor ?? "");
    setVal("totalfloor", workingItem.totalfloor ?? "");
    setVal("commonarea", formatModalAreaValue(workingItem.sourceType, workingItem.commonarea ?? ""));
    setVal("exclusivearea", formatModalAreaValue(workingItem.sourceType, workingItem.exclusivearea ?? ""));
    setVal("sitearea", formatModalAreaValue(workingItem.sourceType, workingItem.sitearea ?? ""));
    setVal("useapproval", workingItem.useapproval ?? "");
    setVal("status", workingItem.status ?? "");
    setVal("priceMain", formatMoneyInputValue(workingItem.priceMain ?? ""));
    setVal("lowprice", formatMoneyInputValue(workingItem.lowprice ?? ""));
    setVal("dateMain", toInputDateTimeLocal(workingItem.dateMain) ?? "");
    setVal("sourceUrl", workingItem.sourceUrl ?? "");
    setVal("date", formatDate(workingItem.createdAt) ?? "");
    setVal("realtorname", workingItem.realtorname ?? "");
    setVal("realtorphone", workingItem.realtorphone ?? "");
    setVal("realtorcell", workingItem.realtorcell ?? "");
    setVal("rightsAnalysis", workingItem.rightsAnalysis ?? "");
    setVal("siteInspection", workingItem.siteInspection ?? "");
    setVal("opinion", "");   // 매일 신규 작성 — 기존 내용 불러오지 않음
    setVal("latitude", workingItem.latitude ?? "");
    setVal("longitude", workingItem.longitude ?? "");

    configureFormNumericUx(f, { decimalNames: ["commonarea", "exclusivearea", "sitearea", "latitude", "longitude"], amountNames: ["priceMain", "lowprice"] });
    toggleBrokerFieldsBySource(workingItem.sourceType);

    // opinion 잠금 해제 (항상 신규 작성 가능)
    const opinionEl = f.elements["opinion"];
    if (opinionEl) opinionEl.disabled = false;

    // 물건 History 렌더
    renderOpinionHistory(els.aemHistoryList, loadOpinionHistory(workingItem), true);
    renderRegistrationLog(els.aemRegistrationLogList, loadRegistrationLog(workingItem));

    const sourceTypeEl = f.elements["sourceType"];
    if (sourceTypeEl) {
      sourceTypeEl.onchange = () => toggleBrokerFieldsBySource(sourceTypeEl.value);
    }

    const hasText = (v) => v != null && String(v).trim() !== "";
    const hasNum = (v) => v != null && String(v).trim() !== "" && !Number.isNaN(Number(v));

    const lockIfHas = (name, has) => {
      const el = f.elements[name];
      if (!el) return;
      el.disabled = !isAdmin && has;
    };

    lockIfHas("itemNo", hasText(workingItem.itemNo));
    lockIfHas("address", hasText(workingItem.address));
    lockIfHas("assetType", hasText(workingItem.assetType));
    lockIfHas("floor", hasText(workingItem.floor));
    lockIfHas("totalfloor", hasText(workingItem.totalfloor));
    lockIfHas("commonarea", hasNum(workingItem.commonarea));
    lockIfHas("exclusivearea", hasNum(workingItem.exclusivearea));
    lockIfHas("sitearea", hasNum(workingItem.sitearea));
    lockIfHas("useapproval", hasText(workingItem.useapproval));
    lockIfHas("status", hasText(workingItem.status));
    lockIfHas("priceMain", hasNum(workingItem.priceMain));
    lockIfHas("lowprice", hasNum(workingItem.lowprice));
    lockIfHas("dateMain", hasText(workingItem.dateMain));
    lockIfHas("sourceUrl", hasText(workingItem.sourceUrl));
    lockIfHas("realtorname", hasText(workingItem.realtorname));
    lockIfHas("realtorphone", hasText(workingItem.realtorphone));
    lockIfHas("realtorcell", hasText(workingItem.realtorcell));
    lockIfHas("rightsAnalysis", hasText(workingItem.rightsAnalysis));
    lockIfHas("siteInspection", hasText(workingItem.siteInspection));
    // opinion은 항상 신규 작성 가능 — lockIfHas 제외

    if (f.elements["sourceType"]) f.elements["sourceType"].disabled = !isAdmin;
    if (f.elements["assigneeId"]) f.elements["assigneeId"].disabled = !isAdmin;
    if (f.elements["submitterType"]) f.elements["submitterType"].disabled = !isAdmin;
    if (f.elements["date"]) f.elements["date"].disabled = true;
    if (els.aemDelete) els.aemDelete.classList.toggle("hidden", !isAdmin);

    setAemMsg("");
    setModalOpen(true);
    els.propertyEditModalAdmin.classList.remove("hidden");
    els.propertyEditModalAdmin.setAttribute("aria-hidden", "false");
  }

  function populateAssigneeSelect(selectedId) {
    const sel = els.aemForm?.elements["assigneeId"];
    if (!sel) return;
    const seen = new Set();
    const staffRows = state.staff
      .map((s) => normalizeStaff(s))
      .filter((s) => normalizeRole(s.role) === "staff" && String(s.id || '').trim())
      .filter((s) => {
        const key = String(s.id || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ko'));
    const options = ['<option value="">미배정</option>'];
    staffRows.forEach((s) => {
      options.push(`<option value="${escapeAttr(s.id)}">${escapeHtml(s.name || s.email || '담당자')}</option>`);
    });
    if (selectedId && !staffRows.some((s) => String(s.id) === String(selectedId))) {
      options.push(`<option value="${escapeAttr(selectedId)}">${escapeHtml(getStaffNameById(selectedId) || '담당자')}</option>`);
    }
    sel.innerHTML = options.join('');
    sel.value = selectedId || "";
  }

  function closePropertyEditModal() {
    if (!els.propertyEditModalAdmin) return;
    els.propertyEditModalAdmin.classList.add("hidden");
    els.propertyEditModalAdmin.setAttribute("aria-hidden", "true");
    state.editingProperty = null;
    setAemMsg("");
    setModalOpen(false);
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

  async function savePropertyEditModal() {
    const item = state.editingProperty;
    if (!item || !els.aemForm) return;

    const user = state.session?.user;
    const isAdmin = user?.role === "admin";

    const fd = new FormData(els.aemForm);
    const readStr = (k) => String(fd.get(k) || "").trim();
    const readNum = (k) => parseFlexibleNumber(fd.get(k));

    const newOpinionText = readStr("opinion");
    const opinionHistory = appendOpinionEntry(
      loadOpinionHistory(item),
      newOpinionText,
      state.session?.user
    );

    const patch = {
      id: item.id || "",
      globalId: item.globalId || "",
      itemNo: readStr("itemNo") || null,
      sourceType: readStr("sourceType") || null,
      assigneeId: readStr("assigneeId") || null,
      submitterType: readStr("submitterType") || null,
      address: readStr("address") || null,
      assetType: readStr("assetType") || null,
      floor: readStr("floor") || null,
      totalfloor: readStr("totalfloor") || null,
      commonarea: readNum("commonarea"),
      exclusivearea: readNum("exclusivearea"),
      sitearea: readNum("sitearea"),
      useapproval: readStr("useapproval") || null,
      status: readStr("status") || null,
      priceMain: readNum("priceMain"),
      lowprice: readNum("lowprice"),
      dateMain: readStr("dateMain") || null,
      sourceUrl: readStr("sourceUrl") || null,
      realtorname: readStr("realtorname") || null,
      realtorphone: readStr("realtorphone") || null,
      realtorcell: readStr("realtorcell") || null,
      rightsAnalysis: readStr("rightsAnalysis") || null,
      siteInspection: readStr("siteInspection") || null,
      opinion: opinionHistory.length ? opinionHistory[opinionHistory.length - 1].text : (item.opinion || null),
      opinionHistory,
      latitude: readNum("latitude"),
      longitude: readNum("longitude"),
    };

    if (!isAdmin) {
      const allowIfEmpty = (k, oldVal) => {
        const v = patch[k];
        const isEmptyOld = oldVal == null || String(oldVal).trim() === "";
        const isEmptyOldNum = oldVal == null || String(oldVal).trim() === "" || Number.isNaN(Number(oldVal));
        const ok = (typeof v === "number") ? isEmptyOldNum : isEmptyOld;
        if (!ok) delete patch[k];
      };
      ["itemNo","address","assetType","floor","totalfloor","useapproval","status","dateMain","sourceUrl","realtorname","realtorphone","realtorcell","rightsAnalysis","siteInspection"].forEach((k)=>allowIfEmpty(k, item[k]));
      ["commonarea","exclusivearea","sitearea","priceMain","lowprice","latitude","longitude"].forEach((k)=>allowIfEmpty(k, item[k]));
      delete patch.sourceType;
      delete patch.assigneeId;
      delete patch.submitterType;
    }

    const targetId = patch.id || patch.globalId;
    if (!targetId) {
      setAemMsg("저장 실패: 물건 식별자(id)가 없습니다.");
      return;
    }

    try {
      if (els.aemSave) els.aemSave.disabled = true;
      setAemMsg("");

      await updatePropertyAdmin(targetId, patch, isAdmin, item);

      setAemMsg("저장 완료", false);
      closePropertyEditModal();
      invalidatePropertyCollections();
      await loadProperties();
    } catch (err) {
      console.error(err);
      setAemMsg(err?.message || "저장 실패");
    } finally {
      if (els.aemSave) els.aemSave.disabled = false;
    }
  }

  async function updatePropertyAdmin(targetId, patch, isAdmin, item) {
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    if (sb) {
      const nextRaw = mergePropertyRaw(item, patch);
      const dbPatch = {
        item_no: patch.itemNo,
        source_type: patch.sourceType,
        assignee_id: patch.assigneeId,
        submitter_type: patch.submitterType,
        address: patch.address,
        asset_type: patch.assetType,
        floor: patch.floor,
        total_floor: patch.totalfloor,
        exclusive_area: patch.exclusivearea,
        common_area: patch.commonarea,
        site_area: patch.sitearea,
        use_approval: patch.useapproval || null,
        status: patch.status,
        price_main: patch.priceMain,
        lowprice: patch.lowprice,
        date_main: patch.dateMain || null,
        source_url: patch.sourceUrl,
        broker_office_name: patch.realtorname,
        submitter_phone: patch.realtorcell,
        memo: patch.opinion,
        latitude: patch.latitude,
        longitude: patch.longitude,
        raw: nextRaw,
      };
      Object.keys(dbPatch).forEach((k) => dbPatch[k] === undefined && delete dbPatch[k]);
      try {
        await updatePropertyRowResilient(sb, targetId, dbPatch);
        return;
      } catch (error) {
        if (!isAdmin || error?.code !== "NO_ROWS_UPDATED") throw error;
      }
    }

    const payload = { ...patch, raw: mergePropertyRaw(item, patch) };
    const candidates = [];
    if (isAdmin) {
      candidates.push({ path: `/admin/properties`, method: "PATCH" });
      candidates.push({ path: `/admin/properties/${encodeURIComponent(targetId)}`, method: "PATCH" });
      candidates.push({ path: `/admin/properties/${encodeURIComponent(targetId)}`, method: "PUT" });
    }
    candidates.push({ path: `/properties/${encodeURIComponent(targetId)}`, method: "PATCH" });
    candidates.push({ path: `/properties/${encodeURIComponent(targetId)}`, method: "PUT" });
    candidates.push({ path: `/properties/update`, method: "POST" });
    candidates.push({ path: `/admin/properties/update`, method: "POST" });

    let lastErr = null;
    for (const c of candidates) {
      try {
        await api(c.path, { method: c.method, auth: true, body: payload });
        return;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || "");
        if (msg.includes("404") || msg.includes("405") || msg.includes("not found")) continue;
      }
    }
    throw lastErr || new Error("저장 실패");
  }

  async function handleDeleteProperty() {
    const item = state.editingProperty;
    if (!item) return;

    const targetId = String(item.id || item.globalId || "").trim();
    if (!targetId) {
      setAemMsg("삭제 실패: 물건 식별자(id)가 없습니다.");
      return;
    }

    const label = item.address || item.itemNo || targetId;
    if (!window.confirm(`물건 '${label}'을(를) 삭제할까요?`)) return;

    try {
      if (els.aemDelete) els.aemDelete.disabled = true;
      setAemMsg("");

      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      if (sb) {
        const isPureId = !String(targetId).includes(":");
        if (isPureId) {
          const { error } = await sb.from("properties").delete().eq("id", targetId);
          if (error) throw error;
        } else {
          const { error } = await sb.from("properties").delete().eq("global_id", targetId);
          if (error) throw error;
        }
      } else {
        await api("/admin/properties", { method: "DELETE", auth: true, body: { ids: [targetId] } });
      }

      state.selectedPropertyIds.delete(targetId);
      closePropertyEditModal();
      invalidatePropertyCollections();
      await loadProperties();
    } catch (err) {
      console.error(err);
      setAemMsg(err?.message || "삭제 실패");
    } finally {
      if (els.aemDelete) els.aemDelete.disabled = false;
    }
  }

  // ---------------------------
  // Staff CRUD
  // ---------------------------
  function setStaffFormMode(mode = "create") {
    const editing = mode === "edit";
    const emailEl = els.staffForm?.elements.email;
    const passwordEl = els.staffForm?.elements.password;

    if (emailEl) {
      emailEl.disabled = editing;
      if (editing) emailEl.removeAttribute("required");
      else emailEl.setAttribute("required", "required");
    }
    if (passwordEl) {
      passwordEl.disabled = editing;
      if (editing) {
        passwordEl.value = "";
        passwordEl.removeAttribute("required");
        passwordEl.placeholder = "비밀번호는 본인 메뉴에서 변경";
      } else {
        passwordEl.setAttribute("required", "required");
        passwordEl.placeholder = "신규 생성 시만 입력";
      }
    }
    if (els.btnStaffSave) els.btnStaffSave.textContent = editing ? "프로필 저장" : "계정 생성";
  }

  function fillStaffForm(staff) {
    if (!els.staffForm) return;
    els.staffForm.elements.id.value = staff.id || "";
    if (els.staffForm.elements.email) els.staffForm.elements.email.value = "";
    els.staffForm.elements.name.value = staff.name || "";
    els.staffForm.elements.role.value = staff.role || "staff";
    if (els.staffForm.elements.password) els.staffForm.elements.password.value = "";
    setStaffFormMode("edit");
  }

  function resetStaffForm() {
    if (!els.staffForm) return;
    els.staffForm.reset();
    els.staffForm.elements.id.value = "";
    els.staffForm.elements.role.value = "staff";
    setStaffFormMode("create");
  }

  async function handleSaveStaff(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const id = String(fd.get("id") || "").trim();
    const payload = {
      email: String(fd.get("email") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      role: String(fd.get("role") || "staff"),
      password: String(fd.get("password") || ""),
    };

    if (!payload.name) return alert("이름을 입력해 주세요.");
    if (!id && !payload.email) return alert("로그인 이메일을 입력해 주세요.");
    if (!id && !payload.password) return alert("신규 계정은 초기 비밀번호가 필요합니다.");

    try {
      setFormBusy(e.currentTarget, true);
      let saved = null;
      if (id) {
        const res = await api(`/admin/staff/${encodeURIComponent(id)}`, {
          method: "PATCH",
          auth: true,
          body: {
            name: payload.name,
            role: payload.role,
          },
        });
        saved = res?.item || null;
        if (saved) {
          state.staff = state.staff.map((row) => String(row.id) === String(id) ? normalizeStaff(saved) : row);
        }
      } else {
        const res = await api("/admin/staff", {
          method: "POST",
          auth: true,
          body: payload,
        });
        saved = res?.item || null;
        if (saved) {
          state.staff = [normalizeStaff(saved), ...state.staff.filter((row) => String(row.id) !== String(saved.id))];
        }
      }
      resetStaffForm();
      if (saved) {
        renderStaffTable();
        renderAssignmentTable();
        renderSummary();
      } else {
        await loadStaff();
      }
      alert(id ? "프로필이 저장되었습니다." : "계정이 생성되었습니다.");
    } catch (err) {
      console.error(err);
      alert(err.message || "저장 실패");
    } finally {
      setFormBusy(e.currentTarget, false);
    }
  }


  function renderStaffTable() {
    if (!els.staffTableBody || !els.staffEmpty) return;
    els.staffTableBody.innerHTML = "";

    const rows = Array.isArray(state.staff) ? state.staff.slice() : [];
    if (!rows.length) {
      els.staffEmpty.classList.remove("hidden");
      return;
    }
    els.staffEmpty.classList.add("hidden");

    const roleLabelOf = (role) => {
      const r = String(role || "staff").toLowerCase();
      if (r === "admin") return "관리자";
      if (r === "other") return "기타";
      return "담당자";
    };

    const frag = document.createDocumentFragment();
    rows.forEach((staff) => {
      const tr = document.createElement("tr");
      const assignedCount = Array.isArray(staff.assignedRegions) ? staff.assignedRegions.length : 0;
      tr.innerHTML = `
        <td>${escapeHtml(staff.name || staff.email || "-")}</td>
        <td>${escapeHtml(roleLabelOf(staff.role))}</td>
        <td>${assignedCount}</td>
        <td>${escapeHtml(formatDate(staff.createdAt) || "-")}</td>
        <td>
          <div class="action-row">
            <button class="btn btn-secondary btn-sm" data-act="edit" data-id="${escapeAttr(staff.id)}">수정</button>
            <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${escapeAttr(staff.id)}">삭제</button>
          </div>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.staffTableBody.appendChild(frag);

    els.staffTableBody.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = String(e.currentTarget.dataset.id || "");
        const act = String(e.currentTarget.dataset.act || "");
        const row = state.staff.find((staff) => String(staff.id) === id);
        if (!row) return;

        if (act === "edit") {
          fillStaffForm(row);
          setActiveTab("staff");
          return;
        }

        if (act === "delete") {
          if (!confirm(`계정 '${row.name || row.email || id}'을 삭제할까요?`)) return;
          try {
            await api(`/admin/staff/${encodeURIComponent(id)}`, {
              method: "DELETE",
              auth: true,
            });
            state.staff = state.staff.filter((staff) => String(staff.id) !== id);
            renderStaffTable();
            renderAssignmentTable();
            renderSummary();
            hydrateAssignedAgentNames();
            renderPropertiesTable();
          } catch (err) {
            console.error(err);
            alert(err.message || "삭제 실패");
          }
        }
      });
    });
  }

  function renderAssignmentTable() {
    if (!els.assignmentTableBody || !els.assignmentEmpty) return;
    els.assignmentTableBody.innerHTML = "";

    const agents = state.staff.filter((s) => normalizeRole(s.role) === "staff");
    if (!agents.length) {
      els.assignmentEmpty.classList.remove("hidden");
      return;
    }
    els.assignmentEmpty.classList.add("hidden");

    const regionOptions = getRegionOptionsFromProperties();
    const frag = document.createDocumentFragment();

    agents.forEach((agent) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(agent.name || agent.email || "-")}</td>
        <td>담당자</td>
        <td>
          <select class="assignment-select" data-agent-id="${escapeAttr(agent.id)}" multiple></select>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.assignmentTableBody.appendChild(frag);

    els.assignmentTableBody.querySelectorAll(".assignment-select").forEach((sel) => {
      const agentId = String(sel.dataset.agentId || "");
      const agent = agents.find((a) => String(a.id) === agentId);
      if (!agent) return;
      regionOptions.forEach((region) => {
        const opt = document.createElement("option");
        opt.value = region;
        opt.textContent = region;
        opt.selected = Array.isArray(agent.assignedRegions) && agent.assignedRegions.includes(region);
        sel.appendChild(opt);
      });
    });
  }

  // ---------------------------
  // CSV Import (Properties)
  // ---------------------------
  async function handleCsvUpload() {
    try {
      const file = els.csvFileInput.files?.[0];
      if (!file) return alert("CSV 파일을 선택해 주세요.");

      const sourceType = String(els.csvImportSource.value || "auction"); // auction|onbid|realtor
      const source =
        sourceType === "auction" ? "auction" :
        sourceType === "onbid" ? "gongmae" :
        "general"; // realtor는 레거시 general로 전송

      const csvText = await readCsvFileText(file, sourceType);

      // Supabase import (admin only)
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      if (sb) {
        try { await K.sbSyncLocalSession(); } catch {}
        if (state.session?.user?.role !== "admin") {
          throw new Error("관리자만 CSV 업로드가 가능합니다.");
        }

        const rawRows = parseCsv(csvText);
        const preparedRows = [];
        for (const r of rawRows) {
          const m = mapPropertyCsvRow(r, sourceType);
          // itemNo 없으면 global_id = "sourceType:" 으로 중복돼 upsert 에러 유발
          if (!m || !m.itemNo || !m.address) continue;
          const built = buildSupabasePropertyRow(r, m, sourceType);
          if (!built.global_id || built.global_id.endsWith(":")) continue;
          preparedRows.push(built);
        }

        if (!preparedRows.length) throw new Error("유효한 행이 없습니다.");

        const dedupedRows = dedupePropertyRowsByGlobalId(preparedRows);
        const dedupedInFile = preparedRows.length - dedupedRows.length;
        const regContext = buildRegisterLogContext(`CSV 업로드(${sourceType === "auction" ? "경매" : sourceType === "onbid" ? "공매" : "중개"})`, state.session?.user);
        await ensureAuxiliaryPropertiesForAdmin();
        const workingByKey = new Map();
        getAuxiliaryPropertiesSnapshot().forEach((item) => {
          const key = buildRegistrationMatchKey(buildRegistrationSnapshotFromItem(item));
          if (key && !workingByKey.has(key)) workingByKey.set(key, item);
        });
        const finalRows = [];
        let regUpdatedCount = 0;
        for (const row of dedupedRows) {
          const snap = buildRegistrationSnapshotFromDbRow(row);
          const matchKey = buildRegistrationMatchKey(snap);
          const existing = matchKey ? workingByKey.get(matchKey) : null;
          if (existing) {
            const merged = buildRegistrationDbRowForExisting(existing, row, regContext);
            finalRows.push(merged.row);
            workingByKey.set(matchKey, normalizeProperty({ ...merged.row, raw: merged.row.raw }));
            if (merged.changes.length) regUpdatedCount += 1;
          } else {
            const created = buildRegistrationDbRowForCreate(row, regContext);
            finalRows.push(created);
            if (matchKey) workingByKey.set(matchKey, normalizeProperty({ ...created, raw: created.raw }));
          }
        }
        const importResult = await upsertPropertiesResilient(sb, finalRows, { chunkSize: 200 });
        const summaryParts = [
          `업로드 완료`,
          `처리: ${importResult.okCount}건`,
        ];
        if (dedupedInFile > 0) summaryParts.push(`파일내 중복 통합: ${dedupedInFile}건`);
        if (regUpdatedCount > 0) summaryParts.push(`기존 물건 갱신(LOG): ${regUpdatedCount}건`);
        if (importResult.failed.length > 0) {
          summaryParts.push(`실패: ${importResult.failed.length}건`);
          const preview = importResult.failed.slice(0, 5).map((v) => v.itemNo || v.globalId || "-").join(", ");
          if (preview) summaryParts.push(`실패 예시: ${preview}`);
        }

        showResultBox(els.csvResultBox, summaryParts.join(" / "), importResult.failed.length > 0);
        invalidatePropertyCollections();
        await loadProperties();
        return;
      }

      // Legacy (Vercel API)
      const res = await api("/admin/import/properties-csv", {
        method: "POST",
        auth: true,
        body: {
          source: sourceType,
          sourceType,     // new
          csvText,
          dedupeKey: "address",
        },
      });

      const summary = [
        `업로드 완료`,
        `삽입: ${res?.inserted ?? 0}건`,
        `중복 스킵: ${res?.duplicates ?? 0}건`,
        `오류: ${res?.errors ?? 0}건`,
      ].join(" / ");

      showResultBox(els.csvResultBox, summary);
      invalidatePropertyCollections();
      await loadProperties();
    } catch (err) {
      console.error(err);
      if (err?.code === "LOGIN_REQUIRED" || err?.status === 401) {
        setGlobalMsg("로그인이 필요합니다. 다시 로그인해 주세요.");
        goLoginPage(true);
      }
      showResultBox(els.csvResultBox, `업로드 실패: ${err.message}`, true);
    }
  }

    function mapPropertyCsvRow(row, sourceType) {
    const pick = (...keys) => {
      for (const k of keys) {
        if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
      }
      return "";
    };

    const toNum = (v) => {
      const n = toNumber(v);
      return Number.isFinite(n) ? n : 0;
    };

    const m2ToPyeong = (m2) => {
      const n = toNum(m2);
      return n ? (n / 3.305785) : 0;
    };

    const toISO = (v) => {
      if (K && typeof K.toISODate === "function") return K.toISODate(v);
      return null;
    };

    const parseAuctionAreas = (text) => {
      const src = String(text || "");
      const building = src.match(/건물[^0-9]*([0-9.,]+)\s*평/i);
      const site = src.match(/대지권[^0-9]*([0-9.,]+)\s*평/i);
      return {
        building: building ? toNum(building[1]) : null,
        site: site ? toNum(site[1]) : null,
      };
    };

    let itemNo = "";
    let address = "";
    let status = "";
    let priceMain = 0;
    let lowprice = null;
    let latitude = null;
    let longitude = null;

    let assetType = "";
    let floor = null;
    let totalfloor = null;
    let commonArea = null;
    let exclusiveArea = null;
    let siteArea = null;
    let useApproval = null;
    let dateMain = null;
    let sourceUrl = "";
    let memo = "";

    if (sourceType === "auction") {
      // 사건번호 + 물건번호를 조합해야 고유 식별자가 됨
      // ex) 사건번호=2025타경41814, 물건번호=1 → "2025타경41814(1)"
      // 물건번호가 이미 사건번호를 포함한 형태(2025타경41814(1))면 그대로 사용
      const caseNo = pick("사건번호", "caseNo", "");
      const propNo = pick("물건번호", "");
      if (caseNo && propNo) {
        itemNo = propNo.includes(caseNo) ? propNo : `${caseNo}(${propNo})`;
      } else {
        itemNo = caseNo || propNo || pick("itemNo", "");
      }
      address = pick("주소(시군구동)", "주소", "소재지", "address");
      status = pick("진행상태", "상태", "status");
      priceMain = toNum(pick("감정가", "감정가(원)", "priceMain"));
      lowprice = toNum(pick("최저가", "매각가", "lowprice")) || null;
      assetType = pick("종별", "부동산유형", "assetType");
      dateMain = toISO(pick("입찰일자", "입찰일", "dateMain")) || null;
      memo = pick("경매현황", "비고", "memo");
      const area = parseAuctionAreas(memo);
      exclusiveArea = area.building;
      siteArea = area.site;
    } else if (sourceType === "onbid") {
      itemNo = pick("물건관리번호", "itemNo", "물건번호");
      address = pick("소재지", "주소", "address", "물건명");
      status = pick("물건상태", "상태", "status");
      priceMain = toNum(pick("감정가(원)", "감정가", "priceMain"));
      lowprice = toNum(pick("최저입찰가(원)", "lowprice")) || null;
      assetType = pick("용도", "부동산유형", "assetType");
      dateMain = pick("입찰마감일시", "입찰마감", "dateMain") || null;
      memo = pick("비고", "특이사항", "메모", "memo");
      const bM2 = pick("건물 면적(㎡)", "건물 면적(m²)", "건물 면적(m2)", "건물면적(㎡)");
      const tM2 = pick("토지 면적(㎡)", "토지 면적(m²)", "토지 면적(m2)", "토지면적(㎡)");
      if (bM2) exclusiveArea = m2ToPyeong(bM2);
      if (tM2) siteArea = m2ToPyeong(tM2);
    } else {
      itemNo = pick("매물ID", "itemNo", "물건번호");
      address = pick("주소(통합)", "도로명주소", "지번주소", "주소", "address");
      status = pick("거래유형", "status");
      priceMain = toNum(pick("가격(표시)", "가격(원)", "가격(원본)", "매매가", "priceMain"));
      assetType = pick("세부유형", "부동산유형명", "부동산유형", "assetType");
      sourceUrl = pick("바로가기(엑셀)", "매물URL", "sourceUrl", "url");
      memo = pick("매물특징", "memo");
      floor = pick("해당층", "층수", "floor") || null;
      totalfloor = pick("총층", "전체층", "totalfloor") || null;
      const ex = pick("전용면적(평)", "전용면적", "exclusiveArea");
      const common = pick("공용면적(평)", "공급/계약면적(평)", "공급면적(평)", "commonArea");
      if (ex) exclusiveArea = toNum(ex);
      if (common) commonArea = toNum(common);
      const lat = pick("위도", "latitude", "lat");
      const lng = pick("경도", "longitude", "lng");
      latitude = lat ? Number(lat) : null;
      longitude = lng ? Number(lng) : null;
      useApproval = toISO(pick("사용승인일", "useApproval")) || null;
    }

    if (!address && !itemNo) return null;

    return {
      itemNo,
      address,
      status,
      priceMain,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      assetType,
      commonArea,
      exclusiveArea,
      siteArea,
      useApproval,
      dateMain,
      sourceUrl,
      memo,
      lowprice,
      floor,
      totalfloor,
    };
  }

  function buildSupabasePropertyRow(rawRow, m, sourceType) {
    const globalId = `${sourceType}:${m.itemNo}`;
    const toNullNum = (v) => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

    const normalizedRaw = {
      ...(rawRow || {}),
      itemNo: String(m.itemNo || ""),
      address: String(m.address || ""),
      assetType: m.assetType || null,
      floor: m.floor || null,
      totalfloor: m.totalfloor || null,
      commonArea: toNullNum(m.commonArea),
      exclusiveArea: toNullNum(m.exclusiveArea),
      siteArea: toNullNum(m.siteArea),
      useapproval: m.useApproval || null,
      dateMain: m.dateMain || null,
      sourceUrl: m.sourceUrl || null,
      opinion: sanitizeOnbidOpinion(sourceType === "onbid" ? null : m.memo, m.memo, m.address) || null,
      memo: m.memo || null,
      lowprice: toNullNum(m.lowprice),
      currentPrice: toNullNum(m.lowprice),
    };

    const row = {
      global_id: globalId,
      item_no: String(m.itemNo || ""),
      source_type: sourceType,
      is_general: false,

      address: String(m.address || ""),
      asset_type: (m.assetType || "") || null,
      exclusive_area: toNullNum(m.exclusiveArea),
      common_area: toNullNum(m.commonArea),
      site_area: toNullNum(m.siteArea),
      use_approval: m.useApproval || null,
      status: m.status || null,

      price_main: toNullNum(m.priceMain),
      date_main: m.dateMain || null,
      source_url: m.sourceUrl || null,
      memo: m.memo || null,

      latitude: m.latitude,
      longitude: m.longitude,

      geocode_status: (m.latitude != null && m.longitude != null)
        ? "ok"
        : (sourceType === "realtor" ? null : "pending"),

      raw: normalizedRaw,
    };

    return row;
  }


  function dedupePropertyRowsByGlobalId(rows) {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = String(row?.global_id || "").trim();
      if (!key) continue;
      map.set(key, row);
    }
    return [...map.values()];
  }

  async function upsertPropertiesResilient(sb, rows, { chunkSize = 200 } = {}) {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const failed = [];
    let okCount = 0;

    async function upsertBatch(batch) {
      if (!batch.length) return;
      const { error } = await sb.from("properties").upsert(batch, { onConflict: "global_id" });
      if (!error) {
        okCount += batch.length;
        return;
      }
      if (batch.length === 1) {
        const row = batch[0] || {};
        failed.push({
          globalId: row.global_id || "",
          itemNo: row.item_no || "",
          message: String(error.message || error.details || error.hint || "업서트 실패"),
        });
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      await upsertBatch(batch.slice(0, mid));
      await upsertBatch(batch.slice(mid));
    }

    const chunks = (K && typeof K.chunk === "function") ? K.chunk(list, chunkSize) : chunkArray(list, chunkSize);
    for (const chunk of chunks) {
      await upsertBatch(chunk);
    }

    return { okCount, failed };
  }

  // ---------------------------
  // Region Assignments  // ---------------------------
  // Region Assignments

  // ---------------------------
  function getRegionOptionsFromProperties() {
    const set = new Set();
    for (const p of getAuxiliaryPropertiesSnapshot()) {
      if (p.regionGu) set.add(p.regionGu);
      if (p.regionDong) set.add(p.regionDong);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }

  async function handleSuggestGrouping() {
    await ensureAuxiliaryPropertiesForAdmin();
    const agents = state.staff.filter((s) => normalizeRole(s.role) === "staff");
    if (!agents.length) return alert("담당자 계정을 먼저 등록해 주세요.");

    const requestedCount = Math.max(1, Number(els.agentCountInput.value || 1));
    const unitMode = els.regionUnitMode.value; // auto|gu|dong

    const grouped = buildAutoRegionGrouping(getAuxiliaryPropertiesSnapshot(), requestedCount, unitMode);
    state.lastGroupSuggestion = grouped;

    renderGroupSuggestion(grouped, agents);
  }

  function renderGroupSuggestion(grouped, agents) {
    els.groupSuggestBox.innerHTML = "";
    if (!grouped || !grouped.groups?.length) {
      els.groupSuggestBox.innerHTML = `<div class="muted">그룹 제안 결과가 없습니다.</div>`;
      return;
    }

    const info = document.createElement("div");
    info.className = "hint-box";
    info.innerHTML = `
      <div><strong>제안 기준:</strong> ${escapeHtml(grouped.unitLabel)} / 총 지역 ${grouped.totalRegions}개 / 그룹 ${grouped.groups.length}개</div>
      <div class="muted small">※ 제안 결과는 아래 [배정 저장] 전에 테이블에서 수정 가능합니다.</div>
    `;
    els.groupSuggestBox.appendChild(info);

    const frag = document.createDocumentFragment();
    grouped.groups.forEach((g, idx) => {
      const card = document.createElement("div");
      card.className = "group-card";
      const agentName = agents[idx]?.name || `미지정 그룹 ${idx + 1}`;
      card.innerHTML = `
        <h4>그룹 ${idx + 1} (${escapeHtml(agentName)})</h4>
        <div class="group-chip-wrap">
          ${g.regions.map(r => `<span class="group-chip">${escapeHtml(r)}</span>`).join("")}
        </div>
      `;
      frag.appendChild(card);
    });
    els.groupSuggestBox.appendChild(frag);

    // 실제 배정 테이블 반영(담당자 순서 기준)
    const selects = [...els.assignmentTableBody.querySelectorAll(".assignment-select")];
    selects.forEach((sel, idx) => {
      const regions = grouped.groups[idx]?.regions || [];
      [...sel.options].forEach((opt) => {
        opt.selected = regions.includes(opt.value);
      });
    });
  }

  async function handleSaveAssignments() {
    const agents = state.staff.filter((s) => normalizeRole(s.role) === "staff");
    if (!agents.length) return alert("담당자 계정이 없습니다.");

    const rows = [...els.assignmentTableBody.querySelectorAll(".assignment-select")].map((sel) => {
      const agentId = sel.dataset.agentId;
      const assignedRegions = [...sel.selectedOptions].map((o) => o.value);
      return { agentId, assignedRegions };
    });

    try {
      await api("/admin/region-assignments", {
        method: "POST",
        auth: true,
        body: { assignments: rows },
      });

      await loadStaff();
      alert("담당자 지역 배정이 저장되었습니다.");
    } catch (err) {
      console.error(err);
      alert(err.message || "배정 저장 실패");
    }
  }

  /**
   * 자동 그룹핑 휴리스틱 (초기 버전)
   * - 주소 기반으로 구/동 추출된 값을 사용
   * - auto 모드에서 X > 구개수 이면 동 단위로 전환
   * - 같은 구 우선 배치 + (가능하면) 인접 구 함께 배치
   */
  function buildAutoRegionGrouping(properties, agentCount, unitMode) {
    const valid = properties.filter((p) => p.address);
    const regionsByGu = new Map(); // gu => Set(dong)
    for (const p of valid) {
      const { gu, dong } = extractGuDong(p.address);
      const rg = p.regionGu || gu;
      const rd = p.regionDong || dong;
      if (!rg) continue;
      if (!regionsByGu.has(rg)) regionsByGu.set(rg, new Set());
      if (rd) regionsByGu.get(rg).add(rd);
    }

    const guList = [...regionsByGu.keys()].sort((a, b) => a.localeCompare(b, "ko"));
    const guCount = guList.length;

    let mode = unitMode;
    if (unitMode === "auto") {
      mode = agentCount > guCount ? "dong" : "gu";
    }

    let regionUnits = [];
    if (mode === "gu") {
      regionUnits = guList.map((gu) => ({ key: gu, gu, weight: regionsByGu.get(gu)?.size || 1 }));
    } else {
      for (const gu of guList) {
        const dongs = [...(regionsByGu.get(gu) || [])];
        if (!dongs.length) {
          regionUnits.push({ key: gu, gu, weight: 1 });
          continue;
        }
        dongs.sort((a, b) => a.localeCompare(b, "ko")).forEach((dong) => {
          regionUnits.push({ key: dong, gu, weight: 1 });
        });
      }
    }

    // 그룹 초기화
    const groups = Array.from({ length: Math.max(1, agentCount) }, (_, i) => ({
      idx: i,
      regions: [],
      guSet: new Set(),
      totalWeight: 0,
    }));

    // gu 모드일 때 인접 구 기반 ordering(간단)
    if (mode === "gu") {
      regionUnits = sortGuUnitsByAdjacency(regionUnits);
    } else {
      // dong 모드: 같은 구끼리 붙게 정렬
      regionUnits.sort((a, b) => {
        if (a.gu !== b.gu) return a.gu.localeCompare(b.gu, "ko");
        return a.key.localeCompare(b.key, "ko");
      });
    }

    // 균등 분배 (가중치 기준 가장 작은 그룹에 할당)
    for (const unit of regionUnits) {
      const target = groups
        .slice()
        .sort((g1, g2) => {
          if (g1.totalWeight !== g2.totalWeight) return g1.totalWeight - g2.totalWeight;
          // 같은 구 이어붙이기 선호
          const p1 = g1.guSet.has(unit.gu) ? -1 : 0;
          const p2 = g2.guSet.has(unit.gu) ? -1 : 0;
          if (p1 !== p2) return p1 - p2;
          return g1.idx - g2.idx;
        })[0];

      target.regions.push(unit.key);
      target.totalWeight += unit.weight || 1;
      if (unit.gu) target.guSet.add(unit.gu);
    }

    return {
      unit: mode,
      unitLabel: mode === "gu" ? "구 단위" : "동 단위",
      totalRegions: regionUnits.length,
      groups: groups.map((g) => ({
        regions: g.regions.sort((a, b) => a.localeCompare(b, "ko")),
        totalWeight: g.totalWeight,
      })),
    };
  }

  // 서울 기준 일부 인접맵(초기 내장, 필요시 서버/설정으로 확장 권장)
  const GU_ADJ = {
    "강남구": ["서초구", "송파구", "강동구", "성동구"],
    "서초구": ["강남구", "동작구", "관악구", "용산구", "송파구"],
    "송파구": ["강남구", "강동구", "광진구", "성동구", "서초구"],
    "강동구": ["송파구", "강남구", "광진구"],
    "마포구": ["서대문구", "은평구", "용산구", "영등포구"],
    "서대문구": ["은평구", "마포구", "종로구", "중구"],
    "영등포구": ["동작구", "구로구", "양천구", "마포구", "용산구"],
    "구로구": ["금천구", "양천구", "영등포구"],
    "양천구": ["강서구", "구로구", "영등포구"],
    "관악구": ["동작구", "서초구", "금천구"],
    "동작구": ["용산구", "영등포구", "관악구", "서초구"],
    "용산구": ["중구", "마포구", "서초구", "동작구", "성동구"],
    "성동구": ["광진구", "동대문구", "중구", "용산구", "강남구", "송파구"],
    "광진구": ["성동구", "동대문구", "중랑구", "강동구", "송파구"],
    "노원구": ["도봉구", "중랑구", "성북구"],
    "도봉구": ["노원구", "강북구"],
    "강북구": ["도봉구", "성북구", "종로구"],
    "성북구": ["강북구", "종로구", "동대문구", "중랑구", "노원구"],
    "종로구": ["중구", "서대문구", "성북구", "강북구", "은평구"],
    "중구": ["종로구", "용산구", "성동구", "동대문구", "서대문구"],
    "동대문구": ["중랑구", "성북구", "성동구", "중구", "광진구"],
    "중랑구": ["노원구", "동대문구", "광진구", "성북구"],
    "은평구": ["서대문구", "종로구", "마포구", "강북구"],
    "강서구": ["양천구"],
    "금천구": ["관악구", "구로구"],
  };

  function sortGuUnitsByAdjacency(units) {
    const left = units.slice();
    if (!left.length) return left;

    const result = [];
    // 시작점: weight 큰 구부터
    left.sort((a, b) => (b.weight || 1) - (a.weight || 1));
    result.push(left.shift());

    while (left.length) {
      const last = result[result.length - 1];
      const adj = GU_ADJ[last.gu] || [];
      let idx = left.findIndex((u) => adj.includes(u.gu));
      if (idx < 0) idx = 0;
      result.push(left.splice(idx, 1)[0]);
    }

    return result;
  }


  function readCsvFileText(file, sourceType) {
    return file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      // BOM이 있으면 UTF-8 확정
      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
      }
      const preferred = sourceType === "realtor" ? "utf-8" : "euc-kr";
      try {
        const decoded = new TextDecoder(preferred, { fatal: true }).decode(bytes);
        return decoded.replace(/^\uFEFF/, "");
      } catch (_) {
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
        } catch (_2) {
          return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
        }
      }
    });
  }

  // ---------------------------
  // CSV Parser (simple, quotes support)
  // ---------------------------
  function parseCsv(text) {
    const rows = [];
    let i = 0;
    let field = "";
    let row = [];
    let inQuotes = false;

    const pushField = () => {
      row.push(field);
      field = "";
    };
    const pushRow = () => {
      if (row.length === 1 && row[0] === "" && rows.length === 0) {
        row = [];
        return;
      }
      rows.push(row);
      row = [];
    };

    while (i < text.length) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i++;
            continue;
          }
        } else {
          field += ch;
          i++;
          continue;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
          continue;
        }
        if (ch === ",") {
          pushField();
          i++;
          continue;
        }
        if (ch === "\n") {
          pushField();
          pushRow();
          i++;
          continue;
        }
        if (ch === "\r") {
          i++;
          continue;
        }
        field += ch;
        i++;
      }
    }

    pushField();
    if (row.length) pushRow();

    if (!rows.length) return [];
    const headers = rows[0].map((h) => String(h || "").trim());
    return rows.slice(1)
      .filter(r => r.some(v => String(v || "").trim() !== ""))
      .map((r) => {
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
        return obj;
      });
  }

  // ---------------------------
  // API
  // ---------------------------
  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json" };

    let token = "";
    if (options.auth) {
      if (isSupabaseMode() && K && typeof K.sbGetAccessToken === "function") {
        try {
          token = await K.sbGetAccessToken();
          state.session = loadSession();
        } catch {}
      }
      if (!token) {
        token = state.session?.token || "";
      }
      if (!token) {
        state.session = loadSession();
        token = state.session?.token || "";
      }
      if (!token && isSupabaseMode()) {
        try {
          await K.sbSyncLocalSession(true);
          state.session = loadSession();
          token = state.session?.token || "";
        } catch {}
      }
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

    if (res.status === 401 && options.auth && !options._retried && isSupabaseMode()) {
      try {
        if (K && typeof K.sbGetAccessToken === "function") {
          const nextToken = await K.sbGetAccessToken({ forceRefresh: true });
          if (nextToken) {
            state.session = loadSession();
            return api(path, { ...options, _retried: true });
          }
        }
        await K.sbSyncLocalSession(true);
        state.session = loadSession();
        return api(path, { ...options, _retried: true });
      } catch {}
    }

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

  function getKakaoAppKey() {
    const meta = document.querySelector('meta[name="kakao-app-key"]');
    return String(meta?.getAttribute("content") || "").trim();
  }

  function loadKakaoMapsSDK(appKey) {
    return new Promise((resolve, reject) => {
      if (window.kakao?.maps?.services?.Geocoder) {
        resolve();
        return;
      }
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve());
        return;
      }
      const s = document.createElement("script");
      s.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey=" + encodeURIComponent(appKey) + "&autoload=false&libraries=services";
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

  async function ensureKakaoGeocoder() {
    if (_geocoder) return _geocoder;
    const appKey = getKakaoAppKey();
    if (!appKey) throw new Error("카카오 JavaScript 키가 설정되지 않았습니다.");
    if (!_geocodeKakaoReady) {
      _geocodeKakaoReady = loadKakaoMapsSDK(appKey);
    }
    await _geocodeKakaoReady;
    _geocoder = new kakao.maps.services.Geocoder();
    return _geocoder;
  }

  function geocodeOneAddress(geocoder, address) {
    return new Promise((resolve) => {
      geocoder.addressSearch(address, (result, status) => {
        if (status !== kakao.maps.services.Status.OK || !result?.length) {
          resolve(null);
          return;
        }
        const best = result[0];
        const lat = Number(best.y);
        const lng = Number(best.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          resolve(null);
          return;
        }
        resolve({ lat, lng });
      });
    });
  }

  function normalizeAddressForGeocode(rawAddress) {
    let addr = String(rawAddress || "").trim();
    if (!addr) return "";
    addr = addr.replace(/\([^)]*\)/g, "").trim();
    addr = addr.replace(/\s*외\s*\d*\s*필지?/g, "").trim();
    addr = addr.replace(/\s+\d{1,5}동\s*\d{1,5}호\s*$/g, "").trim();
    addr = addr.replace(/\s+(지하\s*)?\d{1,3}층.*$/g, "").trim();
    addr = addr.replace(/[,;·\s]+$/, "").trim();
    return addr;
  }

  function getGeocodeStats() {
    const props = state.properties;
    let pending = 0, ok = 0, failed = 0;
    for (const p of props) {
      const st = String(p.geocodeStatus || "").toLowerCase();
      const hasCoords = (p.latitude != null && p.longitude != null);
      if (st === "ok" || (hasCoords && st !== "failed" && st !== "pending")) { ok++; }
      else if (st === "failed") { failed++; }
      else if (st === "pending" || (!hasCoords && p.address)) { pending++; }
    }
    return { pending, ok, failed, total: props.length };
  }

  function updateGeocodeStatusBar() {
    const stats = getGeocodeStats();

    if (els.geocodePending) els.geocodePending.textContent = stats.pending.toLocaleString("ko-KR");
    if (els.geocodeOk)      els.geocodeOk.textContent      = stats.ok.toLocaleString("ko-KR");
    if (els.geocodeFailed)  els.geocodeFailed.textContent  = stats.failed.toLocaleString("ko-KR");

    // 카드 active 스타일 (실패 0이면 실패 카드 dim)
    if (els.geoStatFailed) els.geoStatFailed.classList.toggle("is-empty", stats.failed === 0);
    if (els.geoStatPending) els.geoStatPending.classList.toggle("is-empty", stats.pending === 0);

    if (els.btnGeocodeRun) {
      els.btnGeocodeRun.disabled = stats.pending === 0 || state.geocodeRunning;
      els.btnGeocodeRun.textContent = state.geocodeRunning ? "실행 중..." : "지오코딩 실행";
    }
    if (els.btnGeocodeRetryFailed) {
      els.btnGeocodeRetryFailed.classList.toggle("hidden", stats.failed === 0);
      els.btnGeocodeRetryFailed.disabled = stats.failed === 0 || state.geocodeRunning;
    }
  }

  function renderGeocodeList(filter) {
    if (!els.geocodeListWrap || !els.geocodeListBody) return;

    // 카드 선택 강조
    ["geoStatPending", "geoStatOk", "geoStatFailed"].forEach((key) => {
      if (els[key]) els[key].classList.toggle("is-selected", els[key].dataset.geoFilter === filter);
    });

    const labelMap = { pending: "대기", ok: "완료", failed: "실패" };
    const label = labelMap[filter] || filter;

    const rows = getAuxiliaryPropertiesSnapshot().filter((p) => {
      const st = String(p.geocodeStatus || "").toLowerCase();
      const hasCoords = p.latitude != null && p.longitude != null;
      if (filter === "ok")      return st === "ok" || (hasCoords && st !== "failed" && st !== "pending");
      if (filter === "failed")  return st === "failed";
      if (filter === "pending") return st === "pending" || (!hasCoords && !!p.address && st !== "ok" && st !== "failed");
      return false;
    });

    if (els.geocodeListTitle) {
      els.geocodeListTitle.textContent = `${label} 물건 ${rows.length.toLocaleString("ko-KR")}건`;
    }

    els.geocodeListBody.innerHTML = "";

    if (!rows.length) {
      if (els.geocodeListEmpty) els.geocodeListEmpty.classList.remove("hidden");
      els.geocodeListWrap.classList.remove("hidden");
      return;
    }
    if (els.geocodeListEmpty) els.geocodeListEmpty.classList.add("hidden");

    const kindMap = { auction: "경매", onbid: "공매", realtor: "중개", general: "일반" };
    const frag = document.createDocumentFragment();
    rows.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${escapeHtml(p.itemNo || "-")}</td>` +
        `<td><span class="kind-text kind-${p.sourceType || "general"}">${escapeHtml(kindMap[p.sourceType] || "-")}</span></td>` +
        `<td class="text-cell">${escapeHtml(p.address || "-")}</td>` +
        `<td>${escapeHtml(p.geocodeStatus || "pending")}</td>` +
        `<td>${escapeHtml(formatDate(p.createdAt) || "-")}</td>`;
      frag.appendChild(tr);
    });
    els.geocodeListBody.appendChild(frag);
    els.geocodeListWrap.classList.remove("hidden");
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function saveGeocodeResult(sb, propertyId, coords, status) {
    const basePatch = { geocode_status: status };
    if (coords && status === "ok") {
      basePatch.latitude = coords.lat;
      basePatch.longitude = coords.lng;
    }
    const col = String(propertyId).includes(":") ? "global_id" : "id";

    // 1차: geocoded_at 포함 시도
    const fullPatch = { ...basePatch, geocoded_at: new Date().toISOString() };
    const { error } = await sb.from("properties").update(fullPatch).eq(col, propertyId);

    if (error) {
      // geocoded_at 컬럼이 없으면 해당 컬럼 제외하고 재시도
      if (String(error.message || "").includes("geocoded_at")) {
        const { error: retryErr } = await sb.from("properties").update(basePatch).eq(col, propertyId);
        if (retryErr) console.warn("saveGeocodeResult error:", propertyId, retryErr.message);
      } else {
        console.warn("saveGeocodeResult error:", propertyId, error.message);
      }
    }
  }

  async function runGeocoding(retryFailed) {
    if (state.geocodeRunning) return;

    const sb = isSupabaseMode() ? K.initSupabase() : null;
    if (!sb) {
      alert("Supabase 연동이 필요합니다.");
      return;
    }

    // 1. 카카오 Maps JS SDK 로드 + Geocoder 준비
    let geocoder;
    try {
      geocoder = await ensureKakaoGeocoder();
    } catch (err) {
      alert("카카오 SDK 로드 실패: " + (err.message || "알 수 없는 오류"));
      return;
    }

    state.geocodeRunning = true;
    updateGeocodeStatusBar();
    if (els.geocodeProgress) els.geocodeProgress.classList.remove("hidden");
    if (els.geocodeRunningText) els.geocodeRunningText.classList.remove("hidden");

    try {
      // 2. DB에서 대상 건 전체 조회 (1000건씩 페이징)
      const statusFilter = retryFailed ? "failed" : "pending";
      const allItems = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error: fetchErr } = await sb.from("properties")
          .select("id,global_id,address,latitude,longitude,geocode_status")
          .eq("geocode_status", statusFilter)
          .not("address", "is", null)
          .order("date_uploaded", { ascending: false })
          .range(from, from + pageSize - 1);
        if (fetchErr) throw fetchErr;
        const rows = Array.isArray(data) ? data : [];
        allItems.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }

      const items = allItems.filter((r) => String(r.address || "").trim());
      if (!items.length) {
        alert(retryFailed ? "재시도할 실패 건이 없습니다." : "지오코딩 대상이 없습니다.");
        return;
      }

      // 3. 순차 처리
      let processed = 0, okCount = 0, failCount = 0;
      const total = items.length;

      for (const item of items) {
        const propId = item.id || item.global_id;
        if (!propId) { processed++; continue; }

        const rawAddr = String(item.address || "").trim();
        const cleaned = normalizeAddressForGeocode(rawAddr);

        if (!cleaned) {
          await saveGeocodeResult(sb, propId, null, "failed");
          failCount++;
          processed++;
          continue;
        }

        // 카카오 Maps JS SDK Geocoder 호출
        const coords = await geocodeOneAddress(geocoder, cleaned);

        // 첫 시도 실패 시 원본 주소로 재시도
        let finalCoords = coords;
        if (!finalCoords && cleaned !== rawAddr) {
          finalCoords = await geocodeOneAddress(geocoder, rawAddr);
        }

        if (finalCoords) {
          await saveGeocodeResult(sb, propId, finalCoords, "ok");
          okCount++;
        } else {
          await saveGeocodeResult(sb, propId, null, "failed");
          failCount++;
        }

        processed++;

        // 진행률 업데이트
        const pct = Math.round((processed / total) * 100);
        if (els.geocodeProgressBar) els.geocodeProgressBar.style.width = pct + "%";
        if (els.geocodeRunningText) {
          els.geocodeRunningText.textContent = processed + "/" + total + " (성공 " + okCount + ", 실패 " + failCount + ")";
        }

        // 카카오 SDK는 콜백 기반이라 Rate Limit이 REST보다 관대하지만 안전하게 150ms 간격 유지
        if (processed < total) await sleep(150);
      }

      alert("지오코딩 완료: 총 " + total + "건 중 성공 " + okCount + "건, 실패 " + failCount + "건");
      invalidatePropertyCollections();
      await ensureAuxiliaryPropertiesForAdmin({ forceRefresh: true });
      await loadProperties();

    } catch (err) {
      console.error("runGeocoding error:", err);
      alert(err?.message || "지오코딩 중 오류가 발생했습니다.");
    } finally {
      state.geocodeRunning = false;
      if (els.geocodeProgress) els.geocodeProgress.classList.add("hidden");
      if (els.geocodeRunningText) els.geocodeRunningText.classList.add("hidden");
      if (els.geocodeProgressBar) els.geocodeProgressBar.style.width = "0%";
      updateGeocodeStatusBar();
    }
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
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function firstText(...values) {
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
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
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

  function $(sel) {
    return document.querySelector(sel);
  }

  function goLoginPage(withLogout = false) {
    const next = encodeURIComponent("./admin-index.html");
    const extra = withLogout ? "&logout=1" : "";
    location.href = `./login.html?next=${next}${extra}`;
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(v) {
    try {
      if (!v) {
        sessionStorage.removeItem(SESSION_KEY);
        try { sessionStorage.removeItem(SESSION_KEY); } catch {}
        return;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    } catch {}
  }
})();
