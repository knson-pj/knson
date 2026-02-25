const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody, id, nowIso } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      items: store.staff.map(u => ({ ...u, password: undefined })),
    });
  }

  if (req.method === 'POST') {
    const body = getJsonBody(req);
    const name = String(body.name || '').trim();
    const password = String(body.password || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'agent';

    if (!name || !password) {
      return send(res, 400, { ok: false, message: 'name, password는 필수입니다.' });
    }
    if (store.staff.some(u => u.name === name)) {
      return send(res, 409, { ok: false, message: '동일 이름 계정이 이미 존재합니다.' });
    }

    const user = {
      id: id('user'),
      name,
      password,
      role,
      regions: Array.isArray(body.regions) ? body.regions : [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.staff.push(user);
    return send(res, 201, { ok: true, item: { ...user, password: undefined } });
  }

  if (req.method === 'PATCH') {
    const body = getJsonBody(req);
    const targetId = String(body.id || '').trim();
    const user = store.staff.find(u => u.id === targetId);
    if (!user) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });

    if (body.name != null) {
      const nextName = String(body.name || '').trim();
      if (!nextName) return send(res, 400, { ok: false, message: 'name은 비울 수 없습니다.' });
      const dup = store.staff.some(u => u.id !== user.id && u.name === nextName);
      if (dup) return send(res, 409, { ok: false, message: '동일 이름 계정이 이미 존재합니다.' });
      user.name = nextName;
    }
    if (body.password != null) user.password = String(body.password || '').trim();
    if (body.role != null) user.role = body.role === 'admin' ? 'admin' : 'agent';
    if (body.regions != null) user.regions = Array.isArray(body.regions) ? body.regions : [];
    user.updatedAt = nowIso();

    return send(res, 200, { ok: true, item: { ...user, password: undefined } });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
