'use client';

import { createSupabaseClient } from './supabase';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

// ============================================
// 타입
// ============================================
export interface PricingTier {
  n_combos: number;
  price: number;
  label: string;
}

export interface DiversityOption {
  min_diff: number;
  label: string;
  description: string;
}

export interface RoundInfo {
  predict_round: number;
  pricing_tiers: PricingTier[];
  allowed_n_combos: number[];
  price_per_combo: number;
  diversity_options: DiversityOption[];
  default_min_diff: number;
  extraction_k: number;
  business_bank: string;
  business_account_number: string;
  business_account_holder: string;
}

export interface DepositInfo {
  bank: string;
  account_number: string;
  account_holder: string;
  deposit_name: string;
  amount: number;
}

export interface OrderPrepareResult {
  already_purchased: boolean;
  order_id: string;
  predict_round: number;
  amount?: number;
  n_combos?: number;
  min_diff?: number;
  deposit_info?: DepositInfo;
}

export interface CombinationDetail {
  numbers: number[];
  metrics: {
    total_sum: number;
    ac: number;
    odd_even: string;
    low_high: string;
    prime_count: number;
    palaces_used: number;
    colors_used: number;
    consecutive: number;
  };
}

export type OrderStatus = 'pending' | 'awaiting_deposit' | 'paid' | 'cancelled';

export interface Order {
  order_id: string;
  predict_round: number;
  amount: number;
  status: OrderStatus;
  n_combos: number;
  min_diff: number;
  combinations: number[][] | null;
  combinations_detail?: CombinationDetail[];
  deposit_name: string;
  deposit_marked_at: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  prev_round?: number;
}

export interface AdminOrder extends Order {
  user_id: string;
  approved_by: string | null;
}

export interface HistoryStats {
  meta: {
    n_rounds: number;
    round_range: [number, number];
  };
  continuous: {
    [key: string]: {
      n: number; min: number; max: number; mean: number; median: number; std: number;
      percentiles: { '5': number; '25': number; '50': number; '75': number; '95': number };
    };
  };
  discrete: {
    [key: string]: {
      n: number; mean: number; mode: number;
      distribution: { [value: number]: { count: number; pct: number } };
    };
  };
}

// ============================================
// 헬퍼
// ============================================
async function authHeaders(): Promise<HeadersInit> {
  const supabase = createSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('로그인이 필요합니다.');
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  };
}

/**
 * fetchJson — 공통 JSON 호출 헬퍼.
 *
 * v1.18: retry 옵션 추가 (콜드 스타트 504 방지).
 *   - 5xx 응답 또는 네트워크 throw 시 지수 백오프로 자동 재시도.
 *   - 4xx 는 사용자/요청 측 오류이므로 재시도 X (즉시 throw).
 *   - 기본값 retry=0 (기존 호출 동작 100% 보존 — POST/주문/결제 등 변경 없음).
 *   - GET helper 들(getRoundInfo, getExtractEngineInfo, getHistoryStats, getBusinessInfo)에서
 *     retry: 1 명시 — 사용자 화면 콜드 스타트 504 자동 복구.
 */
type FetchJsonOptions = RequestInit & {
  retry?: number;       // 5xx/네트워크 실패 시 재시도 횟수 (기본 0)
  retryDelay?: number;  // 첫 재시도 전 대기 ms (기본 1000, 이후 지수 증가)
};

async function fetchJson<T>(url: string, options?: FetchJsonOptions): Promise<T> {
  const { retry = 0, retryDelay = 1000, ...fetchOpts } = options || {};
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retry; attempt++) {
    if (attempt > 0) {
      // 지수 백오프: 1s → 2s → 4s ...
      await new Promise((r) => setTimeout(r, retryDelay * Math.pow(2, attempt - 1)));
    }

    try {
      const resp = await fetch(url, fetchOpts);
      if (resp.ok) {
        return resp.json();
      }

      // 메시지 추출 (응답 본문에 error 필드가 있으면 사용)
      let msg = `요청 실패 (${resp.status})`;
      try {
        const data = await resp.json();
        if (data?.error) msg = data.error;
      } catch {}

      // 5xx — 일시적 서버 오류로 간주, 재시도 가능
      if (resp.status >= 500 && resp.status < 600 && attempt < retry) {
        lastError = new Error(msg);
        continue;
      }

      // 4xx 또는 재시도 소진 — 즉시 throw
      throw new Error(msg);
    } catch (e) {
      // fetch 자체 throw (네트워크 차단·타임아웃·DNS 등) — 재시도 가능
      // 단, 위에서 throw 한 Error 가 여기로 다시 잡히면 안 되므로 별도 분기.
      if (e instanceof TypeError && attempt < retry) {
        // TypeError 는 브라우저 fetch 의 네트워크 실패 시그니처
        lastError = e;
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error('요청 실패');
}

// ============================================
// 공개 API
// ============================================
export async function getRoundInfo(): Promise<RoundInfo> {
  // v1.18: 콜드 스타트 504 자동 복구 (1회 재시도)
  return fetchJson(`${API_BASE}/api/round-info`, { retry: 1 });
}

export async function getHistoryStats(): Promise<HistoryStats> {
  // v1.18: 콜드 스타트 504 자동 복구 (1회 재시도)
  return fetchJson(`${API_BASE}/api/history-stats`, { retry: 1 });
}

// ============================================
// 사용자 API
// ============================================
export async function prepareOrder(
  n_combos: number,
  min_diff: number,
  deposit_name_prefix: string = '',
): Promise<OrderPrepareResult> {
  return fetchJson(`${API_BASE}/api/orders/prepare`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ n_combos, min_diff, deposit_name_prefix }),
  });
}

export async function markDeposit(orderId: string): Promise<{
  status: string;
  order_id: string;
  message?: string;
}> {
  return fetchJson(`${API_BASE}/api/orders/${orderId}/mark-deposit`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
}

export async function listOrders(): Promise<{ orders: Order[] }> {
  return fetchJson(`${API_BASE}/api/orders`, {
    headers: await authHeaders(),
  });
}

export async function getOrder(orderId: string): Promise<Order> {
  return fetchJson(`${API_BASE}/api/orders/${orderId}`, {
    headers: await authHeaders(),
  });
}

// ============================================
// 어드민 API
// ============================================
export async function adminListOrders(
  status?: OrderStatus,
  limit: number = 100,
): Promise<{ orders: AdminOrder[]; admin_user_id: string }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  return fetchJson(`${API_BASE}/api/admin/orders?${params}`, {
    headers: await authHeaders(),
  });
}

export async function adminApproveOrder(orderId: string): Promise<{
  status: string;
  order_id: string;
  combinations: number[][];
  n_combos: number;
}> {
  return fetchJson(`${API_BASE}/api/admin/orders/${orderId}/approve`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
}

export async function adminRejectOrder(orderId: string, reason: string = ''): Promise<{
  status: string;
  order_id: string;
  reason: string;
}> {
  return fetchJson(`${API_BASE}/api/admin/orders/${orderId}/reject`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ reason }),
  });
}

export async function adminGetStats(): Promise<{
  orders_by_status: Record<string, number>;
  today_paid_count: number;
  today_paid_amount: number;
}> {
  return fetchJson(`${API_BASE}/api/admin/stats`, {
    headers: await authHeaders(),
  });
}

// ============================================
// 메인/로그 페이지 — 추출엔진 정보 (1221회 34개 풀 + 직전 회차 + 누적 통계)
// 백엔드: GET /api/extract-engine-info (caching.py get_or_compute_extract_engine_info)
// ============================================
export interface PrizeBlock {
  prize_1: number;
  prize_2: number;
  prize_3: number;
  prize_4: number;
  prize_5: number;
}

export interface PrizeBlockWithCombos extends PrizeBlock {
  combos_total: number;
}

export interface PrizeBlockWithPoolSize extends PrizeBlock {
  pool_size_total: number;
}

export interface ExtractEngineInfo {
  current_round: number;
  /**
   * v1.25 stage1 expand 단계: 백엔드는 여전히 응답하지만 stage2 contract 단계에서 제거 예정.
   * 프론트는 길이만 필요 (값은 사용자에게 노출 X). 길이 비교는 current_pool_size 사용 권장.
   * @deprecated stage2 contract 후 백엔드에서 제거됨. current_pool_size 를 사용하세요.
   */
  current_pool?: number[];
  /** v1.25 신규 (stage1 백엔드 expand) — 현재 회차 추출 풀 크기. 메인/주문 페이지의 분석 카드 분기에 사용. */
  current_pool_size: number;
  next_draw_at: string;            // ISO8601 (다음 토요일 20:35 KST)
  previous_round: {
    round: number | null;
    winning_nums: number[] | null;
    bonus: number | null;
    extract_pool_match: number | null;   // 우리 풀 vs 본번호 일치 개수 (1220 이전: null)
    extract_bonus_match: boolean | null; // 우리 풀에 보너스 포함 여부 (1220 이전: null)
  };
  cumulative_stats: {
    standard_total: PrizeBlockWithPoolSize;
    paid_recommend: PrizeBlockWithCombos;
    paid_custom:    PrizeBlockWithCombos;
    extract_pool:   PrizeBlock;          // 누적 풀 적중 (회차 단위 카운트)
  };
}

export async function getExtractEngineInfo(): Promise<ExtractEngineInfo> {
  // v1.18: 메인 페이지 첫 화면의 콜드 스타트 504 자동 복구 — 핵심 변경점.
  // 백엔드 lifespan 워밍업 + BFF 타임아웃 15s 와 결합해 사용자 빨간 에러 화면 제거.
  return fetchJson(`${API_BASE}/api/extract-engine-info`, { retry: 1 });
}

// ============================================
// v1.19 — 최근 분석 처리 상태 (메인 페이지 분석 카드용)
// ============================================
// 백엔드 GET /api/recent-analysis-status 응답 구조.
// 분석 카드(ExtractEnginePoolCard) 가 적응형 polling 으로 호출하여
// 처리 4단계의 실제 백엔드 시각을 그대로 표시.
//
// 정직 원칙: 사용자가 보는 분석 카드 단계 시각 = DB 의 시각 (시뮬레이션 X).
export interface AnalysisPhases {
  data_load_at?: string | null;
  backtest_at?: string | null;
  pattern_scan_started_at?: string | null;
  pattern_scan_at?: string | null;
  pool_select_at?: string | null;
}

export interface RecentAnalysisStatus {
  round: number | null;             // 처리 중이거나 가장 최근 완료된 회차
  status: 'running' | 'standby';
  phases: AnalysisPhases | null;
  last_completed_round: number | null;
  last_completed_at: string | null; // 마지막 완료 시각 (pool_select_at)
}

export async function getRecentAnalysisStatus(): Promise<RecentAnalysisStatus> {
  // 콜드 스타트 504 자동 복구 (다른 GET 호출과 동일 패턴).
  return fetchJson(`${API_BASE}/api/recent-analysis-status`, { retry: 1 });
}

// ============================================
// 사업자 정보 (Phase 3 §C — 이용약관 / 개인정보처리방침 페이지용)
// 백엔드: public_bff.py → public.py /api/business-info
// 모두 환경변수 기반. mailorder_license 빈 문자열 = 통신판매업 미신고 상태.
// ============================================
export interface BusinessInfo {
  name: string;              // 상호 (예: "후추랩")
  reg_no: string;            // 사업자등록번호 (예: "546-03-03940")
  ceo: string;               // 대표자명 (예: "장현성")
  address: string;           // 사업장 주소
  contact_email: string;     // 고객센터 이메일
  mailorder_license: string; // 통신판매업 신고번호 — '' 이면 미신고 (페이지 측 placeholder 처리)
}

export async function getBusinessInfo(): Promise<BusinessInfo> {
  // v1.18: 콜드 스타트 504 자동 복구 (1회 재시도)
  return fetchJson(`${API_BASE}/api/business-info`, { retry: 1 });
}

// ============================================
// 어드민 — 당첨번호 입력 흐름 (5-5 → 5-6 → 5-7)
// 백엔드: admin_lotto_bff.py
//   5-5: POST /api/admin/lotto-history          (입력 + 즉시 풀 매칭, 1초 이내)
//   5-6: POST /api/admin/lotto-history/process  (백그라운드 표준풀 분석, ~24초)
//   5-7: GET  /api/admin/lotto-history/status   (5초 간격 polling)
// 모두 require_admin 인증 (Bearer JWT).
// ============================================
export interface AdminLottoHistoryInput {
  round: number;
  numbers: number[];      // 본번호 6개 (정렬 안 돼도 백엔드에서 처리)
  bonus: number;
  drawn_at?: string;      // 'YYYY-MM-DD' (선택, 미지정 시 백엔드가 KST 오늘로 처리)
}

export interface AdminLottoExtractMatch {
  main_match: number;
  bonus_match: boolean;
}

export interface AdminLottoPaidPrizes {
  combos: number;
  prizes: Record<string, number>;  // {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
}

export interface AdminLottoHistoryResult {
  round: number;
  status: 'pending';
  extract_match: AdminLottoExtractMatch;
  paid_summary: {
    recommend: AdminLottoPaidPrizes;
    custom:    AdminLottoPaidPrizes;
  };
  paid_matches: unknown[];
  message?: string;
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
  extract_pool: number[];
  extract_main_match: number;
  extract_bonus_match: boolean;
  calculated_at: string;
  recalculated_at: string | null;
}

export interface AdminLottoProcessResult {
  round: number;
  status: 'ready';
  engine_history: EngineHistoryRow;
  message?: string;
}

export type AdminLottoStatusValue = 'absent' | 'pending' | 'processing' | 'ready';

export interface AdminLottoStatusResult {
  round: number;
  status: AdminLottoStatusValue;
  engine_history: EngineHistoryRow | null;
}

// 5-5 어드민 당첨번호 입력 (즉시 풀 매칭).
export async function adminInputLottoHistory(
  input: AdminLottoHistoryInput,
): Promise<AdminLottoHistoryResult> {
  return fetchJson(`${API_BASE}/api/admin/lotto-history`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
}

// 5-6 백그라운드 표준풀 계산 트리거 (~24초). 응답은 'ready' 또는 504.
export async function adminProcessLottoHistory(
  round: number,
): Promise<AdminLottoProcessResult> {
  return fetchJson(`${API_BASE}/api/admin/lotto-history/process`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ round }),
  });
}

// 5-7 처리 상태 polling. 5초 간격 호출 → 'ready' 시 종료.
export async function adminLottoHistoryStatus(
  round: number,
): Promise<AdminLottoStatusResult> {
  return fetchJson(
    `${API_BASE}/api/admin/lotto-history/status?round=${encodeURIComponent(round)}`,
    {
      headers: await authHeaders(),
    },
  );
}

// ============================================
// §4-A 1단계 — DL 벤치마크 (어드민 전용)
// 백엔드: admin_dl_benchmark_bff.py → admin_dl_benchmark.py
// fit 시간 + 메모리 + Vercel 안전성 측정. 응답까지 60~250초 소요 가능.
// ============================================
export interface DLBenchmarkResult {
  model: 'mlp' | 'hybrid';
  data_load_seconds: number;
  fit_predict_seconds: number;
  total_seconds: number;
  peak_memory_mb: number;
  vercel_deadline_safe: boolean;
  memory_safe: boolean;
  predict_round: number;
  top_k_size: number;
  interpretation: string;
}

export async function benchmarkDLModel(
  model: 'mlp' | 'hybrid',
): Promise<DLBenchmarkResult> {
  return fetchJson(`${API_BASE}/api/admin/dl-benchmark`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ model }),
  });
}

// ============================================
// §4-A 3단계 — DL 백테스트 (어드민 전용)
// 직전 50회차 룰/MLP/Hybrid 풀 적중률 비교. 응답까지 5~250초 소요 가능.
// ============================================
export interface DLBacktestModelStats {
  first_prize_count: number;
  first_prize_rate: number;
  no_prize_count: number;
  avg_matches: number;
  paired_p_value_vs_rule?: number;
}

export interface DLBacktestBaseline {
  first_prize_count: number;
  first_prize_rate: number;
  no_prize_count: number;
  avg_matches_expected: number;
}

export interface DLBacktestResult {
  n_rounds: number;
  extraction_k: number;
  elapsed_seconds: number;
  rule: DLBacktestModelStats;
  mlp?: DLBacktestModelStats;
  hybrid?: DLBacktestModelStats;
  baseline_random: DLBacktestBaseline;
  adopted_model: string;
  interpretation: string;
}

export async function backtestDLModels(
  includeMlp: boolean,
  includeHybrid: boolean,
): Promise<DLBacktestResult> {
  return fetchJson(`${API_BASE}/api/admin/dl-backtest`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      include_mlp: includeMlp,
      include_hybrid: includeHybrid,
    }),
  });
}


// ============================================
// v1.25 stage2 — 34추출 번호 백엔드 endpoint 호출 (보안 강화 — 사장님 합의 2026-05-15)
// ============================================
// migration_v1.10 으로 engine_history.extract_pool 컬럼이 클라이언트 직접 조회에서 차단됨.
// v1.24 의 fetchRecentExtractPools / fetchRoundResultForOrder 는 제거되었고, 본 함수들로 대체.

/**
 * 구매 결과 페이지 — 본인 결제 회차의 34추출 번호 풀 조회.
 *
 * 응답 분기 (백엔드 orders.py :: get_order_extract_pool):
 *   - draw_completed=false : 추첨 전 → pool_positional[34] 모두 숫자 + draw_at(다음 추첨)
 *   - draw_completed=true  : 추첨 후 → pool_positional[34] 중 적중만 숫자/나머지 null
 *                            + winning_nums + bonus + hit_count + bonus_in_pool
 *
 * 인증: Bearer 토큰 (본인 paid 주문만)
 *
 * 에러:
 *   - 401: 미인증
 *   - 403: 본인 주문 아님 / paid 상태 아님
 *   - 404: 주문 없음
 *   - 503: 회차 분석 미완료 (드문 케이스)
 */
export interface OrderExtractPool {
  round: number;
  draw_completed: boolean;
  /** 정렬된 34개 위치. 추첨 후엔 미적중 자리가 null (보안: 미적중 번호 비공개) */
  pool_positional: (number | null)[];
  pool_size: number;
  /** 본번호 적중 개수 (추첨 전: null) */
  hit_count: number | null;
  /** 추첨 시각 ISO8601. 추첨 전엔 미래 시각(카운트다운용), 추첨 후엔 과거 시각 */
  draw_at: string;
  /** 추첨 후만 — 당첨 본번호 6개 */
  winning_nums: number[] | null;
  /** 추첨 후만 — 보너스 */
  bonus: number | null;
  /** 추첨 후만 — 보너스가 풀 안에 있었는지 (정직 표시) */
  bonus_in_pool: boolean | null;
}

export async function getOrderExtractPool(orderId: string): Promise<OrderExtractPool> {
  return fetchJson(`${API_BASE}/api/orders/${orderId}/extract-pool`, {
    headers: await authHeaders(),
    retry: 1,
  });
}

/**
 * 관리자 페이지 — 최근 N회차의 34추출 번호 카드용.
 *
 * 인증: Bearer 토큰 + ADMIN_USER_IDS 등록 사용자만 (백엔드 require_admin)
 *
 * 에러:
 *   - 400: limit 범위 초과 (1~50)
 *   - 401: 미인증
 *   - 403: 관리자 권한 없음
 */
export interface AdminPoolRow {
  round: number;
  drawn_at: string;          // 'YYYY-MM-DD'
  extract_pool: number[];    // 34개 (관리자에게만 전체 노출)
  n1: number; n2: number; n3: number;
  n4: number; n5: number; n6: number;
  bonus: number;
  extract_main_match: number;  // 풀 안 본번호 일치 개수
  extract_bonus_match: boolean;
}

export async function adminListRecentPools(limit: number = 5): Promise<{ rounds: AdminPoolRow[] }> {
  return fetchJson(`${API_BASE}/api/admin/recent-pools?limit=${limit}`, {
    headers: await authHeaders(),
    retry: 1,
  });
}
