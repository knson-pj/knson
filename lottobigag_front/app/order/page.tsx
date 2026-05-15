'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { ExtractEnginePoolCard } from '@/components/ExtractEnginePoolCard';
import { PrevRoundCard } from '@/components/PrevRoundCard';
import { DrawCountdownCard } from '@/components/DrawCountdownCard';
import { createSupabaseClient } from '@/lib/supabase';
import {
  getRoundInfo,
  getExtractEngineInfo,
  prepareOrder,
  type RoundInfo,
  type ExtractEngineInfo,
} from '@/lib/api';
import {
  fetchRecentRoundLogs,
  type RoundLogRow,
} from '@/lib/round-logs';

/**
 * v1.14 — /order 페이지 (신규)
 *
 * 이전: 메인 페이지(/)에서 처리되던 주문 양식
 * 변경: 메인을 대시보드로 전환하면서 주문 흐름을 별도 페이지로 분리 (사장님 합의 옵션 A)
 *
 * v1.23 갱신 (사장님 합의 2026-05-15 — PrevRoundCard 디자인 통일):
 *   - PrevRoundCard 데이터 소스 변경: extractInfo.previous_round → Supabase 직접 조회 (RoundLogRow)
 *   - 카드 디자인이 적중로그 회차 카드와 동일하게 변경됨 (조합엔진·결제 조합 5등급 표시)
 *   - 신규 의존성: lib/round-logs.ts
 *   - 백테스트 로그는 주문 페이지에서 미사용 (메인 페이지 전용)
 *
 * 페이지 흐름:
 *   1. 조합 수 선택 → 2. 다양성 강도 → 3. 입금자명 → 무통장입금 안내 → 주문 버튼
 *   우측(PC): 카운트다운 + 분석 카드 + 직전 회차 결과 (sticky)
 *
 * 로직은 기존 메인의 HomePage와 동일 — 단순 이동.
 */
export default function OrderPage() {
  const router = useRouter();
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [extractInfo, setExtractInfo] = useState<ExtractEngineInfo | null>(null);
  // v1.23 — 직전 회차 카드 데이터 (Supabase 직접 조회, 메인 페이지와 동일 패턴)
  const [prevRow, setPrevRow] = useState<RoundLogRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createSupabaseClient();

  const [nCombos, setNCombos] = useState<number>(1);
  const [minDiff, setMinDiff] = useState<number>(2);
  const [depositPrefix, setDepositPrefix] = useState('');

  useEffect(() => {
    Promise.all([
      getRoundInfo(),
      getExtractEngineInfo(),
      // v1.23 — 직전 회차 1건 (백테스트 로그는 주문 페이지에서 미사용)
      // 실패 시 null 반환 → PrevRoundCard 영역 미표시, 다른 영역은 정상
      fetchRecentRoundLogs(1).catch(() => [] as RoundLogRow[]),
    ])
      .then(([r, ext, recent]) => {
        setRound(r);
        setExtractInfo(ext);
        setPrevRow(recent[0] ?? null);
        setMinDiff(r.default_min_diff);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handlePurchase = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login?redirect=/order');
        return;
      }
      const prep = await prepareOrder(nCombos, minDiff, depositPrefix);
      router.push(`/result/${prep.order_id}`);
    } catch (e: any) {
      setError(e.message || '주문 생성 실패');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="container mx-auto px-4 py-12 text-center">
          <p className="text-gray-500">로딩 중...</p>
        </div>
      </>
    );
  }

  if (!round) {
    return (
      <>
        <Header />
        <div className="container mx-auto px-4 py-12 text-center">
          <p className="text-red-500">{error || '데이터를 불러올 수 없습니다.'}</p>
        </div>
      </>
    );
  }

  const selectedTier = round.pricing_tiers.find((t) => t.n_combos === nCombos);
  const price = selectedTier?.price ?? 0;

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-6 sm:py-8 max-w-3xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px]">

        {/* 페이지 타이틀 */}
        <div className="mb-4 sm:mb-6">
          <Link href="/" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 mb-2">
            ← 대시보드로 돌아가기
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-brand-900">분석 번호 구매하기</h1>
          <p className="text-sm text-gray-500 mt-1">
            제 <span className="font-bold text-brand-700">{round.predict_round}</span>회 추첨 대상
          </p>
        </div>

        {/* PC: 좌(주문) 8/12 + 우(보조 패널) 4/12. 모바일은 1단 (lg:order로 PC 시각 순서) */}
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">

          {/* 우측 보조 — 카운트다운 + 분석 + 직전 회차 (PC 우, 모바일 위) */}
          <aside className="lg:col-span-1 lg:order-2 lg:sticky lg:top-20 space-y-4 mb-4 lg:mb-0">
            <DrawCountdownCard predictRound={round.predict_round} />
            {extractInfo && extractInfo.current_pool_size > 0 && (
              <ExtractEnginePoolCard
                round={extractInfo.current_round}
                poolSize={extractInfo.current_pool_size}
              />
            )}
            {/* v1.23 — PrevRoundCard 입력 변경: extractInfo.previous_round → prevRow (Supabase) */}
            {prevRow && <PrevRoundCard row={prevRow} />}
          </aside>

          {/* 좌측 메인 — 주문 양식 (PC col-span-2) */}
          <div className="lg:col-span-2 lg:order-1">

            {/* 1. 조합 수 선택 */}
            <section className="bg-white rounded-xl p-6 mb-4 shadow-sm">
              <h2 className="text-lg font-semibold mb-4">1. 조합 수 선택</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {round.pricing_tiers.map((tier) => {
                  const selected = tier.n_combos === nCombos;
                  return (
                    <button
                      key={tier.n_combos}
                      type="button"
                      onClick={() => setNCombos(tier.n_combos)}
                      className={`p-4 rounded-lg border-2 transition ${
                        selected
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="text-sm text-gray-600 mb-1">{tier.label}</div>
                      <div className="text-xl font-bold">
                        {tier.price.toLocaleString()}원
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 2. 다양성 선택 */}
            <section className="bg-white rounded-xl p-6 mb-4 shadow-sm">
              <h2 className="text-lg font-semibold mb-4">2. 다양성 강도</h2>
              <div className="space-y-2">
                {round.diversity_options.map((opt) => {
                  const selected = opt.min_diff === minDiff;
                  return (
                    <button
                      key={opt.min_diff}
                      type="button"
                      onClick={() => setMinDiff(opt.min_diff)}
                      className={`w-full p-3 rounded-lg border-2 text-left transition ${
                        selected
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-sm text-gray-500">{opt.description}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 3. 입금자명 prefix (옵션) */}
            <section className="bg-white rounded-xl p-6 mb-4 shadow-sm">
              <h2 className="text-lg font-semibold mb-2">3. 입금자명 (선택)</h2>
              <p className="text-sm text-gray-500 mb-3">
                입금 시 사용할 이름 또는 별명. 비워두면 카카오 닉네임으로 자동 설정됩니다.
              </p>
              <input
                type="text"
                maxLength={8}
                placeholder="예: 홍길동"
                value={depositPrefix}
                onChange={(e) => setDepositPrefix(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </section>

            {/* v1.15 — 무통장입금 안내 카드는 결제완료 페이지(/result/[orderId])에서
                구체 입금 정보(계좌·금액·입금자명)와 함께 노출됨.
                구매 흐름 단순화를 위해 이 페이지에서는 제거 (사장님 합의). */}

            {/* 결제 버튼 */}
            <button
              type="button"
              onClick={handlePurchase}
              disabled={submitting}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 text-white font-bold py-4 rounded-xl text-lg transition shadow-md"
            >
              {submitting
                ? '주문 생성 중...'
                : `${price.toLocaleString()}원 — 주문 생성 및 입금 안내`}
            </button>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

          </div>
        </div>
      </main>
    </>
  );
}
