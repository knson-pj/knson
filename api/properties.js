const { applyCors } = require('./_lib/cors');
const { getStore } = require('./_lib/store');
const { send } = require('./_lib/utils');
const { getSession } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { ok: false, message: 'Method Not Allowed' });

  const store = getStore();
  const session = getSession(req);
  const url = new URL(req.url, 'http://localhost');
  const source = (url.searchParams.get('source') || 'all').toLowerCase();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();

  let items = [...store.properties];

  if (session?.role === 'agent') {
    items = items.filter(p => p.assigneeId === session.userId);
  } else if (!session) {
    // 비로그인 사용자는 공개용으로 active만 조회
    items = items.filter(p => p.status === 'active');
  }

  if (source && source !== 'all') {
    items = items.filter(p => p.source === source);
  }
  if (status) {
    items = items.filter(p => String(p.status || '').toLowerCase() === status);
  }
  if (q) {
    items = items.filter(p =>
      [p.address, p.region, p.district, p.dong, p.assigneeName, p.note]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }

  const grouped = {
    all: items,
    auction: items.filter(v => v.source === 'auction'),
    public: items.filter(v => v.source === 'public'),
    general: items.filter(v => v.source === 'general'),
  };

  return send(res, 200, {
    ok: true,
    roleView: session?.role || 'public',
    counts: {
      all: grouped.all.length,
      auction: grouped.auction.length,
      public: grouped.public.length,
      general: grouped.general.length,
    },
    items,
    grouped,
  });
};
