(() => {
  "use strict";

  const API_BASE = "https://knson.vercel.app/api";
  const SESSION_KEY = "knson_bms_session_v1";
  const GEO_CACHE_KEY = "knson_geo_cache_v1";

  const state = {
    session: loadSession(),
    items: [],
    view: "table",
    map: null,
    markers: [],
    geocoder: null,
    geoCache: loadGeoCache(),
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheEls();
    bindEvents();

    // 로그인 없으면 로그인 페이지로
    if (!state.session?.token || !state.session?.user) {
      location.replace(`./login.html?next=${encodeURIComponent('./index.html')}`);
      return;
    }

    // 관리자 링크
    if (state.session.user.role === "admin") {
      els.adminLink.classList.remove("hidden");
    }

    loadProperties();
  }

  function cacheEls() {
    Object.assign(els, {
      btnLogout: document.getElementById("btnLogout"),
      adminLink: document.getElementById("adminLink"),
      viewTabs: document.getElementById("viewTabs"),
      tableView: document.getElementById("tableView"),
      mapView: document.getElementById("mapView"),
      tbody: document.querySelector("#propTable tbody"),
      emptyState: document.getElementById("emptyState"),

      kpiTotal: document.getElementById("kpiTotal"),
      kpiAuction: document.getElementById("kpiAuction"),
      kpiGongmae: document.getElementById("kpiGongmae"),
      kpiGeneral: document.getElementById("kpiGeneral"),

      mapEl: document.getElementById("kakaoMap"),
      mapHint: document.getElementById("mapHint"),
    });
  }

  function bindEvents() {
    els.btnLogout.addEventListener("click", () => {
      saveSession(null);
      location.replace("./login.html");
    });

    els.viewTabs.addEventListener("click", async (e) => {
      const btn = e.target.closest(".view-tab");
      if (!btn) return;
      const view = btn.dataset.view;
      if (!view) return;
      setView(view);

      if (view === "map") {
        await ensureKakaoMap();
        await renderKakaoMarkers();
      }
    });
  }

  function setView(view) {
    state.view = view;
    [...els.viewTabs.querySelectorAll(".view-tab")].forEach((b) => {
      b.classList.toggle("is-active", b.dataset.view === view);
    });

    els.tableView.classList.toggle("hidden", view !== "table");
    els.mapView.classList.toggle("hidden", view !== "map");
  }

  async function loadProperties() {
    try {
      const scope = state.session.user.role === "admin" ? "all" : "mine";
      const res = await api(`/properties?scope=${encodeURIComponent(scope)}`, { auth: true });
      state.items = Array.isArray(res?.items) ? res.items.map(normalizeItem) : [];

      renderKPIs();
      renderTable();

      // 지도뷰가 이미 켜져있으면 마커
      if (state.view === "map") {
        await ensureKakaoMap();
        await renderKakaoMarkers();
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || "목록을 불러오지 못했습니다.");
      state.items = [];
      renderKPIs();
      renderTable();
    }
  }

  function normalizeItem(p) {
    // 백엔드 응답이 달라도 최대한 수용
    const source = p.source || p.category || "general"; // auction | gongmae | general
    const address = p.address || p.location || "";

    return {
      id: p.id || "",
      source,
      address,
      type: p.type || p.propertyType || p.kind || "-",
      floor: p.floor || p.floorText || "-",
      areaPy: toAreaPy(p.areaPy ?? p.area ?? p.area_m2),
      appraisalPrice: toNumber(p.appraisalPrice ?? p.appraisal_price ?? p.salePrice ?? p.sale_price),
      currentPrice: toNumber(p.currentPrice ?? p.current_price),
      bidDate: p.bidDate || p.bid_date || "-",
      createdAt: p.createdAt || p.created_at || "",
      agent: p.assignedAgentName || p.agentName || p.manager || "-",
      analysisDone: !!(p.analysisDone ?? p.analysis_done),
      siteVisit: !!(p.siteVisit ?? p.site_visit),
      memo: p.memo || p.comment || "",
    };
  }

  function renderKPIs() {
    const total = state.items.length;
    const auction = state.items.filter(i => i.source === "auction").length;
    const gongmae = state.items.filter(i => i.source === "gongmae").length;
    const general = state.items.filter(i => i.source === "general").length;

    els.kpiTotal.textContent = String(total);
    els.kpiAuction.textContent = String(auction);
    els.kpiGongmae.textContent = String(gongmae);
    els.kpiGeneral.textContent = String(general);
  }

  function renderTable() {
    els.tbody.innerHTML = "";
    if (!state.items.length) {
      els.emptyState.classList.remove("hidden");
      return;
    }
    els.emptyState.classList.add("hidden");

    const frag = document.createDocumentFragment();

    for (const it of state.items) {
      const tr = document.createElement("tr");
      const catLabel = sourceLabel(it.source);
      const catClass = it.source === "auction" ? "cat-auction" : it.source === "gongmae" ? "cat-gongmae" : "cat-general";
      const place = formatPlace(it.address);

      const appraisal = it.appraisalPrice ? formatMoneyEok(it.appraisalPrice) : "-";
      const current = it.currentPrice ? formatMoneyEok(it.currentPrice) : "-";
      const ratio = (it.appraisalPrice && it.currentPrice)
        ? `${((it.currentPrice / it.appraisalPrice) * 100).toFixed(2)} %`
        : "-";

      tr.innerHTML = `
        <td class="td-cat ${catClass}">${escapeHtml(catLabel)}</td>
        <td>${escapeHtml(place)}</td>
        <td>${escapeHtml(it.type)}</td>
        <td>${escapeHtml(String(it.floor))}</td>
        <td>${it.areaPy ? escapeHtml(String(it.areaPy)) : "-"}</td>
        <td>${escapeHtml(appraisal)}</td>
        <td>${escapeHtml(current)}</td>
        <td>${escapeHtml(ratio)}</td>
        <td>${escapeHtml(String(it.bidDate || "-"))}</td>
        <td>${escapeHtml(formatDate(it.createdAt))}</td>
        <td>${escapeHtml(it.agent)}</td>
        <td>${it.analysisDone ? '<span class="td-ok">✓</span>' : '-'}</td>
        <td>${it.siteVisit ? '<span class="td-ok">✓</span>' : '-'}</td>
        <td>${it.memo ? '<button class="btn-view" data-act="memo">보기</button>' : '-'}</td>
      `;

      tr.addEventListener("click", async (e) => {
        const memoBtn = e.target?.closest?.("button[data-act='memo']");
        if (memoBtn) {
          e.stopPropagation();
          alert(it.memo);
          return;
        }

        // 지도뷰에서 클릭하면 해당 주소로 이동
        if (state.view === "map") {
          await ensureKakaoMap();
          const pos = await geocodeCached(it.address);
          if (pos && state.map) {
            state.map.setCenter(new kakao.maps.LatLng(pos.lat, pos.lng));
            state.map.setLevel(4);
          }
        }
      });

      frag.appendChild(tr);
    }

    els.tbody.appendChild(frag);
  }

  // -----------------------------
  // Kakao Map
  // -----------------------------

  async function ensureKakaoMap() {
    if (state.map && state.geocoder) return;

    const appKey = getKakaoAppKey();
    if (!appKey) {
      showMapHint("카카오맵 앱키가 필요합니다. index.html의 &lt;meta name='kakao-app-key' content='...'/&gt; 에 JS 키를 입력해 주세요.");
      return;
    }

    await loadKakaoSdk(appKey);

    // eslint-disable-next-line no-undef
    const center = new kakao.maps.LatLng(37.5665, 126.9780);
    state.map = new kakao.maps.Map(els.mapEl, {
      center,
      level: 7,
    });

    state.geocoder = new kakao.maps.services.Geocoder();
    hideMapHint();
  }

  async function renderKakaoMarkers() {
    if (!state.map || !state.geocoder) return;

    // 기존 마커 제거
    state.markers.forEach(m => m.setMap(null));
    state.markers = [];

    const list = state.items.slice(0, 80); // 너무 많으면 느려서 상한

    for (const it of list) {
      const pos = await geocodeCached(it.address);
      if (!pos) continue;

      const marker = new kakao.maps.Marker({
        map: state.map,
        position: new kakao.maps.LatLng(pos.lat, pos.lng),
      });

      state.markers.push(marker);

      // 약간 쉬어주기(레이트리밋/부하)
      await sleep(120);
    }

    // 첫 마커로 센터 이동
    if (state.markers.length) {
      const first = state.markers[0].getPosition();
      state.map.setCenter(first);
      state.map.setLevel(6);
    }
  }

  async function geocodeCached(address) {
    const a = String(address || "").trim();
    if (!a || !state.geocoder) return null;

    const key = normalizeAddress(a);
    const cached = state.geoCache[key];
    if (cached && typeof cached.lat === "number" && typeof cached.lng === "number") {
      return cached;
    }

    const res = await geocode(a);
    if (!res) return null;

    state.geoCache[key] = res;
    saveGeoCache(state.geoCache);
    return res;
  }

  function geocode(address) {
    return new Promise((resolve) => {
      state.geocoder.addressSearch(address, (result, status) => {
        if (status !== kakao.maps.services.Status.OK || !result?.length) {
          resolve(null);
          return;
        }
        const r = result[0];
        resolve({ lat: Number(r.y), lng: Number(r.x) });
      });
    });
  }

  function loadKakaoSdk(appKey) {
    return new Promise((resolve, reject) => {
      if (window.kakao?.maps) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
      script.async = true;
      script.onload = () => {
        kakao.maps.load(() => resolve());
      };
      script.onerror = () => reject(new Error("카카오맵 SDK 로드 실패"));
      document.head.appendChild(script);
    });
  }

  function getKakaoAppKey() {
    // 1) meta 우선
    const meta = document.querySelector("meta[name='kakao-app-key']");
    const fromMeta = meta?.getAttribute("content")?.trim();
    if (fromMeta) return fromMeta;

    // 2) 전역 변수 지원
    const fromWin = (window.KAKAO_MAP_APP_KEY || "").trim();
    return fromWin || "";
  }

  function showMapHint(htmlText) {
    els.mapHint.innerHTML = htmlText;
    els.mapHint.classList.remove("hidden");
  }

  function hideMapHint() {
    els.mapHint.classList.add("hidden");
    els.mapHint.textContent = "";
  }

  // -----------------------------
  // API
  // -----------------------------

  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();

    const headers = { Accept: "application/json" };
    const hasBody = !["GET", "HEAD"].includes(method);
    if (hasBody) headers["Content-Type"] = "application/json";

    if (options.auth && state.session?.token) {
      headers.Authorization = `Bearer ${state.session.token}`;
    }

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

  // -----------------------------
  // Utils
  // -----------------------------

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    try {
      if (!session) localStorage.removeItem(SESSION_KEY);
      else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {}
  }

  function sourceLabel(s) {
    if (s === "auction") return "경매";
    if (s === "gongmae") return "공매";
    return "일반";
  }

  function formatPlace(address) {
    const a = String(address || "").trim();
    if (!a) return "-";

    const city = a.match(/(서울|인천|경기|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)/)?.[1];
    const dong = a.match(/([가-힣0-9]+동)\b/)?.[1];
    const gu = a.match(/([가-힣]+구)\b/)?.[1];

    const left = city || (a.split(" ")[0] || "-");
    const right = dong || gu || (a.split(" ")[1] || "-");
    return `${left} / ${right}`;
  }

  function toNumber(v) {
    const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function toAreaPy(v) {
    if (v == null || v === "") return "";
    const n = toNumber(v);
    if (!n) return "";

    // m2로 들어오면 평 변환 (대략)
    if (n > 200) {
      return (n / 3.3058).toFixed(0);
    }
    return String(n);
  }

  function formatMoneyEok(won) {
    const n = toNumber(won);
    if (!n) return "-";
    const eok = n / 100000000;
    // 1억 미만은 만원 단위로
    if (eok < 1) {
      return `${Math.round(n / 10000).toLocaleString("ko-KR")} 만원`;
    }
    return `${stripZeros(eok.toFixed(2))} 억원`;
  }

  function stripZeros(s) {
    return String(s).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function formatDate(v) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return `${String(d.getFullYear()).slice(2)}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function normalizeAddress(v) {
    return String(v || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[(),]/g, "")
      .trim();
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function loadGeoCache() {
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveGeoCache(cache) {
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache || {}));
    } catch {}
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
