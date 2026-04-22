/**
 * api/admin/valuation/evaluate.js
 * Phase 2+3 — 비교사례 매칭 + 평가 산출 + DB 저장
 *
 * POST /api/admin/valuation/evaluate
 * Body: { propertyId: "xxx" }
 *   → 해당 매물에 대해 비교사례 매칭 → 수익률/경매 평가 → DB 저장
 *
 * POST /api/admin/valuation/evaluate  (batch)
 * Body: { propertyIds: ["xxx","yyy",...] }
 *   → 복수 매물 일괄 평가
 *
 * GET /api/admin/valuation/evaluate?propertyId=xxx
 *   → 저장된 평가 결과 조회
 */

const { applyCors } = require('../../_lib/cors');
const { send, getJsonBody } = require('../../_lib/utils');
const { hasSupabaseAdminEnv, requireSupabaseAdmin, getEnv } = require('../../_lib/supabase-admin');

function buildHeaders({ hasJson = false } = {}) {
  const { serviceRoleKey } = getEnv();
  return {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...(hasJson ? { 'Content-Type': 'application/json' } : {}),
  };
}

// ═══════════════════════════════════════════════════
// 법정동코드 API (행정안전부) — 실시간 조회
// ═══════════════════════════════════════════════════
// 환경변수: REGION_API_KEY (data.go.kr 서비스키)
// API: http://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList

const REGION_API_BASE = 'http://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList';
const regionCodeCache = new Map(); // 메모리 캐시 (함수 warm 동안 유지)

function getRegionApiKey() {
  return String(process.env.REGION_API_KEY || process.env.MOLIT_API_KEY || '').trim();
}

/**
 * 주소 문자열에서 법정동코드 API를 호출하여 시군구코드(5자리) + 동 이름을 반환
 * @param {string} address - 전체 주소 (예: "서울특별시 강남구 역삼동 123-45")
 * @returns {{ sigunguCode: string, dongName: string, regionCd: string }}
 */
async function resolveRegionCode(address) {
  const text = String(address || '').replace(/\s+/g, ' ').trim();
  if (!text) return { sigunguCode: '', dongName: '', regionCd: '' };

  // 주소에서 검색어 추출: "OO시 OO구 OO동" 또는 "OO도 OO시 OO동" 형태
  // 동 단위까지 포함하여 검색하면 정확도 높음
  const dongMatch = text.match(/([가-힣0-9]+동)\b/);
  const guMatch = text.match(/([가-힣]+[시군구])\s/);
  const sidoMatch = text.match(/^([가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도))/);

  // 검색어 조합: 가장 구체적인 것부터 시도
  const searchParts = [sidoMatch?.[1], guMatch?.[1], dongMatch?.[1]].filter(Boolean);
  const searchQuery = searchParts.join(' ') || text.substring(0, 20);

  // 캐시 확인
  if (regionCodeCache.has(searchQuery)) return regionCodeCache.get(searchQuery);

  const apiKey = getRegionApiKey();
  if (!apiKey) {
    console.warn('REGION_API_KEY 미설정, 주소 파싱으로 폴백');
    return fallbackParseAddress(text);
  }

  try {
    const params = new URLSearchParams({
      ServiceKey: apiKey,
      type: 'json',
      pageNo: '1',
      numOfRows: '10',
      flag: 'Y',
      locatadd_nm: searchQuery,
    });

    const res = await fetch(`${REGION_API_BASE}?${params.toString()}`);
    if (!res.ok) {
      console.warn(`법정동코드 API 응답 오류: ${res.status}`);
      return fallbackParseAddress(text);
    }

    const data = await res.json();
    const rows = data?.StanReginCd?.[1]?.row || [];

    if (!rows.length) {
      // 동 이름으로만 재시도
      if (dongMatch) {
        const params2 = new URLSearchParams({
          ServiceKey: apiKey, type: 'json', pageNo: '1', numOfRows: '10',
          flag: 'Y', locatadd_nm: dongMatch[1],
        });
        const res2 = await fetch(`${REGION_API_BASE}?${params2.toString()}`);
        if (res2.ok) {
          const data2 = await res2.json();
          const rows2 = data2?.StanReginCd?.[1]?.row || [];
          if (rows2.length) {
            const best = pickBestMatch(rows2, text);
            const result = {
              sigunguCode: best.region_cd ? best.region_cd.substring(0, 5) : '',
              dongName: best.locallow_nm || dongMatch[1],
              regionCd: best.region_cd || '',
            };
            regionCodeCache.set(searchQuery, result);
            return result;
          }
        }
      }
      return fallbackParseAddress(text);
    }

    const best = pickBestMatch(rows, text);
    const result = {
      sigunguCode: best.region_cd ? best.region_cd.substring(0, 5) : '',
      dongName: best.locallow_nm || dongMatch?.[1] || '',
      regionCd: best.region_cd || '',
    };
    regionCodeCache.set(searchQuery, result);
    return result;
  } catch (err) {
    console.warn('법정동코드 API 호출 실패:', err.message);
    return fallbackParseAddress(text);
  }
}

/**
 * API 응답에서 주소와 가장 잘 매칭되는 row 선택
 */
function pickBestMatch(rows, address) {
  const normalized = address.replace(/\s+/g, '');
  let best = rows[0];
  let bestScore = 0;

  for (const row of rows) {
    const locatAddr = (row.locatadd_nm || '').replace(/\s+/g, '');
    let score = 0;
    // 동 레벨까지 매칭되면 높은 점수 (umd_cd가 000이 아닌 것)
    if (row.umd_cd && row.umd_cd !== '000') score += 10;
    // 주소 문자열에 포함되면 가산
    if (normalized.includes(locatAddr.replace(/\s+/g, ''))) score += 5;
    if (locatAddr && normalized.includes(locatAddr)) score += 5;
    // 리 코드가 00이면 동 레벨 (리 레벨보다 선호)
    if (row.ri_cd === '00') score += 2;
    if (score > bestScore) { bestScore = score; best = row; }
  }
  return best;
}

/**
 * API 사용 불가 시 주소 문자열에서 직접 파싱 (폴백)
 * 주요 시군구 코드만 하드코딩
 */
function fallbackParseAddress(address) {
  const dongMatch = address.match(/([가-힣0-9]+동)\b/);
  const dongName = dongMatch ? dongMatch[1] : '';

  // 간단한 시군구 매핑 (주요 지역만)
  const KNOWN_CODES = {
    '강남구': '11680', '서초구': '11650', '송파구': '11710', '강동구': '11740',
    '마포구': '11440', '용산구': '11170', '성동구': '11200', '광진구': '11215',
    '동대문구': '11230', '중랑구': '11260', '성북구': '11290', '강북구': '11305',
    '도봉구': '11320', '노원구': '11350', '은평구': '11380', '서대문구': '11410',
    '종로구': '11110', '중구': '11140', '영등포구': '11560', '동작구': '11590',
    '관악구': '11620', '금천구': '11545', '구로구': '11530', '양천구': '11470',
    '강서구': '11500', '중구': '11140',
  };

  for (const [gu, code] of Object.entries(KNOWN_CODES)) {
    if (address.includes(gu)) {
      return { sigunguCode: code, dongName, regionCd: '' };
    }
  }
  return { sigunguCode: '', dongName, regionCd: '' };
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
  if (!res.ok) throw new Error((data?.message || data?.error) || `${res.status}`);
  return data;
}

// ═══════════════════════════════════════════════════
// Phase 2: 비교사례 매칭 엔진
// ═══════════════════════════════════════════════════

/**
 * 매칭 가중치 (수정 반영):
 *   같은 층 여부  40%
 *   거래 최신성   30%
 *   면적 유사도   20%
 *   용도 동일성   10%
 */

function floorScore(targetFloor, compFloor) {
  const t = targetFloor || 0;
  const c = compFloor || 0;
  if (t === c) return 100;
  // 1층 vs 지하
  if ((t === 1 && c < 0) || (t < 0 && c === 1)) return 30;
  // 1층 vs 2층 이상
  if ((t === 1 && c >= 2) || (c === 1 && t >= 2)) return 50;
  // 같은 카테고리 (둘 다 지하, 둘 다 2층 이상)
  if ((t < 0 && c < 0) || (t >= 2 && c >= 2)) return 70;
  return 40;
}

function recencyScore(dealYear, dealMonth) {
  const now = new Date();
  const dealDate = new Date(dealYear, dealMonth - 1, 15);
  const monthsAgo = (now.getFullYear() - dealDate.getFullYear()) * 12 + (now.getMonth() - dealDate.getMonth());
  if (monthsAgo <= 0) return 100;
  if (monthsAgo >= 12) return 0;
  return Math.round(100 * (1 - monthsAgo / 12));
}

function areaScore(targetArea, compArea) {
  if (!targetArea || !compArea) return 50; // 면적 정보 없으면 중립
  const ratio = Math.abs(targetArea - compArea) / targetArea;
  if (ratio <= 0.05) return 100;
  if (ratio >= 0.30) return 0;
  return Math.round(100 * (1 - ratio / 0.30));
}

function useScore(targetUse, compUse) {
  if (!targetUse || !compUse) return 50;
  const t = targetUse.replace(/\s/g, '');
  const c = compUse.replace(/\s/g, '');
  if (t === c) return 100;
  // 근린생활 계열끼리는 유사
  const isKunrin = (s) => /근린생활|근생/.test(s);
  if (isKunrin(t) && isKunrin(c)) return 70;
  return 0;
}

function computeMatchScore(target, comp) {
  const fs = floorScore(target.floor, comp.floor);
  const rs = recencyScore(comp.deal_year, comp.deal_month);
  const as = areaScore(target.building_area, comp.building_area);
  const us = useScore(target.building_use, comp.building_use);
  return fs * 0.40 + rs * 0.30 + as * 0.20 + us * 0.10;
}

function matchTransactions(target, transactions) {
  const scored = transactions
    .map((tx) => ({
      ...tx,
      _matchScore: computeMatchScore(target, tx),
    }))
    .filter((tx) => tx._matchScore > 20) // 최소 임계값
    .sort((a, b) => b._matchScore - a._matchScore);
  return scored;
}

function matchRentals(target, rentals) {
  // 임대 매칭도 유사 로직 (면적/층 기준)
  return rentals
    .map((r) => {
      const fs = floorScore(target.floor, r.floor);
      const as = areaScore(target.building_area, r.area_m2);
      return { ...r, _matchScore: fs * 0.5 + as * 0.5 };
    })
    .filter((r) => r._matchScore > 20)
    .sort((a, b) => b._matchScore - a._matchScore);
}

// ═══════════════════════════════════════════════════
// Phase 3A: 임대수익률 기반 평가 (일반/중개)
// ═══════════════════════════════════════════════════

/**
 * 연 임대수익률 = (월세 × 12) / (매매가 - 보증금) × 100%
 *
 * 등급 기준:
 *   A: 6%+     — 높은 수익률, 즉시 매입 추천
 *   B: 5~6%    — 양호한 수익률
 *   C: 4~5%    — 시장 평균 수준
 *   D: 3~4%    — 수익률 미흡
 *   E: 3% 미만  — 투자 매력 낮음
 */

function computeYieldGrade(annualYield) {
  if (annualYield >= 6) return 'A';
  if (annualYield >= 5) return 'B';
  if (annualYield >= 4) return 'C';
  if (annualYield >= 3) return 'D';
  return 'E';
}

function evaluateYield(property, matchedTx, matchedRentals) {
  const salePrice = property.price_main || property.lowprice || 0; // 만원
  if (!salePrice) return null;

  // 주변 임대 호가 가중평균
  let weightedRent = 0, weightedDeposit = 0, totalWeight = 0;
  const topRentals = matchedRentals.slice(0, 10);

  for (const r of topRentals) {
    if (!r.monthly_rent) continue;
    const w = r._matchScore;
    weightedRent += (r.monthly_rent || 0) * w;
    weightedDeposit += (r.deposit || 0) * w;
    totalWeight += w;
  }

  if (!totalWeight) return null;

  const estMonthlyRent = Math.round(weightedRent / totalWeight);
  const estDeposit = Math.round(weightedDeposit / totalWeight);

  const realInvestment = salePrice - estDeposit;
  if (realInvestment <= 0) return null;

  const annualYield = ((estMonthlyRent * 12) / realInvestment) * 100;

  // 주변 평균 수익률 (거래사례 + 임대 호가 교차)
  let avgYield = null;
  if (matchedTx.length >= 2 && topRentals.length >= 2) {
    let txWeightedPrice = 0, txWeight = 0;
    for (const tx of matchedTx.slice(0, 10)) {
      txWeightedPrice += tx.deal_amount * tx._matchScore;
      txWeight += tx._matchScore;
    }
    if (txWeight > 0) {
      const avgTxPrice = txWeightedPrice / txWeight;
      avgYield = ((estMonthlyRent * 12) / (avgTxPrice - estDeposit)) * 100;
    }
  }

  const grade = computeYieldGrade(annualYield);

  return {
    valuation_type: 'yield',
    est_monthly_rent: estMonthlyRent,
    est_deposit: estDeposit,
    sale_price: salePrice,
    annual_yield: Math.round(annualYield * 1000) / 1000,
    avg_area_yield: avgYield ? Math.round(avgYield * 1000) / 1000 : null,
    grade,
    score: Math.min(100, Math.round(annualYield / 8 * 100)),
    comparable_count: matchedTx.length,
    comparable_ids: matchedTx.slice(0, 10).map((t) => t.id),
    rental_comp_ids: topRentals.map((r) => r.id),
    detail: {
      formula: '(월세×12) / (매매가-보증금) × 100%',
      estMonthlyRent: estMonthlyRent,
      estDeposit: estDeposit,
      salePrice: salePrice,
      realInvestment: realInvestment,
      annualYield: Math.round(annualYield * 1000) / 1000,
      avgAreaYield: avgYield ? Math.round(avgYield * 1000) / 1000 : null,
      rentalComparables: topRentals.length,
      txComparables: matchedTx.length,
    },
  };
}

// ═══════════════════════════════════════════════════
// Phase 3B: 경매/공매 이중검증 평가
// ═══════════════════════════════════════════════════

function evaluateAuction(property, matchedTx, matchedRentals) {
  const appraisalPrice = property.price_main || 0;  // 감정가 (만원)
  const currentPrice = property.lowprice || 0;        // 현재가/최저가 (만원)
  if (!appraisalPrice || !currentPrice) return null;

  // ① 감정가 대비 낙찰가율
  const bidRatio = (currentPrice / appraisalPrice) * 100;

  // ② 시세 대비 현재가
  let marketRatio = null;
  if (matchedTx.length >= 1) {
    let txWeightedPrice = 0, txWeight = 0;
    for (const tx of matchedTx.slice(0, 10)) {
      txWeightedPrice += tx.deal_amount * tx._matchScore;
      txWeight += tx._matchScore;
    }
    if (txWeight > 0) {
      const avgMarketPrice = txWeightedPrice / txWeight;
      marketRatio = (currentPrice / avgMarketPrice) * 100;
    }
  }

  // ③ 임대수익률 (있으면 추가)
  let yieldResult = null;
  if (matchedRentals.length >= 1) {
    yieldResult = evaluateYield(
      { ...property, price_main: currentPrice, lowprice: null },
      matchedTx,
      matchedRentals
    );
  }

  // 종합 등급 산출
  let score = 0;
  // 낙찰가율 점수 (낮을수록 좋음): 50% 미만 = 만점
  const bidScore = bidRatio <= 50 ? 100 : bidRatio >= 100 ? 0 : Math.round((100 - bidRatio) * 2);
  score += bidScore * 0.4;

  // 시세대비 점수 (낮을수록 좋음)
  if (marketRatio !== null) {
    const mktScore = marketRatio <= 60 ? 100 : marketRatio >= 110 ? 0 : Math.round((110 - marketRatio) * 2);
    score += mktScore * 0.35;
  } else {
    score += 50 * 0.35; // 중립
  }

  // 수익률 점수
  if (yieldResult) {
    score += Math.min(100, yieldResult.score) * 0.25;
  } else {
    score += 50 * 0.25;
  }

  let grade;
  if (score >= 80) grade = 'A';
  else if (score >= 65) grade = 'B';
  else if (score >= 50) grade = 'C';
  else if (score >= 35) grade = 'D';
  else grade = 'E';

  return {
    valuation_type: 'auction',
    appraisal_price: appraisalPrice,
    sale_price: currentPrice,
    bid_ratio: Math.round(bidRatio * 1000) / 1000,
    market_ratio: marketRatio ? Math.round(marketRatio * 1000) / 1000 : null,
    annual_yield: yieldResult?.annual_yield || null,
    est_monthly_rent: yieldResult?.est_monthly_rent || null,
    est_deposit: yieldResult?.est_deposit || null,
    avg_area_yield: yieldResult?.avg_area_yield || null,
    grade,
    score: Math.round(score * 10) / 10,
    comparable_count: matchedTx.length,
    comparable_ids: matchedTx.slice(0, 10).map((t) => t.id),
    rental_comp_ids: (matchedRentals || []).slice(0, 10).map((r) => r.id),
    detail: {
      bidRatio: Math.round(bidRatio * 100) / 100,
      marketRatio: marketRatio ? Math.round(marketRatio * 100) / 100 : null,
      bidScore,
      yieldResult: yieldResult?.detail || null,
      txComparables: matchedTx.length,
      rentalComparables: matchedRentals.length,
    },
  };
}

// ═══════════════════════════════════════════════════
// 메인 평가 파이프라인
// ═══════════════════════════════════════════════════

async function evaluateProperty(propertyId) {
  // 1. 매물 정보 조회
  const props = await sbRest(
    `/rest/v1/properties?id=eq.${encodeURIComponent(propertyId)}&limit=1`
  );
  const prop = Array.isArray(props) ? props[0] : null;
  if (!prop) throw new Error(`매물을 찾을 수 없습니다: ${propertyId}`);

  const address = prop.address || '';
  const raw = prop.raw && typeof prop.raw === 'object' ? prop.raw : {};

  // 2. 주소에서 시군구코드 + 동 추출 (법정동코드 API 실시간 호출)
  const dongMatch = address.match(/([가-힣0-9]+동)\b/);
  const dongName = dongMatch ? dongMatch[1] : '';

  const resolved = await resolveRegionCode(address);
  const sigunguCode = resolved.sigunguCode;

  if (!sigunguCode) {
    return {
      property_id: propertyId,
      error: '시군구코드를 확인할 수 없습니다. 주소를 확인하세요: ' + address,
      grade: null,
    };
  }

  // 3. 매물 메타 정보 정리
  const targetFloor = parseInt(prop.floor || raw.floor || '0', 10) || null;
  const targetArea = parseFloat(prop.exclusive_area || prop.common_area || raw.exclusivearea || '0') || null;
  const buildingUse = prop.asset_type || raw.assetType || raw.asset_type || '';

  const targetInfo = {
    floor: targetFloor,
    building_area: targetArea,
    building_use: buildingUse,
  };

  // 4. 거래사례 조회 (최근 12개월, 같은 동)
  const transactions = await sbRest(
    `/rest/v1/market_transactions?sigungu_code=eq.${sigunguCode}&dong_name=eq.${encodeURIComponent(dongName)}&cancel_yn=neq.Y&order=deal_year.desc,deal_month.desc&limit=200`
  );
  const txList = Array.isArray(transactions) ? transactions : [];

  // 5. 임대 호가 조회
  const rentals = await sbRest(
    `/rest/v1/rental_listings?sigungu_code=eq.${sigunguCode}&dong_name=ilike.*${encodeURIComponent(dongName)}*&expired=eq.false&limit=200`
  );
  const rentalList = Array.isArray(rentals) ? rentals : [];

  // 6. 매칭
  const matchedTx = matchTransactions(targetInfo, txList);
  const matchedRentals = matchRentals(targetInfo, rentalList);

  // 7. 평가 분기
  const sourceType = String(prop.source_type || raw.source_type || raw.sourceType || '').toLowerCase();
  const isAuction = sourceType === 'auction' || sourceType === 'onbid';

  let result;
  if (isAuction) {
    result = evaluateAuction(
      { price_main: prop.price_main, lowprice: prop.lowprice },
      matchedTx,
      matchedRentals
    );
  } else {
    result = evaluateYield(
      { price_main: prop.price_main || prop.lowprice, lowprice: null },
      matchedTx,
      matchedRentals
    );
  }

  if (!result) {
    return {
      property_id: propertyId,
      error: `비교사례 부족 (거래 ${matchedTx.length}건, 임대 ${matchedRentals.length}건)`,
      grade: null,
      comparable_count: matchedTx.length,
    };
  }

  // 8. DB 저장 (upsert)
  const row = {
    property_id: propertyId,
    ...result,
    evaluated_at: new Date().toISOString(),
  };

  await sbRest('/rest/v1/valuation_results', {
    method: 'POST',
    json: row,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });

  return row;
}

// ── Handler ──

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!hasSupabaseAdminEnv()) return send(res, 500, { error: 'Supabase 미설정' });

  // SECURITY: 관리자 인증 필수 — 평가 트리거/결과 조회 모두 service_role 로 DB 에 접근하므로
  // 비로그인/비관리자 호출을 차단해 valuation_results 테이블 쓰기 및 자원 남용을 방지한다.
  const session = await requireSupabaseAdmin(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const { propertyId } = req.query || {};
      if (!propertyId) return send(res, 400, { error: 'propertyId 필수' });

      const rows = await sbRest(
        `/rest/v1/valuation_results?property_id=eq.${encodeURIComponent(propertyId)}&order=evaluated_at.desc&limit=5`
      );
      return send(res, 200, { ok: true, results: Array.isArray(rows) ? rows : [] });
    }

    if (req.method === 'POST') {
      const body = getJsonBody(req);

      // 단건
      if (body.propertyId) {
        const result = await evaluateProperty(body.propertyId);
        return send(res, 200, { ok: true, result });
      }

      // 일괄
      if (Array.isArray(body.propertyIds)) {
        const results = [];
        for (const pid of body.propertyIds.slice(0, 50)) {
          try {
            const r = await evaluateProperty(pid);
            results.push(r);
          } catch (err) {
            results.push({ property_id: pid, error: err.message });
          }
        }
        return send(res, 200, { ok: true, results });
      }

      return send(res, 400, { error: 'propertyId 또는 propertyIds 필수' });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('evaluate error:', err);
    return send(res, 500, { error: err.message || '서버 오류' });
  }
};
