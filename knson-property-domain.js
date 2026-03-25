(() => {
  "use strict";

  const Shared = window.KNSN_SHARED || null;

  function pickFirstText(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
    return "";
  }

  function compactAddressText(value) {
    return String(value || "").trim().replace(/\s+/g, "");
  }

  function parseFloorNumberForLog(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    let match = text.match(/^(?:B|b|지하)\s*(\d+)$/);
    if (match) return `b${match[1]}`;
    match = text.match(/(-?\d+)/);
    return match ? String(Number(match[1])) : "";
  }

  function parseAddressIdentityParts(address) {
    const compact = compactAddressText(String(address || "").trim().replace(/\s+/g, " "));
    if (!compact) return { dong: "", mainNo: "", subNo: "" };

    const suffixSet = new Set(["동", "읍", "면", "리"]);
    let end = -1;
    for (let i = compact.length - 1; i >= 0; i -= 1) {
      if (suffixSet.has(compact[i])) {
        end = i;
        break;
      }
    }
    if (end < 0) return { dong: "", mainNo: "", subNo: "" };

    let start = 0;
    for (let i = end - 1; i >= 0; i -= 1) {
      if (/[시군구읍면리동]/.test(compact[i])) {
        start = i + 1;
        break;
      }
    }

    const dong = compact.slice(start, end + 1);
    if (!/^[가-힣A-Za-z0-9]+(?:동|읍|면|리)$/.test(dong)) return { dong: "", mainNo: "", subNo: "" };

    const tail = compact.slice(end + 1);
    const lot = tail.match(/(산?\d+)(?:-(\d+))?/);
    if (!lot) return { dong, mainNo: "", subNo: "" };
    return { dong, mainNo: lot[1] || "", subNo: lot[2] || "" };
  }

  function extractHoNumberForLog(data) {
    const explicitValues = [data?.ho, data?.unit, data?.room, data?.raw?.ho, data?.raw?.unit, data?.raw?.room];
    for (const value of explicitValues) {
      const text = String(value || "").trim();
      if (!text) continue;
      let match = text.match(/(\d{1,5})\s*호/);
      if (match) return String(Number(match[1]));
      if (!/층|동/.test(text)) {
        match = text.match(/^\D*(\d{1,5})\D*$/);
        if (match) return String(Number(match[1]));
      }
    }
    const texts = [
      data?.address,
      data?.raw?.address,
      data?.raw?.물건명,
      data?.raw?.상세주소,
      data?.memo,
      data?.raw?.memo,
      data?.raw?.opinion,
      data?.raw?.detailAddress,
    ].filter(Boolean).join(" ");
    const match = texts.match(/(\d{1,5})\s*호/);
    return match ? String(Number(match[1])) : "";
  }

  function buildRegistrationMatchKey(data) {
    const parts = parseAddressIdentityParts(pickFirstText(data?.address, data?.raw?.address, ""));
    const floorKey = parseFloorNumberForLog(pickFirstText(data?.floor, data?.raw?.floor, "")) || "0";
    const hoKey = extractHoNumberForLog(data) || "0";
    if (!parts.dong || !parts.mainNo) return "";
    return `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey}|${hoKey}`;
  }

  function attachRegistrationIdentity(raw, data) {
    const nextRaw = { ...(raw || {}) };
    const parts = parseAddressIdentityParts(pickFirstText(data?.address, data?.raw?.address, nextRaw.address, ""));
    const floorKey = parseFloorNumberForLog(pickFirstText(data?.floor, data?.raw?.floor, nextRaw.floor, ""));
    const hoKey = extractHoNumberForLog(data);
    const key = parts.dong && parts.mainNo
      ? `${parts.dong}|${parts.mainNo}|${parts.subNo || "0"}|${floorKey || "0"}|${hoKey || "0"}`
      : "";
    nextRaw.registrationIdentityKey = key;
    nextRaw.registrationIdentity = {
      dong: parts.dong || "",
      mainNo: parts.mainNo || "",
      subNo: parts.subNo || "",
      floor: floorKey || "",
      ho: hoKey || "",
    };
    return nextRaw;
  }

  function hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  }

  function normalizeCompareValue(field, value, options = {}) {
    if (value === null || value === undefined) return "";
    const numericFields = new Set(options.numericFields || []);
    if (numericFields.has(field)) {
      const num = Shared && typeof Shared.toNullableNumber === "function"
        ? Shared.toNullableNumber(value)
        : Number(String(value).replace(/,/g, ""));
      return num == null || !Number.isFinite(num) ? "" : String(num);
    }
    return String(value).trim().replace(/\s+/g, " ");
  }

  function formatFieldValueForLog(field, value, options = {}) {
    if (value === null || value === undefined) return "";
    const amountFields = new Set(options.amountFields || []);
    const numericFields = new Set(options.numericFields || []);
    const num = Shared && typeof Shared.toNullableNumber === "function"
      ? Shared.toNullableNumber(value)
      : Number(String(value).replace(/,/g, ""));
    if (amountFields.has(field)) {
      return num == null || !Number.isFinite(num) ? "" : Number(num).toLocaleString("ko-KR");
    }
    if (numericFields.has(field)) {
      if (num == null || !Number.isFinite(num)) return "";
      return Number.isInteger(num) ? String(num) : String(num).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    }
    return String(value).trim();
  }

  function buildRegistrationChanges(prevSnapshot, nextSnapshot, labels, options = {}) {
    const changes = [];
    Object.keys(labels || {}).forEach((field) => {
      const nextValue = nextSnapshot?.[field];
      if (!hasMeaningfulValue(nextValue)) return;
      const prevNorm = normalizeCompareValue(field, prevSnapshot?.[field], options);
      const nextNorm = normalizeCompareValue(field, nextValue, options);
      if (prevNorm === nextNorm) return;
      changes.push({
        field,
        label: labels[field],
        before: formatFieldValueForLog(field, prevSnapshot?.[field], options) || "-",
        after: formatFieldValueForLog(field, nextValue, options) || "-",
      });
    });
    return changes;
  }

  function buildRegisterLogContext(route, options = {}) {
    const user = options.user || null;
    return {
      at: String(options.at || new Date().toISOString()).trim(),
      route: String(route || options.route || "등록").trim(),
      actor: String(options.actor || user?.name || user?.email || "").trim(),
    };
  }

  function ensureRegistrationCreatedLog(raw, context = {}) {
    const nextRaw = { ...(raw || {}) };
    const firstAt = pickFirstText(nextRaw.firstRegisteredAt, context?.at, new Date().toISOString());
    const current = Array.isArray(nextRaw.registrationLog) ? nextRaw.registrationLog.slice() : [];
    if (!current.length) {
      current.push({ type: "created", at: firstAt, route: context?.route || "등록", actor: context?.actor || "" });
    }
    nextRaw.firstRegisteredAt = firstAt;
    nextRaw.registrationLog = current;
    return nextRaw;
  }

  function appendRegistrationLog(raw, context = {}, changes = []) {
    const nextRaw = ensureRegistrationCreatedLog(raw, context);
    if (Array.isArray(changes) && changes.length) {
      nextRaw.registrationLog = [...nextRaw.registrationLog, {
        type: "changed",
        at: context?.at || new Date().toISOString(),
        route: context?.route || "등록",
        actor: context?.actor || "",
        changes: changes.map((entry) => ({ ...entry })),
      }];
    }
    return nextRaw;
  }

  function loadOpinionHistory(item) {
    const raw = item?._raw?.raw || {};
    const hist = raw.opinionHistory;
    if (Array.isArray(hist)) return hist;
    const legacy = String(item?.opinion || raw.opinion || "").trim();
    if (legacy) {
      const fallbackDate = Shared && typeof Shared.formatDate === "function"
        ? (Shared.formatDate(item?.createdAt) || "unknown")
        : "unknown";
      return [{ date: fallbackDate, text: legacy, author: "" }];
    }
    return [];
  }

  function appendOpinionEntry(history, newText, user, now = new Date()) {
    const text = String(newText || "").trim();
    if (!text) return Array.isArray(history) ? history : [];
    const date = now instanceof Date ? now : new Date(now);
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const author = String(user?.name || user?.email || "").trim();
    return [...(Array.isArray(history) ? history : []), { date: today, text, author }];
  }

  window.KNSN_PROPERTY_DOMAIN = {
    pickFirstText,
    compactAddressText,
    parseFloorNumberForLog,
    parseAddressIdentityParts,
    extractHoNumberForLog,
    buildRegistrationMatchKey,
    attachRegistrationIdentity,
    hasMeaningfulValue,
    normalizeCompareValue,
    formatFieldValueForLog,
    buildRegistrationChanges,
    buildRegisterLogContext,
    ensureRegistrationCreatedLog,
    appendRegistrationLog,
    loadOpinionHistory,
    appendOpinionEntry,
  };
})();
