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
const { hasSupabaseAdminEnv, getEnv } = require('./_lib/supabase-admin');
const PropertyDomain = require('../knson-property-domain.js');

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
  return '';
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
  const payload = buildPayloadFromBody(body);
  const validationMessage = validatePayload(payload);
  if (validationMessage) return send(res, 400, { ok: false, message: validationMessage });

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
