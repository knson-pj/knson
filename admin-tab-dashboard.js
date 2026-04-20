(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const localState = {
    activeActorId: 'all',
    activeGroupKey: '',
    dateKey: '',
    data: null,
    loading: false,
  };

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return {
      rt,
      state: rt.state || {},
      els: rt.els || {},
      api: rt.adminApi,
      utils: rt.utils || {},
    };
  }

  function esc(v) {
    const { utils } = ctx();
    if (typeof utils.escapeHtml === 'function') return utils.escapeHtml(v);
    return String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getTodayDateKey(baseDate) {
    const d = baseDate ? new Date(baseDate) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    // KST(UTC+9) 기준으로 환산 (서버와 동기화)
    const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
    const kst = new Date(kstMs);
    const yyyy = kst.getUTCFullYear();
    const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function parseDate(value) {
    const { utils } = ctx();
    if (typeof utils.parseFlexibleDate === 'function') return utils.parseFlexibleDate(value);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function sameDay(dateLike, dateKey) {
    const d = parseDate(dateLike);
    if (!d) return false;
    return getTodayDateKey(d) === dateKey;
  }

  function sourceLabel(sourceType) {
    const { utils } = ctx();
    if (typeof utils.sourceLabel === 'function') return utils.sourceLabel(sourceType);
    const map = { auction: '경매', onbid: '공매', realtor: '중개', general: '일반' };
    return map[String(sourceType || '').trim()] || '일반';
  }

  function sourceClass(sourceType) {
    const map = { auction: 'is-auction', onbid: 'is-onbid', realtor: 'is-realtor', general: 'is-general' };
    return map[String(sourceType || '').trim()] || 'is-general';
  }

  function normalizeRole(role) {
    const { utils } = ctx();
    if (typeof utils.normalizeRole === 'function') return utils.normalizeRole(role);
    return String(role || '').trim().toLowerCase();
  }

  function getAllProperties() {
    const { state } = ctx();
    return Array.isArray(state.propertiesFullCache) ? state.propertiesFullCache : [];
  }

  function getAssigneeIds(item) {
    const raw = item?._raw || {};
    return [
      item?.assignedAgentId,
      item?.assigneeId,
      item?.assignee_id,
      raw.assignee_id,
      raw.assigneeId,
      raw.assignedAgentId,
    ]
      .map((v) => String(v || '').trim())
      .filter(Boolean);
  }

  function getPropertyIdentityKey(item) {
    const raw = item?._raw || {};
    const inner = raw?.raw || {};
    return String(
      item?.registrationIdentityKey ||
      raw?.registrationIdentityKey ||
      inner?.registrationIdentityKey ||
      ''
    ).trim();
  }

  function getPropertyIndex() {
    const all = getAllProperties();
    if (localState.propertyIndex && localState.propertyIndex.source === all) return localState.propertyIndex;

    const { utils } = ctx();
    const byId = new Map();
    const byItemNo = new Map();
    const byIdentity = new Map();
    const addressBuckets = new Map();

    const remember = (map, key, item) => {
      const safeKey = String(key || '').trim();
      if (!safeKey || map.has(safeKey)) return;
      map.set(safeKey, item);
    };

    for (const item of Array.isArray(all) ? all : []) {
      const raw = item?._raw || {};
      remember(byId, item?.id, item);
      remember(byId, item?.globalId, item);
      remember(byId, raw?.id, item);
      remember(byId, raw?.global_id, item);
      remember(byItemNo, item?.itemNo, item);
      remember(byItemNo, raw?.item_no, item);
      remember(byIdentity, getPropertyIdentityKey(item), item);
      const rawAddress = String(item?.address || raw?.address || '').trim();
      if (rawAddress) {
        const normalized = typeof utils.normalizeAddress === 'function' ? utils.normalizeAddress(rawAddress) : rawAddress;
        const bucket = addressBuckets.get(normalized) || [];
        bucket.push(item);
        addressBuckets.set(normalized, bucket);
      }
    }

    const byAddressUnique = new Map();
    for (const [address, bucket] of addressBuckets.entries()) {
      if (bucket.length === 1) byAddressUnique.set(address, bucket[0]);
    }

    localState.propertyIndex = { source: all, byId, byItemNo, byIdentity, byAddressUnique };
    return localState.propertyIndex;
  }

  function getAssignedPropertyMap() {
    const buckets = new Map();
    for (const item of Array.isArray(getAllProperties()) ? getAllProperties() : []) {
      const key = getPropertyUniqueKey(item);
      for (const actorId of getAssigneeIds(item)) {
        if (!actorId) continue;
        const set = buckets.get(actorId) || new Set();
        if (key) set.add(key);
        buckets.set(actorId, set);
      }
    }
    return buckets;
  }

  function getRegisteredStaffIds() {
    const { state } = ctx();
    return new Set((Array.isArray(state.staff) ? state.staff : [])
      .filter((row) => normalizeRole(row?.role) === 'staff')
      .map((row) => String(row?.id || row?.user_id || row?.uid || '').trim())
      .filter(Boolean));
  }

  function getAllAssignedPropertyTotal() {
    const staffIds = getRegisteredStaffIds();
    const unique = new Set();
    for (const item of Array.isArray(getAllProperties()) ? getAllProperties() : []) {
      const ids = getAssigneeIds(item);
      if (!ids.length) continue;
      if (staffIds.size && !ids.some((id) => staffIds.has(id))) continue;
      const key = getPropertyUniqueKey(item);
      if (key) unique.add(key);
    }
    return unique.size;
  }

  function getRegisteredActors(items) {
    const { state } = ctx();
    const logBuckets = new Map();
    for (const actor of buildLogActorBuckets(items)) {
      logBuckets.set(actor.actorId, actor);
    }
    const assignedMap = getAssignedPropertyMap();
    const staffRows = Array.isArray(state.staff) ? state.staff : [];
    const staffActors = staffRows
      .filter((row) => normalizeRole(row?.role) === 'staff')
      .map((row) => {
        const actorId = String(row?.id || row?.user_id || row?.uid || '').trim();
        if (!actorId) return null;
        const bucket = logBuckets.get(actorId);
        const actorName = String(row?.name || bucket?.actorName || '미상').trim() || '미상';
        return {
          actorId,
          actorName,
          items: bucket?.items || [],
          propertyKeys: assignedMap.get(actorId) || new Set(),
          counts: bucket?.counts || { rights_analysis: 0, site_inspection: 0, daily_issue: 0, new_property: 0, property_update: 0 },
          propertyCount: (assignedMap.get(actorId) || new Set()).size,
        };
      })
      .filter(Boolean);
    for (const bucket of logBuckets.values()) {
      if (staffActors.some((actor) => actor.actorId === bucket.actorId)) continue;
      const assignedSet = assignedMap.get(bucket.actorId) || new Set();
      staffActors.push({
        actorId: bucket.actorId,
        actorName: bucket.actorName,
        items: bucket.items,
        propertyKeys: assignedSet,
        counts: bucket.counts,
        propertyCount: assignedSet.size || bucket.propertyKeys.size,
      });
    }
    return staffActors.sort((a, b) => a.actorName.localeCompare(b.actorName, 'ko'));
  }

  function actionLabel(actionType) {
    const map = {
      rights_analysis: '권리분석',
      site_inspection: '현장조사',
      daily_issue: '금일이슈',
      opinion: '담당자의견',
      new_property: '신규등록',
    };
    return map[String(actionType || '').trim()] || '기타';
  }

  function actionClass(actionType) {
    const map = {
      rights_analysis: 'is-rights',
      site_inspection: 'is-site',
      daily_issue: 'is-edit',
      opinion: 'is-opinion',
      new_property: 'is-new',
    };
    return map[String(actionType || '').trim()] || 'is-edit';
  }

  function formatTodayDetail(parts, usingFullData) {
    if (!parts.total) {
      return usingFullData
        ? '<span class="hs-muted">금일 신규 등록 물건이 없습니다.</span>'
        : '<span class="hs-muted">금일 신규 등록 물건이 없습니다. (현재 로딩 데이터 기준)</span>';
    }
    const bits = [];
    if (parts.auction) bits.push(`<span class="hs-auction">경매</span> ${Number(parts.auction).toLocaleString('ko-KR')}건`);
    if (parts.onbid) bits.push(`<span class="hs-onbid">공매</span> ${Number(parts.onbid).toLocaleString('ko-KR')}건`);
    if (parts.realtor_naver) bits.push(`<span class="hs-naver">네이버중개</span> ${Number(parts.realtor_naver).toLocaleString('ko-KR')}건`);
    if (parts.realtor_direct) bits.push(`<span class="hs-general">일반중개</span> ${Number(parts.realtor_direct).toLocaleString('ko-KR')}건`);
    if (parts.general) bits.push(`<span class="hs-general">일반</span> ${Number(parts.general).toLocaleString('ko-KR')}건`);
    const suffix = usingFullData ? '입니다.' : '입니다. (현재 로딩 데이터 기준)';
    return bits.join(', ') + ' ' + suffix;
  }

  mod.renderSummary = function renderSummary() {
    const { state, els, utils } = ctx();
    const props = typeof utils.getAuxiliaryPropertiesSnapshot === 'function' ? (utils.getAuxiliaryPropertiesSnapshot() || []) : (state.properties || []);
    const overview = state.propertyOverview && typeof state.propertyOverview === 'object' ? state.propertyOverview : null;
    const hasSnapshotRows = Array.isArray(props) && props.length > 0;
    const staff = Array.isArray(state.staff) ? state.staff : [];
    const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
    const summary = state.propertySummary || ((utils.PropertyDomain && typeof utils.PropertyDomain.summarizeSourceBuckets === 'function')
      ? utils.PropertyDomain.summarizeSourceBuckets(props)
      : {
          total: props.length,
          auction: props.filter((p) => p.sourceType === 'auction').length,
          onbid: props.filter((p) => p.sourceType === 'onbid').length,
          realtor_naver: props.filter((p) => p.sourceType === 'realtor' && !p.isDirectSubmission).length,
          realtor_direct: props.filter((p) => p.sourceType === 'realtor' && p.isDirectSubmission).length,
          general: props.filter((p) => p.sourceType === 'general').length,
        });
    const staffCount = staff.filter((s) => String(utils.normalizeRole ? utils.normalizeRole(s.role) : s.role) === 'staff').length;

    if (els.sumTotal) els.sumTotal.textContent = fmt(summary.total);
    if (els.sumAuction) els.sumAuction.textContent = fmt(summary.auction);
    if (els.sumGongmae) els.sumGongmae.textContent = fmt(summary.onbid);
    if (els.sumNaverRealtor) els.sumNaverRealtor.textContent = fmt(summary.realtor_naver);
    if (els.sumDirectRealtor) els.sumDirectRealtor.textContent = fmt(summary.realtor_direct);
    if (els.sumGeneral) els.sumGeneral.textContent = fmt(summary.general);
    if (els.sumAgents) els.sumAgents.textContent = fmt(staffCount);

    const totalForRatio = Math.max(Number(summary.total) || 0, 1);
    const setProgress = (el, value) => {
      if (!el) return;
      const ratio = Math.max(8, Math.min(100, Math.round(((Number(value) || 0) / totalForRatio) * 100)));
      el.style.width = `${ratio}%`;
    };
    setProgress(els.homeProgressAuction, summary.auction);
    setProgress(els.homeProgressOnbid, summary.onbid);
    setProgress(els.homeProgressNaver, summary.realtor_naver);
    setProgress(els.homeProgressDirect, summary.realtor_direct);
    setProgress(els.homeProgressGeneral, summary.general);

    const dateKey = getTodayDateKey();
    const todayParts = overview && !hasSnapshotRows
      ? {
          total: Number(overview?.today?.total || 0),
          auction: Number(overview?.today?.auction || 0),
          onbid: Number(overview?.today?.onbid || 0),
          realtor_naver: Number(overview?.today?.realtor_naver || 0),
          realtor_direct: Number(overview?.today?.realtor_direct || 0),
          general: Number(overview?.today?.general || 0),
        }
      : { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    let geoPending = overview && !hasSnapshotRows ? Number(overview?.geoPending || 0) : 0;
    // 디버그: 어느 경로로 진입했는지 표시
    try { console.log('[Dashboard 진입 경로]', { hasSnapshotRows, propsLength: (props||[]).length, hasOverview: !!overview, overviewToday: overview?.today, dateKey }); } catch {}
    if (hasSnapshotRows) {
      todayParts.total = 0;
      todayParts.auction = 0;
      todayParts.onbid = 0;
      todayParts.realtor_naver = 0;
      todayParts.realtor_direct = 0;
      todayParts.general = 0;
      geoPending = 0;
      // ── 디버그 진단: 진짜 createdAt 분포 확인 (콘솔에서 확인 가능) ──
      let dbg = { total: 0, hadCreatedAt: 0, parsedOk: 0, todayMatch: 0, sample: [] };
      for (const item of Array.isArray(props) ? props : []) {
        dbg.total += 1;
        // DB 의 created_at (실제 INSERT 시점) 을 최우선.
        // _raw 가 Supabase row 자체이므로 _raw.created_at 이 진짜 값.
        const rawCreatedAt = item?._raw?.created_at
                          || item?.createdAt
                          || item?._raw?.created_at_utc
                          || item?._raw?.raw?.firstRegisteredAt
                          || item?._raw?.raw?.createdAt
                          || item?._raw?.date_uploaded
                          || '';
        if (rawCreatedAt) dbg.hadCreatedAt += 1;
        if (parseDate(rawCreatedAt)) dbg.parsedOk += 1;
        if (dbg.sample.length < 3 && rawCreatedAt) dbg.sample.push({ id: item?.id, createdAt: rawCreatedAt, source: item?.sourceType });
        if (sameDay(rawCreatedAt, dateKey)) {
          dbg.todayMatch += 1;
          todayParts.total += 1;
          const sourceKey = String(item?.sourceType || '').trim();
          if (sourceKey === 'auction') todayParts.auction += 1;
          else if (sourceKey === 'onbid') todayParts.onbid += 1;
          else if (sourceKey === 'general') todayParts.general += 1;
          else if (sourceKey === 'realtor') {
            if (item?.isDirectSubmission || item?.is_direct_submission) todayParts.realtor_direct += 1;
            else todayParts.realtor_naver += 1;
          }
        }
        const status = String(item?.geocodeStatus || item?._raw?.geocode_status || '').trim().toLowerCase();
        const lat = item?.latitude ?? item?._raw?.latitude;
        const lng = item?.longitude ?? item?._raw?.longitude;
        const hasCoords = lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '';
        const address = String(item?.address || item?._raw?.address || '').trim();
        if (!hasCoords && address && status !== 'failed' && status !== 'ok') geoPending += 1;
      }
      // 콘솔에 진단 출력 (사용자가 F12 로 확인 가능)
      try { console.log('[Dashboard today 진단]', { dateKey, ...dbg, todayParts }); } catch {}
    }
    if (els.sumTodayTotal) els.sumTodayTotal.textContent = fmt(todayParts.total);
    if (els.sumTodayAuction) els.sumTodayAuction.textContent = fmt(todayParts.auction);
    if (els.sumTodayOnbid) els.sumTodayOnbid.textContent = fmt(todayParts.onbid);
    if (els.sumTodayRealtor) els.sumTodayRealtor.textContent = fmt(todayParts.realtor_naver);
    if (els.sumTodayDirect) els.sumTodayDirect.textContent = fmt(todayParts.realtor_direct);
    if (els.sumTodayGeneral) els.sumTodayGeneral.textContent = fmt(todayParts.general);
    if (els.homeGeoPending) els.homeGeoPending.textContent = fmt(geoPending);
    if (els.sumTodayDetail) {
      const usingFullData = Array.isArray(state.propertiesFullCache) || hasSnapshotRows;
      els.sumTodayDetail.innerHTML = formatTodayDetail(todayParts, usingFullData);
    }

    // 금주 낙찰/매각 카드: 비동기 로드 (결과 도착 시 DOM 직접 갱신)
    renderWeeklyAuctionCard();
  };

  let _weeklyAuctionLoading = false;
  let _weeklyAuctionFetchedAt = 0;
  async function renderWeeklyAuctionCard() {
    const { state, api } = ctx();
    const countEl = document.getElementById('homeWeeklyWinCount');
    const subEl = document.getElementById('homeWeeklyAvgRatio');
    const cardEl = document.getElementById('homeWeeklyAuctionCard');
    if (!countEl || !cardEl) return;
    // 30초 이내 재호출 방지 (대시보드 렌더가 자주 호출되므로 캐시)
    if (_weeklyAuctionLoading) return;
    if (Date.now() - _weeklyAuctionFetchedAt < 30000 && countEl.textContent !== '-') return;
    _weeklyAuctionLoading = true;
    try {
      const data = await api('/admin/properties?mode=weekly_auction_stats', { auth: true });
      if (!data?.ok) throw new Error(data?.message || '통계 실패');
      const c = data.counts || {};
      const winCount = Number(c['낙찰'] || 0) + Number(c['매각'] || 0);
      countEl.textContent = Number(winCount).toLocaleString('ko-KR');
      if (subEl) {
        if (data.avgRatio && winCount > 0) {
          subEl.textContent = `평균 ${data.avgRatio}%`;
        } else {
          subEl.textContent = '';
        }
      }
      // 카드에 주간 범위를 title 로 부착
      if (data.weekStart && data.weekEnd) {
        cardEl.title = `${data.weekStart} ~ ${data.weekEnd} 집계`;
      }
      _weeklyAuctionFetchedAt = Date.now();
    } catch (e) {
      console.warn('weekly auction stats load failed', e);
      countEl.textContent = '-';
      if (subEl) subEl.textContent = '';
    } finally {
      _weeklyAuctionLoading = false;
    }
  }

  // 카드 클릭 → 전체리스트로 이동 + 낙찰/매각 필터 힌트
  //   (별도 필터 UI 는 기존에 없으므로 구분별 공매/경매 + keyword '낙찰' 조합으로 유사 동작)
  function bindWeeklyAuctionCardClick() {
    const cardEl = document.getElementById('homeWeeklyAuctionCard');
    if (!cardEl || cardEl.dataset.bound === '1') return;
    cardEl.dataset.bound = '1';
    cardEl.style.cursor = 'pointer';
    cardEl.addEventListener('click', () => {
      try {
        // 관리자 탭 전환: tab-properties
        const runtime = window.KNSN_ADMIN_RUNTIME || {};
        if (typeof runtime.switchTab === 'function') {
          runtime.switchTab('properties');
        } else {
          const tabBtn = document.querySelector('[data-admin-tab="properties"]');
          if (tabBtn) tabBtn.click();
        }
      } catch (e) { console.warn('weekly card click nav failed', e); }
    });
  }

  // 대시보드 DOM 이 세팅된 후 한 번 바인딩
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindWeeklyAuctionCardClick);
    } else {
      setTimeout(bindWeeklyAuctionCardClick, 0);
    }
  }


  function pickPropertyKey(row) {
    return String(
      row?.property_id ||
      row?.property_identity_key ||
      row?.property_item_no ||
      row?.property_address ||
      row?.id ||
      ''
    ).trim();
  }

  function buildLogActorBuckets(items) {
    const buckets = new Map();
    for (const row of Array.isArray(items) ? items : []) {
      const actorId = String(row?.actor_id || '').trim() || 'unknown';
      const actorName = String(row?.actor_name || '미상').trim() || '미상';
      const existing = buckets.get(actorId) || {
        actorId,
        actorName,
        items: [],
        propertyKeys: new Set(),
        counts: { rights_analysis: 0, site_inspection: 0, daily_issue: 0, new_property: 0, property_update: 0 },
      };
      existing.items.push(row);
      const propertyKey = pickPropertyKey(row);
      if (propertyKey) existing.propertyKeys.add(propertyKey);
      const actionType = String(row?.action_type || '').trim();
      if (existing.counts[actionType] !== undefined) existing.counts[actionType] += 1;
      buckets.set(actorId, existing);
    }
    return [...buckets.values()]
      .map((actor) => ({
        ...actor,
        propertyCount: actor.propertyKeys.size,
      }))
      .sort((a, b) => a.actorName.localeCompare(b.actorName, 'ko'));
  }

  function findPropertyLike(row) {
    const { utils } = ctx();
    const index = getPropertyIndex();
    const propertyId = String(row?.property_id || '').trim();
    const identityKey = String(row?.property_identity_key || '').trim();
    const itemNo = String(row?.property_item_no || '').trim();
    const rawAddress = String(row?.property_address || '').trim();
    const normalizedAddress = rawAddress && typeof utils.normalizeAddress === 'function'
      ? utils.normalizeAddress(rawAddress)
      : rawAddress;
    if (propertyId && index.byId.has(propertyId)) return index.byId.get(propertyId) || null;
    if (identityKey && index.byIdentity.has(identityKey)) return index.byIdentity.get(identityKey) || null;
    if (itemNo && index.byItemNo.has(itemNo)) return index.byItemNo.get(itemNo) || null;
    if (normalizedAddress && index.byAddressUnique.has(normalizedAddress)) return index.byAddressUnique.get(normalizedAddress) || null;
    return null;
  }

  function groupWorkRows(items) {
    const groups = [];
    const map = new Map();
    for (const row of Array.isArray(items) ? items : []) {
      const actorId = String(row?.actor_id || '').trim() || 'unknown';
      const key = pickPropertyKey(row);
      if (!key) continue;
      const groupKey = `${actorId}::${key}`;
      let bucket = map.get(groupKey);
      if (!bucket) {
        const item = findPropertyLike(row);
        bucket = {
          groupKey,
          propertyKey: key,
          actorId,
          actorName: String(row?.actor_name || '미상').trim() || '미상',
          row,
          item,
          latestAt: String(row?.created_at || row?.action_date || '').trim(),
          rows: [],
          counts: { rights_analysis: 0, site_inspection: 0, daily_issue: 0, new_property: 0, property_update: 0 },
        };
        map.set(groupKey, bucket);
        groups.push(bucket);
      }
      bucket.rows.push(row);
      const actionType = String(row?.action_type || '').trim();
      if (bucket.counts[actionType] !== undefined) bucket.counts[actionType] += 1;
      const at = String(row?.created_at || row?.action_date || '').trim();
      if (at && (!bucket.latestAt || at > bucket.latestAt)) bucket.latestAt = at;
    }
    return groups.sort((a, b) => {
      if (a.actorName !== b.actorName) return a.actorName.localeCompare(b.actorName, 'ko');
      return String(b.latestAt || '').localeCompare(String(a.latestAt || ''));
    });
  }

  function formatFloorLabel(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/층$/.test(raw)) return raw;
    const numMatch = raw.match(/-?\d+/);
    if (numMatch) return `${numMatch[0]}층`;
    return raw;
  }

  function formatAreaLabel(value) {
    const { utils } = ctx();
    if (value == null || value === '') return '';
    const area = typeof utils.formatAreaPyeong === 'function' ? utils.formatAreaPyeong(value) : value;
    return area ? `${area}평` : '';
  }

  function buildPropertyTitle(group) {
    const item = group?.item;
    const row = group?.row || {};
    return String(item?.address || item?._raw?.address || row?.property_address || '-').trim();
  }

  function buildPropertySubMeta(group) {
    const item = group?.item || {};
    const row = group?.row || {};
    const raw = item?._raw || {};
    const parts = [];
    const assetType = String(item?.assetType || item?.assettype || raw?.asset_type || row?.property_asset_type || row?.asset_type || '').trim();
    const floor = formatFloorLabel(item?.floor || raw?.floor || row?.property_floor || '');
    const area = formatAreaLabel(item?.exclusivearea ?? item?.exclusive_area ?? item?.exclusiveArea ?? raw?.exclusivearea ?? raw?.exclusiveArea ?? row?.property_area);
    const itemNo = String(item?.itemNo || raw?.item_no || row?.property_item_no || '').trim();
    if (assetType) parts.push(assetType);
    if (floor) parts.push(floor);
    if (area) parts.push(area);
    if (itemNo) parts.push(itemNo);
    return parts.join(' · ');
  }

  function formatMoney(value) {
    const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(num) || num <= 0) return '-';
    if (num >= 100000000) return `${(num / 100000000).toFixed(2).replace(/\.00$/, '')}억원`;
    return `${num.toLocaleString('ko-KR')}원`;
  }

  function formatTime(value) {
    const d = parseDate(value);
    if (!d) return '-';
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  function actorInitial(name) {
    const s = String(name || '').trim();
    return s ? s.charAt(0) : '?';
  }

  function getSelectedActorItems(items) {
    const selectedActorId = localState.activeActorId || 'all';
    return selectedActorId === 'all'
      ? items
      : items.filter((row) => String(row?.actor_id || '').trim() === selectedActorId);
  }


  function isSelectedActorProperty(item, actorId = null) {
    const selectedActorId = actorId || localState.activeActorId || 'all';
    const candidateIds = getAssigneeIds(item);
    if (selectedActorId === 'all') return candidateIds.length > 0;
    return candidateIds.includes(selectedActorId);
  }

  function getAssignedProperties(actorId = null) {
    const all = getAllProperties();
    return (Array.isArray(all) ? all : []).filter((item) => isSelectedActorProperty(item, actorId));
  }

  function getPropertyUniqueKey(input) {
    const raw = input?._raw || {};
    return String(
      input?.globalId ||
      input?.id ||
      input?.itemNo ||
      raw?.global_id ||
      raw?.id ||
      raw?.item_no ||
      raw?.registrationIdentityKey ||
      input?.address ||
      ''
    ).trim();
  }

  function getTodayPublicSubmissionCount(dateKey, actorId = null) {
    const assigned = getAssignedProperties(actorId);
    const unique = new Set();
    for (const item of assigned) {
      const createdAt = item?.createdAt || item?._raw?.created_at || item?._raw?.date_uploaded || item?._raw?.createdAt || '';
      if (!sameDay(createdAt, dateKey)) continue;
      const isPublic = String(item?.sourceType || '').trim() === 'general' || !!item?.isDirectSubmission;
      if (!isPublic) continue;
      const key = getPropertyUniqueKey(item);
      if (key) unique.add(key);
    }
    return unique.size;
  }

  function getNewPropertyLogCount(items) {
    const unique = new Set();
    for (const row of Array.isArray(items) ? items : []) {
      if (String(row?.action_type || '').trim() !== 'new_property') continue;
      const key = pickPropertyKey(row);
      if (key) unique.add(key);
    }
    return unique.size;
  }

  function ensureSelections(items, actors, groups) {
    if (!actors.length) {
      localState.activeActorId = 'all';
      localState.activeGroupKey = '';
      return;
    }
    if (localState.activeActorId !== 'all' && !actors.some((actor) => actor.actorId === localState.activeActorId)) {
      localState.activeActorId = 'all';
    }
    if (!groups.length) {
      localState.activeGroupKey = '';
      return;
    }
    if (!localState.activeGroupKey || !groups.some((group) => group.groupKey === localState.activeGroupKey)) {
      localState.activeGroupKey = groups[0].groupKey;
    }
  }

  function renderActorCards(actors) {
    const container = document.getElementById('workMgmtActors');
    if (!container) return;
    const selected = localState.activeActorId || 'all';
    const totalUpdates = actors.reduce((sum, actor) => {
      const counts = actor.counts || {};
      return sum + Number(counts.rights_analysis || 0) + Number(counts.site_inspection || 0) + Number(counts.daily_issue || 0) + Number(counts.property_update || 0) + Number(counts.new_property || 0);
    }, 0);
    const totalAssigned = getAllAssignedPropertyTotal();
    const allCard = `
      <button type="button" class="workmgmt-actor-card ${selected === 'all' ? 'is-active' : 'is-dim'}" data-actor-id="all">
        <div class="workmgmt-actor-head">
          <span class="workmgmt-actor-avatar is-all">전체</span>
          <div>
            <p class="workmgmt-actor-name">전체 담당자</p>
            <p class="workmgmt-actor-sub">등록된 담당자 전체 보기</p>
          </div>
        </div>
        <div class="workmgmt-actor-chips">
          <span class="workmgmt-chip is-soft">${Number(totalAssigned).toLocaleString('ko-KR')} 배정 물건</span>
          <span class="workmgmt-chip is-brand">${Number(totalUpdates).toLocaleString('ko-KR')} 업데이트</span>
        </div>
      </button>`;
    container.innerHTML = allCard + actors.map((actor) => {
      const counts = actor.counts || {};
      const updateCount = Number(counts.rights_analysis || 0) + Number(counts.site_inspection || 0) + Number(counts.daily_issue || 0) + Number(counts.opinion || 0) + Number(counts.property_update || 0) + Number(counts.new_property || 0);
      const subText = (!actor.propertyCount && !actor.items.length) ? '금일 진행사항이 없습니다' : '담당자 업무 현황';
      return `
        <button type="button" class="workmgmt-actor-card ${selected === actor.actorId ? 'is-active' : 'is-dim'}" data-actor-id="${esc(actor.actorId)}">
          <div class="workmgmt-actor-head">
            <span class="workmgmt-actor-avatar">${esc(actorInitial(actor.actorName))}</span>
            <div>
              <p class="workmgmt-actor-name">${esc(actor.actorName)}</p>
              <p class="workmgmt-actor-sub">${esc(subText)}</p>
            </div>
          </div>
          <div class="workmgmt-actor-chips">
            <span class="workmgmt-chip is-soft">${Number(actor.propertyCount).toLocaleString('ko-KR')} 관리 물건</span>
            <span class="workmgmt-chip is-brand">${Number(updateCount).toLocaleString('ko-KR')} 업데이트</span>
          </div>
        </button>`;
    }).join('');
  }

  function renderPropertyCards(groups) {
    const container = document.getElementById('workMgmtRows');
    const empty = document.getElementById('workMgmtEmpty');
    if (!container || !empty) return;
    if (!groups.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      empty.textContent = '표시할 관리 물건이 없습니다.';
      return;
    }
    empty.classList.add('hidden');
    const selectedKey = localState.activeGroupKey || '';
    container.innerHTML = groups.map((group) => {
      const item = group.item || {};
      const sourceType = String(item?.sourceType || group?.row?.sourceType || '').trim() || 'general';
      const sourceText = sourceLabel(sourceType);
      const actionTotal = Object.values(group.counts || {}).reduce((sum, v) => sum + Number(v || 0), 0);
      const address = buildPropertyTitle(group);
      const meta = buildPropertySubMeta(group) || '세부 정보 없음';
      return `
        <button type="button" class="workmgmt-property-card ${selectedKey === group.groupKey ? 'is-active' : 'is-dim'}" data-group-key="${esc(group.groupKey)}">
          <div class="workmgmt-property-body is-compact">
            <div class="workmgmt-property-top">
              <span class="workmgmt-property-type ${sourceClass(sourceType)}">${esc(sourceText)}</span>
              <span class="workmgmt-property-mark">${selectedKey === group.groupKey ? '●' : '○'}</span>
            </div>
            <h4 class="workmgmt-property-title">${esc(address)}</h4>
            <p class="workmgmt-property-address">${esc(meta)}</p>
            <div class="workmgmt-property-meta-row">
              <span class="workmgmt-property-meta-text">업무 ${Number(actionTotal).toLocaleString('ko-KR')}건</span>
            </div>
          </div>
        </button>`;
    }).join('');
  }

  function buildLogTitle(row) {
    const actionType = String(row?.action_type || '').trim();
    const labels = {
      daily_issue: '',
      opinion: '',
      rights_analysis: '권리분석 업데이트',
      site_inspection: '현장조사 기록',
      new_property: '신규 물건 등록',
      property_update: '물건 정보 수정',
    };
    return labels[actionType] || actionLabel(actionType);
  }

  function buildLogDescription(row) {
    const note = String(row?.note || '').trim();
    if (note) return note;
    const fieldLabels = {
      floor: '층수', totalfloor: '총층', useapproval: '사용승인일',
      commonarea: '공용면적(평)', exclusivearea: '전용면적(평)', sitearea: '토지면적(평)',
      priceMain: '감정가(매각가)', currentPrice: '현재가격', dateMain: '주요일정',
      dailyIssue: '금일 이슈사항', siteInspection: '현장실사', opinion: '담당자 의견',
      rightsAnalysis: '권리분석', status: '진행상태'
    };
    const changed = Array.isArray(row?.changed_fields)
      ? row.changed_fields.map((field) => fieldLabels[String(field || '').trim()] || String(field || '').trim()).filter(Boolean)
      : [];
    if (changed.length) return `${changed.join(', ')} 항목이 반영되었습니다.`;
    const address = String(row?.property_address || '').trim();
    return address ? `${address} 관련 업무 로그입니다.` : '상세 메모가 없는 업무 로그입니다.';
  }

  function renderLogCards(groups) {
    const container = document.getElementById('workMgmtLogs');
    const empty = document.getElementById('workMgmtEmpty');
    if (!container || !empty) return;
    const selectedGroup = groups.find((group) => group.groupKey === localState.activeGroupKey) || null;
    if (!selectedGroup) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      empty.textContent = '표시할 업무 로그가 없습니다.';
      return;
    }
    empty.classList.add('hidden');
    const sortedRows = [...(selectedGroup.rows || [])].sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
    const body = sortedRows.map((row) => {
      const actionType = String(row?.action_type || '').trim();
      const title = buildLogTitle(row);
      const showTitle = actionType !== 'daily_issue' && actionType !== 'opinion' && !!title;
      return `
        <article class="workmgmt-log-card">
          <div class="workmgmt-log-top">
            <span class="workmgmt-log-badge ${actionClass(actionType)}">${esc(actionLabel(actionType))}</span>
            <span class="workmgmt-log-time">${esc(formatTime(row?.created_at || row?.action_date))}</span>
          </div>
          ${showTitle ? `<h5 class="workmgmt-log-title">${esc(title)}</h5>` : ''}
          <p class="workmgmt-log-desc${showTitle ? '' : ' is-tight'}">${esc(buildLogDescription(row)).split(String.fromCharCode(10)).join('<br>')}</p>
        </article>`;
    }).join('');
    container.innerHTML = body || '<div class="workmgmt-empty">표시할 업무 로그가 없습니다.</div>';
  }

  function renderStats(groups, actors, allItems) {
    const container = document.getElementById('workMgmtStats');
    if (!container) return;
    const assignedTotal = getAllAssignedPropertyTotal();
    const managedTotal = groups.length;
    const managedRate = assignedTotal > 0 ? ((managedTotal / assignedTotal) * 100) : 0;
    const selectedActorId = localState.activeActorId || 'all';
    const newPropertyCount = getNewPropertyLogCount(getSelectedActorItems(allItems));
    const publicSubmissionCount = getTodayPublicSubmissionCount(localState.dateKey || getTodayDateKey(), selectedActorId === 'all' ? null : selectedActorId);
    const stats = [
      { label: '전체 배정 물건', value: Number(assignedTotal).toLocaleString('ko-KR'), accent: 'is-brand' },
      { label: '관리 물건', value: Number(managedTotal).toLocaleString('ko-KR'), accent: 'is-soft' },
      { label: '물건 관리율', value: `${managedRate.toFixed(2)}%`, accent: 'is-warm' },
      { label: '신규 물건 등록수', value: Number(newPropertyCount + publicSubmissionCount).toLocaleString('ko-KR'), accent: 'is-danger' },
    ];
    container.innerHTML = stats.map((stat) => `
      <div class="workmgmt-stat-card ${stat.accent}">
        <span class="workmgmt-stat-label">${esc(stat.label)}</span>
        <strong class="workmgmt-stat-value">${esc(stat.value)}</strong>
      </div>`).join('');
  }

  function renderWorkMgmt() {
    const { els } = ctx();
    const items = Array.isArray(localState.data?.items) ? localState.data.items : [];
    const actors = getRegisteredActors(items);
    const filteredItems = getSelectedActorItems(items);
    const groups = groupWorkRows(filteredItems);
    ensureSelections(items, actors, groups);
    renderActorCards(actors);
    renderPropertyCards(groups);
    renderLogCards(groups);
    renderStats(groups, actors, items);
    if (els.workMgmtMeta) {
      els.workMgmtMeta.textContent = '';
    }
  }
  mod.refreshWorkMgmt = async function refreshWorkMgmt(options = {}) {
    const { els, api, utils } = ctx();
    if (localState.loading && !options.force) return localState.data;
    const dateKey = String(options.dateKey || els.workMgmtDate?.value || localState.dateKey || getTodayDateKey()).trim() || getTodayDateKey();
    localState.loading = true;
    localState.dateKey = dateKey;
    if (typeof utils.setAdminLoading === 'function') utils.setAdminLoading('workmgmt', true, '업무 로그를 집계하는 중입니다.');
    if (els.workMgmtDate && els.workMgmtDate.value !== dateKey) els.workMgmtDate.value = dateKey;
    try {
      if (typeof utils.ensureAuxiliaryPropertiesForAdmin === 'function') {
        await utils.ensureAuxiliaryPropertiesForAdmin({ forceRefresh: !!options.forceRefreshProperties });
        localState.propertyIndex = null;
      }
      const data = await api(`/properties?daily_report=1&admin_view=1&date=${encodeURIComponent(dateKey)}`, { auth: true });
      localState.data = {
        date: dateKey,
        counts: data?.counts || {},
        items: Array.isArray(data?.items) ? data.items : [],
      };
      renderWorkMgmt();
      return localState.data;
    } catch (err) {
      if (typeof utils.setGlobalMsg === 'function') utils.setGlobalMsg(err?.message || '업무 관리 로드 실패');
      throw err;
    } finally {
      localState.loading = false;
      if (typeof utils.setAdminLoading === 'function') utils.setAdminLoading('workmgmt', false);
    }
  };

  mod.bindEvents = function bindEvents() {
    const { els } = ctx();
    if (els.workMgmtDate && !els.workMgmtDate.value) {
      els.workMgmtDate.value = getTodayDateKey();
      localState.dateKey = els.workMgmtDate.value;
    }
    if (els.btnWorkMgmtRefresh && els.btnWorkMgmtRefresh.dataset.bound !== 'true') {
      els.btnWorkMgmtRefresh.dataset.bound = 'true';
      els.btnWorkMgmtRefresh.addEventListener('click', () => {
        mod.refreshWorkMgmt({ force: true }).catch(() => {});
      });
    }
    if (els.workMgmtDate && els.workMgmtDate.dataset.bound !== 'true') {
      els.workMgmtDate.dataset.bound = 'true';
      els.workMgmtDate.addEventListener('change', () => {
        localState.dateKey = String(els.workMgmtDate.value || '').trim() || getTodayDateKey();
        mod.refreshWorkMgmt({ force: true }).catch(() => {});
      });
    }
    if (els.workMgmtActors && els.workMgmtActors.dataset.bound !== 'true') {
      els.workMgmtActors.dataset.bound = 'true';
      els.workMgmtActors.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-actor-id]');
        if (!btn) return;
        localState.activeActorId = String(btn.dataset.actorId || 'all').trim() || 'all';
        localState.activeGroupKey = '';
        renderWorkMgmt();
      });
    }
    const propertyList = document.getElementById('workMgmtRows');
    if (propertyList && propertyList.dataset.bound !== 'true') {
      propertyList.dataset.bound = 'true';
      propertyList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-group-key]');
        if (!btn) return;
        localState.activeGroupKey = String(btn.dataset.groupKey || '').trim();
        renderWorkMgmt();
      });
    }
  };

  AdminModules.dashboard = mod;
})();
