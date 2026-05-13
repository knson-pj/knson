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
const { requireTierWrite } = require('../../_lib/admin-tier');
const { recordAssigneeChangeLogs } = require('../../_lib/activity-log');

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

// 담당자 퇴사 시 그 담당자에게 묶인 매물들의 배정 정보 일괄 해제.
//
// 이전 버전 결함 보수 (사용자 합의):
//   ① assignee_name 컬럼이 비워지지 않음 → 유령 이름 잔존
//   ② raw jsonb 내 assignee_id / assigneeId / assignee_name / assigneeName / assignedAgentId
//      / assignedAgentName 6개 키가 비워지지 않음 → 백업본도 유령 데이터
//   ③ 활동로그 미기록 → 누가 언제 어떤 매물을 퇴사 처리했는지 추적 불가
//
// 본 함수는 ①②③ 을 한 번에 해결.
//   - 단계 1: 영향받는 매물 스냅샷 조회 (item_no/address 메타 포함, 로그용)
//   - 단계 2: assignee_id + assignee_name + raw 6개 키를 한 번의 PATCH 로 모두 NULL/빈 처리
//   - 단계 3: 호출부가 활동로그를 기록할 수 있도록 스냅샷 반환
async function clearAssigneeFromProperties(targetId) {
  const { url } = getEnv();

  // 1) 영향받는 매물 스냅샷 수집
  const selRes = await fetch(
    `${url}/rest/v1/properties?select=id,item_no,address,assignee_id,assignee_name,raw&assignee_id=eq.${encodeURIComponent(targetId)}`,
    { method: 'GET', headers: buildSupabaseHeaders(false) }
  );
  if (!selRes.ok) {
    const text = await selRes.text().catch(() => '');
    throw new Error(text || '담당 물건 조회에 실패했습니다.');
  }
  const affected = await selRes.json().catch(() => []);
  if (!Array.isArray(affected) || !affected.length) {
    // 영향받는 매물이 없으면 더 할 일 없음
    return { affected: [] };
  }

  // 2) raw 백업본 키까지 모두 정리해 일괄 PATCH.
  //    PATCH 는 모든 매칭 행에 동일 raw 객체로 덮어쓰지 못함 → 행별로 raw 머지 후 개별 PATCH.
  //    (assignee_id/assignee_name 만이면 단일 PATCH 가능하나, raw 머지는 행별이 안전)
  const errors = [];
  for (const row of affected) {
    const cleanedRaw = { ...(row.raw && typeof row.raw === 'object' ? row.raw : {}) };
    cleanedRaw.assignee_id = null;
    cleanedRaw.assigneeId = null;
    cleanedRaw.assigneeName = null;
    cleanedRaw.assignee_name = null;
    cleanedRaw.assignedAgentId = null;
    cleanedRaw.assignedAgentName = null;

    const patchRes = await fetch(
      `${url}/rest/v1/properties?id=eq.${encodeURIComponent(row.id)}`,
      {
        method: 'PATCH',
        headers: buildSupabaseHeaders(true, { Prefer: 'return=minimal' }),
        body: JSON.stringify({
          assignee_id: null,
          assignee_name: null,
          raw: cleanedRaw,
        }),
      }
    );
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '');
      errors.push({ id: row.id, error: text || `HTTP ${patchRes.status}` });
    }
  }

  if (errors.length && errors.length === affected.length) {
    // 한 건도 처리 못한 경우만 전체 실패로 간주
    throw new Error('담당 물건 연결 해제에 실패했습니다: ' + (errors[0]?.error || ''));
  }

  return { affected, errors };
}

function clearAssigneeFromStoreProperties(store, targetId) {
  const items = Array.isArray(store?.properties) ? store.properties : [];
  for (const row of items) {
    if (String(row?.assignee_id || row?.assigneeId || '').trim() !== String(targetId || '').trim()) continue;
    row.assignee_id = null;
    row.assigneeId = null;
    row.assignee_name = null;
    row.assigneeName = null;
    if (row.raw && typeof row.raw === 'object') {
      row.raw.assignee_id = null;
      row.raw.assigneeId = null;
      row.raw.assignee_name = null;
      row.raw.assigneeName = null;
      row.raw.assignedAgentId = null;
      row.raw.assignedAgentName = null;
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
      // 담당자 신규 생성은 master 만 가능 (2026-05-08 admin_tier 도입)
      if (!requireTierWrite(session, 'staff', res)) return;
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
      // 자기 자신 수정은 self (basic 도 가능), 타인 수정은 staff (master 만 가능) — 2026-05-08
      const resourceKey = (targetId === session.userId) ? 'self' : 'staff';
      if (!requireTierWrite(session, resourceKey, res)) return;
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
      // 담당자 삭제는 master 만 가능 (2026-05-08 admin_tier 도입)
      if (!requireTierWrite(session, 'staff', res)) return;
      const items = await listStaff();
      const target = items.find((row) => row.id === targetId);
      if (!target) return send(res, 404, { ok: false, message: '계정을 찾을 수 없습니다.' });
      if (target.role === 'admin' && items.filter((row) => row.role === 'admin').length <= 1) {
        return send(res, 400, { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' });
      }

      try {
        // ① 영향받는 매물 스냅샷 + 데이터 정리 (이전 결함 보수 포함)
        const clearResult = await clearAssigneeFromProperties(targetId);

        // ② 활동로그 기록 (담당자 → 미배정), reason='resignation'
        //    actor 는 현재 세션의 관리자 (Q3 합의: 삭제 버튼을 누른 관리자)
        try {
          const affected = Array.isArray(clearResult?.affected) ? clearResult.affected : [];
          if (affected.length) {
            const logEntries = affected.map((row) => ({
              propertyId: String(row.id || ''),
              identityKey: row.raw?.registrationIdentityKey || null,
              itemNo: row.item_no || null,
              address: row.address || null,
              prevId: String(row.assignee_id || '').trim(),
              prevName: String(row.assignee_name || target.name || '').trim(),
              nextId: '',
              nextName: '',
            })).filter((e) => e.propertyId);
            if (logEntries.length) {
              await recordAssigneeChangeLogs({
                entries: logEntries,
                actor: { id: session.userId || session.user?.id, name: session.name || session.user?.name || '' },
                reason: 'resignation',
              });
            }
          }
        } catch (logErr) {
          console.warn('[assignee_change_log] resignation skipped:', logErr?.message || logErr);
        }

        // ③ 마지막에 auth 사용자 삭제 (= profiles cascade 삭제)
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
