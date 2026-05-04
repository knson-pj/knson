// =============================================================================
// api/_lib/property-videos.js  (2026-05-04)
// =============================================================================
//
// 동영상 업로드/조회/삭제 서버 헬퍼.
//
// 사진 모듈(property-photos.js) 과 동일한 패턴이지만 핵심 차이:
//   - 동영상은 파일이 크다 (최대 100MB) → Vercel 함수 본문 한도(4.5MB) 우회
//   - 그래서 dataURL → base64 디코드 방식이 아니라
//     Supabase Storage 의 "signed upload URL" 을 발급해서 클라이언트가
//     Storage 에 직접 PUT 한다.
//   - 서버는 prepare 단계에서 token 만 만들고, commit 단계에서 메타데이터만
//     DB 에 INSERT.
//
// 권한 모델은 사진과 동일: 관리자 OR 본인 배정 매물 담당자.
// requirePropertyAccess 는 사진 헬퍼와 다를 게 없어 별도 구현.
// =============================================================================

'use strict';

const crypto = require('crypto');
const { getJsonBody, send } = require('./utils');
const { getEnv, resolveCurrentUserContext } = require('./supabase-admin');

const BUCKET = 'property-videos';

// 사양 (결정사항 ② / ⑨)
const MAX_VIDEOS_PER_PROPERTY = 5;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;       // 100 MB
const MAX_DURATION_SEC = 300;                         // 5분
const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const ALLOWED_POSTER_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const SIGNED_URL_EXPIRES = 60 * 60;                   // 조회용 1시간
const UPLOAD_TOKEN_EXPIRES = 60 * 60 * 2;             // 업로드용 2시간 (대용량 대비)


// ─────────────────────────────────────────────────────────────────────────────
// Supabase REST/Storage 호출 래퍼
// ─────────────────────────────────────────────────────────────────────────────

function encodeStoragePath(path) {
  return String(path || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function buildHeaders({ hasJson = false, extra = {} } = {}) {
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


// ─────────────────────────────────────────────────────────────────────────────
// 매물 식별 / 권한
// ─────────────────────────────────────────────────────────────────────────────

function trimRef(value) {
  return String(value || '').trim();
}

function encodeOrValue(value) {
  return String(value || '').replace(/,/g, '%2C').replace(/\)/g, '%29').replace(/\(/g, '%28');
}

async function getPropertyRow(propertyRef) {
  const rawRef = trimRef(propertyRef);
  if (!rawRef) return null;

  const directRows = await supabaseFetch(`/rest/v1/properties?select=id,global_id,assignee_id,item_no,raw&id=eq.${encodeURIComponent(rawRef)}&limit=1`).catch(() => null);
  if (Array.isArray(directRows) && directRows[0]) return directRows[0];

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
    console.error('property video property lookup failed', err);
    return null;
  });
  if (!property) {
    send(res, 404, { ok: false, message: '매물을 찾을 수 없습니다.' });
    return null;
  }
  const resolvedId = getResolvedPropertyId(property, rawPropertyRef);
  if (!resolvedId) {
    send(res, 400, { ok: false, message: '동영상 기능에서 사용할 수 없는 매물 식별자입니다.' });
    return null;
  }
  if (ctx.role !== 'admin') {
    const assigneeId = getRowAssigneeId(property);
    if (!assigneeId || assigneeId !== String(ctx.userId || '').trim()) {
      send(res, 403, { ok: false, message: '이 매물의 동영상을 수정할 권한이 없습니다.' });
      return null;
    }
  }
  return { ctx, propertyId: resolvedId, property, propertyRef: rawPropertyRef };
}


// ─────────────────────────────────────────────────────────────────────────────
// MIME → 파일 확장자
// ─────────────────────────────────────────────────────────────────────────────

function videoExtensionForMime(mimeType) {
  const m = String(mimeType || '').trim().toLowerCase();
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/webm') return 'webm';
  if (m === 'video/quicktime') return 'mov';
  return 'mp4';
}

function posterExtensionForMime(mimeType) {
  const m = String(mimeType || '').trim().toLowerCase();
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  return 'jpg';
}


// ─────────────────────────────────────────────────────────────────────────────
// Storage 경로 생성
// ─────────────────────────────────────────────────────────────────────────────

function buildVideoPaths(propertyId, videoId, { videoMime, posterMime } = {}) {
  const cleanId = trimRef(videoId);
  const safePropertyId = trimRef(propertyId);
  const videoExt = videoExtensionForMime(videoMime);
  const posterExt = posterExtensionForMime(posterMime);
  return {
    videoId: cleanId,
    storagePath: `properties/${safePropertyId}/videos/original/${cleanId}.${videoExt}`,
    posterPath: `properties/${safePropertyId}/videos/poster/${cleanId}.${posterExt}`,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Signed Upload URL 발급 (Supabase Storage v3)
// ─────────────────────────────────────────────────────────────────────────────
//
// Supabase Storage 의 "signed upload URL" 은 클라이언트가 service_role 키 없이도
// 특정 경로에 대해 한 번 PUT 할 수 있는 임시 토큰을 만든다.
// 엔드포인트: POST /storage/v1/object/upload/sign/{bucket}/{path}
//   응답: { url, token } 형태 (Supabase 버전에 따라 signedURL 키도 가능)
// 클라이언트는 받은 token 을 헤더(또는 URL)에 넣어 POST/PUT 한다.
// ─────────────────────────────────────────────────────────────────────────────

async function createSignedUploadUrl(path) {
  const data = await supabaseFetch(`/storage/v1/object/upload/sign/${BUCKET}/${encodeStoragePath(path)}`, {
    method: 'POST',
    json: { expiresIn: UPLOAD_TOKEN_EXPIRES },
  });
  const { url } = getEnv();
  // Supabase 응답 호환: signedUrl / signedURL / url / signed_url 다양
  const signedRaw = String(
    data?.url || data?.signedUrl || data?.signedURL || data?.signed_url || ''
  ).trim();
  const token = String(data?.token || '').trim();
  if (!signedRaw && !token) {
    throw new Error('Signed upload URL 발급 실패');
  }
  // Supabase 가 상대 경로를 줄 수도 있으므로 절대 경로로 보정
  const signed = signedRaw.startsWith('http') ? signedRaw : `${url}/storage/v1${signedRaw}`;
  return { signedUrl: signed, token, path };
}


// ─────────────────────────────────────────────────────────────────────────────
// 조회용 Signed URL (재생 / 포스터)
// ─────────────────────────────────────────────────────────────────────────────

async function createSignedReadUrl(path) {
  if (!trimRef(path)) return '';
  try {
    const data = await supabaseFetch(`/storage/v1/object/sign/${BUCKET}/${encodeStoragePath(path)}`, {
      method: 'POST',
      json: { expiresIn: SIGNED_URL_EXPIRES },
    });
    const { url } = getEnv();
    const signed = String(data?.signedURL || data?.signedUrl || data?.url || '').trim();
    if (!signed) return '';
    return signed.startsWith('http') ? signed : `${url}/storage/v1${signed}`;
  } catch {
    return '';
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Storage 객체 삭제 (soft delete 시 즉시 제거)
// ─────────────────────────────────────────────────────────────────────────────

async function removeObjects(paths) {
  const prefixes = Array.from(new Set((Array.isArray(paths) ? paths : []).filter(Boolean).map((v) => String(v))));
  if (!prefixes.length) return;
  await supabaseFetch(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', json: { prefixes } });
}


// ─────────────────────────────────────────────────────────────────────────────
// DB row CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function listVideoRows(propertyId) {
  const ref = trimRef(propertyId);
  const rows = await supabaseFetch(
    `/rest/v1/property_videos?select=*&property_id=eq.${encodeURIComponent(ref)}&deleted_at=is.null&order=sort_order.asc,created_at.asc`
  );
  return Array.isArray(rows) ? rows : [];
}

async function getVideoRow(videoId) {
  const rows = await supabaseFetch(`/rest/v1/property_videos?select=*&id=eq.${encodeURIComponent(videoId)}&limit=1`);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function insertVideoRow(row) {
  const rows = await supabaseFetch('/rest/v1/property_videos?select=*', {
    method: 'POST',
    json: row,
    headers: { Prefer: 'return=representation' },
  });
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function patchVideoRows(filterQuery, patch) {
  return supabaseFetch(`/rest/v1/property_videos?${filterQuery}`, {
    method: 'PATCH',
    json: patch,
    headers: { Prefer: 'return=representation' },
  });
}

async function getActiveVideoCount(propertyId) {
  const ref = trimRef(propertyId);
  const rows = await supabaseFetch(
    `/rest/v1/property_videos?select=id&property_id=eq.${encodeURIComponent(ref)}&deleted_at=is.null`
  );
  return Array.isArray(rows) ? rows.length : 0;
}


// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────

function makeId() {
  return crypto.randomUUID();
}

function isAllowedVideoMime(mimeType) {
  return ALLOWED_MIME_TYPES.has(String(mimeType || '').trim().toLowerCase());
}

function isAllowedPosterMime(mimeType) {
  if (!mimeType) return true; // 포스터는 옵션
  return ALLOWED_POSTER_MIME_TYPES.has(String(mimeType || '').trim().toLowerCase());
}


module.exports = {
  BUCKET,
  MAX_VIDEOS_PER_PROPERTY,
  MAX_FILE_SIZE_BYTES,
  MAX_DURATION_SEC,
  ALLOWED_MIME_TYPES,
  ALLOWED_POSTER_MIME_TYPES,
  getJsonBody,
  send,
  requirePropertyAccess,
  buildVideoPaths,
  createSignedUploadUrl,
  createSignedReadUrl,
  removeObjects,
  listVideoRows,
  getVideoRow,
  insertVideoRow,
  patchVideoRows,
  getActiveVideoCount,
  makeId,
  isAllowedVideoMime,
  isAllowedPosterMime,
  videoExtensionForMime,
  posterExtensionForMime,
};
