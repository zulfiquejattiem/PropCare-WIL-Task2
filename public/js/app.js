/* PropCare Task 2 - SPA that talks to the Express + SQLite API. */
(function () {
  var API = window.PropCareAPI;
  var state = { user: null };

  /* ---------------- helpers ---------------- */
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initials(name) {
    // Names arrive from the API, so guard the same way `esc` does: a null or
    // empty name must render an empty avatar, not throw and blank the screen.
    return String(name == null ? '' : name)
      .split(' ')
      .filter(Boolean)
      .map(function (w) { return w[0]; })
      .slice(0, 2)
      .join('')
      .toLowerCase();
  }

  function statusClass(sid) { return 'st-' + sid; }
  function urgClass(uid) { return 'urg-' + uid; }

  function roleLabel(role) {
    return { tenant: 'Tenant', manager: 'Property Manager', technician: 'Technician', admin: 'Administrator' }[role] || role;
  }

  function statusLabel(sid) {
    return {
      submitted: 'Submitted', 'under-review': 'Under review', assigned: 'Assigned',
      'in-progress': 'In progress', 'on-hold': 'On hold', completed: 'Completed',
      closed: 'Closed', cancelled: 'Cancelled', rejected: 'Rejected'
    }[sid] || sid;
  }

  function openStatuses() {
    return ['submitted', 'under-review', 'assigned', 'in-progress', 'on-hold'];
  }

  function isOpen(r) { return openStatuses().indexOf(r.status) !== -1; }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function badge(statusId) {
    return '<span class="badge ' + statusClass(statusId) + '">' + esc(statusLabel(statusId)) + '</span>';
  }

  function avatarFor(name, cls) {
    cls = cls || '';
    return '<span class="avatar ' + cls + '">' + esc(initials(name)) + '</span>';
  }

  function loadingUI(text) {
    text = text || 'Loading…';
    return '<div class="empty" role="status"><div class="spinner" aria-hidden="true"></div>' +
      '<div class="loading-text">' + esc(text) + '</div></div>';
  }

  function errorUI(msg) {
    return '<div class="error-banner" role="alert"><strong>Something went wrong.</strong> ' +
      esc(msg) + '</div>';
  }

  function emptyUI(big, text) {
    return '<div class="empty"><div class="big">' + big + '</div>' + esc(text) + '</div>';
  }

  function reqRow(r) {
    var sub = esc(r.categoryName || '') + ' &middot; ' + esc(urgName(r.urgency)) + ' urgency &middot; ' +
      esc(r.unit) + ' &middot; updated ' + esc(r.updated);
    if (r.propertyName) sub += ' &middot; ' + esc(r.propertyName);
    return '<div class="request-item" data-id="' + esc(r.id) + '" tabindex="0" role="link" aria-label="Open request ' +
      esc(r.id) + ', ' + esc(r.title) + '">' +
      '<div><div class="r-main">' + esc(r.title) + '</div>' +
      '<div class="r-sub">' + sub + '</div></div>' +
      '<div class="r-right">' + badge(r.status) +
      '<span class="urg ' + urgClass(r.urgency) + '">' + esc(urgName(r.urgency)) + '</span></div></div>';
  }

  function reqRowFor(r) {
    var lines = [];
    lines.push('<span class="trow-main">' + esc(r.id) + ' &middot; ' + esc(r.title) + '</span>');
    lines.push('<div class="trow-sub">' + esc(r.categoryName) + ' &middot; ' + esc(r.propertyName || '') + ' &middot; ' + esc(r.unit) + '</div>');
    return '<td>' + lines.join('') + '</td>' +
      '<td>' + badge(r.status) + '</td>' +
      '<td><span class="' + urgClass(r.urgency) + '" style="font-weight:600">' + esc(urgName(r.urgency)) + '</span></td>' +
      '<td class="trow-sub">' + esc(r.updated) + '</td>';
  }

  function urgName(id) {
    return { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }[id] || id;
  }

  /** Sortable urgency weight: urgent first, low last. */
  function urgencyRank(id) {
    var rank = { urgent: 0, high: 1, normal: 2, low: 3 };
    return rank[id] === undefined ? 9 : rank[id];
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function openCount(list) { return list.filter(isOpen).length; }

  function statCard(num, cap, delta) {
    return '<div class="stat"><div class="num">' + num + '</div><div class="cap">' + cap +
      '</div><div class="stat-note">' + delta + '</div></div>';
  }

  /* ---------------- navigation config ---------------- */
  var NAV = {
    tenant: [
      { key: 'overview', label: 'Overview', ico: '\uD83C\uDFE0', href: '#/overview' },
      { key: 'requests', label: 'My requests', ico: '\uD83D\uDD27', href: '#/requests' },
      { key: 'properties', label: 'My property', ico: '\uD83C\uDFE2', href: '#/properties' },
      { key: 'notifications', label: 'Notifications', ico: '\uD83D\uDD14', href: '#/notifications' },
      { key: 'mockups', label: 'Design reference', ico: '\uD83D\uDDBC\uFE0F', href: '#/mockups' }
    ],
    manager: [
      { key: 'overview', label: 'Overview', ico: '\uD83C\uDFE0', href: '#/overview' },
      { key: 'requests', label: 'Requests', ico: '\uD83D\uDD27', href: '#/requests' },
      { key: 'properties', label: 'Properties', ico: '\uD83C\uDFE2', href: '#/properties' },
      { key: 'tenants', label: 'Tenants', ico: '\uD83D\uDC65', href: '#/tenants' },
      { key: 'technicians', label: 'Technicians', ico: '\uD83E\uDDD1\u200D\uD83D\uDD27', href: '#/technicians' },
      { key: 'reports', label: 'Reports', ico: '\uD83D\uDCCA', href: '#/reports' },
      { key: 'notifications', label: 'Notifications', ico: '\uD83D\uDD14', href: '#/notifications' },
      { key: 'mockups', label: 'Design reference', ico: '\uD83D\uDDBC\uFE0F', href: '#/mockups' }
    ],
    technician: [
      { key: 'jobs', label: 'Jobs', ico: '\uD83D\uDD27', href: '#/jobs' },
      { key: 'schedule', label: 'Schedule', ico: '\uD83D\uDCC5', href: '#/schedule' },
      { key: 'completed', label: 'Completed', ico: '\u2705', href: '#/completed' },
      { key: 'notifications', label: 'Notifications', ico: '\uD83D\uDD14', href: '#/notifications' },
      { key: 'mockups', label: 'Design reference', ico: '\uD83D\uDDBC\uFE0F', href: '#/mockups' }
    ],
    admin: [
      { key: 'overview', label: 'Overview', ico: '\uD83C\uDFE0', href: '#/overview' },
      { key: 'users', label: 'Users', ico: '\uD83D\uDC64', href: '#/users' },
      { key: 'properties', label: 'Properties', ico: '\uD83C\uDFE2', href: '#/properties' },
      { key: 'categories', label: 'Categories', ico: '\uD83D\uDCD6', href: '#/categories' },
      { key: 'roles', label: 'Roles', ico: '\uD83D\uDD11', href: '#/roles' },
      { key: 'reports', label: 'Reports', ico: '\uD83D\uDCCA', href: '#/reports' },
      { key: 'settings', label: 'Settings', ico: '\u2699\uFE0F', href: '#/settings' },
      { key: 'notifications', label: 'Notifications', ico: '\uD83D\uDD14', href: '#/notifications' },
      { key: 'mockups', label: 'Design reference', ico: '\uD83D\uDDBC\uFE0F', href: '#/mockups' }
    ]
  };

  function activeKey() {
    var hash = location.hash.replace(/^#\/?/, '');
    var seg = hash.split('?')[0].split('/')[0];
    return seg || 'overview';
  }

  function renderNav() {
    var user = state.user;
    var items = NAV[user.role];
    var active = activeKey();
    var nav = document.getElementById('topNav');
    var mobile = document.getElementById('bottomNav');
    function link(n, prefix) {
      var on = n.key === active ? ' active' : '';
      if (prefix === 'top') return '<a href="' + n.href + '" data-nav="' + n.key + '" class="' + on + '">' + n.label + '</a>';
      return '<a href="' + n.href + '" data-nav="' + n.key + '" class="' + on + '">' +
        '<span class="bn-ico">' + n.ico + '</span><span>' + n.label + '</span></a>';
    }
    nav.innerHTML = items.map(function (n) { return link(n, 'top'); }).join('');
    mobile.innerHTML = items.map(function (n) { return link(n, 'mobile'); }).join('');
  }

  function renderShell() {
    var user = state.user;
    document.getElementById('userName').textContent = user.name;
    var av = document.getElementById('userAvatar');
    av.textContent = initials(user.name);
    av.className = 'avatar role-' + user.role;
    document.getElementById('userAvatar').setAttribute('aria-label', user.name);
    renderNav();
    var bc = document.getElementById('breadcrumb');
    var seg = activeKey();
    var label = '';
    var items = NAV[user.role];
    for (var i = 0; i < items.length; i++) if (items[i].key === seg) label = items[i].label;
    if (seg === 'request') label = 'Request detail';
    if (seg === 'job') label = 'Job detail';
    if (seg === 'report') label = 'Report an issue';
    bc.innerHTML = 'Horizon Property Group &rsaquo; <b>' + esc(roleLabel(user.role)) + '</b>' +
      (label ? ' &rsaquo; ' + esc(label) : '');
  }

  function setUser(user) {
    state.user = user;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    renderShell();
    route();
  }

  function showLogin() {
    state.user = null;
    API.clearSession();
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('loginPassword').focus();
  }

  /* ---------------- modal (accessible) ---------------- */
  var lastFocus = null;

  function openModal(html, title) {
    var box = document.getElementById('modalBox');
    lastFocus = document.activeElement;
    box.innerHTML = html;
    document.getElementById('modalBackdrop').classList.remove('hidden');
    // Manage focus: move to the modal heading if present, else the first control.
    var modal = box.closest('.modal');
    var heading = box.querySelector('h2') || box.querySelector('h3');
    if (heading) heading.setAttribute('tabindex', '-1');
    if (heading) heading.focus();
    else {
      var first = box.querySelector('input, select, textarea, button');
      if (first) first.focus();
    }
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    document.getElementById('modalBackdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function wireModalClose(scope) {
    (scope || document).querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', closeModal);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.getElementById('modalBackdrop').classList.contains('hidden')) {
      closeModal();
    }
  });

  document.getElementById('modalBackdrop').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  /* ---------------- shared async fetch wrapper ---------------- */
  function load(path) { return API.get(path).then(function (d) { return d.data; }); }

  var _urlCache = {};
  function fetchOnce(path) {
    _urlCache[path] = _urlCache[path] || API.get(path).then(function (d) { return d.data; });
    return _urlCache[path];
  }

  /* ---------------- screens ---------------- */
  var body = function () { return document.getElementById('appBody'); };

  function render(data) { body().innerHTML = data; }

  function failUI(err) { render(errorUI(err.message || 'Please try again.')); }

  /* ============ OVERVIEW ============ */
  async function screenOverview() {
    var u = state.user;
    if (u.role === 'tenant') return tenantOverview();
    if (u.role === 'manager') return managerOverview();
    if (u.role === 'technician') return techOverview();
    return adminOverview();
  }

  async function tenantOverview() {
    render(loadingUI('Loading your overview…'));
    try {
      var buzz = await fetchOnce('/api/requests');
      var props = await fetchOnce('/api/properties');
      var reqs = buzz.requests;
      var open = reqs.filter(isOpen);
      var need = open.filter(function (r) { return r.urgency === 'high' || r.urgency === 'urgent'; }).length;
      var recent = reqs.slice(0, 4);
      var today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      var name = state.user.name.split(' ')[0];
      var units = state.user.units || [];
      var cats = props.properties.length ? '' : '';
      render(
        '<div class="hero"><h1>Good ' + (new Date().getHours() < 12 ? 'morning' : 'afternoon') + ', ' + esc(name) + '</h1>' +
        '<p>' + today + ' &middot; Keep an eye on your home. We will keep you updated.</p></div>' +
        '<div class="grid stat-grid">' +
        statCard(open.length, 'Open requests', need + ' need priority attention') +
        statCard(reqs.filter(function (r) { return r.status === 'completed' || r.status === 'closed'; }).length, 'Resolved', 'across your units') +
        statCard(units.length, 'Your units', 'across the portfolio') +
        statCard('1.8h', 'Average response', 'operational rhythm') +
        '</div>' +
        '<div class="grid two-col">' +
        '<div class="card"><h3 class="card-title">Recent requests <small>' + open.length + ' open</small></h3>' +
        '<div class="req-list">' + (recent.map(reqRow).join('') || '<p style="color:var(--muted)">No requests yet.</p>') + '</div>' +
        '<button type="button" class="btn btn-accent btn-block" style="margin-top:14px" data-go="#/report">+ Report an issue</button></div>' +
        '<div>' +
        '<div class="card" style="margin-bottom:16px"><h3 class="card-title">My properties</h3>' +
        (props.properties.map(function (p) {
          return '<div class="request-item" data-static="1" style="cursor:default"><span class="n-ico">\uD83C\uDFE2</span><div><div class="r-main">' + esc(p.name) + '</div><div class="r-sub">' + esc(p.area) + '</div></div></div>';
        }).join('')) +
        '</div>' +
        '<div class="card"><h3 class="card-title">Quick actions</h3>' +
        '<p style="font-size:12.5px;color:var(--muted);margin-top:2px">' +
        '<br>Units: ' + units.map(function (u) { return esc(u.name); }).join(', ') +
        '</p></div>' +
        '</div></div>');
    } catch (e) { failUI(e); }
  }

  async function managerOverview() {
    render(loadingUI('Loading your portfolio…'));
    try {
      var buzz = await fetchOnce('/api/requests');
      var props = await fetchOnce('/api/properties');
      var rep = null;
      try { rep = (await fetchOnce('/api/reports/summary')).summary; } catch (e) { /* optional */ }
      var reqs = buzz.requests;
      var open = reqs.filter(isOpen);
      var urgent = open.filter(function (r) { return r.urgency === 'urgent' || r.urgency === 'high'; }).length;
      var queue = reqs.slice().sort(function (a, b) {
        return urgencyRank(a.urgency) - urgencyRank(b.urgency);
      });
      var name = state.user.name.split(' ')[0];
      render(
        '<div class="hero"><h1>Good morning, ' + esc(name) + '</h1><p>Your managed portfolio &middot; ' +
        props.properties.length + ' properties &middot; ' + open.length + ' open maintenance requests.</p></div>' +
        '<div class="grid stat-grid">' +
        statCard(props.properties.length, 'Properties managed', 'across Cape Town') +
        statCard(open.length, 'Open requests', urgent + ' need priority attention') +
        statCard((rep ? rep.resolved : '—'), 'Resolved', 'portfolio total') +
        statCard('1.8h', 'Avg response', 'operational rhythm') +
        '</div>' +
        '<div class="card"><h3 class="card-title">Priority queue</h3><div class="table-wrap"><table><thead><tr>' +
        '<th>Request</th><th>Status</th><th>Priority</th><th>Updated</th></tr></thead><tbody>' +
        queue.slice(0, 6).map(function (r) { return '<tr class="clickable" data-go="#/request/' + esc(r.id) + '" tabindex="0" role="link" aria-label="Open request ' + esc(r.id) + '">' + reqRowFor(r) + '</tr>'; }).join('') +
        '</tbody></table></div>' +
        '<button type="button" class="btn btn-ghost" style="margin-top:14px" data-go="#/requests">View all requests</button></div>');
    } catch (e) { failUI(e); }
  }

  async function techOverview() {
    render(loadingUI('Loading your jobs…'));
    try {
      var buzz = await fetchOnce('/api/requests');
      var reqs = buzz.requests;
      var jobs = reqs.filter(isOpen);
      var done = reqs.filter(function (r) { return r.status === 'completed' || r.status === 'closed'; });
      var today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      render(
        '<div class="hero"><h1>Good morning, ' + esc(state.user.name.split(' ')[0]) + '</h1><p>Today &middot; ' + today + ' &middot; ' +
        jobs.length + ' active job(s) in your queue.</p></div>' +
        '<div class="grid stat-grid">' +
        statCard(jobs.length, 'Active jobs', 'assigned to you') +
        statCard(done.length, 'Completed this month', 'work verified') +
        statCard('1.8h', 'Avg response', 'portfolio-wide') +
        statCard('0', 'Overdue', 'on service plan') +
        '</div>' +
        '<div class="card"><h3 class="card-title">Assigned jobs</h3><div class="req-list">' +
        (jobs.map(reqRow).join('') || emptyUI('\uD83C\uDFAF', 'You have no active jobs right now.')) +
        '</div></div>');
    } catch (e) { failUI(e); }
  }

  async function adminOverview() {
    render(loadingUI('Loading system overview…'));
    try {
      var buzz = await fetchOnce('/api/requests');
      var rep = (await fetchOnce('/api/reports/summary')).summary;
      var reqs = buzz.requests;
      var open = reqs.filter(isOpen);
      var cats = rep.byCategory || [];
      var statuses = rep.byStatus || [];
      render(
        '<div class="hero"><h1>System overview</h1><p>Obs Realty Group &middot; Horizon portfolio &middot; all tenants, properties, technicians and requests.</p></div>' +
        '<div class="grid stat-grid">' +
        statCard(rep.users.tenants, 'Tenants', 'across the portfolio') +
        statCard(rep.properties, 'Properties', rep.units + ' active units') +
        statCard(rep.users.technicians, 'Technicians', 'on service plan') +
        statCard(open.length, 'Open requests', 'across all properties') +
        '</div>' +
        '<div class="grid three-col">' +
        '<div class="card"><h3 class="card-title">By category</h3>' +
        (cats.map(function (c) { return '<div class="inline-stat"><span>' + esc(c.name) + '</span><b>' + c.count + '</b></div>'; }).join('') || 'No data') +
        '</div>' +
        '<div class="card"><h3 class="card-title">By status</h3>' +
        (statuses.map(function (s) { return '<div class="inline-stat"><span>' + esc(statusLabel(s.status)) + '</span><b>' + s.count + '</b></div>'; }).join('') || 'No data') +
        '</div>' +
        '<div class="card"><h3 class="card-title">Latest activity</h3><div class="notif">' +
        reqs.slice(0, 5).map(function (r) {
          return '<div class="n-title">' + esc(r.id) + ' &middot; ' + esc(r.title) + '</div><div class="n-when">' + esc(r.updated) + '</div>';
        }).join('') + '</div></div></div>');
    } catch (e) { failUI(e); }
  }

  /* ============ REQUESTS LIST ============ */
  async function screenRequests() {
    render(loadingUI('Loading requests…'));
    var u = state.user;
    var qs = location.hash.split('?')[1] || '';
    var statusFilter = (qs.match(/status=([\w-]+)/) || [])[1] || 'all';
    var search = (qs.match(/q=([^&]+)/) || [])[1] || '';
    try {
      // Status is filtered by the API (correct on large lists); the free-text
      // search stays client-side so results appear as you type.
      var query = [];
      if (statusFilter !== 'all') query.push('status=' + encodeURIComponent(statusFilter));
      var url = '/api/requests' + (query.length ? '?' + query.join('&') : '');
      var data = await load(url);
      var list = data.requests;
      if (search) {
        search = decodeURIComponent(search).toLowerCase();
        list = list.filter(function (r) {
          return (r.title + ' ' + r.id + ' ' + (r.categoryName || '') + ' ' + r.unit).toLowerCase().indexOf(search) !== -1;
        });
      }
      var statuses = ['all'].concat(openStatuses().concat(['completed', 'closed', 'cancelled', 'rejected']));
      var chips = statuses.map(function (s) {
        return '<span class="chip' + (statusFilter === s ? ' active' : '') + '" data-filter="' + s + '" tabindex="0" role="button" aria-pressed="' + (statusFilter === s) + '">' +
          (s === 'all' ? 'All statuses' : esc(statusLabel(s))) + '</span>';
      }).join('');
      render(
        '<div class="card" style="margin-bottom:16px">' +
        '<h3 class="card-title">' + (u.role === 'manager' ? 'Maintenance queue' : 'My requests') +
        '<small>' + list.length + ' visible</small></h3>' +
        '<label class="visually-hidden" for="reqSearch">Search requests</label>' +
        '<input class="field" id="reqSearch" type="search" placeholder="Search requests" value="' + esc(search) + '">' +
        '<div class="category-row" style="margin-top:12px">' + chips + '</div></div>' +
        '<div class="req-list">' +
        (list.map(reqRow).join('') || '<div class="empty"><div class="big">\uD83D\uDD27</div>No requests match your search.</div>') +
        '</div>');
      bindListControls(search, statusFilter);
      restoreSearchFocus();
    } catch (e) { failUI(e); }
  }

  /**
   * Typing in the search box rewrites the hash, which re-renders the screen and
   * destroys the focused input. Remember the caret and put it back so a user can
   * type a whole phrase without re-clicking the field.
   */
  var searchCaret = null;

  function restoreSearchFocus() {
    if (!searchCaret) return;
    var inp = document.getElementById('reqSearch');
    if (!inp) return;
    inp.focus();
    try { inp.setSelectionRange(searchCaret.start, searchCaret.end); } catch (e) { /* older browsers */ }
  }

  function bindListControls(search, statusFilter) {
    var inp = document.getElementById('reqSearch');
    if (inp) {
      inp.addEventListener('input', function () {
        var value = inp.value;
        searchCaret = { start: inp.selectionStart, end: inp.selectionEnd };
        clearTimeout(inp._debounce);
        // Debounced so a fast typist triggers one navigation, not one per key.
        inp._debounce = setTimeout(function () {
          var parts = [];
          if (statusFilter && statusFilter !== 'all') parts.push('status=' + statusFilter);
          if (value) parts.push('q=' + encodeURIComponent(value));
          location.hash = '#/requests' + (parts.length ? '?' + parts.join('&') : '');
        }, 300);
      });
    }
    body().querySelectorAll('.chip[data-filter]').forEach(function (c) {
      c.addEventListener('click', function () {
        location.hash = '#/requests?status=' + c.getAttribute('data-filter');
      });
    });
  }

  /* ============ REQUEST DETAIL ============ */
  async function screenRequest(id) {
    render(loadingUI('Loading request…'));
    try {
      var d = (await API.get('/api/requests/' + encodeURIComponent(id))).data.request;
      renderRequestDetail(d);
    } catch (e) { failUI(e); }
  }

  function renderRequestDetail(req) {
    var u = state.user;
    var role = u.role;
    var hist = (req.history || []).slice();
    if (!hist.length) hist = [{ status: 'Submitted', when: req.created + ' 09:00' }];
    var notes = (req.comments || []).slice().reverse();

    var actions = '';
    if (role === 'tenant') {
      if (req.status === 'submitted' || req.status === 'under-review') {
        actions = '<button type="button" class="btn btn-danger" data-act="cancel">Cancel request</button>';
      }
      if (req.status === 'completed') {
        actions = '<button type="button" class="btn btn-success" data-act="confirm">Confirm resolved &amp; close</button>' +
          '<button type="button" class="btn btn-ghost" data-act="reopen">Not resolved &mdash; reopen</button>' +
          '<button type="button" class="btn btn-teal" data-act="rate">Rate technician</button>';
      }
      if (req.status === 'closed') {
        actions = '<span class="badge st-closed">Closed &middot; thanks for confirming</span>' +
          (req.rating ? '<span class="badge st-assigned">Your rating: ' + '&#9733;'.repeat(req.rating) + '</span>' : '');
      }
      if (req.status === 'cancelled' || req.status === 'rejected') {
        actions = '<span class="badge st-cancelled">' + esc(statusLabel(req.status)) + '</span>';
      }
    }
    if (role === 'manager') {
      if (req.status === 'submitted' || req.status === 'under-review') {
        actions = '<button type="button" class="btn btn-accent" data-act="assign">Review &amp; assign technician</button>' +
          '<button type="button" class="btn btn-danger" data-act="cancel">Reject / cancel</button>';
      }
      if (req.status === 'completed') {
        actions = '<button type="button" class="btn btn-success" data-act="approve">Approve &amp; close</button>';
      }
    }
    if (role === 'technician') {
      if (req.status === 'assigned') {
        actions = '<button type="button" class="btn btn-success" data-act="accept">Accept job</button>' +
          '<button type="button" class="btn btn-danger" data-act="reject">Reject job</button>';
      }
      if (req.status === 'in-progress') {
        actions = '<button type="button" class="btn btn-ghost" data-act="hold">Place on hold</button>' +
          '<button type="button" class="btn btn-accent" data-act="note">Add work note</button>' +
          '<button type="button" class="btn btn-success" data-act="complete">Mark complete</button>';
      }
      if (req.status === 'on-hold') {
        actions = '<button type="button" class="btn btn-success" data-act="resume">Resume work</button>';
      }
    }

    var photoTiles = '';
    for (var i = 0; i < (req.photos || 0); i++) photoTiles += '<span class="photo-tile">\uD83D\uDDBC\uFE0F</span>';

    render(
      '<div class="grid two-col">' +
      '<div class="card">' +
      '<h3 class="card-title">' + esc(req.id) + ' <small>' + badge(req.status) + '</small></h3>' +
      '<h2 style="margin:0 0 6px">' + esc(req.title) + '</h2>' +
      '<p style="color:var(--muted)">' + esc(req.propertyName) + ' &middot; ' + esc(req.unit) +
      (req.tenantName ? ' &middot; Reported by ' + esc(req.tenantName) : '') +
      (req.technicianName ? ' &middot; Technician: ' + esc(req.technicianName) : '') + '</p>' +
      '<p>' + esc(req.detail) + '</p>' +
      '<div class="category-row" style="margin:10px 0">' +
      '<span class="chip chip-teal">' + esc(req.categoryName) + '</span>' +
      '<span class="chip ' + urgClass(req.urgency) + '">' + esc(urgName(req.urgency)) + ' urgency</span></div>' +
      '<h3 class="card-title" style="margin-top:16px">Photos</h3>' +
      (photoTiles || '<p style="color:var(--muted);font-size:13px">No photos attached.</p>') +
      ((role === 'technician' || role === 'tenant' || role === 'manager') ?
        '<div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="upload">+ Upload photo</button></div>' : '') +
      '<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">' + actions + '</div></div>' +
      '<div>' +
      '<div class="card" style="margin-bottom:16px"><h3 class="card-title">Status history</h3><ul class="timeline">' +
      hist.map(function (h) { return '<li><b>' + esc(h.status) + '</b><div class="t-when">' + esc(h.when) + '</div></li>'; }).join('') +
      '</ul></div>' +
      '<div class="card"><h3 class="card-title">Conversation</h3>' +
      notes.map(function (c) {
        return '<div class="comment"><span class="avatar">' + esc(initials(c.by)) + '</span><div class="c-body">' +
          '<div class="c-who">' + esc(c.by) + ' <span>&middot; ' + esc(c.role) + '</span><span class="c-when">' + esc(c.when) + '</span></div>' +
          '<div class="c-text">' + esc(c.text) + '</div></div></div>';
      }).join('') +
      '<div style="margin-top:10px"><label class="visually-hidden" for="newComment">Add a comment</label>' +
      '<textarea class="field" id="newComment" placeholder="Add a comment..."></textarea>' +
      '<button type="button" class="btn btn-accent btn-sm" style="margin-top:8px" data-act="comment">Post comment</button></div></div>' +
      '</div></div>');

    body().querySelectorAll('[data-go]').forEach(function (e) {
      e.addEventListener('click', function () { location.hash = e.getAttribute('data-go'); });
    });
    body().querySelectorAll('[data-act]').forEach(function (e) {
      e.addEventListener('click', function () { handleRequestAction(e.getAttribute('data-act'), req); });
    });
  }

  async function mutation(path, method, payload, successMsg) {
    var btn;
    var active = document.activeElement;
    if (active && active.classList && active.classList.contains('btn')) {
      btn = active;
      btn.disabled = true;
      originalBtnText = btn.textContent;
      btn.textContent = 'Working…';
    }
    try {
      var res = method === 'post' ? await API.post(path, payload) : await API.put(path, payload);
      toast(successMsg || (res && res.message) || 'Saved.');
      if (btn) { btn.disabled = false; btn.textContent = originalBtnText; }
      return res.data.request;
    } catch (e) {
      toast(e.message || 'Action failed.');
      if (btn) { btn.disabled = false; btn.textContent = originalBtnText; }
      throw e;
    }
  }
  var originalBtnText = '';

  async function performAction(act, req, opts) {
    opts = opts || {};
    switch (act) {
      case 'cancel': return mutation('/api/requests/' + req.id + '/status', 'post', { action: 'cancel' }, req.id + ' cancelled.');
      case 'confirm': return mutation('/api/requests/' + req.id + '/status', 'post', { action: 'confirm' }, 'Thanks! ' + req.id + ' is now closed.');
      case 'reopen': return mutation('/api/requests/' + req.id + '/status', 'post', { action: 'reopen' }, 'Request reopened.');
      case 'approve': return mutation('/api/requests/' + req.id + '/status', 'post', { action: 'approve' }, req.id + ' approved and closed.');
      case 'accept': return mutation('/api/requests/' + req.id + '/status', 'post', { action: 'accept' }, 'Job accepted.');
      case 'hold': return mutation('/api/requests/' + req.id + '/status', 'post', { action: 'hold' }, 'Job on hold.');
      case 'resume': return mutation('/api/requests/' + req.id + '/status', 'post', { action: 'resume' }, 'Work resumed.');
      case 'comment': {
        var c = document.getElementById('newComment').value.trim();
        if (!c) { toast('Write a comment first.'); return; }
        return mutation('/api/requests/' + req.id + '/comments', 'post', { text: c }, 'Comment posted.');
      }
      case 'upload': return mutation('/api/requests/' + req.id + '/photos', 'post', {}, 'Photo uploaded.');
      default: return null;
    }
  }

  function handleRequestAction(act, req) {
    function refresh(data) {
      if (data) renderRequestDetail(data);
      else route();
    }
    if (act === 'cancel') {
      confirmModal('Cancel this request?', 'Request ' + req.id, function () {
        performAction('cancel', req).then(refresh).catch(function () {});
      }, 'danger');
    } else if (act === 'confirm') {
      confirmModal('Confirm the work is resolved?', 'Request ' + req.id + ': ' + req.title, function () {
        performAction('confirm', req).then(refresh).catch(function () {});
      });
    } else if (act === 'reopen') {
      confirmModal('Reopen this request?', 'You will be asked for a bit more detail from the technician.', function () {
        performAction('reopen', req).then(refresh).catch(function () {});
      });
    } else if (act === 'approve') {
      confirmModal('Approve and close this request?', 'Request ' + req.id + ': ' + req.title, function () {
        performAction('approve', req).then(refresh).catch(function () {});
      });
    } else if (act === 'accept') {
      confirmModal('Accept this job?', 'You will take ownership of ' + req.id + '.', function () {
        performAction('accept', req).then(refresh).catch(function () {});
      });
    } else if (act === 'hold') {
      confirmModal('Place this job on hold?', 'Awaiting parts or access for ' + req.id + '.', function () {
        performAction('hold', req).then(refresh).catch(function () {});
      });
    } else if (act === 'resume') {
      confirmModal('Resume work on this job?', req.id, function () {
        performAction('resume', req).then(refresh).catch(function () {});
      });
    } else if (act === 'reject') rejectModal(req, refresh);
    else if (act === 'complete') completeModal(req, refresh);
    else if (act === 'rate') rateModal(req, refresh);
    else if (act === 'assign') assignModal(req, refresh);
    else if (act === 'note') noteModal(req, refresh);
    else performAction(act, req).then(refresh).catch(function () {});
  }

  function confirmModal(title, detail, fn, variant) {
    openModal('<h2 id="modalTitle">' + esc(title) + '</h2><p>' + esc(detail) + '</p>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">Cancel</button>' +
      '<button type="button" class="btn ' + (variant === 'danger' ? 'btn-danger' : 'btn-accent') + '" data-confirm="1">Confirm</button></div>');
    document.querySelector('#modalBox [data-confirm]').addEventListener('click', function () { closeModal(); fn(); });
    wireModalClose();
  }

  function assignModal(req, refresh) {
    loadingUI('');
    load('/api/technicians').then(function (d) {
      var opts = d.technicians.map(function (t) {
        return '<option value="' + t.id + '"' + (t.skill === req.categoryName ? ' selected' : '') + '>' + esc(t.name) + ' (' + esc(t.skill) + ')</option>';
      }).join('');
      openModal('<h2 id="modalTitle">Review &amp; assign technician</h2>' +
        '<p>Review request <b>' + esc(req.id) + '</b> and assign it to a technician.</p>' +
        '<label class="field-label" for="assignTech">Technician</label><select class="field" id="assignTech">' + opts + '</select>' +
        '<label class="field-label" for="assignUrg">Priority</label><select class="field" id="assignUrg">' +
        ['low', 'normal', 'high', 'urgent'].map(function (u) {
          return '<option value="' + u + '"' + (u === req.urgency ? ' selected' : '') + '>' + urgName(u) + '</option>';
        }).join('') +
        '</select>' +
        '<label class="field-label" for="assignNote">Note (optional)</label><textarea class="field" id="assignNote" placeholder="Instruction to the technician..."></textarea>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">Cancel</button>' +
        '<button type="button" class="btn btn-accent" id="assignOk">Assign technician</button></div>');
      document.getElementById('assignOk').addEventListener('click', function () {
        var b = this;
        b.disabled = true;
        var t = document.getElementById('assignTech').value;
        var u = document.getElementById('assignUrg').value;
        var note = document.getElementById('assignNote').value.trim();
        API.post('/api/requests/' + req.id + '/assign', { technicianId: t, urgency: u, note: note })
          .then(function (res) {
            toast('Assigned to ' + (res.data.request.technicianName || 'technician') + '.');
            closeModal();
            refresh(res.data.request);
          })
          .catch(function (e) { toast(e.message || 'Assignment failed.'); b.disabled = false; });
      });
      wireModalClose();
    }).catch(function (e) { toast(e.message); });
  }

  function rejectModal(req, refresh) {
    openModal('<h2 id="modalTitle">Reject job</h2><p>Tell the property manager why you are rejecting <b>' + esc(req.id) + '</b>.</p>' +
      '<label class="visually-hidden" for="rejectReason">Reason</label>' +
      '<textarea class="field" id="rejectReason" placeholder="Reason (e.g. outside my trade, parts unavailable)"></textarea>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">Cancel</button>' +
      '<button type="button" class="btn btn-danger" id="rejectOk">Reject job</button></div>');
    document.getElementById('rejectOk').addEventListener('click', function () {
      var b = this;
      b.disabled = true;
      var why = document.getElementById('rejectReason').value.trim() || 'Job rejected by technician.';
      API.post('/api/requests/' + req.id + '/status', { action: 'reject', text: why })
        .then(function (res) { toast('Job rejected.'); closeModal(); refresh(res.data.request); })
        .catch(function (e) { toast(e.message || 'Could not reject.'); b.disabled = false; });
    });
    wireModalClose();
  }

  function completeModal(req, refresh) {
    openModal('<h2 id="modalTitle">Mark job complete</h2><p>Summarise the work done on <b>' + esc(req.id) + '</b>.</p>' +
      '<label class="visually-hidden" for="completeNote">Work summary</label>' +
      '<textarea class="field" id="completeNote" placeholder="Work completed summary..."></textarea>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">Cancel</button>' +
      '<button type="button" class="btn btn-success" id="completeOk">Mark complete</button></div>');
    document.getElementById('completeOk').addEventListener('click', function () {
      var b = this;
      b.disabled = true;
      var note = document.getElementById('completeNote').value.trim() || 'Work completed by technician.';
      API.post('/api/requests/' + req.id + '/status', { action: 'complete', text: note })
        .then(function (res) {
          // Attach an after photo like in production flow.
          return API.post('/api/requests/' + req.id + '/photos', {}).then(function () { return res; });
        })
        .then(function (res) {
          toast(req.id + ' marked complete - awaiting tenant confirmation.');
          closeModal();
          refresh(res.data.request);
        })
        .catch(function (e) { toast(e.message || 'Could not complete.'); b.disabled = false; });
    });
    wireModalClose();
  }

  function rateModal(req, refresh) {
    openModal('<h2 id="modalTitle">Rate the completed work</h2><p>How was the service from <b>' + esc(req.technicianName || 'the technician') + '</b>?</p>' +
      '<div style="font-size:30px;letter-spacing:6px;text-align:center" id="stars" role="radiogroup" aria-label="Rating stars">' +
      '<button type="button" class="star" aria-label="1 star" data-s="1">\u2606</button>' +
      '<button type="button" class="star" aria-label="2 stars" data-s="2">\u2606</button>' +
      '<button type="button" class="star" aria-label="3 stars" data-s="3">\u2606</button>' +
      '<button type="button" class="star" aria-label="4 stars" data-s="4">\u2606</button>' +
      '<button type="button" class="star" aria-label="5 stars" data-s="5">\u2606</button></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">Close</button>' +
      '<button type="button" class="btn btn-accent" id="rateOk">Submit rating</button></div>');
    var stars = 0;
    document.getElementById('stars').addEventListener('click', function (e) {
      var s = e.target.getAttribute('data-s');
      if (!s) return;
      stars = +s;
      document.querySelectorAll('#stars .star').forEach(function (b) {
        b.textContent = (+b.getAttribute('data-s') <= stars) ? '\u2605' : '\u2606';
      });
    });
    document.getElementById('rateOk').addEventListener('click', function () {
      if (!stars) return toast('Select a star rating first.');
      var b = this;
      b.disabled = true;
      API.post('/api/requests/' + req.id + '/rate', { stars: stars })
        .then(function (res) { toast('Thank you! Rating recorded.'); closeModal(); refresh(res.data.request); })
        .catch(function (e) { toast(e.message || 'Could not submit rating.'); b.disabled = false; });
    });
    wireModalClose();
  }

  function noteModal(req, refresh) {
    openModal('<h2 id="modalTitle">Add work note</h2>' +
      '<label class="visually-hidden" for="noteText">Work note</label>' +
      '<textarea class="field" id="noteText" placeholder="Work note..."></textarea>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="noteOk">Save note</button></div>');
    document.getElementById('noteOk').addEventListener('click', function () {
      var t = document.getElementById('noteText').value.trim();
      if (!t) return toast('Note cannot be empty.');
      var b = this;
      b.disabled = true;
      API.post('/api/requests/' + req.id + '/comments', { text: t })
        .then(function (res) { toast('Work note added.'); closeModal(); refresh(res.data.request); })
        .catch(function (e) { toast(e.message || 'Could not save note.'); b.disabled = false; });
    });
    wireModalClose();
  }

  /* ============ REPORT ISSUE WIZARD ============ */
  var reportState = { step: 1, cat: null, urg: 'normal', photos: 0, title: '', detail: '', unit: '' };

  async function screenReport() {
    render(loadingUI('Preparing the report form…'));
    try {
      var d = await load('/api/categories');
      CATS = d.categories;
      if (!reportState.cat && d.categories.length) reportState.cat = d.categories[0].id;
      renderReportStep();
    } catch (e) { failUI(e); }
  }
  var CATS = [];

  function renderReportStep() {
    var s = reportState;
    var steps = '';
    for (var i = 1; i <= 4; i++) {
      steps += '<div class="step' + (i <= s.step ? (i === s.step ? ' active' : ' done') : '') + '"></div>';
    }
    var ui = '';
    if (s.step === 1) {
      ui = '<div class="card"><h3 class="card-title">What needs attention?</h3><div class="category-row">' +
        CATS.map(function (c) { return '<span class="chip' + (s.cat === c.id ? ' active' : '') + '" data-cat="' + c.id + '" tabindex="0" role="button" aria-pressed="' + (s.cat === c.id) + '">' + esc(c.name) + '</span>'; }).join('') +
        '</div></div>';
    } else if (s.step === 2) {
      ui = '<div class="card"><h3 class="card-title">How urgent is it?</h3><div class="urg-options">' +
        ['low', 'normal', 'high', 'urgent'].map(function (u) {
          return '<div class="urg-opt' + (s.urg === u ? ' active' : '') + '" data-urg="' + u + '" tabindex="0" role="radio" aria-checked="' + (s.urg === u) + '"><b>' + urgName(u) + '</b><small>' +
            ({ low: 'Can wait', normal: 'Soon', high: 'This week', urgent: 'Immediately' })[u] + '</small></div>';
        }).join('') +
        '</div></div>';
    } else if (s.step === 3) {
      var unitOpts = (state.user.units || [{ name: 'My unit' }]).map(function (u) {
        return '<option' + (s.unit === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>';
      }).join('');
      ui = '<div class="card"><h3 class="card-title">Describe the issue</h3>' +
        '<label class="field-label" for="repTitle">Short title</label><input class="field" id="repTitle" placeholder="e.g. Kitchen sink leaking" value="' + esc(s.title) + '">' +
        '<label class="field-label" for="repDetail">Details</label><textarea class="field" id="repDetail" placeholder="What is happening and since when?">' + esc(s.detail) + '</textarea>' +
        '<label class="field-label" for="repUnit">Unit</label><select class="field" id="repUnit">' + unitOpts + '</select>' +
        '<label class="field-label">Photos (' + s.photos + ')</label>' +
        '<div><button type="button" class="btn btn-ghost btn-sm" id="addPhoto">+ Add photo</button></div></div>';
    }

    render(
      '<div class="card" style="margin-bottom:16px"><h3 class="card-title">Report an issue <small>Step ' + Math.min(s.step, 4) + ' of 4</small></h3>' +
      '<div class="steps" aria-hidden="true">' + steps + '</div></div>' + ui +
      (s.step < 4 ? '<div style="margin-top:14px;display:flex;gap:10px">' +
        (s.step > 1 ? '<button type="button" class="btn btn-ghost" id="prevStep">Back</button>' : '') +
        '<button type="button" class="btn btn-accent" id="nextStep">' + (s.step === 3 ? 'Submit request' : 'Continue') + '</button></div>' :
        '<div class="card" style="margin-top:14px"><div class="empty"><div class="big">\u2705</div>' +
        '<h2 style="margin:0 0 8px">Issue submitted</h2>' +
        '<p>Your request has been added to the maintenance queue. Track it from My requests.</p>' +
        '<button type="button" class="btn btn-accent" data-go="#/requests">Go to my requests</button></div></div>'));

    body().querySelectorAll('[data-cat]').forEach(function (c) {
      var choose = function () {
        s.cat = c.getAttribute('data-cat');
        body().querySelectorAll('[data-cat]').forEach(function (x) {
          x.classList.toggle('active', x === c);
          x.setAttribute('aria-pressed', x === c ? 'true' : 'false');
        });
      };
      c.addEventListener('click', choose);
      c.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); choose(); } });
    });
    body().querySelectorAll('[data-urg]').forEach(function (c) {
      var choose = function () {
        s.urg = c.getAttribute('data-urg');
        body().querySelectorAll('[data-urg]').forEach(function (x) {
          x.classList.toggle('active', x === c);
          x.setAttribute('aria-checked', x === c ? 'true' : 'false');
        });
      };
      c.addEventListener('click', choose);
      c.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); choose(); } });
    });
    var next = document.getElementById('nextStep');
    if (next) next.addEventListener('click', function () {
      if (s.step === 1 && !s.cat) return toast('Select a category first.');
      if (s.step === 3) {
        var title = (document.getElementById('repTitle').value || '').trim();
        var detail = (document.getElementById('repDetail').value || '').trim();
        var unit = (document.getElementById('repUnit') && document.getElementById('repUnit').value) || 'My unit';
        s.title = title; s.detail = detail; s.unit = unit;
        if (!title) return toast('Give the issue a short title.');
        next.disabled = true;
        next.textContent = 'Submitting…';
        API.post('/api/requests', {
          category: s.cat, urgency: s.urg, title: title, detail: detail, unit: unit, photos: s.photos
        }).then(function () {
          s.step = 4;
          renderReportStep();
          toast('Maintenance request submitted.');
        }).catch(function (e) {
          toast(e.message || 'Could not submit the request.');
          next.disabled = false;
          next.textContent = 'Submit request';
        });
        return;
      }
      s.step += 1;
      renderReportStep();
    });
    var tInputs = ['repTitle', 'repDetail', 'repUnit'];
    tInputs.forEach(function (id) {
      var f = document.getElementById(id);
      if (f) f.addEventListener('input', function () { s[{ repTitle: 'title', repDetail: 'detail', repUnit: 'unit' }[id]] = f.value; });
    });
    var prev = document.getElementById('prevStep');
    if (prev) prev.addEventListener('click', function () { s.step -= 1; renderReportStep(); });
    var ap = document.getElementById('addPhoto');
    if (ap) ap.addEventListener('click', function () { s.photos += 1; toast('Photo attached.'); renderReportStep(); });
  }

  /* ============ PROPERTIES ============ */
  async function screenProperties() {
    render(loadingUI('Loading properties…'));
    try {
      var d = await load('/api/properties');
      var list = d.properties;
      var u = state.user;
      render(
        '<div class="hero"><h1>' + (u.role === 'tenant' ? 'My property' : (u.role === 'admin' ? 'All properties' : 'Your managed portfolio')) + '</h1>' +
        '<p>' + list.length + ' properties in the Horizon portfolio.</p></div>' +
        '<div class="table-wrap card" style="overflow-x:auto"><table><thead><tr>' +
        '<th>Property</th><th>Location</th><th>Manager</th></tr></thead><tbody>' +
        list.map(function (p) {
          return '<tr><td><span class="trow-main">' + esc(p.name) + '</span><div class="trow-sub">' + esc(p.address) + '</div></td>' +
            '<td class="trow-sub">' + esc(p.area) + '</td>' +
            '<td class="trow-sub">' + esc(p.managerName || '-') + '</td></tr>';
        }).join('') +
        '</tbody></table></div>');
    } catch (e) { failUI(e); }
  }

  /* ============ TECHNICIANS (manager) ============ */
  async function screenTechnicians() {
    render(loadingUI('Loading technicians…'));
    try {
      var d = await load('/api/technicians');
      var buzz = await fetchOnce('/api/requests');
      var all = buzz.requests;
      render(
        '<div class="hero"><h1>Technicians</h1><p>' + d.technicians.length + ' maintenance technicians on the service plan &middot; workloads tracked per request.</p></div>' +
        '<div class="grid three-col">' + d.technicians.map(function (t) {
          var jobs = all.filter(function (r) { return r.techId === t.id; });
          var active = jobs.filter(isOpen).length;
          return '<div class="card">' + avatarFor(t.name, 'role-technician') +
            '<h3 style="margin:10px 0 2px">' + esc(t.name) + '</h3>' +
            '<p style="color:var(--muted);margin:0 0 10px;font-size:13px">' + esc(t.skill) + '</p>' +
            '<span class="badge st-in-progress">' + active + ' active</span> ' +
            '<span class="badge st-closed">' + jobs.length + ' total</span></div>';
        }).join('') + '</div>');
    } catch (e) { failUI(e); }
  }

  /* ============ TENANTS (manager / admin) ============ */
  async function screenTenants() {
    render(loadingUI('Loading tenants…'));
    try {
      var d = await load('/api/tenants');
      render(
        '<div class="hero"><h1>Tenants</h1><p>' + d.tenants.length + ' tenants across the managed portfolio.</p></div>' +
        '<div class="table-wrap card" style="overflow-x:auto"><table><thead><tr>' +
        '<th>Tenant</th><th>Units</th><th>Open requests</th></tr></thead><tbody>' +
        d.tenants.map(function (t) {
          return '<tr><td><span class="trow-main">' + esc(t.name) + '</span><div class="trow-sub">' + esc(t.email) + '</div></td>' +
            '<td class="trow-sub">' + t.units.map(esc).join(', ') + '</td>' +
            '<td><span class="badge ' + (t.openRequests > 0 ? 'st-in-progress' : 'st-closed') + '">' + t.openRequests + ' open</span></td></tr>';
        }).join('') +
        '</tbody></table></div>');
    } catch (e) { failUI(e); }
  }

  /* ============ REPORTS ============ */
  async function screenReports() {
    render(loadingUI('Generating reports…'));
    try {
      var d = await load('/api/reports/summary');
      var s = d.summary;
      var varRow = function (a, b) { return '<div class="inline-stat"><span>' + esc(a) + '</span><b>' + esc(b) + '</b></div>'; };
      // Derived from the data: a hardcoded sentence here would start lying the
      // moment another category overtook it. `byCategory` arrives sorted desc.
      var topCategory = s.byCategory.reduce(function (best, c) {
        return c.count > (best ? best.count : -1) ? c : best;
      }, null);
      var topCategoryNote = topCategory && topCategory.count > 0
        ? esc(topCategory.name) + ' is the most common category across the portfolio, with ' +
          topCategory.count + ' ' + (topCategory.count === 1 ? 'request' : 'requests') + '.'
        : 'No requests recorded yet.';
      render(
        '<div class="hero"><h1>Maintenance reports</h1><p>' + s.total + ' requests total &middot; ' + s.open +
        ' open &middot; ' + s.resolved + ' resolved.</p></div>' +
        '<div class="grid stat-grid">' +
        statCard(s.total, 'Total requests', 'all time') +
        statCard(s.open, 'Open', 'awaiting action') +
        statCard(s.resolved, 'Resolved', 'closed & confirmed') +
        statCard(s.byStatus.filter(function (x) { return x.status === 'in-progress' || x.status === 'on-hold'; }).length, 'In flight', 'in progress or on hold') +
        '</div>' +
        '<div class="grid two-col">' +
        '<div class="card"><h3 class="card-title">Recurring issues by category</h3>' +
        (s.byCategory.map(function (c) { return varRow(c.name, c.count); }).join('') || 'No data yet.') +
        '<p style="font-size:12.5px;color:var(--muted);margin-top:10px">' + topCategoryNote + '</p></div>' +
        '<div class="card"><h3 class="card-title">Open issues by property</h3>' +
        (s.byProperty.length ? s.byProperty.map(function (p) {
          return varRow(p.name, p.count + (state.user.role !== 'admin' ? ' open' : ''));
        }).join('') : 'No data yet.') + '</div></div>' +
        '<div class="card" style="margin-top:16px"><h3 class="card-title">By status</h3>' +
        s.byStatus.map(function (st) { return varRow(statusLabel(st.status), st.count); }).join('') + '</div>' +
        '<div class="card" style="margin-top:16px"><h3 class="card-title">Export</h3>' +
        '<button type="button" class="btn btn-teal" data-export="1">Download CSV report</button></div>');
      body().querySelector('[data-export]').addEventListener('click', function () { exportCsv(s); });
    } catch (e) { failUI(e); }
  }

  function exportCsv(s) {
    var rows = [['Property', 'Requests']].concat(s.byProperty.map(function (p) { return [p.name, p.count]; }));
    rows.push([]);
    rows.push(['Category', 'Requests']);
    s.byCategory.forEach(function (c) { rows.push([c.name, c.count]); });
    rows.push([]);
    rows.push(['Status', 'Count']);
    s.byStatus.forEach(function (st) { rows.push([statusLabel(st.status), st.count]); });
    var csv = rows.map(function (r) {
      return r.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'propcare-report-' + todayStr() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Report exported as CSV.');
  }

  /* ============ NOTIFICATIONS ============ */
  async function screenNotifications() {
    render(loadingUI('Loading activity…'));
    try {
      var d = await load('/api/notifications');
      var nots = d.notifications;
      render(
        '<div class="hero" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
        '<div><h1>Activity centre</h1><p>Important updates, without the message sprawl.</p></div>' +
        '<button type="button" class="btn btn-teal" id="markAll" ' + (d.unread === 0 ? 'disabled' : '') + '>Mark all read</button></div>' +
        '<div class="card">' +
        (nots.map(function (n) {
          return '<div class="notif"><span class="n-ico">' + n.icon + '</span>' +
            '<div><div class="n-title">' + esc(n.title) + '</div><div class="n-when">' + esc(n.when) + '</div></div>' +
            (n.unread ? '<span class="badge st-in-progress" style="margin-left:auto">New</span>' : '') + '</div>';
        }).join('') || emptyUI('\uD83D\uDD14', 'No notifications yet.')) +
        '</div>');
      document.getElementById('markAll').addEventListener('click', function () {
        API.post('/api/notifications/read-all', {})
          .then(function () { toast('All notifications marked as read.'); screenNotifications(); })
          .catch(function (e) { toast(e.message); });
      });
    } catch (e) { failUI(e); }
  }

  /* ============ TECHNICIAN: JOBS / SCHEDULE / COMPLETED ============ */
  async function screenJobs() {
    render(loadingUI('Loading your jobs…'));
    try {
      var d = await load('/api/requests');
      var jobs = d.requests.filter(isOpen);
      var accept = jobs.filter(function (r) { return r.status === 'assigned'; });
      render(
        '<div class="hero"><h1>Assigned jobs</h1><p>' + jobs.length + ' active job(s) &middot; ' + accept.length + ' awaiting your acceptance.</p></div>' +
        '<div class="req-list">' +
        (jobs.map(function (r) {
          return '<div class="request-item" data-id="' + esc(r.id) + '" tabindex="0" role="link" aria-label="Open job ' + esc(r.id) + '"><div>' +
            '<div class="r-main">' + esc(r.title) + '</div>' +
            '<div class="r-sub">' + esc(r.id) + ' &middot; ' + esc(r.unit) + ' &middot; ' + esc(r.propertyName || '') + '</div></div>' +
            '<div class="r-right">' + badge(r.status) + '</div></div>';
        }).join('') || emptyUI('\uD83C\uDFAF', 'You have no active jobs right now.')) +
        '</div>');
    } catch (e) { failUI(e); }
  }

  async function screenSchedule() {
    render(loadingUI('Loading your schedule…'));
    try {
      var d = await load('/api/requests');
      var jobs = d.requests.filter(isOpen);
      var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      var rows = days.map(function (day, i) {
        var r = jobs[i];
        return '<tr><td><b>' + day + '</b><div class="trow-sub">' + (r ? 'Next visit' : '') + '</div></td>' +
          '<td>' + (r ? esc(r.title) + '<div class="trow-sub">' + esc(r.unit) + '</div>' : '<span class="trow-sub">Free</span>') + '</td>' +
          '<td>' + (r ? esc(r.id) + '<div class="trow-sub">' + esc(r.propertyName || '') + '</div>' : '-') + '</td>' +
          '<td>' + (r ? '<button type="button" class="btn btn-sm btn-ghost" data-go="#/job/' + esc(r.id) + '">Open</button>' : '-') + '</td></tr>';
      }).join('');
      render(
        '<div class="hero"><h1>Schedule</h1><p>Planned maintenance visits for the coming week.</p></div>' +
        '<div class="table-wrap card" style="overflow-x:auto"><table><thead><tr><th>Day</th><th>Job</th><th>Request</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>');
    } catch (e) { failUI(e); }
  }

  async function screenCompleted() {
    render(loadingUI('Loading completed jobs…'));
    try {
      var d = await load('/api/requests');
      var done = d.requests.filter(function (r) { return r.status === 'completed' || r.status === 'closed'; });
      render(
        '<div class="hero"><h1>Completed jobs</h1><p>' + done.length + ' jobs completed, verified with before/after photos.</p></div>' +
        '<div class="req-list">' +
        (done.map(function (r) {
          return '<div class="request-item" data-id="' + esc(r.id) + '" tabindex="0" role="link" aria-label="Open job ' + esc(r.id) + '"><div>' +
            '<div class="r-main">' + esc(r.title) + '</div>' +
            '<div class="r-sub">' + esc(r.id) + ' &middot; ' + esc(r.unit) + '</div></div>' +
            '<div class="r-right">' + badge(r.status) + '</div></div>';
        }).join('') || emptyUI('\uD83D\uDD27', 'No completed jobs yet.')) +
        '</div>');
    } catch (e) { failUI(e); }
  }

  /* ============ ADMIN SCREENS ============ */
  async function screenUsers() {
    render(loadingUI('Loading users…'));
    try {
      var d = await load('/api/users');
      render(
        '<div class="hero" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
        '<div><h1>Users</h1><p>All accounts across the platform &middot; role-based access control (RBAC) enforced server-side.</p></div>' +
        '<button type="button" class="btn btn-teal" data-usermodal="1">+ Add user</button></div>' +
        '<div class="table-wrap card" style="overflow-x:auto"><table><thead><tr>' +
        '<th>User</th><th>Role</th><th>Email</th><th>Status</th></tr></thead><tbody>' +
        d.users.map(function (u) {
          return '<tr><td>' + avatarFor(u.name, 'role-' + u.role) + ' <b>' + esc(u.name) + '</b></td>' +
            '<td><span class="badge st-assigned">' + esc(roleLabel(u.role)) + '</span></td>' +
            '<td class="trow-sub">' + esc(u.email) + '</td>' +
            '<td><span class="badge ' + (u.active ? 'st-closed' : 'st-cancelled') + '">' + (u.active ? 'Active' : 'Disabled') + '</span>' +
            (u.id !== state.user.id ? ' <button type="button" class="btn btn-sm btn-ghost" data-toggle="' + u.id + '">' + (u.active ? 'Disable' : 'Enable') + '</button>' : '') +
            '</td></tr>';
        }).join('') +
        '</tbody></table></div>');
      body().querySelector('[data-usermodal]').addEventListener('click', function () { addUserModal(); });
      body().querySelectorAll('[data-toggle]').forEach(function (b) {
        b.addEventListener('click', function () {
          API.put('/api/users/' + b.getAttribute('data-toggle') + '/status', { active: b.textContent.trim() === 'Enable' })
            .then(function (res) { toast(res.message); screenUsers(); })
            .catch(function (e) { toast(e.message); });
        });
      });
    } catch (e) { failUI(e); }
  }

  /**
   * Add-user modal.
   *
   * The role drives the extra fields: a tenant must be attached to a property
   * and unit (otherwise they cannot raise a request), and a technician needs a
   * trade so they appear in the manager's assignment list.
   */
  function addUserModal() {
    load('/api/properties').then(function (d) {
      var propOpts = d.properties.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' &middot; ' + esc(p.area) + '</option>';
      }).join('');

      var extra =
        '<div id="tenantFields">' +
        '<label class="field-label" for="nuProperty">Property</label><select class="field" id="nuProperty">' + propOpts + '</select>' +
        '<label class="field-label" for="nuUnit">Unit</label><input class="field" id="nuUnit" placeholder="e.g. Claremont Unit 4B">' +
        '</div>' +
        '<div id="techFields" class="hidden">' +
        '<label class="field-label" for="nuSkill">Trade / skill</label>' +
        '<select class="field" id="nuSkill">' +
        ['Plumbing', 'Electrical', 'Heating & cooling', 'Security', 'Appliances', 'General maintenance']
          .map(function (sk) { return '<option value="' + esc(sk) + '">' + esc(sk) + '</option>'; }).join('') +
        '</select></div>';

      openModal('<h2 id="modalTitle">Add a user</h2>' +
        '<label class="field-label" for="nuName">Full name</label><input class="field" id="nuName" placeholder="e.g. Jane Doe">' +
        '<label class="field-label" for="nuEmail">Email</label><input class="field" id="nuEmail" type="email" placeholder="jane@example.com">' +
        '<label class="field-label" for="nuRole">Role</label><select class="field" id="nuRole">' +
        '<option value="tenant">Tenant</option><option value="manager">Property Manager</option>' +
        '<option value="technician">Technician</option><option value="admin">Administrator</option>' +
        '</select>' +
        extra +
        '<label class="field-label" for="nuPass">Temporary password (min 8 chars, UPPER + lower + number)</label>' +
        '<input class="field" id="nuPass" type="password" value="">' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">Cancel</button>' +
        '<button type="button" class="btn btn-accent" id="nuOk">Create user</button></div>');

      var syncRole = function () {
        var role = document.getElementById('nuRole').value;
        document.getElementById('tenantFields').classList.toggle('hidden', role !== 'tenant');
        document.getElementById('techFields').classList.toggle('hidden', role !== 'technician');
      };
      document.getElementById('nuRole').addEventListener('change', syncRole);
      syncRole();

      document.getElementById('nuOk').addEventListener('click', function () {
        var b = this; b.disabled = true;
        var role = document.getElementById('nuRole').value;
        var payload = {
          name: document.getElementById('nuName').value.trim(),
          email: document.getElementById('nuEmail').value.trim(),
          role: role,
          password: document.getElementById('nuPass').value
        };
        if (role === 'tenant') {
          payload.propertyId = document.getElementById('nuProperty').value;
          payload.unit = document.getElementById('nuUnit').value.trim();
          if (!payload.unit) { toast('Enter the unit this tenant occupies.'); b.disabled = false; return; }
        }
        if (role === 'technician') payload.skill = document.getElementById('nuSkill').value;

        API.post('/api/users', payload)
          .then(function (res) {
            toast('User ' + res.data.user.email + ' created.');
            closeModal();
            screenUsers();
          })
          .catch(function (e) { toast(e.message || 'Could not create user.'); b.disabled = false; });
      });
      wireModalClose();
    }).catch(function (e) { toast(e.message || 'Could not load properties.'); });
  }

  async function screenCategories() {
    render(loadingUI('Loading categories…'));
    try {
      var d = await load('/api/categories');
      render(
        '<div class="hero"><h1>Maintenance categories</h1><p>Consistent classification for every request.</p></div>' +
        '<div class="grid three-col">' + d.categories.map(function (c) {
          return '<div class="card"><h3>' + esc(c.name) + '</h3><p style="color:var(--muted);font-size:13px">' + c.count + ' requests classified</p>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-preset="1">Applied automatically</button></div>';
        }).join('') + '</div>' +
        '<p style="color:var(--muted);font-size:13px;margin-top:14px">Categories drive the report-an-issue wizard and the recurring-issue reports.</p>');
      body().querySelectorAll('[data-preset]').forEach(function (b) { b.addEventListener('click', function () { toast('Categories are pre-configured for the portfolio.'); }); });
    } catch (e) { failUI(e); }
  }

  function screenRoles() {
    var roles = [
      { r: 'Tenant', perms: ['View my properties', 'Report maintenance issues', 'Upload photos', 'Track request status', 'Confirm & close requests', 'Rate completed work'] },
      { r: 'Property Manager', perms: ['Review & prioritise requests', 'Assign technicians', 'Monitor portfolio', 'Communicate with tenants', 'Approve & close requests', 'Generate reports'] },
      { r: 'Technician', perms: ['View assigned jobs', 'Accept / reject jobs', 'Update job status', 'Upload before/after photos', 'Add work notes', 'Mark jobs complete'] },
      { r: 'Administrator', perms: ['Manage users & permissions', 'Manage properties', 'Manage categories', 'Manage technicians', 'View system-wide reports', 'System settings'] }
    ];
    render(
      '<div class="hero"><h1>Roles &amp; permissions</h1><p>Role-based access control &middot; every role can only access its own functionality.</p></div>' +
      '<div class="grid two-col">' + roles.map(function (x) {
        return '<div class="card"><h3>' + esc(x.r) + '</h3><ul style="margin:8px 0 0;padding-left:18px">' +
          x.perms.map(function (p) { return '<li style="font-size:13.5px;padding:3px 0">' + esc(p) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</div>');
  }

  function screenSettings() {
    render(
      '<div class="hero"><h1>System settings</h1><p>Configuration for the Obs Realty deployment.</p></div>' +
      '<div class="grid two-col">' +
      '<div class="card"><h3 class="card-title">Workspace</h3>' +
      '<label class="field-label" for="wsName">Organisation name</label><input class="field" id="wsName" value="Horizon Property Group">' +
      '<label class="field-label" for="wsNotif">Notification channel (Observer pattern)</label><select class="field" id="wsNotif"><option>In-app push + email</option><option>In-app push only</option><option>Email only</option></select>' +
      '<div style="margin-top:14px"><button type="button" class="btn btn-accent" id="saveSet">Save settings</button></div></div>' +
      '<div class="card"><h3 class="card-title">Security</h3>' +
      '<ul style="margin:0;padding-left:18px;font-size:13.5px">' +
      '<li>Passwords hashed with bcrypt (never stored in plain text)</li>' +
      '<li>JWTs issued on login; refreshed on session restore</li>' +
      '<li>Object-level authorisation: tenants only see their own requests</li>' +
      '<li>Strict Content-Security-Policy on every response</li></ul></div></div>');
    document.getElementById('saveSet').addEventListener('click', function () {
      toast('Settings saved to the workspace.');
    });
  }

  /* ============ MOCKUPS / DESIGN REFERENCE ============ */
  var MOCKUPS = [
    { file: 'PropCare.png', label: 'Login & welcome screen (as-designed)' },
    { file: 'PropCare -1.png', label: 'Tenant overview dashboard' },
    { file: 'PropCare -2.png', label: 'My requests' },
    { file: 'PropCare -3.png', label: 'Managed portfolio (property manager)' },
    { file: 'PropCare -4.png', label: 'Notifications activity centre' }
  ];

  function screenMockups() {
    render(
      '<div class="hero"><h1>Design reference — original mockups</h1>' +
      '<p>The approved mockups that guided the interface, reproduced here for reference.</p></div>' +
      '<div class="mockup-grid">' +
      MOCKUPS.map(function (m, i) {
        return '<figure class="mockup' + (i === 0 ? ' wide' : '') + '"><img src="assets/mockups/' + m.file +
          '" alt="' + esc(m.label) + '"><figcaption>' + esc(m.label) + '</figcaption></figure>';
      }).join('') + '</div>');
  }

  /* ============ PROFILE ============ */
  async function screenProfile() {
    var u = state.user;
    render(
      '<div class="hero"><h1>Profile</h1><p>Your workspace identity and account details.</p></div>' +
      '<div class="grid two-col">' +
      '<div class="card" style="text-align:center;padding:30px">' +
      '<span class="avatar role-' + u.role + '" style="width:64px;height:64px;font-size:24px">' + esc(initials(u.name)) + '</span>' +
      '<h2 style="margin:12px 0 2px">' + esc(u.name) + '</h2>' +
      '<p style="color:var(--muted);margin:0 0 12px">' + esc(roleLabel(u.role)) + ' &middot; ' + esc(u.email) + '</p>' +
      '<span class="badge st-in-progress">' + (u.units ? u.units.length : 0) + ' unit(s)</span></div>' +
      '<div class="card"><h3 class="card-title">Account details</h3>' +
      '<label class="field-label" for="pfName">Full name</label><input class="field" id="pfName" value="' + esc(u.name) + '">' +
      '<label class="field-label" for="pfEmail">Work email</label><input class="field" id="pfEmail" value="' + esc(u.email) + '">' +
      '<label class="field-label" for="pfPass">New password (leave blank to keep current)</label><input class="field" id="pfPass" type="password" autocomplete="new-password">' +
      '<div id="pfError" class="form-error hidden" role="alert" style="margin-top:10px"></div>' +
      '<div style="margin-top:14px"><button type="button" class="btn btn-accent" id="saveProfile">Save changes</button></div></div></div>');
    document.getElementById('saveProfile').addEventListener('click', function () {
      var b = this; b.disabled = true;
      var payload = {
        name: document.getElementById('pfName').value.trim(),
        email: document.getElementById('pfEmail').value.trim()
      };
      var pw = document.getElementById('pfPass').value;
      if (pw) payload.password = pw;
      API.put('/api/users/me', payload)
        .then(function () {
          toast('Profile updated.');
          // refresh cached user
          return API.get('/api/auth/me');
        })
        .then(function (d) {
          state.user = d.data.user;
          var me = state.user;
          document.getElementById('userName').textContent = me.name;
          document.getElementById('userAvatar').textContent = initials(me.name);
          renderShell();
        })
        .catch(function (e) { toast(e.message || 'Could not update profile.'); })
        .finally(function () { b.disabled = false; });
    });
  }

  /* ============ ROUTER ============ */
  async function route() {
    if (!state.user) { showLogin(); return; }
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('?')[0].split('/');
    var seg = parts[0] || 'overview';
    var id = parts[1] || '';
    renderShell();
    _urlCache = {};
    try {
      if (seg === 'overview') return await screenOverview();
      if (seg === 'requests') return await screenRequests();
      if (seg === 'request' || seg === 'job') return await screenRequest(id);
      if (seg === 'report') return await screenReport();
      if (seg === 'properties') return await screenProperties();
      if (seg === 'notifications') return await screenNotifications();
      if (seg === 'mockups') return screenMockups();
      if (seg === 'technicians') return await screenTechnicians();
      if (seg === 'tenants') return await screenTenants();
      if (seg === 'reports') return await screenReports();
      if (seg === 'jobs') return await screenJobs();
      if (seg === 'schedule') return await screenSchedule();
      if (seg === 'completed') return await screenCompleted();
      if (seg === 'users') return await screenUsers();
      if (seg === 'categories') return await screenCategories();
      if (seg === 'roles') return screenRoles();
      if (seg === 'settings') return screenSettings();
      if (seg === 'profile') return await screenProfile();
      location.hash = '#/overview';
      return await screenOverview();
    } catch (e) {
      if (e && e.status === 401) return showLogin();
      failUI(e);
    }
  }

  /* ---------------- login ---------------- */
  var EMAILS = {
    'sarahwilliams@example.com': 'Sarah Williams — Tenant',
    'michael.jacobs@obsrealty.co.za': 'Michael Jacobs — Property Manager',
    'johan.vdm@obsrealty.co.za': 'Johan van der Merwe — Technician',
    'admin@obsrealty.co.za': 'System Admin — Administrator'
  };

  function wireLogin() {
    var roleSel = document.getElementById('loginRole');
    var email = document.getElementById('loginEmail');
    var setErr = function (msg) {
      var box = document.getElementById('loginError');
      box.textContent = msg;
      box.classList.toggle('hidden', !msg);
    };
    roleSel.addEventListener('change', function () {
      if (EMAILS[roleSel.value]) {
        email.value = roleSel.value;
        document.getElementById('loginPassword').value = 'PropCare123!';
      }
      setErr('');
    });
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    document.getElementById('forgotBtn').addEventListener('click', function () {
      toast('In this demo every account uses the password shown on the sign-in card.');
    });
  }

  async function doLogin() {
    var btn = document.getElementById('loginBtn');
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    var errBox = document.getElementById('loginError');
    errBox.classList.add('hidden');
    if (!email || !password) {
      errBox.textContent = 'Enter your email and password.';
      errBox.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    document.querySelector('#loginBtn .btn-label').textContent = 'Signing in…';
    try {
      var res = await API.login(email, password);
      API.setSession(res.data);
      setUser(res.data.user);
      toast('Welcome back, ' + res.data.user.name.split(' ')[0] + '!');
    } catch (e) {
      errBox.textContent = e.message || 'Sign in failed. Please try again.';
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      document.querySelector('#loginBtn .btn-label').textContent = 'Sign in to PropCare';
    }
  }

  /* ---------------- global wiring ---------------- */
  function wireGlobal() {
    document.getElementById('signOutBtn').addEventListener('click', function () {
      API.logout().catch(function () { /* offline is fine */ });
      showLogin();
      toast('Signed out.');
    });
    document.getElementById('userAvatar').addEventListener('click', function () { location.hash = '#/profile'; });
    document.getElementById('userAvatar').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/profile'; }
    });
    window.addEventListener('hashchange', function () { if (state.user) route(); });
    window.addEventListener('propcare:unauthorized', function () {
      showLogin();
      toast('Session expired. Please sign in again.');
    });
    document.getElementById('appBody').addEventListener('click', function (e) {
      var card = e.target.closest('.request-item[data-id]');
      if (card && !card.getAttribute('data-static')) {
        var role = state.user.role;
        location.hash = (role === 'technician' ? '#/job/' : '#/request/') + card.getAttribute('data-id');
      }
      var go = e.target.closest('[data-go]');
      if (go) location.hash = go.getAttribute('data-go');
    });
    document.getElementById('appBody').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('.request-item[data-id]:not([data-static])') || t.matches('[data-filter]') || t.matches('[data-go]')) {
        e.preventDefault();
        t.click();
      }
    });
  }

  /* ---------------- boot ---------------- */
  window.PropCareApp = {
    route: route,
    closeModal: closeModal,
    // Exposed so the formatting helpers can be unit-tested directly.
    initials: initials,
    init: function () {
      wireLogin();
      wireGlobal();
      if (API.token()) {
        API.get('/api/auth/me')
          .then(function (d) {
            state.user = d.data.user;
            if (location.hash && location.hash.indexOf('#/profile') === -1 && location.hash !== '#/') {
              route();
            } else {
              location.hash = '#/';
              route();
            }
          })
          .catch(function () { showLogin(); });
      } else {
        if (location.hash.indexOf('#/') === -1) location.hash = '#/';
        showLogin();
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { window.PropCareApp.init(); });
  } else {
    window.PropCareApp.init();
  }
})();