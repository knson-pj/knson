// =============================================================================
// knson rate-limit 유틸 (2026-04-22)
// =============================================================================
//
// 공개 엔드포인트에 대한 단순 token-bucket 기반 IP/phone rate-limit.
//
// 설계 원칙:
//   1) 저빈도 공개 등록 트래픽에 대한 인메모리 방어가 주 목적. 완벽한 분산 rate
//      limit 이 아니라 "봇 스팸 1대" 수준의 공격을 차단하는 게 목적.
//   2) Vercel 서버리스 환경이라 인스턴스마다 메모리가 분리되고 cold start 마다
//      초기화된다. 대량 공격(DDoS) 대응은 Cloudflare/Vercel 방어에 맡기고,
//      이 레이어는 그 아래 단계의 애플리케이션 레벨 방어를 담당.
//   3) 장기적으로 Upstash Redis 등 외부 저장소로 스왑 가능하도록 입출력을 단순화
//      (key, now, config) 만 받고 순수 boolean + meta 반환. 저장소 교체 시 이 파일만
//      수정.
//
// 사용 예:
//   const { checkRateLimit, getClientIp } = require('../_lib/rate-limit');
//   const ip = getClientIp(req);
//   const rl = checkRateLimit(`public-listings:ip:${ip}`, {
//     windowMs: 60_000, max: 5,
//   });
//   if (!rl.allowed) return send(res, 429, { ok: false, message: '잠시 후 다시 시도해 주세요.' });
// =============================================================================

'use strict';

// 전역 스토어 — 프로세스가 죽을 때까지 유지.
// key 당 최근 요청 타임스탬프 배열을 슬라이딩 윈도우로 저장.
// 메모리 누수를 막기 위해 주기적으로 오래된 key 를 정리한다.
if (!global.__KNSON_RATE_LIMIT_STORE__) {
  global.__KNSON_RATE_LIMIT_STORE__ = new Map();
}
if (!global.__KNSON_RATE_LIMIT_LAST_CLEANUP__) {
  global.__KNSON_RATE_LIMIT_LAST_CLEANUP__ = Date.now();
}

const STORE = global.__KNSON_RATE_LIMIT_STORE__;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5분마다 GC
const MAX_TIMESTAMPS_PER_KEY = 200;        // key 하나당 최대 저장 이벤트 수 (메모리 상한)

/**
 * HTTP 요청에서 클라이언트 IP 를 추출한다.
 * Vercel / Cloudflare / 프록시 뒤 환경을 모두 고려한다.
 */
function getClientIp(req) {
  try {
    const headers = req.headers || {};
    const fwd = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
    const real = String(headers['x-real-ip'] || '').trim();
    if (real) return real;
    const cf = String(headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    return String(remote || '').trim();
  } catch {
    return '';
  }
}

/**
 * 저장소에서 윈도우 내 타임스탬프만 유지하고, 조건에 맞으면 새 이벤트를 기록.
 *
 * @param {string} key            식별 키 (e.g. "public-listings:ip:1.2.3.4")
 * @param {object} opts
 * @param {number} opts.windowMs  슬라이딩 윈도우 크기 (ms)
 * @param {number} opts.max       윈도우 내 최대 허용 이벤트 수
 * @param {number} [opts.now]     현재 시각 (테스트용, 기본 Date.now())
 * @param {boolean}[opts.record]  true(기본)면 허용 시 이벤트 기록. false 면 체크만.
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number, count: number }}
 */
function checkRateLimit(key, opts = {}) {
  const windowMs = Math.max(1, Number(opts.windowMs || 60_000));
  const max = Math.max(1, Number(opts.max || 5));
  const now = Number(opts.now || Date.now());
  const record = opts.record !== false;

  maybeCleanup(now);

  const k = String(key || '').trim();
  if (!k) {
    // key 없으면 방어적으로 거부 대신 통과 (호출자 책임)
    return { allowed: true, remaining: max, retryAfterMs: 0, count: 0 };
  }

  const arr = STORE.get(k) || [];
  // 윈도우 밖 타임스탬프 제거
  const cutoff = now - windowMs;
  let i = 0;
  while (i < arr.length && arr[i] <= cutoff) i += 1;
  const fresh = i > 0 ? arr.slice(i) : arr;

  if (fresh.length >= max) {
    // 가장 오래된 이벤트가 윈도우를 벗어나려면 얼마나 기다려야 하는지
    const oldest = fresh[0];
    const retryAfterMs = Math.max(0, oldest + windowMs - now);
    // 기록은 하지 않고 거부
    if (fresh !== arr) STORE.set(k, fresh);
    return { allowed: false, remaining: 0, retryAfterMs, count: fresh.length };
  }

  if (record) {
    fresh.push(now);
    // key 당 저장 상한 (비정상적으로 쌓이면 앞에서 잘라냄)
    const capped = fresh.length > MAX_TIMESTAMPS_PER_KEY
      ? fresh.slice(fresh.length - MAX_TIMESTAMPS_PER_KEY)
      : fresh;
    STORE.set(k, capped);
    return { allowed: true, remaining: Math.max(0, max - capped.length), retryAfterMs: 0, count: capped.length };
  }

  if (fresh !== arr) STORE.set(k, fresh);
  return { allowed: true, remaining: Math.max(0, max - fresh.length), retryAfterMs: 0, count: fresh.length };
}

/**
 * 한 요청에 대해 여러 bucket (IP/phone 등) 을 연속 체크.
 * 먼저 거부되는 bucket 의 결과를 반환.
 *
 * @param {Array<{ key: string, windowMs: number, max: number, label?: string }>} buckets
 * @param {number} [now]
 * @returns {{ allowed: boolean, bucket?: string, retryAfterMs?: number }}
 */
function checkRateLimitMany(buckets, now = Date.now()) {
  const list = Array.isArray(buckets) ? buckets : [];
  for (const b of list) {
    const result = checkRateLimit(b.key, {
      windowMs: b.windowMs,
      max: b.max,
      now,
      record: false, // 체크만
    });
    if (!result.allowed) {
      return { allowed: false, bucket: b.label || b.key, retryAfterMs: result.retryAfterMs };
    }
  }
  // 전체 체크 통과 — 모두 기록
  for (const b of list) {
    checkRateLimit(b.key, { windowMs: b.windowMs, max: b.max, now, record: true });
  }
  return { allowed: true };
}

function maybeCleanup(now = Date.now()) {
  if (now - global.__KNSON_RATE_LIMIT_LAST_CLEANUP__ < CLEANUP_INTERVAL_MS) return;
  global.__KNSON_RATE_LIMIT_LAST_CLEANUP__ = now;

  // 가장 큰 윈도우(24h 추정)보다 오래된 key 는 전부 삭제
  const STALE_CUTOFF = now - 24 * 60 * 60 * 1000;
  for (const [k, arr] of STORE.entries()) {
    if (!Array.isArray(arr) || !arr.length) {
      STORE.delete(k);
      continue;
    }
    const lastTs = arr[arr.length - 1];
    if (lastTs < STALE_CUTOFF) STORE.delete(k);
  }
}

module.exports = {
  getClientIp,
  checkRateLimit,
  checkRateLimitMany,
};
