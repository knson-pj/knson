/**
 * api/admin/valuation/rental-data.js
 * Phase 1 — 상가 임대 호가 데이터 관리 (CSV 업로드 방식)
 *
 * POST /api/admin/valuation/rental-data
 * Body: { action: "upload-csv", csvRows: [ { dong, address, floor, area, deposit, monthlyRent, ... }, ... ] }
 *   → CSV에서 파싱된 임대 호가 데이터를 DB에 적재
 *
 * POST /api/admin/valuation/rental-data
 * Body: { action: "add-single", dong, address, floor, area, deposit, monthlyRent, ... }
 *   → 수동 단건 입력
 *
 * GET /api/admin/valuation/rental-data?sigunguCode=11680&dong=역삼동
 *   → DB에서 임대 호가 조회
 */

const { applyCors } = require('../../_lib/cors');
const { send, getJsonBody } = require('../../_lib/utils');
const { hasSupabaseAdminEnv, getEnv } = require('../../_lib/supabase-admin');

function buildHeaders({ hasJson = false } = {}) {
  const { serviceRoleKey } = getEnv();
  return {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...(hasJson ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function sbRest(path, opts = {}) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method: opts.method || 'GET',
    headers: { ...buildHeaders({ hasJson: opts.json !== undefined }), ...(opts.headers || {}) },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data?.message || data?.error) || `Supabase ${res.status}`);
  return data;
}

// ── CSV 행 → DB 행 변환 ──

function parseNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,\s원만억]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row, sigunguCode) {
  // CSV 컬럼명 유연 매핑 — 네이버 부동산 임대 CSV + 수동 입력 모두 지원
  const pick = (...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  const articleNo = pick('매물ID', 'article_no', 'articleNo', '매물번호', '매물No') || null;
  const address = pick('주소(통합)', '도로명주소', '지번주소', '주소', 'address', '소재지');
  const dong = pick('dong', '동', 'dong_name', '법정동', '동이름');
  const buildingName = pick('building_name', '건물명', '상가명', '빌딩명');
  const assetType = pick('세부유형', '부동산유형명', '부동산유형', 'asset_type');
  const floor = pick('해당층', '층', 'floor');
  const totalFloor = pick('총층', '전체층', 'total_floor');
  const areaM2 = parseNumber(pick('전용면적(㎡)', '면적(㎡)', '전용면적', 'area_m2', 'area', '면적'));
  const areaPyeong = parseNumber(pick('전용면적(평)', '전용면적평', 'area_pyeong'));
  const commonAreaM2 = parseNumber(pick('공급/계약면적(㎡)', '공급면적(㎡)', '공용면적(㎡)', 'common_area_m2'));
  const commonAreaPy = parseNumber(pick('공급/계약면적(평)', '공급면적(평)', '공용면적(평)', 'common_area_py'));
  const deposit = parseNumber(pick('가격(표시)', '보증금', 'deposit', '보증금(만원)'));
  const monthlyRent = parseNumber(pick('월세', '월세(만원)', '월임대료', 'monthly_rent', 'monthlyRent'));
  const pricePerPy = parseNumber(pick('전용평단가(표시)', 'price_per_py'));
  const pricePerPyRent = parseNumber(pick('전용평단가(월세)', 'price_per_py_rent'));
  const description = pick('매물특징', '매물설명', '설명', '특징', 'description');
  const confirmDate = pick('매물확인일', '확인일자', '날짜', 'confirm_date');
  const useApproval = pick('사용승인일', 'use_approval');
  const brokerName = pick('중개사무소명', '중개업소명', '부동산', 'broker_name');
  const brokerPhone = pick('중개사 유선전화', '유선전화', '대표전화', 'broker_phone');
  const brokerCell = pick('중개사 휴대폰', '휴대폰번호', '휴대폰', 'broker_cell');
  const latitude = parseNumber(pick('위도', 'latitude', 'lat'));
  const longitude = parseNumber(pick('경도', 'longitude', 'lng'));

  // 바로가기(엑셀) 에서 URL 추출
  let sourceUrl = pick('source_url', 'sourceUrl', '매물URL', 'url');
  if (!sourceUrl) {
    const rawLink = pick('바로가기(엑셀)');
    if (rawLink) {
      const urlMatch = rawLink.match(/https?:\/\/[^\s"')]+/);
      if (urlMatch) sourceUrl = urlMatch[0];
      else if (articleNo) sourceUrl = 'https://fin.land.naver.com/articles/' + articleNo;
    }
  }

  // 주소에서 동 이름 추출 (dong이 비어있을 때)
  let dongName = dong;
  if (!dongName && address) {
    const m = address.match(/([가-힣0-9]+동)\b/);
    if (m) dongName = m[1];
  }

  return {
    article_no: articleNo,
    sigungu_code: sigunguCode || '',
    dong_name: dongName,
    address: address || (dongName + ' ' + buildingName).trim(),
    building_name: buildingName || null,
    asset_type: assetType || null,
    floor: floor || null,
    total_floor: totalFloor || null,
    area_m2: areaM2,
    area_pyeong: areaPyeong,
    common_area_m2: commonAreaM2,
    common_area_py: commonAreaPy,
    deposit: deposit,
    monthly_rent: monthlyRent,
    price_per_py: pricePerPy,
    price_per_py_rent: pricePerPyRent,
    trade_type: 'B2',
    direction: pick('방향', 'direction') || null,
    description: description || null,
    confirm_date: confirmDate || null,
    use_approval: useApproval || null,
    source_url: sourceUrl || null,
    broker_name: brokerName || null,
    broker_phone: brokerPhone || null,
    broker_cell: brokerCell || null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    expired: false,
  };
}

// ── DB 적재 ──

async function insertRentals(rows) {
  if (!rows.length) return { inserted: 0, errors: 0, firstError: null };

  let inserted = 0, errors = 0;
  let firstError = null;
  const batchSize = 20;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      const result = await sbRest('/rest/v1/rental_listings', {
        method: 'POST',
        json: batch,
        headers: { Prefer: 'return=representation' },
      });
      inserted += Array.isArray(result) ? result.length : batch.length;
    } catch (batchErr) {
      console.error('rental batch insert error:', batchErr?.message || batchErr);
      // 배치 실패 시 개별 INSERT
      for (const row of batch) {
        try {
          await sbRest('/rest/v1/rental_listings', {
            method: 'POST', json: row, headers: { Prefer: 'return=minimal' },
          });
          inserted++;
        } catch (rowErr) {
          errors++;
          if (!firstError) firstError = String(rowErr?.message || rowErr || '').slice(0, 200);
          console.error('rental row insert error:', rowErr?.message || rowErr);
        }
      }
    }
  }
  return { inserted, errors, firstError };
}

// ── DB 조회 ──

async function queryRentals({ sigunguCode, dong }) {
  const parts = [
    `sigungu_code=eq.${encodeURIComponent(sigunguCode)}`,
    'expired=eq.false',
    'order=fetched_at.desc',
    'limit=300',
  ];
  if (dong) parts.push(`dong_name=ilike.*${encodeURIComponent(dong)}*`);
  const data = await sbRest(`/rest/v1/rental_listings?${parts.join('&')}`);
  return Array.isArray(data) ? data : [];
}

// ── Handler ──

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!hasSupabaseAdminEnv()) return send(res, 500, { error: 'Supabase 미설정' });

  try {
    if (req.method === 'GET') {
      const { sigunguCode, dong } = req.query || {};
      if (!sigunguCode) return send(res, 400, { error: 'sigunguCode 필수' });
      const rows = await queryRentals({ sigunguCode, dong });
      return send(res, 200, { ok: true, count: rows.length, items: rows });
    }

    if (req.method === 'POST') {
      const body = getJsonBody(req);
      const action = body.action || 'upload-csv';

      if (action === 'upload-csv') {
        // CSV 일괄 업로드
        const csvRows = body.csvRows;
        const sigunguCode = body.sigunguCode || '';
        if (!Array.isArray(csvRows) || !csvRows.length) {
          return send(res, 400, { error: 'csvRows 배열이 필요합니다.' });
        }

        const normalized = csvRows
          .map((r) => normalizeRow(r, sigunguCode))
          .filter((r) => r.monthly_rent != null && r.monthly_rent > 0);

        const result = await insertRentals(normalized);
        return send(res, 200, {
          ok: true,
          total: csvRows.length,
          valid: normalized.length,
          ...result,
        });
      }

      if (action === 'add-single') {
        // 수동 단건 입력
        const row = normalizeRow(body, body.sigunguCode || '');
        if (!row.monthly_rent) return send(res, 400, { error: '월세 정보가 필요합니다.' });

        const result = await insertRentals([row]);
        return send(res, 200, { ok: true, ...result });
      }

      return send(res, 400, { error: '알 수 없는 action: ' + action });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('rental-data error:', err);
    return send(res, 500, { error: err.message || '서버 오류' });
  }
};
