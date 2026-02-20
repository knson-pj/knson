(() => {
  "use strict";

  /**
   * 내부 구조
   * - 원천 데이터: 온비드 목록 API(사내 프록시를 통해 호출)
   * - 관리 데이터(배정/상태/피드백): localStorage
   *
   * 다음 단계(권장):
   * - localStorage → 사내 DB 저장(API)으로 교체
   */

  // ====== 문서 기반 기본값(부동산/매각/인터넷입찰) ======
  // prptDivCd: 재산유형코드 (복수 가능)
  // dspsMthodCd: 0001(매각)
  // bidDivCd: 0001(인터넷)
  // resultType: json
  const DEFAULT_QUERY = {
    resultType: "json",
    prptDivCd: "0007,0010,0005,0002,0003,0006,0008,0011",
    dspsMthodCd: "0001",
    bidDivCd: "0001",
  };

  // ====== 사내 프록시 기본값 ======
  // 프론트에서 /api/onbid/list 형태로 호출한다고 가정
  // (서버에서 data.go.kr로 중계)
  const DEFAULT_API_BASE = "/api";

  // ====== localStorage keys ======
  const LS_API_BASE = "onbid_dash_api_base_v1";
  const LS_WORK = "onbid_dash_work_v1"; // { "<key>": {assignee,status,notes,updatedAt} }
  const LS_CACHE = "onbid_dash_cache_v1"; // last fetched list (optional)

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
  let rawItems = [];      // normalized items from API
  let filteredItems = []; // after filters
  let selectedKey = null; // cltrMngNo|pbctCdtnNo

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
    try { return JSON.parse(localStorage.getItem(LS_WORK) || "{}"); }
    catch { return {}; }
  };

  const saveWork = (work) => localStorage.setItem(LS_WORK, JSON.stringify(work));

  const loadApiBase = () => localStorage.getItem(LS_API_BASE) || DEFAULT_API_BASE;
  const saveApiBase = (v) => localStorage.setItem(LS_API_BASE, v);

  const setStatus = (msg) => { els.statusText.textContent = msg; };

  // Convert API response to list array
  // API 응답 구조는 프록시 서버에서 "items 배열만" 내려주게 만들면 가장 편함.
  // 그래도 혹시 몰라 몇 가지 케이스를 흡수함.
  function extractItems(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) return payload.items;

    // data.go.kr 스타일 (문서엔 resultCode/resultMsg/pageNo/totalCount 등 + 목록)로 안내됨
    // 실응답이 {response:{body:{items:[...]}}} 형태일 수 있어 fallback
    const r = payload.response || payload;
    const body = r.body || r;
    const items = body.items || body.item || body.list || null;
    if (Array.isArray(items)) return items;
    if (items && Array.isArray(items.item)) return items.item;
    return [];
  }

  // Normalize fields based on docx spec:
  // cltrMngNo, pbctCdtnNo, onbidCltrNm, lctnSdnm, lctnSggnm, apslEvlAmt, lowstBidPrcIndctCont, apslPrcCtrsLowstBidRto, usbdNft, cltrBidEndDt ...
  function normalize(it) {
    const appraised = toInt(it.apslEvlAmt);
    // lowstBidPrcIndctCont may be number string or "비공개" etc
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
      onbidCltrNm: safe(it.onbidCltrNm),
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
      rqstOrgNm: safe(it.rqstOrgNm),
      prptDivNm: safe(it.prptDivNm),
      dspsMthodNm: safe(it.dspsMthodNm),
      bidDivNm: safe(it.bidDivNm),
      thnlImgUrlAdr: safe(it.thnlImgUrlAdr),
      _raw: it,
    };
  }

  // ====== Fetch ======
  async function fetchPage(apiBase, pageNo, numOfRows) {
    // 프론트 → 사내 프록시
    // 프록시가 받는 쿼리는 그대로 data.go.kr에 전달하면 됨.
    // 예: GET {apiBase}/onbid/rlst-list?serviceKey=...&pageNo=1&numOfRows=50...
    // 단, serviceKey는 프론트에 노출하면 안 되므로 반드시 서버에서 주입하도록 설계!
    const url = new URL(`${apiBase.replace(/\/$/, "")}/onbid/rlst-list`, window.location.origin);

    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    Object.entries(DEFAULT_QUERY).forEach(([k, v]) => url.searchParams.set(k, v));

    // 추가 검색 조건들(선택): 문서상 옵션 파라미터
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

  function buildApiFiltersFromUI() {
    // API 검색용 파라미터(옵션) - 문서 기준 명칭 사용
    // 여기서는 대표적인 것들만 연결해둠.
    const o = {};

    // 가격/면적/입찰기간/유찰횟수 등은 API에 직접 필터 가능
    const minP = els.fMinPrice.value ? String(Math.max(0, Number(els.fMinPrice.value))) : "";
    const maxP = els.fMaxPrice.value ? String(Math.max(0, Number(els.fMaxPrice.value))) : "";
    if (minP) o.lowstBidPrcStart = minP;
    if (maxP) o.lowstBidPrcEnd = maxP;

    const minFail = els.fMinFail.value ? String(Math.max(0, Number(els.fMinFail.value))) : "";
    if (minFail) o.usbdNftStart = minFail;

    // 지역/키워드는 API에 옵션이 있을 수도 있지만(문서에 lctnSdnm 등 '요청 명세'가 있음) 0(옵션)이라서 전달 가능
    const sido = els.fSido.value.trim();
    const sigungu = els.fSigungu.value.trim();
    if (sido) o.lctnSdnm = sido;
    if (sigungu) o.lctnSggnm = sigungu;

    const keyword = els.fKeyword.value.trim();
    if (keyword) o.onbidCltrNm = keyword;

    // 종료일 전(프론트 필터로도 가능하지만 API 옵션에 bidPrdYmdStart/End가 있어 날짜(yyyyMMdd)만 받음)
    // 여기서는 사용자가 YYYYMMDDHHmm을 넣더라도 API에는 yyyyMMdd만 넣도록 처리(앞 8자리)
    const endBefore = els.fEndBefore.value.trim();
    if (endBefore && endBefore.length >= 8) {
      // bidPrdYmdEnd: 검색할 입찰기간 종료일자(yyyyMMdd)
      o.bidPrdYmdEnd = endBefore.slice(0, 8);
    }

    return o;
  }

  async function sync() {
    const apiBase = els.apiBase.value.trim() || DEFAULT_API_BASE;
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
        // 비교: 문자열이 YYYYMMDDHHmm 형태라고 가정
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

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
      const ratio = it.apslPrcCtrsLowstBidRto;
      const ratioText = (ratio === null || ratio === undefined) ? "" : ratio.toFixed(2);

      const notesPreview = (w.notes || "").trim().slice(0, 24);
      const notesText = notesPreview ? escapeHtml(notesPreview) + (w.notes.length > 24 ? "…" : "") : `<span class="muted">-</span>`;

      return `
        <tr data-key="${escapeHtml(key)}" class="${key === selectedKey ? "selected" : ""}">
          <td>${escapeHtml(w.assignee || "") || `<span class="muted">-</span>`}</td>
          <td>${badgeForStatus(w.status || "미배정")}</td>
          <td>${notesText}</td>
          <td>
            <div style="font-weight:800;">${escapeHtml(it.onbidCltrNm)}</div>
            <div class="muted" style="font-size:12px;margin-top:2px;">
              ${escapeHtml([it.prptDivNm, it.dspsMthodNm, it.bidDivNm].filter(Boolean).join(" · "))}
            </div>
          </td>
          <td>${escapeHtml(addr) || `<span class="muted">-</span>`}</td>
          <td class="num">${fmtNum(it.apslEvlAmt)}</td>
          <td class="num">${it.lowstBidAmt !== null ? fmtNum(it.lowstBidAmt) : escapeHtml(it.lowstBidPrcIndctCont)}</td>
          <td class="num">${ratioText}</td>
          <td class="num">${fmtNum(it.usbdNft ?? 0)}</td>
          <td>${escapeHtml(it.cltrBidEndDt)}</td>
          <td class="muted">${escapeHtml(key)}</td>
        </tr>
      `;
    }).join("");

    // row click handler
    [...els.tbody.querySelectorAll("tr[data-key]")].forEach(tr => {
      tr.addEventListener("click", () => {
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

    renderTable();

    const work = loadWork();
    const w = work[key] || { assignee: "", status: "미배정", notes: "" };
    const addr = [it.lctnSdnm, it.lctnSggnm, it.lctnEmdNm].filter(Boolean).join(" ");
    const ratio = it.apslPrcCtrsLowstBidRto;
    const ratioText = (ratio === null || ratio === undefined) ? "" : ratio.toFixed(2);

    els.editor.innerHTML = `
      <div class="panel">
        <h3>물건 정보</h3>
        <div class="kv">
          <div>물건명</div><div><b>${escapeHtml(it.onbidCltrNm)}</b></div>
          <div>소재지</div><div>${escapeHtml(addr) || "-"}</div>
          <div>감정가</div><div>${fmtNum(it.apslEvlAmt) || "-"}</div>
          <div>최저가</div><div>${it.lowstBidAmt !== null ? fmtNum(it.lowstBidAmt) : escapeHtml(it.lowstBidPrcIndctCont)}</div>
          <div>비율(%)</div><div>${ratioText || "-"}</div>
          <div>유찰</div><div>${fmtNum(it.usbdNft ?? 0)}</div>
          <div>입찰기간</div><div>${escapeHtml(it.cltrBidBgngDt)} ~ ${escapeHtml(it.cltrBidEndDt)}</div>
          <div>공고기관</div><div>${escapeHtml(it.rqstOrgNm) || "-"}</div>
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
        <div class="help">현재는 브라우저에만 저장돼(내부 서버 저장은 다음 단계에서 붙이면 됨).</div>
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

      applyFilter(); // reflect filters
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
      const ratio = it.apslPrcCtrsLowstBidRto;
      const ratioText = (ratio === null || ratio === undefined) ? "" : ratio.toFixed(2);

      return {
        key,
        cltrMngNo: it.cltrMngNo,
        pbctCdtnNo: it.pbctCdtnNo,
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
    const m = String(stamp.getMonth()+1).padStart(2,"0");
    const d = String(stamp.getDate()).padStart(2,"0");
    const hh = String(stamp.getHours()).padStart(2,"0");
    const mm = String(stamp.getMinutes()).padStart(2,"0");

    XLSX.writeFile(wb, `onbid_candidates_${y}${m}${d}_${hh}${mm}.xlsx`);
  }

  // ====== Init ======
  function init() {
    els.apiBase.value = loadApiBase();

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

    // try load cache
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