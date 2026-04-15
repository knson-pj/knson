(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};
  const TITLE_MAP = {
    home: '홈 대시보드',
    properties: '전체 현황',
    csv: '물건 등록',
    staff: '등록 관리',
    regions: '물건배정',
    geocoding: '지오 코딩',
    workmgmt: '업무 관리',
    buildings: '건축물대장 API → DB 저장',
  };

  function runtime() {
    return window.KNSN_ADMIN_RUNTIME || {};
  }

  function ctx() {
    const rt = runtime();
    return {
      rt,
      state: rt.state || {},
      els: rt.els || {},
      K: rt.K,
      api: rt.adminApi,
      utils: rt.utils || {},
    };
  }

  function hiddenTabs() {
    return Array.from(document.querySelectorAll('#adminTabs .tab'));
  }

  function clickHiddenTab(tab) {
    const tabs = hiddenTabs();
    const btn = tabs.find((el) => el.dataset.tab === tab);
    if (btn) btn.click();
  }

  function updateSidebarUserName() {
    const { els } = ctx();
    const sidebarName = document.getElementById('sidebarUserName');
    const topbarName = document.getElementById('topbarUserName');
    if (!els.adminUserBadge) return;
    const txt = String(els.adminUserBadge.textContent || '').trim();
    if (txt && txt !== '비로그인') {
      if (sidebarName) sidebarName.textContent = txt;
      if (topbarName) topbarName.textContent = txt;
      return;
    }
    if (sidebarName && txt) sidebarName.textContent = txt;
    if (topbarName && txt) topbarName.textContent = txt;
  }

  mod.syncChromeForTab = function syncChromeForTab(tab) {
    const t = String(tab || '').trim() || 'home';
    document.querySelectorAll('#sidebarNav .sidebar-nav-item').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.tab === t);
    });
    document.querySelectorAll('#adminBottomNav .admin-bottom-item[data-tab]').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.tab === t);
    });

    const active = document.querySelector('#sidebarNav .sidebar-nav-item.is-active');
    if (active) {
      const grp = active.closest('.sidebar-group');
      if (grp) {
        const btn = grp.querySelector('.sidebar-group-btn');
        const items = grp.querySelector('.sidebar-group-items');
        if (btn && items) {
          btn.classList.add('is-open');
          const arrow = btn.querySelector('.sidebar-group-arrow');
          if (arrow) arrow.textContent = '∧';
          items.style.maxHeight = items.scrollHeight + 'px';
        }
      }
    }

    const titleEl = document.getElementById('topbarTitle');
    if (titleEl && TITLE_MAP[t]) titleEl.textContent = TITLE_MAP[t];
  };

  mod.setupChrome = function setupChrome() {
    const { state } = ctx();
    mod.syncChromeForTab(state.activeTab || 'home');
    updateSidebarUserName();
  };

  mod.bindEvents = function bindEvents() {
    const { els } = ctx();

    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.dataset.bound !== 'true') {
      toggleBtn.dataset.bound = 'true';
      toggleBtn.addEventListener('click', () => {
        const collapsed = document.body.classList.toggle('sidebar-collapsed');
        toggleBtn.innerHTML = collapsed ? '&#8250;' : '&#8249;';
      });
    }

    document.querySelectorAll('.sidebar-group-btn').forEach((btn) => {
      if (btn.dataset.bound === 'true') return;
      btn.dataset.bound = 'true';
      const items = btn.closest('.sidebar-group')?.querySelector('.sidebar-group-items');
      if (items && !items.dataset.initialized) {
        items.dataset.initialized = 'true';
        items.style.maxHeight = '0';
      }
      btn.addEventListener('click', () => {
        if (!items) return;
        const opened = btn.classList.toggle('is-open');
        items.style.maxHeight = opened ? items.scrollHeight + 'px' : '0';
        const arrow = btn.querySelector('.sidebar-group-arrow');
        if (arrow) arrow.textContent = opened ? '∧' : '∨';
      });
    });

    document.querySelectorAll('#sidebarNav .sidebar-nav-item').forEach((item) => {
      if (item.dataset.bound === 'true') return;
      item.dataset.bound = 'true';
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        clickHiddenTab(tab);
        mod.syncChromeForTab(tab);
      });
    });

    document.querySelectorAll('#adminBottomNav .admin-bottom-item[data-tab]').forEach((item) => {
      if (item.dataset.bound === 'true') return;
      item.dataset.bound = 'true';
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        clickHiddenTab(tab);
        mod.syncChromeForTab(tab);
      });
    });

    const bottomSettings = document.getElementById('adminBottomSettings');
    if (bottomSettings && bottomSettings.dataset.bound !== 'true') {
      bottomSettings.dataset.bound = 'true';
      bottomSettings.addEventListener('click', () => {
        els.btnChangeMyPassword?.click();
      });
    }

    const sidebarSettings = document.getElementById('btnSidebarSettings');
    if (sidebarSettings && sidebarSettings.dataset.bound !== 'true') {
      sidebarSettings.dataset.bound = 'true';
      sidebarSettings.addEventListener('click', () => {
        els.btnChangeMyPassword?.click();
      });
    }

    if (els.adminGlobalSearch && els.adminGlobalSearch.dataset.bound !== 'true') {
      els.adminGlobalSearch.dataset.bound = 'true';
      els.adminGlobalSearch.addEventListener('input', (e) => {
        const value = String(e.target.value || '');
        const activeTab = String(ctx().state.activeTab || 'home');
        if (activeTab !== 'properties') return;
        if (!els.propKeyword) return;
        els.propKeyword.value = value;
        els.propKeyword.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    const homeBtn = document.getElementById('btnSidebarHome');
    if (homeBtn && homeBtn.dataset.bound !== 'true') {
      homeBtn.dataset.bound = 'true';
      homeBtn.addEventListener('click', () => {
        clickHiddenTab('home');
        mod.syncChromeForTab('home');
      });
    }

    if (els.btnAdminLoginOpen && els.btnAdminLoginOpen.dataset.bound !== 'true') {
      els.btnAdminLoginOpen.dataset.bound = 'true';
      els.btnAdminLoginOpen.addEventListener('click', mod.openLoginModal);
    }

    if (els.btnAdminLogout && els.btnAdminLogout.dataset.bound !== 'true') {
      els.btnAdminLogout.dataset.bound = 'true';
      els.btnAdminLogout.addEventListener('click', () => {
        closeUserMenu();
        mod.logout().catch(() => {});
      });
    }

    const userMenu = document.getElementById('topbarUserMenu');
    const userTrigger = document.getElementById('btnTopbarUserMenu');
    const userDropdown = document.getElementById('topbarUserDropdown');
    const setUserMenuOpen = (open) => {
      if (!userMenu || !userTrigger || !userDropdown) return;
      userMenu.classList.toggle('is-open', !!open);
      userDropdown.classList.toggle('hidden', !open);
      userTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const closeUserMenu = () => setUserMenuOpen(false);
    if (userTrigger && userTrigger.dataset.bound !== 'true') {
      userTrigger.dataset.bound = 'true';
      userTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = !userMenu?.classList.contains('is-open');
        setUserMenuOpen(next);
      });
    }
    if (!window.__KNSN_ADMIN_USERMENU_BOUND__) {
      window.__KNSN_ADMIN_USERMENU_BOUND__ = true;
      document.addEventListener('click', (e) => {
        if (!userMenu) return;
        if (userMenu.contains(e.target)) return;
        closeUserMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeUserMenu();
      });
    }

    if (els.btnAdminLoginClose && els.btnAdminLoginClose.dataset.bound !== 'true') {
      els.btnAdminLoginClose.dataset.bound = 'true';
      els.btnAdminLoginClose.addEventListener('click', mod.closeLoginModal);
    }

    if (els.adminLoginModal && els.adminLoginModal.dataset.bound !== 'true') {
      els.adminLoginModal.dataset.bound = 'true';
      els.adminLoginModal.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.close === 'true') mod.closeLoginModal();
      });
    }

    if (els.adminLoginForm && els.adminLoginForm.dataset.bound !== 'true') {
      els.adminLoginForm.dataset.bound = 'true';
      els.adminLoginForm.addEventListener('submit', (e) => {
        mod.onSubmitAdminLogin(e).catch(() => {});
      });
    }

    if (!window.__KNSN_ADMIN_BADGE_OBSERVER__) {
      const badge = els.adminUserBadge;
      if (badge) {
        window.__KNSN_ADMIN_BADGE_OBSERVER__ = new MutationObserver(() => {
          updateSidebarUserName();
        });
        window.__KNSN_ADMIN_BADGE_OBSERVER__.observe(badge, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    }

    mod.syncChromeForTab(ctx().state.activeTab || 'home');
    updateSidebarUserName();
  };

  mod.renderSessionUI = function renderSessionUI() {
    const { state, els, rt } = ctx();
    const user = state.session?.user;
    const loggedIn = !!(state.session?.token && user);

    els.btnAdminLoginOpen?.classList.toggle('hidden', loggedIn);
    els.btnChangeMyPassword?.classList.toggle('hidden', !loggedIn || !rt.isSupabaseMode?.());
    els.btnAdminLogout?.classList.toggle('hidden', !loggedIn);

    if (!loggedIn) {
      if (els.adminUserBadge) {
        els.adminUserBadge.textContent = '비로그인';
        els.adminUserBadge.className = 'badge badge-muted';
      }
      document.body.classList.remove('role-admin');
      updateSidebarUserName();
      return;
    }

    if (els.adminUserBadge) {
      els.adminUserBadge.textContent = user.name || user.email || '';
      els.adminUserBadge.className = 'badge badge-admin';
    }
    document.body.classList.add('role-admin');
    if (els.summaryPanel) els.summaryPanel.classList.remove('hidden');
    updateSidebarUserName();
  };

  mod.openLoginModal = function openLoginModal() {
    const { utils } = ctx();
    if (typeof utils.goLoginPage === 'function') {
      utils.goLoginPage();
      return;
    }
    window.location.href = './login.html?next=' + encodeURIComponent('./admin-index.html');
  };

  mod.closeLoginModal = function closeLoginModal() {
    const { els, utils } = ctx();
    if (!els.adminLoginModal) return;
    els.adminLoginModal.classList.add('hidden');
    els.adminLoginModal.setAttribute('aria-hidden', 'true');
    if (els.adminLoginForm) els.adminLoginForm.reset();
    if (typeof utils.setModalOpen === 'function') utils.setModalOpen(false);
  };

  mod.onSubmitAdminLogin = async function onSubmitAdminLogin(e) {
    e.preventDefault();
    const { state, els, api, utils } = ctx();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') || '').trim();
    const password = String(fd.get('password') || '');
    if (!name || !password) {
      window.alert('이름/비밀번호를 입력해 주세요.');
      return;
    }

    try {
      if (typeof utils.setFormBusy === 'function') utils.setFormBusy(e.currentTarget, true);
      const res = await api('/auth/login', {
        method: 'POST',
        body: { name, password },
      });

      if (String(res?.user?.role || '').toLowerCase() !== 'admin') {
        throw new Error('관리자 권한 계정만 접속 가능합니다.');
      }

      state.session = { token: res.token, user: res.user };
      if (typeof utils.saveSession === 'function') utils.saveSession(state.session);
      mod.renderSessionUI();
      mod.closeLoginModal();
      if (typeof utils.setGlobalMsg === 'function') utils.setGlobalMsg('');
      if (typeof utils.loadAllCoreData === 'function') await utils.loadAllCoreData();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || '로그인 실패');
    } finally {
      if (typeof utils.setFormBusy === 'function') utils.setFormBusy(e.currentTarget, false);
    }
  };

  mod.logout = async function logout() {
    const { state, K, utils } = ctx();
    try {
      if (K && typeof K.supabaseEnabled === 'function' && K.supabaseEnabled() && K.initSupabase() && typeof K.sbHardSignOut === 'function') {
        await K.sbHardSignOut();
      } else if (K && typeof K.sbSignOut === 'function') {
        await K.sbSignOut();
      }
    } catch {}

    state.session = null;
    if (typeof utils.saveSession === 'function') utils.saveSession(null);
    mod.renderSessionUI();
    state.properties = [];
    state.staff = [];
    if (typeof utils.renderAll === 'function') utils.renderAll();
    if (typeof utils.goLoginPage === 'function') {
      utils.goLoginPage(true);
    } else {
      window.location.href = './login.html?next=' + encodeURIComponent('./admin-index.html') + '&logout=1';
    }
  };

  mod.ensureLoginThenLoad = async function ensureLoginThenLoad() {
    const { state, utils } = ctx();
    if (typeof utils.syncSupabaseSessionIfNeeded === 'function') {
      await utils.syncSupabaseSessionIfNeeded();
    }
    state.session = typeof utils.loadSession === 'function' ? (utils.loadSession() || null) : state.session;
    mod.renderSessionUI();

    const user = state.session?.user;
    const loggedIn = !!(state.session?.token && user);
    if (!loggedIn) {
      mod.openLoginModal();
      return;
    }

    if (String(user.role || '').toLowerCase() !== 'admin') {
      window.location.replace('./agent-index.html');
      return;
    }

    if (typeof utils.loadAllCoreData === 'function') {
      await utils.loadAllCoreData();
    }
  };

  AdminModules.shell = mod;
})();
