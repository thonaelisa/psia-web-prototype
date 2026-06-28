/* PSIA Website — REGISTER module (register.js)
   ------------------------------------------------------------------
   The Register page, redesigned as an immersive broadcast "call-up" flow
   that mirrors the register mockup:

     • immersive hero (registerphoto1) with a scorebug for the picked match
     • 01 Pick a match  — horizontal card row, click to select
     • selected-fixture strip with a live DD:HH:MM:SS countdown
     • 02 Your call-up  — one-tap registration (signed-in), position + note
     • 03 Squad         — live list of who's registered for THAT match
     • season results   — the existing all-results table, kept below

   This module OVERRIDES the old `matches` view in app.js. It registers
   itself through window.PSIA_EXTRA_VIEWS (which app.js merges over its own
   VIEWS map) and fills its root from window.PSIA_AFTER_RENDER, owning all
   of its own state + events. Registration/squad go through PSIA_STORE and
   PSIA_AUTH, so a real backend swaps in without touching this file.

   This OVERRIDES the old `register` view (squad.js's plain form). It registers
   through window.PSIA_EXTRA_VIEWS.register (merged over app.js's VIEWS) and
   fills its root from window.PSIA_AFTER_RENDER, owning its own state + events.
   Registration/squad go through PSIA_STORE and PSIA_AUTH.

   --- FIXTURES -------------------------------------------------------
   The first card is the REAL next fixture (derived from PSIA_DATA.next).
   The others are SAMPLE upcoming fixtures so the picker looks full — edit
   or remove them in SAMPLE_FIXTURES below as real fixtures are added. The
   real fixture's matchId matches squad.js ('next::' + opp) so registrations
   stay consistent across the site. */
(function () {
  'use strict';

  var STORE = window.PSIA_STORE;
  var D = window.PSIA_DATA || {};
  var RMAP = { win: 'WIN', draw: 'DRAW', loss: 'LOSS' };

  var CAP_DEFAULT = (D.next && D.next.slots) || 16;
  var POS = ['GK', 'DF', 'MF', 'FW'];
  var POS_LABEL = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };
  var POS_THEME = {
    GK: { color: '#F5C542', border: '#5A4A12', bg: '#2A2410' },
    DF: { color: '#5C95F5', border: '#2F5BB0', bg: '#0E1D3A' },
    MF: { color: '#36D27B', border: '#1E5237', bg: '#11271B' },
    FW: { color: '#F0584B', border: '#5A2420', bg: '#2A1412' }
  };
  var AVATAR = ['#7A3D1E', '#1E5A4A', '#5A4A12', '#3D2E7A', '#7A1E3D', '#1E3F7A', '#2E5A7A', '#5A2440', '#1E5A2E'];
  var MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    return String(name || '').trim().split(/\s+/).map(function (w) { return w[0]; })
      .slice(0, 2).join('').toUpperCase();
  }
  function rpFmt(n) { var v = Math.round(+n || 0); return 'Rp ' + Math.abs(v).toLocaleString('en-US'); }
  function payFeeNum(fx) { return parseInt(String((fx && fx.fee) || '').replace(/[^\d]/g, ''), 10) || 0; }

  /* Player-facing payment status for the signed-in user's own call-up.
     Two ways to pay: claim a cash/transfer payment, or request that the fee be
     taken from their saldo (only offered when the balance covers it). Either
     way the committee confirms on the admin Payments page. */
  function payStripHTML(mine, fx) {
    if (!mine) return '';
    var st = mine.payStatus || 'unpaid';
    var u = state.user || {};
    var saldo = (typeof u.saldo === 'number') ? u.saldo : (+u.saldo || 0);
    var fee = payFeeNum(fx);
    var box = function (border, bg, inner) {
      return '<div style="margin-top:18px;padding:14px 16px;border:1px solid ' + border + ';background:' + bg + ';border-radius:11px;font-size:13px;line-height:1.5">' + inner + '</div>';
    };
    if (st === 'paid') {
      var amt = mine.payAmount ? ' · <b style="font-family:var(--mono)">' + rpFmt(mine.payAmount) + '</b>' : '';
      var via = mine.payMethod === 'saldo' ? ' from your saldo' : '';
      return box('#1E5237', 'rgba(54,210,123,.08)',
        '<span style="color:#36D27B;font-weight:700">✓ Payment confirmed</span>' + amt + via +
        ' <span style="color:#5E6A82">— thanks!</span>');
    }
    if (st === 'claimed') {
      var sal = mine.payMethod === 'saldo';
      var head = sal ? 'Saldo payment requested.' : 'Payment claim sent.';
      var sub = sal ? 'The committee will confirm and deduct it from your balance.' : 'Waiting for the committee to confirm.';
      return box('#5A4A12', 'rgba(245,197,66,.08)',
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
          '<span><span style="color:#F5C542;font-weight:700">' + head + '</span> <span style="color:#9DAAC0">' + sub + '</span></span>' +
          '<span class="lk" data-mt-unclaim="1" style="color:#9DAAC0;font-weight:700;font-size:12px;white-space:nowrap">Undo</span>' +
        '</div>');
    }
    var feeTxt = fx.fee ? ' (' + escapeHtml(fx.fee) + ')' : '';
    var cashBtn = '<span class="lk" data-mt-claim="1" style="background:#3D7BF0;color:#fff;font-weight:800;font-size:13px;padding:9px 16px;border-radius:9px;white-space:nowrap">I\'ve paid →</span>';
    var saldoBtn = (fee > 0 && saldo >= fee)
      ? '<span class="lk" data-mt-claim-saldo="1" style="background:#1E5237;border:1px solid #36D27B;color:#EAFBF0;font-weight:800;font-size:13px;padding:9px 16px;border-radius:9px;white-space:nowrap">Pay from saldo →</span>'
      : '';
    var saldoNote = (fee > 0 && saldo < fee)
      ? '<div style="margin-top:8px;font-size:11.5px;color:#5E6A82;font-family:var(--mono)">Saldo ' + rpFmt(saldo) + ' — not enough to cover this fee</div>'
      : '';
    return box('#25324A', '#0A1326',
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
        '<span style="color:#9DAAC0">Already paid your match fee' + feeTxt + '?</span>' +
        '<span style="display:flex;gap:10px;flex-wrap:wrap">' + saldoBtn + cashBtn + '</span>' +
      '</div>' + saldoNote);
  }

  /* Parse "SAT · 28 JUN 2026 · 20:00" → epoch ms (Asia/Jakarta, +07:00). */
  function parseDateLong(s) {
    var m = String(s || '').match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})[^\d]*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var mo = MONTHS[m[2].toUpperCase()];
    if (mo == null) return null;
    var t = new Date(m[3] + '-' + pad(mo + 1) + '-' + pad(+m[1]) + 'T' + pad(+m[4]) + ':' + m[5] + ':00+07:00').getTime();
    return isNaN(t) ? null : t;
  }

  /* Split the site's own "DOW · DD MON YYYY · HH:MM" label into card bits, so
     the Matches page shows exactly what the rest of the site shows (we don't
     re-derive the weekday — the authored label wins). */
  function labelsFromNext(n) {
    var dl = String(n.dateLong || '');                 // "SAT · 28 JUN 2026 · 20:00"
    var parts = dl.split('·').map(function (s) { return s.trim(); });
    var dow = (parts[0] || '').toUpperCase();
    var mid = (parts[1] || '').split(/\s+/);            // ["28","JUN","2026"]
    var time = parts[2] || '';
    return {
      dow: dow || '', day: mid[0] || '', mon: (mid[1] || '').toUpperCase(),
      time: time, short: n.dateShort || (dow + ' · ' + time), date: dl
    };
  }

  /* ---- SAMPLE fixtures (edit / remove as real fixtures are added). The
     dates are real Saturdays so weekday + date stay consistent. ---- */
  var SAMPLE_FIXTURES = [
    { opp: 'Banteng FC', abbr: 'BTG', dow: 'SAT', day: '04', mon: 'JUL', year: 2026, time: '20:00',
      target: '2026-07-04T20:00:00+07:00', venue: 'Lapangan Saraga', format: '7v7', fee: 'Rp 50.000', slots: 16 },
    { opp: 'Merpati United', abbr: 'MRP', dow: 'SAT', day: '11', mon: 'JUL', year: 2026, time: '20:00',
      target: '2026-07-11T20:00:00+07:00', venue: 'GOR Pajajaran', format: '7v7', fee: 'Rp 45.000', slots: 16 }
  ];

  /* Real next fixture (from PSIA_DATA.next) + samples → unified list. */
  function buildFixtures() {
    var list = [];
    var n = D.next;
    if (n && n.opp) {
      list.push(Object.assign({
        opp: n.opp, abbr: n.oppAbbr || n.opp.slice(0, 3).toUpperCase(),
        ms: parseDateLong(n.dateLong) || (Date.now() + 7 * 86400000),
        venue: n.venue || '', format: n.format || '7v7',
        fee: n.fee || '', slots: n.slots || CAP_DEFAULT, sample: false
      }, labelsFromNext(n)));
    }
    SAMPLE_FIXTURES.forEach(function (s) {
      list.push({
        opp: s.opp, abbr: s.abbr, ms: new Date(s.target).getTime(),
        venue: s.venue, format: s.format, fee: s.fee, slots: s.slots, sample: true,
        dow: s.dow, day: s.day, mon: s.mon, time: s.time,
        short: s.dow + ' · ' + s.time,
        date: s.dow + ' · ' + s.day + ' ' + s.mon + ' ' + s.year + ' · ' + s.time
      });
    });
    return list;
  }

  function matchIdFor(fx) { return 'next::' + fx.opp; }

  /* ============================================================
     State
     ============================================================ */
  var FIXTURES = buildFixtures();
  /* Expose so the admin Payments page reads the SAME fixtures + match ids that
     players register under (keeps "who registered" and "who paid" aligned). */
  window.PSIA_FIXTURES = FIXTURES;
  window.PSIA_MATCH_ID_FOR = matchIdFor;
  var state = {
    selected: 0,
    pos: null,          // chosen position for the form (null → user default)
    user: null,
    regs: [],           // registrations for the SELECTED match
    loadingRegs: false,
    msg: null           // { text, ok } feedback under the submit button
  };
  var cdTimer = null;

  function root() { return document.getElementById('matchRoot'); }
  function selFx() { return FIXTURES[state.selected] || FIXTURES[0]; }
  function cap(fx) { return fx.slots || CAP_DEFAULT; }
  function myReg() {
    var u = state.user; if (!u) return null;
    return state.regs.find(function (r) { return r.accountId && r.accountId === u.id; }) || null;
  }

  /* ============================================================
     Data loads
     ============================================================ */
  function loadRegs(then) {
    var fx = selFx();
    state.loadingRegs = true;
    STORE.getRegistrations(matchIdFor(fx)).then(function (rows) {
      // ignore if user switched matches mid-flight
      if (selFx() !== fx) return;
      state.regs = rows || [];
      state.loadingRegs = false;
      if (then) then();
    });
  }

  /* ============================================================
     Rendering
     ============================================================ */
  function render() {
    var el = root();
    if (!el) return;
    el.innerHTML = heroHTML() + pickHTML() + stripHTML() + gridHTML();
    startCountdown();
  }

  /* ---- immersive hero ---- */
  function heroHTML() {
    var fx = selFx();
    return '' +
      '<header class="hero hero-matches">' +
        '<img class="hero-photo" src="assets/img/registerphoto1.jpg" alt="PSIA matchday">' +
        '<div class="hero-ov1"></div><div class="hero-ov2"></div>' +
        '<div class="hero-inner">' +
          '<div class="scorebug">' +
            '<div class="tag">REGISTER</div>' +
            '<div class="body"><span class="h">PSIA</span><span class="vs">VS</span>' +
              '<span class="a">' + escapeHtml(fx.abbr) + '</span><span class="div"></span>' +
              '<span class="time">' + escapeHtml(fx.short) + '</span></div>' +
          '</div>' +
          '<div class="lower-third">' +
            '<div class="hero-eyebrow"><span class="bar"></span>MATCHDAY · CONFIRM YOUR SPOT</div>' +
            '<h1 class="hero-h1">Register</h1>' +
            '<p class="hero-sub">Pick a match below, confirm your call-up in one tap, and watch the squad fill up live. Switch position or leave a note only if you need to.</p>' +
          '</div>' +
        '</div>' +
      '</header>';
  }

  /* ---- 01 pick a match (horizontal cards) ---- */
  function pickHTML() {
    var cards = FIXTURES.map(function (fx, i) {
      var isSel = i === state.selected;
      // live fill uses the selected match's loaded regs; others show capacity only
      var filled = isSel ? state.regs.length : null;
      var C = cap(fx);
      var pct = filled == null ? 0 : Math.min(100, Math.round((filled / C) * 100));
      var full = filled != null && filled >= C;
      var tag = isSel ? 'SELECTED' : (fx.sample ? 'SAMPLE' : 'OPEN');
      var tcol = isSel ? ['#fff', '#3D7BF0', '#3D7BF0']
        : (fx.sample ? ['#9DAAC0', '#2C3A55', '#0E1626'] : ['#36D27B', '#1E5237', '#11271B']);
      var cardStyle = 'flex:0 0 248px;border-radius:14px;padding:18px 18px 20px;cursor:pointer;transition:.18s;' +
        (isSel
          ? 'background:radial-gradient(140% 160% at 0% 0%,#1A2C4E,#111B2E 70%);border:1px solid #3D7BF0;box-shadow:0 0 0 1px #3D7BF0 inset,0 14px 30px -16px rgba(61,123,240,.8);'
          : 'background:#111B2E;border:1px solid #25324A;');
      var fillLabel = isSel ? (filled + ' / ' + C) : 'Open for registration';
      var spots = isSel ? (full ? 'FULL' : (Math.max(0, C - filled) + ' left')) : '';
      return '' +
        '<div class="match-card lk" data-mt-select="' + i + '" style="' + cardStyle + '">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0A1326;border:1px solid #25324A;border-radius:10px;padding:8px 11px;flex-shrink:0">' +
              '<div style="font-family:var(--mono);font-size:9px;letter-spacing:.14em;color:#5E6A82">' + fx.dow + '</div>' +
              '<div style="font-weight:900;font-size:21px;line-height:1.05">' + fx.day + '</div>' +
              '<div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:#5E6A82">' + fx.mon + '</div>' +
            '</div>' +
            '<span style="font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.12em;color:' + tcol[0] + ';border:1px solid ' + tcol[1] + ';background:' + tcol[2] + ';border-radius:5px;padding:3px 7px">' + tag + '</span>' +
          '</div>' +
          '<div style="margin-top:13px;font-weight:800;font-size:16px;line-height:1.15">PSIA <span style="color:#5E6A82;font-style:italic;font-size:13px;font-weight:600">vs</span> ' + escapeHtml(fx.opp) + '</div>' +
          '<div style="margin-top:4px;font-size:11.5px;color:#9DAAC0;font-family:var(--mono)">' + fx.time + ' · ' + escapeHtml(fx.venue) + '</div>' +
          '<div style="margin-top:13px;display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">' +
            '<span style="font-size:11.5px;color:#9DAAC0">' + fillLabel + '</span>' +
            '<span style="font-family:var(--mono);font-size:10.5px;color:' + (full ? '#F0584B' : '#5C95F5') + '">' + spots + '</span>' +
          '</div>' +
          '<div style="height:6px;border-radius:99px;background:#0A1326;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#3D7BF0,#5C95F5);border-radius:99px"></div></div>' +
        '</div>';
    }).join('');

    return '' +
      '<section class="sec" style="padding-top:40px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap">' +
          '<div class="shead" style="margin:0"><span class="num">01</span><span class="lbl">Pick a match</span></div>' +
          '<span style="font-family:var(--mono);font-size:11.5px;color:#9DAAC0">' + FIXTURES.length + ' matches open for registration</span>' +
        '</div>' +
        '<div class="mt-scroll" style="display:flex;gap:14px;overflow-x:auto;padding-bottom:6px">' + cards + '</div>' +
      '</section>';
  }

  /* ---- selected-fixture strip + countdown ---- */
  function stripHTML() {
    var fx = selFx();
    return '' +
      '<section class="sec" style="padding-top:26px">' +
        '<div style="position:relative;border:1px solid #25324A;border-radius:16px;overflow:hidden;background:radial-gradient(120% 160% at 12% -20%,#16233F 0%,#111B2E 60%)">' +
          '<div style="height:4px;background:linear-gradient(90deg,#3D7BF0,#F5C542)"></div>' +
          '<div class="mt-strip" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:22px;padding:24px 32px">' +
            '<div style="display:flex;align-items:center;gap:20px">' +
              '<img src="assets/img/psia-crest.png" alt="PS IA-ITB crest" style="height:52px;width:auto;display:block;filter:drop-shadow(0 6px 16px rgba(0,0,0,.5))">' +
              '<div>' +
                '<div style="font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:#5C95F5;margin-bottom:6px">SELECTED FIXTURE</div>' +
                '<div style="font-weight:900;font-size:25px;line-height:1">PSIA <span style="color:#5E6A82;font-style:italic;font-size:18px;font-weight:600">vs</span> ' + escapeHtml(fx.opp) + '</div>' +
                '<div style="margin-top:8px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#9DAAC0;font-weight:500">' +
                  '<span style="font-family:var(--mono)">' + escapeHtml(fx.date) + '</span><span style="color:#3A434F">·</span>' +
                  '<span>📍 ' + escapeHtml(fx.venue) + '</span><span style="color:#3A434F">·</span><span>' + escapeHtml(fx.format) + '</span>' +
                  (fx.fee ? '<span style="color:#3A434F">·</span><span style="font-family:var(--mono);color:#F5C542">' + escapeHtml(fx.fee) + '</span>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:9px">' +
              '<div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.2em;color:#5E6A82">KICK-OFF IN</div>' +
              '<div style="display:flex;align-items:flex-start;gap:7px;font-family:var(--mono)">' +
                cdUnit('mtDD', 'D', '#EEF3FB') + cdSep() +
                cdUnit('mtHH', 'H', '#EEF3FB') + cdSep() +
                cdUnit('mtMM', 'M', '#EEF3FB') + cdSep() +
                cdUnit('mtSS', 'S', '#5C95F5') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
  }
  function cdUnit(id, lbl, col) {
    return '<div style="text-align:center"><div id="' + id + '" style="font-size:22px;font-weight:700;color:' + col + ';line-height:1">--</div>' +
      '<div style="font-size:8px;letter-spacing:.14em;color:#5E6A82;margin-top:4px">' + lbl + '</div></div>';
  }
  function cdSep() { return '<div style="font-size:20px;color:#2C3A55;line-height:1">:</div>'; }

  /* ---- 02 call-up + 03 squad (two-column grid) ---- */
  function gridHTML() {
    return '' +
      '<section class="sec mt-grid" style="padding-top:48px;display:grid;grid-template-columns:1fr 380px;gap:28px;align-items:start">' +
        callupHTML() +
        squadHTML() +
      '</section>';
  }

  function callupHTML() {
    var fx = selFx();
    return '' +
      '<div>' +
        '<div class="shead"><span class="num">02</span><span class="lbl">Your call-up</span></div>' +
        '<div style="border:1px solid #25324A;border-radius:16px;background:#111B2E;padding:28px 30px">' +
          '<div style="display:flex;align-items:center;gap:10px;background:rgba(61,123,240,.1);border:1px solid #2F5BB0;border-radius:10px;padding:11px 15px;margin-bottom:24px;font-size:13px">' +
            '<span style="font-size:15px">⚽</span><span style="color:#C4CEDE">Registering for <b style="color:#fff">PSIA vs ' + escapeHtml(fx.opp) + '</b> · <span style="font-family:var(--mono);color:#9DAAC0">' + escapeHtml(fx.short) + '</span></span>' +
          '</div>' +
          callupBodyHTML() +
        '</div>' +
      '</div>';
  }

  /* Body switches between a sign-in gate (logged out) and the one-tap form. */
  function callupBodyHTML() {
    var fx = selFx();
    var u = state.user;
    if (!u) {
      return '' +
        '<div style="text-align:center;padding:18px 6px 6px">' +
          '<div style="width:48px;height:48px;border-radius:50%;background:#0A1326;border:1px solid #25324A;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 14px">👤</div>' +
          '<div style="font-weight:800;font-size:17px">Sign in to register</div>' +
          '<p style="color:#9DAAC0;font-size:13px;line-height:1.5;margin:8px auto 18px;max-width:340px">Your profile holds your name and usual position, so registering is a single tap — no typing.</p>' +
          '<button class="btn btn-primary lk" data-view="account">Sign in or create account →</button>' +
        '</div>';
    }

    var defPos = state.pos || u.position || null;
    var posBtns = POS.map(function (p) {
      var on = defPos === p;
      var st = 'border-radius:11px;padding:14px 8px;text-align:center;cursor:pointer;transition:.15s;' +
        (on
          ? 'background:rgba(61,123,240,.16);border:1px solid #3D7BF0;box-shadow:0 0 0 1px #3D7BF0 inset,0 8px 22px -10px rgba(61,123,240,.7);'
          : 'background:#0A1326;border:1px solid #25324A;');
      return '<div class="mt-pos lk" data-mt-pos="' + p + '" style="' + st + '">' +
        '<div style="font-weight:900;font-size:16px;line-height:1">' + p + '</div>' +
        '<div style="font-size:11px;margin-top:6px;color:#9DAAC0">' + POS_LABEL[p] + '</div></div>';
    }).join('');

    var mine = myReg();
    var registered = !!mine;
    var submitStyle = 'color:#fff;font-weight:800;font-size:15px;padding:15px 38px;border-radius:10px;text-align:center;white-space:nowrap;cursor:pointer;' +
      (registered ? 'background:#1E5237;border:1px solid #36D27B;' : 'background:#3D7BF0;');
    var feedback = state.msg
      ? '<div style="font-family:var(--mono);font-size:12px;margin-top:12px;color:' + (state.msg.ok ? '#36D27B' : '#F0584B') + '">' + escapeHtml(state.msg.text) + '</div>'
      : '';

    return '' +
      '<div style="font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:#5E6A82;margin-bottom:11px">PLAYER</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;background:#0A1326;border:1px solid #25324A;border-radius:11px;padding:14px 18px">' +
        '<div style="display:flex;align-items:center;gap:13px">' +
          '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#3D7BF0,#1E3F7A);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:#fff">' + escapeHtml(initials(u.name)) + '</div>' +
          '<div>' +
            '<div style="font-weight:800;font-size:16px">' + escapeHtml(u.name) + '</div>' +
            '<div style="font-size:11.5px;color:#5E6A82;font-family:var(--mono)">' + (u.position ? POS_LABEL[u.position].toUpperCase() : 'PLAYER') +
              ' · <span style="color:' + ((u.saldo || 0) > 0 ? '#36D27B' : '#5E6A82') + '">SALDO ' + rpFmt(u.saldo || 0) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<span class="lk" data-view="account" style="color:#5C95F5;font-weight:700;font-size:12.5px;white-space:nowrap">edit profile</span>' +
      '</div>' +

      '<div style="display:flex;align-items:baseline;gap:8px;margin:24px 0 11px">' +
        '<span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:#5E6A82">POSITION</span>' +
        '<span style="font-size:11.5px;color:#4F5B72;font-weight:500">defaults to your usual</span></div>' +
      '<div class="mt-posrow" style="display:grid;grid-template-columns:repeat(4,1fr);gap:11px">' + posBtns + '</div>' +

      '<div style="display:flex;align-items:baseline;gap:8px;margin:24px 0 11px">' +
        '<span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:#5E6A82">NOTE</span>' +
        '<span style="font-size:11.5px;color:#4F5B72;font-weight:500">optional</span></div>' +
      '<input id="mtNote" type="text" maxlength="80" placeholder="e.g. can only play first half" value="' + escapeHtml(mine && mine.note ? mine.note : '') + '" style="width:100%;background:#0A1326;border:1px solid #25324A;border-radius:11px;padding:15px 18px;color:#EEF3FB;font-family:var(--font);font-size:14.5px;transition:.15s">' +

      '<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-top:26px;padding-top:24px;border-top:1px solid #1F2A41">' +
        '<div style="font-size:12.5px;color:#9DAAC0;line-height:1.5">' +
          (fx.fee ? 'Match fee <b style="color:#EEF3FB;font-family:var(--mono)">' + escapeHtml(fx.fee) + '</b><br>' : '') +
          '<span style="color:#5E6A82">Pay on matchday or via transfer.</span></div>' +
        '<div class="mt-submit lk" data-mt-submit="1" style="' + submitStyle + '">' + (registered ? '✓ Registered — update' : 'Register →') + '</div>' +
      '</div>' +
      feedback +
      payStripHTML(mine, fx);
  }

  function squadHTML() {
    var fx = selFx();
    var C = cap(fx);
    var filled = state.regs.length;
    var pct = Math.min(100, Math.round((filled / C) * 100));
    var remaining = Math.max(0, C - filled);

    var rows;
    if (state.loadingRegs) {
      rows = '<div style="padding:34px 22px;text-align:center;color:#5E6A82;font-size:12.5px">Loading…</div>';
    } else if (!filled) {
      rows = '<div style="padding:34px 22px;text-align:center;color:#5E6A82;font-size:12.5px;line-height:1.6">No one\'s confirmed yet.<br>Be the first to claim a spot.</div>';
    } else {
      var u = state.user;
      rows = state.regs.map(function (r, i) {
        var th = POS_THEME[r.position] || POS_THEME.MF;
        var isMe = u && r.accountId && r.accountId === u.id;
        var meta = r.note ? r.note : POS_LABEL[r.position];
        return '<div class="mt-row" style="display:flex;align-items:center;gap:12px;padding:13px 22px;border-bottom:1px solid #161F33;transition:.15s;' + (isMe ? 'background:rgba(54,210,123,.07);' : '') + '">' +
          '<div style="width:34px;height:34px;border-radius:50%;background:' + (isMe ? 'linear-gradient(135deg,#3D7BF0,#1E3F7A)' : AVATAR[i % AVATAR.length]) + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#fff;flex-shrink:0">' + escapeHtml(initials(r.name)) + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(r.name) + (isMe ? ' <span style="color:#36D27B;font-size:11px;font-weight:700">· you</span>' : '') + '</div>' +
            '<div style="font-size:11px;color:#5E6A82;font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(meta) + '</div>' +
          '</div>' +
          '<span style="font-family:var(--mono);font-size:10px;font-weight:700;color:' + th.color + ';border:1px solid ' + th.border + ';background:' + th.bg + ';border-radius:6px;padding:3px 8px;width:38px;text-align:center;flex-shrink:0">' + escapeHtml(r.position) + '</span>' +
        '</div>';
      }).join('');
    }

    return '' +
      '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px">' +
          '<div class="shead" style="margin:0"><span class="num">03</span><span class="lbl">Squad</span></div>' +
          '<span style="font-family:var(--mono);font-size:12px;color:#5C95F5;font-weight:700">' + filled + ' IN</span>' +
        '</div>' +
        '<div style="border:1px solid #25324A;border-radius:16px;background:#111B2E;overflow:hidden">' +
          '<div style="padding:14px 22px;border-bottom:1px solid #1F2A41;font-size:12.5px;color:#9DAAC0">vs <b style="color:#EEF3FB">' + escapeHtml(fx.opp) + '</b> <span style="color:#5E6A82;font-family:var(--mono)">· ' + escapeHtml(fx.short) + '</span></div>' +
          '<div style="padding:18px 22px;border-bottom:1px solid #1F2A41">' +
            '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:9px">' +
              '<span style="font-size:12.5px;color:#9DAAC0">' + remaining + ' spots remaining</span>' +
              '<span style="font-family:var(--mono);font-size:11px;color:#5E6A82">' + filled + ' / ' + C + '</span></div>' +
            '<div style="height:7px;border-radius:99px;background:#0A1326;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#3D7BF0,#5C95F5);border-radius:99px;transition:.3s"></div></div>' +
          '</div>' +
          '<div style="max-height:380px;overflow-y:auto">' + rows + '</div>' +
        '</div>' +
        '<div style="margin-top:14px;font-size:11.5px;color:#5E6A82;line-height:1.5;font-family:var(--mono)">List updates live as teammates confirm. Final XI posted 2h before kick-off.</div>' +
      '</div>';
  }

  /* ============================================================
     Countdown (updates the four number cells in place)
     ============================================================ */
  function tickCountdown() {
    var fx = selFx();
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    if (!fx || !fx.ms) { ['mtDD', 'mtHH', 'mtMM', 'mtSS'].forEach(function (id) { set(id, '--'); }); return; }
    var d = Math.max(0, fx.ms - Date.now());
    set('mtDD', pad(Math.floor(d / 86400000)));
    set('mtHH', pad(Math.floor((d % 86400000) / 3600000)));
    set('mtMM', pad(Math.floor((d % 3600000) / 60000)));
    set('mtSS', pad(Math.floor((d % 60000) / 1000)));
  }
  function startCountdown() {
    if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
    if (!document.getElementById('mtSS')) return;
    tickCountdown();
    cdTimer = setInterval(function () {
      if (!document.getElementById('mtSS')) { clearInterval(cdTimer); cdTimer = null; return