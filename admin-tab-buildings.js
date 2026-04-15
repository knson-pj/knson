(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

  // 법정동 목록 (시군구별)
  const DONG_LIST = {
    "강남구": [
      { code: "1168010100", name: "역삼동" }, { code: "1168010300", name: "삼성동" },
      { code: "1168010500", name: "대치동" }, { code: "1168010600", name: "도곡동" },
      { code: "1168010700", name: "개포동" }, { code: "1168010800", name: "논현동" },
      { code: "1168010900", name: "세곡동" }, { code: "1168011000", name: "압구정동" },
      { code: "1168011100", name: "청담동" }, { code: "1168011200", name: "신사동" },
    ],
    "서초구": [
      { code: "1165010100", name: "서초동" }, { code: "1165010400", name: "반포동" },
      { code: "1165010500", name: "잠원동" }, { code: "1165010700", name: "방배동" },
      { code: "1165010800", name: "양재동" }, { code: "1165011000", name: "내곡동" },
    ],
    "송파구": [
      { code: "1171010100", name: "잠실동" }, { code: "1171010200", name: "신천동" },
      { code: "1171010300", name: "가락동" }, { code: "1171010400", name: "석촌동" },
      { code: "1171010600", name: "문정동" }, { code: "1171010800", name: "방이동" },
      { code: "1171010900", name: "오금동" },
    ],
    "영등포구": [
      { code: "1156010100", name: "영등포동" }, { code: "1156010400", name: "여의도동" },
      { code: "1156010500", name: "당산동" }, { code: "1156010800", name: "신길동" },
    ],
    "마포구": [
      { code: "1144010500", name: "합정동" }, { code: "1144010600", name: "서교동" },
      { code: "1144010700", name: "상수동" }, { code: "1144010800", name: "망원동" },
      { code: "1144010900", name: "연남동" },
    ],
    "용산구": [
      { code: "1117010200", name: "이태원동" }, { code: "1117010300", name: "한남동" },
      { code: "1117010800", name: "용산동" },
    ],
    "성동구": [
      { code: "1120010800", name: "성수동" }, { code: "1120010100", name: "금호동" },
      { code: "1120010200", name: "옥수동" },
    ],
    "중구": [
      { code: "1114011200", name: "을지로동" }, { code: "1114011500", name: "명동" },
      { code: "1114012100", name: "신당동" }, { code: "1114012400", name: "장충동" },
    ],
    "종로구": [
      { code: "1111011100", name: "종로동" }, { code: "1111012100", name: "인사동" },
      { code: "1111012500", name: "사직동" }, { code: "1111014000", name: "삼청동" },
    ],
  };

  let selectedDongs = new Set();
  let isRunning = false;
  let shouldStop = false;

  function getProxyUrl() {
    return document.querySelector('meta[name="vworld-proxy-url"]')?.getAttribute("content")?.replace("vworld-proxy", "building-collector") || "";
  }

  async function getAuthHeaders() {
    var headers = {};
    var K = window.KNSN || {};
    var rt = window.KNSN_ADMIN_RUNTIME || {};

    // 1) anon key: Supabase config → localStorage → meta 태그
    var anonKey = "";
    try {
      if (typeof K.initSupabase === "function") {
        // Supabase 클라이언트가 초기화된 경우 config에서 가져옴
        var cfg = null;
        if (typeof K.supabaseEnabled === "function" && K.supabaseEnabled()) {
          // getSupabaseConfig는 내부 함수이므로 localStorage에서 직접 읽음
          anonKey = String(localStorage.getItem("knson_supabase_key") || "").trim();
        }
      }
    } catch (e) {}
    if (!anonKey) {
      try { anonKey = String(localStorage.getItem("knson_supabase_key") || "").trim(); } catch (e) {}
    }
    if (!anonKey) {
      anonKey = (document.querySelector('meta[name="supabase-anon-key"]') || {}).content || "";
    }
    if (anonKey) headers["apikey"] = anonKey;

    // 2) access token: 여러 소스에서 시도
    var accessToken = "";

    // 2a) Supabase 클라이언트의 현재 세션에서 직접 access_token 추출
    if (!accessToken && typeof K.sbGetSession === "function") {
      try {
        var sess = await K.sbGetSession();
        accessToken = String(sess?.access_token || "").trim();
      } catch (e) { console.warn("[bld] sbGetSession failed:", e.message); }
    }

    // 2b) sbGetAccessToken (토큰 갱신 포함)
    if (!accessToken && typeof K.sbGetAccessToken === "function") {
      try {
        accessToken = String(await K.sbGetAccessToken() || "").trim();
      } catch (e) { console.warn("[bld] sbGetAccessToken failed:", e.message); }
    }

    // 2c) admin runtime의 앱 세션 토큰 (Supabase JWT와 동일)
    if (!accessToken) {
      try {
        var session = rt.state?.session || null;
        if (!session) {
          var raw = sessionStorage.getItem("knson_bms_session_v1");
          if (raw) session = JSON.parse(raw);
        }
        accessToken = String(session?.token || "").trim();
      } catch (e) {}
    }

    if (accessToken) {
      headers["Authorization"] = "Bearer " + accessToken;
    }

    return headers;
  }

  function $(id) { return document.getElementById(id); }

  function escHtml(s) { return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function fmtDate(iso) {
    if (!iso) return "-";
    try { var d = new Date(iso); return d.toLocaleDateString("ko-KR") + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
  }

  function appendLog(msg) {
    var el = $("bldLog");
    if (!el) return;
    el.innerHTML += '<div>' + escHtml(new Date().toLocaleTimeString("ko-KR")) + ' ' + escHtml(msg) + '</div>';
    el.scrollTop = el.scrollHeight;
  }

  // ── 동 선택 UI ──
  function renderDongGrid(region) {
    var grid = $("bldDongGrid");
    if (!grid) return;
    var dongs = region ? (DONG_LIST[region] || []) : Object.values(DONG_LIST).flat();
    grid.innerHTML = dongs.map(function(d) {
      var checked = selectedDongs.has(d.code) ? "checked" : "";
      return '<label class="bld-dong-chip' + (checked ? ' is-checked' : '') + '">' +
        '<input type="checkbox" value="' + d.code + '" data-name="' + escHtml(d.name) + '" ' + checked + ' />' +
        '<span>' + escHtml(d.name) + '</span></label>';
    }).join("");
    // 이벤트
    grid.querySelectorAll("input[type=checkbox]").forEach(function(cb) {
      cb.addEventListener("change", function() {
        if (cb.checked) selectedDongs.add(cb.value); else selectedDongs.delete(cb.value);
        cb.parentElement.classList.toggle("is-checked", cb.checked);
        updateSelectedCount();
      });
    });
    updateSelectedCount();
  }

  function updateSelectedCount() {
    var el = $("bldSelectedCount");
    if (el) el.textContent = selectedDongs.size + "개 선택";
    var btnCollect = $("bldBtnCollect");
    var btnEnrich = $("bldBtnEnrich");
    if (btnCollect) btnCollect.disabled = selectedDongs.size === 0 || isRunning;
    if (btnEnrich) btnEnrich.disabled = selectedDongs.size === 0 || isRunning;
  }

  // ── 수집 실행 ──
  async function runCollect() {
    if (isRunning) return;
    var dongs = Array.from(selectedDongs);
    if (!dongs.length) return;

    // Supabase 세션 동기화
    var K = window.KNSN || {};
    if (typeof K.sbSyncLocalSession === "function") {
      try { await K.sbSyncLocalSession(); } catch (e) {}
    }

    isRunning = true; shouldStop = false;
    $("bldBtnCollect").disabled = true;
    $("bldBtnEnrich").disabled = true;
    $("bldBtnStop").classList.remove("hidden");
    $("bldProgress").classList.remove("hidden");
    $("bldLog").innerHTML = "";

    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();

    // 인증 사전 검증
    if (!headers["Authorization"]) {
      appendLog("❌ 인증 토큰을 가져올 수 없습니다. 다시 로그인 후 시도해 주세요.");
      isRunning = false;
      $("bldBtnStop").classList.add("hidden");
      updateSelectedCount();
      return;
    }

    var total = dongs.length;

    for (var i = 0; i < total; i++) {
      if (shouldStop) { appendLog("사용자에 의해 중단됨"); break; }
      var code = dongs[i];
      var name = findDongName(code);
      $("bldProgressLabel").textContent = "표제부 수집: " + name + " (" + (i+1) + "/" + total + ")";
      $("bldProgressPct").textContent = Math.round(((i+1)/total)*100) + "%";
      $("bldProgressBar").style.width = Math.round(((i+1)/total)*100) + "%";

      appendLog(name + " 표제부 수집 시작...");
      try {
        var res = await fetch(baseUrl + "?mode=collect&dongCode=" + code + "&dongName=" + encodeURIComponent(name), { headers: headers });
        if (res.status === 401) {
          var errBody = await res.text().catch(function() { return ""; });
          appendLog(name + " ❌ 인증 실패(401): " + errBody);
          appendLog("토큰 갱신을 시도합니다...");
          headers = await getAuthHeaders();
          if (!headers["Authorization"]) { appendLog("❌ 토큰 갱신 실패. 다시 로그인해 주세요."); break; }
          // 재시도
          res = await fetch(baseUrl + "?mode=collect&dongCode=" + code + "&dongName=" + encodeURIComponent(name), { headers: headers });
        }
        var data = await res.json();
        if (data.ok) {
          appendLog(name + " ✅ " + (data.parcels||0) + "필지 수집 완료");
        } else {
          appendLog(name + " ❌ " + (data.error||"실패"));
        }
      } catch (e) {
        appendLog(name + " ❌ 오류: " + e.message);
      }
    }

    // enrich 자동 실행
    if (!shouldStop) {
      appendLog("── 전유부+지오코딩 보충 시작 ──");
      for (var j = 0; j < dongs.length; j++) {
        if (shouldStop) break;
        var code2 = dongs[j];
        var name2 = findDongName(code2);
        var enrichDone = false;
        var enrichRound = 0;
        while (!enrichDone && !shouldStop && enrichRound < 100) {
          enrichRound++;
          $("bldProgressLabel").textContent = "보충: " + name2 + " (라운드 " + enrichRound + ")";
          try {
            var eres = await fetch(baseUrl + "?mode=enrich&dongCode=" + code2 + "&limit=20", { headers: headers });
            var edata = await eres.json();
            if (edata.done) {
              enrichDone = true;
              appendLog(name2 + " 보충 완료 ✅");
            } else {
              $("bldProgressDetail").textContent = "enriched=" + (edata.enriched||0) + " geocoded=" + (edata.geocoded||0) + " remaining=" + (edata.remainingResidential||0);
            }
          } catch (e) {
            appendLog(name2 + " 보충 오류: " + e.message);
            enrichDone = true;
          }
        }
      }
    }

    isRunning = false;
    $("bldBtnStop").classList.add("hidden");
    $("bldProgressLabel").textContent = shouldStop ? "중단됨" : "완료";
    updateSelectedCount();
    appendLog("── 수집 작업 " + (shouldStop ? "중단" : "완료") + " ──");
    loadStatus();
  }

  // ── enrich만 실행 ──
  async function runEnrichOnly() {
    if (isRunning) return;
    var dongs = Array.from(selectedDongs);
    if (!dongs.length) return;
    var K = window.KNSN || {};
    if (typeof K.sbSyncLocalSession === "function") {
      try { await K.sbSyncLocalSession(); } catch (e) {}
    }
    isRunning = true; shouldStop = false;
    $("bldBtnCollect").disabled = true;
    $("bldBtnEnrich").disabled = true;
    $("bldBtnStop").classList.remove("hidden");
    $("bldProgress").classList.remove("hidden");
    $("bldLog").innerHTML = "";

    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();

    for (var j = 0; j < dongs.length; j++) {
      if (shouldStop) break;
      var code = dongs[j];
      var name = findDongName(code);
      var enrichDone = false;
      var enrichRound = 0;
      while (!enrichDone && !shouldStop && enrichRound < 100) {
        enrichRound++;
        $("bldProgressLabel").textContent = "보충: " + name + " (" + enrichRound + "회)";
        $("bldProgressPct").textContent = Math.round(((j+1)/dongs.length)*100) + "%";
        try {
          var eres = await fetch(baseUrl + "?mode=enrich&dongCode=" + code + "&limit=20", { headers: headers });
          var edata = await eres.json();
          if (edata.done) { enrichDone = true; appendLog(name + " 보충 완료 ✅"); }
          else { $("bldProgressDetail").textContent = "enriched=" + (edata.enriched||0) + " remaining=" + (edata.remainingResidential||0); }
        } catch (e) { appendLog(name + " 보충 오류: " + e.message); enrichDone = true; }
      }
    }
    isRunning = false;
    $("bldBtnStop").classList.add("hidden");
    updateSelectedCount();
    loadStatus();
  }

  function findDongName(code) {
    for (var region in DONG_LIST) {
      for (var d of DONG_LIST[region]) { if (d.code === code) return d.name; }
    }
    return code;
  }

  // ── 상태 테이블 ──
  async function loadStatus() {
    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();
    try {
      var res = await fetch(baseUrl + "?mode=status", { headers: headers });
      if (res.status === 401) {
        // 토큰 갱신 후 재시도
        var K = window.KNSN || {};
        if (typeof K.sbSyncLocalSession === "function") {
          try { await K.sbSyncLocalSession(true); } catch (e) {}
        }
        headers = await getAuthHeaders();
        res = await fetch(baseUrl + "?mode=status", { headers: headers });
      }
      var data = await res.json();
      renderStatus(data.jobs || []);
    } catch (e) {
      appendLog("상태 조회 실패: " + e.message);
    }
  }

  function renderStatus(jobs) {
    var tbody = $("bldStatusBody");
    var empty = $("bldStatusEmpty");
    if (!tbody) return;
    if (!jobs.length) { tbody.innerHTML = ""; if (empty) empty.classList.remove("hidden"); return; }
    if (empty) empty.classList.add("hidden");
    tbody.innerHTML = jobs.map(function(j) {
      var statusBadge = j.status === "done" || j.status === "collected"
        ? '<span style="color:#4CAF50;font-weight:700;">' + escHtml(j.status) + '</span>'
        : '<span style="color:#FF9800;">' + escHtml(j.status || "pending") + '</span>';
      return '<tr>' +
        '<td>' + escHtml(j.dong_name || j.dong_code) + '</td>' +
        '<td>' + (j.total_buildings || 0) + '</td>' +
        '<td>' + (j.collected_buildings || 0) + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="font-size:10px;">' + fmtDate(j.finished_at) + '</td>' +
        '</tr>';
    }).join("");
  }

  // ── 초기화 ──
  mod.init = function init() {
    // 시군구 셀렉트
    var regionSel = $("bldRegionSelect");
    if (regionSel) {
      regionSel.innerHTML = '<option value="">전체</option>' +
        Object.keys(DONG_LIST).map(function(k) { return '<option value="' + escHtml(k) + '">' + escHtml(k) + '</option>'; }).join("");
      regionSel.addEventListener("change", function() { renderDongGrid(regionSel.value); });
    }
    renderDongGrid("");

    // 전체선택/해제
    if ($("bldSelectAll")) $("bldSelectAll").addEventListener("click", function() {
      var region = regionSel ? regionSel.value : "";
      var dongs = region ? (DONG_LIST[region]||[]) : Object.values(DONG_LIST).flat();
      dongs.forEach(function(d) { selectedDongs.add(d.code); });
      renderDongGrid(region);
    });
    if ($("bldDeselectAll")) $("bldDeselectAll").addEventListener("click", function() {
      selectedDongs.clear();
      renderDongGrid(regionSel ? regionSel.value : "");
    });

    // 수집 버튼
    if ($("bldBtnCollect")) $("bldBtnCollect").addEventListener("click", function() { runCollect(); });
    if ($("bldBtnEnrich")) $("bldBtnEnrich").addEventListener("click", function() { runEnrichOnly(); });
    if ($("bldBtnStop")) $("bldBtnStop").addEventListener("click", function() { shouldStop = true; });
    if ($("bldBtnRefreshStatus")) $("bldBtnRefreshStatus").addEventListener("click", function() { loadStatus(); });

    // 초기 상태 로드 (세션 동기화 후)
    (async function() {
      var K = window.KNSN || {};
      if (typeof K.sbSyncLocalSession === "function") {
        try { await K.sbSyncLocalSession(); } catch (e) {}
      }
      loadStatus();
    })();
  };

  AdminModules.buildingsTab = mod;
})();
