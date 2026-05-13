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
    "court_dept",
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
    // CSV 업로드는 물건 등록 (master / list 가능, basic 차단) — 2026-05-08
    if (utils.ensureAdminWrite && !utils.ensureAdminWrite('properties')) return;
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

        // [신규 2026-04-24] 경매 CSV 선제 병합:
        // 탱크옥션/법원경매 CSV 에서 같은 물건(사건번호+물건번호+주소+감정가+최저가
        // 완전 일치) 이 "토지 표시 행" + "건물 표시 행" 으로 쪼개져 들어오는 경우,
        // 경매현황 텍스트를 합쳐 1개 raw 행으로 압축. 감정가/최저가 동일 = 일괄매각
        // 시그널이므로 그룹 키에 포함. 비경매는 그대로 통과.
        let workingRows = rawRows;
        let auctionMergedCount = 0;
        if (sourceType === "auction") {
          const mergeRes = mod.mergeAuctionCaseLandBuildingRows(rawRows);
          workingRows = mergeRes.rows;
          auctionMergedCount = mergeRes.mergedCount;
        }

        // 1패스: 각 행을 mapPropertyCsvRow 로 파싱
        const mappedRows = [];  // [{raw, m}]
        for (const r of workingRows) {
          const m = mod.mapPropertyCsvRow(r, sourceType);
          if (!m || !m.itemNo || !m.address) continue;
          mappedRows.push({ raw: r, m });
        }

        // 경매 전용: 같은 사건번호 내에서 "서로 다른 물건번호" 가 2개 이상인 경우에만
        // itemNo 뒤에 "(물건번호)" 를 붙여 구분한다. 물건번호가 1개(또는 없음)이면
        // 업계 관례(탱크옥션/지지옥션/대법원경매 모두 동일)에 따라 "(1)" / "(10)" 등을
        // 붙이지 않고 사건번호 단독 사용.
        // [수정 2026-04-24] 기존 "행 수" 기반 판정의 버그 수정.
        //   이전: 같은 사건의 행이 2개 이상이면 무조건 "(물건번호)" 부착
        //   문제: 한 물건(예: 10번) 의 토지행+건물행 2행이 들어오면 "(10)" 오부착
        //         → 2024타경80309(10) 같은 잘못된 itemNo 생성
        //   수정: "서로 다른 물건번호 개수" 가 2개 이상일 때만 부착
        //         (Phase 1 의 선제 병합이 적용되면 행 수는 이미 1로 줄어들지만,
        //          병합 조건을 벗어난 edge case 도 안전하게 처리하기 위해 판정 교체)
        if (sourceType === "auction") {
          const casePropNos = new Map();  // caseNo → Set<propNo>
          for (const { m } of mappedRows) {
            const cn = String(m.auctionCaseNo || "").trim();
            if (!cn) continue;
            if (!casePropNos.has(cn)) casePropNos.set(cn, new Set());
            casePropNos.get(cn).add(String(m.auctionPropNo || "").trim());
          }
          for (const { m } of mappedRows) {
            const cn = String(m.auctionCaseNo || "").trim();
            const pn = String(m.auctionPropNo || "").trim();
            const distinctPropCount = cn ? (casePropNos.get(cn)?.size || 0) : 0;
            if (cn && pn && distinctPropCount >= 2) {
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

        // ── 업로드 전 prev 스냅샷 (담당자 정보가 들어있는 행만 대상으로 1회 SELECT)
        //    Q1 합의: 모든 배정 경로 기록 / 헬퍼가 prev==next 면 자동 스킵.
        //    CSV에 assignee 컬럼이 들어오는 경우는 드물지만 안전망으로 유지.
        const csvAssigneeCandidates = finalRows.filter((r) => {
          const aid = String(r?.assignee_id || '').trim();
          const aname = String(r?.assignee_name || '').trim();
          return (aid || aname) && r?.global_id;
        });
        const csvPrevByGlobalId = new Map();
        if (csvAssigneeCandidates.length) {
          const gids = csvAssigneeCandidates.map((r) => String(r.global_id));
          const CHUNK = 100;
          for (let i = 0; i < gids.length; i += CHUNK) {
            const slice = gids.slice(i, i + CHUNK);
            try {
              const { data } = await sb.from('properties')
                .select('id, global_id, assignee_id, assignee_name, item_no, address, raw')
                .in('global_id', slice);
              (data || []).forEach((r) => csvPrevByGlobalId.set(String(r.global_id), r));
            } catch (_) { /* 스냅샷 실패해도 업로드 자체는 계속 */ }
          }
        }

        const importResult = await mod.upsertPropertiesResilient(sb, finalRows, { chunkSize: 200 });

        // ── 업로드 후 활동로그 (담당자 지정·변경 케이스만)
        //    upsert 가 끝난 후 신규 등록 행은 id 가 새로 생겼을 수 있으므로 한 번 더 SELECT.
        try {
          if (csvAssigneeCandidates.length && DataAccess && typeof DataAccess.recordAssigneeChangeLogsViaApi === 'function') {
            const gids = csvAssigneeCandidates.map((r) => String(r.global_id));
            const postMap = new Map();
            const CHUNK = 100;
            for (let i = 0; i < gids.length; i += CHUNK) {
              const slice = gids.slice(i, i + CHUNK);
              try {
                const { data } = await sb.from('properties')
                  .select('id, global_id, item_no, address, raw')
                  .in('global_id', slice);
                (data || []).forEach((r) => postMap.set(String(r.global_id), r));
              } catch (_) { /* 일부 실패 OK */ }
            }
            const entries = [];
            for (const r of csvAssigneeCandidates) {
              const gid = String(r.global_id);
              const post = postMap.get(gid);
              if (!post || !post.id) continue;  // 신규 id 못 받았으면 추적 불가, 스킵
              const prev = csvPrevByGlobalId.get(gid) || {};
              const prevId = String(prev.assignee_id || '').trim();
              const prevName = String(prev.assignee_name || '').trim();
              const nextId = String(r.assignee_id || '').trim();
              const nextName = String(r.assignee_name || '').trim();
              if (prevId === nextId && prevName === nextName) continue;  // 변경 없음
              entries.push({
                propertyId: post.id,
                identityKey: post.raw?.registrationIdentityKey || prev.raw?.registrationIdentityKey || null,
                itemNo: post.item_no || r.item_no || null,
                address: post.address || r.address || null,
                prevId, prevName, nextId, nextName,
              });
            }
            if (entries.length) {
              await DataAccess.recordAssigneeChangeLogsViaApi(api, entries, { reason: 'new_property', auth: true });
            }
          }
        } catch (logErr) {
          // 로그 실패가 업로드 결과 표시를 막지 않도록 swallow
          console.warn('[assignee_change_log] csv upload skipped:', logErr?.message || logErr);
        }

        const summaryParts = ["업로드 완료", `처리: ${importResult.okCount}건`];
        if (collapsed.outcomeCounts.create > 0) summaryParts.push(`신규 등록: ${collapsed.outcomeCounts.create}건`);
        if (collapsed.outcomeCounts.update > 0) summaryParts.push(`기존 물건 갱신(LOG): ${collapsed.outcomeCounts.update}건`);
        if (collapsed.outcomeCounts.noChange > 0) summaryParts.push(`기존 물건 일치(변경없음): ${collapsed.outcomeCounts.noChange}건`);
        if (auctionMergedCount > 0) summaryParts.push(`토지/건물 행 병합: ${auctionMergedCount}건`);
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
      // [신규 2026-04-27] 자동차/중기 매물은 업로드 대상 제외
      // CSV 의 "종별" 컬럼이 "자동차" 또는 "자동차,중기" 인 행은 부동산 매물이 아니므로
      // mapPropertyCsvRow 단계에서 null 반환해 탈락시킨다 (호출부의 if (!m) continue 로 스킵).
      {
        const assetTokens = String(assetType || "").split(/[,\/\s]+/).map((s) => s.trim()).filter(Boolean);
        const VEHICLE_TYPES = new Set(["자동차", "중기"]);
        if (assetTokens.length > 0 && assetTokens.every((t) => VEHICLE_TYPES.has(t))) {
          return null;
        }
      }
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

  // ─────────────────────────────────────────────────────────────────────
  // [신규 2026-04-24] 경매 CSV 토지+건물 행 선제 병합
  //
  // 배경:
  //   탱크옥션/법원경매 CSV 는 한 물건(사건번호+물건번호) 을 "토지 표시 행" 과
  //   "건물 표시 행" 으로 분리해서 출력하는 경우가 있다. 예:
  //     Row A: 경매현황="토지 대 232.3㎡(70.27평)"
  //     Row B: 경매현황="건물 철근콘크리트조 스라브지붕 4층 ..."
  //   두 행 모두 사건번호·주소·감정가·최저가·진행상태가 완전히 동일하고
  //   경매현황 텍스트만 다르다.
  //
  // 이전 동작의 문제:
  //   - 두 행이 각각 mapPropertyCsvRow 로 파싱되어 별개 물건으로 취급되거나,
  //     "토지만" 행이 건물류 종별 필터로 드롭되어 토지면적(70.27평) 정보가 소실.
  //   - 사건 빈도 2+ 로 잘못 인식되어 실제로는 물건 1개뿐인데 "(10)" 같은
  //     접미사가 붙는 부작용.
  //
  // 해법:
  //   - 그룹 키 = (사건번호, 물건번호, 주소정규화, 감정가, 최저가) 완전 일치
  //     4~5 필드가 동시에 일치하면 물리적으로 같은 매물의 일괄매각 표시임.
  //   - 그룹 내 경매현황을 "\n" 으로 이어붙여 1 행으로 압축.
  //   - 후속의 parseAuctionAreas 가 이미 "건물+토지 혼재 텍스트" 를 정상 처리
  //     하도록 설계되어 있으므로, 이 함수는 "raw 행 병합" 만 수행하면 끝.
  //
  // 그룹화 제외 조건 (단독 유지):
  //   - 사건번호 없음 또는 주소 없음 → 식별 불가
  //   - 감정가 가 0 또는 비어있음 → 일괄매각 시그널 신뢰 불가
  // ─────────────────────────────────────────────────────────────────────
  mod.mergeAuctionCaseLandBuildingRows = function mergeAuctionCaseLandBuildingRows(rawRows) {
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return { rows: Array.isArray(rawRows) ? rawRows : [], mergedCount: 0 };
    }

    const pickField = (row, ...keys) => {
      for (const k of keys) {
        const v = row == null ? null : row[k];
        if (v != null && String(v).trim() !== "") return String(v);
      }
      return "";
    };

    const normalizeNumberKey = (value) => {
      const digits = String(value == null ? "" : value).replace(/[^0-9]/g, "");
      return digits || "";
    };

    const normalizeAddrKey = (value) => {
      return String(value == null ? "" : value).replace(/\s+/g, "").trim();
    };

    const groups = new Map();
    const order = [];

    for (const row of rawRows) {
      const caseNo = pickField(row, "사건번호", "caseNo").trim();
      const propNo = pickField(row, "물건번호").trim();
      const addrNorm = normalizeAddrKey(pickField(row, "주소(시군구동)", "주소", "소재지", "address"));
      const priceKey = normalizeNumberKey(pickField(row, "감정가", "감정가(원)", "priceMain"));
      const lowKey = normalizeNumberKey(pickField(row, "최저가", "lowprice"));

      // 그룹화 불가: 단독 유지 (나중에 rows.length === 1 분기로 통과)
      if (!caseNo || !addrNorm || !priceKey || priceKey === "0") {
        const soloKey = `__solo__${order.length}`;
        groups.set(soloKey, [row]);
        order.push(soloKey);
        continue;
      }

      const key = `${caseNo}|${propNo}|${addrNorm}|${priceKey}|${lowKey}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key).push(row);
    }

    const merged = [];
    let mergedCount = 0;

    for (const key of order) {
      const groupRows = groups.get(key);
      if (!groupRows || groupRows.length === 0) continue;
      if (groupRows.length === 1) {
        merged.push(groupRows[0]);
        continue;
      }

      // 2 개 이상 → 병합. 경매현황 키워드로 건물/토지/기타 분류.
      const buildingRows = [];
      const landRows = [];
      const otherRows = [];
      for (const r of groupRows) {
        const status = pickField(r, "경매현황", "비고", "memo");
        const hasBuilding = /건물/.test(status);
        const hasLand = /(?:대지권|대\s*지\s*권|토지)/.test(status);
        if (hasBuilding) buildingRows.push(r);
        else if (hasLand) landRows.push(r);
        else otherRows.push(r);
      }

      // Base row: 건물 row 우선 → exclusive_area / 층 등 정보가 건물 행에 있음.
      // 없으면 기타 → 토지 → 순서대로 첫 번째 행.
      const baseRow = buildingRows[0] || otherRows[0] || landRows[0] || groupRows[0];

      // 경매현황 통합 순서: 건물 → 기타 → 토지 (자연스러운 읽기 흐름)
      const readOrder = [...buildingRows, ...otherRows, ...landRows];
      const seenTexts = new Set();
      const combinedParts = [];
      for (const r of readOrder) {
        const s = pickField(r, "경매현황", "비고").trim();
        if (s && !seenTexts.has(s)) {
          combinedParts.push(s);
          seenTexts.add(s);
        }
      }
      const combinedStatus = combinedParts.join("\n");

      // 새 raw row: baseRow 복제 후 경매현황 컬럼만 덮어쓰기.
      // baseRow 에 실제 존재하는 컬럼명 중 첫 번째에 저장해 CSV 헤더 불일치 회피.
      const mergedRow = { ...baseRow };
      if (Object.prototype.hasOwnProperty.call(mergedRow, "경매현황")) {
        mergedRow["경매현황"] = combinedStatus;
      } else if (Object.prototype.hasOwnProperty.call(mergedRow, "비고")) {
        mergedRow["비고"] = combinedStatus;
      } else if (Object.prototype.hasOwnProperty.call(mergedRow, "memo")) {
        mergedRow["memo"] = combinedStatus;
      } else {
        mergedRow["경매현황"] = combinedStatus;
      }

      merged.push(mergedRow);
      mergedCount += groupRows.length - 1;
    }

    if (mergedCount > 0) {
      try { console.info(`[CSV auction merge] ${mergedCount} row(s) merged across groups`); } catch {}
    }

    return { rows: merged, mergedCount };
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

  // ════════════════════════════════════════════════════════════════
  // [추가 2026-05-11] URL 매칭 안된 매물 관리 (탱크옥션)
  // ════════════════════════════════════════════════════════════════
  //   탱크옥션 RPC (sync_tankauction_data) 가 source_url 을 채우지 못한
  //   경매 매물 (source_type='auction' AND source_url 비어있음) 을 모아서
  //   표시하고 일괄 삭제하는 기능.
  //
  //   상태: 카드 자체는 항상 보이지만 데이터는 [조회] 버튼을 눌러야 로드됨.
  //   캐시: state.unmatchedProperties 에 마지막 조회 결과 보관.

  // 조회: source_type='auction' + (source_url IS NULL OR source_url='') 인 행 가져오기
  mod.loadUnmatchedProperties = async function loadUnmatchedProperties() {
    const { state, els, K, utils } = ctx();
    if (utils.ensureAdminWrite && !utils.ensureAdminWrite('properties')) return;

    const btnLoad = document.getElementById('btnLoadUnmatched');
    const btnDelete = document.getElementById('btnDeleteUnmatched');
    const wrap = document.getElementById('unmatchedTableWrap');
    const empty = document.getElementById('unmatchedEmpty');
    const countEl = document.getElementById('unmatchedCount');

    if (btnLoad) { btnLoad.disabled = true; btnLoad.textContent = '조회 중...'; }
    if (btnDelete) btnDelete.disabled = true;

    try {
      // 세션 동기화
      try { await K.sbSyncLocalSession(); } catch {}
      if (state.session?.user?.role !== 'admin') {
        throw new Error('관리자만 사용할 수 있습니다.');
      }

      const sb = (K && K.supabaseEnabled && K.supabaseEnabled()) ? K.initSupabase() : null;
      if (!sb) throw new Error('Supabase 클라이언트 사용 불가');

      // 경매(auction) + URL 비어있음 (NULL 또는 빈 문자열)
      // limit 2000: 100~1000건 규모 + 여유. 그 이상이면 다음 호출에서 끊김 안내.
      const { data, error } = await sb
        .from('properties')
        .select('id, item_no, address, asset_type, price_main, date_uploaded, assignee_name, assignee_id, source_url')
        .eq('source_type', 'auction')
        .or('source_url.is.null,source_url.eq.')
        .order('date_uploaded', { ascending: false })
        .limit(2000);

      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      state.unmatchedProperties = rows;
      state.selectedUnmatchedIds = new Set();

      mod.renderUnmatchedTable();

      if (countEl) {
        countEl.textContent = rows.length.toLocaleString('ko-KR') + '건';
        countEl.setAttribute('data-empty', rows.length === 0 ? 'true' : 'false');
      }
      if (rows.length > 0) {
        if (wrap) wrap.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');
      } else {
        if (wrap) wrap.classList.add('hidden');
        if (empty) {
          empty.classList.remove('hidden');
          empty.textContent = '✅ URL 매칭 안 된 경매 매물이 없습니다.';
        }
      }
    } catch (err) {
      console.error('loadUnmatchedProperties failed', err);
      alert('조회 실패: ' + (err.message || '알 수 없는 오류'));
      if (empty) {
        empty.classList.remove('hidden');
        empty.textContent = '조회 중 오류가 발생했습니다.';
      }
    } finally {
      if (btnLoad) { btnLoad.disabled = false; btnLoad.textContent = '새로고침'; }
    }
  };

  // 렌더링: 마지막 조회 결과로 테이블 본문 그리기
  mod.renderUnmatchedTable = function renderUnmatchedTable() {
    const { state, utils } = ctx();
    const tbody = document.getElementById('unmatchedTableBody');
    if (!tbody) return;

    const rows = state.unmatchedProperties || [];
    const selected = state.selectedUnmatchedIds || new Set();
    const esc = (utils && utils.escapeHtml) ? utils.escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    if (rows.length === 0) {
      tbody.innerHTML = '';
      return;
    }

    function fmtDate(s) {
      if (!s) return '-';
      try { return new Date(s).toLocaleDateString('ko-KR'); } catch { return String(s).slice(0,10); }
    }
    function fmtPrice(v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) return '-';
      if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
      if (n >= 10000)     return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
      return n.toLocaleString('ko-KR');
    }

    tbody.innerHTML = rows.map(function(r) {
      const isChecked = selected.has(r.id) ? ' checked' : '';
      return '<tr data-id="' + esc(r.id) + '" class="' + (selected.has(r.id) ? 'row-selected' : '') + '">' +
        '<td class="csv-unmatched-col-check"><input type="checkbox" class="unmatched-row-check" data-id="' + esc(r.id) + '"' + isChecked + ' /></td>' +
        '<td><span class="csv-unmatched-item-no">' + esc(r.item_no || '-') + '</span></td>' +
        // [추가 2026-05-11] 주소 클릭 시 물건정보수정 모달 열림 (.address-trigger 클래스 + data-id)
        '<td class="csv-unmatched-addr"><a href="#" class="address-trigger unmatched-address-trigger" data-id="' + esc(r.id) + '" title="물건 정보 수정">' + esc(r.address || '-') + '</a></td>' +
        '<td>' + esc(r.asset_type || '-') + '</td>' +
        '<td class="csv-unmatched-col-num">' + esc(fmtPrice(r.price_main)) + '</td>' +
        '<td>' + esc(fmtDate(r.date_uploaded)) + '</td>' +
        '<td>' + esc(r.assignee_name || '-') + '</td>' +
        '</tr>';
    }).join('');

    mod.updateUnmatchedControls();
  };

  // 선택 컨트롤 상태 업데이트 (전체선택 체크박스 / 삭제 버튼 활성화)
  mod.updateUnmatchedControls = function updateUnmatchedControls() {
    const { state } = ctx();
    const rows = state.unmatchedProperties || [];
    const selected = state.selectedUnmatchedIds || new Set();
    const total = rows.length;
    const selCount = selected.size;

    const selectAll = document.getElementById('unmatchedSelectAll');
    if (selectAll) {
      if (selCount === 0) { selectAll.checked = false; selectAll.indeterminate = false; }
      else if (selCount === total) { selectAll.checked = true; selectAll.indeterminate = false; }
      else { selectAll.checked = false; selectAll.indeterminate = true; }
    }

    const btnDelete = document.getElementById('btnDeleteUnmatched');
    if (btnDelete) {
      btnDelete.disabled = selCount === 0;
      btnDelete.textContent = selCount > 0
        ? '선택 삭제 (' + selCount.toLocaleString('ko-KR') + '건)'
        : '선택 삭제';
    }
  };

  // 개별 체크박스 토글
  mod.toggleUnmatchedRow = function toggleUnmatchedRow(id, checked) {
    const { state } = ctx();
    if (!state.selectedUnmatchedIds) state.selectedUnmatchedIds = new Set();
    if (checked) state.selectedUnmatchedIds.add(id);
    else         state.selectedUnmatchedIds.delete(id);
    const tr = document.querySelector('#unmatchedTableBody tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (tr) tr.classList.toggle('row-selected', checked);
    mod.updateUnmatchedControls();
  };

  // 전체선택 토글
  mod.toggleUnmatchedSelectAll = function toggleUnmatchedSelectAll(checked) {
    const { state } = ctx();
    const rows = state.unmatchedProperties || [];
    if (!state.selectedUnmatchedIds) state.selectedUnmatchedIds = new Set();
    state.selectedUnmatchedIds.clear();
    if (checked) {
      for (const r of rows) state.selectedUnmatchedIds.add(r.id);
    }
    mod.renderUnmatchedTable();
  };

  // 삭제 실행
  // [수정 2026-05-11] 1,000건 같은 대량 삭제 시 fetch 실패(URL/Body 너무 큼)를 방지하기 위해
  //   100건씩 배치 분할 순차 호출. 진행 상황을 버튼 텍스트에 실시간 표시.
  mod.deleteSelectedUnmatched = async function deleteSelectedUnmatched() {
    const { state, K, api, utils } = ctx();
    if (utils.ensureAdminWrite && !utils.ensureAdminWrite('properties')) return;

    const selected = state.selectedUnmatchedIds || new Set();
    if (selected.size === 0) return;

    const ids = Array.from(selected);
    const cnt = ids.length;
    if (!window.confirm('선택된 ' + cnt.toLocaleString('ko-KR') + '건을 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    if (cnt >= 100 && !window.confirm('정말 ' + cnt.toLocaleString('ko-KR') + '건을 일괄 삭제할까요?\n(100건씩 나눠서 순차 처리됩니다)')) return;

    const btnDelete = document.getElementById('btnDeleteUnmatched');
    const btnLoad = document.getElementById('btnLoadUnmatched');
    if (btnDelete) btnDelete.disabled = true;
    if (btnLoad)   btnLoad.disabled   = true;

    // 100건씩 배치 분할 (운영 환경에서 검증된 안전 크기)
    const BATCH_SIZE = 100;
    const batches = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      batches.push(ids.slice(i, i + BATCH_SIZE));
    }

    const DA = window.KNSN_DATA_ACCESS;
    const successIds = [];
    const failedBatches = [];   // [{ idx, ids, error }]

    for (let bi = 0; bi < batches.length; bi++) {
      const chunk = batches[bi];
      const processedSoFar = bi * BATCH_SIZE;
      if (btnDelete) {
        btnDelete.textContent = '삭제 중... ' +
          processedSoFar.toLocaleString('ko-KR') + ' / ' + cnt.toLocaleString('ko-KR');
      }
      try {
        if (DA && typeof DA.deletePropertiesViaAdminApi === 'function') {
          await DA.deletePropertiesViaAdminApi(api, chunk, { auth: true });
        } else {
          await api('/admin/properties', { method: 'DELETE', auth: true, body: { ids: chunk } });
        }
        for (const id of chunk) successIds.push(id);
      } catch (err) {
        console.error('deleteSelectedUnmatched batch ' + bi + ' failed', err);
        failedBatches.push({ idx: bi, ids: chunk, error: err });
        // 한 배치 실패해도 다음 배치 계속 시도 (가능한 한 많이 삭제)
      }
    }

    // 캐시 무효화
    if (utils && typeof utils.invalidatePropertyCollections === 'function') {
      try { utils.invalidatePropertyCollections(); } catch {}
    }

    // 성공한 ID 들만 화면에서 제거
    if (successIds.length > 0) {
      const successSet = new Set(successIds);
      state.unmatchedProperties = (state.unmatchedProperties || []).filter(function(r) { return !successSet.has(r.id); });
      // 선택 상태에서도 제거 (실패한 건은 다시 선택 시도 가능하도록 유지)
      for (const id of successIds) state.selectedUnmatchedIds.delete(id);
    }
    mod.renderUnmatchedTable();

    const countEl = document.getElementById('unmatchedCount');
    const remain = state.unmatchedProperties.length;
    if (countEl) {
      countEl.textContent = remain.toLocaleString('ko-KR') + '건';
      countEl.setAttribute('data-empty', remain === 0 ? 'true' : 'false');
    }
    if (remain === 0) {
      const wrap = document.getElementById('unmatchedTableWrap');
      const empty = document.getElementById('unmatchedEmpty');
      if (wrap) wrap.classList.add('hidden');
      if (empty) { empty.classList.remove('hidden'); empty.textContent = '✅ 선택된 매물이 모두 삭제되었습니다.'; }
    }

    if (btnLoad)   btnLoad.disabled   = false;
    if (btnDelete) { btnDelete.disabled = state.selectedUnmatchedIds.size === 0; btnDelete.textContent = '선택 삭제'; }
    mod.updateUnmatchedControls();

    // 결과 알림
    if (failedBatches.length === 0) {
      alert(successIds.length.toLocaleString('ko-KR') + '건이 삭제되었습니다.');
    } else {
      const failCount = failedBatches.reduce(function(s, b) { return s + b.ids.length; }, 0);
      const firstErr = failedBatches[0].error;
      alert(
        '일부 삭제 실패 — 성공: ' + successIds.length.toLocaleString('ko-KR') + '건 / ' +
        '실패: ' + failCount.toLocaleString('ko-KR') + '건\n\n' +
        '오류: ' + ((firstErr && firstErr.message) || '알 수 없는 오류') + '\n\n' +
        '실패한 건은 선택 상태를 유지했습니다. 잠시 후 [선택 삭제] 를 다시 눌러주세요.'
      );
    }
  };

  AdminModules.csvTab = mod;
})();
