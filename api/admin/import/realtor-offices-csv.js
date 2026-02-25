const { applyCors } = require('../../_lib/cors');
const { getStore } = require('../../_lib/store');
const {
  send,
  getJsonBody,
  parseCsv,
  normalizeAddress,
  normalizePhone,
  extractGuDong,
  id,
  nowIso,
} = require('../../_lib/utils');
const { requireAdmin } = require('../../_lib/auth');

function cleanHeader(v) {
  return String(v || '').replace(/^\uFEFF/, '').trim();
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== '') return row[name];
    const k = Object.keys(row).find((key) => cleanHeader(key) === name);
    if (k && row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  return '';
}

function parseRegionDistrict(addressLike, explicitRegion, explicitDistrict) {
  const text = String(addressLike || '').replace(/\s+/g, ' ').trim();
  let region = String(explicitRegion || '').trim();
  let district = String(explicitDistrict || '').trim();

  if (!region && text) {
    const tokens = text.split(' ');
    region = tokens[0] || '';
  }
  if (!district && text) {
    const gd = extractGuDong(text);
    district = gd.gu || '';
  }

  return { region, district };
}

function normalizeKoreanRealtorCsvRow(raw) {
  const officeName = String(pick(raw, ['officeName', '사업자상호', '사무소명']))
    .trim();
  const legalName = String(pick(raw, ['법정동명', '소재지', '주소', 'address']))
    .trim();
  const regionInput = String(pick(raw, ['region', '시도', '지역']))
    .trim();
  const districtInput = String(pick(raw, ['district', '시군구', '구군']))
    .trim();
  const managerName = String(
    pick(raw, ['managerName', '대표자명', '중개업자명'])
  ).trim();
  const officePhone = normalizePhone(pick(raw, ['officePhone', '전화번호', '대표전화']));
  const mobilePhone = normalizePhone(pick(raw, ['mobilePhone', '핸드폰번호', '휴대폰번호']));
  const noteInput = String(pick(raw, ['note', '비고', 'memo']))
    .trim();

  const regNo = String(pick(raw, ['등록번호'])).trim();
  const brokerType = String(pick(raw, ['중개업자종별명'])).trim();
  const positionName = String(pick(raw, ['직위구분명'])).trim();
  const baseDate = String(pick(raw, ['데이터기준일자'])).trim();
  const legalCode = String(pick(raw, ['법정동코드'])).trim();

  const address = legalName || String(pick(raw, ['address'])).trim();
  const { region, district } = parseRegionDistrict(address, regionInput, districtInput);

  const noteParts = [];
  if (regNo) noteParts.push(`등록번호:${regNo}`);
  if (brokerType) noteParts.push(`종별:${brokerType}`);
  if (positionName) noteParts.push(`직위:${positionName}`);
  if (baseDate) noteParts.push(`기준일:${baseDate}`);
  if (legalCode) noteParts.push(`법정동코드:${legalCode}`);
  if (noteInput) noteParts.push(noteInput);

  return {
    officeName,
    address,
    region,
    district,
    managerName,
    officePhone,
    mobilePhone,
    note: noteParts.join(' | '),
    officeRegNo: regNo,
    _raw: raw,
  };
}

function groupRowsForOfficeImport(rows) {
  // 공공데이터 '전국 중개사무소 정보'는 사람 단위 행이 많아서 등록번호 기준으로 사무소 단위로 묶어준다.
  const buckets = new Map();

  for (const raw of rows) {
    const normalized = normalizeKoreanRealtorCsvRow(raw);
    if (!normalized.officeName || !normalized.address) continue;

    const groupKey = normalized.officeRegNo
      ? `reg:${normalized.officeRegNo}`
      : `oa:${normalized.officeName}|${normalizeAddress(normalized.address)}`;

    if (!buckets.has(groupKey)) buckets.set(groupKey, []);
    buckets.get(groupKey).push(normalized);
  }

  const merged = [];
  for (const [groupKey, items] of buckets.entries()) {
    const rep =
      items.find((v) => /대표/.test(String(v._raw?.직위구분명 || ''))) ||
      items.find((v) => /공인중개사/.test(String(v._raw?.중개업자종별명 || ''))) ||
      items[0];

    // 여러 행의 휴대폰/관리자명을 보완적으로 채움
    const managerName =
      rep.managerName || items.find((v) => v.managerName)?.managerName || '';
    const mobilePhone =
      rep.mobilePhone || items.find((v) => v.mobilePhone)?.mobilePhone || '';
    const officePhone =
      rep.officePhone || items.find((v) => v.officePhone)?.officePhone || '';

    // 인원수/대표여부 통계 메모 추가
    const representativeCount = items.filter((v) => /대표/.test(String(v._raw?.직위구분명 || ''))).length;
    const staffCount = items.length;
    const baseNote = rep.note || '';
    const extraNote = `행수:${staffCount}${representativeCount ? `,대표행:${representativeCount}` : ''}`;

    merged.push({
      groupKey,
      officeName: rep.officeName,
      address: rep.address,
      region: rep.region,
      district: rep.district,
      managerName,
      officePhone,
      mobilePhone,
      note: baseNote ? `${baseNote} | ${extraNote}` : extraNote,
      officeRegNo: rep.officeRegNo || '',
    });
  }

  return merged;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      sampleCsvSchema: [
        ...store.meta.sampleCsvSchemas.realtorOffices,
        '(또는 공공데이터 컬럼) 법정동명,등록번호,사업자상호,중개업자명,직위구분명,핸드폰번호 ...',
      ],
      exampleCsv:
        '법정동명,등록번호,사업자상호,중개업자명,직위구분명,핸드폰번호\n서울특별시 강서구,11500-2026-00001,좋은공인중개사사무소,홍길동,대표,010-1111-2222',
      note:
        '전국 중개사무소 정보(공공데이터) 형식 업로드를 지원합니다. 등록번호 기준으로 사무소 단위로 자동 그룹핑합니다.',
    });
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method Not Allowed' });

  const body = getJsonBody(req);
  const csvText = String(body.csvText || '').trim();
  if (!csvText) return send(res, 400, { ok: false, message: 'csvText가 필요합니다.' });

  // 참고: 대용량 CSV(수십 MB)는 Vercel Serverless body limit에 걸릴 수 있음.
  // 현재 1단계에서는 포맷 호환 중심으로 처리하고, 대용량은 분할 업로드/청크 업로드가 필요하다.
  const rows = parseCsv(csvText);

  const officeRows = groupRowsForOfficeImport(rows);

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;

  const existingRegNoSet = new Set(
    store.realtorOffices
      .map((v) => String(v.officeRegNo || '').trim())
      .filter(Boolean)
  );
  const seenKeysInThisUpload = new Set();

  for (const row of officeRows) {
    const officeName = String(row.officeName || '').trim();
    const address = String(row.address || '').trim();
    if (!officeName || !address) {
      skipped += 1;
      continue;
    }

    const normalizedAddress = normalizeAddress(address);
    const uploadKey = row.officeRegNo
      ? `reg:${row.officeRegNo}`
      : `oa:${officeName}|${normalizedAddress}`;

    if (seenKeysInThisUpload.has(uploadKey)) {
      duplicates += 1;
      continue;
    }
    seenKeysInThisUpload.add(uploadKey);

    const dup =
      (row.officeRegNo && existingRegNoSet.has(row.officeRegNo)) ||
      store.realtorOffices.some(
        (v) => v.officeName === officeName && v.normalizedAddress === normalizedAddress
      );

    if (dup) {
      duplicates += 1;
      continue;
    }

    const now = nowIso();
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
      officeRegNo: String(row.officeRegNo || '').trim(),
      importedBy: session.name,
      createdAt: now,
      updatedAt: now,
    });

    if (row.officeRegNo) existingRegNoSet.add(row.officeRegNo);
    inserted += 1;
  }

  return send(res, 200, {
    ok: true,
    parsedRows: rows.length,
    groupedOffices: officeRows.length,
    inserted,
    duplicates,
    skipped,
    totalOffices: store.realtorOffices.length,
    message:
      '공공데이터 형식 CSV를 등록번호 기준으로 그룹핑하여 업로드했습니다. (대용량 파일은 분할 업로드 권장)',
  });
};
