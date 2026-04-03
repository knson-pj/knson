const { applyCors } = require('../_lib/cors');
const {
  requirePropertyAccess,
  listPhotoRows,
  patchPhotoRows,
  getJsonBody,
  send,
} = require('../_lib/property-photos');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  const body = getJsonBody(req);
  const propertyId = body?.propertyId;
  const orderedPhotoIds = Array.isArray(body?.orderedPhotoIds) ? body.orderedPhotoIds.map((v) => String(v || '').trim()).filter(Boolean) : [];
  const access = await requirePropertyAccess(req, res, propertyId);
  if (!access) return;
  try {
    const rows = await listPhotoRows(access.propertyId);
    const rowIds = new Set(rows.map((row) => String(row.id || '').trim()));
    const finalOrder = orderedPhotoIds.filter((id) => rowIds.has(id));
    rows.forEach((row) => {
      const id = String(row.id || '').trim();
      if (!finalOrder.includes(id)) finalOrder.push(id);
    });
    await Promise.all(finalOrder.map((photoId, index) => patchPhotoRows(`id=eq.${encodeURIComponent(photoId)}&property_id=eq.${encodeURIComponent(access.propertyId)}`, { sort_order: index })));
    return send(res, 200, { ok: true, orderedPhotoIds: finalOrder });
  } catch (err) {
    return send(res, err?.status || 500, { ok: false, message: err?.message || '사진 순서 저장에 실패했습니다.' });
  }
};
