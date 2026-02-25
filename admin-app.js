(function () {
  "use strict";

  const CONFIG = {
    API_BASE: "https://knson.vercel.app/api",
    ENABLE_MOCK_FALLBACK: true,
    LS_KEYS: {
      DB: "knson_property_mgmt_mock_db_v1",
      SESSION: "knson_property_mgmt_mock_session_v1",
    },
  };

  const state = {
    currentUser: null,
    properties: [],
    users: [],
    csvPreviewRows: [],
    autoGroupDraft: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function show(elOrSel) {
    const el = typeof elOrSel === "string" ? $(elOrSel) : elOrSel;
    if (el) el.classList.remove("hidden");
  }
  function hide(elOrSel) {
    const el = typeof elOrSel === "string" ? $(elOrSel) : elOrSel;
    if (el) el.classList.add("hidden");
  }

  function normalizeWhitespace(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function normalizeAddress(raw) {
    const s = normalizeWhitespace(raw)
      .replace(/[.,]/g, "")
      .replace(/\b(대한민국|한국)\b/g, "")
      .replace(/특별시/g, "시")
      .replace(/광역시/g, "시")
      .replace(/\s*-\s*/g, "-")
      .toLowerCase();
    return s;
  }

  function parseGuDongFromAddress(address) {
    const text = normalizeWhitespace(address);
    const tokens = text.split(" ");
    let regionGu = "";
    let regionDong = "";
    for (const tk of tokens) {
      if (!regionGu && /구$/.test(tk)) regionGu = tk;
      if (!regionDong && /(동|읍|면|리)$/.test(tk)) regionDong = tk;
    }
    return { regionGu, regionDong };
  }

  function regionKey(unit, gu, dong) {
    if (unit === "dong") return normalizeWhitespace(`${gu || ""} ${dong || ""}`).trim();
    return normalizeWhitespace(gu || "");
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  }

  function flashMessage(type, text, timeout = 2500) {
    const box = $("#globalMessage");
    box.className = `global-message ${type}`;
    box.textContent = text;
    show(box);
    if (timeout > 0) {
      window.clearTimeout(flashMessage._t);
      flashMessage._t = window.setTimeout(() => hide(box), timeout);
    }
  }

  function formatDate(value) {
    if (!value) return "-";
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } catch {
      return String(value);
    }
  }

  function formatNumber(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("ko-KR");
  }

  function isAdmin() {
    return state.currentUser?.role === "admin";
  }

  /* =======================
   * CSV parser
   ======================= */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === "," && !inQuotes) {
        row.push(cur); cur = ""; continue;
      }
      if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(v => String(v).trim() !== "")) rows.push(row);
        row = [];
        continue;
      }
      cur += ch;
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      if (row.some(v => String(v).trim() !== "")) rows.push(row);
    }
    if (!rows.length) return { headers: [], records: [] };

    const headers = rows[0].map(h => normalizeWhitespace(h));
    const records = rows.slice(1).map(cols => {
      const rec = {};
      headers.forEach((h, idx) => (rec[h] = normalizeWhitespace(cols[idx] ?? "")));
      return rec;
    });
    return { headers, records };
  }

  function mapCsvRecordToProperty(record, sourceType) {
    const keyAliases = {
      title: ["title", "제목", "물건명", "건명", "사건명"],
      address: ["address", "주소", "소재지", "물건주소"],
      status: ["status", "상태", "진행상태"],
      price: ["price", "가격", "감정가", "최저가", "매각가"],
      regionGu: ["regionGu", "구", "시군구", "구역(구)"],
      regionDong: ["regionDong", "동", "읍면동", "구역(동)"],
      memo: ["memo", "메모", "비고", "특이사항"],
    };

    const pick = (aliases) => {
      for (const a of aliases) {
        if (record[a] != null && record[a] !== "") return record[a];
        const foundKey = Object.keys(record).find(k => k.toLowerCase() === a.toLowerCase());
        if (foundKey && record[foundKey] !== "") return record[foundKey];
      }
      return "";
    };

    const title = pick(keyAliases.title) || `${sourceType === "auction" ? "경매" : "공매"} 물건`;
    const address = pick(keyAliases.address);
    const priceRaw = pick(keyAliases.price);
    const price = Number(String(priceRaw).replace(/[^\d.-]/g, "")) || 0;

    let status = (pick(keyAliases.status) || "active").toLowerCase();
    if (["진행", "진행중", "active"].includes(status)) status = "active";
    else if (["보류", "hold"].includes(status)) status = "hold";
    else if (["종결", "완료", "done"].includes(status)) status = "done";
    else status = "active";

    let regionGu = pick(keyAliases.regionGu);
    let regionDong = pick(keyAliases.regionDong);
    if (!regionGu || !regionDong) {
      const parsed = parseGuDongFromAddress(address);
      regionGu = regionGu || parsed.regionGu;
      regionDong = regionDong || parsed.regionDong;
    }

    return { title, address, status, price, regionGu, regionDong, memo: pick(keyAliases.memo), source: sourceType };
  }

  /* =======================
   * API layer + mock fallback
   ======================= */
  const Api = {
    async request(path, options = {}) {
      const url = `${CONFIG.API_BASE}${path}`;
      const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
      const merged = { ...options, headers };
      if (merged.body && typeof merged.body !== "string") merged.body = JSON.stringify(merged.body);

      const res = await fetch(url, merged);
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();
      if (!res.ok) throw new Error((data && data.message) || `API Error ${res.status}`);
      return data;
    },
    async safe(callServer, callMock) {
      try { return await callServer(); }
      catch (e) {
        if (!CONFIG.ENABLE_MOCK_FALLBACK) throw e;
        console.warn("[API fallback -> mock]", e.message);
        return await callMock();
      }
    },
    auth: {
      login: (name, password) =>
        Api.safe(() => Api.request("/auth/login", { method: "POST", body: { name, password } }), () => MockApi.auth.login(name, password)),
      logout: () =>
        Api.safe(() => Api.request("/auth/logout", { method: "POST" }), () => MockApi.auth.logout()),
      me: () =>
        Api.safe(() => Api.request("/auth/me"), () => MockApi.auth.me()),
    },
    properties: {
      list: () =>
        Api.safe(() => Api.request("/properties"), () => MockApi.properties.list()),
      importCsvRows: (source, rows) =>
        Api.safe(() => Api.request("/properties/import-csv", { method: "POST", body: { source, rows } }), () => MockApi.properties.importCsvRows(source, rows)),
    },
    users: {
      list: () =>
        Api.safe(() => Api.request("/users"), () => MockApi.users.list()),
      create: (payload) =>
        Api.safe(() => Api.request("/users", { method: "POST", body: payload }), () => MockApi.users.create(payload)),
      updateAssignments: (userId, assignedRegions) =>
        Api.safe(() => Api.request(`/users/${encodeURIComponent(userId)}/assignments`, { method: "PATCH", body: { assignedRegions } }), () => MockApi.users.updateAssignments(userId, assignedRegions)),
    },
  };

  const MockApi = {
    _readDb() {
      const raw = localStorage.getItem(CONFIG.LS_KEYS.DB);
      if (raw) { try { return JSON.parse(raw); } catch {} }
      const seed = {
        users: [
          { id: "u_admin", name: "admin", password: "admin123", role: "admin", assignedRegions: [] },
          { id: "u_staff_1", name: "홍길동", password: "1111", role: "staff", assignedRegions: [{ unit: "gu", name: "강남구" }] },
        ],
        properties: [
          {
            id: uid("p"),
            source: "auction",
            title: "역삼동 아파트 경매",
            address: "서울특별시 강남구 역삼동 123-4",
            addressNorm: normalizeAddress("서울특별시 강남구 역삼동 123-4"),
            regionGu: "강남구",
            regionDong: "역삼동",
            status: "active",
            price: 950000000,
            memo: "",
            assigneeId: null,
            assigneeName: "",
            createdBy: "seed",
            createdAt: new Date().toISOString(),
          },
        ],
      };
      localStorage.setItem(CONFIG.LS_KEYS.DB, JSON.stringify(seed));
      return seed;
    },
    _writeDb(db) { localStorage.setItem(CONFIG.LS_KEYS.DB, JSON.stringify(db)); },
    _readSession() {
      const raw = localStorage.getItem(CONFIG.LS_KEYS.SESSION);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    _writeSession(session) {
      if (!session) localStorage.removeItem(CONFIG.LS_KEYS.SESSION);
      else localStorage.setItem(CONFIG.LS_KEYS.SESSION, JSON.stringify(session));
    },
    _withLatency(data, ms = 120) {
      return new Promise((resolve) => setTimeout(() => resolve(data), ms));
    },
    auth: {
      async login(name, password) {
        const db = MockApi._readDb();
        const user = db.users.find((u) => u.name === String(name).trim() && u.password === String(password));
        if (!user) throw new Error("이름 또는 비밀번호가 올바르지 않습니다.");
        MockApi._writeSession({ userId: user.id });
        return MockApi._withLatency({ user: sanitizeUser(user) });
      },
      async logout() { MockApi._writeSession(null); return MockApi._withLatency({ ok: true }); },
      async me() {
        const db = MockApi._readDb();
        const session = MockApi._readSession();
        if (!session) return MockApi._withLatency({ user: null });
        const user = db.users.find((u) => u.id === session.userId);
        return MockApi._withLatency({ user: user ? sanitizeUser(user) : null });
      },
    },
    properties: {
      async list() {
        const db = MockApi._readDb();
        return MockApi._withLatency({ items: db.properties.map((p) => ({ ...p })) });
      },
      async importCsvRows(source, rows) {
        const db = MockApi._readDb();
        const session = MockApi._readSession();
        const currentUser = session ? db.users.find((u) => u.id === session.userId) : null;
        if (!currentUser || currentUser.role !== "admin") throw new Error("관리자 권한이 필요합니다.");

        let created = 0, duplicates = 0;
        const errors = [];

        rows.forEach((r, idx) => {
          try {
            const address = normalizeWhitespace(r.address);
            if (!address) { errors.push({ row: idx + 1, message: "주소 누락" }); return; }
            const addressNorm = normalizeAddress(address);
            if (db.properties.find((p) => p.addressNorm === addressNorm)) { duplicates++; return; }

            let regionGu = normalizeWhitespace(r.regionGu || "");
            let regionDong = normalizeWhitespace(r.regionDong || "");
            if (!regionGu || !regionDong) {
              const parsed = parseGuDongFromAddress(address);
              regionGu = regionGu || parsed.regionGu;
              regionDong = regionDong || parsed.regionDong;
            }

            db.properties.unshift({
              id: uid("p"),
              source,
              title: normalizeWhitespace(r.title || (source === "auction" ? "경매 물건" : "공매 물건")),
              address,
              addressNorm,
              regionGu,
              regionDong,
              status: r.status || "active",
              price: Number(r.price || 0) || 0,
              memo: normalizeWhitespace(r.memo || ""),
              assigneeId: null,
              assigneeName: "",
              createdBy: currentUser.id,
              createdAt: new Date().toISOString(),
            });
            created++;
          } catch (e) {
            errors.push({ row: idx + 1, message: e.message || "알 수 없는 오류" });
          }
        });

        MockApi._writeDb(db);
        return MockApi._withLatency({ ok: true, created, duplicates, errors });
      },
    },
    users: {
      async list() {
        const db = MockApi._readDb();
        return MockApi._withLatency({ items: db.users.map(sanitizeUser) });
      },
      async create(payload) {
        const db = MockApi._readDb();
        const exists = db.users.find((u) => u.name === normalizeWhitespace(payload.name));
        if (exists) throw new Error("동일 이름 계정이 이미 존재합니다.");

        const user = {
          id: uid("u"),
          name: normalizeWhitespace(payload.name),
          password: String(payload.password || ""),
          role: payload.role === "admin" ? "admin" : "staff",
          assignedRegions: [],
        };
        db.users.push(user);
        MockApi._writeDb(db);
        return MockApi._withLatency({ ok: true, item: sanitizeUser(user) });
      },
      async updateAssignments(userId, assignedRegions) {
        const db = MockApi._readDb();
        const user = db.users.find((u) => u.id === userId);
        if (!user) throw new Error("사용자를 찾을 수 없습니다.");
        user.assignedRegions = Array.isArray(assignedRegions)
          ? assignedRegions
              .filter((r) => r && r.unit && r.name)
              .map((r) => ({ unit: r.unit === "dong" ? "dong" : "gu", name: normalizeWhitespace(r.name) }))
          : [];
        MockApi._writeDb(db);
        return MockApi._withLatency({ ok: true, item: sanitizeUser(user) });
      },
    },
  };

  function sanitizeUser(user) {
    if (!user) return null;
    const { password, ...safe } = user;
    return { ...safe };
  }

  /* =======================
   * UI helpers
   ======================= */
  function renderAuth() {
    const authStatus = $("#authStatus");
    const btnLogout = $("#btnLogout");
    const btnLogin = $("#btnOpenLogin");

    if (!state.currentUser) {
      authStatus.textContent = "로그인 필요";
      hide(btnLogout);
      show(btnLogin);
      return;
    }

    authStatus.textContent = `${state.currentUser.name} (${state.currentUser.role === "admin" ? "관리자" : "담당자"})`;
    show(btnLogout);
    hide(btnLogin);

    if (!isAdmin()) {
      flashMessage("error", "관리자만 접근할 수 있습니다.");
    }
  }

  function sourceBadgeHtml(source) {
    const label = source === "auction" ? "경매" : source === "public" ? "공매" : "일반";
    const cls = source === "auction" ? "source-auction" : source === "public" ? "source-public" : "source-general";
    return `<span class="source-badge ${cls}">${label}</span>`;
  }

  function unique(arr) {
    return [...new Set(arr)];
  }

  function getSelectedOptions(selectEl) {
    return Array.from(selectEl.selectedOptions || []).map(o => o.value);
  }

  function renderCsvPreview(headers, mappedRows) {
    const box = $("#csvPreviewBox");
    if (!mappedRows.length) {
      box.innerHTML = `<div class="muted">미리보기 데이터가 없습니다.</div>`;
      return;
    }
    const preview = mappedRows.slice(0, 5);
    box.innerHTML = `
      <div class="muted small" style="margin-bottom:6px;">원본헤더: ${escapeHtml(headers.join(", "))}</div>
      <table>
        <thead>
          <tr>
            <th>title</th><th>address</th><th>status</th><th>price</th><th>regionGu</th><th>regionDong</th>
          </tr>
        </thead>
        <tbody>
          ${preview.map(r => `
            <tr>
              <td>${escapeHtml(r.title || "")}</td>
              <td>${escapeHtml(r.address || "")}</td>
              <td>${escapeHtml(r.status || "")}</td>
              <td>${escapeHtml(String(r.price || ""))}</td>
              <td>${escapeHtml(r.regionGu || "")}</td>
              <td>${escapeHtml(r.regionDong || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="muted small" style="margin-top:6px;">총 ${mappedRows.length}행 (미리보기 5행)</div>
    `;
  }

  function renderUserTable() {
    const tbody = $("#userTableBody");
    const users = state.users || [];
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">계정 없음</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map((u) => {
      const chips = (u.assignedRegions || []).length
        ? `<div class="chips">${u.assignedRegions.map(r => `<span class="chip">${escapeHtml(r.unit)}:${escapeHtml(r.name)}</span>`).join("")}</div>`
        : `<span class="muted">없음</span>`;

      return `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${u.role === "admin" ? "관리자" : "담당자"}</td>
          <td>${chips}</td>
          <td>
            <button class="btn btn-outline" data-action="select-user" data-user-id="${escapeHtml(u.id)}" type="button">배정대상 선택</button>
          </td>
        </tr>
      `;
    }).join("");

    const select = $("#assignUserSelect");
    const staff = users.filter(u => u.role === "staff");
    select.innerHTML = staff.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join("")
      || `<option value="">(담당자 없음)</option>`;
  }

  function renderAdminPropertyTable() {
    const tbody = $("#adminPropertyTableBody");
    const items = [...(state.properties || [])];

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">데이터 없음</td></tr>`;
      $("#adminStats").textContent = "0건";
      return;
    }

    const dupCountMap = {};
    items.forEach(p => { dupCountMap[p.addressNorm] = (dupCountMap[p.addressNorm] || 0) + 1; });

    tbody.innerHTML = items.map((p) => {
      const dup = dupCountMap[p.addressNorm] > 1;
      return `
        <tr>
          <td>${sourceBadgeHtml(p.source)}</td>
          <td>${escapeHtml(p.title || "-")}</td>
          <td>${escapeHtml(p.address || "-")}</td>
          <td class="code">${escapeHtml(p.addressNorm || "-")}</td>
          <td>${escapeHtml(p.regionGu || "-")} / ${escapeHtml(p.regionDong || "-")}</td>
          <td>${escapeHtml(p.assigneeName || "-")}</td>
          <td>${dup ? `<span class="chip warn">중복의심(${dupCountMap[p.addressNorm]})</span>` : `<span class="chip ok">정상</span>`}</td>
        </tr>
      `;
    }).join("");

    const bySource = items.reduce((acc, p) => {
      acc[p.source] = (acc[p.source] || 0) + 1;
      return acc;
    }, {});
    $("#adminStats").textContent = `전체 ${items.length} · 경매 ${bySource.auction || 0} · 공매 ${bySource.public || 0} · 일반 ${bySource.general || 0}`;
  }

  function renderRegionPool() {
    const unit = $("#assignUnit").value;
    const mode = $("#regionSourceMode").value;
    const pool = $("#regionPool");

    let values = [];
    if (mode === "manual") {
      values = ($("#manualRegions").value || "")
        .split(/\n+/)
        .map(v => normalizeWhitespace(v))
        .filter(Boolean);
    } else {
      if (unit === "gu") values = unique(state.properties.map(p => normalizeWhitespace(p.regionGu)).filter(Boolean));
      else values = unique(state.properties.map(p => regionKey("dong", p.regionGu, p.regionDong)).filter(Boolean));
    }

    values = values.sort((a, b) => a.localeCompare(b, "ko"));
    pool.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  }

  /* =======================
   * Auto grouping (휴리스틱)
   ======================= */
  const SEOUL_GU_ORDER_HINT = [
    "은평구", "서대문구", "마포구", "종로구", "중구", "용산구",
    "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구", "노원구",
    "강서구", "양천구", "구로구", "금천구", "영등포구", "동작구", "관악구",
    "서초구", "강남구", "송파구", "강동구"
  ];

  function sortRegionsWithHeuristic(regions, unit) {
    if (unit === "gu") {
      const orderMap = new Map(SEOUL_GU_ORDER_HINT.map((g, i) => [g, i]));
      return [...regions].sort((a, b) => {
        const ai = orderMap.has(a) ? orderMap.get(a) : 999;
        const bi = orderMap.has(b) ? orderMap.get(b) : 999;
        if (ai !== bi) return ai - bi;
        return a.localeCompare(b, "ko");
      });
    }
    return [...regions].sort((a, b) => {
      const [agu = "", adong = ""] = a.split(" ");
      const [bgu = "", bdong = ""] = b.split(" ");
      if (agu !== bgu) {
        const guSorted = sortRegionsWithHeuristic([agu, bgu], "gu");
        return guSorted[0] === agu ? -1 : 1;
      }
      return adong.localeCompare(bdong, "ko");
    });
  }

  function chunkContiguous(arr, chunkCount) {
    if (chunkCount <= 0) return [];
    const result = Array.from({ length: chunkCount }, () => []);
    const n = arr.length;
    const base = Math.floor(n / chunkCount);
    const rem = n % chunkCount;
    let cursor = 0;

    for (let i = 0; i < chunkCount; i++) {
      const size = base + (i < rem ? 1 : 0);
      result[i] = arr.slice(cursor, cursor + size);
      cursor += size;
    }
    return result.filter(g => g.length > 0);
  }

  function expandGuToDongs(selectedGuList, properties) {
    const map = new Map();
    properties.forEach(p => {
      const gu = normalizeWhitespace(p.regionGu);
      const dong = normalizeWhitespace(p.regionDong);
      if (!gu || !dong) return;
      if (selectedGuList.length && !selectedGuList.includes(gu)) return;
      map.set(`${gu} ${dong}`.trim(), true);
    });
    return [...map.keys()];
  }

  function buildAutoGroups({ staffCount, unit, selectedRegions }) {
    const staffUsers = state.users.filter(u => u.role === "staff");
    if (!staffUsers.length) throw new Error("담당자 계정이 없습니다.");
    if (!staffCount || staffCount < 1) throw new Error("담당자 수(X)는 1 이상이어야 합니다.");

    let effectiveUnit = unit;
    let pool = [...selectedRegions];

    if (unit === "gu" && staffCount > pool.length) {
      effectiveUnit = "dong";
      pool = expandGuToDongs(pool, state.properties);
      if (!pool.length) throw new Error("동 단위로 재편성할 데이터가 없습니다. 등록 물건에 동 정보가 필요합니다.");
    }

    const sorted = sortRegionsWithHeuristic(pool, effectiveUnit);
    const groups = chunkContiguous(sorted, Math.min(staffCount, sorted.length));

    return groups.map((regions, idx) => {
      const user = staffUsers[idx] || null;
      return {
        userId: user?.id || "",
        userName: user?.name || "(미배정)",
        regions: regions.map(name => ({ unit: effectiveUnit, name })),
      };
    });
  }

  function renderAutoGroupDraft() {
    const box = $("#autoGroupResult");
    const draft = state.autoGroupDraft;
    if (!draft || !draft.length) {
      box.innerHTML = `<div class="muted">자동 그룹핑 결과가 없습니다.</div>`;
      return;
    }
    box.innerHTML = draft.map((g, idx) => `
      <div class="group-card">
        <h4>그룹 ${idx + 1} · ${escapeHtml(g.userName || "(미배정)")}</h4>
        <div class="chips">
          ${g.regions.map(r => `<span class="chip">${escapeHtml(r.unit)}:${escapeHtml(r.name)}</span>`).join("") || `<span class="muted">지역 없음</span>`}
        </div>
      </div>
    `).join("");
  }

  /* =======================
   * Loaders
   ======================= */
  async function loadMe() {
    const res = await Api.auth.me();
    state.currentUser = res.user || null;
    renderAuth();
    if (state.currentUser && !isAdmin()) {
      flashMessage("error", "관리자만 접근할 수 있습니다.");
    }
  }

  async function loadProperties() {
    const res = await Api.properties.list();
    state.properties = Array.isArray(res.items) ? res.items : [];
    renderAdminPropertyTable();
    renderRegionPool();
  }

  async function loadUsers() {
    const res = await Api.users.list();
    state.users = Array.isArray(res.items) ? res.items : [];
    renderUserTable();
  }

  async function reloadAll() {
    await loadMe();
    if (!isAdmin()) return;
    await Promise.all([loadUsers(), loadProperties()]);
  }

  /* =======================
   * Events
   ======================= */
  function openLoginModal() {
    show("#loginModal");
    $("#loginModal").setAttribute("aria-hidden", "false");
    $("#loginError").textContent = "";
    setTimeout(() => $("#loginName")?.focus(), 10);
  }
  function closeLoginModal() {
    hide("#loginModal");
    $("#loginModal").setAttribute("aria-hidden", "true");
  }

  async function readFileText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("파일 읽기 실패"));
      fr.readAsText(file, "utf-8");
    });
  }

  function bindEvents() {
    $("#btnOpenLogin").addEventListener("click", openLoginModal);
    $("#btnCloseLogin").addEventListener("click", closeLoginModal);
    $("#loginBackdrop").addEventListener("click", closeLoginModal);

    $("#btnLogout").addEventListener("click", async () => {
      try {
        await Api.auth.logout();
        state.currentUser = null;
        renderAuth();
        flashMessage("success", "로그아웃되었습니다.");
      } catch (e) {
        flashMessage("error", e.message || "로그아웃 오류");
      }
    });

    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#loginName").value.trim();
      const password = $("#loginPassword").value;

      try {
        const res = await Api.auth.login(name, password);
        state.currentUser = res.user;
        renderAuth();
        closeLoginModal();
        if (!isAdmin()) {
          flashMessage("error", "관리자만 접근할 수 있습니다.");
          return;
        }
        await Promise.all([loadUsers(), loadProperties()]);
        flashMessage("success", "관리자 로그인 완료");
      } catch (err) {
        $("#loginError").textContent = err.message || "로그인 실패";
      }
    });

    // CSV preview
    $("#btnCsvPreview").addEventListener("click", async () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      const file = $("#csvFile").files?.[0];
      const source = $("#csvType").value;
      if (!file) return flashMessage("error", "CSV 파일을 선택해 주세요.");

      try {
        const text = await readFileText(file);
        const parsed = parseCSV(text);
        const mappedRows = parsed.records.map(r => mapCsvRecordToProperty(r, source));
        state.csvPreviewRows = mappedRows;
        renderCsvPreview(parsed.headers, mappedRows);
        $("#csvImportResult").textContent = `미리보기 완료: ${mappedRows.length}행`;
      } catch (e) {
        flashMessage("error", e.message || "CSV 미리보기 실패");
      }
    });

    // CSV import
    $("#btnCsvImport").addEventListener("click", async () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      if (!state.csvPreviewRows.length) return flashMessage("error", "먼저 CSV 미리보기를 실행해 주세요.");

      try {
        const source = $("#csvType").value;
        const res = await Api.properties.importCsvRows(source, state.csvPreviewRows);
        $("#csvImportResult").textContent =
          `업로드 완료 · 생성 ${res.created || 0} / 중복 ${res.duplicates || 0} / 오류 ${(res.errors || []).length}`;
        await loadProperties();
        renderRegionPool();
        flashMessage("success", "CSV 업로드 반영 완료");
      } catch (e) {
        flashMessage("error", e.message || "CSV 업로드 실패");
      }
    });

    // account create
    $("#userCreateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");

      const payload = {
        name: $("#userName").value.trim(),
        password: $("#userPassword").value,
        role: $("#userRole").value,
      };
      if (!payload.name || !payload.password) return flashMessage("error", "이름/비밀번호는 필수입니다.");

      try {
        await Api.users.create(payload);
        e.target.reset();
        await loadUsers();
        flashMessage("success", "계정이 추가되었습니다.");
      } catch (err) {
        flashMessage("error", err.message || "계정 추가 실패");
      }
    });

    $("#userTableBody").addEventListener("click", (e) => {
      const btn = e.target.closest('button[data-action="select-user"]');
      if (!btn) return;
      $("#assignUserSelect").value = btn.dataset.userId;
      flashMessage("info", "배정 대상 담당자를 선택했습니다.", 1200);
    });

    $("#btnAdminReload").addEventListener("click", async () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      await Promise.all([loadUsers(), loadProperties()]);
      flashMessage("info", "새로고침 완료", 1200);
    });

    $("#assignUnit").addEventListener("change", renderRegionPool);
    $("#regionSourceMode").addEventListener("change", renderRegionPool);

    $("#btnLoadRegionPool").addEventListener("click", () => {
      renderRegionPool();
      flashMessage("info", "지역 후보를 갱신했습니다.", 1200);
    });

    $("#btnAssignSelectedRegions").addEventListener("click", async () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      const userId = $("#assignUserSelect").value;
      const unit = $("#assignUnit").value;
      const selected = getSelectedOptions($("#regionPool"));
      if (!userId) return flashMessage("error", "담당자를 선택해 주세요.");
      if (!selected.length) return flashMessage("error", "배정할 지역을 선택해 주세요.");

      const assignedRegions = selected.map(name => ({ unit, name }));
      try {
        await Api.users.updateAssignments(userId, assignedRegions);
        await loadUsers();
        flashMessage("success", "배정을 저장했습니다.");
      } catch (e) {
        flashMessage("error", e.message || "배정 저장 실패");
      }
    });

    $("#btnAutoGroup").addEventListener("click", () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      try {
        const staffCount = Number($("#autoStaffCount").value || 0);
        const unit = $("#assignUnit").value;

        let selectedRegions = getSelectedOptions($("#regionPool"));
        if (!selectedRegions.length) {
          selectedRegions = Array.from($("#regionPool").options).map(o => o.value);
        }
        if (!selectedRegions.length) throw new Error("지역 후보가 없습니다.");

        state.autoGroupDraft = buildAutoGroups({ staffCount, unit, selectedRegions });
        renderAutoGroupDraft();
        flashMessage("success", "자동 그룹핑 초안을 생성했습니다.");
      } catch (e) {
        flashMessage("error", e.message || "자동 그룹핑 실패");
      }
    });

    $("#btnApplyAutoGroup").addEventListener("click", async () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      const draft = state.autoGroupDraft;
      if (!draft || !draft.length) return flashMessage("error", "먼저 자동 그룹핑을 실행해 주세요.");

      try {
        for (const g of draft) {
          if (!g.userId) continue;
          await Api.users.updateAssignments(g.userId, g.regions);
        }
        await loadUsers();
        flashMessage("success", "자동 그룹핑 결과를 적용했습니다.");
      } catch (e) {
        flashMessage("error", e.message || "적용 실패");
      }
    });
  }

  async function init() {
    bindEvents();
    try {
      await reloadAll();
    } catch (e) {
      console.error(e);
      flashMessage("error", e.message || "초기 로딩 실패");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
