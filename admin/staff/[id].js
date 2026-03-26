const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody, normalizePhone } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');
const {
  hasSupabaseAdminEnv,
  requireSupabaseAdmin,
  listStaff,
  getStaff,
  updateStaff,
  deleteAuthUser,
} = require('../../_lib/supabase-admin');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  const url = new URL(req.url, 'http://localhost');
  const idFromQuery = url.searchParams.get('id');
  const idFromReqQuery = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const pathMatch = url.pathname.match(/\/admin\/staff\/([^/?#]+)/);
  const idFromPath = pathMatch ? decodeURIComponent(pathMatch[1] || '') : '';
  const idFromBody = getJsonBody(req).id;
  const targetId = String(idFromReqQuery || idFromQuery || idFromPath || idFromBody || '').trim();

  if (!targetId) return send(res, 400, { ok: false, message: 'id가 필요합니다.' });

  if (hasSupabaseAdminEnv()) {
    const session = await requireSupabaseAdmin(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      const item = await getStaff(targetId);
      if (!item) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
      return send(res, 200, { ok: true, item });
    }

    if (req.method === 'PATCH') {
      const body = getJsonBody(req);
      const patch = {};
      if (body.name != null) patch.name = body.name;
      if (body.role != null) patch.role = body.role;
      if (body.assignedRegions != null) patch.assignedRegions = body.assignedRegions;
      if (body.password != null) patch.password = body.password;
      if (body.email != null) patch.email = body.email;
      if (body.position != null) patch.position = body.position;
      if (body.phone != null) patch.phone = body.phone;

      try {
        const item = await updateStaff(targetId, patch);
        return send(res, 200, { ok: true, item });
      } catch (err) {
        return send(res, err?.status || 500, { ok: false, message: err?.message || '수정 실패' });
      }
    }

    if (req.method === 'DELETE') {
      const items = await listStaff();
      const target = items.find((row) => row.id === targetId);
      if (!target) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
      if (target.role === 'admin' && items.filter((row) => row.role === 'admin').length <= 1) {
        return send(res, 400, { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' });
      }

      try {
        await deleteAuthUser(targetId);
        return send(res, 200, { ok: true, removedId: targetId });
      } catch (err) {
        return send(res, err?.status || 500, { ok: false, message: err?.message || '삭제 실패' });
      }
    }

    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    const user = store.staff.find((u) => u.id === targetId);
    if (!user) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
    return send(res, 200, {
      ok: true,
      item: {
        ...user,
        role: user.role === 'admin' ? 'admin' : 'staff',
        assignedRegions: Array.isArray(user.regions) ? user.regions : [],
        password: undefined,
      },
    });
  }

  if (req.method === 'PATCH') {
    const body = getJsonBody(req);
    const user = store.staff.find((u) => u.id === targetId);
    if (!user) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });

    if (body.name != null) {
      const nextName = String(body.name || '').trim();
      if (!nextName) return send(res, 400, { ok: false, message: 'name은 비울 수 없습니다.' });
      user.name = nextName;
    }
    if (body.role != null) user.role = body.role === 'admin' ? 'admin' : 'staff';
    if (body.password != null && String(body.password || '').trim()) user.password = String(body.password || '').trim();
    if (body.assignedRegions != null) user.regions = Array.isArray(body.assignedRegions) ? body.assignedRegions : [];
    if (body.email != null) user.email = String(body.email || '').trim().toLowerCase();
    if (body.position != null) user.position = String(body.position || '').trim();
    if (body.phone != null) user.phone = normalizePhone(body.phone || '');

    return send(res, 200, {
      ok: true,
      item: {
        ...user,
        assignedRegions: Array.isArray(user.regions) ? user.regions : [],
        password: undefined,
      },
    });
  }

  if (req.method === 'DELETE') {
    const idx = store.staff.findIndex((u) => u.id === targetId);
    if (idx < 0) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
    if (store.staff[idx].role === 'admin' && store.staff.filter((u) => u.role === 'admin').length <= 1) {
      return send(res, 400, { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' });
    }
    const [removed] = store.staff.splice(idx, 1);
    return send(res, 200, { ok: true, removedId: removed.id });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
