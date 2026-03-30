(() => {
  "use strict";

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;

  const PROPERTY_LIST_SELECT = [
    "id", "global_id", "item_no", "source_type", "source_url", "is_general", "address", "assignee_id",
    "submitter_type", "broker_office_name", "submitter_name", "submitter_phone",
    "memo", "latitude", "longitude", "date_uploaded", "created_at",
    "geocode_status", "geocoded_at", "raw"
  ].join(",");

  const PROPERTY_HOME_SUMMARY_SELECT = [
    "id", "source_type", "source_url", "is_general", "submitter_type", "submitter_name",
    "broker_office_name", "date_uploaded", "created_at", "raw"
  ].join(",");

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
    const text = String(err?.message || err?.details || "").trim();
    const m = text.match(/column\s+properties\.([a-zA-Z0-9_]+)\s+does not exist/i)
      || text.match(/Could not find the '([a-zA-Z0-9_]+)' column of 'properties'/i);
    return m ? String(m[1] || "").trim() : "";
  }

  function omitKeys(obj, keys) {
    const blocked = new Set(Array.isArray(keys) ? keys.filter(Boolean) : []);
    return Object.fromEntries(Object.entries(obj || {}).filter(([key]) => !blocked.has(key)));
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

  async function fetchPropertiesBatch(sb, from, pageSize, { isAdmin, uid, select = "*", orderColumn = "date_uploaded", ascending = false, clientSideFilter = true } = {}) {
    const safeFrom = Math.max(0, Number(from || 0));
    const safePageSize = Math.max(1, Number(pageSize || 1));
    const to = safeFrom + safePageSize - 1;
    const queryBase = (filter) => {
      let q = sb.from("properties").select(select).order(orderColumn, { ascending }).order("id", { ascending }).range(safeFrom, to);
      if (filter) q = q.or(filter);
      return q;
    };
    if (isAdmin) {
      const { data, error } = await queryBase(null);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }
    const result = await runAssignedQuery(queryBase, uid, { clientSideFilter });
    return result.data;
  }

  async function fetchPropertiesPageLight(sb, page, pageSize, { isAdmin, uid, select = PROPERTY_LIST_SELECT, totalFallback = 0 } = {}) {
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.max(1, Number(pageSize || 30));
    const from = Math.max(0, (safePage - 1) * safePageSize);
    const to = from + safePageSize;
    const selectOptions = from === 0 ? { count: "estimated" } : undefined;
    const queryBase = (filter) => {
      let q = sb.from("properties");
      q = selectOptions ? q.select(select, selectOptions) : q.select(select);
      q = q.order("date_uploaded", { ascending: false }).order("id", { ascending: false }).range(from, to);
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
      const { data, error, count } = await queryBase(null);
      if (error) throw error;
      return finalize(data, count);
    }
    const result = await runAssignedQuery(queryBase, uid, { clientSideFilter: true });
    return finalize(result.data, result.count);
  }

  async function fetchAllProperties(sb, { isAdmin, uid, select = PROPERTY_LIST_SELECT, pageSize = 1000 } = {}) {
    const out = [];
    let from = 0;
    const safePageSize = Math.max(1, Number(pageSize || 1000));
    while (true) {
      const rows = await fetchPropertiesBatch(sb, from, safePageSize, { isAdmin, uid, select, orderColumn: "date_uploaded", ascending: false, clientSideFilter: true });
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

  async function fetchPropertySummary(sb, { cachedRows = null, normalizeRow = null } = {}) {
    if (Array.isArray(cachedRows) && cachedRows.length) return buildPropertySummaryFromRows(cachedRows, normalizeRow);
    return fetchExactHomeSummary(sb, { normalizeRow, pageSize: 1000 });
  }

  async function fetchExactHomeSummary(sb, { normalizeRow = null, pageSize = 1000 } = {}) {
    const out = [];
    let from = 0;
    const safePageSize = Math.max(1, Number(pageSize || 1000));
    while (true) {
      const to = from + safePageSize - 1;
      const { data, error } = await sb.from("properties")
        .select(PROPERTY_HOME_SUMMARY_SELECT)
        .order("date_uploaded", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      out.push(...rows);
      if (rows.length < safePageSize) break;
      from += safePageSize;
    }
    return buildPropertySummaryFromRows(out, normalizeRow);
  }

  async function fetchPropertyDetail(sb, targetId, { select = "*", normalizeRow = null } = {}) {
    const col = resolvePropertyIdColumn(targetId);
    const { data, error } = await sb.from("properties").select(select).eq(col, targetId).limit(1).maybeSingle();
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
    const address = String(payload?.address || payload?.raw?.address || "").trim();
    const dongToken = ((address.match(/([가-힣A-Za-z0-9]+동)/) || [null, ""])[1] || "").trim();
    let query = sb.from("properties").select("*").limit(limit);
    if (dongToken) query = query.ilike("address", `%${dongToken}%`);
    const { data, error } = await query;
    if (error) return null;
    const rows = Array.isArray(data) ? data : [];
    const targetKey = PropertyDomain && typeof PropertyDomain.buildRegistrationMatchKey === "function"
      ? PropertyDomain.buildRegistrationMatchKey(payload)
      : "";
    if (!targetKey) return null;
    for (const row of rows) {
      const normalized = typeof normalizeRow === "function" ? normalizeRow(row) : row;
      const matchTarget = normalized && typeof normalized === "object"
        ? (normalized.raw && typeof normalized.raw === "object" ? normalized : { ...normalized, raw: row?.raw && typeof row.raw === "object" ? row.raw : {} })
        : row;
      const key = PropertyDomain && typeof PropertyDomain.buildRegistrationMatchKey === "function"
        ? PropertyDomain.buildRegistrationMatchKey(matchTarget)
        : "";
      if (key && key === targetKey) return normalized || row;
    }
    return null;
  }

  window.KNSN_DATA_ACCESS = {
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
  };
})();
