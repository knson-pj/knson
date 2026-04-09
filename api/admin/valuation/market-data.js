/**
 * api/admin/valuation/market-data.js
 * Phase 1 — 국토부 상업업무용 부동산 매매 실거래 API 연동
 *
 * POST /api/admin/valuation/market-data
 * Body: { sigunguCode: "11680", dealYm: "202503" }
 *   → 해당 시군구/년월의 상업업무용 매매 실거래 데이터를 조회하여 DB에 적재
 *
 * GET /api/admin/valuation/market-data?sigunguCode=11680&dong=역삼동&months=12
 *   → DB에서 조건에 맞는 거래사례 조회
 *
 * 환경변수: MOLIT_API_KEY (국토부 API 서비스키, Decoding 버전)
 */

const { applyCors } = require('../../_lib/cors');
const { send, getJsonBody } = require('../../_lib/utils');
const { hasSupabaseAdminEnv, getEnv } = require('../../_lib/supabase-admin');

function getMolitApiKey() {
  return String(process.env.MOLIT_API_KEY || '').trim();
}

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
    const err = new Error((data && (data.message || data.error_description || data.error)) || `Supabase ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── 국토부 API 호출 ──

const MOLIT_BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade';

async function fetchMolitData(sigunguCode, dealYm) {
  const apiKey = getMolitApiKey();
  if (!apiKey) throw new Error('MOLIT_API_KEY 환경변수가 설정되지 않았습니다.');

  const allItems = [];
  let pageNo = 1;
  const numOfRows = 100;

  while (true) {
    const params = new URLSearchParams({
      serviceKey: apiKey,
      LAWD_CD: sigunguCode,
      DEAL_YMD: dealYm,
      pageNo: String(pageNo),
      numOfRows: String(numOfRows),
    });

    const res = await fetch(`${MOLIT_BASE}?${params.toString()}`);
    if (!res.ok) throw new Error(`국토부 API 응답 오류: ${res.status}`);

    const xml = await res.text();
    const items = parseXmlItems(xml);

    if (!items.length) break;
    allItems.push(...items);

    // totalCount 확인
    const totalMatch = xml.match(/<totalCount>(\d+)<\/totalCount>/);
    const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    if (pageNo * numOfRows >= totalCount) break;
    pageNo++;
  }

  return allItems;
}

function parseXmlItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

  for (const block of itemBlocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : '';
    };
    items.push({
      sigungu_name: get('시군구') || get('sggNm'),
      dong_name: get('법정동') || get('umdNm'),
      jibun: get('지번') || get('jibun'),
      building_type: get('유형') || get('type'),
      building_use: get('건물주용도') || get('mainPurpsNm'),
      land_use_zone: get('용도지역') || get('landLyrNm'),
      build_year: parseInt(get('건축년도') || get('buildYear') || '0', 10) || null,
      floor: parseInt(get('층') || get('floor') || '0', 10) || null,
      land_area: parseFloat(get('대지면적') || get('plArea') || '0') || null,
      building_area: parseFloat(get('건물면적') || get('totArea') || '0') || null,
      deal_amount: parseInt((get('거래금액') || get('dealAmount') || '0').replace(/,/g, ''), 10) || 0,
      deal_year: parseInt(get('년') || get('dealYear') || '0', 10),
      deal_month: parseInt(get('월') || get('dealMonth') || '0', 10),
      deal_day: parseInt(get('일') || get('dealDay') || '0', 10) || null,
      deal_type: get('거래유형') || get('dealType') || '',
      cancel_yn: get('해제여부') || get('cdealType') || 'N',
      broker_loc: get('중개사소재지') || get('rltrNm') || '',
    });
  }
  return items;
}

// ── DB 적재 ──

async function upsertTransactions(sigunguCode, items) {
  if (!items.length) return { inserted: 0 };

  const rows = items.map((item) => ({
    sigungu_code: sigunguCode,
    ...item,
  }));

  // Supabase upsert (on conflict 무시)
  const batchSize = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      await supabaseRest(
        '/rest/v1/market_transactions',
        {
          method: 'POST',
          json: batch,
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        }
      );
      inserted += batch.length;
    } catch (err) {
      console.error('Batch upsert error:', err.message);
    }
  }
  return { inserted };
}

// ── DB 조회 ──

async function queryTransactions({ sigunguCode, dong, months = 12, buildingUse, floorFilter }) {
  const parts = [`sigungu_code=eq.${encodeURIComponent(sigunguCode)}`];

  if (dong) parts.push(`dong_name=eq.${encodeURIComponent(dong)}`);
  if (buildingUse) parts.push(`building_use=eq.${encodeURIComponent(buildingUse)}`);

  // 최근 N개월
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const cutoffYm = cutoff.getFullYear() * 100 + (cutoff.getMonth() + 1);
  // deal_year*100 + deal_month >= cutoffYm 조건은 Supabase에서 computed column이 없으므로 클라이언트 필터

  parts.push('cancel_yn=neq.Y');
  parts.push('order=deal_year.desc,deal_month.desc');
  parts.push('limit=500');

  const qs = parts.join('&');
  const data = await supabaseRest(`/rest/v1/market_transactions?${qs}`);

  // 클라이언트 사이드 날짜 필터
  return (Array.isArray(data) ? data : []).filter((row) => {
    const ym = (row.deal_year || 0) * 100 + (row.deal_month || 0);
    if (ym < cutoffYm) return false;
    if (floorFilter !== undefined && floorFilter !== null) {
      // 층 필터링은 매칭 엔진에서 가중치로 처리하므로 여기서는 skip
    }
    return true;
  });
}

// ── Handler ──

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!hasSupabaseAdminEnv()) return send(res, 500, { error: 'Supabase 미설정' });

  try {
    if (req.method === 'POST') {
      // 국토부 API에서 데이터 가져와서 DB 적재
      const body = getJsonBody(req);
      const { sigunguCode, dealYm } = body;
      if (!sigunguCode || !dealYm) return send(res, 400, { error: 'sigunguCode, dealYm 필수' });

      const items = await fetchMolitData(sigunguCode, dealYm);
      const result = await upsertTransactions(sigunguCode, items);
      return send(res, 200, {
        ok: true,
        fetched: items.length,
        ...result,
        sigunguCode,
        dealYm,
      });
    }

    if (req.method === 'GET') {
      // DB에서 거래사례 조회
      const { sigunguCode, dong, months, buildingUse } = req.query || {};
      if (!sigunguCode) return send(res, 400, { error: 'sigunguCode 필수' });

      const rows = await queryTransactions({
        sigunguCode,
        dong: dong || null,
        months: parseInt(months || '12', 10),
        buildingUse: buildingUse || null,
      });
      return send(res, 200, { ok: true, count: rows.length, items: rows });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('market-data error:', err);
    return send(res, 500, { error: err.message || '서버 오류' });
  }
};
