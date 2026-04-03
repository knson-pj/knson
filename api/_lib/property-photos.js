
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

function parsePropertyId(value) {
  const n = Number(String(value || '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

async function getPropertyRow(propertyId) {
  const rows = await supabaseFetch(`/rest/v1/properties?select=id,global_id,assignee_id,raw&id=eq.${encodeURIComponent(propertyId)}&limit=1`);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

function getRowAssigneeId(row) {
  const raw = row && typeof row.raw === 'object' ? row.raw : {};
  return String(row?.assignee_id || raw.assignee_id || raw.assigneeId || raw.assignedAgentId || raw.assigned_agent_id || '').trim();
}

async function requirePropertyAccess(req, res, propertyId) {
  const numericPropertyId = parsePropertyId(propertyId);
  if (!numericPropertyId) {
    send(res, 400, { ok: false, message: 'propertyId가 필요합니다.' });
    return null;
  }
  const ctx = await resolveCurrentUserContext(req).catch(() => null);
  if (!ctx?.userId) {
    send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }
  const property = await getPropertyRow(numericPropertyId).catch((err) => {
    console.error('property photo property lookup failed', err);
    return null;
  });
  if (!property) {
    send(res, 404, { ok: false, message: '매물을 찾을 수 없습니다.' });
    return null;
  }
  if (ctx.role !== 'admin') {
    const assigneeId = getRowAssigneeId(property);
    if (!assigneeId || assigneeId !== String(ctx.userId || '').trim()) {
      send(res, 403, { ok: false, message: '이 매물의 사진을 수정할 권한이 없습니다.' });
      return null;
    }
  }
  return { ctx, propertyId: numericPropertyId, property };
}

function buildPhotoPaths(propertyId, photoId) {
  const cleanId = String(photoId || '').trim();
  return {
    photoId: cleanId,
    storagePath: `properties/${propertyId}/original/${cleanId}.webp`,
    thumbPath: `properties/${propertyId}/thumb/${cleanId}.webp`,
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
  const rows = await supabaseFetch(`/rest/v1/property_photos?select=*&property_id=eq.${encodeURIComponent(propertyId)}&deleted_at=is.null&order=sort_order.asc,created_at.asc`);
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
  const rows = await supabaseFetch(`/rest/v1/property_photos?select=id&property_id=eq.${encodeURIComponent(propertyId)}&deleted_at=is.null`);
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
  send,
};
