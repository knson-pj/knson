const { applyCors } = require('./_lib/cors');
const { getStore } = require('./_lib/store');
const { send, getJsonBody, normalizeAddress, extractGuDong, normalizePhone, normalizeStatus, id, nowIso } = require('./_lib/utils');
const { getSession } = require('./_lib/auth');
const { hasSupabaseAdminEnv, resolveCurrentUserContext, getEnv } = require('./_lib/supabase-admin');
const PropertyDomain = require('../knson-property-domain.js');
const PropertyPhotos = require('./_lib/property-photos');

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
  const base = raw && typeof raw === 'object' ? (sanitizeJsonValue(raw, 0) || {}) : {};
  if (base && typeof base === 'object') delete base.raw;
  if (Array.isArray(base.opinionHistory)) {
    base.opinionHistory = base.opinionHistory.slice(-200).map((entry) => ({
      date: String(entry?.date || '').trim(),
      text: String(entry?.text || '').trim(),
      author: String(entry?.author || '').trim(),
      authorRole: String(entry?.authorRole || entry?.actorRole || '').trim(),
      kind: String(entry?.kind || '').trim(),
      title: String(entry?.title || '').trim(),
      at: String(entry?.at || '').trim(),
    })).filter((entry) => entry.date || entry.text || entry.author || entry.authorRole || entry.kind || entry.title || entry.at);
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
    opinion: 'opinion',
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
    opinion: 'opinion',
    property_update: 'propertyUpdate',
  };
  const buckets = {
    newProperty: new Set(),
    rightsAnalysis: new Set(),
    siteInspection: new Set(),
    dailyIssue: new Set(),
    opinion: new Set(),
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
    opinion: buckets.opinion.size,
    propertyUpdate: buckets.propertyUpdate.size,
  };
  counts.total = counts.newProperty + counts.rightsAnalysis + counts.siteInspection + counts.dailyIssue + counts.opinion + counts.propertyUpdate;
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

  // 하루 1건만 유지되어야 하는 action_type (같은 물건/담당자/날짜 조합에서 덮어쓰기)
  //   - daily_issue / opinion / site_inspection
  // 그 외 (new_property / property_update / rights_analysis) 는 원래대로 매번 신규 insert.
  const MERGE_TYPES = new Set(['daily_issue', 'opinion', 'site_inspection']);
  const upsertRows = [];
  const insertRows = [];
  for (const row of rows) {
    if (MERGE_TYPES.has(String(row.action_type || ''))) upsertRows.push(row);
    else insertRows.push(row);
  }

  const createdItems = [];
  // 1) insert-only 그룹: 기존처럼 한번에 bulk insert
  if (insertRows.length) {
    const created = await supabaseRest('/rest/v1/property_activity_logs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      json: insertRows,
    });
    if (Array.isArray(created)) createdItems.push(...created);
  }

  // 2) upsert 그룹: 각 row 마다 기존 행 조회 → 있으면 PATCH, 없으면 POST
  //    (property_id 가 null 인 경우도 안전하게 처리 — 키 조건이 3~4 항목으로 좁혀짐)
  for (const row of upsertRows) {
    const actorId = String(row.actor_id || '').trim();
    const actionType = String(row.action_type || '').trim();
    const actionDate = String(row.action_date || '').trim();
    const propertyId = row.property_id ? String(row.property_id).trim() : '';
    if (!actorId || !actionType || !actionDate) {
      // 키 불완전 — 신규 insert 로 fallback
      const created = await supabaseRest('/rest/v1/property_activity_logs', {
        method: 'POST', headers: { Prefer: 'return=representation' }, json: [row],
      });
      if (Array.isArray(created)) createdItems.push(...created);
      continue;
    }
    // 기존 행 조회 조건: actor_id + action_type + action_date + property_id (is.null 또는 값 일치)
    const base = `/rest/v1/property_activity_logs?select=id`
      + `&actor_id=eq.${encodeURIComponent(actorId)}`
      + `&action_type=eq.${encodeURIComponent(actionType)}`
      + `&action_date=eq.${encodeURIComponent(actionDate)}`;
    const query = propertyId
      ? `${base}&property_id=eq.${encodeURIComponent(propertyId)}`
      : `${base}&property_id=is.null`;
    let existing = null;
    try {
      const found = await supabaseRest(query);
      if (Array.isArray(found) && found.length) existing = found[0];
    } catch (e) {
      // 조회 실패 시에도 진행(insert fallback)
    }
    if (existing && existing.id) {
      // UPDATE: note / changed_fields / created_at 만 갱신 (마지막 수정 시각으로)
      const patchPath = `/rest/v1/property_activity_logs?id=eq.${encodeURIComponent(existing.id)}`;
      const patched = await supabaseRest(patchPath, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        json: {
          note: row.note,
          changed_fields: row.changed_fields,
          created_at: new Date().toISOString(),
          // actor/property/address 등은 불변으로 간주 (첫 입력을 기준으로 유지)
        },
      });
      if (Array.isArray(patched)) createdItems.push(...patched);
    } else {
      // 신규 INSERT
      const created = await supabaseRest('/rest/v1/property_activity_logs', {
        method: 'POST', headers: { Prefer: 'return=representation' }, json: [row],
      });
      if (Array.isArray(created)) createdItems.push(...created);
    }
  }

  return {
    createdCount: createdItems.length,
    items: createdItems,
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

// =============================================================================
// property_activity_logs 에러 분류 helper
// -----------------------------------------------------------------------------
// 기존에는 에러 메시지에 'property_activity_logs' 문자열이 포함되기만 하면
// 무조건 "테이블 없음" 메시지로 치환해 진짜 원인(컬럼/NOT NULL/권한/UUID 등)을
// 가렸다. Postgres 및 PostgREST 에러 코드를 먼저 분류해서 사용자·운영자가
// 1차 원인을 즉시 식별 가능하도록 한다. 원본 코드/hint/details 는 debug 필드로
// 그대로 전달되므로, 필요 시 관리자가 정확한 진단이 가능하다.
// =============================================================================
function describePropertyActivityLogError(err, fallback) {
  const rawMessage = String(err?.message || fallback || '').trim();
  const data = (err && typeof err === 'object' && err.data && typeof err.data === 'object') ? err.data : null;
  const pgCode = String(data?.code || '').trim();
  const details = String(data?.details || '').trim();
  const hint = String(data?.hint || '').trim();
  const mentionsTable = /property_activity_logs/i.test(rawMessage);

  let message = rawMessage || fallback || '일일업무일지 처리 중 오류가 발생했습니다.';
  let category = 'unknown';

  if (pgCode === '42P01' || /relation\s+"?[^"\s]*property_activity_logs[^"\s]*"?\s+does not exist/i.test(rawMessage)) {
    message = 'property_activity_logs 테이블이 존재하지 않습니다. Supabase 콘솔에서 migration SQL(0003_tables.sql)을 먼저 실행해 주세요.';
    category = 'missing_table';
  } else if (pgCode === '42703' || /column .* does not exist/i.test(rawMessage) || /Could not find the .* column/i.test(rawMessage)) {
    message = `property_activity_logs 테이블 컬럼 구조가 일치하지 않습니다. 최신 migration 적용이 필요합니다. (${details || rawMessage})`;
    category = 'schema_mismatch';
  } else if (pgCode === '42501' || /permission denied/i.test(rawMessage)) {
    message = 'property_activity_logs 접근 권한이 없습니다. Supabase service_role 키(SUPABASE_SERVICE_ROLE_KEY) 환경변수 또는 RLS 정책을 확인해 주세요.';
    category = 'permission_denied';
  } else if (pgCode === '23502' || /null value in column .* violates not-null/i.test(rawMessage)) {
    const match = rawMessage.match(/null value in column "([^"]+)"/i);
    const colName = match ? match[1] : ((details.match(/column "([^"]+)"/i) || [])[1] || '(알 수 없음)');
    message = `property_activity_logs 필수 값이 비어 있습니다: ${colName}. 세션이 만료되었거나 사용자 식별자가 유효하지 않을 수 있으니 로그아웃 후 다시 로그인해 시도해 주세요.`;
    category = 'not_null_violation';
  } else if (pgCode === '22P02' || /invalid input syntax for type uuid/i.test(rawMessage)) {
    message = '사용자 식별자(actor_id) 형식이 유효하지 않습니다. 로그아웃 후 다시 로그인해 주세요.';
    category = 'invalid_uuid';
  } else if (pgCode === '23505' || /duplicate key value violates unique constraint/i.test(rawMessage)) {
    message = '동일한 업무일지 항목이 이미 존재합니다.';
    category = 'unique_violation';
  } else if (pgCode === 'PGRST301' || /JWT expired/i.test(rawMessage)) {
    message = '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.';
    category = 'jwt_expired';
  } else if (pgCode && /^PGRST/i.test(pgCode)) {
    message = `Supabase REST 오류 (${pgCode}): ${rawMessage}`;
    category = 'postgrest';
  } else if (mentionsTable) {
    // 테이블 이름은 언급되는데 위 패턴 모두 미매칭 — 원본 메시지 노출
    message = `property_activity_logs 처리 중 오류: ${rawMessage}`;
    category = 'other_table_error';
  }

  return {
    message,
    category,
    debug: {
      code: pgCode || null,
      details: details || null,
      hint: hint || null,
      raw: rawMessage || null,
    },
  };
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

  // actor_id 는 property_activity_logs.actor_id (uuid NOT NULL) 컬럼에 바인딩되므로
  // UUID v1~v5 일반 포맷을 만족해야 한다. ctx.userId 가 UUID 가 아니면 Postgres 가
  // 22P02 (invalid input syntax for type uuid) 를 뱉고, 프런트는 원인을 알 수 없는
  // "업무일지 기록 실패" 상태에 빠진다. 여기서 선제 차단해 명확한 원인을 돌려준다.
  const ACTIVITY_ACTOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const actorIdStr = String(ctx.userId).trim();
  if (!ACTIVITY_ACTOR_UUID_RE.test(actorIdStr)) {
    return send(res, 400, {
      ok: false,
      message: '사용자 식별자(actor_id) 형식이 유효한 UUID가 아닙니다. 로그아웃 후 다시 로그인해 주세요.',
      code: 'actor_id_invalid_format',
      debug: {
        actorIdLength: actorIdStr.length,
        actorIdSample: actorIdStr ? `${actorIdStr.slice(0, 8)}…` : '(empty)',
        role: ctx.role || null,
      },
    });
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
      const info = describePropertyActivityLogError(err, '일일업무일지 조회 실패');
      return send(res, err?.status || 500, { ok: false, message: info.message, code: info.category, debug: info.debug });
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
      const info = describePropertyActivityLogError(err, '일일업무일지 기록 실패');
      return send(res, err?.status || 500, { ok: false, message: info.message, code: info.category, debug: info.debug });
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
  const preserveImportedMemo = PropertyDomain && typeof PropertyDomain.usesDedicatedSourceNote === 'function'
    ? PropertyDomain.usesDedicatedSourceNote(normalizedSourceType || baseRaw?.source_type || baseRaw?.sourceType || '')
    : ['auction', 'realtor'].includes(String(normalizedSourceType || baseRaw?.source_type || baseRaw?.sourceType || '').trim().toLowerCase());
  const existingSourceNote = PropertyDomain && typeof PropertyDomain.extractDedicatedSourceNote === 'function'
    ? PropertyDomain.extractDedicatedSourceNote(normalizedSourceType || baseRaw?.source_type || baseRaw?.sourceType || '', input, baseRaw || {})
    : { label: baseRaw?.sourceNoteLabel || baseRaw?.importedSourceLabel || '', text: baseRaw?.sourceNoteText || baseRaw?.importedSourceText || '' };
  if (preserveImportedMemo && existingSourceNote?.text) {
    baseRaw.importedSourceLabel = baseRaw.importedSourceLabel || existingSourceNote.label || '';
    baseRaw.sourceNoteLabel = baseRaw.sourceNoteLabel || existingSourceNote.label || '';
    baseRaw.importedSourceText = baseRaw.importedSourceText || existingSourceNote.text || '';
    baseRaw.sourceNoteText = baseRaw.sourceNoteText || existingSourceNote.text || '';
  }
  const row = omitUndefined({
    item_no: input.item_no ?? input.itemNo,
    source_type: normalizedSourceType,
    assignee_id: input.assignee_id ?? input.assigneeId,
    assignee_name: input.assignee_name ?? input.assigneeName,
    submitter_type: normalizedSubmitterType,
    address: input.address != null ? String(input.address || '').trim() : undefined,
    asset_type: input.asset_type ?? input.assetType,
    floor: input.floor != null ? String(input.floor || '').trim() : undefined,
    total_floor: (input.total_floor ?? input.totalfloor) != null ? String(input.total_floor ?? input.totalfloor ?? '').trim() : undefined,
    common_area: parseNumberOrNull(input.common_area ?? input.commonarea),
    exclusive_area: parseNumberOrNull(input.exclusive_area ?? input.exclusivearea),
    site_area: parseNumberOrNull(input.site_area ?? input.sitearea),
    use_approval: input.use_approval ?? input.useapproval,
    status: input.status != null ? String(input.status || '').trim() : undefined,
    price_main: parseNumberOrNull(input.price_main ?? input.priceMain),
    lowprice: parseNumberOrNull(input.lowprice ?? input.low_price),
    date_main: input.date_main ?? input.dateMain,
    source_url: input.source_url ?? input.sourceUrl,
    broker_office_name: input.broker_office_name ?? input.brokerOfficeName ?? input.realtorname,
    submitter_name: input.submitter_name ?? input.submitterName,
    submitter_phone: input.submitter_phone ?? input.submitterPhone ?? input.realtorcell,
    memo: input.memo !== undefined ? input.memo : (preserveImportedMemo ? undefined : input.opinion),
    latitude: parseNumberOrNull(input.latitude),
    longitude: parseNumberOrNull(input.longitude),
    result_status: input.result_status ?? input.resultStatus,
    result_price: parseNumberOrNull(input.result_price ?? input.resultPrice),
    result_date: input.result_date ?? input.resultDate,
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
    if (!isPatch || row.assignee_name === undefined) row.assignee_name = userName || row.assignee_name || '';
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
    if (patch.assignee_id !== undefined) {
      const aid = patch.assignee_id;
      const aname = patch.assignee_name || '';
      patch.raw.assigneeId = aid || '';
      patch.raw.assignee_id = aid || '';
      patch.raw.assignedAgentId = aid || '';
      patch.raw.assigneeName = aname;
      patch.raw.assignee_name = aname;
      patch.raw.assignedAgentName = aname;
    }
    if (ctx.role === 'staff') { delete patch.assignee_id; delete patch.assignee_name; }

    // ── registrationLog 의 false-positive change 최종 필터링 ──
    // 면적 필드: 소수점 정밀도 차이(20.116250... vs 20.12) 로 인한 거짓 변경 제거
    // 날짜 필드: 타임존/시간 포맷 차이(2026-05-14T00:00:00+00:00 vs 2026-05-14) 로 인한 거짓 변경 제거
    if (patch.raw && Array.isArray(patch.raw.registrationLog)) {
      const extractDateOnly = (v) => {
        if (v == null) return '';
        const s = String(v).trim();
        if (!s) return '';
        const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
        if (!m) return s;
        return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
      };
      const roundArea = (v) => {
        const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '').trim());
        if (!Number.isFinite(n)) return null;
        return Math.round(n * 100) / 100;
      };
      const AREA_FIELDS = new Set(['commonArea', 'exclusiveArea', 'siteArea']);
      const DATE_FIELDS = new Set(['dateMain', 'useapproval']);
      patch.raw.registrationLog = patch.raw.registrationLog.reduce((acc, entry) => {
        if (!entry || typeof entry !== 'object') { acc.push(entry); return acc; }
        if (entry.type !== 'changed' || !Array.isArray(entry.changes)) { acc.push(entry); return acc; }
        const filtered = entry.changes.filter((change) => {
          if (!change || typeof change !== 'object') return true;
          const f = String(change.field || '');
          if (AREA_FIELDS.has(f)) {
            const b = roundArea(change.before);
            const a = roundArea(change.after);
            if (b !== null && a !== null && b === a) return false;
          }
          if (DATE_FIELDS.has(f)) {
            const b = extractDateOnly(change.before);
            const a = extractDateOnly(change.after);
            if (b && a && b === a) return false;
          }
          return true;
        });
        if (!filtered.length) return acc; // 엔트리 전체 제거
        acc.push({ ...entry, changes: filtered });
        return acc;
      }, []);
    }

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



async function handlePhotoAction(req, res, action) {
  if (!hasSupabaseAdminEnv()) {
    return send(res, 501, { ok: false, message: '사진 기능은 Supabase 환경에서만 사용할 수 있습니다.' });
  }
  const body = req.__jsonBody || getJsonBody(req);
  const propertyId = req.__photoPropertyId || body?.propertyId;
  const photoId = String(req.__photoId || body?.photoId || '').trim();
  const access = await PropertyPhotos.requirePropertyAccess(req, res, propertyId);
  if (!access) return;
  try {
    if (action === 'list') {
      const rows = await PropertyPhotos.listPhotoRows(access.propertyId);
      const items = await Promise.all(rows.map(async (row) => ({
        id: row.id,
        propertyId: row.property_id,
        propertyGlobalId: row.property_global_id,
        thumbUrl: await PropertyPhotos.createSignedUrl(row.thumb_path).catch(() => ''),
        originalUrl: await PropertyPhotos.createSignedUrl(row.storage_path).catch(() => ''),
        thumbPath: row.thumb_path,
        storagePath: row.storage_path,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        sizeBytes: row.size_bytes,
        sortOrder: row.sort_order,
        isPrimary: !!row.is_primary,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })));
      return send(res, 200, { ok: true, items });
    }

    if (action === 'prepare') {
      const count = Math.max(1, Math.min(10, Number(body?.count || 1)));
      const existingCount = await PropertyPhotos.getActivePhotoCount(access.propertyId);
      if (existingCount + count > PropertyPhotos.MAX_PHOTOS_PER_PROPERTY) {
        return send(res, 400, { ok: false, message: `사진은 매물당 최대 ${PropertyPhotos.MAX_PHOTOS_PER_PROPERTY}장까지 등록할 수 있습니다.` });
      }
      const uploads = [];
      for (let i = 0; i < count; i += 1) {
        uploads.push(PropertyPhotos.buildPhotoPaths(access.propertyId, PropertyPhotos.makeId()));
      }
      return send(res, 200, { ok: true, uploads, existingCount, maxPhotos: PropertyPhotos.MAX_PHOTOS_PER_PROPERTY });
    }

    if (action === 'commit') {
      const photos = Array.isArray(body?.photos) ? body.photos : [];
      if (!photos.length) return send(res, 400, { ok: false, message: '저장할 사진 데이터가 비어 있습니다. 요청 본문이 누락되었거나 너무 커서 처리되지 않았을 수 있습니다.' });
      const existing = await PropertyPhotos.listPhotoRows(access.propertyId);
      let nextSort = existing.reduce((max, row) => Math.max(max, Number(row?.sort_order || 0)), -1) + 1;
      const hasPrimary = existing.some((row) => !!row.is_primary);
      const items = [];
      for (let i = 0; i < photos.length; i += 1) {
        const entry = photos[i] || {};
        if (!entry.photoId || !entry.storagePath || !entry.thumbPath || !entry.originalDataUrl || !entry.thumbDataUrl) throw new Error('사진 업로드 데이터가 올바르지 않습니다.');
        const originalMeta = await PropertyPhotos.uploadObject(entry.storagePath, entry.originalDataUrl, entry.mimeType || 'image/webp');
        await PropertyPhotos.uploadObject(entry.thumbPath, entry.thumbDataUrl, 'image/webp');
        const inserted = await PropertyPhotos.insertPhotoRow({
          id: entry.photoId,
          property_id: access.propertyId,
          property_global_id: access.property?.global_id || null,
          storage_path: entry.storagePath,
          thumb_path: entry.thumbPath,
          mime_type: entry.mimeType || originalMeta.mimeType || 'image/webp',
          width: Number(entry.width || 0) || null,
          height: Number(entry.height || 0) || null,
          size_bytes: Number(entry.sizeBytes || originalMeta.sizeBytes || 0) || null,
          sort_order: nextSort,
          is_primary: !hasPrimary && i === 0,
          uploaded_by: access.ctx?.userId || null,
        });
        items.push(inserted);
        nextSort += 1;
      }
      return send(res, 200, { ok: true, items });
    }

    if (action === 'set_primary') {
      if (!photoId) return send(res, 400, { ok: false, message: 'photoId가 필요합니다.' });
      const photo = await PropertyPhotos.getPhotoRow(photoId);
      if (!photo || String(photo.property_id || '').trim() !== String(access.propertyId || '').trim() || photo.deleted_at) return send(res, 404, { ok: false, message: '사진을 찾을 수 없습니다.' });
      await PropertyPhotos.patchPhotoRows(`property_id=eq.${encodeURIComponent(access.propertyId)}&deleted_at=is.null`, { is_primary: false, updated_at: new Date().toISOString() });
      const updated = await PropertyPhotos.patchPhotoRows(`id=eq.${encodeURIComponent(photoId)}&property_id=eq.${encodeURIComponent(access.propertyId)}`, { is_primary: true, updated_at: new Date().toISOString() });
      return send(res, 200, { ok: true, item: Array.isArray(updated) ? (updated[0] || null) : updated });
    }

    if (action === 'reorder') {
      const orderedPhotoIds = Array.isArray(body?.orderedPhotoIds) ? body.orderedPhotoIds.map((v) => String(v || '').trim()).filter(Boolean) : [];
      const rows = await PropertyPhotos.listPhotoRows(access.propertyId);
      const rowIds = new Set(rows.map((row) => String(row.id || '').trim()));
      const finalOrder = orderedPhotoIds.filter((id) => rowIds.has(id));
      rows.forEach((row) => { const id = String(row.id || '').trim(); if (!finalOrder.includes(id)) finalOrder.push(id); });
      await Promise.all(finalOrder.map((pid, index) => PropertyPhotos.patchPhotoRows(`id=eq.${encodeURIComponent(pid)}&property_id=eq.${encodeURIComponent(access.propertyId)}`, { sort_order: index, updated_at: new Date().toISOString() })));
      return send(res, 200, { ok: true, orderedPhotoIds: finalOrder });
    }

    if (action === 'delete') {
      if (!photoId) return send(res, 400, { ok: false, message: 'photoId가 필요합니다.' });
      const photo = await PropertyPhotos.getPhotoRow(photoId);
      if (!photo || String(photo.property_id || '').trim() !== String(access.propertyId || '').trim() || photo.deleted_at) return send(res, 404, { ok: false, message: '사진을 찾을 수 없습니다.' });
      await PropertyPhotos.patchPhotoRows(`id=eq.${encodeURIComponent(photoId)}&property_id=eq.${encodeURIComponent(access.propertyId)}`, { deleted_at: new Date().toISOString(), is_primary: false, updated_at: new Date().toISOString() });
      await PropertyPhotos.removeObjects([photo.storage_path, photo.thumb_path]).catch(() => null);
      if (photo.is_primary) {
        const remaining = await PropertyPhotos.listPhotoRows(access.propertyId);
        const next = remaining.find((row) => String(row.id || '') !== photoId);
        if (next) await PropertyPhotos.patchPhotoRows(`id=eq.${encodeURIComponent(next.id)}&property_id=eq.${encodeURIComponent(access.propertyId)}`, { is_primary: true, updated_at: new Date().toISOString() });
      }
      return send(res, 200, { ok: true, removedId: photoId });
    }

    return send(res, 400, { ok: false, message: '지원하지 않는 photo_action 입니다.' });
  } catch (err) {
    const raw = [err?.message, err?.data?.message, err?.data?.error, err?.data?.hint, err?.data?.details].filter(Boolean).join(' ');
    const lowered = String(raw || '').toLowerCase();
    let message = err?.message || '사진 처리 중 오류가 발생했습니다.';
    if (lowered.includes('property_photos') && (lowered.includes('does not exist') || lowered.includes('relation'))) {
      message = 'property_photos 테이블이 없어 사진 기능을 사용할 수 없습니다. Supabase SQL을 먼저 실행해 주세요.';
    } else if (lowered.includes('bucket') && lowered.includes('not found')) {
      message = 'property-photos 스토리지 버킷이 없어 사진 기능을 사용할 수 없습니다. Supabase SQL을 먼저 실행해 주세요.';
    } else if (lowered.includes('invalid input syntax for type bigint') || lowered.includes('column "property_id" is of type bigint')) {
      message = 'property_photos.property_id 타입이 현재 매물 id와 맞지 않습니다. 사진 기능용 SQL 보정 스크립트를 먼저 실행해 주세요.';
    }
    return send(res, err?.status || 500, { ok: false, message, details: err?.data || null });
  }
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

  const inferredPhotoAction = (() => {
    const body = req.__jsonBody || req.body || {};
    if (body && typeof body === 'object' && body.photo_action) return String(body.photo_action || '').trim().toLowerCase();
    if (!body || typeof body !== 'object') return '';
    if (Array.isArray(body.photos) && body.photos.length) return 'commit';
    if (Array.isArray(body.orderedPhotoIds) && body.orderedPhotoIds.length) return 'reorder';
    if (body.photoId && body.propertyId) return 'set_primary';
    if (body.propertyId && Number(body.count || 0) > 0) return 'prepare';
    return '';
  })();
  const photoAction = String(url.searchParams.get('photo_action') || inferredPhotoAction || '').trim().toLowerCase();
  if (photoAction) {
    req.__photoPropertyId = url.searchParams.get('propertyId') || req.__jsonBody?.propertyId || req.body?.propertyId || '';
    req.__photoId = url.searchParams.get('photoId') || req.__jsonBody?.photoId || req.body?.photoId || '';
    return handlePhotoAction(req, res, photoAction);
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
