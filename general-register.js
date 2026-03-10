(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";

  const form = document.getElementById("generalForm");
  const msgEl = document.getElementById("msg");
  const btnSubmit = document.getElementById("btnSubmit");
  const viewForm = document.getElementById("viewForm");
  const viewDone = document.getElementById("viewDone");
  const realtorFields = document.getElementById("realtorFields");
  const ownerFields = document.getElementById("ownerFields");
  const typeCards = () => [...document.querySelectorAll('.type-card')];

  const K = window.KNSN || null;
  const sbEnabled = !!(K && K.supabaseEnabled && K.supabaseEnabled() && K.initSupabase());

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
    const submitterKind = getSubmitterKind();
    const sourceType = submitterKind === 'realtor' ? 'realtor' : 'general';
    const submitterType = submitterKind === 'realtor' ? 'realtor' : 'owner';

    const address = readStr(fd, 'address');
    const assetType = readStr(fd, 'assetType');
    const priceMain = readNum(fd, 'priceMain');
    const exclusiveArea = readNum(fd, 'exclusiveArea');
    const commonArea = readNum(fd, 'commonArea');
    const siteArea = readNum(fd, 'siteArea');
    const useApproval = readStr(fd, 'useApproval') || null;
    const sourceUrl = readStr(fd, 'sourceUrl') || null;
    const memo = readStr(fd, 'memo') || null;

    let submitterName = '';
    let submitterPhone = '';
    let brokerOfficeName = null;
    let brokerName = null;
    let brokerLicenseNo = null;

    if (submitterKind === 'realtor') {
      brokerOfficeName = readStr(fd, 'brokerOfficeName');
      brokerName = readStr(fd, 'brokerName');
      brokerLicenseNo = readStr(fd, 'brokerLicenseNo') || null;
      submitterPhone = readStr(fd, 'submitterPhoneRealtor');
      submitterName = brokerName;
      if (!brokerOfficeName || !brokerName || !submitterPhone) {
        setMsg('공인중개사 등록은 중개사무소명/공인중개사명/연락처를 입력해 주세요.');
        return;
      }
    } else {
      submitterName = readStr(fd, 'submitterNameOwner');
      submitterPhone = readStr(fd, 'submitterPhoneOwner');
      if (!submitterName || !submitterPhone) {
        setMsg('소유자/일반 등록은 이름과 연락처를 입력해 주세요.');
        return;
      }
    }

    if (!address || !assetType || !priceMain) {
      setMsg('주소/부동산유형/기준금액을 입력해 주세요.');
      return;
    }

    const payload = {
      sourceType,
      submitterType,
      address,
      assetType,
      priceMain,
      exclusiveArea,
      commonArea,
      siteArea,
      useApproval,
      sourceUrl,
      memo,
      submitterName,
      submitterPhone,
      brokerOfficeName,
      brokerName,
      brokerLicenseNo,
    };

    try {
      setBusy(true);
      setMsg('');

      if (sbEnabled) {
        const sb = K.initSupabase();
        const row = {
          source_type: sourceType,
          address,
          asset_type: assetType,
          exclusive_area: exclusiveArea,
          common_area: commonArea,
          site_area: siteArea,
          use_approval: useApproval,
          price_main: priceMain,
          source_url: sourceUrl,
          memo,
          assignee_id: null,
          submitter_type: submitterType,
          submitter_name: submitterName,
          submitter_phone: submitterPhone,
          broker_office_name: brokerOfficeName,
          broker_name: brokerName,
          broker_license_no: brokerLicenseNo,
          raw: payload,
        };

        const { error } = await sb.from('properties').insert(row);
        if (error) throw error;
        done();
        return;
      }

      const res = await api('/public-listings', {
        method: 'POST',
        body: payload,
      });
      if (!res?.ok) throw new Error(res?.message || '등록에 실패했습니다.');
      done();
    } catch (err) {
      setMsg(err?.message || '등록에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  });

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
    const n = Number(v);
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
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }
})();
