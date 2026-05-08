(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const localState = {
    activeActorId: 'all',
    activeGroupKey: '',
    dateKey: '',
    data: null,
    loading: false,
    // 업무 통계 패널 (2026-05-08)
    statsRange: 'week',   // 'today' | 'week' | 'month' | 'custom'
    statsStart: '',       // 'YYYY-MM-DD' (KST)
    statsEnd: '',         // 'YYYY-MM-DD' (KST)
    statsData: null,      // { range, actors }
    statsLoading: false,
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
    // [FIX 20260504-tzfix] 신규등록 카운트의 단일 진실 원천 = 서버 overview.today
    //  · 서버는 KST(UTC+9) 기준 created_at 으로 PostgREST HEAD count 를 정확히 산출한다.
    //  · 기존에는 hasSnapshotRows 분기에서 props(페이지네이션된 30건/부분 캐시/전체 캐시)
    //    로 client-side 재집계를 하면서, 탭 이동 시마다 props 가 바뀌어 화면값이 30/555/714
    //    처럼 들쭉날쭉했고 + parseFlexibleDate 의 ISO 8601 시간 손실로 ~159건 어긋났다.
    //  · 이제 overview 가 있으면 hasSnapshotRows 와 무관하게 무조건 overview 사용,
    //    overview 부재 시에만 client-side 재집계로 fallback 한다.
    const useServerOverview = !!overview;
    const todayParts = useServerOverview
      ? {
          total: Number(overview?.today?.total || 0),
          auction: Number(overview?.today?.auction || 0),
          onbid: Number(overview?.today?.onbid || 0),
          realtor_naver: Number(overview?.today?.realtor_naver || 0),
          realtor_direct: Number(overview?.today?.realtor_direct || 0),
          general: Number(overview?.today?.general || 0),
        }
      : { total: 0, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    let geoPending = useServerOverview ? Number(overview?.geoPending || 0) : 0;
    const countSource = useServerOverview
      ? 'server-overview'
      : (hasSnapshotRows ? 'client-snapshot-fallback' : 'empty');
    // 디버그: 어느 경로로 진입했는지 표시
    try { console.log('[Dashboard 진입 경로]', { countSource, hasSnapshotRows, propsLength: (props||[]).length, hasOverview: !!overview, overviewToday: overview?.today, dateKey }); } catch {}
    if (!useServerOverview && hasSnapshotRows) {
      // ── overview 부재 시에만 client-side 재집계 (fallback) ──
      // 이 경로는 props 가 propertiesFullCache(전체)인 경우에만 신뢰 가능하다.
      // homeSummarySnapshot/state.properties(부분) 인 경우에는 부정확하지만,
      // overview 가 없으면 차선책으로라도 0 보다는 부분 카운트를 보여준다.
      let dbg = { total: 0, hadCreatedAt: 0, parsedOk: 0, todayMatch: 0, sample: [] };
      for (const item of Array.isArray(props) ? props : []) {
        dbg.total += 1;
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
      try { console.log('[Dashboard today 진단:fallback]', { dateKey, ...dbg, todayParts }); } catch {}
    }
    if (els.sumTodayTotal) els.sumTodayTotal.textContent = fmt(todayParts.total);
    if (els.sumTodayAuction) els.sumTodayAuction.textContent = fmt(todayParts.auction);
    if (els.sumTodayOnbid) els.sumTodayOnbid.textContent = fmt(todayParts.onbid);
    if (els.sumTodayRealtor) els.sumTodayRealtor.textContent = fmt(todayParts.realtor_naver);
    if (els.sumTodayDirect) els.sumTodayDirect.textContent = fmt(todayParts.realtor_direct);
    if (els.sumTodayGeneral) els.sumTodayGeneral.textContent = fmt(todayParts.general);

    // ── 신규 업데이트 Weekly / Monthly 카운터 (2026-05-08) ──────────────
    // 서버 overview 가 있을 때만 정확한 값 표시. fallback 없음 — overview 부재시 0.
    const weeklyParts = useServerOverview
      ? {
          auction: Number(overview?.weekly?.auction || 0),
          onbid: Number(overview?.weekly?.onbid || 0),
          realtor_naver: Number(overview?.weekly?.realtor_naver || 0),
          realtor_direct: Number(overview?.weekly?.realtor_direct || 0),
          general: Number(overview?.weekly?.general || 0),
        }
      : { auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    const monthlyParts = useServerOverview
      ? {
          auction: Number(overview?.monthly?.auction || 0),
          onbid: Number(overview?.monthly?.onbid || 0),
          realtor_naver: Number(overview?.monthly?.realtor_naver || 0),
          realtor_direct: Number(overview?.monthly?.realtor_direct || 0),
          general: Number(overview?.monthly?.general || 0),
        }
      : { auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };

    if (els.sumWeekAuction) els.sumWeekAuction.textContent = fmt(weeklyParts.auction);
    if (els.sumWeekOnbid) els.sumWeekOnbid.textContent = fmt(weeklyParts.onbid);
    if (els.sumWeekRealtor) els.sumWeekRealtor.textContent = fmt(weeklyParts.realtor_naver);
    if (els.sumWeekDirect) els.sumWeekDirect.textContent = fmt(weeklyParts.realtor_direct);
    if (els.sumWeekGeneral) els.sumWeekGeneral.textContent = fmt(weeklyParts.general);
    if (els.sumMonthAuction) els.sumMonthAuction.textContent = fmt(monthlyParts.auction);
    if (els.sumMonthOnbid) els.sumMonthOnbid.textContent = fmt(monthlyParts.onbid);
    if (els.sumMonthRealtor) els.sumMonthRealtor.textContent = fmt(monthlyParts.realtor_naver);
    if (els.sumMonthDirect) els.sumMonthDirect.textContent = fmt(monthlyParts.realtor_direct);
    if (els.sumMonthGeneral) els.sumMonthGeneral.textContent = fmt(monthlyParts.general);

    if (els.homeGeoPending) els.homeGeoPending.textContent = fmt(geoPending);
    if (els.sumTodayDetail) {
      // overview 사용 시에는 서버 정확 카운트이므로 무조건 full data 로 표기
      const usingFullData = useServerOverview || Array.isArray(state.propertiesFullCache) || hasSnapshotRows;
      els.sumTodayDetail.innerHTML = formatTodayDetail(todayParts, usingFullData);
    }

    // 금주 낙찰/매각 카드: 비동기 로드 (결과 도착 시 DOM 직접 갱신)
    renderWeeklyAuctionCard();

    // [신규] 전일 대비 증가율 칩: API 비동기 로드 후 두 카드 칩 동시 갱신
    renderDailyDeltaChips(Number(summary.total) || 0, Number(todayParts.total) || 0);
  };

  // ─────────────────────────────────────────────────────────────
  // [신규] 전일 대비 증가율 칩 렌더러
  //   - renderSummary 가 스냅샷 경로/비스냅샷 경로 등 여러 번 호출되면서,
  //     첫 호출의 stale 한 totalNow=0 값이 async 완료 시점에 칩에 세팅되어
  //     ▼100% 가 잘못 표시되는 문제가 있었다. 이를 막기 위해 API 응답 후
  //     칩을 세팅할 때는 매개변수가 아니라 현재 DOM 에 렌더된 숫자(#sumTotal,
  //     #sumTodayTotal) 를 재조회해서 계산한다 — DOM 이 source of truth.
  //   - 30초 캐시로 대시보드 재렌더 시 API 연발 방지
  // ─────────────────────────────────────────────────────────────
  let _deltaLoading = false;
  let _deltaFetchedAt = 0;
  let _deltaData = null;
  function parseChipNowFromDom(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const raw = String(el.textContent || '').replace(/[^0-9.-]/g, '');
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  function refreshDeltaChipsFromDom() {
    const totalChip = document.getElementById('sumTotalDeltaChip');
    const todayChip = document.getElementById('sumTodayDeltaChip');
    const totalNow = parseChipNowFromDom('sumTotal');
    const todayNow = parseChipNowFromDom('sumTodayTotal');
    applyDeltaChip(totalChip, totalNow, Number(_deltaData?.totalUntilYesterday || 0), { mode: 'cumulative' });
    applyDeltaChip(todayChip, todayNow, Number(_deltaData?.yesterdayNewCount || 0), { mode: 'daily' });
  }
  async function renderDailyDeltaChips(/* totalNow_ignored, todayNewNow_ignored */) {
    const totalChip = document.getElementById('sumTotalDeltaChip');
    const todayChip = document.getElementById('sumTodayDeltaChip');
    if (!totalChip && !todayChip) return;
    // 캐시 유효하면 즉시 DOM 최신값으로 재계산 (매개변수 사용 안 함)
    if (_deltaData && (Date.now() - _deltaFetchedAt) < 30000) {
      refreshDeltaChipsFromDom();
      return;
    }
    // API 호출 진행 중이면 스킵 (먼저 시작된 호출이 끝나고 칩 세팅함)
    if (_deltaLoading) return;
    _deltaLoading = true;
    try {
      const { api } = ctx();
      const data = await api('/admin/properties?mode=daily_delta_stats', { auth: true });
      if (data?.ok) {
        _deltaData = data;
        _deltaFetchedAt = Date.now();
      }
    } catch (e) {
      console.warn('daily delta stats load failed', e);
    } finally {
      _deltaLoading = false;
    }
    // API 응답 직후 DOM 최신값으로 칩 계산 — 매개변수로 받은 stale 값은 사용 안 함
    refreshDeltaChipsFromDom();
  }

  function applyDeltaChip(el, nowValue, prevValue, options = {}) {
    if (!el) return;
    el.classList.remove('is-up', 'is-down', 'is-flat');
    // 전일 기준 값이 0 이면 백분율 정의 불가
    //  - cumulative(전체 등록): 어제 누적이 0이면 표시 안 함 (DB 초기화 직후 등 edge)
    //  - daily(신규 등록): 어제 신규가 0이면 "신규" 뱃지 표시
    if (!Number.isFinite(prevValue) || prevValue <= 0) {
      if (options.mode === 'daily' && nowValue > 0) {
        el.textContent = '신규';
        el.classList.add('is-up');
      } else {
        el.textContent = '';
      }
      return;
    }
    const diff = nowValue - prevValue;
    const pct = (diff / prevValue) * 100;
    // 소수점 1자리 표시. 단 절대값 10% 이상은 정수로 표시해 노이즈 감소.
    const absPct = Math.abs(pct);
    const pctStr = absPct >= 10
      ? `${Math.round(pct)}%`
      : `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
    if (diff > 0) {
      el.textContent = `▲ ${pct > 0 ? '+' : ''}${pctStr.replace(/^-/, '')}`;
      el.classList.add('is-up');
    } else if (diff < 0) {
      el.textContent = `▼ ${pctStr.replace(/^-/, '')}`;
      el.classList.add('is-down');
    } else {
      el.textContent = '0%';
      el.classList.add('is-flat');
    }
  }

  let _weeklyAuctionLoading = false;
  let _weeklyAuctionFetchedAt = 0;
  let _weeklyAuctionData = null;  // 모달 재오픈 시 재활용용 캐시
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
      _weeklyAuctionData = data;  // 모달용 캐시
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

  // ─────────────────────────────────────────────────────────────
  // [신규] 금주 낙찰/매각 상세 모달
  //   - '상세 내역 확인하기' 버튼 클릭 시 열림
  //   - 캐시가 유효하면 즉시 표시, 아니면 API 재호출
  //   - 카드 전체 클릭(전체리스트 이동) 과 독립 동작
  // ─────────────────────────────────────────────────────────────
  const SOURCE_TYPE_LABEL = {
    auction: '경매', onbid: '공매',
    realtor_naver: '네이버중개', realtor_direct: '일반중개', realtor: '중개',
    general: '일반',
  };
  function formatWon(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num) || num <= 0) return '-';
    return num.toLocaleString('ko-KR') + '원';
  }
  function escHtmlLocal(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderWeeklyAuctionModalContent(data) {
    const rangeEl = document.getElementById('weeklyAuctionModalRange');
    const msgEl = document.getElementById('weeklyAuctionModalMsg');
    const wrapEl = document.getElementById('weeklyAuctionModalTableWrap');
    const tbodyEl = document.getElementById('weeklyAuctionModalTbody');
    if (!msgEl || !wrapEl || !tbodyEl) return;
    if (rangeEl) {
      rangeEl.textContent = (data && data.weekStart && data.weekEnd)
        ? `(${data.weekStart} ~ ${data.weekEnd})`
        : '';
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      msgEl.textContent = '이번 주에 낙찰/매각된 물건이 없습니다.';
      msgEl.classList.remove('hidden', 'is-error');
      msgEl.classList.add('is-empty');
      wrapEl.classList.add('hidden');
      tbodyEl.innerHTML = '';
      return;
    }
    msgEl.classList.add('hidden');
    msgEl.classList.remove('is-empty', 'is-error');
    wrapEl.classList.remove('hidden');
    const rows = items.map((it) => {
      const typeLabel = escHtmlLocal(SOURCE_TYPE_LABEL[it.sourceType] || it.sourceType || '-');
      const assetLabel = escHtmlLocal(it.assetType || '');
      const fullType = assetLabel ? `${typeLabel} · ${assetLabel}` : typeLabel;
      const itemNoText = escHtmlLocal(it.itemNo || '-');
      // [추가 2026-04-27] 물건번호 → 탱크옥션 URL 링크 적용.
      // sourceUrl 이 있을 때만 a 태그로 감쌈. target/rel 은 보안상 noopener 필수.
      const sourceUrl = String(it.sourceUrl || '').trim();
      const itemNo = sourceUrl
        ? `<a href="${escHtmlLocal(sourceUrl)}" target="_blank" rel="noopener" class="item-no-link" title="탱크옥션에서 보기">${itemNoText}</a>`
        : itemNoText;
      const address = escHtmlLocal(it.address || '-');
      const priceMain = formatWon(it.priceMain);
      const resultPrice = formatWon(it.resultPrice);
      let ratioHtml = '-';
      if (typeof it.ratio === 'number' && Number.isFinite(it.ratio)) {
        let cls = '';
        if (it.ratio >= 100) cls = 'is-high';
        else if (it.ratio < 80) cls = 'is-low';
        ratioHtml = `<span class="ratio-badge ${cls}">${it.ratio.toFixed(1)}%</span>`;
      }
      return (
        `<tr>`
        + `<td class="col-item">${itemNo}</td>`
        + `<td>${fullType}</td>`
        + `<td class="col-address" title="${address}">${address}</td>`
        + `<td class="num">${priceMain}</td>`
        + `<td class="num">${resultPrice}</td>`
        + `<td class="num">${ratioHtml}</td>`
        + `</tr>`
      );
    }).join('');
    tbodyEl.innerHTML = rows;
  }
  async function openWeeklyAuctionDetailModal() {
    const modalEl = document.getElementById('weeklyAuctionDetailModal');
    const msgEl = document.getElementById('weeklyAuctionModalMsg');
    const wrapEl = document.getElementById('weeklyAuctionModalTableWrap');
    if (!modalEl) return;
    modalEl.classList.remove('hidden');
    // 캐시가 유효(30초 이내)하면 즉시 표시
    if (_weeklyAuctionData && (Date.now() - _weeklyAuctionFetchedAt) < 30000) {
      renderWeeklyAuctionModalContent(_weeklyAuctionData);
      return;
    }
    // 로딩 표시
    if (msgEl) {
      msgEl.textContent = '로딩 중…';
      msgEl.classList.remove('hidden', 'is-error', 'is-empty');
    }
    if (wrapEl) wrapEl.classList.add('hidden');
    try {
      const { api } = ctx();
      const data = await api('/admin/properties?mode=weekly_auction_stats', { auth: true });
      if (!data?.ok) throw new Error(data?.message || '통계 실패');
      _weeklyAuctionData = data;
      _weeklyAuctionFetchedAt = Date.now();
      renderWeeklyAuctionModalContent(data);
    } catch (e) {
      console.warn('weekly auction detail load failed', e);
      if (msgEl) {
        msgEl.textContent = '상세 내역을 불러오지 못했습니다.';
        msgEl.classList.add('is-error');
        msgEl.classList.remove('hidden', 'is-empty');
      }
      if (wrapEl) wrapEl.classList.add('hidden');
    }
  }
  function closeWeeklyAuctionDetailModal() {
    const modalEl = document.getElementById('weeklyAuctionDetailModal');
    if (modalEl) modalEl.classList.add('hidden');
  }
  function bindWeeklyAuctionModal() {
    const btn = document.getElementById('btnWeeklyAuctionDetail');
    if (btn && btn.dataset.bound !== '1') {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        // 카드 전체 클릭(전체리스트 이동) 이벤트가 함께 발생하지 않도록 버블 차단
        e.stopPropagation();
        openWeeklyAuctionDetailModal();
      });
    }
    const modalEl = document.getElementById('weeklyAuctionDetailModal');
    if (modalEl && modalEl.dataset.bound !== '1') {
      modalEl.dataset.bound = '1';
      modalEl.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.close === 'true') closeWeeklyAuctionDetailModal();
      });
      const closeBtn = document.getElementById('weeklyAuctionModalClose');
      if (closeBtn) closeBtn.addEventListener('click', closeWeeklyAuctionDetailModal);
      // ESC 로 닫기
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) {
          closeWeeklyAuctionDetailModal();
        }
      });
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
      document.addEventListener('DOMContentLoaded', () => {
        bindWeeklyAuctionCardClick();
        bindWeeklyAuctionModal();
      });
    } else {
      setTimeout(() => {
        bindWeeklyAuctionCardClick();
        bindWeeklyAuctionModal();
      }, 0);
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
    // 통계 패널은 일일 보기와 독립적이므로 병렬로 트리거 (실패해도 일일 보기는 정상 진행)
    if (!options.skipStats) {
      mod.refreshWorkMgmtStats({ force: !!options.force }).catch(() => {});
    }
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

  // ══════════════════════════════════════════════════════════════════════
  // 업무 통계 패널 (2026-05-08)
  //   - 기간(오늘/이번주/이번달/사용자지정) 단위로 담당자별 활동 집계 표시
  //   - 백엔드: GET /api/properties?daily_report=1&admin_view=1&aggregate=by_actor
  //   - 카운팅: 신규물건/물건수정/사진/동영상은 고유 물건 수, 그 외는 row 수
  // ══════════════════════════════════════════════════════════════════════
  function getKstWeekRange(baseKey) {
    // 월요일 시작 ~ 일요일 종료 (KST 기준)
    const key = baseKey || getTodayDateKey();
    const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { start: '', end: '' };
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    const dow = dt.getUTCDay(); // 0=Sun ~ 6=Sat
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    const start = new Date(dt);
    start.setUTCDate(dt.getUTCDate() + offsetToMonday);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    const fmt = (date) => {
      const yy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    };
    return { start: fmt(start), end: fmt(end) };
  }

  function getKstMonthRange(baseKey) {
    const key = baseKey || getTodayDateKey();
    const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { start: '', end: '' };
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const start = `${y}-${String(mo).padStart(2, '0')}-01`;
    // 다음달 0일 = 현재 달의 말일
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const end = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }

  function computeStatsRange(rangeType, customStart, customEnd) {
    if (rangeType === 'today') {
      const t = getTodayDateKey();
      return { start: t, end: t };
    }
    if (rangeType === 'month') return getKstMonthRange();
    if (rangeType === 'custom') {
      return {
        start: String(customStart || '').trim(),
        end: String(customEnd || '').trim(),
      };
    }
    // default: week
    return getKstWeekRange();
  }

  function renderStatsPanel({ loading, error, data } = {}) {
    const tbody = document.getElementById('workMgmtStatsBody');
    if (!tbody) return;
    const meta = document.getElementById('workMgmtStatsMeta');
    const custom = document.getElementById('workMgmtStatsCustom');

    // 기간 버튼 활성 상태 동기화
    const periodBtns = document.querySelectorAll('.workmgmt-period-btn');
    periodBtns.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.period === localState.statsRange);
    });
    if (custom) custom.classList.toggle('hidden', localState.statsRange !== 'custom');

    if (loading) {
      tbody.innerHTML = '<tr><td colspan="11" class="workmgmt-stats-empty">집계 중...</td></tr>';
      if (meta) meta.textContent = '';
      return;
    }
    if (error) {
      tbody.innerHTML = `<tr><td colspan="11" class="workmgmt-stats-empty">${esc(error)}</td></tr>`;
      return;
    }

    const apiActors = (data && Array.isArray(data.actors)) ? data.actors : [];
    const { state } = ctx();
    const staffRows = Array.isArray(state.staff) ? state.staff : [];
    // 총배정 산출용: state.properties 기반 actor → 배정 물건 Set 맵
    const assignedMap = (typeof getAssignedPropertyMap === 'function') ? getAssignedPropertyMap() : new Map();

    // 현재 dbms 담당자(staff role 만) 기준으로 머지: 활동 0인 담당자도 표시
    // 관리자(admin) 는 통계 집계 대상에서 제외 — 운영 요구사항(2026-05-08)
    const apiById = new Map(apiActors.map((a) => [String(a.actor_id || ''), a]));
    const merged = [];
    const seen = new Set();
    for (const staff of staffRows) {
      const id = String(staff?.id || '').trim();
      if (!id) continue;
      if (normalizeRole(staff?.role) !== 'staff') {
        // admin / 기타 역할은 표시하지 않으면서 seen 에 등록하여
        // 아래 orphan 루프에서도 다시 추가되지 않도록 차단
        seen.add(id);
        continue;
      }
      const fromApi = apiById.get(id);
      merged.push({
        actor_id: id,
        actor_name: String(staff?.name || staff?.email || '').trim() || '미상',
        counts: fromApi?.counts || {
          newProperty: 0, propertyUpdate: 0, dailyIssue: 0,
          siteInspection: 0, opinion: 0, photoUpload: 0, videoUpload: 0,
          managed: 0,
        },
      });
      seen.add(id);
    }
    // staff 목록에 없지만 활동 로그에는 있는 (예: 삭제된 계정) 담당자도 포함
    for (const actor of apiActors) {
      const id = String(actor.actor_id || '').trim();
      if (!id || seen.has(id)) continue;
      merged.push(actor);
    }
    merged.sort((a, b) => String(a.actor_name || '').localeCompare(String(b.actor_name || ''), 'ko'));

    if (!merged.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="workmgmt-stats-empty">담당자가 없습니다.</td></tr>';
      if (meta) meta.textContent = '';
      return;
    }

    const cell = (n, label) => {
      const v = Number(n) || 0;
      const cls = v === 0 ? 'is-zero' : '';
      return `<td class="${cls}" data-label="${esc(label)}">${v.toLocaleString('ko-KR')}</td>`;
    };
    const rateCell = (managed, assigned) => {
      const a = Number(assigned) || 0;
      const m = Number(managed) || 0;
      if (a <= 0) {
        return `<td class="is-zero" data-label="관리율">-</td>`;
      }
      const rate = (m / a) * 100;
      const cls = m === 0 ? 'is-zero' : '';
      return `<td class="${cls}" data-label="관리율">${rate.toFixed(1)}%</td>`;
    };

    tbody.innerHTML = merged.map((a) => {
      const c = a.counts || {};
      const assignedTotal = (assignedMap.get(a.actor_id) || new Set()).size;
      const managedTotal = Number(c.managed) || 0;
      return `
        <tr>
          <td class="is-actor" data-label="담당자">${esc(a.actor_name || '미상')}</td>
          ${cell(assignedTotal, '총배정')}
          ${cell(managedTotal, '관리중')}
          ${rateCell(managedTotal, assignedTotal)}
          ${cell(c.newProperty, '신규물건')}
          ${cell(c.propertyUpdate, '물건수정')}
          ${cell(c.dailyIssue, '금일이슈')}
          ${cell(c.siteInspection, '현장실사')}
          ${cell(c.opinion, '담당자의견')}
          ${cell(c.photoUpload, '사진등록')}
          ${cell(c.videoUpload, '동영상등록')}
        </tr>`;
    }).join('');

    if (meta && data && data.range) {
      meta.textContent = `${data.range.start} ~ ${data.range.end} (${data.range.days}일)`;
    }
  }

  mod.refreshWorkMgmtStats = async function refreshWorkMgmtStats(options = {}) {
    const { api, utils } = ctx();
    if (localState.statsLoading && !options.force) return localState.statsData;

    const rangeType = options.range || localState.statsRange || 'week';
    const customStart = options.start != null ? options.start : localState.statsStart;
    const customEnd = options.end != null ? options.end : localState.statsEnd;
    const range = computeStatsRange(rangeType, customStart, customEnd);

    if (!range.start || !range.end) {
      localState.statsRange = rangeType;
      renderStatsPanel({ error: '시작일과 종료일을 모두 입력해 주세요.' });
      return null;
    }
    if (range.start > range.end) {
      localState.statsRange = rangeType;
      renderStatsPanel({ error: '시작일이 종료일보다 늦을 수 없습니다.' });
      return null;
    }

    localState.statsRange = rangeType;
    localState.statsStart = range.start;
    localState.statsEnd = range.end;
    localState.statsLoading = true;
    renderStatsPanel({ loading: true });

    try {
      const data = await api(
        `/properties?daily_report=1&admin_view=1&aggregate=by_actor`
        + `&start_date=${encodeURIComponent(range.start)}`
        + `&end_date=${encodeURIComponent(range.end)}`,
        { auth: true }
      );
      localState.statsData = data;
      renderStatsPanel({ data });
      return data;
    } catch (err) {
      if (typeof utils.setGlobalMsg === 'function') utils.setGlobalMsg(err?.message || '업무 통계 로드 실패');
      renderStatsPanel({ error: err?.message || '업무 통계 로드 실패' });
      throw err;
    } finally {
      localState.statsLoading = false;
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
    // ── 업무 통계 패널 이벤트 바인딩 (2026-05-08) ──────────────────────
    const statsPanel = document.getElementById('workMgmtStatsPanel');
    if (statsPanel && statsPanel.dataset.bound !== 'true') {
      statsPanel.dataset.bound = 'true';
      // 기간 버튼 (오늘/이번주/이번달/사용자지정) - 이벤트 위임
      statsPanel.addEventListener('click', (e) => {
        const btn = e.target.closest('.workmgmt-period-btn');
        if (!btn) return;
        const period = String(btn.dataset.period || '').trim();
        if (!period) return;
        if (period === 'custom') {
          // 사용자지정: 입력 칸만 표시하고 즉시 호출하지 않음
          localState.statsRange = 'custom';
          // 기본값: 현재 statsStart/statsEnd 가 비어있으면 이번주로 채워줌
          if (!localState.statsStart || !localState.statsEnd) {
            const w = getKstWeekRange();
            localState.statsStart = w.start;
            localState.statsEnd = w.end;
          }
          const startInput = document.getElementById('workMgmtStatsStart');
          const endInput = document.getElementById('workMgmtStatsEnd');
          if (startInput) startInput.value = localState.statsStart || '';
          if (endInput) endInput.value = localState.statsEnd || '';
          renderStatsPanel({ data: localState.statsData });
          return;
        }
        mod.refreshWorkMgmtStats({ range: period, force: true }).catch(() => {});
      });
    }
    const btnApply = document.getElementById('btnWorkMgmtStatsApply');
    if (btnApply && btnApply.dataset.bound !== 'true') {
      btnApply.dataset.bound = 'true';
      btnApply.addEventListener('click', () => {
        const startInput = document.getElementById('workMgmtStatsStart');
        const endInput = document.getElementById('workMgmtStatsEnd');
        const start = String(startInput?.value || '').trim();
        const end = String(endInput?.value || '').trim();
        mod.refreshWorkMgmtStats({ range: 'custom', start, end, force: true }).catch(() => {});
      });
    }
  };

  AdminModules.dashboard = mod;
})();
