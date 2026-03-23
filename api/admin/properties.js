const { applyCors } = require('../_lib/cors');
const { getStore } = require('../_lib/store');
const {
  send,
  getJsonBody,
  normalizeAddress,
  extractGuDong,
  normalizePhone,
  normalizeStatus,
  id,
  nowIso,
} = require('../_lib/utils');
const { requireAdmin } = require('../_lib/auth');
const { hasSupabaseAdminEnv, requireSupabaseAdmin, getEnv } = require('../_lib/supabase-admin');

function omitUndefined(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([_, v]) => v !== undefined));
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

function buildSupabasePropertyPatch(body = {}) {
  return omitUndefined({
    item_no: body.item_no ?? body.itemNo,
    source_type: body.source_type ?? body.sourceType,
    assignee_id: body.assignee_id ?? body.assigneeId,
    submitter_type: body.submitter_type ?? body.submitterType,
    address: body.address,
    asset_type: body.asset_type ?? body.assetType,
    floor: body.floor,
    total_floor: body.total_floor ?? body.totalfloor,
    common_area: body.common_area ?? body.commonarea,
    exclusive_area: body.exclusive_area ?? body.exclusivearea,
    site_area: body.site_area ?? body.sitearea,
    use_approval: body.use_approval ?? body.useapproval,
    status: body.status,
    price_main: body.price_main ?? body.priceMain,
    lowprice: body.lowprice,
    date_main: body.date_main ?? body.dateMain,
    source_url: body.source_url ?? body.sourceUrl,
    broker_office_name: body.broker_office_name ?? body.realtorname,
    submitter_phone: body.submitter_phone ?? body.realtorcell,
    memo: body.memo ?? body.opinion,
    latitude: body.latitude,
    longitude: body.longitude,
    raw: body.raw,
  });
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  let session = null;
  if (hasSupabaseAdminEnv()) {
    session = await requireSupabaseAdmin(req, res);
  } else {
    session = requireAdmin(req, res);
  }
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const source = (url.searchParams.get('source') || 'all').toLowerCase();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    let items = [...store.properties];
    if (source !== 'all') items = items.filter(v => v.source === source);
    if (q) items = items.filter(v => JSON.stringify(v).toLowerCase().includes(q));
    return send(res, 200, { ok: true, items, total: items.length });
  }

  if (req.method === 'POST') {
    const body = getJsonBody(req);
    const address = String(body.address || '').trim();
    const source = String(body.source || 'general').trim().toLowerCase();
    const price = Number(body.price || 0);
    if (!address || !['auction', 'onbid', 'realtor', 'general'].includes(source)) {
      return send(res, 400, { ok: false, message: 'address, source 값이 올바르지 않습니다.' });
    }

    const normalizedAddress = normalizeAddress(address);
    if (store.properties.some(p => p.normalizedAddress === normalizedAddress)) {
      return send(res, 409, { ok: false, message: '동일 주소 물건이 이미 등록되어 있습니다.' });
    }

    const geo = extractGuDong(address);
    const item = {
      id: id('prop'),
      source,
      address,
      normalizedAddress,
      price,
      region: String(body.region || '').trim(),
      district: String(body.district || geo.gu || '').trim(),
      dong: String(body.dong || geo.dong || '').trim(),
      ownerName: String(body.ownerName || '').trim(),
      phone: normalizePhone(body.phone || ''),
      assigneeId: body.assigneeId || null,
      assigneeName: String(body.assigneeName || '').trim(),
      status: normalizeStatus(body.status),
      createdByType: 'admin',
      createdByName: session.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      note: String(body.note || '').trim(),
    };
    store.properties.unshift(item);
    return send(res, 201, { ok: true, item });
  }

  if (req.method === 'PATCH') {
    if (hasSupabaseAdminEnv()) {
      const body = getJsonBody(req);
      const targetId = String(body.id || body.globalId || '').trim();
      if (!targetId) return send(res, 400, { ok: false, message: '물건 식별자(id)가 필요합니다.' });

      const patch = buildSupabasePropertyPatch(body);
      const col = targetId.includes(':') ? 'global_id' : 'id';
      const rows = await supabaseRest(`/rest/v1/properties?${col}=eq.${encodeURIComponent(targetId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        json: patch,
      });
      const item = Array.isArray(rows) ? rows[0] : rows;
      if (!item) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });
      return send(res, 200, { ok: true, item });
    }
    const body = getJsonBody(req);
    const targetId = String(body.id || '').trim();
    const item = store.properties.find(p => p.id === targetId);
    if (!item) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });

    if (body.address && normalizeAddress(body.address) !== item.normalizedAddress) {
      const nextNorm = normalizeAddress(body.address);
      const dup = store.properties.some(p => p.id !== item.id && p.normalizedAddress === nextNorm);
      if (dup) return send(res, 409, { ok: false, message: '동일 주소 물건이 이미 등록되어 있습니다.' });
      item.address = String(body.address).trim();
      item.normalizedAddress = nextNorm;
      const geo = extractGuDong(item.address);
      if (!body.district && geo.gu) item.district = geo.gu;
      if (!body.dong && geo.dong) item.dong = geo.dong;
    }
    if (body.price != null) item.price = Number(body.price || 0);
    if (body.region != null) item.region = String(body.region || '').trim();
    if (body.district != null) item.district = String(body.district || '').trim();
    if (body.dong != null) item.dong = String(body.dong || '').trim();
    if (body.ownerName != null) item.ownerName = String(body.ownerName || '').trim();
    if (body.phone != null) item.phone = normalizePhone(body.phone);
    if (body.assigneeId !== undefined) item.assigneeId = body.assigneeId || null;
    if (body.assigneeName !== undefined) item.assigneeName = String(body.assigneeName || '').trim();
    if (body.status != null) item.status = normalizeStatus(body.status);
    if (body.note != null) item.note = String(body.note || '').trim();
    item.updatedAt = nowIso();

    return send(res, 200, { ok: true, item });
  }

  if (req.method === 'DELETE') {
    const body = getJsonBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(v => String(v || '').trim()).filter(Boolean) : [];
    if (ids.length) {
      const before = store.properties.length;
      store.properties = store.properties.filter((p) => !ids.includes(String(p.id || '')));
      const removedCount = before - store.properties.length;
      return send(res, 200, { ok: true, removedCount, removedIds: ids });
    }

    const targetId = String(body.id || '').trim();
    const idx = store.properties.findIndex(p => p.id === targetId);
    if (idx < 0) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });
    const removed = store.properties.splice(idx, 1)[0];
    return send(res, 200, { ok: true, removedId: removed.id });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
