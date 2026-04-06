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

  function usesDedicatedSourceNote(sourceType) {
    const normalized = normalizeSourceType(sourceType, { fallback: "" });
    return normalized === "auction" || normalized === "realtor";
  }

  function getDedicatedSourceNoteLabel(sourceType) {
    const normalized = normalizeSourceType(sourceType, { fallback: "" });
    if (normalized === "auction") return "경매현황";
    if (normalized === "realtor") return "매물특징";
    return "";
  }

  function normalizeSourceNoteText(input) {
    return String(input || "").replace(/\s+/g, " ").trim();
  }

  function collectLegacySourceNoteCandidates(row, sourceRaw) {
    const candidates = [];
    const push = (value, explicit = false) => {
      const text = normalizeSourceNoteText(value);
      if (!text) return;
      candidates.push({ text, explicit });
    };
    push(sourceRaw.importedSourceText, true);
    push(sourceRaw.sourceNoteText, true);
    push(sourceRaw["경매현황"], true);
    push(sourceRaw.auctionStatus, true);
    push(sourceRaw.auction_status, true);
    push(sourceRaw["매물특징"], true);
    push(sourceRaw.listingFeature, true);
    push(sourceRaw.listing_feature, true);
    push(sourceRaw.memo);
    push(row.memo);
    push(sourceRaw.opinion);
    push(row.opinion);
    push(sourceRaw.dailyIssue);
    push(sourceRaw.daily_issue);
    const opinionHistory = Array.isArray(sourceRaw.opinionHistory) ? sourceRaw.opinionHistory : [];
    opinionHistory.forEach((entry) => push(entry && (entry.text || entry.note || "")));
    return candidates;
  }

  function chooseLegacySourceNoteText(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    const explicit = list.find((entry) => entry && entry.explicit && entry.text);
    if (explicit) return explicit.text;

    const counts = new Map();
    list.forEach((entry) => {
      if (!entry || !entry.text) return;
      const bucket = counts.get(entry.text) || { count: 0, explicit: false };
      bucket.count += 1;
      bucket.explicit = bucket.explicit || !!entry.explicit;
      counts.set(entry.text, bucket);
    });

    let bestText = "";
    let bestScore = -1;
    counts.forEach((meta, text) => {
      let score = text.length;
      if (meta.explicit) score += 100000;
      if (meta.count >= 2) score += 10000;
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    });
    return bestText;
  }

  function extractDedicatedSourceNote(sourceType, item, raw) {
    const normalized = normalizeSourceType(sourceType, { fallback: "" });
    if (!usesDedicatedSourceNote(normalized)) return { label: "", text: "" };
    const row = item && typeof item === "object" ? item : {};
    const sourceRaw = raw && typeof raw === "object" ? raw : {};
    const label = pickFirstText(sourceRaw.importedSourceLabel, sourceRaw.sourceNoteLabel, getDedicatedSourceNoteLabel(normalized));
    const candidates = collectLegacySourceNoteCandidates(row, sourceRaw);
    let text = chooseLegacySourceNoteText(candidates);
    if (!text && normalized === "auction") {
      text = pickFirstText(row.auctionStatus, row.auction_status, row["경매현황"], "");
    } else if (!text && normalized === "realtor") {
      text = pickFirstText(row.listingFeature, row.listing_feature, row["매물특징"], "");
    }
    return { label, text: normalizeSourceNoteText(text) };
  }

  function stripDedicatedSourceNoteEcho(value, sourceNoteText) {
    const text = String(value || "").trim();
    const sourceText = String(sourceNoteText || "").trim();
    if (!text) return "";
    if (!sourceText) return text;
    const normalize = (input) => String(input || "").replace(/\s+/g, " ").trim();
    const current = normalize(text);
    const source = normalize(sourceText);
    return current === source ? "" : text;
  }

  function inferSourceTypeFromContext(context = {}) {
    const raw = context && context.raw && typeof context.raw === "object" ? context.raw : {};
    const sourceHints = [
      context.rawSource,
      context.sourceType,
      context.source_type,
      context.source,
      context.category,
      raw.sourceType,
      raw.source_type,
      raw.source,
      raw.category,
      raw["구분"],
      raw["출처"],
      raw["플랫폼"],
      raw["서비스"],
      raw["수집구분"],
      raw["매체"],
      raw["사이트"],
      raw.portal,
      raw.provider,
      raw.origin,
      raw.origin_type,
      raw.originType,
    ].map((value) => String(value ?? "").trim()).filter(Boolean);

    for (const hint of sourceHints) {
      const normalized = normalizeSourceType(hint, { fallback: "" });
      if (normalized && normalized !== "general") return normalized;
    }

    const sourceUrl = pickFirstText(
      context.sourceUrl,
      context.source_url,
      raw.sourceUrl,
      raw.source_url,
      raw.url,
      raw["바로가기(엑셀)"],
      raw["매물URL"],
      ""
    ).toLowerCase();
    const globalId = pickFirstText(context.globalId, context.global_id, raw.globalId, raw.global_id, "").toLowerCase();
    const submitterType = normalizeSubmitterType(
      pickFirstText(context.submitterType, context.submitter_type, raw.submitterType, raw.submitter_type, ""),
      { fallback: "" }
    );
    const isGeneral = Boolean(context.isGeneral ?? context.is_general ?? raw.is_general ?? raw.isGeneral);
    const brokerOfficeName = pickFirstText(context.brokerOfficeName, context.broker_office_name, raw.brokerOfficeName, raw.broker_office_name, "");
    const joined = [sourceUrl, globalId, ...sourceHints].filter(Boolean).join(" ");

    if (/(^|\b)(auction|courtauction|court_auction)(:|\b)|법원경매|지지옥션|스피드옥션/i.test(joined)) return "auction";
    if (/(^|\b)(onbid|gongmae|public)(:|\b)|온비드|공매|캠코/i.test(joined)) return "onbid";
    if (/land\.naver\.com|new\.land\.naver\.com|m\.land\.naver\.com|fin\.land\.naver\.com|네이버/i.test(joined)) return "realtor";
    if (sourceHints.some((hint) => /(중개|중개사|공인중개사|broker|realtor|agent)/i.test(hint))) return "realtor";
    if (submitterType === "realtor") return "realtor";
    if (brokerOfficeName) return "realtor";

    for (const hint of sourceHints) {
      if (normalizeSourceType(hint, { fallback: "" }) === "general") return "general";
    }
    if (isGeneral || submitterType === "owner") return "general";
    return "general";
  }

  function buildNormalizedPropertyBase(item, options) {
    const opts = options && typeof options === "object" ? options : {};
    const raw = item && item.raw && typeof item.raw === "object" ? item.raw : {};
    const address = pickFirstText(item && item.address, item && item.location, item && item.addr, raw.address, raw.location, "");
    const itemNo = pickFirstText(item && item.itemNo, item && item.caseNo, item && item.externalId, item && item.listingId, item && item.item_no, raw.itemNo, raw.item_no, "");
    const sourceUrl = pickFirstText(item && item.sourceUrl, item && item.source_url, raw.sourceUrl, raw.source_url, raw.url, raw["바로가기(엑셀)"], raw["매물URL"], "");
    const submitterType = normalizeSubmitterType(pickFirstText(item && item.submitterType, item && item.submitter_type, raw.submitterType, raw.submitter_type, ""));
    const submitterName = pickFirstText(item && item.submitterName, item && item.submitter_name, raw.submitterName, raw.submitter_name, "");
    const brokerOfficeName = pickFirstText(item && item.brokerOfficeName, item && item.broker_office_name, raw.brokerOfficeName, raw.broker_office_name, "");
    const rawSource = pickFirstText(
      item && item.sourceType,
      item && item.source_type,
      item && item.source,
      item && item.category,
      raw.sourceType,
      raw.source_type,
      raw.source,
      raw.category,
      raw["구분"],
      raw["출처"],
      raw["플랫폼"],
      raw["서비스"],
      raw["수집구분"],
      raw["매체"],
      raw["사이트"],
      ""
    ).toLowerCase();
    const isGeneral = Boolean((item && ((item.isGeneral ?? item.is_general) || item.origin === "general")) || raw.is_general || raw.isGeneral);
    const sourceType = inferSourceTypeFromContext({
      rawSource,
      sourceUrl,
      globalId: item && (item.globalId || item.global_id),
      submitterType,
      isGeneral,
      brokerOfficeName,
      raw,
      fallback: opts.fallbackSource || "general",
    });
    const memoText = pickFirstText(item && item.memo, raw.memo, "");
    const sourceNote = extractDedicatedSourceNote(sourceType, item, raw);
    const opinionTextRaw = sourceType === "onbid"
      ? sanitizeOnbidOpinion(pickFirstText(item && item.opinion, raw.opinion, ""), memoText, address)
      : usesDedicatedSourceNote(sourceType)
        ? pickFirstText(item && item.opinion, raw.opinion, item && item.comment, "")
        : pickFirstText(item && item.opinion, raw.opinion, memoText, item && item.comment, "");
    const opinionText = stripDedicatedSourceNoteEcho(opinionTextRaw, sourceNote.text);
    const dailyIssueText = stripDedicatedSourceNoteEcho(pickFirstText(item && item.dailyIssue, item && item.daily_issue, raw.dailyIssue, raw.daily_issue, ""), sourceNote.text);
    const siteInspectionText = stripDedicatedSourceNoteEcho(pickFirstText(item && item.siteInspection, item && item.site_inspection, raw.siteInspection, raw.site_inspection, ""), sourceNote.text);
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
      isGeneral: Boolean(isGeneral || sourceType === "general"),
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
      sourceNoteLabel: sourceNote.label,
      sourceNoteText: sourceNote.text,
      realtorname: pickFirstText(item && item.realtorname, item && item.realtor_name, raw.realtorname, raw.realtorName, brokerOfficeName, ""),
      realtorphone: pickFirstText(item && item.realtorphone, item && item.realtor_phone, raw.realtorphone, raw.realtorPhone, ""),
      realtorcell: pickFirstText(item && item.realtorcell, item && item.realtor_cell, raw.realtorcell, raw.realtorCell, item && item.submitterPhone, item && item.submitter_phone, ""),
      rightsAnalysis: pickFirstText(item && item.rightsAnalysis, item && item.rights_analysis, raw.rightsAnalysis, raw.rights_analysis, "") || ((item && (item.analysisDone ?? item.analysis_done)) ? "완료" : ""),
      siteInspection: siteInspectionText || ((item && (item.siteVisit ?? item.site_visit ?? item.fieldDone ?? item.field_done)) ? "완료" : ""),
      dailyIssue: dailyIssueText,
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

  function resolveRegistrationCandidateRow(item) {
    if (!item || typeof item !== "object") return null;
    if (item._raw && typeof item._raw === "object") return item._raw;
    return item;
  }

  function resolveRegistrationCandidateRaw(item) {
    const row = resolveRegistrationCandidateRow(item);
    if (!row || typeof row !== "object") return {};
    if (row.raw && typeof row.raw === "object") return row.raw;
    return {};
  }

  function resolveRegistrationMatchKey(item) {
    const row = resolveRegistrationCandidateRow(item);
    const raw = resolveRegistrationCandidateRaw(item);
    const direct = pickFirstText(
      item && item.registrationIdentityKey,
      row && row.registrationIdentityKey,
      raw && raw.registrationIdentityKey,
      ""
    );
    if (direct) return direct;
    return buildRegistrationMatchKey({
      address: pickFirstText(item && item.address, row && row.address, raw && raw.address, ""),
      floor: pickFirstText(item && item.floor, row && row.floor, raw && raw.floor, ""),
      totalFloor: pickFirstText(item && item.totalfloor, item && item.totalFloor, row && row.total_floor, row && row.totalfloor, raw && raw.totalfloor, raw && raw.totalFloor, ""),
      ho: pickFirstText(item && item.ho, item && item.unit, item && item.room, row && row.ho, raw && raw.ho, raw && raw.unit, raw && raw.room, ""),
      raw,
    });
  }

  function buildRegistrationSearchHint(data) {
    const targetKey = buildRegistrationMatchKey(data);
    const address = pickFirstText(data && data.address, data && data.raw && data.raw.address, "");
    const identity = parseAddressIdentityParts(address);
    let dongToken = identity.dong || "";
    if (!dongToken) {
      const match = String(address || "").trim().match(/([가-힣A-Za-z0-9]+동)/);
      dongToken = String((match && match[1]) || "").trim();
    }
    return {
      targetKey: String(targetKey || "").trim(),
      address: String(address || "").trim(),
      dongToken,
      identity,
    };
  }

  function findExistingPropertyByRegistrationKey(data, items, options = {}) {
    const hint = buildRegistrationSearchHint(data);
    if (!hint.targetKey) return null;
    const ignore = String(options.ignoreId || options.ignore || "").trim();
    const normalizeRow = typeof options.normalizeRow === "function" ? options.normalizeRow : null;
    const list = Array.isArray(items) ? items : [];
    for (const sourceItem of list) {
      const candidate = normalizeRow ? (normalizeRow(sourceItem) || sourceItem) : sourceItem;
      const row = resolveRegistrationCandidateRow(candidate) || sourceItem;
      const currentId = pickFirstText(candidate && candidate.id, candidate && candidate.globalId, row && row.id, row && row.global_id, row && row.globalId, "");
      if (ignore && String(currentId || "").trim() === ignore) continue;
      const key = resolveRegistrationMatchKey(candidate || sourceItem);
      if (key && key === hint.targetKey) return candidate || sourceItem;
    }
    return null;
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

  function normalizeOpinionHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const text = String(entry.text || entry.note || "").trim();
    if (!text) return null;
    const kind = String(entry.kind || entry.type || "opinion").trim() || "opinion";
    const title = String(entry.title || entry.label || "").trim();
    const date = String(entry.date || entry.at || "").trim();
    const author = String(entry.author || entry.actor || "").trim();
    return { ...entry, kind, title, date, at: date || String(entry.at || "").trim(), text, author };
  }

  function buildOpinionHistoryEntry(kind, text, user, options = {}) {
    const body = String(text || "").trim();
    if (!body) return null;
    const at = String(options.at || new Date().toISOString()).trim() || new Date().toISOString();
    const date = String(options.date || (Shared && typeof Shared.formatDate === "function" ? (Shared.formatDate(at) || "") : "")).trim();
    const fallbackDate = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const author = String(options.author || user?.name || user?.email || "").trim();
    const titleMap = {
      opinion: "담당자 의견",
      siteInspection: "현장실사",
      dailyIssue: "금일이슈사항",
    };
    return {
      kind: String(kind || "opinion").trim() || "opinion",
      title: String(options.title || titleMap[kind] || "담당자 의견").trim(),
      date: date || fallbackDate,
      at,
      text: body,
      author,
    };
  }

  function loadOpinionHistory(item) {
    const raw = item?._raw?.raw || item?.raw || {};
    const hist = raw.opinionHistory;
    if (Array.isArray(hist) && hist.length) {
      return hist.map((entry) => normalizeOpinionHistoryEntry(entry)).filter(Boolean);
    }
    const legacy = String(item?.opinion || raw.opinion || "").trim();
    if (legacy) {
      const entry = buildOpinionHistoryEntry("opinion", legacy, { name: "" }, { at: item?.createdAt || raw.firstRegisteredAt || new Date().toISOString() });
      return entry ? [entry] : [];
    }
    return [];
  }

  function appendOpinionEntry(history, newText, user, options = {}) {
    const entry = buildOpinionHistoryEntry(options.kind || "opinion", newText, user, options);
    if (!entry) return Array.isArray(history) ? history : [];
    return [...(Array.isArray(history) ? history : []), entry];
  }

  function getOpinionHistoryMeta(entry) {
    const kind = String(entry?.kind || "opinion").trim();
    if (kind === "siteInspection") return { badgeClass: "is-site", badgeLabel: "현장실사", title: "현장실사" };
    if (kind === "dailyIssue") return { badgeClass: "is-edit", badgeLabel: "금일이슈", title: "금일이슈사항" };
    return { badgeClass: "is-opinion", badgeLabel: "담당자 의견", title: "담당자 의견" };
  }

  function toTimelineTimestamp(value) {
    const s = String(value || "").trim();
    if (!s) return Number.POSITIVE_INFINITY;
    const time = Date.parse(s);
    if (Number.isFinite(time)) return time;
    const normalized = s.replace(/\./g, "-").replace(/\s+/g, "T");
    const nextTime = Date.parse(normalized);
    if (Number.isFinite(nextTime)) return nextTime;
    return Number.POSITIVE_INFINITY;
  }

  function buildCombinedPropertyLog(opinionHistory, registrationLog) {
    const opinions = Array.isArray(opinionHistory) ? opinionHistory : [];
    const regLogs = Array.isArray(registrationLog) ? registrationLog : [];
    const rows = [];

    opinions.forEach((entry, idx) => {
      const normalized = normalizeOpinionHistoryEntry(entry);
      if (!normalized) return;
      const meta = getOpinionHistoryMeta(normalized);
      rows.push({
        kind: "opinion",
        sortAt: toTimelineTimestamp(normalized.at || normalized.date),
        at: normalized.at || normalized.date || "",
        badgeClass: meta.badgeClass,
        badgeLabel: meta.badgeLabel,
        author: normalized.author,
        text: normalized.text,
        title: normalized.title || meta.title,
        order: idx,
      });
    });

    regLogs.forEach((entry, idx) => {
      const at = String(entry?.at || entry?.date || "").trim();
      const route = String(entry?.route || "").trim();
      const actor = String(entry?.actor || "").trim();
      const type = String(entry?.type || "").trim();
      const changes = (Array.isArray(entry?.changes) ? entry.changes : []).filter((change) => change?.field !== "submitterPhone" && change?.label !== "등록자 연락처");
      rows.push({
        kind: "registration",
        sortAt: toTimelineTimestamp(at),
        at,
        badgeClass: "is-registration",
        badgeLabel: "등록LOG",
        author: actor,
        title: type === "created" ? "최초 등록" : (route || "등록 정보 변경"),
        route,
        changes,
        order: idx,
      });
    });

    return rows.sort((a, b) => {
      if (a.sortAt !== b.sortAt) return a.sortAt - b.sortAt;
      return a.order - b.order;
    });
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

  function sanitizeJsonValue(value, depth = 0, seen) {
    if (value == null) return value;
    if (depth > 6) return undefined;
    const valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") return value;
    if (valueType !== "object") return undefined;
    const bag = seen || new WeakSet();
    if (bag.has(value)) return undefined;
    bag.add(value);
    try {
      if (Array.isArray(value)) {
        const out = [];
        for (const item of value.slice(0, 500)) {
          const next = sanitizeJsonValue(item, depth + 1, bag);
          if (next !== undefined) out.push(next);
        }
        return out;
      }
      const out = {};
      for (const [key, nextValue] of Object.entries(value)) {
        if (key === "raw") continue;
        const next = sanitizeJsonValue(nextValue, depth + 1, bag);
        if (next !== undefined) out[key] = next;
      }
      return out;
    } finally {
      bag.delete(value);
    }
  }

  function sanitizeOpinionHistoryEntries(history) {
    return (Array.isArray(history) ? history : [])
      .slice(-200)
      .map((entry) => ({
        date: String(entry?.date || "").trim(),
        text: String(entry?.text || "").trim(),
        author: String(entry?.author || "").trim(),
        kind: String(entry?.kind || "").trim(),
        title: String(entry?.title || "").trim(),
        at: String(entry?.at || "").trim(),
      }))
      .filter((entry) => entry.date || entry.text || entry.author || entry.kind || entry.title || entry.at);
  }

  function sanitizePropertyRawForSave(raw, overrides = {}) {
    const base = raw && typeof raw === "object" ? (sanitizeJsonValue(raw, 0) || {}) : {};
    if (base && typeof base === "object") delete base.raw;
    const merged = { ...(base || {}), ...(overrides || {}) };
    if (Array.isArray(merged.opinionHistory)) {
      merged.opinionHistory = sanitizeOpinionHistoryEntries(merged.opinionHistory);
    }
    return merged;
  }

  function getActorIdentity(user) {
    return {
      id: String(user?.id || user?.email || "").trim(),
      name: String(user?.name || user?.email || "").trim(),
    };
  }

  function normalizeStaffMember(item) {
    const normalizedRole = normalizeRoleValue(item?.role);
    return {
      id: item?.id || "",
      email: item?.email || "",
      name: item?.name || item?.email || "",
      position: String(item?.position || item?.jobTitle || item?.job_title || "").trim(),
      phone: String(item?.phone || item?.mobile || item?.mobile_phone || item?.phone_number || "").trim(),
      role: normalizedRole,
      assignedRegions: Array.isArray(item?.assignedRegions)
        ? item.assignedRegions
        : (Array.isArray(item?.assigned_regions) ? item.assigned_regions : []),
      createdAt: item?.createdAt || item?.created_at || "",
    };
  }

  function dedupeStaffMembers(items) {
    const seenIds = new Set();
    const seenEmails = new Set();
    const out = [];
    for (const raw of Array.isArray(items) ? items : []) {
      const item = normalizeStaffMember(raw);
      const idKey = String(item.id || "").trim();
      const emailKey = String(item.email || "").trim().toLowerCase();
      if (idKey && seenIds.has(idKey)) continue;
      if (emailKey && seenEmails.has(emailKey)) continue;
      if (idKey) seenIds.add(idKey);
      if (emailKey) seenEmails.add(emailKey);
      out.push(item);
    }
    return out;
  }

  function normalizeSourceType(rawValue, options = {}) {
    const fallback = String(options.fallback || "general").trim() || "general";
    const value = String(rawValue || "").trim().toLowerCase();
    if (!value) return fallback;
    if (["auction", "courtauction", "court_auction", "경매"].includes(value)) return "auction";
    if (["onbid", "public", "gongmae", "공매"].includes(value)) return "onbid";
    if (["realtor", "broker", "naver", "realtor_naver", "realtor_direct", "중개", "중개사", "네이버중개", "일반중개", "공인중개사"].includes(value)) return "realtor";
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

  function normalizeRegistrationSubmitterKind(rawValue, options = {}) {
    const fallback = String(options.fallback || "realtor").trim().toLowerCase() === "owner" ? "owner" : "realtor";
    const value = String(rawValue || "").trim().toLowerCase();
    if (!value) return fallback;
    if (["realtor", "broker", "agent", "중개", "중개사", "공인중개사"].includes(value)) return "realtor";
    if (["owner", "general", "user", "person", "일반", "소유", "소유자", "본인"].includes(value)) return "owner";
    return fallback;
  }

  function buildRegistrationSubmissionCore(input = {}, options = {}) {
    const defaultKind = String(options.defaultSubmitterKind || "realtor").trim().toLowerCase() === "owner" ? "owner" : "realtor";
    const submitterKind = normalizeRegistrationSubmitterKind(
      pickFirstText(
        input.submitterKind,
        input.submitter_kind,
        input.registrationKind,
        input.registration_kind,
        input.submitterType,
        input.submitter_type,
        defaultKind
      ),
      { fallback: defaultKind }
    );
    const submitterType = normalizeSubmitterType(
      pickFirstText(input.submitterType, input.submitter_type, ""),
      { fallback: submitterKind === "realtor" ? "realtor" : "owner" }
    );
    const sourceType = normalizePublicSourceType(
      pickFirstText(input.sourceType, input.source_type, ""),
      submitterType
    );

    return {
      submitterKind,
      sourceType,
      submitterType,
      address: pickFirstText(input.address, ""),
      assetType: pickFirstText(input.assetType, input.asset_type, ""),
      priceMain: toNullableNumber(input.priceMain ?? input.price_main),
      floor: pickFirstText(input.floor, "") || null,
      totalFloor: pickFirstText(input.totalFloor, input.totalfloor, input.total_floor, "") || null,
      commonArea: toNullableNumber(input.commonArea ?? input.common_area),
      exclusiveArea: toNullableNumber(input.exclusiveArea ?? input.exclusive_area),
      siteArea: toNullableNumber(input.siteArea ?? input.site_area),
      useApproval: pickFirstText(input.useApproval, input.use_approval, input.useapproval, "") || null,
      submitterName: pickFirstText(input.submitterName, input.submitter_name, "") || null,
      submitterPhone: pickFirstText(input.submitterPhone, input.submitter_phone, "") || null,
      realtorName: pickFirstText(input.realtorName, input.realtor_name, input.realtorname, input.brokerOfficeName, input.broker_office_name, "") || null,
      realtorPhone: pickFirstText(input.realtorPhone, input.realtor_phone, input.realtorphone, "") || null,
      realtorCell: pickFirstText(input.realtorCell, input.realtor_cell, input.realtorcell, "") || null,
      opinion: pickFirstText(input.opinion, input.memo, "") || null,
      actorName: pickFirstText(options.actorName, input.actorName, input.actor_name, "") || null,
      assigneeId: pickFirstText(options.assigneeId, input.assigneeId, input.assignee_id, "") || null,
    };
  }

  function validateRegistrationSubmissionCore(core, options = {}) {
    const data = core && typeof core === "object" ? core : buildRegistrationSubmissionCore(core, options);
    if (!data.address || !data.assetType || !data.priceMain) {
      return String(options.requiredMessage || "주소/세부유형/매매가를 입력해 주세요.");
    }
    if (data.submitterType === "realtor") {
      if (!data.realtorName || !data.realtorCell) {
        return String(options.realtorMessage || "중개사무소명과 휴대폰번호를 입력해 주세요.");
      }
    } else if (!data.submitterName || !data.submitterPhone) {
      return String(options.ownerMessage || "이름과 연락처를 입력해 주세요.");
    }
    return "";
  }

  function buildRegistrationSubmissionPackage(input = {}, options = {}) {
    const core = buildRegistrationSubmissionCore(input, options);
    const validationMessage = validateRegistrationSubmissionCore(core, options);
    return {
      core,
      validationMessage,
      payload: validationMessage ? null : buildRegistrationSubmissionPayload(core, options),
    };
  }

  function buildRegistrationSubmissionPayload(input = {}, options = {}) {
    const core = buildRegistrationSubmissionCore(input, options);
    const extraRaw = input.raw && typeof input.raw === "object" ? { ...input.raw } : {};
    const raw = {
      sourceType: core.sourceType,
      source_type: core.sourceType,
      submitterType: core.submitterType,
      submitter_type: core.submitterType,
      address: core.address,
      assetType: core.assetType,
      priceMain: core.priceMain,
      floor: core.floor,
      totalfloor: core.totalFloor,
      useapproval: core.useApproval,
      commonArea: core.commonArea,
      exclusiveArea: core.exclusiveArea,
      siteArea: core.siteArea,
      realtorName: core.realtorName,
      realtorPhone: core.realtorPhone,
      realtorCell: core.realtorCell,
      submitterName: core.submitterName,
      submitterPhone: core.submitterPhone,
      opinion: core.opinion,
      ...extraRaw,
    };

    if (hasMeaningfulValue(core.assigneeId)) {
      raw.assigneeId = core.assigneeId;
      raw.assignedAgentId = core.assigneeId;
    }
    if (options.registrationKind === "admin") raw.registeredByAdmin = true;
    if (options.registrationKind === "agent") raw.registeredByAgent = true;
    if (hasMeaningfulValue(core.actorName)) raw.registeredByName = core.actorName;

    const payload = {
      source_type: core.sourceType,
      is_general: core.sourceType === "general",
      submitter_type: core.submitterType,
      address: core.address,
      asset_type: core.assetType,
      price_main: core.priceMain,
      use_approval: core.useApproval,
      common_area: core.commonArea,
      exclusive_area: core.exclusiveArea,
      site_area: core.siteArea,
      broker_office_name: core.realtorName,
      submitter_name: core.submitterName,
      submitter_phone: core.submitterPhone,
      memo: core.opinion,
      raw,
    };
    if (hasMeaningfulValue(core.assigneeId)) payload.assignee_id = core.assigneeId;
    return payload;
  }

  function buildPublicListingPayload(input = {}, options = {}) {
    return buildRegistrationSubmissionCore(input, options);
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

  function getRawPayload(item) {
    if (!item || typeof item !== 'object') return {};
    if (item.raw && typeof item.raw === 'object') {
      if (item.raw.raw && typeof item.raw.raw === 'object') return item.raw.raw;
      return item.raw;
    }
    if (item._raw && typeof item._raw === 'object') {
      if (item._raw.raw && typeof item._raw.raw === 'object') return item._raw.raw;
      return item._raw;
    }
    return {};
  }

  function isDirectRealtorSubmission(item) {
    const raw = getRawPayload(item);
    const sourceType = inferSourceTypeFromContext({
      sourceType: item?.sourceType,
      source_type: item?.source_type,
      source: item?.source,
      category: item?.category,
      sourceUrl: item?.sourceUrl || item?.source_url || raw?.sourceUrl || raw?.source_url,
      globalId: item?.globalId || item?.global_id || raw?.globalId || raw?.global_id,
      submitterType: item?.submitterType || item?.submitter_type || raw?.submitterType || raw?.submitter_type,
      isGeneral: item?.isGeneral || item?.is_general || raw?.isGeneral || raw?.is_general,
      brokerOfficeName: item?.brokerOfficeName || item?.broker_office_name || raw?.brokerOfficeName || raw?.broker_office_name,
      raw,
    });
    if (sourceType !== "realtor") return false;
    const submitterType = normalizeSubmitterType(
      item?.submitterType || item?.submitter_type || raw?.submitterType || raw?.submitter_type || "",
      { fallback: "" }
    );
    const rawSource = String(item?.sourceBucket || item?.source_bucket || item?.rawSource || item?.raw_source || item?.sourceType || item?.source_type || raw?.sourceBucket || raw?.source_bucket || raw?.sourceType || raw?.source_type || item?.source || item?.category || raw?.source || raw?.category || "").trim().toLowerCase();
    if (["realtor_direct"].includes(rawSource)) return true;
    if (["realtor_naver", "naver", "broker"].includes(rawSource)) return false;
    const sourceUrl = pickFirstText(item?.sourceUrl, item?.source_url, raw?.sourceUrl, raw?.source_url, raw?.url, raw?.["바로가기(엑셀)"], raw?.["매물URL"], "");
    if (sourceUrl) return false;
    if (submitterType === "realtor") return true;
    const submitterName = pickFirstText(item?.submitterName, item?.submitter_name, raw?.submitterName, raw?.submitter_type, item?.brokerOfficeName, item?.broker_office_name, raw?.brokerOfficeName, raw?.broker_office_name, "");
    return !!submitterName;
  }

  function getSourceBucket(item) {
    const explicitBucket = String(item?.sourceBucket || item?.source_bucket || item?._raw?.sourceBucket || item?._raw?.source_bucket || '').trim();
    if (["auction", "onbid", "realtor_naver", "realtor_direct", "general", "realtor"].includes(explicitBucket)) {
      return explicitBucket === 'realtor' ? 'realtor_naver' : explicitBucket;
    }
    const raw = getRawPayload(item);
    const sourceType = inferSourceTypeFromContext({
      sourceType: item?.sourceType,
      source_type: item?.source_type,
      source: item?.source,
      category: item?.category,
      sourceUrl: item?.sourceUrl || item?.source_url || raw?.sourceUrl || raw?.source_url,
      globalId: item?.globalId || item?.global_id || raw?.globalId || raw?.global_id,
      submitterType: item?.submitterType || item?.submitter_type || raw?.submitterType || raw?.submitter_type,
      isGeneral: item?.isGeneral || item?.is_general || raw?.isGeneral || raw?.is_general,
      brokerOfficeName: item?.brokerOfficeName || item?.broker_office_name || raw?.brokerOfficeName || raw?.broker_office_name,
      raw,
      rawSource: item?.rawSource || item?.raw_source || raw?.sourceType || raw?.source_type || raw?.source || raw?.category,
    });
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

  function getSourceBucketClass(bucket) {
    const key = String(bucket || "").trim();
    if (key === "auction") return "kind-auction";
    if (key === "onbid") return "kind-gongmae";
    if (key === "realtor_naver") return "kind-realtor-naver";
    if (key === "realtor_direct") return "kind-realtor-direct";
    return "kind-general";
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

  function getCurrentPriceValue(item) {
    const low = toNullableNumber(
      item?.lowprice ?? item?.low_price ?? item?.lowPrice ??
      item?.currentPrice ?? item?.current_price ??
      item?._raw?.lowprice ?? item?._raw?.low_price ?? item?._raw?.lowPrice ??
      item?.raw?.lowprice ?? item?.raw?.low_price ?? item?.raw?.lowPrice
    );
    if (low != null && low > 0) return low;
    return toNullableNumber(item?.priceMain ?? item?.price_main ?? item?.appraisalPrice ?? item?.appraisal_price ?? item?._raw?.priceMain ?? item?._raw?.price_main) || 0;
  }

  function getRatioValue(item) {
    const appraisal = toNullableNumber(item?.priceMain ?? item?.price_main ?? item?.appraisalPrice ?? item?.appraisal_price ?? item?._raw?.priceMain ?? item?._raw?.price_main) || 0;
    const current = getCurrentPriceValue(item);
    if (appraisal > 0 && current > 0) return current / appraisal;
    const rawRate = item?.raw?.bidRate ?? item?.raw?.rate ?? item?.raw?.["최저입찰가율(%)"] ?? item?._raw?.bidRate ?? item?._raw?.rate ?? item?._raw?.["최저입찰가율(%)"];
    const numeric = Number(String(rawRate ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? numeric / 100 : -1;
  }

  function getFloorDisplayValue(item) {
    const floor = pickFirstText(item?.floor, item?.floorText, item?.raw?.floor, item?.raw?.floorText, item?._raw?.floor, item?._raw?.floorText, '');
    const total = pickFirstText(item?.totalfloor, item?.total_floor, item?.totalFloor, item?.totalFloorText, item?.raw?.totalfloor, item?.raw?.total_floor, item?.raw?.totalFloor, item?._raw?.totalfloor, item?._raw?.total_floor, item?._raw?.totalFloor, '');
    if (floor && total) {
      if (floor.includes('/')) return floor;
      return `${floor}/${total}`;
    }
    return floor || total || '';
  }

  function buildPropertyListViewModel(item = {}) {
    const bucket = getSourceBucket(item);
    return {
      sourceBucket: bucket,
      kindLabel: getSourceBucketLabel(bucket),
      kindClass: getSourceBucketClass(bucket),
      itemNo: pickFirstText(item?.itemNo, item?.item_no, item?.globalId, item?.global_id, '-'),
      address: pickFirstText(item?.address, item?.roadAddress, item?.road_address, item?.raw?.address, item?._raw?.address, '-'),
      assetType: pickFirstText(item?.assetType, item?.asset_type, item?.type, item?.raw?.assetType, item?.raw?.asset_type, item?._raw?.assetType, item?._raw?.asset_type, '-'),
      floorText: getFloorDisplayValue(item),
      appraisalPriceValue: toNullableNumber(item?.priceMain ?? item?.price_main ?? item?.appraisalPrice ?? item?.appraisal_price ?? item?._raw?.priceMain ?? item?._raw?.price_main),
      currentPriceValue: getCurrentPriceValue(item),
      ratioValue: getRatioValue(item),
      exclusiveAreaValue: toNullableNumber(item?.exclusivearea ?? item?.exclusive_area ?? item?.exclusiveArea ?? item?._raw?.exclusivearea ?? item?._raw?.exclusive_area),
      commonAreaValue: toNullableNumber(item?.commonarea ?? item?.common_area ?? item?.commonArea ?? item?._raw?.commonarea ?? item?._raw?.common_area),
      siteAreaValue: toNullableNumber(item?.sitearea ?? item?.site_area ?? item?.siteArea ?? item?._raw?.sitearea ?? item?._raw?.site_area),
      useApprovalValue: pickFirstText(item?.useapproval, item?.use_approval, item?.useApproval, item?._raw?.useapproval, item?._raw?.use_approval, item?._raw?.useApproval, ''),
      createdAtValue: pickFirstText(item?.createdAt, item?.created_at, item?.dateUploaded, item?.date_uploaded, item?._raw?.created_at, item?._raw?.date_uploaded, ''),
    };
  }

  function matchesSourceSelection(item, selected) {
    const key = String(selected || '').trim();
    if (!key || key === 'all') return true;
    const bucket = getSourceBucket(item);
    if (key === 'realtor') return bucket === 'realtor_naver' || bucket === 'realtor_direct';
    return bucket === key;
  }

  function matchesKeyword(item, keyword, options = {}) {
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return true;
    const fields = Array.isArray(options.fields) && options.fields.length
      ? options.fields
      : ['address', 'assignedAgentName', 'regionGu', 'regionDong', 'type', 'assetType', 'rightsAnalysis', 'siteInspection', 'opinion', 'memo', 'submitterName', 'brokerOfficeName'];
    const hay = fields
      .map((field) => {
        if (typeof field === 'function') {
          try { return field(item); } catch (_) { return ''; }
        }
        return item?.[field];
      })
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  }


  const PROPERTY_SOURCE_FILTER_OPTIONS = [
    { value: '', label: '전체' },
    { value: 'auction', label: '경매' },
    { value: 'onbid', label: '공매' },
    { value: 'realtor_naver', label: '네이버중개' },
    { value: 'realtor_direct', label: '일반중개' },
    { value: 'general', label: '일반' },
  ];

  const PROPERTY_AREA_FILTER_OPTIONS = [
    { value: '', label: '전체 면적' },
    { value: '0-5', label: '5평 미만' },
    { value: '5-10', label: '5~10평' },
    { value: '10-20', label: '10~20평' },
    { value: '20-30', label: '20~30평' },
    { value: '30-50', label: '30~50평' },
    { value: '50-100', label: '50평~100평미만' },
    { value: '100-', label: '100평 이상' },
  ];

  const PROPERTY_PRICE_FILTER_OPTIONS = [
    { value: '', label: '전체 가격' },
    { value: '0-1', label: '1억 미만' },
    { value: '1-3', label: '1~3억' },
    { value: '3-5', label: '3~5억' },
    { value: '5-10', label: '5~10억' },
    { value: '10-20', label: '10~20억' },
    { value: '20-', label: '20억 이상' },
  ];

  const PROPERTY_RATIO_FILTER_OPTIONS = [
    { value: '', label: '전체 비율' },
    { value: '50', label: '50% 이하' },
  ];

  function matchesAreaFilter(value, area) {
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = parseFloat(minStr) || 0;
    const max = maxStr ? parseFloat(maxStr) : Infinity;
    const numericArea = Number(area);
    if (!Number.isFinite(numericArea) || numericArea <= 0) return false;
    return numericArea >= min && (max === Infinity || numericArea < max);
  }

  function getPropertyEffectivePrice(row) {
    const sourceType = normalizeSourceType(row?.sourceType || row?.source_type || row?._raw?.sourceType || row?._raw?.source_type || '', { fallback: '' });
    const isAuctionType = sourceType === 'auction' || sourceType === 'onbid';
    return isAuctionType ? getCurrentPriceValue(row) : (toNullableNumber(row?.priceMain ?? row?.price_main ?? row?.appraisalPrice ?? row?.appraisal_price ?? row?._raw?.priceMain ?? row?._raw?.price_main) || 0);
  }

  function matchesPriceRangeFilter(value, row) {
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = (parseFloat(minStr) || 0) * 100000000;
    const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
    const price = getPropertyEffectivePrice(row);
    if (!price || price <= 0) return false;
    return price >= min && (max === Infinity || price < max);
  }

  function matchesRatioFilter(value, row) {
    if (!value) return true;
    const sourceType = normalizeSourceType(row?.sourceType || row?.source_type || row?._raw?.sourceType || row?._raw?.source_type || '', { fallback: '' });
    if (sourceType !== 'auction' && sourceType !== 'onbid') return false;
    const ratio = getRatioValue(row);
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 0.5;
  }

  function matchesTodayBidFilter(enabled, row, todayKey = '') {
    if (!enabled) return true;
    const sourceType = normalizeSourceType(row?.sourceType || row?.source_type || row?._raw?.sourceType || row?._raw?.source_type || '', { fallback: '' });
    if (sourceType !== 'auction' && sourceType !== 'onbid') return false;
    const text = String(row?.dateMain || row?.date_main || row?._raw?.dateMain || row?._raw?.date_main || '').trim();
    const key = String(todayKey || '').trim();
    if (!key) return false;
    return text.startsWith(key);
  }

  function applyPropertyFilters(rows, filters = {}, options = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const ignoreKeys = new Set(Array.isArray(options?.ignoreKeys) ? options.ignoreKeys : []);
    const keywordFields = Array.isArray(options?.keywordFields) ? options.keywordFields : undefined;
    const isFavorite = typeof options?.isFavorite === 'function' ? options.isFavorite : null;
    const todayKey = String(options?.todayKey || '').trim();
    return list.filter((row) => {
      const sourceKey = filters.activeCard ?? filters.source ?? '';
      if (!ignoreKeys.has('activeCard') && !ignoreKeys.has('source') && sourceKey) {
        if (!matchesSourceSelection(row, sourceKey)) return false;
      }
      if (!ignoreKeys.has('status') && filters.status) {
        const status = String(row?.status || '').trim();
        const selected = String(filters.status || '').trim();
        if (status !== selected && !status.includes(selected)) return false;
      }
      if (!ignoreKeys.has('area') && filters.area) {
        const areaValue = row?.exclusivearea ?? row?.exclusive_area ?? row?.exclusiveArea ?? row?._raw?.exclusivearea ?? row?._raw?.exclusive_area;
        if (!matchesAreaFilter(filters.area, areaValue)) return false;
      }
      if (!ignoreKeys.has('priceRange') && filters.priceRange) {
        if (!matchesPriceRangeFilter(filters.priceRange, row)) return false;
      }
      if (!ignoreKeys.has('ratio50') && filters.ratio50) {
        if (!matchesRatioFilter(filters.ratio50, row)) return false;
      }
      if (!ignoreKeys.has('todayBid') && filters.todayBid) {
        if (!matchesTodayBidFilter(filters.todayBid, row, todayKey)) return false;
      }
      if (!ignoreKeys.has('favOnly') && filters.favOnly && isFavorite && !isFavorite(row)) return false;
      if (!ignoreKeys.has('keyword') && filters.keyword) {
        if (!matchesKeyword(row, filters.keyword, { fields: keywordFields })) return false;
      }
      return true;
    });
  }



  function normalizeRoleValue(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === '관리자' || v === 'admin') return 'admin';
    if (v === '기타' || v === 'other') return 'other';
    return 'staff';
  }

  function normalizeRegionToken(value) {
    const s = String(value || '').trim().replace(/\s+/g, ' ');
    return s || '';
  }

  function normalizeAssignedRegions(values) {
    if (!Array.isArray(values)) return [];
    const out = [];
    const seen = new Set();
    for (const value of values) {
      const token = normalizeRegionToken(value);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }

  function extractAddressRegionParts(address) {
    const text = String(address || '').replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return { gu: '', dong: '' };
    const gu = (text.match(/[가-힣]+(?:구|군|시)/) || [])[0] || '';
    const dong = (text.match(/[가-힣0-9]+(?:동|읍|면|가)/) || [])[0] || '';
    return { gu, dong };
  }

  function getPropertyRegionTokens(row = {}) {
    const tokens = [];
    const seen = new Set();
    const add = (v) => {
      const token = normalizeRegionToken(v);
      if (!token || seen.has(token)) return;
      seen.add(token);
      tokens.push(token);
    };
    add(row.regionGu);
    add(row.regionDong);
    const addrParts = extractAddressRegionParts(row.address);
    add(addrParts.gu);
    add(addrParts.dong);
    return tokens;
  }

  function buildStaffAssignmentEntries(staffItems, assignItems) {
    const map = new Map();
    const staff = Array.isArray(staffItems) ? staffItems : [];
    const assignments = Array.isArray(assignItems) ? assignItems : [];
    const assignById = new Map(assignments.map((row) => [String(row?.id || '').trim(), row]));
    staff.forEach((row) => {
      const role = normalizeRoleValue(row?.role);
      if (role !== 'staff') return;
      const id = String(row?.id || '').trim();
      if (!id) return;
      const assignRow = assignById.get(id);
      const name = String(row?.name || row?.email || '').trim() || `담당자 ${map.size + 1}`;
      map.set(id, {
        id,
        role: 'staff',
        email: String(row?.email || '').trim(),
        name,
        regions: normalizeAssignedRegions(assignRow?.assignedRegions || assignRow?.regions || row?.assignedRegions || row?.regions || row?.assigned_regions),
      });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  function buildAgentChartEntries(rows, staffAssignments) {
    const staff = (Array.isArray(staffAssignments) ? staffAssignments : []).filter((row) => normalizeRoleValue(row?.role) === 'staff');
    const byId = new Map();

    const ensureEntry = (id, name, regions = []) => {
      const key = String(id || '').trim() || String(name || '').trim();
      if (!key) return null;
      if (!byId.has(key)) {
        byId.set(key, {
          id: key,
          name: String(name || key).trim() || '담당자',
          regions: normalizeAssignedRegions(regions),
          auction: 0,
          onbid: 0,
          realtor: 0,
          general: 0,
          total: 0,
        });
      }
      const entry = byId.get(key);
      if ((!entry.name || entry.name === entry.id) && name) entry.name = String(name).trim() || entry.name;
      if ((!entry.regions || !entry.regions.length) && Array.isArray(regions) && regions.length) {
        entry.regions = normalizeAssignedRegions(regions);
      }
      return entry;
    };

    staff.forEach((staffRow) => ensureEntry(staffRow.id, staffRow.name, staffRow.regions || []));

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      let entry = null;
      const assignedId = String(row?.assignedAgentId || '').trim();
      const assignedName = String(row?.assignedAgentName || '').trim();
      if (assignedId && byId.has(assignedId)) {
        entry = byId.get(assignedId);
      } else if (assignedName) {
        const found = [...byId.values()].find((item) => item.name === assignedName);
        if (found) entry = found;
      }
      if (!entry) {
        const tokens = getPropertyRegionTokens(row);
        const matched = staff.find((item) => item.regions?.length && item.regions.some((region) => tokens.includes(region)));
        if (matched) entry = ensureEntry(matched.id, matched.name, matched.regions || []);
      }
      if (!entry) return;
      const src = ['auction', 'onbid', 'realtor', 'general'].includes(row?.source) ? row.source : 'general';
      entry[src] = (entry[src] || 0) + 1;
      entry.total += 1;
    });

    return [...byId.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko'));
  }

  function getRegistrationRawObject(input) {
    if (input?._raw?.raw && typeof input._raw.raw === "object") return input._raw.raw;
    if (input?.raw && typeof input.raw === "object") return input.raw;
    return {};
  }

  function buildRegistrationSnapshot(input = {}) {
    const container = input?._raw && typeof input._raw === "object" ? input._raw : (input || {});
    const raw = getRegistrationRawObject(input);
    return {
      itemNo: pickFirstText(input?.itemNo, input?.item_no, container?.item_no, container?.itemNo, raw.itemNo, raw.item_no, ""),
      address: pickFirstText(input?.address, container?.address, raw.address, ""),
      assetType: pickFirstText(input?.assetType, input?.asset_type, container?.asset_type, container?.assetType, raw.assetType, raw.asset_type, raw["세부유형"], ""),
      floor: pickFirstText(raw.floor, input?.floor, container?.floor, ""),
      totalfloor: pickFirstText(raw.totalfloor, raw.total_floor, raw.totalFloor, input?.total_floor, input?.totalfloor, container?.total_floor, container?.totalfloor, ""),
      commonArea: input?.commonArea ?? input?.common_area ?? container?.common_area ?? container?.commonArea ?? raw.commonArea ?? raw.commonarea ?? raw.common_area ?? null,
      exclusiveArea: input?.exclusiveArea ?? input?.exclusive_area ?? container?.exclusive_area ?? container?.exclusiveArea ?? raw.exclusiveArea ?? raw.exclusivearea ?? raw.exclusive_area ?? null,
      siteArea: input?.siteArea ?? input?.site_area ?? container?.site_area ?? container?.siteArea ?? raw.siteArea ?? raw.sitearea ?? raw.site_area ?? null,
      useapproval: pickFirstText(input?.useApproval, input?.use_approval, container?.use_approval, container?.useapproval, raw.useapproval, raw.useApproval, raw.use_approval, ""),
      status: pickFirstText(input?.status, container?.status, raw.status, ""),
      priceMain: input?.priceMain ?? input?.price_main ?? container?.price_main ?? container?.priceMain ?? raw.priceMain ?? raw.price_main ?? null,
      lowprice: input?.lowprice ?? input?.low_price ?? container?.lowprice ?? container?.low_price ?? raw.lowprice ?? raw.low_price ?? null,
      dateMain: pickFirstText(input?.dateMain, input?.date_main, container?.date_main, container?.dateMain, raw.dateMain, raw.date_main, ""),
      sourceUrl: pickFirstText(input?.sourceUrl, input?.source_url, container?.source_url, container?.sourceUrl, raw.sourceUrl, raw.source_url, raw.url, raw["바로가기(엑셀)"], raw["매물URL"], ""),
      realtorName: pickFirstText(input?.realtorName, input?.realtorname, input?.broker_office_name, container?.broker_office_name, container?.brokerOfficeName, raw.realtorName, raw.realtorname, raw.brokerOfficeName, raw.broker_office_name, ""),
      realtorPhone: pickFirstText(input?.realtorPhone, input?.realtorphone, raw.realtorPhone, raw.realtorphone, ""),
      realtorCell: pickFirstText(input?.realtorCell, input?.realtorcell, input?.submitter_phone, container?.submitter_phone, raw.realtorCell, raw.realtorcell, raw.submitterPhone, raw.submitter_phone, ""),
      submitterName: pickFirstText(input?.submitterName, input?.submitter_name, container?.submitter_name, raw.registeredByName, raw.submitterName, raw.submitter_name, ""),
      submitterPhone: pickFirstText(input?.submitterPhone, input?.submitter_phone, container?.submitter_phone, raw.submitterPhone, raw.submitter_phone, ""),
      memo: pickFirstText(input?.memo, input?.opinion, container?.memo, raw.memo, raw.opinion, ""),
      latitude: input?.latitude ?? container?.latitude ?? raw.latitude ?? null,
      longitude: input?.longitude ?? container?.longitude ?? raw.longitude ?? null,
      raw,
    };
  }

  function syncRegistrationRawMeta(raw = {}, row = {}) {
    const nextRaw = { ...(raw || {}) };
    const sourceType = normalizeSourceType(row?.source_type || row?.sourceType || nextRaw.source_type || nextRaw.sourceType || "", { fallback: "" });
    const submitterType = normalizeSubmitterType(row?.submitter_type || row?.submitterType || nextRaw.submitter_type || nextRaw.submitterType || "", { fallback: "" });
    if (sourceType) {
      nextRaw.sourceType = sourceType;
      nextRaw.source_type = sourceType;
    }
    if (submitterType) {
      nextRaw.submitterType = submitterType;
      nextRaw.submitter_type = submitterType;
    }
    return nextRaw;
  }

  function buildRegistrationDbRowForCreate(row, context = {}, options = {}) {
    const nextRow = { ...(row || {}) };
    const sourceType = normalizeSourceType(nextRow?.source_type || nextRow?.sourceType || nextRow?.raw?.source_type || nextRow?.raw?.sourceType || "", { fallback: "" });
    if (sourceType) {
      nextRow.source_type = sourceType;
      nextRow.is_general = sourceType === "general";
    }
    const submitterType = normalizeSubmitterType(nextRow?.submitter_type || nextRow?.submitterType || nextRow?.raw?.submitter_type || nextRow?.raw?.submitterType || "", { fallback: "" });
    if (submitterType) nextRow.submitter_type = submitterType;
    const baseRaw = syncRegistrationRawMeta(nextRow?.raw || {}, nextRow);
    nextRow.raw = attachRegistrationIdentity(ensureRegistrationCreatedLog(baseRaw, context), nextRow);
    return nextRow;
  }

  function buildRegistrationDbRowForExisting(existingItem, incomingRow, context = {}, options = {}) {
    const baseContainer = existingItem?._raw && typeof existingItem._raw === "object"
      ? existingItem._raw
      : (existingItem && typeof existingItem === "object" ? existingItem : {});
    const base = { ...baseContainer, raw: { ...getRegistrationRawObject(existingItem) } };
    const prevSnapshot = buildRegistrationSnapshot(existingItem || base);
    const nextSnapshot = buildRegistrationSnapshot(incomingRow);
    const labels = options.labels || REGISTRATION_LOG_LABELS_BASE;
    const changeOptions = {
      amountFields: options.amountFields || ["priceMain", "lowprice"],
      numericFields: options.numericFields || ["priceMain", "lowprice", "commonArea", "exclusiveArea", "siteArea", "latitude", "longitude"],
    };
    const changes = buildRegistrationChanges(prevSnapshot, nextSnapshot, labels, changeOptions);
    const nextRow = { ...base };
    const copyFields = Array.isArray(options.copyFields) && options.copyFields.length
      ? options.copyFields
      : [
          "address", "asset_type", "exclusive_area", "common_area", "site_area", "use_approval", "status", "price_main", "lowprice",
          "date_main", "source_url", "broker_office_name", "submitter_name", "submitter_phone", "memo", "latitude", "longitude",
          "floor", "total_floor", "item_no", "source_type", "submitter_type", "assignee_id",
        ];
    for (const key of copyFields) {
      if (key === "assignee_id" && options.assignIfEmpty) {
        if (!hasMeaningfulValue(nextRow.assignee_id) && hasMeaningfulValue(incomingRow?.assignee_id)) nextRow.assignee_id = incomingRow.assignee_id;
        continue;
      }
      if (!hasMeaningfulValue(nextRow[key]) && key === "item_no" && hasMeaningfulValue(incomingRow?.[key])) {
        nextRow[key] = incomingRow[key];
        continue;
      }
      if (hasMeaningfulValue(incomingRow?.[key])) nextRow[key] = incomingRow[key];
    }

    const sourcePriority = options.sourcePriority || { "": 0, general: 1, realtor: 2, onbid: 3, auction: 4 };
    const currentSourceType = normalizeSourceType(nextRow.source_type || nextRow.sourceType || base?.raw?.source_type || base?.raw?.sourceType || "", { fallback: "" });
    const incomingSourceType = normalizeSourceType(incomingRow?.source_type || incomingRow?.sourceType || incomingRow?.raw?.source_type || incomingRow?.raw?.sourceType || "", { fallback: "" });
    if (incomingSourceType) {
      if (!currentSourceType || (sourcePriority[incomingSourceType] || 0) > (sourcePriority[currentSourceType] || 0)) nextRow.source_type = incomingSourceType;
      else if (!hasMeaningfulValue(nextRow.source_type)) nextRow.source_type = incomingSourceType;
    }

    const currentSubmitterType = normalizeSubmitterType(nextRow.submitter_type || nextRow.submitterType || base?.raw?.submitter_type || base?.raw?.submitterType || "", { fallback: "" });
    const incomingSubmitterType = normalizeSubmitterType(incomingRow?.submitter_type || incomingRow?.submitterType || incomingRow?.raw?.submitter_type || incomingRow?.raw?.submitterType || "", { fallback: "" });
    if (incomingSubmitterType === "realtor" || (!currentSubmitterType && incomingSubmitterType)) nextRow.submitter_type = incomingSubmitterType;
    if (hasMeaningfulValue(nextRow.source_type)) nextRow.is_general = normalizeSourceType(nextRow.source_type, { fallback: "" }) === "general";

    const mergedRaw = syncRegistrationRawMeta(mergeMeaningfulShallow(base.raw || {}, incomingRow?.raw || {}), {
      source_type: nextRow.source_type,
      submitter_type: nextRow.submitter_type,
    });
    nextRow.raw = attachRegistrationIdentity(appendRegistrationLog(mergedRaw, context, changes), nextSnapshot);
    return { row: nextRow, changes };
  }


  function normalizePropertyPhoto(row) {
    const item = row && typeof row === 'object' ? row : {};
    return {
      id: String(item.id || '').trim(),
      propertyId: Number(item.propertyId ?? item.property_id ?? 0) || null,
      propertyGlobalId: String(item.propertyGlobalId || item.property_global_id || '').trim() || null,
      thumbUrl: String(item.thumbUrl || item.thumb_url || '').trim(),
      originalUrl: String(item.originalUrl || item.original_url || '').trim(),
      thumbPath: String(item.thumbPath || item.thumb_path || '').trim(),
      storagePath: String(item.storagePath || item.storage_path || '').trim(),
      mimeType: String(item.mimeType || item.mime_type || 'image/webp').trim(),
      width: Number(item.width || 0) || null,
      height: Number(item.height || 0) || null,
      sizeBytes: Number(item.sizeBytes || item.size_bytes || 0) || null,
      sortOrder: Number(item.sortOrder ?? item.sort_order ?? 0) || 0,
      isPrimary: !!(item.isPrimary ?? item.is_primary),
      createdAt: item.createdAt || item.created_at || '',
      updatedAt: item.updatedAt || item.updated_at || '',
    };
  }

  function normalizePropertyPhotoList(rows) {
    return (Array.isArray(rows) ? rows : []).map(normalizePropertyPhoto).filter((row) => row.id).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  function buildPropertyPhotoCommitPayload(prepared, optimized) {
    return {
      photoId: String(prepared?.photoId || '').trim(),
      storagePath: String(prepared?.storagePath || '').trim(),
      thumbPath: String(prepared?.thumbPath || '').trim(),
      mimeType: String(optimized?.mimeType || 'image/webp').trim(),
      width: Number(optimized?.width || 0) || null,
      height: Number(optimized?.height || 0) || null,
      sizeBytes: Number(optimized?.sizeBytes || 0) || null,
      originalDataUrl: String(optimized?.originalDataUrl || '').trim(),
      thumbDataUrl: String(optimized?.thumbDataUrl || '').trim(),
    };
  }


  return {
    pickFirstText,
    compactAddressText,
    extractFloorText,
    sanitizeOnbidOpinion,
    usesDedicatedSourceNote,
    getDedicatedSourceNoteLabel,
    extractDedicatedSourceNote,
    stripDedicatedSourceNoteEcho,
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
    normalizeOpinionHistoryEntry,
    buildOpinionHistoryEntry,
    loadOpinionHistory,
    appendOpinionEntry,
    getOpinionHistoryMeta,
    buildCombinedPropertyLog,
    PROPERTY_DUPLICATE_INDEX_NAMES,
    collectPropertyErrorFragments,
    detectPropertyDuplicateIndexName,
    isPropertyDuplicateError,
    normalizePropertyDuplicateError,
    sanitizeJsonValue,
    sanitizeOpinionHistoryEntries,
    sanitizePropertyRawForSave,
    getActorIdentity,
    normalizeStaffMember,
    dedupeStaffMembers,
    REGISTRATION_LOG_LABELS_BASE,
    REGISTRATION_LOG_LABELS_ADMIN,
    REGISTRATION_LOG_LABELS_AGENT,
    REGISTRATION_LOG_LABELS_PUBLIC,
    normalizeSourceType,
    normalizeSubmitterType,
    normalizePublicSourceType,
    normalizeRegistrationSubmitterKind,
    buildRegistrationSubmissionCore,
    validateRegistrationSubmissionCore,
    buildRegistrationSubmissionPackage,
    buildRegistrationSubmissionPayload,
    buildPublicListingPayload,
    isBrokerLikeSource,
    isAuctionLikeSource,
    isGeneralSourceType,
    isDirectRealtorSubmission,
    getSourceBucket,
    getSourceTypeLabel,
    getSourceBucketLabel,
    getSourceBucketClass,
    matchesSourceBucket,
    matchesSourceSelection,
    matchesKeyword,
    PROPERTY_SOURCE_FILTER_OPTIONS,
    PROPERTY_AREA_FILTER_OPTIONS,
    PROPERTY_PRICE_FILTER_OPTIONS,
    PROPERTY_RATIO_FILTER_OPTIONS,
    matchesAreaFilter,
    getPropertyEffectivePrice,
    matchesPriceRangeFilter,
    matchesRatioFilter,
    matchesTodayBidFilter,
    applyPropertyFilters,
    summarizeSourceBuckets,
    getCurrentPriceValue,
    getRatioValue,
    getFloorDisplayValue,
    buildPropertyListViewModel,
    normalizeRoleValue,
    normalizeRegionToken,
    normalizeAssignedRegions,
    extractAddressRegionParts,
    getPropertyRegionTokens,
    buildStaffAssignmentEntries,
    buildAgentChartEntries,
    buildRegistrationSnapshot,
    buildRegistrationDbRowForCreate,
    buildRegistrationDbRowForExisting,
    normalizePropertyPhoto,
    normalizePropertyPhotoList,
    buildPropertyPhotoCommitPayload,
  };
});
