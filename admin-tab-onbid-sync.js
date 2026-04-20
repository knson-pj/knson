// admin-tab-onbid-sync.js
//
// 온비드 공매 입찰결과 동기화 탭
//   - Supabase Edge Function (onbid-sync) 호출
//   - 진행 상태 표시
//   - 이력 테이블 렌더링
//
// Edge Function 배포 및 ONBID_SERVICE_KEY 시크릿 설정이 완료되어야 동작.
(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

  function runtime() { return window.KNSN_ADMIN_RUNTIME || {}; }
  function ctx() {
    const rt = runtime();
    return { rt, state: rt.state || {}, els: rt.els || {}, utils: rt.utils || {}, K: rt.K || window.KNSN || null };
  }

  function fmtNumber(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function fmtDuration(ms) {
    if (!Number.isFinite(Number(ms))) return '-';
    const s = Math.round(Number(ms) / 1000);
    if (s < 60) return `${s}초`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}분 ${r}초`;
  }
  function fmtDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    try {
      const parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(d);
      const g = (t) => parts.find((p) => p.type === t)?.value || '';
      return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
    } catch {
      return d.toISOString().replace('T', ' ').slice(0, 16);
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function setStatus(text, isError) {
    const { els } = ctx();
    if (!els.onbidSyncStatus) return;
    els.onbidSyncStatus.textContent = String(text || '');
    els.onbidSyncStatus.style.color = isError ? 'var(--danger, #dc2626)' : 'var(--muted, #6b7280)';
  }

  function setResult(text, isError) {
    const { els } = ctx();
    if (!els.onbidSyncResult) return;
    els.onbidSyncResult.textContent = String(text || '');
    els.onbidSyncResult.style.color = isError ? 'var(--danger, #dc2626)' : 'var(--text, #111827)';
  }

  // ─────────────────────────────────────────────────────────────
  // Edge Function 호출
  // ─────────────────────────────────────────────────────────────
  mod.runOnbidSync = async function runOnbidSync() {
    const { state, els, K } = ctx();
    if (!K || typeof K.supabaseEnabled !== 'function' || !K.supabaseEnabled()) {
      setStatus('Supabase 가 구성되어 있지 않습니다.', true);
      return;
    }
    const sb = K.initSupabase();
    if (!sb) {
      setStatus('Supabase 클라이언트 초기화 실패', true);
      return;
    }
    if (state?.session?.user?.role !== 'admin') {
      setStatus('관리자만 실행할 수 있습니다.', true);
      return;
    }

    const maxItemsRaw = Number(els.onbidSyncMaxItems?.value) || 500;
    const maxItems = Math.min(2000, Math.max(1, Math.floor(maxItemsRaw)));

    if (els.btnOnbidSyncStart) els.btnOnbidSyncStart.disabled = true;
    setStatus(`동기화 중... (최대 ${maxItems}건, 1건당 120ms + API 응답시간 소요)`, false);
    setResult('');

    const startedAt = Date.now();
    try {
      // Supabase JS SDK 의 functions.invoke 는 자동으로 Bearer 토큰 첨부
      const { data, error } = await sb.functions.invoke('onbid-sync', {
        body: {
          triggeredBy: 'manual',
          maxItems,
        },
      });

      if (error) {
        // Edge Function 호출 자체 실패 (네트워크/권한/배포상태)
        throw new Error(error?.message || 'Edge Function 호출 실패');
      }
      if (!data || data.ok !== true) {
        throw new Error(data?.message || '동기화 실패');
      }

      const durationTxt = fmtDuration(data.durationMs ?? (Date.now() - startedAt));
      let summary = [
        `대상 ${fmtNumber(data.targetCount)}건`,
        `갱신 ${fmtNumber(data.updatedCount)}건`,
        `결과없음 ${fmtNumber(data.nodataCount)}건`,
        `오류 ${fmtNumber(data.errorCount)}건`,
        `소요 ${durationTxt}`,
      ].join(' · ');
      if (data.abortedByTimeout) {
        summary += ` · 시간 한도로 ${fmtNumber(data.remaining)}건 남음 (다시 실행하면 이어서 처리)`;
      }
      setStatus('동기화 완료', false);
      setResult(summary, data.errorCount > 0);

      // 에러 샘플 있으면 추가로 표시
      if (Array.isArray(data.errors) && data.errors.length) {
        const sample = data.errors.slice(0, 3).map((e) => {
          if (e?.error) return `${e.itemNo}: ${e.error}`;
          if (e?.code) return `${e.itemNo}: [${e.code}] ${e.msg || ''}`;
          if (e?.updateError) return `${e.itemNo}: DB ${e.updateError}`;
          return JSON.stringify(e);
        }).join(' / ');
        setResult(summary + '\n에러 샘플: ' + sample, true);
      }

      // 이력 새로고침
      mod.loadOnbidSyncLogs().catch(() => {});

      // 물건 리스트 무효화 (result_status 변경됨)
      const { utils } = ctx();
      if (typeof utils.invalidatePropertyCollections === 'function') {
        utils.invalidatePropertyCollections();
      }
    } catch (err) {
      console.error('onbid-sync edge function error', err);
      const msg = String(err?.message || err);
      setStatus('동기화 실패', true);
      setResult(msg + '\nEdge Function 배포 상태 및 ONBID_SERVICE_KEY 시크릿 설정을 확인하세요.', true);
    } finally {
      if (els.btnOnbidSyncStart) els.btnOnbidSyncStart.disabled = false;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 이력 조회 & 렌더링
  // ─────────────────────────────────────────────────────────────
  mod.loadOnbidSyncLogs = async function loadOnbidSyncLogs() {
    const { els, K } = ctx();
    if (!K || typeof K.supabaseEnabled !== 'function' || !K.supabaseEnabled()) return;
    const sb = K.initSupabase();
    if (!sb) return;

    const tbody = els.onbidSyncLogsBody;
    const emptyEl = els.onbidSyncLogsEmpty;
    if (!tbody) return;

    try {
      const { data, error } = await sb
        .from('onbid_sync_logs')
        .select('created_at, triggered_by, target_count, success_count, nodata_count, error_count, updated_count, duration_ms, note')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');

      const triggerLabel = (v) => {
        const s = String(v || '').trim();
        if (s === 'manual') return '수동';
        if (s === 'csv_upload') return 'CSV 업로드';
        if (s === 'cron') return '자동';
        return s || '-';
      };
      const noteLabel = (v) => {
        const s = String(v || '').trim();
        if (s === 'aborted_by_timeout') return '시간 한도 중단';
        return s;
      };

      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td>${escapeHtml(fmtDateTime(r.created_at))}</td>
          <td>${escapeHtml(triggerLabel(r.triggered_by))}</td>
          <td style="text-align:right;">${fmtNumber(r.target_count)}</td>
          <td style="text-align:right;color:${Number(r.updated_count) > 0 ? 'var(--primary, #2563eb)' : 'inherit'};">${fmtNumber(r.updated_count)}</td>
          <td style="text-align:right;color:var(--muted, #6b7280);">${fmtNumber(r.nodata_count)}</td>
          <td style="text-align:right;color:${Number(r.error_count) > 0 ? 'var(--danger, #dc2626)' : 'inherit'};">${fmtNumber(r.error_count)}</td>
          <td style="text-align:right;">${escapeHtml(fmtDuration(r.duration_ms))}</td>
          <td style="font-size:11px;color:var(--muted, #6b7280);">${escapeHtml(noteLabel(r.note))}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.warn('loadOnbidSyncLogs failed', err);
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);padding:20px;text-align:center;">이력 로드 실패: ${escapeHtml(err?.message || err)}</td></tr>`;
      if (emptyEl) emptyEl.classList.add('hidden');
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 이벤트 바인딩 (admin-app.js 에서 호출)
  // ─────────────────────────────────────────────────────────────
  mod.initEvents = function initEvents() {
    const { els } = ctx();
    if (els.btnOnbidSyncStart && !els.btnOnbidSyncStart.dataset.bound) {
      els.btnOnbidSyncStart.dataset.bound = '1';
      els.btnOnbidSyncStart.addEventListener('click', () => {
        mod.runOnbidSync().catch((e) => console.error(e));
      });
    }
    if (els.btnOnbidSyncRefreshLogs && !els.btnOnbidSyncRefreshLogs.dataset.bound) {
      els.btnOnbidSyncRefreshLogs.dataset.bound = '1';
      els.btnOnbidSyncRefreshLogs.addEventListener('click', () => {
        mod.loadOnbidSyncLogs().catch((e) => console.error(e));
      });
    }
  };

  AdminModules.onbidSync = mod;
})();
