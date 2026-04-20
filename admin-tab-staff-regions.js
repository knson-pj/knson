(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return { rt, state: rt.state || {}, els: rt.els || {}, api: rt.adminApi, utils: rt.utils || {}, K: rt.K || window.KNSN || null };
  }

  mod.loadStaff = async function loadStaff() {
    const { state, api, utils } = ctx();
    const DataAccess = window.KNSN_DATA_ACCESS;
    const { syncSupabaseSessionIfNeeded, dedupeStaff, hydrateAssignedAgentNames, renderSummary, renderPropertiesTable } = utils;
    await syncSupabaseSessionIfNeeded();
    const res = (DataAccess && typeof DataAccess.fetchAdminStaffViaApi === "function")
      ? await DataAccess.fetchAdminStaffViaApi(api, { auth: true })
      : await api('/admin/staff', { auth: true });
    state.staff = dedupeStaff(res?.items || []);
    mod.renderStaffTable();
    mod.refreshAssignmentView();
    renderSummary();
    hydrateAssignedAgentNames();
    renderPropertiesTable();
  };

  mod.setStaffFormMode = function setStaffFormMode(mode = "create") {
    const { els } = ctx();
    const editing = mode === "edit";
    const emailEl = els.staffForm?.elements.email;
    const passwordEl = els.staffForm?.elements.password;

    if (emailEl) {
      emailEl.disabled = editing;
      if (editing) emailEl.removeAttribute("required");
      else emailEl.setAttribute("required", "required");
    }
    if (passwordEl) {
      passwordEl.disabled = editing;
      if (editing) {
        passwordEl.value = "";
        passwordEl.removeAttribute("required");
        passwordEl.placeholder = "비밀번호는 본인 메뉴에서 변경";
      } else {
        passwordEl.setAttribute("required", "required");
        passwordEl.placeholder = "신규 생성 시만 입력";
      }
    }
    if (els.btnStaffSave) els.btnStaffSave.textContent = editing ? "프로필 저장" : "계정 생성";
  };

  mod.fillStaffForm = function fillStaffForm(staff) {
    const { els, state } = ctx();
    if (!els.staffForm) return;
    state.staffEditingId = staff.id || "";
    els.staffForm.elements.id.value = staff.id || "";
    if (els.staffForm.elements.email) els.staffForm.elements.email.value = staff.email || "";
    els.staffForm.elements.name.value = staff.name || "";
    if (els.staffForm.elements.position) els.staffForm.elements.position.value = staff.position || "";
    if (els.staffForm.elements.phone) els.staffForm.elements.phone.value = staff.phone || "";
    els.staffForm.elements.role.value = staff.role || "staff";
    if (els.staffForm.elements.password) els.staffForm.elements.password.value = "";
    mod.setStaffFormMode("edit");
  };

  mod.resetStaffForm = function resetStaffForm() {
    const { els, state } = ctx();
    if (!els.staffForm) return;
    state.staffEditingId = "";
    els.staffForm.reset();
    els.staffForm.elements.id.value = "";
    els.staffForm.elements.role.value = "staff";
    if (els.staffForm.elements.position) els.staffForm.elements.position.value = "";
    if (els.staffForm.elements.phone) els.staffForm.elements.phone.value = "";
    mod.setStaffFormMode("create");
  };

  async function handleStaffRowAction(act, id) {
    const { state, api, utils } = ctx();
    const DataAccess = window.KNSN_DATA_ACCESS;
    const { renderSummary, hydrateAssignedAgentNames, renderPropertiesTable, setActiveTab, invalidatePropertyCollections, loadProperties } = utils;
    const row = (Array.isArray(state.staff) ? state.staff : []).find((staff) => String(staff.id) === String(id || ''));
    if (!row) return;

    if (act === 'edit') {
      mod.fillStaffForm(row);
      setActiveTab('staff');
      try {
        const firstInput = document.querySelector('#staffForm input[name="name"]');
        if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
      } catch {}
      return;
    }

    if (act === 'delete') {
      if (!confirm(`계정 '${row.name || row.email || id}'을 삭제할까요?`)) return;
      try {
        if (DataAccess && typeof DataAccess.deleteAdminStaffViaApi === 'function') {
          await DataAccess.deleteAdminStaffViaApi(api, id, { auth: true });
        } else {
          await api(`/admin/staff?id=${encodeURIComponent(id)}`, { method: 'DELETE', auth: true, body: { id } });
        }
        state.staff = state.staff.filter((staff) => String(staff.id) !== String(id));

        // 삭제된 담당자의 배정 정보를 로컬 물건 캐시에서 클리어
        const clearAssigneeFromLocalCache = (rows) => {
          if (!Array.isArray(rows)) return;
          rows.forEach((p) => {
            const aid = String(p.assignedAgentId || p.assigneeId || '').trim();
            if (aid !== String(id)) return;
            p.assignedAgentId = null;
            p.assigneeId = null;
            p.assignedAgentName = null;
            p.assigneeName = null;
            if (p._raw && typeof p._raw === 'object') {
              p._raw.assignee_id = null;
              p._raw.assignedAgentId = null;
              p._raw.assignee_name = null;
              p._raw.assignedAgentName = null;
            }
          });
        };
        clearAssigneeFromLocalCache(state.properties);
        clearAssigneeFromLocalCache(state.propertiesFullCache);
        clearAssigneeFromLocalCache(state.homeSummarySnapshot);

        mod.resetStaffForm();
        mod.renderStaffTable();
        mod.refreshAssignmentView();
        renderSummary();
        hydrateAssignedAgentNames();
        renderPropertiesTable();

        // 서버 동기화: 캐시 무효화 후 백그라운드에서 물건 목록 재로드
        invalidatePropertyCollections();
        loadProperties({ refreshSummary: true }).catch(() => {});
      } catch (err) {
        console.error(err);
        alert(err.message || '삭제 실패');
      }
    }
  }

  mod.bindStaffTableActions = function bindStaffTableActions() {
    const { els } = ctx();
    const tbody = els.staffTableBody;
    if (!tbody || tbody.__knsonStaffActionsBound) return;
    tbody.__knsonStaffActionsBound = true;
    tbody.addEventListener('click', async (e) => {
      const btn = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('button[data-act][data-id]')
        : null;
      if (!btn || !tbody.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';
      try {
        const id = String(btn.dataset.id || '');
        const act = String(btn.dataset.act || '');
        await handleStaffRowAction(act, id);
      } finally {
        btn.dataset.busy = '0';
      }
    });
  };

  mod.handleSaveStaff = async function handleSaveStaff(e) {
    const { state, api, utils } = ctx();
    const DataAccess = window.KNSN_DATA_ACCESS;
    const { normalizeStaff, setFormBusy, renderSummary } = utils;
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const id = String(fd.get("id") || "").trim();
    const payload = {
      email: String(fd.get("email") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      position: String(fd.get("position") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      role: String(fd.get("role") || "staff"),
      password: String(fd.get("password") || ""),
    };

    if (!payload.name) return alert("이름을 입력해 주세요.");
    if (!id && !payload.email) return alert("로그인 이메일을 입력해 주세요.");
    if (!id && !payload.password) return alert("신규 계정은 초기 비밀번호가 필요합니다.");

    try {
      setFormBusy(form, true);
      let saved = null;
      if (id) {
        const res = (DataAccess && typeof DataAccess.updateAdminStaffViaApi === 'function')
          ? await DataAccess.updateAdminStaffViaApi(api, id, { name: payload.name, position: payload.position, phone: payload.phone, role: payload.role }, { auth: true })
          : await api(`/admin/staff?id=${encodeURIComponent(id)}`, { method: 'PATCH', auth: true, body: { id, name: payload.name, position: payload.position, phone: payload.phone, role: payload.role } });
        saved = res?.item || null;
      } else {
        const res = (DataAccess && typeof DataAccess.createAdminStaffViaApi === 'function')
          ? await DataAccess.createAdminStaffViaApi(api, payload, { auth: true })
          : await api('/admin/staff', { method: 'POST', auth: true, body: payload });
        saved = res?.item || null;
      }
      mod.resetStaffForm();
      await mod.loadStaff();
      mod.resetStaffForm();
      renderSummary();
      alert(id ? "프로필이 저장되었습니다." : "계정이 생성되었습니다.");
      return;
    } catch (err) {
      console.error(err);
      alert(err.message || "저장 실패");
    } finally {
      setFormBusy(form, false);
    }
  };

  mod.renderStaffTable = function renderStaffTable() {
    const { state, els, utils } = ctx();
    const { escapeHtml, escapeAttr, formatDate } = utils;
    if (!els.staffTableBody || !els.staffEmpty) return;
    els.staffTableBody.innerHTML = "";

    const rows = Array.isArray(state.staff) ? state.staff.slice() : [];
    if (!rows.length) {
      els.staffEmpty.classList.remove("hidden");
      return;
    }
    els.staffEmpty.classList.add("hidden");

    const roleLabelOf = (role) => {
      const r = String(role || "staff").toLowerCase();
      if (r === "admin") return "관리자";
      if (r === "other") return "기타";
      return "담당자";
    };

    const allProps = utils.getAuxiliaryPropertiesSnapshot ? utils.getAuxiliaryPropertiesSnapshot() : [];
    const propCountMap = new Map();
    allProps.forEach((p) => {
      const aid = String(p.assignedAgentId || p.assigneeId || '').trim();
      if (aid) propCountMap.set(aid, (propCountMap.get(aid) || 0) + 1);
    });

    // 로그인 중 판정: last_sign_in_at이 현재 기준 1시간 이내 (Supabase 기본 JWT 만료)
    const LOGIN_WINDOW_MS = 60 * 60 * 1000;
    const nowTs = Date.now();
    const isStaffLoggedIn = (staff) => {
      const ts = Date.parse(staff?.lastSignInAt || '');
      if (!Number.isFinite(ts)) return false;
      return (nowTs - ts) <= LOGIN_WINDOW_MS;
    };

    const frag = document.createDocumentFragment();
    rows.forEach((staff) => {
      const tr = document.createElement("tr");
      const assignedCount = propCountMap.get(String(staff.id)) || 0;
      const loggedIn = isStaffLoggedIn(staff);
      const chipClass = loggedIn ? 'staff-login-chip is-online' : 'staff-login-chip is-offline';
      const chipHtml = `<span class="${chipClass}" title="${loggedIn ? '로그인 중' : '로그아웃 상태'}">Log-in</span>`;
      const nameCell = `<span class="staff-name-wrap">${escapeHtml(staff.name || staff.email || "-")} ${chipHtml}</span>`;
      tr.innerHTML = `
        <td>${nameCell}</td>
        <td class="staff-email-cell">${escapeHtml(staff.email || "-")}</td>
        <td class="staff-position-cell">${escapeHtml(staff.position || "-")}</td>
        <td class="staff-phone-cell">${escapeHtml(staff.phone || "-")}</td>
        <td class="staff-role-cell">${escapeHtml(roleLabelOf(staff.role))}</td>
        <td class="staff-count-cell">${assignedCount}</td>
        <td class="staff-date-cell">${escapeHtml(formatDate(staff.createdAt) || "-")}</td>
        <td>
          <div class="action-row">
            <button type="button" class="btn btn-secondary btn-sm" data-act="edit" data-id="${escapeAttr(staff.id)}">수정</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="${escapeAttr(staff.id)}">삭제</button>
          </div>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.staffTableBody.appendChild(frag);
    mod.bindStaffTableActions();
  };

  // ═══════════════════════════════════════════════════════
  // 물건 배정 시스템
  // ═══════════════════════════════════════════════════════

  const BUCKET_KEYS = ['auction', 'onbid', 'realtor_naver', 'realtor_direct', 'general'];
  const BUCKET_LABELS = { auction: '경매', onbid: '공매', realtor_naver: '네이버중개', realtor_direct: '일반중개', general: '일반' };

  function getSourceBucket(utils, p) {
    var PD = window.KNSN_PROPERTY_DOMAIN;
    if (PD && typeof PD.getSourceBucket === 'function') return PD.getSourceBucket(p);
    const st = String(p.sourceType || '').trim();
    if (st === 'realtor') return p.isDirectSubmission ? 'realtor_direct' : 'realtor_naver';
    return st || 'general';
  }

  function isManaged(p) {
    return !!String(p.siteInspection || '').trim();
  }

  function extractGu(p) {
    const addr = String(p.address || '').trim();
    const m = addr.match(/(서울|경기|인천|부산|대구|대전|광주|울산|세종|충[남북]|전[남북]|경[남북]|강원|제주)[^\s]*\s+([^\s]*[시군구])/);
    if (m) return m[2];
    const m2 = addr.match(/([^\s]*[구군시])/);
    return m2 ? m2[1] : '기타';
  }

  // A. 담당자 배정 현황 렌더링
  mod.renderAssignmentStatus = function renderAssignmentStatus() {
    const { state, els, utils } = ctx();
    const { normalizeRole, escapeHtml } = utils;
    if (!els.assignStatusBody) return;

    const allAgents = (state.staff || []).filter((s) => normalizeRole(s.role) === 'staff');
    // 담당자 필터가 있으면 선택된 담당자만 표시
    const filterAgentIds = [...(_multiSelectState.assignAgentFilter || [])];
    const agents = filterAgentIds.length
      ? allAgents.filter(function(a) { return filterAgentIds.includes(String(a.id)); })
      : allAgents;
    if (!agents.length) {
      els.assignStatusBody.innerHTML = '';
      if (els.assignStatusEmpty) {
        els.assignStatusEmpty.classList.remove('hidden');
        els.assignStatusEmpty.textContent = allAgents.length
          ? '선택한 담당자가 없습니다. (담당자 필터에서 선택해 주세요.)'
          : '담당자 계정을 먼저 등록해 주세요.';
      }
      return;
    }
    if (els.assignStatusEmpty) els.assignStatusEmpty.classList.add('hidden');

    const allProps = utils.getAuxiliaryPropertiesSnapshot() || [];

    // 담당자별 + 구분별 집계
    const agentStats = new Map();
    agents.forEach((a) => {
      const entry = { total: {}, managed: {} };
      BUCKET_KEYS.forEach((k) => { entry.total[k] = 0; entry.managed[k] = 0; });
      agentStats.set(String(a.id), entry);
    });

    allProps.forEach((p) => {
      const aid = String(p.assignedAgentId || p.assigneeId || '').trim();
      if (!aid || !agentStats.has(aid)) return;
      const bucket = getSourceBucket(utils, p);
      const key = BUCKET_KEYS.includes(bucket) ? bucket : 'general';
      const entry = agentStats.get(aid);
      entry.total[key] = (entry.total[key] || 0) + 1;
      if (isManaged(p)) entry.managed[key] = (entry.managed[key] || 0) + 1;
    });

    const frag = document.createDocumentFragment();
    agents.forEach((a) => {
      const entry = agentStats.get(String(a.id));
      const tr = document.createElement('tr');
      let totalAll = 0, managedAll = 0;
      let cells = `<td style="font-weight:600;">${escapeHtml(a.name || a.email || '-')}</td>`;
      BUCKET_KEYS.forEach((k) => {
        const t = entry.total[k] || 0;
        const m = entry.managed[k] || 0;
        totalAll += t;
        managedAll += m;
        const pct = t > 0 ? (m / t * 100).toFixed(1) : '0.0';
        cells += `<td style="font-size:11px;white-space:nowrap;">${t > 0 ? `<span style="color:var(--brand);">(${pct}%)</span> ${m}/총 ${t}` : '<span style="color:var(--muted);">-</span>'}</td>`;
      });
      const allPct = totalAll > 0 ? (managedAll / totalAll * 100).toFixed(1) : '0.0';
      cells += `<td style="font-size:11px;font-weight:600;white-space:nowrap;">(${allPct}%) ${managedAll}/총 ${totalAll}</td>`;
      tr.innerHTML = cells;
      frag.appendChild(tr);
    });
    els.assignStatusBody.innerHTML = '';
    els.assignStatusBody.appendChild(frag);
  };

  // ── 다중 선택 필터 UI (패널을 body에 부착하여 overflow 회피) ──
  // 시/도 표준 정렬 순서 (실제 데이터에 존재하는 것만 옵션으로 노출)
  const SIDO_ORDER = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
  const SIDO_NORMALIZE = {
    '서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천',
    '광주광역시':'광주','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종',
    '경기도':'경기','강원특별자치도':'강원','강원도':'강원',
    '충청북도':'충북','충청남도':'충남',
    '전북특별자치도':'전북','전라북도':'전북','전라남도':'전남',
    '경상북도':'경북','경상남도':'경남','제주특별자치도':'제주',
    // 약식
    '서울':'서울','부산':'부산','대구':'대구','인천':'인천','광주':'광주','대전':'대전',
    '울산':'울산','세종':'세종','경기':'경기','강원':'강원','충북':'충북','충남':'충남',
    '전북':'전북','전남':'전남','경북':'경북','경남':'경남','제주':'제주',
  };

  // 주소 → { sido, gu, dong } 추출
  // gu 는 가능한 한 ~구를 우선, 없으면 ~시/~군 (도지역의 단일 시 또는 군)
  // 광역시 + ~구 의 경우: '서울 강남구 역삼동' → { 서울, 강남구, 역삼동 }
  // 도 + ~시 + ~구 의 경우: '경기 수원시 영통구 영통동' → { 경기, 영통구, 영통동 } (수원시는 생략)
  // 도 + ~시 (구 없음) 경우: '경기 김포시 사우동' → { 경기, 김포시, 사우동 }
  function extractRegion(p) {
    const addr = String(p?.address || '').trim();
    if (!addr) return { sido: '', gu: '', dong: '' };
    const tokens = addr.split(/\s+/);
    if (!tokens.length) return { sido: '', gu: '', dong: '' };
    let sido = '';
    let i = 0;
    if (SIDO_NORMALIZE[tokens[0]]) {
      sido = SIDO_NORMALIZE[tokens[0]];
      i = 1;
    }
    // ~구 우선 검색 (i ~ i+2 범위)
    let gu = '';
    for (let j = i; j < Math.min(tokens.length, i + 3); j++) {
      if (/[가-힣]+구$/.test(tokens[j])) { gu = tokens[j]; i = j + 1; break; }
    }
    if (!gu) {
      for (let j = i; j < Math.min(tokens.length, i + 2); j++) {
        if (/[가-힣]+(시|군)$/.test(tokens[j])) { gu = tokens[j]; i = j + 1; break; }
      }
    }
    let dong = '';
    if (tokens[i] && /[가-힣\d·]+(동|읍|면|리)$/.test(tokens[i])) dong = tokens[i];
    return { sido, gu, dong };
  }

  const FILTER_DEFS = {
    assignSidoFilter:   { placeholder: '전체 시/도',   options: [] }, // dynamic
    assignGuFilter:     { placeholder: '전체 시/군/구', options: [] }, // dynamic
    assignDongFilter:   { placeholder: '전체 동',     options: [] }, // dynamic
    assignSourceFilter: {
      placeholder: '전체 구분',
      options: [
        { value: 'auction', label: '경매' }, { value: 'onbid', label: '공매' },
        { value: 'realtor_naver', label: '네이버중개' }, { value: 'realtor_direct', label: '일반중개' },
        { value: 'general', label: '일반' },
      ],
    },
    assignAreaFilter: {
      placeholder: '전체 면적',
      options: [
        { value: '0-5', label: '5평 미만' }, { value: '5-10', label: '5~10평' },
        { value: '10-20', label: '10~20평' }, { value: '20-30', label: '20~30평' },
        { value: '30-50', label: '30~50평' }, { value: '50-100', label: '50~100평' },
        { value: '100-', label: '100평 이상' },
      ],
    },
    assignPriceFilter: {
      placeholder: '전체 가격',
      options: [
        { value: '0-1', label: '1억 미만' }, { value: '1-3', label: '1~3억' },
        { value: '3-5', label: '3~5억' }, { value: '5-10', label: '5~10억' },
        { value: '10-20', label: '10~20억' }, { value: '20-', label: '20억 이상' },
      ],
    },
    assignAgentFilter:  { placeholder: '전체 담당자', options: [] }, // dynamic
  };
  const _multiSelectState = {};
  const _multiPanels = [];
  const _multiInstances = {}; // { [filterKey]: { panel, btn, syncBtnText, renderOptions, def, selected } }

  function closeAllPanels() {
    _multiPanels.forEach(function(ref) { ref.panel.style.display = 'none'; ref.isOpen = false; });
  }

  function buildMultiSelect(container, filterKey, onChange) {
    const def = FILTER_DEFS[filterKey];
    if (!container || !def) return null;
    _multiSelectState[filterKey] = new Set();
    const selected = _multiSelectState[filterKey];

    container.innerHTML = '';
    container.style.cssText = 'position:relative;display:inline-block;min-width:140px;';

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
    panel.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:6px 0;min-width:160px;max-height:260px;overflow-y:auto;';
    document.body.appendChild(panel);

    const ref = { panel: panel, isOpen: false };
    _multiPanels.push(ref);

    let currentOptions = Array.isArray(def.options) ? def.options.slice() : [];

    function renderOptionsInternal(options) {
      currentOptions = Array.isArray(options) ? options.slice() : [];
      // 새 옵션에 없는 선택은 정리 (cascading 시 stale 제거)
      const validValues = new Set(currentOptions.map(function(o) { return String(o.value); }));
      Array.from(selected).forEach(function(v) {
        if (!validValues.has(String(v))) selected.delete(v);
      });
      panel.innerHTML = '';
      if (!currentOptions.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:10px 14px;color:var(--muted,#999);font-size:12px;white-space:nowrap;';
        empty.textContent = '옵션 없음';
        panel.appendChild(empty);
        syncBtnText();
        return;
      }
      currentOptions.forEach(function(opt) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:6px 14px;cursor:pointer;font-size:13px;white-space:nowrap;user-select:none;';
        row.addEventListener('mouseenter', function() { row.style.background = 'var(--hover-bg,#f5f5f5)'; });
        row.addEventListener('mouseleave', function() { row.style.background = ''; });
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = String(opt.value);
        cb.checked = selected.has(String(opt.value));
        cb.style.cssText = 'margin:0;flex-shrink:0;';
        cb.addEventListener('change', function(e) {
          e.stopPropagation();
          if (cb.checked) selected.add(String(opt.value)); else selected.delete(String(opt.value));
          syncBtnText();
          if (typeof onChange === 'function') onChange();
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(opt.label));
        panel.appendChild(row);
      });
      syncBtnText();
    }

    function syncBtnText() {
      if (!selected.size) { btn.textContent = def.placeholder; return; }
      const labels = currentOptions.filter(function(o) { return selected.has(String(o.value)); }).map(function(o) { return o.label; });
      if (!labels.length) {
        btn.textContent = selected.size + '개 선택';
        return;
      }
      btn.textContent = labels.length <= 2 ? labels.join(', ') : labels.slice(0, 2).join(', ') + ' +' + (labels.length - 2);
    }

    function positionPanel() {
      const r = btn.getBoundingClientRect();
      panel.style.top = (r.bottom + 2) + 'px';
      panel.style.left = r.left + 'px';
      panel.style.minWidth = Math.max(r.width, 160) + 'px';
    }

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const wasOpen = ref.isOpen;
      closeAllPanels();
      if (!wasOpen) {
        positionPanel();
        panel.style.display = 'block';
        ref.isOpen = true;
      }
    });

    panel.addEventListener('click', function(e) { e.stopPropagation(); });

    renderOptionsInternal(currentOptions);

    const inst = { ref: ref, def: def, selected: selected, renderOptions: renderOptionsInternal, syncBtnText: syncBtnText, btn: btn, panel: panel };
    _multiInstances[filterKey] = inst;
    return inst;
  }

  function rebuildMultiSelectOptions(filterKey, newOptions) {
    const inst = _multiInstances[filterKey];
    if (!inst) return;
    inst.renderOptions(newOptions || []);
  }

  if (!window.__knsnAssignPanelClose) {
    window.__knsnAssignPanelClose = true;
    document.addEventListener('click', function() { closeAllPanels(); });
  }

  // 경매/공매 물건이 이미 종결된(낙찰/매각/취하/기각) 상태인지 판별.
  // 자동/수동 배정 시 이런 물건은 배정 후보에서 제외해야 함.
  // 두 가지 필드를 모두 확인:
  //   - result_status: 매각결과 (정식 필드) — "낙찰","매각","유찰","취하","기각"
  //   - status: 진행상태 — "유찰 N회","낙찰","취하","변경" 등 (일부 CSV 는 여기에만 들어옴)
  const AUCTION_FINALIZED_STATUSES = new Set(['낙찰', '매각', '취하', '기각']);
  function isAuctionLikeFinalized(prop) {
    if (!prop) return false;
    const src = String(prop.sourceType || prop.source_type || prop._raw?.source_type || prop._raw?.sourceType || '').trim().toLowerCase();
    if (src !== 'auction' && src !== 'onbid') return false;
    // raw.raw 와 최상위 양쪽 모두 체크 (레코드 구조가 경로마다 달라 대응)
    const containers = [
      prop._raw?.raw,
      prop._raw,
      prop.raw,
      prop,
    ].filter((c) => c && typeof c === 'object');
    const statusValues = [];
    for (const c of containers) {
      if (c.result_status) statusValues.push(String(c.result_status).trim());
      if (c.resultStatus) statusValues.push(String(c.resultStatus).trim());
      if (c.status) statusValues.push(String(c.status).trim());
    }
    if (prop.status) statusValues.push(String(prop.status).trim());
    // 종결 상태 이름을 정확히 포함하면 종결로 간주
    // (status 에 "낙찰" 단독 또는 "낙찰 (매각불허)" 같은 변형 포함)
    for (const s of statusValues) {
      if (!s) continue;
      for (const finalized of AUCTION_FINALIZED_STATUSES) {
        if (s === finalized) return true;
        // "낙찰" 로 시작하거나, 단어 경계로 포함되는 케이스
        if (s.startsWith(finalized)) return true;
      }
    }
    return false;
  }

  // ── 동적 옵션 갱신 (시/도→구→동 cascading + 담당자) ──
  function getAllUnassignedRaw() {
    const { utils } = ctx();
    const allProps = utils.getAuxiliaryPropertiesSnapshot() || [];
    return allProps.filter(function(p) {
      const aid = String(p.assignedAgentId || p.assigneeId || '').trim();
      if (aid) return false;  // 이미 배정된 건 제외
      // 경매/공매 중 종결된(낙찰/매각/취하/기각) 물건은 배정 후보에서 제외
      if (isAuctionLikeFinalized(p)) return false;
      return true;
    });
  }

  function refreshRegionOptions() {
    const unassigned = getAllUnassignedRaw();
    const sidoSet = new Set();
    const regions = [];
    for (const p of unassigned) {
      const r = extractRegion(p);
      regions.push(r);
      if (r.sido) sidoSet.add(r.sido);
    }
    // 시/도 옵션: SIDO_ORDER 기준 정렬 + 데이터에 존재하는 것만
    const sidoOptions = SIDO_ORDER.filter(function(s) { return sidoSet.has(s); }).map(function(s) { return { value: s, label: s }; });
    rebuildMultiSelectOptions('assignSidoFilter', sidoOptions);

    const selectedSidos = _multiSelectState.assignSidoFilter || new Set();
    const guSet = new Set();
    for (const r of regions) {
      if (selectedSidos.size && !selectedSidos.has(r.sido)) continue;
      if (r.gu) guSet.add(r.gu);
    }
    const guOptions = Array.from(guSet).sort(function(a, b) { return a.localeCompare(b, 'ko'); }).map(function(g) { return { value: g, label: g }; });
    rebuildMultiSelectOptions('assignGuFilter', guOptions);

    const selectedGus = _multiSelectState.assignGuFilter || new Set();
    const dongSet = new Set();
    for (const r of regions) {
      if (selectedSidos.size && !selectedSidos.has(r.sido)) continue;
      if (selectedGus.size && !selectedGus.has(r.gu)) continue;
      if (r.dong) dongSet.add(r.dong);
    }
    const dongOptions = Array.from(dongSet).sort(function(a, b) { return a.localeCompare(b, 'ko'); }).map(function(d) { return { value: d, label: d }; });
    rebuildMultiSelectOptions('assignDongFilter', dongOptions);
  }

  function refreshAgentOptions() {
    const { state, utils } = ctx();
    const normalizeRole = utils.normalizeRole || function(r) { return String(r || '').trim().toLowerCase(); };
    const agents = (state.staff || []).filter(function(s) { return normalizeRole(s.role) === 'staff'; });
    const opts = agents.map(function(a) {
      const label = String(a.name || a.email || '').trim() || ('#' + a.id);
      return { value: String(a.id), label: label };
    });
    rebuildMultiSelectOptions('assignAgentFilter', opts);
  }

  mod.initMultiSelectFilters = function initMultiSelectFilters() {
    const { els } = ctx();
    const onChange = function() { mod.renderAssignFilterSummary(); };
    // 지역 cascading: 시/도 → 구 → 동
    buildMultiSelect(els.assignSidoFilter,   'assignSidoFilter',   function() { refreshRegionOptions(); onChange(); });
    buildMultiSelect(els.assignGuFilter,     'assignGuFilter',     function() { refreshRegionOptions(); onChange(); });
    buildMultiSelect(els.assignDongFilter,   'assignDongFilter',   onChange);
    // 기존 3개
    buildMultiSelect(els.assignSourceFilter, 'assignSourceFilter', onChange);
    buildMultiSelect(els.assignAreaFilter,   'assignAreaFilter',   onChange);
    buildMultiSelect(els.assignPriceFilter,  'assignPriceFilter',  onChange);
    // 담당자 (선택 시 배정현황 표 + 자동배정 대상도 한정)
    buildMultiSelect(els.assignAgentFilter,  'assignAgentFilter',  function() { mod.renderAssignmentStatus(); onChange(); });
    // 동적 옵션 초기 채움
    refreshRegionOptions();
    refreshAgentOptions();
  };

  // B. 배정 물건 조건 설정 + 필터 요약
  function getAssignFilterValues() {
    return {
      sidos:    [...(_multiSelectState.assignSidoFilter   || [])],
      gus:      [...(_multiSelectState.assignGuFilter     || [])],
      dongs:    [...(_multiSelectState.assignDongFilter   || [])],
      sources:  [...(_multiSelectState.assignSourceFilter || [])],
      areas:    [...(_multiSelectState.assignAreaFilter   || [])],
      prices:   [...(_multiSelectState.assignPriceFilter  || [])],
      agentIds: [...(_multiSelectState.assignAgentFilter  || [])],
    };
  }

  function matchesAreaFilter(value, area) {
    if (!value) return true;
    const PD = window.KNSN_PROPERTY_DOMAIN;
    if (PD && typeof PD.matchesAreaFilter === 'function') return PD.matchesAreaFilter(value, area);
    const [minS, maxS] = String(value).split('-');
    const min = parseFloat(minS) || 0;
    const max = maxS ? parseFloat(maxS) : Infinity;
    const n = Number(area);
    if (!Number.isFinite(n) || n <= 0) return false;
    return n >= min && (max === Infinity || n < max);
  }

  function matchesPriceFilter(value, p) {
    if (!value) return true;
    const PD = window.KNSN_PROPERTY_DOMAIN;
    if (PD && typeof PD.matchesPriceRangeFilter === 'function') return PD.matchesPriceRangeFilter(value, p);
    const [minS, maxS] = String(value).split('-');
    const min = (parseFloat(minS) || 0) * 100000000;
    const max = maxS ? parseFloat(maxS) * 100000000 : Infinity;
    const price = Number(p.priceMain || 0) || 0;
    if (!price || price <= 0) return false;
    return price >= min && (max === Infinity || price < max);
  }

  function getFilteredUnassignedProperties() {
    const filters = getAssignFilterValues();
    const needRegion = filters.sidos.length || filters.gus.length || filters.dongs.length;
    return getAllUnassignedRaw().filter(function(p) {
      const { utils } = ctx();
      // 구분 필터 (다중)
      if (filters.sources.length) {
        const bucket = getSourceBucket(utils, p);
        if (!filters.sources.includes(bucket)) return false;
      }
      // 면적 필터 (다중)
      if (filters.areas.length) {
        if (!filters.areas.some(function(v) { return matchesAreaFilter(v, p.exclusivearea); })) return false;
      }
      // 가격 필터 (다중)
      if (filters.prices.length) {
        if (!filters.prices.some(function(v) { return matchesPriceFilter(v, p); })) return false;
      }
      // 지역 필터 (시/도/구/동, 다중)
      if (needRegion) {
        const r = extractRegion(p);
        if (filters.sidos.length && !filters.sidos.includes(r.sido)) return false;
        if (filters.gus.length   && !filters.gus.includes(r.gu))     return false;
        if (filters.dongs.length && !filters.dongs.includes(r.dong)) return false;
      }
      // 담당자 필터는 미배정 물건 필터링에는 적용하지 않음
      // (배정 대상 담당자 한정용 — 자동배정/배정현황표에서 적용)
      return true;
    });
  }

  mod.renderAssignFilterSummary = function renderAssignFilterSummary() {
    const { els, utils } = ctx();
    if (!els.assignFilterSummary) return;

    const filtered = getFilteredUnassignedProperties();
    if (els.assignFilterTotal) els.assignFilterTotal.textContent = `미배정 ${filtered.length}건`;

    if (!filtered.length) {
      els.assignFilterSummary.innerHTML = '<span style="color:var(--muted);">조건에 해당하는 미배정 물건이 없습니다.</span>';
      return;
    }

    // 구분별 → 지역별 집계
    const bucketMap = new Map();
    filtered.forEach((p) => {
      const bucket = getSourceBucket(utils, p);
      const key = BUCKET_KEYS.includes(bucket) ? bucket : 'general';
      if (!bucketMap.has(key)) bucketMap.set(key, new Map());
      const guMap = bucketMap.get(key);
      const gu = extractGu(p);
      guMap.set(gu, (guMap.get(gu) || 0) + 1);
    });

    const parts = [];
    BUCKET_KEYS.forEach((k) => {
      if (!bucketMap.has(k)) return;
      const guMap = bucketMap.get(k);
      const total = [...guMap.values()].reduce((a, b) => a + b, 0);
      const guParts = [...guMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([gu, cnt]) => `${gu}(${cnt})`)
        .join(', ');
      const more = guMap.size > 8 ? ` 외 ${guMap.size - 8}개 지역` : '';
      parts.push(`<strong>${BUCKET_LABELS[k] || k}(${total})</strong>: ${guParts}${more}`);
    });

    els.assignFilterSummary.innerHTML = parts.join('<br/>');
  };

  // 통합 렌더
  let _filtersInitialized = false;
  mod.refreshAssignmentView = function refreshAssignmentView() {
    if (!_filtersInitialized) {
      mod.initMultiSelectFilters();
      _filtersInitialized = true;
    } else {
      // 데이터/담당자 변경 반영: 시/도·구·동·담당자 옵션 재갱신
      // (cascading 시 stale 선택은 renderOptions 내부에서 자동 정리됨)
      try { refreshRegionOptions(); } catch (_) {}
      try { refreshAgentOptions(); } catch (_) {}
    }
    mod.renderAssignmentStatus();
    mod.renderAssignFilterSummary();
  };

  // ═══════════════════════════════════════════════════════
  // C. 자동 물건 배정 (미리보기 모달 + 서버 API + 배치 이력)
  // ═══════════════════════════════════════════════════════

  function escapeForHtml(v) {
    return String(v ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  // Phase 1/2 로직 상수
  const PHASE1_BUCKETS = ['auction', 'onbid'];                          // 경매/공매 (앵커)
  const PHASE2_BUCKETS = ['realtor_naver', 'realtor_direct', 'general']; // 중개/일반

  function toFiniteNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function getLatLng(p) {
    const lat = toFiniteNumber(p?.latitude ?? p?.lat ?? p?._raw?.latitude);
    const lng = toFiniteNumber(p?.longitude ?? p?.lng ?? p?._raw?.longitude);
    if (lat === null || lng === null) return null;
    return { lat, lng };
  }
  // 서울권 범위에서는 단순 유클리드로도 오차 무시 가능. sqrt 생략 (정렬에만 쓰므로)
  function squaredDist(a, b) {
    const dx = a.lat - b.lat;
    const dy = a.lng - b.lng;
    return dx * dx + dy * dy;
  }
  // 배열을 N 명에게 균등 분배 (나머지는 앞쪽부터 +1)
  function splitEvenly(items, numAgents) {
    const per = Math.floor(items.length / numAgents);
    const rem = items.length - per * numAgents;
    const out = [];
    let idx = 0;
    for (let i = 0; i < numAgents; i++) {
      const cnt = per + (i < rem ? 1 : 0);
      out.push(items.slice(idx, idx + cnt));
      idx += cnt;
    }
    return out;
  }

  // 미배정 물건 + 담당자 조합으로 assignments 계산 (2-phase: 경매/공매 균등 → 중개/일반 최근접)
  function computeAssignments() {
    const { state, utils } = ctx();
    const normalizeRole = utils.normalizeRole || function(r) { return String(r || '').trim().toLowerCase(); };

    const allAgents = (state.staff || []).filter((s) => normalizeRole(s.role) === 'staff');
    if (!allAgents.length) return { error: '담당자 계정을 먼저 등록해 주세요.' };

    const filterAgentIds = [...(_multiSelectState.assignAgentFilter || [])];
    const agents = filterAgentIds.length
      ? allAgents.filter((a) => filterAgentIds.includes(String(a.id)))
      : allAgents;
    if (!agents.length) return { error: '선택한 담당자가 없습니다. 담당자 필터를 다시 확인해 주세요.' };

    const filtered = getFilteredUnassignedProperties();
    if (!filtered.length) return { error: '배정할 미배정 물건이 없습니다.' };

    // Phase 1(경매/공매) / Phase 2(중개/일반) 로 분리
    const phase1Props = [];
    const phase2Props = [];
    filtered.forEach((p) => {
      const bucket = getSourceBucket(utils, p);
      const key = BUCKET_KEYS.includes(bucket) ? bucket : 'general';
      if (PHASE1_BUCKETS.includes(key)) phase1Props.push({ p, bucket: key });
      else phase2Props.push({ p, bucket: key });
    });

    // Phase 1 비면: 중개/일반 건수만 안내하고 스킵
    if (!phase1Props.length) {
      return {
        error: `앵커가 되는 경매/공매 물건이 없습니다.\n\n현재 필터 결과: 중개/일반 ${phase2Props.length}건만 존재.\n경매 또는 공매를 필터에 포함해 주세요.`,
      };
    }

    // ── Phase 1: 경매/공매를 담당자 수 만큼 균등 분배 ──
    // 재현성을 위해 id 정렬 후 분배
    phase1Props.sort((a, b) => String(a.p.id || '').localeCompare(String(b.p.id || '')));
    const splits = splitEvenly(phase1Props, agents.length);

    const assignments = [];
    // agentId -> { name, anchors: [{lat,lng}] } (Phase 2 에서 사용)
    const agentAnchors = new Map();
    agents.forEach((a, i) => {
      const aid = String(a.id);
      const aname = String(a.name || a.email || '');
      agentAnchors.set(aid, { name: aname, anchors: [] });
      splits[i].forEach(({ p }) => {
        assignments.push({
          propertyId: String(p.id || p.globalId || '').trim(),
          agentId: aid,
          agentName: aname,
          phase: 1,
        });
        const ll = getLatLng(p);
        if (ll) agentAnchors.get(aid).anchors.push(ll);
      });
    });

    // ── Phase 2: 중개/일반을 "가장 가까운 Phase 1 앵커의 담당자" 에게 ──
    // 좌표 있음 → 최단거리 담당자 / 좌표 없음 → 라운드로빈
    let rrIdx = 0;
    const rrIds = agents.map((a) => String(a.id));
    const rrNames = agents.map((a) => String(a.name || a.email || ''));

    phase2Props.forEach(({ p }) => {
      const ll = getLatLng(p);
      let chosenId = null;
      let chosenName = null;

      if (ll) {
        let best = Infinity;
        for (const [aid, info] of agentAnchors.entries()) {
          if (!info.anchors.length) continue;
          for (const anc of info.anchors) {
            const d = squaredDist(ll, anc);
            if (d < best) {
              best = d;
              chosenId = aid;
              chosenName = info.name;
            }
          }
        }
      }
      // 좌표 없거나 앵커 담당자 결정 실패 → 라운드로빈
      if (!chosenId) {
        const i = rrIdx % rrIds.length;
        chosenId = rrIds[i];
        chosenName = rrNames[i];
        rrIdx++;
      }

      assignments.push({
        propertyId: String(p.id || p.globalId || '').trim(),
        agentId: chosenId,
        agentName: chosenName,
        phase: 2,
      });
    });

    // 담당자별 집계 (phase 별 세부 포함)
    const agentSummary = {};
    assignments.forEach((a) => {
      if (!agentSummary[a.agentId]) {
        agentSummary[a.agentId] = { name: a.agentName, count: 0, phase1: 0, phase2: 0 };
      }
      agentSummary[a.agentId].count += 1;
      if (a.phase === 1) agentSummary[a.agentId].phase1 += 1;
      else agentSummary[a.agentId].phase2 += 1;
    });

    const phase2NoCoord = phase2Props.filter(({ p }) => !getLatLng(p)).length;

    return {
      assignments,
      agents,
      filterAgentIds,
      filtered,
      agentSummary,
      filterSnapshot: { ...getAssignFilterValues() },
      strategy: {
        mode: '2phase_nearest',
        phase1Count: phase1Props.length,
        phase2Count: phase2Props.length,
        phase2NoCoord,
      },
    };
  }

  // ── 미리보기 모달 ──
  function showPreviewModal(plan, onConfirm) {
    const { els } = ctx();
    if (!els.assignPreviewModal) {
      // 모달 DOM 없으면 기존 confirm 으로 fallback
      const ok = confirm(`미배정 ${plan.assignments.length}건을 ${plan.agents.length}명에게 자동 배정할까요?`);
      if (ok) onConfirm();
      return;
    }
    // Summary
    const total = plan.assignments.length;
    const agentCount = plan.agents.length;
    const strat = plan.strategy || {};
    const phase1Count = Number(strat.phase1Count || 0);
    const phase2Count = Number(strat.phase2Count || 0);
    const phase2NoCoord = Number(strat.phase2NoCoord || 0);

    els.assignPreviewSummary.innerHTML =
      `<div style="font-weight:600;font-size:14px;margin-bottom:4px;">총 ${total}건을 ${agentCount}명에게 배정합니다.</div>`
      + `<div style="color:var(--text-secondary,#666);font-size:12px;line-height:1.5;margin-bottom:6px;">`
      +   `① 경매/공매 <strong>${phase1Count}건</strong>을 담당자에게 균등 분배<br/>`
      +   `② 중개/일반 <strong>${phase2Count}건</strong>을 각 물건의 좌표 기준 가장 가까운 경매/공매 담당자에게 자동 배정`
      + `</div>`
      + (phase2NoCoord > 0
          ? `<div style="color:#b45309;font-size:11px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:6px 8px;margin-bottom:6px;">`
          + `⚠ 중개/일반 중 좌표 없는 <strong>${phase2NoCoord}건</strong>은 담당자 순환(라운드로빈) 방식으로 배정됩니다.`
          + `</div>`
          : '')
      + `<div style="color:var(--text-secondary,#666);font-size:12px;">실행 후 '배정 이력' 섹션에서 언제든 되돌릴 수 있습니다 (3주 이내).</div>`;

    // 담당자별 배분 (Phase 1/2 세부)
    const sorted = Object.entries(plan.agentSummary).sort((a, b) => b[1].count - a[1].count);
    els.assignPreviewAgents.innerHTML = sorted.map(([aid, info]) => {
      const pct = total > 0 ? Math.round(info.count / total * 100) : 0;
      const p1 = Number(info.phase1 || 0);
      const p2 = Number(info.phase2 || 0);
      const detail = (p1 || p2)
        ? `<span style="color:var(--muted,#999);font-size:11px;font-weight:400;margin-left:6px;">경매·공매 ${p1} · 중개·일반 ${p2}</span>`
        : '';
      return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;gap:8px;flex-wrap:wrap;">`
        + `<span>${escapeForHtml(info.name || aid)}${detail}</span>`
        + `<span style="font-weight:600;">${info.count}건 <span style="color:var(--muted,#999);font-size:11px;font-weight:400;">(${pct}%)</span></span>`
        + `</div>`;
    }).join('');

    // 필터 요약
    const fs = plan.filterSnapshot;
    const pieces = [];
    if (fs.sidos.length)    pieces.push(`시/도: ${fs.sidos.join(', ')}`);
    if (fs.gus.length)      pieces.push(`시/군/구: ${fs.gus.join(', ')}`);
    if (fs.dongs.length)    pieces.push(`동: ${fs.dongs.join(', ')}`);
    if (fs.sources.length)  pieces.push(`구분: ${fs.sources.join(', ')}`);
    if (fs.areas.length)    pieces.push(`면적: ${fs.areas.join(', ')}`);
    if (fs.prices.length)   pieces.push(`가격: ${fs.prices.join(', ')}`);
    if (fs.agentIds.length) pieces.push(`담당자 한정: ${agentCount}명`);
    els.assignPreviewFilters.innerHTML = pieces.length
      ? `<strong>적용된 필터</strong><br/>${pieces.map(escapeForHtml).join('<br/>')}`
      : `<strong>적용된 필터</strong><br/><span style="color:var(--muted,#999);">필터 없음 (전체)</span>`;

    // 모달 오픈
    els.assignPreviewModal.classList.remove('hidden');
    els.assignPreviewModal.style.display = 'block';

    // 닫기 핸들러 (중복 방지: clone 으로 교체)
    const modal = els.assignPreviewModal;
    const closeModal = () => {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    };
    modal.querySelectorAll('[data-assign-preview-close]').forEach((el) => {
      const c = el.cloneNode(true);
      el.parentNode.replaceChild(c, el);
      c.addEventListener('click', closeModal);
    });
    const confirmBtn = els.btnAssignPreviewConfirm;
    if (confirmBtn) {
      const newBtn = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
      els.btnAssignPreviewConfirm = newBtn;
      newBtn.addEventListener('click', () => {
        closeModal();
        onConfirm();
      });
    }
  }

  // ── 메인: 자동 배정 실행 ──
  mod.handleAutoAssign = async function handleAutoAssign() {
    const plan = computeAssignments();
    if (plan.error) return alert(plan.error);

    showPreviewModal(plan, async () => {
      await executeAutoAssign(plan);
    });
  };

  async function executeAutoAssign(plan) {
    const { els, api, utils } = ctx();
    const { invalidatePropertyCollections, loadProperties, ensureAuxiliaryPropertiesForAdmin, setAdminLoading } = utils;

    setAdminLoading('autoAssign', true, `${plan.assignments.length}건 자동 배정 중입니다...`);
    if (els.autoAssignStatus) els.autoAssignStatus.textContent = '서버 전송 중...';

    try {
      const resp = await api('/admin/assignment-batches', {
        method: 'POST',
        auth: true,
        body: {
          assignments: plan.assignments,
          filterSnapshot: plan.filterSnapshot,
          agentSummary: plan.agentSummary,
        },
      });

      if (!resp?.ok || !resp?.batch) {
        throw new Error(resp?.message || '배정 응답이 올바르지 않습니다.');
      }

      const b = resp.batch;
      const parts = [`배정 완료: ${b.propertiesUpdated}건 성공`];
      if (b.propertiesFailed > 0) parts.push(`${b.propertiesFailed}건 실패`);
      const summaryText = Object.entries(plan.agentSummary)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([_, info]) => `${info.name}: ${info.count}건`)
        .join(', ');
      parts.push(summaryText);

      if (els.autoAssignResult) {
        els.autoAssignResult.innerHTML = `<div class="hint-box" style="margin-top:8px;">${escapeForHtml(parts.join(' / '))} <span style="color:var(--muted,#999);font-size:11px;">(배정 이력에 저장됨 · 되돌릴 수 있음)</span></div>`;
      }
      if (els.autoAssignStatus) els.autoAssignStatus.textContent = '';

      // 새로고침
      invalidatePropertyCollections();
      await ensureAuxiliaryPropertiesForAdmin({ forceRefresh: true });
      await loadProperties({ refreshSummary: true });
      mod.refreshAssignmentView();
      mod.loadAssignmentHistory();
    } catch (err) {
      console.error(err);
      alert(err.message || '자동 배정 실패');
      if (els.autoAssignStatus) els.autoAssignStatus.textContent = '';
    } finally {
      setAdminLoading('autoAssign', false);
    }
  }

  // ═══════════════════════════════════════════════════════
  // D. 배정 이력 (로드, 렌더, 롤백)
  // ═══════════════════════════════════════════════════════
  let _assignHistoryCache = [];

  mod.loadAssignmentHistory = async function loadAssignmentHistory() {
    const { els, api } = ctx();
    if (!els.assignHistoryList) return;
    try {
      const resp = await api('/admin/assignment-batches', { auth: true });
      _assignHistoryCache = Array.isArray(resp?.batches) ? resp.batches : [];
      renderAssignHistoryList();
    } catch (err) {
      console.error('[loadAssignmentHistory] failed:', err);
      els.assignHistoryList.innerHTML = `<div class="hint-box" style="color:var(--danger,#dc2626);">배정 이력을 불러오지 못했습니다: ${escapeForHtml(err.message || '')}</div>`;
    }
  };

  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    // KST 변환
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${dd} ${hh}:${mi}`;
  }

  function renderAssignHistoryList() {
    const { els } = ctx();
    if (!els.assignHistoryList) return;
    const batches = _assignHistoryCache;
    if (!batches.length) {
      els.assignHistoryList.innerHTML = '';
      if (els.assignHistoryEmpty) els.assignHistoryEmpty.classList.remove('hidden');
      return;
    }
    if (els.assignHistoryEmpty) els.assignHistoryEmpty.classList.add('hidden');

    const html = batches.map((b) => renderBatchCard(b)).join('');
    els.assignHistoryList.innerHTML = html;
    bindBatchCardActions();
  }

  function renderBatchCard(b) {
    const id = escapeForHtml(b.id);
    const when = formatDateTime(b.created_at);
    const who = escapeForHtml(b.created_by_name || '-');
    const total = Number(b.total_count || 0);
    const fs = b.filter_snapshot || {};
    const agentSummary = b.agent_summary || {};

    // 필터 요약 (한 줄)
    const fpieces = [];
    if (Array.isArray(fs.sidos) && fs.sidos.length) fpieces.push(fs.sidos.join(','));
    if (Array.isArray(fs.gus) && fs.gus.length)     fpieces.push(fs.gus.slice(0, 3).join(',') + (fs.gus.length > 3 ? ` 외${fs.gus.length-3}` : ''));
    if (Array.isArray(fs.sources) && fs.sources.length) fpieces.push(fs.sources.join(','));
    if (Array.isArray(fs.areas) && fs.areas.length) fpieces.push('면적:' + fs.areas.length);
    if (Array.isArray(fs.prices) && fs.prices.length) fpieces.push('가격:' + fs.prices.length);
    const filterSummary = fpieces.length ? escapeForHtml(fpieces.join(' · ')) : '<span style="color:var(--muted,#999);">필터 없음</span>';

    // 담당자별 집계 (롤백된 것 표시용)
    const agents = Object.entries(agentSummary);
    const agentCells = agents.map(([aid, info]) => {
      const name = escapeForHtml(info.name || aid);
      const cnt = Number(info.count || 0);
      return `<span style="display:inline-block;margin-right:8px;"><strong>${name}</strong>: ${cnt}건</span>`;
    }).join('');

    // 상태 배지
    let statusBadge = '';
    if (b.status === 'rolled_back') {
      statusBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:600;">전체 롤백됨</span>`;
    } else if (b.status === 'partial') {
      statusBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#fef3c7;color:#b45309;font-size:11px;font-weight:600;">부분 롤백</span>`;
    } else {
      statusBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;font-size:11px;font-weight:600;">활성</span>`;
    }

    // 액션 버튼
    let actions = '';
    if (b.status !== 'rolled_back') {
      actions = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost btn-sm" data-batch-agent-rollback="${id}">담당자별 롤백 ▾</button>
          <button type="button" class="btn btn-secondary btn-sm" data-batch-full-rollback="${id}">전체 되돌리기</button>
        </div>
      `;
    } else if (b.rolled_back_at) {
      actions = `<span style="font-size:11px;color:var(--muted,#999);">롤백 시각: ${escapeForHtml(formatDateTime(b.rolled_back_at))}</span>`;
    }

    return `
      <div class="assign-batch-card" style="border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:12px;margin-bottom:8px;background:var(--surface,#fff);" data-batch-id="${id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1 1 300px;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <strong style="font-size:13px;">${escapeForHtml(when)}</strong>
              ${statusBadge}
              <span style="color:var(--muted,#999);font-size:11px;">· 실행: ${who}</span>
            </div>
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${total}건</div>
            <div style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:4px;">${agentCells}</div>
            <div style="font-size:11px;color:var(--muted,#999);">필터: ${filterSummary}</div>
          </div>
          <div style="flex:0 0 auto;">${actions}</div>
        </div>
      </div>
    `;
  }

  function bindBatchCardActions() {
    const { els } = ctx();
    if (!els.assignHistoryList) return;
    els.assignHistoryList.querySelectorAll('[data-batch-full-rollback]').forEach((btn) => {
      btn.addEventListener('click', () => handleBatchRollback(btn.dataset.batchFullRollback, null));
    });
    els.assignHistoryList.querySelectorAll('[data-batch-agent-rollback]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showAgentRollbackMenu(btn);
      });
    });
  }

  function showAgentRollbackMenu(anchorBtn) {
    const batchId = anchorBtn.dataset.batchAgentRollback;
    const batch = _assignHistoryCache.find((b) => b.id === batchId);
    if (!batch) return;
    const agents = Object.entries(batch.agent_summary || {});
    if (!agents.length) { alert('담당자 정보가 없습니다.'); return; }

    // 기존 메뉴 제거
    document.querySelectorAll('.__agent-rollback-menu').forEach((el) => el.remove());

    const menu = document.createElement('div');
    menu.className = '__agent-rollback-menu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:6px 0;min-width:200px;max-height:280px;overflow-y:auto;';

    agents.forEach(([aid, info]) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:block;width:100%;text-align:left;padding:7px 14px;border:0;background:transparent;cursor:pointer;font-size:13px;white-space:nowrap;';
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--hover-bg,#f5f5f5)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.innerHTML = `<strong>${escapeForHtml(info.name || aid)}</strong> <span style="color:var(--muted,#999);font-size:11px;">${info.count}건 되돌리기</span>`;
      row.addEventListener('click', () => {
        menu.remove();
        handleBatchRollback(batchId, [aid]);
      });
      menu.appendChild(row);
    });

    document.body.appendChild(menu);
    const r = anchorBtn.getBoundingClientRect();
    menu.style.top = (r.bottom + 2) + 'px';
    menu.style.left = r.left + 'px';

    const closeOnOutside = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
  }

  async function handleBatchRollback(batchId, agentIds) {
    const { api, utils } = ctx();
    const { invalidatePropertyCollections, loadProperties, ensureAuxiliaryPropertiesForAdmin, setAdminLoading } = utils;
    const batch = _assignHistoryCache.find((b) => b.id === batchId);
    if (!batch) return;

    let confirmMsg;
    if (agentIds && agentIds.length) {
      const agentNames = agentIds.map((aid) => (batch.agent_summary?.[aid]?.name || aid)).join(', ');
      const targetCount = agentIds.reduce((sum, aid) => sum + Number(batch.agent_summary?.[aid]?.count || 0), 0);
      confirmMsg = `"${agentNames}" 담당자의 배정 ${targetCount}건을 되돌립니다. 진행할까요?`;
    } else {
      confirmMsg = `이 배치의 모든 배정(총 ${batch.total_count}건)을 되돌립니다. 진행할까요?`;
    }
    if (!confirm(confirmMsg)) return;

    setAdminLoading('autoAssign', true, '배정 되돌리는 중입니다...');
    try {
      const resp = await api(`/admin/assignment-batches?id=${encodeURIComponent(batchId)}&action=rollback`, {
        method: 'POST',
        auth: true,
        body: agentIds && agentIds.length ? { agentIds } : {},
      });
      if (!resp?.ok) throw new Error(resp?.message || '롤백 응답이 올바르지 않습니다.');
      const r = resp.rollback || {};
      alert(`되돌리기 완료: ${r.restoredOk || 0}건 복구${r.restoredFail ? ` · ${r.restoredFail}건 실패` : ''}`);

      // 새로고침
      invalidatePropertyCollections();
      await ensureAuxiliaryPropertiesForAdmin({ forceRefresh: true });
      await loadProperties({ refreshSummary: true });
      mod.refreshAssignmentView();
      await mod.loadAssignmentHistory();
    } catch (err) {
      console.error(err);
      alert(err.message || '롤백 실패');
    } finally {
      setAdminLoading('autoAssign', false);
    }
  }

  // 새로고침 버튼 바인딩 (한 번만)
  if (!window.__knsnBatchHistoryBound) {
    window.__knsnBatchHistoryBound = true;
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('btnAssignHistoryRefresh');
      if (btn) btn.addEventListener('click', () => { mod.loadAssignmentHistory(); });
    });
    // 이미 DOMContentLoaded 끝난 경우 대비
    if (document.readyState !== 'loading') {
      setTimeout(() => {
        const btn = document.getElementById('btnAssignHistoryRefresh');
        if (btn && !btn.__bound) {
          btn.__bound = true;
          btn.addEventListener('click', () => { mod.loadAssignmentHistory(); });
        }
      }, 0);
    }
  }

  AdminModules.staffRegions = mod;
})();
