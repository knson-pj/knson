'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { LottoBall } from '@/components/LottoBall';
import { DrawCountdownCard } from '@/components/DrawCountdownCard';
import { PrizeRankBadge } from '@/components/PrizeRankBadge';
import { PoolCountdown } from '@/components/PoolCountdown';
import {
  getOrder,
  markDeposit,
  getRoundInfo,
  getOrderExtractPool,
  type Order,
  type RoundInfo,
  type OrderExtractPool,
} from '@/lib/api';
import { LEGAL_NOTICES } from '@/lib/notices';

export default function ResultPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [round, setRound] = useState<RoundInfo | null>(null);
  /**
   * v1.25 stage2 — 본인 결제 회차의 추출 풀 (백엔드 endpoint 경유)
   * draw_completed 분기:
   *   - false: 추첨 전 → pool_positional 34개 + draw_at(카운트다운용)
   *   - true:  추첨 후 → pool_positional 적중 자리만, 나머지 null + winning_nums/bonus
   */
  const [poolData, setPoolData] = useState<OrderExtractPool | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    try {
      const o = await getOrder(orderId);
      setOrder(o);
    } catch (e: any) {
      setError(e.message || '주문 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
    getRoundInfo().then(setRound).catch(() => {});
  }, [fetchOrder]);

  // v1.25 stage2 — paid 상태가 되면 본인 결제 회차의 풀 조회 (백엔드 endpoint).
  // draw_completed 분기로 추첨 전/후 화면 분리됨.
  // 실패 시 영역 미노출 (조용히 fallback — 다른 영역은 정상)
  useEffect(() => {
    if (order && order.status === 'paid' && order.predict_round) {
      getOrderExtractPool(order.order_id)
        .then((data) => {
          setPoolData(data);
          setPoolError(null);
        })
        .catch((e: any) => {
          // 503(분석 미완료) 등은 영역 미노출 + 사용자에게는 부드럽게 안내
          setPoolError(e.message || '회차 분석 정보를 불러오지 못했습니다.');
          setPoolData(null);
        });
    }
  }, [order]);

  // awaiting_deposit 상태일 때 30초마다 polling (paid 상태 자동 감지)
  useEffect(() => {
    if (!order || order.status !== 'awaiting_deposit') return;
    const id = setInterval(() => fetchOrder(), 30 * 1000);
    return () => clearInterval(id);
  }, [order, fetchOrder]);

  const handleMarkDeposit = async () => {
    setMarking(true);
    setError(null);
    try {
      await markDeposit(orderId);
      await fetchOrder();
    } catch (e: any) {
      setError(e.message || '입금 완료 처리 실패');
    } finally {
      setMarking(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

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

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="container mx-auto px-4 py-12 text-center">
          <p className="text-red-500 mb-4">{error || '주문을 찾을 수 없습니다.'}</p>
          <Link href="/" className="text-brand-600 underline">홈으로</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-2xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px]">
        {/* 주문 헤더 */}
        <div className="bg-white rounded-xl p-6 mb-4 shadow-sm max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl font-bold">제 {order.predict_round}회 추출 주문</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm text-gray-600">
            {order.n_combos}조합 · 다양성 {order.min_diff} · {order.amount.toLocaleString()}원
          </p>
        </div>

        {/* 1. PENDING — 입금 안내 (v1.16 사장님 명시 텍스트로 재구성) */}
        {order.status === 'pending' && round && (
          <section className="bg-white rounded-xl p-6 mb-4 shadow-sm max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold mb-3">💳 입금 안내</h2>

            {/* 상단 안내 3개 — 결제 흐름 핵심 */}
            <ul className="text-sm text-gray-700 space-y-1.5 mb-4 list-disc pl-5 leading-relaxed">
              <li>아래 입금자명으로 정확한 금액을 입금해 주세요.</li>
              <li>입금 후 &ldquo;입금 완료&rdquo; 버튼을 누르시면 30분 이내에 조합이 발송됩니다.</li>
              <li>조합이 발송된 이후에는 환불이 불가능합니다.</li>
            </ul>

            {/* 계좌 / 입금자명 / 금액 박스 */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <CopyRow label="은행" value={round.business_bank} onCopy={copy} copied={copied} />
              <CopyRow
                label="계좌번호"
                value={round.business_account_number}
                onCopy={copy}
                copied={copied}
              />
              <CopyRow
                label="예금주"
                value={round.business_account_holder}
                onCopy={copy}
                copied={copied}
              />
              <CopyRow
                label="입금자명"
                value={order.deposit_name}
                onCopy={copy}
                copied={copied}
                highlight
              />
              <CopyRow
                label="금액"
                value={`${order.amount.toLocaleString()}원`}
                onCopy={copy}
                copied={copied}
                highlight
              />
            </div>

            {/* 이용 주의 사항 — v1.16 LEGAL_NOTICES 공통 상수 사용 (푸터와 동일 문구 자동 동기화) */}
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-900 mb-2">⚠️ 이용 주의 사항</p>
              <ul className="text-xs text-amber-800 space-y-1.5 list-disc pl-5 leading-relaxed">
                {LEGAL_NOTICES.map((notice, i) => (
                  <li key={i}>{notice}</li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={handleMarkDeposit}
              disabled={marking}
              className="w-full mt-4 bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-lg transition"
            >
              {marking ? '처리 중...' : '입금 완료했어요'}
            </button>
          </section>
        )}

        {/* 2. AWAITING_DEPOSIT — 승인 대기 */}
        {order.status === 'awaiting_deposit' && (
          <section className="bg-white rounded-xl p-6 mb-4 shadow-sm text-center max-w-md mx-auto">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-3">
              <span className="text-3xl">⏳</span>
            </div>
            <h2 className="text-lg font-semibold mb-2">사업자 승인 대기 중</h2>
            <p className="text-gray-600 text-sm mb-1">
              입금 확인 후 영업시간 내 1~3시간 안에 처리됩니다.
            </p>
            <p className="text-gray-500 text-xs">
              입금 시각:{' '}
              {order.deposit_marked_at
                ? new Date(order.deposit_marked_at).toLocaleString('ko-KR')
                : '-'}
            </p>
            <p className="text-gray-400 text-xs mt-3">
              (이 페이지는 30초마다 자동 새로고침됩니다)
            </p>
          </section>
        )}

        {/* 3. CANCELLED — 취소 (수동 / v1.15부터 자동 — rejected_reason 로 구분) */}
        {order.status === 'cancelled' && (
          <section className="bg-white rounded-xl p-6 mb-4 shadow-sm max-w-xl mx-auto">
            <h2 className="text-lg font-semibold mb-2 text-red-600">❌ 주문 취소</h2>
            <p className="text-gray-600 text-sm mb-2">
              이 주문은 취소되었습니다.
            </p>
            {order.rejected_reason && (
              <div className="bg-gray-50 rounded p-3 text-sm">
                <span className="text-gray-500">사유: </span>
                {order.rejected_reason}
              </div>
            )}
            <Link
              href="/order"
              className="block mt-4 text-center bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 rounded-lg"
            >
              새 주문 만들기
            </Link>
          </section>
        )}

        {/* 4. PAID — 결과 표시 + 우측 보조 패널 (v1.12 신규)
            모바일: 1단 (보조패널 위 → 결과 아래, lg:order-2 패턴)
            PC (lg+): 2단 (메인 결과 좌, 보조패널 우측 sticky)  */}
        {order.status === 'paid' && order.combinations_detail && (
          <div className="lg:grid lg:grid-cols-12 lg:gap-6">
            {/* 메인: 추출 결과 (lg에서 8/12) */}
            <section className="lg:col-span-8 lg:order-1 bg-white rounded-xl p-6 mb-4 shadow-sm">
              <h2 className="text-lg font-semibold mb-3">
                🎯 추출 결과 — {order.combinations?.length ?? order.n_combos}조합
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                승인 시각:{' '}
                {order.approved_at
                  ? new Date(order.approved_at).toLocaleString('ko-KR')
                  : '-'}
              </p>

              {/* v1.25 stage2 — 본인 결제 회차의 34추출 번호 (사장님 합의 2026-05-15)
                  추첨 전 : 풀 34개 전체 + amber 카운트다운 ("추첨 시작 시 적중하지 않은 번호는 사라집니다")
                  추첨 후 : 같은 34칸 그리드 자리 유지 + 적중 자리만 amber 강조 + 미적중 자리 빈 박스
                  데이터 소스: 백엔드 GET /api/orders/{order_id}/extract-pool (Bearer 토큰 검증) */}
              {(() => {
                // 풀 데이터 로딩 중 또는 실패 — 영역 미렌더 (다른 영역은 정상 노출)
                if (!poolData) {
                  if (poolError) {
                    return (
                      <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 mb-5 text-center">
                        <p className="text-sm text-gray-600 font-medium">
                          이 회차의 34추출 번호를 표시할 수 없습니다.
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          잠시 후 다시 시도해주세요.
                        </p>
                      </div>
                    );
                  }
                  return null;
                }

                const isAfterDraw = poolData.draw_completed;

                return (
                  <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
                    {/* 추첨 후 — 당첨번호 6+1 헤더 노출 */}
                    {isAfterDraw && poolData.winning_nums && poolData.bonus !== null && (
                      <div className="mb-3 pb-3 border-b border-gray-200">
                        <p className="text-xs font-medium text-gray-600 mb-2">
                          제 {poolData.round}회 당첨번호
                          {poolData.draw_at && (
                            <span className="text-gray-400">
                              {' · '}
                              {new Date(poolData.draw_at).toLocaleDateString('ko-KR')}
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {poolData.winning_nums.map((n) => (
                            <LottoBall key={n} n={n} />
                          ))}
                          <span className="text-gray-400 px-1">+</span>
                          <LottoBall n={poolData.bonus} />
                        </div>
                      </div>
                    )}

                    {/* 헤더: 카드 제목 + (추첨 후) 적중 N/34 배지 */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-medium text-gray-800">
                        이 회차 34추출 번호
                      </p>
                      {isAfterDraw && poolData.hit_count !== null && (
                        <span
                          className="text-[11px] font-medium px-2.5 py-0.5 rounded"
                          style={{ background: '#FAEEDA', color: '#633806' }}
                        >
                          적중 {poolData.hit_count} / {poolData.pool_size}
                        </span>
                      )}
                    </div>

                    {/* 추첨 전 카운트다운 */}
                    {!isAfterDraw && poolData.draw_at && (
                      <PoolCountdown drawAt={poolData.draw_at} />
                    )}

                    {/* 추첨 후 안내문 */}
                    {isAfterDraw && (
                      <p className="text-xs text-gray-500 mb-2">
                        추첨 후 적중하지 않은 번호는 사라졌습니다
                      </p>
                    )}

                    {/* 34칸 그리드 — 자리 유지
                        추첨 전: 모든 칸이 숫자
                        추첨 후: 적중 자리만 숫자 + amber, 미적중 자리는 점선 빈 박스 (위치만 유지) */}
                    <div className="grid grid-cols-10 sm:grid-cols-12 gap-1">
                      {poolData.pool_positional.map((n, idx) =>
                        n !== null ? (
                          <span
                            key={idx}
                            className="inline-flex items-center justify-center h-7 rounded text-[11px] font-medium tabular-nums"
                            style={
                              isAfterDraw
                                ? {
                                    background: '#FAEEDA',
                                    color: '#633806',
                                    boxShadow: '0 0 0 1.5px #BA7517',
                                  }
                                : {
                                    background: 'white',
                                    color: '#5F5E5A',
                                    border: '0.5px solid #D3D1C7',
                                  }
                            }
                            title={isAfterDraw ? `${n} — 적중` : `${n}`}
                          >
                            {n}
                          </span>
                        ) : (
                          /* 미적중 자리 — 점선 빈 박스 (위치만 유지, 미적중 번호는 비공개) */
                          <span
                            key={idx}
                            className="inline-flex items-center justify-center h-7 rounded text-[11px] tabular-nums"
                            style={{
                              background: '#F1EFE8',
                              color: '#B4B2A9',
                              border: '0.5px dashed #D3D1C7',
                            }}
                            aria-label="미적중 자리"
                          >
                            ·
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-4 sm:space-y-0 sm:grid sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 sm:gap-4 sm:items-start">
                {order.combinations_detail.map((c, i) => {
                  // v1.25 stage2 — 등수 계산: poolData (백엔드 응답)의 winning_nums/bonus 사용
                  const isAfterDraw = poolData?.draw_completed ?? false;
                  const winningNums = poolData?.winning_nums ?? null;
                  const bonus = poolData?.bonus ?? null;
                  let comboWinSet: Set<number> | null = null;
                  let mainMatch = 0;
                  let bonusMatch = false;
                  if (isAfterDraw && winningNums && bonus !== null) {
                    comboWinSet = new Set(winningNums);
                    mainMatch = c.numbers.filter((n) => comboWinSet!.has(n)).length;
                    bonusMatch = c.numbers.includes(bonus);
                  }

                  return (
                    <div key={i} className="border border-gray-200 rounded-lg p-4">
                      {/* 등수 배지 (추첨 완료 시) 또는 추첨 대기 배지 */}
                      <div className="mb-2">
                        <PrizeRankBadge
                          mainMatch={mainMatch}
                          bonusMatch={bonusMatch}
                          pending={!isAfterDraw}
                        />
                      </div>

                      <div className="flex items-center mb-2">
                        <span className="text-sm font-bold text-gray-700 mr-3">
                          [{i + 1}]
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {c.numbers.map((n, idx) => (
                            <LottoBall
                              key={idx}
                              n={n}
                              // 당첨/미당첨 강조 (추첨 완료 시에만)
                              highlight={!!comboWinSet && comboWinSet.has(n)}
                              dimmed={!!comboWinSet && !comboWinSet.has(n)}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 grid grid-cols-2 sm:grid-cols-4 gap-1 mt-2">
                        <span>합 {c.metrics.total_sum}</span>
                        <span>AC {c.metrics.ac}</span>
                        <span>홀짝 {c.metrics.odd_even}</span>
                        <span>고저 {c.metrics.low_high}</span>
                        <span>소수 {c.metrics.prime_count}</span>
                        <span>9궁 {c.metrics.palaces_used}/9</span>
                        <span>색상 {c.metrics.colors_used}/5</span>
                        <span>연속 {c.metrics.consecutive}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 text-xs text-gray-400 text-center">
                본 결과는 통계 분석에 의한 추천이며 당첨을 보장하지 않습니다.
              </div>
            </section>

            {/* 보조 패널 (lg에서 4/12, sticky)
                모바일: order-0 (결과 위), PC: order-2 (결과 우측) */}
            <aside className="lg:col-span-4 lg:order-2 lg:sticky lg:top-20 lg:self-start mb-4 lg:mb-0 space-y-3">
              <DrawCountdownCard predictRound={order.predict_round} />
              <HowToCheckCard predictRound={order.predict_round} />
            </aside>
          </div>
        )}

        <div className="text-center text-sm text-gray-500 mt-6">
          <Link href="/mypage" className="hover:text-brand-600">
            ← 구매 이력으로
          </Link>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: Order['status'] }) {
  const map = {
    pending: { label: '입금 대기', cls: 'bg-gray-100 text-gray-700' },
    awaiting_deposit: { label: '승인 대기', cls: 'bg-amber-100 text-amber-700' },
    paid: { label: '결제 완료', cls: 'bg-green-100 text-green-700' },
    cancelled: { label: '취소', cls: 'bg-red-100 text-red-700' },
  };
  const info = map[status];
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${info.cls}`}>
      {info.label}
    </span>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
  copied,
  highlight = false,
}: {
  label: string;
  value: string;
  onCopy: (v: string, l: string) => void;
  copied: string | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className={`font-mono ${
            highlight ? 'text-lg font-bold text-brand-700' : 'text-base'
          }`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => onCopy(value, label)}
          className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          {copied === label ? '복사됨' : '복사'}
        </button>
      </div>
    </div>
  );
}


/* ────────────────────────────────────────────────────────────
 * v1.14 — DrawCountdownCard / useCountdown / getNextDrawAt 는
 *         components/DrawCountdownCard.tsx 로 분리 (메인 대시보드 공용)
 * P2 HowToCheckCard 는 result 페이지 전용이라 아래 그대로 유지
 * ──────────────────────────────────────────────────────────── */


function HowToCheckCard({ predictRound }: { predictRound: number }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-brand-100">
      <h3 className="text-sm font-bold text-brand-900 mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs">
          ?
        </span>
        당첨 확인 방법
      </h3>

      <ol className="space-y-3 text-xs sm:text-sm text-gray-700">
        <li className="flex gap-2">
          <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
            1
          </span>
          <span>
            <strong className="text-brand-900">토요일 저녁 8:35</strong> 추첨 후
            당첨번호 발표
          </span>
        </li>
        <li className="flex gap-2">
          <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
            2
          </span>
          <span>
            받으신 조합과 당첨번호의{' '}
            <strong className="text-brand-900">일치 개수</strong> 확인
          </span>
        </li>
        <li className="flex gap-2">
          <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
            3
          </span>
          <span>
            5등 3개 · 4등 4개 · 3등 5개 · 2등 5개+보너스 · 1등 6개 일치
          </span>
        </li>
      </ol>

      <div className="mt-4 space-y-2">
        <a
          href={`https://dhlottery.co.kr/gameResult.do?method=byWin&drwNo=${predictRound}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs bg-brand-50 text-brand-700 font-medium py-2 rounded-lg hover:bg-brand-100 transition"
        >
          {predictRound}회 당첨번호 보기 →
        </a>
        <Link
          href="/log"
          className="block text-center text-xs text-neutral-600 hover:text-brand-600 py-1"
        >
          지난 적중 결과 보기 →
        </Link>
      </div>
    </div>
  );
}
