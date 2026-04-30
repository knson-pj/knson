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
        // 화면의 해당 행/카드를 즉시 갱신 (페이지 새로고침 없이)
        updateItemNoLinkInPlace(propertyId, newUrl, property);

        // property 객체의 sourceUrl 도 갱신 (다시 모달 열 때 새 값 표시)
        if (property) {
          property.sourceUrl = newUrl || null;
          property.source_url = newUrl || null;
        }

        closeModal();
        showToast(newUrl ? '저장되었습니다 🔗' : 'URL 이 삭제되었습니다', 'success');
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

  // ────────────────────────────────────────────
  // 화면 즉시 갱신 — item_no 링크 반영 (새로고침 회피)
  // ────────────────────────────────────────────
  // 화면에 같은 매물의 행/카드가 여러 개 있을 수 있어 모두 순회.
  // 패턴 3종:
  //   1) 기존 url 있던 매물 (a.item-no-link 존재) → href 갱신 또는 a 풀기
  //   2) 테이블뷰에서 url 없던 매물 → <td> 안 itemNo 텍스트를 a 로 감싸기
  //   3) 카드뷰에서 url 없던 매물 → "#<itemNo>" 패턴 처리
  function updateItemNoLinkInPlace(propertyId, newUrl, property) {
    if (!propertyId) return;
    let safeId;
    try { safeId = (window.CSS && CSS.escape) ? CSS.escape(propertyId) : String(propertyId).replace(/"/g, '\\"'); }
    catch (e) { safeId = String(propertyId); }

    const kindEls = document.querySelectorAll('.kind-text[data-trigger="kind-edit"][data-property-id="' + safeId + '"]');
    if (!kindEls.length) return;

    const itemNoText = String(property?.itemNo || property?.item_no || '').trim();

    kindEls.forEach((kindEl) => {
      // 매물 행의 컨테이너 — tr / .ag-card / .ag-card-row / 카드 부모
      const container = kindEl.closest('tr')
        || kindEl.closest('.ag-card')
        || kindEl.closest('.ag-card-row')
        || kindEl.closest('article')
        || kindEl.closest('li')
        || kindEl.parentElement?.parentElement
        || null;
      if (!container) return;

      // [1] 기존 a.item-no-link 가 있으면 href 만 갱신
      const existing = container.querySelectorAll('a.item-no-link');
      if (existing.length > 0) {
        if (newUrl) {
          existing.forEach((a) => {
            try { a.href = newUrl; } catch (e) {}
          });
        } else {
          // url 삭제 → a 를 텍스트 노드로 풀어줌
          existing.forEach((a) => {
            const text = a.textContent;
            a.replaceWith(document.createTextNode(text));
          });
        }
        return;
      }

      // [2,3] 링크 없음 + 새 url 있음 → itemNo 텍스트를 a 로 감싸기
      if (!newUrl || !itemNoText) return;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const raw = node.nodeValue || '';
        const trimmed = raw.trim();
        // 패턴 2: 정확히 itemNo 와 일치 (테이블뷰)
        // 패턴 3: "#<itemNo>" (카드뷰의 ag-card-itemno)
        if (trimmed === itemNoText) {
          const a = createItemNoAnchor(newUrl, itemNoText);
          node.replaceWith(a);
          break;
        } else if (trimmed === '#' + itemNoText) {
          // 카드뷰: 텍스트는 "#텍스트" 통으로. # 는 그대로 두고 itemNo 만 a 로.
          node.nodeValue = raw.replace('#' + itemNoText, '#');
          // # 뒤에 a 를 형제로 추가
          const a = createItemNoAnchor(newUrl, itemNoText);
          if (node.parentNode) node.parentNode.appendChild(a);
          break;
        }
      }
    });
  }

  function createItemNoAnchor(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'item-no-link';
    a.textContent = text;
    // 행 클릭 모달 열림 방지 (다른 a.item-no-link 와 동일 동작)
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  }

  // ────────────────────────────────────────────
  // 토스트 알림
  // ────────────────────────────────────────────
  function showToast(message, kind) {
    let toast = document.getElementById('easter-egg-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'easter-egg-toast';
      Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 18px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: '500',
        color: '#fff',
        zIndex: '99999',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        transition: 'opacity 0.25s',
        pointerEvents: 'none',
        opacity: '0',
      });
      document.body.appendChild(toast);
    }
    toast.style.background = kind === 'error' ? '#d33' : '#2a8';
    toast.textContent = message;
    // 페이드인 트리거
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 2200);
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

      // [가드] 경매/공매 매물에만 발동.
      // realtor/general 매물에 url 을 채우면 도메인 분류 로직(url 유무 기반)
      // 때문에 화면 표시가 일반중개 ↔ 네이버중개로 잘못 바뀌는 부작용이 있어 차단.
      // 중개/일반 매물의 url 은 매물 등록/수정 폼에서 변경하도록 안내.
      const sourceType = String(
        property?.sourceType
          || property?.source_type
          || property?.raw?.source_type
          || ''
      ).toLowerCase();
      if (sourceType !== 'auction' && sourceType !== 'onbid') {
        alert('URL 편집은 경매/공매 매물에만 가능합니다.\n중개/일반 매물의 URL은 매물 등록/수정 폼에서 변경하세요.');
        return;
      }

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
