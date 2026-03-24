const { applyCors } = require('./_lib/cors');
const { getStore } = require('./_lib/store');
const { send, getJsonBody, normalizeAddress, extractGuDong, normalizePhone, normalizeStatus, id, nowIso } = require('./_lib/utils');
const { getSession } = require('./_lib/auth');
const { hasSupabaseAdminEnv, resolveCurrentUserContext, getEnv } = require('./_lib/supabase-admin');

function omitUndefined(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== undefined));
}

function buildSupabaseHeaders(hasJson = false, extra = {}) {
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
    headers: buildSupabaseHeaders(json !== undefined, headers),
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
    })).filter((entry) => entry.date || entry.text || entry.author);
  }
  return base;
}

function buildSupabasePropertyRow(input = {}, { role = '', userId = '', userName = '', isPatch = false } = {}) {
  const row = omitUndefined({
    item_no: input.item_no ?? input.itemNo,
    source_type: input.source_type ?? input.sourceType,
    assignee_id: input.assignee_id ?? input.assigneeId,
    submitter_type: input.submitter_type ?? input.submitterType,
    address: input.address != null ? String(input.address || '').trim() : undefined,
    asset_type: input.asset_type ?? input.assetType,
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
    memo: input.memo ?? input.opinion,
    latitude: parseNumberOrNull(input.latitude),
    longitude: parseNumberOrNull(input.longitude),
    is_general: input.is_general,
    raw: input.raw !== undefined ? sanitizePropertyRaw(input.raw) : undefined,
  });

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
    const body = getJsonBody(req);
    const rowInput = body.row && typeof body.row === 'object' ? body.row : body;
    const row = buildSupabasePropertyRow(rowInput, { role: ctx.role, userId: ctx.userId, userName: ctx.name, isPatch: false });
    if (!row.address) return send(res, 400, { ok: false, message: '주소가 필요합니다.' });
    const created = await supabaseRest('/rest/v1/properties', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      json: row,
    });
    const item = Array.isArray(created) ? (created[0] || null) : created;
    return send(res, 201, { ok: true, item });
  }

  if (req.method === 'PATCH') {
    const body = getJsonBody(req);
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
    if (ctx.role === 'staff') delete patch.assignee_id;

    const col = targetId.includes(':') ? 'global_id' : 'id';
    const rows = await supabaseRest(`/rest/v1/properties?${col}=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      json: patch,
    });
    const item = Array.isArray(rows) ? (rows[0] || null) : rows;
    return send(res, 200, { ok: true, item });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
}

function handleLegacyWrite(req, res) {
  const ctx = buildLegacySessionContext(req, res);
  if (!ctx) return;
  const store = getStore();

  if (req.method === 'POST') {
    const body = getJsonBody(req);
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
    const body = getJsonBody(req);
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

  if (req.method === 'GET') {
    const store = getStore();
    const session = getSession(req);
    const url = new URL(req.url, 'http://localhost');
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
    if (hasSupabaseAdminEnv()) return await handleSupabaseWrite(req, res);
    return handleLegacyWrite(req, res);
  } catch (err) {
    return send(res, err?.status || 500, {
      ok: false,
      message: err?.message || '요청 처리 중 오류가 발생했습니다.',
      details: err?.data || null,
    });
  }
};
