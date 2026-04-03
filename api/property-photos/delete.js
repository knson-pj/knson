const { applyCors } = require('../_lib/cors');
const {
  requirePropertyAccess,
  getPhotoRow,
  listPhotoRows,
  patchPhotoRows,
  removeObjects,
  getJsonBody,
  send,
} = require('../_lib/property-photos');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  const body = getJsonBody(req);
  const propertyId = body?.propertyId;
  const photoId = String(body?.photoId || '').trim();
  const access = await requirePropertyAccess(req, res, propertyId);
  if (!access) return;
  if (!photoId) return send(res, 400, { ok: false, message: 'photoId가 필요합니다.' });
  try {
    const photo = await getPhotoRow(photoId);
    if (!photo || Number(photo.property_id) !== Number(access.propertyId) || photo.deleted_at) {
      return send(res, 404, { ok: false, message: '사진을 찾을 수 없습니다.' });
    }
    await patchPhotoRows(`id=eq.${encodeURIComponent(photoId)}&property_id=eq.${encodeURIComponent(access.propertyId)}`, { deleted_at: new Date().toISOString(), is_primary: false });
    await removeObjects([photo.storage_path, photo.thumb_path]).catch(() => null);
    if (photo.is_primary) {
      const remaining = await listPhotoRows(access.propertyId);
      const next = remaining.find((row) => String(row.id || '') !== photoId);
      if (next) await patchPhotoRows(`id=eq.${encodeURIComponent(next.id)}&property_id=eq.${encodeURIComponent(access.propertyId)}`, { is_primary: true });
    }
    return send(res, 200, { ok: true, removedId: photoId });
  } catch (err) {
    return send(res, err?.status || 500, { ok: false, message: err?.message || '사진 삭제에 실패했습니다.' });
  }
};
