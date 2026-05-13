// ═══════════════════════════════════════════════════════════════════
// api/admin/assignment-batches.js
// 자동 물건 배정 배치 이력 관리
//
// 지원 엔드포인트:
//   GET    /api/admin/assignment-batches            → 목록 (3주 이내)
//   POST   /api/admin/assignment-batches            → 새 배치 생성 + properties 일괄 배정
//   POST   /api/admin/assignment-batches?id=xxx&action=rollback
//                                                   → 전체 롤백 또는 담당자 한정 롤백
//
// service_role 키 사용 → enforce_staff_property_update 트리거를 안전하게 통과
// 2026-04-17
// ═══════════════════════════════════════════════════════════════════
const { applyCors } = require('../_lib/cors');
const { send, getJsonBody } = require('../_lib/utils');
const { hasSupabaseAdminEnv, requireSupabaseAdmin, getEnv } = require('../_lib/supabase-admin');
const { requireTierWrite } = require('../_lib/admin-tier');
const { recordAssigneeChangeLogs } = require('../_lib/activity-log');

// ──────────────────────────────────────────────────────────────────
// 공통 헬퍼
// ──────────────────────────────────────────────────────────────────
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

async function sbRest(path, { method = 'GET', json, headers } = {}) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: buildSupabaseHeaders(json !== undefined, headers),
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  if (!res.ok) {
    const err = new Error(
      (data && (data.message || data.msg || data.error_description || data.error)) ||
      `Supabase 오류 (${res.status})`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function sbRpc(fnName, args = {}) {
  return sbRest(`/rest/v1/rpc/${fnName}`, { method: 'POST', json: args });
}

// 배열을 n 크기로 쪼개기
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 3주 경과 배치 자동 삭제 (실패해도 무시)
async function cleanupOldBatches() {
  try {
    await sbRpc('cleanup_old_assignment_batches', {});
  } catch (e) {
    // 함수 없거나 실패해도 조용히 넘어감
    console.warn('[assignment-batches] cleanup skipped:', e?.message || e);
  }
}

// ──────────────────────────────────────────────────────────────────
// GET: 배치 목록
// ──────────────────────────────────────────────────────────────────
async function handleList(req, res) {
  await cleanupOldBatches();
  // 3주 = 21일 이내만 (cleanup 이 실패한 경우 대비 이중 필터)
  const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
  const path = `/rest/v1/property_assignment_batches`
    + `?select=id,created_at,created_by,created_by_name,total_count,filter_snapshot,agent_summary,status,rolled_back_at,rolled_back_by,rolled_back_summary,note`
    + `&created_at=gte.${encodeURIComponent(since)}`
    + `&order=created_at.desc`;
  const rows = await sbRest(path);
  return send(res, 200, { ok: true, batches: Array.isArray(rows) ? rows : [] });
}

// ──────────────────────────────────────────────────────────────────
// POST: 배치 생성 + properties 일괄 UPDATE
// body: {
//   assignments: [{ propertyId, agentId, agentName }],
//   filterSnapshot: { sidos, gus, dongs, sources, areas, prices, agentIds },
//   agentSummary: { [agentId]: { name, count } },
//   note: string
// }
// ──────────────────────────────────────────────────────────────────
async function handleCreate(req, res, admin) {
  const body = await getJsonBody(req);
  const assignments = Array.isArray(body?.assignments) ? body.assignments : [];
  if (!assignments.length) {
    return send(res, 400, { ok: false, message: '배정할 물건 목록이 비어있습니다.' });
  }

  // 1) 배치 row 생성
  const batchInsert = {
    created_by: admin.userId,
    created_by_name: admin.name || admin.email || '',
    total_count: assignments.length,
    filter_snapshot: body?.filterSnapshot || {},
    agent_summary: body?.agentSummary || {},
    note: body?.note ? String(body.note).slice(0, 500) : null,
  };
  const batchRows = await sbRest('/rest/v1/property_assignment_batches', {
    method: 'POST',
    json: batchInsert,
    headers: { Prefer: 'return=representation' },
  });
  const batch = Array.isArray(batchRows) ? batchRows[0] : batchRows;
  if (!batch?.id) {
    return send(res, 500, { ok: false, message: '배치 생성 실패.' });
  }

  // 2) 각 property 의 현재 assignee 스냅샷 조회 (prev 저장용 + 활동로그용 메타데이터 동시 수집)
  const propertyIds = assignments.map((a) => String(a.propertyId || '')).filter(Boolean);
  const prevMap = new Map();
  for (const ids of chunk(propertyIds, 200)) {
    const inList = ids.map((v) => `"${v}"`).join(',');
    const rows = await sbRest(`/rest/v1/properties?select=id,assignee_id,assignee_name,item_no,address,raw&id=in.(${inList})`);
    (rows || []).forEach((r) => prevMap.set(String(r.id), r));
  }

  // 3) batch_items 생성 (200 건씩 chunked insert)
  const itemsToInsert = assignments.map((a) => {
    const pid = String(a.propertyId || '');
    const prev = prevMap.get(pid) || {};
    return {
      batch_id: batch.id,
      property_id: pid,
      agent_id: String(a.agentId || ''),
      agent_name: String(a.agentName || ''),
      prev_agent_id: prev.assignee_id || null,
      prev_agent_name: prev.assignee_name || null,
    };
  }).filter((i) => i.property_id && i.agent_id);

  let itemsInserted = 0;
  for (const block of chunk(itemsToInsert, 200)) {
    try {
      await sbRest('/rest/v1/property_assignment_batch_items', {
        method: 'POST',
        json: block,
      });
      itemsInserted += block.length;
    } catch (err) {
      console.error('[batch_items insert failed]', err?.message);
    }
  }

  // 4) properties 실제 UPDATE (chunked. 한 번에 too-long URL 회피)
  // 담당자별로 묶어서 UPDATE (id=in.(...) 방식)
  const byAgent = new Map(); // agentId -> { name, ids[] }
  for (const a of assignments) {
    const aid = String(a.agentId || '');
    const pid = String(a.propertyId || '');
    if (!aid || !pid) continue;
    if (!byAgent.has(aid)) byAgent.set(aid, { name: String(a.agentName || ''), ids: [] });
    byAgent.get(aid).ids.push(pid);
  }

  let okCount = 0;
  let failCount = 0;
  const assignedAtIso = new Date().toISOString();
  for (const [agentId, { name, ids }] of byAgent.entries()) {
    for (const block of chunk(ids, 100)) {
      const inList = block.map((v) => `"${v}"`).join(',');
      try {
        await sbRest(`/rest/v1/properties?id=in.(${inList})`, {
          method: 'PATCH',
          json: { assignee_id: agentId, assignee_name: name, assigned_at: assignedAtIso },
        });
        okCount += block.length;
      } catch (err) {
        console.error('[properties batch update failed]', err?.message);
        failCount += block.length;
      }
    }
  }

  // ── 자동 배정 로그 (Q1: 모든 경로, Q-C: 매물별 개별 로그 유지)
  //    properties PATCH 완료 후, 본 응답을 막지 않게 try/catch.
  //    같은 담당자로 재배정되는 경우(prev==next)는 헬퍼가 자동 스킵.
  try {
    const logEntries = assignments.map((a) => {
      const pid = String(a.propertyId || '');
      const prev = prevMap.get(pid) || {};
      return {
        propertyId: pid,
        identityKey: prev.raw?.registrationIdentityKey || null,
        itemNo: prev.item_no || null,
        address: prev.address || null,
        prevId: String(prev.assignee_id || '').trim(),
        prevName: String(prev.assignee_name || '').trim(),
        nextId: String(a.agentId || '').trim(),
        nextName: String(a.agentName || '').trim(),
      };
    }).filter((e) => e.propertyId);
    if (logEntries.length) {
      await recordAssigneeChangeLogs({
        entries: logEntries,
        actor: { id: admin.userId, name: admin.name || admin.email || '' },
        reason: 'auto_batch',
      });
    }
  } catch (logErr) {
    console.warn('[assignee_change_log] auto_batch skipped:', logErr?.message || logErr);
  }

  return send(res, 200, {
    ok: true,
    batch: {
      id: batch.id,
      createdAt: batch.created_at,
      totalCount: batch.total_count,
      itemsRecorded: itemsInserted,
      propertiesUpdated: okCount,
      propertiesFailed: failCount,
    },
  });
}

// ──────────────────────────────────────────────────────────────────
// POST .../?id=xxx&action=rollback: 전체/담당자별 롤백
// body: { agentIds?: string[] }  // 없거나 [] 면 전체
// ──────────────────────────────────────────────────────────────────
async function handleRollback(req, res, admin, batchId) {
  const body = await getJsonBody(req);
  const agentIds = Array.isArray(body?.agentIds) ? body.agentIds.map((v) => String(v)).filter(Boolean) : [];

  // 1) 배치 로드
  const [batch] = await sbRest(`/rest/v1/property_assignment_batches?id=eq.${encodeURIComponent(batchId)}&select=*&limit=1`);
  if (!batch) return send(res, 404, { ok: false, message: '배치를 찾을 수 없습니다.' });
  if (batch.status === 'rolled_back') {
    return send(res, 409, { ok: false, message: '이미 전체 롤백된 배치입니다.' });
  }

  // 2) 대상 items 조회 (아직 롤백 안 된 것만)
  let itemsPath = `/rest/v1/property_assignment_batch_items`
    + `?select=id,property_id,agent_id,agent_name,prev_agent_id,prev_agent_name`
    + `&batch_id=eq.${encodeURIComponent(batchId)}`
    + `&rolled_back_at=is.null`;
  if (agentIds.length) {
    const inList = agentIds.map((v) => `"${v}"`).join(',');
    itemsPath += `&agent_id=in.(${inList})`;
  }
  const items = await sbRest(itemsPath);
  if (!items || !items.length) {
    return send(res, 400, { ok: false, message: '롤백 가능한 대상이 없습니다.' });
  }

  // 3) properties 복원: prev_agent_id 가 있으면 이전 담당자로, 없으면 NULL 로
  // 단순하게: prev 상관없이 NULL 복원 (자동배정 직전 상태는 거의 항상 미배정이었을 것)
  // → 혹시 다른 담당자에게 배정돼 있던 것이면 prev 로 복원 시도
  // 구현: prev_agent_id 존재 여부로 두 그룹 분리
  const restoreToNull = items.filter((i) => !i.prev_agent_id).map((i) => i.property_id);
  const restoreToPrev = new Map();  // prevAgentId -> { name, ids[] }
  items.filter((i) => i.prev_agent_id).forEach((i) => {
    const k = i.prev_agent_id;
    if (!restoreToPrev.has(k)) restoreToPrev.set(k, { name: i.prev_agent_name || '', ids: [] });
    restoreToPrev.get(k).ids.push(i.property_id);
  });

  let restoredOk = 0;
  let restoredFail = 0;

  for (const block of chunk(restoreToNull, 100)) {
    const inList = block.map((v) => `"${v}"`).join(',');
    try {
      await sbRest(`/rest/v1/properties?id=in.(${inList})`, {
        method: 'PATCH',
        json: { assignee_id: null, assignee_name: null, assigned_at: null },
      });
      restoredOk += block.length;
    } catch (err) {
      console.error('[rollback -> null failed]', err?.message);
      restoredFail += block.length;
    }
  }
  for (const [prevId, { name, ids }] of restoreToPrev.entries()) {
    for (const block of chunk(ids, 100)) {
      const inList = block.map((v) => `"${v}"`).join(',');
      try {
        await sbRest(`/rest/v1/properties?id=in.(${inList})`, {
          method: 'PATCH',
          json: { assignee_id: prevId, assignee_name: name },
        });
        restoredOk += block.length;
      } catch (err) {
        console.error('[rollback -> prev failed]', err?.message);
        restoredFail += block.length;
      }
    }
  }

  // 4) batch_items.rolled_back_at 마킹
  const nowIso = new Date().toISOString();
  const itemIds = items.map((i) => i.id);
  for (const block of chunk(itemIds, 200)) {
    const inList = block.map((v) => `"${v}"`).join(',');
    try {
      await sbRest(`/rest/v1/property_assignment_batch_items?id=in.(${inList})`, {
        method: 'PATCH',
        json: { rolled_back_at: nowIso },
      });
    } catch (err) {
      console.warn('[mark items rolled_back failed]', err?.message);
    }
  }

  // 5) 배치 status 갱신
  // 아직 안 롤백된 items 있나?
  const [{ count: remainingRaw } = { count: 0 }] = await sbRest(
    `/rest/v1/property_assignment_batch_items?select=id&batch_id=eq.${encodeURIComponent(batchId)}&rolled_back_at=is.null&limit=1`,
    { headers: { Prefer: 'count=exact' } }
  ).then((rows) => [{ count: Array.isArray(rows) ? rows.length : 0 }]).catch(() => [{ count: 0 }]);
  // 위 방식은 정확 count 가 아님 → HEAD 로 정확 집계
  let remainingCount = 0;
  try {
    const headRes = await fetch(`${getEnv().url}/rest/v1/property_assignment_batch_items?select=id&batch_id=eq.${encodeURIComponent(batchId)}&rolled_back_at=is.null`, {
      method: 'HEAD',
      headers: buildSupabaseHeaders(false, { Prefer: 'count=exact' }),
    });
    const cr = String(headRes.headers.get('content-range') || '');
    const m = cr.match(/\/(\d+)$/);
    remainingCount = m ? Number(m[1] || 0) : 0;
  } catch (_) { remainingCount = 0; }

  const newStatus = remainingCount === 0 ? 'rolled_back' : 'partial';
  const rollbackSummary = {
    at: nowIso,
    agentIds: agentIds.length ? agentIds : 'all',
    count: items.length,
    restored: restoredOk,
    failed: restoredFail,
  };
  try {
    // partial 인 경우엔 rolled_back_at/by 는 NULL 유지
    const patch = {
      status: newStatus,
      rolled_back_summary: rollbackSummary,
    };
    if (newStatus === 'rolled_back') {
      patch.rolled_back_at = nowIso;
      patch.rolled_back_by = admin.userId;
    }
    await sbRest(`/rest/v1/property_assignment_batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: 'PATCH',
      json: patch,
    });
  } catch (err) {
    console.warn('[update batch status failed]', err?.message);
  }

  // ── 롤백 활동 로그 (Q1: 모든 경로)
  //    batch_items 에 들어 있는 agent_id/agent_name 이 "현재(롤백 전) 담당자"
  //    prev_agent_id/prev_agent_name 이 "롤백 후 복원되는 담당자"
  //    매물 메타데이터(item_no/address/raw)는 batch_items 에 없으므로 보조 SELECT 1회 추가.
  try {
    const propertyIdsForLog = items.map((i) => String(i.property_id || '')).filter(Boolean);
    const metaMap = new Map();
    for (const ids of chunk(propertyIdsForLog, 200)) {
      const inList = ids.map((v) => `"${v}"`).join(',');
      try {
        const rows = await sbRest(`/rest/v1/properties?select=id,item_no,address,raw&id=in.(${inList})`);
        (rows || []).forEach((r) => metaMap.set(String(r.id), r));
      } catch (_) { /* 메타 조회 실패해도 로그는 ID 기반으로 계속 */ }
    }
    const logEntries = items.map((i) => {
      const pid = String(i.property_id || '');
      const meta = metaMap.get(pid) || {};
      return {
        propertyId: pid,
        identityKey: meta.raw?.registrationIdentityKey || null,
        itemNo: meta.item_no || null,
        address: meta.address || null,
        prevId: String(i.agent_id || '').trim(),               // 롤백 직전 담당자 (=현재)
        prevName: String(i.agent_name || '').trim(),
        nextId: String(i.prev_agent_id || '').trim(),          // 롤백 후 복원될 담당자
        nextName: String(i.prev_agent_name || '').trim(),
      };
    }).filter((e) => e.propertyId);
    if (logEntries.length) {
      await recordAssigneeChangeLogs({
        entries: logEntries,
        actor: { id: admin.userId, name: admin.name || admin.email || '' },
        reason: 'rollback',
      });
    }
  } catch (logErr) {
    console.warn('[assignee_change_log] rollback skipped:', logErr?.message || logErr);
  }

  return send(res, 200, {
    ok: true,
    rollback: {
      batchId,
      newStatus,
      rolledBackCount: items.length,
      restoredOk,
      restoredFail,
      agentIds: agentIds.length ? agentIds : null,
    },
  });
}

// ──────────────────────────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (!hasSupabaseAdminEnv()) {
    return send(res, 503, { ok: false, message: 'Supabase 관리자 환경이 설정되지 않았습니다.' });
  }
  const admin = await requireSupabaseAdmin(req, res);
  if (!admin) return;

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const method = String(req.method || 'GET').toUpperCase();
    const id = url.searchParams.get('id');
    const action = url.searchParams.get('action');

    if (method === 'GET') {
      return await handleList(req, res);
    }
    // POST(신규 배치) / POST?action=rollback 모두 배정 변경 → master/list 만 가능 (2026-05-08)
    if (method === 'POST' && id && action === 'rollback') {
      if (!requireTierWrite(admin, 'regions', res)) return;
      return await handleRollback(req, res, admin, id);
    }
    if (method === 'POST') {
      if (!requireTierWrite(admin, 'regions', res)) return;
      return await handleCreate(req, res, admin);
    }
    return send(res, 405, { ok: false, message: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    console.error('[assignment-batches] error:', err);
    return send(res, err?.status || 500, {
      ok: false,
      message: err?.message || '배치 처리 중 오류가 발생했습니다.',
      details: err?.data || null,
    });
  }
};
