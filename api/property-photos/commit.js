const { applyCors } = require('../_lib/cors');
const {
  requirePropertyAccess,
  listPhotoRows,
  uploadObject,
  insertPhotoRow,
  getJsonBody,
  send,
} = require('../_lib/property-photos');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  const body = getJsonBody(req);
  const propertyId = body?.propertyId;
  const photos = Array.isArray(body?.photos) ? body.photos : [];
  const access = await requirePropertyAccess(req, res, propertyId);
  if (!access) return;
  if (!photos.length) return send(res, 400, { ok: false, message: '저장할 사진이 없습니다.' });
  try {
    const existing = await listPhotoRows(access.propertyId);
    let nextSort = existing.reduce((max, row) => Math.max(max, Number(row?.sort_order || 0)), -1) + 1;
    const hasPrimary = existing.some((row) => !!row.is_primary);
    const items = [];
    for (let i = 0; i < photos.length; i += 1) {
      const entry = photos[i] || {};
      if (!entry.photoId || !entry.storagePath || !entry.thumbPath || !entry.originalDataUrl || !entry.thumbDataUrl) {
        throw new Error('사진 업로드 데이터가 올바르지 않습니다.');
      }
      const originalMeta = await uploadObject(entry.storagePath, entry.originalDataUrl, entry.mimeType || 'image/webp');
      await uploadObject(entry.thumbPath, entry.thumbDataUrl, 'image/webp');
      const inserted = await insertPhotoRow({
        id: entry.photoId,
        property_id: access.propertyId,
        property_global_id: access.property?.global_id || null,
        storage_path: entry.storagePath,
        thumb_path: entry.thumbPath,
        mime_type: entry.mimeType || originalMeta.mimeType || 'image/webp',
        width: Number(entry.width || 0) || null,
        height: Number(entry.height || 0) || null,
        size_bytes: Number(entry.sizeBytes || originalMeta.sizeBytes || 0) || null,
        sort_order: nextSort,
        is_primary: !hasPrimary && i === 0,
        uploaded_by: access.ctx?.userId || null,
      });
      items.push(inserted);
      nextSort += 1;
    }
    return send(res, 200, { ok: true, items });
  } catch (err) {
    return send(res, err?.status || 500, { ok: false, message: err?.message || '사진 저장에 실패했습니다.' });
  }
};
