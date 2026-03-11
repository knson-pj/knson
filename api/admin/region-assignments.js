const { applyCors } = require('../_lib/cors');
const { getStore } = require('../_lib/store');
const { send, getJsonBody, nowIso } = require('../_lib/utils');
const { requireAdmin } = require('../_lib/auth');
const {
  hasSupabaseAdminEnv,
  requireSupabaseAdmin,
  listStaff,
  updateStaff,
} = require('../_lib/supabase-admin');

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

  units.forEach((unit) => {
    groups.sort((a, b) => a.totalCount - b.totalCount || a.index - b.index);
    groups[0].items.push(unit);
    groups[0].totalCount += unit.count;
  });

  groups.sort((a, b) => a.index - b.index);
  return { mode, groups };
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (hasSupabaseAdminEnv()) {
    const session = await requireSupabaseAdmin(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      const items = await listStaff();
      const agentCount = items.filter((u) => u.role !== 'admin').length || 1;
      return send(res, 200, {
        ok: true,
        agentCount,
        suggestion: { mode: 'gu', groups: [] },
        currentAssignments: items
          .filter((u) => u.role !== 'admin')
          .map((u) => ({ id: u.id, name: u.name, regions: u.assignedRegions || [] })),
      });
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = getJsonBody(req);
      const assignments = Array.isArray(body.assignments) ? body.assignments : [];

      try {
        for (const row of assignments) {
          const staffId = String(row.staffId || row.agentId || '').trim();
          if (!staffId) continue;
          const regions = Array.isArray(row.regions)
            ? row.regions
            : (Array.isArray(row.assignedRegions) ? row.assignedRegions : []);
          await updateStaff(staffId, { assignedRegions: regions });
        }

        const items = await listStaff();
        return send(res, 200, {
          ok: true,
          items: items
            .filter((u) => u.role !== 'admin')
            .map((u) => ({ id: u.id, name: u.name, regions: u.assignedRegions || [] })),
        });
      } catch (err) {
        return send(res, err?.status || 500, { ok: false, message: err?.message || '배정 저장 실패' });
      }
    }

    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    const agentCount = store.staff.filter((u) => u.role !== 'admin').length || 1;
    const suggestion = suggestGroups(store.properties, agentCount);
    return send(res, 200, {
      ok: true,
      agentCount,
      suggestion,
      currentAssignments: store.staff
        .filter((u) => u.role !== 'admin')
        .map((u) => ({ id: u.id, name: u.name, regions: u.regions || [] })),
    });
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    const body = getJsonBody(req);
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    for (const a of assignments) {
      const staffId = String(a.staffId || a.agentId || '').trim();
      const user = store.staff.find((u) => u.id === staffId && u.role !== 'admin');
      if (!user) continue;
      const regions = Array.isArray(a.regions)
        ? a.regions
        : (Array.isArray(a.assignedRegions) ? a.assignedRegions : []);
      user.regions = regions;
      user.updatedAt = nowIso();
    }
    return send(res, 200, {
      ok: true,
      items: store.staff
        .filter((u) => u.role !== 'admin')
        .map((u) => ({ id: u.id, name: u.name, regions: u.regions || [] })),
    });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
