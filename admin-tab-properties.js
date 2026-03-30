(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const DataAccess = window.KNSN_DATA_ACCESS || null;

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

  function nl2brEscaped(utils, value) {
    const safe = utils.escapeHtml(String(value || ''));
    return safe.replace(/\r?\n/g, '<br/>');
  }

  function renderDetailIndicator(kind, text, utils) {
    const raw = String(text || '').trim();
    if (!raw) return '-';
    const label = kind === 'rights' ? '권리분석' : '현장실사';
    const content = nl2brEscaped(utils, raw);
    return `
      <div class="detail-indicator" data-detail-kind="${utils.escapeAttr(kind)}">
        <button type="button" class="detail-ok-btn" aria-label="${utils.escapeAttr(label)} 내용 보기">
          <span class="detail-ok-icon" aria-hidden="true"></span>
        </button>
        <div class="detail-popover" role="tooltip">${content}</div>
      </div>`;
  }


  function getCurrentPriceValue(row) {
    if (window.KNSN_PROPERTY_DOMAIN && typeof window.KNSN_PROPERTY_DOMAIN.getCurrentPriceValue === 'function') {
      return window.KNSN_PROPERTY_DOMAIN.getCurrentPriceValue(row);
    }
    if (!row || row.lowprice == null || row.lowprice === '') return Number(row?.priceMain || 0) || 0;
    return Number(row.lowprice || 0) || 0;
  }

  function getRatioValue(row, utils) {
    const base = Number(row?.priceMain || 0);
    const current = Number(getCurrentPriceValue(row) || 0);
    if (Number.isFinite(base) && Number.isFinite(current) && base > 0 && current > 0) return current / base;
    const raw = row?._raw || {};
    const rawRate = raw && (raw["최저입찰가율(%)"] || raw.bidRate || raw.rate);
    const numeric = Number(String(rawRate || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? numeric / 100 : -1;
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

  function toggleBrokerFieldsBySource(els, sourceType) {
    const hide = ['auction', 'onbid'].includes(String(sourceType || ''));
    ['realtorname', 'realtorphone', 'realtorcell'].forEach((name) => {
      const el = els.aemForm?.elements?.[name];
      const field = el?.closest?.('.field');
      if (field) field.classList.toggle('hidden', hide);
    });
  }

  function toInputDateTimeLocal(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function setAemMsg(els, text, isError = true) {
    if (!els.aemMsg) return;
    els.aemMsg.style.color = isError ? '#ff8b8b' : '#9ff0b6';
    els.aemMsg.textContent = text || '';
  }

  function appendOpinionEntryLocal(history, newText, user) {
    const text = String(newText || '').trim();
    if (!text) return history;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const author = String(user?.name || user?.email || '').trim();
    return [...history, { date: today, text, author }];
  }

  mod.getFilteredProperties = function getFilteredProperties() {
    const { state, utils } = ctx();
    const f = state.propertyFilters || {};
    const kw = String(f.keyword || '').toLowerCase().trim();
    const sortKey = String(state?.propertySort?.key || '').trim();
    const auctionOnlyForSort = sortKey === 'currentPrice' || sortKey === 'ratio';
    const filtered = (state.properties || []).filter((p) => {
      if (auctionOnlyForSort && p.sourceType !== 'auction' && p.sourceType !== 'onbid') return false;
      if (f.activeCard && f.activeCard !== 'all') {
        if (utils.PropertyDomain && typeof utils.PropertyDomain.matchesSourceBucket === 'function') {
          if (!utils.PropertyDomain.matchesSourceBucket(p, f.activeCard)) return false;
        } else if (f.activeCard === 'realtor_naver') {
          if (p.sourceType !== 'realtor' || p.isDirectSubmission) return false;
        } else if (f.activeCard === 'realtor_direct') {
          if (p.sourceType !== 'realtor' || !p.isDirectSubmission) return false;
        } else if (['auction', 'onbid', 'general'].includes(f.activeCard)) {
          if (p.sourceType !== f.activeCard) return false;
        }
      }
      if (f.status) {
        if ((p.status || '') !== f.status && !(p.status || '').includes(f.status)) return false;
      }
      if (f.area) {
        const [minStr, maxStr] = String(f.area).split('-');
        const min = parseFloat(minStr) || 0;
        const max = maxStr ? parseFloat(maxStr) : Infinity;
        const area = p.exclusivearea;
        if (area == null || area <= 0) return false;
        if (area < min || (max !== Infinity && area >= max)) return false;
      }
      if (f.priceRange) {
        const [minStr, maxStr] = String(f.priceRange).split('-');
        const min = (parseFloat(minStr) || 0) * 100000000;
        const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
        const isAuctionType = p.sourceType === 'auction' || p.sourceType === 'onbid';
        const price = isAuctionType ? (p.lowprice ?? p.priceMain) : p.priceMain;
        if (!price || price <= 0) return false;
        if (price < min || (max !== Infinity && price >= max)) return false;
      }
      if (f.ratio50) {
        if (p.sourceType !== 'auction' && p.sourceType !== 'onbid') return false;
        if (!p.priceMain || !p.lowprice || p.priceMain <= 0) return false;
        if ((p.lowprice / p.priceMain) > 0.5) return false;
      }
      if (kw) {
        const hay = [
          p.itemNo, p.address, p.assetType, p.floor, p.totalfloor,
          p.rightsAnalysis, p.siteInspection, p.opinion,
          (p.assignedAgentName || getStaffNameByIdLocal(state, p.assignedAgentId)),
          p.regionGu, p.regionDong, p.status,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    return applyPropertySort(filtered, state, utils);
  };

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
      if (DataAccess && typeof DataAccess.deletePropertiesByIds === 'function') {
        await DataAccess.deletePropertiesByIds(sb, ids);
      } else {
        throw new Error('KNSN_DATA_ACCESS.deletePropertiesByIds 를 찾을 수 없습니다.');
      }
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
    await api('/admin/properties', { method: 'DELETE', auth: true, body: { all: true } });
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

    if (!els.propertiesTableBody) return;
    bindPropertySortHeaders();
    els.propertiesTableBody.innerHTML = '';

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
      const kindLabel = listView?.kindLabel || ((utils.PropertyDomain && typeof utils.PropertyDomain.getSourceBucketLabel === 'function')
        ? utils.PropertyDomain.getSourceBucketLabel((utils.PropertyDomain.getSourceBucket && utils.PropertyDomain.getSourceBucket(p)) || p.sourceType)
        : (p.sourceType === 'auction' ? '경매' : p.sourceType === 'onbid' ? '공매' : p.sourceType === 'realtor' ? (p.isDirectSubmission ? '일반중개' : '네이버중개') : '일반'));
      const currentPriceValue = listView?.currentPriceValue ?? getCurrentPriceValue(p);
      const currentPrice = currentPriceValue ? utils.formatMoneyKRW(currentPriceValue) : '-';
      const rate = utils.formatPercent(p.priceMain, currentPriceValue, p._raw || {});
      tr.innerHTML = `
        <td class="check-col"><label class="check-wrap"><input class="prop-row-check" type="checkbox" data-prop-id="${utils.escapeAttr(rowId)}" ${rowId && state.selectedPropertyIds.has(rowId) ? 'checked' : ''} /><span></span></label></td>
        <td><span class="kind-text ${utils.escapeAttr(listView?.kindClass || (p.sourceType === 'auction' ? 'kind-auction' : p.sourceType === 'onbid' ? 'kind-gongmae' : p.sourceType === 'realtor' ? 'kind-realtor' : 'kind-general'))}">${utils.escapeHtml(kindLabel)}</span></td>
        <td>${utils.escapeHtml(listView?.itemNo || p.itemNo || '-')}</td>
        <td class="text-cell"><button type="button" class="address-trigger">${utils.escapeHtml(listView?.address || p.address || '-')}</button></td>
        <td>${utils.escapeHtml(listView?.assetType || p.assetType || '-')}</td>
        <td>${utils.escapeHtml(String(listView?.floor || p.floor || '-'))}</td>
        <td>${p.exclusivearea != null ? utils.escapeHtml(utils.formatAreaPyeong(p.exclusivearea)) : '-'}</td>
        <td>${p.priceMain != null ? utils.formatMoneyKRW(p.priceMain) : '-'}</td>
        <td>${utils.escapeHtml(currentPrice)}</td>
        <td>${utils.escapeHtml(rate)}</td>
        <td class="schedule-cell">${typeof utils.formatScheduleHtml === 'function' ? utils.formatScheduleHtml(p) : '-'}</td>
        <td>${utils.escapeHtml((p.assignedAgentName || getStaffNameByIdLocal(state, p.assignedAgentId)) || '미배정')}</td>
        <td class="indicator-cell">${renderDetailIndicator('rights', p.rightsAnalysis, utils)}</td>
        <td class="indicator-cell">${renderDetailIndicator('inspection', p.siteInspection, utils)}</td>
        <td>${utils.escapeHtml(utils.formatDate(p.createdAt) || '-')}</td>
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
      const res = await api('/admin/staff', { auth: true });
      state.staff = utils.dedupeStaff((res?.items || []));
      utils.renderSummary();
    } catch (err) {
      console.warn('ensureStaffForPropertyModal failed', err);
    }
  };

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
    const setVal = (name, v) => {
      const el = f.elements[name];
      if (el) el.value = v == null ? '' : String(v);
    };
    setVal('itemNo', workingItem.itemNo);
    setVal('sourceType', workingItem.sourceType);
    mod.populateAssigneeSelect(workingItem.assignedAgentId || workingItem.assigneeId || workingItem.assignee_id || '');
    setVal('submitterType', workingItem.submitterType);
    setVal('address', workingItem.address);
    setVal('assetType', workingItem.assetType);
    setVal('floor', workingItem.floor ?? '');
    setVal('totalfloor', workingItem.totalfloor ?? '');
    setVal('commonarea', formatModalAreaValue(workingItem.sourceType, workingItem.commonarea ?? ''));
    setVal('exclusivearea', formatModalAreaValue(workingItem.sourceType, workingItem.exclusivearea ?? ''));
    setVal('sitearea', formatModalAreaValue(workingItem.sourceType, workingItem.sitearea ?? ''));
    setVal('useapproval', workingItem.useapproval ?? '');
    setVal('status', workingItem.status ?? '');
    setVal('priceMain', utils.formatMoneyInputValue(workingItem.priceMain ?? ''));
    setVal('lowprice', utils.formatMoneyInputValue(workingItem.lowprice ?? ''));
    setVal('dateMain', toInputDateTimeLocal(workingItem.dateMain) ?? '');
    setVal('sourceUrl', workingItem.sourceUrl ?? '');
    setVal('date', utils.formatDate(workingItem.createdAt) ?? '');
    setVal('realtorname', workingItem.realtorname ?? '');
    setVal('realtorphone', workingItem.realtorphone ?? '');
    setVal('realtorcell', workingItem.realtorcell ?? '');
    setVal('rightsAnalysis', workingItem.rightsAnalysis ?? '');
    setVal('siteInspection', workingItem.siteInspection ?? '');
    setVal('opinion', '');
    setVal('latitude', workingItem.latitude ?? '');
    setVal('longitude', workingItem.longitude ?? '');

    utils.configureFormNumericUx(f, { decimalNames: ['commonarea', 'exclusivearea', 'sitearea', 'latitude', 'longitude'], amountNames: ['priceMain', 'lowprice'] });
    toggleBrokerFieldsBySource(els, workingItem.sourceType);
    const opinionEl = f.elements['opinion'];
    if (opinionEl) opinionEl.disabled = false;
    if (typeof utils.renderOpinionHistory === 'function') utils.renderOpinionHistory(els.aemHistoryList, utils.loadOpinionHistory(workingItem), true);
    if (typeof utils.renderRegistrationLog === 'function') utils.renderRegistrationLog(els.aemRegistrationLogList, utils.loadRegistrationLog(workingItem));
    const sourceTypeEl = f.elements['sourceType'];
    if (sourceTypeEl) sourceTypeEl.onchange = () => toggleBrokerFieldsBySource(els, sourceTypeEl.value);

    const hasText = (v) => v != null && String(v).trim() !== '';
    const hasNum = (v) => v != null && String(v).trim() !== '' && !Number.isNaN(Number(v));
    const lockIfHas = (name, has) => {
      const el = f.elements[name];
      if (el) el.disabled = !isAdmin && has;
    };
    lockIfHas('itemNo', hasText(workingItem.itemNo));
    lockIfHas('address', hasText(workingItem.address));
    lockIfHas('assetType', hasText(workingItem.assetType));
    lockIfHas('floor', hasText(workingItem.floor));
    lockIfHas('totalfloor', hasText(workingItem.totalfloor));
    lockIfHas('commonarea', hasNum(workingItem.commonarea));
    lockIfHas('exclusivearea', hasNum(workingItem.exclusivearea));
    lockIfHas('sitearea', hasNum(workingItem.sitearea));
    lockIfHas('useapproval', hasText(workingItem.useapproval));
    lockIfHas('status', hasText(workingItem.status));
    lockIfHas('priceMain', hasNum(workingItem.priceMain));
    lockIfHas('lowprice', hasNum(workingItem.lowprice));
    lockIfHas('dateMain', hasText(workingItem.dateMain));
    lockIfHas('sourceUrl', hasText(workingItem.sourceUrl));
    lockIfHas('realtorname', hasText(workingItem.realtorname));
    lockIfHas('realtorphone', hasText(workingItem.realtorphone));
    lockIfHas('realtorcell', hasText(workingItem.realtorcell));
    lockIfHas('rightsAnalysis', hasText(workingItem.rightsAnalysis));
    lockIfHas('siteInspection', hasText(workingItem.siteInspection));
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
    const opinionHistory = appendOpinionEntryLocal(utils.loadOpinionHistory(item), newOpinionText, state.session?.user);
    const patch = {
      id: item.id || '',
      globalId: item.globalId || '',
      itemNo: readStr('itemNo') || null,
      sourceType: readStr('sourceType') || null,
      assigneeId: readStr('assigneeId') || null,
      submitterType: readStr('submitterType') || null,
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
      sourceUrl: readStr('sourceUrl') || null,
      realtorname: readStr('realtorname') || null,
      realtorphone: readStr('realtorphone') || null,
      realtorcell: readStr('realtorcell') || null,
      rightsAnalysis: readStr('rightsAnalysis') || null,
      siteInspection: readStr('siteInspection') || null,
      opinion: opinionHistory.length ? opinionHistory[opinionHistory.length - 1].text : (item.opinion || null),
      opinionHistory,
      latitude: readNum('latitude'),
      longitude: readNum('longitude'),
    };
    if (!isAdmin) {
      const allowIfEmpty = (k, oldVal) => {
        const v = patch[k];
        const isEmptyOld = oldVal == null || String(oldVal).trim() === '';
        const isEmptyOldNum = oldVal == null || String(oldVal).trim() === '' || Number.isNaN(Number(oldVal));
        const ok = (typeof v === 'number') ? isEmptyOldNum : isEmptyOld;
        if (!ok) delete patch[k];
      };
      ['itemNo','address','assetType','floor','totalfloor','useapproval','status','dateMain','sourceUrl','realtorname','realtorphone','realtorcell','rightsAnalysis','siteInspection'].forEach((k) => allowIfEmpty(k, item[k]));
      ['commonarea','exclusivearea','sitearea','priceMain','lowprice','latitude','longitude'].forEach((k) => allowIfEmpty(k, item[k]));
      delete patch.sourceType;
      delete patch.assigneeId;
      delete patch.submitterType;
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
      setAemMsg(els, '저장 완료', false);
      mod.closePropertyEditModal();
      utils.invalidatePropertyCollections();
      await utils.loadProperties({ refreshSummary: false });
    } catch (err) {
      console.error(err);
      setAemMsg(els, err?.message || '저장 실패');
    } finally {
      if (els.aemSave) els.aemSave.disabled = false;
    }
  };

  mod.updatePropertyAdmin = async function updatePropertyAdmin(targetId, patch, isAdmin, item) {
    const { K, api, utils } = ctx();
    const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
    const payload = { ...patch, raw: utils.mergePropertyRaw(item, patch) };

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
        source_url: patch.sourceUrl,
        broker_office_name: patch.realtorname,
        submitter_phone: patch.realtorcell,
        memo: patch.opinion,
        latitude: patch.latitude,
        longitude: patch.longitude,
        raw: payload.raw,
      };
      Object.keys(dbPatch).forEach((k) => dbPatch[k] === undefined && delete dbPatch[k]);
      await utils.updatePropertyRowResilient(sb, targetId, dbPatch);
      return;
    }

    // 실제 서버 구현은 /api/properties 한 곳에서 PATCH { targetId, patch }를 받는다.
    await api('/properties', {
      method: 'PATCH',
      auth: true,
      body: { targetId, patch: payload },
    });
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
        await api('/admin/properties', { method: 'DELETE', auth: true, body: { ids: [targetId] } });
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

  AdminModules.propertiesTab = mod;
})();
