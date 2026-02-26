(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";

  const els = {
    viewForm: document.getElementById("viewForm"),
    viewThanks: document.getElementById("viewThanks"),
    form: document.getElementById("generalListingForm"),
    btnSubmit: document.getElementById("btnSubmit"),
    btnNew: document.getElementById("btnNew"),
    formHint: document.getElementById("formHint"),
  };

  els.form.addEventListener("submit", onSubmit);
  els.btnNew.addEventListener("click", reset);

  function reset() {
    els.form.reset();
    hideHint();
    els.viewThanks.classList.add("hidden");
    els.viewForm.classList.remove("hidden");
  }

  async function onSubmit(e) {
    e.preventDefault();

    const fd = new FormData(els.form);
    const payload = {
      source: "general",
      address: String(fd.get("address") || "").trim(),
      salePrice: Number(fd.get("salePrice") || 0),
      registrantName: String(fd.get("registrantName") || "").trim(),
      phone: normalizePhone(String(fd.get("phone") || "")),
      memo: String(fd.get("memo") || "").trim(),
    };

    const missing = [];
    if (!payload.address) missing.push("물건 주소");
    if (!payload.salePrice) missing.push("매각가");
    if (!payload.registrantName) missing.push("등록자");
    if (!payload.phone) missing.push("전화번호");

    if (missing.length) {
      return showHint(`필수 항목을 입력해 주세요: ${missing.join(", ")}`);
    }

    try {
      setBusy(true);

      const res = await fetch(`${API_BASE}/public-listings`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

      if (!res.ok) {
        const msg = data?.message || `등록에 실패했습니다. (${res.status})`;
        throw new Error(msg);
      }

      // 성공 → 완료 화면
      els.viewForm.classList.add("hidden");
      els.viewThanks.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      showHint(err.message || "등록 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function setBusy(busy) {
    els.btnSubmit.disabled = !!busy;
    [...els.form.querySelectorAll("input, textarea, button")].forEach((el) => {
      if (el === els.btnNew) return;
      el.disabled = !!busy;
    });
  }

  function normalizePhone(v) {
    return v.replace(/[^\d]/g, "");
  }

  function showHint(msg) {
    els.formHint.textContent = msg;
    els.formHint.classList.remove("hidden");
  }

  function hideHint() {
    els.formHint.textContent = "";
    els.formHint.classList.add("hidden");
  }
})();
