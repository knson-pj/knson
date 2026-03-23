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

  const FAVS_KEY_PREFIX = "knson_favs_v1_";

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
    els.globalMsg = $("#globalMsg");

    // Summary
    els.agSumTotal = $("#agSumTotal");
    els.agSumAuction = $("#agSumAuction");
    els.agSumGongmae = $("#agSumGongmae");
    els.agSumNaverRealtor = $("#agSumNaverRealtor");
    els.agSumDirectRealtor = $("#agSumDirectRealtor");
    els.agSumGeneral = $("#agSumGeneral");

    // Table
    els.agTableBody = $("#agTableBody");
    els.agEmpty = $("#agEmpty");
    els.agPagination = $("#agPagination");

    // Filters
    els.agStatusFilter = $("#agStatusFilter");
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

    // 요약 카드 클릭 → 필터
    document.querySelectorAll(".summary-card[data-card]").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.card || "";
        const next = state.filters.activeCard === key ? "" : key;
        state.filters.activeCard = next;
        document.querySelectorAll(".summary-card[data-card]").forEach((c) => {
          c.classList.toggle("is-active", c.dataset.card === next && next !== "");
        });
        state.page = 1;
        renderTable();
      });
    });

    // Filters
    if (els.agStatusFilter) els.agStatusFilter.addEventListener("change", (e) => { state.filters.status = e.target.value; state.page = 1; renderTable(); });
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
        submitNewProperty().catch((err) => setNpmMsg(err?.message || "등록 실패"));
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
    const queryBase = () => sb.from("properties").select("*").order("date_uploaded", { ascending: false }).range(from, from + pageSize - 1);
    const filters = [
      `assignee_id.eq.${uid},raw->>assigneeId.eq.${uid},raw->>assignedAgentId.eq.${uid},raw->>assignee_id.eq.${uid},raw->>assigned_agent_id.eq.${uid}`,
      `assignee_id.eq.${uid}`
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

  async function fetchAllAssignedProperties(sb, uid) {
    const out = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const rows = await fetchPropertiesBatch(sb, from, pageSize, uid);
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  async function loadProperties() {
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
      itemNo: firstText(item.item_no, item.itemNo, raw.itemNo, ""),
      address: firstText(item.address, item.location, raw.address, ""),
      assetType: firstText(item.asset_type, item.assetType, raw.assetType, raw["세부유형"], "-"),
      floor: firstText(raw.floor, raw.floorText, raw["해당층"], ""),
      totalfloor: firstText(raw.totalfloor, raw.total_floor, raw.totalFloor, raw["총층"], ""),
      exclusivearea: toNum(item.exclusive_area ?? item.exclusivearea ?? raw.exclusivearea ?? raw["전용면적(평)"]),
      priceMain: toNum(item.price_main ?? item.priceMain ?? raw.priceMain ?? raw["감정가(원)"]),
      lowprice: toNum(item.lowprice ?? item.low_price ?? raw.lowprice ?? raw["최저입찰가(원)"] ?? raw["매각가"]),
      status: firstText(item.status, raw.status, ""),
      dateMain: firstText(item.date_main, item.dateMain, raw.dateMain, raw["입찰일자"], ""),
      rightsAnalysis: firstText(raw.rightsAnalysis, raw.rights_analysis, ""),
      siteInspection: firstText(raw.siteInspection, raw.site_inspection, ""),
      opinion: firstText(item.opinion, item.memo, raw.opinion, raw.memo, ""),
      createdAt: firstText(item.date, item.date_uploaded, item.createdAt, raw.date, ""),
      isDirectSubmission: !!(
        firstText(item.submitter_name, item.submitterName, raw.submitter_name, raw.submitterName, "") ||
        firstText(item.broker_office_name, item.brokerOfficeName, raw.broker_office_name, raw.brokerOfficeName, "")
      ),
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
    const fmt = (n) => Number(n).toLocaleString("ko-KR");
    if (els.agSumTotal) els.agSumTotal.textContent = fmt(p.length);
    if (els.agSumAuction) els.agSumAuction.textContent = fmt(p.filter((r) => r.sourceType === "auction").length);
    if (els.agSumGongmae) els.agSumGongmae.textContent = fmt(p.filter((r) => r.sourceType === "onbid").length);
    if (els.agSumNaverRealtor) els.agSumNaverRealtor.textContent = fmt(p.filter((r) => r.sourceType === "realtor" && !r.isDirectSubmission).length);
    if (els.agSumDirectRealtor) els.agSumDirectRealtor.textContent = fmt(p.filter((r) => r.sourceType === "realtor" && r.isDirectSubmission).length);
    if (els.agSumGeneral) els.agSumGeneral.textContent = fmt(p.filter((r) => r.sourceType === "general").length);
  }

  function getFilteredProps() {
    let rows = state.properties;
    const f = state.filters;

    // 카드 클릭 필터
    if (f.activeCard && f.activeCard !== "all") {
      if (f.activeCard === "realtor_naver") {
        rows = rows.filter((r) => r.sourceType === "realtor" && !r.isDirectSubmission);
      } else if (f.activeCard === "realtor_direct") {
        rows = rows.filter((r) => r.sourceType === "realtor" && r.isDirectSubmission);
      } else {
        rows = rows.filter((r) => r.sourceType === f.activeCard);
      }
    }

    // 상태 필터
    if (f.status) {
      rows = rows.filter((r) => {
        const s = String(r.status || "").toLowerCase();
        return s === f.status || s.includes(f.status);
      });
    }

    // 면적 필터
    if (f.area) {
      const [minStr, maxStr] = f.area.split("-");
      const min = parseFloat(minStr) || 0;
      const max = maxStr ? parseFloat(maxStr) : Infinity;
      rows = rows.filter((r) => {
        const area = r.exclusivearea;
        return area != null && area > 0 && area >= min && (max === Infinity || area < max);
      });
    }

    // 가격대 필터
    if (f.priceRange) {
      const [minStr, maxStr] = f.priceRange.split("-");
      const min = (parseFloat(minStr) || 0) * 100000000;
      const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
      rows = rows.filter((r) => {
        const isAuctionType = r.sourceType === "auction" || r.sourceType === "onbid";
        const price = isAuctionType ? (r.lowprice ?? r.priceMain) : r.priceMain;
        return price && price > 0 && price >= min && (max === Infinity || price < max);
      });
    }

    // 50% 이하 비율 필터
    if (f.ratio50) {
      rows = rows.filter((r) => {
        if (r.sourceType !== "auction" && r.sourceType !== "onbid") return false;
        if (!r.priceMain || !r.lowprice || r.priceMain <= 0) return false;
        return (r.lowprice / r.priceMain) <= 0.5;
      });
    }

    // 당일 입찰기일 필터 (경매/공매만)
    if (f.todayBid) {
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      rows = rows.filter((r) => {
        if (r.sourceType !== "auction" && r.sourceType !== "onbid") return false;
        return String(r.dateMain || "").trim().startsWith(todayStr);
      });
    }

    // 관심물건 필터
    if (f.favOnly) {
      rows = rows.filter((r) => state.favorites.has(r.id));
    }

    // 키워드 필터
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
    const isFav = state.favorites.has(p.id);

    // ☆ 버튼 셀 — 클릭해도 모달 열리지 않음
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
      // 관심물건 필터 활성 중이면 즉시 리렌더
      if (state.filters.favOnly) { state.page = 1; renderTable(); }
    });
    favTd.appendChild(favBtn);
    tr.appendChild(favTd);

    tr.insertAdjacentHTML("beforeend",
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
      "<td>" + esc((p.opinion || "-").slice(0, 30)) + "</td>"
    );

    tr.addEventListener("click", () => openEditModal(p));
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
    setVal(f, "opinion", ""); // 매일 신규 작성
    if (els.agEditMsg) els.agEditMsg.textContent = "";
    // 물건 History (담당자: 읽기 전용)
    renderOpinionHistory(els.agHistoryList, loadOpinionHistory(item), false);
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

    const newOpinionText = readStr("opinion");
    const opinionHistory = appendOpinionEntry(
      loadOpinionHistory(item),
      newOpinionText,
      state.session?.user
    );

    const patch = {};
    // DB에 존재하는 컬럼만 직접 매핑
    const assetTypeVal = readStr("assetType") || null;
    const statusVal = readStr("status") || null;
    const rightsVal = readStr("rightsAnalysis") || null;
    const siteVal = readStr("siteInspection") || null;

    if (assetTypeVal !== null) patch.asset_type = assetTypeVal;
    if (statusVal !== null) patch.status = statusVal;
    // rights_analysis, site_inspection 은 DB 컬럼 없음 → raw 에만 저장

    // opinion → DB의 memo 컬럼으로 매핑 (opinion 컬럼 없음)
    patch.memo = opinionHistory.length ? opinionHistory[opinionHistory.length - 1].text : (item.opinion || null);

    try {
      if (els.agEditSave) els.agEditSave.disabled = true;
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) throw new Error("Supabase 연동 필요");

      const targetId = item.id || item.globalId;

      // raw JSON 업데이트 — 기존 raw에서 raw 키 자체는 제외하여 중첩 방지
      const existingRaw = item._raw?.raw && typeof item._raw.raw === "object" ? { ...item._raw.raw } : {};
      delete existingRaw.raw; // 중첩 raw 제거
      const newRaw = { ...existingRaw };
      if (assetTypeVal !== null) newRaw.assetType = assetTypeVal;
      if (statusVal !== null) newRaw.status = statusVal;
      if (rightsVal !== null) newRaw.rightsAnalysis = rightsVal;
      if (siteVal !== null) newRaw.siteInspection = siteVal;
      if (patch.memo !== undefined) { newRaw.opinion = patch.memo; newRaw.memo = patch.memo; }
      newRaw.opinionHistory = opinionHistory;
      patch.raw = newRaw;

      // undefined 키 제거 (Supabase 전송 시 에러 방지)
      Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

      await updatePropertyRowResilient(sb, targetId, patch);

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

  // ── 신규 물건 등록 모달 ──
  function openNewPropertyModal() {
    if (!els.newPropertyModal || !els.newPropertyForm) return;
    els.newPropertyForm.reset();
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
    const readNum = (k) => { const v = String(fd.get(k) || "").trim(); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

    const submitterKind = readStr("submitterKind") || "realtor";
    const sourceType = submitterKind === "realtor" ? "realtor" : "general";
    const address = readStr("address");
    const assetType = readStr("assetType");
    const priceMain = readNum("priceMain");

    if (!address || !assetType || !priceMain) throw new Error("주소, 세부유형, 매매가는 필수입니다.");

    let submitterName = "", submitterPhone = "", realtorName = null, realtorPhone = null, realtorCell = null;
    if (submitterKind === "realtor") {
      realtorName = readStr("realtorname");
      realtorPhone = readStr("realtorphone") || null;
      realtorCell = readStr("realtorcell");
      submitterName = realtorName;
      submitterPhone = realtorCell;
      if (!realtorName || !realtorCell) throw new Error("중개사무소명과 휴대폰번호를 입력해 주세요.");
    } else {
      submitterName = readStr("submitterName");
      submitterPhone = readStr("submitterPhone");
      if (!submitterName || !submitterPhone) throw new Error("이름과 연락처를 입력해 주세요.");
    }

    const currentUserId = String(state.session?.user?.id || "").trim() || null;
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
      assignee_id: currentUserId,
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
        assigneeId: currentUserId,
        assignedAgentId: currentUserId,
        registeredByAgent: true,
      },
    };

    if (els.npmSave) els.npmSave.disabled = true;
    setNpmMsg("");
    try {
      const sb = isSupabaseMode() ? K.initSupabase() : null;
      if (!sb) throw new Error("Supabase 연동이 필요합니다.");
      await insertPropertyRowResilient(sb, payload);
      setNpmMsg("등록되었습니다.", false);
      setTimeout(() => { closeNewPropertyModal(); loadProperties(); }, 700);
    } finally {
      if (els.npmSave) els.npmSave.disabled = false;
    }
  }

  // ── Opinion History 유틸 ──
  function loadOpinionHistory(item) {
    const raw = item?._raw?.raw || {};
    const hist = raw.opinionHistory;
    if (Array.isArray(hist)) return hist;
    const legacy = String(item?.opinion || raw.opinion || "").trim();
    if (legacy) {
      return [{ date: formatDate(item?.createdAt) || "unknown", text: legacy, author: "" }];
    }
    return [];
  }

  function appendOpinionEntry(history, newText, user) {
    const text = String(newText || "").trim();
    if (!text) return history;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const author = String(user?.name || user?.email || "").trim();
    return [...history, { date: today, text, author }];
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
