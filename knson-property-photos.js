(() => {
  'use strict';

  const DataAccess = window.KNSN_DATA_ACCESS || null;
  const Domain = window.KNSN_PROPERTY_DOMAIN || null;
  const Renderers = window.KNSN_PROPERTY_RENDERERS || null;

  const MAX_FILES = 10;
  const SECTION_HTML = `
    <section class="property-photo-section" data-photo-root>
      <div class="property-photo-head">
        <div>
          <h4 class="property-photo-title">사진</h4>
          <p class="property-photo-desc">사진을 업로드하면 자동으로 최적화 후 저장됩니다.</p>
        </div>
        <div class="property-photo-head-actions">
          <button type="button" class="btn btn-secondary" data-photo-action="pick">사진 선택</button>
        </div>
      </div>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple class="hidden" data-photo-role="input" />
      <div class="property-photo-message hidden" data-photo-role="message"></div>
      <div class="property-photo-loading hidden" data-photo-role="loading">사진을 불러오는 중입니다.</div>
      <div class="property-photo-grid" data-photo-role="grid"></div>
    </section>`;

  const VIEWER_HTML = `
    <div class="property-photo-viewer hidden" data-photo-viewer aria-hidden="true">
      <div class="property-photo-viewer-backdrop" data-viewer-action="close"></div>
      <div class="property-photo-viewer-dialog" role="dialog" aria-modal="true" aria-label="사진 크게 보기">
        <button type="button" class="property-photo-viewer-close" data-viewer-action="close" aria-label="닫기">×</button>
        <button type="button" class="property-photo-viewer-nav is-prev" data-viewer-action="prev" aria-label="이전 사진">‹</button>
        <div class="property-photo-viewer-stage">
          <img class="property-photo-viewer-image" data-viewer-role="image" alt="매물 사진" />
          <div class="property-photo-viewer-empty hidden" data-viewer-role="empty">이미지를 불러올 수 없습니다.</div>
          <div class="property-photo-viewer-counter" data-viewer-role="counter"></div>
        </div>
        <button type="button" class="property-photo-viewer-nav is-next" data-viewer-action="next" aria-label="다음 사진">›</button>
      </div>
    </div>`;

  function safeEscape(text) {
    if (Renderers && typeof Renderers.escapeHtml === 'function') return Renderers.escapeHtml(text);
    return String(text || '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[ch] || ch));
  }

  function ensureSection(form) {
    let root = form.querySelector('[data-photo-root]');
    if (root) return root;
    root = document.createElement('div');
    root.innerHTML = SECTION_HTML;
    const section = root.firstElementChild;
    const explicitAnchor = form.querySelector('[data-photo-anchor]');
    if (explicitAnchor && explicitAnchor.parentElement) {
      explicitAnchor.replaceWith(section);
      return section;
    }
    const fieldNodes = [
      form.querySelector('textarea[name="dailyIssue"]'),
      form.querySelector('textarea[name="opinion"]'),
      form.querySelector('textarea[name="siteInspection"]'),
    ].filter(Boolean);
    const anchor = fieldNodes[fieldNodes.length - 1]?.closest('.field, .grid2, .grid3, section, div');
    if (anchor && anchor.parentElement) anchor.after(section);
    else {
      const actions = form.querySelector('.modal-actions');
      if (actions && actions.parentElement) actions.before(section);
      else form.appendChild(section);
    }
    return section;
  }

  async function fileToImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file);
      } catch (_) {}
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function canvasToDataUrl(canvas, quality) {
    return canvas.toDataURL('image/webp', quality);
  }

  async function optimizeImageFile(file) {
    const image = await fileToImage(file);
    const ow = image.width || image.naturalWidth || 0;
    const oh = image.height || image.naturalHeight || 0;
    if (!ow || !oh) throw new Error('이미지 크기를 확인할 수 없습니다.');

    function resize(maxEdge, quality) {
      const ratio = Math.min(1, maxEdge / Math.max(ow, oh));
      const width = Math.max(1, Math.round(ow * ratio));
      const height = Math.max(1, Math.round(oh * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(image, 0, 0, width, height);
      return canvasToDataUrl(canvas, quality).then((dataUrl) => ({ dataUrl, width, height }));
    }

    const original = await resize(1600, 0.82);
    const thumb = await resize(420, 0.78);
    const sizeBytes = Math.round((original.dataUrl.length - (original.dataUrl.indexOf(',') + 1)) * 0.75);
    return {
      originalDataUrl: original.dataUrl,
      thumbDataUrl: thumb.dataUrl,
      width: original.width,
      height: original.height,
      sizeBytes,
      mimeType: 'image/webp',
    };
  }

  function getMessageSetter(root) {
    return (text, kind = 'info') => {
      if (Renderers && typeof Renderers.setPhotoSectionMessage === 'function') {
        Renderers.setPhotoSectionMessage(root, text, kind);
        return;
      }
      const node = root.querySelector('[data-photo-role="message"]');
      if (!node) return;
      const raw = String(text || '').trim();
      node.textContent = raw;
      node.classList.toggle('hidden', !raw);
      node.classList.remove('is-info', 'is-success', 'is-error');
      if (raw) node.classList.add(`is-${kind}`);
    };
  }

  function getLoadingSetter(root) {
    return (isLoading, text = '사진을 불러오는 중입니다.') => {
      if (Renderers && typeof Renderers.setPhotoSectionLoading === 'function') {
        Renderers.setPhotoSectionLoading(root, isLoading, text);
        return;
      }
      const node = root.querySelector('[data-photo-role="loading"]');
      if (!node) return;
      node.textContent = text;
      node.classList.toggle('hidden', !isLoading);
      root.classList.toggle('is-loading', !!isLoading);
    };
  }

  function normalizeItems(items) {
    if (Domain && typeof Domain.normalizePropertyPhotoList === 'function') return Domain.normalizePropertyPhotoList(items);
    return Array.isArray(items) ? items : [];
  }

  function ensureViewer() {
    let viewer = document.querySelector('[data-photo-viewer]');
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
      if (action === 'close') {
        closeViewer(viewer);
        return;
      }
      if (action === 'prev') {
        showViewerIndex(viewer, state.index - 1);
        return;
      }
      if (action === 'next') {
        showViewerIndex(viewer, state.index + 1);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (viewer.classList.contains('hidden')) return;
      if (event.key === 'Escape') {
        closeViewer(viewer);
      } else if (event.key === 'ArrowLeft') {
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
    const img = viewer.querySelector('[data-viewer-role="image"]');
    const empty = viewer.querySelector('[data-viewer-role="empty"]');
    if (img) { img.src = ''; img.classList.remove('hidden'); }
    if (empty) empty.classList.add('hidden');
  }

  function showViewerIndex(viewer, index) {
    const state = viewer && viewer.__viewerState;
    const items = Array.isArray(state?.items) ? state.items : [];
    if (!viewer || !items.length) return;
    const nextIndex = (index + items.length) % items.length;
    const item = items[nextIndex] || {};
    state.index = nextIndex;
    const img = viewer.querySelector('[data-viewer-role="image"]');
    const empty = viewer.querySelector('[data-viewer-role="empty"]');
    const counter = viewer.querySelector('[data-viewer-role="counter"]');
    const src = String(item.originalUrl || item.thumbUrl || '').trim();
    if (counter) counter.textContent = `${nextIndex + 1} / ${items.length}`;
    const prevBtn = viewer.querySelector('[data-viewer-action="prev"]');
    const nextBtn = viewer.querySelector('[data-viewer-action="next"]');
    if (prevBtn) prevBtn.disabled = items.length <= 1;
    if (nextBtn) nextBtn.disabled = items.length <= 1;
    if (!src) {
      if (img) { img.src = ''; img.classList.add('hidden'); }
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    if (img) {
      img.classList.remove('hidden');
      img.src = src;
      img.alt = `매물 사진 ${nextIndex + 1}`;
    }
  }

  function openViewer(items, photoId) {
    const rows = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!rows.length) return;
    const viewer = ensureViewer();
    const idx = Math.max(0, rows.findIndex((row) => String(row.id || '') === String(photoId || '')));
    viewer.__viewerState = { items: rows, index: idx >= 0 ? idx : 0 };
    viewer.classList.remove('hidden');
    viewer.setAttribute('aria-hidden', 'false');
    showViewerIndex(viewer, idx >= 0 ? idx : 0);
  }

  function renderGrid(root, items) {
    const grid = root.querySelector('[data-photo-role="grid"]');
    if (!grid) return;
    if (Renderers && typeof Renderers.renderPropertyPhotoGrid === 'function') {
      grid.innerHTML = Renderers.renderPropertyPhotoGrid(items);
      return;
    }
    grid.innerHTML = (Array.isArray(items) && items.length)
      ? items.map((item) => `<article class="property-photo-card" data-photo-id="${safeEscape(item.id)}"><img src="${safeEscape(item.thumbUrl || '')}" class="property-photo-thumb" alt="매물 사진" /></article>`).join('')
      : '<div class="property-photo-empty">등록된 사진이 없습니다.</div>';
  }

  async function reload(manager) {
    const { root, api, propertyId } = manager;
    const setLoading = getLoadingSetter(root);
    const setMessage = getMessageSetter(root);
    if (!propertyId) return;
    setLoading(true, '사진을 불러오는 중입니다.');
    try {
      const res = await DataAccess.listPropertyPhotosViaApi(api, { propertyId, auth: true });
      manager.items = normalizeItems(res?.items || []);
      renderGrid(root, manager.items);
      setMessage('');
    } catch (err) {
      setMessage(err?.message || '사진을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function uploadFiles(manager, files) {
    const { root, api, propertyId } = manager;
    const setLoading = getLoadingSetter(root);
    const setMessage = getMessageSetter(root);
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const currentCount = Array.isArray(manager.items) ? manager.items.length : 0;
    if (currentCount + list.length > MAX_FILES) {
      setMessage(`사진은 매물당 최대 ${MAX_FILES}장까지 등록할 수 있습니다.`, 'error');
      return;
    }
    setLoading(true, '사진을 준비하는 중입니다.');
    try {
      const prep = await DataAccess.preparePropertyPhotosViaApi(api, { propertyId, count: list.length, auth: true });
      const uploads = Array.isArray(prep?.uploads) ? prep.uploads : [];
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const slot = uploads[i];
        if (!slot) throw new Error('사진 업로드 준비 데이터가 부족합니다.');
        setLoading(true, `사진을 업로드하는 중입니다. (${i + 1}/${list.length})`);
        const optimized = await optimizeImageFile(file);
        const payload = Domain && typeof Domain.buildPropertyPhotoCommitPayload === 'function'
          ? Domain.buildPropertyPhotoCommitPayload(slot, optimized)
          : { ...slot, ...optimized };
        await DataAccess.commitPropertyPhotosViaApi(api, { propertyId, photos: [payload], auth: true });
      }
      await reload(manager);
      setMessage('사진이 저장되었습니다.', 'success');
      window.setTimeout(() => setMessage(''), 1500);
    } catch (err) {
      setMessage(err?.message || '사진 저장에 실패했습니다.', 'error');
    } finally {
      setLoading(false);
      const input = root.querySelector('[data-photo-role="input"]');
      if (input) input.value = '';
    }
  }

  async function handleAction(manager, action, photoId) {
    const { root, api, propertyId } = manager;
    const setLoading = getLoadingSetter(root);
    const setMessage = getMessageSetter(root);
    const items = Array.isArray(manager.items) ? manager.items.slice() : [];
    const idx = items.findIndex((row) => String(row.id || '') === String(photoId || ''));
    const current = idx >= 0 ? items[idx] : null;
    if (!current) return;
    try {
      if (action === 'view') {
        openViewer(items, photoId);
        return;
      }
      setLoading(true, '사진 정보를 저장하는 중입니다.');
      if (action === 'primary') {
        await DataAccess.setPrimaryPropertyPhotoViaApi(api, { propertyId, photoId, auth: true });
      } else if (action === 'delete') {
        if (!window.confirm('이 사진을 삭제할까요?')) return;
        await DataAccess.deletePropertyPhotoViaApi(api, { propertyId, photoId, auth: true });
      } else if (action === 'move-left' || action === 'move-right') {
        const nextIndex = action === 'move-left' ? idx - 1 : idx + 1;
        if (nextIndex < 0 || nextIndex >= items.length) return;
        const cloned = items.slice();
        const [moved] = cloned.splice(idx, 1);
        cloned.splice(nextIndex, 0, moved);
        const orderedPhotoIds = cloned.map((row) => row.id);
        await DataAccess.reorderPropertyPhotosViaApi(api, { propertyId, orderedPhotoIds, auth: true });
      }
      await reload(manager);
      setMessage(action === 'delete' ? '사진이 삭제되었습니다.' : '사진이 저장되었습니다.', 'success');
      window.setTimeout(() => setMessage(''), 1500);
    } catch (err) {
      setMessage(err?.message || '사진 처리에 실패했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }

  function bind(root, manager) {
    if (root.__photoBound) return;
    root.__photoBound = true;
    const input = root.querySelector('[data-photo-role="input"]');
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-photo-action]');
      if (!button) return;
      const action = button.getAttribute('data-photo-action');
      const photoId = button.getAttribute('data-photo-id') || '';
      if (action === 'pick') {
        input?.click();
        return;
      }
      handleAction(manager, action, photoId);
    });
    input?.addEventListener('change', (event) => uploadFiles(manager, event.target.files));
  }

  async function mountSection({ form, propertyId, api }) {
    if (!form || !propertyId || !DataAccess) return null;
    const root = ensureSection(form);
    const manager = { form, root, propertyId, api, items: [] };
    root.__photoManager = manager;
    bind(root, manager);
    await reload(manager);
    return manager;
  }

  window.KNSN_PROPERTY_PHOTOS = {
    mountSection,
    optimizeImageFile,
  };
})();
