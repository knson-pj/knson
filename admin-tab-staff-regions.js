(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

  const GU_ADJ = {
    "강남구": ["서초구", "송파구", "강동구", "성동구"],
    "서초구": ["강남구", "동작구", "관악구", "용산구", "송파구"],
    "송파구": ["강남구", "강동구", "광진구", "성동구", "서초구"],
    "강동구": ["송파구", "강남구", "광진구"],
    "마포구": ["서대문구", "은평구", "용산구", "영등포구"],
    "서대문구": ["은평구", "마포구", "종로구", "중구"],
    "영등포구": ["동작구", "구로구", "양천구", "마포구", "용산구"],
    "구로구": ["금천구", "양천구", "영등포구"],
    "양천구": ["강서구", "구로구", "영등포구"],
    "관악구": ["동작구", "서초구", "금천구"],
    "동작구": ["용산구", "영등포구", "관악구", "서초구"],
    "용산구": ["중구", "마포구", "서초구", "동작구", "성동구"],
    "성동구": ["광진구", "동대문구", "중구", "용산구", "강남구", "송파구"],
    "광진구": ["성동구", "동대문구", "중랑구", "강동구", "송파구"],
    "노원구": ["도봉구", "중랑구", "성북구"],
    "도봉구": ["노원구", "강북구"],
    "강북구": ["도봉구", "성북구", "종로구"],
    "성북구": ["강북구", "종로구", "동대문구", "중랑구", "노원구"],
    "종로구": ["중구", "서대문구", "성북구", "강북구", "은평구"],
    "중구": ["종로구", "용산구", "성동구", "동대문구", "서대문구"],
    "동대문구": ["중랑구", "성북구", "성동구", "중구", "광진구"],
    "중랑구": ["노원구", "동대문구", "광진구", "성북구"],
    "은평구": ["서대문구", "종로구", "마포구", "강북구"],
    "강서구": ["양천구"],
    "금천구": ["관악구", "구로구"],
  };

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return { rt, state: rt.state || {}, els: rt.els || {}, api: rt.adminApi, utils: rt.utils || {} };
  }

  mod.loadStaff = async function loadStaff() {
    const { state, api, utils } = ctx();
    const { syncSupabaseSessionIfNeeded, dedupeStaff, hydrateAssignedAgentNames, renderSummary, renderPropertiesTable } = utils;
    await syncSupabaseSessionIfNeeded();
    const res = await api("/admin/staff", { auth: true });
    state.staff = dedupeStaff(res?.items || []);
    mod.renderStaffTable();
    mod.renderAssignmentTable();
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
    const { els } = ctx();
    if (!els.staffForm) return;
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
    const { els } = ctx();
    if (!els.staffForm) return;
    els.staffForm.reset();
    els.staffForm.elements.id.value = "";
    els.staffForm.elements.role.value = "staff";
    if (els.staffForm.elements.position) els.staffForm.elements.position.value = "";
    if (els.staffForm.elements.phone) els.staffForm.elements.phone.value = "";
    mod.setStaffFormMode("create");
  };

  mod.handleSaveStaff = async function handleSaveStaff(e) {
    const { state, api, utils } = ctx();
    const { normalizeStaff, setFormBusy, renderSummary } = utils;
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
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
      setFormBusy(e.currentTarget, true);
      let saved = null;
      if (id) {
        const res = await api(`/admin/staff/${encodeURIComponent(id)}`, {
          method: "PATCH",
          auth: true,
          body: { name: payload.name, position: payload.position, phone: payload.phone, role: payload.role },
        });
        saved = res?.item || null;
      } else {
        const res = await api("/admin/staff", {
          method: "POST",
          auth: true,
          body: payload,
        });
        saved = res?.item || null;
      }
      mod.resetStaffForm();
      await mod.loadStaff();
      renderSummary();
      alert(id ? "프로필이 저장되었습니다." : "계정이 생성되었습니다.");
    } catch (err) {
      console.error(err);
      alert(err.message || "저장 실패");
    } finally {
      setFormBusy(e.currentTarget, false);
    }
  };

  mod.renderStaffTable = function renderStaffTable() {
    const { state, els, api, utils } = ctx();
    const { escapeHtml, escapeAttr, formatDate, renderSummary, hydrateAssignedAgentNames, renderPropertiesTable, setActiveTab } = utils;
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

    const frag = document.createDocumentFragment();
    rows.forEach((staff) => {
      const tr = document.createElement("tr");
      const assignedCount = Array.isArray(staff.assignedRegions) ? staff.assignedRegions.length : 0;
      tr.innerHTML = `
        <td>${escapeHtml(staff.name || staff.email || "-")}</td>
        <td class="staff-position-cell">${escapeHtml(staff.position || "-")}</td>
        <td class="staff-phone-cell">${escapeHtml(staff.phone || "-")}</td>
        <td class="staff-role-cell">${escapeHtml(roleLabelOf(staff.role))}</td>
        <td class="staff-count-cell">${assignedCount}</td>
        <td class="staff-date-cell">${escapeHtml(formatDate(staff.createdAt) || "-")}</td>
        <td>
          <div class="action-row">
            <button class="btn btn-secondary btn-sm" data-act="edit" data-id="${escapeAttr(staff.id)}">수정</button>
            <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${escapeAttr(staff.id)}">삭제</button>
          </div>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.staffTableBody.appendChild(frag);

    els.staffTableBody.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = String(e.currentTarget.dataset.id || "");
        const act = String(e.currentTarget.dataset.act || "");
        const row = state.staff.find((staff) => String(staff.id) === id);
        if (!row) return;

        if (act === "edit") {
          mod.fillStaffForm(row);
          setActiveTab("staff");
          return;
        }

        if (act === "delete") {
          if (!confirm(`계정 '${row.name || row.email || id}'을 삭제할까요?`)) return;
          try {
            await api(`/admin/staff/${encodeURIComponent(id)}`, { method: "DELETE", auth: true });
            state.staff = state.staff.filter((staff) => String(staff.id) !== id);
            mod.renderStaffTable();
            mod.renderAssignmentTable();
            renderSummary();
            hydrateAssignedAgentNames();
            renderPropertiesTable();
          } catch (err) {
            console.error(err);
            alert(err.message || "삭제 실패");
          }
        }
      });
    });
  };

  mod.renderAssignmentTable = function renderAssignmentTable() {
    const { state, els, utils } = ctx();
    const { normalizeRole, escapeHtml, escapeAttr } = utils;
    if (!els.assignmentTableBody || !els.assignmentEmpty) return;
    els.assignmentTableBody.innerHTML = "";

    const agents = state.staff.filter((s) => normalizeRole(s.role) === "staff");
    if (!agents.length) {
      els.assignmentEmpty.classList.remove("hidden");
      return;
    }
    els.assignmentEmpty.classList.add("hidden");

    const regionOptions = mod.getRegionOptionsFromProperties();
    const frag = document.createDocumentFragment();

    agents.forEach((agent) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(agent.name || agent.email || "-")}</td>
        <td>담당자</td>
        <td>
          <select class="assignment-select" data-agent-id="${escapeAttr(agent.id)}" multiple></select>
        </td>
      `;
      frag.appendChild(tr);
    });

    els.assignmentTableBody.appendChild(frag);

    els.assignmentTableBody.querySelectorAll(".assignment-select").forEach((sel) => {
      const agentId = String(sel.dataset.agentId || "");
      const agent = agents.find((a) => String(a.id) === agentId);
      if (!agent) return;
      regionOptions.forEach((region) => {
        const opt = document.createElement("option");
        opt.value = region;
        opt.textContent = region;
        opt.selected = Array.isArray(agent.assignedRegions) && agent.assignedRegions.includes(region);
        sel.appendChild(opt);
      });
    });
  };

  mod.getRegionOptionsFromProperties = function getRegionOptionsFromProperties() {
    const { utils } = ctx();
    const set = new Set();
    for (const p of utils.getAuxiliaryPropertiesSnapshot()) {
      if (p.regionGu) set.add(p.regionGu);
      if (p.regionDong) set.add(p.regionDong);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  };

  mod.handleSuggestGrouping = async function handleSuggestGrouping() {
    const { state, els, utils } = ctx();
    const { ensureAuxiliaryPropertiesForAdmin, getAuxiliaryPropertiesSnapshot, normalizeRole } = utils;
    await ensureAuxiliaryPropertiesForAdmin();
    const agents = state.staff.filter((s) => normalizeRole(s.role) === "staff");
    if (!agents.length) return alert("담당자 계정을 먼저 등록해 주세요.");

    const requestedCount = Math.max(1, Number(els.agentCountInput.value || 1));
    const unitMode = els.regionUnitMode.value;

    const grouped = mod.buildAutoRegionGrouping(getAuxiliaryPropertiesSnapshot(), requestedCount, unitMode);
    state.lastGroupSuggestion = grouped;
    mod.renderGroupSuggestion(grouped, agents);
  };

  mod.renderGroupSuggestion = function renderGroupSuggestion(grouped, agents) {
    const { els, utils } = ctx();
    const { escapeHtml } = utils;
    els.groupSuggestBox.innerHTML = "";
    if (!grouped || !grouped.groups?.length) {
      els.groupSuggestBox.innerHTML = `<div class="muted">그룹 제안 결과가 없습니다.</div>`;
      return;
    }

    const info = document.createElement("div");
    info.className = "hint-box";
    info.innerHTML = `
      <div><strong>제안 기준:</strong> ${escapeHtml(grouped.unitLabel)} / 총 지역 ${grouped.totalRegions}개 / 그룹 ${grouped.groups.length}개</div>
      <div class="muted small">※ 제안 결과는 아래 [배정 저장] 전에 테이블에서 수정 가능합니다.</div>
    `;
    els.groupSuggestBox.appendChild(info);

    const frag = document.createDocumentFragment();
    grouped.groups.forEach((g, idx) => {
      const card = document.createElement("div");
      card.className = "group-card";
      const agentName = agents[idx]?.name || `미지정 그룹 ${idx + 1}`;
      card.innerHTML = `
        <h4>그룹 ${idx + 1} (${escapeHtml(agentName)})</h4>
        <div class="group-chip-wrap">
          ${g.regions.map((r) => `<span class="group-chip">${escapeHtml(r)}</span>`).join("")}
        </div>
      `;
      frag.appendChild(card);
    });
    els.groupSuggestBox.appendChild(frag);

    const selects = [...els.assignmentTableBody.querySelectorAll(".assignment-select")];
    selects.forEach((sel, idx) => {
      const regions = grouped.groups[idx]?.regions || [];
      [...sel.options].forEach((opt) => {
        opt.selected = regions.includes(opt.value);
      });
    });
  };

  mod.handleSaveAssignments = async function handleSaveAssignments() {
    const { state, els, api, utils } = ctx();
    const { normalizeRole } = utils;
    const agents = state.staff.filter((s) => normalizeRole(s.role) === "staff");
    if (!agents.length) return alert("담당자 계정이 없습니다.");

    const rows = [...els.assignmentTableBody.querySelectorAll(".assignment-select")].map((sel) => ({
      agentId: sel.dataset.agentId,
      assignedRegions: [...sel.selectedOptions].map((o) => o.value),
    }));

    try {
      await api("/admin/region-assignments", { method: "POST", auth: true, body: { assignments: rows } });
      await mod.loadStaff();
      alert("담당자 지역 배정이 저장되었습니다.");
    } catch (err) {
      console.error(err);
      alert(err.message || "배정 저장 실패");
    }
  };

  mod.buildAutoRegionGrouping = function buildAutoRegionGrouping(properties, agentCount, unitMode) {
    const { utils } = ctx();
    const { extractGuDong } = utils;
    const valid = properties.filter((p) => p.address);
    const regionsByGu = new Map();
    for (const p of valid) {
      const { gu, dong } = extractGuDong(p.address);
      const rg = p.regionGu || gu;
      const rd = p.regionDong || dong;
      if (!rg) continue;
      if (!regionsByGu.has(rg)) regionsByGu.set(rg, new Set());
      if (rd) regionsByGu.get(rg).add(rd);
    }

    const guList = [...regionsByGu.keys()].sort((a, b) => a.localeCompare(b, "ko"));
    const guCount = guList.length;

    let mode = unitMode;
    if (unitMode === "auto") {
      mode = agentCount > guCount ? "dong" : "gu";
    }

    let regionUnits = [];
    if (mode === "gu") {
      regionUnits = guList.map((gu) => ({ key: gu, gu, weight: regionsByGu.get(gu)?.size || 1 }));
    } else {
      for (const gu of guList) {
        const dongs = [...(regionsByGu.get(gu) || [])];
        if (!dongs.length) {
          regionUnits.push({ key: gu, gu, weight: 1 });
          continue;
        }
        dongs.sort((a, b) => a.localeCompare(b, "ko")).forEach((dong) => {
          regionUnits.push({ key: dong, gu, weight: 1 });
        });
      }
    }

    const groups = Array.from({ length: Math.max(1, agentCount) }, (_, i) => ({ idx: i, regions: [], guSet: new Set(), totalWeight: 0 }));

    if (mode === "gu") {
      regionUnits = mod.sortGuUnitsByAdjacency(regionUnits);
    } else {
      regionUnits.sort((a, b) => {
        if (a.gu !== b.gu) return a.gu.localeCompare(b.gu, "ko");
        return a.key.localeCompare(b.key, "ko");
      });
    }

    for (const unit of regionUnits) {
      const target = groups.slice().sort((g1, g2) => {
        if (g1.totalWeight !== g2.totalWeight) return g1.totalWeight - g2.totalWeight;
        const p1 = g1.guSet.has(unit.gu) ? -1 : 0;
        const p2 = g2.guSet.has(unit.gu) ? -1 : 0;
        if (p1 !== p2) return p1 - p2;
        return g1.idx - g2.idx;
      })[0];

      target.regions.push(unit.key);
      target.totalWeight += unit.weight || 1;
      if (unit.gu) target.guSet.add(unit.gu);
    }

    return {
      unit: mode,
      unitLabel: mode === "gu" ? "구 단위" : "동 단위",
      totalRegions: regionUnits.length,
      groups: groups.map((g) => ({ regions: g.regions.sort((a, b) => a.localeCompare(b, "ko")), totalWeight: g.totalWeight })),
    };
  };

  mod.sortGuUnitsByAdjacency = function sortGuUnitsByAdjacency(units) {
    const left = units.slice();
    if (!left.length) return left;

    const result = [];
    left.sort((a, b) => (b.weight || 1) - (a.weight || 1));
    result.push(left.shift());

    while (left.length) {
      const last = result[result.length - 1];
      const adj = GU_ADJ[last.gu] || [];
      let idx = left.findIndex((u) => adj.includes(u.gu));
      if (idx < 0) idx = 0;
      result.push(left.splice(idx, 1)[0]);
    }

    return result;
  };

  AdminModules.staffRegions = mod;
})();
