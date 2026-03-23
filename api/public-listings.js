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


function parseFloorNumberForLog(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  let m = s.match(/^(?:B|b|지하)\s*(\d+)$/);
  if (m) return `b${m[1]}`;
  m = s.match(/(-?\d+)/);
  return m ? String(Number(m[1])) : '';
}

function compactAddressText(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function parseAddressIdentityParts(address) {
  const text = String(address || "").trim().replace(/\s+/g, " ");
  const compact = compactAddressText ? compactAddressText(text) : text.replace(/\s+/g, "");
  if (!compact) return { dong: "", mainNo: "", subNo: "" };

  const suffixSet = new Set(["동", "읍", "면", "리"]);
  let end = -1;
  for (let i = compact.length - 1; i >= 0; i -= 1) {
    if (suffixSet.has(compact[i])) {
    end = i;
    break;
    }
  }
  if (end < 0) return { dong: "", mainNo: "", subNo: "" };

  let start = 0;
  for (let i = end - 1; i >= 0; i -= 1) {
    if (/[시군구읍면리동]/.test(compact[i])) {
    start = i + 1;
    break;
    }
  }

  const dong = compact.slice(start, end + 1);
  if (!/^[가-힣A-Za-z0-9]+(?:동|읍|면|리)$/.test(dong)) {
    return { dong: "", mainNo: "", subNo: "" };
  }

  const tail = compact.slice(end + 1);
  const lot = tail.match(/(산?\d+)(?:-(\d+))?/);
  if (!lot) return { dong, mainNo: "", subNo: "" };
  return { dong, mainNo: lot[1] || "", subNo: lot[2] || "" };
  }

function extractHoNumberForLog(...values) {
  for (const value of values) {
    const s = String(value || '').trim();
    if (!s) continue;
    let m = s.match(/(\d{1,5})\s*호/);
    if (m) return String(Number(m[1]));
    if (!/층|동/.test(s)) {
      m = s.match(/^\D*(\d{1,5})\D*$/);
      if (m) return String(Number(m[1]));
    }
  }
  return '';
}

function buildRegistrationKey(body) {
  const parts = parseAddressIdentityParts(body.address || '');
  const floorKey = parseFloorNumberForLog(body.floor || body.totalFloor || '') || '0';
  const hoKey = extractHoNumberForLog(body.ho || '', body.unit || '', body.room || '', body.address || '') || '0';
  return parts.dong && parts.mainNo ? `${parts.dong}|${parts.mainNo}|${parts.subNo || '0'}|${floorKey}|${hoKey}` : '';
}

function attachRegistrationIdentity(raw, body) {
  const nextRaw = { ...(raw || {}) };
  const parts = parseAddressIdentityParts(body.address || nextRaw.address || '');
  const floorKey = parseFloorNumberForLog(body.floor || body.totalFloor || nextRaw.floor || '') || '';
  const hoKey = extractHoNumberForLog(body.ho || '', body.unit || '', body.room || '', body.address || nextRaw.address || '') || '';
  nextRaw.registrationIdentityKey = parts.dong && parts.mainNo ? `${parts.dong}|${parts.mainNo}|${parts.subNo || '0'}|${floorKey || '0'}|${hoKey || '0'}` : '';
  nextRaw.registrationIdentity = { dong: parts.dong || '', mainNo: parts.mainNo || '', subNo: parts.subNo || '', floor: floorKey || '', ho: hoKey || '' };
  return nextRaw;
}
function buildRegistrationLogCreated(route, actor) {
  return [{ type: 'created', at: nowIso(), route, actor }];
}

function appendRegistrationLog(raw, route, actor, changes) {
  const current = Array.isArray(raw.registrationLog) ? raw.registrationLog.slice() : buildRegistrationLogCreated('공개 등록', actor);
  if (Array.isArray(changes) && changes.length) current.push({ type: 'changed', at: nowIso(), route, actor, changes });
  return current;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const store = getStore();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      message: '일반물건 등록 API',
      requiredFields: ['address', 'priceMain', 'submitterName', 'submitterPhone'],
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = getJsonBody(req);
  const address = String(body.address || '').trim();
  const sourceType = String(body.sourceType || 'general').trim().toLowerCase();
  const submitterType = String(body.submitterType || (sourceType === 'realtor' ? 'realtor' : 'owner')).trim().toLowerCase();
  const price = Number(body.priceMain || body.price || 0);
  const registrantName = String(body.submitterName || body.registrantName || body.ownerName || '').trim();
  const phone = normalizePhone(body.submitterPhone || body.phone);

  if (!address || !price || !registrantName || !phone) {
    return send(res, 400, { ok: false, message: '필수값(address, priceMain, submitterName, submitterPhone)을 입력하세요.' });
  }

  const normalizedAddress = normalizeAddress(address);
  const registrationKey = buildRegistrationKey(body);
  const existing = store.properties.find((p) => {
    const baseKey = p.registrationKey || buildRegistrationKey({ address: p.address, floor: p.floor, totalFloor: p.totalFloor });
    return registrationKey && baseKey && registrationKey === baseKey;
  });

  const geo = extractGuDong(address);
  if (existing) {
    const changes = [];
    const pushChange = (label, beforeValue, afterValue) => {
      const before = String(beforeValue || '').trim();
      const after = String(afterValue || '').trim();
      if (!after || before === after) return;
      changes.push({ label, before: before || '-', after });
    };
    pushChange('주소', existing.address, address);
    pushChange('세부유형', existing.assetType, body.assetType || '');
    pushChange('매매가', existing.price, price);
    pushChange('등록자명', existing.ownerName, registrantName);
    pushChange('등록자 연락처', existing.phone, phone);
    if (address) existing.address = address;
    existing.normalizedAddress = normalizedAddress;
    existing.price = price;
    existing.assetType = String(body.assetType || existing.assetType || '').trim();
    existing.ownerName = registrantName;
    existing.phone = phone;
    existing.submitterType = submitterType;
    existing.updatedAt = nowIso();
    existing.registrationKey = registrationKey;
    existing.raw = existing.raw || {};
    existing.raw = attachRegistrationIdentity(existing.raw, body);
    existing.raw.registrationLog = appendRegistrationLog(existing.raw, '공개 등록', registrantName || '공개 등록', changes);
    return send(res, 200, { ok: true, message: '기존 물건을 갱신했습니다.', item: { id: existing.id, address: existing.address, updatedAt: existing.updatedAt } });
  }

  const item = {
    id: id('prop'),
    source: sourceType === 'realtor' ? 'realtor' : 'general',
    address,
    normalizedAddress,
    price,
    region: String(body.region || '').trim(),
    district: String(body.district || geo.gu || '').trim(),
    dong: String(body.dong || geo.dong || '').trim(),
    ownerName: registrantName,
    phone,
    submitterType,
    assetType: String(body.assetType || '').trim(),
    memo: String(body.memo || '').trim(),
    brokerOfficeName: String(body.brokerOfficeName || '').trim(),
    brokerName: String(body.brokerName || '').trim(),
    brokerLicenseNo: String(body.brokerLicenseNo || '').trim(),
    assigneeId: null,
    assigneeName: '',
    status: 'review',
    createdByType: 'public',
    createdByName: registrantName,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    note: String(body.note || '공개 등록 접수').trim(),
    floor: String(body.floor || '').trim(),
    totalFloor: String(body.totalFloor || '').trim(),
    registrationKey,
    raw: attachRegistrationIdentity({
      ...body,
      firstRegisteredAt: nowIso(),
      registrationLog: buildRegistrationLogCreated('공개 등록', registrantName || '공개 등록'),
    }, body),
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
