(() => {
  "use strict";

  /**
   * ✅ 핵심 수정 (0건 로드 원인 대응)
   * - DEFAULT_QUERY에서 불필요한 기본 필터(prptDivCd/dspsMthodCd/bidDivCd/cptnMthodCd)를 제거
   *   → API가 “필터 미지정”일 때 가장 넓게 조회되도록 함
   * - items가 0건이면 첫 페이지 응답의 키/구조를 statusText에 표시(조용히 실패 방지)
   * - normalizeApiBase 슬래시 정리 정규식 안정화
   */

  // ====== 기본 검색 파라미터 ======
  const DEFAULT_QUERY = {
    resultType: "json",
  };

  // ✅ 기본 API_BASE: 너의 Vercel 프록시
  const DEFAULT_API_BASE = "https://knson.vercel.app/api";

  // ✅ 입찰방식(cptnMthodCd) 4종 전체 조회 (프록시/원본 API가 반복 파라미터를 허용하는 경우)
  // 값 형식이 다른 API(예: 01~04)를 쓰면 여기만 바꾸면 됨.
  const CPTN_METHOD_CODES_ALL = Object.freeze(["0001", "0002", "0003", "0004"]);
  const FIXED_ITEM_NAME_KEYWORD = "근린생활시설";
  const FIXED_QUERY_FILTERS = Object.freeze({
    dspsMthodCd: "0001", // 처분방식코드: 매각
    cltrUsgLclsCtgrNm: "부동산",
    cltrUsgMclsCtgrNm: "상가용및업무용건물",
    cltrUsgSclsCtgrNm: "근린생활시설",
  });

  const SYNC_SCOPE = Object.freeze({
    regionPrefixes: ["서울", "경기", "인천"],
    maxRatio: 50,
    pvctAllowed: ["Y", "N"],
  });
  const SYNC_SCOPE_TEXT = "서울, 경기, 인천 + 근린생활시설 + 수의계약 가능/불가능 + 비율 50% 이하 건만 동기화";


  // ====== localStorage keys ======
  const LS_API_BASE = "onbid_dash_api_base_v1";
  const LS_WORK = "onbid_dash_work_v1";
  const LS_CACHE = "onbid_dash_cache_v3";

  // ====== UI elements ======
  const $ = (id) => document.getElementById(id);

  const els = {
    apiBase: $("apiBase"),
    numOfRows: $("numOfRows"),
    pageNo: $("pageNo"),
    maxPages: $("maxPages"),
    fSido: $("fSido"),
    fSigungu: $("fSigungu"),
    fMinPrice: $("fMinPrice"),
    fMaxPrice: $("fMaxPrice"),
    fMaxRatio: $("fMaxRatio"),
    fMinFail: $("fMinFail"),
    fEndBefore: $("fEndBefore"),
    fKeyword: $("fKeyword"),
    fAssignee: $("fAssignee"),
    fBidResult: $("fBidResult"),
    fPvctTrgtYn: $("fPvctTrgtYn"),

    btnSync: $("btnSync"),
    btnExport: $("btnExport"),
    btnApplyFilter: $("btnApplyFilter"),
    btnClearFilter: $("btnClearFilter"),
    btnResetLocal: $("btnResetLocal"),

    statusText: $("statusText"),
    countPill: $("countPill"),
    tbody: $("tbody"),
    editor: $("editor"),
  };

  // ====== State ======
  let rawItems = [];
  let filteredItems = [];
  let selectedKey = null;

  // ====== Utils ======
  const fmtNum = (n) => {
    if (n === null || n === undefined || n === "") return "";
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    return x.toLocaleString("ko-KR");
  };

  const toInt = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Math.trunc(v);
    const s = String(v).replace(/,/g, "").trim();
    if (!s) return null;
    const x = Number(s);
    return Number.isFinite(x) ? Math.trunc(x) : null;
  };

  const safe = (v) => (v === null || v === undefined ? "" : String(v));
  const buildKey = (it) => `${safe(it.cltrMngNo)}|${safe(it.pbctCdtnNo)}`;

  const loadWork = () => {
    try {
      return JSON.parse(localStorage.getItem(LS_WORK) || "{}");
    } catch {
      return {};
    }
  };
  const saveWork = (work) => localStorage.setItem(LS_WORK, JSON.stringify(work));

  const loadApiBase = () => localStorage.getItem(LS_API_BASE) || DEFAULT_API_BASE;
  const saveApiBase = (v) => localStorage.setItem(LS_API_BASE, v);

  const setStatus = (msg) => {
    if (els.statusText) els.statusText.textContent = msg;
  };

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return `${Math.round(n)}%`;
  }

  function formatBidMethodDisplay(it) {
    const name = safe(it?.cptnMthodNm).trim();
    const code = safe(it?.cptnMthodCd).trim();
    if (name && code) return `${name} (${code})`;
    return name || code || "-";
  }

  function uniqSorted(values) {
    return [...new Set(values.map((v) => safe(v).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  }

  function getBidEndFilterValue(it) {
    const result = safe(it?.pbctStatNm).trim();
    const method = safe(it?.cptnMthodNm).trim();
    const merged = `${result} ${method}`.trim();

    if (!merged) return "";
    if (/수의/.test(merged)) return "수의계약";
    if (/경쟁/.test(merged)) return "입찰경쟁";
    if (/유찰/.test(merged)) return "유찰";
    if (/낙찰/.test(merged)) return "낙찰";
    if (/취소/.test(merged)) return "취소";
    if (/변경/.test(merged)) return "변경";
    return result || method || "";
  }

  function resolvePvctTrgtYn(raw) {
    if (!raw || typeof raw !== "object") return "";

    const directKeys = [
      "pvctTrgtYn", "PVCTTRGTYN", "pvctYn", "pvctTrgYn",
      "prvtCtrtTrgtYn", "prvtCtrtYn", "privateContractTargetYn",
      "suiCtrtPsblYn", "suuiCtrtPsblYn"
    ];
    for (const k of directKeys) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      const v = String(raw[k] ?? "").trim().toUpperCase();
      if (v === "Y" || v === "N") return v;
    }

    const textCandidates = [
      raw.pvctTrgtNm,
      raw.pbctStatNm,
      raw.pbctStat,
      raw.cltrStatNm,
      raw.cltrSttsNm,
      raw.cltrSttusNm,
      raw.cltrStat,
      raw.cltrStts,
      raw.bidStatNm,
      raw.onbidCltrNm,
      raw.prptDivNm,
      raw.cptnMthodNm,
      raw.goodStatNm,
      raw.statusNm,
      raw.statNm,
    ].map((v) => String(v ?? "")).filter(Boolean);

    let joined = textCandidates.join(" | ");

    // 응답 스키마가 다를 때를 대비해 전체 문자열 필드를 한 번 더 훑음
    if (!joined || !/수의\s*계약/.test(joined)) {
      try {
        const allStrings = Object.values(raw)
          .filter((v) => v !== null && v !== undefined)
          .map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : ""))
          .filter(Boolean)
          .join(" | ");
        if (allStrings) joined = `${joined} | ${allStrings}`.trim();
      } catch {}
    }

    if (/수의\s*계약\s*(불가|불가능)/.test(joined)) return "N";
    if (/수의\s*계약\s*가능/.test(joined)) return "Y";

    return "";
  }

  function formatPvctTargetLabel(code) {
    const v = String(code || "").trim().toUpperCase();
    if (v === "Y") return "수의계약 가능";
    if (v === "N") return "수의계약 불가";
    return "-";
  }

  function toFloat(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).replace(/,/g, "").trim();
    if (!s) return null;
    const x = Number(s);
    return Number.isFinite(x) ? x : null;
  }

  function findAreaFieldValue(rawObj) {
    if (!rawObj || typeof rawObj !== "object") return null;

    const candidates = [
      "bldArea", "buldArea", "bldAr", "buldAr", "bldngArea", "buildingArea",
      "bldSqms", "bldSqm", "bldM2", "buldSqm", "buldM2", "bldTotArea",
      "totBldArea", "archArea", "bldnAr", "bldMetr", "bldAtmcAr",
      "bildArea", "건물면적", "건물면적(㎡)"
    ];

    for (const k of candidates) {
      if (Object.prototype.hasOwnProperty.call(rawObj, k)) {
        const n = toFloat(rawObj[k]);
        if (n !== null) return n;
      }
    }

    // 키 이름 패턴으로 한 번 더 탐색 (Onbid/프록시마다 필드명이 달라질 수 있음)
    for (const [k, v] of Object.entries(rawObj)) {
      if (v === null || v === undefined || v === "") continue;
      const key = String(k);
      if (/(bld|build|buld|건물)/i.test(key) && /(ar|area|sqm|m2|면적)/i.test(key)) {
        const n = toFloat(v);
        if (n !== null) return n;
      }
    }

    return null;
  }

  function sqmToPy(sqm) {
    const n = toFloat(sqm);
    if (n === null) return null;
    return n / 3.305785;
  }

  function formatAreaCell(sqm) {
    const s = toFloat(sqm);
    if (s === null) return "-";
    const py = sqmToPy(s);
    return `${s.toFixed(2)}㎡ (${(py ?? 0).toFixed(2)} py)`;
  }

  function isInSyncRegion(sido) {
    const v = safe(sido).trim();
    if (!v) return false;
    return SYNC_SCOPE.regionPrefixes.some((p) => v.startsWith(p));
  }

  function isAllowedPvct(v) {
    const x = String(v || "").trim().toUpperCase();
    return SYNC_SCOPE.pvctAllowed.includes(x);
  }

  function matchesSyncScope(it) {
    if (!it) return false;
    if (!isInSyncRegion(it.lctnSdnm)) return false;
    const ratio = Number(it.apslPrcCtrsLowstBidRto);
    if (!Number.isFinite(ratio) || ratio > SYNC_SCOPE.maxRatio) return false;
    // pvctTrgtYn는 응답 스키마/필드명 차이로 누락될 수 있어 동기화 단계에서는 너무 엄격히 제외하지 않음.
    // 단, 값이 식별되면 Y/N만 허용.
    if (it.pvctTrgtYn && !isAllowedPvct(it.pvctTrgtYn)) return false;

    // 기본 고정 조건(방어적 재검증)
    if (safe(it.dspsMthodCd) && safe(it.dspsMthodCd) !== FIXED_QUERY_FILTERS.dspsMthodCd) return false;
    const l = safe(it.cltrUsgLclsCtgrNm).trim();
    const m = safe(it.cltrUsgMclsCtgrNm).trim();
    const scls = safe(it.cltrUsgSclsCtgrNm).trim();
    if (l && l !== FIXED_QUERY_FILTERS.cltrUsgLclsCtgrNm) return false;
    if (m && m !== FIXED_QUERY_FILTERS.cltrUsgMclsCtgrNm) return false;
    if (scls && scls !== FIXED_QUERY_FILTERS.cltrUsgSclsCtgrNm) return false;

    return true;
  }

  function ensureSyncScopeHint() {
    const anchor = els.statusText;
    if (!anchor || !anchor.parentElement) return;
    let hint = document.getElementById("syncScopeHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "syncScopeHint";
      hint.className = "sync-scope-hint";
      anchor.parentElement.appendChild(hint);
    }
    hint.innerHTML = `<b>동기화 조건:</b> ${escapeHtml(SYNC_SCOPE_TEXT)}`;
  }

  function renderFeedbackCheck(note, label) {
    const raw = String(note || "").trim();
    if (!raw) return `<span class="fb-empty">-</span>`;
    return `<button type="button" class="fb-check" data-note="${escapeHtml(raw)}" aria-label="${escapeHtml(label)} 입력됨"></button>`;
  }

  function ensureFeedbackPopup() {
    let pop = document.getElementById("fbPopup");
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "fbPopup";
    pop.className = "fb-popup hidden";
    pop.innerHTML = `
      <button type="button" class="fb-popup-close" aria-label="닫기">×</button>
      <div class="fb-popup-body"></div>
    `;
    document.body.appendChild(pop);

    const close = () => pop.classList.add("hidden");
    pop.querySelector(".fb-popup-close")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    document.addEventListener("click", (e) => {
      if (pop.classList.contains("hidden")) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#fbPopup")) return;
      if (target.closest(".fb-check")) return;
      close();
    }, true);

    return pop;
  }

  function showFeedbackPopup(anchorEl, text) {
    const raw = String(text || "").trim();
    if (!raw || !anchorEl) return;

    const pop = ensureFeedbackPopup();
    const body = pop.querySelector(".fb-popup-body");
    if (body) body.textContent = raw; // 항목명 없이 입력 내용만 표시

    pop.classList.remove("hidden");
    pop.style.visibility = "hidden";
    pop.style.left = "0px";
    pop.style.top = "0px";

    const r = anchorEl.getBoundingClientRect();
    const gap = 8;
    const maxW = Math.min(420, window.innerWidth - 24);
    pop.style.maxWidth = `${maxW}px`;

    const pr = pop.getBoundingClientRect();
    let left = r.left + window.scrollX;
    let top = r.bottom + window.scrollY + gap;

    const maxLeft = window.scrollX + window.innerWidth - pr.width - 12;
    if (left > maxLeft) left = Math.max(window.scrollX + 12, maxLeft);

    const maxTop = window.scrollY + window.innerHeight - pr.height - 12;
    if (top > maxTop) {
      top = r.top + window.scrollY - pr.height - gap;
    }
    if (top < window.scrollY + 12) top = window.scrollY + 12;

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = "visible";
  }


  function lockKeywordFilterControl() {
    if (!els.fKeyword) return;
    const fixed = FIXED_ITEM_NAME_KEYWORD;
    if (els.fKeyword.tagName === "SELECT") {
      els.fKeyword.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = fixed;
      opt.textContent = fixed;
      els.fKeyword.appendChild(opt);
      els.fKeyword.value = fixed;
      els.fKeyword.disabled = true;
      els.fKeyword.title = `물건명 고정: ${fixed}`;
    } else {
      els.fKeyword.value = fixed;
      els.fKeyword.readOnly = true;
      els.fKeyword.title = `물건명 고정: ${fixed}`;
    }
  }

  function applyWideLayoutPatch() {
    const patchId = "onbid-wide-layout-patch";
    if (!document.getElementById(patchId)) {
      const style = document.createElement("style");
      style.id = patchId;
      style.textContent = `
        /* 조회설정/후보리스트 가로폭 최대화 (기존 CSS 보완) */
        body .container,
        body .wrap,
        body .page,
        body .app,
        body .layout,
        body .content,
        body .dashboard,
        body .dashboard-wrap {
          max-width: none !important;
          width: calc(100vw - 24px) !important;
        }
        /* 후보리스트 체크표시(권리분석/현장조사) */
        .fb-check {
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:28px;
          height:28px;
          padding:0 8px;
          border-radius:8px;
          border:1px solid rgba(255,255,255,.08);
          background: rgba(31, 48, 82, .65);
          color:#39d98a;
          font-weight:700;
          cursor:pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        }
        .fb-check::before { content:"✔"; font-size:14px; line-height:1; }
        .onbid-link {
          background: transparent !important;
          color: #9ec5ff !important;
          text-decoration: underline;
          border: 0 !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        a.onbid-link { display: inline-block; }
        button.onbid-link { cursor: pointer; font: inherit; }
        .fb-empty { color: rgba(255,255,255,.55); }
        .sync-scope-hint {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.4;
          color: rgba(190, 215, 255, .9);
          opacity: .95;
          word-break: keep-all;
        }
        .sync-scope-hint b { color: #d7ecff; }
        .fb-popup {
          position: absolute;
          z-index: 9999;
          min-width: 180px;
          max-width: min(420px, calc(100vw - 24px));
          padding: 10px 12px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(7, 13, 28, .96);
          color: #e8f2ff;
          box-shadow: 0 14px 38px rgba(0,0,0,.35);
        }
        .fb-popup.hidden { display: none; }
        .fb-popup-close {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 24px;
          height: 24px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.04);
          color: #dcecff;
          cursor: pointer;
          line-height: 1;
          font-size: 16px;
        }
        .fb-popup-body {
          margin-top: 2px;
          padding-right: 18px;
          font-size: 12px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }
      `;
      document.head.appendChild(style);
    }

    const widenAncestors = (anchor, depth = 7) => {
      let node = anchor;
      let count = 0;
      while (node && count < depth) {
        if (node instanceof HTMLElement) {
          node.style.maxWidth = "none";
          if (count > 0) node.style.width = "100%";
        }
        node = node.parentElement;
        count += 1;
      }
    };

    [els.apiBase, els.tbody].filter(Boolean).forEach((anchor) => widenAncestors(anchor));

    const table = els.tbody?.closest?.("table");
    if (table) {
      table.style.width = "100%";
      table.style.minWidth = "100%";
    }
    const tableWrap = table?.parentElement;
    if (tableWrap) {
      tableWrap.style.width = "100%";
      tableWrap.style.maxWidth = "none";
      tableWrap.style.overflowX = tableWrap.style.overflowX || "auto";
    }
  }


  function findLikelyFieldBlock(el) {
    if (!(el instanceof Element)) return null;
    let node = el;
    while (node && node !== document.body) {
      const labels = node.querySelectorAll ? node.querySelectorAll("label") : [];
      const controls = node.querySelectorAll ? node.querySelectorAll("input,select,textarea") : [];
      if (labels.length >= 1 && labels.length <= 3 && controls.length >= 1 && controls.length <= 4 && node.contains(el)) {
        return node;
      }
      node = node.parentElement;
    }
    return el.parentElement || null;
  }

  function relabelByTextContains(fromText, toText) {
    const labels = [...document.querySelectorAll("label")];
    labels.forEach((lb) => {
      const t = (lb.textContent || "").trim();
      if (t.includes(fromText)) lb.textContent = t.replace(fromText, toText);
    });
  }

  function hideFieldBlockByEl(el) {
    const block = findLikelyFieldBlock(el);
    if (!block) return null;
    block.style.display = "none";
    return block;
  }

  function buildCandidateFilterDock() {
    const table = els.tbody?.closest?.("table");
    if (!table) return null;
    const tableWrap = table.parentElement || table;
    let dock = document.getElementById("candidateFilterDock");
    if (!dock) {
      dock = document.createElement("div");
      dock.id = "candidateFilterDock";
      dock.className = "candidate-filter-dock";
      dock.innerHTML = `
        <div class="candidate-filter-grid"></div>
        <div class="candidate-filter-actions"></div>
      `;
      tableWrap.parentNode?.insertBefore(dock, tableWrap);
    }
    return dock;
  }

  function moveNodeIfPresent(node, target) {
    if (!(node instanceof Element) || !(target instanceof Element)) return false;
    target.appendChild(node);
    return true;
  }

  function patchFilterAndSyncLayout() {
    // 1) 동기화(조회) 고정값화 + 기존 페이지 관련 필드 숨김
    if (els.numOfRows) {
      els.numOfRows.value = "50";
      hideFieldBlockByEl(els.numOfRows);
      els.numOfRows.disabled = true;
    }
    if (els.pageNo) {
      els.pageNo.value = "1";
      hideFieldBlockByEl(els.pageNo);
      els.pageNo.disabled = true;
    }
    if (els.maxPages) {
      hideFieldBlockByEl(els.maxPages);
      els.maxPages.disabled = true;
    }

    // 2) 후보리스트 필터에서 제거할 항목 숨김
    hideFieldBlockByEl(els.fMinPrice);
    hideFieldBlockByEl(els.fMaxPrice);

    // fBidResult는 fAssignee/fPvctTrgtYn와 동일 필드 블록(세로 스택)으로 생성되는 경우가 있어
    // 블록 전체를 숨기면 담당자/수의계약가능여부까지 같이 사라질 수 있음.
    {
      const bidBlock = findLikelyFieldBlock(els.fBidResult);
      const assigneeBlock = findLikelyFieldBlock(els.fAssignee);
      const pvctBlock = findLikelyFieldBlock(els.fPvctTrgtYn);
      const sharedWithKept = !!(bidBlock && (bidBlock === assigneeBlock || bidBlock === pvctBlock));
      if (sharedWithKept) {
        if (els.fBidResult) {
          els.fBidResult.style.display = "none";
          els.fBidResult.disabled = true;
        }
      } else {
        hideFieldBlockByEl(els.fBidResult);
      }
    }

    hideFieldBlockByEl(els.fEndBefore);

    // 라벨 문구 정리 (요청: HHmm 제거)
    relabelByTextContains("YYYYMMDDHHmm", "YYYY/MMDD");
    relabelByTextContains("YYYY/MMDDHHmm", "YYYY/MMDD");

    // 3) 남길 필터를 후보리스트 제목과 테이블 사이로 이동
    const dock = buildCandidateFilterDock();
    if (!dock) return;
    const grid = dock.querySelector(".candidate-filter-grid");
    const actions = dock.querySelector(".candidate-filter-actions");
    if (!grid || !actions) return;

    const keepControls = [
      els.fSido,
      els.fSigungu,
      els.fMaxRatio,
      els.fMinFail,
      els.fKeyword,
      els.fAssignee,
      els.fPvctTrgtYn,
    ].filter(Boolean);

    const moved = new Set();
    keepControls.forEach((ctl) => {
      const block = findLikelyFieldBlock(ctl);
      if (!block || moved.has(block)) return;
      moved.add(block);
      grid.appendChild(block);
    });

    // 필터 버튼 이동 (원래 조회 설정 카드 하단에 섞여 있던 것 분리)
    [els.btnApplyFilter, els.btnClearFilter].forEach((btn) => {
      if (btn && btn.parentElement !== actions) {
        actions.appendChild(btn);
      }
    });

    // 후보리스트 카운트/필터 간격 안정화
    if (!dock.dataset.patched) {
      dock.dataset.patched = "1";
      const styleId = "candidate-filter-dock-style";
      if (!document.getElementById(styleId)) {
        const st = document.createElement("style");
        st.id = styleId;
        st.textContent = `
          .candidate-filter-dock{
            margin: 10px 12px 12px;
            padding: 12px;
            border-radius: 14px;
            border: 1px solid rgba(255,255,255,.08);
            background: rgba(255,255,255,.02);
          }
          .candidate-filter-dock .candidate-filter-grid{
            display:grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap:10px 12px;
            align-items:end;
          }
          .candidate-filter-dock .candidate-filter-actions{
            display:flex;
            gap:8px;
            margin-top:10px;
            flex-wrap:wrap;
          }
          .candidate-filter-dock .candidate-filter-grid > *{
            min-width:0;
          }
        `;
        document.head.appendChild(st);
      }
    }
  }

  function upgradeInputToSelect(id, placeholderText) {
    let el = document.getElementById(id);
    if (!el) return null;
    if (el.tagName === "SELECT") return el;

    const select = document.createElement("select");
    select.id = el.id;
    select.name = el.name || "";
    select.className = el.className || "";
    select.title = el.title || placeholderText || "";
    select.setAttribute("aria-label", placeholderText || id);

    // dataset/inline style 최대한 보존
    [...el.attributes].forEach((attr) => {
      if (["id", "name", "type", "value", "placeholder"].includes(attr.name)) return;
      try {
        select.setAttribute(attr.name, attr.value);
      } catch {}
    });

    const firstOpt = document.createElement("option");
    firstOpt.value = "";
    firstOpt.textContent = placeholderText || "전체";
    select.appendChild(firstOpt);

    select.value = el.value || "";
    el.replaceWith(select);
    return select;
  }

  function ensureBidResultFilterControl() {
    let el = document.getElementById("fBidResult");
    if (el) {
      els.fBidResult = el;
      return el;
    }

    const anchor = els.fAssignee || els.fKeyword || els.fEndBefore || null;
    if (!anchor || !anchor.parentNode) return null;

    const select = document.createElement("select");
    select.id = "fBidResult";
    select.className = anchor.className || "";
    select.title = "입찰종료 필터";
    select.setAttribute("aria-label", "입찰종료");
    select.innerHTML = `<option value="">입찰종료(전체)</option>`;

    anchor.parentNode.insertBefore(select, anchor.nextSibling);
    els.fBidResult = select;
    return select;
  }

  function normalizePvctFilterOptionLabels(el) {
    if (!el) return;
    try {
      [...(el.options || [])].forEach((opt) => {
        const v = String(opt.value || "").trim().toUpperCase();
        if (!v) opt.textContent = "수의계약 가능여부(전체)";
        else if (v === "Y") opt.textContent = "수의계약 가능";
        else if (v === "N") opt.textContent = "수의계약 불가능";
      });
    } catch {}
  }

  function ensurePvctTargetFilterControl() {
    let el = document.getElementById("fPvctTrgtYn");
    if (el) {
      els.fPvctTrgtYn = el;
      try {
        // 기존 HTML에 이미 select가 있으면 문구/옵션을 강제로 최신화
        const opts = [...el.options || []];
        let hasAll = false, hasY = false, hasN = false;
        opts.forEach((opt) => {
          const v = String(opt.value || "").trim().toUpperCase();
          if (!v) { hasAll = true; return; }
          if (v === "Y") { hasY = true; return; }
          if (v === "N") { hasN = true; return; }
        });
        if (!hasAll) { const o = document.createElement("option"); o.value = ""; el.insertBefore(o, el.firstChild); }
        if (!hasY) { const o = document.createElement("option"); o.value = "Y"; el.appendChild(o); }
        if (!hasN) { const o = document.createElement("option"); o.value = "N"; el.appendChild(o); }
        normalizePvctFilterOptionLabels(el);
      } catch {}
      return el;
    }

    const anchor = els.fBidResult || els.fAssignee || els.fKeyword || els.fEndBefore || null;
    if (!anchor || !anchor.parentNode) return null;

    const select = document.createElement("select");
    select.id = "fPvctTrgtYn";
    select.className = anchor.className || "";
    select.title = "수의계약가능여부 필터";
    select.setAttribute("aria-label", "수의계약가능여부");
    select.innerHTML = `
      <option value="">수의계약 가능여부(전체)</option>
      <option value="Y">수의계약 가능</option>
      <option value="N">수의계약 불가능</option>
    `;

    anchor.parentNode.insertBefore(select, anchor.nextSibling);
    els.fPvctTrgtYn = select;
    normalizePvctFilterOptionLabels(select);
    return select;
  }


  function patchCandidateTableHeader() {
    const table = els.tbody?.closest?.("table");
    const tr = table?.querySelector?.("thead tr");
    if (!tr) return;

    const desired = [
      "담당", "상태", "권리분석", "현장조사", "물건명", "소재지", "감정가", "최저가", "비율(%)",
      "건물면적", "유찰", "입찰방식", "입찰결과", "입찰종료일", "물건번호"
    ];

    const current = [...tr.children].map((th) => (th.textContent || "").replace(/\s+/g, ""));
    const desiredCmp = desired.map((s) => s.replace(/\s+/g, ""));
    const same = current.length === desiredCmp.length && current.every((v, i) => v === desiredCmp[i]);
    if (same) return;

    tr.innerHTML = desired.map((txt) => `<th>${txt}</th>`).join("");
  }

  function initSelectableFilterControls() {
    // 기존 텍스트 입력 → 선택형(select)으로 업그레이드 (같은 id 유지)
    els.fSido = upgradeInputToSelect("fSido", "시/도(전체)") || els.fSido;
    els.fSigungu = upgradeInputToSelect("fSigungu", "시/군/구(전체)") || els.fSigungu;
    els.fKeyword = upgradeInputToSelect("fKeyword", "물건명(고정)") || els.fKeyword;
    els.fAssignee = upgradeInputToSelect("fAssignee", "담당자(전체)") || els.fAssignee;

    ensureBidResultFilterControl();
    ensurePvctTargetFilterControl();
    lockKeywordFilterControl();

    // 시/도 선택 시 시군구 목록 재구성
    els.fSido?.addEventListener("change", () => {
      populateFilterSelectOptions({ preserveValues: true, only: ["sigungu"] });
    });
  }

  function setSelectOptions(selectEl, values, placeholderText, selectedValue = "") {
    if (!selectEl) return;
    const current = safe(selectedValue ?? selectEl.value).trim();
    const options = uniqSorted(values);

    const frag = document.createDocumentFragment();
    const firstOpt = document.createElement("option");
    firstOpt.value = "";
    firstOpt.textContent = placeholderText || "전체";
    frag.appendChild(firstOpt);

    options.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      frag.appendChild(opt);
    });

    selectEl.innerHTML = "";
    selectEl.appendChild(frag);

    if (current && options.includes(current)) {
      selectEl.value = current;
    } else {
      selectEl.value = "";
    }
  }

  function populateFilterSelectOptions({ preserveValues = true, only = null } = {}) {
    const prev = {
      sido: preserveValues ? safe(els.fSido?.value).trim() : "",
      sigungu: preserveValues ? safe(els.fSigungu?.value).trim() : "",
      keyword: preserveValues ? safe(els.fKeyword?.value).trim() : "",
      assignee: preserveValues ? safe(els.fAssignee?.value).trim() : "",
      bidResult: preserveValues ? safe(els.fBidResult?.value).trim() : "",
      pvctTrgtYn: preserveValues ? safe(els.fPvctTrgtYn?.value).trim().toUpperCase() : "",
    };

    const should = (name) => !Array.isArray(only) || only.includes(name);

    if (should("sido")) {
      setSelectOptions(els.fSido, rawItems.map((it) => it.lctnSdnm), "시/도(전체)", prev.sido);
    }

    const selectedSido = safe(els.fSido?.value || prev.sido).trim();
    const sigunguSource = selectedSido ? rawItems.filter((it) => safe(it.lctnSdnm).trim() === selectedSido) : rawItems;

    if (should("sigungu")) {
      setSelectOptions(els.fSigungu, sigunguSource.map((it) => it.lctnSggnm), "시/군/구(전체)", prev.sigungu);
    }

    if (should("keyword")) {
      lockKeywordFilterControl();
    }

    if (should("assignee")) {
      const work = loadWork();
      const assignees = Object.values(work)
        .map((w) => w?.assignee)
        .filter(Boolean);
      setSelectOptions(els.fAssignee, assignees, "담당자(전체)", prev.assignee);
    }

    if (should("bidResult")) {
      const bidResultValues = rawItems.map((it) => getBidEndFilterValue(it));
      setSelectOptions(els.fBidResult, bidResultValues, "입찰종료(전체)", prev.bidResult);
    }

    if (should("pvctTrgtYn") && els.fPvctTrgtYn) {
      const current = prev.pvctTrgtYn;
      const frag = document.createDocumentFragment();

      const optAll = document.createElement("option");
      optAll.value = "";
      optAll.textContent = "수의계약 가능여부(전체)";
      frag.appendChild(optAll);

      const optY = document.createElement("option");
      optY.value = "Y";
      optY.textContent = "수의계약 가능";
      frag.appendChild(optY);

      const optN = document.createElement("option");
      optN.value = "N";
      optN.textContent = "수의계약 불가능";
      frag.appendChild(optN);

      els.fPvctTrgtYn.innerHTML = "";
      els.fPvctTrgtYn.appendChild(frag);
      normalizePvctFilterOptionLabels(els.fPvctTrgtYn);
      els.fPvctTrgtYn.value = (current && ["Y", "N"].includes(current)) ? current : "";
    }
  }

  function normalizeApiBase(input) {
    let s = (input || "").trim();
    if (!s) s = DEFAULT_API_BASE;

    s = s.replace(/\s+/g, "").replace(/\/+$/, "");

    if (s.includes("github.io")) {
      s = DEFAULT_API_BASE.replace(/\/+$/, "");
    }

    if (s.includes(".vercel.app") && !/\/api$/i.test(s) && !/\/api\//i.test(s)) {
      s = s + "/api";
    }

    // ✅ 안정적인 슬래시 중복 정리(https://는 보존)
    s = s.replace(/([^:]\/)\/+/g, "$1");
    return s;
  }

  function buildOnbidLink(item) {
    const cltrHstrNo = safe(item?.cltrHstrNo);
    const cltrNo = safe(item?.cltrNo);
    const plnmNo = safe(item?.plnmNo);
    const pbctNo = safe(item?.pbctNo);
    const pbctCdtnNo = safe(item?.pbctCdtnNo);

    const hasDetail = cltrHstrNo && cltrNo && plnmNo && pbctNo;
    if (!hasDetail) return "";

    const params = new URLSearchParams();
    params.set("cltrHstrNo", cltrHstrNo);
    params.set("cltrNo", cltrNo);
    params.set("plnmNo", plnmNo);
    params.set("pbctNo", pbctNo);
    params.set("scrnGrpCd", "0001");
    if (pbctCdtnNo) params.set("pbctCdtnNo", pbctCdtnNo);

    return `https://www.onbid.co.kr/op/cta/cltrdtl/collateralRealEstateDetail.do?${params.toString()}`;
  }

  // ====== API 응답 파싱 ======
  function tryParseJsonLike(v) {
    if (typeof v !== "string") return v;
    const t = v.trim();
    if (!t) return v;
    if (!(t.startsWith("{") || t.startsWith("["))) return v;
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  }

  function extractItems(payload) {
    if (!payload) return [];

    let p = tryParseJsonLike(payload);

    // 프록시가 { result: ... } / { data: ... } 형태로 여러 번 감싸는 경우 대응
    for (let i = 0; i < 4 && p && typeof p === "object"; i++) {
      const next = p.result ?? p.data ?? null;
      if (next === null || next === undefined) break;
      const parsedNext = tryParseJsonLike(next);
      if (parsedNext === p) break;
      // header/response/body가 이미 있으면 wrapper로 간주하지 않음
      if (p.response || p.body || p.header) break;
      p = parsedNext;
    }

    p = tryParseJsonLike(p);

    // 공공데이터 표준 wrapper (response.header) 또는 (header)
    const header = p?.response?.header ?? p?.header ?? null;
    if (header?.resultCode && header.resultCode !== "00") {
      throw new Error(`${header.resultCode} ${header.resultMsg || "API Error"}`.trim());
    }

    let body = p?.response?.body ?? p?.body ?? p;
    body = tryParseJsonLike(body);

    // body 자체가 다시 wrapper인 경우 추가 대응
    for (let i = 0; i < 4 && body && typeof body === "object"; i++) {
      const next = body.result ?? body.data ?? null;
      if (next === null || next === undefined) break;
      const parsedNext = tryParseJsonLike(next);
      if (parsedNext === body) break;
      // items/list/item가 있으면 더 벗기지 않음
      if (body.items || body.item || body.list) break;
      body = parsedNext;
    }

    const items =
      body?.items?.item ??
      body?.items ??
      body?.item ??
      body?.list ??
      body?.result?.items?.item ??
      body?.result?.items ??
      body?.data?.items?.item ??
      body?.data?.items ??
      p?.result?.items?.item ??
      p?.result?.items ??
      p?.data?.items?.item ??
      p?.data?.items ??
      null;

    return Array.isArray(items) ? items : items ? [items] : [];
  }

  function normalize(it) {
    const appraised = toInt(it.apslEvlAmt);
    const minBid = toInt(it.lowstBidPrcIndctCont);
    const pvctTrgtYnResolved = resolvePvctTrgtYn(it);

    const ratio = (() => {
      if (it.apslPrcCtrsLowstBidRto !== undefined && it.apslPrcCtrsLowstBidRto !== null && it.apslPrcCtrsLowstBidRto !== "") {
        const x = toFloat(String(it.apslPrcCtrsLowstBidRto).replace(/%/g, ""));
        return x !== null ? x : appraised && minBid ? (minBid / appraised) * 100 : null;
      }
      return appraised && minBid ? (minBid / appraised) * 100 : null;
    })();

    return {
      cltrMngNo: safe(it.cltrMngNo),
      pbctCdtnNo: safe(it.pbctCdtnNo),

      cltrHstrNo: safe(it.cltrHstrNo),
      cltrNo: safe(it.cltrNo),
      plnmNo: safe(it.plnmNo),
      pbctNo: safe(it.pbctNo),

      onbidCltrNm: safe(it.onbidCltrNm),
      rqstOrgNm: safe(it.rqstOrgNm),
      lctnSdnm: safe(it.lctnSdnm),
      lctnSggnm: safe(it.lctnSggnm),
      lctnEmdNm: safe(it.lctnEmdNm),

      apslEvlAmt: appraised,
      lowstBidPrcIndctCont: safe(it.lowstBidPrcIndctCont),
      lowstBidAmt: minBid,
      apslPrcCtrsLowstBidRto: ratio,

      usbdNft: toInt(it.usbdNft) ?? 0,
      cltrBidEndDt: safe(it.cltrBidEndDt),
      cltrBidBgngDt: safe(it.cltrBidBgngDt),

      cptnMthodCd: safe(it.cptnMthodCd),
      cptnMthodNm: safe(it.cptnMthodNm),
      pbctStatNm: safe(it.pbctStatNm),
      bidCloseFilterType: getBidEndFilterValue(it),

      pvctTrgtYn: pvctTrgtYnResolved,
      pvctTrgtLabel: formatPvctTargetLabel(pvctTrgtYnResolved),

      prptDivNm: safe(it.prptDivNm),
      dspsMthodCd: safe(it.dspsMthodCd),
      dspsMthodNm: safe(it.dspsMthodNm),
      bidDivNm: safe(it.bidDivNm),

      cltrUsgLclsCtgrNm: safe(it.cltrUsgLclsCtgrNm),
      cltrUsgMclsCtgrNm: safe(it.cltrUsgMclsCtgrNm),
      cltrUsgSclsCtgrNm: safe(it.cltrUsgSclsCtgrNm),
      bldAreaSqm: findAreaFieldValue(it),
      bldAreaPy: sqmToPy(findAreaFieldValue(it)),

      _raw: it,
    };
  }

  // ====== Fetch ======
  function buildApiFiltersFromUI() {
    const o = {};

    const minP = els.fMinPrice?.value ? String(Math.max(0, Number(els.fMinPrice.value))) : "";
    const maxP = els.fMaxPrice?.value ? String(Math.max(0, Number(els.fMaxPrice.value))) : "";
    if (minP) o.lowstBidPrcStart = minP;
    if (maxP) o.lowstBidPrcEnd = maxP;

    const minFail = els.fMinFail?.value ? String(Math.max(0, Number(els.fMinFail.value))) : "";
    if (minFail) o.usbdNftStart = minFail;

    const sido = els.fSido?.value?.trim() || "";
    const sigungu = els.fSigungu?.value?.trim() || "";
    if (sido) o.lctnSdnm = sido;
    if (sigungu) o.lctnSggnm = sigungu;

    // NOTE: '검색(물건명)' UI는 근린생활시설 고정 표시만 하고,
    // 실제 API 검색어(onbidCltrNm)는 보내지 않는다.
    // 이유: 물건명에 '근린생활시설' 문자열이 없는 경우가 많아 0건이 될 수 있음.

    const endBefore = els.fEndBefore?.value?.trim() || "";
    if (endBefore && endBefore.length >= 8) o.bidPrdYmdEnd = endBefore.slice(0, 8);

    Object.assign(o, FIXED_QUERY_FILTERS);

    return o;
  }

  async function fetchPage(apiBase, pageNo, numOfRows) {
    const buildUrlForCode = (code, pvctYn) => {
      const url = new URL(`${apiBase.replace(/\/+$/, "")}/onbid/rlst-list`);
      url.searchParams.set("pageNo", String(pageNo));
      url.searchParams.set("numOfRows", String(numOfRows));

      Object.entries(DEFAULT_QUERY).forEach(([k, v]) => url.searchParams.set(k, v));

      const q = buildApiFiltersFromUI();
      Object.entries(q).forEach(([k, v]) => {
        if (v !== null && v !== undefined && String(v).trim() !== "") url.searchParams.set(k, String(v));
      });

      url.searchParams.delete("cptnMthodCd");
      if (code) url.searchParams.set("cptnMthodCd", String(code));
      url.searchParams.delete("pvctTrgtYn");
      if (pvctYn) url.searchParams.set("pvctTrgtYn", String(pvctYn));
      url.searchParams.set("_ts", String(Date.now()));
      return url;
    };

    const fetchJson = async (url) => {
      const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`API error ${res.status} ${res.statusText}\nURL: ${url.toString()}\nBODY: ${t.slice(0, 500)}`);
      }
      return res.json();
    };

    // 일부 프록시/원본 API는 반복 파라미터 OR 처리를 지원하지 않아 마지막 값만 적용될 수 있음.
    // 안전하게 코드별로 개별 호출 후 병합한다.
    const payloads = [];
    const pvctPairs = ["Y", "N"];
    for (const code of CPTN_METHOD_CODES_ALL) {
      if (!code) continue;
      for (const pvctYn of pvctPairs) {
        const url = buildUrlForCode(code, pvctYn);
        try {
          const payload = await fetchJson(url);
          payloads.push(payload);
        } catch (e) {
          console.warn("fetchPage subset failed", { code, pvctYn, error: e?.message || e });
        }
      }
    }
    return payloads;
  }

  async function sync() {
    const apiBase = normalizeApiBase(els.apiBase?.value || DEFAULT_API_BASE);
    if (els.apiBase) els.apiBase.value = apiBase;
    saveApiBase(apiBase);

    const numOfRows = 50; // 고정: 동기화용 내부 설정
    const pageStart = 1;   // 고정: 첫 페이지부터 전체 자동수집
    const maxPages = Number.POSITIVE_INFINITY; // 전체 동기화: 동기화 조건에 맞는 건을 끝까지 수집

    setStatus(`조회 중... (${SYNC_SCOPE_TEXT}) · 전체 페이지 자동수집`);
    if (els.btnSync) els.btnSync.disabled = true;

    try {
      const collected = [];
      let firstPayload = null;
      const HARD_PAGE_SAFETY_CAP = 500;

      for (let p = pageStart; p < pageStart + maxPages; p++) {
        if ((p - pageStart) >= HARD_PAGE_SAFETY_CAP) {
          console.warn("sync safety cap reached", { HARD_PAGE_SAFETY_CAP });
          break;
        }
        setStatus(`조회 중... (page ${p}, 전체 자동수집)`);
        const payloadBatch = await fetchPage(apiBase, p, numOfRows);
        const payloads = Array.isArray(payloadBatch) ? payloadBatch : [payloadBatch];
        if (!firstPayload) firstPayload = payloads[0] || payloadBatch;

        const pageItems = [];
        payloads.forEach((pl) => {
          try {
            pageItems.push(...extractItems(pl));
          } catch (e) {
            console.warn("extractItems failed for one payload", e);
          }
        });

        // 코드별 병합 시 중복 제거 (물건관리번호+공매조건번호 기준)
        const seenPage = new Set();
        const items = pageItems.filter((it) => {
          const k = `${safe(it?.cltrMngNo)}|${safe(it?.pbctCdtnNo)}`;
          if (seenPage.has(k)) return false;
          seenPage.add(k);
          return true;
        });

        if (!items.length) break;
        collected.push(...items);
      }

      const normalizedAll = collected.map(normalize);
      rawItems = normalizedAll.filter(matchesSyncScope);
      lockKeywordFilterControl();

      localStorage.setItem(LS_CACHE, JSON.stringify({ ts: Date.now(), items: rawItems.map((x) => x._raw) }));

      populateFilterSelectOptions({ preserveValues: true });
      applyFilter();

      if (rawItems.length === 0) {
        const topKeys = firstPayload ? Object.keys(firstPayload).slice(0, 10).join(", ") : "(no payload)";
        const hint = firstPayload?.response ? "response wrapper" : firstPayload?.body ? "body wrapper" : firstPayload?.result ? "result wrapper" : "unknown";
        setStatus(`완료: 0건 로드 (동기화조건 적용: ${SYNC_SCOPE_TEXT}) (응답키: ${topKeys} / 형태: ${hint})`);
      } else {
        setStatus(`완료: ${rawItems.length}건 로드 (동기화조건 적용: ${SYNC_SCOPE_TEXT})`);
      }
    } catch (e) {
      console.error(e);
      setStatus(`오류: ${e.message || e}`);
    } finally {
      if (els.btnSync) els.btnSync.disabled = false;
    }
  }

  // ====== Filtering / Render / Editor / Export ======
  function applyFilter() {
    const work = loadWork();

    const sido = els.fSido?.value?.trim() || "";
    const sigungu = els.fSigungu?.value?.trim() || "";
    const minP = els.fMinPrice?.value ? Number(els.fMinPrice.value) : null;
    const maxP = els.fMaxPrice?.value ? Number(els.fMaxPrice.value) : null;
    const maxRatio = els.fMaxRatio?.value ? Number(els.fMaxRatio.value) : null;
    const minFail = els.fMinFail?.value ? Number(els.fMinFail.value) : null;
    const endBefore = els.fEndBefore?.value?.trim() || "";
    const keyword = ""; // UI 고정표시는 유지, 실제 필터링은 재산유형 고정조건으로 대체
    const assigneeFilter = (els.fAssignee?.value || "").trim();
    const bidResultFilter = (els.fBidResult?.value || "").trim();
    const pvctTrgtFilter = (els.fPvctTrgtYn?.value || "").trim().toUpperCase();

    filteredItems = rawItems.filter((it) => {
      if (sido && !it.lctnSdnm.includes(sido)) return false;
      if (sigungu && !it.lctnSggnm.includes(sigungu)) return false;

      if (minP !== null) {
        const v = it.lowstBidAmt;
        if (v === null) return false;
        if (v < minP) return false;
      }
      if (maxP !== null) {
        const v = it.lowstBidAmt;
        if (v === null) return false;
        if (v > maxP) return false;
      }
      if (maxRatio !== null) {
        const r = it.apslPrcCtrsLowstBidRto;
        if (r === null || r === undefined) return false;
        if (r > maxRatio) return false;
      }
      if (minFail !== null) {
        const f = it.usbdNft ?? 0;
        if (f < minFail) return false;
      }
      if (endBefore) {
        if (it.cltrBidEndDt && it.cltrBidEndDt > endBefore) return false;
      }
      if (keyword) {
        const nm = it.onbidCltrNm.toLowerCase();
        if (!nm.includes(keyword)) return false;
      }

      if (assigneeFilter) {
        const k = buildKey(it);
        const w = work[k];
        if (!w?.assignee || w.assignee !== assigneeFilter) return false;
      }

      if (bidResultFilter) {
        const t = it.bidCloseFilterType || getBidEndFilterValue(it);
        if (t !== bidResultFilter) return false;
      }

      if (pvctTrgtFilter) {
        const pv = String(it.pvctTrgtYn || "").trim().toUpperCase();
        if (pv !== pvctTrgtFilter) return false;
      }

      return true;
    });

    renderTable();
  }

  function clearFilter() {
    [els.fSido, els.fSigungu, els.fMinPrice, els.fMaxPrice, els.fMaxRatio, els.fMinFail, els.fEndBefore, els.fAssignee, els.fBidResult, els.fPvctTrgtYn]
      .filter(Boolean)
      .forEach((el) => (el.value = ""));
    lockKeywordFilterControl();
    applyFilter();
  }

  function badgeForStatus(status) {
    const s = (status || "미배정").trim();
    if (s === "완료") return `<span class="badge ok">완료</span>`;
    if (s === "진행중") return `<span class="badge warn">진행중</span>`;
    if (s === "보류") return `<span class="badge danger">보류</span>`;
    if (s === "검토중") return `<span class="badge warn">검토중</span>`;
    return `<span class="badge">${escapeHtml(s || "미배정")}</span>`;
  }

  function renderTable() {
    const work = loadWork();
    if (els.countPill) els.countPill.textContent = `${filteredItems.length}건`;

    if (!els.tbody) return;

    if (!filteredItems.length) {
      els.tbody.innerHTML = `<tr><td class="muted" colspan="16">조건에 맞는 물건이 없어.</td></tr>`;
      return;
    }

    els.tbody.innerHTML = filteredItems
      .map((it) => {
        const key = buildKey(it);
        const w = work[key] || {};
        const addr = [it.lctnSdnm, it.lctnSggnm, it.lctnEmdNm].filter(Boolean).join(" ");
        const ratioText = formatPct(it.apslPrcCtrsLowstBidRto);

        const rightsNotesRaw = (w.rightsNotes ?? w.notes ?? "").trim();
        const siteNotesRaw = (w.siteNotes ?? "").trim();
        const rightsText = renderFeedbackCheck(rightsNotesRaw, "권리분석");
        const siteText = renderFeedbackCheck(siteNotesRaw, "현장조사");

        const onbidUrl = buildOnbidLink(it);
        const keyLabel = `${escapeHtml(it.cltrMngNo || "")}`;

        return `
        <tr data-key="${escapeHtml(key)}">
          <td>${escapeHtml(w.assignee || "") || `<span class="muted">-</span>`}</td>
          <td>${badgeForStatus(w.status || "미배정")}</td>
          <td>${rightsText}</td>
          <td>${siteText}</td>
          <td class="wrap-soft" title="${escapeHtml(it.onbidCltrNm)}">
            <div class="cell-title">${escapeHtml(it.onbidCltrNm)}</div>
            <div class="cell-sub">${escapeHtml([it.prptDivNm, it.dspsMthodNm, it.bidDivNm, it.pvctTrgtLabel].filter(Boolean).join(" · "))}</div>
          </td>
          <td class="wrap-soft">${escapeHtml(addr) || `<span class="muted">-</span>`}</td>
          <td class="num">${fmtNum(it.apslEvlAmt)}</td>
          <td class="num">${it.lowstBidAmt !== null ? fmtNum(it.lowstBidAmt) : escapeHtml(it.lowstBidPrcIndctCont)}</td>
          <td class="num">${escapeHtml(ratioText)}</td>
          <td class="num">${escapeHtml(formatAreaCell(it.bldAreaSqm))}</td>
          <td class="num">${fmtNum(it.usbdNft ?? 0)}</td>
          <td class="num">${escapeHtml(formatBidMethodDisplay(it))}</td>
          <td class="num">${escapeHtml(it.pbctStatNm || "-")}</td>
          <td>${escapeHtml(it.cltrBidEndDt || "-")}</td>
          <td class="wrap-soft">
            ${
              onbidUrl
                ? `<a class="onbid-link" href="${onbidUrl}" target="_blank" rel="noopener noreferrer" title="온비드 상세로 이동">${keyLabel}</a>`
                : `<button class="onbid-link disabled" type="button" data-copy="${escapeHtml(it.cltrMngNo || "")}" title="상세 링크 파라미터가 없어 복사만 가능">${keyLabel}</button>`
            }
          </td>
        </tr>
      `;
      })
      .join("");

    [...els.tbody.querySelectorAll("button.onbid-link.disabled")].forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const txt = btn.getAttribute("data-copy") || "";
        try {
          await navigator.clipboard.writeText(txt);
          setStatus(`복사됨: ${txt}`);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = txt;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          setStatus(`복사됨: ${txt}`);
        }
      });
    });

    [...els.tbody.querySelectorAll(".fb-check[data-note]")].forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const note = btn.getAttribute("data-note") || "";
        showFeedbackPopup(btn, note);
      });
    });

    [...els.tbody.querySelectorAll("tr[data-key]")].forEach((tr) => {
      tr.addEventListener("click", (e) => {
        const a = e.target?.closest?.("a");
        const b = e.target?.closest?.("button");
        if (a || b) return;
        const key = tr.getAttribute("data-key");
        selectItem(key);
      });
    });
  }

  function selectItem(key) {
    selectedKey = key;
    const it = filteredItems.find((x) => buildKey(x) === key) || rawItems.find((x) => buildKey(x) === key);
    if (!it || !els.editor) return;

    const work = loadWork();
    const w = work[key] || { assignee: "", status: "미배정", rightsNotes: "", siteNotes: "", notes: "" };
    const addr = [it.lctnSdnm, it.lctnSggnm, it.lctnEmdNm].filter(Boolean).join(" ");
    const ratioText = formatPct(it.apslPrcCtrsLowstBidRto);
    const onbidUrl = buildOnbidLink(it);

    els.editor.innerHTML = `
      <div class="panel">
        <h3>물건 정보</h3>
        <div class="kv">
          <div>물건명</div><div><b>${escapeHtml(it.onbidCltrNm)}</b></div>
          <div>소재지</div><div>${escapeHtml(addr) || "-"}</div>
          <div>감정가</div><div>${fmtNum(it.apslEvlAmt) || "-"}</div>
          <div>최저가</div><div>${it.lowstBidAmt !== null ? fmtNum(it.lowstBidAmt) : escapeHtml(it.lowstBidPrcIndctCont)}</div>
          <div>비율(%)</div><div>${escapeHtml(ratioText) || "-"}</div>
          <div>건물면적</div><div>${escapeHtml(formatAreaCell(it.bldAreaSqm))}</div>
          <div>유찰</div><div>${fmtNum(it.usbdNft ?? 0)}</div>
          <div>입찰방식</div><div>${escapeHtml(formatBidMethodDisplay(it))}</div>
          <div>입찰결과</div><div>${escapeHtml(it.pbctStatNm || "-")}</div>
          <div>수의계약가능여부</div><div>${escapeHtml(it.pvctTrgtLabel || "-")}</div>
          <div>재산유형</div><div>${escapeHtml([it.cltrUsgLclsCtgrNm, it.cltrUsgMclsCtgrNm, it.cltrUsgSclsCtgrNm].filter(Boolean).join(" > ")) || "-"}</div>
          <div>입찰기간</div><div>${escapeHtml(it.cltrBidBgngDt)} ~ ${escapeHtml(it.cltrBidEndDt)}</div>
          <div>온비드</div><div>${onbidUrl ? `<a class="onbid-link" href="${onbidUrl}" target="_blank" rel="noopener noreferrer">상세 바로가기</a>` : `<span class="muted">상세링크 불가</span>`}</div>
          <div>물건번호</div><div class="muted">${escapeHtml(it.cltrMngNo || "-")}</div>
        </div>

        <div style="margin-top:12px;" class="grid" style="grid-template-columns: 1fr 1fr;">
          <div class="field">
            <label>담당자</label>
            <input id="edAssignee" type="text" value="${escapeHtml(w.assignee || "")}" placeholder="예: 홍길동" />
          </div>
          <div class="field">
            <label>진행상태</label>
            <select id="edStatus">
              ${["미배정","검토중","진행중","완료","보류"].map((s) => `<option value="${s}" ${w.status===s?"selected":""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="bar" style="justify-content:flex-end; margin-top:10px;">
          <button id="btnSave" class="btn primary">저장</button>
        </div>
      </div>

      <div class="panel">
        <h3>권리분석 피드백</h3>
        <textarea id="edRightsNotes">${escapeHtml(w.rightsNotes ?? w.notes ?? "")}</textarea>
      </div>

      <div class="panel">
        <h3>현장조사 피드백</h3>
        <textarea id="edSiteNotes">${escapeHtml(w.siteNotes || "")}</textarea>
      </div>
    `;

    const btnSave = document.getElementById("btnSave");
    btnSave?.addEventListener("click", () => {
      const assignee = document.getElementById("edAssignee")?.value?.trim() || "";
      const status = document.getElementById("edStatus")?.value || "미배정";
      const rightsNotes = document.getElementById("edRightsNotes")?.value || "";
      const siteNotes = document.getElementById("edSiteNotes")?.value || "";

      const work2 = loadWork();
      // notes는 하위호환용(기존 피드백 컬럼/구버전 데이터 마이그레이션 대비)
      work2[key] = { assignee, status, rightsNotes, siteNotes, notes: rightsNotes, updatedAt: Date.now() };
      saveWork(work2);

      populateFilterSelectOptions({ preserveValues: true, only: ["assignee"] });
      applyFilter();
      setStatus("저장 완료");
    });
  }

  function exportExcel() {
    if (!window.XLSX) {
      alert("XLSX 라이브러리가 없어. (index.html에서 xlsx CDN 로드 확인)");
      return;
    }
    const work = loadWork();
    const rows = filteredItems.map((it) => {
      const key = buildKey(it);
      const w = work[key] || {};
      const addr = [it.lctnSdnm, it.lctnSggnm, it.lctnEmdNm].filter(Boolean).join(" ");
      return {
        "물건번호": it.cltrMngNo,
        onbidUrl: buildOnbidLink(it),

        물건명: it.onbidCltrNm,
        소재지: addr,
        감정가: it.apslEvlAmt ?? "",
        최저가: it.lowstBidAmt ?? it.lowstBidPrcIndctCont,
        비율: formatPct(it.apslPrcCtrsLowstBidRto),
        건물면적: formatAreaCell(it.bldAreaSqm),
        유찰: it.usbdNft ?? 0,
        입찰방식: formatBidMethodDisplay(it),
        입찰결과: it.pbctStatNm || "",
        수의계약가능여부: it.pvctTrgtLabel || "",
        재산유형: [it.cltrUsgLclsCtgrNm, it.cltrUsgMclsCtgrNm, it.cltrUsgSclsCtgrNm].filter(Boolean).join(" > "),
        입찰종료일: it.cltrBidEndDt,
        담당자: w.assignee || "",
        진행상태: w.status || "미배정",
        권리분석피드백: w.rightsNotes ?? w.notes ?? "",
        현장조사피드백: w.siteNotes || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "candidates");
    XLSX.writeFile(wb, `onbid_candidates_${Date.now()}.xlsx`);
  }

  function init() {
    if (els.apiBase) els.apiBase.value = normalizeApiBase(loadApiBase());

    applyWideLayoutPatch();
    patchCandidateTableHeader();
    initSelectableFilterControls();
    ensureSyncScopeHint();
    patchFilterAndSyncLayout();
    populateFilterSelectOptions({ preserveValues: true });

    els.btnSync?.addEventListener("click", sync);
    els.btnExport?.addEventListener("click", exportExcel);
    els.btnApplyFilter?.addEventListener("click", applyFilter);
    els.btnClearFilter?.addEventListener("click", clearFilter);
    els.btnResetLocal?.addEventListener("click", () => {
      if (!confirm("로컬 기록(담당/상태/피드백)을 초기화할까?")) return;
      localStorage.removeItem(LS_WORK);
      setStatus("로컬 기록 초기화 완료");
      applyFilter();
    });

    try {
      const cache = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
      if (cache?.items?.length) {
        rawItems = cache.items.map(normalize).filter(matchesSyncScope);
        lockKeywordFilterControl();
        populateFilterSelectOptions({ preserveValues: true });
        applyFilter();
        setStatus(`캐시 로드: ${rawItems.length}건`);
      }
    } catch {}
  }

  init();
})();
