function send(res, status, payload) {
  res.status(status).json(payload);
}

function normalizeAddress(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[(),]/g, '')
    .trim();
}

function normalizePhone(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

function extractGuDong(address) {
  const text = String(address || '').replace(/\s+/g, ' ').trim();
  const guMatch = text.match(/([가-힣]+구)\b/);
  const dongMatch = text.match(/([가-힣0-9]+동)\b/);
  return {
    gu: guMatch ? guMatch[1] : '',
    dong: dongMatch ? dongMatch[1] : '',
  };
}

function normalizeStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['active', '진행', '진행중', '진행중인'].includes(s)) return 'active';
  if (['hold', '보류'].includes(s)) return 'hold';
  if (['closed', '종결', '완료'].includes(s)) return 'closed';
  if (['review', '검토', '검토중', ''].includes(s)) return 'review';
  return 'review';
}

function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { pushField(); i++; continue; }
    if (ch === '\n') { pushField(); pushRow(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    field += ch; i++;
  }
  pushField();
  if (row.length) pushRow();

  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1)
    .filter(r => r.some(v => String(v || '').trim() !== ''))
    .map(r => {
      const o = {};
      headers.forEach((h, idx) => { o[h] = r[idx] ?? ''; });
      return o;
    });
}

function getJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  send,
  normalizeAddress,
  normalizePhone,
  extractGuDong,
  normalizeStatus,
  parseCsv,
  getJsonBody,
  id,
  nowIso,
};
