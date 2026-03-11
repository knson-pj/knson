const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody, nowIso } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');
const {
  hasSupabaseAdminEnv,
  requireSupabaseAdmin,
  getProfile,
  updateProfile,
  deleteAuthUser,
  listProfiles,
} = require('../../_lib/supabase-admin');

function resolveTargetId(req) {
  try {
    if (req.query?.id) return String(req.query.id).trim();
  } catch {}

  try {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams.get('id');
    if (q) return String(q).trim();
    const parts = url.pathname.split('/').filter(Boolean);
    const tail = parts[parts.length - 1] || '';
    if (tail && tail !== '[id]' && tail !== 'staff') return decodeURIComponent(tail);
  } catch {}

  try {
    const body = getJsonBody(req);
    if (body?.id) return String(body.id).trim();
  } catch {}

  return '';
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  const targetId = resolveTargetId(req);
  if (!targetId) return send(res, 400, { ok: false, message: 'id가 필요합니다.' });

  if (hasSupabaseAdminEnv()) {
    const session = await requireSupabaseAdmin(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      const item = await getProfile(targetId);
      if (!item) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
      return send(res, 200, { ok: true, item });
    }

    if (req.method === 'PATCH') {
      const body = getJsonBody(req);
      const name = body.name != null ? String(body.name || '').trim() : undefined;
      const role = body.role != null ? (body.role === 'admin' ? 'admin' : 'staff') : undefined;
      const assignedRegions = body.assignedRegions;

      if (name != null && !name) {
        return send(res, 400, { ok: false, message: 'name은 비울 수 없습니다.' });
      }

      const item = await updateProfile(targetId, { name, role, assignedRegions });
      return send(res, 200, { ok: true, item });
    }

    if (req.method === 'DELETE') {
      const profiles = await listProfiles();
      const target = profiles.find((row) => String(row.id) === targetId) || null;
      const adminCount = profiles.filter((row) => row.role === 'admin').length;
      if (target?.role === 'admin' && adminCount <= 1) {
        return send(res, 400, { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' });
      }
      await deleteAuthUser(targetId);
      return send(res, 200, { ok: true, removedId: targetId });
    }

    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    const user = store.staff.find(u => u.id === targetId);
    if (!user) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
    return send(res, 200, { ok: true, item: { ...user, password: undefined } });
  }

  if (req.method === 'PATCH') {
    const body = getJsonBody(req);
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
