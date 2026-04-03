(() => {
  "use strict";

  const PROPERTY_LIST_COLUMNS = [
    "id", "global_id", "item_no", "source_type", "source_url", "is_general", "address", "assignee_id",
    "submitter_type", "broker_office_name", "submitter_name", "submitter_phone",
    "asset_type", "floor", "total_floor", "common_area", "exclusive_area", "site_area", "use_approval",
    "status", "price_main", "lowprice", "date_main", "rights_analysis", "site_inspection",
    "memo", "latitude", "longitude", "date_uploaded", "created_at", "raw",
    "geocode_status", "geocoded_at"
  ];

  const PROPERTY_HOME_SUMMARY_COLUMNS = [
    "id", "source_type", "source_url", "is_general", "submitter_type", "submitter_name",
    "broker_office_name", "address", "latitude", "longitude", "geocode_status",
    "exclusive_area", "date_uploaded", "created_at"
  ];

  const DEFAULT_SORT = {
    propertyList: "id",
    propertyPage: "date_uploaded",
  };

  function joinColumns(columns) {
    return (Array.isArray(columns) ? columns : [])
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(",");
  }

  window.KNSN_SCHEMA = {
    PROPERTY_LIST_COLUMNS,
    PROPERTY_LIST_SELECT: joinColumns(PROPERTY_LIST_COLUMNS),
    PROPERTY_HOME_SUMMARY_COLUMNS,
    PROPERTY_HOME_SUMMARY_SELECT: joinColumns(PROPERTY_HOME_SUMMARY_COLUMNS),
    DEFAULT_SORT,
    joinColumns,
  };
})();
