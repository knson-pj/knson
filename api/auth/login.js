const { applyCors } = require('../_lib/cors');
const { getStore } = require('../_lib/store');
const { getJsonBody, send } = require('../_lib/utils');
const { createSession } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method Not Allowed' });

  const { name, password } = getJsonBody(req);
  const store = getStore();
  const user = store.staff.find(u => u.name === String(name || '').trim() && u.password === String(password || ''));

  if (!user) {
    return send(res, 401, { ok: false, message: '이름 또는 비밀번호가 올바르지 않습니다.' });
  }

  const token = createSession(user);
  return send(res, 200, {
    ok: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      regions: user.regions || [],
    },
  });
};
