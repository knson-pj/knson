/**
 * api/public/properties.js
 * platform 회원 사이트 — 지도용 매물 데이터 엔드포인트.
 *
 * GET /api/public/properties
 *   ?source=all|auction|onbid|realtor|realtor_naver|realtor_direct|general
 *   &status=active|hold|closed|review
 *   &q=<keyword>
 *   &offset=<int>&limit=<int>
 *   &markerLimit=<int>
 *   &swLat=&swLng=&neLat=&neLng=  (지도 viewport bounds — 옵션)
 *
 * 응답: { ok, summary, total, items[], markers[] }
 *
 * 보안
 *   • Supabase JWT 필수 (Authorization: Bearer <token>)
 *   • DBMS 계정(app_metadata.app === 'dbms') 차단 — 임직원은 /admin/properties 사용
 *   • RLS 우회를 위해 내부에서 service_role 키 사용 → PII 컬럼은 SELECT 단계에서 제외
 *
 * PII 제거 항목 (SELECT 컬럼에서 아예 빠짐)
 *   • broker_office_name, submitter_name, submitter_phone, submitter_type
 *   • assignee_id (담당자 ID)
 *   • memo, rights_analysis, site_inspection (내부 검토 메모)
 *   • raw (외부 원본 데이터 — 일부 PII 가능성)
 */
const { applyCors } = require('../_lib/cors');
const { send } = require('../_lib/utils');
const { verifySupabaseUser, getEnv } = require('../_lib/supabase-admin');

// 회원 사이트에 안전하게 노출 가능한 컬럼만 선택
const PUBLIC_SELECT_COLUMNS = [
  'id', 'global_id', 'item_no',
  'source_type', 'source_url', 'is_general',
  'address', 'asset_type', 'tankauction_category',
  'floor', 'total_floor', 'use_approval',
  'common_area', 'exclusive_area', 'site_area',
  'status', 'price_main', 'lowprice', 'date_main',
  'latitude', 'longitude',
  'created_at', 'date_uploaded',
  // 경공매 결과 — 공개 가능
  'result_status', 'result_price', 'result_date',
];

function buildSupabaseHeaders(hasJson = false) {
  const { serviceRoleKey } = getEnv();
  const headers = {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function supabaseRest(path) {
  const { url } = getEnv();
  if (!url) throw new Error('SUPABASE_URL 이 설정되지 않았습니다.');
  const res = await fetch(`${url}${path}`, {
    method: 'GET',
    headers: buildSupabaseHeaders(),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  if (!res.ok) {
    const message = (data && (data.message || data.msg || data.error_description || data.error))
      || `Supabase API 오류 (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// admin/properties.js 의 getSourceBucket 과 동일한 분류 규칙 (간소화 버전).
// platform 은 raw 데이터를 안 받으므로 fallback 규칙은 단순함.
function classifySourceBucket(row) {
  if (row && row.is_general === true) return 'general';
  const t = String(row && row.source_type || '').toLowerCase();
  if (t === 'auction') return 'auction';
  if (t === 'onbid') return 'onbid';
  if (t === 'realtor_naver') return 'realtor_naver';
  if (t === 'realtor_direct' || t === 'realtor') return 'realtor_direct';
  return 'general';
}

// DB row → platform 응답용 객체 (PII 없음).
function normalizeRow(row) {
  return {
    id: String(row.id || ''),
    globalId: String(row.global_id || ''),
    itemNo: String(row.item_no || ''),
    source: String(row.source_type || 'general'),
    sourceBucket: classifySourceBucket(row),
    sourceUrl: String(row.source_url || ''),
    address: String(row.address || ''),
    type: String(row.asset_type || ''),
    tankauctionCategory: String(row.tankauction_category || ''),
    status: String(row.status || ''),
    floor: String(row.floor || ''),
    totalFloor: String(row.total_floor || ''),
    useapproval: String(row.use_approval || ''),
    exclusivearea: toFiniteNumber(row.exclusive_area),
    commonarea: toFiniteNumber(row.common_area),
    sitearea: toFiniteNumber(row.site_area),
    appraisalPrice: toFiniteNumber(row.price_main),
    currentPrice: toFiniteNumber(row.lowprice),
    bidDate: String(row.date_main || ''),
    resultStatus: String(row.result_status || ''),
    resultPrice: toFiniteNumber(row.result_price),
    resultDate: String(row.result_date || ''),
    latitude: toFiniteNumber(row.latitude),
    longitude: toFiniteNumber(row.longitude),
    createdAt: String(row.created_at || row.date_uploaded || ''),
    // 가치 평가는 Phase F 에서 valuation_results JOIN 또는 별도 endpoint 로 연결 예정
    valuation: null,
  };
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  // ────────────────────────────────────────────────────────────────────
  // 1) 인증 — Supabase JWT 검증
  // ────────────────────────────────────────────────────────────────────
  let user;
  try {
    user = await verifySupabaseUser(req);
  } catch (err) {
    return send(res, 401, { ok: false, message: '인증에 실패했습니다.' });
  }
  if (!user || !user.id) {
    return send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  }

  // ────────────────────────────────────────────────────────────────────
  // 2) DBMS 계정 차단 — 임직원은 /api/admin/properties 사용
  // ────────────────────────────────────────────────────────────────────
  const userApp = String((user.app_metadata && user.app_metadata.app) || '').trim();
  if (userApp === 'dbms') {
    return send(res, 403, {
      ok: false,
      message: 'DBMS 계정은 이 API 를 사용할 수 없습니다. /api/admin/properties 를 사용해 주세요.',
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 3) 쿼리 파라미터 파싱
  // ────────────────────────────────────────────────────────────────────
  const url = new URL(req.url, 'http://localhost');
  const source = String(url.searchParams.get('source') || 'all').trim().toLowerCase();
  const status = String(url.searchParams.get('status') || '').trim();
  const q = String(url.searchParams.get('q') || '').trim();
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 300)));
  const markerLimit = Math.max(1, Math.min(2000, Number(url.searchParams.get('markerLimit') || 1200)));
  const swLat = toFiniteNumber(url.searchParams.get('swLat'));
  const swLng = toFiniteNumber(url.searchParams.get('swLng'));
  const neLat = toFiniteNumber(url.searchParams.get('neLat'));
  const neLng = toFiniteNumber(url.searchParams.get('neLng'));

  // ────────────────────────────────────────────────────────────────────
  // 4) Supabase REST 쿼리 빌드 + 호출
  // ────────────────────────────────────────────────────────────────────
  // 위·경도가 있는 row 만 (지도 표시 대상). 추가 필터는 가능한 한 DB 단계에서 처리.
  // source 필터는 sourceBucket 분류가 application 레이어에서 일어나므로,
  // 1차 SELECT 는 전체 가져오고 application 레이어에서 필터링.
  const params = new URLSearchParams();
  params.set('select', PUBLIC_SELECT_COLUMNS.join(','));
  params.set('order', 'date_uploaded.desc.nullslast,id.desc');
  params.set('limit', String(Math.max(limit, markerLimit, 1200)));
  // 위·경도 필수
  params.append('latitude', 'not.is.null');
  params.append('longitude', 'not.is.null');
  // bbox 필터 (지도 viewport)
  if (swLat !== null && neLat !== null) {
    params.append('latitude', `gte.${swLat}`);
    params.append('latitude', `lte.${neLat}`);
  }
  if (swLng !== null && neLng !== null) {
    params.append('longitude', `gte.${swLng}`);
    params.append('longitude', `lte.${neLng}`);
  }
  // status 필터 (DB 단계)
  if (status) {
    params.append('status', `eq.${status}`);
  }

  let rows;
  try {
    rows = await supabaseRest(`/rest/v1/properties?${params.toString()}`);
  } catch (err) {
    return send(res, err.status || 500, {
      ok: false,
      message: '매물 데이터를 불러오지 못했습니다.',
      detail: String(err.message || err),
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 5) 정규화 + application 레이어 필터링 (source / keyword)
  // ────────────────────────────────────────────────────────────────────
  const normalized = (Array.isArray(rows) ? rows : []).map(normalizeRow);
  const keyword = q.toLowerCase();

  const filtered = normalized.filter((row) => {
    // source 필터
    if (source && source !== 'all') {
      if (source === 'realtor') {
        if (!(row.sourceBucket === 'realtor_naver' || row.sourceBucket === 'realtor_direct')) return false;
      } else if (row.sourceBucket !== source) {
        return false;
      }
    }
    // 키워드 — 주소·물건번호·자산유형만 검색 (PII 영역은 검색 대상 아님)
    if (keyword) {
      const hay = [row.address, row.itemNo, row.type]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  // ────────────────────────────────────────────────────────────────────
  // 6) 요약(summary) — 필터 적용 후 count
  // ────────────────────────────────────────────────────────────────────
  const summary = { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
  for (const row of filtered) {
    summary.total += 1;
    if (Object.prototype.hasOwnProperty.call(summary, row.sourceBucket)) {
      summary[row.sourceBucket] += 1;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 7) items + markers 분리해서 응답
  // ────────────────────────────────────────────────────────────────────
  const items = filtered.slice(offset, offset + limit);
  const markers = filtered.slice(0, markerLimit).map((row) => ({
    id: row.id,
    address: row.address,
    type: row.type,
    latitude: row.latitude,
    longitude: row.longitude,
    sourceBucket: row.sourceBucket,
    source: row.source,
  }));

  // 캐시 비활성화 — 매물 데이터는 자주 변경됨
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  return send(res, 200, {
    ok: true,
    summary,
    total: summary.total,
    items,
    markers,
  });
};
