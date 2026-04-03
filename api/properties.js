const { applyCors } = require('./_lib/cors');
const { getStore } = require('./_lib/store');
const { send, getJsonBody, normalizeAddress, extractGuDong, normalizePhone, normalizeStatus, id, nowIso } = require('./_lib/utils');
const { getSession } = require('./_lib/auth');
const { hasSupabaseAdminEnv, resolveCurrentUserContext, getEnv } = require('./_lib/supabase-admin');
const PropertyDomain = require('../knson-property-domain.js');

function omitUndefined(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== undefined));
}

function readBearer(req) {
  const auth = String(req?.headers?.authorization || '').trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

function buildSupabaseHeaders({ hasJson = false, extra = {}, authToken = '', useAnon = false } = {}) {
  const { serviceRoleKey, anonKey } = getEnv();
  const token = String(authToken || '').trim();
  const hasUserToken = !!token;
  const apiKey = hasUserToken || useAnon ? (anonKey || serviceRoleKey) : serviceRoleKey;
  const authorization = hasUserToken ? token : serviceRoleKey;
  const headers = {
    Accept: 'application/json',
    apikey: apiKey,
    Authorization: `Bearer ${authorization}`,
    ...extra,
  };
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function supabaseRest(path, { method = 'GET', json, headers, authToken = '', useAnon = false } = {}) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: buildSupabaseHeaders({ hasJson: json !== undefined, extra: headers, authToken, useAnon }),
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

function parseNumberOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function extractMissingPropertiesColumn(error) {
  const message = String(error?.message || error?.data?.message || error?.data?.error || '').trim();
  const m = message.match(/Could not find the '([^']+)' column of 'properties' in the schema cache/i);
  return m ? String(m[1] || '').trim() : '';
}

function clonePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizePropertyDuplicateError(error) {
  return PropertyDomain.normalizePropertyDuplicateError(error);
}

async function supabasePropertyWriteWithRetry(path, { method, json, headers, authToken = '', useAnon = false }, { maxAttempts = 6 } = {}) {
  let payload = clonePlainObject(json);
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      return await supabaseRest(path, { method, json: payload, headers, authToken, useAnon });
    } catch (err) {
      const missingCol = extractMissingPropertiesColumn(err);
      if (!missingCol || !(missingCol in payload)) throw err;
      const missingVal = payload[missingCol];
      delete payload[missingCol];
      if (missingVal !== undefined) {
        const raw = sanitizePropertyRaw(payload.raw || {});
        if (raw[missingCol] === undefined) raw[missingCol] = missingVal;
        payload.raw = raw;
      }
      attempts += 1;
      continue;
    }
  }
  return supabaseRest(path, { method, json: payload, headers, authToken, useAnon });
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

function kstDateKey(input) {
  const d = input ? new Date(input) : new Date();
  if (!d || Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value || '';
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = parts.find((p) => p.type === 'day')?.value || '';
    return year && month && day ? `${year}-${month}-${day}` : '';
  } catch {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function normalizeActionType(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  const map = {
    new_property: 'new_property',
    newproperty: 'new_property',
    rights_analysis: 'rights_analysis',
    rightsanalysis: 'rights_analysis',
    site_inspection: 'site_inspection',
    siteinspection: 'site_inspection',
    daily_issue: 'daily_issue',
    dailyissue: 'daily_issue',
    property_update: 'property_update',
    propertyupdate: 'property_update',
  };
  return map[s] || '';
}

function cleanText(value, max = 500) {
  const s = String(value || '').trim();
  return s ? s.slice(0, max) : null;
}

function normalizeChangedFields(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const s = String(entry || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s.slice(0, 80));
  }
  return out;
}

function summarizeActivityRows(rows) {
  const defs = {
    new_property: 'newProperty',
    rights_analysis: 'rightsAnalysis',
    site_inspection: 'siteInspection',
    daily_issue: 'dailyIssue',
    property_update: 'propertyUpdate',
  };
  const buckets = {
    newProperty: new Set(),
    rightsAnalysis: new Set(),
    siteInspection: new Set(),
    dailyIssue: new Set(),
    propertyUpdate: new Set(),
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    const bucket = defs[String(row?.action_type || '').trim()];
    if (!bucket) continue;
    const key = String(
      row?.property_id ||
      row?.property_identity_key ||
      row?.property_item_no ||
      row?.property_address ||
      row?.id ||
      ''
    ).trim();
    if (!key) continue;
    buckets[bucket].add(key);
  }
  const counts = {
    newProperty: buckets.newProperty.size,
    rightsAnalysis: buckets.rightsAnalysis.size,
    siteInspection: buckets.siteInspection.size,
    dailyIssue: buckets.dailyIssue.size,
    propertyUpdate: buckets.propertyUpdate.size,
  };
  counts.total = counts.newProperty + counts.rightsAnalysis + counts.siteInspection + counts.dailyIssue + counts.propertyUpdate;
  return counts;
}

function normalizeActivityEntry(entry, ctx) {
  const actionType = normalizeActionType(entry?.actionType || entry?.action_type);
  if (!actionType) return null;
  return {
    actor_id: ctx.userId,
    actor_name: cleanText(ctx.name || ctx.email || '', 120),
    property_id: cleanText(entry?.propertyId || entry?.property_id, 120),
    property_identity_key: cleanText(entry?.propertyIdentityKey || entry?.property_identity_key, 180),
    property_item_no: cleanText(entry?.propertyItemNo || entry?.property_item_no, 120),
    property_address: cleanText(entry?.propertyAddress || entry?.property_address, 500),
    action_type: actionType,
    action_date: /^\d{4}-\d{2}-\d{2}$/.test(String(entry?.actionDate || entry?.action_date || '').trim())
      ? String(entry.actionDate || entry.action_date).trim()
      : kstDateKey(),
    changed_fields: normalizeChangedFields(entry?.changedFields || entry?.changed_fields),
    note: cleanText(entry?.note, 4000),
  };
}

async function insertActivityEntries(entries, ctx) {
  const rows = (Array.isArray(entries) ? entries : []).map((entry) => normalizeActivityEntry(entry, ctx)).filter(Boolean);
  if (!rows.length) return { createdCount: 0 };
  const created = await supabaseRest('/rest/v1/property_activity_logs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    json: rows,
  });
  return {
    createdCount: Array.isArray(created) ? created.length : 0,
    items: Array.isArray(created) ? created : [],
  };
}


function mergeActivityRowsByIdAndName(rowsById, rowsByName, actorId) {
  const idRows = Array.isArray(rowsById) ? rowsById : [];
  const nameRows = Array.isArray(rowsByName) ? rowsByName : [];
  const out = [];
  const seen = new Set();
  const allowLooseNameFallback = !idRows.length;
  const add = (row, source) => {
    if (!row || typeof row !== 'object') return;
    const actorIdValue = cleanText(row?.actor_id, 120);
    if (source === 'name' && !allowLooseNameFallback && actorIdValue && actorId && actorIdValue !== actorId) return;
    const key = String(row.id || `${row.actor_id || ''}|${row.property_id || ''}|${row.property_identity_key || ''}|${row.property_item_no || ''}|${row.property_address || ''}|${row.action_type || ''}|${row.created_at || ''}`).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };
  idRows.forEach((row) => add(row, 'id'));
  nameRows.forEach((row) => add(row, 'name'));
  out.sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
  return out;
}

function collectActorNameCandidates(ctx) {
  const values = [
    ctx?.name,
    ctx?.email,
    ctx?.profile?.name,
    ctx?.authUser?.user_metadata?.display_name,
    ctx?.bearerUser?.user_metadata?.display_name,
    ctx?.authUser?.email,
    ctx?.bearerUser?.email,
  ];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const s = cleanText(value, 120);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function fetchRowsByActorNames(baseSelect, date, actorNames) {
  const names = Array.isArray(actorNames) ? actorNames.filter(Boolean) : [];
  if (!names.length) return [];
  const merged = [];
  const seen = new Set();
  for (const name of names) {
    const rows = await supabaseRest(`/rest/v1/property_activity_logs?select=${baseSelect}&actor_name=eq.${encodeURIComponent(name)}&action_date=eq.${encodeURIComponent(date)}&order=created_at.desc`);
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = String(row?.id || '').trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}

async function fetchRowsByAssignedProperties(baseSelect, date, actorId) {
  const userId = cleanText(actorId, 120);
  if (!userId) return [];
  const propertyRows = await supabaseRest(`/rest/v1/properties?select=id,item_no,address,global_id,assignee_id&assignee_id=eq.${encodeURIComponent(userId)}&limit=5000`);
  const props = Array.isArray(propertyRows) ? propertyRows : [];
  if (!props.length) return [];

  const idSet = new Set();
  const itemNoSet = new Set();
  const addressSet = new Set();
  for (const row of props) {
    const idVals = [row?.id, row?.global_id];
    for (const value of idVals) {
      const s = cleanText(value, 120);
      if (s) idSet.add(s);
    }
    const itemNo = cleanText(row?.item_no, 120);
    if (itemNo) itemNoSet.add(itemNo);
    const address = cleanText(row?.address, 500);
    if (address) addressSet.add(address);
  }
  if (!idSet.size && !itemNoSet.size && !addressSet.size) return [];

  const rows = await supabaseRest(`/rest/v1/property_activity_logs?select=${baseSelect}&action_date=eq.${encodeURIComponent(date)}&order=created_at.desc`);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const propertyId = cleanText(row?.property_id, 120);
    const itemNo = cleanText(row?.property_item_no, 120);
    const address = cleanText(row?.property_address, 500);
    return (propertyId && idSet.has(propertyId)) || (itemNo && itemNoSet.has(itemNo)) || (address && addressSet.has(address));
  });
}

async function handleActivityLog(req, res) {
  if (!hasSupabaseAdminEnv()) {
    return send(res, 501, { ok: false, message: '일일업무일지 기능은 Supabase 환경에서만 사용할 수 있습니다.' });
  }

  let ctx = null;
  try {
    ctx = await resolveCurrentUserContext(req);
  } catch (err) {
    return send(res, 500, { ok: false, message: err?.message || '사용자 확인에 실패했습니다.' });
  }

  if (!ctx?.userId) return send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  if (!['staff', 'admin'].includes(String(ctx.role || '').trim())) {
    return send(res, 403, { ok: false, message: '담당자 또는 관리자 권한이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get('date') || '').trim())
        ? String(url.searchParams.get('date')).trim()
        : kstDateKey();
      const requestedActorId = cleanText(url.searchParams.get('actor_id'), 120);
      const adminViewRequested = ctx.role === 'admin' && ['1', 'true', 'yes'].includes(String(url.searchParams.get('admin_view') || '').trim().toLowerCase());
      const actorId = ctx.role === 'admin' && requestedActorId ? requestedActorId : ctx.userId;
      const actorName = cleanText(ctx.name || ctx.email || '', 120);
      const baseSelect = 'id,actor_id,actor_name,property_id,property_identity_key,property_item_no,property_address,action_type,action_date,changed_fields,note,created_at';
      let rows = [];
      if (adminViewRequested) {
        let query = `/rest/v1/property_activity_logs?select=${baseSelect}&action_date=eq.${encodeURIComponent(date)}`;
        if (requestedActorId) {
          query += `&actor_id=eq.${encodeURIComponent(requestedActorId)}`;
        }
        query += '&order=actor_name.asc.nullslast,created_at.desc';
        rows = await supabaseRest(query);
      } else {
        const actorNames = collectActorNameCandidates(ctx);
        const byActorId = `/rest/v1/property_activity_logs?select=${baseSelect}&actor_id=eq.${encodeURIComponent(actorId)}&action_date=eq.${encodeURIComponent(date)}&order=created_at.desc`;
        const rowsById = await supabaseRest(byActorId);
        const rowsByName = await fetchRowsByActorNames(baseSelect, date, actorNames);
        rows = mergeActivityRowsByIdAndName(rowsById, rowsByName, actorId);
        if (!rows.length) {
          rows = await fetchRowsByAssignedProperties(baseSelect, date, actorId);
        }
      }
      return send(res, 200, {
        ok: true,
        date,
        actorId: adminViewRequested ? (requestedActorId || null) : actorId,
        actorName: adminViewRequested ? null : actorName,
        adminView: adminViewRequested,
        counts: summarizeActivityRows(rows),
        items: Array.isArray(rows) ? rows : [],
        debug: {
          queryMode: adminViewRequested ? 'admin_view' : 'self_view',
          actorIdRows: Array.isArray(rows) ? rows.filter((row) => String(row?.actor_id || '').trim() === String(actorId || '').trim()).length : 0,
          actorNameCandidates: adminViewRequested ? [] : collectActorNameCandidates(ctx),
          fallbackMode: adminViewRequested ? null : (Array.isArray(rows) && rows.length ? 'actor_or_name_or_assigned_property' : 'empty'),
        },
      });
    } catch (err) {
      const rawMessage = err?.message || '일일업무일지 조회 실패';
      const message = /property_activity_logs/i.test(String(rawMessage))
        ? 'property_activity_logs 테이블이 없거나 접근할 수 없습니다. migration SQL을 먼저 실행해 주세요.'
        : rawMessage;
      return send(res, err?.status || 500, { ok: false, message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.__jsonBody || getJsonBody(req);
      const rows = (Array.isArray(body?.entries) ? body.entries : [body])
        .map((entry) => normalizeActivityEntry(entry, ctx))
        .filter(Boolean);
      if (!rows.length) {
        return send(res, 400, { ok: false, message: '기록할 업무일지 항목이 없습니다.' });
      }
      const created = await supabaseRest('/rest/v1/property_activity_logs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        json: rows,
      });
      return send(res, 201, {
        ok: true,
        createdCount: Array.isArray(created) ? created.length : 0,
        items: Array.isArray(created) ? created : [],
        actorId: ctx.userId,
        actorName: cleanText(ctx.name || ctx.email || '', 120),
      });
    } catch (err) {
      const rawMessage = err?.message || '일일업무일지 기록 실패';
      const message = /property_activity_logs/i.test(String(rawMessage))
        ? 'property_activity_logs 테이블이 없거나 접근할 수 없습니다. migration SQL을 먼저 실행해 주세요.'
        : rawMessage;
      return send(res, err?.status || 500, { ok: false, message });
    }
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
}

function buildSupabasePropertyRow(input = {}, { role = '', userId = '', userName = '', isPatch = false } = {}) {
  const lowpriceValue = parseNumberOrNull(input.lowprice ?? input.low_price);
  const normalizedSourceType = PropertyDomain.normalizeSourceType(input.source_type ?? input.sourceType, { fallback: '' }) || undefined;
  const normalizedSubmitterType = PropertyDomain.normalizeSubmitterType(input.submitter_type ?? input.submitterType, { fallback: '' }) || undefined;
  const derivedIsGeneral = normalizedSourceType ? PropertyDomain.isGeneralSourceType(normalizedSourceType) : undefined;
  const baseRaw = input.raw !== undefined ? sanitizePropertyRaw(input.raw) : undefined;
  const row = omitUndefined({
    item_no: input.item_no ?? input.itemNo,
    source_type: normalizedSourceType,
    assignee_id: input.assignee_id ?? input.assigneeId,
    submitter_type: normalizedSubmitterType,
    address: input.address != null ? String(input.address || '').trim() : undefined,
    asset_type: input.asset_type ?? input.assetType,
    common_area: parseNumberOrNull(input.common_area ?? input.commonarea),
    exclusive_area: parseNumberOrNull(input.exclusive_area ?? input.exclusivearea),
    site_area: parseNumberOrNull(input.site_area ?? input.sitearea),
    use_approval: input.use_approval ?? input.useapproval,
    status: input.status != null ? String(input.status || '').trim() : undefined,
    price_main: parseNumberOrNull(input.price_main ?? input.priceMain),
    date_main: input.date_main ?? input.dateMain,
    source_url: input.source_url ?? input.sourceUrl,
    broker_office_name: input.broker_office_name ?? input.brokerOfficeName ?? input.realtorname,
    submitter_name: input.submitter_name ?? input.submitterName,
    submitter_phone: input.submitter_phone ?? input.submitterPhone ?? input.realtorcell,
    memo: input.memo ?? input.opinion,
    latitude: parseNumberOrNull(input.latitude),
    longitude: parseNumberOrNull(input.longitude),
    is_general: input.is_general !== undefined ? !!input.is_general : derivedIsGeneral,
    raw: baseRaw,
  });

  if (lowpriceValue !== null) {
    row.raw = sanitizePropertyRaw(row.raw || {});
    if (row.raw.lowprice === undefined) row.raw.lowprice = lowpriceValue;
  }

  if (normalizedSourceType || normalizedSubmitterType || derivedIsGeneral !== undefined) {
    row.raw = sanitizePropertyRaw(row.raw || {});
    if (normalizedSourceType) row.raw.source_type = normalizedSourceType;
    if (normalizedSourceType && row.raw.sourceType === undefined) row.raw.sourceType = normalizedSourceType;
    if (normalizedSubmitterType) row.raw.submitter_type = normalizedSubmitterType;
    if (normalizedSubmitterType && row.raw.submitterType === undefined) row.raw.submitterType = normalizedSubmitterType;
    if (derivedIsGeneral !== undefined && row.raw.is_general === undefined) row.raw.is_general = derivedIsGeneral;
  }

  if (role === 'staff') {
    if (!isPatch || row.assignee_id === undefined) row.assignee_id = userId || row.assignee_id || null;
    if (row.raw && typeof row.raw === 'object') {
      row.raw.assigneeId = userId || row.raw.assigneeId || '';
      row.raw.assignedAgentId = userId || row.raw.assignedAgentId || '';
      row.raw.registeredByAgent = true;
      if (userName) row.raw.registeredByName = userName;
    }
  }

  return omitUndefined(row);
}

async function getSupabaseProperty(targetId) {
  const col = String(targetId).includes(':') ? 'global_id' : 'id';
  const rows = await supabaseRest(`/rest/v1/properties?select=*&${col}=eq.${encodeURIComponent(targetId)}&limit=1`);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

function isAllowedNonGetRole(role) {
  return role === 'admin' || role === 'staff';
}

function buildLegacySessionContext(req, res) {
  const session = getSession(req);
  if (!session) {
    send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }
  const role = session.role === 'admin' ? 'admin' : (session.role === 'staff' ? 'staff' : '');
  if (!isAllowedNonGetRole(role)) {
    send(res, 403, { ok: false, message: '권한이 없습니다.' });
    return null;
  }
  return {
    userId: session.userId || '',
    role,
    name: session.name || '',
    email: session.email || '',
  };
}

async function handleSupabaseWrite(req, res) {
  let ctx = null;
  try {
    ctx = await resolveCurrentUserContext(req);
  } catch (err) {
    return send(res, 500, { ok: false, message: err.message || '사용자 확인에 실패했습니다.' });
  }
  if (!ctx?.userId) return send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  if (!isAllowedNonGetRole(ctx.role)) return send(res, 403, { ok: false, message: '권한이 없습니다.' });

  if (req.method === 'POST') {
    const body = req.__jsonBody || getJsonBody(req);
    const rowInput = body.row && typeof body.row === 'object' ? body.row : body;
    const row = buildSupabasePropertyRow(rowInput, { role: ctx.role, userId: ctx.userId, userName: ctx.name, isPatch: false });
    if (!row.address) return send(res, 400, { ok: false, message: '주소가 필요합니다.' });
    const created = await supabasePropertyWriteWithRetry('/rest/v1/properties', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      json: row,
    });
    const item = Array.isArray(created) ? (created[0] || null) : created;
    return send(res, 201, { ok: true, item });
  }

  if (req.method === 'PATCH') {
    const body = req.__jsonBody || getJsonBody(req);
    const targetId = String(body.targetId || body.id || body.globalId || '').trim();
    if (!targetId) return send(res, 400, { ok: false, message: '물건 식별자(targetId)가 필요합니다.' });

    const current = await getSupabaseProperty(targetId);
    if (!current) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });

    if (ctx.role === 'staff') {
      const currentAssigneeId = String(current.assignee_id || '').trim();
      if (currentAssigneeId && currentAssigneeId !== ctx.userId) {
        return send(res, 403, { ok: false, message: '본인에게 배정된 물건만 수정할 수 있습니다.' });
      }
    }

    const patchInput = body.patch && typeof body.patch === 'object' ? body.patch : body;
    const patch = buildSupabasePropertyRow(patchInput, { role: ctx.role, userId: ctx.userId, userName: ctx.name, isPatch: true });
    const currentRaw = sanitizePropertyRaw(current?.raw || {});
    const currentSourceType = PropertyDomain.normalizeSourceType(
      current?.source_type ?? currentRaw.source_type ?? currentRaw.sourceType,
      { fallback: '' }
    ) || undefined;
    const currentSubmitterType = PropertyDomain.normalizeSubmitterType(
      current?.submitter_type ?? currentRaw.submitter_type ?? currentRaw.submitterType,
      { fallback: '' }
    ) || undefined;
    if (!patch.source_type && currentSourceType) patch.source_type = currentSourceType;
    if (patch.is_general === undefined && currentSourceType) patch.is_general = PropertyDomain.isGeneralSourceType(currentSourceType);
    if (!patch.submitter_type && currentSubmitterType) patch.submitter_type = currentSubmitterType;
    patch.raw = sanitizePropertyRaw({
      ...currentRaw,
      ...(patch.raw && typeof patch.raw === 'object' ? patch.raw : {}),
    });
    if (currentSourceType) {
      if (patch.raw.source_type === undefined) patch.raw.source_type = currentSourceType;
      if (patch.raw.sourceType === undefined) patch.raw.sourceType = currentSourceType;
      if (patch.raw.is_general === undefined) patch.raw.is_general = PropertyDomain.isGeneralSourceType(currentSourceType);
    }
    if (currentSubmitterType) {
      if (patch.raw.submitter_type === undefined) patch.raw.submitter_type = currentSubmitterType;
      if (patch.raw.submitterType === undefined) patch.raw.submitterType = currentSubmitterType;
    }
    if (ctx.role === 'staff') delete patch.assignee_id;

    const col = targetId.includes(':') ? 'global_id' : 'id';
    const rows = await supabasePropertyWriteWithRetry(`/rest/v1/properties?${col}=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      json: patch,
    });
    const item = Array.isArray(rows) ? (rows[0] || null) : rows;

    let activityLogError = '';
    let activityLoggedCount = 0;
    if (Array.isArray(body.activityEntries) && body.activityEntries.length) {
      try {
        const mappedEntries = body.activityEntries.map((entry) => ({
          ...entry,
          propertyId: entry?.propertyId || entry?.property_id || item?.id || current?.id || targetId,
          propertyIdentityKey: entry?.propertyIdentityKey || entry?.property_identity_key || item?.raw?.registrationIdentityKey || current?.raw?.registrationIdentityKey || null,
          propertyItemNo: entry?.propertyItemNo || entry?.property_item_no || item?.item_no || current?.item_no || null,
          propertyAddress: entry?.propertyAddress || entry?.property_address || item?.address || current?.address || null,
        }));
        const activityRes = await insertActivityEntries(mappedEntries, ctx);
        activityLoggedCount = Number(activityRes?.createdCount || 0);
      } catch (logErr) {
        activityLogError = logErr?.message || '일일업무일지 기록 실패';
      }
    }

    return send(res, 200, { ok: true, item, activityLoggedCount, activityLogError: activityLogError || null });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
}

function handleLegacyWrite(req, res) {
  const ctx = buildLegacySessionContext(req, res);
  if (!ctx) return;
  const store = getStore();

  if (req.method === 'POST') {
    const body = req.__jsonBody || getJsonBody(req);
    const row = body.row && typeof body.row === 'object' ? body.row : body;
    const address = String(row.address || '').trim();
    if (!address) return send(res, 400, { ok: false, message: '주소가 필요합니다.' });
    const normalizedAddress = normalizeAddress(address);
    const geo = extractGuDong(address);
    const item = {
      id: id('prop'),
      source: String(row.source_type || row.sourceType || row.source || 'general').trim().toLowerCase() || 'general',
      address,
      normalizedAddress,
      price: parseNumberOrNull(row.price_main ?? row.priceMain ?? row.price) || 0,
      region: String(row.region || '').trim(),
      district: String(row.district || geo.gu || '').trim(),
      dong: String(row.dong || geo.dong || '').trim(),
      ownerName: String(row.submitter_name || row.submitterName || '').trim(),
      phone: normalizePhone(row.submitter_phone || row.submitterPhone || ''),
      assigneeId: ctx.role === 'staff' ? ctx.userId : (row.assignee_id || row.assigneeId || null),
      assigneeName: ctx.name || String(row.assigneeName || '').trim(),
      status: normalizeStatus(row.status),
      createdByType: ctx.role,
      createdByName: ctx.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      note: String(row.memo || row.opinion || '').trim(),
      raw: sanitizePropertyRaw(row.raw || {}),
    };
    store.properties.unshift(item);
    return send(res, 201, { ok: true, item });
  }

  if (req.method === 'PATCH') {
    const body = req.__jsonBody || getJsonBody(req);
    const targetId = String(body.targetId || body.id || '').trim();
    const item = store.properties.find((v) => String(v.id || '') === targetId);
    if (!item) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });
    if (ctx.role === 'staff' && item.assigneeId && item.assigneeId !== ctx.userId) {
      return send(res, 403, { ok: false, message: '본인에게 배정된 물건만 수정할 수 있습니다.' });
    }
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : body;
    if (patch.status !== undefined) item.status = normalizeStatus(patch.status);
    if (patch.memo !== undefined) item.note = String(patch.memo || patch.opinion || '').trim();
    if (patch.raw !== undefined) item.raw = sanitizePropertyRaw(patch.raw);
    item.updatedAt = nowIso();
    return send(res, 200, { ok: true, item });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  const url = new URL(req.url, 'http://localhost');
  const dailyReportRequested = ['1', 'true', 'yes'].includes(String(url.searchParams.get('daily_report') || '').trim().toLowerCase());
  if ((req.method === 'POST' || req.method === 'PATCH') && !req.__jsonBody) {
    req.__jsonBody = getJsonBody(req);
  }
  const action = String(req.__jsonBody?.action || '').trim().toLowerCase();
  const dailyReportPost = req.method === 'POST' && action === 'daily_report_log';

  if ((req.method === 'GET' && dailyReportRequested) || dailyReportPost) {
    return handleActivityLog(req, res);
  }

  if (req.method === 'GET') {
    const store = getStore();
    const session = getSession(req);
    const source = (url.searchParams.get('source') || 'all').toLowerCase();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const status = (url.searchParams.get('status') || '').trim().toLowerCase();

    let items = [...store.properties];

    if (session?.role === 'staff') {
      items = items.filter((p) => p.assigneeId === session.userId);
    } else if (!session) {
      items = items.filter((p) => p.status === 'active');
    }

    if (source && source !== 'all') {
      items = items.filter((p) => p.source === source);
    }
    if (status) {
      items = items.filter((p) => String(p.status || '').toLowerCase() === status);
    }
    if (q) {
      items = items.filter((p) =>
        [p.address, p.region, p.district, p.dong, p.assigneeName, p.note]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }

    const grouped = {
      all: items,
      auction: items.filter((v) => v.source === 'auction'),
      onbid: items.filter((v) => v.source === 'onbid' || v.source === 'public'),
      realtor: items.filter((v) => v.source === 'realtor'),
      general: items.filter((v) => v.source === 'general'),
    };

    return send(res, 200, {
      ok: true,
      roleView: session?.role || 'public',
      counts: {
        all: grouped.all.length,
        auction: grouped.auction.length,
        onbid: grouped.onbid.length,
        realtor: grouped.realtor.length,
        general: grouped.general.length,
      },
      items,
      grouped,
    });
  }

  try {
    if (req.method === 'POST') {
      const body = req.__jsonBody || getJsonBody(req);
      const action = String(body?.action || '').trim().toLowerCase();
      if (action === 'daily_report_log' || action === 'daily-report-log' || action === 'dailyreportlog') {
        req.__jsonBody = body;
        return handleActivityLog(req, res);
      }
      req.__jsonBody = body;
    }
    if (hasSupabaseAdminEnv()) return await handleSupabaseWrite(req, res);
    return handleLegacyWrite(req, res);
  } catch (err) {
    const duplicateErr = normalizePropertyDuplicateError(err);
    if (duplicateErr) {
      return send(res, duplicateErr.status, {
        ok: false,
        message: duplicateErr.message,
        code: duplicateErr.code,
      });
    }
    return send(res, err?.status || 500, {
      ok: false,
      message: err?.message || '요청 처리 중 오류가 발생했습니다.',
      details: err?.data || null,
    });
  }
};
