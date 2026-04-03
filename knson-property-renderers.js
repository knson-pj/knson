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
  };
})();
