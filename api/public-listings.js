const { applyCors } = require('./_lib/cors');
const { getStore } = require('./_lib/store');
const {
  send,
  getJsonBody,
  normalizeAddress,
  normalizePhone,
  extractGuDong,
  id,
  nowIso,
} = require('./_lib/utils');
const { hasSupabaseAdminEnv, getEnv, verifySupabaseUser } = require('./_lib/supabase-admin');
const { getClientIp, checkRateLimitMany } = require('./_lib/rate-limit');
const PropertyDomain = require('../knson-property-domain.js');

// =============================================================================
// platform 회원용 지도 매물 조회 (GET ?mode=map) — 2026-05-12 Phase C-2 통합
// =============================================================================
// Vercel Hobby 플랜의 Serverless Function 12 개 한도 회피를 위해
// 별도 파일(api/public/properties.js) 대신 본 파일에 통합.
// POST 의 매물 등록 흐름과 완전히 분리되어 있어 상호 간섭 없음.
//
// PII 제거 정책 — DB SELECT 단계에서 안전 컬럼만 추림 + normalize 단계에서 한번 더 차단
const PUBLIC_MAP_SELECT_COLUMNS = [
  'id', 'global_id', 'item_no',
  'source_type', 'source_url', 'is_general',
  'address', 'asset_type', 'tankauction_category',
  'floor', 'total_floor', 'use_approval',
  'common_area', 'exclusive_area', 'site_area',
  'status', 'price_main', 'lowprice', 'date_main',
  'latitude', 'longitude',
  'created_at', 'date_uploaded',
  'result_status', 'result_price', 'result_date',
].join(',');

function buildSupabaseHeadersForPublicMap() {
  const { serviceRoleKey } = getEnv();
  return {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
}

async function supabaseRestForPublicMap(path) {
  const { url } = getEnv();
  if (!url) throw new Error('SUPABASE_URL 이 설정되지 않았습니다.');
  const res = await fetch(`${url}${path}`, {
    method: 'GET',
    headers: buildSupabaseHeadersForPublicMap(),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  if (!res.ok) {
    const message = (data && (data.message || data.msg || data.error_description || data.error))
      || `Supabase API 오류 (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function pmToFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pmClassifySourceBucket(row) {
  if (row && row.is_general === true) return 'general';
  const t = String((row && row.source_type) || '').toLowerCase();
  if (t === 'auction') return 'auction';
  if (t === 'onbid') return 'onbid';
  if (t === 'realtor_naver') return 'realtor_naver';
  if (t === 'realtor_direct' || t === 'realtor') return 'realtor_direct';
  return 'general';
}

function pmNormalizeRow(row) {
  return {
    id: String(row.id || ''),
    globalId: String(row.global_id || ''),
    itemNo: String(row.item_no || ''),
    source: String(row.source_type || 'general'),
    sourceBucket: pmClassifySourceBucket(row),
    sourceUrl: String(row.source_url || ''),
    address: String(row.address || ''),
    type: String(row.asset_type || ''),
    tankauctionCategory: String(row.tankauction_category || ''),
    status: String(row.status || ''),
    floor: String(row.floor || ''),
    totalFloor: String(row.total_floor || ''),
    useapproval: String(row.use_approval || ''),
    exclusivearea: pmToFiniteNumber(row.exclusive_area),
    commonarea: pmToFiniteNumber(row.common_area),
    sitearea: pmToFiniteNumber(row.site_area),
    appraisalPrice: pmToFiniteNumber(row.price_main),
    currentPrice: pmToFiniteNumber(row.lowprice),
    bidDate: String(row.date_main || ''),
    resultStatus: String(row.result_status || ''),
    resultPrice: pmToFiniteNumber(row.result_price),
    resultDate: String(row.result_date || ''),
    latitude: pmToFiniteNumber(row.latitude),
    longitude: pmToFiniteNumber(row.longitude),
    createdAt: String(row.created_at || row.date_uploaded || ''),
    valuation: null,
  };
}

async function handlePublicMapRequest(req, res) {
  // 1) JWT 검증
  let user;
  try {
    user = await verifySupabaseUser(req);
  } catch (err) {
    return send(res, 401, { ok: false, message: '인증에 실패했습니다.' });
  }
  if (!user || !user.id) {
    return send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  }

  // 2) DBMS 계정 차단
  const userApp = String((user.app_metadata && user.app_metadata.app) || '').trim();
  if (userApp === 'dbms') {
    return send(res, 403, {
      ok: false,
      message: 'DBMS 계정은 이 API 를 사용할 수 없습니다.',
    });
  }

  // 3) 쿼리 파라미터
  const url = new URL(req.url, 'http://localhost');
  const source = String(url.searchParams.get('source') || 'all').trim().toLowerCase();
  const status = String(url.searchParams.get('status') || '').trim();
  const q = String(url.searchParams.get('q') || '').trim();
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 300)));
  const markerLimit = Math.max(1, Math.min(2000, Number(url.searchParams.get('markerLimit') || 1200)));
  const swLat = pmToFiniteNumber(url.searchParams.get('swLat'));
  const swLng = pmToFiniteNumber(url.searchParams.get('swLng'));
  const neLat = pmToFiniteNumber(url.searchParams.get('neLat'));
  const neLng = pmToFiniteNumber(url.searchParams.get('neLng'));

  // 4) Supabase REST 쿼리 빌드
  const params = new URLSearchParams();
  params.set('select', PUBLIC_MAP_SELECT_COLUMNS);
  params.set('order', 'date_uploaded.desc.nullslast,id.desc');
  params.set('limit', String(Math.max(limit, markerLimit, 1200)));
  params.append('latitude', 'not.is.null');
  params.append('longitude', 'not.is.null');
  if (swLat !== null && neLat !== null) {
    params.append('latitude', `gte.${swLat}`);
    params.append('latitude', `lte.${neLat}`);
  }
  if (swLng !== null && neLng !== null) {
    params.append('longitude', `gte.${swLng}`);
    params.append('longitude', `lte.${neLng}`);
  }
  if (status) params.append('status', `eq.${status}`);

  let rows;
  try {
    rows = await supabaseRestForPublicMap(`/rest/v1/properties?${params.toString()}`);
  } catch (err) {
    return send(res, err.status || 500, {
      ok: false,
      message: '매물 데이터를 불러오지 못했습니다.',
      detail: String(err.message || err),
    });
  }

  // 5) 정규화 + source/keyword 필터
  const normalized = (Array.isArray(rows) ? rows : []).map(pmNormalizeRow);
  const keyword = q.toLowerCase();
  const filtered = normalized.filter((row) => {
    if (source && source !== 'all') {
      if (source === 'realtor') {
        if (!(row.sourceBucket === 'realtor_naver' || row.sourceBucket === 'realtor_direct')) return false;
      } else if (row.sourceBucket !== source) return false;
    }
    if (keyword) {
      const hay = [row.address, row.itemNo, row.type]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  // 6) 요약
  const summary = { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
  for (const row of filtered) {
    summary.total += 1;
    if (Object.prototype.hasOwnProperty.call(summary, row.sourceBucket)) {
      summary[row.sourceBucket] += 1;
    }
  }

  const items = filtered.slice(offset, offset + limit);
  const markers = filtered.slice(0, markerLimit).map((row) => ({
    id: row.id,
    address: row.address,
    type: row.type,
    latitude: row.latitude,
    longitude: row.longitude,
    sourceBucket: row.sourceBucket,
    source: row.source,
  }));

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return send(res, 200, {
    ok: true,
    summary,
    total: summary.total,
    items,
    markers,
  });
}
// =============================================================================
// platform 회원용 지도 매물 조회 — 끝
// =============================================================================


// =============================================================================
// 공개 등록 스팸 방어 상수 (2026-04-22)
// =============================================================================
// Honeypot: 프런트 폼에 CSS 로 숨겨둔 필드. 사람은 보지 못하므로 비어있고,
// 자동 봇은 모든 필드를 채우므로 값이 들어온다. 값이 들어오면 즉시 거부하되,
// 공격자에게 "차단됐다"는 신호를 주지 않기 위해 일반 성공 응답으로 속이는
// silent-drop 방식을 채택한다.
const HONEYPOT_FIELD_NAMES = ['website', 'url', 'email_confirm'];

// 폼 로드~제출 사이 최소 경과 시간(ms). 사람은 최소 2초 이상 걸린다고 가정.
// 이보다 빠르면 봇일 확률이 높음. timestamp 필드가 없으면 체크 skip (backward compat).
const MIN_FORM_DWELL_MS = 2000;

// 필드 길이 상한 (DB 자체 제한 전에 API 에서 먼저 차단)
const FIELD_MAX_LENGTHS = {
  address: 500,
  assetType: 120,
  floor: 40,
  totalFloor: 40,
  realtorName: 200,
  realtorPhone: 40,
  realtorCell: 40,
  submitterName: 100,
  submitterPhone: 40,
  opinion: 2000,
  useApproval: 40,
};

// memo/opinion 에 포함된 외부 URL 은 스팸 광고의 전형적 신호. 포함 시 거부.
const URL_PATTERN = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i;

// 숫자 필드 상한 (비정상적으로 큰 값 차단 — SQL numeric overflow 방지 겸용)
const NUMERIC_MAX = {
  priceMain: 1e14,       // 100조 원
  commonArea: 1e7,       // 1천만 평 (현실적으로 불가)
  exclusiveArea: 1e7,
  siteArea: 1e7,
};

// Rate limit bucket 설정 (IP / phone 기반)
const RATE_LIMIT_BUCKETS_IP = [
  { windowMs: 60_000,       max: 5,   label: 'ip-1min' },   // 1분에 5건
  { windowMs: 60 * 60_000,  max: 30,  label: 'ip-1hour' },  // 1시간에 30건
];
const RATE_LIMIT_BUCKETS_PHONE = [
  { windowMs: 60 * 60_000,      max: 5,   label: 'phone-1hour' },  // 전화번호당 1시간 5건
  { windowMs: 24 * 60 * 60_000, max: 20,  label: 'phone-1day' },   // 전화번호당 하루 20건
];

const REG_LOG_LABELS = PropertyDomain.REGISTRATION_LOG_LABELS_PUBLIC;

function parseFloorNumberForLog(value) {
  return PropertyDomain.parseFloorNumberForLog(value);
}

function compactAddressText(value) {
  return PropertyDomain.compactAddressText(value);
}

function parseAddressIdentityParts(address) {
  return PropertyDomain.parseAddressIdentityParts(address);
}

function extractHoNumberForLog(...values) {
  return PropertyDomain.extractHoNumberForLog({
    ho: values[0],
    unit: values[1],
    room: values[2],
    address: values[3],
  });
}

function buildRegistrationKey(body) {
  const parts = parseAddressIdentityParts(body.address || '');
  const floorKey = parseFloorNumberForLog(body.floor || body.totalFloor || body.totalfloor || '') || '0';
  const hoKey = extractHoNumberForLog(body.ho || '', body.unit || '', body.room || '', body.address || '') || '0';
  return parts.dong && parts.mainNo ? `${parts.dong}|${parts.mainNo}|${parts.subNo || '0'}|${floorKey}|${hoKey}` : '';
}

function attachRegistrationIdentity(raw, body) {
  return PropertyDomain.attachRegistrationIdentity(raw, body);
}

function buildRegistrationLogCreated(route, actor, at = nowIso()) {
  return [{ type: 'created', at, route, actor }];
}

function appendRegistrationLog(raw, route, actor, changes, at = nowIso()) {
  const current = Array.isArray(raw?.registrationLog) ? raw.registrationLog.slice() : buildRegistrationLogCreated('공개 등록', actor, at);
  if (Array.isArray(changes) && changes.length) current.push({ type: 'changed', at, route, actor, changes });
  return current;
}

function hasMeaningfulValue(value) {
  return PropertyDomain.hasMeaningfulValue(value);
}

function parseNumberOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeCompareValue(field, value) {
  return PropertyDomain.normalizeCompareValue(field, value, { numericFields: ['priceMain', 'commonArea', 'exclusiveArea', 'siteArea'] });
}

function formatFieldValueForLog(field, value) {
  return PropertyDomain.formatFieldValueForLog(field, value, { amountFields: ['priceMain'], numericFields: ['commonArea', 'exclusiveArea', 'siteArea'] });
}

function buildRegistrationSnapshot(input = {}) {
  return {
    address: String(input.address || '').trim(),
    assetType: String(input.assetType || input.asset_type || '').trim(),
    floor: String(input.floor || '').trim(),
    totalfloor: String(input.totalfloor || input.totalFloor || '').trim(),
    commonArea: parseNumberOrNull(input.commonArea ?? input.common_area),
    exclusiveArea: parseNumberOrNull(input.exclusiveArea ?? input.exclusive_area),
    siteArea: parseNumberOrNull(input.siteArea ?? input.site_area),
    useapproval: String(input.useapproval || input.useApproval || input.use_approval || '').trim(),
    priceMain: parseNumberOrNull(input.priceMain ?? input.price_main),
    realtorName: String(input.realtorName || input.broker_office_name || input.brokerOfficeName || '').trim(),
    realtorPhone: String(input.realtorPhone || input.realtorphone || '').trim(),
    realtorCell: String(input.realtorCell || input.realtorcell || input.submitterPhone || input.submitter_phone || '').trim(),
    submitterName: String(input.submitterName || input.submitter_name || '').trim(),
    submitterPhone: String(input.submitterPhone || input.submitter_phone || '').trim(),
    memo: String(input.memo || input.opinion || '').trim(),
  };
}

function buildRegistrationSnapshotFromRow(row = {}) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  return {
    address: String(row.address || raw.address || '').trim(),
    assetType: String(row.asset_type || row.assetType || raw.assetType || raw.asset_type || '').trim(),
    floor: String(raw.floor || '').trim(),
    totalfloor: String(raw.totalfloor || row.total_floor || '').trim(),
    commonArea: parseNumberOrNull(row.common_area ?? raw.commonArea),
    exclusiveArea: parseNumberOrNull(row.exclusive_area ?? raw.exclusiveArea),
    siteArea: parseNumberOrNull(row.site_area ?? raw.siteArea),
    useapproval: String(row.use_approval || raw.useapproval || raw.useApproval || '').trim(),
    priceMain: parseNumberOrNull(row.price_main ?? raw.priceMain),
    realtorName: String(row.broker_office_name || raw.realtorName || '').trim(),
    realtorPhone: String(raw.realtorPhone || raw.realtorphone || '').trim(),
    realtorCell: String(row.submitter_phone || raw.realtorCell || raw.realtorcell || raw.submitterPhone || '').trim(),
    submitterName: String(row.submitter_name || raw.submitterName || raw.submitter_name || '').trim(),
    submitterPhone: String(row.submitter_phone || raw.submitterPhone || raw.submitter_phone || '').trim(),
    memo: String(row.memo || raw.memo || raw.opinion || '').trim(),
  };
}

function buildRegistrationChanges(prevSnapshot, nextSnapshot) {
  return PropertyDomain.buildRegistrationChanges(prevSnapshot, nextSnapshot, REG_LOG_LABELS, {
    amountFields: ['priceMain'],
    numericFields: ['commonArea', 'exclusiveArea', 'siteArea'],
  });
}

function mergeMeaningfulShallow(baseObj, incomingObj) {
  return PropertyDomain.mergeMeaningfulShallow(baseObj, incomingObj);
}

function sanitizeJsonValue(value, depth = 0, seen) {
  if (PropertyDomain && typeof PropertyDomain.sanitizeJsonValue === 'function') {
    return PropertyDomain.sanitizeJsonValue(value, depth, seen);
  }
  if (value == null) return value;
  if (depth > 6) return undefined;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t !== 'object') return undefined;
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
    for (const [k, v] of Object.entries(value)) {
      if (k === 'raw') continue;
      const next = sanitizeJsonValue(v, depth + 1, bag);
      if (next !== undefined) out[k] = next;
    }
    return out;
  } finally {
    bag.delete(value);
  }
}

function sanitizePropertyRaw(raw) {
  if (PropertyDomain && typeof PropertyDomain.sanitizePropertyRawForSave === 'function') {
    return PropertyDomain.sanitizePropertyRawForSave(raw);
  }
  const base = raw && typeof raw === 'object' ? (sanitizeJsonValue(raw, 0) || {}) : {};
  if (base && typeof base === 'object') delete base.raw;
  if (Array.isArray(base.opinionHistory)) {
    base.opinionHistory = base.opinionHistory.slice(-200).map((entry) => ({
      date: String(entry?.date || '').trim(),
      text: String(entry?.text || '').trim(),
      author: String(entry?.author || '').trim(),
    })).filter((entry) => entry.date || entry.text || entry.author);
  }
  return base;
}

function buildRegisterLogContext(route, actor = '공개 등록') {
  return { at: nowIso(), route: String(route || '등록').trim(), actor: String(actor || '공개 등록').trim() };
}

function buildPayloadFromBody(body = {}) {
  const sourceType = PropertyDomain.normalizePublicSourceType(body.sourceType || 'general', body.submitterType || '');
  const submitterType = PropertyDomain.normalizeSubmitterType(body.submitterType || (sourceType === 'realtor' ? 'realtor' : 'owner'), { fallback: sourceType === 'realtor' ? 'realtor' : 'owner' }) || (sourceType === 'realtor' ? 'realtor' : 'owner');
  const realtorCell = normalizePhone(body.realtorCell || body.realtorcell || body.submitterPhone || body.phone || '');
  const ownerPhone = normalizePhone(body.submitterPhone || body.phone || '');
  const submitterPhone = submitterType === 'realtor' ? realtorCell : ownerPhone;
  return {
    sourceType,
    submitterType,
    address: String(body.address || '').trim(),
    assetType: String(body.assetType || '').trim(),
    priceMain: parseNumberOrNull(body.priceMain || body.price),
    floor: String(body.floor || '').trim() || null,
    totalFloor: String(body.totalFloor || body.totalfloor || '').trim() || null,
    commonArea: parseNumberOrNull(body.commonArea ?? body.commonarea),
    exclusiveArea: parseNumberOrNull(body.exclusiveArea ?? body.exclusivearea),
    siteArea: parseNumberOrNull(body.siteArea ?? body.sitearea),
    useApproval: String(body.useApproval || body.useapproval || '').trim() || null,
    submitterName: String(body.submitterName || body.registrantName || body.ownerName || '').trim(),
    submitterPhone,
    realtorName: String(body.realtorName || body.realtorname || '').trim() || null,
    realtorPhone: normalizePhone(body.realtorPhone || body.realtorphone || '') || null,
    realtorCell: realtorCell || null,
    opinion: String(body.opinion || body.memo || '').trim() || null,
  };
}

function validatePayload(payload) {
  if (!payload.address || !payload.assetType || !payload.priceMain) {
    return '주소/세부유형/매매가를 입력해 주세요.';
  }
  if (payload.submitterType === 'realtor') {
    if (!payload.realtorName || !payload.realtorCell) return '중개 등록은 중개사무소명과 휴대폰번호를 입력해 주세요.';
  } else if (!payload.submitterName || !payload.submitterPhone) {
    return '소유자/일반 등록은 이름과 연락처를 입력해 주세요.';
  }

  // 길이 상한 검증 — 과도한 데이터 주입 차단
  for (const [field, maxLen] of Object.entries(FIELD_MAX_LENGTHS)) {
    const value = payload[field];
    if (value != null && typeof value === 'string' && value.length > maxLen) {
      return '입력값이 너무 깁니다.';
    }
  }

  // 숫자 필드 상한 검증 — 비정상적으로 큰 값 차단
  for (const [field, maxVal] of Object.entries(NUMERIC_MAX)) {
    const value = payload[field];
    if (value != null && Number.isFinite(Number(value)) && Number(value) > maxVal) {
      return '입력값이 허용 범위를 초과했습니다.';
    }
    if (value != null && Number.isFinite(Number(value)) && Number(value) < 0) {
      return '음수는 입력할 수 없습니다.';
    }
  }

  // opinion/memo 에 외부 URL 포함 시 거부 — 스팸 광고 차단
  if (payload.opinion && URL_PATTERN.test(String(payload.opinion))) {
    return '의견란에 링크를 포함할 수 없습니다.';
  }

  // 전화번호 숫자만 추출 후 길이 체크 (9~11자리, 한국 번호 체계)
  const phoneToCheck = payload.submitterType === 'realtor' ? payload.realtorCell : payload.submitterPhone;
  if (phoneToCheck) {
    const digits = String(phoneToCheck).replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 11) {
      return '연락처 형식이 올바르지 않습니다.';
    }
  }

  return '';
}

// Honeypot 검사. 값이 조금이라도 채워져 있으면 봇으로 판단.
function isHoneypotTriggered(body = {}) {
  for (const name of HONEYPOT_FIELD_NAMES) {
    const v = body[name];
    if (v != null && String(v).trim() !== '') return true;
  }
  return false;
}

// 폼 로드-제출 간격 검사. 너무 빠르면 봇. 필드 없으면 skip (backward compat).
function isFormSubmittedTooFast(body = {}, now = Date.now()) {
  const raw = body.form_loaded_at ?? body.formLoadedAt;
  if (raw == null || raw === '') return false; // 필드 없음 → 체크 skip
  const loadedAt = Number(raw);
  if (!Number.isFinite(loadedAt) || loadedAt <= 0) return false;
  const diff = now - loadedAt;
  // 비정상 음수/미래시각 또는 너무 짧은 dwell → 봇
  if (diff < 0) return true;
  if (diff < MIN_FORM_DWELL_MS) return true;
  return false;
}

// Rate limit 체크 (IP + phone). 차단 시 429 응답 반환하고 true 를 리턴.
function enforceRateLimit(req, res, payload) {
  const ip = getClientIp(req);
  const phone = normalizePhone(
    payload.submitterType === 'realtor' ? payload.realtorCell : payload.submitterPhone
  );

  const buckets = [];
  if (ip) {
    for (const cfg of RATE_LIMIT_BUCKETS_IP) {
      buckets.push({ key: `pub-listings:ip:${ip}:${cfg.windowMs}`, ...cfg });
    }
  }
  if (phone) {
    for (const cfg of RATE_LIMIT_BUCKETS_PHONE) {
      buckets.push({ key: `pub-listings:phone:${phone}:${cfg.windowMs}`, ...cfg });
    }
  }
  if (!buckets.length) return false;

  const result = checkRateLimitMany(buckets);
  if (!result.allowed) {
    const retrySec = Math.max(1, Math.ceil((result.retryAfterMs || 60_000) / 1000));
    res.setHeader('Retry-After', String(retrySec));
    send(res, 429, {
      ok: false,
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      retryAfter: retrySec,
    });
    return true;
  }
  return false;
}

function buildRawForCreate(payload, context) {
  const raw = {
    ...payload,
    totalfloor: payload.totalFloor,
    useapproval: payload.useApproval,
    registeredByPublic: true,
    createdByType: 'public',
    createdByName: context.actor,
    firstRegisteredAt: context.at,
    registrationLog: buildRegistrationLogCreated(context.route, context.actor, context.at),
  };
  return sanitizePropertyRaw(attachRegistrationIdentity(raw, payload));
}

function buildSupabaseRowForCreate(payload, context) {
  return {
    source_type: payload.sourceType,
    is_general: payload.sourceType === 'general',
    status: 'review',
    address: payload.address,
    asset_type: payload.assetType,
    exclusive_area: payload.exclusiveArea,
    common_area: payload.commonArea,
    site_area: payload.siteArea,
    use_approval: payload.useApproval,
    price_main: payload.priceMain,
    assignee_id: null,
    submitter_type: payload.submitterType,
    submitter_name: payload.submitterName,
    submitter_phone: payload.submitterPhone,
    broker_office_name: payload.realtorName,
    memo: payload.opinion,
    raw: buildRawForCreate(payload, context),
  };
}

function buildSupabasePatchForExisting(existingRow, payload, context) {
  const baseRaw = existingRow.raw && typeof existingRow.raw === 'object' ? existingRow.raw : {};
  const prevSnapshot = buildRegistrationSnapshotFromRow(existingRow);
  const nextSnapshot = buildRegistrationSnapshot(payload);
  const changes = buildRegistrationChanges(prevSnapshot, nextSnapshot);
  const patch = {};
  if (hasMeaningfulValue(payload.address)) patch.address = payload.address;
  if (hasMeaningfulValue(payload.assetType)) patch.asset_type = payload.assetType;
  if (hasMeaningfulValue(payload.exclusiveArea)) patch.exclusive_area = payload.exclusiveArea;
  if (hasMeaningfulValue(payload.commonArea)) patch.common_area = payload.commonArea;
  if (hasMeaningfulValue(payload.siteArea)) patch.site_area = payload.siteArea;
  if (hasMeaningfulValue(payload.useApproval)) patch.use_approval = payload.useApproval;
  if (hasMeaningfulValue(payload.priceMain)) patch.price_main = payload.priceMain;
  if (hasMeaningfulValue(payload.opinion)) patch.memo = payload.opinion;
  if (hasMeaningfulValue(payload.sourceType)) patch.source_type = payload.sourceType;
  patch.is_general = payload.sourceType === 'general';
  if (hasMeaningfulValue(payload.submitterType)) patch.submitter_type = payload.submitterType;
  if (hasMeaningfulValue(payload.submitterName)) patch.submitter_name = payload.submitterName;
  if (hasMeaningfulValue(payload.submitterPhone)) patch.submitter_phone = payload.submitterPhone;
  if (hasMeaningfulValue(payload.realtorName)) patch.broker_office_name = payload.realtorName;
  const mergedRaw = mergeMeaningfulShallow(baseRaw, {
    ...payload,
    totalfloor: payload.totalFloor,
    useapproval: payload.useApproval,
    updatedByPublic: true,
    updatedByName: context.actor,
  });
  const rawWithIdentity = attachRegistrationIdentity(mergedRaw, payload);
  rawWithIdentity.registrationLog = appendRegistrationLog(rawWithIdentity, context.route, context.actor, changes, context.at);
  patch.raw = sanitizePropertyRaw(rawWithIdentity);
  return { patch, changes };
}

function extractDongToken(address) {
  return ((String(address || '').match(/([가-힣A-Za-z0-9]+동)/) || [null, ''])[1] || '').trim();
}

function escapeLikeTerm(value) {
  return String(value || '').replace(/[%,]/g, '').trim();
}

function normalizePropertyDuplicateError(error) {
  return PropertyDomain.normalizePropertyDuplicateError(error);
}

function buildSupabaseHeaders({ hasJson = false, extra = {} } = {}) {
  const { serviceRoleKey } = getEnv();
  const headers = {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function supabaseRest(path, { method = 'GET', json, headers } = {}) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: buildSupabaseHeaders({ hasJson: json !== undefined, extra: headers }),
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.msg || data.error_description || data.error)) || `Supabase API 오류 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function buildRegistrationMatchKeyFromRow(row) {
  return PropertyDomain.buildRegistrationMatchKeyFromRow(row);
}

async function findExistingSupabaseProperty(payload) {
  const targetKey = buildRegistrationKey(payload);
  if (!targetKey) return null;
  const select = 'id,global_id,address,asset_type,price_main,submitter_name,submitter_phone,broker_office_name,use_approval,common_area,exclusive_area,site_area,memo,raw,created_at,updated_at';

  try {
    const rows = await supabaseRest(`/rest/v1/properties?select=${select}&raw->>registrationIdentityKey=eq.${encodeURIComponent(targetKey)}&limit=5&order=updated_at.desc.nullslast,created_at.desc.nullslast`);
    if (Array.isArray(rows) && rows.length) return rows[0];
  } catch (_) {}

  const dongToken = extractDongToken(payload.address);
  if (dongToken) {
    try {
      const rows = await supabaseRest(`/rest/v1/properties?select=${select}&address=ilike.*${encodeURIComponent(escapeLikeTerm(dongToken))}*&limit=300&order=updated_at.desc.nullslast,created_at.desc.nullslast`);
      const found = (Array.isArray(rows) ? rows : []).find((row) => buildRegistrationMatchKeyFromRow(row) === targetKey);
      if (found) return found;
    } catch (_) {}
  }

  const rows = await supabaseRest(`/rest/v1/properties?select=${select}&limit=300&order=updated_at.desc.nullslast,created_at.desc.nullslast`);
  return (Array.isArray(rows) ? rows : []).find((row) => buildRegistrationMatchKeyFromRow(row) === targetKey) || null;
}

async function handleSupabasePublicListing(res, payload) {
  const context = buildRegisterLogContext('공개 등록', payload.submitterName || payload.realtorName || '공개 등록');
  const existing = await findExistingSupabaseProperty(payload);
  if (existing) {
    const { patch, changes } = buildSupabasePatchForExisting(existing, payload, context);
    const targetId = String(existing.id || existing.global_id || '').trim();
    const targetCol = String(existing.id || '').trim() ? 'id' : 'global_id';
    if (!targetId) throw new Error('기존 물건 식별자 확인 실패');
    const rows = await supabaseRest(`/rest/v1/properties?${targetCol}=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      json: patch,
    });
    const item = Array.isArray(rows) ? (rows[0] || null) : rows;
    return send(res, 200, {
      ok: true,
      message: changes.length ? '기존 물건을 갱신했습니다.' : '동일 물건이 있어 기존 물건에 반영했습니다.',
      item: item ? {
        id: item.id || item.global_id || null,
        address: item.address || payload.address,
        updatedAt: item.updated_at || context.at,
      } : null,
    });
  }

  const created = await supabaseRest('/rest/v1/properties', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    json: buildSupabaseRowForCreate(payload, context),
  });
  const item = Array.isArray(created) ? (created[0] || null) : created;
  return send(res, 201, {
    ok: true,
    message: '검토후 연락드리겠습니다.',
    item: item ? {
      id: item.id || item.global_id || null,
      source: item.source_type || payload.sourceType,
      status: item.status || 'review',
      address: item.address || payload.address,
      createdAt: item.created_at || context.at,
    } : null,
  });
}

function handleLegacyPublicListing(res, payload, originalBody = {}) {
  const store = getStore();
  const registrationKey = buildRegistrationKey(payload);
  const existing = store.properties.find((p) => {
    const baseKey = p.registrationKey || buildRegistrationKey({ address: p.address, floor: p.floor, totalFloor: p.totalFloor });
    return registrationKey && baseKey && registrationKey === baseKey;
  });
  const registrantName = payload.submitterName || payload.realtorName || '공개 등록';

  if (existing) {
    const changes = [];
    const pushChange = (label, beforeValue, afterValue) => {
      const before = String(beforeValue || '').trim();
      const after = String(afterValue || '').trim();
      if (!after || before === after) return;
      changes.push({ label, before: before || '-', after });
    };
    pushChange('주소', existing.address, payload.address);
    pushChange('세부유형', existing.assetType, payload.assetType || '');
    pushChange('매매가', existing.price, payload.priceMain);
    pushChange('등록자명', existing.ownerName, payload.submitterName || registrantName);
    pushChange('등록자 연락처', existing.phone, payload.submitterPhone);
    if (payload.address) existing.address = payload.address;
    existing.normalizedAddress = normalizeAddress(payload.address);
    existing.price = payload.priceMain;
    existing.assetType = String(payload.assetType || existing.assetType || '').trim();
    existing.ownerName = payload.submitterName || registrantName;
    existing.phone = payload.submitterPhone;
    existing.submitterType = payload.submitterType;
    existing.updatedAt = nowIso();
    existing.registrationKey = registrationKey;
    existing.raw = existing.raw || {};
    existing.raw = attachRegistrationIdentity(existing.raw, { ...originalBody, ...payload, totalfloor: payload.totalFloor });
    existing.raw.registrationLog = appendRegistrationLog(existing.raw, '공개 등록', registrantName, changes);
    return send(res, 200, { ok: true, message: '기존 물건을 갱신했습니다.', item: { id: existing.id, address: existing.address, updatedAt: existing.updatedAt } });
  }

  const geo = extractGuDong(payload.address);
  const item = {
    id: id('prop'),
    source: PropertyDomain.normalizePublicSourceType(payload.sourceType, payload.submitterType),
    address: payload.address,
    normalizedAddress: normalizeAddress(payload.address),
    price: payload.priceMain,
    region: String(originalBody.region || '').trim(),
    district: String(originalBody.district || geo.gu || '').trim(),
    dong: String(originalBody.dong || geo.dong || '').trim(),
    ownerName: payload.submitterName || registrantName,
    phone: payload.submitterPhone,
    submitterType: payload.submitterType,
    assetType: payload.assetType,
    memo: String(originalBody.memo || payload.opinion || '').trim(),
    brokerOfficeName: payload.realtorName || '',
    brokerName: '',
    brokerLicenseNo: '',
    assigneeId: null,
    assigneeName: '',
    status: 'review',
    createdByType: 'public',
    createdByName: registrantName,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    note: String(originalBody.note || '공개 등록 접수').trim(),
    floor: String(payload.floor || '').trim(),
    totalFloor: String(payload.totalFloor || '').trim(),
    registrationKey,
    raw: attachRegistrationIdentity({
      ...originalBody,
      ...payload,
      totalfloor: payload.totalFloor,
      firstRegisteredAt: nowIso(),
      registrationLog: buildRegistrationLogCreated('공개 등록', registrantName),
    }, payload),
  };
  store.properties.unshift(item);
  return send(res, 201, {
    ok: true,
    message: '검토후 연락드리겠습니다.',
    item: { id: item.id, source: item.source, status: item.status, address: item.address, createdAt: item.createdAt },
  });
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === 'GET') {
    // platform 회원용 지도 매물 조회 — Phase C-2 통합
    const url = new URL(req.url, 'http://localhost');
    const mode = String(url.searchParams.get('mode') || '').trim().toLowerCase();
    if (mode === 'map') {
      return handlePublicMapRequest(req, res);
    }
    // 기본 GET — 도움말 (기존 동작 유지)
    return send(res, 200, {
      ok: true,
      message: '일반물건 등록 API',
      requiredFields: ['address', 'assetType', 'priceMain', 'submitterName', 'submitterPhone'],
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = getJsonBody(req);

  // [방어 L2-a] Honeypot: 봇이 숨겨진 필드를 채웠다면 성공처럼 응답하고 실제로는 무시 (silent drop).
  // 공격자가 "차단됐다"는 신호를 받지 못하게 하여 우회 시도를 지연시킨다.
  if (isHoneypotTriggered(body)) {
    return send(res, 200, { ok: true, message: '검토후 연락드리겠습니다.', item: null });
  }

  // [방어 L2-b] 폼 dwell time: 제출이 너무 빠르면 봇. timestamp 없으면 체크 skip.
  if (isFormSubmittedTooFast(body)) {
    return send(res, 400, { ok: false, message: '잠시 후 다시 시도해 주세요.' });
  }

  const payload = buildPayloadFromBody(body);

  // [방어 L2-c] 페이로드 검증 (필수필드/길이/숫자범위/전화형식/URL패턴)
  const validationMessage = validatePayload(payload);
  if (validationMessage) return send(res, 400, { ok: false, message: validationMessage });

  // [방어 L2-d] IP + 전화번호 기반 rate limit
  if (enforceRateLimit(req, res, payload)) return;

  try {
    if (hasSupabaseAdminEnv()) {
      return await handleSupabasePublicListing(res, payload);
    }
    return handleLegacyPublicListing(res, payload, body);
  } catch (err) {
    const duplicateErr = normalizePropertyDuplicateError(err);
    if (duplicateErr) {
      return send(res, duplicateErr.status, { ok: false, message: duplicateErr.message, code: duplicateErr.code });
    }
    return send(res, err?.status || 500, { ok: false, message: err?.message || '등록에 실패했습니다.' });
  }
};
