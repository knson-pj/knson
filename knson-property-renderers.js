(() => {
  "use strict";

  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;

  function truncateDisplayText(value, maxLength) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    const limit = Number(maxLength || 0);
    if (!text) return "";
    if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
    if (limit <= 1) return text.slice(0, limit);
    return `${text.slice(0, limit - 1)}…`;
  }

  function getFloorDisplayValue(item) {
    const raw = item?._raw && typeof item._raw === "object" ? item._raw : {};
    const floor = String(item?.floor ?? item?.floorText ?? raw.floor ?? raw.floorText ?? "").trim();
    const total = String(item?.totalfloor ?? item?.total_floor ?? raw.totalfloor ?? raw.total_floor ?? raw.totalFloor ?? "").trim();
    if (floor && total) {
      if (floor.includes("/")) return floor;
      return `${floor}/${total}`;
    }
    return floor || total || "";
  }

  function isPlainSourceFilterSelected(value) {
    const key = String(value || "").trim();
    return key === "realtor_naver" || key === "realtor_direct" || key === "general";
  }

  function getCurrentPriceValue(row) {
    if (!row || typeof row !== "object") return 0;
    const low = row.lowprice ?? row.lowPrice ?? row?._raw?.lowprice ?? row?._raw?.low_price;
    if (low === null || low === undefined || low === "") {
      const base = Number(row?.priceMain ?? row?.price_main ?? 0) || 0;
      return base;
    }
    return Number(low || 0) || 0;
  }

  function getRatioValue(row) {
    const base = Number(row?.priceMain ?? row?.price_main ?? 0);
    const current = Number(getCurrentPriceValue(row) || 0);
    if (Number.isFinite(base) && Number.isFinite(current) && base > 0 && current > 0) return current / base;
    const raw = row?._raw || row?.raw || {};
    const rawRate = raw && (raw["최저입찰가율(%)"] || raw.bidRate || raw.rate);
    const numeric = Number(String(rawRate || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(numeric) ? numeric / 100 : -1;
  }

  function getSourceBucket(item) {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === "function") return PropertyDomain.getSourceBucket(item);
    return "general";
  }

  function getSourceBucketLabel(bucket) {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucketLabel === "function") return PropertyDomain.getSourceBucketLabel(bucket);
    const key = String(bucket || "").trim();
    if (key === "auction") return "경매";
    if (key === "onbid") return "공매";
    if (key === "realtor_naver") return "네이버중개";
    if (key === "realtor_direct") return "일반중개";
    return "일반";
  }

  function parseFlexibleDate(value) {
    if (Shared && typeof Shared.parseFlexibleDate === "function") return Shared.parseFlexibleDate(value);
    if (!value) return null;
    const direct = new Date(String(value).trim());
    return Number.isNaN(direct.getTime()) ? null : direct;
  }

  function formatDateValue(value, fallback = "") {
    const text = Shared && typeof Shared.formatDate === "function" ? Shared.formatDate(value) : String(value || "").trim();
    return text || fallback;
  }

  function computeDdayLabel(value) {
    const target = parseFlexibleDate(value);
    if (!target) return "";
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const normalizedTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const diffDays = Math.round((normalizedTarget.getTime() - startToday.getTime()) / 86400000);
    if (diffDays == 0) return "D-Day";
    return diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
  }

  function formatScheduleCountdown(value, fallback = "-") {
    const dateText = formatDateValue(value, "");
    if (!dateText) return fallback;
    const dday = computeDdayLabel(value);
    return dday ? `${dateText} (${dday})` : dateText;
  }

  function escapeHtml(value) {
    if (Shared && typeof Shared.escapeHtml === "function") return Shared.escapeHtml(value);
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }


  function escapeAttr(value) {
    if (Shared && typeof Shared.escapeAttr === "function") return Shared.escapeAttr(value);
    return escapeHtml(value).replaceAll("`", "&#96;");
  }

  function sourceLabel(value, fallback = "일반") {
    const key = String(value || "").trim().toLowerCase();
    if (key === "auction") return "경매";
    if (key === "gongmae" || key === "onbid") return "공매";
    if (key === "realtor" || key === "realtor_naver" || key === "realtor_direct") return key === "realtor_naver" ? "네이버중개" : key === "realtor_direct" ? "일반중개" : "중개";
    if (key === "general") return "일반";
    return fallback;
  }

  function statusLabel(value, fallback = "-") {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return fallback;
    if (["active", "진행", "진행중", "진행중인"].includes(key)) return "진행중";
    if (["hold", "보류"].includes(key)) return "보류";
    if (["closed", "종결", "완료"].includes(key)) return "종결";
    if (["review", "검토", "검토중"].includes(key)) return "검토중";
    return String(value || fallback);
  }

  function formatPercent(base, current, raw = null, fallback = "-") {
    const b = Number(base || 0);
    const c = Number(current || 0);
    if (Number.isFinite(b) && Number.isFinite(c) && b > 0 && c > 0) return `${((c / b) * 100).toFixed(1)}%`;
    const rawRate = raw && (raw["최저입찰가율(%)"] || raw.bidRate || raw.rate);
    if (rawRate != null && String(rawRate).trim() !== "") return String(rawRate).trim();
    return fallback;
  }

  function toNullableNumber(value) {
    if (Shared && typeof Shared.toNullableNumber === "function") return Shared.toNullableNumber(value);
    if (value == null || value === "") return null;
    const num = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  function firstText(...values) {
    if (PropertyDomain && typeof PropertyDomain.pickFirstText === "function") return PropertyDomain.pickFirstText(...values);
    for (const value of values) {
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  }

  function buildKakaoMapLink(item, options = {}) {
    if (item?.latitude == null || item?.longitude == null) return "";
    const fallbackLabel = options.fallbackLabel || "매물 위치";
    const label = encodeURIComponent(firstText(item?.address, item?.assetType, item?.type, fallbackLabel));
    return `https://map.kakao.com/link/map/${label},${item.latitude},${item.longitude}`;
  }

  function normalizePhone(value) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  function formatPhoneDisplay(value) {
    const numeric = normalizePhone(value);
    if (numeric.length === 11) return `${numeric.slice(0,3)}-${numeric.slice(3,7)}-${numeric.slice(7)}`;
    if (numeric.length === 10) return `${numeric.slice(0,3)}-${numeric.slice(3,6)}-${numeric.slice(6)}`;
    return numeric;
  }

  function formatScheduleHtml(item, options = {}) {
    const raw = item?._raw?.raw && typeof item._raw.raw === 'object' ? item._raw.raw : (item?._raw || item?.raw || {});
    const keys = Array.isArray(options.rawKeys) && options.rawKeys.length ? options.rawKeys : ["입찰일자", "입찰마감일시"];
    let rawValue = item?.dateMain || item?.bidDate || item?.date_main || "";
    if (!rawValue) {
      for (const key of keys) {
        if (raw && raw[key]) { rawValue = raw[key]; break; }
      }
    }
    const dateText = formatDateValue(rawValue, "-");
    const dday = computeDdayLabel(rawValue);
    return `<span class="schedule-stack"><span class="schedule-date">${escapeHtml(dateText)}</span>${dday ? `<span class="schedule-dday">${escapeHtml(dday)}</span>` : `<span class="schedule-dday schedule-dday-empty"></span>`}</span>`;
  }

  function formatMoneyEok(value, fallback = "-") {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    const eok = num / 100000000;
    const fixed = eok.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return `${fixed} 억원`;
  }

  function formatMoneyKRW(value, fallback = "-") {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return fallback;
    return `${num.toLocaleString("ko-KR")}원`;
  }

  function formatAreaPyeong(value, fallback = "-") {
    if (value == null || value === "") return fallback;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function getSourceBucketClass(bucket) {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucketClass === "function") return PropertyDomain.getSourceBucketClass(bucket);
    const key = String(bucket || "").trim();
    if (key === "auction") return "kind-auction";
    if (key === "onbid") return "kind-gongmae";
    if (key === "realtor_naver") return "kind-realtor-naver";
    if (key === "realtor_direct") return "kind-realtor-direct";
    return "kind-general";
  }

  window.KNSN_PROPERTY_RENDERERS = {
    truncateDisplayText,
    getFloorDisplayValue,
    isPlainSourceFilterSelected,
    getCurrentPriceValue,
    getRatioValue,
    getSourceBucket,
    getSourceBucketLabel,
    getSourceBucketClass,
    parseFlexibleDate,
    formatDateValue,
    computeDdayLabel,
    formatScheduleCountdown,
    formatScheduleHtml,
    formatMoneyEok,
    formatMoneyKRW,
    formatAreaPyeong,
    sourceLabel,
    statusLabel,
    formatPercent,
    toNullableNumber,
    firstText,
    buildKakaoMapLink,
    normalizePhone,
    formatPhoneDisplay,
    escapeHtml,
    escapeAttr,
  };
})();
