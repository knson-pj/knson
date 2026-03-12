const { send } = require('./utils');

function cleanTokenLike(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^Bearer\s+/i, '').trim();
  return s;
}

function getEnv() {
  const url = String(
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();

  const serviceRoleKey = cleanTokenLike(
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  const anonKey = cleanTokenLike(
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY_PUBLIC ||
    ''
  );

  return { url, serviceRoleKey, anonKey };
}

function hasSupabaseAdminEnv() {
  const env = getEnv();
  return !!(env.url && env.serviceRoleKey);
}

function readBearer(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? cleanTokenLike(m[1] || '') : '';
}

function buildHeaders({ token, useAnon = false, hasJson = false, extra = {} } = {}) {
  const { serviceRoleKey, anonKey } = getEnv();
  const apikey = cleanTokenLike(useAnon ? (anonKey || serviceRoleKey) : serviceRoleKey);
  const authorization = cleanTokenLike(token || serviceRoleKey);

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
  const { url, serviceRoleKey, anonKey } = getEnv();
  if (!url) throw new Error('SUPABASE_URL 이 설정되지 않았습니다.');
  if (path.startsWith('/auth/v1/admin') && !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.');
  }
  if (options.useAnon && !(anonKey || serviceRoleKey)) {
    throw new Error('SUPABASE_ANON_KEY 또는 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.');
  }

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
    let message = (data && (data.msg || data.message || data.error_description || data.error)) || `Supabase API 오류 (${res.status})`;
    if (/valid bearer token/i.test(String(message || ''))) {
      if (path.startsWith('/auth/v1/admin')) {
        message = 'Supabase 관리자 API 인증에 실패했습니다. Vercel의 SUPABASE_SERVICE_ROLE_KEY 값을 다시 확인해 주세요.';
      } else if (options.useAnon) {
        message = 'Supabase 사용자 토큰이 유효하지 않습니다. 다시 로그인해 주세요.';
      }
    }
    const err = new Error(message);
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

function normalizeRole(role) {
  const s = String(role || '').trim().toLowerCase();
  if (!s) return '';
  if (['admin', '관리자'].includes(s)) return 'admin';
  if (['agent', 'staff', '담당자'].includes(s)) return 'staff';
  return '';
}

function extractRoleCandidate(user) {
  if (!user || typeof user !== 'object') return '';
  return String(
    user?.app_metadata?.role ||
    user?.user_metadata?.role ||
    user?.role ||
    ''
  ).trim();
}

function extractDisplayName(user) {
  return String(
    user?.user_metadata?.display_name ||
    user?.email ||
    ''
  ).trim();
}

function mergeRoles(...roles) {
  const normalized = roles.map((v) => normalizeRole(v)).filter(Boolean);
  if (normalized.includes('admin')) return 'admin';
  if (normalized.includes('staff')) return 'staff';
  return '';
}

function pickRoleFromUser(user) {
  return mergeRoles(extractRoleCandidate(user)) || 'staff';
}

function pickDisplayName({ profile, user }) {
  return (
    profile?.name ||
    extractDisplayName(user) ||
    ''
  );
}

function isProfileReadIssue(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('stack depth') ||
    msg.includes('infinite recursion') ||
    msg.includes('policy') ||
    msg.includes('profiles') ||
    msg.includes('does not exist')
  );
}

async function safeGetProfile(userId) {
  try {
    const rows = await supabaseFetch(`/rest/v1/profiles?select=id,name,role,created_at&id=eq.${encodeURIComponent(userId)}&limit=1`);
    return Array.isArray(rows) ? (rows[0] || null) : null;
  } catch (err) {
    if (isProfileReadIssue(err)) return null;
    throw err;
  }
}

async function safeListProfiles() {
  try {
    const rows = await supabaseFetch('/rest/v1/profiles?select=id,name,role,created_at&order=created_at.desc.nullslast,name.asc');
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (isProfileReadIssue(err)) return [];
    throw err;
  }
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

async function resolveCurrentUserContext(req) {
  const bearerUser = await verifySupabaseUser(req);
  if (!bearerUser?.id) return null;

  const adminUser = await getAuthUser(bearerUser.id).catch(() => null);
  const authUser = adminUser || bearerUser;

  const authRole = mergeRoles(
    extractRoleCandidate(authUser),
    extractRoleCandidate(bearerUser)
  );

  const authName = pickDisplayName({ profile: null, user: authUser || bearerUser });
  const needsProfileFallback = !authRole || !authName;

  let profile = null;
  if (needsProfileFallback) {
    profile = await safeGetProfile(bearerUser.id);
  }

  const role = mergeRoles(authRole, profile?.role) || 'staff';

  return {
    userId: bearerUser.id,
    email: authUser?.email || bearerUser?.email || '',
    name: pickDisplayName({ profile, user: authUser || bearerUser }),
    role,
    assignedRegions: pickAssignedRegionsFromUser(authUser || bearerUser),
    authUser,
    bearerUser,
    profile,
  };
}

async function requireSupabaseAdmin(req, res) {
  let ctx = null;
  try {
    ctx = await resolveCurrentUserContext(req);
  } catch (err) {
    send(res, 500, { ok: false, message: err.message || '프로필 조회에 실패했습니다.' });
    return null;
  }

  if (!ctx?.userId) {
    send(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }

  if (ctx.role !== 'admin') {
    send(res, 403, { ok: false, message: '관리자 권한이 필요합니다.' });
    return null;
  }

  return {
    userId: ctx.userId,
    role: ctx.role,
    name: ctx.name,
    email: ctx.email,
  };
}

async function listProfiles() {
  return safeListProfiles();
}

function pickAssignedRegionsFromUser(user) {
  const regions = user?.user_metadata?.assigned_regions;
  return Array.isArray(regions) ? regions.filter(Boolean).map((v) => String(v)) : [];
}

function normalizeStaffItem({ profile, user }) {
  return {
    id: profile?.id || user?.id || '',
    email: user?.email || '',
    name: pickDisplayName({ profile, user }),
    role: mergeRoles(extractRoleCandidate(user), profile?.role) || 'staff',
    assignedRegions: pickAssignedRegionsFromUser(user),
    createdAt: profile?.created_at || user?.created_at || '',
  };
}

async function listStaff() {
  const users = await listAuthUsers();
  const needProfiles = users.some((user) => {
    const role = mergeRoles(extractRoleCandidate(user));
    const name = pickDisplayName({ profile: null, user });
    return !role || !name;
  });

  const profiles = needProfiles ? await safeListProfiles() : [];
  const profileMap = new Map((profiles || []).map((row) => [String(row.id), row]));
  const seenIds = new Set();
  const seenEmails = new Set();
  const items = [];

  for (const user of users) {
    const id = String(user?.id || '');
    const emailKey = String(user?.email || '').trim().toLowerCase();
    if (!id) continue;
    if (seenIds.has(id)) continue;
    if (emailKey && seenEmails.has(emailKey)) continue;

    const role = mergeRoles(extractRoleCandidate(user));
    const name = pickDisplayName({ profile: null, user });
    const profile = (!role || !name) ? (profileMap.get(id) || null) : null;
    items.push(normalizeStaffItem({ profile, user }));

    seenIds.add(id);
    if (emailKey) seenEmails.add(emailKey);
    if (profile) profileMap.delete(id);
  }

  // profiles 테이블에 과거/고아 row가 남아 있어도 실제 로그인 가능한 계정(Auth user)이 아니면
  // 담당자 목록에 다시 합치지 않습니다. 그렇지 않으면 동일 인물이 2번 보일 수 있습니다.
  if (!items.length && profileMap.size) {
    for (const [id, profile] of profileMap.entries()) {
      if (!id || seenIds.has(id)) continue;
      items.push(normalizeStaffItem({ profile, user: { id } }));
      seenIds.add(id);
    }
  }

  items.sort((a, b) => {
    const ad = new Date(a.createdAt || 0).getTime();
    const bd = new Date(b.createdAt || 0).getTime();
    return (Number.isFinite(bd) ? bd : 0) - (Number.isFinite(ad) ? ad : 0);
  });

  return items;
}

async function createAuthUser({ email, password, name, role }) {
  const normalizedRole = normalizeRole(role) || 'staff';
  const body = {
    email,
    password,
    email_confirm: true,
    app_metadata: {
      role: normalizedRole,
    },
    user_metadata: {
      display_name: name || '',
      role: normalizedRole,
      assigned_regions: [],
    },
  };

  const data = await supabaseFetch('/auth/v1/admin/users', {
    method: 'POST',
    json: body,
  });

  const user = data?.user || data;
  if (!user?.id) throw new Error('Supabase 계정 생성 응답이 올바르지 않습니다.');

  try {
    await upsertProfile({
      id: user.id,
      name,
      role: normalizedRole,
    });
  } catch (err) {
    if (!isProfileReadIssue(err)) throw err;
  }

  return user;
}

async function upsertProfile({ id, name, role }) {
  const payload = [{
    id,
    name: name || '',
    role: normalizeRole(role) || 'staff',
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
  if (patch.role != null) payload.role = normalizeRole(patch.role) || 'staff';
  if (!Object.keys(payload).length) return null;

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
  const currentAppMeta = current.app_metadata && typeof current.app_metadata === 'object'
    ? current.app_metadata
    : {};

  const nextMeta = { ...currentMeta };
  const nextAppMeta = { ...currentAppMeta };
  if (patch.name != null) nextMeta.display_name = String(patch.name || '').trim();
  if (patch.role != null) {
    const role = normalizeRole(patch.role) || 'staff';
    nextMeta.role = role;
    nextAppMeta.role = role;
  }
  if (patch.assignedRegions != null) {
    nextMeta.assigned_regions = Array.isArray(patch.assignedRegions)
      ? patch.assignedRegions.filter(Boolean).map((v) => String(v))
      : [];
  }

  const body = {
    user_metadata: nextMeta,
    app_metadata: nextAppMeta,
  };
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
  const user = await getAuthUser(userId).catch(() => null);
  let profile = null;
  if (user) {
    const role = mergeRoles(extractRoleCandidate(user));
    const name = pickDisplayName({ profile: null, user });
    if (!role || !name) profile = await safeGetProfile(userId).catch(() => null);
  } else {
    profile = await safeGetProfile(userId).catch(() => null);
  }
  if (!profile && !user) return null;
  return normalizeStaffItem({ profile, user });
}

async function updateStaff(userId, patch = {}) {
  await updateAuthUser(userId, patch);
  try {
    await updateProfile(userId, patch);
  } catch (err) {
    if (!isProfileReadIssue(err)) throw err;
  }
  return getStaff(userId);
}

async function getProfile(userId) {
  return safeGetProfile(userId);
}

async function deleteAuthUser(userId) {
  await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  return true;
}

module.exports = {
  cleanTokenLike,
  getEnv,
  hasSupabaseAdminEnv,
  readBearer,
  verifySupabaseUser,
  requireSupabaseAdmin,
  resolveCurrentUserContext,
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
