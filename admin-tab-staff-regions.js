(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return { rt, state: rt.state || {}, els: rt.els || {}, api: rt.adminApi, utils: rt.utils || {} };
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

  // ── 동적 옵션 갱신 (시/도→구→동 cascading + 담당자) ──
  function getAllUnassignedRaw() {
    const { utils } = ctx();
    const allProps = utils.getAuxiliaryPropertiesSnapshot() || [];
    return allProps.filter(function(p) {
      const aid = String(p.assignedAgentId || p.assigneeId || '').trim();
      return !aid;
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

  // C. 자동 물건 배정
  mod.handleAutoAssign = async function handleAutoAssign() {
    const { state, els, K, utils } = ctx();
    const { normalizeRole, getStaffNameById, invalidatePropertyCollections, loadProperties, ensureAuxiliaryPropertiesForAdmin, setAdminLoading } = utils;
    const DataAccess = window.KNSN_DATA_ACCESS;

    const allAgents = (state.staff || []).filter((s) => normalizeRole(s.role) === 'staff');
    if (!allAgents.length) return alert('담당자 계정을 먼저 등록해 주세요.');

    // 담당자 필터가 활성화돼 있으면 선택된 담당자에게만 배정
    const filterAgentIds = [...(_multiSelectState.assignAgentFilter || [])];
    const agents = filterAgentIds.length
      ? allAgents.filter((a) => filterAgentIds.includes(String(a.id)))
      : allAgents;
    if (!agents.length) return alert('선택한 담당자가 없습니다. 담당자 필터를 다시 확인해 주세요.');

    const filtered = getFilteredUnassignedProperties();
    if (!filtered.length) return alert('배정할 미배정 물건이 없습니다.');

    const limitedNote = filterAgentIds.length ? ` (선택 담당자 ${agents.length}명에게만)` : '';
    if (!confirm(`미배정 ${filtered.length}건을 ${agents.length}명의 담당자에게 자동 배정할까요?${limitedNote}`)) return;

    setAdminLoading('autoAssign', true, '물건 자동 배정 중입니다...');
    if (els.autoAssignStatus) els.autoAssignStatus.textContent = '배정 중...';

    try {
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      if (!sb) throw new Error('Supabase 연동이 필요합니다.');

      const allProps = utils.getAuxiliaryPropertiesSnapshot() || [];

      // 담당자별 + 구분별 업무처리율 계산
      const agentRates = agents.map((a) => {
        const aid = String(a.id);
        const rateByBucket = {};
        BUCKET_KEYS.forEach((k) => {
          let total = 0, managed = 0;
          allProps.forEach((p) => {
            if (String(p.assignedAgentId || p.assigneeId || '').trim() !== aid) return;
            const bucket = getSourceBucket(utils, p);
            if ((BUCKET_KEYS.includes(bucket) ? bucket : 'general') !== k) return;
            total++;
            if (isManaged(p)) managed++;
          });
          rateByBucket[k] = total > 0 ? managed / total : 0.5; // 데이터 없으면 50%
        });
        return { agent: a, rateByBucket };
      });

      // 구분별로 미배정 물건 분류
      const bucketProps = new Map();
      filtered.forEach((p) => {
        const bucket = getSourceBucket(utils, p);
        const key = BUCKET_KEYS.includes(bucket) ? bucket : 'general';
        if (!bucketProps.has(key)) bucketProps.set(key, []);
        bucketProps.get(key).push(p);
      });

      // 구분별로 업무처리율에 비례하여 배분
      const assignments = []; // { propId, agentId, agentName }
      for (const [bucket, props] of bucketProps.entries()) {
        // 가중치 계산 (처리율 높을수록 더 많이)
        const weights = agentRates.map((ar) => {
          const rate = ar.rateByBucket[bucket] || 0.1;
          return Math.max(rate, 0.1); // 최소 10%
        });
        const totalWeight = weights.reduce((a, b) => a + b, 0);

        // 가중 라운드로빈 배분
        const agentCounts = weights.map((w) => Math.floor(props.length * w / totalWeight));
        let remainder = props.length - agentCounts.reduce((a, b) => a + b, 0);
        // 나머지를 가중치 높은 순으로 배분
        const sortedIdx = weights.map((w, i) => ({ i, w })).sort((a, b) => b.w - a.w);
        for (let r = 0; r < remainder; r++) {
          agentCounts[sortedIdx[r % sortedIdx.length].i]++;
        }

        let idx = 0;
        agentRates.forEach((ar, ai) => {
          const cnt = agentCounts[ai];
          for (let c = 0; c < cnt && idx < props.length; c++, idx++) {
            const p = props[idx];
            assignments.push({
              propId: String(p.id || p.globalId || '').trim(),
              agentId: String(ar.agent.id),
              agentName: String(ar.agent.name || ar.agent.email || ''),
            });
          }
        });
      }

      // DB 업데이트
      let okCount = 0, failCount = 0;
      for (const a of assignments) {
        if (!a.propId) { failCount++; continue; }
        try {
          if (DataAccess && typeof DataAccess.updatePropertyRowResilient === 'function') {
            await DataAccess.updatePropertyRowResilient(sb, a.propId, { assignee_id: a.agentId, assignee_name: a.agentName });
          } else {
            await sb.from('properties').update({ assignee_id: a.agentId, assignee_name: a.agentName }).eq('id', a.propId);
          }
          okCount++;
        } catch (e) {
          console.warn('assign failed:', a.propId, e.message);
          failCount++;
        }
        if (els.autoAssignStatus) els.autoAssignStatus.textContent = `${okCount + failCount}/${assignments.length} 처리 중...`;
      }

      // 결과 표시
      const resultParts = [`배정 완료: ${okCount}건 성공`];
      if (failCount > 0) resultParts.push(`${failCount}건 실패`);

      // 담당자별 배정 결과 요약
      const agentSummary = new Map();
      assignments.forEach((a) => {
        const name = a.agentName || a.agentId;
        agentSummary.set(name, (agentSummary.get(name) || 0) + 1);
      });
      const summaryText = [...agentSummary.entries()].map(([name, cnt]) => `${name}: ${cnt}건`).join(', ');
      resultParts.push(summaryText);

      if (els.autoAssignResult) {
        els.autoAssignResult.innerHTML = `<div class="hint-box" style="margin-top:8px;">${resultParts.join(' / ')}</div>`;
      }
      if (els.autoAssignStatus) els.autoAssignStatus.textContent = '';

      // 데이터 새로고침
      invalidatePropertyCollections();
      await ensureAuxiliaryPropertiesForAdmin({ forceRefresh: true });
      await loadProperties({ refreshSummary: true });
      mod.refreshAssignmentView();
    } catch (err) {
      console.error(err);
      alert(err.message || '자동 배정 실패');
      if (els.autoAssignStatus) els.autoAssignStatus.textContent = '';
    } finally {
      setAdminLoading('autoAssign', false);
    }
  };

  AdminModules.staffRegions = mod;
})();
