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

function normalizeRegions(values) {
  return Array.isArray(values)
    ? [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))]
    : [];
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (hasSupabaseAdminEnv()) {
    const session = await requireSupabaseAdmin(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      try {
        const items = await listStaff();
        return send(res, 200, {
          ok: true,
          items: items.filter((u) => u.role !== 'admin').map((u) => ({
            id: u.id,
            email: u.email || '',
            name: u.name || u.email || '',
            role: u.role || 'staff',
            assignedRegions: normalizeRegions(u.assignedRegions),
            createdAt: u.createdAt || '',
          })),
        });
      } catch (err) {
        return send(res, err?.status || 500, { ok: false, message: err?.message || '담당자 지역 배정 목록 조회 실패' });
      }
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = getJsonBody(req);
      const assignments = Array.isArray(body.assignments) ? body.assignments : [];

      try {
        const staff = await listStaff();
        const staffMap = new Map(
          staff
            .filter((u) => u.role !== 'admin')
            .map((u) => [String(u.id), u])
        );

        await Promise.all(assignments.map(async (row) => {
          const agentId = String(row.agentId || row.staffId || '').trim();
          if (!agentId || !staffMap.has(agentId)) return;
          await updateStaff(agentId, {
            assignedRegions: normalizeRegions(row.assignedRegions || row.regions),
          });
        }));

        const refreshed = await listStaff();
        return send(res, 200, {
          ok: true,
          items: refreshed.filter((u) => u.role !== 'admin').map((u) => ({
            id: u.id,
            email: u.email || '',
            name: u.name || u.email || '',
            role: u.role || 'staff',
            assignedRegions: normalizeRegions(u.assignedRegions),
            createdAt: u.createdAt || '',
          })),
        });
      } catch (err) {
        return send(res, err?.status || 500, { ok: false, message: err?.message || '담당자 지역 배정 저장 실패' });
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
      items: store.staff
        .filter((u) => u.role !== 'admin')
        .map((u) => ({
          id: u.id,
          email: u.email || '',
          name: u.name || u.email || '',
          role: 'staff',
          assignedRegions: normalizeRegions(u.regions),
          createdAt: u.createdAt || '',
        })),
    });
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    const body = getJsonBody(req);
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];

    for (const row of assignments) {
      const agentId = String(row.agentId || row.staffId || '').trim();
      const user = store.staff.find((u) => String(u.id) === agentId && u.role !== 'admin');
      if (!user) continue;
      user.regions = normalizeRegions(row.assignedRegions || row.regions);
      user.updatedAt = nowIso();
    }

    return send(res, 200, {
      ok: true,
      items: store.staff
        .filter((u) => u.role !== 'admin')
        .map((u) => ({
          id: u.id,
          email: u.email || '',
          name: u.name || u.email || '',
          role: 'staff',
          assignedRegions: normalizeRegions(u.regions),
          createdAt: u.createdAt || '',
        })),
    });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
