/* ═══════════════════════════════════════════════════
   knson-easter-egg.js  —  이스터에그 url 편집 기능 (모달 버전)
   ═══════════════════════════════════════════════════
   목적: 잔여 url 누락 매물(약 179건)을 사용자가 수동으로 채우는 도구.
         정상 UI 노출은 안 하고, 이스터에그 방식으로 매물 행의
         "구분" 라벨(경매/공매/네이버중개/일반)을 1초 안에 3회 연속
         클릭하면 url 편집 모달이 뜸.

   동작:
     1) kind-text[data-trigger="kind-edit"] 요소 3연속 클릭 (윈도우 1.0초)
     2) 모달(#urlEditModal) 열림 (기존 url 있으면 input 에 기본값)
     3) 저장 버튼 → update_property_source_url RPC 호출
     4) 성공 시 화면 즉시 갱신, 실패 시 모달 안 메시지 영역에 표시

   모달 구조 (HTML 에 정적으로 배치):
     <div id="urlEditModal">
       <input id="urlEditInput">
       <button id="urlEditSave">저장</button>
       <button id="urlEditCancel">취소</button>
       <div id="urlEditMsg">
       <div id="urlEditItemNoLine">  -- 매물 식별 정보

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
    currentPropertyId: null,
    currentProperty: null,
  };
  const CLICK_WINDOW_MS = 1000;

  // RPC 호출 — supabase-js 클라이언트 사용 (anon key + 토큰 자동 처리)
  async function callRpc(propertyId, newUrl) {
    const K = window.KNSN || null;
    if (!K || typeof K.initSupabase !== 'function') {
      throw new Error('Supabase 클라이언트를 초기화할 수 없습니다 (KNSN 미로드).');
    }
    const sb = K.initSupabase();
    if (!sb) {
      throw new Error('Supabase 클라이언트 초기화 실패. 로그인 상태를 확인하세요.');
    }

    const { data, error } = await sb.rpc('update_property_source_url', {
      p_property_id: propertyId,
      p_new_url: newUrl || null,
    });

    if (error) {
      throw new Error('RPC error: ' + (error.message || error.code || JSON.stringify(error)));
    }
    return data;
  }

  function getCurrentUser() {
    const K = window.KNSN || null;
    const Shared = window.KNSN_SHARED || null;
    let session = null;
    if (Shared && typeof Shared.loadSession === 'function') session = Shared.loadSession();
    else if (K && typeof K.loadSession === 'function') session = K.loadSession();
    return session?.user || null;
  }

  // 매물의 담당자 또는 admin 인지 클라이언트 측 사전 검증 (UX용)
  function canEditClientSide(property) {
    const user = getCurrentUser();
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    if (role === 'admin') return true;
    const assignee = property?.assigneeId || property?.assignee_id || property?.raw?.assignee_id;
    return assignee && String(assignee) === String(user.id);
  }

  // ────────────────────────────────────────────
  // 모달 제어
  // ────────────────────────────────────────────
  function getModalElements() {
    return {
      modal: document.getElementById('urlEditModal'),
      title: document.getElementById('urlEditTitle'),
      itemNoLine: document.getElementById('urlEditItemNoLine'),
      input: document.getElementById('urlEditInput'),
      saveBtn: document.getElementById('urlEditSave'),
      cancelBtn: document.getElementById('urlEditCancel'),
      closeBtn: document.getElementById('urlEditClose'),
      form: document.getElementById('urlEditForm'),
      msg: document.getElementById('urlEditMsg'),
    };
  }

  function setMsg(text, kind) {
    const els = getModalElements();
    if (!els.msg) return;
    els.msg.textContent = text || '';
    els.msg.style.color = kind === 'error' ? '#d33' : (kind === 'success' ? '#2a8' : '');
  }

  function escapeHtml(str) {
    const s = String(str == null ? '' : str);
    return s.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
  }

  function openModal(propertyId, property) {
    const els = getModalElements();
    if (!els.modal) {
      // 모달 마크업이 없으면 폴백으로 prompt 사용 (안전장치)
      console.warn('urlEditModal not found in DOM; falling back to prompt');
      fallbackPrompt(propertyId, property);
      return;
    }

    STATE.currentPropertyId = propertyId;
    STATE.currentProperty = property;

    const currentUrl = property?.sourceUrl || property?.source_url || '';
    const itemNo = property?.itemNo || property?.item_no || '(매물)';
    const address = String(property?.address || property?.raw?.address || '').trim();

    if (els.itemNoLine) {
      els.itemNoLine.innerHTML = '<strong>' + escapeHtml(itemNo) + '</strong>'
        + (address ? '<br><span style="opacity:0.75;">' + escapeHtml(address) + '</span>' : '');
    }
    if (els.input) {
      els.input.value = currentUrl;
    }
    setMsg('', '');

    els.modal.classList.remove('hidden');
    els.modal.setAttribute('aria-hidden', 'false');

    // 자동 포커스
    setTimeout(() => {
      if (els.input) {
        els.input.focus();
        els.input.select();
      }
    }, 100);
  }

  function closeModal() {
    const els = getModalElements();
    if (!els.modal) return;
    els.modal.classList.add('hidden');
    els.modal.setAttribute('aria-hidden', 'true');
    STATE.currentPropertyId = null;
    STATE.currentProperty = null;
    if (els.input) els.input.value = '';
    setMsg('', '');
  }

  async function handleSave(e) {
    if (e) e.preventDefault();
    const els = getModalElements();
    if (!els.input) return;

    const propertyId = STATE.currentPropertyId;
    const property = STATE.currentProperty;
    if (!propertyId) {
      setMsg('대상 매물 정보를 잃었습니다. 모달을 닫고 다시 시도하세요.', 'error');
      return;
    }

    // 클라이언트 사전 검증
    if (!canEditClientSide(property)) {
      setMsg('이 매물의 url 을 편집할 권한이 없습니다. 담당자 또는 관리자만 가능합니다.', 'error');
      return;
    }

    const newUrl = (els.input.value || '').trim();
    const currentUrl = (property?.sourceUrl || property?.source_url || '').trim();

    if (newUrl === currentUrl) {
      setMsg('변경 사항이 없습니다.', '');
      return;
    }

    // 저장 진행 — 버튼 비활성화
    if (els.saveBtn) els.saveBtn.disabled = true;
    setMsg('저장 중...', '');

    try {
      const res = await callRpc(propertyId, newUrl);
      if (res?.success) {
        setMsg('저장되었습니다. 페이지를 새로고침합니다.', 'success');
        setTimeout(() => {
          closeModal();
          location.reload();
        }, 600);
      } else {
        const err = res?.error || 'unknown';
        const m = res?.message || '';
        if (err === 'invalid_url') setMsg('허용된 도메인이 아닙니다. ' + m, 'error');
        else if (err === 'forbidden') setMsg('권한이 없습니다. 담당자 또는 관리자만 편집 가능합니다.', 'error');
        else if (err === 'unauthenticated') setMsg('로그인이 필요합니다.', 'error');
        else if (err === 'property_not_found') setMsg('매물을 찾을 수 없습니다.', 'error');
        else setMsg('저장 실패: ' + err, 'error');
      }
    } catch (err) {
      console.error('url 편집 오류:', err);
      setMsg('저장 실패: ' + (err?.message || err), 'error');
    } finally {
      if (els.saveBtn) els.saveBtn.disabled = false;
    }
  }

  // 모달 이벤트 바인딩 (페이지에 마크업 있을 때 한 번만)
  function bindModalHandlers() {
    const els = getModalElements();
    if (!els.modal || els.modal.dataset.bound === '1') return;
    els.modal.dataset.bound = '1';

    if (els.form) {
      els.form.addEventListener('submit', handleSave);
    }
    if (els.saveBtn) {
      els.saveBtn.addEventListener('click', handleSave);
    }
    if (els.cancelBtn) {
      els.cancelBtn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
    }
    if (els.closeBtn) {
      els.closeBtn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
    }
    // backdrop 클릭으로 닫기 (다른 모달과 동일 패턴)
    const backdrop = els.modal.querySelector('.modal-backdrop[data-close="true"]');
    if (backdrop) {
      backdrop.addEventListener('click', () => closeModal());
    }
    // ESC 키로 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  // ────────────────────────────────────────────
  // 폴백 prompt (모달 마크업이 페이지에 없는 경우 안전장치)
  // ────────────────────────────────────────────
  async function fallbackPrompt(propertyId, property) {
    if (!canEditClientSide(property)) {
      alert('이 매물의 url 을 편집할 권한이 없습니다.');
      return;
    }
    const currentUrl = property?.sourceUrl || property?.source_url || '';
    const itemNo = property?.itemNo || property?.item_no || '(매물)';
    const input = prompt('[' + itemNo + '] url 편집\n\n허용: tankauction.com, onbid.co.kr, land.naver.com, naver.me, kko.to, map.kakao.com', currentUrl);
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === (currentUrl || '').trim()) return;
    try {
      const res = await callRpc(propertyId, trimmed);
      if (res?.success) { alert('저장 완료. 새로고침합니다.'); location.reload(); }
      else alert('저장 실패: ' + (res?.error || '알 수 없는 오류') + (res?.message ? '\n' + res.message : ''));
    } catch (e) {
      alert('저장 실패: ' + (e?.message || e));
    }
  }

  // ────────────────────────────────────────────
  // 메인 핸들러 — 3연속 클릭 처리
  // ────────────────────────────────────────────
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
      STATE.clickCount = 0;
      STATE.lastTargetId = null;
      openModal(propertyId, property);
    }
  }

  // 페이지 로드 시 모달 핸들러 바인딩 시도 + DOMContentLoaded 시도
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindModalHandlers);
  } else {
    bindModalHandlers();
  }

  // 전역 노출 (agent-app.js / admin-tab-properties.js 에서 호출)
  window.handleKindLabelTripleClick = handleTripleClick;
})();
