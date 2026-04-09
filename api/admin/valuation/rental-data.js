/**
 * api/admin/valuation/rental-data.js
 * Phase 1 — 네이버 부동산 상가 월세 호가 수집
 *
 * POST /api/admin/valuation/rental-data
 * Body: { cortarNo: "1168010600", pages: 5 }
 *   → 네이버 부동산 내부 API에서 상가+월세 데이터를 수집하여 DB 적재
 *
 * GET /api/admin/valuation/rental-data?sigunguCode=11680&dong=역삼동
 *   → DB에서 임대 호가 조회
 *
 * 네이버 부동산 내부 API 파라미터:
 *   rletTypeCd=D02 (상가), tradeTypeCd=B2 (월세)
 *   cortarNo: 법정동코드 10자리
 */

const { applyCors } = require('../../_lib/cors');
const { send, getJsonBody } = require('../../_lib/utils');
const { hasSupabaseAdminEnv, getEnv } = require('../../_lib/supabase-admin');

function buildSupabaseHeaders({ hasJson = false } = {}) {
  const { serviceRoleKey } = getEnv();
  const headers = {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function supabaseRest(path, { method = 'GET', json, headers: extra = {} } = {}) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { ...buildSupabaseHeaders({ hasJson: json !== undefined }), ...extra },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data?.message || data?.error) || `Supabase ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── 네이버 부동산 내부 API ──

const NAVER_LAND_API = 'https://new.land.naver.com/api/articles';

async function fetchNaverRentals(cortarNo, maxPages = 5) {
  const allArticles = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      cortarNo,
      rletTypeCd: 'D02',       // 상가
      tradeTypeCd: 'B2',       // 월세
      order: 'dateDesc',
      page: String(page),
    });

    try {
      const res = await fetch(`${NAVER_LAND_API}?${params.toString()}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://new.land.naver.com/',
        },
      });

      if (!res.ok) {
        console.warn(`Naver API page ${page} failed: ${res.status}`);
        break;
      }

      const data = await res.json();
      const articles = data?.articleList || [];
      if (!articles.length) break;

      for (const a of articles) {
        allArticles.push({
          article_no: String(a.atclNo || ''),
          sigungu_code: cortarNo.substring(0, 5),
          dong_name: a.atclNm || '',
          address: [a.rletTpNm, a.atclNm, a.bildNm].filter(Boolean).join(' '),
          building_name: a.bildNm || '',
          floor: parseInt(a.flrInfo || '0', 10) || null,
          area_m2: parseFloat(a.spc2 || a.spc1 || '0') || null,
          deposit: parseInt(String(a.hanPrc || '').split('/')[0]?.replace(/[^0-9]/g, '') || '0', 10) || null,
          monthly_rent: parseInt(String(a.hanPrc || '').split('/')[1]?.replace(/[^0-9]/g, '') || '0', 10) || null,
          trade_type: 'B2',
          direction: a.direction || '',
          description: a.atclFetrDesc || '',
          confirm_date: a.cfmYmd || '',
        });
      }

      // 너무 빨리 요청하지 않도록 지연
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn(`Naver fetch page ${page} error:`, err.message);
      break;
    }
  }

  return allArticles;
}

// ── DB 적재 ──

async function upsertRentals(items) {
  if (!items.length) return { inserted: 0 };

  const batchSize = 20;
  let inserted = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      const result = await supabaseRest('/rest/v1/rental_listings', {
        method: 'POST',
        json: batch,
        headers: { Prefer: 'return=representation' },
      });
      inserted += Array.isArray(result) ? result.length : batch.length;
    } catch (err) {
      for (const row of batch) {
        try {
          await supabaseRest('/rest/v1/rental_listings', {
            method: 'POST',
            json: row,
            headers: { Prefer: 'return=minimal' },
          });
          inserted += 1;
        } catch (innerErr) {
          // 중복 무시
        }
      }
    }
  }
  return { inserted };
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

  const qs = parts.join('&');
  const data = await supabaseRest(`/rest/v1/rental_listings?${qs}`);
  return Array.isArray(data) ? data : [];
}

// ── Handler ──

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!hasSupabaseAdminEnv()) return send(res, 500, { error: 'Supabase 미설정' });

  try {
    if (req.method === 'POST') {
      const body = getJsonBody(req);
      const { cortarNo, pages } = body;
      if (!cortarNo) return send(res, 400, { error: 'cortarNo (법정동코드 10자리) 필수' });

      const items = await fetchNaverRentals(cortarNo, parseInt(pages || '5', 10));
      const result = await upsertRentals(items);
      return send(res, 200, { ok: true, fetched: items.length, ...result });
    }

    if (req.method === 'GET') {
      const { sigunguCode, dong } = req.query || {};
      if (!sigunguCode) return send(res, 400, { error: 'sigunguCode 필수' });

      const rows = await queryRentals({ sigunguCode, dong });
      return send(res, 200, { ok: true, count: rows.length, items: rows });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('rental-data error:', err);
    return send(res, 500, { error: err.message || '서버 오류' });
  }
};
