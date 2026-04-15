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

    const frag = document.createDocumentFragment();
    rows.forEach((staff) => {
      const tr = document.createElement("tr");
      const assignedCount = propCountMap.get(String(staff.id)) || 0;
      tr.innerHTML = `
        <td>${escapeHtml(staff.name || staff.email || "-")}</td>
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
  // 물건배정 시스템
  // ═══════════════════════════════════════════════════════

  const BUCKET_KEYS = ['auction', 'onbid', 'realtor_naver', 'realtor_direct', 'general'];
  const BUCKET_LABELS = { auction: '경매', onbid: '공매', realtor_naver: '네이버중개', realtor_direct: '일반중개', general: '일반' };

  function getSourceBucket(utils, p) {
    if (utils.PropertyDomain && typeof utils.PropertyDomain.getSourceBucket === 'function') return utils.PropertyDomain.getSourceBucket(p);
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

    const agents = (state.staff || []).filter((s) => normalizeRole(s.role) === 'staff');
    if (!agents.length) {
      els.assignStatusBody.innerHTML = '';
      if (els.assignStatusEmpty) els.assignStatusEmpty.classList.remove('hidden');
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

  // B. 배정 물건 조건 설정 + 필터 요약
  function getAssignFilterValues() {
    const { els } = ctx();
    return {
      source: String(els.assignSourceFilter?.value || '').trim(),
      area: String(els.assignAreaFilter?.value || '').trim(),
      price: String(els.assignPriceFilter?.value || '').trim(),
      keyword: String(els.assignKeyword?.value || '').trim().toLowerCase(),
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
    const { utils } = ctx();
    const allProps = utils.getAuxiliaryPropertiesSnapshot() || [];
    const filters = getAssignFilterValues();
    return allProps.filter((p) => {
      // 미배정만
      const aid = String(p.assignedAgentId || p.assigneeId || '').trim();
      if (aid) return false;
      // 구분 필터
      if (filters.source) {
        const bucket = getSourceBucket(utils, p);
        if (bucket !== filters.source) return false;
      }
      // 면적 필터
      if (filters.area && !matchesAreaFilter(filters.area, p.exclusivearea)) return false;
      // 가격 필터
      if (filters.price && !matchesPriceFilter(filters.price, p)) return false;
      // 키워드 필터
      if (filters.keyword) {
        const text = String(p.address || '').toLowerCase() + ' ' + String(p.regionGu || '').toLowerCase() + ' ' + String(p.regionDong || '').toLowerCase();
        if (!text.includes(filters.keyword)) return false;
      }
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
  mod.refreshAssignmentView = function refreshAssignmentView() {
    mod.renderAssignmentStatus();
    mod.renderAssignFilterSummary();
  };

  // C. 자동 물건 배정
  mod.handleAutoAssign = async function handleAutoAssign() {
    const { state, els, K, utils } = ctx();
    const { normalizeRole, getStaffNameById, invalidatePropertyCollections, loadProperties, ensureAuxiliaryPropertiesForAdmin, setAdminLoading } = utils;
    const DataAccess = window.KNSN_DATA_ACCESS;

    const agents = (state.staff || []).filter((s) => normalizeRole(s.role) === 'staff');
    if (!agents.length) return alert('담당자 계정을 먼저 등록해 주세요.');

    const filtered = getFilteredUnassignedProperties();
    if (!filtered.length) return alert('배정할 미배정 물건이 없습니다.');

    if (!confirm(`미배정 ${filtered.length}건을 ${agents.length}명의 담당자에게 자동 배정할까요?`)) return;

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
