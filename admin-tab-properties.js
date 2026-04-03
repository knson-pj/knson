(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const PropertyRenderers = window.KNSN_PROPERTY_RENDERERS || null;

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

  const SOURCE_FILTER_OPTIONS = [
    { value: '', label: '전체' },
    { value: 'auction', label: '경매' },
    { value: 'onbid', label: '공매' },
    { value: 'realtor_naver', label: '네이버중개' },
    { value: 'realtor_direct', label: '일반중개' },
    { value: 'general', label: '일반' },
  ];

  const AREA_FILTER_OPTIONS = [
    { value: '', label: '전체 면적' },
    { value: '0-5', label: '5평 미만' },
    { value: '5-10', label: '5~10평' },
    { value: '10-20', label: '10~20평' },
    { value: '20-30', label: '20~30평' },
    { value: '30-50', label: '30~50평' },
    { value: '50-100', label: '50평~100평미만' },
    { value: '100-', label: '100평 이상' },
  ];

  const PRICE_FILTER_OPTIONS = [
    { value: '', label: '전체 가격' },
    { value: '0-1', label: '1억 미만' },
    { value: '1-3', label: '1~3억' },
    { value: '3-5', label: '3~5억' },
    { value: '5-10', label: '5~10억' },
    { value: '10-20', label: '10~20억' },
    { value: '20-', label: '20억 이상' },
  ];

  const RATIO_FILTER_OPTIONS = [
    { value: '', label: '전체 비율' },
    { value: '50', label: '50% 이하' },
  ];

  function isPlainSourceFilterSelected(value) {
    if (PropertyRenderers && typeof PropertyRenderers.isPlainSourceFilterSelected === 'function') {
      return PropertyRenderers.isPlainSourceFilterSelected(value);
    }
    const key = String(value || '').trim();
    return key === 'realtor_naver' || key === 'realtor_direct' || key === 'general';
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

  function getAreaFilterMatch(value, area) {
    if (!value) return true;
    const [minStr, maxStr] = String(value).split('-');
    const min = parseFloat(minStr) || 0;
    const max = maxStr ? parseFloat(maxStr) : Infinity;
    const numericArea = Number(area);
    if (!Number.isFinite(numericArea) || numericArea <= 0) return false;
    return numericArea >= min && (max === Infinity || numericArea < max);
  }

  function getPriceFilterMatch(value, row) {
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

  function getRatioFilterMatch(value, row) {
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
    const raw = item?._raw?.raw && typeof item._raw.raw === 'object' ? item._raw.raw : (item?._raw || {});
    return {
      realtorName: utilsFirstText(view?.realtorname, item?.broker_office_name, item?.realtorname, raw?.broker_office_name, raw?.brokerOfficeName, raw?.realtorname, raw?.realtorName, ''),
      realtorPhone: utilsFirstText(view?.realtorphone, item?.realtorphone, raw?.realtorphone, raw?.realtorPhone, ''),
      realtorCell: utilsFirstText(view?.realtorcell, item?.submitter_phone, item?.realtorcell, raw?.submitter_phone, raw?.submitterPhone, raw?.realtorcell, raw?.realtorCell, ''),
      ownerName: utilsFirstText(view?.submitterName, item?.submitter_name, raw?.submitter_name, raw?.submitterName, raw?.registeredByName, ''),
      ownerPhone: utilsFirstText(view?.submitterPhone, item?.submitter_phone, raw?.submitter_phone, raw?.submitterPhone, ''),
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

  function buildFormFeedbackHtml(text, kind = 'info') {
    const message = String(text || '').trim();
    if (!message) return '';
    const strongText = kind === 'error' ? '오류' : kind === 'success' ? '완료' : '안내';
    return `<div class="form-feedback-shell is-${kind}"><div class="admin-loading-box"><span class="admin-loading-spinner" aria-hidden="true"></span><div class="admin-loading-copy"><strong>${strongText}</strong><p>${message}</p></div></div></div>`;
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


  
  function getAdminFormControl(form, name) {
    if (!form || !name) return null;
    const control = form.elements?.[name];
    if (!control) return null;
    if (typeof control.tagName === 'string') return control;
    if (typeof control.length === 'number') {
      for (const node of Array.from(control)) {
        if (node && typeof node.tagName === 'string') return node;
      }
    }
    return null;
  }

  function findAdminFieldShell(form, fieldName) {
    const control = getAdminFormControl(form, fieldName);
    if (!control) return null;
    return control.closest('[data-aem-field]') || control.closest('.form-field') || control.parentElement || null;
  }

  function findAdminFieldLabelElement(shell) {
    if (!shell) return null;
    const explicit = shell.querySelector('label, .field-label, .form-label, .input-label, .textarea-label, .section-label, .modal-field-label, .aem-label, [class*="label"], [class*="title"]');
    if (explicit) return explicit;
    const directChildren = Array.from(shell.children || []);
    return directChildren.find((node) => {
      if (!node || node.dataset?.generatedFieldTitle === 'true') return false;
      const tag = String(node.tagName || '').toLowerCase();
      if (!tag || ['input', 'textarea', 'select', 'option', 'button'].includes(tag)) return false;
      if (node.querySelector('input, textarea, select, button')) return false;
      const textValue = String(node.textContent || '').trim();
      return !!textValue && textValue.length <= 40;
    }) || null;
  }

  function setAdminFieldLabel(shell, text) {
    if (!shell) return;
    const generatedLabels = Array.from(shell.querySelectorAll('[data-generated-field-title="true"]'));
    const explicit = findAdminFieldLabelElement(shell);
    if (explicit) {
      explicit.textContent = text;
      generatedLabels.forEach((node) => {
        if (node !== explicit) node.remove();
      });
      return;
    }
    const generated = generatedLabels[0] || document.createElement('label');
    generated.dataset.generatedFieldTitle = 'true';
    generated.textContent = text;
    if (!generated.parentElement) shell.insertBefore(generated, shell.firstChild || null);
    generatedLabels.slice(1).forEach((node) => node.remove());
  }

  function ensureAdminTextareaField(form, fieldName, shell) {
    if (!form || !shell || !fieldName) return null;
    let control = getAdminFormControl(form, fieldName);
    const isUsable = control && String(control.type || '').toLowerCase() !== 'hidden';
    if (isUsable) {
      control.hidden = false;
      control.style.display = '';
      return control;
    }
    if (control && String(control.type || '').toLowerCase() === 'hidden') control.disabled = true;
    const area = document.createElement('textarea');
    area.name = fieldName;
    area.rows = 6;
    area.className = (control && control.className) ? String(control.className) : 'aem-textarea';
    shell.appendChild(area);
    return area;
  }

  function arrangeAdminOpinionFields(form) {
    if (!form) return;
    const siteShell = findAdminFieldShell(form, 'siteInspection');
    const rightsShell = findAdminFieldShell(form, 'rightsAnalysis');
    const opinionShell = findAdminFieldShell(form, 'opinion');
    ensureAdminTextareaField(form, 'siteInspection', siteShell);
    ensureAdminTextareaField(form, 'rightsAnalysis', rightsShell);
    ensureAdminTextareaField(form, 'opinion', opinionShell);
    if (siteShell) {
      siteShell.classList.remove('hidden');
      siteShell.style.display = '';
      siteShell.hidden = false;
      siteShell.style.gridColumn = '';
      setAdminFieldLabel(siteShell, '현장실사');
    }
    if (rightsShell) {
      rightsShell.classList.remove('hidden');
      rightsShell.style.display = '';
      rightsShell.hidden = false;
      rightsShell.style.gridColumn = '';
      setAdminFieldLabel(rightsShell, '담당자 의견');
    }
    if (opinionShell) {
      opinionShell.classList.remove('hidden');
      opinionShell.style.display = '';
      opinionShell.hidden = false;
      opinionShell.style.gridColumn = '1 / -1';
      setAdminFieldLabel(opinionShell, '금일 이슈사항');
    }
    const parent = siteShell && rightsShell && opinionShell && siteShell.parentElement === rightsShell.parentElement && rightsShell.parentElement === opinionShell.parentElement
      ? siteShell.parentElement
      : null;
    if (parent) {
      parent.appendChild(siteShell);
      parent.appendChild(rightsShell);
      parent.appendChild(opinionShell);
    }
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
    form.querySelectorAll('[data-aem-field="status"], [data-aem-field="dateMain"], [data-aem-field="rightsAnalysis"], [data-aem-field="currentPrice"]').forEach((node) => {
      node.classList.toggle('hidden', hideForPlain);
    });
    form.querySelectorAll('[data-aem-section="broker"]').forEach((node) => node.classList.toggle('hidden', !isRealtor));
    form.querySelectorAll('[data-aem-section="owner"]').forEach((node) => node.classList.toggle('hidden', !isGeneral));
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
    els.aemMsg.innerHTML = buildFormFeedbackHtml(text, isError ? 'error' : 'success');
    if (String(text || '').trim()) {
      window.requestAnimationFrame(() => {
        try { els.aemMsg.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
      });
    }
  }


  function refreshPropertiesInBackground(state, utils, options = {}) {
    const refreshSummary = !!options.refreshSummary;
    try { utils.invalidatePropertyCollections?.(); } catch {}
    Promise.resolve()
      .then(() => utils.loadProperties?.({ refreshSummary }))
      .catch((err) => console.warn('properties refresh failed', err));
  }

  function appendOpinionEntryLocal(history, newText, user) {
    const text = String(newText || '').trim();
    if (!text) return history;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const author = String(user?.name || user?.email || '').trim();
    return [...history, { date: today, text, author }];
  }

  mod.getFilteredProperties = function getFilteredProperties(options = {}) {
    const { state, utils } = ctx();
    const ignoreKeys = new Set(Array.isArray(options?.ignoreKeys) ? options.ignoreKeys : []);
    const f = state.propertyFilters || {};
    const kw = String(f.keyword || '').toLowerCase().trim();
    const sortKey = String(state?.propertySort?.key || '').trim();
    const auctionOnlyForSort = sortKey === 'currentPrice' || sortKey === 'ratio';
    const sourceRows = getPropertyFilterSourceRows(state);
    const filtered = sourceRows.filter((p) => {
      if (auctionOnlyForSort && p.sourceType !== 'auction' && p.sourceType !== 'onbid') return false;
      if (!ignoreKeys.has('activeCard') && f.activeCard && f.activeCard !== 'all') {
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
      if (!ignoreKeys.has('status') && f.status) {
        if ((p.status || '') !== f.status && !(p.status || '').includes(f.status)) return false;
      }
      if (!ignoreKeys.has('area') && f.area) {
        if (!getAreaFilterMatch(f.area, p.exclusivearea)) return false;
      }
      if (!ignoreKeys.has('priceRange') && f.priceRange) {
        const [minStr, maxStr] = String(f.priceRange).split('-');
        const min = (parseFloat(minStr) || 0) * 100000000;
        const max = maxStr ? parseFloat(maxStr) * 100000000 : Infinity;
        const isAuctionType = p.sourceType === 'auction' || p.sourceType === 'onbid';
        const price = isAuctionType ? (p.lowprice ?? p.priceMain) : p.priceMain;
        if (!price || price <= 0) return false;
        if (price < min || (max !== Infinity && price >= max)) return false;
      }
      if (!ignoreKeys.has('ratio50') && f.ratio50) {
        if (p.sourceType !== 'auction' && p.sourceType !== 'onbid') return false;
        if (!p.priceMain || !p.lowprice || p.priceMain <= 0) return false;
        if ((p.lowprice / p.priceMain) > 0.5) return false;
      }
      if (!ignoreKeys.has('keyword') && kw) {
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

  mod.updatePropertyFilterOptionCounts = function updatePropertyFilterOptionCounts() {
    const { state, els, utils } = ctx();
    const filters = state?.propertyFilters || {};
    const hasLocalOverrides = !!(
      String(filters.activeCard || '').trim() ||
      String(filters.status || '').trim() ||
      String(filters.keyword || '').trim() ||
      String(filters.area || '').trim() ||
      String(filters.priceRange || '').trim() ||
      String(filters.ratio50 || '').trim() ||
      String(state?.propertySort?.key || '').trim()
    );
    const overviewCounts = state?.propertyOverview?.filterCounts || null;
    if (!Array.isArray(state?.propertiesFullCache) && !Array.isArray(state?.homeSummarySnapshot) && !hasLocalOverrides && overviewCounts) {
      if (overviewCounts.source) applySelectOptionCounts(els.propSourceFilter, SOURCE_FILTER_OPTIONS, overviewCounts.source, (optionDef, count) => formatOptionLabel(optionDef.label, count));
      if (overviewCounts.area) applySelectOptionCounts(els.propAreaFilter, AREA_FILTER_OPTIONS, overviewCounts.area, (optionDef, count) => formatOptionLabel(optionDef.label, count));
      if (overviewCounts.price) applySelectOptionCounts(els.propPriceFilter, PRICE_FILTER_OPTIONS, overviewCounts.price, (optionDef, count) => formatOptionLabel(optionDef.label, count));
      if (overviewCounts.ratio) applySelectOptionCounts(els.propRatioFilter, RATIO_FILTER_OPTIONS, overviewCounts.ratio, (optionDef, count) => formatOptionLabel(optionDef.label, count));
      if (els.propSourceFilter) els.propSourceFilter.value = String(filters.activeCard || '');
      if (els.propAreaFilter) els.propAreaFilter.value = String(filters.area || '');
      if (els.propPriceFilter) els.propPriceFilter.value = String(filters.priceRange || '');
      if (els.propRatioFilter) els.propRatioFilter.value = String(filters.ratio50 || '');
      return;
    }

    const sourceRows = mod.getFilteredProperties({ ignoreKeys: ['activeCard'] });
    const areaRows = mod.getFilteredProperties({ ignoreKeys: ['area'] });
    const priceRows = mod.getFilteredProperties({ ignoreKeys: ['priceRange'] });
    const ratioRows = mod.getFilteredProperties({ ignoreKeys: ['ratio50'] });

    const sourceCounts = { '': sourceRows.length, auction: 0, onbid: 0, realtor_naver: 0, realtor_direct: 0, general: 0 };
    sourceRows.forEach((row) => {
      const bucket = utils.PropertyDomain && typeof utils.PropertyDomain.getSourceBucket === 'function'
        ? utils.PropertyDomain.getSourceBucket(row)
        : (row.sourceType === 'realtor' ? (row.isDirectSubmission ? 'realtor_direct' : 'realtor_naver') : String(row.sourceType || 'general'));
      if (Object.prototype.hasOwnProperty.call(sourceCounts, bucket)) sourceCounts[bucket] += 1;
    });

    const areaCounts = { '': areaRows.length, '0-5': 0, '5-10': 0, '10-20': 0, '20-30': 0, '30-50': 0, '50-100': 0, '100-': 0 };
    areaRows.forEach((row) => {
      AREA_FILTER_OPTIONS.slice(1).forEach((optionDef) => {
        if (getAreaFilterMatch(optionDef.value, row?.exclusivearea)) areaCounts[optionDef.value] += 1;
      });
    });

    const priceCounts = { '': priceRows.length, '0-1': 0, '1-3': 0, '3-5': 0, '5-10': 0, '10-20': 0, '20-': 0 };
    priceRows.forEach((row) => {
      PRICE_FILTER_OPTIONS.slice(1).forEach((optionDef) => {
        if (getPriceFilterMatch(optionDef.value, row)) priceCounts[optionDef.value] += 1;
      });
    });

    const ratioCounts = { '': ratioRows.length, '50': 0 };
    ratioRows.forEach((row) => {
      if (getRatioFilterMatch('50', row)) ratioCounts['50'] += 1;
    });

    applySelectOptionCounts(els.propSourceFilter, SOURCE_FILTER_OPTIONS, sourceCounts, (optionDef, count) => formatOptionLabel(optionDef.label, count));
    applySelectOptionCounts(els.propAreaFilter, AREA_FILTER_OPTIONS, areaCounts, (optionDef, count) => formatOptionLabel(optionDef.label, count));
    applySelectOptionCounts(els.propPriceFilter, PRICE_FILTER_OPTIONS, priceCounts, (optionDef, count) => formatOptionLabel(optionDef.label, count));
    applySelectOptionCounts(els.propRatioFilter, RATIO_FILTER_OPTIONS, ratioCounts, (optionDef, count) => formatOptionLabel(optionDef.label, count));
    if (els.propSourceFilter) els.propSourceFilter.value = String(state?.propertyFilters?.activeCard || '');
    if (els.propAreaFilter) els.propAreaFilter.value = String(state?.propertyFilters?.area || '');
    if (els.propPriceFilter) els.propPriceFilter.value = String(state?.propertyFilters?.priceRange || '');
    if (els.propRatioFilter) els.propRatioFilter.value = String(state?.propertyFilters?.ratio50 || '');
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
      if (DataAccess && typeof DataAccess.deletePropertiesViaAdminApi === 'function') {
        await DataAccess.deletePropertiesViaAdminApi(api, ids, { auth: true });
      } else {
        throw new Error('KNSN_DATA_ACCESS.deletePropertiesViaAdminApi 를 찾을 수 없습니다.');
      }
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
      throw new Error('KNSN_DATA_ACCESS.deleteAllPropertiesViaAdminApi 를 찾을 수 없습니다.');
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
  const usePlainLayout = isPlainSourceFilterSelected(state?.propertyFilters?.sourceType);

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
    const addressText = truncateDisplayText(listView?.address || p.address || '-', 40) || '-';
    const assetTypeText = truncateDisplayText(listView?.assetType || p.assetType || '-', 7) || '-';
    const exclusiveText = p.exclusivearea != null ? utils.escapeHtml(utils.formatAreaPyeong(p.exclusivearea)) : '-';
    const commonText = p.commonarea != null ? utils.escapeHtml(utils.formatAreaPyeong(p.commonarea)) : '-';
    const siteText = p.sitearea != null ? utils.escapeHtml(utils.formatAreaPyeong(p.sitearea)) : '-';
    const useapprovalText = (utils.formatDate && utils.formatDate(p.useapproval)) || '-';
    const scheduleHtml = typeof utils.formatScheduleHtml === 'function' ? utils.formatScheduleHtml(p) : '-';
    const rightsHtml = renderDetailIndicator('rights', p.rightsAnalysis, utils);
    const inspectionHtml = renderDetailIndicator('inspection', p.siteInspection, utils);
    const assigneeText = utils.escapeHtml((p.assignedAgentName || getStaffNameByIdLocal(state, p.assignedAgentId)) || '미배정');
    tr.innerHTML = usePlainLayout
      ? `
      <td class="check-col"><label class="check-wrap"><input class="prop-row-check" type="checkbox" data-prop-id="${utils.escapeAttr(rowId)}" ${rowId && state.selectedPropertyIds.has(rowId) ? 'checked' : ''} /><span></span></label></td>
      <td><span class="kind-text ${utils.escapeAttr(kindClass)}">${utils.escapeHtml(kindLabel)}</span></td>
      <td>${utils.escapeHtml(listView?.itemNo || p.itemNo || '-')}</td>
      <td class="text-cell"><button type="button" class="address-trigger">${utils.escapeHtml(addressText)}</button></td>
      <td>${utils.escapeHtml(assetTypeText)}</td>
      <td>${utils.escapeHtml(String(floorText))}</td>
      <td>${exclusiveText}</td>
      <td>${commonText}</td>
      <td>${siteText}</td>
      <td>${utils.escapeHtml(useapprovalText)}</td>
      <td>${p.priceMain != null ? utils.formatMoneyKRW(p.priceMain) : '-'}</td>
      <td>${assigneeText}</td>
      <td class="indicator-cell">${rightsHtml}</td>
      <td class="indicator-cell">${inspectionHtml}</td>
      <td>${formatDateCell(utils, p.createdAt)}</td>
    `
      : `
      <td class="check-col"><label class="check-wrap"><input class="prop-row-check" type="checkbox" data-prop-id="${utils.escapeAttr(rowId)}" ${rowId && state.selectedPropertyIds.has(rowId) ? 'checked' : ''} /><span></span></label></td>
      <td><span class="kind-text ${utils.escapeAttr(kindClass)}">${utils.escapeHtml(kindLabel)}</span></td>
      <td>${utils.escapeHtml(listView?.itemNo || p.itemNo || '-')}</td>
      <td class="text-cell"><button type="button" class="address-trigger">${utils.escapeHtml(addressText)}</button></td>
      <td>${utils.escapeHtml(assetTypeText)}</td>
      <td>${utils.escapeHtml(String(floorText))}</td>
      <td>${exclusiveText}</td>
      <td>${p.priceMain != null ? utils.formatMoneyKRW(p.priceMain) : '-'}</td>
      <td>${utils.escapeHtml(currentPrice)}</td>
      <td>${utils.escapeHtml(rate)}</td>
      <td class="schedule-cell">${scheduleHtml}</td>
      <td>${assigneeText}</td>
      <td class="indicator-cell">${rightsHtml}</td>
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
      if (!(DataAccess && typeof DataAccess.fetchAdminStaffViaApi === 'function')) {
        throw new Error('KNSN_DATA_ACCESS.fetchAdminStaffViaApi 를 찾을 수 없습니다.');
      }
      const res = await DataAccess.fetchAdminStaffViaApi(api, { auth: true });
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
    setVal('assetType', view.assetType);
    setVal('floor', view.floor ?? '');
    setVal('totalfloor', view.totalfloor ?? '');
    setVal('commonarea', formatModalAreaValue(view.sourceType, view.commonarea ?? ''));
    setVal('exclusivearea', formatModalAreaValue(view.sourceType, view.exclusivearea ?? ''));
    setVal('sitearea', formatModalAreaValue(view.sourceType, view.sitearea ?? ''));
    setVal('useapproval', view.useapproval ?? '');
    setVal('status', view.status ?? '');
    setVal('priceMain', utils.formatMoneyInputValue(view.priceMain ?? ''));
    setVal('lowprice', utils.formatMoneyInputValue(view.currentPriceValue ?? view.lowprice ?? ''));
    setVal('dateMain', toInputDate(view.dateMain) ?? '');
    setVal('date', utils.formatDate(view.createdAt) ?? '');
    setVal('realtorname', view.realtorname ?? '');
    setVal('realtorphone', view.realtorphone ?? '');
    setVal('realtorcell', view.realtorcell ?? '');
    setVal('rightsAnalysis', view.rightsAnalysis ?? '');
    setVal('siteInspection', view.siteInspection ?? '');
    setVal('opinion', view.opinion ?? '');
    setVal('latitude', view.latitude ?? '');
    setVal('longitude', view.longitude ?? '');

    utils.configureFormNumericUx(f, { decimalNames: ['commonarea', 'exclusivearea', 'sitearea', 'latitude', 'longitude'], amountNames: ['priceMain', 'lowprice'] });
    applyAdminPropertyFormMode(els, utils, workingItem, view.sourceType, view.submitterType, view);
    arrangeAdminOpinionFields(f);
    const opinionEl = f.elements['opinion'];
    if (opinionEl) opinionEl.disabled = false;
    if (typeof utils.renderOpinionHistory === 'function') utils.renderOpinionHistory(els.aemHistoryList, utils.loadOpinionHistory(workingItem), true);
    if (typeof utils.renderRegistrationLog === 'function') utils.renderRegistrationLog(els.aemRegistrationLogList, utils.loadRegistrationLog(workingItem));
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
    lockIfHas('rightsAnalysis', hasText(view.rightsAnalysis));
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
      rightsAnalysis: readStr('rightsAnalysis') || null,
      siteInspection: readStr('siteInspection') || null,
      opinion: opinionHistory.length ? opinionHistory[opinionHistory.length - 1].text : (item.opinion || null),
      opinionHistory,
      latitude: readNum('latitude'),
      longitude: readNum('longitude'),
    };
    if (hiddenStatusFields) {
      delete patch.status;
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
      ['itemNo','address','assetType','floor','totalfloor','useapproval','status','dateMain','realtorname','realtorphone','realtorcell','rightsAnalysis','siteInspection'].forEach((k) => allowIfEmpty(k, item[k]));
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
      setAemMsg(els, '저장되었습니다.', false);
      await new Promise((resolve) => setTimeout(resolve, 2200));
      mod.closePropertyEditModal();
      window.setTimeout(() => refreshPropertiesInBackground(state, utils, { refreshSummary: state.activeTab === 'home' }), 2400);
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
    if (DataAccess && typeof DataAccess.updatePropertyViaApi === 'function') {
      await DataAccess.updatePropertyViaApi(api, targetId, payload, { auth: true });
    } else {
      throw new Error('KNSN_DATA_ACCESS.updatePropertyViaApi 를 찾을 수 없습니다.');
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

  AdminModules.propertiesTab = mod;
})();
