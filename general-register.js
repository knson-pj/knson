(() => {
  "use strict";

  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function") ? window.KNSN.getApiBase() : "https://knson.vercel.app/api";

  const form = document.getElementById("generalForm");
  const msgEl = document.getElementById("msg");
  const btnSubmit = document.getElementById("btnSubmit");
  const viewForm = document.getElementById("viewForm");
  const viewDone = document.getElementById("viewDone");
  const realtorFields = document.getElementById("realtorFields");
  const ownerFields = document.getElementById("ownerFields");
  const typeCards = () => [...document.querySelectorAll('.type-card')];

  const K = window.KNSN || null;
  const Shared = window.KNSN_SHARED || null;
  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;
  const DataAccess = window.KNSN_DATA_ACCESS || null;

  function toUserErrorMessage(err, fallback = "등록에 실패했습니다.") {
    const raw = String(err?.message || err || "").trim();
    if (!raw) return fallback;
    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(raw)) return "네트워크 연결 또는 서버 응답에 실패했습니다.";
    if (/not allowed|forbidden|permission/i.test(raw)) return "권한이 없어 요청을 처리할 수 없습니다.";
    return raw;
  }

  const sharedApi = (Shared && typeof Shared.createApiClient === "function")
    ? Shared.createApiClient({
        baseUrl: API_BASE,
        networkErrorFactory: (fetchErr) => {
          const detail = String(fetchErr?.message || "").trim();
          const err = new Error(detail ? `네트워크 연결 또는 서버 응답에 실패했습니다. (${detail})` : "네트워크 연결 또는 서버 응답에 실패했습니다.");
          err.cause = fetchErr;
          return err;
        },
      })
    : null;
  const REG_LOG_LABELS = {
    address: "주소",
    assetType: "세부유형",
    floor: "층수",
    totalfloor: "총층",
    commonArea: "공용면적",
    exclusiveArea: "전용면적",
    siteArea: "토지면적",
    useapproval: "사용승인일",
    priceMain: "매매가",
    realtorName: "중개사무소명",
    realtorPhone: "유선전화",
    realtorCell: "휴대폰번호",
    submitterName: "등록자명",
    submitterPhone: "등록자 연락처",
    memo: "메모/의견",
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (K && typeof K.initTheme === "function") {
      K.initTheme({ container: document.querySelector(".actions"), className: "theme-toggle" });
    }
    bindTypeSwitch();
    updateTypeUi(getSubmitterKind());
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const submitterKind = PropertyDomain?.normalizeRegistrationSubmitterKind?.(getSubmitterKind(), { fallback: 'realtor' }) || 'realtor';

    let submitterName = '';
    let submitterPhone = '';
    let realtorName = null;
    let realtorPhone = null;
    let realtorCell = null;

    if (submitterKind === 'realtor') {
      realtorName = readStr(fd, 'realtorname');
      realtorPhone = readStr(fd, 'realtorphone') || null;
      realtorCell = readStr(fd, 'realtorcell');
      submitterPhone = realtorCell;
      submitterName = realtorName;
    } else {
      submitterName = readStr(fd, 'submitterName');
      submitterPhone = readStr(fd, 'submitterPhone');
    }

    const payload = PropertyDomain?.buildPublicListingPayload?.({
      submitterKind,
      address: readStr(fd, 'address'),
      assetType: readStr(fd, 'assetType'),
      priceMain: readNum(fd, 'priceMain'),
      floor: readStr(fd, 'floor') || null,
      totalFloor: readStr(fd, 'totalfloor') || null,
      commonArea: readNum(fd, 'commonarea'),
      exclusiveArea: readNum(fd, 'exclusivearea'),
      siteArea: readNum(fd, 'sitearea'),
      useApproval: readStr(fd, 'useapproval') || null,
      submitterName,
      submitterPhone,
      realtorName,
      realtorPhone,
      realtorCell,
      opinion: readStr(fd, 'opinion') || null,
    }) || null;
    const validationMessage = PropertyDomain?.validateRegistrationSubmissionCore?.(payload, {
      requiredMessage: '주소/세부유형/매매가를 입력해 주세요.',
      realtorMessage: '중개 등록은 중개사무소명과 휴대폰번호를 입력해 주세요.',
      ownerMessage: '소유자/일반 등록은 이름과 연락처를 입력해 주세요.',
    }) || '';
    if (validationMessage) {
      setMsg(validationMessage);
      return;
    }

    try {
      setBusy(true);
      setMsg('');

      const res = await api('/public-listings', {
        method: 'POST',
        body: payload,
      });
      if (!res?.ok) throw new Error(res?.message || '등록에 실패했습니다.');
      done();
    } catch (err) {
      setMsg(toUserErrorMessage(err, '등록에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  });

  function hasMeaningfulValue(value) {
    if (PropertyDomain && typeof PropertyDomain.hasMeaningfulValue === 'function') return PropertyDomain.hasMeaningfulValue(value);
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
  }

  function normalizeCompareValue(field, value) {
    if (PropertyDomain && typeof PropertyDomain.normalizeCompareValue === 'function') {
      return PropertyDomain.normalizeCompareValue(field, value, { numericFields: ['priceMain', 'commonArea', 'exclusiveArea', 'siteArea'] });
    }
    if (value === null || value === undefined) return '';
    if (['priceMain', 'commonArea', 'exclusiveArea', 'siteArea'].includes(field)) {
      const n = Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n) ? String(n) : '';
    }
    return String(value).trim().replace(/\s+/g, ' ');
  }

  function formatFieldValueForLog(field, value) {
    if (PropertyDomain && typeof PropertyDomain.formatFieldValueForLog === 'function') {
      return PropertyDomain.formatFieldValueForLog(field, value, { amountFields: ['priceMain'], numericFields: ['commonArea', 'exclusiveArea', 'siteArea'] });
    }
    if (value === null || value === undefined) return '';
    if (['priceMain'].includes(field)) {
      const n = Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';
    }
    if (['commonArea', 'exclusiveArea', 'siteArea'].includes(field)) {
      const n = Number(String(value).replace(/,/g, ''));
      if (!Number.isFinite(n)) return '';
      return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    }
    return String(value).trim();
  }

  function buildRegisterLogContext(route) {
    if (PropertyDomain && typeof PropertyDomain.buildRegisterLogContext === 'function') {
      return PropertyDomain.buildRegisterLogContext(route, { actor: '공개 등록' });
    }
    return { at: new Date().toISOString(), route: String(route || '등록').trim(), actor: '공개 등록' };
  }

  function parseFloorNumberForLog(value) {
    if (PropertyDomain && typeof PropertyDomain.parseFloorNumberForLog === 'function') return PropertyDomain.parseFloorNumberForLog(value);
    const s = String(value || '').trim();
    if (!s) return '';
    let m = s.match(/^(?:B|b|지하)\s*(\d+)$/);
    if (m) return `b${m[1]}`;
    m = s.match(/(-?\d+)/);
    return m ? String(Number(m[1])) : '';
  }

  function compactAddressText(value) {
    if (PropertyDomain && typeof PropertyDomain.compactAddressText === 'function') return PropertyDomain.compactAddressText(value);
    return String(value || '').trim().replace(/\s+/g, '');
  }

  function parseAddressIdentityParts(address) {
    if (PropertyDomain && typeof PropertyDomain.parseAddressIdentityParts === 'function') return PropertyDomain.parseAddressIdentityParts(address);
    const text = String(address || "").trim().replace(/\s+/g, " ");
    const compact = compactAddressText ? compactAddressText(text) : text.replace(/\s+/g, "");
    if (!compact) return { dong: "", mainNo: "", subNo: "" };

    const suffixSet = new Set(["동", "읍", "면", "리"]);
    let end = -1;
    for (let i = compact.length - 1; i >= 0; i -= 1) {
      if (suffixSet.has(compact[i])) {
        end = i;
        break;
      }
    }
    if (end < 0) return { dong: "", mainNo: "", subNo: "" };

    let start = 0;
    for (let i = end - 1; i >= 0; i -= 1) {
      if (/[시군구읍면리동]/.test(compact[i])) {
        start = i + 1;
        break;
      }
    }

    const dong = compact.slice(start, end + 1);
    if (!/^[가-힣A-Za-z0-9]+(?:동|읍|면|리)$/.test(dong)) {
      return { dong: "", mainNo: "", subNo: "" };
    }

    const tail = compact.slice(end + 1);
    const lot = tail.match(/(산?\d+)(?:-(\d+))?/);
    if (!lot) return { dong, mainNo: "", subNo: "" };
    return { dong, mainNo: lot[1] || "", subNo: lot[2] || "" };
  }

  function extractHoNumberForLog(data) {
    if (PropertyDomain && typeof PropertyDomain.extractHoNumberForLog === 'function') return PropertyDomain.extractHoNumberForLog(data);
    const explicitValues = [data?.ho, data?.unit, data?.room, data?.raw?.ho, data?.raw?.unit, data?.raw?.room];
    for (const value of explicitValues) {
      const s = String(value || '').trim();
      if (!s) continue;
      let m = s.match(/(\d{1,5})\s*호/);
      if (m) return String(Number(m[1]));
      if (!/층|동/.test(s)) {
        m = s.match(/^\D*(\d{1,5})\D*$/);
        if (m) return String(Number(m[1]));
      }
    }
    const texts = [data?.address, data?.raw?.address, data?.memo, data?.raw?.memo, data?.raw?.opinion, data?.raw?.detailAddress].filter(Boolean).join(' ');
    const m = texts.match(/(\d{1,5})\s*호/);
    return m ? String(Number(m[1])) : '';
  }

  function buildRegistrationMatchKey(data) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationMatchKey === 'function') return PropertyDomain.buildRegistrationMatchKey(data);
    const parts = parseAddressIdentityParts(data?.address || data?.raw?.address || '');
    const floorKey = parseFloorNumberForLog(data?.floor || data?.raw?.floor || '') || '0';
    const hoKey = extractHoNumberForLog(data) || '0';
    if (!parts.dong || !parts.mainNo) return '';
    return `${parts.dong}|${parts.mainNo}|${parts.subNo || '0'}|${floorKey}|${hoKey}`;
  }

  function attachRegistrationIdentity(raw, data) {
    if (PropertyDomain && typeof PropertyDomain.attachRegistrationIdentity === 'function') return PropertyDomain.attachRegistrationIdentity(raw, data);
    const nextRaw = { ...(raw || {}) };
    const parts = parseAddressIdentityParts(data?.address || data?.raw?.address || nextRaw.address || '');
    const floorKey = parseFloorNumberForLog(data?.floor || data?.raw?.floor || nextRaw.floor || '');
    const hoKey = extractHoNumberForLog(data);
    const key = parts.dong && parts.mainNo ? `${parts.dong}|${parts.mainNo}|${parts.subNo || '0'}|${floorKey || '0'}|${hoKey || '0'}` : '';
    nextRaw.registrationIdentityKey = key;
    nextRaw.registrationIdentity = { dong: parts.dong || '', mainNo: parts.mainNo || '', subNo: parts.subNo || '', floor: floorKey || '', ho: hoKey || '' };
    return nextRaw;
  }
  function buildRegistrationSnapshot(payload) {
    return {
      address: payload.address,
      assetType: payload.assetType,
      floor: payload.floor,
      totalfloor: payload.totalFloor,
      commonArea: payload.commonArea,
      exclusiveArea: payload.exclusiveArea,
      siteArea: payload.siteArea,
      useapproval: payload.useApproval,
      priceMain: payload.priceMain,
      realtorName: payload.realtorName,
      realtorPhone: payload.realtorPhone,
      realtorCell: payload.realtorCell,
      submitterName: payload.submitterName,
      submitterPhone: payload.submitterPhone,
      memo: payload.opinion,
    };
  }

  function buildRegistrationSnapshotFromRow(row) {
    const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
    return {
      address: row?.address || raw.address || '',
      assetType: row?.asset_type || raw.assetType || '',
      floor: raw.floor || row?.floor || '',
      totalfloor: raw.totalfloor || row?.total_floor || '',
      commonArea: row?.common_area ?? raw.commonArea ?? null,
      exclusiveArea: row?.exclusive_area ?? raw.exclusiveArea ?? null,
      siteArea: row?.site_area ?? raw.siteArea ?? null,
      useapproval: row?.use_approval || raw.useapproval || raw.useApproval || '',
      priceMain: row?.price_main ?? raw.priceMain ?? null,
      realtorName: row?.broker_office_name || raw.realtorName || '',
      realtorPhone: raw.realtorPhone || raw.realtorphone || '',
      realtorCell: row?.submitter_phone || raw.realtorCell || raw.realtorcell || raw.submitterPhone || '',
      submitterName: row?.submitter_name || raw.submitterName || raw.submitter_name || '',
      submitterPhone: row?.submitter_phone || raw.submitterPhone || raw.submitter_phone || '',
      memo: row?.memo || raw.memo || raw.opinion || '',
      raw,
    };
  }

  function buildRegistrationChanges(prevSnapshot, nextSnapshot) {
    if (PropertyDomain && typeof PropertyDomain.buildRegistrationChanges === 'function') {
      return PropertyDomain.buildRegistrationChanges(prevSnapshot, nextSnapshot, REG_LOG_LABELS, {
        amountFields: ['priceMain'],
        numericFields: ['commonArea', 'exclusiveArea', 'siteArea'],
      });
    }
    const changes = [];
    Object.keys(REG_LOG_LABELS).forEach((field) => {
      const nextValue = nextSnapshot?.[field];
      if (!hasMeaningfulValue(nextValue)) return;
      const prevNorm = normalizeCompareValue(field, prevSnapshot?.[field]);
      const nextNorm = normalizeCompareValue(field, nextValue);
      if (prevNorm === nextNorm) return;
      changes.push({
        field,
        label: REG_LOG_LABELS[field],
        before: formatFieldValueForLog(field, prevSnapshot?.[field]) || '-',
        after: formatFieldValueForLog(field, nextValue) || '-',
      });
    });
    return changes;
  }

  function appendRegistrationCreateLog(raw, context) {
    if (PropertyDomain && typeof PropertyDomain.ensureRegistrationCreatedLog === 'function') return PropertyDomain.ensureRegistrationCreatedLog(raw, context);
    const nextRaw = { ...(raw || {}) };
    const firstAt = String(nextRaw.firstRegisteredAt || context?.at || new Date().toISOString()).trim();
    const current = Array.isArray(nextRaw.registrationLog) ? nextRaw.registrationLog.slice() : [];
    if (!current.length) current.push({ type: 'created', at: firstAt, route: context?.route || '등록', actor: context?.actor || '' });
    nextRaw.firstRegisteredAt = firstAt;
    nextRaw.registrationLog = current;
    return nextRaw;
  }

  function appendRegistrationChangeLog(raw, context, changes) {
    if (PropertyDomain && typeof PropertyDomain.appendRegistrationLog === 'function') return PropertyDomain.appendRegistrationLog(raw, context, changes);
    const nextRaw = appendRegistrationCreateLog(raw, context);
    if (Array.isArray(changes) && changes.length) {
      nextRaw.registrationLog = [...nextRaw.registrationLog, {
        type: 'changed',
        at: context?.at || new Date().toISOString(),
        route: context?.route || '등록',
        actor: context?.actor || '',
        changes: changes.map((entry) => ({ ...entry })),
      }];
    }
    return nextRaw;
  }

  function mergeMeaningfulShallow(baseObj, incomingObj) {
    if (PropertyDomain && typeof PropertyDomain.mergeMeaningfulShallow === 'function') return PropertyDomain.mergeMeaningfulShallow(baseObj, incomingObj);
    const out = { ...(baseObj || {}) };
    Object.entries(incomingObj || {}).forEach(([key, value]) => {
      if (!hasMeaningfulValue(value)) return;
      out[key] = value;
    });
    return out;
  }

  function buildRowForCreate(payload, context) {
    return {
      source_type: payload.sourceType,
      address: payload.address,
      asset_type: payload.assetType,
      exclusive_area: payload.exclusiveArea,
      common_area: payload.commonArea,
      site_area: payload.siteArea,
      use_approval: payload.useApproval,
      price_main: payload.priceMain,
      memo: payload.opinion,
      assignee_id: null,
      submitter_type: payload.submitterType,
      submitter_name: payload.submitterName,
      submitter_phone: payload.submitterPhone,
      broker_office_name: payload.realtorName,
      raw: attachRegistrationIdentity(appendRegistrationCreateLog({ ...payload }, context), payload),
    };
  }

  function buildRowForExisting(existingRow, payload, context) {
    const base = { ...existingRow, raw: { ...((existingRow && existingRow.raw) || {}) } };
    const prevSnapshot = buildRegistrationSnapshotFromRow(existingRow);
    const nextSnapshot = buildRegistrationSnapshot(payload);
    const changes = buildRegistrationChanges(prevSnapshot, nextSnapshot);
    const nextRow = { ...base };
    if (hasMeaningfulValue(payload.address)) nextRow.address = payload.address;
    if (hasMeaningfulValue(payload.assetType)) nextRow.asset_type = payload.assetType;
    if (hasMeaningfulValue(payload.exclusiveArea)) nextRow.exclusive_area = payload.exclusiveArea;
    if (hasMeaningfulValue(payload.commonArea)) nextRow.common_area = payload.commonArea;
    if (hasMeaningfulValue(payload.siteArea)) nextRow.site_area = payload.siteArea;
    if (hasMeaningfulValue(payload.useApproval)) nextRow.use_approval = payload.useApproval;
    if (hasMeaningfulValue(payload.priceMain)) nextRow.price_main = payload.priceMain;
    if (hasMeaningfulValue(payload.opinion)) nextRow.memo = payload.opinion;
    if (hasMeaningfulValue(payload.submitterType)) nextRow.submitter_type = payload.submitterType;
    if (hasMeaningfulValue(payload.submitterName)) nextRow.submitter_name = payload.submitterName;
    if (hasMeaningfulValue(payload.submitterPhone)) nextRow.submitter_phone = payload.submitterPhone;
    if (hasMeaningfulValue(payload.realtorName)) nextRow.broker_office_name = payload.realtorName;
    nextRow.raw = attachRegistrationIdentity(appendRegistrationChangeLog(mergeMeaningfulShallow(base.raw || {}, payload), context, changes), payload);
    return { row: nextRow, changes };
  }

  async function findExistingRowByRegistrationKey(sb, payload) {
    if (DataAccess && typeof DataAccess.findExistingPropertyForRegistration === 'function') {
      return DataAccess.findExistingPropertyForRegistration(sb, payload, { limit: 300, normalizeRow: null });
    }
    return null;
  }

  function bindTypeSwitch() {
    typeCards().forEach((card) => {
      const input = card.querySelector('input[name="submitterKind"]');
      if (!input) return;
      const sync = () => updateTypeUi(input.value);
      input.addEventListener('change', sync);
      card.addEventListener('click', () => {
        input.checked = true;
        updateTypeUi(input.value);
      });
    });
  }

  function getSubmitterKind() {
    return document.querySelector('input[name="submitterKind"]:checked')?.value || 'realtor';
  }

  function updateTypeUi(kind) {
    typeCards().forEach((card) => {
      const input = card.querySelector('input[name="submitterKind"]');
      card.classList.toggle('is-active', !!input && input.value === kind);
    });
    const isRealtor = kind === 'realtor';
    realtorFields?.classList.toggle('hidden', !isRealtor);
    ownerFields?.classList.toggle('hidden', isRealtor);
  }

  function readStr(fd, key) { return String(fd.get(key) || '').trim(); }
  function readNum(fd, key) {
    const v = String(fd.get(key) || '').trim();
    if (!v) return null;
    if (Shared && typeof Shared.parseFlexibleNumber === 'function') return Shared.parseFlexibleNumber(v);
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function done() {
    viewForm.classList.add('hidden');
    viewDone.classList.remove('hidden');
  }

  function setBusy(b) {
    btnSubmit.disabled = !!b;
    btnSubmit.textContent = b ? '등록 중...' : '등록 요청하기';
  }

  function setMsg(msg) {
    msgEl.textContent = msg || '';
    msgEl.classList.toggle('show', !!msg);
  }

  async function api(path, options = {}) {
    if (sharedApi) return sharedApi(path, options);
    const method = String(options.method || 'GET').toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(method);
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json' },
      body: hasBody ? JSON.stringify(options.body || {}) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }
})();
