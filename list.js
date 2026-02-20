/* list.js
 * - 키 클릭 시: 온비드 상세페이지로 이동 (가능할 때만)
 * - 비율(%): 소수점 제거 + % 붙임
 * - 입찰방식(일반/제한/지명/수의) 전체 조회 기본값 적용
 * - 입찰결과(pbctStatNm) 컬럼 표시
 */

(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // ====== 유틸 ======
  const nf = new Intl.NumberFormat("ko-KR");

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return nf.format(n);
  }

  function fmtRatioPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return `${Math.round(n)}%`;
  }

  function safe(v) {
    return (v === null || v === undefined || v === "") ? "" : String(v);
  }

  function copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
    } catch (_) {}
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  // ====== 온비드 상세 링크 생성 ======
  // 네가 준 정상 URL 패턴에 맞춰 구성
  function buildOnbidDetailUrl(it) {
    const cltrHstrNo = safe(it.cltrHstrNo);
    const cltrNo = safe(it.cltrNo);
    const plnmNo = safe(it.plnmNo);
    const pbctNo = safe(it.pbctNo);
    const pbctCdtnNo = safe(it.pbctCdtnNo);

    // 상세페이지 필수 파라미터 4종이 없으면 "링크 생성 불가"
    if (!cltrHstrNo || !cltrNo || !plnmNo || !pbctNo) return "";

    const params = new URLSearchParams();
    params.set("cltrHstrNo", cltrHstrNo);
    params.set("cltrNo", cltrNo);
    params.set("plnmNo", plnmNo);
    params.set("pbctNo", pbctNo);
    params.set("scrnGrpCd", "0001"); // 부동산 상세 그룹(사이트에서 쓰는 값)
    if (pbctCdtnNo) params.set("pbctCdtnNo", pbctCdtnNo);

    return `https://www.onbid.co.kr/op/cta/cltrdtl/collateralRealEstateDetail.do?${params.toString()}`;
  }

  function getApiBase() {
    // 기존 UI 입력이 있으면 거기 값 사용, 없으면 기본
    const el = $("#apiBase");
    const v = el ? el.value.trim() : "";
    return v || "https://knson.vercel.app";
  }

  function buildApiUrl() {
    const base = getApiBase().replace(/\/+$/, "");
    const url = new URL(`${base}/api/onbid/rlst-list`);

    // 기존 폼 값들을 가능한 범위에서 유지 (없으면 기본값)
    const pageNo = Number($("#pageNo")?.value || 1);
    const numOfRows = Number($("#numOfRows")?.value || 100);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    url.searchParams.set("resultType", "json");

    // ★ 핵심: 입찰방식코드 (기본: 전체)
    // 0001 일반경쟁 / 0002 제한경쟁 / 0003 지명경쟁 / 0004 수의계약 :contentReference[oaicite:2]{index=2}
    const cptnInput = $("#cptnMthodCd")?.value?.trim(); // 혹시 너 폼에 추가돼있으면 그걸 우선
    url.searchParams.set("cptnMthodCd", cptnInput || "0001,0002,0003,0004");

    // 너가 기존에 쓰던 필터들(있으면 유지)
    const prptDivCd = $("#prptDivCd")?.value?.trim();
    const dspsMthodCd = $("#dspsMthodCd")?.value?.trim();
    const bidDivCd = $("#bidDivCd")?.value?.trim();

    if (prptDivCd) url.searchParams.set("prptDivCd", prptDivCd);
    if (dspsMthodCd) url.searchParams.set("dspsMthodCd", dspsMthodCd);
    if (bidDivCd) url.searchParams.set("bidDivCd", bidDivCd);

    // 날짜/금액/유찰 등 기타 필터 (폼에 있으면 자동 반영)
    const passthroughIds = [
      "bidPrdYmdStart", "bidPrdYmdEnd",
      "apslEvlAmtStart", "apslEvlAmtEnd",
      "usbdNftStart", "usbdNftEnd",
      "onbidCltrNm"
    ];
    for (const id of passthroughIds) {
      const val = $("#"+id)?.value?.trim();
      if (val) url.searchParams.set(id, val);
    }

    return url.toString();
  }

  // ====== 렌더 ======
  function ensureColumnsHeader() {
    // 헤더를 JS로 그리는 구조면 여기에서 맞춰줌
    const theadTr = $("#candidatesTable thead tr");
    if (!theadTr) return;

    // 기존 헤더를 교체 (가독성: 물건명/소재지 넓게)
    theadTr.innerHTML = `
      <th class="col-owner">담당</th>
      <th class="col-status">상태</th>
      <th class="col-feedback">피드백</th>
      <th class="col-title">물건명</th>
      <th class="col-addr">소재지</th>
      <th class="col-money">감정가</th>
      <th class="col-money">최저가</th>
      <th class="col-ratio">비율</th>
      <th class="col-small">유찰</th>
      <th class="col-small">입찰방식</th>
      <th class="col-small">입찰결과</th>
      <th class="col-date">입찰종료</th>
      <th class="col-key">키</th>
    `;
  }

  function renderRows(items) {
    const tbody = $("#candidatesTable tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    for (const raw of items) {
      const it = raw || {};
      const ratio = fmtRatioPct(it.bidPrceRto || it.bidPrceRatio || it.ratio); // 너 기존 필드명 흔들림 대비
      const detailUrl = buildOnbidDetailUrl(it);

      const keyText = safe(it.cltrMngNo) && safe(it.pbctCdtnNo)
        ? `${safe(it.cltrMngNo)}/${safe(it.pbctCdtnNo)}`
        : (safe(it.cltrMngNo) || safe(it.pbctCdtnNo) || "-");

      const bidEnd = safe(it.bidEndDt) || safe(it.bidPrdEndDtm) || safe(it.bidPrdEnd) || "-";
      const bidMethod = safe(it.cptnMthodNm) || safe(it.cptnMthodCd) || "-";
      const bidResult = safe(it.pbctStatNm) || safe(it.pbctStatCd) || "-"; // 입찰결과(낙찰/유찰/진행중 등) :contentReference[oaicite:3]{index=3}

      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td class="col-owner">-</td>
        <td class="col-status"><span class="chip chip-muted">미배정</span></td>
        <td class="col-feedback">-</td>

        <td class="col-title">
          <div class="title-main">${safe(it.onbidCltrNm) || "-"}</div>
          <div class="title-sub">${safe(it.prptDivNm) ? `${safe(it.prptDivNm)} · ` : ""}${safe(it.dspsMthodNm) || ""}${safe(it.bidDivNm) ? ` · ${safe(it.bidDivNm)}` : ""}</div>
        </td>

        <td class="col-addr">
          <div class="addr-main">${safe(it.ctpvNm) ? `${safe(it.ctpvNm)} ` : ""}${safe(it.sggNm) ? `${safe(it.sggNm)} ` : ""}${safe(it.emdNm) ? `${safe(it.emdNm)}` : ""}</div>
          <div class="addr-sub">${safe(it.onbidCltrLctnAddr) || ""}</div>
        </td>

        <td class="col-money">${fmtMoney(it.apslEvlAmt)}</td>
        <td class="col-money">${fmtMoney(it.minBidPrc)}</td>
        <td class="col-ratio">${ratio}</td>
        <td class="col-small">${safe(it.usbdNft) || safe(it.usbdCnt) || "-"}</td>
        <td class="col-small">${bidMethod}</td>
        <td class="col-small">${bidResult}</td>
        <td class="col-date">${bidEnd}</td>

        <td class="col-key">
          ${
            detailUrl
              ? `<a class="key-link" href="${detailUrl}" target="_blank" rel="noopener noreferrer">${keyText}</a>`
              : `<button class="key-link key-link-disabled" type="button" data-copy="${keyText}" title="상세 페이지 파라미터 부족(키 복사만 가능)">${keyText}</button>`
          }
        </td>
      `;

      tbody.appendChild(tr);
    }

    // 링크 생성 불가한 항목은 "키 복사"로 동작
    $$(".key-link-disabled", tbody).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const txt = btn.getAttribute("data-copy") || "";
        await copyToClipboard(txt);
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 900);
      });
    });
  }

  function renderCount(totalCount) {
    const el = $("#candidateCount");
    if (!el) return;
    const n = Number(totalCount);
    el.textContent = Number.isFinite(n) ? `${nf.format(n)}건` : "-";
  }

  async function fetchList() {
    const url = buildApiUrl();

    const statusEl = $("#statusText");
    if (statusEl) statusEl.textContent = "조회 중...";

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`API 오류: ${res.status}`);

    const data = await res.json();

    const body = data?.response?.body || data?.body || data;
    const itemsObj = body?.items || body?.item || {};
    const arr = Array.isArray(itemsObj?.item) ? itemsObj.item
             : Array.isArray(itemsObj) ? itemsObj
             : itemsObj ? [itemsObj] : [];

    renderCount(body?.totalCount ?? arr.length);
    ensureColumnsHeader();
    renderRows(arr);

    if (statusEl) statusEl.textContent = "완료";
  }

  function bind() {
    // 기존 버튼 id가 다를 수 있어서 “가장 흔한” 케이스를 다 걸어둠
    const btn =
      $("#btnSearch") ||
      $("#searchBtn") ||
      $("button[data-action='search']") ||
      $("#btnFetch");

    if (btn) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        fetchList().catch((err) => {
          const statusEl = $("#statusText");
          if (statusEl) statusEl.textContent = `에러: ${err.message}`;
          console.error(err);
        });
      });
    }

    // 페이지 로드시 자동조회 옵션이 있으면 실행
    const auto = $("#autoSearchOnLoad");
    if (auto && auto.checked) {
      fetchList().catch(console.error);
    }
  }

  // start
  document.addEventListener("DOMContentLoaded", bind);
})();
