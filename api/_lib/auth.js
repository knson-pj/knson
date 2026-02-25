const { getStore } = require('./store');
const { id, nowIso, send } = require('./utils');

function createSession(user) {
  const store = getStore();
  const token = id('tok');
  store.sessions[token] = {
    token,
    userId: user.id,
    role: user.role,
    name: user.name,
    createdAt: nowIso(),
  };
  return token;
}

function getSession(req) {
  const store = getStore();
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  return store.sessions[token] || null;
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role !== 'admin') {
    send(res, 403, { ok: false, message: '관리자 권한이 필요합니다.' });
    return null;
  }
  return session;
}

module.exports = {
  createSession,
  getSession,
  requireAuth,
  requireAdmin,
};
