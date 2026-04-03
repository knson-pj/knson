const { applyCors } = require('../_lib/cors');
const {
  requirePropertyAccess,
  listPhotoRows,
  createSignedUrl,
  send,
} = require('../_lib/property-photos');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  const url = new URL(req.url, 'http://localhost');
  const propertyId = url.searchParams.get('propertyId');
  const access = await requirePropertyAccess(req, res, propertyId);
  if (!access) return;
  try {
    const rows = await listPhotoRows(access.propertyId);
    const items = await Promise.all(rows.map(async (row) => ({
      id: row.id,
      propertyId: row.property_id,
      propertyGlobalId: row.property_global_id,
      thumbUrl: await createSignedUrl(row.thumb_path).catch(() => ''),
      originalUrl: await createSignedUrl(row.storage_path).catch(() => ''),
      thumbPath: row.thumb_path,
      storagePath: row.storage_path,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      sizeBytes: row.size_bytes,
      sortOrder: row.sort_order,
      isPrimary: !!row.is_primary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })));
    return send(res, 200, { ok: true, items });
  } catch (err) {
    return send(res, err?.status || 500, { ok: false, message: err?.message || '사진 목록을 불러오지 못했습니다.' });
  }
};
