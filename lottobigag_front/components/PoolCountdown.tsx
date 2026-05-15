'use client';

import { useEffect, useState } from 'react';

/**
 * v1.25 stage2 — 결과 페이지의 추첨 전 카운트다운 메시지 (사장님 합의 2026-05-15)
 *
 * 동작:
 *   - 추첨 전(`draw_completed=false`) 상태에서만 노출
 *   - draw_at(다음 추첨 시작 시각, ISO8601) 까지 남은 시간을 실시간 표시
 *   - 1초마다 갱신, 0초 도달 시 부모가 폴링으로 새 응답 받으면 자동 분기 (추첨 후 화면으로 전환)
 *
 * 디자인:
 *   - amber 톤 (시간 제한 의미)
 *   - 풀 카드 안 상단에 배치
 *   - 모바일 320px ~ PC 모두 한 줄 가독성 유지 (clock 아이콘 + 메시지 + 시간)
 *
 * 작업 규칙 #8: 모바일 반응형. 시간 표시는 tabular-nums 로 자릿수 흔들림 방지.
 * 작업 규칙 #2: cleanup(컴포넌트 unmount 시 interval clear).
 */
export function PoolCountdown({ drawAt }: { drawAt: string }) {
  const [remaining, setRemaining] = useState<string>('');

  useEffect(() => {
    function format(ms: number): string {
      if (ms <= 0) return '추첨 시작';
      const totalSec = Math.floor(ms / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      const pad = (n: number) => String(n).padStart(2, '0');
      if (days > 0) {
        return `${days}일 ${pad(hours)}시간 ${pad(mins)}분 ${pad(secs)}초`;
      }
      return `${pad(hours)}시간 ${pad(mins)}분 ${pad(secs)}초`;
    }

    // 초기 1회 계산 후 1초 간격 갱신
    const tick = () => {
      const drawTime = new Date(drawAt).getTime();
      const now = Date.now();
      setRemaining(format(drawTime - now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [drawAt]);

  return (
    <div
      className="rounded-md p-3 mb-3 flex items-center gap-2.5"
      style={{ background: '#FAEEDA' }}
    >
      {/* 아이콘 — 시계 (시간 제한 의미) */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#854F0B"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="text-xs font-medium" style={{ color: '#854F0B', margin: 0 }}>
          추첨 시작 시 적중하지 않은 번호는 사라집니다
        </p>
        <p
          className="text-xs font-medium tabular-nums"
          style={{ color: '#633806', margin: '2px 0 0' }}
        >
          남은 시간 · <span className="text-sm">{remaining}</span>
        </p>
      </div>
    </div>
  );
}
