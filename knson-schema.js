(() => {
  "use strict";

  const PROPERTY_COLUMNS = {
    id: "id",
    globalId: "global_id",
    itemNo: "item_no",
    sourceType: "source_type",
    sourceUrl: "source_url",
    isGeneral: "is_general",
    address: "address",
    assigneeId: "assignee_id",
    submitterType: "submitter_type",
    brokerOfficeName: "broker_office_name",
    submitterName: "submitter_name",
    submitterPhone: "submitter_phone",
    assetType: "asset_type",
    floor: "floor",
    totalFloor: "total_floor",
    commonArea: "common_area",
    exclusiveArea: "exclusive_area",
    siteArea: "site_area",
    useApproval: "use_approval",
    status: "status",
    priceMain: "price_main",
    currentPrice: "lowprice",
    dateMain: "date_main",
    rightsAnalysis: "rights_analysis",
    siteInspection: "site_inspection",
    memo: "memo",
    latitude: "latitude",
    longitude: "longitude",
    dateUploaded: "date_uploaded",
    createdAt: "created_at",
    raw: "raw",
    geocodeStatus: "geocode_status",
    geocodedAt: "geocoded_at",
  };

  const PROPERTY_SELECTS = {
    list: [
      PROPERTY_COLUMNS.id,
      PROPERTY_COLUMNS.globalId,
      PROPERTY_COLUMNS.itemNo,
      PROPERTY_COLUMNS.sourceType,
      PROPERTY_COLUMNS.sourceUrl,
      PROPERTY_COLUMNS.isGeneral,
      PROPERTY_COLUMNS.address,
      PROPERTY_COLUMNS.assigneeId,
      PROPERTY_COLUMNS.submitterType,
      PROPERTY_COLUMNS.brokerOfficeName,
      PROPERTY_COLUMNS.submitterName,
      PROPERTY_COLUMNS.submitterPhone,
      PROPERTY_COLUMNS.assetType,
      PROPERTY_COLUMNS.floor,
      PROPERTY_COLUMNS.totalFloor,
      PROPERTY_COLUMNS.commonArea,
      PROPERTY_COLUMNS.exclusiveArea,
      PROPERTY_COLUMNS.siteArea,
      PROPERTY_COLUMNS.useApproval,
      PROPERTY_COLUMNS.status,
      PROPERTY_COLUMNS.priceMain,
      PROPERTY_COLUMNS.currentPrice,
      PROPERTY_COLUMNS.dateMain,
      PROPERTY_COLUMNS.rightsAnalysis,
      PROPERTY_COLUMNS.siteInspection,
      PROPERTY_COLUMNS.memo,
      PROPERTY_COLUMNS.latitude,
      PROPERTY_COLUMNS.longitude,
      PROPERTY_COLUMNS.dateUploaded,
      PROPERTY_COLUMNS.createdAt,
      PROPERTY_COLUMNS.raw,
      PROPERTY_COLUMNS.geocodeStatus,
      PROPERTY_COLUMNS.geocodedAt,
    ].join(","),
    homeSummary: [
      PROPERTY_COLUMNS.id,
      PROPERTY_COLUMNS.sourceType,
      PROPERTY_COLUMNS.sourceUrl,
      PROPERTY_COLUMNS.isGeneral,
      PROPERTY_COLUMNS.submitterType,
      PROPERTY_COLUMNS.submitterName,
      PROPERTY_COLUMNS.brokerOfficeName,
      PROPERTY_COLUMNS.address,
      PROPERTY_COLUMNS.latitude,
      PROPERTY_COLUMNS.longitude,
      PROPERTY_COLUMNS.geocodeStatus,
      PROPERTY_COLUMNS.exclusiveArea,
      PROPERTY_COLUMNS.dateUploaded,
      PROPERTY_COLUMNS.createdAt,
      PROPERTY_COLUMNS.raw,
    ].join(","),
    overviewRealtor: [
      PROPERTY_COLUMNS.sourceType,
      PROPERTY_COLUMNS.sourceUrl,
      PROPERTY_COLUMNS.submitterType,
      PROPERTY_COLUMNS.submitterName,
      PROPERTY_COLUMNS.brokerOfficeName,
      PROPERTY_COLUMNS.isGeneral,
    ].join(","),
    detail: "*",
  };

  const PROPERTY_ORDERS = {
    list: PROPERTY_COLUMNS.dateUploaded,
    detailFallback: PROPERTY_COLUMNS.id,
    fallbackChain: [PROPERTY_COLUMNS.dateUploaded, PROPERTY_COLUMNS.createdAt, PROPERTY_COLUMNS.id],
  };

  function getPropertySelect(name, fallback = "") {
    const key = String(name || "").trim();
    if (key && Object.prototype.hasOwnProperty.call(PROPERTY_SELECTS, key)) return PROPERTY_SELECTS[key];
    return String(fallback || "").trim();
  }

  function getPropertyOrder(name, fallback = PROPERTY_ORDERS.list) {
    const key = String(name || "").trim();
    if (key && Object.prototype.hasOwnProperty.call(PROPERTY_ORDERS, key)) return PROPERTY_ORDERS[key];
    return String(fallback || PROPERTY_ORDERS.list).trim();
  }

  window.KNSN_SCHEMA = {
    PROPERTY_COLUMNS,
    PROPERTY_SELECTS,
    PROPERTY_ORDERS,
    getPropertySelect,
    getPropertyOrder,
  };
})();
