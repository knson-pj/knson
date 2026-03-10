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
      message: '공개 매물 등록 API',
      requiredFields: ['submitterType', 'address', 'assetType', 'priceMain', 'submitterName', 'submitterPhone'],
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = getJsonBody(req);
  const submitterType = String(body.submitterType || '').trim() === 'realtor' ? 'realtor' : 'owner';
  const sourceType = submitterType === 'realtor' ? 'realtor' : 'general';

  const address = String(body.address || '').trim();
  const assetType = String(body.assetType || '').trim();
  const priceMain = Number(body.priceMain || 0);
  const submitterName = String(body.submitterName || body.registrantName || '').trim();
  const submitterPhone = normalizePhone(body.submitterPhone || body.phone);
  const brokerOfficeName = String(body.brokerOfficeName || '').trim();
  const brokerName = String(body.brokerName || '').trim();
  const brokerLicenseNo = String(body.brokerLicenseNo || '').trim();

  if (!address || !assetType || !priceMain || !submitterName || !submitterPhone) {
    return send(res, 400, {
      ok: false,
      message: '필수값(submitterType, address, assetType, priceMain, submitterName, submitterPhone)을 입력하세요.',
    });
  }

  if (submitterType === 'realtor' && !brokerOfficeName) {
    return send(res, 400, { ok: false, message: '공인중개사 등록은 중개사무소명이 필요합니다.' });
  }

  const normalizedAddress = normalizeAddress(address);
  const exists = store.properties.some((p) => p.normalizedAddress === normalizedAddress && p.source === sourceType);
  if (exists) {
    return send(res, 409, { ok: false, message: '동일 주소 물건이 이미 등록되어 있습니다.' });
  }

  const geo = extractGuDong(address);
  const prefix = sourceType === 'realtor' ? 'R' : 'G';
  const itemNo = `${prefix}${(store.properties.filter((p) => String(p.source || '').toLowerCase() === sourceType).length + 1)}`;

  const item = {
    id: id('prop'),
    globalId: `${sourceType}:${itemNo}`,
    itemNo,
    source: sourceType,
    sourceType,
    submitterType,
    address,
    normalizedAddress,
    assetType,
    priceMain,
    region: String(body.region || '').trim(),
    district: String(body.district || geo.gu || '').trim(),
    dong: String(body.dong || geo.dong || '').trim(),
    ownerName: submitterName,
    submitterName,
    submitterPhone,
    brokerOfficeName,
    brokerName,
    brokerLicenseNo,
    commonArea: body.commonArea ?? null,
    exclusiveArea: body.exclusiveArea ?? null,
    siteArea: body.siteArea ?? null,
    useApproval: body.useApproval || null,
    sourceUrl: body.sourceUrl || null,
    memo: String(body.memo || '').trim(),
    assigneeId: null,
    assigneeName: '',
    status: 'review',
    createdByType: 'public',
    createdByName: submitterName,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    note: String(body.note || '공개 매물 등록').trim(),
    raw: body,
  };

  store.properties.unshift(item);

  return send(res, 201, {
    ok: true,
    message: '등록이 접수되었습니다.',
    item: {
      id: item.id,
      source: item.source,
      sourceType: item.sourceType,
      itemNo: item.itemNo,
      status: item.status,
      address: item.address,
      createdAt: item.createdAt,
    },
  });
};
