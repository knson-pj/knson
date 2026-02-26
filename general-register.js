(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";

  const form = document.getElementById("generalForm");
  const msgEl = document.getElementById("msg");
  const btnSubmit = document.getElementById("btnSubmit");

  const viewForm = document.getElementById("viewForm");
  const viewDone = document.getElementById("viewDone");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const payload = {
      source: "general",
      address: String(fd.get("address") || "").trim(),
      salePrice: Number(fd.get("salePrice") || 0),
      registrantName: String(fd.get("registrantName") || "").trim(),
      phone: normalizePhone(String(fd.get("phone") || "")),
      memo: String(fd.get("memo") || "").trim(),
    };

    if (!payload.address || !payload.salePrice || !payload.registrantName || !payload.phone) {
      setMsg("필수 항목을 모두 입력해 주세요.");
      return;
    }

    try {
      setBusy(true);
      setMsg("");

      const res = await api("/public-listings", {
        method: "POST",
        body: payload,
      });

      if (res?.duplicate) {
        // 중복이어도 접수로 처리하는 정책
        // UI 메시지만 안내
        setMsg("동일 주소 물건이 이미 접수되어 있습니다. 검토 후 연락드리겠습니다.");
      }

      form.reset();
      viewForm.classList.add("hidden");
      viewDone.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      setMsg(err?.message || "등록 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  });

  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();

    const headers = { Accept: "application/json" };
    const hasBody = !["GET", "HEAD"].includes(method);
    if (hasBody) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body || {}) : undefined,
      });
    } catch {
      throw new Error("서버 연결에 실패했습니다. (네트워크/CORS 확인)");
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      throw new Error(data?.message || `API 오류 (${res.status})`);
    }
    return data;
  }

  function normalizePhone(v) {
    return String(v || "").replace(/[\D]/g, "");
  }

  function setBusy(busy) {
    btnSubmit.disabled = busy;
    [...form.querySelectorAll("input, textarea")].forEach((el) => (el.disabled = busy));
  }

  function setMsg(text) {
    msgEl.textContent = text || "";
  }
})();
