/**
 * admin-tab-valuation.js
 * Phase 5 — 관리자 가격평가 관리 탭
 * 시도 → 시군구 → 동 드롭다운 + 자동 코드 매핑
 */
(() => {
  "use strict";

  const API_BASE = (window.KNSN && typeof window.KNSN.getApiBase === "function")
    ? window.KNSN.getApiBase()
    : "https://knson.vercel.app/api";

  function getAuthToken() {
    try {
      const raw = sessionStorage.getItem("knson_bms_session_v1");
      return raw ? (JSON.parse(raw)?.token || "") : "";
    } catch { return ""; }
  }

  function authHeaders() {
    const t = getAuthToken();
    return { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) };
  }

  // ── 시도 목록 (고정) ──
  const SIDO_LIST = [
    { name: "서울특별시", code: "11" }, { name: "부산광역시", code: "26" },
    { name: "대구광역시", code: "27" }, { name: "인천광역시", code: "28" },
    { name: "광주광역시", code: "29" }, { name: "대전광역시", code: "30" },
    { name: "울산광역시", code: "31" }, { name: "세종특별자치시", code: "36" },
    { name: "경기도", code: "41" }, { name: "강원특별자치도", code: "42" },
    { name: "충청북도", code: "43" }, { name: "충청남도", code: "44" },
    { name: "전북특별자치도", code: "45" }, { name: "전라남도", code: "46" },
    { name: "경상북도", code: "47" }, { name: "경상남도", code: "48" },
    { name: "제주특별자치도", code: "50" },
  ];

  // ── 시군구 하드코딩 (주요 지역, API 폴백용) ──
  const SGG_MAP = {
    "서울특별시": [
      {n:"강남구",c:"11680"},{n:"강동구",c:"11740"},{n:"강북구",c:"11305"},{n:"강서구",c:"11500"},
      {n:"관악구",c:"11620"},{n:"광진구",c:"11215"},{n:"구로구",c:"11530"},{n:"금천구",c:"11545"},
      {n:"노원구",c:"11350"},{n:"도봉구",c:"11320"},{n:"동대문구",c:"11230"},{n:"동작구",c:"11590"},
      {n:"마포구",c:"11440"},{n:"서대문구",c:"11410"},{n:"서초구",c:"11650"},{n:"성동구",c:"11200"},
      {n:"성북구",c:"11290"},{n:"송파구",c:"11710"},{n:"양천구",c:"11470"},{n:"영등포구",c:"11560"},
      {n:"용산구",c:"11170"},{n:"은평구",c:"11380"},{n:"종로구",c:"11110"},{n:"중구",c:"11140"},
      {n:"중랑구",c:"11260"},
    ],
    "부산광역시": [
      {n:"강서구",c:"26440"},{n:"금정구",c:"26410"},{n:"기장군",c:"26710"},{n:"남구",c:"26300"},
      {n:"동구",c:"26170"},{n:"동래구",c:"26260"},{n:"부산진구",c:"26230"},{n:"북구",c:"26320"},
      {n:"사상구",c:"26530"},{n:"사하구",c:"26380"},{n:"서구",c:"26140"},{n:"수영구",c:"26500"},
      {n:"연제구",c:"26470"},{n:"영도구",c:"26200"},{n:"중구",c:"26110"},{n:"해운대구",c:"26350"},
    ],
    "인천광역시": [
      {n:"계양구",c:"28245"},{n:"남동구",c:"28200"},{n:"동구",c:"28140"},{n:"미추홀구",c:"28177"},
      {n:"부평구",c:"28237"},{n:"서구",c:"28260"},{n:"연수구",c:"28185"},{n:"중구",c:"28110"},
    ],
    "경기도": [
      {n:"고양시덕양구",c:"41281"},{n:"고양시일산동구",c:"41285"},{n:"고양시일산서구",c:"41287"},
      {n:"과천시",c:"41290"},{n:"광명시",c:"41210"},{n:"광주시",c:"41610"},
      {n:"구리시",c:"41310"},{n:"군포시",c:"41410"},{n:"김포시",c:"41570"},
      {n:"남양주시",c:"41360"},{n:"동두천시",c:"41250"},{n:"부천시",c:"41190"},
      {n:"성남시분당구",c:"41135"},{n:"성남시수정구",c:"41131"},{n:"성남시중원구",c:"41133"},
      {n:"수원시권선구",c:"41113"},{n:"수원시영통구",c:"41117"},{n:"수원시장안구",c:"41111"},
      {n:"수원시팔달구",c:"41115"},{n:"시흥시",c:"41390"},{n:"안산시단원구",c:"41273"},
      {n:"안산시상록구",c:"41271"},{n:"안양시동안구",c:"41173"},{n:"안양시만안구",c:"41171"},
      {n:"양주시",c:"41630"},{n:"오산시",c:"41370"},{n:"용인시기흥구",c:"41463"},
      {n:"용인시수지구",c:"41465"},{n:"용인시처인구",c:"41461"},{n:"의왕시",c:"41430"},
      {n:"의정부시",c:"41150"},{n:"이천시",c:"41500"},{n:"파주시",c:"41480"},
      {n:"평택시",c:"41220"},{n:"포천시",c:"41650"},{n:"하남시",c:"41450"},
      {n:"화성시",c:"41590"},
    ],
  };

  // ═══════════════════════════════════════════════════
  // 탭 HTML
  // ═══════════════════════════════════════════════════

  const S = "padding:7px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;";
  const B = "padding:7px 16px;border:none;border-radius:6px;font-size:13px;cursor:pointer;color:#fff;";

  function renderTab() {
    const opts = SIDO_LIST.map(function(s) { return '<option value="' + s.name + '">' + s.name + '</option>'; }).join("");
    return '<div style="padding:20px">' +

      '<div style="margin-bottom:24px;padding:16px;background:rgba(0,0,0,0.02);border-radius:10px;border:1px solid rgba(0,0,0,0.06)">' +
        '<h3 style="font-size:15px;font-weight:600;margin-bottom:12px">📍 지역 선택</h3>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
          '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">시도<select id="valSido" style="' + S + 'min-width:150px"><option value="">선택</option>' + opts + '</select></label>' +
          '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">시군구<select id="valSgg" style="' + S + 'min-width:140px" disabled><option value="">시도 먼저 선택</option></select></label>' +
          '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">동 (임대 수집용, 선택사항)<select id="valDong" style="' + S + 'min-width:140px" disabled><option value="">시군구 먼저 선택</option></select></label>' +
        '</div>' +
        '<div id="valRegionInfo" style="margin-top:8px;font-size:12px;color:#999"></div>' +
      '</div>' +

      '<div style="margin-bottom:24px">' +
        '<h3 style="font-size:15px;font-weight:600;margin-bottom:12px">📊 국토부 실거래 데이터 수집</h3>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
          '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">시작<input id="valStartYm" type="month" style="' + S + 'width:150px" /></label>' +
          '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">종료<input id="valEndYm" type="month" style="' + S + 'width:150px" /></label>' +
          '<button id="btnFetchMolit" type="button" style="' + B + 'background:#534AB7">수집 시작</button>' +
        '</div>' +
        '<div id="valMolitLog" style="margin-top:10px;font-size:12px;color:#666;max-height:200px;overflow-y:auto"></div>' +
      '</div>' +

      '<div style="margin-bottom:24px">' +
        '<h3 style="font-size:15px;font-weight:600;margin-bottom:12px">🏪 상가 임대 호가 등록 (CSV 업로드)</h3>' +
        '<div style="margin-bottom:10px;font-size:12px;color:#888;line-height:1.6">' +
          '네이버 부동산에서 상가 월세 매물을 조회 → 엑셀에 정리 → CSV로 저장 후 업로드<br>' +
          '<strong>필수 컬럼:</strong> 동, 월세(만원) &nbsp; <strong>권장 컬럼:</strong> 주소, 층, 면적(㎡), 보증금(만원), 건물명' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
          '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">CSV 파일' +
            '<input id="valRentalCsv" type="file" accept=".csv,.tsv,.txt" style="font-size:12px" /></label>' +
          '<button id="btnUploadRental" type="button" style="' + B + 'background:#0FA68B">업로드</button>' +
          '<button id="btnShowRentalSample" type="button" style="padding:7px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:12px;cursor:pointer;background:#fff;">샘플 CSV 다운로드</button>' +
        '</div>' +
        '<div id="valRentalLog" style="margin-top:10px;font-size:12px;color:#666;max-height:200px;overflow-y:auto"></div>' +
      '</div>' +

      '<div style="margin-bottom:24px">' +
        '<h3 style="font-size:15px;font-weight:600;margin-bottom:12px">⚡ 매물 일괄 평가</h3>' +
        '<div style="display:flex;gap:10px;align-items:end">' +
          '<select id="valEvalTarget" style="' + S + '"><option value="active">진행중 매물 전체</option><option value="unevaluated">미평가 매물만</option></select>' +
          '<button id="btnRunEval" type="button" style="' + B + 'background:#D85A30">평가 실행</button>' +
        '</div>' +
        '<div id="valEvalLog" style="margin-top:10px;font-size:12px;color:#666;max-height:300px;overflow-y:auto"></div>' +
      '</div>' +

      '<div>' +
        '<h3 style="font-size:15px;font-weight:600;margin-bottom:12px">📋 평가 결과 요약</h3>' +
        '<div id="valResultSummary" style="font-size:13px;color:#666"></div>' +
      '</div>' +

    '</div>';
  }

  // ═══════════════════════════════════════════════════
  // 지역 선택 로직
  // ═══════════════════════════════════════════════════

  let curSgg = null;  // { name, code }
  let curDong = null; // { name, code }

  function onSidoChange() {
    var sido = document.getElementById("valSido").value;
    var sggSel = document.getElementById("valSgg");
    var dongSel = document.getElementById("valDong");
    var info = document.getElementById("valRegionInfo");
    curSgg = null; curDong = null;
    dongSel.innerHTML = '<option value="">시군구 먼저 선택</option>';
    dongSel.disabled = true;
    if (info) info.textContent = "";

    if (!sido) {
      sggSel.innerHTML = '<option value="">시도 먼저 선택</option>';
      sggSel.disabled = true;
      return;
    }

    var list = SGG_MAP[sido] || [];
    if (!list.length) {
      sggSel.innerHTML = '<option value="">해당 시도의 시군구 데이터가 없습니다</option>';
      sggSel.disabled = true;
      return;
    }

    sggSel.innerHTML = '<option value="">선택</option>' +
      list.map(function(s) { return '<option value="' + s.n + '" data-code="' + s.c + '">' + s.n + '</option>'; }).join("");
    sggSel.disabled = false;
  }

  function onSggChange() {
    var sggSel = document.getElementById("valSgg");
    var dongSel = document.getElementById("valDong");
    var info = document.getElementById("valRegionInfo");
    var opt = sggSel.selectedOptions[0];
    curDong = null;

    if (!opt || !opt.value) {
      curSgg = null;
      dongSel.innerHTML = '<option value="">시군구 먼저 선택</option>';
      dongSel.disabled = true;
      if (info) info.textContent = "";
      return;
    }

    curSgg = { name: opt.value, code: opt.dataset.code || "" };
    if (info) info.textContent = "시군구코드: " + curSgg.code;

    // 동 목록은 법정동코드 API로 가져와야 하지만, 프론트에서 직접 호출 불가(CORS)
    // → 임대 수집 시 cortarNo를 시군구코드 + 00000으로 설정
    dongSel.innerHTML = '<option value="">전체 (시군구 단위 수집)</option>';
    dongSel.disabled = true;
  }

  // ═══════════════════════════════════════════════════
  // 수집/평가 핸들러
  // ═══════════════════════════════════════════════════

  async function handleFetchMolit() {
    var log = document.getElementById("valMolitLog");
    if (!curSgg) { log.textContent = "⚠️ 시도/시군구를 선택하세요."; return; }
    var s = document.getElementById("valStartYm").value;
    var e = document.getElementById("valEndYm").value;
    if (!s || !e) { log.textContent = "⚠️ 시작/종료 년월을 선택하세요."; return; }
    var startYm = s.replace("-", ""), endYm = e.replace("-", "");
    var code = curSgg.code;

    var yms = [];
    var y = parseInt(startYm.substring(0, 4)), m = parseInt(startYm.substring(4, 6));
    var ey = parseInt(endYm.substring(0, 4)), em = parseInt(endYm.substring(4, 6));
    while (y < ey || (y === ey && m <= em)) {
      yms.push(String(y) + String(m).padStart(2, "0"));
      m++; if (m > 12) { m = 1; y++; }
    }

    log.innerHTML = '<strong>' + curSgg.name + ' / ' + yms.length + '개월 수집 시작...</strong><br>';
    var total = 0;
    for (var i = 0; i < yms.length; i++) {
      try {
        var res = await fetch(API_BASE + "/admin/valuation/market-data", {
          method: "POST", headers: authHeaders(),
          body: JSON.stringify({ sigunguCode: code, dealYm: yms[i] }),
        });
        var data = await res.json();
        total += data.inserted || 0;
        log.innerHTML += '✅ ' + yms[i] + ': ' + (data.fetched || 0) + '건 조회 / ' + (data.inserted || 0) + '건 저장<br>';
        log.scrollTop = log.scrollHeight;
      } catch (err) {
        log.innerHTML += '❌ ' + yms[i] + ': ' + err.message + '<br>';
      }
    }
    log.innerHTML += '<br><strong>완료! 총 ' + total + '건 저장</strong>';
  }

  async function handleUploadRental() {
    var log = document.getElementById("valRentalLog");
    if (!curSgg) { log.textContent = "⚠️ 시도/시군구를 먼저 선택하세요."; return; }

    var fileInput = document.getElementById("valRentalCsv");
    if (!fileInput || !fileInput.files.length) {
      log.textContent = "⚠️ CSV 파일을 선택하세요.";
      return;
    }

    log.textContent = "파일 읽는 중...";

    var file = fileInput.files[0];
    var text = await file.text();
    var rows = parseCsvText(text);

    if (!rows.length) {
      log.textContent = "⚠️ CSV에서 데이터를 읽을 수 없습니다. 헤더 행이 있는지 확인하세요.";
      return;
    }

    log.textContent = rows.length + "건 파싱 완료, 업로드 중...";

    try {
      var res = await fetch(API_BASE + "/admin/valuation/rental-data", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          action: "upload-csv",
          sigunguCode: curSgg.code,
          csvRows: rows,
        }),
      });
      var data = await res.json();
      log.textContent = '✅ 전체 ' + (data.total || 0) + '건 중 유효 ' + (data.valid || 0) + '건 / 저장 ' + (data.inserted || 0) + '건' +
        (data.errors ? ' / 오류 ' + data.errors + '건' : '');
    } catch (err) {
      log.textContent = '❌ ' + err.message;
    }
  }

  function parseCsvText(text) {
    var lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    // 탭 또는 쉼표 구분 자동 감지
    var sep = lines[0].includes('\t') ? '\t' : ',';
    var headers = lines[0].split(sep).map(function(h) { return h.replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim(); });

    var result = [];
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var values = line.split(sep).map(function(v) { return v.replace(/^"|"$/g, '').trim(); });
      var obj = {};
      headers.forEach(function(h, idx) { obj[h] = values[idx] || ''; });
      result.push(obj);
    }
    return result;
  }

  function handleDownloadSample() {
    var csv = '동,주소,건물명,층,면적(㎡),보증금(만원),월세(만원),설명\n' +
      '역삼동,서울특별시 강남구 역삼동 123-4,OO빌딩,1,45.5,3000,150,역삼역 도보 3분\n' +
      '역삼동,서울특별시 강남구 역삼동 456-7,△△상가,B1,33.2,1000,80,지하 상가\n' +
      '논현동,서울특별시 강남구 논현동 89-1,□□타워,2,60.0,5000,200,대로변 코너\n';
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rental_sample.csv';
    a.click();
  }

  async function handleRunEval() {
    var log = document.getElementById("valEvalLog");
    log.innerHTML = "⚠️ 개별 매물 상세에서 [평가 실행] 버튼을 사용하세요.<br>일괄 평가 기능은 추후 업데이트됩니다.";
  }

  function loadSummary() {
    var el = document.getElementById("valResultSummary");
    if (!el) return;
    var gs = [
      { l: "A", d: "즉시 매입 추천", c: "#17C964", bg: "#E7F8EE", t: "#085041" },
      { l: "B", d: "양호", c: "#59A7FF", bg: "#E7F2FF", t: "#0C447C" },
      { l: "C", d: "보통", c: "#F6B04A", bg: "#FFF1DD", t: "#633806" },
      { l: "D", d: "미흡", c: "#E87040", bg: "#FFF0E8", t: "#712B13" },
      { l: "E", d: "비추천", c: "#E24B4A", bg: "#FCEBEB", t: "#791F1F" },
    ];
    var h = '<div style="display:flex;gap:12px;flex-wrap:wrap">';
    gs.forEach(function(g) {
      h += '<div style="padding:12px 18px;border-radius:8px;background:' + g.bg + ';border:1px solid ' + g.c + ';min-width:80px;text-align:center">' +
        '<div style="font-size:20px;font-weight:700;color:' + g.t + '">' + g.l + '</div>' +
        '<div style="font-size:11px;color:' + g.t + ';opacity:0.7">' + g.d + '</div></div>';
    });
    h += '</div><p style="margin-top:12px;font-size:12px;opacity:0.6">지역을 선택하고 데이터를 수집한 후, 매물 상세에서 평가를 실행하세요.</p>';
    el.innerHTML = h;
  }

  // ═══════════════════════════════════════════════════
  // 초기화
  // ═══════════════════════════════════════════════════

  var inited = false;

  function initValuationTab(el) {
    if (!el) return;
    if (inited) return;
    inited = true;
    el.innerHTML = renderTab();

    var now = new Date();
    var endV = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var sd = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    var startV = sd.getFullYear() + "-" + String(sd.getMonth() + 1).padStart(2, "0");
    var se = document.getElementById("valStartYm"); if (se) se.value = startV;
    var ee = document.getElementById("valEndYm"); if (ee) ee.value = endV;

    document.getElementById("valSido").addEventListener("change", onSidoChange);
    document.getElementById("valSgg").addEventListener("change", onSggChange);
    document.getElementById("btnUploadRental").addEventListener("click", handleUploadRental);
    document.getElementById("btnShowRentalSample").addEventListener("click", handleDownloadSample);
    document.getElementById("btnFetchMolit").addEventListener("click", handleFetchMolit);
    document.getElementById("btnRunEval").addEventListener("click", handleRunEval);
    loadSummary();
  }

  window.KNSN_VALUATION_ADMIN = { initValuationTab: initValuationTab };
})();
