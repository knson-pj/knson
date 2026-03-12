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

  const API_BASE = "https://knson.vercel.app/api";
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
    csvPreviewRows: [],
    officeCsvPreviewRows: [],
    lastGroupSuggestion: null,
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
      sumOffices: $("#sumOffices"),

      // panels
      tabProperties: $("#tab-properties"),
      tabCsv: $("#tab-csv"),
      tabStaff: $("#tab-staff"),
      tabRegions: $("#tab-regions"),
      tabOffices: $("#tab-offices"),

      // properties table
      btnReloadProperties: $("#btnReloadProperties"),
      propSourceFilter: $("#propSourceFilter"),
      propStatusFilter: $("#propStatusFilter"),
      propKeyword: $("#propKeyword"),
      propertiesTableBody: $("#propertiesTable tbody"),
      propertiesEmpty: $("#propertiesEmpty"),

      // CSV import
      csvImportSource: $("#csvImportSource"),
      csvFileInput: $("#csvFileInput"),
      btnCsvPreview: $("#btnCsvPreview"),
      btnCsvUpload: $("#btnCsvUpload"),
      csvPreviewTableBody: $("#csvPreviewTable tbody"),
      csvPreviewEmpty: $("#csvPreviewEmpty"),
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

    });
  }


  function setupChrome() {
    if (K && typeof K.initTheme === "function") {
      K.initTheme({ container: document.querySelector(".top-actions"), className: "theme-toggle" });
    }

    const actions = document.querySelector(".top-actions");
    if (actions && !actions.querySelector(".top-link")) {
      const mainLink = document.createElement("a");
      mainLink.className = "btn btn-secondary top-link";
      mainLink.href = "./index.html";
      mainLink.textContent = "메인으로";
      actions.prepend(mainLink);
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
    if (els.propSourceFilter) els.propSourceFilter.addEventListener("change", (e) => {
      state.propertyFilters.source = String(e.target.value || "");
      renderPropertiesTable();
      renderSummary();
    });
    if (els.propStatusFilter) els.propStatusFilter.addEventListener("change", (e) => {
      state.propertyFilters.status = String(e.target.value || "");
      renderPropertiesTable();
      renderSummary();
    });
    if (els.propKeyword) els.propKeyword.addEventListener("input", debounce((e) => {
      state.propertyFilters.keyword = String(e.target.value || "").toLowerCase();
      renderPropertiesTable();
      renderSummary();
    }, 150));

    // CSV import (관리자만)
    if (els.btnCsvPreview) els.btnCsvPreview.addEventListener("click", () => {
      if (state.session?.user?.role !== "admin") return alert("CSV 업로드는 관리자만 가능합니다.");
      handleCsvPreview();
    });
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

    if (els.regionUnitMode) els.regionUnitMode.addEventListener("change", () => {
      if (state.session?.user?.role !== "admin") return;
      renderAssignmentTable();
      handleSuggestGrouping({ silent: true });
    });
    if (els.assignmentTableBody) els.assignmentTableBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".region-chip-btn");
      if (!btn || state.session?.user?.role !== "admin") return;
      const editor = btn.closest(".assignment-editor");
      if (!editor) return;
      toggleAssignmentRegion(editor, btn.dataset.region || "");
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

    // 담당자: properties만
    if (user.role !== "admin") {
      setActiveTab("properties");
      await Promise.all([loadStaff().catch(()=>{}), loadProperties()]);
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

    if (user.role === "admin") {
      els.adminUserBadge.textContent = `관리자: ${user.name}`;
      els.adminUserBadge.className = "badge badge-admin";
    } else {
      els.adminUserBadge.textContent = `담당자: ${user.name}`;
      els.adminUserBadge.className = "badge badge-agent";
    }

    // 탭 권한: 담당자는 properties만
    const isAdmin = user.role === "admin";
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      const key = btn.getAttribute("data-tab");
      if (!key) return;
      btn.classList.toggle("hidden", !isAdmin && key !== "properties");
    });
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
      // 초기 진입에서는 "물건 리스트"만 먼저 로드해서 관리자 페이지가 바로 usable 하게.
      // (staff/offices 등 /admin/* 는 탭 진입 시 온디맨드 로드)
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
      alert(err.message || "데이터 로드 실패");
    }
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

      let q = sb.from("properties").select("*").order("date_uploaded", { ascending: false }).limit(5000);
      if (!isAdmin) {
        if (!uid) {
          state.properties = [];
          renderPropertiesTable();
          renderSummary();
          return;
        }
        q = q.eq("assignee_id", uid);
      }

      const { data, error } = await q;
      if (error) throw error;

      state.properties = Array.isArray(data) ? data.map(normalizeProperty) : [];
      hydrateAssignedAgentNames();
      renderPropertiesTable();
      renderSummary();
      return;
    }

    const isAdmin = user?.role === "admin";
    const path = isAdmin ? "/properties?scope=all" : "/properties?scope=mine";
    const res = await api(path, { auth: true });
    state.properties = Array.isArray(res?.items) ? res.items.map(normalizeProperty) : [];
    hydrateAssignedAgentNames();
    renderPropertiesTable();
    renderSummary();
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
    const rawSource = (item.sourceType || item.source || item.category || item.source_type || "").toString().toLowerCase();
    const sourceType =
      rawSource === "auction" ? "auction" :
      rawSource === "gongmae" || rawSource === "public" || rawSource === "onbid" ? "onbid" :
      rawSource === "realtor" ? "realtor" :
      rawSource === "general" ? "general" :
      "general";

    const itemNo = (item.itemNo || item.caseNo || item.externalId || item.listingId || item.item_no || "").toString().trim();
    const address = (item.address || item.location || item.addr || "").toString().trim();

    const latitude = toNumber(item.latitude ?? item.lat ?? item.y ?? "");
    const longitude = toNumber(item.longitude ?? item.lng ?? item.x ?? "");

    return {
      id: (item.id || item._id || item.globalId || item.global_id || "").toString(),
      globalId: (item.globalId || item.global_id || (sourceType && itemNo ? `${sourceType}:${itemNo}` : "")).toString(),
      sourceType,
      itemNo,
      isGeneral: Boolean(item.isGeneral || item.is_general || item.origin === "general" || sourceType === "general"),
      address,
      assetType: (item.assetType || item.asset_type || item.type || item.propertyType || item.kind || "").toString().trim(),
      priceMain: toNumber(item.priceMain ?? item.price_main ?? item.salePrice ?? item.price ?? item.appraisalPrice ?? 0),
      status: (item.status || "").toString(),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      assignedAgentId: item.assignedAgentId || item.assigneeId || item.assignee_id || null,
      assignedAgentName: item.assignedAgentName || item.assigneeName || "",
      createdAt: item.date || item.date_uploaded || item.createdAt || item.created_at || "",
      duplicateFlag: !!item.duplicateFlag,
      regionGu: item.regionGu || "",
      regionDong: item.regionDong || "",
      memo: item.memo || item.raw?.memo || "",
      exclusivearea: toNumber(item.exclusivearea ?? item.exclusive_area ?? item.exclusiveArea ?? ""),
      commonarea: toNumber(item.commonarea ?? item.common_area ?? item.commonArea ?? ""),
      sitearea: toNumber(item.sitearea ?? item.site_area ?? item.siteArea ?? ""),
      useapproval: item.useapproval || item.use_approval || "",
      dateMain: item.dateMain || item.date_main || "",
      sourceUrl: item.sourceUrl || item.source_url || "",
      submitterType: item.submitterType || item.submitter_type || "",
      submitterName: item.submitterName || item.submitter_name || "",
      submitterPhone: item.submitterPhone || item.submitter_phone || "",
      brokerOfficeName: item.brokerOfficeName || item.broker_office_name || "",
      brokerName: item.brokerName || item.broker_name || "",
      brokerLicenseNo: item.brokerLicenseNo || item.broker_license_no || "",
      _raw: item,
    };
  }

  function normalizeStaff(item) {
    return {
      id: item.id || "",
      email: item.email || "",
      name: item.name || item.email || "",
      role: item.role || "staff",
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

    if (els.sumAgents) els.sumAgents.textContent = String(staff.filter(s => s.role !== "admin").length);
    if (els.sumOffices) els.sumOffices.textContent = String(offices.length);
  }

  function getFilteredProperties() {
    const f = state.propertyFilters;
    const kw = (f.keyword || "").toLowerCase().trim();

    return state.properties.filter((p) => {
      if (f.source && p.sourceType !== f.source) return false;
      if (f.status) {
        // exact match for status codes if stored; otherwise substring
        if ((p.status || "") !== f.status && !(p.status || "").includes(f.status)) return false;
      }
      if (kw) {
        const hay = [
          p.itemNo,
          p.address,
          p.assetType,
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

  function renderPropertiesTable() {
    const rows = getFilteredProperties();
    els.propertiesTableBody.innerHTML = "";

    if (!rows.length) {
      els.propertiesEmpty.classList.remove("hidden");
      return;
    }
    els.propertiesEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    for (const p of rows) {
      const tr = document.createElement("tr");

      const kindLabel = p.sourceType === "auction" ? "경매" : p.sourceType === "onbid" ? "공매" : p.sourceType === "realtor" ? "중개" : "일반";

      tr.innerHTML = `
        <td>${escapeHtml(p.itemNo || "-")}</td>
        <td>${escapeHtml(kindLabel)}</td>
        <td>${escapeHtml(p.address || "-")}</td>
        <td>${escapeHtml(p.assetType || "-")}</td>
        <td>${p.priceMain ? formatMoneyKRW(p.priceMain) : "-"}</td>
        <td>${escapeHtml(statusLabel(p.status) || p.status || "-")}</td>
        <td>${p.latitude != null ? escapeHtml(String(p.latitude)) : '<span class="cell-badge warn">필요</span>'}</td>
        <td>${p.longitude != null ? escapeHtml(String(p.longitude)) : '<span class="cell-badge warn">필요</span>'}</td>
        <td>${escapeHtml((p.assignedAgentName || getStaffNameById(p.assignedAgentId)) || "미배정")}</td>
        <td>${escapeHtml(formatDate(p.createdAt) || "-")}</td>
      `;

      tr.addEventListener("click", () => openPropertyEditModal(p));
      frag.appendChild(tr);
    }
    els.propertiesTableBody.appendChild(frag);
  }

  // ---------------------------
  // Property Edit Modal
  // ---------------------------
  function openPropertyEditModal(item) {
    if (!els.propertyEditModalAdmin || !els.aemForm) return;

    const user = state.session?.user;
    const isAdmin = user?.role === "admin";

    // 담당자: 본인 물건만
    if (!isAdmin) {
      const myId = user?.id || "";
      const assignedId = item.assignedAgentId || "";
      if (assignedId && myId && assignedId !== myId) {
        alert("본인에게 배정된 물건만 수정할 수 있습니다.");
        return;
      }
    }

    state.editingProperty = item;

    const f = els.aemForm;
    const setVal = (name, v) => {
      const el = f.elements[name];
      if (!el) return;
      el.value = v == null ? "" : String(v);
    };

    setVal("itemNo", item.itemNo);
    setVal("sourceType", item.sourceType);
    populateAssigneeSelect(item.assignedAgentId);
    setVal("submitterType", item.submitterType);
    setVal("address", item.address);
    setVal("assetType", item.assetType);
    setVal("exclusivearea", item.exclusivearea ?? "");
    setVal("commonarea", item.commonarea ?? "");
    setVal("sitearea", item.sitearea ?? "");
    setVal("useapproval", item.useapproval ?? "");
    setVal("status", item.status ?? "");
    setVal("priceMain", item.priceMain ?? "");
    setVal("dateMain", toInputDateTimeLocal(item.dateMain) ?? "");
    setVal("sourceUrl", item.sourceUrl ?? "");
    setVal("submitterName", item.submitterName ?? "");
    setVal("submitterPhone", item.submitterPhone ?? "");
    setVal("brokerOfficeName", item.brokerOfficeName ?? "");
    setVal("brokerName", item.brokerName ?? "");
    setVal("brokerLicenseNo", item.brokerLicenseNo ?? "");
    setVal("memo", item.memo ?? "");
    setVal("latitude", item.latitude ?? "");
    setVal("longitude", item.longitude ?? "");

    // 담당자: 빈 값만
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
    lockIfHas("exclusivearea", hasNum(item.exclusivearea));
    lockIfHas("commonarea", hasNum(item.commonarea));
    lockIfHas("sitearea", hasNum(item.sitearea));
    lockIfHas("useapproval", hasText(item.useapproval));
    lockIfHas("status", hasText(item.status));
    lockIfHas("priceMain", hasNum(item.priceMain));
    lockIfHas("dateMain", hasText(item.dateMain));
    lockIfHas("sourceUrl", hasText(item.sourceUrl));
    lockIfHas("memo", hasText(item.memo));
    lockIfHas("latitude", hasNum(item.latitude));
    lockIfHas("longitude", hasNum(item.longitude));

    // 관리자 전용 필드
    if (f.elements["sourceType"]) f.elements["sourceType"].disabled = !isAdmin;
    if (f.elements["assigneeId"]) f.elements["assigneeId"].disabled = !isAdmin;
    if (f.elements["submitterType"]) f.elements["submitterType"].disabled = !isAdmin;
    if (els.aemDelete) els.aemDelete.classList.toggle("hidden", !isAdmin);

    setAemMsg("");
    setModalOpen(true);
    els.propertyEditModalAdmin.classList.remove("hidden");
    els.propertyEditModalAdmin.setAttribute("aria-hidden", "false");
  }

  function populateAssigneeSelect(selectedId) {
    const sel = els.aemForm?.elements["assigneeId"];
    if (!sel) return;
    const staffRows = state.staff.filter((s) => s.role !== "admin");
    sel.innerHTML = `<option value="">미배정</option>` + staffRows.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join("");
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
      exclusivearea: readNum("exclusivearea"),
      commonarea: readNum("commonarea"),
      sitearea: readNum("sitearea"),
      useapproval: readStr("useapproval") || null,
      status: readStr("status") || null,
      priceMain: readNum("priceMain"),
      dateMain: readStr("dateMain") || null,
      sourceUrl: readStr("sourceUrl") || null,
      submitterName: readStr("submitterName") || null,
      submitterPhone: readStr("submitterPhone") || null,
      brokerOfficeName: readStr("brokerOfficeName") || null,
      brokerName: readStr("brokerName") || null,
      brokerLicenseNo: readStr("brokerLicenseNo") || null,
      memo: readStr("memo") || null,
      latitude: readNum("latitude"),
      longitude: readNum("longitude"),
    };

    if (!isAdmin) {
      // 빈 값만
      const allowIfEmpty = (k, oldVal) => {
        const v = patch[k];
        const isEmptyOld = oldVal == null || String(oldVal).trim() === "";
        const isEmptyOldNum = oldVal == null || String(oldVal).trim() === "" || Number.isNaN(Number(oldVal));
        const ok = (typeof v === "number") ? isEmptyOldNum : isEmptyOld;
        if (!ok) delete patch[k];
      };
      allowIfEmpty("itemNo", item.itemNo);
      allowIfEmpty("address", item.address);
      allowIfEmpty("assetType", item.assetType);
      allowIfEmpty("exclusivearea", item.exclusivearea);
      allowIfEmpty("commonarea", item.commonarea);
      allowIfEmpty("sitearea", item.sitearea);
      allowIfEmpty("useapproval", item.useapproval);
      allowIfEmpty("status", item.status);
      allowIfEmpty("priceMain", item.priceMain);
      allowIfEmpty("dateMain", item.dateMain);
      allowIfEmpty("sourceUrl", item.sourceUrl);
      allowIfEmpty("memo", item.memo);
      allowIfEmpty("latitude", item.latitude);
      allowIfEmpty("longitude", item.longitude);
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

      await updatePropertyAdmin(targetId, patch, isAdmin);

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

  async function updatePropertyAdmin(targetId, patch, isAdmin) {
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    if (sb) {
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
        submitter_name: patch.submitterName,
        submitter_phone: patch.submitterPhone,
        broker_office_name: patch.brokerOfficeName,
        broker_name: patch.brokerName,
        broker_license_no: patch.brokerLicenseNo,
        memo: patch.memo,
        latitude: patch.latitude,
        longitude: patch.longitude,
      };
      Object.keys(dbPatch).forEach((k) => dbPatch[k] === undefined && delete dbPatch[k]);
      const col = String(targetId).includes(":") ? "global_id" : "id";
      const { error } = await sb.from("properties").update(dbPatch).eq(col, targetId);
      if (error) throw error;
      return;
    }

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
        await api(c.path, { method: c.method, auth: true, body: patch });
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
    if (state.session?.user?.role !== "admin") {
      alert("관리자만 삭제할 수 있습니다.");
      return;
    }
    if (!confirm(`물건 '${item.itemNo || item.address || item.id}' 을(를) 삭제할까요?`)) return;

    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    if (sb) {
      const { error } = await sb.from("properties").delete().eq("id", item.id);
      if (error) throw error;
      closePropertyEditModal();
      await loadProperties();
      return;
    }

    await api("/admin/properties", { method: "DELETE", auth: true, body: { id: item.id || item.globalId } });
    closePropertyEditModal();
    await loadProperties();
  }


  function renderStaffTable() {
    els.staffTableBody.innerHTML = "";

    if (!state.staff.length) {
      els.staffEmpty.classList.remove("hidden");
      return;
    }
    els.staffEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();

    state.staff.forEach((s) => {
      const tr = document.createElement("tr");
      const roleLabel = s.role === "admin" ? "관리자" : "담당자";
      tr.innerHTML = `
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(roleLabel)}</td>
        <td>${s.assignedRegions.length}</td>
        <td>${escapeHtml(formatDate(s.createdAt))}</td>
        <td>
          <div class="action-row">
            <button class="btn btn-secondary btn-sm" data-act="edit" data-id="${escapeAttr(s.id)}">수정</button>
            <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${escapeAttr(s.id)}">삭제</button>
          </div>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.staffTableBody.appendChild(frag);

    els.staffTableBody.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.currentTarget.dataset.id;
        const act = e.currentTarget.dataset.act;
        const row = state.staff.find((s) => s.id === id);
        if (!row) return;

        if (act === "edit") {
          fillStaffForm(row);
          setActiveTab("staff");
        } else if (act === "delete") {
          if (!confirm(`담당자 '${row.name}' 계정을 삭제할까요?`)) return;
          try {
            await api(`/admin/staff/${encodeURIComponent(id)}`, {
              method: "DELETE",
              auth: true,
            });
            await loadStaff();
          } catch (err) {
            console.error(err);
            alert(err.message || "삭제 실패");
          }
        }
      });
    });
  }

  function renderAssignmentTable() {
    els.assignmentTableBody.innerHTML = "";

    const agents = state.staff.filter((s) => s.role !== "admin");
    syncAgentCountInput(agents.length);

    if (!agents.length) {
      els.assignmentEmpty.classList.remove("hidden");
      els.groupSuggestBox.innerHTML = "";
      return;
    }
    els.assignmentEmpty.classList.add("hidden");

    const requestedCount = Math.max(1, agents.length);
    const regionOptions = getRegionOptionsFromProperties(requestedCount, els.regionUnitMode?.value || "auto");
    const hasSavedAssignments = agents.some((a) => Array.isArray(a.assignedRegions) && a.assignedRegions.length);

    const frag = document.createDocumentFragment();
    agents.forEach((a) => {
      const tr = document.createElement("tr");
      const selected = Array.isArray(a.assignedRegions) ? a.assignedRegions : [];
      tr.innerHTML = `
        <td>${escapeHtml(a.name)}</td>
        <td>담당자</td>
        <td>
          <div class="assignment-editor" data-agent-id="${escapeAttr(a.id)}" data-selected='${escapeAttr(JSON.stringify(selected))}'>
            <div class="assignment-selected-badges"></div>
            <div class="assignment-chip-grid"></div>
          </div>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.assignmentTableBody.appendChild(frag);

    els.assignmentTableBody.querySelectorAll(".assignment-editor").forEach((editor) => {
      const selected = parseEditorSelected(editor);
      renderAssignmentEditor(editor, regionOptions, selected);
    });

    if (!hasSavedAssignments && regionOptions.length) {
      handleSuggestGrouping({ silent: true });
    } else if (!state.lastGroupSuggestion?.groups?.length) {
      els.groupSuggestBox.innerHTML = `<div class="muted small">자동 그룹핑 제안을 누르면 현재 물건 분포 기준으로 지역을 자동 배정합니다.</div>`;
    }
  }

  function renderOfficesTable() {
    if (!els.officeTableBody || !els.officeEmpty) return;
    els.officeTableBody.innerHTML = "";

    if (!state.offices.length) {
      els.officeEmpty.classList.remove("hidden");
      return;
    }
    els.officeEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();

    state.offices.forEach((o) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(o.officeName)}</td>
        <td>${escapeHtml(o.branchName || "-")}</td>
        <td>${escapeHtml(o.address)}</td>
        <td>${escapeHtml([o.regionGu, o.regionDong].filter(Boolean).join(" / ") || "-")}</td>
        <td>${escapeHtml(o.managerName || "-")}</td>
        <td>
          <input class="inline-input office-phone-input" data-id="${escapeAttr(o.id)}" type="text" value="${escapeAttr(formatPhoneDisplay(o.phone))}" placeholder="01012345678" />
          <div class="muted small" data-save-msg="${escapeAttr(o.id)}"></div>
        </td>
        <td>${escapeHtml(o.memo || "-")}</td>
      `;
      frag.appendChild(tr);
    });

    els.officeTableBody.appendChild(frag);

    els.officeTableBody.querySelectorAll(".office-phone-input").forEach((input) => {
      input.addEventListener("input", () => {
        scheduleOfficePhoneSave(input.dataset.id, input.value);
      });
      input.addEventListener("blur", () => {
        flushOfficePhoneSave(input.dataset.id, input.value);
      });
    });
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
    if (els.staffFormHint) {
      els.staffFormHint.innerHTML = editing
        ? '선택한 계정의 <strong>이름 / 권한</strong>만 수정합니다. 비밀번호는 상단의 <strong>내 비밀번호 변경</strong>으로 처리합니다.'
        : '신규 생성 시에는 <strong>Supabase Auth 계정 + profiles</strong>가 함께 생성됩니다. 기존 계정은 여기서 <strong>이름 / 권한</strong>만 수정하고, 비밀번호는 본인 메뉴에서 직접 변경합니다.';
    }
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

    const idEl = els.staffForm.elements.id;
    const emailEl = els.staffForm.elements.email;
    const nameEl = els.staffForm.elements.name;
    const roleEl = els.staffForm.elements.role;
    const passwordEl = els.staffForm.elements.password;

    if (idEl) idEl.value = "";
    if (emailEl) {
      emailEl.value = "";
      emailEl.disabled = false;
      emailEl.readOnly = false;
    }
    if (nameEl) {
      nameEl.value = "";
      nameEl.disabled = false;
      nameEl.readOnly = false;
    }
    if (roleEl) {
      roleEl.value = "staff";
      roleEl.disabled = false;
    }
    if (passwordEl) {
      passwordEl.value = "";
      passwordEl.disabled = false;
      passwordEl.readOnly = false;
    }

    setStaffFormMode("create");

    if (els.btnStaffSave) els.btnStaffSave.disabled = false;
    if (els.btnStaffReset) els.btnStaffReset.disabled = false;

    requestAnimationFrame(() => {
      if (emailEl && typeof emailEl.focus === "function") emailEl.focus();
    });
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
      if (!id) resetStaffForm();
    } catch (err) {
      console.error(err);
      alert(err.message || "저장 실패");
    } finally {
      setFormBusy(e.currentTarget, false);
    }
  }

  // ---------------------------
  // CSV Import (Properties)
  // ---------------------------
  async function handleCsvPreview() {
    try {
      const file = els.csvFileInput.files?.[0];
      if (!file) return alert("CSV 파일을 선택해 주세요.");
      const sourceType = String(els.csvImportSource.value || "auction"); // auction|onbid|realtor

      const text = await readCsvFileText(file, sourceType);
      const rows = parseCsv(text);
      state.csvPreviewRows = rows.map((r) => mapPropertyCsvRow(r, sourceType)).filter(Boolean);

      renderCsvPreviewTable();
      showResultBox(els.csvResultBox, `미리보기 완료: ${state.csvPreviewRows.length}행`);
    } catch (err) {
      console.error(err);
      showResultBox(els.csvResultBox, `미리보기 실패: ${err.message}`, true);
    }
  }

  function renderCsvPreviewTable() {
    els.csvPreviewTableBody.innerHTML = "";
    if (!state.csvPreviewRows.length) {
      els.csvPreviewEmpty.classList.remove("hidden");
      return;
    }
    els.csvPreviewEmpty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    state.csvPreviewRows.slice(0, 200).forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(r.itemNo || "-")}</td>
        <td>${escapeHtml(r.address || "-")}</td>
        <td>${r.priceMain ? formatMoneyKRW(r.priceMain) : "-"}</td>
        <td>${escapeHtml(r.status || "-")}</td>
        <td>${r.latitude != null ? escapeHtml(String(r.latitude)) : "-"}</td>
        <td>${r.longitude != null ? escapeHtml(String(r.longitude)) : "-"}</td>
      `;
      frag.appendChild(tr);
    });
    els.csvPreviewTableBody.appendChild(frag);
  }
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
          if (!m || !m.itemNo || !m.address) continue;
          mappedRows.push(buildSupabasePropertyRow(r, m, sourceType));
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
          source,         // legacy
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
    let latitude = null;
    let longitude = null;

    let assetType = "";
    let commonArea = null;
    let exclusiveArea = null;
    let siteArea = null;
    let useApproval = null;
    let dateMain = null;
    let sourceUrl = "";
    let memo = "";

    if (sourceType === "auction") {
      itemNo = pick("사건번호", "itemNo", "caseNo", "물건번호");
      address = pick("주소(시군구동)", "주소", "소재지", "address");
      status = pick("진행상태", "상태", "status");
      priceMain = toNum(pick("감정가", "감정가(원)", "최저가", "priceMain"));
      assetType = pick("종별", "부동산유형", "assetType");
      dateMain = toISO(pick("입찰일자", "입찰일", "dateMain")) || null;
      memo = pick("경매현황", "비고", "memo");
      const area = parseAuctionAreas(memo);
      commonArea = area.building;
      siteArea = area.site;
    } else if (sourceType === "onbid") {
      itemNo = pick("물건관리번호", "itemNo", "물건번호");
      address = pick("물건명", "소재지", "주소", "address");
      status = pick("물건상태", "상태", "status");
      priceMain = toNum(pick("감정가(원)", "감정가", "최저입찰가(원)", "priceMain"));
      assetType = pick("용도", "부동산유형", "assetType");
      dateMain = pick("입찰마감일시", "입찰마감", "dateMain") || null;
      memo = pick("물건명", "memo");
      const bM2 = pick("건물 면적(㎡)", "건물 면적(m²)", "건물 면적(m2)", "건물면적(㎡)");
      const tM2 = pick("토지 면적(㎡)", "토지 면적(m²)", "토지 면적(m2)", "토지면적(㎡)");
      if (bM2) commonArea = m2ToPyeong(bM2);
      if (tM2) siteArea = m2ToPyeong(tM2);
    } else {
      itemNo = pick("매물ID", "itemNo", "물건번호");
      address = pick("주소(통합)", "도로명주소", "지번주소", "주소", "address");
      status = pick("거래유형", "status");
      priceMain = toNum(pick("가격(표시)", "가격(원)", "가격(원본)", "매매가", "priceMain"));
      assetType = pick("세부유형", "부동산유형명", "부동산유형", "assetType");
      sourceUrl = pick("바로가기(엑셀)", "매물URL", "sourceUrl", "url");
      memo = pick("매물특징", "memo");
      const ex = pick("전용면적(평)", "전용면적", "commonArea");
      const supply = pick("공급/계약면적(평)", "공급면적(평)", "exclusiveArea");
      if (ex) commonArea = toNum(ex);
      if (supply) exclusiveArea = toNum(supply);
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
    };
  }

  function buildSupabasePropertyRow(rawRow, m, sourceType) {
    const globalId = `${sourceType}:${m.itemNo}`;
    const toNullNum = (v) => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

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

      raw: rawRow,
    };

    return row;
  }

  // ---------------------------
  // Region Assignments

  // ---------------------------
  function syncAgentCountInput(count) {
    if (!els.agentCountInput) return;
    const safe = Math.max(0, Number(count || 0));
    els.agentCountInput.value = String(safe);
    els.agentCountInput.readOnly = true;
    els.agentCountInput.setAttribute("readonly", "readonly");
    els.agentCountInput.setAttribute("aria-readonly", "true");
  }

  function collectRegionBuckets(properties) {
    const guMap = new Map();
    const dongMap = new Map();

    for (const p of Array.isArray(properties) ? properties : []) {
      const parsed = extractGuDong(p.address || "");
      const gu = String((p.regionGu || parsed.gu || "")).trim();
      const dong = String((p.regionDong || parsed.dong || "")).trim();
      if (!gu) continue;
      guMap.set(gu, (guMap.get(gu) || 0) + 1);
      if (dong) {
        const dongLabel = `${gu} ${dong}`.trim();
        dongMap.set(dongLabel, (dongMap.get(dongLabel) || 0) + 1);
      }
    }

    return {
      gu: [...guMap.entries()].map(([label, count]) => ({ label, count })),
      dong: [...dongMap.entries()].map(([label, count]) => ({ label, count })),
    };
  }

  function resolveEffectiveUnitMode(agentCount, unitMode) {
    const buckets = collectRegionBuckets(state.properties);
    if (unitMode !== "auto") return unitMode;
    return agentCount > buckets.gu.length && buckets.dong.length ? "dong" : "gu";
  }

  function getRegionOptionsFromProperties(agentCount = 1, unitMode = "auto") {
    const buckets = collectRegionBuckets(state.properties);
    const mode = resolveEffectiveUnitMode(agentCount, unitMode);
    const source = mode === "dong" && buckets.dong.length ? buckets.dong : buckets.gu;
    return source
      .slice()
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"))
      .map((item) => item.label);
  }

  function parseEditorSelected(editor) {
    try {
      const raw = JSON.parse(editor?.dataset?.selected || "[]");
      return Array.isArray(raw) ? raw.filter(Boolean).map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }

  function setEditorSelected(editor, regions) {
    const normalized = Array.isArray(regions)
      ? [...new Set(regions.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))]
      : [];
    editor.dataset.selected = JSON.stringify(normalized);
    renderSelectedRegionBadges(editor, normalized);
    editor.querySelectorAll(".region-chip-btn").forEach((btn) => {
      const active = normalized.includes(String(btn.dataset.region || ""));
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderSelectedRegionBadges(editor, regions) {
    const box = editor.querySelector(".assignment-selected-badges");
    if (!box) return;
    if (!regions.length) {
      box.innerHTML = `<span class="cell-badge">미배정</span>`;
      return;
    }
    box.innerHTML = regions
      .slice()
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((region) => `<span class="assignment-region-badge">${escapeHtml(region)}</span>`)
      .join("");
  }

  function renderAssignmentEditor(editor, regionOptions, selectedRegions) {
    const chipGrid = editor.querySelector(".assignment-chip-grid");
    if (!chipGrid) return;
    chipGrid.innerHTML = "";

    if (!regionOptions.length) {
      chipGrid.innerHTML = `<div class="muted small">물건 주소에서 추출된 지역이 없어 자동 배정을 만들 수 없습니다.</div>`;
      setEditorSelected(editor, []);
      return;
    }

    const frag = document.createDocumentFragment();
    regionOptions.forEach((region) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "region-chip-btn";
      btn.dataset.region = region;
      btn.textContent = region;
      frag.appendChild(btn);
    });
    chipGrid.appendChild(frag);
    setEditorSelected(editor, selectedRegions);
  }

  function toggleAssignmentRegion(editor, region) {
    const current = parseEditorSelected(editor);
    const set = new Set(current);
    if (set.has(region)) set.delete(region);
    else set.add(region);
    setEditorSelected(editor, [...set]);
  }

  function applyGroupedAssignmentsToEditors(grouped) {
    const editors = [...els.assignmentTableBody.querySelectorAll(".assignment-editor")];
    editors.forEach((editor, idx) => {
      const regions = grouped?.groups?.[idx]?.regions || [];
      setEditorSelected(editor, regions);
    });
  }

  async function handleSuggestGrouping(options = {}) {
    const agents = state.staff.filter((s) => s.role !== "admin");
    if (!agents.length) {
      if (!options.silent) alert("담당자 계정을 먼저 등록해 주세요.");
      return;
    }

    syncAgentCountInput(agents.length);
    const requestedCount = Math.max(1, agents.length);
    const unitMode = els.regionUnitMode.value; // auto|gu|dong

    const grouped = buildAutoRegionGrouping(state.properties, requestedCount, unitMode);
    state.lastGroupSuggestion = grouped;

    renderGroupSuggestion(grouped, agents);
    applyGroupedAssignmentsToEditors(grouped);
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
      <div class="muted small">※ 현재 화면에는 자동 그룹핑 제안값이 기본 반영되어 있으며, 아래 지역 배지에서 직접 수정할 수 있습니다.</div>
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
          ${g.regions.map(r => `<span class="group-chip">${escapeHtml(r)}</span>`).join("") || `<span class="cell-badge">미배정</span>`}
        </div>
      `;
      frag.appendChild(card);
    });
    els.groupSuggestBox.appendChild(frag);
  }

  async function handleSaveAssignments() {
    const agents = state.staff.filter((s) => s.role !== "admin");
    if (!agents.length) return alert("담당자 계정이 없습니다.");

    const rows = [...els.assignmentTableBody.querySelectorAll(".assignment-editor")].map((editor) => {
      const agentId = editor.dataset.agentId;
      const assignedRegions = parseEditorSelected(editor);
      return { agentId, assignedRegions };
    });

    try {
      await api("/admin/region-assignments", {
        method: "POST",
        auth: true,
        body: { assignments: rows },
      });

      state.staff = state.staff.map((staff) => {
        const found = rows.find((row) => row.agentId === staff.id);
        return found ? { ...staff, assignedRegions: found.assignedRegions.slice() } : staff;
      });
      renderAssignmentTable();
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
          regionUnits.push({ key: `${gu} ${dong}`.trim(), gu, weight: 1 });
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
      showResultBox(els.officeCsvResultBox, `업로드 실패: ${err.message}`, true);
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
      const preferred = sourceType === "realtor" ? "utf-8" : "euc-kr";
      try {
        return new TextDecoder(preferred).decode(bytes).replace(/^﻿/, "");
      } catch (_) {
        return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
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

  function formatDate(v) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
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
    el.classList.remove("hidden");
    el.style.borderColor = isError ? "rgba(255,109,109,.28)" : "#2b3a4c";
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
