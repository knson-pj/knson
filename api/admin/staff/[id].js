const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();
  const url = new URL(req.url, 'http://localhost');
  const idFromQuery = url.searchParams.get('id');
  const idFromBody = getJsonBody(req).id;
  const targetId = String(idFromQuery || idFromBody || '').trim();

  if (!targetId) return send(res, 400, { ok: false, message: 'id가 필요합니다.' });

  if (req.method === 'GET') {
    const user = store.staff.find(u => u.id === targetId);
    if (!user) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
    return send(res, 200, { ok: true, item: { ...user, password: undefined } });
  }

  if (req.method === 'DELETE') {
    const idx = store.staff.findIndex(u => u.id === targetId);
    if (idx < 0) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
    if (store.staff[idx].role === 'admin' && store.staff.filter(u => u.role === 'admin').length <= 1) {
      return send(res, 400, { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' });
    }
    const [removed] = store.staff.splice(idx, 1);
    return send(res, 200, { ok: true, removedId: removed.id });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
