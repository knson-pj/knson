// ════════════════════════════════════════════════════════════════════════
// api/_lib/admin-tier.js — 관리자 tier 권한 체크 (2026-05-08)
// ────────────────────────────────────────────────────────────────────────
// 저장 위치 : auth.users.raw_app_meta_data.admin_tier (master | basic | list)
// 적용 시점 : 모든 admin API 의 CUD(Create/Update/Delete) 메서드 진입 시점
// 응답      : 권한 부족 시 403 응답 자동 전송 후 false 반환 (호출부는 return 만)
//
// resourceKey 매트릭스:
//   ┌──────────────┬─ master ─┬─ list ─┬─ basic ─┐
//   │ properties   │   ✅     │  ✅    │  ❌     │  물건 등록/수정/삭제 (CSV/사진/동영상/활동로그 포함)
//   │ regions      │   ✅     │  ✅    │  ❌     │  물건 배정 (region-assignments / assignment-batches)
//   │ staff        │   ✅     │  ❌    │  ❌     │  담당자 추가/수정/삭제
//   │ valuation    │   ✅     │  ❌    │  ❌     │  가격평가 데이터 적재/실행
//   │ api_collect  │   ✅     │  ❌    │  ❌     │  건축물대장/온비드/지오코딩 실행 (보기는 GET 으로 통과)
//   │ self         │   ✅     │  ✅    │  ✅     │  자기 정보(비밀번호/이름) 수정
//   └──────────────┴──────────┴────────┴─────────┘
// 주의: 'self' 는 user_id 가 ctx.userId 와 일치하는지 추가 검증 필요 (호출부에서 처리)
// ════════════════════════════════════════════════════════════════════════

const { send } = require('./utils');

const VALID_TIERS = ['master', 'basic', 'list'];

const TIER_PERMISSIONS = {
  master: 'all', // 모든 리소스 CUD 가능
  list:   ['properties', 'regions', 'self'],
  basic:  ['self'],
};

/**
 * tier 가 해당 resourceKey 에 대한 쓰기(CUD) 권한이 있는지 확인.
 * @param {string} tier - 'master' | 'basic' | 'list' (대소문자 무관, 미지정 시 basic 으로 강등)
 * @param {string} resourceKey - 'properties' | 'regions' | 'staff' | 'valuation' | 'api_collect' | 'self'
 * @returns {boolean}
 */
function canTierWrite(tier, resourceKey) {
  const t = normalizeTier(tier);
  const perms = TIER_PERMISSIONS[t];
  if (!perms) return false;
  if (perms === 'all') return true;
  return Array.isArray(perms) && perms.includes(String(resourceKey || '').trim().toLowerCase());
}

/**
 * tier 표기 정규화. 미지정/이상한 값은 'basic' 으로 강등(보안 기본값 가장 제한적).
 */
function normalizeTier(tier) {
  const t = String(tier || '').trim().toLowerCase();
  return VALID_TIERS.includes(t) ? t : 'basic';
}

/**
 * API endpoint 진입 시점에서 권한 체크. 통과하면 true, 실패하면 403 응답 후 false.
 * 호출부 패턴:
 *   if (!requireTierWrite(session, 'properties', res)) return;
 *
 * @param {object} session - requireSupabaseAdmin() 반환 객체 (adminTier 포함)
 * @param {string} resourceKey
 * @param {object} res - Node.js response object
 * @returns {boolean}
 */
function requireTierWrite(session, resourceKey, res) {
  const tier = normalizeTier(session?.adminTier);
  if (canTierWrite(tier, resourceKey)) return true;
  send(res, 403, {
    ok: false,
    code: 'TIER_FORBIDDEN',
    message: '이 작업을 수행할 권한이 없습니다.',
    resource: resourceKey,
    tier,
  });
  return false;
}

/**
 * staff/admin 양쪽이 사용하는 endpoint(예: api/properties.js) 용 변형:
 *   - ctx.role !== 'admin' 이면 통과 (staff 권한 로직은 호출부가 자체 처리)
 *   - admin 이면 adminTier 기준으로 체크
 *
 * @param {object} ctx - resolveCurrentUserContext() 반환 객체 (role, adminTier 포함)
 * @param {string} resourceKey
 * @param {object} res
 * @returns {boolean}
 */
function requireCtxTierWrite(ctx, resourceKey, res) {
  if (ctx?.role !== 'admin') return true; // staff/기타: 호출부에서 자체 권한 체크
  return requireTierWrite(ctx, resourceKey, res);
}

module.exports = {
  VALID_TIERS,
  TIER_PERMISSIONS,
  canTierWrite,
  normalizeTier,
  requireTierWrite,
  requireCtxTierWrite,
};
