const { applyCors } = require('../_lib/cors');
const { send } = require('../_lib/utils');
const { getSession } = require('../_lib/auth');
const {
  hasSupabaseAdminEnv,
  resolveCurrentUserContext,
} = require('../_lib/supabase-admin');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  if (hasSupabaseAdminEnv()) {
    try {
      const ctx = await resolveCurrentUserContext(req);
      if (!ctx?.userId) {
        return send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
      }

      return send(res, 200, {
        ok: true,
        user: {
          id: ctx.userId,
          email: ctx.email || '',
          name: ctx.name || ctx.email || '',
          role: ctx.role || 'staff',
          assignedRegions: Array.isArray(ctx.assignedRegions) ? ctx.assignedRegions : [],
        },
      });
    } catch (err) {
      return send(res, err?.status || 500, {
        ok: false,
        message: err?.message || '사용자 정보를 확인하지 못했습니다.',
      });
    }
  }

  const session = getSession(req);
  if (!session) {
    return send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  }

  return send(res, 200, {
    ok: true,
    user: {
      id: session.userId,
      email: '',
      name: session.name || '',
      role: session.role || 'staff',
      assignedRegions: [],
    },
  });
};
