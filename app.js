(function () {
  "use strict";

  /******************************************************************
   * CONFIG
   ******************************************************************/
  const CONFIG = {
    API_BASE: "https://knson.vercel.app/api",
    ENABLE_MOCK_FALLBACK: true, // API 미구현/실패 시 localStorage mock 동작
    LS_KEYS: {
      DB: "knson_property_mgmt_mock_db_v1",
      SESSION: "knson_property_mgmt_mock_session_v1",
    },
  };

  /******************************************************************
   * STATE
   ******************************************************************/
  const state = {
    currentView: "front",
    currentUser: null, // {id,name,role,assignedRegions[]}
    properties: [],
    users: [],
    csvPreviewRows: [],
    autoGroupDraft: null, // [{userId, userName, regions:[{unit,name}]}]
  };

  /******************************************************************
   * DOM HELPERS
   ******************************************************************/
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

  function setText(sel, text) {
    const el = $(sel);
    if (el) el.textContent = text;
  }

  function show(elOrSel) {
    const el = typeof elOrSel === "string" ? $(elOrSel) : elOrSel;
    if (el) el.classList.remove("hidden");
  }

  function hide(elOrSel) {
    const el = typeof elOrSel === "string" ? $(elOrSel) : elOrSel;
    if (el) el.classList.add("hidden");
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

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  }

  /******************************************************************
   * MESSAGE
   ******************************************************************/
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

  /******************************************************************
   * ADDRESS / REGION UTILS
   ******************************************************************/
  function normalizeWhitespace(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function normalizeAddress(raw) {
    // 주소 중복 방지용 정규화 (기본 버전)
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
    // 매우 단순 파서 (서울/수도권 중심). 이후 확장 가능.
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
    if (unit === "dong") {
      return normalizeWhitespace(`${gu || ""} ${dong || ""}`).trim();
    }
    return normalizeWhitespace(gu || "");
  }

  /******************************************************************
   * CSV PARSER (간단 구현)
   ******************************************************************/
  function parseCSV(text) {
    // quoted field 지원
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
        row.push(cur);
        cur = "";
        continue;
      }

      if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cur);
        cur = "";
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

    return {
      title,
      address,
      status,
      price,
      regionGu,
      regionDong,
      memo: pick(keyAliases.memo),
      source: sourceType,
    };
  }

  /******************************************************************
   * API LAYER (실서버 + mock fallback)
   ******************************************************************/
  const Api = {
    async request(path, options = {}) {
      const url = `${CONFIG.API_BASE}${path}`;
      const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };

      const merged = { ...options, headers };
      if (merged.body && typeof merged.body !== "string") {
        merged.body = JSON.stringify(merged.body);
      }

      const res = await fetch(url, merged);
      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      if (!res.ok) {
        const errMsg = (data && data.message) || `API Error ${res.status}`;
        throw new Error(errMsg);
      }
      return data;
    },

    async safe(callServer, callMock) {
      try {
        return await callServer();
      } catch (e) {
        if (!CONFIG.ENABLE_MOCK_FALLBACK) throw e;
        console.warn("[API fallback -> mock]", e.message);
        return await callMock();
      }
    },

    auth: {
      async login(name, password) {
        return Api.safe(
          () => Api.request("/auth/login", { method: "POST", body: { name, password } }),
          () => MockApi.auth.login(name, password)
        );
      },
      async logout() {
        return Api.safe(
          () => Api.request("/auth/logout", { method: "POST" }),
          () => MockApi.auth.logout()
        );
      },
      async me() {
        return Api.safe(
          () => Api.request("/auth/me"),
          () => MockApi.auth.me()
        );
      },
    },

    properties: {
      async list() {
        return Api.safe(
          () => Api.request("/properties"),
          () => MockApi.properties.list()
        );
      },
      async createGeneral(payload) {
        return Api.safe(
          () => Api.request("/properties/general", { method: "POST", body: payload }),
          () => MockApi.properties.createGeneral(payload)
        );
      },
      async importCsvRows(source, rows) {
        return Api.safe(
          () => Api.request("/properties/import-csv", { method: "POST", body: { source, rows } }),
          () => MockApi.properties.importCsvRows(source, rows)
        );
      },
    },

    users: {
      async list() {
        return Api.safe(
          () => Api.request("/users"),
          () => MockApi.users.list()
        );
      },
      async create(payload) {
        return Api.safe(
          () => Api.request("/users", { method: "POST", body: payload }),
          () => MockApi.users.create(payload)
        );
      },
      async updateAssignments(userId, assignedRegions) {
        return Api.safe(
          () => Api.request(`/users/${encodeURIComponent(userId)}/assignments`, {
            method: "PATCH",
            body: { assignedRegions },
          }),
          () => MockApi.users.updateAssignments(userId, assignedRegions)
        );
      },
    },
  };

  /******************************************************************
   * MOCK API (localStorage)
   * - 실제 백엔드 붙기 전 개발/검증용
   ******************************************************************/
  const MockApi = {
    _readDb() {
      const raw = localStorage.getItem(CONFIG.LS_KEYS.DB);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch {}
      }
      const seed = {
        users: [
          {
            id: "u_admin",
            name: "admin",
            password: "admin123", // 데모용만. 실서버에서는 절대 평문 저장 금지.
            role: "admin",
            assignedRegions: [],
          },
          {
            id: "u_staff_1",
            name: "홍길동",
            password: "1111",
            role: "staff",
            assignedRegions: [{ unit: "gu", name: "강남구" }],
          },
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
          {
            id: uid("p"),
            source: "public",
            title: "대치동 근린시설 공매",
            address: "서울 강남구 대치동 77-1",
            addressNorm: normalizeAddress("서울 강남구 대치동 77-1"),
            regionGu: "강남구",
            regionDong: "대치동",
            status: "active",
            price: 1200000000,
            memo: "",
            assigneeId: null,
            assigneeName: "",
            createdBy: "seed",
            createdAt: new Date().toISOString(),
          },
          {
            id: uid("p"),
            source: "general",
            title: "송파구 일반 중개 매물",
            address: "서울특별시 송파구 잠실동 100",
            addressNorm: normalizeAddress("서울특별시 송파구 잠실동 100"),
            regionGu: "송파구",
            regionDong: "잠실동",
            status: "hold",
            price: 1500000000,
            memo: "일반 등록 샘플",
            assigneeId: null,
            assigneeName: "",
            createdBy: "u_staff_1",
            createdAt: new Date().toISOString(),
          },
        ],
      };
      localStorage.setItem(CONFIG.LS_KEYS.DB, JSON.stringify(seed));
      return seed;
    },

    _writeDb(db) {
      localStorage.setItem(CONFIG.LS_KEYS.DB, JSON.stringify(db));
    },

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
        const user = db.users.find(
          (u) => u.name === String(name).trim() && u.password === String(password)
        );
        if (!user) throw new Error("이름 또는 비밀번호가 올바르지 않습니다.");
        MockApi._writeSession({ userId: user.id });
        return MockApi._withLatency({ user: sanitizeUser(user) });
      },

      async logout() {
        MockApi._writeSession(null);
        return MockApi._withLatency({ ok: true });
      },

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
        return MockApi._withLatency({
          items: db.properties.map((p) => ({ ...p })),
        });
      },

      async createGeneral(payload) {
        const db = MockApi._readDb();
        const session = MockApi._readSession();
        const currentUser = session ? db.users.find((u) => u.id === session.userId) : null;
        if (!currentUser) throw new Error("로그인이 필요합니다.");

        const address = normalizeWhitespace(payload.address);
        if (!address) throw new Error("주소는 필수입니다.");

        const addressNorm = normalizeAddress(address);
        const duplicated = db.properties.find((p) => p.addressNorm === addressNorm);
        if (duplicated) throw new Error("중복 주소 물건이 이미 등록되어 있습니다.");

        let regionGu = normalizeWhitespace(payload.regionGu || "");
        let regionDong = normalizeWhitespace(payload.regionDong || "");
        if (!regionGu || !regionDong) {
          const parsed = parseGuDongFromAddress(address);
          regionGu = regionGu || parsed.regionGu;
          regionDong = regionDong || parsed.regionDong;
        }

        const item = {
          id: uid("p"),
          source: "general",
          title: normalizeWhitespace(payload.title || "일반 물건"),
          address,
          addressNorm,
          regionGu,
          regionDong,
          status: payload.status || "active",
          price: Number(payload.price || 0) || 0,
          memo: normalizeWhitespace(payload.memo || ""),
          assigneeId: null,
          assigneeName: "",
          createdBy: currentUser.id,
          createdAt: new Date().toISOString(),
        };

        db.properties.unshift(item);
        MockApi._writeDb(db);
        return MockApi._withLatency({ ok: true, item });
      },

      async importCsvRows(source, rows) {
        const db = MockApi._readDb();
        const session = MockApi._readSession();
        const currentUser = session ? db.users.find((u) => u.id === session.userId) : null;
        if (!currentUser || currentUser.role !== "admin") {
          throw new Error("관리자 권한이 필요합니다.");
        }

        let created = 0;
        let duplicates = 0;
        const errors = [];

        rows.forEach((r, idx) => {
          try {
            const address = normalizeWhitespace(r.address);
            if (!address) {
              errors.push({ row: idx + 1, message: "주소 누락" });
              return;
            }
            const addressNorm = normalizeAddress(address);
            const duplicated = db.properties.find((p) => p.addressNorm === addressNorm);
            if (duplicated) {
              duplicates++;
              return;
            }

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
              title: normalizeWhitespace(r.title || `${source === "auction" ? "경매" : "공매"} 물건`),
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

  /******************************************************************
   * ACCESS CONTROL
   ******************************************************************/
  function isAdmin() {
    return state.currentUser?.role === "admin";
  }

  function isStaff() {
    return state.currentUser?.role === "staff";
  }

  function canViewProperty(user, p) {
    if (!user) return false;
    if (user.role === "admin") return true;

    // 담당자 물건 판정:
    // 1) 명시 배정자 일치 또는
    // 2) 배정 지역(구/동) 매칭
    if (p.assigneeId && p.assigneeId === user.id) return true;

    const regions = Array.isArray(user.assignedRegions) ? user.assignedRegions : [];
    for (const r of regions) {
      if (r.unit === "gu" && normalizeWhitespace(r.name) === normalizeWhitespace(p.regionGu)) return true;
      if (r.unit === "dong") {
        const key = regionKey("dong", p.regionGu, p.regionDong);
        if (normalizeWhitespace(r.name) === key) return true;
      }
    }
    return false;
  }

  /******************************************************************
   * RENDERERS
   ******************************************************************/
  function renderAuth() {
    const authStatus = $("#authStatus");
    const btnLogout = $("#btnLogout");
    const btnLogin = $("#btnOpenLogin");
    const adminNav = $('.nav-btn[data-view="admin"]');

    if (!state.currentUser) {
      authStatus.textContent = "로그인 필요";
      hide(btnLogout);
      show(btnLogin);
      hide(adminNav);
    } else {
      authStatus.textContent = `${state.currentUser.name} (${state.currentUser.role === "admin" ? "관리자" : "담당자"})`;
      show(btnLogout);
      hide(btnLogin);
      if (isAdmin()) show(adminNav);
      else hide(adminNav);
    }
  }

  function renderView() {
    $$(".view").forEach(v => v.classList.remove("active"));
    $$(".nav-btn").forEach(v => v.classList.remove("active"));

    const viewId = `#view-${state.currentView}`;
    $(viewId)?.classList.add("active");
    $(`.nav-btn[data-view="${state.currentView}"]`)?.classList.add("active");

    // 권한 가드
    if (state.currentView === "admin" && !isAdmin()) {
      state.currentView = "front";
      renderView();
      flashMessage("error", "관리자만 접근할 수 있습니다.");
      return;
    }

    if (state.currentView === "general-register" && !state.currentUser) {
      state.currentView = "front";
      renderView();
      flashMessage("error", "로그인 후 일반물건 등록이 가능합니다.");
      return;
    }
  }

  function sourceBadgeHtml(source) {
    const label = source === "auction" ? "경매" : source === "public" ? "공매" : "일반";
    const cls = source === "auction" ? "source-auction" : source === "public" ? "source-public" : "source-general";
    return `<span class="source-badge ${cls}">${label}</span>`;
  }

  function statusBadgeHtml(status) {
    const map = {
      active: ["진행중", "status-active"],
      hold: ["보류", "status-hold"],
      done: ["종결", "status-done"],
    };
    const [label, cls] = map[status] || ["-", "status-done"];
    return `<span class="status-badge ${cls}">${label}</span>`;
  }

  function getFrontFilteredProperties() {
    if (!state.currentUser) return [];

    const source = $("#filterSource")?.value || "all";
    const status = $("#filterStatus")?.value || "all";
    const region = normalizeWhitespace($("#filterRegion")?.value || "").toLowerCase();
    const keyword = normalizeWhitespace($("#filterKeyword")?.value || "").toLowerCase();

    let list = state.properties.filter((p) => canViewProperty(state.currentUser, p));

    if (source !== "all") list = list.filter((p) => p.source === source);
    if (status !== "all") list = list.filter((p) => p.status === status);

    if (region) {
      list = list.filter((p) =>
        [p.regionGu, p.regionDong, p.address].some((v) => String(v || "").toLowerCase().includes(region))
      );
    }

    if (keyword) {
      list = list.filter((p) =>
        [p.title, p.address, p.memo].some((v) => String(v || "").toLowerCase().includes(keyword))
      );
    }

    return list;
  }

  function renderFrontTable() {
    const tbody = $("#frontTableBody");
    if (!state.currentUser) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">로그인 후 조회할 수 있습니다.</td></tr>`;
      setText("#frontCount", "0건");
      return;
    }

    const items = getFrontFilteredProperties();
    setText("#frontCount", `${items.length.toLocaleString("ko-KR")}건`);

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">조회 결과가 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((p) => `
      <tr>
        <td>${sourceBadgeHtml(p.source)}</td>
        <td>${statusBadgeHtml(p.status)}</td>
        <td>${escapeHtml(p.title || "-")}</td>
        <td>${escapeHtml(p.address || "-")}</td>
        <td>${escapeHtml(p.regionGu || "-")} / ${escapeHtml(p.regionDong || "-")}</td>
        <td>${escapeHtml(p.assigneeName || "-")}</td>
        <td>${p.price ? `${formatNumber(p.price)}원` : "-"}</td>
        <td>${formatDate(p.createdAt)}</td>
      </tr>
    `).join("");
  }

  function renderUserTable() {
    const tbody = $("#userTableBody");
    const staffUsers = state.users;

    if (!staffUsers.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">계정 없음</td></tr>`;
      return;
    }

    tbody.innerHTML = staffUsers.map((u) => {
      const chips = (u.assignedRegions || []).length
        ? `<div class="chips">${u.assignedRegions.map(r => `<span class="chip region">${escapeHtml(r.unit)}:${escapeHtml(r.name)}</span>`).join("")}</div>`
        : `<span class="muted">없음</span>`;

      return `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${u.role === "admin" ? "관리자" : "담당자"}</td>
          <td>${chips}</td>
          <td>
            <button class="btn btn-outline btn-sm" data-action="select-user" data-user-id="${escapeHtml(u.id)}">배정대상 선택</button>
          </td>
        </tr>
      `;
    }).join("");

    // select box
    const select = $("#assignUserSelect");
    select.innerHTML = state.users
      .filter(u => u.role === "staff")
      .map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`)
      .join("") || `<option value="">(담당자 없음)</option>`;
  }

  function renderAdminPropertyTable() {
    const tbody = $("#adminPropertyTableBody");
    const items = [...state.properties];

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">데이터 없음</td></tr>`;
      setText("#adminStats", "0건");
      return;
    }

    const dupCountMap = {};
    items.forEach(p => {
      dupCountMap[p.addressNorm] = (dupCountMap[p.addressNorm] || 0) + 1;
    });

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
    setText(
      "#adminStats",
      `전체 ${items.length}건 · 경매 ${bySource.auction || 0} · 공매 ${bySource.public || 0} · 일반 ${bySource.general || 0}`
    );
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
      if (unit === "gu") {
        values = unique(state.properties.map(p => normalizeWhitespace(p.regionGu)).filter(Boolean));
      } else {
        values = unique(state.properties.map(p => regionKey("dong", p.regionGu, p.regionDong)).filter(Boolean));
      }
    }

    values = values.sort((a, b) => a.localeCompare(b, "ko"));
    pool.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
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
          ${g.regions.map(r => `<span class="chip region">${escapeHtml(r.unit)}:${escapeHtml(r.name)}</span>`).join("") || `<span class="muted">지역 없음</span>`}
        </div>
      </div>
    `).join("");
  }

  /******************************************************************
   * UTIL
   ******************************************************************/
  function unique(arr) {
    return [...new Set(arr)];
  }

  function getSelectedOptions(selectEl) {
    return Array.from(selectEl.selectedOptions || []).map(o => o.value);
  }

  /******************************************************************
   * AUTO GROUPING (휴리스틱)
   * - 지도/좌표 기반이 아니라 "인접성 근사 순서" 중심
   * - 추후 실제 GIS/행정동 경계 데이터로 교체 가능
   ******************************************************************/
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

    // dong 단위: "구" 기준으로 묶은 뒤, 동명 정렬
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
    return result.filter(group => group.length > 0);
  }

  function expandGuToDongs(selectedGuList, properties) {
    const map = new Map();
    properties.forEach(p => {
      const gu = normalizeWhitespace(p.regionGu);
      const dong = normalizeWhitespace(p.regionDong);
      if (!gu || !dong) return;
      if (selectedGuList.length && !selectedGuList.includes(gu)) return;
      const key = `${gu} ${dong}`.trim();
      map.set(key, true);
    });
    return [...map.keys()];
  }

  function buildAutoGroups({ staffCount, unit, selectedRegions }) {
    const staffUsers = state.users.filter(u => u.role === "staff");
    if (!staffUsers.length) throw new Error("담당자 계정이 없습니다.");
    if (!staffCount || staffCount < 1) throw new Error("담당자 수(X)는 1 이상이어야 합니다.");

    // 규칙:
    // - X명 = X구역 수
    // - 구 단위 총 개수보다 담당자 수가 많아지면 동 단위로 재편성
    let effectiveUnit = unit;
    let pool = [...selectedRegions];

    // unit=gu이고 X > 구 수이면 동 단위로 재편성
    if (unit === "gu" && staffCount > pool.length) {
      effectiveUnit = "dong";
      pool = expandGuToDongs(pool, state.properties);
      if (!pool.length) {
        // 동 데이터가 없는 경우, 수동/기존 입력에서 "구 동"이 있을 수 있으니 fallback 없음
        throw new Error("동 단위로 재편성할 데이터가 없습니다. 등록 물건에 동 정보가 필요합니다.");
      }
    }

    const sorted = sortRegionsWithHeuristic(pool, effectiveUnit);
    const groups = chunkContiguous(sorted, Math.min(staffCount, sorted.length));

    // 담당자 매칭 (앞에서부터)
    const assigned = groups.map((regions, idx) => {
      const user = staffUsers[idx] || null;
      return {
        userId: user?.id || "",
        userName: user?.name || "(미배정)",
        regions: regions.map(name => ({ unit: effectiveUnit, name })),
      };
    });

    return assigned;
  }

  /******************************************************************
   * DATA LOAD
   ******************************************************************/
  async function loadMe() {
    const res = await Api.auth.me();
    state.currentUser = res.user || null;
    renderAuth();
    renderView();
  }

  async function loadProperties() {
    const res = await Api.properties.list();
    state.properties = Array.isArray(res.items) ? res.items : [];
    renderFrontTable();
    if (isAdmin()) {
      renderAdminPropertyTable();
      renderRegionPool();
    }
  }

  async function loadUsers() {
    const res = await Api.users.list();
    state.users = Array.isArray(res.items) ? res.items : [];
    if (isAdmin()) {
      renderUserTable();
      renderAutoGroupDraft();
    }
  }

  async function reloadAll() {
    await loadMe();
    await Promise.all([loadProperties(), loadUsers()]);
  }

  /******************************************************************
   * EVENTS - NAV
   ******************************************************************/
  function bindNavEvents() {
    $$(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        state.currentView = view;
        renderView();
      });
    });
  }

  /******************************************************************
   * EVENTS - LOGIN
   ******************************************************************/
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

  function bindLoginEvents() {
    $("#btnOpenLogin").addEventListener("click", openLoginModal);
    $("#btnCloseLogin").addEventListener("click", closeLoginModal);
    $("#loginBackdrop").addEventListener("click", closeLoginModal);

    $("#btnLogout").addEventListener("click", async () => {
      try {
        await Api.auth.logout();
        state.currentUser = null;
        renderAuth();
        renderFrontTable();
        state.currentView = "front";
        renderView();
        flashMessage("success", "로그아웃되었습니다.");
      } catch (e) {
        flashMessage("error", e.message || "로그아웃 중 오류가 발생했습니다.");
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
        renderView();
        closeLoginModal();
        await Promise.all([loadProperties(), loadUsers()]);
        flashMessage("success", "로그인되었습니다.");
      } catch (err) {
        $("#loginError").textContent = err.message || "로그인 실패";
      }
    });
  }

  /******************************************************************
   * EVENTS - FRONT FILTERS
   ******************************************************************/
  function bindFrontEvents() {
    ["#filterSource", "#filterStatus", "#filterRegion", "#filterKeyword"].forEach(sel => {
      const el = $(sel);
      const evt = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, renderFrontTable);
    });

    $("#btnRefreshList").addEventListener("click", async () => {
      try {
        await loadProperties();
        flashMessage("info", "목록을 새로고침했습니다.", 1200);
      } catch (e) {
        flashMessage("error", e.message || "새로고침 실패");
      }
    });
  }

  /******************************************************************
   * EVENTS - 일반물건 등록
   ******************************************************************/
  function bindGeneralRegisterEvents() {
    $("#generalPropertyForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.currentUser) {
        flashMessage("error", "로그인 후 등록 가능합니다.");
        return;
      }

      const payload = {
        title: $("#gpTitle").value.trim(),
        address: $("#gpAddress").value.trim(),
        status: $("#gpStatus").value,
        price: Number($("#gpPrice").value || 0),
        memo: $("#gpMemo").value.trim(),
        regionGu: $("#gpRegionGu").value.trim(),
        regionDong: $("#gpRegionDong").value.trim(),
      };

      try {
        const res = await Api.properties.createGeneral(payload);
        $("#generalRegisterResult").textContent = `등록 완료: ${res.item?.title || ""}`;
        e.target.reset();
        await loadProperties();
        if (isAdmin()) renderRegionPool();
        flashMessage("success", "일반물건이 등록되었습니다.");
      } catch (err) {
        $("#generalRegisterResult").textContent = `오류: ${err.message || "등록 실패"}`;
        flashMessage("error", err.message || "등록 실패");
      }
    });
  }

  /******************************************************************
   * EVENTS - 관리자 (CSV)
   ******************************************************************/
  async function readFileText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("파일 읽기 실패"));
      fr.readAsText(file, "utf-8");
    });
  }

  function renderCsvPreview(headers, mappedRows) {
    const box = $("#csvPreviewBox");
    if (!mappedRows.length) {
      box.innerHTML = `<div class="muted">미리보기 데이터가 없습니다.</div>`;
      return;
    }

    const preview = mappedRows.slice(0, 5);
    box.innerHTML = `
      <div class="muted small" style="margin-bottom:6px;">
        원본헤더: ${escapeHtml(headers.join(", "))}
      </div>
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

  function bindAdminCsvEvents() {
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

    $("#btnCsvImport").addEventListener("click", async () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      const source = $("#csvType").value;
      if (!state.csvPreviewRows.length) {
        return flashMessage("error", "먼저 CSV 미리보기를 실행해 주세요.");
      }

      try {
        const res = await Api.properties.importCsvRows(source, state.csvPreviewRows);
        $("#csvImportResult").textContent =
          `업로드 완료 · 생성 ${res.created || 0}건 / 중복 ${res.duplicates || 0}건 / 오류 ${(res.errors || []).length}건`;
        await loadProperties();
        renderRegionPool();
        flashMessage("success", "CSV 업로드를 반영했습니다.");
      } catch (e) {
        flashMessage("error", e.message || "CSV 업로드 실패");
      }
    });
  }

  /******************************************************************
   * EVENTS - 관리자 (계정)
   ******************************************************************/
  function bindAdminUserEvents() {
    $("#userCreateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");

      const payload = {
        name: $("#userName").value.trim(),
        password: $("#userPassword").value,
        role: $("#userRole").value,
      };
      if (!payload.name || !payload.password) {
        return flashMessage("error", "이름과 비밀번호를 입력해 주세요.");
      }

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
      const userId = btn.dataset.userId;
      $("#assignUserSelect").value = userId;
      flashMessage("info", "지역 배정 대상 담당자를 선택했습니다.", 1200);
    });
  }

  /******************************************************************
   * EVENTS - 관리자 (지역 배정/자동 그룹핑)
   ******************************************************************/
  function bindAdminAssignEvents() {
    $("#btnLoadRegionPool").addEventListener("click", () => {
      renderRegionPool();
      flashMessage("info", "지역 후보 목록을 갱신했습니다.", 1200);
    });

    $("#assignUnit").addEventListener("change", renderRegionPool);
    $("#regionSourceMode").addEventListener("change", renderRegionPool);

    $("#btnAssignSelectedRegions").addEventListener("click", async () => {
      if (!isAdmin()) return flashMessage("error", "관리자만 가능");
      const userId = $("#assignUserSelect").value;
      const unit = $("#assignUnit").value;
      const selected = getSelectedOptions($("#regionPool"));

      if (!userId) return flashMessage("error", "대상 담당자를 선택해 주세요.");
      if (!selected.length) return flashMessage("error", "배정할 지역을 선택해 주세요.");

      const assignedRegions = selected.map(name => ({ unit, name }));

      try {
        await Api.users.updateAssignments(userId, assignedRegions);
        await loadUsers();
        flashMessage("success", "선택 지역 배정을 저장했습니다.");
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
          // 선택 없으면 전체 풀 사용
          selectedRegions = Array.from($("#regionPool").options).map(o => o.value);
        }

        if (!selectedRegions.length) throw new Error("지역 후보가 없습니다.");

        const draft = buildAutoGroups({
          staffCount,
          unit,
          selectedRegions,
        });

        // 담당자 수보다 그룹이 적으면 나머지 담당자는 빈 그룹으로 표시(옵션)
        const staffUsers = state.users.filter(u => u.role === "staff");
        if (draft.length < Math.min(staffCount, staffUsers.length)) {
          for (let i = draft.length; i < Math.min(staffCount, staffUsers.length); i++) {
            draft.push({
              userId: staffUsers[i]?.id || "",
              userName: staffUsers[i]?.name || "(미배정)",
              regions: [],
            });
          }
        }

        state.autoGroupDraft = draft;
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
        flashMessage("success", "자동 그룹핑 결과를 담당자 배정에 적용했습니다.");
      } catch (e) {
        flashMessage("error", e.message || "자동 그룹핑 적용 실패");
      }
    });
  }

  /******************************************************************
   * EVENTS - 관리자 (기타)
   ******************************************************************/
  function bindAdminMiscEvents() {
    $("#btnAdminReload").addEventListener("click", async () => {
      try {
        await Promise.all([loadProperties(), loadUsers()]);
        flashMessage("info", "관리자 데이터를 새로고침했습니다.", 1200);
      } catch (e) {
        flashMessage("error", e.message || "새로고침 실패");
      }
    });
  }

  /******************************************************************
   * INIT
   ******************************************************************/
  function bindAllEvents() {
    bindNavEvents();
    bindLoginEvents();
    bindFrontEvents();
    bindGeneralRegisterEvents();
    bindAdminCsvEvents();
    bindAdminUserEvents();
    bindAdminAssignEvents();
    bindAdminMiscEvents();
  }

  async function init() {
    bindAllEvents();
    renderAuth();
    renderView();
    renderAutoGroupDraft();
    renderRegionPool();

    try {
      await reloadAll();
    } catch (e) {
      console.error(e);
      flashMessage("error", e.message || "초기 로딩 실패");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
