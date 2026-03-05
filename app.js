(() => {
  "use strict";

  // ---- Config ----
  const API_BASE = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const GEO_CACHE_KEY = "knson_geo_cache_v1";

  // ---- State ----
  const state = {
    session: loadSession(),
    items: [],
    editingItem: null,
    view: "text", // text | map
    source: "all", // all | auction | onbid | realtor
    keyword: "",
    status: "",

    // kakao
    kakaoReady: null,
    map: null,
    geocoder: null,
    markers: [],
    geoCache: loadGeoCache(),
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheEls();

    // 내부 페이지 이동(관리자페이지 등) 시에는 자동 로그아웃을 스킵하기 위한 플래그
    try { sessionStorage.removeItem("knson_nav_keep_session"); } catch {}

    // 로그인 없으면 즉시 로그인 페이지
    if (!state.session?.token || !state.session?.user) {
      redirectToLogin(true);
      return;
    }

    // admin link: admin만 노출
    const isAdmin = isAdminUser(state.session.user);
    if (els.adminLink) {
      els.adminLink.style.display = isAdmin ? "inline-flex" : "none";
    }

    bindEvents();
    loadProperties();
  }

  function cacheEls() {
    els.btnLogout = document.getElementById("btnLogout");
    els.adminLink = document.querySelector(".admin-link");

    // KPI
    els.statTotal = document.getElementById("statTotal");
    els.statAuction = document.getElementById("statAuction");
    els.statGongmae = document.getElementById("statGongmae");
    els.statGeneral = document.getElementById("statGeneral");
    els.statGeneralFlagMini = document.getElementById("statGeneralFlagMini");

    els.statTotalCard = document.getElementById("statTotalCard");
    els.statAuctionCard = document.getElementById("statAuctionCard");
    els.statGongmaeCard = document.getElementById("statGongmaeCard");
    els.statGeneralCard = document.getElementById("statGeneralCard");

    // Views
    els.tabText = document.getElementById("tabText");
    els.tabMap = document.getElementById("tabMap");
    els.textView = document.getElementById("textView");
    els.mapView = document.getElementById("mapView");

    // Table
    els.tableWrap = document.querySelector(".table-wrap");
    els.tableBody = document.getElementById("tableBody");
    els.emptyState = document.getElementById("emptyState");

    // Filters
    els.btnFilter = document.getElementById("btnFilter");
    els.filterPanel = document.getElementById("filterPanel");
    els.btnFilterClose = document.getElementById("btnFilterClose");
    els.searchKeyword = document.getElementById("searchKeyword");
    els.filterStatus = document.getElementById("filterStatus");
    els.btnRefresh = document.getElementById("btnRefresh");
  
    // Edit modal
    els.propertyEditModal = document.getElementById("propertyEditModal");
    els.pemClose = document.getElementById("pemClose");
    els.pemCancel = document.getElementById("pemCancel");
    els.pemForm = document.getElementById("pemForm");
    els.pemSave = document.getElementById("pemSave");
    els.pemMsg = document.getElementById("pemMsg");

}

  function bindEvents() {
    // 방어: DOM 구조가 바뀌어도 에러 안 나게
    if (els.btnLogout) {
      els.btnLogout.addEventListener("click", () => {
        clearSession();
        redirectToLogin(true);
      });
    }

    // 관리자페이지로 이동할 때는 '페이지 떠나면 자동 로그아웃' 규칙에서 예외 처리
    if (els.adminLink) {
      els.adminLink.addEventListener("click", () => {
        try { sessionStorage.setItem("knson_nav_keep_session", "1"); } catch {}
      });
    }

    // KPI 카드 클릭 → 소스 필터
    const bindCard = (el, source) => {
      if (!el) return;
      el.addEventListener("click", () => {
        state.source = source;
        renderKPIs();
        renderTable();
        if (state.view === "map") renderKakaoMarkers();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      });
    };

    bindCard(els.statTotalCard, "all");
    bindCard(els.statAuctionCard, "auction");
    bindCard(els.statGongmaeCard, "gongmae");
    bindCard(els.statGeneralCard, "general");

    // 탭
    if (els.tabText) {
      els.tabText.addEventListener("click", () => setView("text"));
    }
    if (els.tabMap) {
      els.tabMap.addEventListener("click", async () => {
        setView("map");
        await ensureKakaoMap();
        await renderKakaoMarkers();
      });
    }

    // 필터 패널
    if (els.btnFilter && els.filterPanel) {
      els.btnFilter.addEventListener("click", () => openFilter());
    }
    if (els.btnFilterClose && els.filterPanel) {
      els.btnFilterClose.addEventListener("click", () => closeFilter());
    }

    if (els.searchKeyword) {
      els.searchKeyword.addEventListener(
        "input",
        debounce((e) => {
          state.keyword = String(e.target.value || "").trim();
          renderKPIs();
          renderTable();
        }, 120)
      );
    }

    if (els.filterStatus) {
      els.filterStatus.addEventListener("change", (e) => {
        state.status = String(e.target.value || "");
        renderKPIs();
        renderTable();
      });
    }

    if (els.btnRefresh) {
      els.btnRefresh.addEventListener("click", () => loadProperties());
    }

    // map view에서 창 크기 바뀌면 리레이아웃
    window.addEventListener(
      "resize",
      debounce(() => {
        if (state.view === "map" && state.map && window.kakao?.maps) {
          state.map.relayout();
        }
      }, 150)
    );

    // 요구사항: 로그인 이후 페이지를 나가면 자동 로그아웃
    // 단, 관리자페이지로 이동 같은 '내부 이동'은 예외 처리(위 플래그)
    window.addEventListener("pagehide", () => {
      let keep = false;
      try { keep = sessionStorage.getItem("knson_nav_keep_session") === "1"; } catch {}
      if (!keep) clearSession();
    });
  
    // Edit modal events
    if (els.propertyEditModal) {
      els.propertyEditModal.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.close === "true") showModal(false);
      });
    }
    if (els.pemClose) els.pemClose.addEventListener("click", () => showModal(false));
    if (els.pemCancel) els.pemCancel.addEventListener("click", () => showModal(false));
    if (els.pemForm) {
      els.pemForm.addEventListener("submit", (e) => {
        e.preventDefault();
        saveEditModal();
      });
    }

}

  function setView(view) {
    state.view = view;
    if (els.tabText) {
      els.tabText.classList.toggle("is-active", view === "text");
      els.tabText.setAttribute("aria-selected", view === "text" ? "true" : "false");
    }
    if (els.tabMap) {
      els.tabMap.classList.toggle("is-active", view === "map");
      els.tabMap.setAttribute("aria-selected", view === "map" ? "true" : "false");
    }

    if (els.textView) els.textView.classList.toggle("hidden", view !== "text");
    if (els.mapView) els.mapView.classList.toggle("hidden", view !== "map");
  }

  function openFilter() {
    if (!els.filterPanel) return;
    els.filterPanel.classList.remove("hidden");
    els.filterPanel.setAttribute("aria-hidden", "false");
    if (els.searchKeyword) els.searchKeyword.focus();
  }

  function closeFilter() {
    if (!els.filterPanel) return;
    els.filterPanel.classList.add("hidden");
    els.filterPanel.setAttribute("aria-hidden", "true");
  }

  // ---- Data ----
  async function loadProperties() {
    try {
      const role = state.session?.user?.role;
      const scope = isAdminUser(state.session.user) ? "all" : "mine";
      const res = await api(`/properties?scope=${encodeURIComponent(scope)}`, { auth: true });
      state.items = Array.isArray(res?.items) ? res.items.map(normalizeItem) : [];

      renderKPIs();
      renderTable();

      if (state.view === "map") {
        await ensureKakaoMap();
        await renderKakaoMarkers();
      }

      // 필터 패널 닫기(선택)
      closeFilter();
    } catch (err) {
      console.error(err);
      state.items = [];
      renderKPIs();
      renderTable();
      // 네트워크 오류는 alert로 충분
      alert(err?.message || "목록을 불러오지 못했습니다.");
    }
  }

  function normalizeItem(p) {
    // 서버 레거시 필드 호환: p.source(auction/gongmae/general) -> sourceType(auction/onbid/realtor)
    const rawSource = (p.sourceType || p.source || p.category || "").toString().toLowerCase();
    const sourceType =
      rawSource === "auction" ? "auction" :
      rawSource === "gongmae" || rawSource === "onbid" ? "onbid" :
      rawSource === "realtor" ? "realtor" :
      rawSource === "general" ? "realtor" :
      "realtor";

    const itemNo = (p.itemNo || p.caseNo || p.item_id || p.listingId || p.externalId || "").toString().trim();

    const address = (p.address || p.location || p.addr || "").toString().trim();

    const latitude = toNumber(p.latitude ?? p.lat ?? p.y ?? "");
    const longitude = toNumber(p.longitude ?? p.lng ?? p.lon ?? p.x ?? "");

    const priceMain = toNumber(p.priceMain ?? p.salePrice ?? p.price ?? p.appraisalPrice ?? p.appraisal ?? 0);
    const dateMain = (p.dateMain || p.bidDate || p.bidEndAt || "").toString().trim();
    const createdAt = p.date || p.createdAt || p.created || "";

    const memo = (p.memo || "").toString();

    return {
      // identifiers
      id: (p.id || p._id || p.globalId || "").toString(),
      globalId: (p.globalId || (sourceType && itemNo ? `${sourceType}:${itemNo}` : "")).toString(),
      // standard
      itemNo,
      sourceType,
      isGeneral: Boolean(p.isGeneral || p.source === "general" || p.origin === "general"),
      address,
      assetType: (p.assetType || p.type || p.propertyType || p.kind || "").toString().trim(),
      exclusivearea: toNumber(p.exclusivearea ?? p.exclusiveArea ?? p.commonAreaPy ?? p.publicAreaPy ?? ""),
      commonarea: toNumber(p.commonarea ?? p.commonArea ?? p.privateAreaPy ?? p.areaPyeong ?? p.areaPy ?? ""),
      sitearea: toNumber(p.sitearea ?? p.siteArea ?? p.landAreaPy ?? ""),
      useapproval: (p.useapproval || p.useApproval || p.approvalDate || "").toString().trim(),
      status: (p.status || "").toString().trim(),
      priceMain,
      dateMain,
      sourceUrl: (p.sourceUrl || p.url || p.sourceURL || "").toString().trim(),
      memo,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      date: createdAt,
      // assignment
      assignedAgentId: (p.assignedAgentId || p.assigneeId || "").toString(),
      assignedAgentName: (p.assignedAgentName || p.assigneeName || "").toString(),
      // region hints (optional)
      regionGu: (p.regionGu || "").toString(),
      regionDong: (p.regionDong || "").toString(),
      // raw keep
      _raw: p,
    };
  }

  // ---- Render ----
  function getFilteredRows() {
    let rows = state.items.slice();

    // sourceType filter
    if (state.source && state.source !== "all") {
      rows = rows.filter((p) => p.sourceType === state.source);
    }

    // status filter (문자열 포함)
    const st = (state.status || "").trim();
    if (st) rows = rows.filter((p) => (p.status || "").includes(st));

    // keyword filter (주소/담당자/물건번호)
    const kw = (state.keyword || "").trim().toLowerCase();
    if (kw) {
      rows = rows.filter((p) => {
        const blob = [
          p.itemNo,
          p.address,
          p.assetType,
          p.assignedAgentName,
          p.status,
        ].filter(Boolean).join(" ").toLowerCase();
        return blob.includes(kw);
      });
    }

    return rows;
  }

  function renderKPIs() {
    const items = state.items || [];
    const total = items.length;
    const auction = items.filter((p) => p.sourceType === "auction").length;
    const onbid = items.filter((p) => p.sourceType === "onbid").length;
    const realtor = items.filter((p) => p.sourceType === "realtor").length;
    const general = items.filter((p) => p.isGeneral).length;

    if (els.statTotal) els.statTotal.textContent = formatInt(total);
    if (els.statAuction) els.statAuction.textContent = formatInt(auction);
    if (els.statGongmae) els.statGongmae.textContent = formatInt(onbid);
    if (els.statGeneral) els.statGeneral.textContent = formatInt(realtor);
    if (els.statGeneralFlagMini) els.statGeneralFlagMini.textContent = `일반 ${formatInt(general)}`;
  }

  function renderTable() {
    if (!els.tableBody) return;

    const rows = getFilteredRows();
    els.tableBody.innerHTML = "";

    if (!rows.length) {
      // 요구사항: 빈 데이터 의미없이 보여주지 않기
      if (els.tableWrap) els.tableWrap.classList.add("hidden");
      if (els.emptyState) {
        els.emptyState.classList.remove("hidden");
        els.emptyState.textContent = "등록된 물건이 없습니다.";
      }
      return;
    }

    if (els.tableWrap) els.tableWrap.classList.remove("hidden");
    if (els.emptyState) els.emptyState.classList.add("hidden");

    const frag = document.createDocumentFragment();
    for (const p of rows) frag.appendChild(renderRow(p));
    els.tableBody.appendChild(frag);
  }

  function renderRow(p) {
    const tr = document.createElement("tr");

    const kindClass =
      p.sourceType === "auction" ? "kind-auction" :
      p.sourceType === "onbid" ? "kind-gongmae" :
      "kind-realtor";

    const kindLabel =
      p.sourceType === "auction" ? "경매" :
      p.sourceType === "onbid" ? "공매" :
      "중개";

    const generalBadge = p.isGeneral ? '<span class="cell-badge warn">일반</span>' : '<span class="cell-badge muted">-</span>';

    const linkCell = p.sourceUrl ? `<a class="link" href="${escapeAttr(p.sourceUrl)}" target="_blank" rel="noopener">보기</a>` : "-";
    const memoCell = p.memo ? `<button class="btn-view" type="button">보기</button>` : "-";

    tr.innerHTML = `
      <td>${escapeHtml(p.itemNo || "-")}</td>
      <td><span class="kind-chip ${kindClass}">${escapeHtml(kindLabel)}</span></td>
      <td>${generalBadge}</td>
      <td>${escapeHtml(p.address || "-")}</td>
      <td>${escapeHtml(p.assetType || "-")}</td>
      <td>${formatNum(p.exclusivearea)}</td>
      <td>${formatNum(p.commonarea)}</td>
      <td>${formatNum(p.sitearea)}</td>
      <td>${escapeHtml(p.useapproval || "-")}</td>
      <td>${escapeHtml(p.status || "-")}</td>
      <td>${p.priceMain ? formatMoneyKRW(p.priceMain) : "-"}</td>
      <td>${escapeHtml(p.dateMain || "-")}</td>
      <td>${linkCell}</td>
      <td>${memoCell}</td>
      <td>${p.latitude != null ? escapeHtml(String(p.latitude)) : '<span class="cell-badge warn">필요</span>'}</td>
      <td>${p.longitude != null ? escapeHtml(String(p.longitude)) : '<span class="cell-badge warn">필요</span>'}</td>
      <td>${escapeHtml(formatShortDate(p.date) || "-")}</td>
      <td>${escapeHtml(p.assignedAgentName || "-")}</td>
    `;

    // memo button
    const btn = tr.querySelector(".btn-view");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openMemoAlert(p.memo);
      });
    }

    // row click to edit (권한 검사 후 모달)
    tr.addEventListener("click", () => openEditModal(p));
    
  // ---------------------------
  // Edit Modal (index)
  // ---------------------------
  function openMemoAlert(text) {
    alert(text || "");
  }

  function openEditModal(item) {
    if (!els.propertyEditModal || !els.pemForm) return;

    // 담당자는 본인 물건만(서버에서 mine으로 내려오지만, 방어적으로 체크)
    const isAdmin = isAdminUser(state.session?.user);
    if (!isAdmin) {
      const myId = state.session?.user?.id || "";
      const assignedId = item.assignedAgentId || "";
      if (assignedId && myId && assignedId !== myId) {
        alert("본인에게 배정된 물건만 수정할 수 있습니다.");
        return;
      }
    }

    state.editingItem = item;

    // Fill
    const f = els.pemForm;
    const setVal = (name, v) => {
      const el = f.elements[name];
      if (!el) return;
      el.value = v == null ? "" : String(v);
    };

    setVal("itemNo", item.itemNo);
    setVal("sourceType", item.sourceType);
    setVal("isGeneral", item.isGeneral ? "true" : "false");
    setVal("assignedAgentName", item.assignedAgentName);
    setVal("address", item.address);
    setVal("assetType", item.assetType);
    setVal("exclusivearea", item.exclusivearea ?? "");
    setVal("commonarea", item.commonarea ?? "");
    setVal("sitearea", item.sitearea ?? "");
    setVal("useapproval", item.useapproval);
    setVal("status", item.status);
    setVal("priceMain", item.priceMain ?? "");
    setVal("dateMain", item.dateMain);
    setVal("sourceUrl", item.sourceUrl);
    setVal("memo", item.memo);
    setVal("latitude", item.latitude ?? "");
    setVal("longitude", item.longitude ?? "");

    // 권한/규칙: 담당자는 '빈 값'만 입력 가능
    const lockIfHasValue = (name, hasValue) => {
      const el = f.elements[name];
      if (!el) return;
      el.disabled = !isAdmin && hasValue;
    };

    const hasText = (v) => v != null && String(v).trim() !== "";
    const hasNum = (v) => v != null && String(v).trim() !== "" && !Number.isNaN(Number(v));

    lockIfHasValue("itemNo", hasText(item.itemNo));
    lockIfHasValue("address", hasText(item.address));
    lockIfHasValue("assetType", hasText(item.assetType));
    lockIfHasValue("exclusivearea", hasNum(item.exclusivearea));
    lockIfHasValue("commonarea", hasNum(item.commonarea));
    lockIfHasValue("sitearea", hasNum(item.sitearea));
    lockIfHasValue("useapproval", hasText(item.useapproval));
    lockIfHasValue("status", hasText(item.status));
    lockIfHasValue("priceMain", hasNum(item.priceMain));
    lockIfHasValue("dateMain", hasText(item.dateMain));
    lockIfHasValue("sourceUrl", hasText(item.sourceUrl));
    lockIfHasValue("memo", hasText(item.memo));
    lockIfHasValue("latitude", hasNum(item.latitude));
    lockIfHasValue("longitude", hasNum(item.longitude));

    // sourceType/isGeneral/담당자명은 관리자만 변경(담당자 페이지에서는 읽기 전용)
    const stEl = f.elements["sourceType"];
    const genEl = f.elements["isGeneral"];
    const asEl = f.elements["assignedAgentName"];
    if (stEl) stEl.disabled = !isAdmin;
    if (genEl) genEl.disabled = !isAdmin;
    if (asEl) asEl.disabled = !isAdmin;

    setPemMsg("");
    showModal(true);
  }

  function showModal(open) {
    if (!els.propertyEditModal) return;
    if (open) {
      els.propertyEditModal.classList.remove("hidden");
      els.propertyEditModal.setAttribute("aria-hidden", "false");
    } else {
      els.propertyEditModal.classList.add("hidden");
      els.propertyEditModal.setAttribute("aria-hidden", "true");
      state.editingItem = null;
    }
  }

  function setPemMsg(msg, isError = true) {
    if (!els.pemMsg) return;
    els.pemMsg.style.color = isError ? "#b00020" : "#197a34";
    els.pemMsg.textContent = msg || "";
  }

  async function saveEditModal() {
    const item = state.editingItem;
    if (!item || !els.pemForm) return;

    const isAdmin = isAdminUser(state.session?.user);
    const fd = new FormData(els.pemForm);

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
      isGeneral: readStr("isGeneral") === "true",
      assignedAgentName: readStr("assignedAgentName") || null,
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
      memo: readStr("memo") || null,
      latitude: readNum("latitude"),
      longitude: readNum("longitude"),
    };

    // 담당자는 빈 값이었던 필드만 patch에 남기기(서버 보호 + 실수 방지)
    if (!isAdmin) {
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

      // 관리자 전용 필드 제거
      delete patch.sourceType;
      delete patch.isGeneral;
      delete patch.assignedAgentName;
    }

    // 필수로 보낼 식별자 확보
    const targetId = patch.id || patch.globalId;
    if (!targetId) {
      setPemMsg("저장 실패: 물건 식별자(id)가 없습니다. 관리자에게 문의해 주세요.");
      return;
    }

    try {
      els.pemSave && (els.pemSave.disabled = true);
      setPemMsg("");

      await updateProperty(targetId, patch, isAdmin);

      setPemMsg("저장 완료", false);
      showModal(false);
      await loadProperties();
    } catch (err) {
      console.error(err);
      setPemMsg(err?.message || "저장에 실패했습니다.");
    } finally {
      els.pemSave && (els.pemSave.disabled = false);
    }
  }

  async function updateProperty(targetId, patch, isAdmin) {
    // 레거시/신규 API 모두 고려한 보수적 접근
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
        const body = c.method === "POST" ? patch : patch;
        await api(c.path, { method: c.method, auth: true, body });
        return;
      } catch (e) {
        lastErr = e;
        // 404/405면 다음 후보로
        const msg = String(e?.message || "");
        if (msg.includes("404") || msg.includes("405") || msg.includes("not found")) continue;
      }
    }
    throw lastErr || new Error("저장에 실패했습니다.");
  }


  return tr;
  }

  function formatLocation(p) {
    // 화면 샘플처럼: 구/동 있으면 "서울 / 미아동" 형태를 우선
    if (p.regionGu || p.regionDong) {
      const left = p.regionGu || "";
      const right = p.regionDong || "";
      const mid = left && right ? " / " : "";
      return `${left}${mid}${right}`.trim();
    }
    return p.address || "";
  }

  function calcRate(appraisal, current) {
    const a = Number(appraisal || 0);
    const c = Number(current || 0);
    if (!Number.isFinite(a) || !Number.isFinite(c) || a <= 0 || c <= 0) return "-";
    return `${((c / a) * 100).toFixed(2)} %`;
  }

  // ---- Kakao Map ----
  function ensureMapDom() {
    if (!els.mapView) return { mapEl: null, hintEl: null };

    let mapEl = document.getElementById("kakaoMap");
    let hintEl = document.getElementById("mapHint");

    // 기존 placeholder 제거하고 실제 컨테이너 삽입
    if (!mapEl) {
      els.mapView.innerHTML = `
        <div class="map-wrap">
          <div id="mapHint" class="map-hint hidden"></div>
          <div id="kakaoMap" class="kakao-map"></div>
        </div>
      `;
      mapEl = document.getElementById("kakaoMap");
      hintEl = document.getElementById("mapHint");
    }

    return { mapEl, hintEl };
  }

  async function ensureKakaoMap() {
    const { mapEl, hintEl } = ensureMapDom();
    if (!mapEl) return;

    const key = getKakaoKey();
    if (!key) {
      if (hintEl) {
        hintEl.classList.remove("hidden");
        hintEl.textContent = "카카오 JavaScript 키가 필요합니다. index.html의 <meta name=\"kakao-app-key\">에 키를 넣어주세요.";
      }
      return;
    }

    if (!state.kakaoReady) {
      state.kakaoReady = loadKakaoSdk(key);
    }

    await state.kakaoReady;

    // 이미 생성돼 있으면 종료
    if (state.map && state.geocoder) return;

    const center = new kakao.maps.LatLng(37.5665, 126.9780); // Seoul
    state.map = new kakao.maps.Map(mapEl, {
      center,
      level: 6,
    });

    state.geocoder = new kakao.maps.services.Geocoder();
  }

  async function renderKakaoMarkers() {
    if (state.view !== "map") return;
    if (!state.map || !state.geocoder || !window.kakao?.maps) return;

    // clear markers
    for (const m of state.markers) m.setMap(null);
    state.markers = [];

    const rows = getFilteredRows();
    const valid = rows.filter((r) => (r.address || "").trim().length > 0);
    if (!valid.length) return;

    let firstPos = null;

    for (const it of valid.slice(0, 200)) {
      const pos = (it.latitude != null && it.longitude != null)
        ? { lat: Number(it.latitude), lng: Number(it.longitude) }
        : await geocodeCached(it.address);
      if (!pos) continue;

      if (!firstPos) firstPos = pos;

      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(pos.lat, pos.lng),
        map: state.map,
      });

      state.markers.push(marker);
    }

    if (firstPos) {
      state.map.setCenter(new kakao.maps.LatLng(firstPos.lat, firstPos.lng));
    }
  }

  function getKakaoKey() {
    const meta = document.querySelector('meta[name="kakao-app-key"]');
    const key = meta?.getAttribute("content")?.trim();
    return key || "";
  }

  function loadKakaoSdk(appKey) {
    return new Promise((resolve, reject) => {
      // 이미 로드됨
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve());
        return;
      }

      const s = document.createElement("script");
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
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

  async function geocodeCached(address) {
    const a = String(address || "").trim();
    if (!a) return null;

    const key = normalizeAddressKey(a);
    const cached = state.geoCache[key];
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
      return cached;
    }

    const pos = await geocodeAddress(a);
    if (pos) {
      state.geoCache[key] = pos;
      saveGeoCache(state.geoCache);
    }
    return pos;
  }

  function geocodeAddress(address) {
    return new Promise((resolve) => {
      if (!state.geocoder) return resolve(null);
      state.geocoder.addressSearch(address, (result, status) => {
        if (status !== kakao.maps.services.Status.OK) return resolve(null);
        const r = result?.[0];
        if (!r) return resolve(null);
        resolve({ lat: Number(r.y), lng: Number(r.x) });
      });
    });
  }

  function normalizeAddressKey(v) {
    return String(v || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[(),]/g, "")
      .trim();
  }

  // ---- API (GET preflight 최소화) ----
  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json" };

    const hasBody = !["GET", "HEAD"].includes(method);
    if (hasBody) headers["Content-Type"] = "application/json";

    if (options.auth && state.session?.token) {
      headers.Authorization = `Bearer ${state.session.token}`;
    }

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body || {}) : undefined,
      });
    } catch {
      throw new Error("서버 연결에 실패했습니다. (네트워크/CORS 확인)");
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const message = data?.message || `API 오류 (${res.status})`;
      throw new Error(message);
    }

    return data;
  }

  // ---- Utils ----
  function isAdminUser(user) {
    const r = String(user?.role || "").toLowerCase();
    return r === "admin" || r === "관리자";
  }

  function toNumber(v) {
    const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function toAreaPy(v) {
    if (v == null || v === "") return "";
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return "";

    // m2면 평으로 변환(대략)
    if (n > 200) {
      const py = n / 3.3058;
      return Math.round(py);
    }

    return Math.round(n);
  }

  function formatMoneyEok(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num) || num <= 0) return "-";
    // 단순: 1억=100,000,000
    const eok = num / 100000000;
    const fixed = eok >= 10 ? eok.toFixed(2) : eok.toFixed(2);
    return `${fixed.replace(/\.00$/, "")} 억원`;
  }

  function formatShortDate(v) {
    if (!v) return "";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
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
    // For attribute values (href etc.)
    return escapeHtml(v).replaceAll("`", "&#96;");
  }

  function formatNum(v) {
    if (v == null || v === "") return "-";
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    // 0이면 0 표시
    const s = (Math.round(n * 100) / 100).toString();
    return s;
  }

  function debounce(fn, wait = 200) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    state.session = null;
  }

  function redirectToLogin(replace = false) {
    const url = `./login.html?next=${encodeURIComponent("./index.html")}`;
    if (replace) location.replace(url);
    else location.href = url;
  }

  function loadGeoCache() {
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveGeoCache(cache) {
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache || {}));
    } catch {}
  }
})();
