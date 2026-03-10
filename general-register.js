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

  document.addEventListener("DOMContentLoaded", () => {
    if (K && typeof K.initTheme === "function") {
      K.initTheme({ container: document.querySelector(".actions"), className: "theme-toggle" });
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const sourceType = String(fd.get("sourceType") || "general").trim() || "general";
    const address = String(fd.get("address") || "").trim();
    const salePrice = Number(fd.get("salePrice") || 0);
    const registrant = String(fd.get("registrantName") || "").trim();
    const phone = String(fd.get("phone") || "").trim();

    if (!address || !salePrice || !registrant || !phone) {
      setMsg("주소/매각가/등록자/전화번호를 모두 입력해 주세요.");
      return;
    }

    const payload = {
      sourceType,
      address,
      priceMain: salePrice,
      memo: `등록자:${registrant} / 전화:${phone}`,
      registrant,
      phone,
    };

    try {
      setBusy(true);
      setMsg("");

      if (sbEnabled) {
        // Supabase 직접 저장(초기 버전: 즉시 노출 요구사항 반영)
        // 보안/검증은 추후 강화 예정 (승인/캡차/레이트리밋 등)
        const sb = K.initSupabase();
        const globalId = `${sourceType}:public:${Date.now()}:${Math.random().toString(16).slice(2)}`;
        const row = {
          global_id: globalId,
          item_no: globalId,
          source_type: sourceType,
          is_general: false,
          address,
          price_main: salePrice,
          memo: [payload.memo, fd.get("memo") ? String(fd.get("memo")).trim() : ""].filter(Boolean).join("\n"),
          assignee_id: null,
          date_uploaded: new Date().toISOString(),
          raw: payload,
        };

        const { error } = await sb.from("properties").insert(row);
        if (error) throw error;

        done();
        return;
      }

      // Legacy (Vercel API)
      const res = await api("/public-listings", {
        method: "POST",
        body: {
          source: sourceType === "realtor" ? "general" : "general",
          address: payload.address,
          salePrice: payload.priceMain,
          registrant: payload.registrant,
          phone: payload.phone,
          // forward-compatible fields
          sourceType: payload.sourceType,
          priceMain: payload.priceMain,
          memo: payload.memo,
        },
      });

      if (!res?.ok) throw new Error(res?.message || "등록에 실패했습니다.");
      done();
    } catch (err) {
      setMsg(err?.message || "등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  });

  function done() {
    viewForm.classList.add("hidden");
    viewDone.classList.remove("hidden");
  }

  function setBusy(b) {
    btnSubmit.disabled = !!b;
    btnSubmit.textContent = b ? "등록 중..." : "등록";
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
