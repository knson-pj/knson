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

function normalizeUserList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.users)) return data.users;
  return [];
}

async function listAuthUsers() {
  const data = await supabaseFetch('/auth/v1/admin/users?page=1&per_page=1000');
  return normalizeUserList(data);
}

async function getAuthUser(userId) {
  const data = await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
  return data?.user || data || null;
}

async function listProfiles() {
  const rows = await supabaseFetch('/rest/v1/profiles?select=id,name,role,created_at&order=created_at.desc.nullslast,name.asc');
  return Array.isArray(rows) ? rows : [];
}

function pickAssignedRegionsFromUser(user) {
  const regions = user?.user_metadata?.assigned_regions;
  return Array.isArray(regions) ? regions.filter(Boolean).map((v) => String(v)) : [];
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'staff';
}

function normalizeStaffItem({ profile, user }) {
  const role = normalizeRole(profile?.role || user?.user_metadata?.role || 'staff');
  return {
    id: profile?.id || user?.id || '',
    email: user?.email || '',
    name: profile?.name || user?.user_metadata?.display_name || user?.email || '',
    role,
    assignedRegions: pickAssignedRegionsFromUser(user),
    createdAt: profile?.created_at || user?.created_at || '',
  };
}

async function listStaff() {
  const [profiles, users] = await Promise.all([listProfiles(), listAuthUsers()]);
  const profileMap = new Map((profiles || []).map((row) => [String(row.id), row]));
  const items = [];

  for (const user of users) {
    const id = String(user?.id || '');
    if (!id) continue;
    const profile = profileMap.get(id) || { id, name: '', role: 'staff', created_at: user?.created_at || '' };
    items.push(normalizeStaffItem({ profile, user }));
    profileMap.delete(id);
  }

  for (const [id, profile] of profileMap.entries()) {
    items.push(normalizeStaffItem({ profile, user: { id } }));
  }

  items.sort((a, b) => {
    const ad = new Date(a.createdAt || 0).getTime();
    const bd = new Date(b.createdAt || 0).getTime();
    return (Number.isFinite(bd) ? bd : 0) - (Number.isFinite(ad) ? ad : 0);
  });

  return items;
}

async function createAuthUser({ email, password, name, role }) {
  const body = {
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: name || '',
      role: normalizeRole(role),
      assigned_regions: [],
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
  });

  return user;
}

async function upsertProfile({ id, name, role }) {
  const payload = [{
    id,
    name: name || '',
    role: normalizeRole(role),
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
  if (patch.role != null) payload.role = normalizeRole(patch.role);

  const data = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=representation',
    },
    json: payload,
  });

  return Array.isArray(data) ? data[0] : data;
}

async function updateAuthUser(userId, patch = {}) {
  const current = await getAuthUser(userId);
  if (!current?.id) throw new Error('계정을 찾을 수 없습니다.');

  const currentMeta = current.user_metadata && typeof current.user_metadata === 'object'
    ? current.user_metadata
    : {};

  const nextMeta = { ...currentMeta };
  if (patch.name != null) nextMeta.display_name = String(patch.name || '').trim();
  if (patch.role != null) nextMeta.role = normalizeRole(patch.role);
  if (patch.assignedRegions != null) {
    nextMeta.assigned_regions = Array.isArray(patch.assignedRegions)
      ? patch.assignedRegions.filter(Boolean).map((v) => String(v))
      : [];
  }

  const body = { user_metadata: nextMeta };
  if (patch.password != null && String(patch.password || '').trim()) {
    body.password = String(patch.password || '');
  }
  if (patch.email != null && String(patch.email || '').trim()) {
    body.email = String(patch.email || '').trim();
  }

  const data = await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    json: body,
  });

  return data?.user || data || null;
}

async function getStaff(userId) {
  const [profile, user] = await Promise.all([
    getProfile(userId),
    getAuthUser(userId).catch(() => null),
  ]);
  if (!profile && !user) return null;
  return normalizeStaffItem({ profile, user });
}

async function updateStaff(userId, patch = {}) {
  await Promise.all([
    updateProfile(userId, patch),
    updateAuthUser(userId, patch),
  ]);
  return getStaff(userId);
}

async function getProfile(userId) {
  const rows = await supabaseFetch(`/rest/v1/profiles?select=id,name,role,created_at&id=eq.${encodeURIComponent(userId)}&limit=1`);
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
  listAuthUsers,
  getAuthUser,
  listStaff,
  createAuthUser,
  upsertProfile,
  updateProfile,
  updateAuthUser,
  updateStaff,
  getProfile,
  getStaff,
  deleteAuthUser,
};
