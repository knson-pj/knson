const { send } = require('./utils');

function getEnv() {
  const url = String(
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();

  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();

  const anonKey = String(
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY_PUBLIC ||
    ''
  ).trim();

  return { url, serviceRoleKey, anonKey };
}

function hasSupabaseAdminEnv() {
  const env = getEnv();
  return !!(env.url && env.serviceRoleKey);
}

function readBearer(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

function buildHeaders({ token, useAnon = false, hasJson = false, extra = {} } = {}) {
  const { serviceRoleKey, anonKey } = getEnv();
  const apikey = useAnon ? (anonKey || serviceRoleKey) : serviceRoleKey;
  const authorization = token || serviceRoleKey;

  const headers = {
    Accept: 'application/json',
    apikey,
    Authorization: `Bearer ${authorization}`,
    ...extra,
  };

  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function supabaseFetch(path, options = {}) {
  const { url } = getEnv();
  if (!url) throw new Error('SUPABASE_URL 이 설정되지 않았습니다.');

  const res = await fetch(`${url}${path}`, {
    method: options.method || 'GET',
    headers: buildHeaders({
      token: options.token,
      useAnon: !!options.useAnon,
      hasJson: options.json !== undefined,
      extra: options.headers || {},
    }),
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!res.ok) {
    const err = new Error(
      (data && (data.msg || data.message || data.error_description || data.error)) ||
      `Supabase API 오류 (${res.status})`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function verifySupabaseUser(req) {
  const token = readBearer(req);
  if (!token) return null;
  try {
    return await supabaseFetch('/auth/v1/user', { token, useAnon: true });
  } catch {
    return null;
  }
}

async function requireSupabaseAdmin(req, res) {
  const user = await verifySupabaseUser(req);
  if (!user?.id) {
    send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }

  let profile = null;
  try {
    const rows = await supabaseFetch(`/rest/v1/profiles?select=id,name,role&id=eq.${encodeURIComponent(user.id)}&limit=1`);
    profile = Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    send(res, 500, { ok: false, message: err.message || '프로필 조회에 실패했습니다.' });
    return null;
  }

  if (!profile || profile.role !== 'admin') {
    send(res, 403, { ok: false, message: '관리자 권한이 필요합니다.' });
    return null;
  }

  return {
    userId: user.id,
    role: profile.role,
    name: profile.name || user.email || '',
    email: user.email || '',
  };
}

async function listProfiles() {
  const rows = await supabaseFetch('/rest/v1/profiles?select=id,name,role,assigned_regions,created_at&order=created_at.desc.nullslast,name.asc');
  return Array.isArray(rows) ? rows : [];
}

async function createAuthUser({ email, password, name, role }) {
  const body = {
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: name || '',
      role: role || 'staff',
    },
  };

  const data = await supabaseFetch('/auth/v1/admin/users', {
    method: 'POST',
    json: body,
  });

  const user = data?.user || data;
  if (!user?.id) throw new Error('Supabase 계정 생성 응답이 올바르지 않습니다.');

  await upsertProfile({
    id: user.id,
    name,
    role,
    assignedRegions: [],
  });

  return user;
}

async function upsertProfile({ id, name, role, assignedRegions }) {
  const payload = [{
    id,
    name: name || '',
    role: role === 'admin' ? 'admin' : 'staff',
    assigned_regions: Array.isArray(assignedRegions) ? assignedRegions : [],
  }];

  const data = await supabaseFetch('/rest/v1/profiles?on_conflict=id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    json: payload,
  });

  return Array.isArray(data) ? data[0] : data;
}

async function updateProfile(userId, patch = {}) {
  const payload = {};
  if (patch.name != null) payload.name = String(patch.name || '').trim();
  if (patch.role != null) payload.role = patch.role === 'admin' ? 'admin' : 'staff';
  if (patch.assignedRegions != null) payload.assigned_regions = Array.isArray(patch.assignedRegions) ? patch.assignedRegions : [];

  const data = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=representation',
    },
    json: payload,
  });

  return Array.isArray(data) ? data[0] : data;
}

async function getProfile(userId) {
  const rows = await supabaseFetch(`/rest/v1/profiles?select=id,name,role,assigned_regions,created_at&id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function deleteAuthUser(userId) {
  await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  return true;
}

module.exports = {
  getEnv,
  hasSupabaseAdminEnv,
  readBearer,
  verifySupabaseUser,
  requireSupabaseAdmin,
  listProfiles,
  createAuthUser,
  upsertProfile,
  updateProfile,
  getProfile,
  deleteAuthUser,
};
