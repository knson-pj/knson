// =============================================================================
// knson-property-videos.js  (2026-05-04)
// =============================================================================
//
// 매물 동영상 업로드 / 재생 / 정렬 / 삭제 모듈.
// 사진 모듈(knson-property-photos.js) 과 동일한 mountSection 인터페이스.
//
// 핵심 동작 흐름 (업로드):
//   1) 파일 선택 → 사이즈/포맷/재생시간 사전 검증 + 와이파이 안내(첫 1회)
//   2) <video> 로드해 첫 프레임 canvas 캡처 → JPEG dataURL (실패 시 null)
//   3) /api/properties?video_action=prepare 호출 → signed upload URL 발급
//   4) XMLHttpRequest 로 Storage 에 직접 PUT (progress 이벤트로 0~100% 표시)
//      포스터가 있으면 별도 PUT (progress 비표시, 작은 이미지)
//   5) /api/properties?video_action=commit 호출 → DB 메타 INSERT
//   6) 목록 새로고침
//
// 모달 닫기 = 진행 중 업로드 취소:
//   manager.activeUpload 에 현재 XHR 보관, mountSection 시 폼 또는 모달의
//   close 이벤트(폼 ancestor 의 .modal hidden 토글)를 MutationObserver 로
//   감시해서 닫히면 abort.
//
// =============================================================================

(() => {
  'use strict';

  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const Domain = window.KNSN_PROPERTY_DOMAIN || null;
  const Renderers = window.KNSN_PROPERTY_RENDERERS || null;

  // 서버 사양과 동일하게 클라이언트에도 상한 보유 (사전 차단)
  const MAX_VIDEOS = 5;
  const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;       // 100 MB
  const MAX_DURATION_SEC = 300;                         // 5분
  const ALLOWED_MIME_TYPES = new Set([
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ]);

  // 와이파이 안내를 한 번만 표시 (페이지 세션 동안)
  const WIFI_NOTICE_KEY = 'knson_video_wifi_notice_v1';

  const SECTION_HTML = `
    <section class="property-video-section" data-video-root>
      <div class="property-video-head">
        <div>
          <h4 class="property-video-title">동영상</h4>
          <p class="property-video-desc">
            매물당 최대 ${MAX_VIDEOS}개, 영상별 최대 100MB / 5분.
            <strong class="property-video-wifi-hint">데이터 사용량이 크니 Wi-Fi 환경에서 업로드를 권장합니다.</strong>
          </p>
        </div>
        <div class="property-video-head-actions">
          <button type="button" class="btn btn-secondary" data-video-action="pick">동영상 선택</button>
        </div>
      </div>
      <input type="file" accept="video/mp4,video/webm,video/quicktime" multiple class="hidden" data-video-role="input" />
      <div class="property-video-message hidden" data-video-role="message"></div>
      <div class="property-video-progress hidden" data-video-role="progress" aria-live="polite">
        <div class="property-video-progress-meta">
          <span class="property-video-progress-label" data-video-role="progress-label"></span>
          <span class="property-video-progress-counter" data-video-role="progress-counter">0%</span>
        </div>
        <div class="property-video-progress-track">
          <div class="property-video-progress-bar" data-video-role="progress-bar" style="width:0%"></div>
        </div>
      </div>
      <div class="property-video-loading hidden" data-video-role="loading">동영상을 불러오는 중입니다.</div>
      <div class="property-video-grid" data-video-role="grid"></div>
    </section>`;

  const VIEWER_HTML = `
    <div class="property-video-viewer hidden" data-video-viewer aria-hidden="true">
      <div class="property-video-viewer-backdrop" data-viewer-action="close"></div>
      <div class="property-video-viewer-dialog" role="dialog" aria-modal="true" aria-label="동영상 크게 보기">
        <button type="button" class="property-video-viewer-close" data-viewer-action="close" aria-label="닫기">×</button>
        <button type="button" class="property-video-viewer-nav is-prev" data-viewer-action="prev" aria-label="이전 동영상">‹</button>
        <div class="property-video-viewer-stage">
          <video class="property-video-viewer-player" data-viewer-role="video" controls preload="metadata" playsinline></video>
          <div class="property-video-viewer-empty hidden" data-viewer-role="empty">동영상을 불러올 수 없습니다.</div>
          <div class="property-video-viewer-counter" data-viewer-role="counter"></div>
        </div>
        <button type="button" class="property-video-viewer-nav is-next" data-viewer-action="next" aria-label="다음 동영상">›</button>
      </div>
    </div>`;

  function safeEscape(text) {
    if (Renderers && typeof Renderers.escapeHtml === 'function') return Renderers.escapeHtml(text);
    return String(text || '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[ch] || ch));
  }


  // ───────────────────────────────────────────────────────────────────────
  // 섹션 생성/마운트
  // ───────────────────────────────────────────────────────────────────────

  function ensureSection(form) {
    let root = form.querySelector('[data-video-root]');
    if (root) return root;
    const wrap = document.createElement('div');
    wrap.innerHTML = SECTION_HTML;
    const section = wrap.firstElementChild;

    // 1순위: 명시 anchor (<div data-video-anchor></div>)
    const explicitAnchor = form.querySelector('[data-video-anchor]');
    if (explicitAnchor && explicitAnchor.parentElement) {
      explicitAnchor.replaceWith(section);
      return section;
    }
    // 2순위: 사진 섹션 바로 다음
    const photoSection = form.querySelector('[data-photo-root]');
    if (photoSection && photoSection.parentElement) {
      photoSection.after(section);
      return section;
    }
    // 3순위: 모달 actions 직전
    const actions = form.querySelector('.modal-actions');
    if (actions && actions.parentElement) {
      actions.before(section);
      return section;
    }
    form.appendChild(section);
    return section;
  }


  // ───────────────────────────────────────────────────────────────────────
  // 메시지 / 로딩 / 진행률 헬퍼 (렌더러 위임 + fallback)
  // ───────────────────────────────────────────────────────────────────────

  function getMessageSetter(root) {
    return (text, kind = 'info') => {
      if (Renderers && typeof Renderers.setVideoSectionMessage === 'function') {
        Renderers.setVideoSectionMessage(root, text, kind);
        return;
      }
      const node = root.querySelector('[data-video-role="message"]');
      if (!node) return;
      const raw = String(text || '').trim();
      node.textContent = raw;
      node.classList.toggle('hidden', !raw);
      node.classList.remove('is-info', 'is-success', 'is-error');
      if (raw) node.classList.add(`is-${kind}`);
    };
  }

  function getLoadingSetter(root) {
    return (isLoading, text = '동영상을 불러오는 중입니다.') => {
      if (Renderers && typeof Renderers.setVideoSectionLoading === 'function') {
        Renderers.setVideoSectionLoading(root, isLoading, text);
        return;
      }
      const node = root.querySelector('[data-video-role="loading"]');
      if (!node) return;
      node.textContent = text;
      node.classList.toggle('hidden', !isLoading);
      root.classList.toggle('is-loading', !!isLoading);
    };
  }

  function getProgressSetter(root) {
    return (state) => {
      if (Renderers && typeof Renderers.setVideoSectionProgress === 'function') {
        Renderers.setVideoSectionProgress(root, state || {});
        return;
      }
      const wrap = root.querySelector('[data-video-role="progress"]');
      if (!wrap) return;
      const active = !!state?.active;
      wrap.classList.toggle('hidden', !active);
      if (!active) return;
      const bar = wrap.querySelector('[data-video-role="progress-bar"]');
      const label = wrap.querySelector('[data-video-role="progress-label"]');
      const counter = wrap.querySelector('[data-video-role="progress-counter"]');
      const safePct = Math.max(0, Math.min(100, Math.round(Number(state.percent) || 0)));
      if (bar) bar.style.width = `${safePct}%`;
      if (label) label.textContent = String(state.fileName || '동영상');
      if (counter) {
        const pct = `${safePct}%`;
        counter.textContent = state.total > 1 ? `${state.current}/${state.total} · ${pct}` : pct;
      }
    };
  }


  // ───────────────────────────────────────────────────────────────────────
  // 데이터 정규화
  // ───────────────────────────────────────────────────────────────────────

  function normalizeItems(items) {
    if (Domain && typeof Domain.normalizePropertyVideoList === 'function') {
      return Domain.normalizePropertyVideoList(items);
    }
    return Array.isArray(items) ? items : [];
  }


  // ───────────────────────────────────────────────────────────────────────
  // 클라이언트 사전 검증
  // ───────────────────────────────────────────────────────────────────────

  function validateFile(file) {
    if (!file) return '파일이 선택되지 않았습니다.';
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `파일 크기가 너무 큽니다. (최대 ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB)`;
    }
    const mime = String(file.type || '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return '지원하지 않는 동영상 형식입니다. (MP4 / WebM / MOV)';
    }
    return '';
  }

  // <video> 로 메타 로드해서 duration / 가로세로 측정 + 첫 프레임 캡처
  // 캡처 실패해도 메타는 반환. (iOS 등 캡처 제한 환경 fallback)
  function probeVideoFile(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      let url = '';
      try { url = URL.createObjectURL(file); } catch {}
      let settled = false;
      let captured = false;

      function cleanup() {
        try { if (url) URL.revokeObjectURL(url); } catch {}
        try { video.src = ''; video.load(); } catch {}
      }

      function finish(meta) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(meta);
      }

      // 폼/사용자 환경에서 메타 로드가 막히는 경우 대비
      const timeoutId = window.setTimeout(() => {
        finish({ durationSec: 0, width: 0, height: 0, posterDataUrl: '' });
      }, 8000);

      video.addEventListener('loadedmetadata', () => {
        const durationSec = Number(video.duration || 0);
        const width = Number(video.videoWidth || 0);
        const height = Number(video.videoHeight || 0);
        // duration 이 즉시 사용 가능. 첫 프레임 캡처는 currentTime=0.1 이동 후 시도
        try {
          // 일부 브라우저는 0초 프레임을 못 그리므로 살짝 이동
          video.currentTime = Math.min(0.1, Math.max(0, (durationSec - 0.05)));
        } catch {
          window.clearTimeout(timeoutId);
          finish({ durationSec, width, height, posterDataUrl: '' });
        }

        const tryCapture = () => {
          if (captured) return;
          captured = true;
          let posterDataUrl = '';
          try {
            const canvas = document.createElement('canvas');
            const w = video.videoWidth || width || 640;
            const h = video.videoHeight || height || 360;
            // 너무 큰 포스터는 비실용적. 최대 640px 변길이로 축소.
            const ratio = Math.min(1, 640 / Math.max(w, h));
            canvas.width = Math.max(1, Math.round(w * ratio));
            canvas.height = Math.max(1, Math.round(h * ratio));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            posterDataUrl = canvas.toDataURL('image/jpeg', 0.78);
          } catch {
            posterDataUrl = '';
          }
          window.clearTimeout(timeoutId);
          finish({ durationSec, width, height, posterDataUrl });
        };

        // seeked 이벤트 또는 약간의 딜레이 후 캡처
        video.addEventListener('seeked', tryCapture, { once: true });
        window.setTimeout(tryCapture, 800);
      }, { once: true });

      video.addEventListener('error', () => {
        window.clearTimeout(timeoutId);
        finish({ durationSec: 0, width: 0, height: 0, posterDataUrl: '' });
      }, { once: true });

      try {
        video.src = url || '';
        video.load();
      } catch {
        window.clearTimeout(timeoutId);
        finish({ durationSec: 0, width: 0, height: 0, posterDataUrl: '' });
      }
    });
  }


  // ───────────────────────────────────────────────────────────────────────
  // dataURL → Blob (포스터 업로드용)
  // ───────────────────────────────────────────────────────────────────────

  function dataUrlToBlob(dataUrl) {
    const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1];
    const bin = atob(m[2]);
    const len = bin.length;
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }


  // ───────────────────────────────────────────────────────────────────────
  // Storage 직접 PUT (signed upload URL)
  //
  // Supabase 의 signed upload URL 은 두 가지 방식 모두 받음:
  //   (a) 응답에 url + token 분리 → 클라이언트가 url 에 PUT 하면서
  //       header 'x-upsert: true', 'Authorization: Bearer {token}' 사용
  //   (b) 응답 url 자체에 token 이 포함된 경우 → 그대로 PUT
  // 안전하게 (a) 우선 + (b) fallback.
  // ───────────────────────────────────────────────────────────────────────

  function putToSignedUrl(uploadInfo, blob, { onProgress, abortSignal } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = String(uploadInfo?.url || '').trim();
      const token = String(uploadInfo?.token || '').trim();
      const contentType = String(uploadInfo?.contentType || blob?.type || 'application/octet-stream').trim();

      if (!url) {
        reject(new Error('업로드 URL 이 누락되었습니다.'));
        return;
      }

      try { xhr.open('PUT', url, true); } catch (err) {
        reject(err);
        return;
      }
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('x-upsert', 'true');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (typeof onProgress === 'function' && xhr.upload) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          const err = new Error(`업로드 실패 (HTTP ${xhr.status})`);
          err.status = xhr.status;
          err.responseText = xhr.responseText || '';
          reject(err);
        }
      });
      xhr.addEventListener('error', () => reject(new Error('업로드 네트워크 오류')));
      xhr.addEventListener('abort', () => {
        const err = new Error('업로드가 취소되었습니다.');
        err.code = 'UPLOAD_ABORTED';
        reject(err);
      });

      // 호출 측에서 abort 신호 등록
      if (abortSignal && typeof abortSignal.addEventListener === 'function') {
        if (abortSignal.aborted) {
          try { xhr.abort(); } catch {}
        } else {
          abortSignal.addEventListener('abort', () => {
            try { xhr.abort(); } catch {}
          }, { once: true });
        }
      }

      try { xhr.send(blob); } catch (err) {
        reject(err);
      }
    });
  }


  // ───────────────────────────────────────────────────────────────────────
  // 와이파이 안내 (세션당 1회)
  // ───────────────────────────────────────────────────────────────────────

  function maybeShowWifiNotice(setMessage) {
    let shown = false;
    try { shown = sessionStorage.getItem(WIFI_NOTICE_KEY) === '1'; } catch {}
    if (shown) return;
    setMessage('데이터 사용량이 큽니다. Wi-Fi 환경에서 업로드를 권장합니다.', 'info');
    try { sessionStorage.setItem(WIFI_NOTICE_KEY, '1'); } catch {}
  }


  // ───────────────────────────────────────────────────────────────────────
  // 그리드 / 뷰어
  // ───────────────────────────────────────────────────────────────────────

  function renderGrid(root, items) {
    const grid = root.querySelector('[data-video-role="grid"]');
    if (!grid) return;
    if (Renderers && typeof Renderers.renderPropertyVideoGrid === 'function') {
      grid.innerHTML = Renderers.renderPropertyVideoGrid(items);
      return;
    }
    grid.innerHTML = (Array.isArray(items) && items.length)
      ? items.map((item) => `<article class="property-video-card" data-video-id="${safeEscape(item.id)}">${item.posterUrl ? `<img src="${safeEscape(item.posterUrl)}" class="property-video-thumb" alt="동영상" />` : ''}</article>`).join('')
      : '<div class="property-video-empty">등록된 동영상이 없습니다.</div>';
  }

  function ensureViewer() {
    let viewer = document.querySelector('[data-video-viewer]');
    if (viewer) return viewer;
    const wrap = document.createElement('div');
    wrap.innerHTML = VIEWER_HTML;
    viewer = wrap.firstElementChild;
    document.body.appendChild(viewer);
    viewer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-viewer-action]');
      if (!button) return;
      const action = button.getAttribute('data-viewer-action');
      const state = viewer.__viewerState || null;
      if (!state) return;
      if (action === 'close') { closeViewer(viewer); return; }
      if (action === 'prev') { showViewerIndex(viewer, state.index - 1); return; }
      if (action === 'next') { showViewerIndex(viewer, state.index + 1); }
    });
    document.addEventListener('keydown', (event) => {
      if (viewer.classList.contains('hidden')) return;
      if (event.key === 'Escape') closeViewer(viewer);
      else if (event.key === 'ArrowLeft') {
        const state = viewer.__viewerState || null;
        if (state) showViewerIndex(viewer, state.index - 1);
      } else if (event.key === 'ArrowRight') {
        const state = viewer.__viewerState || null;
        if (state) showViewerIndex(viewer, state.index + 1);
      }
    });
    return viewer;
  }

  function closeViewer(viewer) {
    if (!viewer) return;
    viewer.classList.add('hidden');
    viewer.setAttribute('aria-hidden', 'true');
    viewer.__viewerState = null;
    const player = viewer.querySelector('[data-viewer-role="video"]');
    const empty = viewer.querySelector('[data-viewer-role="empty"]');
    if (player) {
      try { player.pause(); } catch {}
      try { player.removeAttribute('src'); player.load(); } catch {}
      player.classList.remove('hidden');
    }
    if (empty) empty.classList.add('hidden');
  }

  function showViewerIndex(viewer, index) {
    const state = viewer && viewer.__viewerState;
    const items = Array.isArray(state?.items) ? state.items : [];
    if (!viewer || !items.length) return;
    const nextIndex = (index + items.length) % items.length;
    const item = items[nextIndex] || {};
    state.index = nextIndex;
    const player = viewer.querySelector('[data-viewer-role="video"]');
    const empty = viewer.querySelector('[data-viewer-role="empty"]');
    const counter = viewer.querySelector('[data-viewer-role="counter"]');
    const src = String(item.videoUrl || '').trim();
    if (counter) counter.textContent = `${nextIndex + 1} / ${items.length}`;
    if (!src) {
      if (player) { try { player.pause(); } catch {} player.classList.add('hidden'); }
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    if (player) {
      player.classList.remove('hidden');
      try { player.pause(); } catch {}
      player.setAttribute('src', src);
      if (item.posterUrl) player.setAttribute('poster', item.posterUrl);
      else player.removeAttribute('poster');
      try { player.load(); } catch {}
    }
  }

  function openViewer(items, videoId) {
    const rows = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!rows.length) return;
    const viewer = ensureViewer();
    const idx = Math.max(0, rows.findIndex((row) => String(row.id || '') === String(videoId || '')));
    viewer.__viewerState = { items: rows, index: idx >= 0 ? idx : 0 };
    viewer.classList.remove('hidden');
    viewer.setAttribute('aria-hidden', 'false');
    showViewerIndex(viewer, idx >= 0 ? idx : 0);
  }


  // ───────────────────────────────────────────────────────────────────────
  // 목록 새로고침
  // ───────────────────────────────────────────────────────────────────────

  async function reload(manager) {
    const { root, api, propertyId } = manager;
    const setLoading = getLoadingSetter(root);
    const setMessage = getMessageSetter(root);
    if (!propertyId || !DataAccess) return;
    setLoading(true, '동영상을 불러오는 중입니다.');
    try {
      const res = await DataAccess.listPropertyVideosViaApi(api, { propertyId, auth: true });
      manager.items = normalizeItems(res?.items || []);
      renderGrid(root, manager.items);
      setMessage('');
    } catch (err) {
      setMessage(err?.message || '동영상을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }


  // ───────────────────────────────────────────────────────────────────────
  // 업로드 메인 로직
  // ───────────────────────────────────────────────────────────────────────

  async function uploadFiles(manager, files) {
    const { root, api, propertyId } = manager;
    if (!DataAccess || !propertyId) return;
    const setMessage = getMessageSetter(root);
    const setLoading = getLoadingSetter(root);
    const setProgress = getProgressSetter(root);
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;

    // 클라이언트 상한 체크 (서버에서도 한 번 더 검증됨)
    const currentCount = Array.isArray(manager.items) ? manager.items.length : 0;
    if (currentCount + list.length > MAX_VIDEOS) {
      setMessage(`동영상은 매물당 최대 ${MAX_VIDEOS}개까지 등록할 수 있습니다.`, 'error');
      return;
    }

    // 와이파이 안내 (첫 1회)
    maybeShowWifiNotice(setMessage);

    // 전체 시퀀스 동안 abort 가능하도록 AbortController 보관
    const controller = new AbortController();
    manager.activeUpload = controller;

    let success = 0;
    try {
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];

        // 사전 검증
        const validationError = validateFile(file);
        if (validationError) {
          setMessage(validationError, 'error');
          return;
        }

        setProgress({ active: true, percent: 0, fileName: file.name || '동영상', current: i + 1, total: list.length });
        setLoading(true, `동영상을 분석하는 중입니다. (${i + 1}/${list.length})`);

        // 메타 + 첫 프레임 추출
        const probe = await probeVideoFile(file);

        // 재생시간 사전 차단
        if (probe.durationSec > MAX_DURATION_SEC) {
          setMessage(`동영상은 ${Math.floor(MAX_DURATION_SEC / 60)}분 이하만 등록할 수 있습니다. (현재 ${Math.round(probe.durationSec)}초)`, 'error');
          return;
        }

        if (controller.signal.aborted) throw createAbortError();

        // prepare
        setLoading(true, `업로드 준비 중입니다. (${i + 1}/${list.length})`);
        const posterMime = probe.posterDataUrl ? 'image/jpeg' : '';
        const prep = await DataAccess.preparePropertyVideoViaApi(api, {
          propertyId,
          mimeType: file.type,
          posterMimeType: posterMime,
          sizeBytes: file.size,
          durationSec: probe.durationSec,
        });
        if (!prep?.ok) throw new Error(prep?.message || '업로드 준비에 실패했습니다.');

        if (controller.signal.aborted) throw createAbortError();

        // 영상 본체 업로드 (XHR + progress)
        setLoading(true, `동영상을 업로드하는 중입니다. (${i + 1}/${list.length})`);
        await putToSignedUrl(prep.videoUpload, file, {
          abortSignal: controller.signal,
          onProgress: (pct) => {
            setProgress({ active: true, percent: pct, fileName: file.name || '동영상', current: i + 1, total: list.length });
          },
        });

        if (controller.signal.aborted) throw createAbortError();

        // 포스터 업로드 (있을 때만)
        if (prep.posterUpload && probe.posterDataUrl) {
          setLoading(true, `썸네일을 업로드하는 중입니다. (${i + 1}/${list.length})`);
          const blob = dataUrlToBlob(probe.posterDataUrl);
          if (blob) {
            try {
              await putToSignedUrl(prep.posterUpload, blob, { abortSignal: controller.signal });
            } catch (posterErr) {
              // 포스터 실패는 비치명적 — 영상 본체는 이미 업로드됨
              if (posterErr?.code === 'UPLOAD_ABORTED') throw posterErr;
              console.warn('[video] poster upload skipped:', posterErr?.message);
            }
          }
        }

        if (controller.signal.aborted) throw createAbortError();

        // commit
        setLoading(true, `메타데이터를 저장하는 중입니다. (${i + 1}/${list.length})`);
        const commitPayload = (Domain && typeof Domain.buildPropertyVideoCommitPayload === 'function')
          ? Domain.buildPropertyVideoCommitPayload(
              { videoId: prep.videoId, storagePath: prep.storagePath, posterPath: prep.posterPath },
              {
                mimeType: file.type,
                durationSec: probe.durationSec,
                width: probe.width,
                height: probe.height,
                sizeBytes: file.size,
              }
            )
          : {
              videoId: prep.videoId,
              storagePath: prep.storagePath,
              posterPath: prep.posterPath || '',
              mimeType: file.type,
              durationSec: probe.durationSec,
              width: probe.width,
              height: probe.height,
              sizeBytes: file.size,
            };

        await DataAccess.commitPropertyVideoViaApi(api, { propertyId, video: commitPayload, auth: true });
        success += 1;

        setProgress({ active: true, percent: 100, fileName: file.name || '동영상', current: i + 1, total: list.length });
      }

      await reload(manager);
      setMessage(`${success}개 동영상이 저장되었습니다.`, 'success');
      window.setTimeout(() => setMessage(''), 1800);
    } catch (err) {
      if (err?.code === 'UPLOAD_ABORTED' || controller.signal.aborted) {
        setMessage('업로드가 취소되었습니다.', 'info');
        // 부분 업로드 정리는 서버에서 commit 안 했으므로 자동 무효화됨
      } else {
        setMessage(err?.message || '동영상 저장에 실패했습니다.', 'error');
      }
    } finally {
      setProgress({ active: false });
      setLoading(false);
      manager.activeUpload = null;
      const input = root.querySelector('[data-video-role="input"]');
      if (input) input.value = '';
    }
  }

  function createAbortError() {
    const err = new Error('업로드가 취소되었습니다.');
    err.code = 'UPLOAD_ABORTED';
    return err;
  }


  // ───────────────────────────────────────────────────────────────────────
  // 카드 액션 (정렬 / 대표 / 삭제)
  // ───────────────────────────────────────────────────────────────────────

  async function handleAction(manager, action, videoId) {
    const { root, api, propertyId } = manager;
    const setLoading = getLoadingSetter(root);
    const setMessage = getMessageSetter(root);
    const items = Array.isArray(manager.items) ? manager.items.slice() : [];
    const idx = items.findIndex((row) => String(row.id || '') === String(videoId || ''));
    const current = idx >= 0 ? items[idx] : null;
    if (!current) return;
    try {
      if (action === 'view') {
        openViewer(items, videoId);
        return;
      }
      setLoading(true, '동영상 정보를 저장하는 중입니다.');
      if (action === 'primary') {
        await DataAccess.setPrimaryPropertyVideoViaApi(api, { propertyId, videoId, auth: true });
      } else if (action === 'delete') {
        await DataAccess.deletePropertyVideoViaApi(api, { propertyId, videoId, auth: true });
      } else if (action === 'move-left' || action === 'move-right') {
        const nextIndex = action === 'move-left' ? idx - 1 : idx + 1;
        if (nextIndex < 0 || nextIndex >= items.length) return;
        const cloned = items.slice();
        const [moved] = cloned.splice(idx, 1);
        cloned.splice(nextIndex, 0, moved);
        const orderedVideoIds = cloned.map((row) => row.id);
        await DataAccess.reorderPropertyVideosViaApi(api, { propertyId, orderedVideoIds, auth: true });
      }
      await reload(manager);
      setMessage(action === 'delete' ? '동영상이 삭제되었습니다.' : '동영상이 저장되었습니다.', 'success');
      window.setTimeout(() => setMessage(''), 1500);
    } catch (err) {
      setMessage(err?.message || '동영상 처리에 실패했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }


  // ───────────────────────────────────────────────────────────────────────
  // 이벤트 바인딩
  // ───────────────────────────────────────────────────────────────────────

  function bind(root) {
    if (root.__videoBound) return;
    root.__videoBound = true;
    const input = root.querySelector('[data-video-role="input"]');
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-video-action]');
      if (!button) return;
      const manager = root.__videoManager;
      if (!manager) return;
      const action = button.getAttribute('data-video-action');
      const videoId = button.getAttribute('data-video-id') || '';
      if (action === 'pick') {
        input?.click();
        return;
      }
      handleAction(manager, action, videoId);
    });
    input?.addEventListener('change', (event) => {
      const manager = root.__videoManager;
      if (!manager) return;
      uploadFiles(manager, event.target.files);
    });
  }


  // ───────────────────────────────────────────────────────────────────────
  // 모달 닫힘 감지 → 진행 중 업로드 취소
  // ───────────────────────────────────────────────────────────────────────
  //
  // 폼이 속한 가장 가까운 .modal 의 hidden 클래스 / aria-hidden 속성을 감시해
  // true 가 되는 순간 manager.activeUpload?.abort() 호출.
  // ───────────────────────────────────────────────────────────────────────

  function attachModalCloseObserver(form, manager) {
    const modal = form.closest('.modal');
    if (!modal || manager.__modalObserver) return;
    const observer = new MutationObserver(() => {
      const isHidden = modal.classList.contains('hidden') || modal.getAttribute('aria-hidden') === 'true';
      if (isHidden && manager.activeUpload) {
        try { manager.activeUpload.abort(); } catch {}
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    manager.__modalObserver = observer;
  }


  // ───────────────────────────────────────────────────────────────────────
  // public mount
  // ───────────────────────────────────────────────────────────────────────

  async function mountSection({ form, propertyId, api }) {
    if (!form || !propertyId || !DataAccess) return null;
    const root = ensureSection(form);
    const manager = { form, root, propertyId, api, items: [], activeUpload: null };
    root.__videoManager = manager;
    bind(root);
    attachModalCloseObserver(form, manager);
    await reload(manager);
    return manager;
  }

  window.KNSN_PROPERTY_VIDEOS = {
    mountSection,
    MAX_VIDEOS,
    MAX_FILE_SIZE_BYTES,
    MAX_DURATION_SEC,
  };
})();
