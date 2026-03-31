const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody, id, nowIso, normalizePhone } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');
const {
  hasSupabaseAdminEnv,
  requireSupabaseAdmin,
  listStaff,
  createAuthUser,
  getStaff,
  updateStaff,
  deleteAuthUser,
  getEnv,
} = require('../../_lib/supabase-admin');

function normalizeRoleValue(value) {
  return value === 'admin' ? 'admin' : (value === 'other' ? 'other' : 'staff');
}

function readTargetId(req, body) {
  const url = new URL(req.url, 'http://localhost');
  const idFromQuery = url.searchParams.get('id');
  const idFromBody = body && typeof body === 'object' ? body.id : '';
  return String(idFromQuery || idFromBody || '').trim();
}

function buildSupabaseHeaders(hasJson = false, extra = {}) {
  const { serviceRoleKey } = getEnv();
  const headers = {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function clearAssigneeFromProperties(targetId) {
  const { url } = getEnv();
  const res = await fetch(`${url}/rest/v1/properties?assignee_id=eq.${encodeURIComponent(targetId)}`, {
    method: 'PATCH',
    headers: buildSupabaseHeaders(true, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ assignee_id: null }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || '담당 물건 연결 해제에 실패했습니다.');
  }
}

function clearAssigneeFromStoreProperties(store, targetId) {
  const items = Array.isArray(store?.properties) ? store.properties : [];
  for (const row of items) {
    if (String(row?.assignee_id || row?.assigneeId || '').trim() !== String(targetId || '').trim()) continue;
    row.assignee_id = null;
    row.assigneeId = null;
    if (row.raw && typeof row.raw === 'object') {
      row.raw.assignee_id = null;
      row.raw.assigneeId = null;
    }
  }
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  const body = req.method === 'GET' ? null : getJsonBody(req);
  const targetId = readTargetId(req, body);

  if (hasSupabaseAdminEnv()) {
    const session = await requireSupabaseAdmin(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      if (targetId) {
        const item = await getStaff(targetId);
        if (!item) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
        return send(res, 200, { ok: true, item });
      }
      const items = await listStaff();
      return send(res, 200, { ok: true, items });
    }

    if (req.method === 'POST') {
      const email = String(body?.email || '').trim().toLowerCase();
      const name = String(body?.name || '').trim();
      const password = String(body?.password || '').trim();
      const role = normalizeRoleValue(body?.role);
      const position = String(body?.position || '').trim();
      const phone = normalizePhone(body?.phone || '');

      if (!email || !name || !password) {
        return send(res, 400, { ok: false, message: 'email, name, password는 필수입니다.' });
      }

      try {
        const user = await createAuthUser({ email, password, name, role, position, phone });
        const item = await getStaff(user.id).catch(() => null);
        return send(res, 201, {
          ok: true,
          item: item || {
            id: user.id,
            email: user.email || email,
            name,
            role,
            position,
            phone,
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

    if (req.method === 'PATCH') {
      if (!targetId) return send(res, 400, { ok: false, message: 'id가 필요합니다.' });
      const patch = {};
      if (body?.name != null) patch.name = body.name;
      if (body?.role != null) patch.role = body.role;
      if (body?.assignedRegions != null) patch.assignedRegions = body.assignedRegions;
      if (body?.password != null) patch.password = body.password;
      if (body?.email != null) patch.email = body.email;
      if (body?.position != null) patch.position = body.position;
      if (body?.phone != null) patch.phone = body.phone;

      try {
        const item = await updateStaff(targetId, patch);
        return send(res, 200, { ok: true, item });
      } catch (err) {
        return send(res, err?.status || 500, { ok: false, message: err?.message || '수정 실패' });
      }
    }

    if (req.method === 'DELETE') {
      if (!targetId) return send(res, 400, { ok: false, message: 'id가 필요합니다.' });
      const items = await listStaff();
      const target = items.find((row) => row.id === targetId);
      if (!target) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
      if (target.role === 'admin' && items.filter((row) => row.role === 'admin').length <= 1) {
        return send(res, 400, { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' });
      }

      try {
        await clearAssigneeFromProperties(targetId);
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
    if (targetId) {
      const user = store.staff.find((u) => u.id === targetId);
      if (!user) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
      return send(res, 200, {
        ok: true,
        item: {
          ...user,
          role: normalizeRoleValue(user.role),
          assignedRegions: Array.isArray(user.regions) ? user.regions : [],
          password: undefined,
        },
      });
    }
    return send(res, 200, {
      ok: true,
      items: store.staff.map((u) => ({
        ...u,
        role: normalizeRoleValue(u.role),
        assignedRegions: Array.isArray(u.regions) ? u.regions : [],
        password: undefined,
      })),
    });
  }

  if (req.method === 'POST') {
    const email = String(body?.email || '').trim().toLowerCase();
    const name = String(body?.name || '').trim();
    const password = String(body?.password || '').trim();
    const role = normalizeRoleValue(body?.role);
    const position = String(body?.position || '').trim();
    const phone = normalizePhone(body?.phone || '');

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
      position,
      phone,
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

  if (req.method === 'PATCH') {
    if (!targetId) return send(res, 400, { ok: false, message: 'id가 필요합니다.' });
    const user = store.staff.find((u) => u.id === targetId);
    if (!user) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });

    if (body?.name != null) {
      const nextName = String(body.name || '').trim();
      if (!nextName) return send(res, 400, { ok: false, message: 'name은 비울 수 없습니다.' });
      user.name = nextName;
    }
    if (body?.role != null) user.role = normalizeRoleValue(body.role);
    if (body?.password != null && String(body.password || '').trim()) user.password = String(body.password || '').trim();
    if (body?.assignedRegions != null) user.regions = Array.isArray(body.assignedRegions) ? body.assignedRegions : [];
    if (body?.email != null) user.email = String(body.email || '').trim().toLowerCase();
    if (body?.position != null) user.position = String(body.position || '').trim();
    if (body?.phone != null) user.phone = normalizePhone(body.phone || '');
    user.updatedAt = nowIso();

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
    if (!targetId) return send(res, 400, { ok: false, message: 'id가 필요합니다.' });
    const idx = store.staff.findIndex((u) => u.id === targetId);
    if (idx < 0) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
    if (store.staff[idx].role === 'admin' && store.staff.filter((u) => u.role === 'admin').length <= 1) {
      return send(res, 400, { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' });
    }
    clearAssigneeFromStoreProperties(store, targetId);
    const [removed] = store.staff.splice(idx, 1);
    return send(res, 200, { ok: true, removedId: removed.id });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
