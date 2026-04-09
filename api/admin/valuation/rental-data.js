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
  // CSV 컬럼명 유연 매핑
  const dong = String(row.dong || row['동'] || row.dong_name || row['법정동'] || row['동이름'] || '').trim();
  const address = String(row.address || row['주소'] || row['소재지'] || row['도로명주소'] || '').trim();
  const buildingName = String(row.building_name || row['건물명'] || row['상가명'] || row['빌딩명'] || '').trim();
  const floor = parseNumber(row.floor || row['층'] || row['해당층']);
  const area = parseNumber(row.area || row.area_m2 || row['면적'] || row['전용면적'] || row['면적(㎡)'] || row['전용면적(㎡)']);
  const deposit = parseNumber(row.deposit || row['보증금'] || row['보증금(만원)']);
  const monthlyRent = parseNumber(row.monthly_rent || row.monthlyRent || row['월세'] || row['월세(만원)'] || row['월임대료']);
  const direction = String(row.direction || row['방향'] || '').trim();
  const description = String(row.description || row['설명'] || row['매물설명'] || row['특징'] || '').trim();
  const articleNo = String(row.article_no || row.articleNo || row['매물번호'] || row['매물No'] || '').trim() || null;

  return {
    article_no: articleNo,
    sigungu_code: sigunguCode || '',
    dong_name: dong,
    address: address || (dong + ' ' + buildingName).trim(),
    building_name: buildingName,
    floor: floor,
    area_m2: area,
    deposit: deposit,
    monthly_rent: monthlyRent,
    trade_type: 'B2',
    direction: direction,
    description: description,
    confirm_date: String(row.confirm_date || row['확인일자'] || row['날짜'] || '').trim() || null,
    expired: false,
  };
}

// ── DB 적재 ──

async function insertRentals(rows) {
  if (!rows.length) return { inserted: 0, errors: 0 };

  let inserted = 0, errors = 0;
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
    } catch {
      // 배치 실패 시 개별 INSERT
      for (const row of batch) {
        try {
          await sbRest('/rest/v1/rental_listings', {
            method: 'POST', json: row, headers: { Prefer: 'return=minimal' },
          });
          inserted++;
        } catch { errors++; }
      }
    }
  }
  return { inserted, errors };
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
