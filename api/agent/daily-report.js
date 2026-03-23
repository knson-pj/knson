const { applyCors } = require('../_lib/cors');
const { send, getJsonBody } = require('../_lib/utils');
const { getEnv, resolveCurrentUserContext } = require('../_lib/supabase-admin');

function kstDateKey(input) {
  const d = input ? new Date(input) : new Date();
  if (!d || Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value || '';
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = parts.find((p) => p.type === 'day')?.value || '';
    return year && month && day ? `${year}-${month}-${day}` : '';
  } catch {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function getRestBaseAndHeaders() {
  const { url, serviceRoleKey } = getEnv();
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  return {
    baseUrl: url,
    headers: {
      Accept: 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  };
}

async function restFetch(path, options = {}) {
  const { baseUrl, headers } = getRestBaseAndHeaders();
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...headers,
      ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!res.ok) {
    const rawMessage =
      data?.message ||
      data?.msg ||
      data?.error_description ||
      data?.details ||
      data?.hint ||
      data?.error ||
      `Supabase REST 오류 (${res.status})`;
    const message = /property_activity_logs/i.test(String(rawMessage || ''))
      ? 'property_activity_logs 테이블이 없거나 접근할 수 없습니다. migration SQL을 먼저 실행해 주세요.'
      : String(rawMessage || `Supabase REST 오류 (${res.status})`);
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function normalizeActionType(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  const map = {
    new_property: 'new_property',
    newproperty: 'new_property',
    rights_analysis: 'rights_analysis',
    rightsanalysis: 'rights_analysis',
    site_inspection: 'site_inspection',
    siteinspection: 'site_inspection',
    daily_issue: 'daily_issue',
    dailyissue: 'daily_issue',
    property_update: 'property_update',
    propertyupdate: 'property_update',
  };
  return map[s] || '';
}

function cleanText(value, max = 500) {
  const s = String(value || '').trim();
  return s ? s.slice(0, max) : null;
}

function normalizeChangedFields(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const s = String(entry || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s.slice(0, 80));
  }
  return out;
}

function normalizeEntry(entry, ctx) {
  const actionType = normalizeActionType(entry?.actionType);
  if (!actionType) return null;
  return {
    actor_id: ctx.userId,
    actor_name: cleanText(ctx.name || ctx.email || '', 120),
    property_id: cleanText(entry?.propertyId, 120),
    property_identity_key: cleanText(entry?.propertyIdentityKey, 180),
    property_item_no: cleanText(entry?.propertyItemNo, 120),
    property_address: cleanText(entry?.propertyAddress, 500),
    action_type: actionType,
    action_date: /^\d{4}-\d{2}-\d{2}$/.test(String(entry?.actionDate || '').trim())
      ? String(entry.actionDate).trim()
      : kstDateKey(),
    changed_fields: normalizeChangedFields(entry?.changedFields),
    note: cleanText(entry?.note, 4000),
  };
}

function summarize(rows) {
  const defs = {
    new_property: 'newProperty',
    rights_analysis: 'rightsAnalysis',
    site_inspection: 'siteInspection',
    daily_issue: 'dailyIssue',
  };
  const buckets = {
    newProperty: new Set(),
    rightsAnalysis: new Set(),
    siteInspection: new Set(),
    dailyIssue: new Set(),
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    const bucket = defs[String(row?.action_type || '').trim()];
    if (!bucket) continue;
    const key = String(
      row?.property_id ||
      row?.property_identity_key ||
      row?.property_item_no ||
      row?.property_address ||
      row?.id ||
      ''
    ).trim();
    if (!key) continue;
    buckets[bucket].add(key);
  }
  const counts = {
    newProperty: buckets.newProperty.size,
    rightsAnalysis: buckets.rightsAnalysis.size,
    siteInspection: buckets.siteInspection.size,
    dailyIssue: buckets.dailyIssue.size,
  };
  counts.total = counts.newProperty + counts.rightsAnalysis + counts.siteInspection + counts.dailyIssue;
  return counts;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  let ctx = null;
  try {
    ctx = await resolveCurrentUserContext(req);
  } catch (err) {
    return send(res, 500, { ok: false, message: err?.message || '사용자 확인에 실패했습니다.' });
  }

  if (!ctx?.userId) {
    return send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  }

  if (!['staff', 'admin'].includes(String(ctx.role || '').trim())) {
    return send(res, 403, { ok: false, message: '담당자 또는 관리자 권한이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get('date') || '').trim())
        ? String(url.searchParams.get('date')).trim()
        : kstDateKey();
      const requestedActorId = cleanText(url.searchParams.get('actor_id'), 120);
      const actorId = ctx.role === 'admin' && requestedActorId ? requestedActorId : ctx.userId;
      const rows = await restFetch(
        `/rest/v1/property_activity_logs?select=id,actor_id,actor_name,property_id,property_identity_key,property_item_no,property_address,action_type,action_date,changed_fields,note,created_at&actor_id=eq.${encodeURIComponent(actorId)}&action_date=eq.${encodeURIComponent(date)}&order=created_at.desc`
      );
      return send(res, 200, {
        ok: true,
        date,
        actorId,
        counts: summarize(rows),
        items: Array.isArray(rows) ? rows : [],
      });
    } catch (err) {
      return send(res, err?.status || 500, { ok: false, message: err?.message || '일일업무일지 조회 실패' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = getJsonBody(req);
      const rows = (Array.isArray(body?.entries) ? body.entries : [body])
        .map((entry) => normalizeEntry(entry, ctx))
        .filter(Boolean);

      if (!rows.length) {
        return send(res, 400, { ok: false, message: '기록할 업무일지 항목이 없습니다.' });
      }

      const created = await restFetch('/rest/v1/property_activity_logs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        json: rows,
      });

      return send(res, 201, {
        ok: true,
        createdCount: Array.isArray(created) ? created.length : 0,
        items: Array.isArray(created) ? created : [],
      });
    } catch (err) {
      return send(res, err?.status || 500, { ok: false, message: err?.message || '일일업무일지 기록 실패' });
    }
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
