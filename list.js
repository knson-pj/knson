(() => {
  "use strict";

  // ====== 문서 기반 기본값(부동산/매각/인터넷입찰) ======
  const DEFAULT_QUERY = {
    resultType: "json",
    prptDivCd: "0007,0010,0005,0002,0003,0006,0008,0011",
    dspsMthodCd: "0001",
    bidDivCd: "0001",
  };

  // ✅ GitHub Pages에서 바로 동작하게: 기본은 너 Vercel 프록시로
  const DEFAULT_API_BASE = "https://knson.vercel.app/api";

  // ====== localStorage keys ======
  const LS_API_BASE = "onbid_dash_api_base_v1";
  const LS_WORK = "onbid_dash_work_v1";
  const LS_CACHE = "onbid_dash_cache_v1";

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
    tbl: $("tbl"),
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
    els.statusText.textContent = msg;
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

  // ✅ 온비드 상세 정식 URL (사용자가 준 패턴)
  // https://www.onbid.co.kr/op/cta/cltrdtl/collateralRealEstateDetail.do?cltrHstrNo=...&cltrNo=...&plnmNo=...&pbctNo=...&scrnGrpCd=0001&pbctCdtnNo=...
  function buildOnbidLink(item) {
    const cltrHstrNo = safe(item?.cltrHstrNo);
    const cltrNo = safe(item?.cltrNo);
    const plnmNo = safe(item?.plnmNo);
    const pbctNo = safe(item?.pbctNo);
    const pbctCdtnNo = safe(item?.pbctCdtnNo);
    const cltrMngNo = safe(item?.cltrMngNo);

    const hasDetail =
      cltrHstrNo && cltrNo && plnmNo && pbctNo && pbctCdtnNo;

    if (hasDetail) {
      const scrnGrpCd = safe(item?.scrnGrpCd) || "0001";
      return (
        `https://www.onbid.co.kr/op/cta/cltrdtl/collateralRealEstateDetail.do` +
        `?cltrHstrNo=${encodeURIComponent(cltrHstrNo)}` +
        `&cltrNo=${encodeURIComponent(cltrNo)}` +
        `&plnmNo=${encodeURIComponent(plnmNo)}` +
        `&pbctNo=${encodeURIComponent(pbctNo)}` +
        `&scrnGrpCd=${encodeURIComponent(scrnGrpCd)}` +
        `&pbctCdtnNo=${encodeURIComponent(pbctCdtnNo)}`
      );
    }

    // 혹시 일부 물건에서 상세 파라미터가 누락될 때를 위한 안전 우회
    return `https://www.google.com/search?q=${encodeURIComponent(
      `site:onbid.co.kr ${cltrMngNo} ${pbctCdtnNo}`
    )}`;
  }

  // ====== API 응답 파싱 ======
  function extractItems(payload) {
    if (!payload) return [];

    let p = payload;

    if (p.response?.header) {
      const rc = p.response.header.resultCode;
      if (rc && rc !== "00") {
        const msg = p.response.header.resultMsg || "API Error";
        throw new Error(`${rc} ${msg}`.trim());
      }
    }

    let body = p.response?.body ?? p.body ?? p;

    // ✅ body가 문자열(JSON string)로 오는 케이스
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {}
    }

    const items =
      body?.items?.item ??
      body?.items ??
      body?.item ??
      body?.list ??
      null;

    return Array.isArray(items) ? items : items ? [items] : [];
  }

  // Normalize
  function normalize(it) {
    const appraised = toInt(it.apslEvlAmt);
    const minBid = toInt(it.lowstBidPrcIndctCont);

    const ratio = (() => {
      if (
        it.apslPrcCtrsLowstBidRto !== undefined &&
        it.apslPrcCtrsLowstBidRto !== null &&
        it.apslPrcCtrsLowstBidRto !== ""
      ) {
        const x = Number(it.apslPrcCtrsLowstBidRto);
        return Number.isFinite(x) ? x : appraised && minBid ? (minBid / appraised) * 100 : null;
      }
      return appraised && minBid ? (minBid / appraised) * 100 : null;
    })();

    return {
      // 목록 키
      cltrMngNo: safe(it.cltrMngNo),
      pbctCdtnNo: safe(it.pbctCdtnNo),

      // ✅ 상세 링크용 파라미터 (네가 확인한 필드들)
      cltrHstrNo: safe(it.cltrHstrNo),
      cltrNo: safe(it.cltrNo),
      plnmNo: safe(it.plnmNo),
      pbctNo: safe(it.pbctNo),
      scrnGrpCd: safe(it.scrnGrpCd),

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

      prptDivNm: safe(it.prptDivNm),
      dspsMthodNm: safe(it.dspsMthodNm),
      bidDivNm: safe(it.bidDivNm),

      thnlImgUrlAdr: safe(it.thnlImgUrlAdr),

      _raw: it,
    };
  }

  // ====== Fetch ======
  function buildApiFiltersFromUI() {
    const o = {};

    const minP = els.fMinPrice.value ? String(Math.max(0, Number(els.fMinPrice.value))) : "";
    const maxP = els.fMaxPrice.value ? String(Math.max(0, Number(els.fMaxPrice.value))) : "";
    if (minP) o.lowstBidPrcStart = minP;
    if (maxP) o.lowstBidPrcEnd = maxP;

    const minFail = els.fMinFail.value ? String(Math.max(0, Number(els.fMinFail.value))) : "";
    if (minFail) o.usbdNftStart = minFail;

    const sido = els.fSido.value.trim();
    const sigungu = els.fSigungu.value.trim();
    if (sido) o.lctnSdnm = sido;
    if (sigungu) o.lctnSggnm = sigungu;

    const keyword = els.fKeyword.value.trim();
    if (keyword) o.onbidCltrNm = keyword;

    const endBefore = els.fEndBefore.value.trim();
    if (endBefore && endBefore.length >= 8) {
      o.bidPrdYmdEnd = endBefore.slice(0, 8);
    }

    return o;
  }

  async function fetchPage(apiBase, pageNo, numOfRows) {
    const url = new URL(`${apiBase.replace(/\/$/, "")}/onbid/rlst-list`);

    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    Object.entries(DEFAULT_QUERY).forEach(([k, v]) => url.searchParams.set(k, v));

    const q = buildApiFiltersFromUI();
    Object.entries(q).forEach(([k, v]) => {
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        url.searchParams.set(k, String(v));
      }
    });

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`API error ${res.status} ${res.statusText} ${t}`.trim());
    }
    return res.json();
  }

  async function sync() {
    const apiBase = (els.apiBase.value.trim() || DEFAULT_API_BASE).replace(/\/$/, "");
    els.apiBase.value = apiBase;
    saveApiBase(apiBase);

    const numOfRows = Number(els.numOfRows.value || 50);
    const pageStart = Number(els.pageNo.value || 1);
    const maxPages = Number(els.maxPages.value || 3);

    setStatus("조회 중...");
    els.btnSync.disabled = true;

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
      localStorage.setItem(LS_CACHE, JSON.stringify({ ts: Date.now(), items: rawItems.map(x => x._raw) }));
      applyFilter();
      setStatus(`완료: ${rawItems.length}건 로드`);
    } catch (e) {
      console.error(e);
      setStatus(`오류: ${e.message || e}`);

      // 캐시라도 보여주기
      try {
        const cache = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
        if (cache?.items?.length) {
          rawItems = cache.items.map(normalize);
          applyFilter();
          setStatus(`오류로 캐시 표시: ${rawItems.length}건`);
        }
      } catch {}
    } finally {
      els.btnSync.disabled = false;
    }
  }

  // ====== Filtering ======
  function applyFilter() {
    const work = loadWork();

    const sido = els.fSido.value.trim();
    const sigungu = els.fSigungu.value.trim();
    const minP = els.fMinPrice.value ? Number(els.fMinPrice.value) : null;
    const maxP = els.fMaxPrice.value ? Number(els.fMaxPrice.value) : null;
    const maxRatio = els.fMaxRatio.value ? Number(els.fMaxRatio.value) : null;
    const minFail = els.fMinFail.value ? Number(els.fMinFail.value) : null;
    const endBefore = els.fEndBefore.value.trim();
    const keyword = els.fKeyword.value.trim().toLowerCase();
    const assigneeFilter = els.fAssignee.value.trim();

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
    [
      els.fSido, els.fSigungu, els.fMinPrice, els.fMaxPrice, els.fMaxRatio,
      els.fMinFail, els.fEndBefore, els.fKeyword, els.fAssignee
    ].forEach(el => el.value = "");
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
    els.countPill.textContent = `${filteredItems.length}건`;

    if (!filteredItems.length) {
      els.tbody.innerHTML = `<tr><td class="muted" colspan="11">조건에 맞는 물건이 없어.</td></tr>`;
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
          <td>${escapeHtml(it.cltrBidEndDt)}</td>
          <td class="wrap-soft">
            <a class="onbid-link" href="${onbidUrl}" target="_blank" rel="noopener noreferrer" title="온비드 상세로 이동">
              ${escapeHtml(it.cltrMngNo || "")}${it.pbctCdtnNo ? `<span class="muted">/${escapeHtml(it.pbctCdtnNo)}</span>` : ""}
            </a>
          </td>
        </tr>
      `;
    }).join("");

    // row click -> editor
    [...els.tbody.querySelectorAll("tr[data-key]")].forEach(tr => {
      tr.addEventListener("click", (e) => {
        // 링크 클릭은 row 선택 트리거 막기(링크는 링크대로 열리게)
        const a = e.target?.closest?.("a");
        if (a) return;

        const key = tr.getAttribute("data-key");
        selectItem(key);
      });
    });
  }

  // ====== Editor ======
  function selectItem(key) {
    selectedKey = key;
    const it = filteredItems.find(x => buildKey(x) === key) || rawItems.find(x => buildKey(x) === key);
    if (!it) return;

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
          <div>입찰기간</div><div>${escapeHtml(it.cltrBidBgngDt)} ~ ${escapeHtml(it.cltrBidEndDt)}</div>
          <div>공고기관</div><div>${escapeHtml(it.rqstOrgNm) || "-"}</div>
          <div>온비드</div><div><a class="onbid-link" href="${onbidUrl}" target="_blank" rel="noopener noreferrer">상세 바로가기</a></div>
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
          <button id="btnClearNotes" class="btn ghost">피드백 비우기</button>
        </div>
      </div>

      <div class="panel">
        <h3>권리분석/현장실사 피드백</h3>
        <textarea id="edNotes" placeholder="예)
- 권리분석: 선순위/임차인/말소기준 등 요약
- 현장실사: 접근성, 임대현황, 리스크, 사진 링크
- 결론: 매입/보류/제외 사유
">${escapeHtml(w.notes || "")}</textarea>
        <div class="help">현재는 브라우저에만 저장돼(서버 저장은 다음 단계에서 붙이면 됨).</div>
      </div>
    `;

    const btnSave = document.getElementById("btnSave");
    const btnClearNotes = document.getElementById("btnClearNotes");

    btnSave.addEventListener("click", () => {
      const assignee = document.getElementById("edAssignee").value.trim();
      const status = document.getElementById("edStatus").value;
      const notes = document.getElementById("edNotes").value;

      const work2 = loadWork();
      work2[key] = { assignee, status, notes, updatedAt: Date.now() };
      saveWork(work2);

      applyFilter();
      setStatus("저장 완료");
    });

    btnClearNotes.addEventListener("click", () => {
      document.getElementById("edNotes").value = "";
    });
  }

  // ====== Excel Export ======
  function exportExcel() {
    if (!window.XLSX) {
      alert("XLSX 라이브러리를 불러오지 못했어. 네트워크/정책을 확인해줘.");
      return;
    }

    const work = loadWork();
    const rows = filteredItems.map(it => {
      const key = buildKey(it);
      const w = work[key] || {};
      const addr = [it.lctnSdnm, it.lctnSggnm, it.lctnEmdNm].filter(Boolean).join(" ");
      const ratioText = formatPct(it.apslPrcCtrsLowstBidRto);

      return {
        key,
        cltrMngNo: it.cltrMngNo,
        pbctCdtnNo: it.pbctCdtnNo,
        cltrHstrNo: it.cltrHstrNo,
        cltrNo: it.cltrNo,
        plnmNo: it.plnmNo,
        pbctNo: it.pbctNo,

        물건명: it.onbidCltrNm,
        시도: it.lctnSdnm,
        시군구: it.lctnSggnm,
        읍면동: it.lctnEmdNm,
        소재지: addr,
        감정가: it.apslEvlAmt ?? "",
        최저가: it.lowstBidAmt ?? it.lowstBidPrcIndctCont,
        "비율(%)": ratioText,
        유찰: it.usbdNft ?? 0,
        입찰시작: it.cltrBidBgngDt,
        입찰종료: it.cltrBidEndDt,
        공고기관: it.rqstOrgNm,
        담당자: w.assignee || "",
        진행상태: w.status || "미배정",
        피드백: w.notes || "",
        업데이트: w.updatedAt ? new Date(w.updatedAt).toISOString() : ""
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "candidates");

    const stamp = new Date();
    const y = stamp.getFullYear();
    const m = String(stamp.getMonth() + 1).padStart(2, "0");
    const d = String(stamp.getDate()).padStart(2, "0");
    const hh = String(stamp.getHours()).padStart(2, "0");
    const mm = String(stamp.getMinutes()).padStart(2, "0");

    XLSX.writeFile(wb, `onbid_candidates_${y}${m}${d}_${hh}${mm}.xlsx`);
  }

  // ====== Init ======
  function init() {
    els.apiBase.value = loadApiBase().replace(/\/$/, "");

    els.btnSync.addEventListener("click", sync);
    els.btnExport.addEventListener("click", exportExcel);
    els.btnApplyFilter.addEventListener("click", applyFilter);
    els.btnClearFilter.addEventListener("click", clearFilter);
    els.btnResetLocal.addEventListener("click", () => {
      if (!confirm("로컬 기록(담당/상태/피드백)을 초기화할까?")) return;
      localStorage.removeItem(LS_WORK);
      setStatus("로컬 기록 초기화 완료");
      applyFilter();
    });

    // 캐시 로드
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
