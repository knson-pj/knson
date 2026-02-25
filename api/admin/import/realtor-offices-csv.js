const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const { send, getJsonBody, parseCsv, normalizeAddress, normalizePhone, id, nowIso } = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      sampleCsvSchema: store.meta.sampleCsvSchemas.realtorOffices,
      exampleCsv: 'officeName,address,region,district,managerName,officePhone,mobilePhone,note\\n좋은부동산,서울특별시 강서구 화곡동 123-4,서울특별시,강서구,홍길동,02-123-4567,010-1111-2222,샘플',
    });
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method Not Allowed' });

  const body = getJsonBody(req);
  const csvText = String(body.csvText || '').trim();
  if (!csvText) return send(res, 400, { ok: false, message: 'csvText가 필요합니다.' });

  const rows = parseCsv(csvText);
  let inserted = 0;
  let duplicates = 0;

  for (const row of rows) {
    const officeName = String(row.officeName || '').trim();
    const address = String(row.address || '').trim();
    if (!officeName || !address) continue;
    const normalizedAddress = normalizeAddress(address);
    const dup = store.realtorOffices.some(v => v.officeName === officeName && v.normalizedAddress === normalizedAddress);
    if (dup) {
      duplicates += 1;
      continue;
    }

    store.realtorOffices.unshift({
      id: id('office'),
      officeName,
      address,
      normalizedAddress,
      region: String(row.region || '').trim(),
      district: String(row.district || '').trim(),
      managerName: String(row.managerName || '').trim(),
      officePhone: normalizePhone(row.officePhone || ''),
      mobilePhone: normalizePhone(row.mobilePhone || ''),
      note: String(row.note || '').trim(),
      importedBy: session.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    inserted += 1;
  }

  return send(res, 200, {
    ok: true,
    inserted,
    duplicates,
    totalOffices: store.realtorOffices.length,
  });
};
