const { applyCors } = require('./_lib/cors');
const { getStore } = require('./_lib/store');
const {
  send,
  getJsonBody,
  normalizeAddress,
  normalizePhone,
  extractGuDong,
  id,
  nowIso,
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const store = getStore();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      message: '일반물건 등록 API',
      requiredFields: ['address', 'price', 'registrantName', 'phone'],
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = getJsonBody(req);
  const address = String(body.address || '').trim();
  const price = Number(body.price || 0);
  const registrantName = String(body.registrantName || body.ownerName || '').trim();
  const phone = normalizePhone(body.phone);

  if (!address || !price || !registrantName || !phone) {
    return send(res, 400, { ok: false, message: '필수값(address, price, registrantName, phone)을 입력하세요.' });
  }

  const normalizedAddress = normalizeAddress(address);
  const exists = store.properties.some(p => p.normalizedAddress === normalizedAddress);
  if (exists) {
    return send(res, 409, { ok: false, message: '동일 주소 물건이 이미 등록되어 있습니다.' });
  }

  const geo = extractGuDong(address);
  const item = {
    id: id('prop'),
    source: 'general',
    address,
    normalizedAddress,
    price,
    region: String(body.region || '').trim(),
    district: String(body.district || geo.gu || '').trim(),
    dong: String(body.dong || geo.dong || '').trim(),
    ownerName: registrantName,
    phone,
    assigneeId: null,
    assigneeName: '',
    status: 'review',
    createdByType: 'public',
    createdByName: registrantName,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    note: String(body.note || '프론트 일반물건 등록').trim(),
  };

  store.properties.unshift(item);

  return send(res, 201, {
    ok: true,
    message: '검토후 연락드리겠습니다.',
    item: {
      id: item.id,
      source: item.source,
      status: item.status,
      address: item.address,
      createdAt: item.createdAt,
    },
  });
};
