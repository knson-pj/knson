/* ═══════════════════════════════════════════════════
   agent-app.js  —  담당자 전용 페이지 (배정된 물건 관리)
   ═══════════════════════════════════════════════════ */
(function () {
  "use strict";

  const K = window.KNSN || null;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function loadSession() { return K ? K.loadSession() : null; }
  function isSupabaseMode() { return !!(K && K.supabaseEnabled && K.supabaseEnabled()); }

  const state = {
    session: loadSession(),
    properties: [],
    filters: { source: "", status: "", keyword: "" },
    page: 1,
    pageSize: 30,
    editingProperty: null,
  };

  const els = {};

  // ── Init ──
  function init() {
    cacheEls();
    bindEvents();
    setupChrome();
    ensureLoginThenLoad();
  }

  function cacheEls() {
    els.agentUserBadge = $("#agentUserBadge");
    els.btnAgentLogout = $("#btnAgentLogout");
    els.btnChangeMyPassword = $("#btnChangeMyPassword");
    els.btnAgentRefresh = $("#btnAgentRefresh");
    els.globalMsg = $("#globalMsg");

    // Summary
    els.agSumTotal = $("#agSumTotal");
    els.agSumAuction = $("#agSumAuction");
    els.agSumGongmae = $("#agSumGongmae");
    els.agSumRealtor = $("#agSumRealtor");
    els.agSumGeneral = $("#agSumGeneral");

    // Table
    els.agTableBody = $("#agTableBody");
    els.agEmpty = $("#agEmpty");
    els.agPagination = $("#agPagination");

    // Filters
    els.agSourceFilter = $("#agSourceFilter");
    els.agStatusFilter = $("#agStatusFilter");
    els.agKeyword = $("#agKeyword");

    // Edit modal
    els.agEditModal = $("#agEditModal");
    els.agEditForm = $("#agEditForm");
    els.agEditClose = $("#agEditClose");
    els.agEditCancel = $("#agEditCancel");
    els.agEditSave = $("#agEditSave");
    els.agEditMsg = $("#agEditMsg");

    // Password modal
    els.pwdModal = $("#passwordChangeModal");
    els.pwdForm = $("#passwordChangeForm");
    els.pwdClose = $("#pwdModalClose");
    els.pwdCancel = $("#pwdCancel");
    els.pwdMsg = $("#pwdMsg");
  }

  function setupChrome() {
    if (K && typeof K.mountThemeToggle === "function") {
      K.mountThemeToggle(document.querySelector(".top-actions"), { className: "theme-toggle" });
    }
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

    // Refresh
    if (els.btnAgentRefresh) els.btnAgentRefresh.addEventListener("click", () => loadProperties());

    // Filters
    if (els.agSourceFilter) els.agSourceFilter.addEventListener("change", (e) => { state.filters.source = e.target.value; state.page = 1; renderAll(); });
    if (els.agStatusFilter) els.agStatusFilter.addEventListener("change", (e) => { state.filters.status = e.target.value; state.page = 1; renderAll(); });
    if (els.agKeyword) els.agKeyword.addEventListener("input", debounce((e) => { state.filters.keyword = String(e.target.value || "").trim(); state.page = 1; renderAll(); }, 150));

    // Edit modal
    if (els.agEditClose) els.agEditClose.addEventListener("click", closeEditModal);
    if (els.agEditCancel) els.agEditCancel.addEventListener("click", closeEditModal);
    if (els.agEditModal) {
      els.agEditModal.addEventListener("click", (e) => {
        if (e.target?.dataset?.close === "true") closeEditModal();
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

    await loadProperties();
  }

  function renderSessionUI() {
    const user = state.session?.user;
    if (!user) return;
    if (els.agentUserBadge) els.agentUserBadge.textContent = "담당자: " + (user.name || user.email || "");
    if (els.btnAgentLogout) els.btnAgentLogout.classList.remove("hidden");
    if (els.btnChangeMyPassword && isSupabaseMode()) els.btnChangeMyPassword.classList.remove("hidden");
  }

  // ── Load Data ──
  function rowAssignedToUid(row, uid) {
    const target = String(uid || "").trim();
    if (!target) return false;
    const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
    return [row?.assignee_id, row?.assigneeId, row?.assignedAgentId, raw.assignee_id, raw.assigneeId, raw.assignedAgentId]
      .some((v) => String(v || "").trim() === target);
  }

  async function loadProperties() {
    try {
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) { state.properties = []; renderAll(); return; }

      try { await K.sbSyncLocalSession(); state.session = loadSession(); } catch {}
      const uid = String(state.session?.user?.id || "").trim();
      if (!uid) { state.properties = []; renderAll(); return; }

      // admin-app.js와 동일한 fallback 패턴
      const filters = [
        "assignee_id.eq." + uid + ",raw->>assigneeId.eq." + uid + ",raw->>assignedAgentId.eq." + uid + ",raw->>assignee_id.eq." + uid,
        "assignee_id.eq." + uid,
      ];

      const allItems = [];
      let lastError = null;

      for (const filter of filters) {
        allItems.length = 0;
        lastError = null;
        let from = 0;
        const pageSize = 1000;
        let success = true;

        while (true) {
          const { data, error } = await sb.from("properties")
            .select("*")
            .or(filter)
            .order("date_uploaded", { ascending: false })
            .range(from, from + pageSize - 1);

          if (error) { lastError = error; success = false; break; }
          const rows = Array.isArray(data) ? data : [];
          allItems.push(...rows);
          if (rows.length < pageSize) break;
          from += pageSize;
        }

        if (success) break;
      }

      // 클라이언트 측 추가 필터링 (DB 필터가 부정확할 수 있으므로)
      const verified = allItems.filter((row) => rowAssignedToUid(row, uid));
      state.properties = verified.map(normalizeProperty);
      renderAll();
    } catch (err) {
      console.error("loadProperties error:", err);
      state.properties = [];
      renderAll();
    }
  }

  // ── Normalize ──
  function normalizeProperty(item) {
    const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
    const rawSource = (item.sourceType || item.source || item.category || item.source_type || raw.sourceType || "").toString().toLowerCase();
    const sourceType =
      rawSource === "auction" ? "auction" :
      rawSource === "gongmae" || rawSource === "public" || rawSource === "onbid" ? "onbid" :
      rawSource === "realtor" ? "realtor" :
      "general";

    return {
      id: String(item.id || item.global_id || ""),
      globalId: String(item.globalId || item.global_id || ""),
      sourceType,
      itemNo: firstText(item.itemNo, item.item_no, raw.itemNo, ""),
      address: firstText(item.address, item.location, raw.address, ""),
      assetType: firstText(item.assetType, item.asset_type, raw.assetType, raw["세부유형"], "-"),
      floor: firstText(item.floor, raw.floor, raw["해당층"], ""),
      totalfloor: firstText(item.totalfloor, item.total_floor, raw.totalfloor, raw["총층"], ""),
      exclusivearea: toNum(item.exclusivearea ?? item.exclusive_area ?? raw.exclusivearea ?? raw["전용면적(평)"]),
      priceMain: toNum(item.priceMain ?? item.price_main ?? raw.priceMain ?? raw["감정가(원)"]),
      lowprice: toNum(item.lowprice ?? item.low_price ?? raw.lowprice ?? raw["최저입찰가(원)"] ?? raw["매각가"]),
      status: firstText(item.status, raw.status, ""),
      dateMain: firstText(item.dateMain, item.date_main, raw.dateMain, raw["입찰일자"], ""),
      rightsAnalysis: firstText(item.rightsAnalysis, item.rights_analysis, raw.rightsAnalysis, ""),
      siteInspection: firstText(item.siteInspection, item.site_inspection, raw.siteInspection, ""),
      opinion: firstText(item.opinion, raw.opinion, ""),
      createdAt: firstText(item.date, item.date_uploaded, item.createdAt, raw.date, ""),
      _raw: item,
    };
  }

  // ── Render ──
  function renderAll() {
    renderSummary();
    renderTable();
  }

  function renderSummary() {
    const p = state.properties;
    if (els.agSumTotal) els.agSumTotal.textContent = String(p.length);
    if (els.agSumAuction) els.agSumAuction.textContent = String(p.filter((r) => r.sourceType === "auction").length);
    if (els.agSumGongmae) els.agSumGongmae.textContent = String(p.filter((r) => r.sourceType === "onbid").length);
    if (els.agSumRealtor) els.agSumRealtor.textContent = String(p.filter((r) => r.sourceType === "realtor").length);
    if (els.agSumGeneral) els.agSumGeneral.textContent = String(p.filter((r) => r.sourceType === "general").length);
  }

  function getFilteredProps() {
    let rows = state.properties;
    const f = state.filters;
    if (f.source) rows = rows.filter((r) => r.sourceType === f.source);
    if (f.status) rows = rows.filter((r) => {
      const s = String(r.status || "").toLowerCase();
      return s === f.status || s.includes(f.status);
    });
    if (f.keyword) {
      const kw = f.keyword.toLowerCase();
      rows = rows.filter((r) =>
        (r.address || "").toLowerCase().includes(kw) ||
        (r.itemNo || "").toLowerCase().includes(kw) ||
        (r.opinion || "").toLowerCase().includes(kw)
      );
    }
    return rows;
  }

  function renderTable() {
    if (!els.agTableBody) return;
    const rows = getFilteredProps();
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
    const kindMap = { auction: "경매", onbid: "공매", realtor: "중개", general: "일반" };
    const kindClass = { auction: "kind-auction", onbid: "kind-gongmae", realtor: "kind-realtor", general: "kind-general" };
    const kindLabel = kindMap[p.sourceType] || "일반";
    const appraisal = p.priceMain != null ? formatEok(p.priceMain) : "-";
    const current = p.lowprice != null ? formatEok(p.lowprice) : "-";
    const rate = calcRate(p.priceMain, p.lowprice);
    const statusLabel = normalizeStatus(p.status);

    tr.innerHTML =
      "<td>" + esc(p.itemNo || "-") + "</td>" +
      '<td><span class="kind-text ' + (kindClass[p.sourceType] || "kind-general") + '">' + esc(kindLabel) + "</span></td>" +
      "<td>" + esc(p.address || "-") + "</td>" +
      "<td>" + esc(p.assetType || "-") + "</td>" +
      "<td>" + esc(p.floor || "-") + "</td>" +
      "<td>" + (p.exclusivearea != null ? fmtArea(p.exclusivearea) : "-") + "</td>" +
      "<td>" + esc(appraisal) + "</td>" +
      "<td>" + esc(current) + "</td>" +
      "<td>" + esc(rate) + "</td>" +
      "<td>" + esc(formatDate(p.dateMain) || "-") + "</td>" +
      "<td>" + esc(statusLabel) + "</td>" +
      "<td>" + (p.rightsAnalysis ? "✓" : "-") + "</td>" +
      "<td>" + (p.siteInspection ? "✓" : "-") + "</td>" +
      "<td>" + esc((p.opinion || "-").slice(0, 30)) + "</td>";

    tr.addEventListener("click", () => openEditModal(p));
    return tr;
  }

  function renderPagination(totalPages) {
    if (!els.agPagination) return;
    els.agPagination.innerHTML = "";
    if (totalPages <= 1) { els.agPagination.classList.add("hidden"); return; }
    els.agPagination.classList.remove("hidden");
    const frag = document.createDocumentFragment();
    const addBtn = (label, page, disabled, active) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = active ? "pager-num is-active" : (typeof label === "number" ? "pager-num" : "pager-btn");
      b.textContent = String(label);
      b.disabled = disabled;
      if (!disabled) b.addEventListener("click", () => { state.page = page; renderTable(); });
      frag.appendChild(b);
    };
    addBtn("이전", state.page - 1, state.page <= 1);
    const s = Math.max(1, state.page - 2);
    const e = Math.min(totalPages, s + 4);
    for (let i = s; i <= e; i++) addBtn(i, i, false, i === state.page);
    addBtn("다음", state.page + 1, state.page >= totalPages);
    els.agPagination.appendChild(frag);
  }

  // ── Edit Modal ──
  function openEditModal(item) {
    state.editingProperty = item;
    if (!els.agEditForm) return;
    const f = els.agEditForm;
    const kindMap = { auction: "경매", onbid: "공매", realtor: "중개", general: "일반" };
    setVal(f, "itemNo", item.itemNo);
    setVal(f, "sourceType", kindMap[item.sourceType] || "일반");
    setVal(f, "address", item.address);
    setVal(f, "assetType", item.assetType === "-" ? "" : item.assetType);
    setVal(f, "status", item.status);
    setVal(f, "rightsAnalysis", item.rightsAnalysis);
    setVal(f, "siteInspection", item.siteInspection);
    setVal(f, "opinion", item.opinion);
    if (els.agEditMsg) els.agEditMsg.textContent = "";
    els.agEditModal.classList.remove("hidden");
    els.agEditModal.setAttribute("aria-hidden", "false");
  }

  function closeEditModal() {
    state.editingProperty = null;
    if (els.agEditModal) {
      els.agEditModal.classList.add("hidden");
      els.agEditModal.setAttribute("aria-hidden", "true");
    }
  }

  async function saveProperty() {
    const item = state.editingProperty;
    if (!item) return;
    const f = els.agEditForm;
    const readStr = (name) => String((f.elements[name]?.value) || "").trim();

    // 담당자는 제한된 필드만 수정 가능
    const patch = {};
    const fields = ["assetType", "status", "rightsAnalysis", "siteInspection", "opinion"];
    const rawKeys = { assetType: "asset_type", status: "status", rightsAnalysis: "rights_analysis", siteInspection: "site_inspection", opinion: "opinion" };

    for (const key of fields) {
      const val = readStr(key) || null;
      patch[rawKeys[key]] = val;
    }

    try {
      if (els.agEditSave) els.agEditSave.disabled = true;
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) throw new Error("Supabase 연동 필요");

      const targetId = item.id || item.globalId;
      const col = String(targetId).includes(":") ? "global_id" : "id";

      // raw JSON도 업데이트
      const existingRaw = item._raw?.raw || {};
      const newRaw = { ...existingRaw };
      if (patch.asset_type !== undefined) newRaw.assetType = patch.asset_type;
      if (patch.status !== undefined) newRaw.status = patch.status;
      if (patch.rights_analysis !== undefined) newRaw.rightsAnalysis = patch.rights_analysis;
      if (patch.site_inspection !== undefined) newRaw.siteInspection = patch.site_inspection;
      if (patch.opinion !== undefined) newRaw.opinion = patch.opinion;
      patch.raw = newRaw;

      const { error } = await sb.from("properties").update(patch).eq(col, targetId);
      if (error) throw error;

      closeEditModal();
      await loadProperties();
    } catch (err) {
      if (els.agEditMsg) els.agEditMsg.textContent = err?.message || "저장 실패";
    } finally {
      if (els.agEditSave) els.agEditSave.disabled = false;
    }
  }

  // ── Password Change ──
  function openPwdModal() {
    if (els.pwdModal) { els.pwdModal.classList.remove("hidden"); els.pwdModal.setAttribute("aria-hidden", "false"); }
    if (els.pwdMsg) els.pwdMsg.textContent = "";
  }
  function closePwdModal() {
    if (els.pwdModal) { els.pwdModal.classList.add("hidden"); els.pwdModal.setAttribute("aria-hidden", "true"); }
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
      if (els.pwdMsg) els.pwdMsg.textContent = err?.message || "변경 실패";
    }
  }

  // ── Utilities ──
  function firstText(...args) {
    for (const v of args) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return "";
  }

  function toNum(v) {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function esc(v) {
    return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatEok(n) {
    if (n == null) return "-";
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "-";
    if (v >= 100000000) return (v / 100000000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1") + " 억원";
    if (v >= 10000) return (v / 10000).toFixed(0) + " 만원";
    return v.toLocaleString() + " 원";
  }

  function fmtArea(v) {
    const n = toNum(v);
    if (n == null || n <= 0) return "-";
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function calcRate(appraisal, current) {
    const a = Number(appraisal || 0);
    const c = Number(current || 0);
    if (!a || !c || a <= 0) return "-";
    return (c / a * 100).toFixed(1) + "%";
  }

  function normalizeStatus(v) {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return "-";
    const map = { active: "진행중", hold: "보류", closed: "종결", review: "검토중" };
    return map[s] || v || "-";
  }

  function formatDate(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function setVal(form, name, value) {
    const el = form.elements[name];
    if (!el) return;
    el.value = value || "";
  }

  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  // ── Start ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
