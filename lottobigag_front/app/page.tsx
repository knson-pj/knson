'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import {
  ExtractEnginePoolCard,
  type BacktestLogEntry,
} from '@/components/ExtractEnginePoolCard';
import { PrevRoundCard } from '@/components/PrevRoundCard';
import { DrawCountdownCard } from '@/components/DrawCountdownCard';
import { CumulativeWinsHero } from '@/components/CumulativeWinsHero';
import {
  getRoundInfo,
  getExtractEngineInfo,
  type RoundInfo,
  type ExtractEngineInfo,
} from '@/lib/api';
import {
  fetchRecentRoundLogs,
  type RoundLogRow,
} from '@/lib/round-logs';
import { prizeRank } from '@/lib/lottery';

/**
 * v1.14 — 메인 페이지 = 대시보드 (사장님 합의 옵션 A)
 *
 * 이전(v1.13): 헤로(인디고 그라데이션) + 주문 양식(1·2·3·무통장·버튼) + 우측 정보 패널
 * 변경(v1.14): 정보·실적 위주 대시보드. 주문은 /order 페이지로 분리.
 *
 * v1.23 갱신 (사장님 합의 2026-05-15 — 직전 회차 카드 + 백테스트 로그 통합):
 *   - PrevRoundCard 데이터 소스 변경: extractInfo.previous_round → Supabase 직접 조회 (RoundLogRow)
 *     → log/page.tsx 와 동일 데이터 소스 사용, 카드 디자인도 동일 통일
 *   - ExtractEnginePoolCard 에 backtestLog prop 신규 전달 (최근 4회차 매칭 결과)
 *     → STANDBY 상태에서 분석 카드 안에 "// backtest log (recent 4)" 4줄 표시
 *   - 신규 의존성: lib/round-logs.ts (Supabase 조회 헬퍼)
 *   - 작업 규칙 #5 보존: extractInfo (백엔드 API) 호출은 그대로 — 누적 통계 등 다른 영역에 필요
 *
 * 구성:
 *   1. 헤로 (전체) — 누적 34추출엔진 적중 5등급 + 큰 CTA → /order
 *   2. PC 2-column: 분석 카드(좌, 백테스트 로그 포함) + 카운트다운(우)
 *   3. 직전 회차 결과 — 적중로그 회차 카드와 동일 디자인 (조합엔진·결제 조합 5등급 포함)
 *   4. 부가 링크 — 적중 로그·통계·구매 이력
 *
 * 데이터 호출: getRoundInfo + getExtractEngineInfo + fetchRecentRoundLogs(4) 병렬
 * cumulative_stats.extract_pool 은 백엔드 60초 캐시.
 */
export default function HomePage() {
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [extractInfo, setExtractInfo] = useState<ExtractEngineInfo | null>(null);
  // v1.23 — 최근 4회차 (직전 회차 카드 + 백테스트 로그 공용 데이터)
  const [recentRounds, setRecentRounds] = useState<RoundLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getRoundInfo(),
      getExtractEngineInfo(),
      // v1.23 — Supabase 직접 조회: lotto_history + engine_history 최근 4회차
      // 실패 시 빈 배열 fallback (PrevRoundCard·백테스트 로그 미표시, 다른 영역은 정상 노출)
      fetchRecentRoundLogs(4).catch(() => [] as RoundLogRow[]),
    ])
      .then(([r, ext, recent]) => {
        setRound(r);
        setExtractInfo(ext);
        setRecentRounds(recent);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
    // v1.18: fetchJson 의 retry: 1 가 이미 작동한 뒤에도 실패한 케이스.
    // 첫 노출에 빨간 에러 코드 대신 사용자 친화 메시지 + 새로고침 버튼 제공.
    return (
      <>
        <Header />
        <main className="container mx-auto px-4 py-16 max-w-md text-center">
          <div className="bg-white rounded-xl shadow-sm border border-neutral-100 p-6">
            <p className="text-3xl mb-3" aria-hidden>⏳</p>
            <h2 className="text-base font-semibold text-neutral-900 mb-2">
              분석 서버를 깨우는 중이에요
            </h2>
            <p className="text-sm text-neutral-600 mb-5 leading-relaxed">
              일시적으로 분석 데이터를 불러오지 못했습니다.
              <br />
              잠시 후 다시 시도해 주세요.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              다시 시도
            </button>
            {error && (
              <p className="mt-4 text-xs text-neutral-400">
                상세: {error}
              </p>
            )}
          </div>
        </main>
      </>
    );
  }

  const cumulativeStats = extractInfo?.cumulative_stats?.extract_pool ?? null;

  // v1.23 — 직전 회차 카드 데이터 = recentRounds 의 가장 최근 (desc 정렬 [0])
  // recentRounds 가 빈 배열이면 (페치 실패) prevRow=null → 카드 영역 미표시
  const prevRow = recentRounds[0] ?? null;

  // v1.23 — 백테스트 로그 4줄 = 최근 4회차 매칭 결과 (오래된 → 최신 순으로 reverse)
  // 등수 도달 여부: prizeRank 가 null 아니면 pool 도달, 1등(rank===1) 이면 star
  const backtestLog: BacktestLogEntry[] = recentRounds
    .slice()
    .reverse()
    .map((r) => {
      const eh = r.eh!; // fetchRecentRoundLogs 가 eh !== null 만 반환 (안전)
      const rank = prizeRank(eh.extract_main_match, eh.extract_bonus_match);
      return {
        round: r.round,
        match: eh.extract_main_match,
        bonus: eh.extract_bonus_match,
        poolHit: rank !== null,
        star: rank === 1,
      };
    });

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-6 sm:py-8 max-w-3xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px]">

        {/* 1. 헤로 — 누적 적중 5등급 + 큰 CTA (v1.18: 회차 카운트 동적 계산)
            v1.19: 조합엔진 영역 추가 — standard_total prop 신규 전달 */}
        <CumulativeWinsHero
          stats={cumulativeStats}
          standardTotal={extractInfo?.cumulative_stats?.standard_total ?? null}
          previousRound={extractInfo?.previous_round?.round ?? null}
        />

        {/* 2. PC 2-column: 분석 카드(좌) + 카운트다운(우) */}
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start mb-2">

          {/* 분석 카드 (PC 좌 col-span-2, 모바일 1단)
              v1.23: backtestLog prop 신규 전달 — STANDBY 상태에서 4줄 백테스트 로그 표시 */}
          <div className="lg:col-span-2">
            {extractInfo && extractInfo.current_pool_size > 0 ? (
              <ExtractEnginePoolCard
                round={extractInfo.current_round}
                poolSize={extractInfo.current_pool_size}
                infoText="월요일까지 34추출엔진이 가동하며, 이후 조합엔진을 통한 구매 주문이 가능합니다."
                backtestLog={backtestLog}
              />
            ) : (
              <section className="bg-white rounded-xl p-6 mb-4 shadow-sm text-center text-sm text-gray-500">
                분석 정보를 불러오는 중...
              </section>
            )}
          </div>

          {/* 카운트다운 (PC 우 col-span-1, sticky) */}
          <aside className="lg:col-span-1 lg:sticky lg:top-20 mb-4 lg:mb-0">
            <DrawCountdownCard predictRound={round.predict_round} />
          </aside>
        </div>

        {/* 3. 직전 회차 결과 — 적중로그 회차 카드와 동일 디자인 (v1.23)
            recentRounds 가 빈 배열이면 prevRow=null → 영역 자체 미표시 */}
        {prevRow && <PrevRoundCard row={prevRow} />}

        {/* 4. 추가 정보 진입 — 적중 로그·통계·구매 이력 (Footer 와 별개로 메인 콘텐츠 영역에 노출) */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
          <DashboardLink
            href="/log"
            title="적중 로그"
            desc="회차별 매칭 이력"
            emoji="📈"
          />
          <DashboardLink
            href="/stats"
            title="참고 통계"
            desc="과거 데이터 분포"
            emoji="📊"
          />
          <DashboardLink
            href="/mypage"
            title="구매 이력"
            desc="내 주문 확인"
            emoji="🧾"
          />
        </section>

        {/* 5. 보조 CTA — 페이지 하단 한 번 더 (스크롤 후 진입 유도) */}
        <div className="mt-8 text-center">
          <Link
            href="/order"
            className="inline-flex items-center gap-2 bg-point-600 hover:bg-point-700 text-white font-bold px-7 py-3 rounded-full shadow-md transition-colors"
          >
            분석 번호 구매하기 →
          </Link>
        </div>
      </main>
    </>
  );
}

/**
 * 대시보드 보조 진입 카드 — 모바일 1단, 데스크탑 3개 가로
 */
function DashboardLink({
  href, title, desc, emoji,
}: { href: string; title: string; desc: string; emoji: string }) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl p-4 shadow-sm border border-brand-100 hover:border-brand-300 hover:shadow-md transition-all group"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden>{emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-brand-900 group-hover:text-brand-700">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
        </div>
        <span className="text-brand-400 group-hover:text-brand-600" aria-hidden>→</span>
      </div>
    </Link>
  );
}
