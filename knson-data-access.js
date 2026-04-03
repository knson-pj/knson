(() => {
  "use strict";

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;

  const PROPERTY_LIST_SELECT = [
    "id", "global_id", "item_no", "source_type", "source_url", "is_general", "address", "assignee_id",
    "submitter_type", "broker_office_name", "submitter_name", "submitter_phone",
    "asset_type", "floor", "total_floor", "common_area", "exclusive_area", "site_area", "use_approval",
    "status", "price_main", "lowprice", "date_main", "rights_analysis", "site_inspection",
    "memo", "latitude", "longitude", "date_uploaded", "created_at", "raw",
    "geocode_status", "geocoded_at"
  ].join(",");

  const PROPERTY_HOME_SUMMARY_SELECT = [
    "id", "source_type", "source_url", "is_general", "submitter_type", "submitter_name",
    "broker_office_name", "address", "latitude", "longitude", "geocode_status",
    "exclusive_area", "date_uploaded", "created_at"
  ].join(",");

  const EFFECTIVE_SELECT_CACHE = new Map();
  const EFFECTIVE_ORDER_CACHE = new Map();

  function getSelectCacheKey(select) {
    return String(select || '').trim();
  }

  function getEffectiveSelect(select) {
    const key = getSelectCacheKey(select);
    return key ? (EFFECTIVE_SELECT_CACHE.get(key) || key) : '';
  }

  function rememberEffectiveSelect(requestedSelect, effectiveSelect) {
    const requested = getSelectCacheKey(requestedSelect);
    if (!requested) return;
    const effective = getSelectCacheKey(effectiveSelect) || requested;
    EFFECTIVE_SELECT_CACHE.set(requested, effective);
  }

  function getOrderCacheKey(orderColumn) {
    return String(orderColumn || '').trim();
  }

  function buildOrderCandidates(orderColumn) {
    const requested = getOrderCacheKey(orderColumn) || 'id';
    const cached = EFFECTIVE_ORDER_CACHE.get(requested);
    return [...new Set([cached, requested, 'date_uploaded', 'created_at', 'id'].filter(Boolean))];
  }

  function rememberEffectiveOrder(requestedOrder, effectiveOrder) {
    const requested = getOrderCacheKey(requestedOrder);
    const effective = getOrderCacheKey(effectiveOrder);
    if (!requested || !effective) return;
    EFFECTIVE_ORDER_CACHE.set(requested, effective);
  }

  async function runOrderedSelectQueryResilient(buildQuery, { select = '*', orderColumn = 'id', maxRetries = 8 } = {}) {
    const requestedSelect = getSelectCacheKey(select) || '*';
    const seededSelect = getEffectiveSelect(requestedSelect) || requestedSelect;
    let lastResult = null;
    for (const candidateOrder of buildOrderCandidates(orderColumn)) {
      const result = await runSelectQueryResilient((activeSelect) => buildQuery(activeSelect, candidateOrder), seededSelect, { maxRetries });
      if (!result?.error) {
        rememberEffectiveSelect(requestedSelect, result.__effectiveSelect || seededSelect);
        rememberEffectiveOrder(orderColumn, candidateOrder);
        if (candidateOrder !== orderColumn) result.__effectiveOrderColumn = candidateOrder;
        return result;
      }
      lastResult = result;
      const missing = extractSchemaMissingColumn(result.error);
      if (missing && missing === String(candidateOrder || '').trim()) continue;
      return result;
    }
    return lastResult;
  }

  function chunkArray(arr, size) {
    if (K && typeof K.chunk === "function") return K.chunk(arr, size);
    const out = [];
    const safe = Math.max(1, Number(size || 1));
    for (let i = 0; i < (Array.isArray(arr) ? arr.length : 0); i += safe) out.push(arr.slice(i, i + safe));
    return out;
  }

  function toNumber(value) {
    if (Shared && typeof Shared.toNumber === "function") return Shared.toNumber(value);
    if (K && typeof K.toNumber === "function") return K.toNumber(value);
    if (value === null || value === undefined) return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    const text = String(value).trim();
    if (!text) return NaN;
    const n = Number(text.replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }

  function extractSchemaMissingColumn(err) {
    const text = [err?.message, err?.details, err?.hint].filter(Boolean).join(' ').trim();
    const m = text.match(/column\s+properties\.([a-zA-Z0-9_]+)\s+does not exist/i)
      || text.match(/column\s+([a-zA-Z0-9_]+)\s+does not exist/i)
      || text.match(/Could not find the '([a-zA-Z0-9_]+)' column of 'properties'/i)
      || text.match(/schema cache.*?column.*?'([a-zA-Z0-9_]+)'/i);
    return m ? String(m[1] || "").trim() : "";
  }

  function omitKeys(obj, keys) {
    const blocked = new Set(Array.isArray(keys) ? keys.filter(Boolean) : []);
    return Object.fromEntries(Object.entries(obj || {}).filter(([key]) => !blocked.has(key)));
  }
  function splitSelectColumns(select) {
    return String(select || "")
      .split(',')
      .map((part) => String(part || '').trim())
      .filter(Boolean);
  }

  function joinSelectColumns(columns) {
    return (Array.isArray(columns) ? columns : []).map((part) => String(part || '').trim()).filter(Boolean).join(',');
  }

  function removeMissingColumnFromSelect(select, missingColumn) {
    const target = String(missingColumn || '').trim();
    if (!target) return String(select || '');
    const filtered = splitSelectColumns(select).filter((part) => {
      const base = String(part || '').split(':').pop().split('->')[0].split('(')[0].trim();
      return base !== target;
    });
    return joinSelectColumns(filtered);
  }

  async function runSelectQueryResilient(buildQuery, select, { maxRetries = 8 } = {}) {
    let currentSelect = String(select || '').trim();
    const removed = new Set();
    for (let i = 0; i < maxRetries; i += 1) {
      const result = await buildQuery(currentSelect);
      if (!result?.error) {
        if (currentSelect && currentSelect !== select) result.__effectiveSelect = currentSelect;
        return result;
      }
      const missing = extractSchemaMissingColumn(result.error);
      if (!missing || removed.has(missing) || !currentSelect) return result;
      const nextSelect = removeMissingColumnFromSelect(currentSelect, missing);
      if (!nextSelect || nextSelect === currentSelect) return result;
      removed.add(missing);
      currentSelect = nextSelect;
    }
    return buildQuery(String(select || '').trim());
  }

  function normalizeDuplicateError(err) {
    if (PropertyDomain && typeof PropertyDomain.normalizePropertyDuplicateError === "function") {
      return PropertyDomain.normalizePropertyDuplicateError(err);
    }
    return err;
  }

  function resolvePropertyIdColumn(targetId) {
    return String(targetId || "").includes(":") ? "global_id" : "id";
  }

  function rowAssignedToUid(row, uid) {
    const target = String(uid || "").trim();
    if (!target) return false;
    const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
    return [
      row?.assignee_id,
      row?.assigneeId,
      row?.assignedAgentId,
      row?.assigned_agent_id,
      raw.assignee_id,
      raw.assigneeId,
      raw.assignedAgentId,
      raw.assigned_agent_id,
    ].some((v) => String(v || "").trim() === target);
  }

  function buildAssignedFilters(uid) {
    const target = String(uid || "").trim();
    if (!target) return [];
    return [
      `assignee_id.eq.${target},raw->>assigneeId.eq.${target},raw->>assignedAgentId.eq.${target},raw->>assignee_id.eq.${target},raw->>assigned_agent_id.eq.${target}`,
      `assignee_id.eq.${target}`,
    ];
  }


  function escapeLikeValue(value) {
    return String(value || '').replace(/[%,]/g, ' ').trim();
  }

  function applyServerBackedPropertyFilters(query, filters = {}) {
    let q = query;
    const activeCard = String(filters?.activeCard || '').trim();
    const status = String(filters?.status || '').trim();

    if (activeCard === 'auction' || activeCard === 'onbid' || activeCard === 'general') {
      q = q.eq('source_type', activeCard);
    } else if (activeCard === 'realtor_naver') {
      q = q.eq('source_type', 'realtor').not('source_url', 'is', null);
    } else if (activeCard === 'realtor_direct') {
      q = q.eq('source_type', 'realtor').is('source_url', null);
    }

    if (status) {
      q = q.ilike('status', `%${escapeLikeValue(status)}%`);
    }

    return q;
  }

  async function runAssignedQuery(queryBase, uid, { clientSideFilter = true } = {}) {
    const filters = buildAssignedFilters(uid);
    let lastError = null;
    for (const filter of filters) {
      const { data, error, count } = await queryBase(filter);
      if (!error) {
        const rows = Array.isArray(data) ? data : [];
        return {
          data: clientSideFilter ? rows.filter((row) => rowAssignedToUid(row, uid)) : rows,
          count,
          error: null,
        };
      }
      lastError = error;
    }
    throw lastError;
  }

  async function fetchPropertiesBatch(sb, from, pageSize, { isAdmin, uid, select = "*", orderColumn = "date_uploaded", ascending = false, clientSideFilter = true, filters = null } = {}) {
    const safeFrom = Math.max(0, Number(from || 0));
    const safePageSize = Math.max(1, Number(pageSize || 1));
    const to = safeFrom + safePageSize - 1;
    const queryBase = (filter, activeSelect = select, activeOrderColumn = orderColumn) => {
      let q = sb.from("properties").select(activeSelect).order(activeOrderColumn, { ascending }).order("id", { ascending }).range(safeFrom, to);
      q = applyServerBackedPropertyFilters(q, filters);
      if (filter) q = q.or(filter);
      return q;
    };
    if (isAdmin) {
      const { data, error } = await runOrderedSelectQueryResilient((activeSelect, activeOrderColumn) => queryBase(null, activeSelect, activeOrderColumn), { select, orderColumn });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }
    const result = await runAssignedQuery((filter) => runOrderedSelectQueryResilient((activeSelect, activeOrderColumn) => queryBase(filter, activeSelect, activeOrderColumn), { select, orderColumn }), uid, { clientSideFilter });
    return result.data;
  }

  async function fetchPropertiesPageLight(sb, page, pageSize, { isAdmin, uid, select = PROPERTY_LIST_SELECT, totalFallback = 0, filters = null } = {}) {
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.max(1, Number(pageSize || 30));
    const from = Math.max(0, (safePage - 1) * safePageSize);
    const to = from + safePageSize;
    const hasServerFilters = !!(String(filters?.activeCard || '').trim() || String(filters?.status || '').trim());
    const selectOptions = (from === 0 || hasServerFilters) ? { count: "estimated" } : undefined;
    const queryBase = (filter, activeSelect = select, activeOrderColumn = "date_uploaded") => {
      let q = sb.from("properties");
      q = selectOptions ? q.select(activeSelect, selectOptions) : q.select(activeSelect);
      q = q.order(activeOrderColumn, { ascending: false }).order("id", { ascending: false }).range(from, to);
      q = applyServerBackedPropertyFilters(q, filters);
      if (filter) q = q.or(filter);
      return q;
    };
    const finalize = (rows, count) => {
      const list = Array.isArray(rows) ? rows : [];
      const hasMore = list.length > safePageSize;
      const items = hasMore ? list.slice(0, safePageSize) : list;
      const numericCount = Number(count || 0);
      const total = numericCount || Number(totalFallback || 0) || (hasMore ? (from + safePageSize + 1) : (from + items.length));
      return { items, total, hasMore, totalIsEstimated: !numericCount };
    };
    if (isAdmin) {
      const { data, error, count } = await runOrderedSelectQueryResilient((activeSelect, activeOrderColumn) => queryBase(null, activeSelect, activeOrderColumn), { select, orderColumn: "date_uploaded" });
      if (error) throw error;
      return finalize(data, count);
    }
    const result = await runAssignedQuery((filter) => runOrderedSelectQueryResilient((activeSelect, activeOrderColumn) => queryBase(filter, activeSelect, activeOrderColumn), { select, orderColumn: "date_uploaded" }), uid, { clientSideFilter: true });
    return finalize(result.data, result.count);
  }

  async function fetchAllProperties(sb, { isAdmin, uid, select = PROPERTY_LIST_SELECT, pageSize = 1000, filters = null } = {}) {
    const out = [];
    let from = 0;
    const safePageSize = Math.max(1, Number(pageSize || 1000));
    while (true) {
      const rows = await fetchPropertiesBatch(sb, from, safePageSize, { isAdmin, uid, select, orderColumn: "date_uploaded", ascending: false, clientSideFilter: true, filters });
      out.push(...rows);
      if (rows.length < safePageSize) break;
      from += safePageSize;
    }
    return out;
  }

  function buildPropertySummaryFromRows(rows, normalizeRow) {
    const list = (Array.isArray(rows) ? rows : [])
      .map((row) => (typeof normalizeRow === "function" ? normalizeRow(row) : row))
      .filter(Boolean);
    if (PropertyDomain && typeof PropertyDomain.summarizeSourceBuckets === "function") {
      return PropertyDomain.summarizeSourceBuckets(list);
    }
    const summary = { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    list.forEach((item) => {
      summary.total += 1;
      const type = String(item?.sourceType || item?.source_type || item?.source || "").trim();
      if (type === "auction") summary.auction += 1;
      else if (type === "onbid") summary.onbid += 1;
      else if (type === "realtor") {
        if (item?.isDirectSubmission) summary.realtor_direct += 1;
        else summary.realtor_naver += 1;
      } else if (type === "general") summary.general += 1;
    });
    return summary;
  }


  function createEmptyOverview() {
    return {
      summary: { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 },
      today: { total: 0, auction: 0, onbid: 0, realtor: 0, realtor_naver: 0, realtor_direct: 0, general: 0 },
      geoPending: 0,
      filterCounts: { source: { '': 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 } },
      generatedAt: new Date().toISOString(),
    };
  }

  function encodeQueryParams(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      search.set(key, String(value));
    });
    return search.toString();
  }

  async function fetchScopedPropertiesViaApi(api, { scope = 'mine', auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api(`/properties?${encodeQueryParams({ scope })}`, { auth });
  }

  async function fetchDailyReportViaApi(api, { dateKey, actorId = '', adminView = false, auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api(`/properties?${encodeQueryParams({ daily_report: 1, date: dateKey, actor_id: actorId, admin_view: adminView ? 1 : '' })}`, { auth });
  }

  async function createPropertyViaApi(api, row, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/properties', { method: 'POST', auth, body: { row } });
  }

  async function updatePropertyViaApi(api, targetId, patch, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/properties', { method: 'PATCH', auth, body: { targetId, patch } });
  }

  async function recordDailyReportEntriesViaApi(api, entries, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    const safeEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry && (entry.actionType || entry.action_type));
    if (!safeEntries.length) return { ok: true, items: [] };
    return api('/properties', { method: 'POST', auth, body: { action: 'daily_report_log', entries: safeEntries } });
  }

  async function deletePropertiesViaAdminApi(api, ids, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/admin/properties', { method: 'DELETE', auth, body: { ids: Array.isArray(ids) ? ids.filter(Boolean) : [] } });
  }

  async function deleteAllPropertiesViaAdminApi(api, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/admin/properties', { method: 'DELETE', auth, body: { all: true } });
  }

  async function deletePropertyViaAdminApi(api, targetId, { auth = true } = {}) {
    return deletePropertiesViaAdminApi(api, [targetId], { auth });
  }

  async function fetchAdminMapDataViaApi(api, params = {}, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    const query = encodeQueryParams(params);
    return api(`/admin/properties?${query}`, { auth });
  }

  async function fetchPropertyOverviewViaApi(api, { cacheBust = '', auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api(`/admin/properties?${encodeQueryParams({ mode: 'overview', _ts: cacheBust || Date.now() })}`, { auth });
  }

  async function fetchBrowserOverviewViaApi(sb, { normalizeRow = null, pageSize = 1000 } = {}) {
    if (!sb || typeof sb.from !== 'function') return null;
    const rows = await fetchAllProperties(sb, {
      isAdmin: true,
      uid: '',
      select: PROPERTY_HOME_SUMMARY_SELECT,
      pageSize,
      filters: null,
    });
    const list = (Array.isArray(rows) ? rows : []).map((row) => (typeof normalizeRow === 'function' ? normalizeRow(row) : row)).filter(Boolean);
    const summary = buildPropertySummaryFromRows(list, null);
    const overview = createEmptyOverview();
    overview.summary.total = Number(summary.total || 0);
    overview.summary.auction = Number(summary.auction || 0);
    overview.summary.onbid = Number(summary.onbid || 0);
    overview.summary.realtor_naver = Number(summary.realtor_naver || 0);
    overview.summary.realtor_direct = Number(summary.realtor_direct || 0);
    overview.summary.general = Number(summary.general || 0);
    overview.filterCounts.source[''] = overview.summary.total;
    overview.filterCounts.source.auction = overview.summary.auction;
    overview.filterCounts.source.onbid = overview.summary.onbid;
    overview.filterCounts.source.realtor_naver = overview.summary.realtor_naver;
    overview.filterCounts.source.realtor_direct = overview.summary.realtor_direct;
    overview.filterCounts.source.general = overview.summary.general;
    overview.source = 'browser_rows';
    return overview;
  }

  async function fetchAdminPropertyDetailViaApi(api, targetId, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api(`/admin/properties?${encodeQueryParams({ mode: 'detail', id: targetId })}`, { auth });
  }

  async function submitPublicListingViaApi(api, payload) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/public-listings', { method: 'POST', body: payload });
  }

  async function fetchAdminStaffViaApi(api, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/admin/staff', { auth });
  }

  async function fetchRegionAssignmentsViaApi(api, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/admin/region-assignments', { auth });
  }

  async function createAdminStaffViaApi(api, payload, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/admin/staff', { method: 'POST', auth, body: payload || {} });
  }

  async function updateAdminStaffViaApi(api, targetId, payload, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api(`/admin/staff?${encodeQueryParams({ id: targetId })}`, { method: 'PATCH', auth, body: { id: targetId, ...(payload || {}) } });
  }

  async function deleteAdminStaffViaApi(api, targetId, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api(`/admin/staff?${encodeQueryParams({ id: targetId })}`, { method: 'DELETE', auth, body: { id: targetId } });
  }

  async function saveRegionAssignmentsViaApi(api, assignments, { auth = true } = {}) {
    if (typeof api !== 'function') throw new Error('API 호출 함수를 찾을 수 없습니다.');
    return api('/admin/region-assignments', { method: 'POST', auth, body: { assignments: Array.isArray(assignments) ? assignments : [] } });
  }

  async function fetchPropertySummary(sb, { cachedRows = null, normalizeRow = null } = {}) {
    if (Array.isArray(cachedRows) && cachedRows.length) return buildPropertySummaryFromRows(cachedRows, normalizeRow);
    return fetchExactHomeSummary(sb, { normalizeRow, pageSize: 1000 });
  }

  async function fetchExactHomeSummary(sb, { normalizeRow = null, pageSize = 1000 } = {}) {
    const out = [];
    let from = 0;
    const safePageSize = Math.max(1, Number(pageSize || 1000));
    let activeSelect = PROPERTY_HOME_SUMMARY_SELECT;
    while (true) {
      const to = from + safePageSize - 1;
      const { data, error, __effectiveSelect } = await runOrderedSelectQueryResilient((selectText, activeOrderColumn) => sb.from("properties")
        .select(selectText)
        .order(activeOrderColumn, { ascending: false })
        .order("id", { ascending: false })
        .range(from, to), { select: activeSelect, orderColumn: "date_uploaded" });
      if (error) throw error;
      if (__effectiveSelect) activeSelect = __effectiveSelect;
      const rows = Array.isArray(data) ? data : [];
      out.push(...rows);
      if (rows.length < safePageSize) break;
      from += safePageSize;
    }
    return buildPropertySummaryFromRows(out, normalizeRow);
  }

  async function fetchPropertyDetail(sb, targetId, { select = "*", normalizeRow = null } = {}) {
    const col = resolvePropertyIdColumn(targetId);
    const { data, error } = await runSelectQueryResilient((activeSelect) => sb.from("properties").select(activeSelect).eq(col, targetId).limit(1).maybeSingle(), select);
    if (error) throw error;
    return data ? (typeof normalizeRow === "function" ? normalizeRow(data) : data) : null;
  }

  async function insertPropertyRowResilient(sb, row, { select = "id", maxRetries = 16 } = {}) {
    let current = { ...(row || {}) };
    const removed = new Set();
    for (let i = 0; i < maxRetries; i += 1) {
      const { data, error } = await sb.from("properties").insert(current).select(select).limit(1);
      if (!error) {
        if (Array.isArray(data) && data.length) return data[0];
        return null;
      }
      const missing = extractSchemaMissingColumn(error);
      if (!missing || removed.has(missing) || !(missing in current)) throw normalizeDuplicateError(error);
      removed.add(missing);
      current = omitKeys(current, [missing]);
    }
    throw new Error("properties insert failed after schema fallback retries");
  }

  async function updatePropertyRowResilient(sb, targetId, patch, { select = "id", maxRetries = 16, extraEq = null } = {}) {
    let current = { ...(patch || {}) };
    const removed = new Set();
    const col = resolvePropertyIdColumn(targetId);
    for (let i = 0; i < maxRetries; i += 1) {
      let q = sb.from("properties").update(current).eq(col, targetId);
      if (extraEq && typeof extraEq === "object") {
        Object.entries(extraEq).forEach(([key, value]) => {
          q = q.eq(key, value);
        });
      }
      const { data, error } = await q.select(select).limit(1);
      if (!error) {
        if (Array.isArray(data) && data.length) return data[0];
        throw Object.assign(new Error("NO_ROWS_UPDATED"), { code: "NO_ROWS_UPDATED" });
      }
      const missing = extractSchemaMissingColumn(error);
      if (!missing || removed.has(missing) || !(missing in current)) throw normalizeDuplicateError(error);
      removed.add(missing);
      current = omitKeys(current, [missing]);
    }
    throw new Error("properties update failed after schema fallback retries");
  }

  async function updatePropertyMemoRaw(sb, targetId, { memo, raw }) {
    const col = resolvePropertyIdColumn(targetId);
    const { error } = await sb.from("properties").update({ memo, raw }).eq(col, targetId);
    if (error) throw error;
    return true;
  }

  async function deletePropertiesByIds(sb, ids) {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    for (const chunk of chunkArray(list, 100)) {
      const pureIds = chunk.filter((v) => !String(v).includes(":"));
      const globalIds = chunk.filter((v) => String(v).includes(":"));
      if (pureIds.length) {
        const { error } = await sb.from("properties").delete().in("id", pureIds);
        if (error) throw error;
      }
      if (globalIds.length) {
        const { error } = await sb.from("properties").delete().in("global_id", globalIds);
        if (error) throw error;
      }
    }
    return true;
  }

  async function deletePropertyById(sb, targetId) {
    const col = resolvePropertyIdColumn(targetId);
    const { error } = await sb.from("properties").delete().eq(col, targetId);
    if (error) throw error;
    return true;
  }

  async function upsertPropertiesResilient(sb, rows, { chunkSize = 200, onConflict = "global_id" } = {}) {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const failed = [];
    let okCount = 0;

    async function upsertBatch(batch) {
      if (!batch.length) return;
      const { error } = await sb.from("properties").upsert(batch, { onConflict });
      if (!error) {
        okCount += batch.length;
        return;
      }
      if (batch.length === 1) {
        const row = batch[0] || {};
        failed.push({
          globalId: row.global_id || "",
          itemNo: row.item_no || "",
          message: String(error.message || error.details || error.hint || "업서트 실패"),
        });
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      await upsertBatch(batch.slice(0, mid));
      await upsertBatch(batch.slice(mid));
    }

    for (const chunk of chunkArray(list, chunkSize)) await upsertBatch(chunk);
    return { okCount, failed };
  }

  async function saveGeocodeResult(sb, propertyId, coords, status) {
    const basePatch = { geocode_status: status };
    if (coords && status === "ok") {
      basePatch.latitude = coords.lat;
      basePatch.longitude = coords.lng;
    }
    const col = resolvePropertyIdColumn(propertyId);
    const fullPatch = { ...basePatch, geocoded_at: new Date().toISOString() };
    const { error } = await sb.from("properties").update(fullPatch).eq(col, propertyId);
    if (!error) return true;
    if (String(error.message || "").includes("geocoded_at")) {
      const { error: retryErr } = await sb.from("properties").update(basePatch).eq(col, propertyId);
      if (retryErr) throw retryErr;
      return true;
    }
    throw error;
  }

  async function fetchGeocodeQueue(sb, { statusFilter = "pending", pageSize = 1000 } = {}) {
    const out = [];
    let from = 0;
    const safePageSize = Math.max(1, Number(pageSize || 1000));
    while (true) {
      const { data, error } = await sb.from("properties")
        .select("id,global_id,address,latitude,longitude,geocode_status")
        .eq("geocode_status", statusFilter)
        .not("address", "is", null)
        .order("date_uploaded", { ascending: false })
        .range(from, from + safePageSize - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      out.push(...rows);
      if (rows.length < safePageSize) break;
      from += safePageSize;
    }
    return out.filter((row) => String(row?.address || "").trim());
  }

  async function findExistingPropertyForRegistration(sb, payload, { limit = 500, normalizeRow = null } = {}) {
    const hint = PropertyDomain && typeof PropertyDomain.buildRegistrationSearchHint === "function"
      ? PropertyDomain.buildRegistrationSearchHint(payload)
      : null;
    const targetKey = String(hint?.targetKey || "").trim();
    if (!targetKey) return null;

    const candidateSets = [];
    const safeLimit = Math.max(20, Number(limit || 500));

    if (hint?.dongToken) {
      const { data, error } = await sb.from("properties")
        .select("*")
        .ilike("address", `%${hint.dongToken}%`)
        .order("date_uploaded", { ascending: false })
        .order("id", { ascending: false })
        .limit(safeLimit);
      if (!error && Array.isArray(data) && data.length) candidateSets.push(data);
    }

    const fallbackLimit = Math.min(Math.max(safeLimit, 300), 1000);
    const { data: fallbackRows, error: fallbackError } = await sb.from("properties")
      .select("*")
      .order("date_uploaded", { ascending: false })
      .order("id", { ascending: false })
      .limit(fallbackLimit);
    if (!fallbackError && Array.isArray(fallbackRows) && fallbackRows.length) candidateSets.push(fallbackRows);

    for (const rows of candidateSets) {
      const found = PropertyDomain && typeof PropertyDomain.findExistingPropertyByRegistrationKey === "function"
        ? PropertyDomain.findExistingPropertyByRegistrationKey(payload, rows, { normalizeRow })
        : null;
      if (found) return found;
    }
    return null;
  }

  window.KNSN_DATA_ACCESS = {
    __build: "20260403-adminfix2",
    PROPERTY_LIST_SELECT,
    PROPERTY_HOME_SUMMARY_SELECT,
    resolvePropertyIdColumn,
    rowAssignedToUid,
    buildAssignedFilters,
    fetchPropertiesBatch,
    fetchPropertiesPageLight,
    fetchAllProperties,
    fetchPropertySummary,
    fetchExactHomeSummary,
    fetchPropertyDetail,
    insertPropertyRowResilient,
    updatePropertyRowResilient,
    updatePropertyMemoRaw,
    deletePropertiesByIds,
    deletePropertyById,
    upsertPropertiesResilient,
    saveGeocodeResult,
    fetchGeocodeQueue,
    findExistingPropertyForRegistration,
    fetchScopedPropertiesViaApi,
    fetchDailyReportViaApi,
    createPropertyViaApi,
    updatePropertyViaApi,
    recordDailyReportEntriesViaApi,
    deletePropertiesViaAdminApi,
    deleteAllPropertiesViaAdminApi,
    deletePropertyViaAdminApi,
    fetchAdminMapDataViaApi,
    fetchPropertyOverviewViaApi,
    fetchBrowserOverviewViaApi,
    fetchAdminPropertyDetailViaApi,
    submitPublicListingViaApi,
    fetchAdminStaffViaApi,
    fetchRegionAssignmentsViaApi,
    createAdminStaffViaApi,
    updateAdminStaffViaApi,
    deleteAdminStaffViaApi,
    saveRegionAssignmentsViaApi,
  };
})();
