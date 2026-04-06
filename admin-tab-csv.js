(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const DataAccess = window.KNSN_DATA_ACCESS || null;

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return { rt, state: rt.state || {}, els: rt.els || {}, K: rt.K, api: rt.adminApi, utils: rt.utils || {} };
  }

  mod.handleCsvUpload = async function handleCsvUpload() {
    const { state, els, K, api, utils } = ctx();
    const {
      buildRegisterLogContext,
      ensureAuxiliaryPropertiesForAdmin,
      getAuxiliaryPropertiesSnapshot,
      buildRegistrationMatchKey,
      buildRegistrationSnapshotFromItem,
      buildRegistrationSnapshotFromDbRow,
      buildRegistrationDbRowForExisting,
      buildRegistrationDbRowForCreate,
      normalizeProperty,
      showResultBox,
      invalidatePropertyCollections,
      loadProperties,
      setGlobalMsg,
      goLoginPage,
    } = utils;
    try {
      const file = els.csvFileInput.files?.[0];
      if (!file) return alert("CSV 파일을 선택해 주세요.");

      const sourceType = String(els.csvImportSource.value || "auction");
      const csvText = await mod.readCsvFileText(file, sourceType);

      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      if (sb) {
        try { await K.sbSyncLocalSession(); } catch {}
        if (state.session?.user?.role !== "admin") {
          throw new Error("관리자만 CSV 업로드가 가능합니다.");
        }

        const rawRows = mod.parseCsv(csvText);
        const preparedRows = [];
        for (const r of rawRows) {
          const m = mod.mapPropertyCsvRow(r, sourceType);
          if (!m || !m.itemNo || !m.address) continue;
          const built = mod.buildSupabasePropertyRow(r, m, sourceType);
          if (!built.global_id || built.global_id.endsWith(":")) continue;
          preparedRows.push(built);
        }

        if (!preparedRows.length) throw new Error("유효한 행이 없습니다.");

        const dedupedRows = mod.dedupePropertyRowsByGlobalId(preparedRows);
        const dedupedInFile = preparedRows.length - dedupedRows.length;
        const regContext = buildRegisterLogContext(`CSV 업로드(${sourceType === "auction" ? "경매" : sourceType === "onbid" ? "공매" : "중개"})`, state.session?.user);
        await ensureAuxiliaryPropertiesForAdmin();
        const workingByKey = new Map();
        getAuxiliaryPropertiesSnapshot().forEach((item) => {
          const key = buildRegistrationMatchKey(buildRegistrationSnapshotFromItem(item));
          if (key && !workingByKey.has(key)) workingByKey.set(key, item);
        });
        const finalRows = [];
        let regUpdatedCount = 0;
        for (const row of dedupedRows) {
          const snap = buildRegistrationSnapshotFromDbRow(row);
          const matchKey = buildRegistrationMatchKey(snap);
          const existing = matchKey ? workingByKey.get(matchKey) : null;
          if (existing) {
            const merged = buildRegistrationDbRowForExisting(existing, row, regContext);
            finalRows.push(merged.row);
            workingByKey.set(matchKey, normalizeProperty({ ...merged.row, raw: merged.row.raw }));
            if (merged.changes.length) regUpdatedCount += 1;
          } else {
            const created = buildRegistrationDbRowForCreate(row, regContext);
            finalRows.push(created);
            if (matchKey) workingByKey.set(matchKey, normalizeProperty({ ...created, raw: created.raw }));
          }
        }
        const importResult = await mod.upsertPropertiesResilient(sb, finalRows, { chunkSize: 200 });
        const summaryParts = [`업로드 완료`, `처리: ${importResult.okCount}건`];
        if (dedupedInFile > 0) summaryParts.push(`파일내 중복 통합: ${dedupedInFile}건`);
        if (regUpdatedCount > 0) summaryParts.push(`기존 물건 갱신(LOG): ${regUpdatedCount}건`);
        if (importResult.failed.length > 0) {
          summaryParts.push(`실패: ${importResult.failed.length}건`);
          const preview = importResult.failed.slice(0, 5).map((v) => v.itemNo || v.globalId || "-").join(", ");
          if (preview) summaryParts.push(`실패 예시: ${preview}`);
        }

        showResultBox(els.csvResultBox, summaryParts.join(" / "), importResult.failed.length > 0);
        invalidatePropertyCollections();
        await loadProperties();
        return;
      }

      const res = await api("/admin/import/properties-csv", {
        method: "POST",
        auth: true,
        body: { source: sourceType, sourceType, csvText, dedupeKey: "address" },
      });

      const summary = [`업로드 완료`, `삽입: ${res?.inserted ?? 0}건`, `중복 스킵: ${res?.duplicates ?? 0}건`, `오류: ${res?.errors ?? 0}건`].join(" / ");
      showResultBox(els.csvResultBox, summary);
      invalidatePropertyCollections();
      await loadProperties();
    } catch (err) {
      console.error(err);
      if (err?.code === "LOGIN_REQUIRED" || err?.status === 401) {
        setGlobalMsg("로그인이 필요합니다. 다시 로그인해 주세요.");
        goLoginPage(true);
      }
      showResultBox(els.csvResultBox, `업로드 실패: ${err.message}`, true);
    }
  };

  mod.mapPropertyCsvRow = function mapPropertyCsvRow(row, sourceType) {
    const { K, utils } = ctx();
    const { toNumber } = utils;
    const pick = (...keys) => {
      for (const k of keys) {
        if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
      }
      return "";
    };
    const toNum = (v) => {
      const n = toNumber(v);
      return Number.isFinite(n) ? n : 0;
    };
    const m2ToPyeong = (m2) => {
      const n = toNum(m2);
      return n ? (n / 3.305785) : 0;
    };
    const toISO = (v) => {
      if (K && typeof K.toISODate === "function") return K.toISODate(v);
      return null;
    };
    const parseAuctionAreas = (text) => {
      const src = String(text || "");
      const building = src.match(/건물[^0-9]*([0-9.,]+)\s*평/i);
      const site = src.match(/대지권[^0-9]*([0-9.,]+)\s*평/i);
      return {
        building: building ? toNum(building[1]) : null,
        site: site ? toNum(site[1]) : null,
      };
    };

    let itemNo = "";
    let address = "";
    let status = "";
    let priceMain = 0;
    let lowprice = null;
    let latitude = null;
    let longitude = null;
    let assetType = "";
    let floor = null;
    let totalfloor = null;
    let commonArea = null;
    let exclusiveArea = null;
    let siteArea = null;
    let useApproval = null;
    let dateMain = null;
    let sourceUrl = "";
    let memo = "";

    if (sourceType === "auction") {
      const caseNo = pick("사건번호", "caseNo", "");
      const propNo = pick("물건번호", "");
      if (caseNo && propNo) itemNo = propNo.includes(caseNo) ? propNo : `${caseNo}(${propNo})`;
      else itemNo = caseNo || propNo || pick("itemNo", "");
      address = pick("주소(시군구동)", "주소", "소재지", "address");
      status = pick("진행상태", "상태", "status");
      priceMain = toNum(pick("감정가", "감정가(원)", "priceMain"));
      lowprice = toNum(pick("최저가", "매각가", "lowprice")) || null;
      assetType = pick("종별", "부동산유형", "assetType");
      dateMain = toISO(pick("입찰일자", "입찰일", "dateMain")) || null;
      memo = pick("경매현황", "비고", "memo");
      const area = parseAuctionAreas(memo);
      exclusiveArea = area.building;
      siteArea = area.site;
    } else if (sourceType === "onbid") {
      itemNo = pick("물건관리번호", "itemNo", "물건번호");
      address = pick("소재지", "주소", "address", "물건명");
      status = pick("물건상태", "상태", "status");
      priceMain = toNum(pick("감정가(원)", "감정가", "priceMain"));
      lowprice = toNum(pick("최저입찰가(원)", "lowprice")) || null;
      assetType = pick("용도", "부동산유형", "assetType");
      dateMain = pick("입찰마감일시", "입찰마감", "dateMain") || null;
      memo = pick("비고", "특이사항", "메모", "memo");
      const bM2 = pick("건물 면적(㎡)", "건물 면적(m²)", "건물 면적(m2)", "건물면적(㎡)");
      const tM2 = pick("토지 면적(㎡)", "토지 면적(m²)", "토지 면적(m2)", "토지면적(㎡)");
      if (bM2) exclusiveArea = m2ToPyeong(bM2);
      if (tM2) siteArea = m2ToPyeong(tM2);
    } else {
      itemNo = pick("매물ID", "itemNo", "물건번호");
      address = pick("주소(통합)", "도로명주소", "지번주소", "주소", "address");
      status = pick("거래유형", "status");
      priceMain = toNum(pick("가격(표시)", "가격(원)", "가격(원본)", "매매가", "priceMain"));
      assetType = pick("세부유형", "부동산유형명", "부동산유형", "assetType");
      sourceUrl = pick("바로가기(엑셀)", "매물URL", "sourceUrl", "url");
      memo = pick("매물특징", "memo");
      floor = pick("해당층", "층수", "floor") || null;
      totalfloor = pick("총층", "전체층", "totalfloor") || null;
      const ex = pick("전용면적(평)", "전용면적", "exclusiveArea");
      const common = pick("공용면적(평)", "공급/계약면적(평)", "공급면적(평)", "commonArea");
      if (ex) exclusiveArea = toNum(ex);
      if (common) commonArea = toNum(common);
      const lat = pick("위도", "latitude", "lat");
      const lng = pick("경도", "longitude", "lng");
      latitude = lat ? Number(lat) : null;
      longitude = lng ? Number(lng) : null;
      useApproval = toISO(pick("사용승인일", "useApproval")) || null;
    }

    if (!address && !itemNo) return null;
    return { itemNo, address, status, priceMain, latitude: Number.isFinite(latitude) ? latitude : null, longitude: Number.isFinite(longitude) ? longitude : null, assetType, commonArea, exclusiveArea, siteArea, useApproval, dateMain, sourceUrl, memo, lowprice, floor, totalfloor };
  };

  mod.buildSupabasePropertyRow = function buildSupabasePropertyRow(rawRow, m, sourceType) {
    const globalId = `${sourceType}:${m.itemNo}`;
    const toNullNum = (v) => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const importedSourceLabel = sourceType === "auction"
      ? "경매현황"
      : (sourceType === "realtor" ? "매물특징" : "");
    const normalizedRaw = {
      ...(rawRow || {}),
      itemNo: String(m.itemNo || ""),
      address: String(m.address || ""),
      assetType: m.assetType || null,
      floor: m.floor || null,
      totalfloor: m.totalfloor || null,
      commonArea: toNullNum(m.commonArea),
      exclusiveArea: toNullNum(m.exclusiveArea),
      siteArea: toNullNum(m.siteArea),
      useapproval: m.useApproval || null,
      dateMain: m.dateMain || null,
      sourceUrl: m.sourceUrl || null,
      memo: m.memo || null,
      importedSourceLabel: importedSourceLabel || null,
      importedSourceText: m.memo || null,
      sourceNoteLabel: importedSourceLabel || null,
      sourceNoteText: m.memo || null,
      lowprice: toNullNum(m.lowprice),
      latitude: toNullNum(m.latitude),
      longitude: toNullNum(m.longitude),
      sourceType,
    };
    const source = sourceType === "onbid" ? "gongmae" : (sourceType === "realtor" ? "general" : sourceType);
    return {
      global_id: globalId,
      item_no: String(m.itemNo || ""),
      source,
      source_type: sourceType,
      address: m.address || null,
      status: m.status || null,
      price_main: toNullNum(m.priceMain),
      lowprice: toNullNum(m.lowprice),
      latitude: toNullNum(m.latitude),
      longitude: toNullNum(m.longitude),
      raw: normalizedRaw,
    };
  };

  mod.dedupePropertyRowsByGlobalId = function dedupePropertyRowsByGlobalId(rows) {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = String(row?.global_id || "").trim();
      if (!key) continue;
      map.set(key, row);
    }
    return [...map.values()];
  };

  mod.upsertPropertiesResilient = async function upsertPropertiesResilient(sb, rows, { chunkSize = 200 } = {}) {
    if (DataAccess && typeof DataAccess.upsertPropertiesResilient === "function") {
      return DataAccess.upsertPropertiesResilient(sb, rows, { chunkSize, onConflict: "global_id" });
    }
    throw new Error("KNSN_DATA_ACCESS.upsertPropertiesResilient 를 찾을 수 없습니다.");
  };

  mod.readCsvFileText = function readCsvFileText(file, sourceType) {
    return file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
      }
      const preferred = sourceType === "realtor" ? "utf-8" : "euc-kr";
      try {
        const decoded = new TextDecoder(preferred, { fatal: true }).decode(bytes);
        return decoded.replace(/^\uFEFF/, "");
      } catch (_) {
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
        } catch (_2) {
          return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
        }
      }
    });
  };

  mod.parseCsv = function parseCsv(text) {
    const rows = [];
    let i = 0;
    let field = "";
    let row = [];
    let inQuotes = false;

    const pushField = () => {
      row.push(field);
      field = "";
    };
    const pushRow = () => {
      if (row.length === 1 && row[0] === "" && rows.length === 0) {
        row = [];
        return;
      }
      rows.push(row);
      row = [];
    };

    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i++;
            continue;
          }
        } else {
          field += ch;
          i++;
          continue;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
          continue;
        }
        if (ch === ",") {
          pushField();
          i++;
          continue;
        }
        if (ch === "\n") {
          pushField();
          pushRow();
          i++;
          continue;
        }
        if (ch === "\r") {
          i++;
          continue;
        }
        field += ch;
        i++;
      }
    }

    pushField();
    if (row.length) pushRow();
    if (!rows.length) return [];
    const headers = rows[0].map((h) => String(h || "").trim());
    return rows.slice(1)
      .filter((r) => r.some((v) => String(v || "").trim() !== ""))
      .map((r) => {
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
        return obj;
      });
  };

  AdminModules.csvTab = mod;
})();
