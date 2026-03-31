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
  'id', 'global_id', 'item_no', 'source_type', 'source_url', 'is_general', 'submitter_type', 'submitter_name', 'broker_office_name',
  'address', 'latitude', 'longitude', 'geocode_status', 'exclusive_area', 'date_uploaded', 'created_at'
].join(',');

const AREA_KEYS = ['', '0-5', '5-10', '10-20', '20-30', '30-50', '50-100', '100-'];

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
    if (mode === 'overview') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      try {
        if (hasSupabaseAdminEnv()) {
          const rows = await fetchSupabaseOverviewRows();
          return send(res, 200, { ok: true, overview: buildOverviewFromRows(rows) });
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
