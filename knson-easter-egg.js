/* ═══════════════════════════════════════════════════
   knson-easter-egg.js  —  이스터에그 url 편집 기능
   ═══════════════════════════════════════════════════
   목적: 잔여 url 누락 매물(약 179건)을 사용자가 수동으로 채우는 도구.
         정상 UI 노출은 안 하고, 이스터에그 방식으로 매물 행의
         "구분" 라벨(경매/공매/네이버중개/일반)을 1초 안에 3회 연속
         클릭하면 url 입력 prompt 가 뜸.
   
   동작:
     1) kind-text[data-trigger="kind-edit"] 요소 3연속 클릭 (윈도우 1.0초)
     2) prompt() 으로 새 url 입력 (기존 url 있으면 기본값으로 표시)
     3) update_property_source_url RPC 호출
     4) 성공 시 화면 즉시 갱신, 실패 시 alert
   
   권한:
     - 클라이언트: 모든 사용자 발동 가능 (UI 차단 없음)
     - 서버: RPC 안에서 매물 담당자(assignee_id) 또는 admin 만 허용
   
   허용 url:
     - tankauction.com, onbid.co.kr, land.naver.com, naver.me
     - RPC 에서 검증, 클라이언트는 입력만 받음
═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  const STATE = {
    lastTargetId: null,
    clickCount: 0,
    lastClickAt: 0,
  };
  const CLICK_WINDOW_MS = 1000;

  // RPC 호출 — Supabase REST endpoint 사용 (sync RPC 와 동일 패턴)
  async function callRpc(propertyId, newUrl) {
    const K = window.KNSN || null;
    const Shared = window.KNSN_SHARED || null;
    let session = null;
    if (Shared && typeof Shared.loadSession === 'function') session = Shared.loadSession();
    else if (K && typeof K.loadSession === 'function') session = K.loadSession();
    const token = session?.access_token || session?.token || null;

    // SUPABASE_URL/ANON_KEY 는 페이지에 이미 노출된 값 사용
    const SB_URL = (K && typeof K.getSupabaseUrl === 'function')
      ? K.getSupabaseUrl()
      : (window.SUPABASE_URL || 'https://sdkiwbzpllyqqlvdtimz.supabase.co');
    const SB_KEY = (K && typeof K.getSupabaseAnonKey === 'function')
      ? K.getSupabaseAnonKey()
      : (window.SUPABASE_ANON_KEY || '');

    const headers = {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + (token || SB_KEY),
    };

    const r = await fetch(SB_URL + '/rest/v1/rpc/update_property_source_url', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        p_property_id: propertyId,
        p_new_url: newUrl || null,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error('RPC error (' + r.status + '): ' + t);
    }
    return r.json();
  }

  // 사용자에게 권한 안내 — 화면에 가능한 admin 권한 체크
  function getCurrentUser() {
    const K = window.KNSN || null;
    const Shared = window.KNSN_SHARED || null;
    let session = null;
    if (Shared && typeof Shared.loadSession === 'function') session = Shared.loadSession();
    else if (K && typeof K.loadSession === 'function') session = K.loadSession();
    return session?.user || null;
  }

  // 매물의 담당자 또는 admin 인지 클라이언트 측 사전 검증 (UX용)
  // 실제 권한 검증은 서버 RPC 에서 수행
  function canEditClientSide(property) {
    const user = getCurrentUser();
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    if (role === 'admin') return true;
    const assignee = property?.assigneeId || property?.assignee_id || property?.raw?.assignee_id;
    return assignee && String(assignee) === String(user.id);
  }

  // 메인 핸들러 — 3연속 클릭 처리
  function handleTripleClick(kindEl, property) {
    const propertyId = kindEl.getAttribute('data-property-id') || property?.id;
    if (!propertyId) return;

    const now = Date.now();
    const sameTarget = STATE.lastTargetId === propertyId;
    const inWindow = (now - STATE.lastClickAt) < CLICK_WINDOW_MS;

    if (sameTarget && inWindow) {
      STATE.clickCount += 1;
    } else {
      STATE.clickCount = 1;
      STATE.lastTargetId = propertyId;
    }
    STATE.lastClickAt = now;

    if (STATE.clickCount >= 3) {
      // 카운터 리셋
      STATE.clickCount = 0;
      STATE.lastTargetId = null;
      // 편집 다이얼로그 발동
      openUrlEditPrompt(propertyId, property);
    }
  }

  async function openUrlEditPrompt(propertyId, property) {
    // 클라이언트 사전 검증 (UX용 — 실제는 서버에서)
    if (!canEditClientSide(property)) {
      alert('이 매물의 url 을 편집할 권한이 없습니다.\n담당자 또는 관리자만 가능합니다.');
      return;
    }

    const currentUrl = property?.sourceUrl || property?.source_url || '';
    const itemNo = property?.itemNo || property?.item_no || '(매물)';
    const promptMsg =
      '[' + itemNo + '] url 편집\n\n' +
      '· 비워두고 확인 → url 삭제\n' +
      '· 새 url 입력 후 확인 → 저장\n' +
      '· 허용 도메인: tankauction.com, onbid.co.kr, land.naver.com, naver.me';

    const input = prompt(promptMsg, currentUrl);
    if (input === null) return;  // 취소

    const trimmed = input.trim();

    // 변경 없음
    if (trimmed === (currentUrl || '').trim()) {
      return;
    }

    // 확인
    const confirmMsg = trimmed
      ? '아래 url 로 저장하시겠어요?\n\n' + trimmed
      : '이 매물의 url 을 삭제하시겠어요?';
    if (!confirm(confirmMsg)) return;

    try {
      const res = await callRpc(propertyId, trimmed);
      if (res?.success) {
        alert('저장 완료.\n페이지를 새로고침합니다.');
        // 가장 단순하고 확실한 갱신 방법
        location.reload();
      } else {
        const err = res?.error || 'unknown';
        const msg = res?.message || '';
        if (err === 'invalid_url') {
          alert('허용된 도메인이 아닙니다.\n' + msg);
        } else if (err === 'forbidden') {
          alert('권한이 없습니다. 담당자 또는 관리자만 편집 가능합니다.');
        } else if (err === 'unauthenticated') {
          alert('로그인이 필요합니다.');
        } else if (err === 'property_not_found') {
          alert('매물을 찾을 수 없습니다.');
        } else {
          alert('저장 실패: ' + err);
        }
      }
    } catch (e) {
      console.error('url 편집 오류:', e);
      alert('저장 실패: ' + (e?.message || e));
    }
  }

  // 전역 노출 (agent-app.js / admin-tab-properties.js 에서 호출)
  window.handleKindLabelTripleClick = handleTripleClick;
})();
