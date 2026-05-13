// api/_lib/activity-log.js
// ──────────────────────────────────────────────────────────────────────────
// 담당자 배정 변경 활동로그(property_activity_logs.action_type='assignee_change')
// 를 일괄 기록하는 공통 헬퍼.
//
// _lib 폴더 안에 있으므로 Vercel function 카운트에 영향 없음
// (다른 API 라우트들에서 require 해 사용).
//
// 사용처:
//   - api/properties.js                    (담당자/관리자 매물 수정 PATCH)
//   - api/admin/properties.js              (관리자 매물 수정 PATCH)
//   - api/admin/assignment-batches.js      (자동 배정 + rollback)
//   - api/admin/staff/index.js             (담당자 퇴사 → assignee_id NULL 일괄 처리)
//
// 설계 원칙:
//   1) 동일 처리(prev==next)는 자동 스킵 → 거짓 로그 방지
//   2) 1회 호출에 여러 매물 일괄 처리 가능 (자동 배정/퇴사 처리 시 효율)
//   3) 어떤 처리 경로로 들어왔는지 식별 가능하도록 reason 메타를 changed_fields 에 함께 저장
//   4) 로그 기록 실패는 본 작업(=배정 변경)을 깨뜨리지 않도록 호출부에서 try/catch 권장.
//      여기서는 fail-fast 대신 결과 객체로 성공/실패 카운트 반환.
//
// note 포맷 (사용자 합의):  "${prevName||'미배정'} → ${nextName||'미배정'}"
// ──────────────────────────────────────────────────────────────────────────

const { getEnv } = require('./supabase-admin');

const ACTION_TYPE = 'assignee_change';

// chunked POST 사이즈 — Supabase REST 단일 요청 URL/페이로드 한도 고려.
// 자동 배정 1,000건 일괄 처리 시에도 10회로 끊어 처리.
const INSERT_CHUNK = 100;

// reason 키 표준화 (Q1 의 5가지 경로):
//   manual          : 매물 수정 모달에서 관리자/담당자가 수동 변경
//   new_property    : 신규 등록 시 첫 배정 (관리자 모달, CSV 업로드 포함)
//   auto_batch      : 자동 물건 배정 (assignment-batches POST)
//   rollback        : 배정 되돌리기 (assignment-batches rollback)
//   resignation     : 담당자 퇴사로 인한 자동 해제 (staff DELETE)
const ALLOWED_REASONS = new Set([
  'manual', 'new_property', 'auto_batch', 'rollback', 'resignation',
]);

function trimText(v, max) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return max && s.length > max ? s.slice(0, max) : s;
}

function todayKstDate() {
  // KST 기준 YYYY-MM-DD (다른 활동로그와 정합성 유지)
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

function makeNote(prevName, nextName) {
  const a = trimText(prevName) || '미배정';
  const b = trimText(nextName) || '미배정';
  return `${a} → ${b}`;
}

function normalizeId(v) {
  return trimText(v).slice(0, 120);
}

// 각 엔트리 → property_activity_logs row.
// 동일하면 null 반환 (스킵).
function buildRow(entry, actor, reason) {
  const prevId = normalizeId(entry.prevId);
  const nextId = normalizeId(entry.nextId);
  const prevName = trimText(entry.prevName);
  const nextName = trimText(entry.nextName);

  // 진짜 변경이 아니면 스킵
  if (prevId === nextId && prevName === nextName) return null;

  const propertyId = normalizeId(entry.propertyId);
  if (!propertyId) return null;  // 매물 식별자 없으면 추적 불가

  const changedFields = ['assignee'];
  // reason 메타는 별도 컬럼 없으므로 changed_fields 에 함께 보관 (DB 스키마 변경 없이 표시).
  if (ALLOWED_REASONS.has(reason)) changedFields.push(`reason:${reason}`);

  return {
    actor_id: actor.id,
    actor_name: trimText(actor.name, 120) || null,
    property_id: propertyId,
    property_identity_key: trimText(entry.identityKey, 180) || null,
    property_item_no: trimText(entry.itemNo, 120) || null,
    property_address: trimText(entry.address, 500) || null,
    action_type: ACTION_TYPE,
    action_date: todayKstDate(),
    changed_fields: changedFields,
    note: makeNote(prevName, nextName),
  };
}

async function postBatch(url, serviceRoleKey, rows) {
  const res = await fetch(`${url}/rest/v1/property_activity_logs`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || `Supabase 활동로그 기록 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
}

// 메인 export.
// 반환: { ok:boolean, inserted:number, skipped:number, failed:number, errors:[Error] }
// 로그 기록 실패가 본 작업(배정 변경)을 막지 않도록 throw 하지 않음.
async function recordAssigneeChangeLogs({ entries, actor, reason }) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const actorId = actor && actor.id ? String(actor.id).trim() : '';
  const result = { ok: true, inserted: 0, skipped: 0, failed: 0, errors: [] };

  if (!actorId) {
    // actor_id 가 NOT NULL 이라 빈 actor 면 진입 자체 차단
    result.ok = false;
    result.errors.push(new Error('activity-log: actor.id 가 비어 있음'));
    return result;
  }

  const rows = [];
  for (const e of safeEntries) {
    const row = buildRow(e || {}, { id: actorId, name: actor.name || '' }, reason);
    if (row) rows.push(row);
    else result.skipped += 1;
  }
  if (!rows.length) return result;

  const env = getEnv();
  if (!env.url || !env.serviceRoleKey) {
    // 운영 환경 변수 없으면 로컬/개발 fallback — 조용히 스킵
    result.skipped += rows.length;
    return result;
  }

  // 100건씩 끊어 POST
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const block = rows.slice(i, i + INSERT_CHUNK);
    try {
      await postBatch(env.url, env.serviceRoleKey, block);
      result.inserted += block.length;
    } catch (err) {
      result.failed += block.length;
      result.errors.push(err);
      result.ok = false;
    }
  }

  return result;
}

module.exports = {
  ACTION_TYPE,
  recordAssigneeChangeLogs,
  // 테스트/내부 디버깅용 export
  _internals: { buildRow, makeNote, todayKstDate },
};
