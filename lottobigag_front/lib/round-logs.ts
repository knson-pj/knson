'use client';

import { createSupabaseClient } from './supabase';

/**
 * v1.23 — 회차별 추첨 결과 + 풀 매칭 데이터 조회 헬퍼.
 *
 * 사용처:
 *   - app/page.tsx       : 직전 회차 카드 1건 + 백테스트 로그 4건 (총 4회차)
 *   - app/order/page.tsx : 직전 회차 카드 1건 (총 1회차)
 *
 * v1.25 stage2 변경 (사장님 합의 2026-05-15 — 34추출 번호 보안 강화):
 *   - v1.24 에서 추가했던 fetchRecentExtractPools / fetchRoundResultForOrder 두 함수 제거
 *     (engine_history.extract_pool 컬럼 권한 회수 정책 — migration_v1.10.sql)
 *   - 대신 백엔드 endpoint 경유:
 *       관리자 페이지 : lib/api.ts :: adminListRecentPools(limit)  → GET /api/admin/recent-pools
 *       결과 페이지   : lib/api.ts :: getOrderExtractPool(orderId) → GET /api/orders/{id}/extract-pool
 *   - 본 파일은 fetchRecentRoundLogs (백테스트 로그 + 직전 회차 카드용 — extract_pool 미사용) 그대로 유지
 *
 * 다음 세션 리팩터링 후보: app/log/page.tsx 의 인라인 조회를 이 함수로 통합 권장.
 * (log 페이지는 50회차 + extract-engine-info 까지 함께 호출하므로 시그니처를 확장해야 함)
 *
 * 데이터 흐름 (log/page.tsx 와 동일 패턴):
 *   1. lotto_history 테이블에서 최근 N회차 desc 조회 (전체 회차 — CSV 임포트 포함)
 *   2. engine_history 테이블에서 같은 회차 범위 조회 (1221회 이후만 매칭 데이터 보유)
 *   3. 클라이언트 측에서 round 기준 left-join
 *   4. engine_history 가 없는 회차(1220 이전)는 결과에서 제외 (메인·주문 페이지는 모두 1221회 이후 의미)
 *
 * 보안 (v1.25 stage2 갱신):
 *   - 본 함수가 SELECT 하는 engine_history 컬럼은 모두 anon/authenticated SELECT 권한 유지된 컬럼
 *   - extract_pool 컬럼은 본 SELECT 에 미포함 → migration_v1.10 권한 회수 영향 0
 *
 * 정직 원칙:
 *   - 백엔드 API 의 extractInfo.previous_round 대신 Supabase 직접 조회 사용 시
 *     log/page.tsx 와 동일한 데이터 소스를 보게 되어 로그/메인 페이지 수치 정합 보장
 */

// ============================================
// 타입 — log/page.tsx 와 동일 구조 (Supabase 컬럼명 그대로)
// ============================================
export interface LottoHistoryRow {
  round: number;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  n6: number;
  bonus: number;
  drawn_at: string; // 'YYYY-MM-DD'
}

export interface EngineHistoryRow {
  round: number;
  standard_pool_size: number;
  standard_prize_1: number;
  standard_prize_2: number;
  standard_prize_3: number;
  standard_prize_4: number;
  standard_prize_5: number;
  paid_recommend_combos: number;
  paid_recommend_prize_1: number;
  paid_recommend_prize_2: number;
  paid_recommend_prize_3: number;
  paid_recommend_prize_4: number;
  paid_recommend_prize_5: number;
  paid_custom_combos: number;
  paid_custom_prize_1: number;
  paid_custom_prize_2: number;
  paid_custom_prize_3: number;
  paid_custom_prize_4: number;
  paid_custom_prize_5: number;
  extract_main_match: number;
  extract_bonus_match: boolean;
}

/** lotto_history × engine_history 좌측 외부 조인 결과 — 회차 단위 표시용 */
export interface RoundLogRow extends LottoHistoryRow {
  eh: EngineHistoryRow | null;
}

// ============================================
// 회차 + 풀 매칭 조회 — 메인·주문 페이지 공통
// ============================================

const EH_SELECT_COLUMNS =
  'round, standard_pool_size, ' +
  'standard_prize_1, standard_prize_2, standard_prize_3, ' +
  'standard_prize_4, standard_prize_5, ' +
  'paid_recommend_combos, ' +
  'paid_recommend_prize_1, paid_recommend_prize_2, paid_recommend_prize_3, ' +
  'paid_recommend_prize_4, paid_recommend_prize_5, ' +
  'paid_custom_combos, ' +
  'paid_custom_prize_1, paid_custom_prize_2, paid_custom_prize_3, ' +
  'paid_custom_prize_4, paid_custom_prize_5, ' +
  'extract_main_match, extract_bonus_match';

/**
 * 최근 N 회차의 추첨 결과 + 풀 매칭 데이터를 desc 순으로 반환.
 * engine_history 가 없는 회차(1220 이전 CSV 임포트)는 결과에서 제외.
 *
 * @param limit 가져올 회차 수 (메인: 4 / 주문: 1 / log: 50)
 * @throws Supabase 조회 실패 시 throw
 */
export async function fetchRecentRoundLogs(
  limit: number,
): Promise<RoundLogRow[]> {
  const supabase = createSupabaseClient();

  // 두 테이블 병렬 조회 — log/page.tsx 와 동일 패턴
  const [lhRes, ehRes] = await Promise.all([
    supabase
      .from('lotto_history')
      .select('round, n1, n2, n3, n4, n5, n6, bonus, drawn_at')
      .order('round', { ascending: false })
      .limit(limit),
    supabase
      .from('engine_history')
      .select(EH_SELECT_COLUMNS)
      .order('round', { ascending: false })
      .limit(limit),
  ]);

  if (lhRes.error) {
    throw new Error(`당첨번호 조회 실패: ${lhRes.error.message}`);
  }
  if (ehRes.error) {
    throw new Error(`풀 매칭 데이터 조회 실패: ${ehRes.error.message}`);
  }

  // round 기준 EH map 구성
  // Supabase select 문자열이 길어 타입 추론이 fallback 되므로 명시적 캐스팅
  // (RLS Public read 보장된 schema 라 안전 — log/page.tsx 패턴과 동일)
  const ehMap = new Map<number, EngineHistoryRow>();
  for (const eh of (ehRes.data ?? []) as unknown as EngineHistoryRow[]) {
    ehMap.set(eh.round, eh);
  }

  // 1221회 이후 (engine_history 매칭) 회차만 반환
  // 1220 이전 CSV 임포트 회차는 34추출엔진 매칭이 없어 PrevRoundCard·백테스트 로그에서 의미 없음
  const joined: RoundLogRow[] = (
    (lhRes.data ?? []) as unknown as LottoHistoryRow[]
  )
    .map((lh) => ({ ...lh, eh: ehMap.get(lh.round) ?? null }))
    .filter((r) => r.eh !== null);

  return joined;
}
