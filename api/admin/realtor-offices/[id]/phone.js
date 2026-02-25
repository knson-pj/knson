const { applyCors } = require('../../../_lib/cors');
const { getStore } = require('../../../_lib/store');
const { send, getJsonBody, normalizePhone, nowIso } = require('../../../_lib/utils');
const { requireAdmin } = require('../../../_lib/auth');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const store = getStore();
  const url = new URL(req.url, 'http://localhost');
  const body = getJsonBody(req);
  const targetId = String(url.searchParams.get('id') || body.id || '').trim();
  const item = store.realtorOffices.find(v => v.id === targetId);
  if (!item) return send(res, 404, { ok: false, message: '중개사무소를 찾을 수 없습니다.' });

  if (body.mobilePhone != null) item.mobilePhone = normalizePhone(body.mobilePhone || '');
  if (body.officePhone != null) item.officePhone = normalizePhone(body.officePhone || '');
  item.updatedAt = nowIso();

  return send(res, 200, { ok: true, item });
};
