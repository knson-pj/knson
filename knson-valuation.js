/**
 * knson-valuation.js
 * Phase 4 — 가격평가 프론트엔드 모듈
 *
 * index.html에 <script src="./knson-valuation.js"></script> 추가하여 사용
 * app.js의 normalizeItem, renderMapSidebar 등에서 호출
 */
(() => {
  "use strict";

  const K = window.KNSN || null;

  // ── 등급 정의 ──
  const GRADE_CONFIG = {
    A: { label: "A", desc: "즉시 매입 추천", color: "#17C964", bg: "#E7F8EE", text: "#085041" },
    B: { label: "B", desc: "양호", color: "#59A7FF", bg: "#E7F2FF", text: "#0C447C" },
    C: { label: "C", desc: "보통", color: "#F6B04A", bg: "#FFF1DD", text: "#633806" },
    D: { label: "D", desc: "미흡", color: "#E87040", bg: "#FFF0E8", text: "#712B13" },
    E: { label: "E", desc: "비추천", color: "#E24B4A", bg: "#FCEBEB", text: "#791F1F" },
  };

  const GRADE_MAP_COLORS = {
    A: "#17C964",
    B: "#59A7FF",
    C: "#F6B04A",
    D: "#E87040",
    E: "#E24B4A",
  };

  // ── 캐시 ──
  const valuationCache = new Map();

  // ── API 호출 ──

  function getApiBase() {
    return (K && typeof K.getApiBase === "function") ? K.getApiBase() : "https://knson.vercel.app/api";
  }

  function getAuthToken() {
    try {
      const raw = sessionStorage.getItem("knson_bms_session_v1");
      const s = raw ? JSON.parse(raw) : null;
      return s?.token || "";
    } catch { return ""; }
  }

  async function fetchValuation(propertyId) {
    if (valuationCache.has(propertyId)) return valuationCache.get(propertyId);

    try {
      const token = getAuthToken();
      const res = await fetch(
        `${getApiBase()}/admin/valuation/evaluate?propertyId=${encodeURIComponent(propertyId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const result = data?.results?.[0] || null;
      if (result) valuationCache.set(propertyId, result);
      return result;
    } catch { return null; }
  }

  async function requestEvaluation(propertyId) {
    try {
      const token = getAuthToken();
      const res = await fetch(`${getApiBase()}/admin/valuation/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ propertyId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const result = data?.result || null;
      if (result && result.grade) {
        valuationCache.set(propertyId, result);
      }
      return result;
    } catch { return null; }
  }

  // ── UI 렌더링 ──

  /**
   * 등급 배지 HTML 생성
   * @param {object|null} valuation - valuation_results row
   * @returns {string} HTML string
   */
  function renderGradeBadge(valuation) {
    if (!valuation || !valuation.grade) {
      return '<span class="val-badge val-badge--none" title="평가 대기">—</span>';
    }

    const g = GRADE_CONFIG[valuation.grade] || GRADE_CONFIG.C;
    const yieldText = valuation.annual_yield != null
      ? `수익률 ${valuation.annual_yield.toFixed(1)}%`
      : "";
    const typeLabel = valuation.valuation_type === "auction" ? "경매" : "수익률";

    return (
      '<span class="val-badge" ' +
      'style="background:' + g.bg + ";color:" + g.text + ";border:1px solid " + g.color + ';" ' +
      'title="' + escapeAttr(typeLabel + " " + g.desc + (yieldText ? " · " + yieldText : "")) + '">' +
      g.label +
      (yieldText ? '<small style="margin-left:3px;opacity:0.8;font-size:0.85em">' + yieldText + "</small>" : "") +
      "</span>"
    );
  }

  /**
   * 비교사례 상세 팝업 HTML
   */
  function renderValuationDetail(valuation) {
    if (!valuation) return '<div class="val-detail-empty">평가 데이터 없음</div>';

    const g = GRADE_CONFIG[valuation.grade] || GRADE_CONFIG.C;
    const detail = valuation.detail || {};
    const isAuction = valuation.valuation_type === "auction";

    let html = '<div class="val-detail">';
    html += '<div class="val-detail-grade" style="background:' + g.bg + ";color:" + g.text + ";border-left:4px solid " + g.color + '">';
    html += '<strong style="font-size:1.3em">' + g.label + " 등급</strong>";
    html += '<span style="margin-left:8px">' + g.desc + "</span>";
    html += "</div>";

    if (isAuction) {
      html += '<div class="val-detail-row"><span>감정가</span><strong>' + formatMoney(valuation.appraisal_price) + "</strong></div>";
      html += '<div class="val-detail-row"><span>현재가(최저가)</span><strong>' + formatMoney(valuation.sale_price) + "</strong></div>";
      html += '<div class="val-detail-row"><span>낙찰가율</span><strong>' + (valuation.bid_ratio || 0).toFixed(1) + "%</strong></div>";
      if (valuation.market_ratio != null) {
        html += '<div class="val-detail-row"><span>시세 대비</span><strong>' + valuation.market_ratio.toFixed(1) + "%</strong></div>";
      }
    }

    if (valuation.est_monthly_rent != null) {
      html += '<div class="val-detail-row"><span>추정 월세</span><strong>' + formatMoney(valuation.est_monthly_rent) + "</strong></div>";
    }
    if (valuation.est_deposit != null) {
      html += '<div class="val-detail-row"><span>추정 보증금</span><strong>' + formatMoney(valuation.est_deposit) + "</strong></div>";
    }
    if (valuation.annual_yield != null) {
      html += '<div class="val-detail-row"><span>연 임대수익률</span><strong style="color:' + g.color + '">' + valuation.annual_yield.toFixed(2) + "%</strong></div>";
    }
    if (valuation.avg_area_yield != null) {
      html += '<div class="val-detail-row"><span>주변 평균 수익률</span><strong>' + valuation.avg_area_yield.toFixed(2) + "%</strong></div>";
    }
    html += '<div class="val-detail-row val-detail-row--sub"><span>비교사례</span><span>거래 ' + (valuation.comparable_count || 0) + "건";
    if (valuation.rental_comp_ids) html += " / 임대 " + valuation.rental_comp_ids.length + "건";
    html += "</span></div>";

    html += '<div class="val-detail-formula">';
    html += isAuction
      ? "① 감정가 대비 낙찰가율 + ② 주변 시세 대비 현재가 + ③ 임대수익률 종합"
      : "연 임대수익률 = (월세×12) ÷ (매매가−보증금) × 100%";
    html += "</div>";

    html += "</div>";
    return html;
  }

  /**
   * 지도 마커 색상 — 평가 등급 기준
   */
  function getGradeMarkerColor(grade) {
    return GRADE_MAP_COLORS[grade] || "#888";
  }

  // ── 유틸 ──

  function formatMoney(manwon) {
    if (manwon == null) return "-";
    const v = Number(manwon);
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, "") + "억";
    return v.toLocaleString() + "만";
  }

  function escapeAttr(str) {
    return String(str || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // ── CSS 삽입 ──

  function injectStyles() {
    if (document.getElementById("knson-valuation-styles")) return;
    const style = document.createElement("style");
    style.id = "knson-valuation-styles";
    style.textContent = [
      ".val-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap;line-height:1.4}",
      ".val-badge--none{background:var(--color-background-secondary,#f5f5f5);color:var(--color-text-tertiary,#999);font-weight:400}",
      ".val-detail{padding:12px 0;font-size:13px}",
      ".val-detail-grade{padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:14px}",
      ".val-detail-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(0,0,0,0.06)}",
      ".val-detail-row span{opacity:0.7}",
      ".val-detail-row strong{font-weight:600}",
      ".val-detail-row--sub{opacity:0.6;font-size:12px;border-bottom:none}",
      ".val-detail-formula{margin-top:8px;padding:8px 10px;background:rgba(0,0,0,0.03);border-radius:6px;font-size:11px;opacity:0.6;line-height:1.5}",
      ".val-detail-empty{color:var(--color-text-tertiary,#999);font-size:13px;padding:12px 0}",
      ".val-toggle{display:inline-flex;gap:2px;background:rgba(0,0,0,0.06);border-radius:6px;padding:2px}",
      ".val-toggle button{padding:4px 10px;border:none;background:transparent;border-radius:5px;font-size:12px;cursor:pointer;color:inherit}",
      ".val-toggle button.is-active{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.1)}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ── 지도 색상 토글 ──

  let mapColorMode = "source"; // "source" | "grade"

  function renderMapColorToggle() {
    return (
      '<div class="val-toggle" id="valMapToggle">' +
      '<button type="button" class="' + (mapColorMode === "source" ? "is-active" : "") + '" data-mode="source">구분별</button>' +
      '<button type="button" class="' + (mapColorMode === "grade" ? "is-active" : "") + '" data-mode="grade">평가별</button>' +
      "</div>"
    );
  }

  function getMapColorMode() {
    return mapColorMode;
  }

  function setMapColorMode(mode) {
    mapColorMode = mode;
  }

  // ── 초기화 ──

  function init() {
    injectStyles();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ── Export ──

  window.KNSN_VALUATION = {
    GRADE_CONFIG,
    GRADE_MAP_COLORS,
    fetchValuation,
    requestEvaluation,
    renderGradeBadge,
    renderValuationDetail,
    renderMapColorToggle,
    getGradeMarkerColor,
    getMapColorMode,
    setMapColorMode,
    formatMoney,
    valuationCache,
  };
})();
