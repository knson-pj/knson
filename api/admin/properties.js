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

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
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
    if (!address || !['auction', 'public', 'general'].includes(source)) {
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
    const targetId = String(body.id || '').trim();
    const idx = store.properties.findIndex(p => p.id === targetId);
    if (idx < 0) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });
    const removed = store.properties.splice(idx, 1)[0];
    return send(res, 200, { ok: true, removedId: removed.id });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
