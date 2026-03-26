(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const localState = {
    activeActorId: 'all',
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

  function buildActorBuckets(items) {
    const buckets = new Map();
    for (const row of Array.isArray(items) ? items : []) {
      const actorId = String(row?.actor_id || '').trim() || 'unknown';
      const actorName = String(row?.actor_name || '미상').trim() || '미상';
      const existing = buckets.get(actorId) || { actorId, actorName, items: [] };
      existing.items.push(row);
      buckets.set(actorId, existing);
    }
    return [...buckets.values()].sort((a, b) => a.actorName.localeCompare(b.actorName, 'ko'));
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
      const key = String(row?.property_id || row?.property_identity_key || row?.property_item_no || row?.property_address || row?.id || '').trim();
      if (!key) continue;
      const groupKey = `${actorId}::${key}`;
      let bucket = map.get(groupKey);
      if (!bucket) {
        const item = findPropertyLike(row);
        bucket = {
          actorId,
          actorName: String(row?.actor_name || '미상').trim() || '미상',
          row,
          item,
          latestAt: String(row?.created_at || row?.action_date || '').trim(),
          counts: { rights_analysis: 0, site_inspection: 0, daily_issue: 0, new_property: 0 },
        };
        map.set(groupKey, bucket);
        groups.push(bucket);
      }
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

  function renderActorChips(actors) {
    const { els } = ctx();
    if (!els.workMgmtActors) return;
    const selected = localState.activeActorId || 'all';
    const allTotal = actors.reduce((sum, actor) => sum + actor.items.length, 0);
    els.workMgmtActors.innerHTML = [
      `<button type="button" class="work-actor-chip ${selected === 'all' ? 'is-active' : ''}" data-actor-id="all">전체 <strong>${Number(allTotal).toLocaleString('ko-KR')}</strong></button>`,
      ...actors.map((actor) => `
        <button type="button" class="work-actor-chip ${selected === actor.actorId ? 'is-active' : ''}" data-actor-id="${esc(actor.actorId)}">
          ${esc(actor.actorName)} <strong>${Number(actor.items.length).toLocaleString('ko-KR')}</strong>
        </button>`)
    ].join('');
  }

  function renderWorkRows(groups) {
    const { els } = ctx();
    if (!els.workMgmtRows || !els.workMgmtEmpty) return;
    if (!groups.length) {
      els.workMgmtRows.innerHTML = '';
      els.workMgmtEmpty.classList.remove('hidden');
      return;
    }
    els.workMgmtEmpty.classList.add('hidden');
    els.workMgmtRows.innerHTML = groups.map((group) => {
      const item = group.item;
      const sourceType = String(item?.sourceType || '').trim() || 'general';
      const sourceText = sourceLabel(sourceType);
      const title = buildPropertyTitle(group);
      const metaParts = [group.actorName];
      const itemNo = String(item?.itemNo || group?.row?.property_item_no || '').trim();
      if (itemNo) metaParts.push(itemNo);
      const actionNodes = Object.entries(group.counts)
        .filter(([, count]) => Number(count || 0) > 0)
        .map(([key, count]) => `<div class="work-action-pill ${actionClass(key)}"><span>${esc(actionLabel(key))}</span> <strong>${Number(count).toLocaleString('ko-KR')}건</strong></div>`)
        .join('');
      return `
        <div class="work-row">
          <div class="work-property-node">
            <div class="work-property-card">
              <span class="work-source-tag ${sourceClass(sourceType)}">${esc(sourceText)}</span>
              <span class="work-property-text">${esc(title)}</span>
              <span class="work-property-meta">${esc(metaParts.join(' · '))}</span>
            </div>
          </div>
          <div class="work-action-list">${actionNodes}</div>
        </div>`;
    }).join('');
  }

  function renderWorkMgmt() {
    const { els } = ctx();
    const items = Array.isArray(localState.data?.items) ? localState.data.items : [];
    const actors = buildActorBuckets(items);
    const selectedActorId = localState.activeActorId || 'all';
    const filteredItems = selectedActorId === 'all'
      ? items
      : items.filter((row) => String(row?.actor_id || '').trim() === selectedActorId);
    const groups = groupWorkRows(filteredItems);
    renderActorChips(actors);
    renderWorkRows(groups);
    if (els.workMgmtMeta) {
      const actorText = selectedActorId === 'all'
        ? `담당자 ${Number(actors.length).toLocaleString('ko-KR')}명`
        : `선택 담당자 ${Number(actors.find((actor) => actor.actorId === selectedActorId)?.items.length || 0).toLocaleString('ko-KR')}건`;
      const totalText = `업무 로그 ${Number(items.length).toLocaleString('ko-KR')}건`;
      els.workMgmtMeta.textContent = `${localState.dateKey || getTodayDateKey()} 기준 · ${actorText} · ${totalText}`;
    }
  }

  mod.refreshWorkMgmt = async function refreshWorkMgmt(options = {}) {
    const { els, api, utils } = ctx();
    if (localState.loading && !options.force) return localState.data;
    const dateKey = String(options.dateKey || els.workMgmtDate?.value || localState.dateKey || getTodayDateKey()).trim() || getTodayDateKey();
    localState.loading = true;
    localState.dateKey = dateKey;
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
        renderWorkMgmt();
      });
    }
  };

  AdminModules.dashboard = mod;
})();
