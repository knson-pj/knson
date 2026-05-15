'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getRecentAnalysisStatus,
  type RecentAnalysisStatus,
} from '@/lib/api';

/**
 * v1.14 — 추출엔진 풀 카드 (메인 대시보드 + /order 페이지 공용)
 *
 * v1.19 갱신 (사장님 합의 2026-05-12 — 전면 재작성, "정직 = 운영의 생명"):
 *   - 디자인 톤: 흰 카드 + 신경망 SVG → 서버룸·터미널식 짙은 모노톤
 *   - 폰트: 모노스페이스 (SF Mono / Monaco / Consolas)
 *   - 표현: AI 분석 시뮬레이션 → 백엔드 실제 단계 시각을 그대로 노출
 *           (data_load · backtest · pattern_scan · pool_select 4단계)
 *
 *   두 가지 상태로 자동 전환 (백엔드 /api/recent-analysis-status 응답 기반):
 *     STANDBY — 평소 시간 (99% 시간대)
 *       · 모든 4단계 ✓ + 각 단계의 실제 백엔드 완료 시각
 *       · "last analysis · r####" + standing by 메시지
 *       · 백테스트 로그 4줄 (최근 회차 매칭 결과 — 실제 진실값)
 *     RUNNING — 어드민 당첨번호 입력 후 ~25초 동안
 *       · 완료된 단계는 ✓ + 실제 시각, 진행 중은 ▶ + 진행 막대, 대기 단계는 [ ]
 *       · "processing r#### · {단계명} running..." + 깜빡이는 커서
 *
 *   적응형 polling 전략:
 *     · 평소: 60초 간격 (백엔드 부하 거의 없음)
 *     · running 감지 시: 2초 간격으로 자동 단축 (실시간 단계 진행 노출)
 *     · standby 복귀 시: 60초 간격으로 복귀
 *
 * 정직 원칙 검증:
 *   - 단계 시각은 백엔드 admin_lotto_bff.py + admin_lotto.py 가 실제 처리 직후 UPDATE
 *   - 프론트는 받은 시각을 그대로 표시 (시뮬레이션·임의 값 X)
 *   - 백테스트 로그도 실제 회차 데이터(props 로 전달받음) 사용
 *
 * Props:
 *   round: 분석 대상 회차 (current_round, 예: 1224)
 *   poolSize:  추출 풀 크기(보통 34) — v1.25 stage2 에서 pool: number[] → poolSize: number 로 정직화
 *              (사용자에게 풀 번호 노출 X 정책 — 화면에는 k=34 길이만 표시)
 *   infoText: (옵션) 호출 컨텍스트별 안내 — /order 페이지에서 사용
 *   backtestLog: (옵션) 백테스트 로그 4줄. 미전달 시 STANDBY 상태에서 영역 숨김.
 *
 * 작업 규칙 #8: 모바일 반응형 — 모노스페이스 + tabular-nums + grid 자동 조정.
 * 작업 규칙 #2: polling cleanup, prefers-reduced-motion 처리, polling 실패 시 fallback.
 */

const INFO_TEXT_DEFAULT =
  '엔진이 다음 추첨 회차를 위해 데이터·백테스트로 분석합니다.';

// 적응형 polling 주기
const POLL_INTERVAL_STANDBY_MS = 60_000; // 평소 60초
const POLL_INTERVAL_RUNNING_MS = 2_000;  // 처리 중 2초

// 시각 포맷터 (KST HH:mm:ss)
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '—';
  }
}

// 회차 포맷터 (r1224)
function fmtRound(round: number | null | undefined): string {
  return round != null ? `r${round}` : 'r—';
}

// 마지막 분석 시각 포맷터 (yyyy-mm-dd HH:mm:ss KST)
function fmtFullDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} KST`;
  } catch {
    return '—';
  }
}

// 4단계 키 순서
const PHASE_KEYS = [
  'data_load_at',
  'backtest_at',
  'pattern_scan_at',
  'pool_select_at',
] as const;

const PHASE_LABELS: Record<(typeof PHASE_KEYS)[number], string> = {
  data_load_at: 'data_load',
  backtest_at: 'backtest',
  pattern_scan_at: 'pattern_scan',
  pool_select_at: 'pool_select',
};

export interface BacktestLogEntry {
  round: number;          // 회차
  match: number;          // m=일치 개수
  bonus: boolean;         // 보너스 포함 여부
  poolHit: boolean;       // 풀이 등수에 도달했는지
  star?: boolean;         // 1등 적중 등 강조
}

export function ExtractEnginePoolCard({
  round,
  poolSize,
  infoText,
  backtestLog,
}: {
  round: number;
  /**
   * v1.25 stage2 — 풀 크기 (보통 34). 이전엔 `pool: number[]` 으로 전체 배열을 받았으나,
   * 컴포넌트가 length 만 사용 + 사용자에게 풀 번호 노출 X 정책상 poolSize 만 받도록 정직화.
   * 호출자는 `extractInfo.current_pool_size` 를 그대로 전달.
   */
  poolSize: number;
  infoText?: string;
  backtestLog?: BacktestLogEntry[];
}) {
  const [status, setStatus] = useState<RecentAnalysisStatus | null>(null);
  const [fetchError, setFetchError] = useState<boolean>(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 적응형 polling — 상태 기반으로 다음 호출 주기 동적 조정
  useEffect(() => {
    let cancelled = false;

    const scheduleNext = (intervalMs: number) => {
      if (cancelled) return;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(poll, intervalMs);
    };

    const poll = async () => {
      try {
        const data = await getRecentAnalysisStatus();
        if (cancelled) return;
        setStatus(data);
        setFetchError(false);
        // 다음 polling 주기 — running 이면 2초, standby 면 60초
        scheduleNext(
          data.status === 'running'
            ? POLL_INTERVAL_RUNNING_MS
            : POLL_INTERVAL_STANDBY_MS,
        );
      } catch {
        if (cancelled) return;
        setFetchError(true);
        // 에러 시 평소 주기로 재시도 (백엔드 일시 장애 시 부담 X)
        scheduleNext(POLL_INTERVAL_STANDBY_MS);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // 표시 상태 결정
  const isRunning = status?.status === 'running';
  const phases = status?.phases || {};
  const currentRound = isRunning ? status?.round : round;

  // 현재 진행 중인 단계 식별 (running 상태에서만 의미 있음)
  let currentPhaseIdx = -1;
  if (isRunning) {
    for (let i = 0; i < PHASE_KEYS.length; i++) {
      if (!(phases as Record<string, string | null | undefined>)[PHASE_KEYS[i]]) {
        currentPhaseIdx = i;
        break;
      }
    }
  }

  return (
    <section
      className="rounded-xl shadow-sm border overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #17171a 0%, #141418 100%)',
        borderColor: 'rgba(255,255,255,0.10)',
        fontFamily:
          "'SF Mono', 'Monaco', 'Menlo', 'Consolas', ui-monospace, monospace",
        color: '#d4d4d4',
      }}
    >
      <style>{`
        @keyframes ee-blink-cursor { 0%, 50% { opacity: 1 } 50.1%, 100% { opacity: 0 } }
        @keyframes ee-scan-bar { 0% { width: 24% } 50% { width: 74% } 100% { width: 42% } }
        @keyframes ee-status-dot { 0%, 100% { opacity: 0.55 } 50% { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .ee-pulse, .ee-bar-fill, .ee-cursor { animation: none !important; }
        }
      `}</style>

      {/* 헤더 — 프롬프트 + 상태 배지 */}
      <div
        className="flex justify-between items-center px-4 py-3 text-[10.5px]"
        style={{ borderBottom: '1px dashed rgba(255,255,255,0.10)' }}
      >
        <span style={{ color: '#8b8b92' }}>
          <span style={{ color: '#00d9ff', marginRight: 4 }}>$</span>
          <span style={{ color: '#e4e4e7' }}>extract.engine</span>{' '}
          <span style={{ color: '#f87cd2' }}>--round={currentRound}</span>
        </span>
        <StatusBadge running={isRunning} fetchError={fetchError} />
      </div>

      <div className="px-4 py-3">
        {/* 안내 텍스트 (옅게, 카드 컨텍스트 설명) */}
        <p className="text-[10.5px] mb-3" style={{ color: '#8b8b92' }}>
          {infoText ?? INFO_TEXT_DEFAULT}
        </p>

        {/* STANDBY 상태: 마지막 분석 정보 박스 */}
        {!isRunning && status?.last_completed_at && (
          <div
            className="text-[10px] mb-2 px-2 py-1.5 rounded"
            style={{
              color: '#8b8b92',
              background: 'rgba(74,222,128,0.06)',
              border: '1px solid rgba(74,222,128,0.15)',
            }}
          >
            last analysis ·{' '}
            <span style={{ color: '#4ade80' }}>
              {fmtRound(status.last_completed_round)}
            </span>{' '}
            · {fmtFullDateTime(status.last_completed_at)}
          </div>
        )}

        {/* 4단계 진행 표시 */}
        <div className="text-[11px]">
          {PHASE_KEYS.map((key, idx) => {
            const ts = (phases as Record<string, string | null | undefined>)[key];
            const completed = !!ts;
            const isCurrent = isRunning && idx === currentPhaseIdx;
            const isWaiting = !completed && !isCurrent;

            return (
              <div
                key={key}
                className="grid items-center py-0.5"
                style={{ gridTemplateColumns: '40px 1fr 90px', gap: '8px' }}
              >
                <span
                  className="text-[10px]"
                  style={{
                    color: completed
                      ? '#4ade80'
                      : isCurrent
                        ? '#00d9ff'
                        : '#6b6b73',
                  }}
                >
                  {completed ? '[✓]' : isCurrent ? '[▶]' : '[ ]'}
                </span>

                {isCurrent ? (
                  // 진행 중 — 진행 막대
                  <div
                    className="flex items-center gap-1.5"
                    style={{ minWidth: 0 }}
                  >
                    <div
                      className="flex-1 h-1.5 rounded overflow-hidden"
                      style={{ background: 'rgba(255,255,255,0.08)' }}
                    >
                      <div
                        className="ee-bar-fill h-full rounded"
                        style={{
                          background:
                            'linear-gradient(90deg, #0891b2, #00d9ff)',
                          boxShadow: '0 0 6px rgba(0,217,255,0.45)',
                          animation:
                            'ee-scan-bar 3.2s ease-in-out infinite',
                          width: '24%',
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <span
                    style={{
                      color: isWaiting ? '#8b8b92' : '#e4e4e7',
                    }}
                  >
                    {PHASE_LABELS[key]}
                  </span>
                )}

                <span
                  className="text-[10px] text-right tabular-nums"
                  style={{
                    color: completed
                      ? '#6b6b73'
                      : isCurrent
                        ? '#8b8b92'
                        : '#6b6b73',
                  }}
                >
                  {completed ? fmtTime(ts) : isCurrent ? 'running...' : '—'}
                </span>
              </div>
            );
          })}
        </div>

        {/* 백테스트 로그 (옵션) — STANDBY 상태에서만 노출 */}
        {!isRunning && backtestLog && backtestLog.length > 0 && (
          <div
            className="mt-3 p-2.5 rounded"
            style={{
              background: 'rgba(255,255,255,0.035)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <div
              className="text-[10px] mb-1.5"
              style={{ color: '#8b8b92', letterSpacing: '0.04em' }}
            >
              // backtest log (recent {backtestLog.length})
            </div>
            {backtestLog.map((entry) => (
              <div
                key={entry.round}
                className="grid items-center py-0.5 text-[10.5px]"
                style={{ gridTemplateColumns: '50px 1fr 70px', gap: '6px' }}
              >
                <span style={{ color: '#e4e4e7' }}>r{entry.round}</span>
                <span style={{ color: '#a8a8b0' }}>
                  m={entry.match}
                  {entry.bonus ? ' +bonus' : ''}
                </span>
                <span
                  className="justify-self-end text-[9.5px] px-1.5 py-0.5 rounded-full"
                  style={{
                    border: '1px solid',
                    ...(entry.star
                      ? {
                          color: '#f87cd2',
                          borderColor: 'rgba(248,124,210,0.35)',
                        }
                      : entry.poolHit
                        ? {
                            color: '#4ade80',
                            borderColor: 'rgba(74,222,128,0.35)',
                          }
                        : {
                            color: '#a8a8b0',
                            borderColor: 'rgba(255,255,255,0.12)',
                          }),
                  }}
                >
                  {entry.star ? '★ pool' : entry.poolHit ? 'pool' : '—'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 상태 메시지 */}
        {isRunning ? (
          <div
            className="mt-3 px-2 py-1.5 rounded text-[10.5px] flex items-center gap-1"
            style={{
              background: 'rgba(0,217,255,0.06)',
              color: '#00d9ff',
            }}
          >
            <span>{'>'}</span>
            <span>
              processing {fmtRound(currentRound)} ·{' '}
              {currentPhaseIdx >= 0
                ? `${PHASE_LABELS[PHASE_KEYS[currentPhaseIdx]]} running...`
                : 'finalizing...'}
            </span>
            <Cursor />
          </div>
        ) : status ? (
          <div
            className="mt-3 px-2 py-1.5 rounded text-[10.5px] flex justify-between items-center"
            style={{
              background: 'rgba(255,255,255,0.025)',
              color: '#8b8b92',
            }}
          >
            <span>// standing by for {fmtRound(currentRound)} draw</span>
            <span style={{ color: '#00d9ff' }}>→</span>
          </div>
        ) : (
          // 초기 로딩 또는 fetch 에러
          <div
            className="mt-3 px-2 py-1.5 rounded text-[10.5px]"
            style={{
              background: 'rgba(255,255,255,0.025)',
              color: '#8b8b92',
            }}
          >
            {fetchError
              ? '// status unavailable · retrying...'
              : '// loading status...'}
          </div>
        )}

        {/* 푸터 */}
        <div
          className="mt-3 pt-2 flex justify-between items-center text-[10px]"
          style={{
            borderTop: '1px dashed rgba(255,255,255,0.10)',
            color: '#6b6b73',
          }}
        >
          <span style={{ color: '#8b8b92' }}>
            engine v3.2 · stats model
          </span>
          <span>
            k={poolSize}
            <Cursor />
          </span>
        </div>
      </div>
    </section>
  );
}

function StatusBadge({
  running,
  fetchError,
}: {
  running: boolean;
  fetchError: boolean;
}) {
  if (fetchError) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px]"
        style={{ color: '#f59e0b', letterSpacing: '0.05em' }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: '#f59e0b' }}
          aria-hidden
        />
        OFFLINE
      </span>
    );
  }
  if (running) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px]"
        style={{ color: '#00d9ff', letterSpacing: '0.05em' }}
      >
        <span
          className="ee-pulse w-1.5 h-1.5 rounded-full"
          style={{
            background: '#00d9ff',
            boxShadow: '0 0 6px #00d9ff',
            animation: 'ee-status-dot 1.2s ease-in-out infinite',
          }}
          aria-hidden
        />
        RUNNING
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px]"
      style={{ color: '#4ade80', letterSpacing: '0.05em' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80' }}
        aria-hidden
      />
      STANDBY
    </span>
  );
}

function Cursor() {
  return (
    <span
      className="ee-cursor inline-block ml-0.5"
      style={{
        width: 6,
        height: 11,
        background: '#00d9ff',
        verticalAlign: -1,
        boxShadow: '0 0 6px #00d9ff',
        animation: 'ee-blink-cursor 1s step-end infinite',
      }}
      aria-hidden
    />
  );
}
