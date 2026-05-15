"""
api/routers/orders.py — Cloudtype 측 사용자 주문 (Group D, Phase D-1d)
========================================================================
이전 api/index.py 라인 789~963 영역 인플레이스 이동 + BFF 패턴 적용.

배포 환경: Cloudtype (DEPLOY_TARGET=cloudtype) 만 등록.
역할: 사용자 주문 / 결제 흐름 — 모든 개인정보 처리는 한국 인프라에서.

엔드포인트 (4개):
    POST /api/orders/prepare              주문 생성 + 입금 안내
    POST /api/orders/{order_id}/mark-deposit  사용자 "입금했어요"
    GET  /api/orders                      사용자 구매 이력
    GET  /api/orders/{order_id}           단일 주문 조회

분리 환경 변경:
    - prepare 엔드포인트가 가격/회차 검증을 위해 Vercel /api/internal/prediction-snapshot
      을 호출하거나, business_config 의 PRICING_TIERS + 별도 회차 캐시 사용.
    - 단순화 위해 회차 정보는 Vercel /api/round-info 를 BFF 호출 (캐시 hit 시 ~수십 ms).

원본 시그니처/시맨틱 그대로 보존 — 작업 규칙 #4. 단 단일 백엔드 시절
get_or_compute_prediction() 직접 호출은 Vercel internal 호출로 대체.

개인정보 처리 영역:
    - JWT 검증 (카카오 닉네임/이메일/user_id) — Cloudtype 메모리만
    - orders 테이블 INSERT/SELECT/UPDATE — Supabase 한국 리전
    - deposit_name 생성 — Cloudtype 메모리만
    - lotto_engine.metrics.compute_all_metrics — get_order 응답 시 메트릭 계산용
      (UI 표시용 — 수치 계산만, 개인정보 무관)
"""
import hashlib
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException

# get_order 응답의 combinations_detail 메트릭 계산용 (가벼운 함수, numpy 무관)
from lotto_engine import metrics as M

from ..auth import get_current_user, check_rate_limit
from ..business_config import (
    PRICING_TIERS, ALLOWED_N_COMBOS, DIVERSITY_OPTIONS,
)
from ..config import (
    BUSINESS_BANK_NAME,
    BUSINESS_ACCOUNT_NUMBER,
    BUSINESS_ACCOUNT_HOLDER,
    VERCEL_API_BASE,
    INTERNAL_TOKEN,
)
from ..dependencies import get_supabase
from ..models import OrderPrepareRequest, MarkDepositRequest


router = APIRouter()

_INTERNAL_HEADERS = {"X-Internal-Token": INTERNAL_TOKEN} if INTERNAL_TOKEN else {}
_http_client: httpx.AsyncClient | None = None


# ============================================
# v1.15 — 자동 취소 lazy check (사장님 합의 토요일 19:35 KST = 추첨 1시간 전)
# ============================================
# 메커니즘: lazy check
#   - 사용자가 본인 주문 조회(GET /api/orders, /api/orders/{id}) 시
#   - 어드민이 주문 목록 조회 시 (admin_orders.list_orders)
#   - 주문이 awaiting_deposit 상태이고 마감 시간 지났으면 cancelled 로 전환
# 트리거: 추첨 시각(매주 토요일 20:35 KST) 1시간 전 = 토요일 19:35 KST
# 기준: 주문 created_at 이후 가장 가까운 토요일 19:35 KST
def _next_saturday_19_35_kst(after):
    """주어진 datetime 이후 가장 가까운 토요일 19:35 KST 반환.

    토요일 19:35 정각 이전: 그 주 토요일 19:35
    토요일 19:35 이후: 다음 주 토요일 19:35
    """
    from datetime import timedelta, timezone

    KST = timezone(timedelta(hours=9))
    after_kst = after.astimezone(KST)
    day = after_kst.weekday()  # 0=월 ~ 5=토 ~ 6=일

    days_until_saturday = (5 - day + 7) % 7
    candidate = (after_kst + timedelta(days=days_until_saturday)).replace(
        hour=19, minute=35, second=0, microsecond=0
    )
    if candidate <= after_kst:
        # 오늘이 토요일 19:35 이후면 다음 주 토요일
        candidate += timedelta(days=7)
    return candidate


def _auto_cancel_if_overdue(sb, order: dict) -> dict:
    """awaiting_deposit / pending 주문이 판매 마감 시간 지났으면 cancelled 로 전환.

    사장님 합의 (v1.15): 추첨 1시간 전(토요일 19:35 KST) 마감, lazy check.
    사장님 추가 (v1.16): pending 상태도 자동 취소 대상에 포함.
                        — 입금 안내 페이지에서 멈춰 mark_deposit 누르지 않은 케이스.
                        — 과거 회차에 남아있는 pending 주문도 lazy check 시점에 자동 정리됨.

    Args:
        sb: Supabase client
        order: 주문 dict (status, created_at 포함 필수)

    Returns:
        order — 자동 취소 처리된 경우 status/rejected_reason 변경된 dict 반환
    """
    # v1.16 — awaiting_deposit + pending 둘 다 자동 취소 대상
    if order.get('status') not in ('awaiting_deposit', 'pending'):
        return order

    from datetime import datetime, timezone, timedelta

    KST = timezone(timedelta(hours=9))
    now = datetime.now(KST)

    # supabase created_at: ISO8601 string (UTC, 끝에 Z 또는 +00:00)
    created_str = order.get('created_at')
    if not created_str:
        return order
    try:
        created_at = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return order

    deadline = _next_saturday_19_35_kst(created_at)

    if now >= deadline:
        reason = '자동 취소 — 판매 마감 시간 도달 (추첨 1시간 전)'
        # DB 업데이트 (RLS: 어드민/시스템 권한 — orders RLS 정책상 service role 만 update 가능)
        try:
            sb.table('orders').update({
                'status': 'cancelled',
                'rejected_reason': reason,
            }).eq('order_id', order['order_id']).execute()
            order['status'] = 'cancelled'
            order['rejected_reason'] = reason
        except Exception:
            # 자동 취소 실패해도 사용자 조회 흐름은 막지 않음 (정보 노출만 우선)
            pass

    return order


def _get_client() -> httpx.AsyncClient:
    """Vercel internal 호출용 httpx 클라이언트.

    prepare 엔드포인트만 사용 — predict_round 조회 위해
    /api/internal/prediction-snapshot 호출.
    """
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            base_url=VERCEL_API_BASE,
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers=_INTERNAL_HEADERS,
        )
    return _http_client


async def _fetch_prediction_snapshot() -> dict:
    """Vercel 분석 백엔드에서 예측 스냅샷 조회.

    응답:
        { predict_round, top_k, scores, prev_nums }
    """
    client = _get_client()
    try:
        resp = await client.get("/api/internal/prediction-snapshot")
    except httpx.TimeoutException:
        raise HTTPException(504, "분석 백엔드 응답 시간 초과")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"분석 백엔드 통신 실패: {type(e).__name__}")

    if resp.status_code != 200:
        raise HTTPException(503, f"분석 백엔드 에러 (status={resp.status_code})")
    try:
        return resp.json()
    except ValueError:
        raise HTTPException(502, "분석 백엔드 응답 파싱 실패")


# ============================================
# POST /api/orders/prepare
# ============================================
@router.post("/api/orders/prepare")
async def prepare_order(req: OrderPrepareRequest, user=Depends(get_current_user)):
    """결제 시작 — orderId 발급 + 입금자명 안내."""
    check_rate_limit(user['user_id'])

    # 옵션 검증
    if req.n_combos not in PRICING_TIERS:
        raise HTTPException(400, f"n_combos는 {ALLOWED_N_COMBOS} 중 하나여야 합니다.")
    if req.min_diff not in DIVERSITY_OPTIONS:
        raise HTTPException(400, f"min_diff는 {sorted(DIVERSITY_OPTIONS.keys())} 중 하나여야 합니다.")

    sb = get_supabase()

    # 분리 환경 변경:
    # 이전 (단일 백엔드): pred = get_or_compute_prediction()
    # 이후 (분리 환경) : Vercel internal 에서 predict_round 조회
    snapshot = await _fetch_prediction_snapshot()
    predict_round = snapshot['predict_round']

    # 같은 회차 + 같은 옵션 paid 주문 확인
    existing = sb.table('orders').select('*').eq(
        'user_id', user['user_id']
    ).eq('predict_round', predict_round).eq('status', 'paid').execute()

    same_option = [o for o in (existing.data or [])
                   if o.get('n_combos') == req.n_combos
                   and o.get('min_diff') == req.min_diff]
    if same_option:
        return {
            'already_purchased': True,
            'order_id': same_option[0]['order_id'],
            'predict_round': same_option[0]['predict_round'],
            'n_combos': req.n_combos,
            'min_diff': req.min_diff,
        }

    # 가격 + orderId 생성
    price = PRICING_TIERS[req.n_combos]['price']
    timestamp = int(time.time() * 1000)
    raw = f"{user['user_id']}-{predict_round}-{req.n_combos}-{req.min_diff}-{timestamp}"
    order_id_hash = hashlib.sha256(raw.encode()).hexdigest()[:24]
    order_id = "ord_" + order_id_hash

    # v1.15 — 입금자명 suffix: 영문 6자리 → 숫자 4자리 (사장님 합의 옵션 A)
    # 이유: 모바일 키패드에서 영문 대문자 입력 번거로움. 숫자만으로 IME 전환 불필요.
    # 충돌 가능성: 1/10000 (같은 prefix 동일 회차 1만 건 누적 시점) — 현실적으로 무시.
    deposit_name_suffix = f"{int(order_id_hash, 16) % 10000:04d}"
    # prefix 우선순위 (HANDOVER v1.2 §1.1):
    #   1. 사용자가 직접 입력한 값
    #   2. JWT의 카카오 닉네임 (한글 OK, 단 입금자명에 사용 가능한 문자 한정)
    #   3. 이메일 ID 부분
    #   4. user_id 앞 4자리 (UUID prefix, fallback의 fallback)
    raw_prefix = (
        req.deposit_name_prefix
        or user.get('nickname', '')
        or (user.get('email', '').split('@')[0] if user.get('email') else '')
        or f"user{user['user_id'][:4]}"
    )
    # 한글/영문/숫자만 남기고 8자 컷 (입금자명은 은행에서 특수문자 거부 가능)
    prefix = re.sub(r'[^가-힣A-Za-z0-9]', '', raw_prefix)[:8] or 'GUEST'
    deposit_name = f"{prefix}{deposit_name_suffix}"

    # pending 기록
    sb.table('orders').insert({
        'order_id':       order_id,
        'user_id':        user['user_id'],
        'predict_round':  predict_round,
        'amount':         price,
        'status':         'pending',
        'n_combos':       req.n_combos,
        'min_diff':       req.min_diff,
        # prev_round 는 Vercel snapshot 에서 받지 않고 prepare 시점에는 알 필요 없음
        # — paid 시점(approve) 에 다시 조회. 단일 백엔드 시절에는 prev_round 도 같이 저장했으나
        # 분리 환경에서는 approve 시점 snapshot 에서 prev_nums 받아 처리.
        # 단, 기존 orders 테이블 스키마에 prev_round 컬럼이 NOT NULL 이면 호환 위해 0 넣어야 함.
        # 호환성을 위해 snapshot 의 회차에서 -1 로 추정값 주입 (향후 approve 에서 정확값으로 갱신 X).
        'prev_round':     predict_round - 1,
        'deposit_name':   deposit_name,
    }).execute()

    return {
        'already_purchased': False,
        'order_id':       order_id,
        'predict_round':  predict_round,
        'amount':         price,
        'n_combos':       req.n_combos,
        'min_diff':       req.min_diff,
        # 사용자에게 표시할 입금 안내
        'deposit_info': {
            'bank':           BUSINESS_BANK_NAME,
            'account_number': BUSINESS_ACCOUNT_NUMBER,
            'account_holder': BUSINESS_ACCOUNT_HOLDER,
            'deposit_name':   deposit_name,
            'amount':         price,
        },
    }


# ============================================
# POST /api/orders/{order_id}/mark-deposit
# ============================================
@router.post("/api/orders/{order_id}/mark-deposit")
async def mark_deposit(
    order_id: str,
    req: MarkDepositRequest,
    user=Depends(get_current_user),
):
    """사용자가 '입금했어요' 클릭. status: pending → awaiting_deposit."""
    from datetime import datetime, timezone
    check_rate_limit(user['user_id'])
    sb = get_supabase()

    rows = sb.table('orders').select('*').eq('order_id', order_id).execute()
    if not rows.data:
        raise HTTPException(404, "주문 없음")
    order = rows.data[0]
    if order['user_id'] != user['user_id']:
        raise HTTPException(403, "주문 소유자 불일치")

    if order['status'] == 'paid':
        return {'status': 'already_paid', 'order_id': order_id}
    if order['status'] == 'cancelled':
        raise HTTPException(400, "거부된 주문입니다.")
    if order['status'] == 'awaiting_deposit':
        return {'status': 'already_awaiting', 'order_id': order_id}

    sb.table('orders').update({
        'status':            'awaiting_deposit',
        'deposit_marked_at': datetime.now(timezone.utc).isoformat(),
    }).eq('order_id', order_id).execute()

    return {
        'status':   'awaiting_deposit',
        'order_id': order_id,
        'message':  '입금 확인 중입니다. 사업자 승인 후 결과를 받아보실 수 있습니다.',
    }


# ============================================
# GET /api/orders (사용자 구매 이력)
# ============================================
@router.get("/api/orders")
async def list_orders(user=Depends(get_current_user)):
    """사용자 구매 이력 (모든 상태)."""
    check_rate_limit(user['user_id'])
    sb = get_supabase()

    rows = sb.table('orders').select(
        'order_id, predict_round, amount, status, n_combos, min_diff, '
        'combinations, deposit_name, deposit_marked_at, '
        'approved_at, rejected_reason, created_at'
    ).eq('user_id', user['user_id']).order(
        'created_at', desc=True
    ).execute()

    # v1.15 — 사장님 합의 자동 취소 lazy check
    # awaiting_deposit 주문이 마감 시간(토요일 19:35 KST) 지났으면 cancelled 로 전환.
    # 사용자 구매 이력 조회 시점에 일괄 체크.
    orders = [_auto_cancel_if_overdue(sb, o) for o in rows.data]

    return {'orders': orders}


# ============================================
# GET /api/orders/{order_id}
# ============================================
@router.get("/api/orders/{order_id}")
async def get_order(order_id: str, user=Depends(get_current_user)):
    """주문 조회. paid 상태일 때만 combinations 노출."""
    check_rate_limit(user['user_id'])
    sb = get_supabase()

    rows = sb.table('orders').select(
        'order_id, predict_round, amount, status, n_combos, min_diff, '
        'combinations, deposit_name, deposit_marked_at, '
        'approved_at, rejected_reason, created_at, prev_round'
    ).eq('order_id', order_id).eq('user_id', user['user_id']).execute()

    if not rows.data:
        raise HTTPException(404, "주문 없음")

    order = rows.data[0]

    # v1.15 — 사장님 합의 자동 취소 lazy check
    # awaiting_deposit 주문이 마감 시간 지났으면 cancelled 로 전환 후 응답.
    order = _auto_cancel_if_overdue(sb, order)

    # combinations에 메트릭 첨부 (UI 표시용)
    # M.compute_all_metrics 는 numpy 미사용 순수 파이썬 — Cloudtype 에서 안전.
    combinations_with_metrics = []
    if order.get('combinations'):
        for combo in order['combinations']:
            m = M.compute_all_metrics(combo)
            combinations_with_metrics.append({
                'numbers': combo,
                'metrics': {
                    'total_sum':   m['total_sum'],
                    'ac':          m['ac'],
                    'odd_even':    m['odd_even'],
                    'low_high':    m['low_high'],
                    'prime_count': m['prime_count'],
                    'palaces_used': m['palaces_used'],
                    'colors_used': m['colors_used'],
                    'consecutive': m['consecutive_pair'],
                },
            })

    return {
        **order,
        'combinations_detail': combinations_with_metrics,
    }


# ============================================
# v1.25 — GET /api/orders/{order_id}/extract-pool
# 본인 결제 회차의 34추출 번호 풀 조회 (보안 강화 — 사장님 합의 2026-05-15)
# ============================================
def _compute_next_saturday_20_35_kst_iso() -> str:
    """다음 토요일 20:35 KST (추첨 시작 시각) 을 ISO8601 (+09:00) 문자열로 반환.

    프론트 결과 페이지의 "추첨 시작 시 사라집니다" 카운트다운에 사용.
    이미 이번 주 토요일 20:35 이 지났으면 다음 주 토요일 20:35.

    Vercel caching.py 의 compute_next_draw_at() 와 동일 로직.
    Cloudtype 측은 lotto_engine 비의존이라 caching.py import 불가 → 동일 로직 재구현.
    """
    from datetime import datetime, timezone, timedelta

    KST = timezone(timedelta(hours=9))
    now = datetime.now(KST)

    day = now.weekday()  # 0=월 ~ 5=토 ~ 6=일
    days_until_saturday = (5 - day + 7) % 7
    candidate = (now + timedelta(days=days_until_saturday)).replace(
        hour=20, minute=35, second=0, microsecond=0
    )
    if candidate <= now:
        candidate += timedelta(days=7)
    return candidate.isoformat()


@router.get("/api/orders/{order_id}/extract-pool")
async def get_order_extract_pool(order_id: str, user=Depends(get_current_user)):
    """본인 결제 회차의 34추출 번호 조회 (v1.25 신규 — 보안 강화).

    노출 조건 (사장님 정책 결정 2026-05-15):
      1. 본인 주문이어야 함 (user_id 일치)
      2. status='paid' 여야 함
      3. engine_history.extract_pool 이 채워져 있어야 함 (분석 완료)
      4. 추첨 전: 풀 34개 전체 반환 + 카운트다운용 다음 추첨 시각
      5. 추첨 후: 풀 위치 유지하되 적중하지 않은 자리는 null 로 마스킹
                  (미적중 번호 자체는 클라이언트에 절대 전달 X)

    응답 (HTTP 200) — 추첨 전:
      {
        "round": int,
        "draw_completed": false,
        "pool_positional": [3, 4, 6, 7, ..., 45],   # 정렬된 34개 (모두 숫자)
        "pool_size": 34,
        "hit_count": null,
        "draw_at": "2026-05-16T20:35:00+09:00",     # 다음 추첨 시작 시각 (카운트다운용)
        "winning_nums": null,
        "bonus": null
      }

    응답 (HTTP 200) — 추첨 후:
      {
        "round": int,
        "draw_completed": true,
        "pool_positional": [null, null, null, 7, null, null, 12, null, 15, ..., 21, null, ...],
                                                    # 정렬 순서 유지, 적중만 숫자
        "pool_size": 34,
        "hit_count": 4,                             # 본번호 적중 개수
        "draw_at": "2026-05-09T20:35:00+09:00",     # 이 회차의 추첨 시각 (이미 지난 시각)
        "winning_nums": [7, 12, 15, 21, 28, 35],   # 본번호 (lotto_history Public read)
        "bonus": 19,
        "bonus_in_pool": false                      # 보너스가 풀 안에 있었는지 (정직 표시)
      }

    에러 코드:
      401 — 미인증
      403 — 본인 주문 아님 / paid 상태 아님
      404 — 주문 없음
      503 — 회차 분석 미완료 (extract_pool 비어있음, 드문 케이스)

    데이터 흐름:
      service_role 키 사용 → engine_history.extract_pool 컬럼 권한 회수와 무관하게 조회 가능
      (v1.10 마이그레이션 이후 클라이언트 직접 조회는 차단됨)
    """
    check_rate_limit(user['user_id'])
    sb = get_supabase()

    # 1. 주문 조회 + 본인 + paid 검증
    rows = sb.table('orders').select(
        'order_id, user_id, status, predict_round'
    ).eq('order_id', order_id).execute()

    if not rows.data:
        raise HTTPException(404, "주문 없음")

    order = rows.data[0]
    if order['user_id'] != user['user_id']:
        raise HTTPException(403, "주문 소유자 불일치")
    if order['status'] != 'paid':
        raise HTTPException(403, "결제 완료된 주문만 풀 조회가 가능합니다.")

    round_num = order['predict_round']

    # 2. 풀 조회 (service_role 이므로 컬럼 권한 우회)
    eh_rows = sb.table('engine_history').select(
        'extract_pool'
    ).eq('round', round_num).execute()

    if not eh_rows.data:
        raise HTTPException(503, "이 회차의 분석이 아직 완료되지 않았습니다.")

    pool = eh_rows.data[0].get('extract_pool') or []
    if not pool:
        raise HTTPException(503, "이 회차의 분석이 아직 완료되지 않았습니다.")

    # 풀 정렬 (positional grid 위치 일관성 보장 — 프론트 표시 안정)
    pool_sorted = sorted(pool)
    pool_size = len(pool_sorted)

    # 3. 추첨 여부 판정 — winning_numbers / lotto_history 동시 조회
    #    어드민 5-5 입력 시 두 테이블에 동시 INSERT 됨. 단순화를 위해 둘 다 조회.
    win_rows = sb.table('winning_numbers').select(
        'round, n1, n2, n3, n4, n5, n6, bonus, drawn_at'
    ).eq('round', round_num).execute()

    if not win_rows.data:
        # ============================================
        # 추첨 전 — 풀 34개 전체 + 카운트다운 정보
        # ============================================
        return {
            'round':           round_num,
            'draw_completed':  False,
            'pool_positional': pool_sorted,
            'pool_size':       pool_size,
            'hit_count':       None,
            'draw_at':         _compute_next_saturday_20_35_kst_iso(),
            'winning_nums':    None,
            'bonus':           None,
            'bonus_in_pool':   None,
        }

    # ============================================
    # 추첨 후 — 적중 자리만 숫자, 나머지 위치는 null 마스킹
    # ============================================
    win = win_rows.data[0]
    winning_nums = [win['n1'], win['n2'], win['n3'],
                    win['n4'], win['n5'], win['n6']]
    bonus = win['bonus']
    winning_set = set(winning_nums)

    # 본번호 일치 자리만 숫자, 나머지는 null
    # (보너스는 등수 계산 영향이지만 풀 위치 표시에는 본번호 일치만 노출)
    pool_positional = [
        n if n in winning_set else None
        for n in pool_sorted
    ]
    hit_count = sum(1 for x in pool_positional if x is not None)
    bonus_in_pool = bonus in pool_sorted

    # 추첨일 (lotto_history.drawn_at 도 같이 받지만 winning_numbers.drawn_at 사용)
    # ISO8601 형식으로 정규화 — '2026-05-09' → '2026-05-09T20:35:00+09:00'
    drawn_at_str = win.get('drawn_at')
    if drawn_at_str:
        # drawn_at 은 'YYYY-MM-DD' date 형식. 추첨 시각 20:35 KST 결합.
        draw_at_iso = f"{drawn_at_str}T20:35:00+09:00"
    else:
        # fallback — drawn_at 누락 케이스 (방어 코드)
        draw_at_iso = _compute_next_saturday_20_35_kst_iso()

    return {
        'round':           round_num,
        'draw_completed':  True,
        'pool_positional': pool_positional,
        'pool_size':       pool_size,
        'hit_count':       hit_count,
        'draw_at':         draw_at_iso,
        'winning_nums':    winning_nums,
        'bonus':           bonus,
        'bonus_in_pool':   bonus_in_pool,
    }
