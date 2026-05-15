'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { createSupabaseClient } from '@/lib/supabase';
import {
  adminListOrders,
  adminApproveOrder,
  adminRejectOrder,
  adminGetStats,
  adminInputLottoHistory,
  adminProcessLottoHistory,
  adminLottoHistoryStatus,
  benchmarkDLModel,
  backtestDLModels,
  getRoundInfo,
  adminListRecentPools,
  type AdminOrder,
  type OrderStatus,
  type AdminLottoHistoryResult,
  type DLBenchmarkResult,
  type DLBacktestResult,
  type AdminPoolRow,
} from '@/lib/api';

export default function AdminPage() {
  const router = useRouter();
  const supabase = createSupabaseClient();

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [stats, setStats] = useState<{
    orders_by_status: Record<string, number>;
    today_paid_count: number;
    today_paid_amount: number;
  } | null>(null);
  const [filter, setFilter] = useState<OrderStatus>('awaiting_deposit');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  // ============================================
  // 어드민 당첨번호 입력 카드 — 5-5 → 5-6 → 5-7 자동 흐름
  // ============================================
  // predict_round 자동 채움 (수정 불가) — 백엔드 round 일치 검증 보호
  const [predictRound, setPredictRound] = useState<number | null>(null);
  // 본번호 6칸 — string 보관 (빈 칸 vs 0 구분, 사용자 typing 보존)
  const [inputNumbers, setInputNumbers] = useState<string[]>(['', '', '', '', '', '']);
  const [inputBonus, setInputBonus] = useState<string>('');
  const [inputDrawnAt, setInputDrawnAt] = useState<string>(''); // 'YYYY-MM-DD' 또는 '' (서버 KST 오늘)
  // 처리 단계: idle | inserting(5-5) | computing(5-6) | polling(5-7) | done | error
  type InputPhase = 'idle' | 'inserting' | 'computing' | 'polling' | 'done' | 'error';
  const [inputPhase, setInputPhase] = useState<InputPhase>('idle');
  const [inputMessage, setInputMessage] = useState<string | null>(null);
  const [inputResult, setInputResult] = useState<AdminLottoHistoryResult | null>(null);

  // ============================================
  // 표준풀 재계산 카드 — 5-6 미완료 회차 (recalculated_at IS NULL) 재트리거
  // ============================================
  type PendingRoundRow = {
    round: number;
    extract_main_match: number;
    extract_bonus_match: boolean;
  };
  const [pendingRounds, setPendingRounds] = useState<PendingRoundRow[]>([]);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [recalcRound, setRecalcRound] = useState<number | null>(null);   // 현재 처리 중 회차
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [recalcPhase, setRecalcPhase] = useState<'idle' | 'computing' | 'polling' | 'done' | 'error'>('idle');

  // ============================================
  // v1.24 — 회차별 34추출 번호 카드 (최근 5회차)
  // v1.25 stage2 — Supabase 직접 조회 → 백엔드 GET /api/admin/recent-pools 경유 (보안 강화)
  // ============================================
  const [recentPools, setRecentPools] = useState<AdminPoolRow[]>([]);
  const [poolsError, setPoolsError] = useState<string | null>(null);

  // ============================================
  // DL 벤치마크 카드 (§4-A 1단계 — fit 시간/메모리 측정)
  // ============================================
  const [dlBenchModel, setDlBenchModel] = useState<'mlp' | 'hybrid' | null>(null);  // 측정 중 모델
  const [dlBenchResult, setDlBenchResult] = useState<DLBenchmarkResult | null>(null);
  const [dlBenchError, setDlBenchError] = useState<string | null>(null);
  const [dlBenchElapsed, setDlBenchElapsed] = useState<number>(0);  // 측정 경과 시간 (초, UI 표시용)

  // ============================================
  // DL 백테스트 카드 (§4-A 3단계 — 룰/MLP/Hybrid 적중률 비교)
  // ============================================
  type BacktestModelChoice = 'rule_only' | 'rule_hybrid' | 'rule_mlp' | 'all';
  const [dlBackChoice, setDlBackChoice] = useState<BacktestModelChoice | null>(null);  // 측정 중 선택
  const [dlBackResult, setDlBackResult] = useState<DLBacktestResult | null>(null);
  const [dlBackError, setDlBackError] = useState<string | null>(null);
  const [dlBackElapsed, setDlBackElapsed] = useState<number>(0);

  const load = useCallback(async () => {
    try {
      const [{ orders }, statsData, roundInfo, pendingRes, recentPoolsRes] = await Promise.all([
        adminListOrders(filter, 100),
        adminGetStats(),
        getRoundInfo(),  // predict_round 동기화 — 5-5 입력 후 자동 갱신
        // 미완료 회차 (5-6 분석 대기) — Supabase 직접 read (RLS Public)
        // engine_history 의 통계 컬럼만 SELECT — extract_pool 미사용 → migration_v1.10 영향 0
        supabase
          .from('engine_history')
          .select('round, extract_main_match, extract_bonus_match')
          .is('recalculated_at', null)
          .order('round', { ascending: true }),
        // v1.25 stage2 — 백엔드 endpoint 경유 (Bearer 토큰 + ADMIN_USER_IDS 검증)
        // 실패 시 빈 배열 fallback, 다른 영역은 정상 노출
        adminListRecentPools(5)
          .then((r) => r.rounds)
          .catch((e: any) => {
            setPoolsError(e.message || '회차별 추출 풀 조회 실패');
            return [] as AdminPoolRow[];
          }),
      ]);
      setOrders(orders);
      setStats(statsData);
      setPredictRound(roundInfo.predict_round);
      if (pendingRes.error) {
        setPendingError(pendingRes.error.message);
      } else {
        setPendingRounds((pendingRes.data ?? []) as PendingRoundRow[]);
        setPendingError(null);
      }
      setRecentPools(recentPoolsRes);
      if (recentPoolsRes.length > 0) setPoolsError(null);
    } catch (e: any) {
      setError(e.message || '데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [filter, supabase]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login?redirect=/admin');
        return;
      }
      await load();
    })();
  }, [router, supabase, load]);

  const handleApprove = async (orderId: string) => {
    if (!confirm('이 주문을 승인하시겠습니까? 조합이 자동 생성됩니다.')) return;
    setActingOnId(orderId);
    try {
      await adminApproveOrder(orderId);
      await load();
    } catch (e: any) {
      alert(e.message || '승인 실패');
    } finally {
      setActingOnId(null);
    }
  };

  const handleReject = async (orderId: string) => {
    const reason = prompt('취소 사유 (선택):') ?? '';
    if (!confirm('이 주문을 취소 처리하시겠습니까? (취소 불가)')) return;
    setActingOnId(orderId);
    try {
      await adminRejectOrder(orderId, reason);
      await load();
    } catch (e: any) {
      alert(e.message || '취소 처리 실패');
    } finally {
      setActingOnId(null);
    }
  };

  // ============================================
  // 어드민 당첨번호 입력 흐름 — 5-5 → 5-6 → 5-7
  // 5-6 (24초) 동기 호출 정상 / 504 timeout 시 5-7 polling fallback (5초 간격, 3분 한도)
  // ============================================
  const handleLottoSubmit = async () => {
    // 1. 클라이언트 검증 (백엔드 검증 이중 방어 — 작업 규칙 #2)
    if (predictRound === null) {
      setInputMessage('예측 회차를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
      setInputPhase('error');
      return;
    }
    const numbers = inputNumbers.map((s) => parseInt(s, 10));
    if (numbers.some((n) => isNaN(n))) {
      setInputMessage('본번호 6개를 모두 입력하세요.');
      setInputPhase('error');
      return;
    }
    if (numbers.some((n) => n < 1 || n > 45)) {
      setInputMessage('본번호는 1~45 범위여야 합니다.');
      setInputPhase('error');
      return;
    }
    if (new Set(numbers).size !== 6) {
      setInputMessage('본번호 6개는 중복되지 않아야 합니다.');
      setInputPhase('error');
      return;
    }
    const bonus = parseInt(inputBonus, 10);
    if (isNaN(bonus) || bonus < 1 || bonus > 45) {
      setInputMessage('보너스는 1~45 범위로 입력하세요.');
      setInputPhase('error');
      return;
    }
    if (numbers.includes(bonus)) {
      setInputMessage('보너스는 본번호와 중복될 수 없습니다.');
      setInputPhase('error');
      return;
    }
    const sortedPreview = [...numbers].sort((a, b) => a - b);
    if (
      !confirm(
        `${predictRound}회 당첨번호를 입력합니다.\n` +
          `본번호: ${sortedPreview.join(', ')}\n` +
          `보너스: ${bonus}\n` +
          (inputDrawnAt ? `추첨일: ${inputDrawnAt}\n` : '추첨일: 오늘 (서버 KST)\n') +
          `\n진행하시겠습니까? (취소 불가)`,
      )
    ) {
      return;
    }

    // 2. 5-5 입력 + 즉시 풀 매칭
    setInputPhase('inserting');
    setInputMessage('당첨번호 저장 중...');
    setInputResult(null);

    let r5_5: AdminLottoHistoryResult;
    try {
      r5_5 = await adminInputLottoHistory({
        round: predictRound,
        numbers,
        bonus,
        drawn_at: inputDrawnAt || undefined,
      });
    } catch (e: any) {
      setInputPhase('error');
      setInputMessage(`5-5 입력 실패: ${e.message || '알 수 없는 오류'}`);
      return;
    }
    setInputResult(r5_5);
    setInputMessage(
      `풀 매칭 완료 — 풀 vs 본번호 ${r5_5.extract_match.main_match}개 적중, ` +
        `보너스 ${r5_5.extract_match.bonus_match ? '포함' : '미포함'}. ` +
        `표준풀 분석 시작 (~24초)...`,
    );

    // 3. 5-6 백그라운드 표준풀 계산 (~24초, Vercel cold start 시 +10초 가능)
    setInputPhase('computing');
    let r5_6_ok = false;
    try {
      await adminProcessLottoHistory(predictRound);
      r5_6_ok = true;
    } catch (e: any) {
      const msg: string = e.message || '';
      // 504 timeout / 시간 초과 → 5-7 polling fallback
      if (!/504|시간 초과|timeout/i.test(msg)) {
        setInputPhase('error');
        setInputMessage(`5-6 분석 실패: ${msg}`);
        return;
      }
    }

    // 4. 5-7 polling fallback (5-6 504 timeout 시)
    if (!r5_6_ok) {
      setInputPhase('polling');
      setInputMessage('표준풀 분석 진행 중 (5초 간격 확인)...');
      const start = Date.now();
      const TIMEOUT_MS = 180_000; // 3분 한도
      while (Date.now() - start < TIMEOUT_MS) {
        await new Promise((res) => setTimeout(res, 5000));
        try {
          const status = await adminLottoHistoryStatus(predictRound);
          if (status.status === 'ready') {
            r5_6_ok = true;
            break;
          }
        } catch (e: any) {
          // polling 중 일시적 오류는 무시 (다음 사이클 재시도). 3분 한도까지.
        }
      }
      if (!r5_6_ok) {
        setInputPhase('error');
        setInputMessage('표준풀 분석이 3분 안에 완료되지 않았습니다. 운영자에게 문의하세요.');
        return;
      }
    }

    // 5. 완료 — 폼 초기화 + predict_round/통계/주문 reload
    setInputPhase('done');
    setInputMessage(`#${predictRound}회 입력 + 표준풀 분석 완료. 다음 회차로 자동 전환됩니다.`);
    setInputNumbers(['', '', '', '', '', '']);
    setInputBonus('');
    setInputDrawnAt('');
    setLoading(true);
    await load();
  };

  const handleLottoReset = () => {
    if (
      inputPhase === 'inserting' ||
      inputPhase === 'computing' ||
      inputPhase === 'polling'
    ) {
      if (
        !confirm('처리 진행 중입니다. 폼만 초기화합니다 (백엔드 작업은 계속됩니다). 진행하시겠습니까?')
      ) {
        return;
      }
    }
    setInputNumbers(['', '', '', '', '', '']);
    setInputBonus('');
    setInputDrawnAt('');
    setInputPhase('idle');
    setInputMessage(null);
    setInputResult(null);
  };

  const inputBusy =
    inputPhase === 'inserting' || inputPhase === 'computing' || inputPhase === 'polling';

  // ============================================
  // 표준풀 재계산 — 미완료 회차 5-6 재트리거
  // 입력 카드와 동일한 5-6 → 5-7 polling 흐름. Vercel Pro 적용으로 60초+ 가능.
  // ============================================
  const handleRecalc = async (round: number) => {
    if (recalcRound !== null) {
      // 다른 회차 재계산 진행 중이면 차단
      return;
    }
    if (
      !confirm(
        `#${round}회 표준풀 분석을 다시 시도합니다.\n` +
          `기존 풀 매칭 결과는 유지되고, 표준풀 등수만 새로 계산됩니다.\n` +
          `진행하시겠습니까? (수십 초 소요)`,
      )
    ) {
      return;
    }
    setRecalcRound(round);
    setRecalcPhase('computing');
    setRecalcMessage(`#${round}회 표준풀 분석 중...`);

    let ok = false;
    try {
      await adminProcessLottoHistory(round);
      ok = true;
    } catch (e: any) {
      const msg: string = e.message || '';
      if (!/504|시간 초과|timeout/i.test(msg)) {
        setRecalcPhase('error');
        setRecalcMessage(`#${round}회 분석 실패: ${msg}`);
        setRecalcRound(null);
        return;
      }
    }

    // 504 timeout 시 5-7 polling fallback (Vercel Pro 5분 한도까지 대응)
    if (!ok) {
      setRecalcPhase('polling');
      setRecalcMessage(`#${round}회 분석 진행 중 (5초 간격 확인)...`);
      const start = Date.now();
      const TIMEOUT_MS = 300_000; // 5분 한도
      while (Date.now() - start < TIMEOUT_MS) {
        await new Promise((res) => setTimeout(res, 5000));
        try {
          const status = await adminLottoHistoryStatus(round);
          if (status.status === 'ready') {
            ok = true;
            break;
          }
        } catch {
          // polling 일시적 오류 무시 (다음 사이클 재시도)
        }
      }
      if (!ok) {
        setRecalcPhase('error');
        setRecalcMessage(`#${round}회 분석이 5분 안에 완료되지 않았습니다. 운영자에게 문의해주세요.`);
        setRecalcRound(null);
        return;
      }
    }

    // 완료 — 미완료 목록에서 제거 + 메시지 표시
    setRecalcPhase('done');
    setRecalcMessage(`#${round}회 표준풀 분석 완료.`);
    setRecalcRound(null);
    setLoading(true);
    await load(); // pendingRounds 자동 갱신
  };

  const recalcBusy = recalcRound !== null;

  // ============================================
  // DL 벤치마크 — Hybrid / MLP fit 측정 (60~250s 소요)
  // ============================================
  const handleDLBenchmark = async (model: 'mlp' | 'hybrid') => {
    if (dlBenchModel !== null) return;  // 측정 중 중복 클릭 방지
    setDlBenchModel(model);
    setDlBenchResult(null);
    setDlBenchError(null);
    setDlBenchElapsed(0);

    // 경과 시간 표시용 1초 간격 카운터
    const startedAt = performance.now();
    const tick = setInterval(() => {
      setDlBenchElapsed(Math.floor((performance.now() - startedAt) / 1000));
    }, 1000);

    try {
      const result = await benchmarkDLModel(model);
      setDlBenchResult(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDlBenchError(msg);
    } finally {
      clearInterval(tick);
      setDlBenchModel(null);
    }
  };

  const dlBenchBusy = dlBenchModel !== null;

  // ============================================
  // DL 백테스트 — 룰 / MLP / Hybrid 적중률 비교 (5~250s)
  // ============================================
  const handleDLBacktest = async (choice: BacktestModelChoice) => {
    if (dlBackChoice !== null) return;
    setDlBackChoice(choice);
    setDlBackResult(null);
    setDlBackError(null);
    setDlBackElapsed(0);

    const includeMlp  = (choice === 'rule_mlp' || choice === 'all');
    const includeHybrid = (choice === 'rule_hybrid' || choice === 'all');

    const startedAt = performance.now();
    const tick = setInterval(() => {
      setDlBackElapsed(Math.floor((performance.now() - startedAt) / 1000));
    }, 1000);

    try {
      const result = await backtestDLModels(includeMlp, includeHybrid);
      setDlBackResult(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDlBackError(msg);
    } finally {
      clearInterval(tick);
      setDlBackChoice(null);
    }
  };

  const dlBackBusy = dlBackChoice !== null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="container mx-auto px-4 py-12 text-center text-gray-500">
          로딩 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="container mx-auto px-4 py-12 text-center">
          <p className="text-red-500 mb-4">{error}</p>
          {error.includes('어드민') && (
            <p className="text-sm text-gray-500">
              어드민 권한이 없습니다. 관리자에게 ADMIN_USER_IDS 등록을 요청하세요.
            </p>
          )}
          <Link href="/" className="block mt-4 text-brand-700 underline">
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px]">
        <h1 className="text-2xl font-bold mb-4">어드민 대시보드</h1>

        {/* PC: 4 카드를 2-column 그리드로 묶음 (좌: 운영 = 입력+재계산 / 우: R&D = DL 벤치+DL 백테).
            모바일은 자연 흐름이라 코드 순서 그대로 1→2→3→4 유지. 통계+주문 목록은 그리드 밖 wide. */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start mb-6">
          {/* 좌측 wrapper — 운영 작업 (당첨번호 입력 + 재계산) */}
          <div>
        {/* 당첨번호 입력 카드 (5-5 → 5-6 → 5-7 자동 흐름) */}
        <section className="bg-white rounded-xl p-5 mb-6 shadow-sm border-2 border-amber-200">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span aria-hidden>📝</span>
              당첨번호 입력
            </h2>
            {predictRound !== null && (
              <span className="text-xs font-bold text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
                예측 회차 {predictRound}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">
            입력 → 풀 매칭(즉시) → 표준풀 분석(약 24초)이 자동 진행됩니다. 다음 예측 회차만 입력 가능합니다.
          </p>

          {/* 회차 (자동 채움, 수정 불가 — 백엔드 round 일치 검증 보호) */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">회차</label>
            <input
              type="number"
              value={predictRound ?? ''}
              disabled
              readOnly
              className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-600 cursor-not-allowed"
            />
          </div>

          {/* 본번호 6칸 — 모바일 3x2, sm: 6x1 */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              본번호 6개 (1~45)
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {inputNumbers.map((v, i) => (
                <input
                  key={i}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={45}
                  value={v}
                  placeholder={`#${i + 1}`}
                  onChange={(e) => {
                    const next = [...inputNumbers];
                    next[i] = e.target.value;
                    setInputNumbers(next);
                  }}
                  disabled={inputBusy}
                  aria-label={`본번호 ${i + 1}번째`}
                  className="w-full px-2 py-2 text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              순서 무관, 자동 정렬됩니다. 중복은 허용되지 않습니다.
            </p>
          </div>

          {/* 추첨일 + 보너스 — 1줄 (모바일에서도 1줄 유지) */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                추첨일 (선택)
              </label>
              <input
                type="date"
                value={inputDrawnAt}
                onChange={(e) => setInputDrawnAt(e.target.value)}
                disabled={inputBusy}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">보너스</label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={45}
                value={inputBonus}
                placeholder="b"
                onChange={(e) => setInputBonus(e.target.value)}
                disabled={inputBusy}
                aria-label="보너스 번호"
                className="w-full px-2 py-2 text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-100"
              />
            </div>
          </div>

          {/* 진행 상태 strip */}
          {inputMessage && (
            <div
              className={`mb-3 px-3 py-2 rounded-lg text-sm flex items-start gap-2 ${
                inputPhase === 'error'
                  ? 'bg-red-50 border border-red-200 text-red-700'
                  : inputPhase === 'done'
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-blue-50 border border-blue-200 text-blue-700'
              }`}
              role="status"
              aria-live="polite"
            >
              {inputBusy && (
                <span
                  className="inline-block w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mt-1 flex-shrink-0"
                  aria-hidden
                />
              )}
              <span className="break-words">{inputMessage}</span>
            </div>
          )}

          {/* 버튼 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleLottoSubmit}
              disabled={predictRound === null || inputBusy}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition"
            >
              {inputPhase === 'inserting'
                ? '저장 중...'
                : inputPhase === 'computing'
                ? '분석 중...'
                : inputPhase === 'polling'
                ? '확인 중...'
                : '입력 + 처리 시작'}
            </button>
            <button
              type="button"
              onClick={handleLottoReset}
              className="px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
            >
              초기화
            </button>
          </div>
        </section>

        {/* 표준풀 재계산 카드 — 미완료 회차 (recalculated_at IS NULL) 5-6 재트리거 */}
        {(pendingRounds.length > 0 || pendingError) && (
          <section className="bg-white rounded-xl p-5 mb-6 shadow-sm border border-blue-200">
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <span aria-hidden>🔄</span>
                표준풀 재계산
              </h2>
              <span className="text-xs text-gray-500">{pendingRounds.length}건 대기</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              5-6 분석이 미완료된 회차입니다. 풀 매칭은 이미 저장됐고, 표준풀 등수만 새로 계산됩니다.
            </p>

            {pendingError ? (
              <div className="px-3 py-2 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">
                회차 목록 조회 실패: {pendingError}
              </div>
            ) : (
              <div className="space-y-2">
                {pendingRounds.map((p) => {
                  const isProcessing = recalcRound === p.round;
                  return (
                    <div
                      key={p.round}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                        isProcessing
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-baseline gap-2 flex-1 min-w-0">
                        <span className="font-bold text-sm">#{p.round}회</span>
                        <span className="text-xs text-gray-500 truncate">
                          본번호 {p.extract_main_match}개 적중
                          {p.extract_bonus_match && ' + 보너스'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRecalc(p.round)}
                        disabled={recalcBusy}
                        className="bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-1.5 rounded-md transition flex-shrink-0"
                      >
                        {isProcessing
                          ? recalcPhase === 'computing'
                            ? '분석 중...'
                            : '확인 중...'
                          : '재계산'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 진행 상태 strip */}
            {recalcMessage && (
              <div
                className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-start gap-2 ${
                  recalcPhase === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-700'
                    : recalcPhase === 'done'
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-blue-50 border border-blue-200 text-blue-700'
                }`}
                role="status"
                aria-live="polite"
              >
                {recalcBusy && (
                  <span
                    className="inline-block w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mt-1 flex-shrink-0"
                    aria-hidden
                  />
                )}
                <span className="break-words">{recalcMessage}</span>
              </div>
            )}
          </section>
        )}

        {/* v1.24 — 회차별 34추출 번호 카드 (최근 5회차) */}
        <section className="bg-white rounded-xl p-5 mb-6 shadow-sm border border-emerald-200">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span aria-hidden>📋</span>
              회차별 34추출 번호
            </h2>
            <span className="text-xs text-gray-500">최근 {recentPools.length}회차</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            각 회차에서 34추출엔진이 산출한 번호 풀입니다. 당첨번호와 일치한 번호는 금색 강조로 표시됩니다.
          </p>

          {poolsError ? (
            <div className="px-3 py-2 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">
              조회 실패: {poolsError}
            </div>
          ) : recentPools.length === 0 ? (
            <div className="px-3 py-3 rounded-lg text-sm bg-gray-50 border border-gray-200 text-gray-500 text-center">
              표시할 추출 풀이 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {recentPools.map((p) => {
                const winningSet = new Set([p.n1, p.n2, p.n3, p.n4, p.n5, p.n6]);
                return (
                  <div
                    key={p.round}
                    className="border border-gray-200 rounded-lg p-3 bg-gray-50"
                  >
                    {/* 헤더 — 회차 + 추첨일 + 매칭 결과 요약 */}
                    <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold text-sm">#{p.round}회</span>
                        <span className="text-xs text-gray-500">{p.drawn_at}</span>
                      </div>
                      <span className="text-xs font-medium text-emerald-700">
                        {p.extract_main_match}개 적중
                        {p.extract_bonus_match && ' +보너스'}
                      </span>
                    </div>

                    {/* 34개 추출 번호 그리드 — 당첨된 번호는 금색 ring */}
                    <div className="grid grid-cols-10 sm:grid-cols-12 md:grid-cols-17 gap-1">
                      {[...p.extract_pool].sort((a, b) => a - b).map((n) => {
                        const hit = winningSet.has(n);
                        const isBonus = n === p.bonus;
                        return (
                          <span
                            key={n}
                            className={`inline-flex items-center justify-center h-7 rounded text-[11px] font-medium tabular-nums ${
                              hit
                                ? 'bg-amber-100 text-amber-900'
                                : isBonus
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-white text-gray-600 border border-gray-200'
                            }`}
                            style={
                              hit
                                ? { boxShadow: '0 0 0 1.5px #facc15' }
                                : undefined
                            }
                            title={
                              hit
                                ? `${n} — 당첨`
                                : isBonus
                                  ? `${n} — 보너스`
                                  : `${n}`
                            }
                          >
                            {n}
                          </span>
                        );
                      })}
                    </div>

                    {/* 당첨번호 요약 (참고용, 한 줄) */}
                    <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
                      당첨번호:{' '}
                      <span className="font-mono">
                        {[p.n1, p.n2, p.n3, p.n4, p.n5, p.n6].sort((a, b) => a - b).join('·')}
                      </span>
                      {' '}+{' '}
                      <span className="font-mono">{p.bonus}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
          </div>{/* /좌측 wrapper — 운영 */}

          {/* 우측 wrapper — R&D 모니터링 (DL 벤치마크 + DL 백테스트) */}
          <div>
        {/* DL 벤치마크 카드 — §4-A 1단계 fit 시간/메모리 측정 (purple-200 구분) */}
        <section className="bg-white rounded-xl p-5 mb-6 shadow-sm border border-purple-200">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-purple-900">
              🧠 DL 벤치마크 (§4-A 1단계)
            </h2>
            <span className="text-xs text-purple-600">fit 시간 / 메모리 / Vercel 안전성</span>
          </div>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            딥러닝 활성화 검증용 측정 — 측정 중 60~250초 소요됩니다. 결과의{' '}
            <code className="bg-purple-50 px-1 rounded text-purple-800">vercel_deadline_safe</code>
            {' '}/{' '}
            <code className="bg-purple-50 px-1 rounded text-purple-800">memory_safe</code>가 모두{' '}
            <strong>true</strong>면 §4-A 2단계(캐싱 추가) 진입 가능. 운영 영향 0 (read-only).
          </p>

          {/* v1.15 — 모델 설명 박스 (사장님 합의 — Claude 일반 ML 단어 초안, 사장님 검토용)
              사장님 운영 시 어드민이 모델 의미 파악하기 쉽도록 카드 안에 항상 노출 */}
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-2 leading-relaxed">
            <p className="font-semibold text-gray-900 text-[13px]">📚 모델 설명</p>
            <div>
              <span className="inline-block px-1.5 py-0.5 bg-gray-200 text-gray-800 rounded font-mono text-[11px] mr-1.5">룰</span>
              <span className="text-gray-700">
                통계적 규칙 기반 후보 선별. 과거 당첨 데이터의 빈도·분포·연관성 패턴을 룰로 정의해 점수 계산. <strong>학습 단계 없이 즉시 동작</strong>, 빠르고 안정적이지만 사전 정의된 규칙 외 패턴은 잡지 못함.
              </span>
            </div>
            <div>
              <span className="inline-block px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded font-mono text-[11px] mr-1.5">MLP</span>
              <span className="text-gray-700">
                다층 퍼셉트론(Multi-Layer Perceptron) — 신경망의 가장 기본 형태. 입력층 → 은닉층 → 출력층 구조로 과거 데이터에서 <strong>비선형 패턴을 학습</strong>. 룰로 표현하기 어려운 복잡한 관계 포착에 강함.
              </span>
            </div>
            <div>
              <span className="inline-block px-1.5 py-0.5 bg-purple-600 text-white rounded font-mono text-[11px] mr-1.5">Hybrid</span>
              <span className="text-gray-700">
                룰 + MLP 결합 앙상블. <strong>룰의 안정성과 MLP의 적응성</strong>을 동시에 활용. 단일 모델 대비 적중률 안정화에 유리, 사장님 운영 기본 모델.
              </span>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleDLBenchmark('hybrid')}
              disabled={dlBenchBusy}
              className="flex-1 min-w-[140px] bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-medium py-2.5 px-4 rounded-lg transition"
            >
              {dlBenchModel === 'hybrid'
                ? `⏳ Hybrid 측정 중 (${dlBenchElapsed}s)`
                : 'Hybrid 측정 ⭐'}
            </button>
            <button
              type="button"
              onClick={() => handleDLBenchmark('mlp')}
              disabled={dlBenchBusy}
              className="flex-1 min-w-[140px] bg-white hover:bg-purple-50 disabled:bg-gray-100 text-purple-700 border border-purple-300 font-medium py-2.5 px-4 rounded-lg transition"
            >
              {dlBenchModel === 'mlp'
                ? `⏳ MLP 측정 중 (${dlBenchElapsed}s)`
                : 'MLP 측정'}
            </button>
          </div>

          {/* 측정 진행 안내 (busy 시) */}
          {dlBenchBusy && (
            <div className="mt-3 bg-purple-50 border border-purple-100 rounded-lg p-3 text-xs text-purple-900 leading-relaxed">
              fit 진행 중입니다. 페이지를 떠나지 마세요. 250초 초과 시 504 응답.
              {dlBenchElapsed >= 60 && (
                <div className="mt-1 text-purple-700">현재 1분 경과 — Vercel 안전 한도(200s)까지 {Math.max(0, 200 - dlBenchElapsed)}초 남음.</div>
              )}
            </div>
          )}

          {/* 측정 결과 */}
          {dlBenchResult && (
            <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                <h3 className="font-semibold text-purple-900">
                  ✅ {dlBenchResult.model.toUpperCase()} 측정 결과
                </h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    dlBenchResult.vercel_deadline_safe && dlBenchResult.memory_safe
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {dlBenchResult.vercel_deadline_safe && dlBenchResult.memory_safe
                    ? '안전'
                    : '주의 필요'}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-gray-600">data_load</dt>
                <dd className="font-mono">{dlBenchResult.data_load_seconds.toFixed(2)}s</dd>

                <dt className="text-gray-600">fit + predict</dt>
                <dd className="font-mono font-semibold">
                  {dlBenchResult.fit_predict_seconds.toFixed(2)}s
                </dd>

                <dt className="text-gray-600">total</dt>
                <dd className="font-mono">{dlBenchResult.total_seconds.toFixed(2)}s</dd>

                <dt className="text-gray-600">peak memory</dt>
                <dd className="font-mono">{dlBenchResult.peak_memory_mb.toFixed(1)} MB</dd>

                <dt className="text-gray-600">vercel 240s 안전</dt>
                <dd className={dlBenchResult.vercel_deadline_safe ? 'text-emerald-700 font-medium' : 'text-rose-700 font-medium'}>
                  {dlBenchResult.vercel_deadline_safe ? '✓ true' : '✗ false'}
                </dd>

                <dt className="text-gray-600">memory 1024MB 안전</dt>
                <dd className={dlBenchResult.memory_safe ? 'text-emerald-700 font-medium' : 'text-rose-700 font-medium'}>
                  {dlBenchResult.memory_safe ? '✓ true' : '✗ false'}
                </dd>

                <dt className="text-gray-600">predict_round</dt>
                <dd className="font-mono">{dlBenchResult.predict_round}</dd>

                <dt className="text-gray-600">top_k size</dt>
                <dd className="font-mono">{dlBenchResult.top_k_size}</dd>
              </dl>

              <p className="mt-3 pt-3 border-t border-purple-200 text-sm text-purple-900">
                <span className="font-semibold">해석:</span> {dlBenchResult.interpretation}
              </p>
            </div>
          )}

          {/* 측정 에러 */}
          {dlBenchError && (
            <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800">
              <div className="font-semibold mb-1">❌ 측정 실패</div>
              <div className="text-xs break-words">{dlBenchError}</div>
              {dlBenchError.includes('504') && (
                <div className="text-xs mt-1 text-rose-700">
                  → 250초 초과 = Vercel 240s 한도 위험. §4-A 활성화 시 가중치 캐시 필수.
                </div>
              )}
            </div>
          )}
        </section>

        {/* DL 백테스트 카드 — §4-A 3단계 적중률 비교 (indigo-200 구분) */}
        <section className="bg-white rounded-xl p-5 mb-6 shadow-sm border border-indigo-200">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-indigo-900">
              📊 DL 백테스트 (§4-A 3단계)
            </h2>
            <span className="text-xs text-indigo-600">직전 50회차 적중률 비교</span>
          </div>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            룰 / MLP / Hybrid 모델별로 직전 50회차에 대한 풀 1등(m=6) 횟수, 평균 적중, 베이스라인 대비 배수를 측정합니다.
            결과의 <strong className="text-indigo-800">Hybrid first_prize_count가 룰보다 의미있게 크면</strong> §4-A 활성화 권장.
            룰만은 ~5초, +Hybrid ~84초, 둘 다 ~101초 소요.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleDLBacktest('rule_only')}
              disabled={dlBackBusy}
              className="bg-white hover:bg-indigo-50 disabled:bg-gray-100 text-indigo-700 border border-indigo-300 font-medium py-2.5 px-3 rounded-lg transition text-sm"
            >
              {dlBackChoice === 'rule_only' ? `⏳ 룰만 (${dlBackElapsed}s)` : '룰만 (5s)'}
            </button>
            <button
              type="button"
              onClick={() => handleDLBacktest('rule_hybrid')}
              disabled={dlBackBusy}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-2.5 px-3 rounded-lg transition text-sm"
            >
              {dlBackChoice === 'rule_hybrid' ? `⏳ 룰+Hybrid (${dlBackElapsed}s)` : '룰+Hybrid ⭐ (84s)'}
            </button>
            <button
              type="button"
              onClick={() => handleDLBacktest('rule_mlp')}
              disabled={dlBackBusy}
              className="bg-white hover:bg-indigo-50 disabled:bg-gray-100 text-indigo-700 border border-indigo-300 font-medium py-2.5 px-3 rounded-lg transition text-sm"
            >
              {dlBackChoice === 'rule_mlp' ? `⏳ 룰+MLP (${dlBackElapsed}s)` : '룰+MLP (22s)'}
            </button>
            <button
              type="button"
              onClick={() => handleDLBacktest('all')}
              disabled={dlBackBusy}
              className="bg-white hover:bg-indigo-50 disabled:bg-gray-100 text-indigo-700 border border-indigo-300 font-medium py-2.5 px-3 rounded-lg transition text-sm"
            >
              {dlBackChoice === 'all' ? `⏳ 모두 (${dlBackElapsed}s)` : '모두 (101s)'}
            </button>
          </div>

          {dlBackBusy && (
            <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 leading-relaxed">
              백테스트 진행 중입니다. 페이지를 떠나지 마세요.
              {dlBackElapsed >= 60 && (
                <div className="mt-1 text-indigo-700">
                  현재 {dlBackElapsed}초 경과 — Vercel 안전 한도(200s)까지 {Math.max(0, 200 - dlBackElapsed)}초 남음.
                </div>
              )}
            </div>
          )}

          {/* 백테스트 결과 */}
          {dlBackResult && (
            <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                <h3 className="font-semibold text-indigo-900">✅ 백테스트 결과 (직전 {dlBackResult.n_rounds}회차)</h3>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800">
                  채택: {dlBackResult.adopted_model.toUpperCase()}
                </span>
              </div>

              {/* 비교 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-indigo-200 text-indigo-900">
                      <th className="text-left py-2 px-1 font-medium">모델</th>
                      <th className="text-right py-2 px-1 font-medium">풀 1등</th>
                      <th className="text-right py-2 px-1 font-medium">미당첨</th>
                      <th className="text-right py-2 px-1 font-medium">평균 m</th>
                      <th className="text-right py-2 px-1 font-medium">vs 베이스</th>
                      <th className="text-right py-2 px-1 font-medium">p (vs 룰)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-100">
                    <tr>
                      <td className="py-2 px-1 font-medium">룰 (현재)</td>
                      <td className="py-2 px-1 text-right font-mono">{dlBackResult.rule.first_prize_count}</td>
                      <td className="py-2 px-1 text-right font-mono">{dlBackResult.rule.no_prize_count}</td>
                      <td className="py-2 px-1 text-right font-mono">{dlBackResult.rule.avg_matches.toFixed(2)}</td>
                      <td className="py-2 px-1 text-right font-mono">
                        {(dlBackResult.rule.first_prize_count / dlBackResult.baseline_random.first_prize_count).toFixed(2)}x
                      </td>
                      <td className="py-2 px-1 text-right text-gray-400">—</td>
                    </tr>
                    {dlBackResult.mlp && (
                      <tr>
                        <td className="py-2 px-1 font-medium">MLP</td>
                        <td className="py-2 px-1 text-right font-mono">{dlBackResult.mlp.first_prize_count}</td>
                        <td className="py-2 px-1 text-right font-mono">{dlBackResult.mlp.no_prize_count}</td>
                        <td className="py-2 px-1 text-right font-mono">{dlBackResult.mlp.avg_matches.toFixed(2)}</td>
                        <td className="py-2 px-1 text-right font-mono">
                          {(dlBackResult.mlp.first_prize_count / dlBackResult.baseline_random.first_prize_count).toFixed(2)}x
                        </td>
                        <td className={`py-2 px-1 text-right font-mono ${(dlBackResult.mlp.paired_p_value_vs_rule ?? 1) < 0.05 ? 'text-emerald-700 font-semibold' : ''}`}>
                          {dlBackResult.mlp.paired_p_value_vs_rule?.toFixed(3) ?? '—'}
                        </td>
                      </tr>
                    )}
                    {dlBackResult.hybrid && (
                      <tr>
                        <td className="py-2 px-1 font-medium">Hybrid</td>
                        <td className="py-2 px-1 text-right font-mono">{dlBackResult.hybrid.first_prize_count}</td>
                        <td className="py-2 px-1 text-right font-mono">{dlBackResult.hybrid.no_prize_count}</td>
                        <td className="py-2 px-1 text-right font-mono">{dlBackResult.hybrid.avg_matches.toFixed(2)}</td>
                        <td className="py-2 px-1 text-right font-mono">
                          {(dlBackResult.hybrid.first_prize_count / dlBackResult.baseline_random.first_prize_count).toFixed(2)}x
                        </td>
                        <td className={`py-2 px-1 text-right font-mono ${(dlBackResult.hybrid.paired_p_value_vs_rule ?? 1) < 0.05 ? 'text-emerald-700 font-semibold' : ''}`}>
                          {dlBackResult.hybrid.paired_p_value_vs_rule?.toFixed(3) ?? '—'}
                        </td>
                      </tr>
                    )}
                    <tr className="bg-gray-50/50">
                      <td className="py-2 px-1 italic text-gray-500">무작위 풀 (베이스라인)</td>
                      <td className="py-2 px-1 text-right font-mono text-gray-500">{dlBackResult.baseline_random.first_prize_count.toFixed(1)}</td>
                      <td className="py-2 px-1 text-right font-mono text-gray-500">{dlBackResult.baseline_random.no_prize_count.toFixed(1)}</td>
                      <td className="py-2 px-1 text-right font-mono text-gray-500">{dlBackResult.baseline_random.avg_matches_expected.toFixed(2)}</td>
                      <td className="py-2 px-1 text-right text-gray-400">1.00x</td>
                      <td className="py-2 px-1 text-right text-gray-400">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3 pt-3 border-t border-indigo-200 text-sm text-indigo-900">
                <span className="font-semibold">해석:</span> {dlBackResult.interpretation}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                p-value &lt; 0.05 = 통계적 유의 (해당 모델이 룰보다 의미있게 좋다는 증거).
                측정 시간: {dlBackResult.elapsed_seconds.toFixed(1)}s
              </p>
            </div>
          )}

          {/* 백테스트 에러 */}
          {dlBackError && (
            <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800">
              <div className="font-semibold mb-1">❌ 백테스트 실패</div>
              <div className="text-xs break-words">{dlBackError}</div>
            </div>
          )}
        </section>
          </div>{/* /우측 wrapper — R&D */}
        </div>{/* /lg:grid 4-카드 묶음 */}

        {/* 통계 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatCard label="입금 대기" value={stats.orders_by_status.pending ?? 0} />
            <StatCard
              label="승인 대기"
              value={stats.orders_by_status.awaiting_deposit ?? 0}
              highlight
            />
            <StatCard label="결제 완료" value={stats.orders_by_status.paid ?? 0} />
            <StatCard label="취소" value={stats.orders_by_status.cancelled ?? 0} />
            <StatCard
              label="오늘 매출"
              value={`${stats.today_paid_amount.toLocaleString()}원`}
              sub={`${stats.today_paid_count}건`}
            />
          </div>
        )}

        {/* 필터 */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['awaiting_deposit', 'pending', 'paid', 'cancelled'] as OrderStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setFilter(s);
                setLoading(true);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                filter === s
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300'
              }`}
            >
              {statusLabel(s)}
            </button>
          ))}
          <button
            type="button"
            onClick={load}
            className="ml-auto px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            🔄 새로고침
          </button>
        </div>

        {/* 주문 목록 */}
        {orders.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-500">
            {statusLabel(filter)} 주문이 없습니다.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">주문ID</th>
                  <th className="px-3 py-2 text-left font-medium">입금자명</th>
                  <th className="px-3 py-2 text-right font-medium">금액</th>
                  <th className="px-3 py-2 text-center font-medium">조합/다양성</th>
                  <th className="px-3 py-2 text-left font-medium">시각</th>
                  <th className="px-3 py-2 text-center font-medium">액션</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.order_id} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      {o.order_id.slice(-12)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <span className="font-bold text-brand-700">{o.deposit_name}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold">
                      {o.amount.toLocaleString()}원
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">
                      {o.n_combos}조합 / 다양성 {o.min_diff}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {o.deposit_marked_at
                        ? `입금: ${new Date(o.deposit_marked_at).toLocaleString('ko-KR')}`
                        : `생성: ${new Date(o.created_at).toLocaleString('ko-KR')}`}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {o.status === 'awaiting_deposit' && (
                        <div className="flex gap-2 justify-center">
                          <button
                            type="button"
                            onClick={() => handleApprove(o.order_id)}
                            disabled={actingOnId === o.order_id}
                            className="px-3 py-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white text-xs rounded"
                          >
                            승인
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(o.order_id)}
                            disabled={actingOnId === o.order_id}
                            className="px-3 py-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white text-xs rounded"
                          >
                            취소 처리
                          </button>
                        </div>
                      )}
                      {o.status !== 'awaiting_deposit' && (
                        <span className="text-xs text-gray-400">{statusLabel(o.status)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-xl ${
        highlight ? 'bg-amber-100 border-2 border-amber-300' : 'bg-white shadow-sm'
      }`}
    >
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function statusLabel(s: OrderStatus): string {
  return {
    pending: '입금 대기',
    awaiting_deposit: '승인 대기',
    paid: '완료',
    cancelled: '취소',
  }[s];
}
