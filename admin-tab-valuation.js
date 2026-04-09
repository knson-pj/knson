/**
 * admin-tab-valuation.js
 * Phase 5 — 관리자 페이지 평가 관리 탭
 *
 * admin-index.html에 탭으로 추가하여 사용:
 *   - 국토부 데이터 일괄 수집 (시군구/기간 지정)
 *   - 네이버 임대 호가 수집
 *   - 매물 일괄 평가 실행
 *   - 평가 결과 조회/로그
 */
(() => {
  "use strict";

  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function")
    ? window.KNSN.getApiBase()
    : "https://knson.vercel.app/api";

  function getAuthToken() {
    try {
      const raw = sessionStorage.getItem("knson_bms_session_v1");
      const s = raw ? JSON.parse(raw) : null;
      return s?.token || "";
    } catch { return ""; }
  }

  function authHeaders() {
    const token = getAuthToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  // ── 탭 HTML ──

  function renderValuationTab() {
    return `
      <div class="admin-valuation-tab" style="padding:20px">

        <!-- 1. 실거래 데이터 수집 -->
        <div class="admin-section" style="margin-bottom:28px">
          <h3 style="font-size:16px;font-weight:600;margin-bottom:12px">📊 국토부 실거래 데이터 수집</h3>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              시군구코드 (5자리)
              <input id="valSigunguCode" type="text" placeholder="예: 11680" maxlength="5"
                style="padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;width:120px" />
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              시작 년월
              <input id="valStartYm" type="text" placeholder="202401" maxlength="6"
                style="padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;width:100px" />
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              종료 년월
              <input id="valEndYm" type="text" placeholder="202503" maxlength="6"
                style="padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;width:100px" />
            </label>
            <button id="btnFetchMolit" type="button"
              style="padding:7px 16px;background:#534AB7;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">
              수집 시작
            </button>
          </div>
          <div id="valMolitLog" style="margin-top:10px;font-size:12px;color:#666;max-height:200px;overflow-y:auto"></div>
        </div>

        <!-- 2. 네이버 임대 호가 수집 -->
        <div class="admin-section" style="margin-bottom:28px">
          <h3 style="font-size:16px;font-weight:600;margin-bottom:12px">🏪 네이버 상가 임대 호가 수집</h3>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              법정동코드 (10자리)
              <input id="valCortarNo" type="text" placeholder="예: 1168010600" maxlength="10"
                style="padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;width:150px" />
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              페이지 수
              <input id="valRentalPages" type="number" value="5" min="1" max="20"
                style="padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;width:70px" />
            </label>
            <button id="btnFetchRental" type="button"
              style="padding:7px 16px;background:#0FA68B;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">
              수집 시작
            </button>
          </div>
          <div id="valRentalLog" style="margin-top:10px;font-size:12px;color:#666"></div>
        </div>

        <!-- 3. 매물 일괄 평가 -->
        <div class="admin-section" style="margin-bottom:28px">
          <h3 style="font-size:16px;font-weight:600;margin-bottom:12px">⚡ 매물 일괄 평가 실행</h3>
          <div style="display:flex;gap:10px;align-items:end">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              대상
              <select id="valEvalTarget"
                style="padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px">
                <option value="active">진행중 매물 전체</option>
                <option value="unevaluated">미평가 매물만</option>
              </select>
            </label>
            <button id="btnRunEval" type="button"
              style="padding:7px 16px;background:#D85A30;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">
              평가 실행
            </button>
          </div>
          <div id="valEvalLog" style="margin-top:10px;font-size:12px;color:#666;max-height:300px;overflow-y:auto"></div>
        </div>

        <!-- 4. 평가 결과 요약 -->
        <div class="admin-section">
          <h3 style="font-size:16px;font-weight:600;margin-bottom:12px">📋 평가 결과 요약</h3>
          <div id="valResultSummary" style="font-size:13px;color:#666">로딩 중...</div>
        </div>

      </div>
    `;
  }

  // ── 이벤트 핸들러 ──

  async function handleFetchMolit() {
    const sigunguCode = document.getElementById("valSigunguCode")?.value?.trim();
    const startYm = document.getElementById("valStartYm")?.value?.trim();
    const endYm = document.getElementById("valEndYm")?.value?.trim();
    const logEl = document.getElementById("valMolitLog");
    if (!sigunguCode || !startYm || !endYm) {
      logEl.textContent = "⚠️ 시군구코드, 시작/종료 년월을 모두 입력하세요.";
      return;
    }

    // 년월 범위 생성
    const yms = [];
    let y = parseInt(startYm.substring(0, 4), 10);
    let m = parseInt(startYm.substring(4, 6), 10);
    const ey = parseInt(endYm.substring(0, 4), 10);
    const em = parseInt(endYm.substring(4, 6), 10);
    while (y < ey || (y === ey && m <= em)) {
      yms.push(String(y) + String(m).padStart(2, "0"));
      m++;
      if (m > 12) { m = 1; y++; }
    }

    logEl.innerHTML = `<strong>${yms.length}개월 수집 시작...</strong><br>`;

    let totalFetched = 0;
    for (const ym of yms) {
      try {
        const res = await fetch(`${API_BASE}/admin/valuation/market-data`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ sigunguCode, dealYm: ym }),
        });
        const data = await res.json();
        totalFetched += data.fetched || 0;
        logEl.innerHTML += `✅ ${ym}: ${data.fetched || 0}건 수집<br>`;
      } catch (err) {
        logEl.innerHTML += `❌ ${ym}: ${err.message}<br>`;
      }
    }
    logEl.innerHTML += `<br><strong>완료! 총 ${totalFetched}건</strong>`;
  }

  async function handleFetchRental() {
    const cortarNo = document.getElementById("valCortarNo")?.value?.trim();
    const pages = parseInt(document.getElementById("valRentalPages")?.value || "5", 10);
    const logEl = document.getElementById("valRentalLog");
    if (!cortarNo) { logEl.textContent = "⚠️ 법정동코드를 입력하세요."; return; }

    logEl.textContent = "수집 중...";
    try {
      const res = await fetch(`${API_BASE}/admin/valuation/rental-data`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ cortarNo, pages }),
      });
      const data = await res.json();
      logEl.textContent = `✅ 완료: ${data.fetched || 0}건 수집, ${data.inserted || 0}건 저장`;
    } catch (err) {
      logEl.textContent = `❌ 오류: ${err.message}`;
    }
  }

  async function handleRunEval() {
    const target = document.getElementById("valEvalTarget")?.value || "active";
    const logEl = document.getElementById("valEvalLog");
    logEl.innerHTML = "<strong>매물 목록 조회 중...</strong><br>";

    // TODO: 실제로는 properties 목록을 조회하여 ID 추출
    // 여기서는 간단히 시연용 구현
    logEl.innerHTML += "⚠️ 매물 ID 목록은 properties 탭에서 선택하거나, " +
      "API를 통해 자동 추출됩니다.<br>" +
      "개별 매물 상세에서 [평가 실행] 버튼을 사용해주세요.";
  }

  async function loadResultSummary() {
    const el = document.getElementById("valResultSummary");
    if (!el) return;

    try {
      // 등급별 건수 (간단 조회)
      const grades = ["A", "B", "C", "D", "E"];
      let html = '<div style="display:flex;gap:12px;flex-wrap:wrap">';
      for (const g of grades) {
        const cfg = window.KNSN_VALUATION?.GRADE_CONFIG?.[g] || { label: g, color: "#888", bg: "#f5f5f5", text: "#333", desc: "" };
        html += '<div style="padding:12px 18px;border-radius:8px;background:' + cfg.bg +
          ";border:1px solid " + cfg.color + ";min-width:80px;text-align:center\">" +
          '<div style="font-size:20px;font-weight:700;color:' + cfg.text + '">' + cfg.label + "</div>" +
          '<div style="font-size:11px;color:' + cfg.text + ";opacity:0.7\">" + cfg.desc + "</div>" +
          "</div>";
      }
      html += "</div>";
      html += '<p style="margin-top:12px;font-size:12px;opacity:0.6">' +
        "건수는 평가 실행 후 표시됩니다. 국토부 데이터와 네이버 임대 호가를 먼저 수집하세요.</p>";
      el.innerHTML = html;
    } catch {
      el.textContent = "요약을 불러올 수 없습니다.";
    }
  }

  // ── 탭 초기화 (admin에서 호출) ──

  function initValuationTab(containerEl) {
    if (!containerEl) return;
    containerEl.innerHTML = renderValuationTab();

    document.getElementById("btnFetchMolit")?.addEventListener("click", handleFetchMolit);
    document.getElementById("btnFetchRental")?.addEventListener("click", handleFetchRental);
    document.getElementById("btnRunEval")?.addEventListener("click", handleRunEval);

    loadResultSummary();
  }

  // ── Export ──

  window.KNSN_VALUATION_ADMIN = {
    initValuationTab,
    renderValuationTab,
  };
})();
