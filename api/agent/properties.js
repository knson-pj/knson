const { applyCors } = require('../_lib/cors');
const { send, getJsonBody } = require('../_lib/utils');
const { getEnv, resolveCurrentUserContext } = require('../_lib/supabase-admin');

function getRestBaseAndHeaders() {
  const { url, serviceRoleKey } = getEnv();
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  return {
    baseUrl: url,
    headers: {
      Accept: 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  };
}

async function restFetch(path, options = {}) {
  const { baseUrl, headers } = getRestBaseAndHeaders();
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...headers,
      ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }

  if (!res.ok) {
    const rawMessage =
      data?.message ||
      data?.msg ||
      data?.error_description ||
      data?.details ||
      data?.hint ||
      data?.error ||
      `Supabase REST 오류 (${res.status})`;
    const err = new Error(String(rawMessage || `Supabase REST 오류 (${res.status})`));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function cleanText(value, max = 5000) {
  const s = String(value || '').trim();
  return s ? s.slice(0, max) : null;
}

function extractSchemaMissingColumn(err) {
  const msg = String(err?.message || err || '');
  const m = msg.match(/Could not find the '([^']+)' column of 'properties' in the schema cache/i);
  return m ? String(m[1] || '').trim() : '';
}

function omitKeys(obj, keys) {
  const drop = new Set((Array.isArray(keys) ? keys : []).map((v) => String(v || '').trim()).filter(Boolean));
  return Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => !drop.has(k) && v !== undefined));
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
        const v = sanitizeJsonValue(item, depth + 1, bag);
        if (v !== undefined) out.push(v);
      }
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'raw') continue;
      const sv = sanitizeJsonValue(v, depth + 1, bag);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  } finally {
    bag.delete(value);
  }
}

function sanitizePropertyRawForSave(raw, overrides = {}) {
  const base = raw && typeof raw === 'object' ? (sanitizeJsonValue(raw, 0) || {}) : {};
  if (base && typeof base === 'object') delete base.raw;
  const merged = { ...(base || {}), ...(overrides || {}) };
  if (Array.isArray(merged.opinionHistory)) {
    merged.opinionHistory = merged.opinionHistory.slice(-200).map((entry) => ({
      date: String(entry?.date || '').trim(),
      text: String(entry?.text || '').trim(),
      author: String(entry?.author || '').trim(),
    })).filter((entry) => entry.date || entry.text || entry.author);
  }
  return merged;
}

function assignedToUser(row, userId) {
  const target = String(userId || '').trim();
  if (!target) return false;
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  return [row?.assignee_id, row?.assigneeId, row?.assignedAgentId, raw.assignee_id, raw.assigneeId, raw.assignedAgentId]
    .some((v) => String(v || '').trim() === target);
}

async function fetchPropertyByTarget(targetId) {
  const isGlobal = String(targetId || '').includes(':');
  const column = isGlobal ? 'global_id' : 'id';
  const rows = await restFetch(`/rest/v1/properties?select=id,global_id,assignee_id,raw&${column}=eq.${encodeURIComponent(targetId)}&limit=1`);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function updatePropertyResilient(targetId, patch) {
  let current = { ...(patch || {}) };
  const removed = new Set();
  const isGlobal = String(targetId || '').includes(':');
  const column = isGlobal ? 'global_id' : 'id';
  for (let i = 0; i < 16; i += 1) {
    try {
      const rows = await restFetch(`/rest/v1/properties?${column}=eq.${encodeURIComponent(targetId)}&select=id,global_id,assignee_id,raw`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        json: current,
      });
      return Array.isArray(rows) ? (rows[0] || { id: targetId }) : { id: targetId };
    } catch (err) {
      const missing = extractSchemaMissingColumn(err);
      if (!missing || removed.has(missing) || !(missing in current)) throw err;
      removed.add(missing);
      current = omitKeys(current, [missing]);
    }
  }
  throw new Error('properties update failed after schema fallback retries');
}

async function insertPropertyResilient(row) {
  let current = { ...(row || {}) };
  const removed = new Set();
  for (let i = 0; i < 16; i += 1) {
    try {
      const rows = await restFetch('/rest/v1/properties?select=id,global_id,assignee_id,raw', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        json: current,
      });
      return Array.isArray(rows) ? (rows[0] || null) : null;
    } catch (err) {
      const missing = extractSchemaMissingColumn(err);
      if (!missing || removed.has(missing) || !(missing in current)) throw err;
      removed.add(missing);
      current = omitKeys(current, [missing]);
    }
  }
  throw new Error('properties insert failed after schema fallback retries');
}

function sanitizePatchInput(patch, userId) {
  const next = { ...(patch || {}) };
  if (next.raw && typeof next.raw === 'object') {
    next.raw = sanitizePropertyRawForSave(next.raw, {
      assigneeId: userId,
      assignedAgentId: userId,
      assignee_id: userId,
    });
  }
  if (next.assignee_id !== undefined) next.assignee_id = userId;
  Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
  return next;
}

function sanitizeCreateRowInput(row, ctx) {
  const next = { ...(row || {}) };
  next.assignee_id = ctx.userId;
  next.submitter_name = cleanText(next.submitter_name, 120);
  next.submitter_phone = cleanText(next.submitter_phone, 80);
  next.broker_office_name = cleanText(next.broker_office_name, 200);
  next.memo = cleanText(next.memo, 4000);
  next.raw = sanitizePropertyRawForSave(next.raw || {}, {
    assigneeId: ctx.userId,
    assignedAgentId: ctx.userId,
    assignee_id: ctx.userId,
    registeredByAgent: true,
    registeredByName: cleanText(ctx.name || ctx.email || '', 120),
  });
  Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
  return next;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

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

  if (req.method === 'POST') {
    try {
      const body = getJsonBody(req);
      const row = sanitizeCreateRowInput(body?.row || body || {}, ctx);
      const item = await insertPropertyResilient(row);
      return send(res, 201, { ok: true, item });
    } catch (err) {
      return send(res, err?.status || 500, { ok: false, message: err?.message || '물건 등록 실패' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const body = getJsonBody(req);
      const targetId = cleanText(body?.targetId || body?.id || '', 120);
      if (!targetId) return send(res, 400, { ok: false, message: 'targetId가 필요합니다.' });

      const existing = await fetchPropertyByTarget(targetId);
      if (!existing) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });
      if (ctx.role !== 'admin' && !assignedToUser(existing, ctx.userId)) {
        return send(res, 403, { ok: false, message: '본인에게 배정된 물건만 수정할 수 있습니다.' });
      }

      const patch = sanitizePatchInput(body?.patch || {}, ctx.userId);
      const item = await updatePropertyResilient(targetId, patch);
      return send(res, 200, { ok: true, item });
    } catch (err) {
      return send(res, err?.status || 500, { ok: false, message: err?.message || '물건 저장 실패' });
    }
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
