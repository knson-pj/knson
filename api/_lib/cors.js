const DEFAULT_ALLOWLIST = [
  'https://knson-pj.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowlist = process.env.CORS_ALLOWLIST
    ? process.env.CORS_ALLOWLIST.split(',').map(v => v.trim()).filter(Boolean)
    : DEFAULT_ALLOWLIST;

  if (origin && (allowlist.includes(origin) || allowlist.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', allowlist.includes('*') ? '*' : origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).json({ ok: true });
    return true;
  }
  return false;
}

module.exports = { applyCors };
