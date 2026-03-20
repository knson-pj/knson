(() => {
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
    offices: [],
    propertyFilters: {
      source: "",
      status: "",
      keyword: "",
    },
    officeCsvPreviewRows: [],
    lastGroupSuggestion: null,
    selectedPropertyIds: new Set(),
    propertyPage: 1,
    propertyPageSize: 30,
    geocodeRunning: false,
  };

  const els = {};
  const phoneSaveTimers = new Map();

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
      sumRealtor: $("#sumRealtor"),
      sumGeneral: $("#sumGeneral"),
      sumAgents: $("#sumAgents"),
      sumAgentsCard: $("#sumAgentsCard"),
      summaryPanel: $("#summaryPanel"),
      tabsPanel: $("#tabsPanel"),
      sumOffices: $("#sumOffices"),

      // panels
      tabProperties: $("#tab-properties"),
      tabCsv: $("#tab-csv"),
      tabStaff: $("#tab-staff"),
      tabRegions: $("#tab-regions"),
      tabOffices: $("#tab-offices"),

      // properties table
      btnReloadProperties: $("#btnReloadProperties"),
      btnDeleteSelectedProperties: $("#btnDeleteSelectedProperties"),
      propSelectAll: $("#propSelectAll"),
      propSourceFilter: $("#propSourceFilter"),
      propStatusFilter: $("#propStatusFilter"),
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

      // offices
      officeCsvFileInput: $("#officeCsvFileInput"),
      btnOfficeCsvPreview: $("#btnOfficeCsvPreview"),
      btnOfficeCsvUpload: $("#btnOfficeCsvUpload"),
      btnReloadOffices: $("#btnReloadOffices"),
      officeResultBox: $("#officeResultBox"),
      officePreviewTableBody: $("#officePreviewTable tbody"),
      officePreviewEmpty: $("#officePreviewEmpty"),
      officeTableBody: $("#officeTable tbody"),
      officeEmpty: $("#officeEmpty"),
      // property edit modal
      propertyEditModalAdmin: $("#propertyEditModalAdmin"),
      aemClose: $("#aemClose"),
      aemCancel: $("#aemCancel"),
      aemForm: $("#aemForm"),
      aemSave: $("#aemSave"),
      aemDelete: $("#aemDelete"),
      aemMsg: $("#aemMsg"),

      // geocoding
      geocodeBar: $("#geocodeBar"),
      geocodePending: $("#geocodePending"),
      geocodeOk: $("#geocodeOk"),
      geocodeFailed: $("#geocodeFailed"),
      geocodeIcon: $("#geocodeIcon"),
      geocodeProgress: $("#geocodeProgress"),
      geocodeProgressBar: $("#geocodeProgressBar"),
      geocodeRunningText: $("#geocodeRunningText"),
      btnGeocodeRun: $("#btnGeocodeRun"),
      btnGeocodeRetryFailed: $("#btnGeocodeRetryFailed"),

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
          if (key === "offices") loadOffices().catch((e)=>handleAsyncError(e,"중개사무소 로드 실패"));
        }
      });
    }

    // properties
    if (els.btnReloadProperties) els.btnReloadProperties.addEventListener("click", () => loadProperties().catch((e)=>handleAsyncError(e,"물건 로드 실패")));
    if (els.btnDeleteSelectedProperties) els.btnDeleteSelectedProperties.addEventListener("click", () => {
      deleteSelectedProperties().catch((e)=>handleAsyncError(e,"삭제 실패"));
    });
    if (els.propSelectAll) els.propSelectAll.addEventListener("change", (e) => {
      toggleSelectAllProperties(!!e.target.checked);
    });
    if (els.propSourceFilter) els.propSourceFilter.addEventListener("change", (e) => {
      state.propertyFilters.source = String(e.target.value || "");
      state.propertyPage = 1;
      renderPropertiesTable();
      renderSummary();
    });
    if (els.propStatusFilter) els.propStatusFilter.addEventListener("change", (e) => {
      state.propertyFilters.status = String(e.target.value || "");
      state.propertyPage = 1;
      renderPropertiesTable();
      renderSummary();
    });
    if (els.propKeyword) els.propKeyword.addEventListener("input", debounce((e) => {
      state.propertyFilters.keyword = String(e.target.value || "").toLowerCase();
      state.propertyPage = 1;
      renderPropertiesTable();
      renderSummary();
    }, 150));

    // CSV import (관리자만)
    if (els.btnCsvUpload) els.btnCsvUpload.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return alert("CSV 업로드는 관리자만 가능합니다.");
      handleCsvUpload().catch((e)=>handleAsyncError(e,"업로드 실패"));
    });

    // staff/regions/offices (관리자만)
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

    if (els.btnOfficeCsvPreview) els.btnOfficeCsvPreview.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      handleOfficeCsvPreview();
    });
    if (els.btnOfficeCsvUpload) els.btnOfficeCsvUpload.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      handleOfficeCsvUpload().catch((e)=>handleAsyncError(e,"업로드 실패"));
    });
    if (els.btnReloadOffices) els.btnReloadOffices.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      loadOffices();
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

    // geocoding
    if (els.btnGeocodeRun) els.btnGeocodeRun.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      runGeocoding(false).catch((e) => handleAsyncError(e, "지오코딩 실패"));
    });
    if (els.btnGeocodeRetryFailed) els.btnGeocodeRetryFailed.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return;
      runGeocoding(true).catch((e) => handleAsyncError(e, "지오코딩 재시도 실패"));
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
      offices: els.tabOffices,
    };
    Object.entries(map).forEach(([key, panel]) => {
      if (!panel) return;
      panel.classList.toggle("hidden", key !== tab);
    });
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

    els.adminUserBadge.textContent = "관리자: " + (user.name || user.email || "");
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
    state.offices = [];
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
    let lastError = null;
    for (const filter of filters) {
      const { data, error } = await queryBase().or(filter);
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
    // Supabase가 설정되어 있으면 Supabase DB를 우선 사용합니다.
    // (Vercel API 401/CORS 이슈와 무관하게 안정적으로 동작)
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
        renderPropertiesTable();
        renderSummary();
        return;
      }

      const data = await fetchAllPropertiesPaged(sb, { isAdmin, uid });
      state.properties = Array.isArray(data) ? data.map(normalizeProperty) : [];
      pruneSelectedPropertyIds();
      hydrateAssignedAgentNames();
      renderPropertiesTable();
      renderSummary();
      updateGeocodeStatusBar();
      return;
    }

    const user = state.session?.user || null;
    const isAdmin = user?.role === "admin";
    const path = isAdmin ? "/properties?scope=all" : "/properties?scope=mine";
    const res = await api(path, { auth: true });
    state.properties = Array.isArray(res?.items) ? res.items.map(normalizeProperty) : [];
    pruneSelectedPropertyIds();
    hydrateAssignedAgentNames();
    renderPropertiesTable();
    renderSummary();
    updateGeocodeStatusBar();
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

  async function loadOffices() {
    const res = await api("/admin/realtor-offices", { auth: true });
    state.offices = Array.isArray(res?.items) ? res.items.map(normalizeOffice) : [];
    renderOfficesTable();
    renderSummary();
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

    return {
      id: String(item.id || item._id || item.globalId || item.global_id || ""),
      globalId: String(item.globalId || item.global_id || (sourceType && itemNo ? `${sourceType}:${itemNo}` : "")),
      sourceType,
      itemNo,
      isGeneral: Boolean(item.isGeneral || item.is_general || item.origin === "general" || sourceType === "general"),
      address,
      assetType: firstText(item.assetType, item.asset_type, item.type, item.propertyType, item.kind, raw.assetType, raw['세부유형'], "-"),
      floor: firstText(item.floor, item.floor_text, raw.floor, raw.floorText, raw["해당층"], extractFloorText(address, raw["물건명"], raw.address)),
      totalfloor: firstText(item.totalfloor, item.total_floor, raw.totalfloor, raw.total_floor, raw.totalFloor, raw["총층"], ""),
      priceMain,
      lowprice,
      status: firstText(item.status, raw.status, ""),
      latitude,
      longitude,
      assignedAgentId: item.assignedAgentId || item.assigneeId || item.assignee_id || null,
      assignedAgentName: firstText(item.assignedAgentName, item.assigneeName, item.assignee_name, raw.assignedAgentName, raw.assigneeName, raw.assignee_name, ""),
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
      _raw: item,
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

  function normalizeOffice(item) {
    return {
      id: item.id || "",
      officeName: item.officeName || "",
      branchName: item.branchName || "",
      address: item.address || "",
      regionGu: item.regionGu || "",
      regionDong: item.regionDong || "",
      managerName: item.managerName || "",
      phone: item.phone || "",
      memo: item.memo || item.raw?.memo || "",
    };
  }

  // ---------------------------
  // Summary / Render
  // ---------------------------
  function renderAll() {
    renderPropertiesTable();
    renderStaffTable();
    renderAssignmentTable();
    renderOfficesTable();
    renderSummary();
  }

  function renderSummary() {
    const props = state.properties;
    const staff = state.staff;
    const offices = state.offices;

    if (els.sumTotal) els.sumTotal.textContent = String(props.length);
    if (els.sumAuction) els.sumAuction.textContent = String(props.filter(p => p.sourceType === "auction").length);
    if (els.sumGongmae) els.sumGongmae.textContent = String(props.filter(p => p.sourceType === "onbid").length);
    if (els.sumRealtor) els.sumRealtor.textContent = String(props.filter(p => p.sourceType === "realtor").length);
    if (els.sumGeneral) els.sumGeneral.textContent = String(props.filter(p => p.sourceType === "general").length);

    if (els.sumAgents) els.sumAgents.textContent = String(staff.filter(s => normalizeRole(s.role) === "staff").length);
    if (els.sumOffices) els.sumOffices.textContent = String(offices.length);
  }

  function getFilteredProperties() {
    const f = state.propertyFilters;
    const kw = (f.keyword || "").toLowerCase().trim();

    return state.properties.filter((p) => {
      if (f.source && p.sourceType !== f.source) return false;
      if (f.status) {
        if ((p.status || "") !== f.status && !(p.status || "").includes(f.status)) return false;
      }
      if (kw) {
        const hay = [
          p.itemNo,
          p.address,
          p.assetType,
          p.floor,
          p.totalfloor,
          p.rightsAnalysis,
          p.siteInspection,
          p.opinion,
          (p.assignedAgentName || getStaffNameById(p.assignedAgentId)),
          p.regionGu,
          p.regionDong,
          p.status,
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

  function renderAdminPropertiesPagination(totalPages) {
    if (!els.adminPropertiesPagination) return;
    els.adminPropertiesPagination.innerHTML = '';
    if (totalPages <= 1) {
      els.adminPropertiesPagination.classList.add('hidden');
      return;
    }
    els.adminPropertiesPagination.classList.remove('hidden');
    const frag = document.createDocumentFragment();
    const addBtn = (label, page, disabled=false, active=false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = active ? 'pager-num is-active' : (typeof label === 'number' ? 'pager-num' : 'pager-btn');
      b.textContent = String(label);
      b.disabled = disabled;
      if (!disabled) b.addEventListener('click', () => { state.propertyPage = page; renderPropertiesTable(); window.scrollTo({ top: els.propertiesTableBody?.closest('.table-wrap')?.getBoundingClientRect().top + window.scrollY - 120, behavior:'smooth' }); });
      frag.appendChild(b);
    };
    addBtn('이전', state.propertyPage - 1, state.propertyPage <= 1);
    const start = Math.max(1, state.propertyPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let p = start; p <= end; p += 1) addBtn(p, p, false, p === state.propertyPage);
    addBtn('다음', state.propertyPage + 1, state.propertyPage >= totalPages);
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
    const rows = getPagedProperties(getFilteredProperties()).rows;
    rows.forEach((p) => {
      const key = String(p.id || p.globalId || "").trim();
      if (!key) return;
      if (checked) state.selectedPropertyIds.add(key);
      else state.selectedPropertyIds.delete(key);
    });
    renderPropertiesTable();
  }

  function updatePropertySelectionControls() {
    const rows = getPagedProperties(getFilteredProperties()).rows;
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
    await loadProperties();
  }

  function renderPropertiesTable() {
    const rows = getFilteredProperties();
    const pageData = getPagedProperties(rows);
    els.propertiesTableBody.innerHTML = "";

    if (!rows.length) {
      els.propertiesEmpty.classList.remove("hidden");
      updatePropertySelectionControls();
      renderAdminPropertiesPagination(0);
      return;
    }
    els.propertiesEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    for (const p of pageData.rows) {
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
    renderAdminPropertiesPagination(pageData.totalPages);
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

    if (!isAdmin) {
      const myId = user?.id || "";
      const assignedId = item.assignedAgentId || "";
      if (assignedId && myId && assignedId !== myId) {
        alert("본인에게 배정된 물건만 수정할 수 있습니다.");
        return;
      }
    }

    state.editingProperty = item;

    if (isAdmin) {
      await ensureStaffForPropertyModal();
    }

    const f = els.aemForm;
    const setVal = (name, v) => {
      const el = f.elements[name];
      if (!el) return;
      el.value = v == null ? "" : String(v);
    };

    setVal("itemNo", item.itemNo);
    setVal("sourceType", item.sourceType);
    populateAssigneeSelect(item.assignedAgentId || item.assigneeId || item.assignee_id || "");
    setVal("submitterType", item.submitterType);
    setVal("address", item.address);
    setVal("assetType", item.assetType);
    setVal("floor", item.floor ?? "");
    setVal("totalfloor", item.totalfloor ?? "");
    setVal("commonarea", formatModalAreaValue(item.sourceType, item.commonarea ?? ""));
    setVal("exclusivearea", formatModalAreaValue(item.sourceType, item.exclusivearea ?? ""));
    setVal("sitearea", formatModalAreaValue(item.sourceType, item.sitearea ?? ""));
    setVal("useapproval", item.useapproval ?? "");
    setVal("status", item.status ?? "");
    setVal("priceMain", item.priceMain ?? "");
    setVal("lowprice", item.lowprice ?? "");
    setVal("dateMain", toInputDateTimeLocal(item.dateMain) ?? "");
    setVal("sourceUrl", item.sourceUrl ?? "");
    setVal("date", formatDate(item.createdAt) ?? "");
    setVal("realtorname", item.realtorname ?? "");
    setVal("realtorphone", item.realtorphone ?? "");
    setVal("realtorcell", item.realtorcell ?? "");
    setVal("rightsAnalysis", item.rightsAnalysis ?? "");
    setVal("siteInspection", item.siteInspection ?? "");
    setVal("opinion", item.opinion ?? "");
    setVal("latitude", item.latitude ?? "");
    setVal("longitude", item.longitude ?? "");
    toggleBrokerFieldsBySource(item.sourceType);

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

    lockIfHas("itemNo", hasText(item.itemNo));
    lockIfHas("address", hasText(item.address));
    lockIfHas("assetType", hasText(item.assetType));
    lockIfHas("floor", hasText(item.floor));
    lockIfHas("totalfloor", hasText(item.totalfloor));
    lockIfHas("commonarea", hasNum(item.commonarea));
    lockIfHas("exclusivearea", hasNum(item.exclusivearea));
    lockIfHas("sitearea", hasNum(item.sitearea));
    lockIfHas("useapproval", hasText(item.useapproval));
    lockIfHas("status", hasText(item.status));
    lockIfHas("priceMain", hasNum(item.priceMain));
    lockIfHas("lowprice", hasNum(item.lowprice));
    lockIfHas("dateMain", hasText(item.dateMain));
    lockIfHas("sourceUrl", hasText(item.sourceUrl));
    lockIfHas("realtorname", hasText(item.realtorname));
    lockIfHas("realtorphone", hasText(item.realtorphone));
    lockIfHas("realtorcell", hasText(item.realtorcell));
    lockIfHas("rightsAnalysis", hasText(item.rightsAnalysis));
    lockIfHas("siteInspection", hasText(item.siteInspection));
    lockIfHas("opinion", hasText(item.opinion));
    lockIfHas("latitude", hasNum(item.latitude));
    lockIfHas("longitude", hasNum(item.longitude));

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
    const readNum = (k) => {
      const v = String(fd.get(k) || "").trim();
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

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
      opinion: readStr("opinion") || null,
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
      ["itemNo","address","assetType","floor","totalfloor","useapproval","status","dateMain","sourceUrl","realtorname","realtorphone","realtorcell","rightsAnalysis","siteInspection","opinion"].forEach((k)=>allowIfEmpty(k, item[k]));
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
        exclusive_area: patch.exclusivearea,
        common_area: patch.commonarea,
        site_area: patch.sitearea,
        use_approval: patch.useapproval || null,
        status: patch.status,
        price_main: patch.priceMain,
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
      const col = String(targetId).includes(":") ? "global_id" : "id";
      const { error } = await sb.from("properties").update(dbPatch).eq(col, targetId);
      if (error) throw error;
      return;
    }

    const payload = { ...patch, raw: mergePropertyRaw(item, patch) };
    const candidates = [];
    if (isAdmin) {
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

  function renderOfficesTable() {
    if (!els.officeTableBody || !els.officeEmpty) return;
    els.officeTableBody.innerHTML = "";

    if (!Array.isArray(state.offices) || !state.offices.length) {
      els.officeEmpty.classList.remove("hidden");
      return;
    }
    els.officeEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    state.offices.forEach((office) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(office.officeName || "-")}</td>
        <td>${escapeHtml(office.branchName || "-")}</td>
        <td>${escapeHtml(office.address || "-")}</td>
        <td>${escapeHtml([office.regionGu, office.regionDong].filter(Boolean).join(" / ") || "-")}</td>
        <td>${escapeHtml(office.managerName || "-")}</td>
        <td>
          <input class="inline-input office-phone-input" data-id="${escapeAttr(office.id)}" type="text" value="${escapeAttr(formatPhoneDisplay(office.phone || ""))}" placeholder="01012345678" />
          <div class="muted small" data-save-msg="${escapeAttr(office.id)}"></div>
        </td>
        <td>${escapeHtml(office.memo || "-")}</td>
      `;
      frag.appendChild(tr);
    });
    els.officeTableBody.appendChild(frag);

    els.officeTableBody.querySelectorAll(".office-phone-input").forEach((input) => {
      input.addEventListener("input", () => {
        scheduleOfficePhoneSave(input.dataset.id, input.value);
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
        const mappedRows = [];
        for (const r of rawRows) {
          const m = mapPropertyCsvRow(r, sourceType);
          // itemNo 없으면 global_id = "sourceType:" 으로 중복돼 upsert 에러 유발
          if (!m || !m.itemNo || !m.address) continue;
          const built = buildSupabasePropertyRow(r, m, sourceType);
          if (!built.global_id || built.global_id.endsWith(":")) continue;
          mappedRows.push(built);
        }

        if (!mappedRows.length) throw new Error("유효한 행이 없습니다.");

        // chunk upsert
        const chunks = (K && typeof K.chunk === "function") ? K.chunk(mappedRows, 500) : chunkArray(mappedRows, 500);
        let okCnt = 0;
        for (const c of chunks) {
          const { error } = await sb.from("properties").upsert(c, { onConflict: "global_id" });
          if (error) throw error;
          okCnt += c.length;
        }

        showResultBox(els.csvResultBox, `업로드 완료 / 처리: ${okCnt}건`);
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

  // ---------------------------
  // Region Assignments  // ---------------------------
  // Region Assignments

  // ---------------------------
  function getRegionOptionsFromProperties() {
    const set = new Set();
    for (const p of state.properties) {
      if (p.regionGu) set.add(p.regionGu);
      if (p.regionDong) set.add(p.regionDong);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }

  async function handleSuggestGrouping() {
    const agents = state.staff.filter((s) => normalizeRole(s.role) === "staff");
    if (!agents.length) return alert("담당자 계정을 먼저 등록해 주세요.");

    const requestedCount = Math.max(1, Number(els.agentCountInput.value || 1));
    const unitMode = els.regionUnitMode.value; // auto|gu|dong

    const grouped = buildAutoRegionGrouping(state.properties, requestedCount, unitMode);
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

  // ---------------------------
  // Offices CSV / Autosave
  // ---------------------------
  async function handleOfficeCsvPreview() {
    try {
      const file = els.officeCsvFileInput.files?.[0];
      if (!file) return alert("CSV 파일을 선택해 주세요.");
      const text = await readCsvFileText(file, "realtor");
      const rows = parseCsv(text);
      state.officeCsvPreviewRows = rows.map(mapOfficeCsvRow).filter(Boolean);
      renderOfficeCsvPreviewTable();
      showResultBox(els.officeResultBox, `미리보기 완료: ${state.officeCsvPreviewRows.length}행`);
    } catch (err) {
      console.error(err);
      showResultBox(els.officeResultBox, `미리보기 실패: ${err.message}`, true);
    }
  }

  function renderOfficeCsvPreviewTable() {
    els.officePreviewTableBody.innerHTML = "";
    if (!state.officeCsvPreviewRows.length) {
      els.officePreviewEmpty.classList.remove("hidden");
      return;
    }
    els.officePreviewEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    state.officeCsvPreviewRows.slice(0, 200).forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(r.officeName)}</td>
        <td>${escapeHtml(r.address)}</td>
        <td>${escapeHtml(r.regionGu || "-")}</td>
        <td>${escapeHtml(r.regionDong || "-")}</td>
        <td>${escapeHtml(r.managerName || "-")}</td>
      `;
      frag.appendChild(tr);
    });
    els.officePreviewTableBody.appendChild(frag);
  }

  async function handleOfficeCsvUpload() {
    try {
      const file = els.officeCsvFileInput.files?.[0];
      if (!file) return alert("CSV 파일을 선택해 주세요.");
      const csvText = await readCsvFileText(file, "realtor");

      const res = await api("/admin/import/realtor-offices-csv", {
        method: "POST",
        auth: true,
        body: { csvText },
      });

      const summary = [
        `업로드 완료`,
        `삽입: ${res?.inserted ?? 0}건`,
        `갱신: ${res?.updated ?? 0}건`,
        `오류: ${res?.errors ?? 0}건`,
      ].join(" / ");

      showResultBox(els.officeResultBox, summary);
      await loadOffices();
    } catch (err) {
      console.error(err);
      if (err?.code === "LOGIN_REQUIRED" || err?.status === 401) {
        setGlobalMsg("로그인이 필요합니다. 다시 로그인해 주세요.");
        goLoginPage(true);
      }
      showResultBox(els.officeResultBox, `업로드 실패: ${err.message}`, true);
    }
  }

  function mapOfficeCsvRow(row) {
    const pick = (...keys) => {
      for (const k of keys) {
        if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
      }
      return "";
    };

    const officeName = pick("office_name", "사무소명", "중개사무소명");
    const address = pick("address", "주소");
    if (!officeName || !address) return null;

    const x = extractGuDong(address);

    return {
      officeName,
      branchName: pick("branch_name", "지점명"),
      address,
      regionGu: pick("region_gu", "구") || x.gu || "",
      regionDong: pick("region_dong", "동") || x.dong || "",
      managerName: pick("manager_name", "담당자"),
      phone: pick("phone", "핸드폰", "휴대폰", "전화번호"),
      memo: pick("memo", "비고"),
    };
  }

  function scheduleOfficePhoneSave(id, rawValue) {
    const key = String(id);
    clearTimeout(phoneSaveTimers.get(key));
    setSaveMsg(id, "저장 대기...");
    const t = setTimeout(() => flushOfficePhoneSave(id, rawValue), 700);
    phoneSaveTimers.set(key, t);
  }

  async function flushOfficePhoneSave(id, rawValue) {
    const key = String(id);
    clearTimeout(phoneSaveTimers.get(key));

    const phone = normalizePhone(rawValue);
    setSaveMsg(id, "저장 중...");

    try {
      await api(`/admin/realtor-offices/${encodeURIComponent(id)}/phone`, {
        method: "PATCH",
        auth: true,
        body: { phone },
      });

      const row = state.offices.find((o) => o.id === id);
      if (row) row.phone = phone;
      setSaveMsg(id, "저장됨");
    } catch (err) {
      console.error(err);
      setSaveMsg(id, "저장 실패");
    }
  }

  function setSaveMsg(id, msg) {
    const el = document.querySelector(`[data-save-msg="${CSS.escape(String(id))}"]`);
    if (el) el.textContent = msg;
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
    if (!els.geocodeBar) return;
    const user = state.session?.user;
    if (!user || user.role !== "admin") {
      els.geocodeBar.classList.add("hidden");
      return;
    }
    const stats = getGeocodeStats();
    els.geocodeBar.classList.toggle("hidden", stats.total === 0);

    if (els.geocodePending) els.geocodePending.textContent = String(stats.pending);
    if (els.geocodeOk) els.geocodeOk.textContent = String(stats.ok);
    if (els.geocodeFailed) els.geocodeFailed.textContent = String(stats.failed);

    if (els.btnGeocodeRun) {
      els.btnGeocodeRun.disabled = stats.pending === 0 || state.geocodeRunning;
      els.btnGeocodeRun.textContent = state.geocodeRunning ? "실행 중..." : "지오코딩 실행";
    }
    if (els.btnGeocodeRetryFailed) {
      els.btnGeocodeRetryFailed.classList.toggle("hidden", stats.failed === 0);
      els.btnGeocodeRetryFailed.disabled = stats.failed === 0 || state.geocodeRunning;
    }
    if (els.geocodeIcon) {
      els.geocodeIcon.textContent = state.geocodeRunning ? "\u23F3" : (stats.pending > 0 ? "\uD83D\uDCCD" : "\u2705");
    }
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
    const assigneeId = patch.assigneeId ?? item?.assignedAgentId ?? currentRaw.assigneeId ?? currentRaw.assignedAgentId ?? null;
    const assigneeName = assigneeId ? getStaffNameById(assigneeId) : '';
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
      assigneeId,
      assignedAgentId: assigneeId,
      assigneeName: assigneeName || currentRaw.assigneeName || currentRaw.assignedAgentName || null,
      assignedAgentName: assigneeName || currentRaw.assignedAgentName || currentRaw.assigneeName || null,
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
