const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const {
  send,
  getJsonBody,
  parseCsv,
  normalizeAddress,
  normalizePhone,
  extractGuDong,
  normalizeStatus,
  id,
  nowIso,
} = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');

function mapRow(row, fallbackSource) {
  const source = String(row.source || fallbackSource || '').trim().toLowerCase();
  const address = String(row.address || '').trim();
  const price = Number(String(row.price || '0').replace(/[^\d.-]/g, '')) || 0;
  const geo = extractGuDong(address);
  return {
    source: ['auction', 'public'].includes(source) ? source : 'auction',
    address,
    normalizedAddress: normalizeAddress(address),
    price,
    region: String(row.region || '').trim(),
    district: String(row.district || geo.gu || '').trim(),
    dong: String(row.dong || geo.dong || '').trim(),
    ownerName: String(row.ownerName || '').trim(),
    phone: normalizePhone(row.phone || ''),
    assigneeName: String(row.assigneeName || '').trim(),
    status: normalizeStatus(row.status),
    note: String(row.note || '').trim(),
  };
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      sampleCsvSchema: store.meta.sampleCsvSchemas.properties,
      exampleCsv: 'source,address,price,region,district,ownerName,phone,assigneeName,status,note\\nauction,서울특별시 강동구 천호동 12-3,850000000,서울특별시,강동구,,,담당자1,active,1차 업로드 샘플',
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = getJsonBody(req);
  const csvText = String(body.csvText || '').trim();
  const fallbackSource = String(body.source || '').trim().toLowerCase();
  if (!csvText) return send(res, 400, { ok: false, message: 'csvText가 필요합니다.' });

  const rows = parseCsv(csvText);
  let inserted = 0;
  let duplicates = 0;
  const duplicateAddresses = [];

  for (const row of rows) {
    const m = mapRow(row, fallbackSource);
    if (!m.address) continue;
    const dup = store.properties.some(p => p.normalizedAddress === m.normalizedAddress);
    if (dup) {
      duplicates += 1;
      duplicateAddresses.push(m.address);
      continue;
    }

    let assigneeId = null;
    if (m.assigneeName) {
      const user = store.staff.find(u => u.name === m.assigneeName);
      if (user) assigneeId = user.id;
    }

    store.properties.unshift({
      id: id('prop'),
      ...m,
      assigneeId,
      createdByType: 'admin_csv',
      createdByName: session.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    inserted += 1;
  }

  return send(res, 200, {
    ok: true,
    inserted,
    duplicates,
    duplicateAddresses,
    totalProperties: store.properties.length,
  });
};
