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
      PropertyDomain: rt.PropertyDomain || window.KNSN_PROPERTY_DOMAIN || null,
    };
  }


  function buildFormFeedbackHtml(text, kind = 'info') {
    const message = String(text || '').trim();
    if (!message) return '';
    const strongText = kind === 'error' ? '오류' : kind === 'success' ? '완료' : '안내';
    return `<div class="form-feedback-shell is-${kind}"><div class="admin-loading-box"><span class="admin-loading-spinner" aria-hidden="true"></span><div class="admin-loading-copy"><strong>${strongText}</strong><p>${message}</p></div></div></div>`;
  }

  function setNpmMsgLocal(els, text, isError = true) {
    if (!els.npmMsg) return;
    els.npmMsg.innerHTML = buildFormFeedbackHtml(text, isError ? 'error' : 'success');
    if (String(text || '').trim()) {
      window.requestAnimationFrame(() => {
        try { els.npmMsg.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
      });
    }
  }


  function refreshPropertiesInBackground(state, utils) {
    try { utils.invalidatePropertyCollections?.(); } catch {}
    Promise.resolve()
      .then(() => utils.loadProperties?.({ refreshSummary: state.activeTab === 'home' }))
      .catch((err) => console.warn('properties refresh failed', err));
  }

  function syncTypeCards(form) {
    form?.querySelectorAll?.('.npm-type-card')?.forEach((card) => {
      card.classList.toggle('is-active', !!card.querySelector('input[type=radio]')?.checked);
    });
  }

  function syncSubmitterKindFields(els, form) {
    const checked = form?.querySelector?.('input[name="submitterKind"]:checked');
    const isRealtor = (checked?.value || 'realtor') === 'realtor';
    if (els.npmRealtorFields) els.npmRealtorFields.classList.toggle('hidden', !isRealtor);
    if (els.npmOwnerFields) els.npmOwnerFields.classList.toggle('hidden', isRealtor);
    syncTypeCards(form);
  }

  mod.bindEvents = function bindEvents() {
    const { els } = ctx();
    if (mod._bound) return;
    mod._bound = true;

    if (els.npmClose) els.npmClose.addEventListener('click', () => mod.closeNewPropertyModal());
    if (els.npmCancel) els.npmCancel.addEventListener('click', () => mod.closeNewPropertyModal());
    if (els.newPropertyModal) {
      els.newPropertyModal.addEventListener('click', (e) => {
        if (e.target?.dataset?.close === 'true') mod.closeNewPropertyModal();
      });
    }
    if (els.newPropertyForm) {
      els.newPropertyForm.addEventListener('change', (e) => {
        if (e.target?.name === 'submitterKind' || e.target?.closest?.('.npm-type-card')) {
          syncSubmitterKindFields(els, els.newPropertyForm);
        }
      });
      els.newPropertyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        mod.submitNewProperty().catch((err) => mod.setNpmMsg(err?.message || '등록 실패'));
      });
    }
  };

  mod.openNewPropertyModal = function openNewPropertyModal() {
    const { els, utils } = ctx();
    if (!els.newPropertyModal || !els.newPropertyForm) return;
    els.newPropertyForm.reset();
    if (typeof utils.configureFormNumericUx === 'function') {
      utils.configureFormNumericUx(els.newPropertyForm, {
        decimalNames: ['commonarea', 'exclusivearea', 'sitearea'],
        amountNames: ['priceMain'],
      });
    }
    syncSubmitterKindFields(els, els.newPropertyForm);
    setNpmMsgLocal(els, '');
    utils.setModalOpen?.(true);
    els.newPropertyModal.classList.remove('hidden');
    els.newPropertyModal.setAttribute('aria-hidden', 'false');
  };

  mod.closeNewPropertyModal = function closeNewPropertyModal() {
    const { els, utils } = ctx();
    if (!els.newPropertyModal) return;
    els.newPropertyModal.classList.add('hidden');
    els.newPropertyModal.setAttribute('aria-hidden', 'true');
    utils.setModalOpen?.(false);
    setNpmMsgLocal(els, '');
  };

  mod.setNpmMsg = function setNpmMsg(text, isError = true) {
    const { els } = ctx();
    setNpmMsgLocal(els, text, isError);
  };

  mod.submitNewProperty = async function submitNewProperty() {
    const { state, els, K, api, utils, PropertyDomain } = ctx();
    const f = els.newPropertyForm;
    if (!f) throw new Error('등록 폼을 찾을 수 없습니다.');
    const fd = new FormData(f);
    const readStr = (k) => String(fd.get(k) || '').trim();
    const readNum = (k) => utils.parseFlexibleNumber ? utils.parseFlexibleNumber(fd.get(k)) : null;

    const actorName = String(state.session?.user?.name || state.session?.user?.email || '').trim();
    const submitterKind = PropertyDomain?.normalizeRegistrationSubmitterKind?.(readStr('submitterKind'), { fallback: 'realtor' }) || 'realtor';
    let submitterName = '';
    let submitterPhone = '';
    let realtorName = null;
    let realtorPhone = null;
    let realtorCell = null;

    if (submitterKind === 'realtor') {
      realtorName = readStr('realtorname');
      realtorPhone = readStr('realtorphone') || null;
      realtorCell = readStr('realtorcell');
      submitterName = actorName || readStr('submitterName') || null;
      submitterPhone = realtorCell;
    } else {
      submitterName = readStr('submitterName') || actorName || '';
      submitterPhone = readStr('submitterPhone');
    }

    const submissionCore = PropertyDomain?.buildRegistrationSubmissionCore?.({
      submitterKind,
      address: readStr('address'),
      assetType: readStr('assetType'),
      priceMain: readNum('priceMain'),
      floor: readStr('floor') || null,
      totalFloor: readStr('totalfloor') || null,
      useApproval: readStr('useapproval') || null,
      commonArea: readNum('commonarea'),
      exclusiveArea: readNum('exclusivearea'),
      siteArea: readNum('sitearea'),
      realtorName,
      realtorPhone,
      realtorCell,
      submitterName,
      submitterPhone,
      opinion: readStr('opinion') || null,
    }, { actorName }) || null;
    const validationMessage = PropertyDomain?.validateRegistrationSubmissionCore?.(submissionCore, {
      requiredMessage: '주소, 세부유형, 매매가는 필수입니다.',
      realtorMessage: '중개사무소명과 휴대폰번호를 입력해 주세요.',
      ownerMessage: '이름과 연락처를 입력해 주세요.',
    }) || '';
    if (validationMessage) throw new Error(validationMessage);

    const payload = PropertyDomain?.buildRegistrationSubmissionPayload?.(submissionCore, {
      actorName,
      registrationKind: 'admin',
    }) || null;
    if (!payload) throw new Error('등록 데이터를 준비하지 못했습니다.');

    if (els.npmSave) els.npmSave.disabled = true;
    setNpmMsgLocal(els, '');
    try {
      const supabaseMode = typeof utils.isSupabaseMode === 'function'
        ? !!utils.isSupabaseMode()
        : !!(K?.supabaseEnabled?.() && K.initSupabase?.());
      const sb = supabaseMode ? K.initSupabase() : null;
      const regContext = typeof utils.buildRegisterLogContext === 'function'
        ? utils.buildRegisterLogContext('관리자 등록', state.session?.user)
        : null;

      if (sb) {
        await utils.ensureAuxiliaryPropertiesForAdmin?.();
        const existing = utils.findExistingPropertyByRegistrationKey?.(payload.raw, utils.getAuxiliaryPropertiesSnapshot?.());
        if (existing) {
          const merged = utils.buildRegistrationDbRowForExisting?.(existing, payload, regContext);
          if (!merged?.row) throw new Error('등록 병합 데이터를 준비하지 못했습니다.');
          await utils.updatePropertyRowResilient?.(sb, existing.id || existing.globalId, merged.row);
          setNpmMsgLocal(els, merged.changes?.length ? '기존 물건을 갱신하고 등록 LOG를 추가했습니다.' : '동일 물건이 있어 기존 물건에 반영했습니다.', false);
        } else {
          const row = utils.buildRegistrationDbRowForCreate?.(payload, regContext);
          await utils.insertPropertyRowResilient?.(sb, row);
          setNpmMsgLocal(els, '등록되었습니다.', false);
        }
      } else {
        if (DataAccess && typeof DataAccess.submitPublicListingViaApi === 'function') {
          await DataAccess.submitPublicListingViaApi(api, payload);
        } else {
          throw new Error('KNSN_DATA_ACCESS.submitPublicListingViaApi 를 찾을 수 없습니다.');
        }
        setNpmMsgLocal(els, '등록되었습니다.', false);
      }

      window.setTimeout(() => {
        mod.closeNewPropertyModal();
        window.setTimeout(() => refreshPropertiesInBackground(state, utils), 2400);
      }, 2200);
    } finally {
      if (els.npmSave) els.npmSave.disabled = false;
    }
  };

  AdminModules.newPropertyModal = mod;
})();
