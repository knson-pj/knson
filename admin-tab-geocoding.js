(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const DataAccess = window.KNSN_DATA_ACCESS || null;
  let _geocodeKakaoReady = null;
  let _geocoder = null;

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return { rt, state: rt.state || {}, els: rt.els || {}, K: rt.K, isSupabaseMode: rt.isSupabaseMode, utils: rt.utils || {} };
  }

  mod.getKakaoAppKey = function getKakaoAppKey() {
    const meta = document.querySelector('meta[name="kakao-app-key"]');
    return String(meta?.getAttribute("content") || "").trim();
  };

  mod.loadKakaoMapsSDK = function loadKakaoMapsSDK(appKey) {
    return new Promise((resolve, reject) => {
      if (window.kakao?.maps?.services?.Geocoder) return resolve();
      if (window.kakao?.maps?.load) return window.kakao.maps.load(() => resolve());
      const s = document.createElement("script");
      s.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey=" + encodeURIComponent(appKey) + "&autoload=false&libraries=services";
      s.async = true;
      s.onload = () => {
        if (!window.kakao?.maps?.load) return reject(new Error("Kakao SDK 로드 실패"));
        window.kakao.maps.load(() => resolve());
      };
      s.onerror = () => reject(new Error("Kakao SDK 네트워크 오류"));
      document.head.appendChild(s);
    });
  };

  mod.ensureKakaoGeocoder = async function ensureKakaoGeocoder() {
    if (_geocoder) return _geocoder;
    const appKey = mod.getKakaoAppKey();
    if (!appKey) throw new Error("카카오 JavaScript 키가 설정되지 않았습니다.");
    if (!_geocodeKakaoReady) _geocodeKakaoReady = mod.loadKakaoMapsSDK(appKey);
    await _geocodeKakaoReady;
    _geocoder = new kakao.maps.services.Geocoder();
    return _geocoder;
  };

  mod.geocodeOneAddress = function geocodeOneAddress(geocoder, address) {
    return new Promise((resolve) => {
      geocoder.addressSearch(address, (result, status) => {
        if (status !== kakao.maps.services.Status.OK || !result?.length) return resolve(null);
        const best = result[0];
        const lat = Number(best.y);
        const lng = Number(best.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return resolve(null);
        resolve({ lat, lng });
      });
    });
  };

  mod.normalizeAddressForGeocode = function normalizeAddressForGeocode(rawAddress) {
    let addr = String(rawAddress || "").trim();
    if (!addr) return "";
    addr = addr.replace(/\([^)]*\)/g, "").trim();
    addr = addr.replace(/\s*외\s*\d*\s*필지?/g, "").trim();
    addr = addr.replace(/\s+\d{1,5}동\s*\d{1,5}호\s*$/g, "").trim();
    addr = addr.replace(/\s+(지하\s*)?\d{1,3}층.*$/g, "").trim();
    addr = addr.replace(/[,;·\s]+$/, "").trim();
    return addr;
  };

  mod.getGeocodeStats = function getGeocodeStats() {
    const { state } = ctx();
    // propertiesFullCache, homeSummarySnapshot, state.properties 순서로 참조
    const props = (Array.isArray(state.propertiesFullCache) && state.propertiesFullCache.length)
      ? state.propertiesFullCache
      : (Array.isArray(state.homeSummarySnapshot) && state.homeSummarySnapshot.length)
        ? state.homeSummarySnapshot
        : (state.properties || []);
    let pending = 0, ok = 0, failed = 0;
    for (const p of props) {
      const st = String(p.geocodeStatus || p.geocode_status || "").toLowerCase();
      const hasCoords = (p.latitude != null && p.longitude != null);
      if (st === "ok" || (hasCoords && st !== "failed" && st !== "pending")) ok++;
      else if (st === "failed") failed++;
      else if (st === "pending" || (!hasCoords && p.address)) pending++;
    }
    return { pending, ok, failed, total: props.length };
  };

  mod.updateGeocodeStatusBar = function updateGeocodeStatusBar() {
    const { state, els } = ctx();
    const stats = mod.getGeocodeStats();
    if (els.geocodePending) els.geocodePending.textContent = stats.pending.toLocaleString("ko-KR");
    if (els.geocodeOk) els.geocodeOk.textContent = stats.ok.toLocaleString("ko-KR");
    if (els.geocodeFailed) els.geocodeFailed.textContent = stats.failed.toLocaleString("ko-KR");
    if (els.geoStatFailed) els.geoStatFailed.classList.toggle("is-empty", stats.failed === 0);
    if (els.geoStatPending) els.geoStatPending.classList.toggle("is-empty", stats.pending === 0);
    if (els.btnGeocodeRun) {
      els.btnGeocodeRun.disabled = stats.pending === 0 || state.geocodeRunning;
      els.btnGeocodeRun.textContent = state.geocodeRunning ? "실행 중..." : "지오코딩 실행";
    }
    if (els.btnGeocodeRetryFailed) {
      els.btnGeocodeRetryFailed.classList.toggle("hidden", stats.failed === 0);
      els.btnGeocodeRetryFailed.disabled = stats.failed === 0 || state.geocodeRunning;
    }
  };

  mod.renderGeocodeList = function renderGeocodeList(filter) {
    const { els, utils } = ctx();
    const { getAuxiliaryPropertiesSnapshot, escapeHtml, formatDate } = utils;
    if (!els.geocodeListWrap || !els.geocodeListBody) return;

    ["geoStatPending", "geoStatOk", "geoStatFailed"].forEach((key) => {
      if (els[key]) els[key].classList.toggle("is-selected", els[key].dataset.geoFilter === filter);
    });

    const labelMap = { pending: "대기", ok: "완료", failed: "실패" };
    const label = labelMap[filter] || filter;

    const rows = getAuxiliaryPropertiesSnapshot().filter((p) => {
      const st = String(p.geocodeStatus || "").toLowerCase();
      const hasCoords = p.latitude != null && p.longitude != null;
      if (filter === "ok") return st === "ok" || (hasCoords && st !== "failed" && st !== "pending");
      if (filter === "failed") return st === "failed";
      if (filter === "pending") return st === "pending" || (!hasCoords && !!p.address && st !== "ok" && st !== "failed");
      return false;
    });

    if (els.geocodeListTitle) els.geocodeListTitle.textContent = `${label} 물건 ${rows.length.toLocaleString("ko-KR")}건`;
    els.geocodeListBody.innerHTML = "";
    if (!rows.length) {
      if (els.geocodeListEmpty) els.geocodeListEmpty.classList.remove("hidden");
      els.geocodeListWrap.classList.remove("hidden");
      return;
    }
    if (els.geocodeListEmpty) els.geocodeListEmpty.classList.add("hidden");

    const kindMap = { auction: "경매", onbid: "공매", realtor: "중개", general: "일반" };
    const frag = document.createDocumentFragment();
    rows.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${escapeHtml(p.itemNo || "-")}</td>` +
        `<td><span class="kind-text kind-${p.sourceType || "general"}">${escapeHtml(kindMap[p.sourceType] || "-")}</span></td>` +
        `<td class="text-cell">${escapeHtml(p.address || "-")}</td>` +
        `<td>${escapeHtml(p.geocodeStatus || "pending")}</td>` +
        `<td>${escapeHtml(formatDate(p.createdAt) || "-")}</td>`;
      frag.appendChild(tr);
    });
    els.geocodeListBody.appendChild(frag);
    els.geocodeListWrap.classList.remove("hidden");
  };

  mod.sleep = function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  };

  mod.saveGeocodeResult = async function saveGeocodeResult(sb, propertyId, coords, status) {
    if (DataAccess && typeof DataAccess.saveGeocodeResult === "function") {
      return DataAccess.saveGeocodeResult(sb, propertyId, coords, status);
    }
    throw new Error("KNSN_DATA_ACCESS.saveGeocodeResult 를 찾을 수 없습니다.");
  };

  mod.runGeocoding = async function runGeocoding(retryFailed) {
    const { state, els, K, isSupabaseMode, utils } = ctx();
    const { invalidatePropertyCollections, ensureAuxiliaryPropertiesForAdmin, loadProperties } = utils;
    if (state.geocodeRunning) return;
    const sb = isSupabaseMode() ? K.initSupabase() : null;
    if (!sb) return alert("Supabase 연동이 필요합니다.");

    let geocoder;
    try {
      geocoder = await mod.ensureKakaoGeocoder();
    } catch (err) {
      alert("카카오 SDK 로드 실패: " + (err.message || "알 수 없는 오류"));
      return;
    }

    state.geocodeRunning = true;
    mod.updateGeocodeStatusBar();
    if (els.geocodeProgress) els.geocodeProgress.classList.remove("hidden");
    if (els.geocodeRunningText) els.geocodeRunningText.classList.remove("hidden");

    try {
      const statusFilter = retryFailed ? "failed" : "pending";
      const items = (DataAccess && typeof DataAccess.fetchGeocodeQueue === "function")
        ? await DataAccess.fetchGeocodeQueue(sb, { statusFilter, pageSize: 1000 })
        : [];
      if (!items.length) {
        alert(retryFailed ? "재시도할 실패 건이 없습니다." : "지오코딩 대상이 없습니다.");
        return;
      }

      let processed = 0, okCount = 0, failCount = 0;
      const total = items.length;

      for (const item of items) {
        const propId = item.id || item.global_id;
        if (!propId) { processed++; continue; }
        const rawAddr = String(item.address || "").trim();
        const cleaned = mod.normalizeAddressForGeocode(rawAddr);
        if (!cleaned) {
          await mod.saveGeocodeResult(sb, propId, null, "failed");
          failCount++;
          processed++;
          continue;
        }
        const coords = await mod.geocodeOneAddress(geocoder, cleaned);
        let finalCoords = coords;
        if (!finalCoords && cleaned !== rawAddr) finalCoords = await mod.geocodeOneAddress(geocoder, rawAddr);

        if (finalCoords) {
          await mod.saveGeocodeResult(sb, propId, finalCoords, "ok");
          okCount++;
        } else {
          await mod.saveGeocodeResult(sb, propId, null, "failed");
          failCount++;
        }

        processed++;
        const pct = Math.round((processed / total) * 100);
        if (els.geocodeProgressBar) els.geocodeProgressBar.style.width = pct + "%";
        if (els.geocodeRunningText) {
          els.geocodeRunningText.textContent = processed + "/" + total + " (성공 " + okCount + ", 실패 " + failCount + ")";
        }
        if (processed < total) await mod.sleep(150);
      }

      alert("지오코딩 완료: 총 " + total + "건 중 성공 " + okCount + "건, 실패 " + failCount + "건");
      invalidatePropertyCollections();
      await ensureAuxiliaryPropertiesForAdmin({ forceRefresh: true });
      await loadProperties();
    } catch (err) {
      console.error("runGeocoding error:", err);
      alert(err?.message || "지오코딩 중 오류가 발생했습니다.");
    } finally {
      state.geocodeRunning = false;
      if (els.geocodeProgress) els.geocodeProgress.classList.add("hidden");
      if (els.geocodeRunningText) els.geocodeRunningText.classList.add("hidden");
      if (els.geocodeProgressBar) els.geocodeProgressBar.style.width = "0%";
      mod.updateGeocodeStatusBar();
    }
  };

  AdminModules.geocodingTab = mod;
})();
