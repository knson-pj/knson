/**
 * api/admin/population.js
 * 행안부 법정동별(행정동 통반단위) 주민등록 인구 및 세대현황 API 연동 + DB 캐싱
 *
 * GET /api/admin/population?dong=역삼동
 * GET /api/admin/population?stdgCd=1168010100
 *
 * 환경변수: MOIS_POP_API_KEY (행안부 인구 API 서비스키, Decoding 버전)
 */

const { applyCors } = require('../_lib/cors');
const { send } = require('../_lib/utils');
const { hasSupabaseAdminEnv, getEnv } = require('../_lib/supabase-admin');

const MOIS_BASE = 'https://apis.data.go.kr/1741000/stdgPpltnHhStus';
const CACHE_TTL_DAYS = 30;

function getMoisApiKey() {
  return String(process.env.MOIS_POP_API_KEY || '').trim();
}

// ── Supabase helpers ──

function buildSupabaseHeaders({ hasJson = false } = {}) {
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
    headers: { ...buildSupabaseHeaders({ hasJson: opts.json !== undefined }), ...(opts.headers || {}) },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data?.message || data?.error) || `Supabase ${res.status}`);
  return data;
}

// ── DB 캐시 ──

async function getCachedPopulation(dongCode) {
  try {
    const rows = await sbRest(
      `/rest/v1/population_cache?dong_code=eq.${encodeURIComponent(dongCode)}&expires_at=gt.${new Date().toISOString()}&order=fetched_at.desc&limit=1`
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch { return null; }
}

async function savePopulationCache(data) {
  try {
    const rc = encodeURIComponent(data.region_code || '');
    const dc = encodeURIComponent(data.dong_code || '');
    if (rc && dc) {
      try { await sbRest(`/rest/v1/population_cache?region_code=eq.${rc}&dong_code=eq.${dc}`, { method: 'DELETE' }); } catch {}
    }
    await sbRest('/rest/v1/population_cache', {
      method: 'POST',
      json: data,
      headers: { Prefer: 'return=minimal' },
    });
  } catch (err) {
    console.error('population cache save failed:', err?.message);
  }
}

// ── 법정동 코드 매핑 (주요 상업지역) ──

const DONG_CODE_MAP = {
  // 서울 강남구
  '역삼동': '1168010100', '삼성동': '1168010300', '대치동': '1168010500',
  '논현동': '1168010800', '압구정동': '1168011000', '청담동': '1168011100',
  '신사동': '1168011200', '도곡동': '1168010600', '개포동': '1168010700',
  '세곡동': '1168010900',
  // 서울 서초구
  '서초동': '1165010100', '반포동': '1165010400', '잠원동': '1165010500',
  '방배동': '1165010700', '양재동': '1165010800', '내곡동': '1165011000',
  // 서울 송파구
  '잠실동': '1171010100', '신천동': '1171010200', '가락동': '1171010300',
  '문정동': '1171010600', '방이동': '1171010800', '오금동': '1171010900',
  '석촌동': '1171010400',
  // 서울 영등포구
  '영등포동': '1156010100', '여의도동': '1156010400', '당산동': '1156010500',
  '문래동': '1156010200', '양평동': '1156010700', '신길동': '1156010800',
  '대림동': '1156010900',
  // 서울 마포구
  '서교동': '1144010600', '합정동': '1144010500', '상수동': '1144010700',
  '망원동': '1144010800', '연남동': '1144010900', '성산동': '1144011100',
  // 서울 종로구
  '삼청동': '1111014000', '종로동': '1111011100', '사직동': '1111012500',
  '관철동': '1111011800', '인사동': '1111012100',
  // 서울 중구
  '명동': '1114011500', '회현동': '1114012400', '충무로': '1114012100',
  '필동': '1114012200', '을지로동': '1114011200',
  // 서울 용산구
  '이태원동': '1117010200', '한남동': '1117010300', '용산동': '1117010800',
  // 서울 성동구
  '성수동': '1120010800', '금호동': '1120010100', '옥수동': '1120010200',
  // 서울 광진구
  '자양동': '1121510200', '구의동': '1121510100', '화양동': '1121510300',
  // 서울 강서구
  '마곡동': '1150010500', '등촌동': '1150010200', '화곡동': '1150010300',
  // 서울 구로구
  '구로동': '1153010100', '신도림동': '1153010300', '가리봉동': '1153010200',
  // 서울 관악구
  '신림동': '1162010200', '봉천동': '1162010100',
  // 서울 동작구
  '노량진동': '1159010100', '상도동': '1159010300',
  // 서울 강동구
  '천호동': '1174010100', '길동': '1174010500', '명일동': '1174010300',
  // 서울 노원구
  '상계동': '1135010100', '공릉동': '1135010300',
  // 서울 은평구
  '불광동': '1138010100', '갈현동': '1138010200',
  // 서울 서대문구
  '연희동': '1141010100', '신촌동': '1141010700',
  // 서울 동대문구
  '전농동': '1123010100', '답십리동': '1123010300',
  // 서울 성북구
  '정릉동': '1129010800', '길음동': '1129010600',
  // 서울 양천구
  '목동': '1147010100', '신정동': '1147010200',
  // 서울 금천구
  '가산동': '1154510100', '독산동': '1154510200',
  // 서울 도봉구
  '창동': '1132010200', '방학동': '1132010100',
  // 서울 중랑구
  '면목동': '1126010100', '상봉동': '1126010200',
  // 서울 강북구
  '미아동': '1130510100', '번동': '1130510200',
  // 경기 성남시 분당구
  '정자동': '4113510900', '서현동': '4113510700', '수내동': '4113510600',
  '야탑동': '4113510300', '이매동': '4113510400', '판교동': '4113511200',
  // 경기 수원시
  '인계동': '4111110700', '매탄동': '4111110600',
  // 경기 고양시
  '일산동': '4128110300', '풍동': '4128510100',
  // 경기 용인시
  '수지동': '4146310100',
  // 인천
  '송도동': '2826010500', '부평동': '2823710100',
};

function resolveDongCode(dong, stdgCd) {
  if (stdgCd && /^\d{10}$/.test(String(stdgCd).trim())) return String(stdgCd).trim();
  const name = String(dong || '').trim();
  if (!name) return '';
  return DONG_CODE_MAP[name] || '';
}

// ── 행안부 API 호출 ──

function getLatestYm() {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
}

async function fetchMoisPopulation(stdgCd) {
  const apiKey = getMoisApiKey();
  if (!apiKey) throw new Error('MOIS_POP_API_KEY 환경변수가 설정되지 않았습니다.');

  const ym = getLatestYm();
  // serviceKey는 URLSearchParams의 자동 인코딩을 피하기 위해 수동 조립
  const queryParts = [
    `serviceKey=${apiKey}`,
    `stdgCd=${encodeURIComponent(stdgCd)}`,
    `srchFrYm=${ym}`,
    `srchToYm=${ym}`,
    `lv=4`,
    `regSeCd=1`,
    `type=XML`,
    `numOfRows=100`,
    `pageNo=1`,
  ];

  const url = `${MOIS_BASE}?${queryParts.join('&')}`;
  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`행안부 API 오류 (${res.status}): ${text.slice(0, 300)}`);
  }

  // JSON 시도
  try {
    return { format: 'json', data: JSON.parse(text) };
  } catch {}
  // XML fallback
  return { format: 'xml', data: text };
}

// ── XML 파싱 ──

function parseXmlItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const g = (t) => { const r = b.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return r ? r[1].trim() : ''; };
    items.push({
      statsYm: g('statsYm'), admmCd: g('admmCd'), ctpvNm: g('ctpvNm'), sggNm: g('sggNm'),
      dongNm: g('dongNm'), tong: g('tong'), ban: g('ban'), stdgCd: g('stdgCd'), stdgNm: g('stdgNm'),
      totNmprCnt: g('totNmprCnt'), hhCnt: g('hhCnt'), hhNmpr: g('hhNmpr'),
      maleNmprCnt: g('maleNmprCnt'), femlNmprCnt: g('femlNmprCnt'), maleFemlRate: g('maleFemlRate'),
    });
  }
  return items;
}

// ── 통/반 합산 ──

function aggregateItems(items, dongCode) {
  if (!items.length) return null;

  let totalPop = 0, hhCount = 0, malePop = 0, femalePop = 0;
  let regionCode = '', dongName = '', regionName = '';

  for (const r of items) {
    totalPop += parseInt(r.totNmprCnt || 0, 10) || 0;
    hhCount += parseInt(r.hhCnt || 0, 10) || 0;
    malePop += parseInt(r.maleNmprCnt || 0, 10) || 0;
    femalePop += parseInt(r.femlNmprCnt || 0, 10) || 0;
    if (!regionCode && r.admmCd) regionCode = String(r.admmCd).slice(0, 5);
    if (!dongName && r.stdgNm) dongName = r.stdgNm;
    if (!regionName && r.ctpvNm) regionName = `${r.ctpvNm} ${r.sggNm || ''}`.trim();
  }

  const now = new Date();
  return {
    region_code: regionCode,
    region_name: regionName,
    dong_code: dongCode || (items[0]?.stdgCd || ''),
    dong_name: dongName,
    total_pop: totalPop,
    household_count: hhCount,
    male_pop: malePop,
    female_pop: femalePop,
    data_date: items[0]?.statsYm || '',
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CACHE_TTL_DAYS * 86400000).toISOString(),
  };
}

function parseApiResponse(result, dongCode) {
  if (result.format === 'json') {
    const d = result.data;
    let items = d?.Response?.items?.item || d?.response?.body?.items?.item || d?.items?.item || d?.items || null;
    if (!items) return null;
    if (!Array.isArray(items)) items = [items];
    return aggregateItems(items, dongCode);
  }
  // XML
  const items = parseXmlItems(result.data);
  return aggregateItems(items, dongCode);
}

// ── Handler ──

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const dong = String(req.query?.dong || '').trim();
  const stdgCdParam = String(req.query?.stdgCd || '').trim();
  const dongCode = resolveDongCode(dong, stdgCdParam);

  if (!dongCode) {
    return send(res, 400, {
      error: `법정동 코드를 확인할 수 없습니다. dong="${dong}" — stdgCd 파라미터를 직접 전달하거나, 매핑에 등록되지 않은 동입니다.`,
    });
  }

  try {
    // 1. DB 캐시
    if (hasSupabaseAdminEnv()) {
      const cached = await getCachedPopulation(dongCode);
      if (cached) return send(res, 200, { ok: true, source: 'cache', data: cached });
    }

    // 2. 행안부 API
    const apiResult = await fetchMoisPopulation(dongCode);
    const parsed = parseApiResponse(apiResult, dongCode);

    if (!parsed) {
      return send(res, 200, { ok: true, source: 'api', data: null, message: `"${dong || dongCode}" 인구 데이터를 찾을 수 없습니다.` });
    }

    // 3. 캐시 저장
    if (hasSupabaseAdminEnv()) {
      await savePopulationCache(parsed).catch(() => {});
    }

    return send(res, 200, { ok: true, source: 'api', data: parsed });
  } catch (err) {
    console.error('population API error:', err);
    return send(res, 500, {
      error: err.message || '인구 데이터 조회 실패',
      debug: { dong, dongCode, ym: getLatestYm() },
    });
  }
};
