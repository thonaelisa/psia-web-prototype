/* PSIA Website — SQUAD module (squad.js)
   Two views, both driven by window.PSIA_STORE:
     • register — players register for the next match + pick a position (GK/DF/MF/FW)
     • admin    — tactical board: pick a formation, drag registrants onto slots,
                  set up to 3 backups per slot, save the lineup.

   The router (app.js) renders an empty root for these views and then calls
   window.PSIA_AFTER_RENDER(view); this module fills that root and owns all of
   its own events. No backend assumptions — everything goes through PSIA_STORE. */
(function () {
  'use strict';

  var STORE = window.PSIA_STORE;
  var D = window.PSIA_DATA || {};

  /* The match we're working with. The site has a single "next" fixture, so we
     derive a stable id from it. (When you add multiple fixtures, pass real ids.) */
  function matchId() {
    var n = D.next || {};
    return 'next::' + (n.opp || 'match');
  }
  function matchLabel() {
    var n = D.next || {};
    return 'PSIA vs ' + (n.opp || 'TBD') + ' · ' + (n.dateLong || '');
  }

  var POS = ['GK', 'DF', 'MF', 'FW'];
  var POS_LABEL = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };

  /* ------------------------------------------------------------------
     ADMIN GATE (placeholder). This is a SOFT, client-side gate only — it
     keeps the board out of casual view, but the passcode ships in this file
     so it is NOT real security. Replace with proper auth when you add the
     backend (PSIA_STORE swap). Change the passcode here:               */
  var ADMIN_PASSCODE = 'psia2026';
  var UNLOCK_KEY = 'psia.admin.unlocked';
  function adminUnlocked() {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
  }
  function setUnlocked(v) {
    try { v ? sessionStorage.setItem(UNLOCK_KEY, '1') : sessionStorage.removeItem(UNLOCK_KEY); } catch (e) {}
  }

  /* ============================================================
     FORMATIONS (11v11). Lines run defence → attack.
     ============================================================ */
  var FORMATIONS = {
    '4-3-3':     [4, 3, 3],
    '4-4-2':     [4, 4, 2],
    '4-2-3-1':   [4, 2, 3, 1],
    '4-1-2-1-2': [4, 1, 2, 1, 2],
    '3-5-2':     [3, 5, 2],
    '3-4-3':     [3, 4, 3],
    '5-3-2':     [5, 3, 2],
    '4-5-1':     [4, 5, 1]
  };

  /* Build positioned slots for a formation. x,y are % of the pitch box;
     y grows downward (own goal at bottom). Slot ids are role+ordinal and are
     stable across formations, so assignments carry over where the slot exists. */
  function buildSlots(name) {
    var lines = FORMATIONS[name] || FORMATIONS['4-3-3'];
    var slots = [{ id: 'GK1', role: 'GK', x: 50, y: 91 }];
    var L = lines.length;
    var yTop = 16, yBot = 73;
    var counters = { DF: 0, MF: 0, FW: 0 };
    lines.forEach(function (count, li) {
      var y = L === 1 ? 45 : yBot - (yBot - yTop) * (li / (L - 1));
      var role = li === 0 ? 'DF' : (li === L - 1 ? 'FW' : 'MF');
      for (var i = 0; i < count; i++) {
        // even, centered spacing: a line of N sits at 1/(N+1) … N/(N+1) of the
        // width, so small lines (e.g. 2 forwards) stay central instead of wide.
        var x = (100 * (i + 1)) / (count + 1);
        counters[role] += 1;
        slots.push({ id: role + counters[role], role: role, x: x, y: y });
      }
    });
    return slots;
  }

  /* ============================================================
     Module state
     ============================================================ */
  var state = {
    user: null,          // signed-in account (set by the register view)
    regs: [],            // registrants for the match
    formation: '4-3-3',
    slots: {},           // slotId -> { starterId, backups:[ids] }
    selectedSlot: null,  // slotId currently open in the editor
    poolFilter: 'ALL',   // GK/DF/MF/FW/ALL
    poolQuery: ''
  };

  function regById(id) { return state.regs.find(function (r) { return r.id === id; }); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function emptySlots(name) {
    var o = {};
    buildSlots(name).forEach(function (s) { o[s.id] = { starterId: null, backups: [] }; });
    return o;
  }
  function root() { return document.getElementById('sqRoot'); }

  /* Which slot (if any) a player currently starts in. */
  function starterSlotOf(regId) {
    return Object.keys(state.slots).find(function (sid) {
      return state.slots[sid].starterId === regId;
    }) || null;
  }
  /* Which slot a player is assigned to at all — as starter OR backup. */
  function assignedSlotOf(regId) {
    return Object.keys(state.slots).find(function (sid) {
      var s = state.slots[sid];
      return s.starterId === regId || (s.backups || []).indexOf(regId) !== -1;
    }) || null;
  }

  /* ============================================================
     REGISTER view
     ============================================================ */
  function fixtureSummaryHTML() {
    var n = D.next || {};
    return '<section class="sec">' +
      '<div class="fixture"><div class="accent-strip"></div>' +
        '<div style="padding:22px 24px">' +
          '<div class="mono" style="color:var(--blue-light);letter-spacing:.08em;font-size:13px">NEXT FIXTURE</div>' +
          '<div style="font-size:22px;font-weight:800;margin-top:6px">PSIA vs ' + escapeHtml(n.opp || 'TBD') + '</div>' +
          '<div class="fx-meta" style="margin-top:8px"><span>🗓 ' + escapeHtml(n.dateLong || '') + '</span>' +
            '<span class="dot">·</span><span>📍 ' + escapeHtml(n.venue || '') + '</span>' +
            '<span class="dot">·</span><span class="mono">' + escapeHtml(n.fee || '') + '</span></div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  /* Registration requires a signed-in account, so the view has two states:
     a sign-in gate (logged out) and the one-tap form (logged in). */
  function renderRegister() {
    var el = root();
    if (!el) return;
    el.innerHTML = '<div class="page-head"><h1>Register for the match</h1><p class="muted-sm">Loading…</p></div>';
    var AUTH = window.PSIA_AUTH;
    (AUTH ? AUTH.refresh() : Promise.resolve(null)).then(function (user) {
      state.user = user || null;
      if (!root()) return;            // navigated away while loading
      if (!state.user) renderRegisterGate();
      else renderRegisterForm(state.user);
    });
  }

  function renderRegisterGate() {
    var el = root();
    if (!el) return;
    el.innerHTML =
      '<div class="page-head"><h1>Register for the match</h1>' +
      '<p>Sign in to put your name down — once you have an account, registering is a single tap.</p></div>' +
      fixtureSummaryHTML() +
      '<section class="sec last"><div class="gate">' +
        '<div class="gate-icon">👤</div>' +
        '<div class="gate-title">Sign in to register</div>' +
        '<p class="muted-sm" style="margin:0 0 18px">Your profile holds your name and usual position, so you never have to type them in again.</p>' +
        '<div class="gate-actions"><button class="btn btn-primary lk" data-view="account">Sign in or create account →</button></div>' +
      '</div></section>';
  }

  function renderRegisterForm(user) {
    var el = root();
    if (!el) return;
    el.innerHTML =
      '<div class="page-head"><h1>Register for the match</h1>' +
      '<p>Signed in as <b>' + escapeHtml(user.name) + '</b>. Confirm your spot below — switch position or add a note only if you need to.</p></div>' +
      fixtureSummaryHTML() +
      '<section class="sec">' +
        '<div class="shead"><span class="num">01</span><span class="lbl">Your call-up</span></div>' +
        '<div class="reg-form">' +
          '<div class="fld"><span>Player</span>' +
            '<div class="acct-readout"><span class="acct-name">' + escapeHtml(user.name) + '</span>' +
              '<span class="lk acct-edit" data-view="account">edit profile</span></div></div>' +
          '<div class="fld"><span>Position <em>(defaults to your usual)</em></span>' +
            '<div class="poschips" id="regPos">' +
              POS.map(function (p) {
                return '<button type="button" class="poschip" data-sq-pos="' + p + '">' +
                  '<b>' + p + '</b><i>' + POS_LABEL[p] + '</i></button>';
              }).join('') +
            '</div></div>' +
          '<label class="fld"><span>Note <em>(optional)</em></span>' +
            '<input id="regNote" type="text" maxlength="80" placeholder="e.g. can only play first half" /></label>' +
          '<div class="reg-actions">' +
            '<button type="button" class="btn btn-primary" id="regSubmit">Register →</button>' +
            '<span class="reg-msg" id="regMsg"></span>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="sec last">' +
        '<div class="shead"><span class="num gold">02</span><span class="lbl">Registered so far</span>' +
          '<span class="link" id="regCount"></span></div>' +
        '<div id="regList"></div>' +
      '</section>';

    bindPosChips(el, user.position);   // preselect the player's usual position
    loadRegList();
  }

  function bindPosChips(el, initial) {
    var chips = el.querySelectorAll('#regPos .poschip');
    chips.forEach(function (c) {
      c.classList.toggle('on', c.getAttribute('data-sq-pos') === initial);
    });
  }
  function selectedRegPos() {
    var on = document.querySelector('#regPos .poschip.on');
    return on ? on.getAttribute('data-sq-pos') : null;
  }

  function loadRegList() {
    STORE.getRegistrations(matchId()).then(function (rows) {
      state.regs = rows;
      var wrap = document.getElementById('regList');
      var count = document.getElementById('regCount');
      if (count) count.textContent = rows.length + ' player' + (rows.length === 1 ? '' : 's');
      if (!wrap) return;
      if (!rows.length) {
        wrap.innerHTML = '<div class="emptybox">No one has registered yet — be the first.</div>';
        return;
      }
      wrap.innerHTML = POS.map(function (p) {
        var group = rows.filter(function (r) { return r.position === p; });
        if (!group.length) return '';
        return '<div class="reggroup"><div class="reggroup-h"><span class="poschip-mini ' + p + '">' + p +
          '</span> ' + POS_LABEL[p] + 's <span class="cnt">' + group.length + '</span></div>' +
          '<div class="reggroup-body">' + group.map(function (r) {
            return '<div class="regrow"><span class="rn">' + escapeHtml(r.name) + '</span>' +
              (r.note ? '<span class="rnote">' + escapeHtml(r.note) + '</span>' : '') +
              '<button class="x" data-sq-unreg="' + r.id + '" title="Remove">✕</button></div>';
          }).join('') + '</div></div>';
      }).join('');
    });
  }

  function submitRegistration() {
    var msg = document.getElementById('regMsg');
    function fail(t) { if (msg) { msg.textContent = t; msg.className = 'reg-msg err'; } }
    var user = state.user || (window.PSIA_AUTH && window.PSIA_AUTH.user);
    if (!user) return fail('Please sign in first.');
    var note = (document.getElementById('regNote') || {}).value || '';
    var pos = selectedRegPos() || user.position;   // falls back to profile default
    if (!pos) return fail('Pick a position.');
    STORE.register({ matchId: matchId(), name: user.name, position: pos, note: note, accountId: user.id })
      .then(function () {
        if (msg) { msg.textContent = '✓ You\'re on the list (' + pos + ').'; msg.className = 'reg-msg ok'; }
        var nt = document.getElementById('regNote'); if (nt) nt.value = '';
        loadRegList();
      })
      .catch(function (e) { fail(e.message || 'Could not register.'); });
  }

  /* ============================================================
     ADMIN tactical board
     ============================================================ */
  function renderGate(errored) {
    var el = root();
    if (!el) return;
    el.innerHTML =
      '<div class="page-head"><h1>Team selection</h1>' +
      '<p>This area is for the coaching staff. Enter the access code to build the call-up list.</p></div>' +
      '<section class="sec last"><div class="gate">' +
        '<div class="gate-icon">🔒</div>' +
        '<div class="gate-title">Staff access</div>' +
        '<label class="fld" style="max-width:280px;margin:0 auto">' +
          '<span>Access code</span>' +
          '<input id="gateInput" type="password" autocomplete="off" placeholder="Enter code" />' +
        '</label>' +
        '<div class="gate-actions"><button class="btn btn-primary" id="gateBtn">Unlock →</button></div>' +
        (errored ? '<div class="reg-msg err" style="margin-top:6px">Incorrect code — try again.</div>' : '') +
      '</div></section>';
    var inp = document.getElementById('gateInput');
    if (inp) inp.focus();
  }

  function tryUnlock() {
    var inp = document.getElementById('gateInput');
    var val = inp ? inp.value : '';
    if (val === ADMIN_PASSCODE) { setUnlocked(true); renderAdmin(); }
    else renderGate(true);
  }

  function renderAdmin() {
    var el = root();
    if (!el) return;
    if (!adminUnlocked()) { renderGate(false); return; }
    el.innerHTML =
      '<div class="page-head"><h1>Team selection</h1>' +
      '<p>Pick a formation, then drag registered players onto the pitch. Click any ' +
      'position to set up to three backups.</p>' +
      '<div style="margin-top:14px;display:flex;gap:20px;flex-wrap:wrap">' +
        '<span class="lk backlink" data-view="manage">← Back to Manage</span>' +
        '<span class="lk backlink" data-view="payments">Payments →</span></div></div>' +
      '<div id="boardWrap"></div>';
    // load saved lineup (or start fresh) + registrants together
    Promise.all([STORE.getRegistrations(matchId()), STORE.getLineup(matchId())])
      .then(function (res) {
        state.regs = res[0];
        var saved = res[1];
        if (saved && saved.formation && FORMATIONS[saved.formation]) {
          state.formation = saved.formation;
          state.slots = mergeSlots(saved.formation, saved.slots || {});
        } else {
          state.slots = emptySlots(state.formation);
        }
        state.selectedSlot = null;
        renderBoard();
      });
  }

  /* Ensure the slot map matches the formation's slot ids exactly. */
  function mergeSlots(name, existing) {
    var fresh = emptySlots(name);
    Object.keys(fresh).forEach(function (sid) {
      if (existing[sid]) {
        fresh[sid].starterId = existing[sid].starterId || null;
        fresh[sid].backups = (existing[sid].backups || []).slice(0, 3);
      }
    });
    return fresh;
  }

  /* Fixed banner so the admin always knows WHICH match this team is for.
     The registered count is live — it reflects state.regs for this match. */
  function matchBannerHTML() {
    var n = D.next || {};
    var count = state.regs.length;
    return '<div class="match-banner">' +
      '<div class="accent-strip"></div>' +
      '<div class="mb-body">' +
        '<div class="mb-main">' +
          '<div class="mono mb-tag">SELECTING TEAM FOR</div>' +
          '<div class="mb-title">PSIA vs ' + escapeHtml(n.opp || 'TBD') + '</div>' +
          '<div class="fx-meta mb-meta">' +
            '<span>🗓 ' + escapeHtml(n.dateLong || 'Date TBD') + '</span>' +
            (n.venue ? '<span class="dot">·</span><span>📍 ' + escapeHtml(n.venue) + '</span>' : '') +
            (n.format ? '<span class="dot">·</span><span>' + escapeHtml(n.format) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="mb-count"><b>' + count + '</b><span>registered</span></div>' +
      '</div>' +
    '</div>';
  }

  function renderBoard() {
    var wrap = document.getElementById('boardWrap');
    if (!wrap) return;
    wrap.innerHTML =
      matchBannerHTML() +
      '<div class="board-toolbar">' +
        '<div class="tb-left">' +
          '<label class="tb-formation">Formation' +
            '<select id="formationSel">' +
              Object.keys(FORMATIONS).map(function (f) {
                return '<option value="' + f + '"' + (f === state.formation ? ' selected' : '') + '>' + f + '</option>';
              }).join('') +
            '</select></label>' +
          '<span class="tb-count" id="tbCount"></span>' +
        '</div>' +
        '<div class="tb-right">' +
          '<button class="btn btn-glass btn-sm" id="seedBtn" title="Fill the registrant list from the player database">Seed demo squad</button>' +
          '<button class="btn btn-glass btn-sm" id="resetBtn">Reset board</button>' +
          '<button class="btn btn-primary btn-sm" id="saveBtn">Save lineup</button>' +
          '<button class="btn-lock" id="lockBtn" title="Lock this page">🔒</button>' +
          '<span class="reg-msg" id="boardMsg"></span>' +
        '</div>' +
      '</div>' +
      '<div class="board-grid">' +
        '<div class="pitch-col">' + pitchHTML() + '</div>' +
        '<div class="pool-col">' + poolHTML() + '</div>' +
      '</div>' +
      slotEditorHTML();
    updateCount();
  }

  function pitchHTML() {
    var slots = buildSlots(state.formation);
    var nodes = slots.map(function (s) {
      var a = state.slots[s.id] || { starterId: null, backups: [] };
      var reg = a.starterId ? regById(a.starterId) : null;
      var filled = !!reg;
      var mismatch = reg && reg.position !== s.role && s.role !== 'GK' ? ' mismatch' : '';
      var sel = state.selectedSlot === s.id ? ' selected' : '';
      var names = [];
      if (reg) names.push(shortName(reg.name));
      (a.backups || []).forEach(function (bid) { var br = regById(bid); if (br) names.push(shortName(br.name)); });
      var depth = (a.backups || []).filter(Boolean).length;
      var label = names.length ? names.join(' / ') : s.role;
      return '<button class="slot ' + s.role + (filled ? ' filled' : '') + mismatch + sel +
        '" data-sq-slot="' + s.id + '" style="left:' + s.x + '%;top:' + s.y + '%">' +
        '<span class="slot-role">' + s.role + '</span>' +
        '<span class="slot-name">' + escapeHtml(label) + '</span>' +
        (depth ? '<span class="slot-depth" title="' + depth + ' backup' + (depth > 1 ? 's' : '') + '">+' + depth + '</span>' : '') +
        '</button>';
    }).join('');
    return '<div class="pitch"><div class="pitch-lines">' +
      '<div class="pl-center"></div><div class="pl-circle"></div>' +
      '<div class="pl-box pl-box-top"></div><div class="pl-box pl-box-bot"></div>' +
      '</div>' + nodes + '</div>';
  }

  function shortName(name) {
    var parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
  }

  function poolHTML() {
    var filt = state.poolFilter, q = state.poolQuery.toLowerCase();
    var filterBtns = ['ALL'].concat(POS).map(function (p) {
      return '<button class="poolfilt' + (filt === p ? ' on' : '') + '" data-sq-filt="' + p + '">' + p + '</button>';
    }).join('');
    var rows = state.regs.filter(function (r) {
      if (filt !== 'ALL' && r.position !== filt) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var list = rows.length ? rows.map(function (r) {
      var atSlot = assignedSlotOf(r.id);
      var isStarter = starterSlotOf(r.id);
      var used = atSlot ? ' used' : '';
      return '<div class="poolchip ' + r.position + used + '" draggable="true" data-sq-reg="' + r.id + '">' +
        '<span class="pc-pos">' + r.position + '</span>' +
        '<span class="pc-name">' + escapeHtml(r.name) + '</span>' +
        (atSlot ? '<span class="pc-tag">' + atSlot + (isStarter ? '' : ' · sub') + '</span>' : '') +
        '</div>';
    }).join('') : '<div class="emptybox sm">No registrants match. ' +
      (state.regs.length ? 'Try another filter.' : 'Use “Seed demo squad” or have players register.') + '</div>';

    return '<div class="pool">' +
      '<div class="pool-head"><b>Registered players</b><span class="cnt">' + state.regs.length + '</span></div>' +
      '<input class="pool-search" id="poolSearch" type="text" placeholder="Search name…" value="' + escapeHtml(state.poolQuery) + '" />' +
      '<div class="pool-filters">' + filterBtns + '</div>' +
      '<div class="pool-list">' + list + '</div>' +
      '<div class="pool-hint">Drag a name onto an empty position to set the starter; drag more onto the same position to stack backups (A / B). Click a position to manage it.</div>' +
      '</div>';
  }

  function slotEditorHTML() {
    var sid = state.selectedSlot;
    if (!sid) return '';
    var slots = buildSlots(state.formation);
    var meta = slots.find(function (s) { return s.id === sid; });
    if (!meta) return '';
    var a = state.slots[sid] || { starterId: null, backups: [] };
    var starter = a.starterId ? regById(a.starterId) : null;

    var backupRows = (a.backups || []).map(function (id, i) {
      var r = regById(id);
      if (!r) return '';
      return '<div class="depthrow"><span class="depth-i">' + (i + 1) + '</span>' +
        '<span class="poschip-mini ' + r.position + '">' + r.position + '</span>' +
        '<span class="depth-n">' + escapeHtml(r.name) + '</span>' +
        '<button class="x" data-sq-rmbackup="' + id + '">✕</button></div>';
    }).join('');

    // candidates to add: same-role registrants not already starter/backup here
    var used = {};
    if (a.starterId) used[a.starterId] = 1;
    (a.backups || []).forEach(function (b) { used[b] = 1; });
    var cands = state.regs.filter(function (r) {
      if (used[r.id]) return false;
      return meta.role === 'GK' ? r.position === 'GK' : (r.position === meta.role);
    });
    var canAddMore = (a.backups || []).length < 3;

    return '<div class="slot-editor" id="slotEditor">' +
      '<div class="se-head"><div><span class="se-role ' + meta.role + '">' + meta.role + '</span>' +
        '<b>Position ' + sid + '</b></div>' +
        '<button class="se-close" data-sq-closeeditor="1">Done</button></div>' +
      '<div class="se-body">' +
        '<div class="se-block"><div class="se-label">Starter</div>' +
          (starter
            ? '<div class="depthrow starter"><span class="poschip-mini ' + starter.position + '">' + starter.position + '</span>' +
              '<span class="depth-n">' + escapeHtml(starter.name) + '</span>' +
              (starter.position !== meta.role && meta.role !== 'GK' ? '<span class="mm">off-position</span>' : '') +
              '<button class="x" data-sq-clearstarter="1">✕</button></div>'
            : '<div class="emptybox sm">Drag a player here, or pick one below.</div>') +
        '</div>' +
        '<div class="se-block"><div class="se-label">Backups <em>(' + (a.backups || []).length + '/3)</em></div>' +
          (backupRows || '<div class="muted-sm">No backups yet.</div>') +
        '</div>' +
        '<div class="se-block"><div class="se-label">Add ' + (meta.role === 'GK' ? 'goalkeeper' : POS_LABEL[meta.role].toLowerCase() + 's') + '</div>' +
          '<div class="se-cands">' +
            (cands.length ? cands.map(function (r) {
              return '<button class="candchip" data-sq-add="' + r.id + '">' +
                '<span class="pc-name">' + escapeHtml(r.name) + '</span>' +
                '<span class="add-as">' + (starter ? (canAddMore ? '+ backup' : 'set starter') : 'set starter') + '</span>' +
                '</button>';
            }).join('') : '<div class="muted-sm">No registered ' + meta.role + ' available. Drag any player on instead.</div>') +
          '</div>' +
        '</div>' +
      '</div></div>';
  }

  function updateCount() {
    var filled = Object.keys(state.slots).filter(function (sid) { return state.slots[sid].starterId; }).length;
    var c = document.getElementById('tbCount');
    if (c) {
      c.innerHTML = '<b>' + filled + '</b>/11 starters';
      c.classList.toggle('full', filled === 11);
    }
  }

  /* ---- board mutations ---- */
  /* Remove a player from every slot (starter or backup) so they appear once. */
  function detach(regId) {
    Object.keys(state.slots).forEach(function (sid) {
      var s = state.slots[sid];
      if (s.starterId === regId) s.starterId = null;
      s.backups = (s.backups || []).filter(function (b) { return b !== regId; });
    });
  }
  /* Drop a dragged player onto a slot: first one becomes the starter, any
     further drops on the SAME slot stack underneath as backups (A / B / C). */
  function dropOnSlot(slotId, regId) {
    if (!state.slots[slotId]) state.slots[slotId] = { starterId: null, backups: [] };
    var s = state.slots[slotId];
    if (s.starterId === regId) return;               // already the starter here
    if ((s.backups || []).indexOf(regId) !== -1) return; // already a backup here
    if (!s.starterId) {
      detach(regId);
      state.slots[slotId].starterId = regId;
    } else {
      if ((s.backups || []).length >= 3) return;      // cap at 3 backups
      detach(regId);
      state.slots[slotId].backups.push(regId);
    }
    renderBoard();
  }
  function assignStarter(slotId, regId) {
    // a player can only start in one slot
    var prev = starterSlotOf(regId);
    if (prev && prev !== slotId) state.slots[prev].starterId = null;
    if (!state.slots[slotId]) state.slots[slotId] = { starterId: null, backups: [] };
    // remove from backups of this slot if present
    state.slots[slotId].backups = (state.slots[slotId].backups || []).filter(function (b) { return b !== regId; });
    state.slots[slotId].starterId = regId;
    renderBoard();
  }
  function clearStarter(slotId) {
    if (state.slots[slotId]) state.slots[slotId].starterId = null;
    renderBoard();
  }
  function addBackup(slotId, regId) {
    var s = state.slots[slotId];
    if (!s) return;
    if (!s.starterId) { assignStarter(slotId, regId); return; }
    if (s.starterId === regId) return;
    s.backups = (s.backups || []).filter(function (b) { return b !== regId; });
    if (s.backups.length >= 3) return;
    s.backups.push(regId);
    renderBoard();
  }
  function removeBackup(slotId, regId) {
    var s = state.slots[slotId];
    if (!s) return;
    s.backups = (s.backups || []).filter(function (b) { return b !== regId; });
    renderBoard();
  }

  function changeFormation(name) {
    state.formation = name;
    state.slots = mergeSlots(name, state.slots);
    state.selectedSlot = null;
    renderBoard();
  }

  function saveLineup() {
    var msg = document.getElementById('boardMsg');
    STORE.saveLineup(matchId(), { formation: state.formation, slots: state.slots })
      .then(function () {
        if (msg) { msg.textContent = '✓ Saved'; msg.className = 'reg-msg ok'; }
        setTimeout(function () { if (msg) msg.textContent = ''; }, 2500);
      })
      .catch(function (e) {
        if (msg) { msg.textContent = e.message || 'Save failed'; msg.className = 'reg-msg err'; }
      });
  }
  function resetBoard() {
    state.slots = emptySlots(state.formation);
    state.selectedSlot = null;
    renderBoard();
  }
  function seedDemo() {
    STORE.seedDemo(matchId()).then(function () {
      return STORE.getRegistrations(matchId());
    }).then(function (rows) {
      state.regs = rows;
      renderBoard();
    });
  }

  /* ============================================================
     Events (delegated, attached once)
     ============================================================ */
  function withinSquad(t) { return t && t.closest && t.closest('#sqRoot'); }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!withinSquad(t)) return;

    // --- register view ---
    var pos = t.closest('[data-sq-pos]');
    if (pos) {
      document.querySelectorAll('#regPos .poschip').forEach(function (c) { c.classList.remove('on'); });
      pos.classList.add('on');
      return;
    }
    if (t.closest('#regSubmit')) { submitRegistration(); return; }
    var unreg = t.closest('[data-sq-unreg]');
    if (unreg) { STORE.unregister(unreg.getAttribute('data-sq-unreg')).then(loadRegList); return; }

    // --- admin gate ---
    if (t.closest('#gateBtn')) { tryUnlock(); return; }
    if (t.closest('#lockBtn')) { setUnlocked(false); renderGate(false); return; }

    // --- board: toolbar ---
    if (t.closest('#saveBtn')) { saveLineup(); return; }
    if (t.closest('#resetBtn')) { resetBoard(); return; }
    if (t.closest('#seedBtn')) { seedDemo(); return; }

    // --- board: pool filters ---
    var filt = t.closest('[data-sq-filt]');
    if (filt) { state.poolFilter = filt.getAttribute('data-sq-filt'); renderBoard(); return; }

    // --- board: select a slot ---
    var slot = t.closest('[data-sq-slot]');
    if (slot) {
      var sid = slot.getAttribute('data-sq-slot');
      state.selectedSlot = state.selectedSlot === sid ? null : sid;
      renderBoard();
      var ed = document.getElementById('slotEditor');
      if (ed && ed.scrollIntoView) ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    // --- slot editor actions ---
    if (t.closest('[data-sq-closeeditor]')) { state.selectedSlot = null; renderBoard(); return; }
    if (t.closest('[data-sq-clearstarter]')) { if (state.selectedSlot) clearStarter(state.selectedSlot); return; }
    var rmb = t.closest('[data-sq-rmbackup]');
    if (rmb && state.selectedSlot) { removeBackup(state.selectedSlot, rmb.getAttribute('data-sq-rmbackup')); return; }
    var add = t.closest('[data-sq-add]');
    if (add && state.selectedSlot) {
      var rid = add.getAttribute('data-sq-add');
      var s = state.slots[state.selectedSlot];
      if (s && !s.starterId) assignStarter(state.selectedSlot, rid);
      else addBackup(state.selectedSlot, rid);
      return;
    }
  });

  document.addEventListener('input', function (e) {
    if (!withinSquad(e.target)) return;
    if (e.target.id === 'poolSearch') {
      state.poolQuery = e.target.value;
      // re-render only the pool list to keep focus
      var listWrap = document.querySelector('#sqRoot .pool-list');
      if (listWrap) {
        var tmp = document.createElement('div');
        tmp.innerHTML = poolHTML();
        var fresh = tmp.querySelector('.pool-list');
        if (fresh) listWrap.innerHTML = fresh.innerHTML;
      }
    }
  });

  /* drag + drop */
  var dragRegId = null;
  document.addEventListener('dragstart', function (e) {
    var chip = e.target.closest && e.target.closest('[data-sq-reg]');
    if (!chip || !withinSquad(chip)) return;
    dragRegId = chip.getAttribute('data-sq-reg');
    chip.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', dragRegId); e.dataTransfer.effectAllowed = 'move'; } catch (x) {}
  });
  document.addEventListener('dragend', function (e) {
    var chip = e.target.closest && e.target.closest('[data-sq-reg]');
    if (chip) chip.classList.remove('dragging');
    document.querySelectorAll('#sqRoot .slot.drop-hot').forEach(function (s) { s.classList.remove('drop-hot'); });
    dragRegId = null;
  });
  document.addEventListener('dragover', function (e) {
    var slot = e.target.closest && e.target.closest('[data-sq-slot]');
    if (!slot || !withinSquad(slot)) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
    slot.classList.add('drop-hot');
  });
  document.addEventListener('dragleave', function (e) {
    var slot = e.target.closest && e.target.closest('[data-sq-slot]');
    if (slot) slot.classList.remove('drop-hot');
  });
  document.addEventListener('drop', function (e) {
    var slot = e.target.closest && e.target.closest('[data-sq-slot]');
    if (!slot || !withinSquad(slot)) return;
    e.preventDefault();
    var id = dragRegId;
    try { id = e.dataTransfer.getData('text/plain') || dragRegId; } catch (x) {}
    if (id) dropOnSlot(slot.getAttribute('data-sq-slot'), id);
    dragRegId = null;
  });

  document.addEventListener('change', function (e) {
    if (!withinSquad(e.target)) return;
    if (e.target.id === 'formationSel') changeFormation(e.target.value);
  });


  // Enter key submits the registration form
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (!withinSquad(e.target)) return;
    if (e.target.id === 'regName' || e.target.id === 'regNote') { e.preventDefault(); submitRegistration(); }
    else if (e.target.id === 'gateInput') { e.preventDefault(); tryUnlock(); }
  });

  /* ============================================================
     Hook into the router
     ============================================================ */
  window.PSIA_EXTRA_VIEWS = window.PSIA_EXTRA_VIEWS || {};
  window.PSIA_EXTRA_VIEWS.register = function () { return '<div id="sqRoot" class="sqRoot"></div>'; };
  window.PSIA_EXTRA_VIEWS.admin = function () { return '<div id="sqRoot" class="sqRoot"></div>'; };

  var prevAfter = window.PSIA_AFTER_RENDER;
  window.PSIA_AFTER_RENDER = function (view) {
    if (typeof prevAfter === 'function') prevAfter(view);
    if (view === 'register') renderRegister();
    else if (view === 'admin') renderAdmin();
  };
})();
