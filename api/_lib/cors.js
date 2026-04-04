const DEFAULT_ALLOWLIST = [
  'https://knson-pj.github.io',
  'https://knson.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
];

function isAllowedOrigin(origin, allowlist) {
  if (!origin) return false;
  if (allowlist.includes('*') || allowlist.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    const isLocal = protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
    const isGithubPages = protocol === 'https:' && hostname.endsWith('.github.io');
    const isVercelPreview = protocol === 'https:' && hostname.endsWith('.vercel.app');
    return isLocal || isGithubPages || isVercelPreview;
  } catch {
    return false;
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowlist = process.env.CORS_ALLOWLIST
    ? process.env.CORS_ALLOWLIST.split(',').map(v => v.trim()).filter(Boolean)
    : DEFAULT_ALLOWLIST;

  if (origin && isAllowedOrigin(origin, allowlist)) {
    res.setHeader('Access-Control-Allow-Origin', allowlist.includes('*') ? '*' : origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-KNSN-Photo-Action, X-KNSN-Property-Id, X-KNSN-Photo-Id');

  if (req.method === 'OPTIONS') {
    res.status(200).json({ ok: true });
    return true;
  }
  return false;
}

module.exports = { applyCors };
