(() => {
  "use strict";

  // ====== 기본 검색 파라미터 ======
  // - cptnMthodCd: 0001 일반경쟁 / 0002 제한경쟁 / 0003 지명경쟁 / 0004 수의계약
  const DEFAULT_QUERY = {
    resultType: "json",
    // 부동산유형/처분방식/입찰구분은 너가 기존에 쓰던 값 유지(없으면 이 기본값으로)
    prptDivCd: "0007,0010,0005,0002,0003,0006,0008,0011",
    dspsMthodCd: "0001",
    bidDivCd: "0001",
    // ✅ 전체 방식 기본(수의 포함)
    cptnMthodCd: "0001,0002,0003,0004",
  };

  // ✅ 기본 API_BASE: 너의 Vercel 프록시
  const DEFAULT_API_BASE = "https://knson.vercel.app/api";

  // ====== localStorage keys ======
  const LS_API_BASE = "onbid_dash_api_base_v1";
  const LS_WORK = "onbid_dash_work_v1";
  // ✅ 캐시 포맷 꼬임 방지 (링크 필드 누락/구버전 혼재 방지)
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

  // ✅ 비율: 소수점 제거 + % 붙이기
  function formatPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return `${Math.round(n)}%`;
  }

  // ✅ 온비드 상세 정식 URL (네가 준 패턴)
  // https://www.onbid.co.kr/op/cta/cltrdtl/collateralRealEstateDetail.do?cltrHstrNo=...&cltrNo=...&plnmNo=...&pbctNo=...&scrnGrpCd=0001&pbctCdtnNo=...
  function buildOnbidLink(item) {
    const cltrHstrNo = safe(item?.cltrHstrNo);
    const cltrNo = safe(item?.cltrNo);
    const plnmNo = safe(item?.plnmNo);
    const pbctNo = safe(item?.pbctNo);
    const pbctCdtnNo = safe(item?.pbctCdtnNo);

    const hasDetail = cltrHstrNo && cltrNo && plnmNo && pbctNo;

    if (!hasDetail) return ""; // ✅ 링크 생성 불가

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
  function extractItems(payload) {
    if (!payload) return [];
    let p = payload;

    // 공공데이터 표준 wrapper
    if (p.response?.header) {
      const rc = p.response.header.resultCode;
      if (rc && rc !== "00") {
        const msg = p.response.header.resultMsg || "API Error";
        throw new Error(`${rc} ${msg}`.trim());
      }
    }

    let body = p.response?.body ?? p.body ?? p;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {}
    }

    const items = body?.items?.item ?? body?.items ?? body?.item ?? body?.list ?? null;
    return Array.isArray(items) ? items : items ? [items] : [];
  }

  // Normalize
  function normalize(it) {
    const appraised = toInt(it.apslEvlAmt);
    const minBid = toInt(it.lowstBidPrcIndctCont);

    const ratio = (() => {
      if (it.apslPrcCtrsLowstBidRto !== undefined && it.apslPrcCtrsLowstBidRto !== null && it.apslPrcCtrsLowstBidRto !== "") {
        const x = Number(it.apslPrcCtrsLowstBidRto);
        return Number.isFinite(x) ? x : (appraised && minBid ? (minBid / appraised) * 100 : null);
      }
      return appraised && minBid ? (minBid / appraised) * 100 : null;
    })();

    return {
      cltrMngNo: safe(it.cltrMngNo),
      pbctCdtnNo: safe(it.pbctCdtnNo),

      // ✅ 상세 URL용
      cltrHstrNo: safe(it.cltrHstrNo),
      cltrNo: safe(it.cltrNo),
      plnmNo: safe(it.plnmNo),
      pbctNo: safe(it.pbctNo),

      // 표기
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

      // ✅ 입찰방식/결과
      cptnMthodNm: safe(it.cptnMthodNm),
      pbctStatNm: safe(it.pbctStatNm),

      prptDivNm: safe(it.prptDivNm),
      dspsMthodNm: safe(it.dspsMthodNm),
      bidDivNm: safe(it.bidDivNm),

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

    const keyword = els.fKeyword?.value?.trim() || "";
    if (keyword) o.onbidCltrNm = keyword;

    const endBefore = els.fEndBefore?.value?.trim() || "";
    if (endBefore && endBefore.length >= 8) o.bidPrdYmdEnd = endBefore.slice(0, 8);

    return o;
  }

  async function fetchPage(apiBase, pageNo, numOfRows) {
    const url = new URL(`${apiBase.replace(/\/$/, "")}/onbid/rlst-list`);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));

    // 기본값 적용
    Object.entries(DEFAULT_QUERY).forEach(([k, v]) => url.searchParams.set(k, v));

    // UI 필터 적용
    const q = buildApiFiltersFromUI();
    Object.entries(q).forEach(([k, v]) => {
      if (v !== null && v !== undefined && String(v).trim() !== "") url.searchParams.set(k, String(v));
    });

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`API error ${res.status} ${res.statusText} ${t}`.trim());
    }
    return res.json();
  }

  async function sync() {
    const apiBase = (els.apiBase?.value?.trim() || DEFAULT_API_BASE).replace(/\/$/, "");
    if (els.apiBase) els.apiBase.value = apiBase;
    saveApiBase(apiBase);

    const numOfRows = Number(els.numOfRows?.value || 50);
    const pageStart = Number(els.pageNo?.value || 1);
    const maxPages = Number(els.maxPages?.value || 3);

    setStatus("조회 중...");
    if (els.btnSync) els.btnSync.disabled = true;

    try {
      const collected = [];
      for (let p = pageStart; p < pageStart + maxPages; p++) {
        setStatus(`조회 중... (page ${p})`);
        const payload = await fetchPage(apiBase, p, numOfRows);
        const items = extractItems(payload);
        if (!items.length) break;
        collected.push(...items);
      }

      rawItems = collected.map(normalize);

      // ✅ 캐시 저장(v3)
      localStorage.setItem(LS_CACHE, JSON.stringify({ ts: Date.now(), items: rawItems.map(x => x._raw) }));

      applyFilter();
      setStatus(`완료: ${rawItems.length}건 로드`);
    } catch (e) {
      console.error(e);
      setStatus(`오류: ${e.message || e}`);
    } finally {
      if (els.btnSync) els.btnSync.disabled = false;
    }
  }

  // ====== Filtering ======
  function applyFilter() {
    const work = loadWork();

    const sido = els.fSido?.value?.trim() || "";
    const sigungu = els.fSigungu?.value?.trim() || "";
    const minP = els.fMinPrice?.value ? Number(els.fMinPrice.value) : null;
    const maxP = els.fMaxPrice?.value ? Number(els.fMaxPrice.value) : null;
    const maxRatio = els.fMaxRatio?.value ? Number(els.fMaxRatio.value) : null;
    const minFail = els.fMinFail?.value ? Number(els.fMinFail.value) : null;
    const endBefore = els.fEndBefore?.value?.trim() || "";
    const keyword = (els.fKeyword?.value || "").trim().toLowerCase();
    const assigneeFilter = (els.fAssignee?.value || "").trim();

    filteredItems = rawItems.filter(it => {
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

      return true;
    });

    renderTable();
  }

  function clearFilter() {
    [els.fSido, els.fSigungu, els.fMinPrice, els.fMaxPrice, els.fMaxRatio, els.fMinFail, els.fEndBefore, els.fKeyword, els.fAssignee]
      .filter(Boolean)
      .forEach(el => (el.value = ""));
    applyFilter();
  }

  // ====== Render table ======
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
      els.tbody.innerHTML = `<tr><td class="muted" colspan="12">조건에 맞는 물건이 없어.</td></tr>`;
      return;
    }

    els.tbody.innerHTML = filteredItems.map(it => {
      const key = buildKey(it);
      const w = work[key] || {};
      const addr = [it.lctnSdnm, it.lctnSggnm, it.lctnEmdNm].filter(Boolean).join(" ");
      const ratioText = formatPct(it.apslPrcCtrsLowstBidRto);

      const notesPreview = (w.notes || "").trim().slice(0, 24);
      const notesText = notesPreview ? escapeHtml(notesPreview) + (w.notes.length > 24 ? "…" : "") : `<span class="muted">-</span>`;

      const onbidUrl = buildOnbidLink(it);
      const keyLabel = `${escapeHtml(it.cltrMngNo || "")}${it.pbctCdtnNo ? `<span class="muted">/${escapeHtml(it.pbctCdtnNo)}</span>` : ""}`;

      return `
        <tr data-key="${escapeHtml(key)}">
          <td>${escapeHtml(w.assignee || "") || `<span class="muted">-</span>`}</td>
          <td>${badgeForStatus(w.status || "미배정")}</td>
          <td>${notesText}</td>
          <td class="wrap-soft" title="${escapeHtml(it.onbidCltrNm)}">
            <div class="cell-title">${escapeHtml(it.onbidCltrNm)}</div>
            <div class="cell-sub">${escapeHtml([it.prptDivNm, it.dspsMthodNm, it.bidDivNm].filter(Boolean).join(" · "))}</div>
          </td>
          <td class="wrap-soft">${escapeHtml(addr) || `<span class="muted">-</span>`}</td>
          <td class="num">${fmtNum(it.apslEvlAmt)}</td>
          <td class="num">${it.lowstBidAmt !== null ? fmtNum(it.lowstBidAmt) : escapeHtml(it.lowstBidPrcIndctCont)}</td>
          <td class="num">${escapeHtml(ratioText)}</td>
          <td class="num">${fmtNum(it.usbdNft ?? 0)}</td>
          <td class="num">${escapeHtml(it.cptnMthodNm || "-")}</td>
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
    }).join("");

    // ✅ 링크 없는 항목: 키 복사
    [...els.tbody.querySelectorAll("button.onbid-link.disabled")].forEach(btn => {
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

    // row click -> editor (링크 클릭은 제외)
    [...els.tbody.querySelectorAll("tr[data-key]")].forEach(tr => {
      tr.addEventListener("click", (e) => {
        const a = e.target?.closest?.("a");
        const b = e.target?.closest?.("button");
        if (a || b) return;
        const key = tr.getAttribute("data-key");
        selectItem(key);
      });
    });
  }

  // ====== Editor (기존 유지) ======
  function selectItem(key) {
    selectedKey = key;
    const it = filteredItems.find(x => buildKey(x) === key) || rawItems.find(x => buildKey(x) === key);
    if (!it || !els.editor) return;

    const work = loadWork();
    const w = work[key] || { assignee: "", status: "미배정", notes: "" };
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
          <div>유찰</div><div>${fmtNum(it.usbdNft ?? 0)}</div>
          <div>입찰방식</div><div>${escapeHtml(it.cptnMthodNm || "-")}</div>
          <div>입찰결과</div><div>${escapeHtml(it.pbctStatNm || "-")}</div>
          <div>입찰기간</div><div>${escapeHtml(it.cltrBidBgngDt)} ~ ${escapeHtml(it.cltrBidEndDt)}</div>
          <div>온비드</div><div>${onbidUrl ? `<a class="onbid-link" href="${onbidUrl}" target="_blank" rel="noopener noreferrer">상세 바로가기</a>` : `<span class="muted">상세링크 불가</span>`}</div>
          <div>키</div><div class="muted">${escapeHtml(key)}</div>
        </div>

        <div style="margin-top:12px;" class="grid" style="grid-template-columns: 1fr 1fr;">
          <div class="field">
            <label>담당자</label>
            <input id="edAssignee" type="text" value="${escapeHtml(w.assignee || "")}" placeholder="예: 홍길동" />
          </div>
          <div class="field">
            <label>진행상태</label>
            <select id="edStatus">
              ${["미배정","검토중","진행중","완료","보류"].map(s => `<option value="${s}" ${w.status===s?"selected":""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="bar" style="justify-content:flex-end; margin-top:10px;">
          <button id="btnSave" class="btn primary">저장</button>
        </div>
      </div>

      <div class="panel">
        <h3>권리분석/현장실사 피드백</h3>
        <textarea id="edNotes">${escapeHtml(w.notes || "")}</textarea>
      </div>
    `;

    const btnSave = document.getElementById("btnSave");
    btnSave?.addEventListener("click", () => {
      const assignee = document.getElementById("edAssignee")?.value?.trim() || "";
      const status = document.getElementById("edStatus")?.value || "미배정";
      const notes = document.getElementById("edNotes")?.value || "";

      const work2 = loadWork();
      work2[key] = { assignee, status, notes, updatedAt: Date.now() };
      saveWork(work2);

      applyFilter();
      setStatus("저장 완료");
    });
  }

  // ====== Export (기존 유지: XLSX 있으면) ======
  function exportExcel() {
    if (!window.XLSX) {
      alert("XLSX 라이브러리가 없어. (index.html에서 xlsx CDN 로드 확인)");
      return;
    }
    const work = loadWork();
    const rows = filteredItems.map(it => {
      const key = buildKey(it);
      const w = work[key] || {};
      const addr = [it.lctnSdnm, it.lctnSggnm, it.lctnEmdNm].filter(Boolean).join(" ");
      return {
        key,
        cltrMngNo: it.cltrMngNo,
        pbctCdtnNo: it.pbctCdtnNo,
        cltrHstrNo: it.cltrHstrNo,
        cltrNo: it.cltrNo,
        plnmNo: it.plnmNo,
        pbctNo: it.pbctNo,
        onbidUrl: buildOnbidLink(it),

        물건명: it.onbidCltrNm,
        소재지: addr,
        감정가: it.apslEvlAmt ?? "",
        최저가: it.lowstBidAmt ?? it.lowstBidPrcIndctCont,
        비율: formatPct(it.apslPrcCtrsLowstBidRto),
        유찰: it.usbdNft ?? 0,
        입찰방식: it.cptnMthodNm || "",
        입찰결과: it.pbctStatNm || "",
        입찰종료: it.cltrBidEndDt,
        담당자: w.assignee || "",
        진행상태: w.status || "미배정",
        피드백: w.notes || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "candidates");
    XLSX.writeFile(wb, `onbid_candidates_${Date.now()}.xlsx`);
  }

  // ====== Init ======
  function init() {
    if (els.apiBase) els.apiBase.value = loadApiBase().replace(/\/$/, "");

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

    // ✅ 캐시 로드(v3)
    try {
      const cache = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
      if (cache?.items?.length) {
        rawItems = cache.items.map(normalize);
        applyFilter();
        setStatus(`캐시 로드: ${rawItems.length}건`);
      }
    } catch {}
  }

  init();
})();
