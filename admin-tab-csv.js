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

  function normalizeCompactText(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function normalizeFloorDigits(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "";
    const trimmed = digits.replace(/^0+/, "") || "0";
    if (trimmed === "0") return "1";
    if (trimmed.length <= 2) return String(Number(trimmed));
    return trimmed.slice(0, -2).replace(/^0+/, "") || "1";
  }

  function extractGroundFloorFromRoom(text) {
    const raw = String(text || "");
    // 1차: 원본 공백/구분자 보존 상태에서 호수 패턴 매칭 (정확도 우선)
    //     경계 문자: 공백, 탭, 또는 "제"
    const rawMatch = raw.match(/(?:^|[\s,(]|제)(\d{3,5})호(?:$|[^0-9])/u);
    if (rawMatch) return normalizeFloorDigits(rawMatch[1]);

    // 2차: 공백 제거 후 fallback — 단 하이픈/마이너스 직후의 숫자는 지번의 일부이므로 제외
    const src = normalizeCompactText(raw);
    if (!src) return "";
    // 앞 경계가 숫자/영문/한글/하이픈이 아닌 경우에만 매칭 (하이픈 뒤 붙은 지번 배제)
    const match = src.match(/(?:^|[^0-9A-Za-z가-힣\-])(\d{3,5})호(?:$|[^0-9])/u)
      || src.match(/제(\d{3,5})호/u);
    if (!match) return "";
    return normalizeFloorDigits(match[1]);
  }

  function extractBasementFloorFromRoom(text) {
    const raw = String(text || "");
    // 1차: 원본 보존 상태에서 매칭
    const rawMatch = raw.match(/(?:^|[\s,(]|제)(?:[Bb]|비)(\d{1,5})호?(?:$|[^0-9])/u);
    if (rawMatch) {
      const floorDigits = normalizeFloorDigits(rawMatch[1]);
      return floorDigits ? `B${floorDigits}` : "";
    }
    // 2차: 공백 제거 fallback
    const src = normalizeCompactText(raw);
    if (!src) return "";
    const match = src.match(/(?:제)?[Bb](\d{1,5})호?/u)
      || src.match(/(?:제)?비(\d{1,5})호?/u);
    if (!match) return "";
    const floorDigits = normalizeFloorDigits(match[1]);
    return floorDigits ? `B${floorDigits}` : "";
  }

  function extractFloorLabelFromTexts(...texts) {
    const candidates = texts
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    for (const text of candidates) {
      const compact = normalizeCompactText(text);
      if (!compact) continue;

      if (/지하층제?\d+호/u.test(compact) || /지하층\d+호/u.test(compact)) {
        return "B1";
      }

      let match = compact.match(/(?:제)?지하(\d+)층/u)
        || compact.match(/(?:제)?지(\d+)층/u)
        || compact.match(/지층(\d+)/u)
        || compact.match(/(?:^|[^가-힣A-Za-z0-9])지(\d+)(?:$|[^0-9])/u);
      if (match) return `B${Number(match[1])}`;

      // 호수 기반 추출은 원본(공백 보존) 텍스트 사용 — 지번과 호수 경계 감지를 위해
      const basementRoomFloor = extractBasementFloorFromRoom(text);
      if (basementRoomFloor) return basementRoomFloor;
    }

    for (const text of candidates) {
      const compact = normalizeCompactText(text);
      if (!compact) continue;

      let match = compact.match(/제(\d+)층/u)
        || compact.match(/지상(\d+)층/u)
        || compact.match(/(\d+)층/u);
      if (match) return String(Number(match[1]));

      // 호수 기반 추출은 원본(공백 보존) 텍스트 사용 — 지번과 호수 경계 감지를 위해
      const roomFloor = extractGroundFloorFromRoom(text);
      if (roomFloor) return roomFloor;
    }

    return "전체";
  }


  const CSV_IMPORT_ALLOWED_COLUMNS = new Set([
    "global_id",
    "item_no",
    "source",
    "source_type",
    "is_general",
    "submitter_type",
    "submitter_name",
    "submitter_phone",
    "broker_office_name",
    "assignee_id",
    "assignee_name",
    "address",
    "asset_type",
    "floor",
    "total_floor",
    "common_area",
    "exclusive_area",
    "site_area",
    "use_approval",
    "status",
    "price_main",
    "lowprice",
    "date_main",
    "source_url",
    "memo",
    "latitude",
    "longitude",
    "raw",
  ]);

  function sanitizePropertyImportRow(row) {
    const src = row && typeof row === "object" ? row : {};
    const clean = {};
    CSV_IMPORT_ALLOWED_COLUMNS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(src, key)) clean[key] = src[key];
    });
    if (!Object.prototype.hasOwnProperty.call(clean, "raw") || !clean.raw || typeof clean.raw !== "object") {
      clean.raw = {};
    }
    return clean;
  }


  function pushImportOutcomeEntry(entries, row, meta = {}) {
    const safeRow = sanitizePropertyImportRow(row);
    const safeMeta = meta && typeof meta === "object" ? meta : {};
    entries.push({
      row: safeRow,
      action: String(safeMeta.action || "").trim() || "create",
      incomingItemNo: String(safeMeta.incomingItemNo || safeRow.item_no || "").trim(),
      incomingGlobalId: String(safeMeta.incomingGlobalId || safeRow.global_id || "").trim(),
      matchKey: String(safeMeta.matchKey || "").trim(),
      changedFieldCount: Number(safeMeta.changedFieldCount || 0) || 0,
    });
  }

  function collapseImportOutcomeEntries(entries) {
    const orderedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const byGlobalId = new Map();
    for (const entry of orderedEntries) {
      const key = String(entry?.row?.global_id || "").trim();
      if (!key) continue;
      const existing = byGlobalId.get(key);
      if (existing) {
        existing.row = entry.row;
        existing.lastAction = entry.action;
        existing.matchKey = entry.matchKey || existing.matchKey || "";
        existing.changedFieldCount = Math.max(existing.changedFieldCount || 0, Number(entry.changedFieldCount || 0) || 0);
        existing.actions.add(entry.action);
        if (entry.incomingItemNo) existing.incomingItemNos.add(entry.incomingItemNo);
        if (entry.incomingGlobalId) existing.incomingGlobalIds.add(entry.incomingGlobalId);
        existing.entryCount += 1;
      } else {
        byGlobalId.set(key, {
          row: entry.row,
          globalId: key,
          lastAction: entry.action,
          matchKey: entry.matchKey || "",
          changedFieldCount: Number(entry.changedFieldCount || 0) || 0,
          actions: new Set([entry.action]),
          incomingItemNos: new Set(entry.incomingItemNo ? [entry.incomingItemNo] : []),
          incomingGlobalIds: new Set(entry.incomingGlobalId ? [entry.incomingGlobalId] : []),
          entryCount: 1,
        });
      }
    }

    const groups = [...byGlobalId.values()];
    const outcomeCounts = { create: 0, update: 0, noChange: 0 };
    for (const group of groups) {
      if (group.actions.has("create")) outcomeCounts.create += 1;
      else if (group.actions.has("update")) outcomeCounts.update += 1;
      else outcomeCounts.noChange += 1;
    }
    const duplicateCollapsedCount = Math.max(0, orderedEntries.length - groups.length);
    return { groups, outcomeCounts, duplicateCollapsedCount };
  }

  function formatImportFailurePreview(failedList, limit = 5) {
    const list = Array.isArray(failedList) ? failedList.slice(0, limit) : [];
    return list.map((item) => {
      const label = String(item?.itemNo || item?.globalId || "-").trim() || "-";
      const message = String(item?.message || "").trim();
      if (!message) return label;
      const compact = message.replace(/\s+/g, " ").trim();
      return `${label} (${compact.length > 60 ? `${compact.slice(0, 60)}…` : compact})`;
    }).join(", ");
  }

  function extractTotalFloorFromTexts(...texts) {
    const candidates = texts
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    for (const text of candidates) {
      const compact = normalizeCompactText(text);
      if (!compact) continue;
      const match = compact.match(/(?:슬래브|스라브|평슬래브|지붕|건물|판매시설및업무시설|판매시설및근린생활시설|점포및사무실|근린생활시설|업무시설)(\d+)층/u)
        || compact.match(/(\d+)층건물/u)
        || compact.match(/(?:철근콘크리트조|콘크리트조|벽돌조|철골조)(\d+)층/u);
      if (match) return String(Number(match[1]));
    }
    return null;
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
      setAdminLoading,
    } = utils;
    try {
      const file = els.csvFileInput.files?.[0];
      if (!file) return alert("CSV 파일을 선택해 주세요.");
      setAdminLoading("csvUpload", true, "CSV 업로드 중입니다...");

      const sourceType = String(els.csvImportSource.value || "auction");
      const csvText = await mod.readCsvFileText(file, sourceType);

      // ── 임대시세 CSV 분기 ──
      if (sourceType === "rental") {
        const rawRows = mod.parseCsv(csvText);
        if (!rawRows.length) throw new Error("유효한 행이 없습니다.");

        // 주소에서 시군구 코드 추출 시도 (첫 행 기준)
        const firstAddr = String(rawRows[0]?.["주소(통합)"] || rawRows[0]?.address || "").trim();
        const sigunguCode = mod.inferSigunguCode ? mod.inferSigunguCode(firstAddr) : "";

        const res = await api("/admin/valuation/rental-data", {
          method: "POST",
          auth: true,
          body: { action: "upload-csv", csvRows: rawRows, sigunguCode },
        });

        const parts = [
          "임대시세 업로드 완료",
          `전체: ${res?.total ?? 0}건`,
          `유효: ${res?.valid ?? 0}건`,
          `삽입: ${res?.inserted ?? 0}건`,
        ];
        if (res?.errors > 0) parts.push(`오류: ${res.errors}건`);
        if (res?.firstError) parts.push(`사유: ${res.firstError}`);
        showResultBox(els.csvResultBox, parts.join(" / "), (res?.errors > 0));
        return;
      }

      // ── 기존 매물 CSV (auction / onbid / realtor) ──
      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      if (sb) {
        try { await K.sbSyncLocalSession(); } catch {}
        if (state.session?.user?.role !== "admin") {
          throw new Error("관리자만 CSV 업로드가 가능합니다.");
        }

        const rawRows = mod.parseCsv(csvText);
        // 1패스: 각 행을 mapPropertyCsvRow 로 파싱
        const mappedRows = [];  // [{raw, m}]
        for (const r of rawRows) {
          const m = mod.mapPropertyCsvRow(r, sourceType);
          if (!m || !m.itemNo || !m.address) continue;
          mappedRows.push({ raw: r, m });
        }

        // 경매 전용: CSV 전체에서 같은 사건번호의 행 개수 집계.
        // 빈도 2+ 인 사건만 itemNo 에 "(물건번호)" 붙여서 구분, 1건이면 사건번호 단독.
        if (sourceType === "auction") {
          const caseNoCount = new Map();
          for (const { m } of mappedRows) {
            const cn = String(m.auctionCaseNo || "").trim();
            if (!cn) continue;
            caseNoCount.set(cn, (caseNoCount.get(cn) || 0) + 1);
          }
          for (const { m } of mappedRows) {
            const cn = String(m.auctionCaseNo || "").trim();
            const pn = String(m.auctionPropNo || "").trim();
            if (cn && pn && (caseNoCount.get(cn) || 0) >= 2) {
              // 이미 물건번호가 사건번호를 포함하는 형식이면 그대로 사용
              m.itemNo = pn.includes(cn) ? pn : `${cn}(${pn})`;
            }
            // else: caseNo 단독 유지 (mapPropertyCsvRow 에서 이미 설정됨)
          }
        }

        // 2패스: 빌드 (itemNo 확정된 뒤여야 global_id 생성이 정확함)
        const preparedRows = [];
        for (const { raw, m } of mappedRows) {
          const built = mod.buildSupabasePropertyRow(raw, m, sourceType);
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
        const outcomeEntries = [];
        for (const row of dedupedRows) {
          const snap = buildRegistrationSnapshotFromDbRow(row);
          const matchKey = buildRegistrationMatchKey(snap);
          const existing = matchKey ? workingByKey.get(matchKey) : null;
          if (existing) {
            const merged = buildRegistrationDbRowForExisting(existing, row, regContext);
            pushImportOutcomeEntry(outcomeEntries, merged.row, {
              action: merged.changes.length ? "update" : "no_change",
              incomingItemNo: row.item_no || row.raw?.itemNo || "",
              incomingGlobalId: row.global_id || "",
              matchKey,
              changedFieldCount: merged.changes.length,
            });
            workingByKey.set(matchKey, normalizeProperty({ ...merged.row, raw: merged.row.raw }));
          } else {
            const created = buildRegistrationDbRowForCreate(row, regContext);
            pushImportOutcomeEntry(outcomeEntries, created, {
              action: "create",
              incomingItemNo: row.item_no || row.raw?.itemNo || "",
              incomingGlobalId: row.global_id || "",
              matchKey,
            });
            if (matchKey) workingByKey.set(matchKey, normalizeProperty({ ...created, raw: created.raw }));
          }
        }

        const collapsed = collapseImportOutcomeEntries(outcomeEntries);
        const finalRows = collapsed.groups.map((group) => group.row);
        const importResult = await mod.upsertPropertiesResilient(sb, finalRows, { chunkSize: 200 });
        const summaryParts = ["업로드 완료", `처리: ${importResult.okCount}건`];
        if (collapsed.outcomeCounts.create > 0) summaryParts.push(`신규 등록: ${collapsed.outcomeCounts.create}건`);
        if (collapsed.outcomeCounts.update > 0) summaryParts.push(`기존 물건 갱신(LOG): ${collapsed.outcomeCounts.update}건`);
        if (collapsed.outcomeCounts.noChange > 0) summaryParts.push(`기존 물건 일치(변경없음): ${collapsed.outcomeCounts.noChange}건`);
        if (dedupedInFile > 0) summaryParts.push(`파일내 중복 통합: ${dedupedInFile}건`);
        if (collapsed.duplicateCollapsedCount > 0) summaryParts.push(`병합 후 중복 제외: ${collapsed.duplicateCollapsedCount}건`);
        if (importResult.failed.length > 0) {
          summaryParts.push(`실제 실패: ${importResult.failed.length}건`);
          const preview = formatImportFailurePreview(importResult.failed, 5);
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
    } finally {
      setAdminLoading("csvUpload", false);
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
    // [신규] 법원+계 정규화 — SQL migration 의 normalize_court_dept 와 동일 로직.
    // 탱크옥션 API 의 crtDpt 포맷 (예: "서울중앙8계") 과 매칭하기 위함.
    //   "서울중앙지방법원" + "경매8계" → "서울중앙8계"
    //   "수원지방법원"     + "3계"     → "수원3계"
    //   "평택지원"         + "경매5계" → "평택지원5계"
    const normalizeCourtDept = (court, division) => {
      const c = String(court == null ? '' : court).trim();
      if (!c) return null;
      let base = c.replace(/지방법원$/, '').replace(/법원$/, '').trim();
      if (!base) return null;
      const d = String(division == null ? '' : division).trim();
      if (!d) return base;
      const div = d.replace(/^경매\s*/, '').replace(/\s+/g, '');
      if (!div) return base;
      return base + div;
    };
    const toISO = (v) => {
      if (K && typeof K.toISODate === "function") return K.toISODate(v);
      return null;
    };
    const parseAuctionAreas = (text) => {
      const src = String(text || "");
      // [수정 내역] 경매 CSV 의 경매현황(=text) 텍스트 파싱 로직 전면 개편.
      // 기존 문제: 같은 경매현황 문자열이라도 "건물" 키워드 위치·정규식 상태에 따라
      // 파싱이 불안정했고, 실패 시 호출부에서 CSV 면적(㎡) 을 평으로 환산하는
      // fallback 이 일어나 집합건물(호별 경매) 에 엉뚱한 큰 값이 저장되는 버그
      // (예: 47.18㎡(14.27평) 짜리 집합건물에 1007.93평 저장) 가 있었다.
      //
      // 새 분기:
      //   1) 집합건물 → 경매현황의 첫 (X평) 값을 반드시 사용. 없으면 ㎡→평 환산.
      //                CSV 면적(㎡) fallback 금지 (호출부에서 isAggregateBuilding 플래그
      //                기반으로 막는다).
      //   2) 다층 일반 건물 → CSV 면적(㎡) 을 평으로 환산 (호출부에서 isMultiFloor
      //                      플래그 기반으로 분기).
      //   3) 단층 일반 건물 → 기존과 유사 (경매현황의 건물 섹션 첫 평 값).
      //   4) 토지만 → building=null, site=값. 호출부에서 종별과 조합해 skip 판정.
      //
      // 반환 추가 필드: isAggregateBuilding / isMultiFloor / hasBuilding / hasLand.

      // 집합건물 / 건물 / 대지권 / 토지 단서 위치 탐지
      const aggregateMatch = src.match(/집합\s*건물/);
      const isAggregateBuilding = !!aggregateMatch;
      const buildingIdx = (() => {
        if (aggregateMatch) return aggregateMatch.index + aggregateMatch[0].length;
        const m = src.match(/건물/);
        return m ? m.index + m[0].length : -1;
      })();
      const siteIdx = (() => {
        const m = src.match(/(?:대지권|대\s*지\s*권|토지)/);
        return m ? m.index + m[0].length : -1;
      })();
      const hasBuilding = buildingIdx >= 0;
      const hasLand = siteIdx >= 0;

      // 다층 판정: "1층/2층/지층/옥탑 ... (X평)" 같은 층별 평수 패턴이 2개 이상
      //   예: "1층 563.13㎡(170.35평)\n2층 378.87㎡(114.61평)" → 다층.
      //       "21.3㎡(6.44평)" 단일 패턴 → 단층.
      const floorPyeongPattern = /(?:\d+\s*층|지하\s*\d*\s*층|지\s*층|옥\s*탑|옥탑)[^\r\n(]*\([0-9]+(?:[.,][0-9]+)?\s*평\)/g;
      const floorPyeongCount = (src.match(floorPyeongPattern) || []).length;
      const isMultiFloor = floorPyeongCount >= 2;

      const toP = (v) => {
        const n = toNum(v);
        return Number.isFinite(n) ? n : null;
      };
      const m2ToP = (m2) => {
        const n = toNum(m2);
        return Number.isFinite(n) ? Number((n * 0.3025).toFixed(2)) : null;
      };

      // 숫자+평 / 숫자+㎡ 매칭을 position 과 함께 모두 수집
      const pyeongMatches = [];
      const sqmMatches = [];
      const pyeongRe = /([0-9]+(?:[.,][0-9]+)?)\s*평/g;
      const sqmRe = /([0-9]+(?:[.,][0-9]+)?)\s*(?:㎡|m²|m2)/g;
      let mm;
      while ((mm = pyeongRe.exec(src)) !== null) pyeongMatches.push({ idx: mm.index, value: toP(mm[1]) });
      while ((mm = sqmRe.exec(src)) !== null)    sqmMatches.push({ idx: mm.index, value: toP(mm[1]) });

      // 섹션 경계 계산
      const hasBoth = buildingIdx >= 0 && siteIdx >= 0;
      const buildingEnd = hasBoth ? (siteIdx > buildingIdx ? siteIdx : -1) : -1;
      const siteEnd = hasBoth ? (buildingIdx > siteIdx ? buildingIdx : -1) : -1;

      const pickFirstInRange = (startIdx, endIdx, arr) => {
        if (startIdx < 0) return null;
        const inRange = arr.filter((x) => x.idx >= startIdx && (endIdx < 0 || x.idx < endIdx));
        return inRange.length ? inRange[0].value : null;
      };

      // 건물 섹션: 평 > ㎡→평 순으로 우선. 집합건물인 경우도 동일 로직이나
      // 호출부에서 CSV 면적(㎡) fallback 금지로 작동.
      let building = null;
      if (buildingIdx >= 0) {
        building = pickFirstInRange(buildingIdx, buildingEnd, pyeongMatches);
        if (building == null) {
          const m2 = pickFirstInRange(buildingIdx, buildingEnd, sqmMatches);
          if (m2 != null) building = Number((m2 * 0.3025).toFixed(2));
        }
      } else if (siteIdx < 0) {
        // 건물/토지 단서 모두 없음 → 전체 첫 평/㎡ 값 fallback
        if (pyeongMatches.length) building = pyeongMatches[0].value;
        else if (sqmMatches.length) building = Number((sqmMatches[0].value * 0.3025).toFixed(2));
      }

      // 토지 섹션
      let site = null;
      if (siteIdx >= 0) {
        site = pickFirstInRange(siteIdx, siteEnd, pyeongMatches);
        if (site == null) {
          const m2 = pickFirstInRange(siteIdx, siteEnd, sqmMatches);
          if (m2 != null) site = Number((m2 * 0.3025).toFixed(2));
        }
      }

      return {
        building: Number.isFinite(building) ? Number(Number(building).toFixed(2)) : null,
        site: Number.isFinite(site) ? Number(Number(site).toFixed(2)) : null,
        isAggregateBuilding,
        isMultiFloor,
        hasBuilding,
        hasLand,
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
    let realtorName = "";
    let realtorPhone = "";
    let realtorCell = "";
    let auctionCaseNo = "";  // 경매 사건번호 원본 (상위 루프에서 빈도 집계용)
    let auctionPropNo = "";  // 경매 물건번호 원본
    let courtDept = null;    // [신규] 법원+계 정규화 값 (예: "서울중앙8계")

    if (sourceType === "auction") {
      const caseNo = pick("사건번호", "caseNo", "");
      const propNo = pick("물건번호", "");
      const buildingDetail = pick("건물상세", "물건명", "건물명", "상세");
      const auctionStatusText = pick("경매현황", "비고", "memo");
      // 원본 보관 (상위 루프에서 사건번호 빈도 파악 후 itemNo 확정)
      auctionCaseNo = String(caseNo || "").trim();
      auctionPropNo = String(propNo || "").trim();
      // itemNo 초기값: caseNo 단독 (상위 루프에서 빈도 2+ 면 `(propNo)` 추가)
      if (caseNo) {
        itemNo = caseNo;
      } else {
        itemNo = propNo || pick("itemNo", "");
      }
      address = pick("주소(시군구동)", "주소", "소재지", "address");
      status = pick("진행상태", "상태", "status");
      priceMain = toNum(pick("감정가", "감정가(원)", "priceMain"));
      const salePrice = toNum(pick("매각가", "salePrice"));
      const lowestPrice = toNum(pick("최저가", "lowprice"));
      lowprice = salePrice || lowestPrice || null;
      assetType = pick("종별", "부동산유형", "assetType");
      dateMain = toISO(pick("입찰일자", "입찰일", "dateMain")) || null;
      // [신규] 법원+계 정규화 — 같은 사건번호 중복 시 지역 구분 키
      const csvCourt = pick("담당법원", "court");
      const csvDivision = pick("담당계", "division");
      courtDept = normalizeCourtDept(csvCourt, csvDivision);
      memo = [auctionStatusText, pick("비고", "memo"), csvCourt, csvDivision]
        .filter(Boolean)
        .join(" / ");
      const area = parseAuctionAreas(auctionStatusText);
      // [수정 내역] exclusive_area 결정 로직 분기 재작성.
      //   1) 집합건물 → 경매현황의 (X평) 값만 사용. CSV 면적(㎡) fallback 금지
      //      (버그 재발 방지: 3332㎡ → 1007.93평 같은 대규모 건물 전체 면적이
      //      호별 경매 exclusive_area 로 저장되는 현상).
      //   2) 다층 일반 건물 → CSV "면적(㎡)" 컬럼을 평으로 환산.
      //      경매현황에 층별로 여러 (X평) 이 있어 첫 값만 쓰면 부정확하기 때문.
      //   3) 단층 일반 건물 → area.building 값 (경매현황 내 (X평)).
      //      아예 파싱 실패 시에만 CSV 면적(㎡) fallback 허용.
      const csvAreaM2 = pick("면적(㎡)");
      if (area.isAggregateBuilding) {
        exclusiveArea = area.building; // null 이어도 fallback 금지
      } else if (area.isMultiFloor) {
        exclusiveArea = csvAreaM2 ? m2ToPyeong(csvAreaM2) : (area.building || null);
      } else {
        exclusiveArea = area.building || (csvAreaM2 ? m2ToPyeong(csvAreaM2) : null);
      }
      siteArea = area.site;

      // [수정 내역] 토지만 있는 경매 + 종별이 건물류(상가/오피스텔/근린시설 등) →
      // 업로드 대상에서 제외. 종별이 토지류(토지/대지/전/답/잡종지 등) 인 경우는
      // 그대로 업로드(토지 평수 = siteArea 는 이미 세팅됨). 종별 토큰 파싱은
      // "상가,오피스텔,근린시설" 같은 쉼표 구분 원본을 split 해서 판정.
      const isLandOnly = !area.hasBuilding && area.hasLand;
      if (isLandOnly) {
        const assetTokens = String(assetType || "").split(/[,\/\s]+/).map((s) => s.trim()).filter(Boolean);
        const LAND_TYPES = new Set(["토지", "대지", "전", "답", "임야", "잡종지", "과수원", "목장", "농지"]);
        const BUILDING_TYPES = new Set([
          "상가", "오피스텔", "근린시설", "근린", "아파트", "빌라", "주택", "연립",
          "다세대", "다가구", "사무실", "사무소", "공장", "창고", "기숙사"
        ]);
        const hasLandToken = assetTokens.some((t) => LAND_TYPES.has(t));
        const hasBuildingToken = assetTokens.some((t) => BUILDING_TYPES.has(t));
        if (hasBuildingToken && !hasLandToken) return null;
      }
      floor = extractFloorLabelFromTexts(buildingDetail, address, auctionStatusText);
      totalfloor = extractTotalFloorFromTexts(auctionStatusText);
    } else if (sourceType === "onbid") {
      const itemName = pick("물건명", "재산명", "물건상세", "건물상세");
      const detailText = pick("상세설명", "물건상세", "건물상세", "비고", "특이사항", "메모", "memo");
      itemNo = pick("물건관리번호", "itemNo", "물건번호");
      address = pick("소재지", "주소", "address", "물건명");
      status = pick("물건상태", "상태", "status");
      priceMain = toNum(pick("감정가(원)", "감정가", "priceMain"));
      // #5 최저입찰가 → 현재가격(lowprice)
      lowprice = toNum(pick("최저입찰가(원)", "최저입찰가", "최저가", "lowprice")) || null;
      // #4 종별 → 유형(assetType)
      assetType = pick("종별", "용도", "부동산유형", "assetType");
      // #3 입찰기간(년월일만, 시간 제외) → 주요일정(dateMain)
      const bidPeriodRaw = pick("입찰기간", "입찰마감일시", "입찰마감", "dateMain");
      // 구간 구분자: ~, 전각 대시(–,—), " - "(공백+하이픈+공백). 단독 "-"는 날짜 내부(2026-05-12)에 쓰이므로 제외.
      const bidPeriodFirst = String(bidPeriodRaw || "").split(/\s*~\s*|\s+[\u2013\u2014]\s+|\s+-\s+/)[0].trim();
      const bidDateOnly = bidPeriodFirst.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/);
      const bidPeriodDatePart = bidDateOnly ? bidDateOnly[0] : bidPeriodFirst.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, "").trim();
      dateMain = toISO(bidPeriodDatePart) || bidPeriodDatePart || null;
      memo = detailText;
      // #2 면적 — 기존 분할 컬럼 우선, 없으면 단일 "면적" 컬럼에서 건물/토지 분리
      let bM2 = pick("건물 면적(㎡)", "건물 면적(m²)", "건물 면적(m2)", "건물면적(㎡)", "건물면적");
      let tM2 = pick("토지 면적(㎡)", "토지 면적(m²)", "토지 면적(m2)", "토지면적(㎡)", "토지면적");
      if (!bM2 || !tM2) {
        const areaText = pick("면적", "면적(㎡)", "면적(m²)", "면적(m2)");
        if (areaText) {
          // "토지 123.45㎡" / "건물 67.89㎡" 패턴 매칭
          const tMatch = areaText.match(/토지\s*([0-9.,]+)\s*(?:㎡|m²|m2|제곱미터)?/i);
          const bMatch = areaText.match(/건물\s*([0-9.,]+)\s*(?:㎡|m²|m2|제곱미터)?/i);
          if (!tM2 && tMatch) tM2 = tMatch[1];
          if (!bM2 && bMatch) bM2 = bMatch[1];
        }
      }
      if (bM2) exclusiveArea = m2ToPyeong(bM2);
      if (tM2) siteArea = m2ToPyeong(tM2);
      floor = extractFloorLabelFromTexts(itemName, detailText, address, memo);
      totalfloor = extractTotalFloorFromTexts(detailText, memo);
    } else {
      itemNo = pick("매물ID", "itemNo", "물건번호");
      address = pick("주소(통합)", "도로명주소", "지번주소", "주소", "address");
      status = pick("거래유형", "status");
      priceMain = toNum(pick("가격(표시)", "가격(원)", "가격(원본)", "매매가", "priceMain"));
      assetType = pick("세부유형", "부동산유형명", "부동산유형", "assetType");
      sourceUrl = pick("바로가기(엑셀)", "매물URL", "sourceUrl", "url");
      memo = pick("매물특징", "memo");
      realtorName = pick("중개사무소명", "중개업소명", "부동산", "중개사무소", "중개업소", "사무소명", "업체명");
      realtorPhone = pick("유선전화", "중개사 유선전화", "대표전화", "전화번호", "업소전화", "중개사무소전화", "연락처");
      realtorCell = pick("휴대폰번호", "중개사 휴대폰", "휴대폰", "핸드폰", "휴대전화", "중개사휴대폰", "중개사 휴대폰번호");
      floor = pick("해당층", "층수", "floor") || extractFloorLabelFromTexts(pick("매물명", "제목", "itemName"), address, memo);
      totalfloor = pick("총층", "전체층", "totalfloor") || extractTotalFloorFromTexts(memo) || null;
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
    return { itemNo, address, status, priceMain, latitude: Number.isFinite(latitude) ? latitude : null, longitude: Number.isFinite(longitude) ? longitude : null, assetType, commonArea, exclusiveArea, siteArea, useApproval, dateMain, sourceUrl, memo, lowprice, floor, totalfloor, realtorName, realtorPhone, realtorCell, auctionCaseNo, auctionPropNo, courtDept };
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
      realtorName: m.realtorName || null,
      realtorPhone: m.realtorPhone || null,
      realtorCell: m.realtorCell || null,
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
      asset_type: m.assetType || null,
      floor: m.floor || null,
      total_floor: m.totalfloor || null,
      common_area: toNullNum(m.commonArea),
      exclusive_area: toNullNum(m.exclusiveArea),
      site_area: toNullNum(m.siteArea),
      use_approval: m.useApproval || null,
      status: m.status || null,
      price_main: toNullNum(m.priceMain),
      lowprice: toNullNum(m.lowprice),
      date_main: m.dateMain || null,
      source_url: m.sourceUrl || null,
      broker_office_name: m.realtorName || null,
      submitter_phone: m.realtorCell || m.realtorPhone || null,
      memo: m.memo || null,
      latitude: toNullNum(m.latitude),
      longitude: toNullNum(m.longitude),
      court_dept: m.courtDept || null,
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
      return DataAccess.upsertPropertiesResilient(sb, (Array.isArray(rows) ? rows : []).map(sanitizePropertyImportRow), { chunkSize, onConflict: "global_id" });
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

  mod.inferSigunguCode = function inferSigunguCode(address) {
    const a = String(address || "").replace(/\s+/g, " ").trim();
    if (!a) return "";
    // 주요 시군구 코드 매핑 (서울/경기/인천 위주)
    const map = [
      [/강남구/, "11680"], [/서초구/, "11650"], [/송파구/, "11710"], [/강동구/, "11740"],
      [/마포구/, "11440"], [/영등포구/, "11560"], [/용산구/, "11170"], [/성동구/, "11200"],
      [/광진구/, "11215"], [/동대문구/, "11230"], [/중랑구/, "11260"], [/성북구/, "11290"],
      [/강북구/, "11305"], [/도봉구/, "11320"], [/노원구/, "11350"], [/은평구/, "11380"],
      [/서대문구/, "11410"], [/종로구/, "11110"], [/중구/, "11140"], [/동작구/, "11590"],
      [/관악구/, "11620"], [/금천구/, "11545"], [/구로구/, "11530"], [/양천구/, "11470"],
      [/강서구/, "11500"], [/종로구/, "11110"],
      [/분당구/, "41135"], [/수정구/, "41131"], [/중원구/, "41133"],
      [/수원시/, "41110"], [/용인시/, "41460"], [/고양시/, "41280"],
      [/성남시/, "41130"], [/화성시/, "41590"], [/안양시/, "41170"],
      [/부천시/, "41190"], [/안산시/, "41270"], [/남양주시/, "41360"],
      [/의정부시/, "41150"], [/시흥시/, "41390"], [/파주시/, "41480"],
      [/김포시/, "41570"], [/광명시/, "41210"], [/하남시/, "41450"],
      [/군포시/, "41410"], [/오산시/, "41370"], [/이천시/, "41500"],
      [/인천.*남동구/, "28200"], [/인천.*부평구/, "28237"], [/인천.*연수구/, "28185"],
    ];
    for (const [re, code] of map) {
      if (re.test(a)) return code;
    }
    return "";
  };

  AdminModules.csvTab = mod;
})();
