(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

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

  function setNpmMsgLocal(els, text, isError = true) {
    if (!els.npmMsg) return;
    els.npmMsg.style.color = isError ? '#ff8b8b' : '#9ff0b6';
    els.npmMsg.textContent = text || '';
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
    const { state, els, K, api, utils } = ctx();
    const f = els.newPropertyForm;
    if (!f) throw new Error('등록 폼을 찾을 수 없습니다.');
    const fd = new FormData(f);
    const readStr = (k) => String(fd.get(k) || '').trim();
    const readNum = (k) => utils.parseFlexibleNumber ? utils.parseFlexibleNumber(fd.get(k)) : null;

    const submitterKind = readStr('submitterKind') || 'realtor';
    const sourceType = submitterKind === 'realtor' ? 'realtor' : 'general';
    const address = readStr('address');
    const assetType = readStr('assetType');
    const priceMain = readNum('priceMain');

    if (!address || !assetType || !priceMain) throw new Error('주소, 세부유형, 매매가는 필수입니다.');

    const actorName = String(state.session?.user?.name || state.session?.user?.email || '').trim();
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
      if (!realtorName || !realtorCell) throw new Error('중개사무소명과 휴대폰번호를 입력해 주세요.');
    } else {
      submitterName = readStr('submitterName') || actorName || '';
      submitterPhone = readStr('submitterPhone');
      if (!submitterName || !submitterPhone) throw new Error('이름과 연락처를 입력해 주세요.');
    }

    const payload = {
      source_type: sourceType,
      is_general: sourceType === 'general',
      submitter_type: submitterKind === 'realtor' ? 'realtor' : 'owner',
      address,
      asset_type: assetType,
      price_main: priceMain,
      use_approval: readStr('useapproval') || null,
      common_area: readNum('commonarea'),
      exclusive_area: readNum('exclusivearea'),
      site_area: readNum('sitearea'),
      broker_office_name: realtorName,
      submitter_name: submitterName || null,
      submitter_phone: submitterPhone,
      memo: readStr('opinion') || null,
      raw: {
        sourceType,
        submitterType: submitterKind === 'realtor' ? 'realtor' : 'owner',
        address, assetType, priceMain,
        floor: readStr('floor') || null,
        totalfloor: readStr('totalfloor') || null,
        useapproval: readStr('useapproval') || null,
        commonArea: readNum('commonarea'),
        exclusiveArea: readNum('exclusivearea'),
        siteArea: readNum('sitearea'),
        realtorName, realtorPhone, realtorCell,
        submitterName, submitterPhone,
        opinion: readStr('opinion') || null,
        registeredByAdmin: true,
        registeredByName: actorName || null,
      },
    };

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
        await api('/public-listings', { method: 'POST', body: payload });
        setNpmMsgLocal(els, '등록되었습니다.', false);
      }

      window.setTimeout(() => {
        mod.closeNewPropertyModal();
        utils.invalidatePropertyCollections?.();
        utils.loadProperties?.({ refreshSummary: state.activeTab === 'home', homeOnly: state.activeTab === 'home' });
      }, 700);
    } finally {
      if (els.npmSave) els.npmSave.disabled = false;
    }
  };

  AdminModules.newPropertyModal = mod;
})();
