const { applyCors } = require('../_lib/cors');
const { send } = require('../_lib/utils');
const { getStore } = require('../_lib/store');
const { requireAdmin } = require('../_lib/auth');
const { hasSupabaseAdminEnv, requireSupabaseAdmin, getEnv } = require('../_lib/supabase-admin');
const PropertyDomain = require('../../knson-property-domain.js');

const OVERVIEW_SELECT = [
  'id', 'global_id', 'item_no', 'source_type', 'source_url', 'is_general', 'submitter_type', 'submitter_name', 'broker_office_name',
  'address', 'latitude', 'longitude', 'geocode_status', 'exclusive_area', 'date_uploaded', 'created_at'
].join(',');

const AREA_KEYS = ['', '0-5', '5-10', '10-20', '20-30', '30-50', '50-100', '100-'];

function buildSupabaseHeaders(extra = {}) {
  const { serviceRoleKey } = getEnv();
  return {
    Accept: 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
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

async function supabaseRest(path) {
  const { url } = getEnv();
  const res = await fetch(`${url}${path}`, {
    method: 'GET',
    headers: buildSupabaseHeaders(),
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

async function fetchSupabaseOverviewRows(pageSize = 2000) {
  const rows = [];
  let from = 0;
  let activeSelect = OVERVIEW_SELECT;
  const removed = new Set();
  while (true) {
    const to = from + pageSize - 1;
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

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  let session = null;
  if (hasSupabaseAdminEnv()) session = await requireSupabaseAdmin(req, res);
  else session = requireAdmin(req, res);
  if (!session) return;

  if (req.method !== 'GET') {
    return send(res, 405, { ok: false, message: 'Method Not Allowed' });
  }

  try {
    if (hasSupabaseAdminEnv()) {
      const rows = await fetchSupabaseOverviewRows();
      return send(res, 200, { ok: true, overview: buildOverviewFromRows(rows) });
    }

    const store = getStore();
    const rows = Array.isArray(store?.properties) ? store.properties : [];
    return send(res, 200, { ok: true, overview: buildOverviewFromRows(rows) });
  } catch (err) {
    return send(res, err?.status || 500, {
      ok: false,
      message: err?.message || '집계 데이터를 불러오지 못했습니다.',
      details: err?.data || null,
    });
  }
};
