(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";

  const form = document.getElementById("generalForm");
  const msgEl = document.getElementById("msg");
  const btnSubmit = document.getElementById("btnSubmit");

  const viewForm = document.getElementById("viewForm");
  const viewDone = document.getElementById("viewDone");

  const K = window.KNSN || null;
  const sbEnabled = !!(K && K.supabaseEnabled && K.supabaseEnabled() && K.initSupabase());

  const submitterRadios = [...document.querySelectorAll('input[name="submitterType"]')];
  const ownerPanel = document.querySelector('[data-panel="owner"]');
  const realtorPanel = document.querySelector('[data-panel="realtor"]');

  document.addEventListener("DOMContentLoaded", () => {
    if (K && typeof K.initTheme === "function") {
      K.initTheme({ container: document.querySelector(".actions"), className: "theme-toggle" });
    }
    syncPanels(getSubmitterType());
  });

  submitterRadios.forEach((radio) => {
    radio.addEventListener("change", () => syncPanels(getSubmitterType()));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const submitterType = getSubmitterType();
    const sourceType = submitterType === "realtor" ? "realtor" : "general";

    const payload = {
      sourceType,
      submitterType,
      address: readText(fd, "address"),
      assetType: readText(fd, "assetType"),
      priceMain: readNumber(fd, "priceMain"),
      commonArea: readNumber(fd, "commonArea"),
      exclusiveArea: readNumber(fd, "exclusiveArea"),
      siteArea: readNumber(fd, "siteArea"),
      useApproval: readText(fd, "useApproval") || null,
      sourceUrl: readText(fd, "sourceUrl") || null,
      memo: readText(fd, "memo") || null,
      submitterName: submitterType === "realtor" ? readText(fd, "brokerName") : readText(fd, "submitterNameOwner"),
      submitterPhone: submitterType === "realtor" ? readText(fd, "submitterPhoneRealtor") : readText(fd, "submitterPhoneOwner"),
      brokerOfficeName: submitterType === "realtor" ? readText(fd, "brokerOfficeName") : null,
      brokerName: submitterType === "realtor" ? readText(fd, "brokerName") : null,
      brokerLicenseNo: submitterType === "realtor" ? readText(fd, "brokerLicenseNo") : null,
    };

    const validationError = validatePayload(payload);
    if (validationError) {
      setMsg(validationError);
      return;
    }

    try {
      setBusy(true);
      setMsg("");

      if (sbEnabled) {
        const sb = K.initSupabase();
        const row = {
          source_type: payload.sourceType,
          is_general: payload.sourceType === "general",
          address: payload.address,
          asset_type: payload.assetType,
          exclusive_area: payload.exclusiveArea,
          common_area: payload.commonArea,
          site_area: payload.siteArea,
          use_approval: payload.useApproval,
          status: "review",
          price_main: payload.priceMain,
          source_url: payload.sourceUrl,
          memo: payload.memo,
          assignee_id: null,
          submitter_type: payload.submitterType,
          submitter_name: payload.submitterName,
          submitter_phone: payload.submitterPhone,
          broker_office_name: payload.brokerOfficeName,
          broker_name: payload.brokerName,
          broker_license_no: payload.brokerLicenseNo,
          raw: {
            channel: "public-register",
            submitted_at: new Date().toISOString(),
            form: payload,
          },
        };

        Object.keys(row).forEach((key) => {
          if (row[key] === "") row[key] = null;
        });

        const { error } = await sb.from("properties").insert(row);
        if (error) throw error;

        done();
        return;
      }

      const res = await api("/public-listings", {
        method: "POST",
        body: payload,
      });

      if (!res?.ok) throw new Error(res?.message || "등록에 실패했습니다.");
      done();
    } catch (err) {
      setMsg(err?.message || "등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  });

  function getSubmitterType() {
    return (submitterRadios.find((radio) => radio.checked)?.value || "realtor").trim();
  }

  function syncPanels(type) {
    const isRealtor = type === "realtor";
    realtorPanel?.classList.toggle("hidden", !isRealtor);
    ownerPanel?.classList.toggle("hidden", isRealtor);

    setRequired("brokerOfficeName", isRealtor);
    setRequired("brokerName", isRealtor);
    setRequired("submitterPhoneRealtor", isRealtor);
    setRequired("submitterNameOwner", !isRealtor);
    setRequired("submitterPhoneOwner", !isRealtor);
  }

  function setRequired(name, required) {
    const el = form.elements[name];
    if (!el) return;
    el.required = !!required;
    if (!required) el.setCustomValidity("");
  }

  function validatePayload(payload) {
    if (!payload.address) return "물건 주소를 입력해 주세요.";
    if (!payload.assetType) return "부동산유형을 입력해 주세요.";
    if (!payload.priceMain) return "기준금액을 입력해 주세요.";
    if (!payload.submitterName) return payload.submitterType === "realtor" ? "공인중개사명을 입력해 주세요." : "등록자명을 입력해 주세요.";
    if (!payload.submitterPhone) return "연락처를 입력해 주세요.";
    if (payload.submitterType === "realtor" && !payload.brokerOfficeName) return "중개사무소명을 입력해 주세요.";
    return "";
  }

  function readText(fd, key) {
    return String(fd.get(key) || "").trim();
  }

  function readNumber(fd, key) {
    const raw = String(fd.get(key) || "").trim();
    if (!raw) return null;
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function done() {
    viewForm.classList.add("hidden");
    viewDone.classList.remove("hidden");
  }

  function setBusy(b) {
    btnSubmit.disabled = !!b;
    btnSubmit.textContent = b ? "등록 중..." : "등록 요청하기";
  }

  function setMsg(msg) {
    msgEl.textContent = msg || "";
    msgEl.classList.toggle("show", !!msg);
  }

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }
})();
