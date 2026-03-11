const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody, id, nowIso } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');
const {
  hasSupabaseAdminEnv,
  requireSupabaseAdmin,
  listStaff,
  createAuthUser,
  getStaff,
} = require('../../_lib/supabase-admin');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (hasSupabaseAdminEnv()) {
    const session = await requireSupabaseAdmin(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      const items = await listStaff();
      return send(res, 200, { ok: true, items });
    }

    if (req.method === 'POST') {
      const body = getJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const password = String(body.password || '').trim();
      const role = body.role === 'admin' ? 'admin' : 'staff';

      if (!email || !name || !password) {
        return send(res, 400, { ok: false, message: 'email, name, password는 필수입니다.' });
      }

      try {
        const user = await createAuthUser({ email, password, name, role });
        const item = await getStaff(user.id).catch(() => null);
        return send(res, 201, {
          ok: true,
          item: item || {
            id: user.id,
            email: user.email || email,
            name,
            role,
            assignedRegions: [],
            createdAt: user.created_at || new Date().toISOString(),
          },
        });
      } catch (err) {
        const msg = String(err?.message || '');
        if (/already|exists|registered|duplicate/i.test(msg)) {
          return send(res, 409, { ok: false, message: '동일 이메일 계정이 이미 존재합니다.' });
        }
        return send(res, err?.status || 500, { ok: false, message: err?.message || '계정 생성 실패' });
      }
    }

    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      items: store.staff.map((u) => ({
        ...u,
        role: u.role === 'admin' ? 'admin' : 'staff',
        assignedRegions: Array.isArray(u.regions) ? u.regions : [],
        password: undefined,
      })),
    });
  }

  if (req.method === 'POST') {
    const body = getJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = String(body.password || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'staff';

    if (!name || !password || !email) {
      return send(res, 400, { ok: false, message: 'email, name, password는 필수입니다.' });
    }
    if (store.staff.some((u) => (u.email || '').toLowerCase() === email)) {
      return send(res, 409, { ok: false, message: '동일 이메일 계정이 이미 존재합니다.' });
    }

    const user = {
      id: id('user'),
      email,
      name,
      password,
      role,
      regions: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.staff.push(user);
    return send(res, 201, {
      ok: true,
      item: {
        ...user,
        assignedRegions: [],
        password: undefined,
      },
    });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
