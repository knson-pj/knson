const { getJsonBody, send } = require('./utils');
const { getEnv, resolveCurrentUserContext } = require('./supabase-admin');

const BUCKET = 'property-photos';
const MAX_PHOTOS_PER_PROPERTY = 10;
const SIGNED_URL_EXPIRES = 60 * 60;

function encodeStoragePath(path) {
  return String(path || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function buildHeaders({ hasJson = false, token = '', useAnon = false, extra = {} } = {}) {
  const { serviceRoleKey, anonKey } = getEnv();
  const bearer = String(token || '').trim() || serviceRoleKey;
  const apikey = useAnon ? (anonKey || serviceRoleKey) : serviceRoleKey;
  const headers = {
    Accept: 'application/json',
    apikey,
    Authorization: `Bearer ${bearer}`,
    ...extra,
  };
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function supabaseFetch(path, { method = 'GET', json, body, headers = {}, hasJson = false } = {}) {
  const { url } = getEnv();
  if (!url) throw new Error('SUPABASE_URL 이 설정되지 않았습니다.');
  const res = await fetch(`${url}${path}`, {
    method,
    headers: buildHeaders({ hasJson: hasJson || json !== undefined, extra: headers }),
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error_description || data.error || data.msg)) || `Supabase API 오류 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function trimRef(value) {
  return String(value || '').trim();
}

function parsePropertyId(value) {
  const raw = trimRef(value);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimRef(value));
}

function encodeOrValue(value) {
  return String(value || '').replace(/,/g, '%2C').replace(/\)/g, '%29').replace(/\(/g, '%28');
}

async function getPropertyRow(propertyRef) {
  const rawRef = trimRef(propertyRef);
  if (!rawRef) return null;

  const directRows = await supabaseFetch(`/rest/v1/properties?select=id,global_id,assignee_id,item_no,raw&id=eq.${encodeURIComponent(rawRef)}&limit=1`).catch(() => null);
  if (Array.isArray(directRows) && directRows[0]) return directRows[0];

  const numericId = parsePropertyId(rawRef);
  if (numericId && String(numericId) !== rawRef) {
    const numericRows = await supabaseFetch(`/rest/v1/properties?select=id,global_id,assignee_id,item_no,raw&id=eq.${encodeURIComponent(numericId)}&limit=1`).catch(() => null);
    if (Array.isArray(numericRows) && numericRows[0]) return numericRows[0];
  }

  const ref = encodeOrValue(rawRef);
  const fallbackRows = await supabaseFetch(`/rest/v1/properties?select=id,global_id,assignee_id,item_no,raw&or=(global_id.eq.${ref},item_no.eq.${ref})&limit=1`).catch(() => null);
  return Array.isArray(fallbackRows) ? (fallbackRows[0] || null) : null;
}

function getResolvedPropertyId(row, fallbackRef) {
  const rowId = trimRef(row?.id);
  if (rowId) return rowId;
  return trimRef(fallbackRef);
}

function getRowAssigneeId(row) {
  const raw = row && typeof row.raw === 'object' ? row.raw : {};
  return String(row?.assignee_id || raw.assignee_id || raw.assigneeId || raw.assignedAgentId || raw.assigned_agent_id || '').trim();
}

async function requirePropertyAccess(req, res, propertyId) {
  const rawPropertyRef = trimRef(propertyId);
  if (!rawPropertyRef) {
    send(res, 400, { ok: false, message: 'propertyId가 필요합니다.' });
    return null;
  }
  const ctx = await resolveCurrentUserContext(req).catch(() => null);
  if (!ctx?.userId) {
    send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }
  const property = await getPropertyRow(rawPropertyRef).catch((err) => {
    console.error('property photo property lookup failed', err);
    return null;
  });
  if (!property) {
    send(res, 404, { ok: false, message: '매물을 찾을 수 없습니다.' });
    return null;
  }
  const resolvedId = getResolvedPropertyId(property, rawPropertyRef);
  if (!resolvedId) {
    send(res, 400, { ok: false, message: '사진 기능에서 사용할 수 없는 매물 식별자입니다.' });
    return null;
  }
  if (ctx.role !== 'admin') {
    const assigneeId = getRowAssigneeId(property);
    if (!assigneeId || assigneeId !== String(ctx.userId || '').trim()) {
      send(res, 403, { ok: false, message: '이 매물의 사진을 수정할 권한이 없습니다.' });
      return null;
    }
  }
  return { ctx, propertyId: resolvedId, property, propertyRef: rawPropertyRef };
}

function buildPhotoPaths(propertyId, photoId) {
  const cleanId = trimRef(photoId);
  const safePropertyId = trimRef(propertyId);
  return {
    photoId: cleanId,
    storagePath: `properties/${safePropertyId}/original/${cleanId}.webp`,
    thumbPath: `properties/${safePropertyId}/thumb/${cleanId}.webp`,
  };
}

function decodeDataUrl(dataUrl) {
  const text = String(dataUrl || '');
  const m = text.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('이미지 데이터 형식이 올바르지 않습니다.');
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function uploadObject(path, dataUrl, contentType) {
  const { buffer, mimeType } = decodeDataUrl(dataUrl);
  const targetType = String(contentType || mimeType || 'image/webp').trim() || 'image/webp';
  await supabaseFetch(`/storage/v1/object/${BUCKET}/${encodeStoragePath(path)}`, {
    method: 'POST',
    body: buffer,
    headers: { 'Content-Type': targetType, 'x-upsert': 'true' },
  });
  return { mimeType: targetType, sizeBytes: buffer.length };
}

async function removeObjects(paths) {
  const prefixes = Array.from(new Set((Array.isArray(paths) ? paths : []).filter(Boolean).map((v) => String(v))));
  if (!prefixes.length) return;
  await supabaseFetch(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', json: { prefixes } });
}

async function createSignedUrl(path) {
  const data = await supabaseFetch(`/storage/v1/object/sign/${BUCKET}/${encodeStoragePath(path)}`, {
    method: 'POST',
    json: { expiresIn: SIGNED_URL_EXPIRES },
  });
  const { url } = getEnv();
  const signed = String(data?.signedURL || data?.signedUrl || '').trim();
  if (!signed) return '';
  return signed.startsWith('http') ? signed : `${url}/storage/v1${signed}`;
}

async function listPhotoRows(propertyId) {
  const ref = trimRef(propertyId);
  const rows = await supabaseFetch(`/rest/v1/property_photos?select=*&property_id=eq.${encodeURIComponent(ref)}&deleted_at=is.null&order=sort_order.asc,created_at.asc`);
  return Array.isArray(rows) ? rows : [];
}

async function getPhotoRow(photoId) {
  const rows = await supabaseFetch(`/rest/v1/property_photos?select=*&id=eq.${encodeURIComponent(photoId)}&limit=1`);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function insertPhotoRow(row) {
  const rows = await supabaseFetch('/rest/v1/property_photos?select=*', {
    method: 'POST',
    json: row,
    headers: { Prefer: 'return=representation' },
  });
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function patchPhotoRows(filterQuery, patch) {
  return supabaseFetch(`/rest/v1/property_photos?${filterQuery}`, {
    method: 'PATCH',
    json: patch,
    headers: { Prefer: 'return=representation' },
  });
}

function makeId() {
  return crypto.randomUUID();
}

async function getActivePhotoCount(propertyId) {
  const ref = trimRef(propertyId);
  const rows = await supabaseFetch(`/rest/v1/property_photos?select=id&property_id=eq.${encodeURIComponent(ref)}&deleted_at=is.null`);
  return Array.isArray(rows) ? rows.length : 0;
}

module.exports = {
  BUCKET,
  MAX_PHOTOS_PER_PROPERTY,
  getJsonBody,
  requirePropertyAccess,
  buildPhotoPaths,
  listPhotoRows,
  getPhotoRow,
  insertPhotoRow,
  patchPhotoRows,
  removeObjects,
  uploadObject,
  createSignedUrl,
  makeId,
  getActivePhotoCount,
  parsePropertyId,
  looksLikeUuid,
  send,
};
