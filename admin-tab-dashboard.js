(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const localState = {
    activeActorId: 'all',
    activePropertyKey: '',
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
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
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

  function actionLabel(actionType) {
    const map = {
      rights_analysis: '권리분석',
      site_inspection: '현장조사',
      daily_issue: '금일이슈',
      new_property: '신규등록',
    };
    return map[String(actionType || '').trim()] || '기타';
  }

  function actionClass(actionType) {
    const map = {
      rights_analysis: 'is-rights',
      site_inspection: 'is-site',
      daily_issue: 'is-edit',
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
    if (parts.onbid) bits.push(`공매 ${Number(parts.onbid).toLocaleString('ko-KR')}건`);
    if (parts.realtor) bits.push(`<span class="hs-naver">중개</span> ${Number(parts.realtor).toLocaleString('ko-KR')}건`);
    if (parts.general) bits.push(`<span class="hs-general">일반</span> ${Number(parts.general).toLocaleString('ko-KR')}건`);
    const suffix = usingFullData ? '입니다.' : '입니다. (현재 로딩 데이터 기준)';
    return bits.join(', ') + ' ' + suffix;
  }

  mod.renderSummary = function renderSummary() {
    const { state, els, utils } = ctx();
    const props = typeof utils.getAuxiliaryPropertiesSnapshot === 'function' ? (utils.getAuxiliaryPropertiesSnapshot() || []) : (state.properties || []);
    const staff = Array.isArray(state.staff) ? state.staff : [];
    const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
    const summary = state.propertySummary || {
      total: props.length,
      auction: props.filter((p) => p.sourceType === 'auction').length,
      onbid: props.filter((p) => p.sourceType === 'onbid').length,
      realtor_naver: props.filter((p) => p.sourceType === 'realtor' && !p.isDirectSubmission).length,
      realtor_direct: props.filter((p) => p.sourceType === 'realtor' && p.isDirectSubmission).length,
      general: props.filter((p) => p.sourceType === 'general').length,
    };
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
    const todayParts = { total: 0, auction: 0, onbid: 0, realtor: 0, general: 0 };
    let geoPending = 0;
    for (const item of Array.isArray(props) ? props : []) {
      const rawCreatedAt = item?.createdAt || item?._raw?.created_at || item?._raw?.raw?.firstRegisteredAt || item?._raw?.raw?.createdAt || '';
      if (sameDay(rawCreatedAt, dateKey)) {
        todayParts.total += 1;
        const key = String(item?.sourceType || '').trim();
        if (todayParts[key] !== undefined) todayParts[key] += 1;
      }
      const status = String(item?.geocodeStatus || item?._raw?.geocode_status || '').trim().toLowerCase();
      const lat = item?.latitude ?? item?._raw?.latitude;
      const lng = item?.longitude ?? item?._raw?.longitude;
      const hasCoords = lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '';
      const address = String(item?.address || item?._raw?.address || '').trim();
      if (!hasCoords && address && status !== 'failed' && status !== 'ok') geoPending += 1;
    }
    if (els.sumTodayTotal) els.sumTodayTotal.textContent = fmt(todayParts.total);
    if (els.sumTodayAuction) els.sumTodayAuction.textContent = fmt(todayParts.auction);
    if (els.sumTodayOnbid) els.sumTodayOnbid.textContent = fmt(todayParts.onbid);
    if (els.sumTodayRealtor) els.sumTodayRealtor.textContent = fmt(todayParts.realtor);
    if (els.homeGeoPending) els.homeGeoPending.textContent = fmt(geoPending);
    if (els.sumTodayDetail) {
      const usingFullData = Array.isArray(state.propertiesFullCache);
      els.sumTodayDetail.innerHTML = formatTodayDetail(todayParts, usingFullData);
    }
  };


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

  function buildActorBuckets(items) {
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
    const { state } = ctx();
    const all = Array.isArray(state.propertiesFullCache) && state.propertiesFullCache.length ? state.propertiesFullCache : (state.properties || []);
    const propertyId = String(row?.property_id || '').trim();
    const itemNo = String(row?.property_item_no || '').trim();
    const address = String(row?.property_address || '').trim();
    const identityKey = String(row?.property_identity_key || '').trim();
    return all.find((item) => {
      const raw = item?._raw || {};
      const inner = raw?.raw || {};
      return (
        (propertyId && [item.id, item.globalId, raw.id, raw.global_id].map((v) => String(v || '').trim()).includes(propertyId)) ||
        (itemNo && String(item.itemNo || '').trim() === itemNo) ||
        (address && String(item.address || '').trim() === address) ||
        (identityKey && String(inner.registrationIdentityKey || '').trim() === identityKey)
      );
    }) || null;
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

  function buildPropertyTitle(group) {
    const { utils } = ctx();
    const item = group?.item;
    const row = group?.row || {};
    const address = String(item?.address || row?.property_address || '-').trim();
    const floor = String(item?.floor || '').trim();
    const area = item?.exclusivearea != null && item?.exclusivearea !== ''
      ? `${typeof utils.formatAreaPyeong === 'function' ? utils.formatAreaPyeong(item.exclusivearea) : item.exclusivearea}평`
      : '';
    const parts = [address];
    if (floor) parts.push(floor);
    if (area) parts.push(area);
    return parts.join(' | ');
  }

  function buildPropertySubMeta(group) {
    const item = group?.item || {};
    const row = group?.row || {};
    const parts = [];
    const itemNo = String(item?.itemNo || row?.property_item_no || '').trim();
    const assetType = String(item?.assetType || item?.assettype || item?._raw?.asset_type || '').trim();
    const status = String(item?.status || item?._raw?.status || '').trim();
    if (itemNo) parts.push(itemNo);
    if (assetType) parts.push(assetType);
    if (status) parts.push(status);
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

  function ensureSelections(items, actors, groups) {
    if (!actors.length) {
      localState.activeActorId = 'all';
      localState.activePropertyKey = '';
      return;
    }
    if (localState.activeActorId !== 'all' && !actors.some((actor) => actor.actorId === localState.activeActorId)) {
      localState.activeActorId = 'all';
    }
    const actorGroups = groups;
    if (!actorGroups.length) {
      localState.activePropertyKey = '';
      return;
    }
    if (!localState.activePropertyKey || !actorGroups.some((group) => group.propertyKey === localState.activePropertyKey)) {
      localState.activePropertyKey = actorGroups[0].propertyKey;
    }
  }

  function renderActorCards(actors) {
    const container = document.getElementById('workMgmtActors');
    if (!container) return;
    const selected = localState.activeActorId || 'all';
    const totalLogs = actors.reduce((sum, actor) => sum + actor.items.length, 0);
    const totalProps = actors.reduce((sum, actor) => sum + actor.propertyCount, 0);
    const allCard = `
      <button type="button" class="workmgmt-actor-card ${selected === 'all' ? 'is-active' : 'is-dim'}" data-actor-id="all">
        <div class="workmgmt-actor-head">
          <span class="workmgmt-actor-avatar is-all">전체</span>
          <div>
            <p class="workmgmt-actor-name">전체 담당자</p>
            <p class="workmgmt-actor-sub">일일 업무 통합 보기</p>
          </div>
        </div>
        <div class="workmgmt-actor-chips">
          <span class="workmgmt-chip is-soft">${Number(totalProps).toLocaleString('ko-KR')} 관리 물건</span>
          <span class="workmgmt-chip is-brand">${Number(totalLogs).toLocaleString('ko-KR')} 로그</span>
        </div>
      </button>`;
    container.innerHTML = allCard + actors.map((actor) => {
      const updateCount = actor.counts.rights_analysis + actor.counts.site_inspection + actor.counts.daily_issue + actor.counts.property_update;
      return `
        <button type="button" class="workmgmt-actor-card ${selected === actor.actorId ? 'is-active' : 'is-dim'}" data-actor-id="${esc(actor.actorId)}">
          <div class="workmgmt-actor-head">
            <span class="workmgmt-actor-avatar">${esc(actorInitial(actor.actorName))}</span>
            <div>
              <p class="workmgmt-actor-name">${esc(actor.actorName)}</p>
              <p class="workmgmt-actor-sub">담당자 업무 현황</p>
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
      return;
    }
    empty.classList.add('hidden');
    const selectedKey = localState.activePropertyKey || '';
    container.innerHTML = groups.map((group) => {
      const item = group.item || {};
      const sourceType = String(item?.sourceType || group?.row?.sourceType || '').trim() || 'general';
      const sourceText = sourceLabel(sourceType);
      const amount = formatMoney(item?.lowprice ?? item?.priceMain ?? item?._raw?.lowprice ?? item?._raw?.priceMain);
      const latestText = buildPropertySubMeta(group) || '세부 정보 없음';
      const actionTotal = Object.values(group.counts).reduce((sum, v) => sum + Number(v || 0), 0);
      return `
        <button type="button" class="workmgmt-property-card ${selectedKey === group.propertyKey ? 'is-active' : 'is-dim'}" data-property-key="${esc(group.propertyKey)}">
          <div class="workmgmt-property-thumb ${sourceClass(sourceType)}">
            <span>${esc(sourceText)}</span>
          </div>
          <div class="workmgmt-property-body">
            <div class="workmgmt-property-top">
              <span class="workmgmt-property-type ${sourceClass(sourceType)}">${esc(sourceText)}</span>
              <span class="workmgmt-property-mark">${selectedKey === group.propertyKey ? '●' : '○'}</span>
            </div>
            <h4 class="workmgmt-property-title">${esc(buildPropertyTitle(group))}</h4>
            <p class="workmgmt-property-address">${esc(latestText)}</p>
            <div class="workmgmt-property-meta-row">
              <span class="workmgmt-property-meta-text">업무 ${Number(actionTotal).toLocaleString('ko-KR')}건</span>
              <strong class="workmgmt-property-amount">${esc(amount)}</strong>
            </div>
          </div>
        </button>`;
    }).join('');
  }

  function buildLogTitle(row) {
    const actionType = String(row?.action_type || '').trim();
    const labels = {
      daily_issue: '금일 이슈 등록',
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
    const changed = Array.isArray(row?.changed_fields) ? row.changed_fields.filter(Boolean) : [];
    if (changed.length) return `${changed.join(', ')} 항목이 반영되었습니다.`;
    const address = String(row?.property_address || '').trim();
    return address ? `${address} 관련 업무 로그입니다.` : '상세 메모가 없는 업무 로그입니다.';
  }

  function renderLogCards(groups) {
    const container = document.getElementById('workMgmtLogs');
    const empty = document.getElementById('workMgmtEmpty');
    if (!container || !empty) return;
    const selectedGroup = groups.find((group) => group.propertyKey === localState.activePropertyKey) || null;
    if (!selectedGroup) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    const sourceType = String(selectedGroup?.item?.sourceType || selectedGroup?.row?.sourceType || '').trim() || 'general';
    const header = `
      <div class="workmgmt-log-header ${sourceClass(sourceType)}">
        <div>
          <p class="workmgmt-log-kicker">${esc(sourceLabel(sourceType))} · ${esc(selectedGroup.actorName)}</p>
          <h4 class="workmgmt-log-heading">${esc(buildPropertyTitle(selectedGroup))}</h4>
        </div>
      </div>`;
    const sortedRows = [...(selectedGroup.rows || [])].sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
    const body = sortedRows.map((row) => {
      const actionType = String(row?.action_type || '').trim();
      return `
        <article class="workmgmt-log-card">
          <div class="workmgmt-log-top">
            <span class="workmgmt-log-badge ${actionClass(actionType)}">${esc(actionLabel(actionType))}</span>
            <span class="workmgmt-log-time">${esc(formatTime(row?.created_at || row?.action_date))}</span>
          </div>
          <h5 class="workmgmt-log-title">${esc(buildLogTitle(row))}</h5>
          <p class="workmgmt-log-desc">${esc(buildLogDescription(row))}</p>
        </article>`;
    }).join('');
    container.innerHTML = header + body;
  }

  function renderStats(groups, actors, allItems) {
    const container = document.getElementById('workMgmtStats');
    if (!container) return;
    const selectedGroup = groups.find((group) => group.propertyKey === localState.activePropertyKey) || null;
    const selectedActorLogs = localState.activeActorId === 'all'
      ? allItems.length
      : allItems.filter((row) => String(row?.actor_id || '').trim() === localState.activeActorId).length;
    const selectedPropertyLogs = selectedGroup ? selectedGroup.rows.length : 0;
    const selectedProperties = groups.length;
    const stats = [
      { label: '업무 로그', value: Number(allItems.length).toLocaleString('ko-KR'), accent: 'is-brand' },
      { label: '담당자 수', value: Number(actors.length).toLocaleString('ko-KR'), accent: 'is-soft' },
      { label: '선택 물건', value: Number(selectedProperties).toLocaleString('ko-KR'), accent: 'is-warm' },
      { label: '선택 로그', value: Number(selectedPropertyLogs || selectedActorLogs).toLocaleString('ko-KR'), accent: 'is-danger' },
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
    const actors = buildActorBuckets(items);
    const filteredItems = getSelectedActorItems(items);
    const groups = groupWorkRows(filteredItems);
    ensureSelections(items, actors, groups);
    renderActorCards(actors);
    renderPropertyCards(groups);
    renderLogCards(groups);
    renderStats(groups, actors, items);
    if (els.workMgmtMeta) {
      const actorText = localState.activeActorId === 'all'
        ? `담당자 ${Number(actors.length).toLocaleString('ko-KR')}명`
        : `${esc(actors.find((actor) => actor.actorId === localState.activeActorId)?.actorName || '선택 담당자')} · 로그 ${Number(filteredItems.length).toLocaleString('ko-KR')}건`;
      const propertyText = `물건 ${Number(groups.length).toLocaleString('ko-KR')}건`;
      els.workMgmtMeta.textContent = `${localState.dateKey || getTodayDateKey()} 기준 · ${actorText} · ${propertyText}`;
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
        localState.activePropertyKey = '';
        renderWorkMgmt();
      });
    }
    const propertyList = document.getElementById('workMgmtRows');
    if (propertyList && propertyList.dataset.bound !== 'true') {
      propertyList.dataset.bound = 'true';
      propertyList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-property-key]');
        if (!btn) return;
        localState.activePropertyKey = String(btn.dataset.propertyKey || '').trim();
        renderWorkMgmt();
      });
    }
  };

  AdminModules.dashboard = mod;
})();
