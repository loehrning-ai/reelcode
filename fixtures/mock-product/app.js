// Tallyport fixture renderer. Reads ?state= and renders one static state.
// No network, no Date, no randomness, no timers: every value below is a constant.
(function () {
  'use strict';
  var STATES = ['landing', 'home', 'search', 'report', 'editor', 'success', 'settings'];
  window.__fixtureStates = STATES.slice();

  var I = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    report: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    export: '<path d="M12 3v12M7 8l5-5 5 5M5 15v5h14v-5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'
  };
  function ic(n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + I[n] + '</svg>';
  }

  // ---------- data (inline constants) ----------
  var KPIS = [
    { id: 'kpi-1', label: 'Active accounts', value: '12,480', delta: '+8.2%', dir: 'up', sub: 'vs. previous 30 days', spark: [8, 9, 9, 10, 11, 10, 12, 13, 13, 14, 15, 16] },
    { id: 'kpi-2', label: 'Net revenue retention', value: '118%', delta: '+3.1 pts', dir: 'up', sub: 'trailing 12 months', spark: [10, 10, 11, 11, 11, 12, 12, 13, 12, 13, 14, 14] },
    { id: 'kpi-3', label: 'Logo churn', value: '1.9%', delta: '−0.4 pts', dir: 'down', sub: 'monthly, all plans', spark: [16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10] }
  ];
  var WEEKS = ['Jul 6', 'Jul 13', 'Jul 20', 'Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21'];
  var MRR_NOW = [412, 418, 431, 428, 446, 459, 455, 472, 489, 497, 512, 531];
  var MRR_PREV = [380, 386, 384, 393, 398, 401, 409, 406, 414, 420, 418, 427];
  var COHORTS = [
    { k: 'Jan', v: 94 }, { k: 'Feb', v: 91 }, { k: 'Mar', v: 89 }, { k: 'Apr', v: 92 },
    { k: 'May', v: 86 }, { k: 'Jun', v: 81 }, { k: 'Jul', v: 88 }, { k: 'Aug', v: 90 }
  ];
  var PEOPLE = [
    { i: 'MR', n: 'Mara Rinne', e: 'mara@kestrelle.example', r: 'Owner' },
    { i: 'JO', n: 'Jonas Ode', e: 'jonas@kestrelle.example', r: 'Admin' },
    { i: 'PL', n: 'Priya Lal', e: 'priya@kestrelle.example', r: 'Analyst' },
    { i: 'TC', n: 'Theo Calder', e: 'theo@kestrelle.example', r: 'Viewer' }
  ];

  // ---------- svg charts ----------
  function sparkline(vals, w, h, color) {
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pts = vals.map(function (v, i) {
      return (i / (vals.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - mn) / (mx - mn || 1) * (h - 4)).toFixed(1);
    }).join(' ');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts +
      '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function lineChart(w, h) {
    var pad = { l: 44, r: 12, t: 10, b: 28 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var lo = 360, hi = 560;
    function x(i) { return pad.l + i / (WEEKS.length - 1) * iw; }
    function y(v) { return pad.t + ih - (v - lo) / (hi - lo) * ih; }
    var s = '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
    s += '<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3D5AFE" stop-opacity="0.32"/><stop offset="1" stop-color="#3D5AFE" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g <= 4; g++) {
      var gv = lo + g * 50, gy = y(gv).toFixed(1);
      s += '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + gy + '" y2="' + gy + '" stroke="#26262C"/>';
      s += '<text x="' + (pad.l - 10) + '" y="' + (+gy + 4) + '" text-anchor="end" fill="#6B6B70" font-size="11" font-family="JetBrains Mono, monospace">$' + gv + 'k</text>';
    }
    WEEKS.forEach(function (wk, i) {
      if (i % 2 === 0) s += '<text x="' + x(i).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" fill="#6B6B70" font-size="11">' + wk + '</text>';
    });
    var now = MRR_NOW.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
    var prev = MRR_PREV.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
    s += '<polygon points="' + pad.l + ',' + (pad.t + ih) + ' ' + now.join(' ') + ' ' + x(WEEKS.length - 1).toFixed(1) + ',' + (pad.t + ih) + '" fill="url(#area)"/>';
    s += '<polyline points="' + prev.join(' ') + '" fill="none" stroke="#6B6B70" stroke-width="2" stroke-dasharray="5 5"/>';
    s += '<polyline points="' + now.join(' ') + '" fill="none" stroke="#3D5AFE" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';
    var lx = x(WEEKS.length - 1), ly = y(MRR_NOW[MRR_NOW.length - 1]);
    s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="5" fill="#0F1012" stroke="#3D5AFE" stroke-width="3"/>';
    return s + '</svg>';
  }

  function barChart(w, h) {
    var pad = { l: 40, r: 8, t: 14, b: 30 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var lo = 70, hi = 100, bw = iw / COHORTS.length;
    var s = '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
    for (var g = 0; g <= 3; g++) {
      var gv = lo + g * 10, gy = (pad.t + ih - (gv - lo) / (hi - lo) * ih).toFixed(1);
      s += '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + gy + '" y2="' + gy + '" stroke="#26262C"/>';
      s += '<text x="' + (pad.l - 8) + '" y="' + (+gy + 4) + '" text-anchor="end" fill="#6B6B70" font-size="11" font-family="JetBrains Mono, monospace">' + gv + '%</text>';
    }
    COHORTS.forEach(function (c, i) {
      var bh = (c.v - lo) / (hi - lo) * ih, bx = pad.l + i * bw + bw * 0.18, by = pad.t + ih - bh;
      var hot = c.k === 'Jun';
      s += '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="6" fill="' + (hot ? '#3D5AFE' : '#34343C') + '"/>';
      s += '<text x="' + (bx + bw * 0.32).toFixed(1) + '" y="' + (by - 7).toFixed(1) + '" text-anchor="middle" fill="' + (hot ? '#F2F0EA' : '#8D8C90') + '" font-size="12" font-family="JetBrains Mono, monospace">' + c.v + '%</text>';
      s += '<text x="' + (bx + bw * 0.32).toFixed(1) + '" y="' + (h - 9) + '" text-anchor="middle" fill="#6B6B70" font-size="12">' + c.k + '</text>';
    });
    return s + '</svg>';
  }

  // ---------- shared pieces ----------
  function sidebar(active) {
    var items = [
      ['home', 'Overview', 'home', ''], ['chart', 'Metrics', 'metrics', '48'], ['report', 'Reports', 'report', '12'],
      ['bell', 'Alerts', 'alerts', '3'], ['users', 'Accounts', 'accounts', ''], ['gear', 'Settings', 'settings', '']
    ];
    var nav = items.map(function (it) {
      return '<a class="' + (it[2] === active ? 'on' : '') + '">' + ic(it[0]) + it[1] + (it[3] ? '<span class="count">' + it[3] + '</span>' : '') + '</a>';
    }).join('');
    return '<aside class="sidebar">' +
      '<div class="brand"><img data-cap="logo" src="logo.svg" alt="Tallyport" width="135" height="36"></div>' +
      '<nav class="nav" data-cap="nav"><div class="nav-label">Workspace</div>' + nav +
      '<div class="nav-label">Pinned</div><a><span class="dot"></span>Churn by cohort</a><a><span class="dot m"></span>Weekly MRR</a><a><span class="dot g"></span>Expansion</a></nav>' +
      '<div class="workspace"><div class="avatar">KL</div><div class="meta">Kestrelle Labs<span>Team plan · 14 seats</span></div></div>' +
      '</aside>';
  }
  function topbar(crumb, extra) {
    return '<header class="topbar"><div class="crumbs">Kestrelle Labs / <b>' + crumb + '</b></div>' +
      '<div class="search" data-cap="search">' + ic('search') + 'Search metrics, reports, accounts<kbd>⌘K</kbd></div>' +
      (extra || '<div class="bell">' + ic('bell') + '</div>') + '</header>';
  }
  function shell(active, crumb, body, extraTop) {
    return '<div class="shell">' + sidebar(active) + '<div class="main">' + topbar(crumb, extraTop) +
      '<main class="content">' + body + '</main></div></div>';
  }

  // ---------- states ----------
  function home() {
    var kpis = KPIS.map(function (k) {
      return '<div class="card kpi" data-cap="' + k.id + '"><div class="label">' + k.label + '</div>' +
        '<div class="row"><div><div class="value">' + k.value + '</div><div class="sub"><span class="delta ' + k.dir + '">' + k.delta + '</span> ' + k.sub + '</div></div>' +
        sparkline(k.spark, 96, 36, k.id === 'kpi-1' ? '#3D5AFE' : '#8D8C90') + '</div></div>';
    }).join('');
    var body = '<div class="page-head"><div><h1>Good morning, Mara</h1><p>Revenue is up 4.1% week over week. Two cohorts need attention.</p></div>' +
      '<div class="actions"><div class="seg"><span>7d</span><span class="on">30d</span><span>90d</span><span>12m</span></div>' +
      '<button class="btn" data-cap="export">' + ic('export') + 'Export</button></div></div>' +
      '<section class="kpis">' + kpis + '</section>' +
      '<section class="grid-2"><div class="card" data-cap="chart"><div class="card-head"><h2>Monthly recurring revenue</h2>' +
      '<div class="legend"><span><i style="background:#3D5AFE"></i>This period</span><span><i style="background:#6B6B70"></i>Previous</span></div></div>' +
      lineChart(760, 300) + '</div>' +
      '<div class="card"><div class="card-head"><h2>Signals</h2><span class="kbd" style="margin-left:auto">Live</span></div><div class="list">' +
      '<div class="item"><span class="dot b"></span>June cohort retention dipped<span class="r">81%</span></div>' +
      '<div class="item"><span class="dot g"></span>Team plan expansion<span class="r">+$18.2k</span></div>' +
      '<div class="item"><span class="dot"></span>Trial → paid conversion<span class="r">24.6%</span></div>' +
      '<div class="item"><span class="dot m"></span>Support tickets / account<span class="r">0.42</span></div>' +
      '<div class="item"><span class="dot g"></span>Seats added this week<span class="r">+212</span></div>' +
      '<div class="item"><span class="dot b"></span>Failed payments<span class="r">37</span></div>' +
      '</div></div></section>';
    return shell('home', 'Overview', body);
  }

  function search() {
    var rows = [
      ['report', '<mark>Churn by cohort</mark>', 'Report · updated by Priya Lal', '↵'],
      ['chart', 'Logo <mark>churn</mark> — monthly', 'Metric · all plans', ''],
      ['layers', 'Retention <mark>by cohort</mark> (Team plan)', 'Saved view', ''],
      ['bolt', 'Alert me when <mark>churn</mark> rises', 'Action · create alert', '⌘↵']
    ];
    var res = rows.map(function (r, i) {
      return '<div class="result' + (i === 0 ? ' on' : '') + '"' + (i === 0 ? ' data-cap="result-1"' : '') + '><div class="ico">' + ic(r[0]) +
        '</div><div><div class="t">' + r[1] + '</div><div class="d">' + r[2] + '</div></div>' + (r[3] ? '<span class="kbd">' + r[3] + '</span>' : '') + '</div>';
    });
    return home() + '<div class="scrim"></div><div class="palette" data-cap="palette">' +
      '<div class="input">' + ic('search') + '<span>churn by cohort<span class="caret"></span></span><span class="kbd" style="margin-left:auto">esc</span></div>' +
      '<div class="group"><div class="group-label">Best match</div>' + res[0] + '</div>' +
      '<div class="group"><div class="group-label">Metrics &amp; views</div>' + res[1] + res[2] + '</div>' +
      '<div class="group" style="padding-bottom:10px"><div class="group-label">Actions</div>' + res[3] + '</div>' +
      '<div class="foot"><span><span class="kbd">↑↓</span> navigate</span><span><span class="kbd">↵</span> open</span><span><span class="kbd">⌘↵</span> run action</span></div></div>';
  }

  function reportBody() {
    return '<div class="page-head"><div><h1>Churn by cohort</h1><p>Share of accounts still active 90 days after signup, by signup month.</p></div>' +
      '<div class="actions"><button class="btn btn-ghost">Schedule</button><button class="btn btn-primary" data-cap="primary">' + ic('export') + 'Export report</button></div></div>' +
      '<div class="filters" data-cap="filters"><span class="chip on"><b>Cohort</b>2026 H1 + Jul–Aug</span><span class="chip"><b>Plan</b>Pro, Team</span>' +
      '<span class="chip"><b>Region</b>All</span><span class="chip"><b>Window</b>90 days</span><span class="chip add">' + ic('plus').replace('<svg', '<svg width="14" height="14"') + 'Add filter</span></div>' +
      '<section class="grid-2"><div class="card" data-cap="report-chart"><div class="card-head"><h2>90-day retention</h2><div class="legend"><span><i style="background:#3D5AFE"></i>Below target</span><span><i style="background:#34343C"></i>On target</span></div></div>' +
      barChart(760, 320) + '</div><div class="card stat-col">' +
      '<div class="stat"><div class="k">Average retention</div><div class="v">88.9%</div></div>' +
      '<div class="stat"><div class="k">Weakest cohort</div><div class="v">June · 81%</div></div>' +
      '<div class="stat"><div class="k">Accounts at risk</div><div class="v">142</div></div>' +
      '<div class="preview-box mono" style="font-size:12px;color:#B9B7B0">retention_90d<br>  WHERE plan IN (pro, team)<br>  GROUP BY signup_month</div></div></section>';
  }
  function report() {
    return shell('report', 'Reports', reportBody()) +
      '<div class="toast" data-cap="toast"><div class="ok">' + ic('check') + '</div><div><div class="t">Report exported</div>' +
      '<div class="d">churn-by-cohort.csv · sent to #growth</div></div><span class="undo">Undo</span></div>';
  }

  function editorBody(saved) {
    return (saved ? '<div class="banner" data-cap="banner"><div class="ok">' + ic('check') + '</div><div><b>Alert is live.</b> Tallyport checks churn every hour and posts to #growth.</div><span class="undo" style="margin-left:auto;color:#3D5AFE;font-weight:600">View alert</span></div>' : '') +
      '<div class="page-head"><div><h1>' + (saved ? 'Churn spike alert' : 'New alert') + '</h1><p>Get told when a number moves, not after the board meeting.</p></div>' +
      '<div class="actions"><button class="btn btn-ghost">Cancel</button><button class="btn btn-primary"' + (saved ? '' : ' data-cap="save"') + '>' + ic('check') + (saved ? 'Saved' : 'Save alert') + '</button></div></div>' +
      '<section class="grid-2"><div class="card form" data-cap="form">' +
      '<div class="field"><label>Alert name</label><div class="inp' + (saved ? '' : ' focus') + '"><span class="grow">Churn spike — Team plan</span></div></div>' +
      '<div class="row-3"><div class="field"><label>Metric</label><div class="inp"><span class="grow">Logo churn (monthly)</span><span class="muted">▾</span></div></div>' +
      '<div class="field"><label>Condition</label><div class="inp"><span class="grow">rises above</span><span class="muted">▾</span></div></div>' +
      '<div class="field"><label>Threshold</label><div class="inp"><span class="grow mono">2.5</span><span class="muted">%</span></div></div></div>' +
      '<div class="row-2"><div class="field"><label>Segment</label><div class="inp"><span class="grow">Plan is Team</span></div></div>' +
      '<div class="field"><label>Check every</label><div class="inp"><span class="grow">1 hour</span><span class="muted">▾</span></div></div></div>' +
      '<div><div class="opt"><div><div class="t">Post to Slack</div><div class="d">#growth</div></div><div class="toggle on"></div></div>' +
      '<div class="opt"><div><div class="t">Email the owner</div><div class="d">mara@kestrelle.example</div></div><div class="toggle on"></div></div>' +
      '<div class="opt"><div><div class="t">Page on-call</div><div class="d">Only when 2× threshold</div></div><div class="toggle"></div></div></div>' +
      '</div><div class="card"><div class="card-head"><h2>Preview</h2></div><div class="preview-box">' + sparkline([14, 13, 15, 14, 16, 15, 18, 17, 21, 24], 290, 90, '#3D5AFE') +
      '<div style="margin-top:10px;color:#B9B7B0;font-size:13px">Would have fired <b style="color:#F2F0EA">2 times</b> in the last 90 days.</div></div></div></section>';
  }
  function editor() { return shell('alerts', 'Alerts', editorBody(false)); }
  function success() {
    var bell = '<div class="bell">' + ic('bell') + '<span class="badge">3</span></div>';
    return shell('alerts', 'Alerts', editorBody(true), bell) +
      '<div class="notifs" data-cap="notifications"><div class="h"><b>Notifications</b><span>Mark all read</span></div>' +
      '<div class="notif new"><span class="dot"></span><div><div><b>Churn spike alert</b> is live</div><div class="d">Created just now · posts to #growth</div></div></div>' +
      '<div class="notif new"><span class="dot g"></span><div><div>Team plan expansion crossed <b>$18k</b></div><div class="d">Expansion · 2 h ago</div></div></div>' +
      '<div class="notif new"><span class="dot b"></span><div><div>June cohort retention fell to <b>81%</b></div><div class="d">Churn by cohort · 5 h ago</div></div></div>' +
      '<div class="notif"><span class="dot m"></span><div><div>Priya Lal shared <b>Weekly MRR</b></div><div class="d">Yesterday</div></div></div></div>';
  }

  function settings() {
    var rows = PEOPLE.map(function (p) {
      return '<tr><td><div class="who"><div class="avatar">' + p.i + '</div><div>' + p.n + '<div style="color:#6B6B70;font-size:12px">' + p.e + '</div></div></div></td><td><span class="role">' + p.r + '</span></td></tr>';
    }).join('');
    var body = '<div class="page-head"><div><h1>Settings</h1><p>Workspace, brand and members.</p></div><div class="actions"><button class="btn btn-primary">Save changes</button></div></div>' +
      '<div class="tabs"><span class="on">General</span><span>Members</span><span>Integrations</span><span>Billing</span><span>API</span></div>' +
      '<section class="grid-2"><div class="card form" data-cap="settings-panel">' +
      '<div class="row-2"><div class="field"><label>Workspace name</label><div class="inp"><span class="grow">Kestrelle Labs</span></div></div>' +
      '<div class="field"><label>URL</label><div class="inp"><span class="muted">tallyport.example/</span><span class="grow">kestrelle</span></div></div></div>' +
      '<div class="field"><label>Report accent</label><div class="swatches"><div class="swatch on" style="background:#3D5AFE"></div><div class="swatch" style="background:#F2F0EA"></div><div class="swatch" style="background:#3FBF7F"></div><div class="swatch" style="background:#6B6B70"></div></div><div class="hint">Used in exported charts and scheduled emails.</div></div>' +
      '<div><div class="opt"><div><div class="t">Weekly digest</div><div class="d">Mondays, 08:00 workspace time</div></div><div class="toggle on"></div></div>' +
      '<div class="opt"><div><div class="t">Anomaly detection</div><div class="d">Flag metrics that move more than 2σ</div></div><div class="toggle on"></div></div>' +
      '<div class="opt"><div><div class="t">Public share links</div><div class="d">Anyone with the link can view</div></div><div class="toggle"></div></div></div>' +
      '<table class="members" data-cap="members"><tr><th>Member</th><th>Role</th></tr>' + rows + '</table>' +
      '</div><div class="card plan" data-cap="plan"><div class="k" style="color:#B9B7B0;font-size:12px">Current plan</div><div class="stat"><div class="v">Team</div></div>' +
      '<div style="color:#B9B7B0;margin:6px 0 16px">14 of 20 seats · 48 metrics · hourly sync</div><button class="btn btn-primary">' + ic('arrow') + 'Upgrade to Scale</button></div></section>';
    return shell('settings', 'Settings', body);
  }

  function landing() {
    var mini = KPIS.map(function (k) { return '<div class="card"><div class="k">' + k.label + '</div><div class="v">' + k.value + '</div></div>'; }).join('');
    return '<div class="landing"><nav class="lnav"><img data-cap="logo" src="logo.svg" alt="Tallyport" width="128" height="34">' +
      '<div class="links"><span>Product</span><span>Templates</span><span>Pricing</span><span>Changelog</span></div>' +
      '<div class="right"><span style="color:#B9B7B0">Sign in</span><button class="btn btn-primary" data-cap="primary">Start free</button></div></nav>' +
      '<section class="hero"><div data-cap="hero"><span class="eyebrow"><b>New</b> Alerts that explain themselves</span>' +
      '<h1>Know which numbers moved. <em>And why.</em></h1>' +
      '<p class="lede">Tallyport connects to your warehouse and tells you what changed in revenue, retention and churn — before anyone asks.</p>' +
      '<div class="ctas"><button class="btn btn-primary" data-cap="cta">Start free trial ' + ic('arrow') + '</button><button class="btn">Book a demo</button></div>' +
      '<div class="trust">Trusted by data teams at<div class="marks"><span>Kestrelle</span><span>Halcyon</span><span>Oakline</span><span>Fernway</span></div></div></div>' +
      '<div class="device" data-cap="device"><div class="bar"><i></i><i></i><i></i></div><div class="inner"><div class="mini-kpis">' + mini + '</div>' +
      '<div class="card">' + lineChart(700, 260) + '</div></div></div></section></div>';
  }

  var RENDER = { landing: landing, home: home, search: search, report: report, editor: editor, success: success, settings: settings };
  var state = new URLSearchParams(location.search).get('state') || 'home';
  if (!RENDER[state]) state = 'home';
  document.documentElement.setAttribute('data-state', state);
  document.getElementById('app').innerHTML = RENDER[state]();

  var imgs = Array.prototype.slice.call(document.images);
  Promise.all(imgs.map(function (im) {
    return im.complete ? Promise.resolve() : new Promise(function (r) { im.onload = r; im.onerror = r; });
  })).then(function () { return document.fonts.ready; }).then(function () { window.__fixtureReady = true; });
})();
