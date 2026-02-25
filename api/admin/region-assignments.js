const { applyCors } = require('../_lib/cors');
const { getStore } = require('../_lib/store');
const { send, getJsonBody, nowIso } = require('../_lib/utils');
const { requireAdmin } = require('../_lib/auth');

function makeBuckets(properties) {
  const guMap = new Map();
  const dongMap = new Map();

  for (const p of properties) {
    const region = p.region || '';
    const gu = p.district || '';
    const dong = p.dong || '';
    if (gu) {
      const key = `${region} ${gu}`.trim();
      guMap.set(key, (guMap.get(key) || 0) + 1);
    }
    if (gu && dong) {
      const key = `${region} ${gu} ${dong}`.trim();
      dongMap.set(key, (dongMap.get(key) || 0) + 1);
    }
  }

  return {
    gu: [...guMap.entries()].map(([label, count]) => ({ label, level: 'gu', count })),
    dong: [...dongMap.entries()].map(([label, count]) => ({ label, level: 'dong', count })),
  };
}

function suggestGroups(properties, staffCount) {
  const buckets = makeBuckets(properties);
  const guSorted = buckets.gu.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const dongSorted = buckets.dong.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // 구 단위 수보다 담당자가 많으면 동 단위로 재편성(요구사항 반영)
  let units = guSorted;
  let mode = 'gu';
  if (staffCount > guSorted.length && dongSorted.length) {
    units = dongSorted;
    mode = 'dong';
  }

  const groups = Array.from({ length: Math.max(1, staffCount) }, (_, i) => ({
    index: i,
    items: [],
    totalCount: 0,
  }));

  // 동선 고려의 간단 버전: 같은 접두(시/구)를 우선 유지하도록 정렬 후 최소합 그리디 분배
  units.forEach(unit => {
    groups.sort((a, b) => a.totalCount - b.totalCount || a.index - b.index);
    groups[0].items.push(unit);
    groups[0].totalCount += unit.count;
  });

  groups.sort((a, b) => a.index - b.index);
  return { mode, groups };
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    const agentCount = store.staff.filter(u => u.role === 'agent').length || 1;
    const suggestion = suggestGroups(store.properties, agentCount);
    return send(res, 200, {
      ok: true,
      agentCount,
      suggestion,
      currentAssignments: store.staff
        .filter(u => u.role === 'agent')
        .map(u => ({ id: u.id, name: u.name, regions: u.regions || [] })),
    });
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    const body = getJsonBody(req);
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    for (const a of assignments) {
      const user = store.staff.find(u => u.id === a.staffId && u.role === 'agent');
      if (!user) continue;
      user.regions = Array.isArray(a.regions) ? a.regions : [];
      user.updatedAt = nowIso();
    }
    return send(res, 200, {
      ok: true,
      items: store.staff.filter(u => u.role === 'agent').map(u => ({ id: u.id, name: u.name, regions: u.regions || [] })),
    });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
