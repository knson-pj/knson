const { applyCors } = require('../_lib/cors');
const { getStore } = require('../_lib/store');
const {
  send,
  getJsonBody,
  normalizeAddress,
  extractGuDong,
  normalizePhone,
  normalizeStatus,
  id,
  nowIso,
} = require('../_lib/utils');
const { requireAdmin } = require('../_lib/auth');
const { hasSupabaseAdminEnv, requireSupabaseAdmin, getEnv } = require('../_lib/supabase-admin');
const PropertyDomain = require('../../knson-property-domain.js');

function omitUndefined(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([_, v]) => v !== undefined));
}

function buildSupabaseHeaders(hasJson = false, extra = {}) {
  const { serviceRoleKey } = getEnv();
  const headers = {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function supabaseRest(path, { method = 'GET', json, headers } = {}) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: buildSupabaseHeaders(json !== undefined, headers),
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.msg || data.error_description || data.error)) || `Supabase API 오류 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}


const OVERVIEW_SELECT = [
  'source_type', 'source_url', 'is_general', 'submitter_type', 'submitter_name', 'broker_office_name',
  'address', 'latitude', 'longitude', 'geocode_status', 'exclusive_area', 'date_uploaded', 'created_at'
].join(',');

const MAP_SCAN_SELECT = [
  'id', 'global_id', 'item_no', 'source_type', 'source_url', 'is_general',
  'submitter_type', 'submitter_name', 'broker_office_name', 'address', 'asset_type',
  'floor', 'total_floor', 'common_area', 'exclusive_area', 'site_area', 'use_approval',
  'status', 'price_main', 'lowprice', 'date_main', 'assignee_id', 'latitude', 'longitude',
  'memo', 'created_at', 'date_uploaded', 'raw'
].join(',');

const AREA_KEYS = ['', '0-5', '5-10', '10-20', '20-30', '30-50', '50-100', '100-'];

async function supabaseHeadCount(path) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method: 'HEAD',
    headers: buildSupabaseHeaders(false, { Prefer: 'count=exact' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || `Supabase count 오류 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const contentRange = String(res.headers.get('content-range') || '').trim();
  const m = contentRange.match(/\/(\d+)$/);
  return m ? Number(m[1] || 0) : 0;
}

async function fetchSupabaseOverviewRealtorRows(pageSize = 5000) {
  const rows = [];
  let from = 0;
  const select = ['source_type','source_url','is_general','submitter_type','submitter_name','broker_office_name'].join(',');
  while (true) {
    const data = await supabaseRest(`/rest/v1/properties?select=${encodeURIComponent(select)}&source_type=eq.realtor&offset=${from}&limit=${pageSize}`);
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchSupabaseTodayRows(limit = 3000) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const select = ['source_type','source_url','is_general','submitter_type','submitter_name','broker_office_name','created_at','date_uploaded'].join(',');
  const orExpr = `(and(created_at.gte.${startIso},created_at.lt.${endIso}),and(date_uploaded.gte.${startIso},date_uploaded.lt.${endIso}))`;
  return supabaseRest(`/rest/v1/properties?select=${encodeURIComponent(select)}&or=${encodeURIComponent(orExpr)}&limit=${limit}`);
}

async function fetchSupabaseGeoPendingCount() {
  try {
    return await supabaseHeadCount('/rest/v1/properties?select=id&latitude=is.null&longitude=is.null&address=not.is.null&geocode_status=not.in.(ok,failed)');
  } catch {
    return 0;
  }
}

async function buildOverviewFastFromSupabase() {
  const [total, auction, onbid, general, realtorRows, todayRows, geoPending] = await Promise.all([
    supabaseHeadCount('/rest/v1/properties?select=id'),
    supabaseHeadCount('/rest/v1/properties?select=id&source_type=eq.auction'),
    supabaseHeadCount('/rest/v1/properties?select=id&source_type=eq.onbid'),
    supabaseHeadCount('/rest/v1/properties?select=id&source_type=eq.general'),
    fetchSupabaseOverviewRealtorRows(),
    fetchSupabaseTodayRows().catch(() => []),
    fetchSupabaseGeoPendingCount(),
  ]);

  const overview = createEmptyOverview();
  overview.summary.total = total;
  overview.summary.auction = auction;
  overview.summary.onbid = onbid;
  overview.summary.general = general;
  overview.geoPending = geoPending;
  overview.filterCounts.source[''] = total;
  overview.filterCounts.source.auction = auction;
  overview.filterCounts.source.onbid = onbid;
  overview.filterCounts.source.general = general;

  for (const row of Array.isArray(realtorRows) ? realtorRows : []) {
    const normalized = PropertyDomain && typeof PropertyDomain.buildNormalizedPropertyBase === 'function'
      ? PropertyDomain.buildNormalizedPropertyBase(row)
      : row;
    const bucket = PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function'
      ? PropertyDomain.getSourceBucket(normalized)
      : (String(row?.source_url || '').trim() ? 'realtor_naver' : 'realtor_direct');
    if (bucket === 'realtor_direct') overview.summary.realtor_direct += 1;
    else overview.summary.realtor_naver += 1;
  }
  overview.filterCounts.source.realtor_naver = overview.summary.realtor_naver;
  overview.filterCounts.source.realtor_direct = overview.summary.realtor_direct;

  const todayKey = getTodayKey();
  for (const row of Array.isArray(todayRows) ? todayRows : []) {
    const normalized = PropertyDomain && typeof PropertyDomain.buildNormalizedPropertyBase === 'function'
      ? PropertyDomain.buildNormalizedPropertyBase(row)
      : row;
    const createdAt = normalized?.createdAt || row?.created_at || row?.date_uploaded || '';
    if (!sameDay(createdAt, todayKey)) continue;
    overview.today.total += 1;
    const bucket = PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function'
      ? PropertyDomain.getSourceBucket(normalized)
      : String(normalized?.source_type || normalized?.sourceType || 'general');
    if (bucket === 'auction') overview.today.auction += 1;
    else if (bucket === 'onbid') overview.today.onbid += 1;
    else if (bucket === 'general') overview.today.general += 1;
    else if (bucket === 'realtor_naver') {
      overview.today.realtor += 1;
      overview.today.realtor_naver = Number(overview.today.realtor_naver || 0) + 1;
    } else if (bucket === 'realtor_direct') {
      overview.today.realtor += 1;
      overview.today.realtor_direct = Number(overview.today.realtor_direct || 0) + 1;
    }
  }

  overview.generatedAt = new Date().toISOString();
  overview.fast = true;
  return overview;
}


function splitSelectColumns(select) {
  return String(select || '').split(',').map((part) => String(part || '').trim()).filter(Boolean);
}

function removeMissingColumnFromSelect(select, missingColumn) {
  const target = String(missingColumn || '').trim();
  if (!target) return String(select || '');
  return splitSelectColumns(select)
    .filter((part) => String(part || '').split(':').pop().split('->')[0].split('(')[0].trim() !== target)
    .join(',');
}

function extractMissingColumn(error) {
  const text = String(error?.message || error?.details || error || '').trim();
  const m = text.match(/column\s+properties\.([a-zA-Z0-9_]+)\s+does not exist/i)
    || text.match(/Could not find the '([a-zA-Z0-9_]+)' column of 'properties'/i);
  return m ? String(m[1] || '').trim() : '';
}

function getAreaFilterMatch(value, area) {
  if (!value) return true;
  const [minStr, maxStr] = String(value).split('-');
  const min = parseFloat(minStr) || 0;
  const max = maxStr ? parseFloat(maxStr) : Infinity;
  const numericArea = Number(area);
  if (!Number.isFinite(numericArea) || numericArea <= 0) return false;
  return numericArea >= min && (max === Infinity || numericArea < max);
}

function sameDay(dateLike, dateKey) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return false;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}` === dateKey;
}

function getTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function createEmptyOverview() {
  return {
    summary: { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 },
    today: { total: 0, auction: 0, onbid: 0, realtor: 0, general: 0 },
    geoPending: 0,
    filterCounts: {
      source: { '': 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 },
      area: { '': 0, '0-5': 0, '5-10': 0, '10-20': 0, '20-30': 0, '30-50': 0, '50-100': 0, '100-': 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

function appendRowToOverview(overview, row, todayKey) {
  const normalized = PropertyDomain && typeof PropertyDomain.buildNormalizedPropertyBase === 'function'
    ? PropertyDomain.buildNormalizedPropertyBase(row)
    : row;
  const bucket = PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function'
    ? PropertyDomain.getSourceBucket(normalized)
    : String(normalized?.source_type || normalized?.sourceType || 'general');
  overview.summary.total += 1;
  if (Object.prototype.hasOwnProperty.call(overview.summary, bucket)) overview.summary[bucket] += 1;
  overview.filterCounts.source[''] += 1;
  if (Object.prototype.hasOwnProperty.call(overview.filterCounts.source, bucket)) overview.filterCounts.source[bucket] += 1;

  const createdAt = normalized?.createdAt || row?.created_at || row?.date_uploaded || '';
  if (sameDay(createdAt, todayKey)) {
    overview.today.total += 1;
    if (bucket === 'auction') overview.today.auction += 1;
    else if (bucket === 'onbid') overview.today.onbid += 1;
    else if (bucket === 'general') overview.today.general += 1;
    else if (bucket === 'realtor_naver' || bucket === 'realtor_direct') overview.today.realtor += 1;
  }

  const status = String(normalized?.geocodeStatus || row?.geocode_status || '').trim().toLowerCase();
  const lat = normalized?.latitude ?? row?.latitude;
  const lng = normalized?.longitude ?? row?.longitude;
  const hasCoords = lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '';
  const address = String(normalized?.address || row?.address || '').trim();
  if (!hasCoords && address && status !== 'failed' && status !== 'ok') overview.geoPending += 1;

  overview.filterCounts.area[''] += 1;
  for (const key of AREA_KEYS.slice(1)) {
    if (getAreaFilterMatch(key, normalized?.exclusivearea ?? row?.exclusive_area)) {
      overview.filterCounts.area[key] += 1;
    }
  }
}

async function fetchSupabaseOverviewRows(pageSize = 5000) {
  const rows = [];
  let from = 0;
  let activeSelect = OVERVIEW_SELECT;
  const removed = new Set();
  while (true) {
    const to = from + pageSize - 1;
    let data;
    try {
      data = await supabaseRest(`/rest/v1/properties?select=${encodeURIComponent(activeSelect)}&offset=${from}&limit=${pageSize}`);
    } catch (err) {
      const missing = extractMissingColumn(err);
      if (missing && !removed.has(missing)) {
        const nextSelect = removeMissingColumnFromSelect(activeSelect, missing);
        if (nextSelect && nextSelect !== activeSelect) {
          removed.add(missing);
          activeSelect = nextSelect;
          from = 0;
          rows.length = 0;
          continue;
        }
      }
      throw err;
    }
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function buildOverviewFromRows(rows) {
  const overview = createEmptyOverview();
  const todayKey = getTodayKey();
  for (const row of Array.isArray(rows) ? rows : []) appendRowToOverview(overview, row, todayKey);
  return overview;
}


function buildMapRow(row) {
  const base = PropertyDomain && typeof PropertyDomain.buildNormalizedPropertyBase === 'function'
    ? PropertyDomain.buildNormalizedPropertyBase(row)
    : row;
  const sourceBucket = PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function'
    ? PropertyDomain.getSourceBucket({
        ...row,
        ...base,
        raw: row?.raw || base?.raw || {},
        sourceType: base?.sourceType || row?.source_type || row?.sourceType || row?.source,
        source_type: row?.source_type || base?.sourceType || row?.sourceType || row?.source,
        sourceUrl: base?.sourceUrl || row?.source_url || row?.sourceUrl,
        source_url: row?.source_url || base?.sourceUrl || row?.sourceUrl,
        globalId: base?.globalId || row?.global_id || row?.globalId,
        global_id: row?.global_id || base?.globalId || row?.globalId,
        submitterType: base?.submitterType || row?.submitter_type || row?.submitterType,
        submitter_type: row?.submitter_type || base?.submitterType || row?.submitterType,
        brokerOfficeName: base?.brokerOfficeName || row?.broker_office_name || row?.brokerOfficeName,
        broker_office_name: row?.broker_office_name || base?.brokerOfficeName || row?.brokerOfficeName,
        isGeneral: (row?.is_general ?? base?.isGeneral),
        is_general: (row?.is_general ?? base?.isGeneral),
      })
    : String(base?.sourceType || row?.source_type || 'general');

  return {
    id: base?.id || row?.id || '',
    itemNo: base?.itemNo || row?.item_no || '',
    source: base?.sourceType || row?.source_type || 'general',
    sourceBucket,
    status: base?.status || row?.status || '',
    address: base?.address || row?.address || '',
    type: base?.assetType || row?.asset_type || '',
    floor: base?.floor || row?.floor || '',
    totalFloor: base?.totalfloor || row?.total_floor || '',
    useapproval: base?.useapproval || row?.use_approval || '',
    exclusivearea: base?.exclusivearea ?? row?.exclusive_area ?? null,
    commonarea: base?.commonarea ?? row?.common_area ?? null,
    sitearea: base?.sitearea ?? row?.site_area ?? null,
    appraisalPrice: base?.priceMain ?? row?.price_main ?? null,
    currentPrice: base?.lowprice ?? row?.lowprice ?? null,
    bidDate: base?.dateMain || row?.date_main || '',
    createdAt: base?.createdAt || row?.created_at || row?.date_uploaded || '',
    assignedAgentId: base?.assignedAgentId || row?.assignee_id || '',
    assignedAgentName: base?.assignedAgentName || '-',
    rightsAnalysis: base?.rightsAnalysis || '',
    siteInspection: base?.siteInspection || '',
    opinion: base?.opinion || row?.memo || '',
    regionGu: base?.regionGu || '',
    regionDong: base?.regionDong || '',
    latitude: base?.latitude ?? row?.latitude ?? null,
    longitude: base?.longitude ?? row?.longitude ?? null,
    sourceUrl: base?.sourceUrl || row?.source_url || '',
    globalId: base?.globalId || row?.global_id || '',
    submitterType: base?.submitterType || row?.submitter_type || '',
    brokerOfficeName: base?.brokerOfficeName || row?.broker_office_name || '',
    isDirectSubmission: !!base?.isDirectSubmission,
    raw: row?.raw && typeof row.raw === 'object' ? row.raw : (base?.raw || {}),
  };
}

function matchesMapFilters(row, { source = 'all', status = '', q = '' } = {}) {
  const bucket = String(row?.sourceBucket || row?.source || 'general').trim() || 'general';
  const sourceKey = String(source || 'all').trim() || 'all';
  if (sourceKey !== 'all') {
    if (sourceKey === 'realtor') {
      if (!(bucket === 'realtor_naver' || bucket === 'realtor_direct')) return false;
    } else if (bucket !== sourceKey) {
      return false;
    }
  }

  if (status) {
    if (String(row?.status || '').trim() !== String(status).trim()) return false;
  }

  const keyword = String(q || '').trim().toLowerCase();
  if (keyword) {
    const hay = [
      row?.address, row?.itemNo, row?.type, row?.opinion, row?.rightsAnalysis, row?.siteInspection,
      row?.brokerOfficeName, row?.submitterType, row?.sourceBucket, row?.source,
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    if (!hay.includes(keyword)) return false;
  }

  return true;
}

async function buildSupabaseMapResponse({ source = 'all', status = '', q = '', offset = 0, limit = 300, markerLimit = 1200, pageSize = 4000 } = {}) {
  let from = 0;
  let activeSelect = MAP_SCAN_SELECT;
  const removed = new Set();
  const summary = { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
  const items = [];
  const markers = [];

  while (true) {
    let data;
    try {
      data = await supabaseRest(`/rest/v1/properties?select=${encodeURIComponent(activeSelect)}&order=date_uploaded.desc.nullslast,id.desc&offset=${from}&limit=${pageSize}`);
    } catch (err) {
      const missing = extractMissingColumn(err);
      if (missing && !removed.has(missing)) {
        const nextSelect = removeMissingColumnFromSelect(activeSelect, missing);
        if (nextSelect && nextSelect !== activeSelect) {
          removed.add(missing);
          activeSelect = nextSelect;
          from = 0;
          items.length = 0;
          markers.length = 0;
          summary.total = 0; summary.auction = 0; summary.onbid = 0; summary.realtor_naver = 0; summary.realtor_direct = 0; summary.general = 0;
          continue;
        }
      }
      throw err;
    }
    const batch = Array.isArray(data) ? data : [];
    for (const row of batch) {
      const normalized = buildMapRow(row);
      if (!matchesMapFilters(normalized, { source, status, q })) continue;
      summary.total += 1;
      if (Object.prototype.hasOwnProperty.call(summary, normalized.sourceBucket)) summary[normalized.sourceBucket] += 1;
      const seen = summary.total - 1;
      if (seen >= Number(offset || 0) && items.length < Number(limit || 300)) items.push(normalized);
      if (markers.length < Number(markerLimit || 1200) && Number.isFinite(Number(normalized.latitude)) && Number.isFinite(Number(normalized.longitude))) {
        markers.push({
          id: normalized.id,
          address: normalized.address,
          type: normalized.type,
          latitude: Number(normalized.latitude),
          longitude: Number(normalized.longitude),
          sourceBucket: normalized.sourceBucket,
          source: normalized.source,
        });
      }
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return { summary, total: summary.total, items, markers };
}

function buildStoreMapResponse(rows, options = {}) {
  const summary = { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
  const items = [];
  const markers = [];
  const offset = Number(options.offset || 0);
  const limit = Number(options.limit || 300);
  const markerLimit = Number(options.markerLimit || 1200);
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = buildMapRow(row);
    if (!matchesMapFilters(normalized, options)) continue;
    summary.total += 1;
    if (Object.prototype.hasOwnProperty.call(summary, normalized.sourceBucket)) summary[normalized.sourceBucket] += 1;
    const seen = summary.total - 1;
    if (seen >= offset && items.length < limit) items.push(normalized);
    if (markers.length < markerLimit && Number.isFinite(Number(normalized.latitude)) && Number.isFinite(Number(normalized.longitude))) {
      markers.push({ id: normalized.id, address: normalized.address, type: normalized.type, latitude: Number(normalized.latitude), longitude: Number(normalized.longitude), sourceBucket: normalized.sourceBucket, source: normalized.source });
    }
  }
  return { summary, total: summary.total, items, markers };
}

function buildSupabasePropertyPatch(body = {}) {
  return omitUndefined({
    item_no: body.item_no ?? body.itemNo,
    source_type: body.source_type ?? body.sourceType,
    assignee_id: body.assignee_id ?? body.assigneeId,
    submitter_type: body.submitter_type ?? body.submitterType,
    address: body.address,
    asset_type: body.asset_type ?? body.assetType,
    floor: body.floor,
    total_floor: body.total_floor ?? body.totalfloor,
    common_area: body.common_area ?? body.commonarea,
    exclusive_area: body.exclusive_area ?? body.exclusivearea,
    site_area: body.site_area ?? body.sitearea,
    use_approval: body.use_approval ?? body.useapproval,
    status: body.status,
    price_main: body.price_main ?? body.priceMain,
    lowprice: body.lowprice,
    date_main: body.date_main ?? body.dateMain,
    source_url: body.source_url ?? body.sourceUrl,
    broker_office_name: body.broker_office_name ?? body.realtorname,
    submitter_phone: body.submitter_phone ?? body.realtorcell,
    memo: body.memo ?? body.opinion,
    latitude: body.latitude,
    longitude: body.longitude,
    raw: body.raw,
  });
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  let session = null;
  if (hasSupabaseAdminEnv()) {
    session = await requireSupabaseAdmin(req, res);
  } else {
    session = requireAdmin(req, res);
  }
  if (!session) return;

  const store = getStore();

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const mode = String(url.searchParams.get('mode') || '').trim().toLowerCase();
    if (mode === 'map') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const source = String(url.searchParams.get('source') || 'all').trim().toLowerCase();
      const status = String(url.searchParams.get('status') || '').trim();
      const q = String(url.searchParams.get('q') || '').trim();
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 300);
      const markerLimit = Number(url.searchParams.get('markerLimit') || 1200);
      try {
        if (hasSupabaseAdminEnv()) {
          const payload = await buildSupabaseMapResponse({ source, status, q, offset, limit, markerLimit });
          return send(res, 200, { ok: true, ...payload });
        }
        return send(res, 200, { ok: true, ...buildStoreMapResponse(store.properties, { source, status, q, offset, limit, markerLimit }) });
      } catch (err) {
        return send(res, err?.status || 500, {
          ok: false,
          message: err?.message || '지도 데이터를 불러오지 못했습니다.',
          details: err?.data || null,
        });
      }
    }
    if (mode === 'overview') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      try {
        if (hasSupabaseAdminEnv()) {
          const overview = await buildOverviewFastFromSupabase();
          return send(res, 200, { ok: true, overview });
        }
        const fallbackRows = Array.isArray(store.properties) ? store.properties : [];
        if (!fallbackRows.length) {
          return send(res, 503, { ok: false, message: '집계용 서버 환경이 준비되지 않았습니다.' });
        }
        return send(res, 200, { ok: true, overview: buildOverviewFromRows(fallbackRows) });
      } catch (err) {
        return send(res, err?.status || 500, {
          ok: false,
          message: err?.message || '집계 데이터를 불러오지 못했습니다.',
          details: err?.data || null,
        });
      }
    }
    const source = (url.searchParams.get('source') || 'all').toLowerCase();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    let items = [...store.properties];
    if (source !== 'all') items = items.filter(v => v.source === source);
    if (q) items = items.filter(v => JSON.stringify(v).toLowerCase().includes(q));
    return send(res, 200, { ok: true, items, total: items.length });
  }

  if (req.method === 'POST') {
    const body = getJsonBody(req);
    const address = String(body.address || '').trim();
    const source = String(body.source || 'general').trim().toLowerCase();
    const price = Number(body.price || 0);
    if (!address || !['auction', 'onbid', 'realtor', 'general'].includes(source)) {
      return send(res, 400, { ok: false, message: 'address, source 값이 올바르지 않습니다.' });
    }

    const normalizedAddress = normalizeAddress(address);
    if (store.properties.some(p => p.normalizedAddress === normalizedAddress)) {
      return send(res, 409, { ok: false, message: '동일 주소 물건이 이미 등록되어 있습니다.' });
    }

    const geo = extractGuDong(address);
    const item = {
      id: id('prop'),
      source,
      address,
      normalizedAddress,
      price,
      region: String(body.region || '').trim(),
      district: String(body.district || geo.gu || '').trim(),
      dong: String(body.dong || geo.dong || '').trim(),
      ownerName: String(body.ownerName || '').trim(),
      phone: normalizePhone(body.phone || ''),
      assigneeId: body.assigneeId || null,
      assigneeName: String(body.assigneeName || '').trim(),
      status: normalizeStatus(body.status),
      createdByType: 'admin',
      createdByName: session.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      note: String(body.note || '').trim(),
    };
    store.properties.unshift(item);
    return send(res, 201, { ok: true, item });
  }

  if (req.method === 'PATCH') {
    if (hasSupabaseAdminEnv()) {
      const body = getJsonBody(req);
      const targetId = String(body.id || body.globalId || '').trim();
      if (!targetId) return send(res, 400, { ok: false, message: '물건 식별자(id)가 필요합니다.' });

      const patch = buildSupabasePropertyPatch(body);
      const col = targetId.includes(':') ? 'global_id' : 'id';
      const rows = await supabaseRest(`/rest/v1/properties?${col}=eq.${encodeURIComponent(targetId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        json: patch,
      });
      const item = Array.isArray(rows) ? rows[0] : rows;
      if (!item) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });
      return send(res, 200, { ok: true, item });
    }
    const body = getJsonBody(req);
    const targetId = String(body.id || '').trim();
    const item = store.properties.find(p => p.id === targetId);
    if (!item) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });

    if (body.address && normalizeAddress(body.address) !== item.normalizedAddress) {
      const nextNorm = normalizeAddress(body.address);
      const dup = store.properties.some(p => p.id !== item.id && p.normalizedAddress === nextNorm);
      if (dup) return send(res, 409, { ok: false, message: '동일 주소 물건이 이미 등록되어 있습니다.' });
      item.address = String(body.address).trim();
      item.normalizedAddress = nextNorm;
      const geo = extractGuDong(item.address);
      if (!body.district && geo.gu) item.district = geo.gu;
      if (!body.dong && geo.dong) item.dong = geo.dong;
    }
    if (body.price != null) item.price = Number(body.price || 0);
    if (body.region != null) item.region = String(body.region || '').trim();
    if (body.district != null) item.district = String(body.district || '').trim();
    if (body.dong != null) item.dong = String(body.dong || '').trim();
    if (body.ownerName != null) item.ownerName = String(body.ownerName || '').trim();
    if (body.phone != null) item.phone = normalizePhone(body.phone);
    if (body.assigneeId !== undefined) item.assigneeId = body.assigneeId || null;
    if (body.assigneeName !== undefined) item.assigneeName = String(body.assigneeName || '').trim();
    if (body.status != null) item.status = normalizeStatus(body.status);
    if (body.note != null) item.note = String(body.note || '').trim();
    item.updatedAt = nowIso();

    return send(res, 200, { ok: true, item });
  }

  if (req.method === 'DELETE') {
    const body = getJsonBody(req);
    const deleteAll = !!body.all;

    if (deleteAll) {
      if (hasSupabaseAdminEnv()) {
        await supabaseRest('/rest/v1/properties?id=not.is.null', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        return send(res, 200, { ok: true, removedAll: true });
      }
      const removedCount = store.properties.length;
      store.properties = [];
      return send(res, 200, { ok: true, removedAll: true, removedCount });
    }

    const ids = Array.isArray(body.ids) ? body.ids.map(v => String(v || '').trim()).filter(Boolean) : [];
    if (ids.length) {
      if (hasSupabaseAdminEnv()) {
        const pureIds = ids.filter((v) => !String(v).includes(':'));
        const globalIds = ids.filter((v) => String(v).includes(':'));
        if (pureIds.length) {
          await supabaseRest(`/rest/v1/properties?id=in.(${pureIds.map(encodeURIComponent).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        }
        if (globalIds.length) {
          await supabaseRest(`/rest/v1/properties?global_id=in.(${globalIds.map(encodeURIComponent).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        }
        return send(res, 200, { ok: true, removedCount: ids.length, removedIds: ids });
      }
      const before = store.properties.length;
      store.properties = store.properties.filter((p) => !ids.includes(String(p.id || '')));
      const removedCount = before - store.properties.length;
      return send(res, 200, { ok: true, removedCount, removedIds: ids });
    }

    const targetId = String(body.id || '').trim();
    if (hasSupabaseAdminEnv()) {
      if (!targetId) return send(res, 400, { ok: false, message: '물건 식별자(id)가 필요합니다.' });
      const col = targetId.includes(':') ? 'global_id' : 'id';
      await supabaseRest(`/rest/v1/properties?${col}=eq.${encodeURIComponent(targetId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return send(res, 200, { ok: true, removedId: targetId });
    }
    const idx = store.properties.findIndex(p => p.id === targetId);
    if (idx < 0) return send(res, 404, { ok: false, message: '물건을 찾을 수 없습니다.' });
    const removed = store.properties.splice(idx, 1)[0];
    return send(res, 200, { ok: true, removedId: removed.id });
  }

  return send(res, 405, { ok: false, message: 'Method Not Allowed' });
};
