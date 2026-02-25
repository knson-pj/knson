const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody, normalizeAddress, normalizePhone, id, nowIso } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    let items = [...store.realtorOffices];
    if (q) items = items.filter(v => JSON.stringify(v).toLowerCase().includes(q));
    return send(res, 200, { ok: true, items, total: items.length, sampleCsvSchema: store.meta.sampleCsvSchemas.realtorOffices });
  }

  if (req.method === 'POST') {
    const body = getJsonBody(req);
    const officeName = String(body.officeName || '').trim();
    const address = String(body.address || '').trim();
    if (!officeName || !address) return send(res, 400, { ok: false, message: 'officeName, address는 필수입니다.' });

    const item = {
      id: id('office'),
      officeName,
      address,
      normalizedAddress: normalizeAddress(address),
      region: String(body.region || '').trim(),
      district: String(body.district || '').trim(),
      managerName: String(body.managerName || '').trim(),
      officePhone: normalizePhone(body.officePhone || ''),
      mobilePhone: normalizePhone(body.mobilePhone || ''),
      note: String(body.note || '').trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const dup = store.realtorOffices.find(v => v.normalizedAddress === item.normalizedAddress && v.officeName === item.officeName);
    if (dup) return send(res, 409, { ok: false, message: '동일 중개사무소(상호+주소)가 이미 존재합니다.' });

    store.realtorOffices.unshift(item);
    return send(res, 201, { ok: true, item });
  }

  if (req.method === 'PATCH') {
    const body = getJsonBody(req);
    const target = store.realtorOffices.find(v => v.id === body.id);
    if (!target) return send(res, 404, { ok: false, message: '중개사무소를 찾을 수 없습니다.' });

    if (body.officeName != null) target.officeName = String(body.officeName || '').trim();
    if (body.address != null) {
      target.address = String(body.address || '').trim();
      target.normalizedAddress = normalizeAddress(target.address);
    }
    if (body.region != null) target.region = String(body.region || '').trim();
    if (body.district != null) target.district = String(body.district || '').trim();
    if (body.managerName != null) target.managerName = String(body.managerName || '').trim();
    if (body.officePhone != null) target.officePhone = normalizePhone(body.officePhone || '');
    if (body.mobilePhone != null) target.mobilePhone = normalizePhone(body.mobilePhone || '');
    if (body.note != null) target.note = String(body.note || '').trim();
    target.updatedAt = nowIso();

    return send(res, 200, { ok: true, item: target });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
