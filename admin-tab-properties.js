(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const PropertyRenderers = window.KNSN_PROPERTY_RENDERERS || null;
  let adminSaveFlashTimer = null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return {
      rt,
      state: rt.state || {},
      els: rt.els || {},
      K: rt.K,
      api: rt.adminApi,
      utils: rt.utils || {},
    };
  }

  function getStaffNameByIdLocal(state, id) {
    const key = String(id || '').trim();
    if (!key) return '';
    return (state.staff || []).find((s) => String(s.id || '').trim() === key)?.name || '';
  }

  function normalizeAssigneeNameKey(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  const AUCTION_PROGRESS_STATUS_OPTIONS = [
    '유찰 1회', '유찰 2회', '유찰 3회', '유찰 4회', '유찰 5회', '유찰 6회', '유찰 7회',
    '낙찰', '취하', '변경',
  ];
  const PLAIN_PROGRESS_STATUS_OPTIONS = ['관찰', '협상', '보류'];

  function getProgressStatusOptionsForBucket(bucket = '') {
    const key = String(bucket || '').trim();
    if (key === 'auction' || key === 'onbid') return AUCTION_PROGRESS_STATUS_OPTIONS.slice();
    if (key === 'realtor_naver' || key === 'realtor_direct' || key === 'general' || key === 'realtor') {
      return PLAIN_PROGRESS_STATUS_OPTIONS.slice();
    }
    return [...AUCTION_PROGRESS_STATUS_OPTIONS, ...PLAIN_PROGRESS_STATUS_OPTIONS];
  }

  function ensureProgressStatusSelect(selectEl, currentValue = '', bucket = '') {
    if (!selectEl) return;
    const current = String(currentValue || '').trim();
    const values = getProgressStatusOptionsForBucket(bucket);
    if (current && !values.includes(current)) values.unshift(current);
    selectEl.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '선택';
    selectEl.appendChild(emptyOption);
    values.forEach((value) => {
      const optionEl = document.createElement('option');
      optionEl.value = value;
      optionEl.textContent = value;
      selectEl.appendChild(optionEl);
    });
    selectEl.value = current;
  }

  function getAssigneeFilterMeta(state, row) {
    const assignedId = String(row?.assignedAgentId || row?.assigneeId || row?._raw?.assignee_id || row?._raw?.assignedAgentId || '').trim();
    const assignedName = String(row?.assignedAgentName || row?.assigneeName || row?._raw?.assignee_name || row?._raw?.assignedAgentName || getStaffNameByIdLocal(state, assignedId) || '').replace(/\s+/g, ' ').trim();
    if (assignedId) return { value: `id:${assignedId}`, label: assignedName || '담당자' };
    const normalizedName = normalizeAssigneeNameKey(assignedName);
    if (normalizedName) return { value: `name:${normalizedName}`, label: assignedName };
    return { value: '__unassigned__', label: '미배정' };
  }

  function matchesAssigneeFilterValue(state, row, selectedValue) {
    const selected = String(selectedValue || '').trim();
    if (!selected) return true;
    if (selected === '__assigned__') return getAssigneeFilterMeta(state, row).value !== '__unassigned__';
    return getAssigneeFilterMeta(state, row).value === selected;
  }

  function renderAssigneeFilterOptions(selectEl, rows, state, selectedValue) {
    if (!selectEl) return;
    const list = Array.isArray(rows) ? rows : [];
    const current = String(selectedValue || '').trim();
    const optionMap = new Map();
    const touch = (value, label, count = 0, order = Number.MAX_SAFE_INTEGER) => {
      const key = String(value || '').trim();
      if (!key && key !== '') return;
      const prev = optionMap.get(key);
      if (prev) {
        prev.count += Number(count || 0);
        if ((!prev.label || prev.label === '담당자') && label) prev.label = label;
        if (order < prev.order) prev.order = order;
        return prev;
      }
      const next = { value: key, label: String(label || '').trim() || '담당자', count: Number(count || 0), order };
      optionMap.set(key, next);
      return next;
    };

    const totalCount = Number(state?.propertyTotalCount || 0) > list.length ? Number(state.propertyTotalCount) : list.length;
    touch('', '담당자별 선택 필터', totalCount, -1);
    touch('__unassigned__', '미배정', 0, -0.8);

    (Array.isArray(state?.staff) ? state.staff : []).forEach((staff, index) => {
      const id = String(staff?.id || '').trim();
      if (!id) return;
      const label = String(staff?.name || staff?.email || '담당자').replace(/\s+/g, ' ').trim();
      touch(`id:${id}`, label, 0, index);
    });

    list.forEach((row) => {
      const meta = getAssigneeFilterMeta(state, row);
      touch(meta.value, meta.label, 1);
    });

    // 배정(XX) 집계: 전체 - 미배정
    const unassignedEntry = optionMap.get('__unassigned__');
    const localAssignedCount = list.length - (unassignedEntry ? unassignedEntry.count : 0);
    // 서버 overview에 assignee counts가 있으면 사용
    const overviewAssigneeCounts = state?.propertyOverview?.filterCounts?.assignee || null;
    const assignedCount = overviewAssigneeCounts
      ? (totalCount - Number(overviewAssigneeCounts.unassigned || 0))
      : localAssignedCount;
    const unassignedTotalCount = overviewAssigneeCounts
      ? Number(overviewAssigneeCounts.unassigned || 0)
      : (unassignedEntry ? unassignedEntry.count : 0);
    if (unassignedEntry) unassignedEntry.count = unassignedTotalCount;
    touch('__assigned__', '배정', assignedCount, -0.5);

    if (current && !optionMap.has(current)) {
      if (current === '__unassigned__') touch(current, '미배정', 0);
      else if (current === '__assigned__') touch(current, '배정', assignedCount);
      else touch(current, current.startsWith('name:') ? current.slice(5) : '담당자', 0);
    }

    const options = [...optionMap.values()]
      .filter((item) => item.value === '' || item.value === '__assigned__' || item.value === '__unassigned__' || item.count > 0 || item.value === current)
      .sort((a, b) => {
        if (a.value === '') return -1;
        if (b.value === '') return 1;
        if (a.order !== b.order) return a.order - b.order;
        return String(a.label || '').localeCompare(String(b.label || ''), 'ko');
      });

    selectEl.innerHTML = '';
    options.forEach((item) => {
      const optionEl = document.createElement('option');
      optionEl.value = item.value;
      optionEl.textContent = formatOptionLabel(item.label, item.count);
      selectEl.appendChild(optionEl);
    });
    selectEl.value = options.some((item) => item.value === current) ? current : '';
  }

  function nl2brEscaped(utils, value) {
    const safe = utils.escapeHtml(String(value || ''));
    return safe.replace(/\r?\n/g, '<br/>');
  }

  function renderDetailIndicator(kind, text, utils) {
    const raw = String(text || '').trim();
    if (!raw) return '-';
    const label = kind === 'opinion' ? '담당자 의견' : '현장실사';
    const content = nl2brEscaped(utils, raw);
    return `
      <div class="detail-indicator" data-detail-kind="${utils.escapeAttr(kind)}">
        <button type="button" class="detail-ok-btn" aria-label="${utils.escapeAttr(label)} 내용 보기">
          <span class="detail-ok-icon" aria-hidden="true"></span>
        </button>
        <div class="detail-popover" role="tooltip">${content}</div>
      </div>`;
  }


  function truncateDisplayText(value, maxLength) {
    if (PropertyRenderers && typeof PropertyRenderers.truncateDisplayText === 'function') {
      return PropertyRenderers.truncateDisplayText(value, maxLength);
    }
    return String(value ?? '').trim();
  }

  function getFloorDisplayValue(item) {
    const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
    if (PropertyDomain && typeof PropertyDomain.getFloorDisplayValue === 'function') {
      return PropertyDomain.getFloorDisplayValue(item);
    }
    if (PropertyRenderers && typeof PropertyRenderers.getFloorDisplayValue === 'function') {
      return PropertyRenderers.getFloorDisplayValue(item);
    }
    return String(item?.floor || item?._raw?.floor || '').trim();
  }

  function getCurrentPriceValue(row) {
    const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
    if (PropertyDomain && typeof PropertyDomain.getCurrentPriceValue === 'function') {
      return PropertyDomain.getCurrentPriceValue(row);
    }
    if (PropertyRenderers && typeof PropertyRenderers.getCurrentPriceValue === 'function') {
      return PropertyRenderers.getCurrentPriceValue(row);
    }
    return Number(row?.lowprice || row?.priceMain || 0) || 0;
  }

  function getRatioValue(row, utils) {
    const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
    if (PropertyDomain && typeof PropertyDomain.getRatioValue === 'function') {
      return PropertyDomain.getRatioValue(row, utils);
    }
    if (PropertyRenderers && typeof PropertyRenderers.getRatioValue === 'function') {
      return PropertyRenderers.getRatioValue(row, utils);
    }
    const base = Number(row?.priceMain || 0);
    const current = Number(getCurrentPriceValue(row) || 0);
    return Number.isFinite(base) && Number.isFinite(current) && base > 0 && current > 0 ? current / base : -1;
  }


  function formatDateCell(utils, value) {
    const text = typeof utils?.formatDate === 'function' ? utils.formatDate(value) : String(value || '').trim();
    const normalized = String(text || '').trim() || '-';
    return typeof utils?.escapeHtml === 'function' ? utils.escapeHtml(normalized) : normalized;
  }

  const SOURCE_FILTER_OPTIONS = (window.KNSN_PROPERTY_DOMAIN && Array.isArray(window.KNSN_PROPERTY_DOMAIN.PROPERTY_SOURCE_FILTER_OPTIONS) ? window.KNSN_PROPERTY_DOMAIN.PROPERTY_SOURCE_FILTER_OPTIONS : [
    { value: '', label: '전체' },
    { value: 'auction', label: '경매' },
    { value: 'onbid', label: '공매' },
    { value: 'realtor_naver', label: '네이버중개' },
    { value: 'realtor_direct', label: '일반중개' },
    { value: 'general', label: '일반' },
  ]);

  const AREA_FILTER_OPTIONS = (window.KNSN_PROPERTY_DOMAIN && Array.isArray(window.KNSN_PROPERTY_DOMAIN.PROPERTY_AREA_FILTER_OPTIONS) ? window.KNSN_PROPERTY_DOMAIN.PROPERTY_AREA_FILTER_OPTIONS : [
    { value: '', label: '전체 면적' },
    { value: '0-5', label: '5평 미만' },
    { value: '5-10', label: '5~10평' },
    { value: '10-20', label: '10~20평' },
    { value: '20-30', label: '20~30평' },
    { value: '30-50', label: '30~50평' },
    { value: '50-100', label: '50평~100평미만' },
    { value: '100-', label: '100평 이상' },
  ]);

  const PRICE_FILTER_OPTIONS = (window.KNSN_PROPERTY_DOMAIN && Array.isArray(window.KNSN_PROPERTY_DOMAIN.PROPERTY_PRICE_FILTER_OPTIONS) ? window.KNSN_PROPERTY_DOMAIN.PROPERTY_PRICE_FILTER_OPTIONS : [
    { value: '', label: '전체 가격' },
    { value: '0-1', label: '1억 미만' },
    { value: '1-3', label: '1~3억' },
    { value: '3-5', label: '3~5억' },
    { value: '5-10', label: '5~10억' },
    { value: '10-20', label: '10~20억' },
    { value: '20-', label: '20억 이상' },
  ]);

  const RATIO_FILTER_OPTIONS = (window.KNSN_PROPERTY_DOMAIN && Array.isArray(window.KNSN_PROPERTY_DOMAIN.PROPERTY_RATIO_FILTER_OPTIONS) ? window.KNSN_PROPERTY_DOMAIN.PROPERTY_RATIO_FILTER_OPTIONS : [
    { value: '', label: '전체 비율' },
    { value: '50', label: '50% 이하' },
  ]);

  function isPlainSourceFilterSelected(value) {
    // 배열 지원: 모든 선택값이 plain이면 true
    if (Array.isArray(value)) {
      return value.length > 0 && value.every((v) => {
        const k = String(v || '').trim();
        return k === 'realtor_naver' || k === 'realtor_direct' || k === 'general';
      });
    }
    const key = String(value || '').trim();
    return key === 'realtor_naver' || key === 'realtor_direct' || key === 'general';
  }

  // ── 전체리스트 다중 선택 필터 ──
  const PROP_FILTER_DEFS = {
    propSourceFilter: { placeholder: '구분별 선택 필터', stateKey: 'activeCard', options: SOURCE_FILTER_OPTIONS.filter((o) => o.value) },
    propAreaFilter: { placeholder: '전체 면적', stateKey: 'area', options: AREA_FILTER_OPTIONS.filter((o) => o.value) },
    propPriceFilter: { placeholder: '전체 가격', stateKey: 'priceRange', options: PRICE_FILTER_OPTIONS.filter((o) => o.value) },
    propRatioFilter: { placeholder: '전체 비율', stateKey: 'ratio50', options: RATIO_FILTER_OPTIONS.filter((o) => o.value) },
  };
  const _propMultiState = {};
  const _propMultiPanels = [];
  const _propMultiCheckboxes = {};

  function closePropPanels() {
    _propMultiPanels.forEach(function(ref) { ref.panel.style.display = 'none'; ref.isOpen = false; });
  }

  function buildPropMultiSelect(container, filterKey, onChange) {
    const def = PROP_FILTER_DEFS[filterKey];
    if (!container || !def) return;
    _propMultiState[filterKey] = new Set();
    _propMultiCheckboxes[filterKey] = [];
    const selected = _propMultiState[filterKey];

    container.innerHTML = '';
    container.style.cssText = 'position:relative;display:inline-block;min-width:130px;';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'width:100%;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:7px 28px 7px 10px;font-size:13px;border:1px solid var(--line,#ddd);border-radius:6px;background:var(--surface,#fff);color:var(--text,#333);';
    btn.textContent = def.placeholder;
    container.appendChild(btn);

    const arrow = document.createElement('span');
    arrow.textContent = '▾';
    arrow.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:11px;color:var(--muted,#999);';
    container.appendChild(arrow);

    const panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:6px 0;min-width:180px;max-height:300px;overflow-y:auto;';
    document.body.appendChild(panel);

    const ref = { panel: panel, isOpen: false };
    _propMultiPanels.push(ref);

    def.options.forEach(function(opt) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:6px 14px;cursor:pointer;font-size:13px;white-space:nowrap;user-select:none;';
      row.addEventListener('mouseenter', function() { row.style.background = 'var(--hover-bg,#f5f5f5)'; });
      row.addEventListener('mouseleave', function() { row.style.background = ''; });
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = opt.value;
      cb.style.cssText = 'margin:0;flex-shrink:0;';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = opt.label;
      cb.addEventListener('change', function(e) {
        e.stopPropagation();
        if (cb.checked) selected.add(opt.value); else selected.delete(opt.value);
        syncBtnText();
        if (typeof onChange === 'function') onChange();
      });
      row.appendChild(cb);
      row.appendChild(labelSpan);
      panel.appendChild(row);
      _propMultiCheckboxes[filterKey].push({ value: opt.value, cb: cb, labelSpan: labelSpan, baseLabel: opt.label });
    });

    function syncBtnText() {
      if (!selected.size) { btn.textContent = def.placeholder; return; }
      const labels = def.options.filter(function(o) { return selected.has(o.value); }).map(function(o) { return o.label; });
      btn.textContent = labels.length <= 2 ? labels.join(', ') : labels.slice(0, 2).join(', ') + ' +' + (labels.length - 2);
    }
    // 외부에서 label 업데이트 후 버튼 텍스트 갱신용
    container._syncBtnText = syncBtnText;

    function positionPanel() {
      const r = btn.getBoundingClientRect();
      panel.style.top = (r.bottom + 2) + 'px';
      panel.style.left = r.left + 'px';
      panel.style.minWidth = Math.max(r.width, 180) + 'px';
    }

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const wasOpen = ref.isOpen;
      closePropPanels();
      if (!wasOpen) { positionPanel(); panel.style.display = 'block'; ref.isOpen = true; }
    });
    panel.addEventListener('click', function(e) { e.stopPropagation(); });
  }

  if (!window.__knsnPropPanelClose) {
    window.__knsnPropPanelClose = true;
    document.addEventListener('click', function() { closePropPanels(); });
  }

  let _propFiltersInitialized = false;
  mod.initPropMultiSelectFilters = function initPropMultiSelectFilters() {
    if (_propFiltersInitialized) return;
    _propFiltersInitialized = true;
    const { state, els, utils } = ctx();
    const onChange = function() {
      // 다중 선택값을 state.propertyFilters에 배열로 저장
      state.propertyFilters.activeCard = [...(_propMultiState.propSourceFilter || [])];
      state.propertyFilters.area = [...(_propMultiState.propAreaFilter || [])];
      state.propertyFilters.priceRange = [...(_propMultiState.propPriceFilter || [])];
      state.propertyFilters.ratio50 = [...(_propMultiState.propRatioFilter || [])];
      state.propertyPage = 1;
      if (typeof utils.loadProperties === 'function') {
        utils.loadProperties({ refreshSummary: false }).catch(function() {});
      }
    };
    buildPropMultiSelect(els.propSourceFilter, 'propSourceFilter', onChange);
    buildPropMultiSelect(els.propAreaFilter, 'propAreaFilter', onChange);
    buildPropMultiSelect(els.propPriceFilter, 'propPriceFilter', onChange);
    buildPropMultiSelect(els.propRatioFilter, 'propRatioFilter', onChange);
  };

  function truncateAddressText(value, maxLength = 30) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    const limit = Number(maxLength || 0);
    if (!text) return '';
    if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
    return `${text.slice(0, limit)}...`;
  }

  function renderPropertiesTableHeader(usePlainLayout) {
    const { els } = ctx();
    const headRow = els.propertiesTableHeadRow || document.getElementById('propertiesTableHeadRow');
    if (!headRow) return;
    headRow.innerHTML = usePlainLayout
      ? `
        <th class="check-col"><label class="check-wrap"><input id="propSelectAll" type="checkbox" /></label></th>
        <th>구분</th><th>물건번호</th><th>주소</th><th>유형</th><th>층수</th><th>전용면적(평)</th>
        <th>공용면적(평)</th><th>토지면적(평)</th><th>사용승인</th><th class="sortable-th" data-prop-sort="priceMain">감정가(매각가)</th>
        <th>담당자</th><th>현장실사</th><th>등록일</th>
      `
      : `
        <th class="check-col"><label class="check-wrap"><input id="propSelectAll" type="checkbox" /></label></th>
        <th>구분</th><th>물건번호</th><th>주소</th><th>유형</th><th>층수</th><th>전용면적(평)</th>
        <th class="sortable-th" data-prop-sort="priceMain">감정가(매각가)</th><th class="sortable-th" data-prop-sort="currentPrice">현재가격</th><th class="sortable-th" data-prop-sort="ratio">비율</th>
        <th>주요일정</th><th>담당자</th><th>담당자 의견</th><th>현장실사</th><th>등록일</th>
      `;
    const selectAll = headRow.querySelector('#propSelectAll');
    if (selectAll) {
      selectAll.checked = false;
      selectAll.addEventListener('change', (e) => {
        const checked = !!e.target.checked;
        document.querySelectorAll('.prop-row-check').forEach((node) => {
          node.checked = checked;
          const id = String(node.dataset.propId || '').trim();
          if (!id) return;
          const { state } = ctx();
          if (checked) state.selectedPropertyIds.add(id);
          else state.selectedPropertyIds.delete(id);
          node.closest('tr')?.classList.toggle('row-selected', checked);
        });
      });
    }
  }

  function getPropertyFilterSourceRows(state) {
    if (Array.isArray(state?.propertiesFullCache) && state.propertiesFullCache.length) return state.propertiesFullCache;
    if (Array.isArray(state?.homeSummarySnapshot) && state.homeSummarySnapshot.length) return state.homeSummarySnapshot;
    return Array.isArray(state?.properties) ? state.properties : [];
  }

  const matchesAreaFilterValue = (value, area) => {
    if (window.KNSN_PROPERTY_DOMAIN && typeof window.KNSN_PROPERTY_DOMAIN.matchesAreaFilter === 'function') {
      return window.KNSN_PROPERTY_DOMAIN.matchesAreaFilter(value, area);
    }
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = parseFloat(minStr) || 0;
    const max = maxStr ? parseFloat(maxStr) : Infinity;
    const numericArea = Number(area);
    if (!Number.isFinite(numericArea) || numericArea <= 0) return false;
    return numericArea >= min && (max === Infinity || numericArea < max);
  }

  const matchesPriceRangeValue = (value, row) => {
    if (window.KNSN_PROPERTY_DOMAIN && typeof window.KNSN_PROPERTY_DOMAIN.matchesPriceRangeFilter === 'function') {
      return window.KNSN_PROPERTY_DOMAIN.matchesPriceRangeFilter(value, row);
    }
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = (parseFloat(minStr) || 0) * 100000000;
    const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
    const sourceType = String(row?.sourceType || '').trim();
    const isAuctionType = sourceType === 'auction' || sourceType === 'onbid';
    const price = isAuctionType ? getCurrentPriceValue(row) : (Number(row?.priceMain || 0) || 0);
    if (!price || price <= 0) return false;
    return price >= min && (max === Infinity || price < max);
  }

  const matchesRatioFilterValue = (value, row) => {
    if (window.KNSN_PROPERTY_DOMAIN && typeof window.KNSN_PROPERTY_DOMAIN.matchesRatioFilter === 'function') {
      return window.KNSN_PROPERTY_DOMAIN.matchesRatioFilter(value, row);
    }
    if (!value) return true;
    const sourceType = String(row?.sourceType || '').trim();
    if (sourceType !== 'auction' && sourceType !== 'onbid') return false;
    const ratio = getRatioValue(row, {});
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 0.5;
  }

  function formatOptionLabel(label, count) {
    return `${label} (${Number(count || 0).toLocaleString('ko-KR')})`;
  }

  function applySelectOptionCounts(selectEl, options, counts, formatter) {
    if (!selectEl) return;
    const countMap = counts || {};
    options.forEach((optionDef, index) => {
      const optionEl = selectEl.options[index];
      if (!optionEl) return;
      optionEl.textContent = formatter(optionDef, Number(countMap[optionDef.value] || 0));
    });
  }

  function applyPropertySort(rows, state, utils) {
    const sortKey = String(state?.propertySort?.key || '').trim();
    if (!sortKey) return rows;
    const direction = String(state?.propertySort?.direction || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const sorted = [...rows];
    const valueFor = (row) => {
      if (sortKey === 'priceMain') return Number(row?.priceMain || 0) || 0;
      if (sortKey === 'currentPrice') return getCurrentPriceValue(row);
      if (sortKey === 'ratio') return getRatioValue(row, utils);
      return 0;
    };
    sorted.sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (bv === av) return 0;
      return (bv > av ? 1 : -1) * direction;
    });
    return sorted;
  }

  function bindPropertySortHeaders() {
    const { state, els, utils } = ctx();
    const headers = document.querySelectorAll('[data-prop-sort]');
    headers.forEach((th) => {
      if (th.dataset.boundSort === '1') return;
      th.dataset.boundSort = '1';
      th.addEventListener('click', async () => {
        const key = String(th.dataset.propSort || '').trim();
        if (!key) return;
        state.propertySort = { key, direction: 'desc' };
        headers.forEach((node) => node.classList.toggle('is-active', node === th));
        state.propertyPage = 1;
        try {
          if (state.propertyMode === 'page') {
            await utils.loadProperties({ refreshSummary: false, forceFull: true });
          } else {
            mod.renderPropertiesTable();
          }
        } catch (err) {
          if (typeof utils.handleAsyncError === 'function') utils.handleAsyncError(err, '물건 목록 정렬 실패');
        }
      });
    });
    headers.forEach((node) => node.classList.toggle('is-active', node.dataset.propSort === String(state?.propertySort?.key || '')));
  }

  function formatModalAreaValue(sourceType, value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (String(sourceType || '') === 'onbid') return n.toFixed(2);
    return Number.isInteger(n) ? String(n) : String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function resolvePropertySourceBucket(utils, item, sourceType, submitterType) {
    const PropertyDomain = utils?.PropertyDomain;
    const normalizedSource = PropertyDomain && typeof PropertyDomain.normalizeSourceType === 'function'
      ? PropertyDomain.normalizeSourceType(sourceType || item?.sourceType || item?._raw?.source_type || item?._raw?.raw?.source_type || '', { fallback: '' })
      : String(sourceType || item?.sourceType || '').trim().toLowerCase();
    const normalizedSubmitter = PropertyDomain && typeof PropertyDomain.normalizeSubmitterType === 'function'
      ? PropertyDomain.normalizeSubmitterType(submitterType || item?.submitterType || item?._raw?.submitter_type || item?._raw?.raw?.submitter_type || '', { fallback: '' })
      : String(submitterType || item?.submitterType || '').trim().toLowerCase();
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function') {
      return PropertyDomain.getSourceBucket({
        ...(item || {}),
        sourceType: normalizedSource || sourceType || item?.sourceType || '',
        source_type: normalizedSource || sourceType || item?.sourceType || '',
        submitterType: normalizedSubmitter || submitterType || item?.submitterType || '',
        submitter_type: normalizedSubmitter || submitterType || item?.submitterType || '',
      });
    }
    return normalizedSource || 'general';
  }

  function extractPropertyContactInfo(view = {}, item = {}) {
    const row = item?._raw && typeof item._raw === 'object' ? item._raw : {};
    const raw = row?.raw && typeof row.raw === 'object' ? row.raw : row;
    const brokerContact = PropertyDomain && typeof PropertyDomain.resolveBrokerContactInfo === 'function'
      ? PropertyDomain.resolveBrokerContactInfo({ ...(item || {}), ...(view || {}) }, raw, row)
      : {
          realtorPhone: utilsFirstText(view?.realtorphone, item?.realtorphone, row?.realtor_phone, row?.realtorphone, raw?.realtorphone, raw?.realtorPhone, ''),
          realtorCell: utilsFirstText(view?.realtorcell, item?.submitter_phone, row?.submitter_phone, row?.submitterPhone, item?.realtorcell, raw?.submitter_phone, raw?.submitterPhone, raw?.realtorcell, raw?.realtorCell, ''),
        };
    return {
      realtorName: utilsFirstText(view?.realtorname, item?.broker_office_name, row?.broker_office_name, item?.realtorname, raw?.broker_office_name, raw?.brokerOfficeName, raw?.realtorname, raw?.realtorName, ''),
      realtorPhone: utilsFirstText(view?.realtorphone, brokerContact?.realtorPhone, ''),
      realtorCell: utilsFirstText(view?.realtorcell, brokerContact?.realtorCell, ''),
      ownerName: utilsFirstText(view?.submitterName, item?.submitter_name, row?.submitter_name, raw?.submitter_name, raw?.submitterName, raw?.registeredByName, ''),
      ownerPhone: utilsFirstText(view?.submitterPhone, item?.submitter_phone, row?.submitter_phone, raw?.submitter_phone, raw?.submitterPhone, ''),
    };
  }

  function utilsFirstText(...values) {
    for (const value of values) {
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return '';
  }


  function toEditSourceTypeValue(item, sourceType, submitterType) {
    const bucket = resolvePropertySourceBucket({ PropertyDomain: window.KNSN_PROPERTY_DOMAIN }, item, sourceType, submitterType);
    return ['auction','onbid','realtor_naver','realtor_direct','general'].includes(bucket) ? bucket : 'general';
  }

  function deriveSubmitterDisplayType(item, view) {
    const raw = item?._raw?.raw && typeof item._raw.raw === 'object' ? item._raw.raw : (item?._raw || {});
    if (raw?.registeredByAdmin) return 'admin';
    if (raw?.registeredByAgent) return 'agent';
    const bucket = toEditSourceTypeValue(item, view?.sourceType || item?.sourceType, view?.submitterType || item?.submitterType);
    if (bucket === 'auction' || bucket === 'onbid' || bucket === 'realtor_naver') return 'admin';
    const value = String(view?.submitterType || item?.submitterType || raw?.submitter_type || raw?.submitterType || '').trim().toLowerCase();
    return value === 'realtor' ? 'realtor' : 'owner';
  }

  function mapDisplaySubmitterLabel(value) {
    const key = String(value || '').trim().toLowerCase();
    if (key === 'admin') return '관리자';
    if (key === 'agent') return '담당자';
    if (key === 'realtor') return '공인중개사';
    return '소유자/일반';
  }

  function toStoredSourceType(bucketValue) {
    const bucket = String(bucketValue || '').trim().toLowerCase();
    if (bucket === 'realtor_naver' || bucket === 'realtor_direct') return 'realtor';
    if (bucket === 'auction' || bucket === 'onbid' || bucket === 'general') return bucket;
    return 'general';
  }

  function toStoredSubmitterType(displayValue, bucketValue) {
    const key = String(displayValue || '').trim().toLowerCase();
    if (key === 'realtor') return 'realtor';
    if (key === 'admin' || key === 'agent' || key === 'owner') return 'owner';
    return String(bucketValue || '').startsWith('realtor_') ? 'realtor' : 'owner';
  }

  function getTodayDateKeyLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getHistoryDateKeyLocal(entry) {
    const value = String(entry?.date || entry?.at || '').trim();
    if (!value) return '';
    const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  function getLatestHistoryEntryLocal(item, kind) {
    const target = String(kind || '').trim();
    const runtimeUtils = (() => {
      try { return ctx().utils || {}; } catch (_) { return {}; }
    })();
    const history = typeof runtimeUtils.loadOpinionHistory === 'function'
      ? runtimeUtils.loadOpinionHistory(item)
      : [];
    return [...(Array.isArray(history) ? history : [])].reverse().find((entry) => String(entry?.kind || 'opinion').trim() === target) || null;
  }

  function getEditorHistoryTextLocal(item, kind, options = {}) {
    const entry = getLatestHistoryEntryLocal(item, kind);
    const text = String(entry?.text || '').trim();
    if (!text) return '';
    if (options.todayOnly && getHistoryDateKeyLocal(entry) !== getTodayDateKeyLocal()) return '';
    return text;
  }

  function appendHistoryIfChangedLocal(item, history, kind, nextText, user, options = {}) {
    const text = String(nextText || '').trim();
    if (!text) return Array.isArray(history) ? history : [];
    const current = String(getEditorHistoryTextLocal(item, kind, { todayOnly: false }) || '').trim();
    if (current === text) return Array.isArray(history) ? history : [];
    return appendOpinionEntryLocal(history, text, user, { ...options, kind });
  }


  function setAdminEditSection(key) {
    const { els } = ctx();
    const activeKey = String(key || 'basic').trim() || 'basic';
    if (Array.isArray(els.aemTabs)) {
      els.aemTabs.forEach((btn) => {
        const isActive = btn.dataset.aemTab === activeKey;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }
    if (Array.isArray(els.aemSections)) {
      els.aemSections.forEach((section) => {
        section.classList.toggle('is-active', section.dataset.aemSectionPage === activeKey);
      });
    }
  }
  mod.setAdminEditSection = setAdminEditSection;

  function arrangeAdminOpinionFields(form) {
    if (!form || !PropertyRenderers || typeof PropertyRenderers.findFieldShell !== 'function') return null;
    const grid = form.querySelector('[data-opinion-grid="admin"]') || form.querySelector('[data-aem-section-page="opinion"] .edit-opinion-grid');
    const ensureShell = (fieldName, label) => {
      const shell = PropertyRenderers.findFieldShell(form, fieldName, { shellSelectors: [`[data-opinion-field="${fieldName}"]`, '[data-aem-field]', '.form-field', '.field'] });
      if (!shell) return null;
      PropertyRenderers.ensureTextareaField?.(form, fieldName, shell, { textareaClass: 'aem-textarea', rows: 8 });
      PropertyRenderers.setFieldLabel?.(shell, label);
      shell.classList.remove('hidden');
      shell.hidden = false;
      shell.style.display = '';
      shell.style.gridColumn = '';
      shell.classList.add('edit-opinion-field');
      return shell;
    };
    const dailyIssueShell = ensureShell('dailyIssue', '금일 이슈사항');
    const siteShell = ensureShell('siteInspection', '현장실사');
    const opinionShell = ensureShell('opinion', '담당자 의견');
    if (grid) {
      if (dailyIssueShell) grid.appendChild(dailyIssueShell);
      if (siteShell) grid.appendChild(siteShell);
      if (opinionShell) grid.appendChild(opinionShell);
    }
    return { dailyIssueShell, siteShell, opinionShell };
  }

function applyAdminPropertyFormMode(els, utils, item, sourceType, submitterType, view) {
    const form = els.aemForm;
    if (!form) return;
    const bucket = resolvePropertySourceBucket(utils, item, sourceType, submitterType);
    const normalizedSource = utils?.PropertyDomain && typeof utils.PropertyDomain.normalizeSourceType === 'function'
      ? utils.PropertyDomain.normalizeSourceType(sourceType || item?.sourceType || '', { fallback: '' })
      : String(sourceType || item?.sourceType || '').trim().toLowerCase();
    const isRealtor = bucket === 'realtor_naver' || bucket === 'realtor_direct' || normalizedSource === 'realtor';
    const isGeneral = bucket === 'general' || normalizedSource === 'general';
    const hideForPlain = isRealtor || isGeneral;
    ensureProgressStatusSelect(form.elements['status'], form.elements['status']?.value || view?.status || item?.status || '', bucket);
    form.querySelectorAll('[data-aem-field="dateMain"], [data-aem-field="currentPrice"]').forEach((node) => {
      node.classList.toggle('hidden', hideForPlain);
    });
    form.querySelectorAll('[data-aem-section="broker"]').forEach((node) => node.classList.toggle('hidden', !isRealtor));
    form.querySelectorAll('[data-aem-section="owner"]').forEach((node) => node.classList.toggle('hidden', !isGeneral));
    const isAuction = bucket === 'auction';
    const isOnbid = bucket === 'onbid';
    form.querySelectorAll('[data-aem-section="auctionInfo"]').forEach((node) => node.classList.toggle('hidden', !isAuction));
    form.querySelectorAll('[data-aem-section="resultInfo"]').forEach((node) => node.classList.toggle('hidden', !(isAuction || isOnbid)));
    const info = extractPropertyContactInfo(view, item);
    const ownerNameEl = form.elements['ownerNameDisplay'];
    const ownerPhoneEl = form.elements['ownerPhoneDisplay'];
    if (ownerNameEl) ownerNameEl.value = info.ownerName || '-';
    if (ownerPhoneEl) ownerPhoneEl.value = info.ownerPhone || '-';
  }

  function toInputDate(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function setAemMsg(els, text, isError = true) {
    if (!els.aemMsg) return;
    if (PropertyRenderers && typeof PropertyRenderers.setFeedbackBoxMessage === 'function') {
      PropertyRenderers.setFeedbackBoxMessage(els.aemMsg, text, { kind: isError ? 'error' : 'success' });
      return;
    }
    els.aemMsg.innerHTML = '';
  }


  function flashAdminSaveNotice(utils, text, duration = 1500) {
    const msg = String(text || '').trim();
    if (!msg) return;
    const setLoading = utils && typeof utils.setAdminLoading === 'function' ? utils.setAdminLoading : null;
    if (!setLoading) return;
    window.clearTimeout(adminSaveFlashTimer);
    setLoading('flashSaveNotice', true, msg);
    adminSaveFlashTimer = window.setTimeout(() => {
      setLoading('flashSaveNotice', false);
    }, Number(duration) > 0 ? Number(duration) : 1500);
  }


  function refreshPropertiesInBackground(state, utils, options = {}) {
    const refreshSummary = !!options.refreshSummary;
    try { utils.invalidatePropertyCollections?.(); } catch {}
    Promise.resolve()
.then(() => utils.loadProperties?.({ refreshSummary, silent: true }))
      .catch((err) => console.warn('properties refresh failed', err));
  }

  function appendOpinionEntryLocal(history, newText, user, options = {}) {
    const domain = PropertyDomain || window.KNSN_ADMIN_RUNTIME?.utils?.PropertyDomain || null;
    if (domain && typeof domain.appendOpinionEntry === 'function') {
      return domain.appendOpinionEntry(history, newText, user, options);
    }
    const text = String(newText || '').trim();
    if (!text) return Array.isArray(history) ? history : [];
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const author = String(user?.name || user?.email || '').trim();
    return [...(Array.isArray(history) ? history : []), { date: today, text, author, kind: String(options.kind || 'opinion').trim() || 'opinion' }];
  }

  function getLatestHistoryText(item, kind) {
    const domain = PropertyDomain || window.KNSN_ADMIN_RUNTIME?.utils?.PropertyDomain || null;
    const history = domain && typeof domain.loadOpinionHistory === 'function' ? domain.loadOpinionHistory(item) : [];
    const target = String(kind || '').trim();
    const latest = [...(Array.isArray(history) ? history : [])].reverse().find((entry) => String(entry?.kind || 'opinion').trim() === target);
    const raw = item?._raw?.raw || {};
    if (latest && String(latest.text || '').trim()) return String(latest.text || '').trim();
    if (target === 'dailyIssue') return String(raw.dailyIssue || raw.daily_issue || '').trim();
    if (target === 'siteInspection') return String(raw.siteInspection || raw.site_inspection || '').trim();
    return '';
  }

  mod.getFilteredProperties = function getFilteredProperties(options = {}) {
    const { state } = ctx();
    const ignoreKeys = Array.isArray(options?.ignoreKeys) ? options.ignoreKeys : [];
    const filters = state.propertyFilters || {};
    const sortKey = String(state?.propertySort?.key || '').trim();
    const auctionOnlyForSort = sortKey === 'currentPrice' || sortKey === 'ratio';
    const sourceRows = getPropertyFilterSourceRows(state);
    const baseRows = auctionOnlyForSort
      ? sourceRows.filter((p) => p.sourceType === 'auction' || p.sourceType === 'onbid')
      : sourceRows;
    const filtered = (window.KNSN_PROPERTY_DOMAIN && typeof window.KNSN_PROPERTY_DOMAIN.applyPropertyFilters === 'function')
      ? window.KNSN_PROPERTY_DOMAIN.applyPropertyFilters(baseRows, filters, {
          ignoreKeys,
          keywordFields: [
            'itemNo', 'address', 'assetType', 'floor', 'totalfloor', 'siteInspection', 'opinion', 'regionGu', 'regionDong', 'status',
            (item) => item.assignedAgentName || getStaffNameByIdLocal(state, item.assignedAgentId),
          ],
        })
      : baseRows;
    const assigneeFiltered = (ignoreKeys.includes('assignee') || !String(filters.assignee || '').trim())
      ? filtered
      : filtered.filter((item) => matchesAssigneeFilterValue(state, item, filters.assignee));
    return applyPropertySort(assigneeFiltered, state, ctx().utils);
  };

  mod.updatePropertyFilterOptionCounts = function updatePropertyFilterOptionCounts() {
    const { state, els, utils } = ctx();
    const filters = state?.propertyFilters || {};
    const toArr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
    const hasLocalOverrides = !!(
      toArr(filters.activeCard).length ||
      String(filters.status || '').trim() ||
      String(filters.keyword || '').trim() ||
      String(filters.assignee || '').trim() ||
      toArr(filters.area).length ||
      toArr(filters.priceRange).length ||
      toArr(filters.ratio50).length ||
      String(state?.propertySort?.key || '').trim()
    );
    const overviewCounts = state?.propertyOverview?.filterCounts || null;

    // 다중 선택 필터 초기화
    mod.initPropMultiSelectFilters();

    if (!Array.isArray(state?.propertiesFullCache) && !Array.isArray(state?.homeSummarySnapshot) && !hasLocalOverrides && overviewCounts) {
      if (overviewCounts.source) updatePropMultiCounts('propSourceFilter', overviewCounts.source);
      if (overviewCounts.area) updatePropMultiCounts('propAreaFilter', overviewCounts.area);
      if (overviewCounts.price) updatePropMultiCounts('propPriceFilter', overviewCounts.price);
      if (overviewCounts.ratio) updatePropMultiCounts('propRatioFilter', overviewCounts.ratio);
      renderAssigneeFilterOptions(els.propAssigneeFilter, getPropertyFilterSourceRows(state), state, filters.assignee);
      return;
    }

    const sourceRows = mod.getFilteredProperties({ ignoreKeys: ['activeCard'] });
    const assigneeRows = mod.getFilteredProperties({ ignoreKeys: ['assignee'] });
    const areaRows = mod.getFilteredProperties({ ignoreKeys: ['area'] });
    const priceRows = mod.getFilteredProperties({ ignoreKeys: ['priceRange'] });
    const ratioRows = mod.getFilteredProperties({ ignoreKeys: ['ratio50'] });

    const sourceCounts = { auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    sourceRows.forEach((row) => {
      const bucket = utils.PropertyDomain && typeof utils.PropertyDomain.getSourceBucket === 'function'
        ? utils.PropertyDomain.getSourceBucket(row)
        : (row.sourceType === 'realtor' ? (row.isDirectSubmission ? 'realtor_direct' : 'realtor_naver') : String(row.sourceType || 'general'));
      if (Object.prototype.hasOwnProperty.call(sourceCounts, bucket)) sourceCounts[bucket] += 1;
    });
    updatePropMultiCounts('propSourceFilter', sourceCounts);

    const areaCounts = {};
    areaRows.forEach((row) => {
      AREA_FILTER_OPTIONS.slice(1).forEach((optionDef) => {
        if (matchesAreaFilterValue(optionDef.value, row?.exclusivearea)) areaCounts[optionDef.value] = (areaCounts[optionDef.value] || 0) + 1;
      });
    });
    updatePropMultiCounts('propAreaFilter', areaCounts);

    const priceCounts = {};
    priceRows.forEach((row) => {
      PRICE_FILTER_OPTIONS.slice(1).forEach((optionDef) => {
        if (matchesPriceRangeValue(optionDef.value, row)) priceCounts[optionDef.value] = (priceCounts[optionDef.value] || 0) + 1;
      });
    });
    updatePropMultiCounts('propPriceFilter', priceCounts);

    const ratioCounts = {};
    ratioRows.forEach((row) => {
      if (matchesRatioFilterValue('50', row)) ratioCounts['50'] = (ratioCounts['50'] || 0) + 1;
    });
    updatePropMultiCounts('propRatioFilter', ratioCounts);

    renderAssigneeFilterOptions(els.propAssigneeFilter, assigneeRows, state, state?.propertyFilters?.assignee);
  };

  function updatePropMultiCounts(filterKey, countMap) {
    const checks = _propMultiCheckboxes[filterKey];
    if (!Array.isArray(checks)) return;
    checks.forEach(function(item) {
      const count = Number(countMap[item.value] || 0);
      item.labelSpan.textContent = item.baseLabel + ' (' + count.toLocaleString('ko-KR') + ')';
    });
    // 버튼 텍스트도 갱신 (선택된 항목의 label이 바뀌었으므로)
    const { els } = ctx();
    const container = els[filterKey];
    if (container && typeof container._syncBtnText === 'function') container._syncBtnText();
  }

  mod.getPagedProperties = function getPagedProperties(rows) {
    const { state } = ctx();
    const totalPages = Math.max(1, Math.ceil(rows.length / state.propertyPageSize));
    if (state.propertyPage > totalPages) state.propertyPage = totalPages;
    if (state.propertyPage < 1) state.propertyPage = 1;
    const start = (state.propertyPage - 1) * state.propertyPageSize;
    return { totalPages, rows: rows.slice(start, start + state.propertyPageSize) };
  };

  mod.renderAdminPropertiesPagination = function renderAdminPropertiesPagination(totalPages) {
    const { state, els, utils } = ctx();
    if (!els.adminPropertiesPagination) return;
    els.adminPropertiesPagination.innerHTML = '';
    if (totalPages <= 1) {
      els.adminPropertiesPagination.classList.add('hidden');
      return;
    }
    els.adminPropertiesPagination.classList.remove('hidden');
    const cur = state.propertyPage;
    const scrollTop = () => {
      const wrap = els.propertiesTableBody?.closest('.table-wrap');
      if (wrap) window.scrollTo({ top: wrap.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
    };
    const go = async (page) => {
      state.propertyPage = Math.max(1, Math.min(totalPages, page));
      if (state.propertyMode === 'page') {
        try {
          await utils.loadProperties({ refreshSummary: false });
        } catch (err) {
          if (typeof utils.handleAsyncError === 'function') utils.handleAsyncError(err, '물건 목록 로드 실패');
          else alert(err?.message || '물건 목록 로드 실패');
        }
      } else {
        mod.renderPropertiesTable();
      }
      scrollTop();
    };

    const frag = document.createDocumentFragment();
    const addBtn = (label, page, disabled = false, active = false, title = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = active ? 'pager-num is-active' : (typeof label === 'number' ? 'pager-num' : 'pager-btn');
      b.textContent = String(label);
      b.disabled = disabled;
      if (title) b.title = title;
      if (!disabled) b.addEventListener('click', () => { void go(page); });
      frag.appendChild(b);
    };

    addBtn('<<', cur - 20, cur - 20 < 1, false, '20페이지 뒤로');
    addBtn('<', cur - 10, cur - 10 < 1, false, '10페이지 뒤로');
    addBtn('이전', cur - 1, cur <= 1);
    const blockSize = 10;
    const blockStart = Math.floor((cur - 1) / blockSize) * blockSize + 1;
    const blockEnd = Math.min(totalPages, blockStart + blockSize - 1);
    for (let p = blockStart; p <= blockEnd; p += 1) addBtn(p, p, false, p === cur);
    addBtn('다음', cur + 1, cur >= totalPages);
    addBtn('>', cur + 10, cur + 10 > totalPages, false, '10페이지 앞으로');
    addBtn('>>', cur + 20, cur + 20 > totalPages, false, '20페이지 앞으로');
    els.adminPropertiesPagination.appendChild(frag);
  };

  mod.pruneSelectedPropertyIds = function pruneSelectedPropertyIds() {
    const { state } = ctx();
    const valid = new Set((state.properties || []).map((p) => String(p.id || p.globalId || '')).filter(Boolean));
    state.selectedPropertyIds = new Set([...state.selectedPropertyIds].filter((id) => valid.has(String(id))));
    mod.updatePropertySelectionControls();
  };

  mod.togglePropertySelection = function togglePropertySelection(id, checked) {
    const { state } = ctx();
    const key = String(id || '').trim();
    if (!key) return;
    if (checked) state.selectedPropertyIds.add(key);
    else state.selectedPropertyIds.delete(key);
    mod.updatePropertySelectionControls();
  };

  mod.toggleSelectAllProperties = function toggleSelectAllProperties(checked) {
    const { state } = ctx();
    const rows = state.propertyMode === 'page' ? (state.properties || []) : mod.getPagedProperties(mod.getFilteredProperties()).rows;
    rows.forEach((p) => {
      const key = String(p.id || p.globalId || '').trim();
      if (!key) return;
      if (checked) state.selectedPropertyIds.add(key);
      else state.selectedPropertyIds.delete(key);
    });
    mod.renderPropertiesTable();
  };

  mod.updatePropertySelectionControls = function updatePropertySelectionControls() {
    const { state, els } = ctx();
    const rows = state.propertyMode === 'page' ? (state.properties || []) : mod.getPagedProperties(mod.getFilteredProperties()).rows;
    const ids = rows.map((p) => String(p.id || p.globalId || '').trim()).filter(Boolean);
    const selectedVisible = ids.filter((id) => state.selectedPropertyIds.has(id));
    if (els.propSelectAll) {
      els.propSelectAll.checked = ids.length > 0 && selectedVisible.length === ids.length;
      els.propSelectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < ids.length;
    }
    if (els.btnDeleteSelectedProperties) {
      const cnt = state.selectedPropertyIds.size;
      els.btnDeleteSelectedProperties.disabled = cnt === 0;
      els.btnDeleteSelectedProperties.textContent = cnt > 0 ? `선택 삭제 (${cnt})` : '선택 삭제';
    }
  };


  async function deletePropertiesWithSupabase(sb, ids) {
    const list = Array.isArray(ids) ? ids.filter(Boolean).map((v) => String(v).trim()).filter(Boolean) : [];
    if (!list.length) return true;
    if (DataAccess && typeof DataAccess.deletePropertiesByIds === 'function') {
      return DataAccess.deletePropertiesByIds(sb, list);
    }
    if (DataAccess && typeof DataAccess.deletePropertyById === 'function') {
      for (const id of list) {
        await DataAccess.deletePropertyById(sb, id);
      }
      return true;
    }
    const pureIds = list.filter((v) => !v.includes(':'));
    const globalIds = list.filter((v) => v.includes(':'));
    if (pureIds.length) {
      const { error } = await sb.from('properties').delete().in('id', pureIds);
      if (error) throw error;
    }
    if (globalIds.length) {
      const { error } = await sb.from('properties').delete().in('global_id', globalIds);
      if (error) throw error;
    }
    return true;
  }

  mod.deleteSelectedProperties = async function deleteSelectedProperties() {
    const { state, K, api, utils } = ctx();
    const ids = [...state.selectedPropertyIds].filter(Boolean);
    if (!ids.length) {
      alert('삭제할 물건을 먼저 선택해 주세요.');
      return;
    }
    if (!window.confirm(`선택한 ${ids.length}건의 물건을 삭제할까요?`)) return;
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    if (sb) {
      await deletePropertiesWithSupabase(sb, ids);
    } else if (DataAccess && typeof DataAccess.deletePropertiesViaAdminApi === 'function') {
      await DataAccess.deletePropertiesViaAdminApi(api, ids, { auth: true });
    } else {
      await api('/admin/properties', { method: 'DELETE', auth: true, body: { ids } });
    }
    state.selectedPropertyIds.clear();
    utils.invalidatePropertyCollections();
    await utils.loadProperties();
  };

  mod.deleteAllProperties = async function deleteAllProperties() {
    const { state, api, utils } = ctx();
    const total = Number(state.propertySummary?.total || state.propertyTotalCount || ((state.properties || []).length));
    if (!total) {
      alert('삭제할 물건이 없습니다.');
      return;
    }
    if (!window.confirm(`현재 등록된 물건 ${total.toLocaleString('ko-KR')}건을 전체삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    if (!window.confirm('정말로 전체삭제를 진행할까요?')) return;
    if (DataAccess && typeof DataAccess.deleteAllPropertiesViaAdminApi === 'function') {
      await DataAccess.deleteAllPropertiesViaAdminApi(api, { auth: true });
    } else {
      await api('/admin/properties', { method: 'DELETE', auth: true, body: { all: true } });
    }
    state.selectedPropertyIds.clear();
    utils.invalidatePropertyCollections();
    await utils.loadProperties();
    alert('전체삭제가 완료되었습니다.');
  };


mod.renderPropertiesTable = function renderPropertiesTable() {
  const { state, els, utils } = ctx();
  const pageMode = state.propertyMode === 'page' && !String(state?.propertySort?.key || '').trim();
  const rows = pageMode ? (state.properties || []) : mod.getFilteredProperties();
  const totalPages = pageMode
    ? Math.max(1, Math.ceil(Number(state.propertyTotalCount || 0) / state.propertyPageSize))
    : Math.max(1, Math.ceil(rows.length / state.propertyPageSize));
  const displayRows = pageMode ? rows : mod.getPagedProperties(rows).rows;
  const usePlainLayout = isPlainSourceFilterSelected(state?.propertyFilters?.activeCard);

  renderPropertiesTableHeader(usePlainLayout);
  if (!els.propertiesTableBody) return;
  bindPropertySortHeaders();
  els.propertiesTableBody.innerHTML = '';

  mod.updatePropertyFilterOptionCounts();

  if (!rows.length) {
    if (els.propertiesEmpty) els.propertiesEmpty.classList.remove('hidden');
    mod.updatePropertySelectionControls();
    mod.renderAdminPropertiesPagination(0);
    return;
  }
  if (els.propertiesEmpty) els.propertiesEmpty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const p of displayRows) {
    const rowId = String(p.id || p.globalId || '').trim();
    const tr = document.createElement('tr');
    if (rowId && state.selectedPropertyIds.has(rowId)) tr.classList.add('row-selected');
    const listView = (utils.PropertyDomain && typeof utils.PropertyDomain.buildPropertyListViewModel === 'function')
      ? utils.PropertyDomain.buildPropertyListViewModel(p)
      : null;
    const bucket = (utils.PropertyDomain && typeof utils.PropertyDomain.getSourceBucket === 'function')
      ? utils.PropertyDomain.getSourceBucket(p)
      : (p.sourceType === 'realtor' ? (p.isDirectSubmission ? 'realtor_direct' : 'realtor_naver') : String(p.sourceType || 'general'));
    const kindLabel = listView?.kindLabel || ((utils.PropertyDomain && typeof utils.PropertyDomain.getSourceBucketLabel === 'function')
      ? utils.PropertyDomain.getSourceBucketLabel(bucket)
      : (p.sourceType === 'auction' ? '경매' : p.sourceType === 'onbid' ? '공매' : p.sourceType === 'realtor' ? (p.isDirectSubmission ? '일반중개' : '네이버중개') : '일반'));
    const kindClass = listView?.kindClass || ((PropertyRenderers && typeof PropertyRenderers.getSourceBucketClass === 'function') ? PropertyRenderers.getSourceBucketClass(bucket) : (bucket === 'auction' ? 'kind-auction' : bucket === 'onbid' ? 'kind-gongmae' : bucket === 'realtor_naver' ? 'kind-realtor-naver' : bucket === 'realtor_direct' ? 'kind-realtor-direct' : 'kind-general'));
    const currentPriceValue = listView?.currentPriceValue ?? getCurrentPriceValue(p);
    const currentPrice = currentPriceValue ? utils.formatMoneyKRW(currentPriceValue) : '-';
    const rate = utils.formatPercent(p.priceMain, currentPriceValue, p._raw || {});
    const floorText = truncateDisplayText(getFloorDisplayValue(p), 7) || '-';
    const addressText = truncateAddressText(listView?.address || p.address || '-', 30) || '-';
    const assetTypeText = truncateDisplayText(listView?.assetType || p.assetType || '-', 7) || '-';
    const exclusiveText = p.exclusivearea != null ? utils.escapeHtml(utils.formatAreaPyeong(p.exclusivearea)) : '-';
    const commonText = p.commonarea != null ? utils.escapeHtml(utils.formatAreaPyeong(p.commonarea)) : '-';
    const siteText = p.sitearea != null ? utils.escapeHtml(utils.formatAreaPyeong(p.sitearea)) : '-';
    const useapprovalText = (utils.formatDate && utils.formatDate(p.useapproval)) || '-';
    const scheduleHtml = typeof utils.formatScheduleHtml === 'function' ? utils.formatScheduleHtml(p) : '-';
    const opinionHtml = renderDetailIndicator('opinion', p.opinion, utils);
    const inspectionHtml = renderDetailIndicator('inspection', p.siteInspection, utils);
    const assigneeText = utils.escapeHtml((p.assignedAgentName || getStaffNameByIdLocal(state, p.assignedAgentId)) || '미배정');
    tr.innerHTML = usePlainLayout
      ? `
      <td class="check-col"><label class="check-wrap"><input class="prop-row-check" type="checkbox" data-prop-id="${utils.escapeAttr(rowId)}" ${rowId && state.selectedPropertyIds.has(rowId) ? 'checked' : ''} /><span></span></label></td>
      <td><span class="kind-text ${utils.escapeAttr(kindClass)}">${utils.escapeHtml(kindLabel)}</span></td>
      <td>${(p.sourceUrl || p.source_url) ? '<a href="' + utils.escapeAttr(p.sourceUrl || p.source_url) + '" target="_blank" rel="noopener" class="item-no-link" title="탱크옥션에서 보기">' + utils.escapeHtml(listView?.itemNo || p.itemNo || '-') + '</a>' : utils.escapeHtml(listView?.itemNo || p.itemNo || '-')}</td>
      <td class="text-cell"><button type="button" class="address-trigger">${utils.escapeHtml(addressText)}</button></td>
      <td>${utils.escapeHtml(assetTypeText)}</td>
      <td>${utils.escapeHtml(String(floorText))}</td>
      <td>${exclusiveText}</td>
      <td>${commonText}</td>
      <td>${siteText}</td>
      <td>${utils.escapeHtml(useapprovalText)}</td>
      <td>${p.priceMain != null ? utils.formatMoneyKRW(p.priceMain) : '-'}</td>
      <td>${assigneeText}</td>
      <td class="indicator-cell">${opinionHtml}</td>
      <td class="indicator-cell">${inspectionHtml}</td>
      <td>${formatDateCell(utils, p.createdAt)}</td>
    `
      : `
      <td class="check-col"><label class="check-wrap"><input class="prop-row-check" type="checkbox" data-prop-id="${utils.escapeAttr(rowId)}" ${rowId && state.selectedPropertyIds.has(rowId) ? 'checked' : ''} /><span></span></label></td>
      <td><span class="kind-text ${utils.escapeAttr(kindClass)}">${utils.escapeHtml(kindLabel)}</span></td>
      <td>${(p.sourceUrl || p.source_url) ? '<a href="' + utils.escapeAttr(p.sourceUrl || p.source_url) + '" target="_blank" rel="noopener" class="item-no-link" title="탱크옥션에서 보기">' + utils.escapeHtml(listView?.itemNo || p.itemNo || '-') + '</a>' : utils.escapeHtml(listView?.itemNo || p.itemNo || '-')}</td>
      <td class="text-cell"><button type="button" class="address-trigger">${utils.escapeHtml(addressText)}</button></td>
      <td>${utils.escapeHtml(assetTypeText)}</td>
      <td>${utils.escapeHtml(String(floorText))}</td>
      <td>${exclusiveText}</td>
      <td>${p.priceMain != null ? utils.formatMoneyKRW(p.priceMain) : '-'}</td>
      <td>${utils.escapeHtml(currentPrice)}</td>
      <td>${utils.escapeHtml(rate)}</td>
      <td class="schedule-cell">${scheduleHtml}</td>
      <td>${assigneeText}</td>
      <td class="indicator-cell">${opinionHtml}</td>
      <td class="indicator-cell">${inspectionHtml}</td>
      <td>${formatDateCell(utils, p.createdAt)}</td>
    `;
    const checkbox = tr.querySelector('.prop-row-check');
    if (checkbox) {
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', (e) => {
        mod.togglePropertySelection(rowId, !!e.target.checked);
        tr.classList.toggle('row-selected', !!e.target.checked);
      });
    }
    const addressTrigger = tr.querySelector('.address-trigger');
    if (addressTrigger) {
      addressTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void mod.openPropertyEditModal(p);
      });
    }
    tr.querySelectorAll('.detail-indicator').forEach((wrap) => {
      const btn = wrap.querySelector('.detail-ok-btn');
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !wrap.classList.contains('is-open');
        document.querySelectorAll('.detail-indicator.is-open').forEach((node) => {
          if (node !== wrap) node.classList.remove('is-open');
        });
        wrap.classList.toggle('is-open', willOpen);
      });
    });
    frag.appendChild(tr);
  }
  els.propertiesTableBody.appendChild(frag);
  mod.updatePropertySelectionControls();
  mod.renderAdminPropertiesPagination(totalPages);
};


  mod.ensureStaffForPropertyModal = async function ensureStaffForPropertyModal() {
    const { state, api, utils } = ctx();
    try {
      await utils.syncSupabaseSessionIfNeeded();
      let res = null;
      if (DataAccess && typeof DataAccess.fetchAdminStaffViaApi === 'function') {
        res = await DataAccess.fetchAdminStaffViaApi(api, { auth: true });
      } else {
        res = await api('/admin/staff', { auth: true });
      }
      state.staff = utils.dedupeStaff((res?.items || []));
      utils.renderSummary();
    } catch (err) {
      console.warn('ensureStaffForPropertyModal failed', err);
    }
  };

  function getImportedSourceNoteInfo(target) {
    const base = target && typeof target === 'object' ? target : {};
    const raw = base?._raw?.raw && typeof base._raw.raw === 'object'
      ? base._raw.raw
      : (base?.raw && typeof base.raw === 'object' ? base.raw : {});
    if (window.KNSN_PROPERTY_DOMAIN && typeof window.KNSN_PROPERTY_DOMAIN.extractDedicatedSourceNote === 'function') {
      const sourceType = base?.sourceType || base?._raw?.source_type || raw.sourceType || raw.source_type || '';
      return window.KNSN_PROPERTY_DOMAIN.extractDedicatedSourceNote(sourceType, base, raw);
    }
    return { label: '', text: '' };
  }

  mod.openPropertyEditModal = async function openPropertyEditModal(item) {
    const { state, els, K, utils } = ctx();
    if (!els.propertyEditModalAdmin || !els.aemForm) return;
    const user = state.session?.user;
    const isAdmin = user?.role === 'admin';
    let workingItem = item;
    if (!isAdmin) {
      const myId = user?.id || '';
      const assignedId = workingItem?.assignedAgentId || '';
      if (assignedId && myId && assignedId !== myId) {
        alert('본인에게 배정된 물건만 수정할 수 있습니다.');
        return;
      }
    }
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    const detailTargetId = String(workingItem?.id || workingItem?.globalId || '').trim();
    if (sb && detailTargetId && typeof utils.fetchPropertyDetail === 'function') {
      try {
        const detailed = await utils.fetchPropertyDetail(sb, detailTargetId);
        if (detailed) workingItem = detailed;
      } catch (err) {
        console.warn('property detail load failed', err);
      }
    }
    state.editingProperty = workingItem;
    if (isAdmin) await mod.ensureStaffForPropertyModal();
    const f = els.aemForm;
    const view = (utils.PropertyDomain && typeof utils.PropertyDomain.buildPropertyEditViewModel === 'function')
      ? (utils.PropertyDomain.buildPropertyEditViewModel(workingItem) || workingItem)
      : workingItem;
    const setVal = (name, v) => {
      const el = f.elements[name];
      if (el) el.value = v == null ? '' : String(v);
    };
    setVal('itemNo', view.itemNo);
    setVal('sourceType', toEditSourceTypeValue(workingItem, view.sourceType, view.submitterType));
    mod.populateAssigneeSelect(view.assignedAgentId || workingItem.assignedAgentId || workingItem.assigneeId || workingItem.assignee_id || '');
    setVal('submitterType', deriveSubmitterDisplayType(workingItem, view));
    setVal('address', view.address);
    const sourceNoteInfo = getImportedSourceNoteInfo(workingItem);
    setVal('sourceNoteDisplay', sourceNoteInfo.text || '');
    const sourceNoteWrap = f.querySelector('[data-aem-source-note]');
    const sourceNoteLabel = sourceNoteWrap?.querySelector('[data-aem-source-note-label]');
    if (sourceNoteWrap) sourceNoteWrap.classList.toggle('hidden', !String(sourceNoteInfo.text || '').trim());
    if (sourceNoteLabel) sourceNoteLabel.textContent = sourceNoteInfo.label || '원본 참고';
    setVal('assetType', view.assetType);
    setVal('floor', view.floor ?? '');
    setVal('totalfloor', view.totalfloor ?? '');
    setVal('commonarea', formatModalAreaValue(view.sourceType, view.commonarea ?? ''));
    setVal('exclusivearea', formatModalAreaValue(view.sourceType, view.exclusivearea ?? ''));
    setVal('sitearea', formatModalAreaValue(view.sourceType, view.sitearea ?? ''));
    setVal('useapproval', view.useapproval ?? '');
    ensureProgressStatusSelect(f.elements['status'], view.status ?? '', toEditSourceTypeValue(workingItem, view.sourceType, view.submitterType));
    setVal('priceMain', utils.formatMoneyInputValue(view.priceMain ?? ''));
    setVal('lowprice', utils.formatMoneyInputValue(view.currentPriceValue ?? view.lowprice ?? ''));
    setVal('dateMain', toInputDate(view.dateMain) ?? '');
    setVal('date', utils.formatDate(view.createdAt) ?? '');
    setVal('realtorname', view.realtorname ?? '');
    setVal('realtorphone', view.realtorphone ?? '');
    setVal('realtorcell', view.realtorcell ?? '');
    const _brokerInfo = extractPropertyContactInfo(view, workingItem);
    if (_brokerInfo.realtorName) setVal('realtorname', _brokerInfo.realtorName);
    if (_brokerInfo.realtorPhone) setVal('realtorphone', _brokerInfo.realtorPhone);
    if (_brokerInfo.realtorCell) setVal('realtorcell', _brokerInfo.realtorCell);
    const _editRaw = workingItem?._raw?.raw && typeof workingItem._raw.raw === 'object' ? workingItem._raw.raw : (workingItem?.raw && typeof workingItem.raw === 'object' ? workingItem.raw : {});
    if (!f.elements['realtorphone']?.value) setVal('realtorphone', _editRaw['중개사 유선전화'] || _editRaw['중개사무소전화'] || _editRaw['대표전화'] || _editRaw.realtorPhone || '');
    if (!f.elements['realtorcell']?.value) setVal('realtorcell', _editRaw['중개사 휴대폰'] || _editRaw['휴대폰번호'] || _editRaw['휴대폰'] || _editRaw.realtorCell || '');
    const brokerMemoEl = f.elements['brokerMemoDisplay'];
    if (brokerMemoEl) brokerMemoEl.value = _editRaw.memo || _editRaw.importedSourceText || _editRaw.sourceNoteText || _editRaw['매물특징'] || '';
    const auctionInfoEl = f.elements['auctionInfoDisplay'];
    if (auctionInfoEl) auctionInfoEl.value = _editRaw['경매현황'] || _editRaw.auctionStatus || _editRaw.auction_status || '';
    const auctionBigoEl = f.elements['auctionBigoDisplay'];
    if (auctionBigoEl) auctionBigoEl.value = _editRaw['비고'] || '';
    setVal('siteInspection', getEditorHistoryTextLocal(workingItem, 'siteInspection') || view.siteInspection || '');
    setVal('opinion', getEditorHistoryTextLocal(workingItem, 'opinion') || view.opinion || '');
    setVal('dailyIssue', getEditorHistoryTextLocal(workingItem, 'dailyIssue', { todayOnly: true }) || '');
    setVal('latitude', view.latitude ?? '');
    setVal('longitude', view.longitude ?? '');
    const _rr = workingItem?._raw || workingItem;
    setVal('resultStatus', _rr?.result_status || workingItem?.result_status || workingItem?.resultStatus || ((_rr?.status || workingItem?.status) === '낙찰' ? '낙찰' : '') || '');
    setVal('resultPrice', _rr?.result_price != null ? utils.formatMoneyInputValue(_rr.result_price) : (workingItem?.result_price != null ? utils.formatMoneyInputValue(workingItem.result_price) : ''));
    setVal('resultDate', toInputDate(_rr?.result_date || workingItem?.result_date || workingItem?.resultDate || ''));
    // fallback: DB에서 직접 조회 (normalize에서 result 필드가 누락된 경우)
    if (!f.elements['resultPrice']?.value && sb && detailTargetId) {
      (async () => {
        try {
          const { data } = await sb.from('properties').select('result_status,result_price,result_date').or('id.eq.' + detailTargetId + ',global_id.eq.' + detailTargetId).limit(1).maybeSingle();
          if (data) {
            if (data.result_status && !f.elements['resultStatus']?.value) setVal('resultStatus', data.result_status);
            if (data.result_price != null && !f.elements['resultPrice']?.value) setVal('resultPrice', utils.formatMoneyInputValue(data.result_price));
            if (data.result_date && !f.elements['resultDate']?.value) setVal('resultDate', toInputDate(data.result_date));
          }
        } catch (_) {}
      })();
    }

    utils.configureFormNumericUx(f, { decimalNames: ['commonarea', 'exclusivearea', 'sitearea', 'latitude', 'longitude'], amountNames: ['priceMain', 'lowprice', 'resultPrice'] });
    applyAdminPropertyFormMode(els, utils, workingItem, view.sourceType, view.submitterType, view);
    arrangeAdminOpinionFields(f);
    setAdminEditSection('basic');
    const opinionEl = f.elements['opinion'];
    if (opinionEl) opinionEl.disabled = false;
    const regWrap = els.aemRegistrationLogList?.closest('.opinion-history-wrap');
    if (typeof utils.renderCombinedPropertyLog === 'function') {
      utils.renderCombinedPropertyLog(els.aemHistoryList, utils.loadOpinionHistory(workingItem), utils.loadRegistrationLog(workingItem));
      if (regWrap) regWrap.classList.add('hidden');
    } else {
      if (typeof utils.renderOpinionHistory === 'function') utils.renderOpinionHistory(els.aemHistoryList, utils.loadOpinionHistory(workingItem), true);
      if (typeof utils.renderRegistrationLog === 'function') utils.renderRegistrationLog(els.aemRegistrationLogList, utils.loadRegistrationLog(workingItem));
      if (regWrap) regWrap.classList.remove('hidden');
    }
    const sourceTypeEl = f.elements['sourceType'];
    const submitterTypeEl = f.elements['submitterType'];
    const refreshFormMode = () => applyAdminPropertyFormMode(els, utils, workingItem, sourceTypeEl?.value || view.sourceType, submitterTypeEl?.value || view.submitterType, view);
    if (sourceTypeEl) sourceTypeEl.onchange = refreshFormMode;
    if (submitterTypeEl) submitterTypeEl.onchange = refreshFormMode;

    const hasText = (v) => v != null && String(v).trim() !== '';
    const hasNum = (v) => v != null && String(v).trim() !== '' && !Number.isNaN(Number(v));
    const lockIfHas = (name, has) => {
      const el = f.elements[name];
      if (el) el.disabled = !isAdmin && has;
    };
    lockIfHas('itemNo', hasText(view.itemNo));
    lockIfHas('address', hasText(view.address));
    lockIfHas('assetType', hasText(view.assetType));
    lockIfHas('floor', hasText(view.floor));
    lockIfHas('totalfloor', hasText(view.totalfloor));
    lockIfHas('commonarea', hasNum(view.commonarea));
    lockIfHas('exclusivearea', hasNum(view.exclusivearea));
    lockIfHas('sitearea', hasNum(view.sitearea));
    lockIfHas('useapproval', hasText(view.useapproval));
    lockIfHas('status', hasText(view.status));
    lockIfHas('priceMain', hasNum(view.priceMain));
    lockIfHas('lowprice', hasNum(view.lowprice));
    lockIfHas('dateMain', hasText(view.dateMain));
    lockIfHas('realtorname', hasText(view.realtorname));
    lockIfHas('realtorphone', hasText(view.realtorphone));
    lockIfHas('realtorcell', hasText(view.realtorcell));
    lockIfHas('siteInspection', hasText(view.siteInspection));
    if (f.elements['sourceType']) f.elements['sourceType'].disabled = !isAdmin;
    if (f.elements['assigneeId']) f.elements['assigneeId'].disabled = !isAdmin;
    if (f.elements['submitterType']) f.elements['submitterType'].disabled = !isAdmin;
    if (f.elements['date']) f.elements['date'].disabled = true;
    if (els.aemDelete) els.aemDelete.classList.toggle('hidden', !isAdmin);
    setAemMsg(els, '');
    if (typeof utils.setModalOpen === 'function') utils.setModalOpen(true);
    else document.body.classList.toggle('modal-open', true);
    els.propertyEditModalAdmin.classList.remove('hidden');
    els.propertyEditModalAdmin.setAttribute('aria-hidden', 'false');
    const PhotoManager = window.KNSN_PROPERTY_PHOTOS || null;
    const propertyId = String(workingItem?.id || workingItem?._raw?.id || '').trim();
    const adminApi = ctx().api;
    if (PhotoManager && propertyId && typeof PhotoManager.mountSection === 'function' && typeof adminApi === 'function') {
      PhotoManager.mountSection({ form: f, propertyId, api: adminApi }).catch((err) => {
        console.warn('admin photo section mount failed', err);
      });
    }
  };

  mod.populateAssigneeSelect = function populateAssigneeSelect(selectedId) {
    const { state, els, utils } = ctx();
    const sel = els.aemForm?.elements['assigneeId'];
    if (!sel) return;
    const seen = new Set();
    const staffRows = (state.staff || [])
      .map((s) => utils.normalizeStaff(s))
      .filter((s) => utils.normalizeRole(s.role) === 'staff' && String(s.id || '').trim())
      .filter((s) => {
        const key = String(s.id || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    const options = ['<option value="">미배정</option>'];
    staffRows.forEach((s) => {
      options.push(`<option value="${utils.escapeAttr(s.id)}">${utils.escapeHtml(s.name || s.email || '담당자')}</option>`);
    });
    if (selectedId && !staffRows.some((s) => String(s.id) === String(selectedId))) {
      options.push(`<option value="${utils.escapeAttr(selectedId)}">${utils.escapeHtml((typeof utils.getStaffNameById === 'function' ? utils.getStaffNameById(selectedId) : getStaffNameByIdLocal(state, selectedId)) || '담당자')}</option>`);
    }
    sel.innerHTML = options.join('');
    sel.value = selectedId || '';
  };

  mod.closePropertyEditModal = function closePropertyEditModal() {
    const { state, els, utils } = ctx();
    if (!els.propertyEditModalAdmin) return;
    els.propertyEditModalAdmin.classList.add('hidden');
    els.propertyEditModalAdmin.setAttribute('aria-hidden', 'true');
    state.editingProperty = null;
    setAemMsg(els, '');
    if (typeof utils.setModalOpen === 'function') utils.setModalOpen(false);
    else document.body.classList.toggle('modal-open', false);
  };

  mod.savePropertyEditModal = async function savePropertyEditModal() {
    const { state, els, utils } = ctx();
    const item = state.editingProperty;
    if (!item || !els.aemForm) return;
    const user = state.session?.user;
    const isAdmin = user?.role === 'admin';
    const fd = new FormData(els.aemForm);
    const readStr = (k) => String(fd.get(k) || '').trim();
    const readNum = (k) => utils.parseFlexibleNumber(fd.get(k));
    const newOpinionText = readStr('opinion');
    const newDailyIssueText = readStr('dailyIssue');
    const newSiteInspectionText = readStr('siteInspection');
    let opinionHistory = Array.isArray(utils.loadOpinionHistory(item)) ? utils.loadOpinionHistory(item) : [];
    opinionHistory = appendHistoryIfChangedLocal(item, opinionHistory, 'siteInspection', newSiteInspectionText, state.session?.user);
    opinionHistory = appendHistoryIfChangedLocal(item, opinionHistory, 'opinion', newOpinionText, state.session?.user);
    opinionHistory = appendHistoryIfChangedLocal(item, opinionHistory, 'dailyIssue', newDailyIssueText, state.session?.user);
    const sourceBucketValue = readStr('sourceType') || toEditSourceTypeValue(item, item.sourceType, item.submitterType);
    const submitterDisplayValue = readStr('submitterType') || deriveSubmitterDisplayType(item, item);
    const sourceTypeValue = toStoredSourceType(sourceBucketValue);
    const submitterTypeValue = toStoredSubmitterType(submitterDisplayValue, sourceBucketValue);
    const sourceBucket = resolvePropertySourceBucket(utils, item, sourceBucketValue, submitterTypeValue);
    const hiddenStatusFields = ['realtor_naver', 'realtor_direct', 'general'].includes(sourceBucket);
    const patch = {
      id: item.id || '',
      globalId: item.globalId || '',
      itemNo: readStr('itemNo') || null,
      sourceType: sourceTypeValue || null,
      sourceBucket: sourceBucketValue || null,
      isDirectSubmission: sourceBucketValue === 'realtor_direct',
      assigneeId: readStr('assigneeId') || null,
      submitterType: submitterTypeValue || null,
      submitterDisplayType: submitterDisplayValue || null,
      registeredByAdmin: submitterDisplayValue === 'admin',
      registeredByAgent: submitterDisplayValue === 'agent',
      address: readStr('address') || null,
      assetType: readStr('assetType') || null,
      floor: readStr('floor') || null,
      totalfloor: readStr('totalfloor') || null,
      commonarea: readNum('commonarea'),
      exclusivearea: readNum('exclusivearea'),
      sitearea: readNum('sitearea'),
      useapproval: readStr('useapproval') || null,
      status: readStr('status') || null,
      priceMain: readNum('priceMain'),
      lowprice: readNum('lowprice'),
      dateMain: readStr('dateMain') || null,
      realtorname: readStr('realtorname') || null,
      realtorphone: readStr('realtorphone') || null,
      realtorcell: readStr('realtorcell') || null,
      siteInspection: readStr('siteInspection') || null,
      dailyIssue: newDailyIssueText || null,
      opinion: newOpinionText || null,
      opinionHistory,
      latitude: readNum('latitude'),
      longitude: readNum('longitude'),
      resultStatus: readStr('resultStatus') || null,
      resultPrice: readNum('resultPrice'),
      resultDate: readStr('resultDate') || null,
    };
    if (hiddenStatusFields) {
      delete patch.dateMain;
      delete patch.lowprice;
    }
    if (!isAdmin) {
      const allowIfEmpty = (k, oldVal) => {
        const v = patch[k];
        const isEmptyOld = oldVal == null || String(oldVal).trim() === '';
        const isEmptyOldNum = oldVal == null || String(oldVal).trim() === '' || Number.isNaN(Number(oldVal));
        const ok = (typeof v === 'number') ? isEmptyOldNum : isEmptyOld;
        if (!ok) delete patch[k];
      };
      ['itemNo','address','assetType','floor','totalfloor','useapproval','status','dateMain','realtorname','realtorphone','realtorcell','siteInspection','dailyIssue'].forEach((k) => allowIfEmpty(k, item[k]));
      ['commonarea','exclusivearea','sitearea','priceMain','lowprice','latitude','longitude'].forEach((k) => allowIfEmpty(k, item[k]));
      delete patch.sourceType;
      delete patch.assigneeId;
      delete patch.submitterType;
      delete patch.submitterDisplayType;
      delete patch.sourceBucket;
      delete patch.isDirectSubmission;
      delete patch.registeredByAdmin;
      delete patch.registeredByAgent;
    }
    const targetId = patch.id || patch.globalId;
    if (!targetId) {
      setAemMsg(els, '저장 실패: 물건 식별자(id)가 없습니다.');
      return;
    }
    try {
      if (els.aemSave) els.aemSave.disabled = true;
      setAemMsg(els, '');
      await mod.updatePropertyAdmin(targetId, patch, isAdmin, item);
      setAemMsg(els, '');
      mod.closePropertyEditModal();
      flashAdminSaveNotice(utils, '저장되었습니다.', 1500);
      window.setTimeout(() => refreshPropertiesInBackground(state, utils, { refreshSummary: state.activeTab === 'home' }), 100);
    } catch (err) {
      console.error(err);
      setAemMsg(els, err?.message || '저장 실패');
    } finally {
      if (els.aemSave) els.aemSave.disabled = false;
    }
  };

  mod.updatePropertyAdmin = async function updatePropertyAdmin(targetId, patch, isAdmin, item) {
    const { state, K, api, utils } = ctx();
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    const currentRawForLog = utils.mergePropertyRaw(item, patch);
    const regContext = utils.buildRegisterLogContext(isAdmin ? '관리자 수정' : '담당자 수정', { user: state.session?.user });
    const mergedLogRow = typeof utils.buildRegistrationDbRowForExisting === 'function'
      ? utils.buildRegistrationDbRowForExisting(item, {
          item_no: patch.itemNo,
          source_type: patch.sourceType,
          submitter_type: patch.submitterType,
          assignee_id: patch.assigneeId,
          assignee_name: patch.assigneeId ? (typeof utils.getStaffNameById === 'function' ? utils.getStaffNameById(patch.assigneeId) : '') : '',
          address: patch.address,
          asset_type: patch.assetType,
          floor: patch.floor,
          total_floor: patch.totalfloor,
          common_area: patch.commonarea,
          exclusive_area: patch.exclusivearea,
          site_area: patch.sitearea,
          use_approval: patch.useapproval,
          status: patch.status,
          price_main: patch.priceMain,
          lowprice: patch.lowprice,
          date_main: patch.dateMain,
          broker_office_name: patch.realtorname,
          submitter_phone: patch.realtorcell,
          memo: patch.opinion,
          latitude: patch.latitude,
          longitude: patch.longitude,
          result_status: patch.resultStatus,
          result_price: patch.resultPrice,
          result_date: patch.resultDate,
          raw: currentRawForLog,
        }, regContext)
      : null;
    const payload = { ...patch, raw: mergedLogRow?.row?.raw || currentRawForLog };

    // 관리자 수정(특히 담당자 배정 assignee_id 변경)은 브라우저의 direct Supabase update를 타면
    // DB 정책/트리거에서 "not allowed"가 발생할 수 있으므로 서버 API를 우선 사용한다.
    if (!isAdmin && sb) {
      const dbPatch = {
        item_no: patch.itemNo,
        source_type: patch.sourceType,
        assignee_id: patch.assigneeId,
        submitter_type: patch.submitterType,
        address: patch.address,
        asset_type: patch.assetType,
        floor: patch.floor,
        total_floor: patch.totalfloor,
        exclusive_area: patch.exclusivearea,
        common_area: patch.commonarea,
        site_area: patch.sitearea,
        use_approval: patch.useapproval || null,
        status: patch.status,
        price_main: patch.priceMain,
        lowprice: patch.lowprice,
        date_main: patch.dateMain || null,
        broker_office_name: patch.realtorname,
        submitter_phone: patch.realtorcell,
        memo: patch.opinion,
        latitude: patch.latitude,
        longitude: patch.longitude,
        result_status: patch.resultStatus,
        result_price: patch.resultPrice,
        result_date: patch.resultDate,
        raw: payload.raw,
      };
      Object.keys(dbPatch).forEach((k) => dbPatch[k] === undefined && delete dbPatch[k]);
      await utils.updatePropertyRowResilient(sb, targetId, dbPatch);
      return;
    }

    // 실제 서버 구현은 /api/properties 한 곳에서 PATCH { targetId, patch }를 받는다.
    if (DataAccess && typeof DataAccess.updatePropertyViaApi === 'function') {
      await DataAccess.updatePropertyViaApi(api, targetId, payload, { auth: true });
    } else {
      await api('/properties', { method: 'PATCH', auth: true, body: { targetId, patch: payload } });
    }
  };

  mod.handleDeleteProperty = async function handleDeleteProperty() {
    const { state, els, K, api, utils } = ctx();
    const item = state.editingProperty;
    if (!item) return;
    const targetId = String(item.id || item.globalId || '').trim();
    if (!targetId) {
      setAemMsg(els, '삭제 실패: 물건 식별자(id)가 없습니다.');
      return;
    }
    const label = item.address || item.itemNo || targetId;
    if (!window.confirm(`물건 '${label}'을(를) 삭제할까요?`)) return;
    try {
      if (els.aemDelete) els.aemDelete.disabled = true;
      setAemMsg(els, '');
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      if (sb) {
        if (DataAccess && typeof DataAccess.deletePropertyById === 'function') {
          await DataAccess.deletePropertyById(sb, targetId);
        } else {
          throw new Error('KNSN_DATA_ACCESS.deletePropertyById 를 찾을 수 없습니다.');
        }
      } else {
        if (DataAccess && typeof DataAccess.deletePropertyViaAdminApi === 'function') {
          await DataAccess.deletePropertyViaAdminApi(api, targetId, { auth: true });
        } else {
          throw new Error('KNSN_DATA_ACCESS.deletePropertyViaAdminApi 를 찾을 수 없습니다.');
        }
      }
      state.selectedPropertyIds.delete(targetId);
      mod.closePropertyEditModal();
      utils.invalidatePropertyCollections();
      await utils.loadProperties({ refreshSummary: false });
    } catch (err) {
      console.error(err);
      setAemMsg(els, err?.message || '삭제 실패');
    } finally {
      if (els.aemDelete) els.aemDelete.disabled = false;
    }
  };

  mod._getPropMultiCheckboxes = function(filterKey) { return _propMultiCheckboxes[filterKey] || []; };

  AdminModules.propertiesTab = mod;
})();
