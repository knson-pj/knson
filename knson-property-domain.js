(function (root, factory) {
  "use strict";
  const domain = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = domain;
  }
  if (root && typeof root === "object") {
    root.KNSN_PROPERTY_DOMAIN = domain;
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this), function (root) {
  "use strict";

  const Shared = root && root.KNSN_SHARED ? root.KNSN_SHARED : null;

  const REGISTRATION_LOG_LABELS_BASE = Object.freeze({
    address: "주소",
    assetType: "세부유형",
    floor: "층수",
    totalfloor: "총층",
    commonArea: "공용면적",
    exclusiveArea: "전용면적",
    siteArea: "토지면적",
    useapproval: "사용승인일",
    priceMain: "매매가",
    realtorName: "중개사무소명",
    realtorPhone: "유선전화",
    realtorCell: "휴대폰번호",
    submitterName: "등록자명",
    submitterPhone: "등록자 연락처",
    memo: "메모/의견",
  });

  const REGISTRATION_LOG_LABELS_ADMIN = Object.freeze({ ...REGISTRATION_LOG_LABELS_BASE });
  const REGISTRATION_LOG_LABELS_AGENT = Object.freeze({ ...REGISTRATION_LOG_LABELS_BASE });
  const REGISTRATION_LOG_LABELS_PUBLIC = Object.freeze({ ...REGISTRATION_LOG_LABELS_BASE });

  const PROPERTY_DUPLICATE_INDEX_NAMES = Object.freeze([
    "uq_properties_global_id",
    "uq_properties_registration_identity_key",
    "uq_properties_registration_identity_key_v2_strict",
  ]);
  const PROPERTY_DUPLICATE_INDEX_NAME_SET = new Set(PROPERTY_DUPLICATE_INDEX_NAMES);

  function firstNonEmpty(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
    return "";
  }

  function toNullableNumber(value) {
    if (Shared && typeof Shared.toNullableNumber === "function") return Shared.toNullableNumber(value);
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value).replace(/,/g, "").trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function pickFirstText(...values) {
    return firstNonEmpty(...values);
  }

  function compactAddressText(value) {
    return String(value || "").trim().replace(/\s+/g, "");
  }

  function parseFloorNumberForLog(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    let match = text.match(/^(?:B|b|지하)\s*(\d+)$/);
    if (match) return `b${match[1]}`;
    match = text.match(/(-?\d+)/);
    return match ? String(Number(match[1])) : "";
  }

  function parseAddressIdentityParts(address) {
    const compact = compactAddressText(String(address || "").trim().replace(/\s+/g, " "));
    if (!compact) return { dong: "", mainNo: "", subNo: "" };

    const suffixSet = new Set(["동", "읍", "면", "리"]);
    let end = -1;
    for (let i = compact.length - 1; i >= 0; i -= 1) {
      if (suffixSet.has(compact[i])) {
        end = i;
        break;
      }
    }
    if (end < 0) return { dong: "", mainNo: "", subNo: "" };

    let start = 0;
    for (let i = end - 1; i >= 0; i -= 1) {
      if (/[시군구읍면리동]/.test(compact[i])) {
        start = i + 1;
        break;
      }
    }

    const dong = compact.slice(start, end + 1);
    if (!/^[가-힣A-Za-z0-9]+(?:동|읍|면|리)$/.test(dong)) return { dong: "", mainNo: "", subNo: "" };

    const tail = compact.slice(end + 1);
    const lot = tail.match(/(산?\d+)(?:-(\d+))?/);
    if (!lot) return { dong, mainNo: "", subNo: "" };
    return { dong, mainNo: lot[1] || "", subNo: lot[2] || "" };
  }

  function extractFloorText(...texts) {
    const joined = texts
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
    if (!joined) return "";
    const korean = joined.match(/(지하\s*\d+층|지상\s*\d+층|\d+층|반지하|옥탑|지하|지상)/);
    if (korean) return korean[1].replace(/\s+/g, "");
    const floor = joined.match(/(?:^|\s)(B\d+|\d+F|\d+층|\d+층\/?\d+층)/i);
    return floor ? floor[1] : "";
  }

  function sanitizeOnbidOpinion(opinion, memo, address) {
    const addressText = String(address || "").trim();

    const cleanCandidate = (value) => {
      let text = String(value || "").trim();
      if (!text) return "";
      if (!addressText) return text;

      const compactText = text.replace(/\s+/g, "");
      const compactAddress = addressText.replace(/\s+/g, "");
      if (!compactAddress) return text;
      if (compactText === compactAddress) return "";
      if (compactText.includes(compactAddress) || compactAddress.includes(compactText)) {
        const escaped = addressText
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\s*");
        if (escaped) {
          text = text
            .replace(new RegExp(escaped, "gi"), "")
            .replace(/^[\s,;:/|·-]+|[\s,;:/|·-]+$/g, "")
            .trim();
        }
        if (!text) return "";
      }
      return text;
    };

    const explicit = cleanCandidate(opinion);
    if (explicit) return explicit;
    return cleanCandidate(memo);
  }

  function buildNormalizedPropertyBase(item, options) {
    const opts = options && typeof options === "object" ? options : {};
    const raw = item && item.raw && typeof item.raw === "object" ? item.raw : {};
    const rawSource = pickFirstText(
      item && item.sourceType,
      item && item.source_type,
      item && item.source,
      item && item.category,
      raw.sourceType,
      raw.source_type
    ).toLowerCase();
    const sourceType = normalizeSourceType(rawSource, { fallback: opts.fallbackSource || "general" });
    const address = pickFirstText(item && item.address, item && item.location, item && item.addr, raw.address, raw.location, "");
    const itemNo = pickFirstText(item && item.itemNo, item && item.caseNo, item && item.externalId, item && item.listingId, item && item.item_no, raw.itemNo, raw.item_no, "");
    const sourceUrl = pickFirstText(item && item.sourceUrl, item && item.source_url, raw.sourceUrl, raw.source_url, raw.url, raw["바로가기(엑셀)"], raw["매물URL"], "");
    const submitterType = normalizeSubmitterType(pickFirstText(item && item.submitterType, item && item.submitter_type, raw.submitterType, raw.submitter_type, ""));
    const submitterName = pickFirstText(item && item.submitterName, item && item.submitter_name, raw.submitterName, raw.submitter_name, "");
    const brokerOfficeName = pickFirstText(item && item.brokerOfficeName, item && item.broker_office_name, raw.brokerOfficeName, raw.broker_office_name, "");
    const memoText = pickFirstText(item && item.memo, raw.memo, "");
    const opinionText = sourceType === "onbid"
      ? sanitizeOnbidOpinion(pickFirstText(item && item.opinion, raw.opinion, ""), memoText, address)
      : pickFirstText(item && item.opinion, raw.opinion, memoText, item && item.comment, "");
    const isDirectSubmission = isDirectRealtorSubmission({
      sourceType,
      rawSource,
      submitterType,
      sourceUrl,
      submitterName,
      brokerOfficeName,
      raw,
      isDirectSubmission: item && (item.isDirectSubmission ?? item.is_direct_submission),
    });

    return {
      id: String((item && (item.id || item._id || item.globalId || item.global_id)) || ""),
      globalId: String((item && (item.globalId || item.global_id)) || (sourceType && itemNo ? `${sourceType}:${itemNo}` : "")),
      raw,
      rawSource,
      sourceType,
      sourceUrl,
      submitterType,
      submitterName,
      brokerOfficeName,
      isDirectSubmission,
      isGeneral: Boolean((item && (item.isGeneral || item.is_general || item.origin === "general")) || sourceType === "general"),
      itemNo,
      address,
      latitude: toNullableNumber(item && (item.latitude ?? item.lat ?? item.y ?? raw.latitude ?? raw.lat ?? "")),
      longitude: toNullableNumber(item && (item.longitude ?? item.lng ?? item.x ?? raw.longitude ?? raw.lng ?? "")),
      priceMain: toNullableNumber(item && (item.priceMain ?? item.price_main ?? raw.priceMain ?? raw.price_main ?? raw["감정가"] ?? raw["감정가(원)"] ?? item.salePrice ?? item.sale_price ?? item.price ?? item.appraisalPrice ?? item.appraisal_price)),
      lowprice: sourceType === "realtor" || sourceType === "general"
        ? null
        : toNullableNumber(item && (item.lowprice ?? item.low_price ?? raw.lowprice ?? raw.low_price ?? raw["최저가"] ?? raw["최저입찰가(원)"] ?? raw["매각가"] ?? item.currentPrice ?? item.current_price ?? raw.currentPrice ?? raw.current_price)),
      status: pickFirstText(item && item.status, raw.status, ""),
      assetType: pickFirstText(item && item.assetType, item && item.asset_type, item && item.type, item && item.propertyType, item && item.kind, raw.assetType, raw.asset_type, raw["세부유형"], "-"),
      floor: pickFirstText(item && item.floor, item && item.floor_text, item && item.floor_korean, raw.floor, raw.floorText, raw["해당층"], extractFloorText(address, raw["물건명"], raw.address)),
      totalfloor: pickFirstText(item && item.totalfloor, item && item.total_floor, item && item.totalfloor_text, item && item.totalfloor_snake, item && item.totalfloor_camel, item && item.totalfloor_korean, raw.totalfloor, raw.total_floor, raw.totalFloor, raw["총층"], ""),
      useapproval: pickFirstText(item && item.useapproval, item && item.use_approval, raw.useapproval, raw.use_approval, raw.useApproval, raw["사용승인일"], ""),
      exclusivearea: toNullableNumber(item && (item.exclusivearea ?? item.exclusive_area ?? item.exclusiveArea ?? raw.exclusivearea ?? raw.exclusiveArea ?? raw["전용면적(평)"] ?? raw["전용면적"] ?? item.areaPyeong ?? item.areaPy ?? item.area ?? item.area_m2)),
      commonarea: toNullableNumber(item && (item.commonarea ?? item.common_area ?? item.commonArea ?? raw.commonarea ?? raw.commonArea ?? raw["공용면적(평)"] ?? raw["공급/계약면적(평)"] ?? raw["공급면적(평)"])),
      sitearea: toNullableNumber(item && (item.sitearea ?? item.site_area ?? item.siteArea ?? raw.sitearea ?? raw.siteArea ?? raw["토지면적(평)"])),
      dateMain: pickFirstText(item && item.dateMain, item && item.date_main, raw.dateMain, raw.date_main, raw["입찰일자"], raw["입찰마감일시"], item && item.bidDate, item && item.bid_date, ""),
      createdAt: pickFirstText(item && item.date, item && item.date_uploaded, item && item.createdAt, item && item.created_at, raw.date, raw.createdAt, raw.date_uploaded, ""),
      assignedAgentId: pickFirstText(item && item.assignedAgentId, item && item.assigneeId, item && item.assignee_id, item && item.agentId, raw.assignedAgentId, raw.assigneeId, raw.assignee_id, ""),
      assignedAgentName: pickFirstText(item && item.assignedAgentName, item && item.assigneeName, item && item.assignee_name, item && item.agentName, item && item.manager, raw.assignedAgentName, raw.assigneeName, raw.assignee_name, ""),
      regionGu: pickFirstText(item && item.regionGu, item && item.region_gu, raw.regionGu, raw.region_gu, ""),
      regionDong: pickFirstText(item && item.regionDong, item && item.region_dong, raw.regionDong, raw.region_dong, ""),
      memo: memoText,
      opinion: opinionText,
      realtorname: pickFirstText(item && item.realtorname, item && item.realtor_name, raw.realtorname, raw.realtorName, brokerOfficeName, ""),
      realtorphone: pickFirstText(item && item.realtorphone, item && item.realtor_phone, raw.realtorphone, raw.realtorPhone, ""),
      realtorcell: pickFirstText(item && item.realtorcell, item && item.realtor_cell, raw.realtorcell, raw.realtorCell, item && item.submitterPhone, item && item.submitter_phone, ""),
      rightsAnalysis: pickFirstText(item && item.rightsAnalysis, item && item.rights_analysis, raw.rightsAnalysis, raw.rights_analysis, "") || ((item && (item.analysisDone ?? item.analysis_done)) ? "완료" : ""),
      siteInspection: pickFirstText(item && item.siteInspection, item && item.site_inspection, raw.siteInspection, raw.site_inspection, "") || ((item && (item.siteVisit ?? item.site_visit ?? item.fieldDone ?? item.field_done)) ? "완료" : ""),
      geocodeStatus: pickFirstText(item && item.geocode_status, item && item.geocodeStatus, raw.geocode_status, ""),
      geocodedAt: pickFirstText(item && item.geocoded_at, item && item.geocodedAt, ""),
      duplicateFlag: !!(item && item.duplicateFlag),
    };
  }

  function extractHoNumberForLog(data) {
    const explicitValues = [data?.ho, data?.unit, data?.room, data?.raw?.ho, data?.raw?.unit, data?.raw?.room];
    for (const value of explicitValues) {
      const text = String(value || "").trim();
      if (!text) continue;
      let match = text.match(/(\d{1,5})\s*호/);
      if (match) return String(Number(match[1]));
      if (!/층|동/.test(text)) {
        match = text.match(/^\D*(\d{1,5})\D*$/);
        if (match) return String(Number(match[1]));
      }
    }
    const texts = [
      data?.address,
      data?.raw?.address,
      data?.raw?.물건명,
      data?.raw?.상세주소,
      data?.memo,
      data?.raw?.memo,
      data?.raw?.opinion,
      data?.raw?.detailAddress,
    ].filter(Boolean).join(" ");
    const match = texts.match(/(\d{1,5})\s*호/);
    return match ? String(Number(match[1])) : "";
  }

  function buildRegistrationMatchKey(data) {
    const parts = parseAddressIdentityParts(pickFirstText(data?.address, data?.raw?.address, ""));
    const floorKey = parseFloorNumberForLog(pickFirstText(data?.floor, data?.raw?.floor, data?.totalFloor, data?.raw?.totalfloor, "")) || "0";
    const hoKey = extractHoNumberForLog(data) || "0";
    if (!parts.dong || !parts.mainNo) return "";
    return `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey}|${hoKey}`;
  }

  function buildRegistrationMatchKeyFromRow(row) {
    const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
    return String(raw.registrationIdentityKey || buildRegistrationMatchKey({
      address: row?.address || raw.address || "",
      floor: raw.floor || row?.floor || "",
      totalFloor: raw.totalfloor || row?.total_floor || "",
      ho: raw.ho || raw.unit || raw.room || "",
      raw,
    }) || "").trim();
  }

  function attachRegistrationIdentity(raw, data) {
    const nextRaw = { ...(raw || {}) };
    const parts = parseAddressIdentityParts(pickFirstText(data?.address, data?.raw?.address, nextRaw.address, ""));
    const floorKey = parseFloorNumberForLog(pickFirstText(data?.floor, data?.raw?.floor, data?.totalFloor, data?.raw?.totalfloor, nextRaw.floor, nextRaw.totalfloor, ""));
    const hoKey = extractHoNumberForLog(data);
    const key = parts.dong && parts.mainNo
      ? `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey || "0"}|${hoKey || "0"}`
      : "";
    nextRaw.registrationIdentityKey = key;
    nextRaw.registrationIdentity = {
      dong: parts.dong || "",
      mainNo: parts.mainNo || "",
      subNo: parts.subNo || "",
      floor: floorKey || "",
      ho: hoKey || "",
    };
    return nextRaw;
  }

  function hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  }

  function normalizeCompareValue(field, value, options = {}) {
    if (value === null || value === undefined) return "";
    const numericFields = new Set(options.numericFields || []);
    if (numericFields.has(field)) {
      const num = toNullableNumber(value);
      return num == null || !Number.isFinite(num) ? "" : String(num);
    }
    return String(value).trim().replace(/\s+/g, " ");
  }

  function formatFieldValueForLog(field, value, options = {}) {
    if (value === null || value === undefined) return "";
    const amountFields = new Set(options.amountFields || []);
    const numericFields = new Set(options.numericFields || []);
    const num = toNullableNumber(value);
    if (amountFields.has(field)) {
      return num == null || !Number.isFinite(num) ? "" : Number(num).toLocaleString("ko-KR");
    }
    if (numericFields.has(field)) {
      if (num == null || !Number.isFinite(num)) return "";
      return Number.isInteger(num) ? String(num) : String(num).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    }
    return String(value).trim();
  }

  function buildRegistrationChanges(prevSnapshot, nextSnapshot, labels, options = {}) {
    const changes = [];
    Object.keys(labels || {}).forEach((field) => {
      const nextValue = nextSnapshot?.[field];
      if (!hasMeaningfulValue(nextValue)) return;
      const prevNorm = normalizeCompareValue(field, prevSnapshot?.[field], options);
      const nextNorm = normalizeCompareValue(field, nextValue, options);
      if (prevNorm === nextNorm) return;
      changes.push({
        field,
        label: labels[field],
        before: formatFieldValueForLog(field, prevSnapshot?.[field], options) || "-",
        after: formatFieldValueForLog(field, nextValue, options) || "-",
      });
    });
    return changes;
  }

  function buildRegisterLogContext(route, options = {}) {
    const user = options.user || null;
    return {
      at: String(options.at || new Date().toISOString()).trim(),
      route: String(route || options.route || "등록").trim(),
      actor: String(options.actor || user?.name || user?.email || "").trim(),
    };
  }

  function ensureRegistrationCreatedLog(raw, context = {}) {
    const nextRaw = { ...(raw || {}) };
    const firstAt = pickFirstText(nextRaw.firstRegisteredAt, context?.at, new Date().toISOString());
    const current = Array.isArray(nextRaw.registrationLog) ? nextRaw.registrationLog.slice() : [];
    if (!current.length) {
      current.push({ type: "created", at: firstAt, route: context?.route || "등록", actor: context?.actor || "" });
    }
    nextRaw.firstRegisteredAt = firstAt;
    nextRaw.registrationLog = current;
    return nextRaw;
  }

  function appendRegistrationLog(raw, context = {}, changes = []) {
    const nextRaw = ensureRegistrationCreatedLog(raw, context);
    if (Array.isArray(changes) && changes.length) {
      nextRaw.registrationLog = [...nextRaw.registrationLog, {
        type: "changed",
        at: context?.at || new Date().toISOString(),
        route: context?.route || "등록",
        actor: context?.actor || "",
        changes: changes.map((entry) => ({ ...entry })),
      }];
    }
    return nextRaw;
  }

  function loadRegistrationLog(item, options = {}) {
    const raw = item?._raw?.raw || item?.raw || {};
    if (Array.isArray(raw.registrationLog) && raw.registrationLog.length) return raw.registrationLog;
    const createdAt = pickFirstText(
      raw.firstRegisteredAt,
      item?.createdAt,
      item?._raw?.created_at,
      item?._raw?.createdAt,
      item?.created_at,
      item?.createdAt,
      ""
    );
    if (!createdAt) return [];
    return [{
      type: "created",
      at: createdAt,
      route: String(options.defaultRoute || "최초 등록").trim() || "최초 등록",
      actor: String(options.defaultActor || "").trim(),
    }];
  }

  function mergeMeaningfulShallow(baseObj, incomingObj) {
    const out = { ...(baseObj || {}) };
    Object.entries(incomingObj || {}).forEach(([key, value]) => {
      if (!hasMeaningfulValue(value)) return;
      out[key] = value;
    });
    return out;
  }

  function loadOpinionHistory(item) {
    const raw = item?._raw?.raw || item?.raw || {};
    const hist = raw.opinionHistory;
    if (Array.isArray(hist)) return hist;
    const legacy = String(item?.opinion || raw.opinion || "").trim();
    if (legacy) {
      const fallbackDate = Shared && typeof Shared.formatDate === "function"
        ? (Shared.formatDate(item?.createdAt) || "unknown")
        : "unknown";
      return [{ date: fallbackDate, text: legacy, author: "" }];
    }
    return [];
  }

  function appendOpinionEntry(history, newText, user, now = new Date()) {
    const text = String(newText || "").trim();
    if (!text) return Array.isArray(history) ? history : [];
    const date = now instanceof Date ? now : new Date(now);
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const author = String(user?.name || user?.email || "").trim();
    return [...(Array.isArray(history) ? history : []), { date: today, text, author }];
  }

  function collectPropertyErrorFragments(error) {
    const fragments = [];
    const push = (value) => {
      if (value == null) return;
      const text = String(value).trim();
      if (text) fragments.push(text);
    };
    const queue = [error];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      push(current.message);
      push(current.details);
      push(current.hint);
      push(current.code);
      push(current.constraint);
      push(current.error);
      push(current.error_description);
      if (current.data && typeof current.data === "object") queue.push(current.data);
      if (current.cause && typeof current.cause === "object") queue.push(current.cause);
      if (current.originalError && typeof current.originalError === "object") queue.push(current.originalError);
    }
    return fragments;
  }

  function detectPropertyDuplicateIndexName(error) {
    const constraint = String(error?.constraint || error?.data?.constraint || "").trim();
    if (PROPERTY_DUPLICATE_INDEX_NAME_SET.has(constraint)) return constraint;
    const joined = collectPropertyErrorFragments(error).join("\n");
    for (const indexName of PROPERTY_DUPLICATE_INDEX_NAMES) {
      if (joined.includes(indexName)) return indexName;
    }
    return "";
  }

  function isPropertyDuplicateError(error) {
    const code = String(error?.code || error?.data?.code || "").trim();
    const joined = collectPropertyErrorFragments(error).join("\n");
    if (detectPropertyDuplicateIndexName(error)) return true;
    if (code === "23505" && /registration_identity_key(_v2)?|global_id/i.test(joined)) return true;
    if (/duplicate key value violates unique constraint/i.test(joined) && /registration_identity_key(_v2)?|global_id/i.test(joined)) return true;
    return false;
  }

  function normalizePropertyDuplicateError(error, options = {}) {
    if (!isPropertyDuplicateError(error)) return null;
    const normalized = new Error(String(options.message || "동일 물건이 이미 등록되어 있습니다"));
    normalized.status = Number(options.status || 409);
    normalized.code = String(options.code || "PROPERTY_DUPLICATE");
    normalized.constraint = detectPropertyDuplicateIndexName(error) || undefined;
    normalized.cause = error;
    return normalized;
  }

  function normalizeSourceType(rawValue, options = {}) {
    const fallback = String(options.fallback || "general").trim() || "general";
    const value = String(rawValue || "").trim().toLowerCase();
    if (!value) return fallback;
    if (["auction", "courtauction", "court_auction"].includes(value)) return "auction";
    if (["onbid", "public", "gongmae", "공매"].includes(value)) return "onbid";
    if (["realtor", "broker", "naver", "realtor_naver", "realtor_direct", "중개", "중개사"].includes(value)) return "realtor";
    if (["general", "owner", "public_user", "일반", "직접등록"].includes(value)) return "general";
    return fallback;
  }

  function normalizeSubmitterType(rawValue, options = {}) {
    const fallback = String(options.fallback || "").trim().toLowerCase();
    const value = String(rawValue || "").trim().toLowerCase();
    if (!value) return fallback;
    if (["realtor", "broker", "agent", "중개", "중개사", "공인중개사"].includes(value)) return "realtor";
    if (["owner", "general", "user", "person", "일반", "소유", "소유자", "본인"].includes(value)) return "owner";
    return fallback;
  }

  function normalizePublicSourceType(rawValue, submitterType) {
    const submitter = normalizeSubmitterType(submitterType, { fallback: "" });
    if (submitter === "realtor") return "realtor";
    if (submitter === "owner") return "general";
    return normalizeSourceType(rawValue, { fallback: "general" });
  }

  function isBrokerLikeSource(sourceType) {
    return normalizeSourceType(sourceType, { fallback: "" }) === "realtor";
  }

  function isAuctionLikeSource(sourceType) {
    return normalizeSourceType(sourceType, { fallback: "" }) === "auction";
  }

  function isGeneralSourceType(sourceType) {
    return normalizeSourceType(sourceType, { fallback: "" }) === "general";
  }

  function isDirectRealtorSubmission(item) {
    const sourceType = normalizeSourceType(
      item?.sourceType || item?.source_type || item?.source || item?.category || item?.raw?.sourceType || item?.raw?.source_type || "",
      { fallback: "general" }
    );
    if (sourceType !== "realtor") return false;
    const submitterType = normalizeSubmitterType(
      item?.submitterType || item?.submitter_type || item?.raw?.submitterType || item?.raw?.submitter_type || "",
      { fallback: "" }
    );
    const rawSource = String(item?.rawSource || item?.raw_source || item?.raw?.sourceType || item?.raw?.source_type || item?.source || item?.category || "").trim().toLowerCase();
    if (["realtor_direct"].includes(rawSource)) return true;
    if (["realtor_naver", "naver", "broker"].includes(rawSource)) return false;
    const sourceUrl = pickFirstText(item?.sourceUrl, item?.source_url, item?.raw?.sourceUrl, item?.raw?.source_url, item?.raw?.url, item?.raw?.["바로가기(엑셀)"], item?.raw?.["매물URL"], "");
    if (sourceUrl) return false;
    if (submitterType === "realtor") return true;
    const submitterName = pickFirstText(item?.submitterName, item?.submitter_name, item?.raw?.submitterName, item?.raw?.submitter_name, item?.brokerOfficeName, item?.broker_office_name, item?.raw?.brokerOfficeName, item?.raw?.broker_office_name, "");
    return !!submitterName;
  }

  function getSourceBucket(item) {
    const sourceType = normalizeSourceType(item?.sourceType || item?.source_type || item?.source || item?.category || item?.raw?.sourceType || item?.raw?.source_type || "", { fallback: "general" });
    if (sourceType === "realtor") {
      if (typeof item?.isDirectSubmission === "boolean") return item.isDirectSubmission ? "realtor_direct" : "realtor_naver";
      if (typeof item?.is_direct_submission === "boolean") return item.is_direct_submission ? "realtor_direct" : "realtor_naver";
      return isDirectRealtorSubmission(item) ? "realtor_direct" : "realtor_naver";
    }
    if (["auction", "onbid", "general"].includes(sourceType)) return sourceType;
    return "general";
  }

  function getSourceTypeLabel(sourceType) {
    const normalized = normalizeSourceType(sourceType, { fallback: "general" });
    if (normalized === "auction") return "경매";
    if (normalized === "onbid") return "공매";
    if (normalized === "realtor") return "중개";
    return "일반";
  }

  function getSourceBucketLabel(bucket) {
    const key = String(bucket || "").trim();
    if (key === "auction") return "경매";
    if (key === "onbid") return "공매";
    if (key === "realtor_naver") return "네이버중개";
    if (key === "realtor_direct") return "일반중개";
    if (key === "realtor") return "중개";
    return "일반";
  }

  function matchesSourceBucket(item, activeCard) {
    const target = String(activeCard || "").trim();
    if (!target || target === "all") return true;
    return getSourceBucket(item) === target;
  }

  function summarizeSourceBuckets(rows) {
    const summary = { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    const list = Array.isArray(rows) ? rows : [];
    for (const item of list) {
      const bucket = getSourceBucket(item);
      summary.total += 1;
      if (bucket in summary) summary[bucket] += 1;
    }
    return summary;
  }

  return {
    pickFirstText,
    compactAddressText,
    extractFloorText,
    sanitizeOnbidOpinion,
    buildNormalizedPropertyBase,
    parseFloorNumberForLog,
    parseAddressIdentityParts,
    extractHoNumberForLog,
    buildRegistrationMatchKey,
    buildRegistrationMatchKeyFromRow,
    attachRegistrationIdentity,
    hasMeaningfulValue,
    normalizeCompareValue,
    formatFieldValueForLog,
    buildRegistrationChanges,
    buildRegisterLogContext,
    ensureRegistrationCreatedLog,
    appendRegistrationLog,
    loadRegistrationLog,
    mergeMeaningfulShallow,
    loadOpinionHistory,
    appendOpinionEntry,
    PROPERTY_DUPLICATE_INDEX_NAMES,
    collectPropertyErrorFragments,
    detectPropertyDuplicateIndexName,
    isPropertyDuplicateError,
    normalizePropertyDuplicateError,
    REGISTRATION_LOG_LABELS_BASE,
    REGISTRATION_LOG_LABELS_ADMIN,
    REGISTRATION_LOG_LABELS_AGENT,
    REGISTRATION_LOG_LABELS_PUBLIC,
    normalizeSourceType,
    normalizeSubmitterType,
    normalizePublicSourceType,
    isBrokerLikeSource,
    isAuctionLikeSource,
    isGeneralSourceType,
    isDirectRealtorSubmission,
    getSourceBucket,
    getSourceTypeLabel,
    getSourceBucketLabel,
    matchesSourceBucket,
    summarizeSourceBuckets,
  };
});
