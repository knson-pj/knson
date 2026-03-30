/* ═══════════════════════════════════════════════════
   agent-app.js  —  담당자 전용 페이지 (배정된 물건 관리)
   ═══════════════════════════════════════════════════ */
(function () {
  "use strict";

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

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

  const parseFlexibleNumber = (Shared && typeof Shared.parseFlexibleNumber === "function")
    ? Shared.parseFlexibleNumber
    : function parseFlexibleNumber(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        const s = String(value).trim();
        if (!s) return null;
        const n = Number(s.replace(/,/g, ""));
        return Number.isFinite(n) ? n : null;
      };

  const formatMoneyInputValue = (Shared && typeof Shared.formatMoneyInputValue === "function")
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

  const bindAmountInputMask = (Shared && typeof Shared.bindAmountInputMask === "function")
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

  const configureFreeDecimalInput = (Shared && typeof Shared.configureFreeDecimalInput === "function")
    ? Shared.configureFreeDecimalInput
    : function configureFreeDecimalInput(input) {
        if (!input) return;
        input.setAttribute("type", "text");
        input.setAttribute("inputmode", "decimal");
        input.removeAttribute("step");
      };

  const configureAmountInput = (Shared && typeof Shared.configureAmountInput === "function")
    ? Shared.configureAmountInput
    : function configureAmountInput(input) {
        if (!input) return;
        input.setAttribute("type", "text");
        input.setAttribute("inputmode", "numeric");
        input.removeAttribute("step");
        bindAmountInputMask(input);
      };

  const configureFormNumericUx = (Shared && typeof Shared.configureFormNumericUx === "function")
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
    editingProperty: null,
    dailyReport: {
      dateKey: "",
      counts: { total: 0, rightsAnalysis: 0, siteInspection: 0, dailyIssue: 0, newProperty: 0 },
      loadedAt: 0,
      loading: false,
    },
  };

  const els = {};

  // ── Init ──
  function init() {
    cacheEls();
    configureFormNumericUx(els.newPropertyForm, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain"] });
    bindEvents();
    setupChrome();
    ensureLoginThenLoad();
  }

  function cacheEls() {
    els.agentUserBadge = $("#agentUserBadge");
    els.btnAgentLogout = $("#btnAgentLogout");
    els.btnChangeMyPassword = $("#btnChangeMyPassword");
    els.btnDailyReport = $("#btnDailyReport");
    els.globalMsg = $("#globalMsg");

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
    return {
      id: String(user?.id || user?.email || "").trim(),
      name: String(user?.name || user?.email || "").trim(),
    };
  }

  const DAILY_REPORT_ACTION_KEYS = {
    rightsAnalysis: "rights_analysis",
    siteInspection: "site_inspection",
    dailyIssue: "daily_issue",
    newProperty: "new_property",
  };

  function emptyDailyReportCounts() {
    return { total: 0, rightsAnalysis: 0, siteInspection: 0, dailyIssue: 0, newProperty: 0 };
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
    return parts.join("\n");
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

  function setGlobalMsg(text, isError = true) {
    if (!els.globalMsg) return;
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

  async function refreshDailyReportSummary(options = {}) {
    const dateKey = String(options.dateKey || getTodayDateKey()).trim();
    if (!dateKey) return state.dailyReport.counts || emptyDailyReportCounts();
    if (state.dailyReport.loading && !options.force) return state.dailyReport.counts || emptyDailyReportCounts();
    state.dailyReport.loading = true;
    try {
      const data = await apiJson(`/properties?daily_report=1&date=${encodeURIComponent(dateKey)}`);
      const nextCounts = { ...emptyDailyReportCounts(), ...(data?.counts || {}) };
      state.dailyReport = {
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
    }
  }

  function getDailyReportActorName() {
    return String(state.session?.user?.name || state.session?.user?.email || "나").trim() || "나";
  }

  function resolvePropertyKindBucket(input, directFlag) {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === "function") {
      if (input && typeof input === "object") return PropertyDomain.getSourceBucket(input);
      const normalized = PropertyDomain.normalizeSourceType?.(input, { fallback: "general" }) || String(input || "").trim() || "general";
      if (normalized === "realtor" && typeof directFlag === "boolean") return directFlag ? "realtor_direct" : "realtor_naver";
      return normalized;
    }
    const sourceType = String(input || "").trim();
    if (sourceType === "realtor" && typeof directFlag === "boolean") return directFlag ? "realtor_direct" : "realtor_naver";
    return sourceType || "general";
  }

  function getPropertyKindLabel(input, directFlag) {
    const bucket = resolvePropertyKindBucket(input, directFlag);
    if (PropertyDomain && typeof PropertyDomain.getSourceBucketLabel === "function") return PropertyDomain.getSourceBucketLabel(bucket);
    const map = { auction: "경매", onbid: "공매", realtor_naver: "네이버중개", realtor_direct: "일반중개", realtor: "중개", general: "일반" };
    return map[String(bucket || "").trim()] || "일반";
  }

  function getPropertyKindClass(input, directFlag) {
    const bucket = resolvePropertyKindBucket(input, directFlag);
    if (bucket === "auction") return "kind-auction";
    if (bucket === "onbid") return "kind-gongmae";
    if (bucket === "realtor_naver" || bucket === "realtor_direct" || bucket === "realtor") return "kind-realtor";
    return "kind-general";
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
          counts: { rights_analysis: 0, site_inspection: 0, daily_issue: 0, new_property: 0 },
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
                const item = group.item;
                const kindLabel = getPropertyKindLabel(item);
                const kindClass = getPropertyKindClass(item);
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
      await refreshDailyReportSummary({ force: true });
      setGlobalMsg("");
    } catch (err) {
      setGlobalMsg(err?.message || "일일업무일지 조회 실패");
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
      note: key === "dailyIssue" ? (String(options.dailyIssueText || "").trim() || null) : null,
      actionDate: String(options.actionDate || getTodayDateKey(options.at)).trim() || getTodayDateKey(),
    }));
  }

  async function recordDailyReportEntries(entries) {
    const safeEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.actionType);
    if (!safeEntries.length) return;
    await apiJson('/properties', {
      method: 'POST',
      json: { action: 'daily_report_log', entries: safeEntries },
    });
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
    priceMain: "매매가",
    sourceUrl: "원문링크",
    realtorName: "중개사무소명",
    realtorPhone: "유선전화",
    realtorCell: "휴대폰번호",
    submitterName: "등록자명",
    submitterPhone: "등록자 연락처",
    memo: "메모/의견",
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
    if (PropertyDomain && typeof PropertyDomain.buildRegisterLogContext === "function") return PropertyDomain.buildRegisterLogContext(route, { user });
    return {
      at: new Date().toISOString(),
      route: String(route || "등록").trim(),
      actor: String(user?.name || user?.email || "").trim(),
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
        assignIfEmpty: !!options.assignIfEmpty,
        copyFields: ["address","asset_type","exclusive_area","common_area","site_area","use_approval","price_main","broker_office_name","submitter_name","submitter_phone","memo","item_no","assignee_id","source_type","submitter_type"],
        labels: REG_LOG_LABELS,
        amountFields: ["priceMain"],
        numericFields: ["priceMain", "commonArea", "exclusiveArea", "siteArea"],
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
    const mergedRaw = mergeMeaningfulShallow(base.raw || {}, incomingRow?.raw || {});
    nextRow.raw = attachRegistrationIdentity(appendRegistrationChangeLog(mergedRaw, context, changes), nextSnapshot);
    return { row: nextRow, changes };
  }

  function buildRegistrationDbRowForCreate(row, context) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationDbRowForCreate === "function") {
      return PropertyDomain.buildRegistrationDbRowForCreate(row, context);
    }
    return { ...(row || {}), raw: attachRegistrationIdentity(appendRegistrationCreateLog(row?.raw || {}, context), row) };
  }

  function findExistingPropertyByRegistrationKey(data, items) {
    if (PropertyDomain && typeof PropertyDomain.findExistingPropertyByRegistrationKey === "function") {
      return PropertyDomain.findExistingPropertyByRegistrationKey(data, items);
    }
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
      itemNo: base.itemNo,
      address: base.address,
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

  function getFilteredProps() {
    let rows = state.properties;
    const f = state.filters;

    // 카드 클릭 필터
    if (f.activeCard && f.activeCard !== "all") {
      rows = rows.filter((r) => {
        if (PropertyDomain && typeof PropertyDomain.matchesSourceBucket === "function") {
          return PropertyDomain.matchesSourceBucket(r, f.activeCard);
        }
        if (f.activeCard === "realtor_naver") return r.sourceType === "realtor" && !r.isDirectSubmission;
        if (f.activeCard === "realtor_direct") return r.sourceType === "realtor" && r.isDirectSubmission;
        return r.sourceType === f.activeCard;
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
    const kindLabel = getPropertyKindLabel(p);
    const kindClass = getPropertyKindClass(p);
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
      '<td><span class="kind-text ' + kindClass + '">' + esc(kindLabel) + "</span></td>" +
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
  function getAgentEditableSnapshot(item) {
    const raw = item?._raw?.raw || {};
    const row = item?._raw || {};
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
      siteInspection: firstText(raw.siteInspection, raw.site_inspection, item?.siteInspection, ""),
      opinion: firstText(raw.opinion, raw.memo, row.memo, item?.opinion, ""),
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

  function openEditModal(item) {
    state.editingProperty = item;
    if (!els.agEditForm) return;
    const f = els.agEditForm;
    const view = getAgentEditableSnapshot(item);

    configureFormNumericUx(f, { decimalNames: ["commonarea", "exclusivearea", "sitearea"], amountNames: ["priceMain", "currentPrice"] });

    setVal(f, "itemNo", item.itemNo);
    setVal(f, "sourceType", getPropertyKindLabel(item));
    setVal(f, "assetType", item.assetType === "-" ? "" : item.assetType);
    setVal(f, "status", item.status);
    setVal(f, "address", item.address);
    setVal(f, "floor", view.floor);
    setVal(f, "totalfloor", view.totalfloor);
    setVal(f, "useapproval", formatDate(view.useapproval));
    setVal(f, "commonarea", view.commonarea != null ? fmtArea(view.commonarea) : "");
    setVal(f, "exclusivearea", view.exclusivearea != null ? fmtArea(view.exclusivearea) : "");
    setVal(f, "sitearea", view.sitearea != null ? fmtArea(view.sitearea) : "");
    setVal(f, "priceMain", view.priceMain != null ? formatMoneyInputValue(view.priceMain) : "");
    setVal(f, "currentPrice", view.currentPrice != null ? formatMoneyInputValue(view.currentPrice) : "");
    setVal(f, "dateMain", view.dateMain || "");
    setVal(f, "rightsAnalysis", view.rightsAnalysis);
    setVal(f, "siteInspection", view.siteInspection);
    setVal(f, "opinion", "");

    ["itemNo", "sourceType", "assetType", "status", "address"].forEach((name) => {
      const el = f.elements[name];
      if (el) {
        el.readOnly = true;
        el.classList.add("agent-lock-input");
      }
    });

    if (els.agEditMsg) els.agEditMsg.textContent = "";
    renderOpinionHistory(els.agHistoryList, loadOpinionHistory(item), false);
    renderRegistrationLog(els.agRegistrationLogList, loadRegistrationLog(item));
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
    const readNum = (name) => parseFlexibleNumber(f.elements[name]?.value);
    const newOpinionText = readStr("opinion");
    const opinionHistory = appendOpinionEntry(loadOpinionHistory(item), newOpinionText, state.session?.user);

    const currentUserId = String(state.session?.user?.id || "").trim();
    const patch = {};
    const rightsVal = readStr("rightsAnalysis") || null;
    const siteVal = readStr("siteInspection") || null;
    const floorVal = readStr("floor") || null;
    const totalFloorVal = readStr("totalfloor") || null;
    const useApprovalVal = readStr("useapproval") || null;
    const commonAreaVal = readNum("commonarea");
    const exclusiveAreaVal = readNum("exclusivearea");
    const siteAreaVal = readNum("sitearea");
    const priceMainVal = readNum("priceMain");
    const currentPriceVal = readNum("currentPrice");
    const dateMainVal = readStr("dateMain") || null;

    patch.memo = opinionHistory.length ? opinionHistory[opinionHistory.length - 1].text : (item.opinion || null);

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
      const newRaw = sanitizePropertyRawForSave(existingRaw, {
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
        siteInspection: siteVal,
        ...(patch.memo !== undefined ? { opinion: patch.memo, memo: patch.memo } : {}),
        opinionHistory,
      });

      maybeAssignInitialColumnValue(patch, "use_approval", useApprovalVal, item?._raw?.use_approval);
      maybeAssignInitialColumnValue(patch, "common_area", commonAreaVal, item?._raw?.common_area);
      maybeAssignInitialColumnValue(patch, "exclusive_area", exclusiveAreaVal, item?._raw?.exclusive_area);
      maybeAssignInitialColumnValue(patch, "site_area", siteAreaVal, item?._raw?.site_area);
      maybeAssignInitialColumnValue(patch, "price_main", priceMainVal, item?._raw?.price_main);
      maybeAssignInitialColumnValue(patch, "date_main", dateMainVal, item?._raw?.date_main);

      const workCategories = [];
      const changedFields = {};
      const prev = getAgentEditableSnapshot(item);
      if (rightsVal && rightsVal !== String(prev.rightsAnalysis || "").trim()) {
        workCategories.push("rightsAnalysis");
        changedFields.rightsAnalysis = ["rightsAnalysis"];
      }
      if (siteVal && siteVal !== String(prev.siteInspection || "").trim()) {
        workCategories.push("siteInspection");
        changedFields.siteInspection = ["siteInspection"];
      }
      if (newOpinionText) {
        workCategories.push("dailyIssue");
        changedFields.dailyIssue = ["opinion"];
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
            _raw: { ...(item._raw || {}), raw: newRaw },
          }, {
            propertyId: updatedRow?.id || item.id || item.globalId || targetId,
            identityKey: newRaw.registrationIdentityKey || buildRegistrationMatchKey({ ...item, raw: newRaw, _raw: { ...(item._raw || {}), raw: newRaw } }),
            changedFields,
            dailyIssueText: newOpinionText,
          }));
        } catch (logErr) {
          activityError = logErr?.message || "일일업무일지 기록 실패";
        }
      }

      closeEditModal();
      await loadProperties();
      if (activityError) setGlobalMsg(`저장은 완료되었지만 업무일지 기록에 실패했습니다. ${activityError}`);
      else setGlobalMsg("");
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
    if (PropertyDomain && typeof PropertyDomain.pickFirstText === "function") return PropertyDomain.pickFirstText(...args);
    for (const v of args) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return "";
  }

  function toNum(v) {
    if (Shared && typeof Shared.toNullableNumber === "function") return Shared.toNullableNumber(v);
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function esc(v) {
    if (Shared && typeof Shared.escapeHtml === "function") return Shared.escapeHtml(v);
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
    if (Shared && typeof Shared.formatDate === "function") return Shared.formatDate(v);
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

  function sanitizeJsonValue(value, depth = 0, seen) {
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
    const saveRes = await apiJson(`/properties`, { method: "POST", json: { row } });
    return saveRes?.item || null;
  }

  async function updatePropertyRowResilient(_sb, targetId, patch) {
    const saveRes = await apiJson(`/properties`, { method: "PATCH", json: { targetId, patch } });
    return saveRes?.item || { id: targetId };
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

    const currentUserId = String(state.session?.user?.id || "").trim() || null;
    const submitterType = submitterKind === "realtor" ? "realtor" : "owner";
    const payload = {
      source_type: sourceType,
      is_general: true,
      submitter_type: submitterType,
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
        source_type: sourceType,
        submitterType,
        submitter_type: submitterType,
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
        registeredByName: actorName || null,
      },
    };

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
      const savePlan = PropertyDomain && typeof PropertyDomain.buildRegistrationPersistencePlan === "function"
        ? PropertyDomain.buildRegistrationPersistencePlan(existing || null, payload, regContext, {
            assignIfEmpty: true,
            labels: PropertyDomain.REGISTRATION_LOG_LABELS_AGENT,
            createMessage: "등록되었습니다.",
            mergeChangedMessage: "기존 물건을 갱신하고 등록 LOG를 추가했습니다.",
            mergeUnchangedMessage: "동일 물건이 있어 기존 물건에 반영했습니다.",
          })
        : null;
      if (existing) {
        const merged = savePlan || buildRegistrationDbRowForExisting(existing, payload, regContext, { assignIfEmpty: true });
        const patchRow = merged?.row || null;
        if (!patchRow) throw new Error("등록 병합 데이터를 준비하지 못했습니다.");
        const saveRes = await apiJson(`/properties`, {
          method: "PATCH",
          json: { targetId: existing.id || existing.globalId, patch: patchRow },
        });
        const updated = saveRes?.item || null;
        savedPropertyId = updated?.id || existing.id || existing.globalId || null;
        savedIdentityKey = patchRow?.raw?.registrationIdentityKey || existing?._raw?.raw?.registrationIdentityKey || buildRegistrationMatchKey(patchRow) || "";
        setNpmMsg(merged?.message || ((merged?.changes || []).length ? "기존 물건을 갱신하고 등록 LOG를 추가했습니다." : "동일 물건이 있어 기존 물건에 반영했습니다."), false);
      } else {
        const createPlan = savePlan || { row: buildRegistrationDbRowForCreate(payload, regContext), message: "등록되었습니다." };
        const createRow = createPlan?.row || null;
        if (!createRow) throw new Error("등록 데이터를 준비하지 못했습니다.");
        const saveRes = await apiJson(`/properties`, {
          method: "POST",
          json: { row: createRow },
        });
        const inserted = saveRes?.item || null;
        savedPropertyId = inserted?.id || null;
        savedIdentityKey = createRow?.raw?.registrationIdentityKey || buildRegistrationMatchKey(createRow) || "";
        setNpmMsg(createPlan?.message || "등록되었습니다.", false);
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
      setTimeout(() => { closeNewPropertyModal(); loadProperties(); }, 700);
    } finally {
      if (els.npmSave) els.npmSave.disabled = false;
    }
  }

  function loadRegistrationLog(item) {
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
    if (PropertyDomain && typeof PropertyDomain.appendOpinionEntry === "function") return PropertyDomain.appendOpinionEntry(history, newText, user);
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
    if (Shared && typeof Shared.debounce === "function") return Shared.debounce(fn, ms);
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
