const { applyCors } = require('../_lib/cors');
const {
  requirePropertyAccess,
  buildPhotoPaths,
  makeId,
  getActivePhotoCount,
  MAX_PHOTOS_PER_PROPERTY,
  getJsonBody,
  send,
} = require('../_lib/property-photos');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  const body = getJsonBody(req);
  const propertyId = body?.propertyId;
  const count = Math.max(1, Math.min(10, Number(body?.count || 1)));
  const access = await requirePropertyAccess(req, res, propertyId);
  if (!access) return;
  try {
    const existingCount = await getActivePhotoCount(access.propertyId);
    if (existingCount + count > MAX_PHOTOS_PER_PROPERTY) {
      return send(res, 400, { ok: false, message: `사진은 매물당 최대 ${MAX_PHOTOS_PER_PROPERTY}장까지 등록할 수 있습니다.` });
    }
    const uploads = [];
    for (let i = 0; i < count; i += 1) {
      const photoId = makeId();
      uploads.push(buildPhotoPaths(access.propertyId, photoId));
    }
    return send(res, 200, { ok: true, uploads, maxPhotos: MAX_PHOTOS_PER_PROPERTY, existingCount });
  } catch (err) {
    return send(res, err?.status || 500, { ok: false, message: err?.message || '사진 업로드 준비에 실패했습니다.' });
  }
};
