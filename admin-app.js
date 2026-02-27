(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";
  // NOTE: 로그인 페이지와 관리자 페이지 간 "재로그인" 문제를 방지하기 위해
  // 여러 키를 호환 로드하고, 저장은 공용 키로 미러링합니다.
  const SESSION_KEYS = [
    "knson_bms_session_v1",
    "knson_bms_admin_session_v1",
    "knson_bms_session",
    "knson_session_v1",
    "knson_session",
    "knson_auth_session",
    "knson_auth_token"
  ];
  const SESSION_KEY = SESSION_KEYS[0];
  const LEGACY_KEYS = SESSION_KEYS.slice(1);

  const state = {
    session: loadSession(),
    activeTab: "properties",
    properties: [],
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

  document.addEventListener("DOMContentLoaded", init);

  // ---------------------------
  // Auth / Role helpers
  // ---------------------------
  function normalizeRole(role) {
    const r = String(role || "").toLowerCase();
    if (["admin", "manager", "root"].includes(r)) return "admin";
    if (["agent", "staff", "user"].includes(r)) return "agent";
    // 서버가 다른 값으로 내려줘도, 최소한 담당자 화면으로 취급
    return r || "agent";
  }

  function isAdminUser(user) {
    return !!user && normalizeRole(user.role) === "admin";
  }

  function isLoggedIn(user) {
    const role = normalizeRole(user?.role);
    // user 정보가 없더라도 token이 있으면 "로그인 상태"로 간주하고 로드를 시도합니다.
    if (!!state.session?.token && !user) return true;
    return !!user && (role === "admin" || role === "agent");
  }

  async function bootstrapSession() {
    // 1) local/session storage에서 호환 키로 세션 로드
    const stored = loadSession();
    if (stored) {
      // 토큰만 있는 경우에도 우선 세팅
      state.session = { token: stored.token || null, user: stored.user || null };

      // user 없으면 /auth/me 류로 보강 (Bearer + 쿠키 둘 다)
      if (!state.session.user && state.session.token) {
        const enriched = await fetchSessionByToken(state.session.token);
        if (enriched?.user) state.session.user = enriched.user;
      }

      if (state.session.user) {
        state.session.user.role = normalizeRole(state.session.user.role);
      }
      saveSession(state.session); // 공용 키로 미러링
      return true;
    }

    // 2) 쿠키 기반 세션(로그인 페이지) 호환: /auth/me 류 엔드포인트를 시도
    const cookieSession = await fetchCookieSession();
    if (cookieSession?.user) {
      cookieSession.user.role = normalizeRole(cookieSession.user.role);
      state.session = cookieSession;
      saveSession(cookieSession);
      return true;
    }

    // 3) /auth/me 류가 없는 경우: 보호 API를 가볍게 probe 해서 쿠키 세션 여부/권한을 추정
    const probed = await probeCookieRole();
    if (probed?.user) {
      probed.user.role = normalizeRole(probed.user.role);
      state.session = probed;
      saveSession(probed);
      return true;
    }

    return false;
  }

  async function fetchCookieSession() {
    const candidates = ["/auth/me", "/auth/session", "/auth/profile"];
    for (const path of candidates) {
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        if (!data) continue;

        // { user, token } 또는 user 단독 형태 모두 허용
        const user = data.user || data.profile || data.me || data;
        const token = data.token || null;

        if (user && (user.id || user.name)) {
          return { token, user };
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  function handleUnauthorized() {
    state.session = null;
    saveSession(null);
    renderSessionUI();
    // 중복 alert 방지: 모달만 띄움
    openLoginModal();
  }


  function init() {
    cacheEls();
    bindEvents();
    renderSessionUI();
    ensureLoginThenLoad();
  }

  function cacheEls() {
    Object.assign(els, {
      // top
      adminUserBadge: $("#adminUserBadge"),
      btnAdminLoginOpen: $("#btnAdminLoginOpen"),
      btnAdminLogout: $("#btnAdminLogout"),

      // login modal
      adminLoginModal: $("#adminLoginModal"),
      btnAdminLoginClose: $("#btnAdminLoginClose"),
      adminLoginForm: $("#adminLoginForm"),

      // tabs
      adminTabs: $("#adminTabs"),

      // summary
      sumTotal: $("#sumTotal"),
      sumAuction: $("#sumAuction"),
      sumGongmae: $("#sumGongmae"),
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
    });
  }

  function bindEvents() {
    // login modal
    els.btnAdminLoginOpen.addEventListener("click", openLoginModal);
    els.btnAdminLoginClose.addEventListener("click", closeLoginModal);
    els.adminLoginModal.addEventListener("click", (e) => {
      if (e.target?.dataset?.close === "true") closeLoginModal();
    });
    els.adminLoginForm.addEventListener("submit", onSubmitAdminLogin);
    els.btnAdminLogout.addEventListener("click", logout);

    // tabs
    els.adminTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      setActiveTab(btn.dataset.tab);
    });

    // properties
    els.btnReloadProperties.addEventListener("click", loadAllCoreData);
    els.propSourceFilter.addEventListener("change", () => {
      state.propertyFilters.source = els.propSourceFilter.value;
      renderPropertiesTable();
    });
    els.propStatusFilter.addEventListener("change", () => {
      state.propertyFilters.status = els.propStatusFilter.value;
      renderPropertiesTable();
    });
    els.propKeyword.addEventListener("input", debounce(() => {
      state.propertyFilters.keyword = els.propKeyword.value.trim().toLowerCase();
      renderPropertiesTable();
    }, 120));

    // CSV import
    els.btnCsvPreview.addEventListener("click", handleCsvPreview);
    els.btnCsvUpload.addEventListener("click", handleCsvUpload);

    // staff
    els.staffForm.addEventListener("submit", handleSaveStaff);
    els.btnStaffReset.addEventListener("click", resetStaffForm);

    // regions
    els.btnSuggestGrouping.addEventListener("click", handleSuggestGrouping);
    els.btnSaveAssignments.addEventListener("click", handleSaveAssignments);

    // offices
    els.btnOfficeCsvPreview.addEventListener("click", handleOfficeCsvPreview);
    els.btnOfficeCsvUpload.addEventListener("click", handleOfficeCsvUpload);
    els.btnReloadOffices.addEventListener("click", loadOffices);
  }

  async function ensureLoginThenLoad() {
    await bootstrapSession();
    const user = state.session?.user;
    if (!isLoggedIn(user)) {
      openLoginModal();
      return;
    }
    applyRoleUI();
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
      panel.classList.toggle("hidden", key !== tab);
    });
  }

  function renderSessionUI() {
    const user = state.session?.user;
    const loggedIn = isLoggedIn(user);
    const admin = isAdminUser(user);

    els.btnAdminLoginOpen.classList.toggle("hidden", loggedIn);
    els.btnAdminLogout.classList.toggle("hidden", !loggedIn);

    if (loggedIn) {
      if (!user) {
        els.adminUserBadge.textContent = "로그인됨";
        els.adminUserBadge.className = "badge badge-agent";
        return;
      }
      const label = admin ? "관리자" : "담당자";
      els.adminUserBadge.textContent = `${label}: ${user.name || ""}`.trim();
      els.adminUserBadge.className = admin ? "badge badge-admin" : "badge badge-agent";
    } else {
      els.adminUserBadge.textContent = "비로그인";
      els.adminUserBadge.className = "badge badge-muted";
    }
  }

  function applyRoleUI() {
    const user = state.session?.user;
    const admin = isAdminUser(user);

    // 탭 버튼/패널: 담당자는 "물건 관리"만 사용
    const adminOnlyTabs = ["csv", "staff", "regions", "offices"];
    adminOnlyTabs.forEach((tab) => {
      const btn = els.adminTabs?.querySelector(`.tab[data-tab="${tab}"]`);
      const panel = document.getElementById(`tab-${tab}`);
      if (btn) btn.classList.toggle("hidden", !admin);
      if (panel) panel.classList.toggle("hidden", !admin);
    });

    // 담당자면 항상 물건 탭으로 이동
    if (!admin) {
      setActiveTab("properties");
    }
  }


  function openLoginModal() {
    els.adminLoginModal.classList.remove("hidden");
    els.adminLoginModal.setAttribute("aria-hidden", "false");
  }

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

      if (!res?.user) {
        throw new Error("로그인 응답이 올바르지 않습니다.");
      }
      res.user.role = normalizeRole(res.user.role);
      state.session = { token: res.token || null, user: res.user };
      saveSession(state.session);
      renderSessionUI();
      applyRoleUI();
      closeLoginModal();
      await loadAllCoreData();
    } catch (err) {
      console.error(err);
      alert(err.message || "로그인 실패");
    } finally {
      setFormBusy(e.currentTarget, false);
    }
  }

  function logout() {
    state.session = null;
    saveSession(null);
    renderSessionUI();
    state.properties = [];
    state.staff = [];
    state.offices = [];
    renderAll();
    openLoginModal();
  }

  async function loadAllCoreData() {
    try {
      const user = state.session?.user;
      const admin = isAdminUser(user);
      if (admin) {
        await Promise.all([loadProperties(), loadStaff(), loadOffices()]);
      } else {
        await loadProperties();
      }
    } catch (err) {
      console.error(err);
      if (err && err.status === 401) {
        handleUnauthorized();
        return;
      }
      alert(err.message || "데이터 로드 실패");
    }
  }

  async function loadProperties() {
    const user = state.session?.user;
    const admin = isAdminUser(user);

    // 담당자는 서버 지원 시 scope=mine를 우선 시도
    const wantedScope = admin ? "all" : "mine";
    let res = null;

    try {
      res = await api(`/admin/properties?scope=${wantedScope}`, { auth: true });
    } catch (err) {
      // scope=mine 미지원이면 all로 폴백
      if (!admin && (err.status === 400 || err.status === 404)) {
        res = await api("/admin/properties?scope=all", { auth: true });
      } else {
        throw err;
      }
    }

    let items = Array.isArray(res?.items) ? res.items.map(normalizeProperty) : [];

    // 최종 안전장치: 담당자는 내 물건만
    if (!admin && user) {
      const myId = String(user.id || "");
      const myName = String(user.name || "");
      items = items.filter((p) => {
        if (myId && String(p.assignedAgentId || "") === myId) return true;
        if (myName && String(p.assignedAgentName || "") === myName) return true;
        return false;
      });
    }

    state.properties = items;
    renderPropertiesTable();
    renderSummary();
  }

  async function loadStaff() {
    const res = await api("/admin/staff", { auth: true });
    state.staff = Array.isArray(res?.items) ? res.items.map(normalizeStaff) : [];
    renderStaffTable();
    renderAssignmentTable();
    renderSummary();
  }

  async function loadOffices() {
    const res = await api("/admin/realtor-offices", { auth: true });
    state.offices = Array.isArray(res?.items) ? res.items.map(normalizeOffice) : [];
    renderOfficesTable();
    renderSummary();
  }

  function normalizeProperty(item) {
    return {
      id: item.id || "",
      source: item.source || "general",
      address: item.address || "",
      normalizedAddress: item.normalizedAddress || normalizeAddress(item.address || ""),
      salePrice: Number(item.salePrice || 0),
      status: item.status || "review",
      assignedAgentId: item.assignedAgentId || null,
      assignedAgentName: item.assignedAgentName || "",
      regionGu: item.regionGu || "",
      regionDong: item.regionDong || "",
      duplicateFlag: !!item.duplicateFlag,
      createdAt: item.createdAt || "",
      memo: item.memo || "",
    };
  }

  function normalizeStaff(item) {
    return {
      id: item.id || "",
      name: item.name || "",
      role: item.role || "agent",
      assignedRegions: Array.isArray(item.assignedRegions) ? item.assignedRegions : [],
      createdAt: item.createdAt || "",
    };
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
      memo: item.memo || "",
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

    els.sumTotal.textContent = String(props.length);
    els.sumAuction.textContent = String(props.filter(p => p.source === "auction").length);
    els.sumGongmae.textContent = String(props.filter(p => p.source === "gongmae").length);
    els.sumGeneral.textContent = String(props.filter(p => p.source === "general").length);
    els.sumAgents.textContent = String(staff.filter(s => s.role === "agent").length);
    els.sumOffices.textContent = String(offices.length);
  }

  function getFilteredProperties() {
    const f = state.propertyFilters;
    return state.properties.filter((p) => {
      if (f.source && p.source !== f.source) return false;
      if (f.status && p.status !== f.status) return false;
      if (f.keyword) {
        const hay = [p.address, p.assignedAgentName, p.regionGu, p.regionDong].join(" ").toLowerCase();
        if (!hay.includes(f.keyword)) return false;
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
      tr.innerHTML = `
        <td>${escapeHtml(sourceLabel(p.source))}</td>
        <td>${escapeHtml(p.address)}</td>
        <td>${formatMoneyKRW(p.salePrice)}</td>
        <td>${escapeHtml(statusLabel(p.status))}</td>
        <td>${escapeHtml(p.assignedAgentName || "미배정")}</td>
        <td>${escapeHtml([p.regionGu, p.regionDong].filter(Boolean).join(" / ") || "-")}</td>
        <td>${p.duplicateFlag ? '<span class="cell-badge danger">중복</span>' : '<span class="cell-badge ok">정상</span>'}</td>
        <td>${escapeHtml(formatDate(p.createdAt))}</td>
      `;
      frag.appendChild(tr);
    }
    els.propertiesTableBody.appendChild(frag);
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

    const agents = state.staff.filter((s) => s.role === "agent");
    if (!agents.length) {
      els.assignmentEmpty.classList.remove("hidden");
      return;
    }
    els.assignmentEmpty.classList.add("hidden");

    const regionOptions = getRegionOptionsFromProperties();

    const frag = document.createDocumentFragment();
    agents.forEach((a) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(a.name)}</td>
        <td>담당자</td>
        <td>
          <select class="assignment-select" data-agent-id="${escapeAttr(a.id)}" multiple></select>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.assignmentTableBody.appendChild(frag);

    els.assignmentTableBody.querySelectorAll(".assignment-select").forEach((sel) => {
      const agentId = sel.dataset.agentId;
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;

      regionOptions.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        opt.selected = agent.assignedRegions.includes(r);
        sel.appendChild(opt);
      });
    });
  }

  function renderOfficesTable() {
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
  function fillStaffForm(staff) {
    els.staffForm.elements.id.value = staff.id || "";
    els.staffForm.elements.name.value = staff.name || "";
    els.staffForm.elements.role.value = staff.role || "agent";
    els.staffForm.elements.password.value = "";
  }

  function resetStaffForm() {
    els.staffForm.reset();
    els.staffForm.elements.id.value = "";
    els.staffForm.elements.role.value = "agent";
  }

  async function handleSaveStaff(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const id = String(fd.get("id") || "").trim();
    const payload = {
      name: String(fd.get("name") || "").trim(),
      role: String(fd.get("role") || "agent"),
      password: String(fd.get("password") || ""),
    };

    if (!payload.name) return alert("이름을 입력해 주세요.");
    if (!id && !payload.password) return alert("신규 계정은 비밀번호가 필요합니다.");

    try {
      setFormBusy(e.currentTarget, true);
      if (id) {
        await api(`/admin/staff/${encodeURIComponent(id)}`, {
          method: "PATCH",
          auth: true,
          body: payload,
        });
      } else {
        await api("/admin/staff", {
          method: "POST",
          auth: true,
          body: payload,
        });
      }
      resetStaffForm();
      await loadStaff();
      alert("저장되었습니다.");
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
      const text = await file.text();
      const rows = parseCsv(text);
      state.csvPreviewRows = rows.map(mapPropertyCsvRow).filter(Boolean);

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
        <td>${escapeHtml(r.address)}</td>
        <td>${formatMoneyKRW(r.salePrice)}</td>
        <td>${escapeHtml(statusLabel(r.status))}</td>
        <td>${escapeHtml(r.regionGu || "-")}</td>
        <td>${escapeHtml(r.regionDong || "-")}</td>
      `;
      frag.appendChild(tr);
    });
    els.csvPreviewTableBody.appendChild(frag);
  }

  async function handleCsvUpload() {
    try {
      const file = els.csvFileInput.files?.[0];
      if (!file) return alert("CSV 파일을 선택해 주세요.");
      const source = els.csvImportSource.value;
      const csvText = await file.text();

      const res = await api("/admin/import/properties-csv", {
        method: "POST",
        auth: true,
        body: {
          source,        // auction | gongmae
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
      showResultBox(els.csvResultBox, `업로드 실패: ${err.message}`, true);
    }
  }

  function mapPropertyCsvRow(row) {
    const pick = (...keys) => {
      for (const k of keys) {
        if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
      }
      return "";
    };

    const address = pick("address", "주소");
    if (!address) return null;

    const salePrice = Number(
      pick("sale_price", "매각가", "매각가(원)", "매각가격").replace(/[^\d.-]/g, "")
    ) || 0;

    const statusRaw = pick("status", "상태").toLowerCase();
    const status = normalizeStatus(statusRaw);

    const regionGu = pick("region_gu", "구") || extractGuDong(address).gu || "";
    const regionDong = pick("region_dong", "동") || extractGuDong(address).dong || "";

    return {
      address,
      salePrice,
      status,
      regionGu,
      regionDong,
    };
  }

  // ---------------------------
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
    const agents = state.staff.filter((s) => s.role === "agent");
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
    const agents = state.staff.filter((s) => s.role === "agent");
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
      const text = await file.text();
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
      const csvText = await file.text();

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

    // Bearer 토큰(로컬스토리지 기반) + 쿠키 세션(로그인 페이지) 둘 다 지원
    const token = state.session?.token;
    if (options.auth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const hasBody = !["GET", "HEAD"].includes(method);
    if (hasBody) headers["Content-Type"] = "application/json";

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: hasBody ? JSON.stringify(options.body || {}) : undefined,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    const allow = Array.isArray(options.allowStatuses) ? options.allowStatuses : [];
    if (!res.ok && !allow.includes(res.status)) {
      const err = new Error(data?.message || `API 오류 (${res.status})`);
      err.status = res.status;
      err.data = data;
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

  function loadSession() {
    // 여러 키/형식(JSON, 토큰 문자열) 호환 로드
    const storages = [localStorage, sessionStorage];

    function tryParse(raw) {
      if (!raw) return null;
      // JSON 형태 우선
      if (raw.startsWith("{") || raw.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.user || parsed.token)) return parsed;
        } catch {
          // ignore
        }
      }
      // 토큰 문자열만 저장된 경우(JWT 등)
      const token = String(raw || "").trim();
      if (token && token.split(".").length >= 3) return { token, user: null };
      return null;
    }

    // 1) 우선 known keys
    for (const store of storages) {
      for (const key of SESSION_KEYS) {
        try {
          const raw = store.getItem(key);
          const parsed = tryParse(raw);
          if (parsed) return parsed;
        } catch {
          // ignore
        }
      }
    }

    // 2) key를 모를 때: 전체 스토리지 스캔(세션 추정)
    for (const store of storages) {
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (!key) continue;
          const raw = store.getItem(key);
          const parsed = tryParse(raw);
          if (!parsed) continue;

          // user가 있는 세션을 우선 반환
          if (parsed.user && (parsed.user.id || parsed.user.name)) return parsed;

          // token-only는 최후 후보로 기억
          if (parsed.token) return parsed;
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  function saveSession(v) {
    // 저장은 공용 키로 미러링(이전 키 포함)
    const targets = [SESSION_KEY, ...LEGACY_KEYS];
    const payload = v ? JSON.stringify(v) : null;

    targets.forEach((key) => {
      try {
        if (!payload) localStorage.removeItem(key);
        else localStorage.setItem(key, payload);
      } catch {
        // ignore
      }
    });
  }
})();
