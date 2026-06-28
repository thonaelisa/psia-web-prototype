/* PSIA Website — PAYMENTS (admin reconciliation)
   ------------------------------------------------------------------
   A passcode-gated committee page that reconciles match-fee payments.
   It lists the players CALLED UP for a chosen match (the same people who
   registered), ordered by position, and shows each one's payment status:

       UNPAID  →  CLAIMS PAID (player tapped "I've paid")  →  PAID (admin)

   Players self-claim on the Register page; the committee finalizes here by
   pressing "Confirm paid" (optionally adjusting the amount). The status and
   amount live ON each registration record in store.js, so "who registered"
   and "who paid" can never drift apart.

   This page only READS/UPDATES payment fields — it does NOT touch the
   Treasury (kas). Log kas entries separately in the Manage page as before.

   Same soft passcode + unlock flag as the Manage and Team-selection pages,
   so unlocking one committee tool trusts the volunteer for all of them this
   session. NOT real security — the passcode ships in the file; swap in real
   auth when you add a backend (see store.js >>> BACKEND).

   Registers itself through window.PSIA_EXTRA_VIEWS.payments and fills its
   root from window.PSIA_AFTER_RENDER, the same pattern the other views use.
*/
(function () {
  'use strict';

  var STORE = window.PSIA_STORE;
  var D = window.PSIA_DATA || {};

  var PASSCODE = 'psia2026';
  var UNLOCK_KEY = 'psia.admin.unlocked';
  function unlocked() { try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; } }
  function setUnlocked(v) { try { v ? sessionStorage.setItem(UNLOCK_KEY, '1') : sessionStorage.removeItem(UNLOCK_KEY); } catch (e) {} }

  var POS_LABEL = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };
  var POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };
  var POS_THEME = {
    GK: { color: '#F5C542', border: '#5A4A12', bg: '#2A2410' },
    DF: { color: '#5C95F5', border: '#2F5BB0', bg: '#0E1D3A' },
    MF: { color: '#36D27B', border: '#1E5237', bg: '#11271B' },
    FW: { color: '#F0584B', border: '#5A2420', bg: '#2A1412' }
  };

  var state = {
    selected: 0,
    regs: [],
    accts: {},        // accountId -> account (for saldo display + confirm-from-saldo)
    loading: false,
    msg: null
  };

  /* ---- helpers ------------------------------------------------- */
  function root() { return document.getElementById('payRoot'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    return String(name || '').trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
  }
  function rp(n) { var v = Math.round(+n || 0); return 'Rp ' + Math.abs(v).toLocaleString('en-US'); }
  function feeOf(fx) { return parseInt(String((fx && fx.fee) || '').replace(/[^\d]/g, ''), 10) || 0; }

  /* Use the fixtures register.js built (real next + samples) so the match ids
     line up with the registrations players actually created. */
  function fixtures() {
    if (Array.isArray(window.PSIA_FIXTURES) && window.PSIA_FIXTURES.length) return window.PSIA_FIXTURES;
    var n = D.next || {};
    return [{ opp: n.opp || 'TBD', abbr: n.oppAbbr || '', venue: n.venue || '', format: n.format || '',
              fee: n.fee || '', slots: n.slots || 16, short: n.dateShort || '', date: n.dateLong || '' }];
  }
  function selFx() { var f = fixtures(); return f[state.selected] || f[0]; }
  function matchIdFor(fx) {
    return (typeof window.PSIA_MATCH_ID_FOR === 'function') ? window.PSIA_MATCH_ID_FOR(fx) : ('next::' + (fx.opp || 'match'));
  }
  function dateShort(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); } catch (e) { return ''; }
  }

  /* ---- data load ----------------------------------------------- */
  function loadRegs(then) {
    var fx = selFx();
    state.loading = true;
    Promise.all([STORE.getRegistrations(matchIdFor(fx)), STORE.getAccounts()]).then(function (res) {
      if (selFx() !== fx) return;           // user switched match mid-flight
      state.regs = res[0] || [];
      state.accts = {};
      (res[1] || []).forEach(function (a) { state.accts[a.id] = a; });
      state.loading = false;
      if (then) then();
    });
  }
  function acctOf(r) { return (r && r.accountId && state.accts[r.accountId]) || null; }

  function totals() {
    var t = { paid: 0, claimed: 0, unpaid: 0, collected: 0, n: state.regs.length };
    state.regs.forEach(function (r) {
      if (r.payStatus === 'paid') { t.paid++; t.collected += (+r.payAmount || 0); }
      else if (r.payStatus === 'claimed') t.claimed++;
      else t.unpaid++;
    });
    return t;
  }

  /* ===============================================================
     GATE
     =============================================================== */
  function renderGate(failed) {
    var el = root(); if (!el) return;
    el.innerHTML =
      '<div class="page-head"><h1>Payments</h1><p>Committee tool — enter the shared passcode to reconcile match-fee payments.</p></div>' +
      '<section class="sec last"><div class="gate">' +
        '<div class="gate-icon">🔑</div>' +
        '<div class="gate-title">Enter passcode</div>' +
        '<div class="fld"><span>Passcode</span>' +
          '<input id="payGate" type="password" placeholder="••••••••" autocomplete="off" /></div>' +
        (failed ? '<div class="reg-msg err" style="margin-top:10px">That passcode didn\'t match. Try again.</div>' : '') +
        '<div class="gate-actions"><button class="btn btn-primary" id="payGateBtn">Unlock →</button></div>' +
      '</div></section>';
    var inp = document.getElementById('payGate'); if (inp) inp.focus();
  }
  function tryUnlock() {
    var inp = document.getElementById('payGate');
    if (inp && inp.value === PASSCODE) { setUnlocked(true); render(); loadRegs(render); }
    else renderGate(true);
  }

  /* ===============================================================
     RENDER
     =============================================================== */
  function render() {
    var el = root(); if (!el) return;
    if (!unlocked()) { renderGate(false); return; }
    el.innerHTML = headHTML() + selectorHTML() + summaryHTML() + listHTML();
  }

  function headHTML() {
    var fb = state.msg
      ? '<div style="margin-top:10px;font-family:var(--mono);font-size:12px;color:' + (state.msg.ok ? '#36D27B' : '#F0584B') + '">' + esc(state.msg.text) + '</div>'
      : '';
    return '<div class="page-head"><h1>Payments</h1>' +
      '<p>Reconcile who has paid the match fee. Players appear here when they register, ordered by position. ' +
      'Confirm a payment once you\'ve received it — cash on matchday or by transfer.</p>' +
      '<div style="margin-top:14px;display:flex;gap:20px;flex-wrap:wrap;align-items:center">' +
        '<span class="lk backlink" data-view="manage">← Back to Manage</span>' +
        '<span class="lk backlink" data-view="admin">Team selection board →</span>' +
        '<span class="lk backlink" id="payLock" style="color:#5E6A82">Lock</span>' +
      '</div>' + fb + '</div>';
  }

  function selectorHTML() {
    var f = fixtures();
    var opts = f.map(function (fx, i) {
      return '<option value="' + i + '"' + (i === state.selected ? ' selected' : '') + '>PSIA vs ' +
        esc(fx.opp) + (fx.short ? (' · ' + esc(fx.short)) : '') + '</option>';
    }).join('');
    var fx = selFx();
    return '<section class="sec" style="padding-top:30px">' +
      '<div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">' +
        '<label class="fld" style="margin:0">' +
          '<span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;color:#5E6A82">MATCH</span>' +
          '<select id="paySel" style="margin-top:6px;background:#0A1326;border:1px solid #25324A;border-radius:10px;padding:11px 14px;color:#EEF3FB;font-family:var(--font);font-size:14px;min-width:280px">' + opts + '</select>' +
        '</label>' +
        '<div style="font-size:12.5px;color:#9DAAC0;padding-bottom:11px">' +
          (fx.fee ? 'Match fee <b style="font-family:var(--mono);color:#F5C542">' + esc(fx.fee) + '</b>' : '') + '</div>' +
        '<button class="lk" id="payReload" style="margin-left:auto;background:#1A2436;border:1px solid #2C3A55;color:#9DAAC0;font-weight:700;font-size:12px;padding:9px 14px;border-radius:9px">↻ Reload</button>' +
      '</div></section>';
  }

  function summaryHTML() {
    var t = totals(), fx = selFx(), fee = feeOf(fx), expected = fee * t.n;
    var cell = function (label, val, col) {
      return '<div style="flex:1;min-width:108px">' +
        '<div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:#5E6A82;margin-bottom:6px">' + label + '</div>' +
        '<div style="font-weight:800;font-size:20px;color:' + (col || '#EEF3FB') + '">' + val + '</div></div>';
    };
    var collected = rp(t.collected) + (expected ? (' <span style="font-size:12px;color:#5E6A82;font-weight:600">/ ' + rp(expected) + '</span>') : '');
    return '<section class="sec" style="padding-top:18px">' +
      '<div style="display:flex;flex-wrap:wrap;gap:18px;border:1px solid #25324A;border-radius:14px;background:#0E1626;padding:20px 24px">' +
        cell('CALLED UP', t.n) +
        cell('PAID', t.paid, '#36D27B') +
        cell('CLAIMED', t.claimed, '#F5C542') +
        cell('UNPAID', t.unpaid, '#9DAAC0') +
        cell('COLLECTED', collected, '#F5C542') +
      '</div></section>';
  }

  function card(inner) {
    return '<section class="sec last"><div style="border:1px solid #25324A;border-radius:16px;background:#111B2E;overflow:hidden">' + inner + '</div></section>';
  }

  function listHTML() {
    if (state.loading) return card('<div style="padding:40px;text-align:center;color:#5E6A82;font-size:13px">Loading…</div>');
    if (!state.regs.length) {
      return card('<div style="padding:42px 22px;text-align:center;color:#5E6A82;font-size:13px;line-height:1.7">' +
        'No one\'s called up for this match yet.<br>Players appear here as they register.</div>');
    }
    var sorted = state.regs.slice().sort(function (a, b) {
      var pa = POS_ORDER[a.position] == null ? 9 : POS_ORDER[a.position];
      var pb = POS_ORDER[b.position] == null ? 9 : POS_ORDER[b.position];
      if (pa !== pb) return pa - pb;
      return (a.ts || 0) - (b.ts || 0);
    });
    var html = '', curPos = null;
    sorted.forEach(function (r) {
      if (r.position !== curPos) {
        curPos = r.position;
        var cnt = sorted.filter(function (x) { return x.position === curPos; }).length;
        var label = (POS_LABEL[curPos] || curPos || 'Other').toUpperCase() + 'S';
        html += '<div style="display:flex;align-items:center;gap:8px;padding:11px 18px;background:#0C1424;border-bottom:1px solid #1F2A41">' +
          '<span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:#9DAAC0;font-weight:700">' + esc(label) + '</span>' +
          '<span style="font-family:var(--mono);font-size:10.5px;color:#5E6A82">· ' + cnt + '</span></div>';
      }
      html += rowHTML(r);
    });
    return card(html);
  }

  function clearBtnFor(r) {
    return (r.payStatus === 'claimed')
      ? '<button class="lk" data-pay-clearclaim="' + esc(r.id) + '" style="background:transparent;border:1px solid #2C3A55;color:#9DAAC0;font-weight:700;font-size:11.5px;padding:7px 10px;border-radius:8px;white-space:nowrap" title="Dismiss the player\'s request">Clear</button>'
      : '';
  }

  function rowHTML(r) {
    var th = POS_THEME[r.position] || POS_THEME.MF;
    var st = r.payStatus || 'unpaid';
    var acct = acctOf(r);
    var saldoReq = (st === 'claimed' && r.payMethod === 'saldo');   // player asked to pay from saldo
    var pill, pillCol, pillBd, pillBg;
    if (st === 'paid') { pill = 'PAID'; pillCol = '#36D27B'; pillBd = '#1E5237'; pillBg = 'rgba(54,210,123,.1)'; }
    else if (saldoReq) { pill = 'SALDO REQUESTED'; pillCol = '#5C95F5'; pillBd = '#2F5BB0'; pillBg = 'rgba(92,149,245,.1)'; }
    else if (st === 'claimed') { pill = 'CLAIMS PAID'; pillCol = '#F5C542'; pillBd = '#5A4A12'; pillBg = 'rgba(245,197,66,.1)'; }
    else { pill = 'UNPAID'; pillCol = '#9DAAC0'; pillBd = '#2C3A55'; pillBg = '#0A1326'; }

    var fee = feeOf(selFx());
    var amtVal = (r.payAmount != null ? r.payAmount : fee) || '';
    var amt0 = (r.payAmount != null ? r.payAmount : fee) || fee;

    // meta line: saldo (if the player has an account) + note
    var saldoMeta = acct
      ? '<span style="color:' + (acct.saldo > 0 ? '#36D27B' : (acct.saldo < 0 ? '#F0584B' : '#5E6A82')) + '">Saldo ' + rp(acct.saldo) + '</span>'
      : '<span style="color:#5E6A82">no account · no saldo</span>';
    var meta = '<div style="font-size:11px;display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;font-family:var(--mono)">' +
      saldoMeta + (r.note ? '<span style="color:#3A434F">·</span><span style="color:#5E6A82;font-family:var(--font)">' + esc(r.note) + '</span>' : '') + '</div>';

    var actions;
    if (st === 'paid') {
      var dt = dateShort(r.payConfirmedAt);
      var via = (r.payMethod && r.payMethod !== 'manual') ? (' · ' + r.payMethod) : '';
      actions =
        '<span style="font-size:11px;color:#5E6A82;font-family:var(--mono);white-space:nowrap">' + (dt ? ('✓ ' + esc(dt)) : '✓') + esc(via) + '</span>' +
        '<button class="lk" data-pay-unpaid="' + esc(r.id) + '" style="background:#1A2436;border:1px solid #2C3A55;color:#9DAAC0;font-weight:700;font-size:11.5px;padding:7px 12px;border-radius:8px;white-space:nowrap">Mark unpaid</button>';
    } else {
      var amtInput =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:11px;color:#5E6A82;font-family:var(--mono)">Rp</span>' +
          '<input type="number" data-pay-amt="' + esc(r.id) + '" value="' + esc(amtVal) + '" min="0" step="1000" ' +
            'style="width:88px;background:#0A1326;border:1px solid #25324A;border-radius:8px;padding:7px 9px;color:#EEF3FB;font-family:var(--mono);font-size:12.5px"></div>';
      if (saldoReq && acct && amt0 > 0 && acct.saldo >= amt0) {
        // confirm the player's saldo request → deducts the balance
        actions = amtInput +
          '<button class="lk" data-pay-saldo="' + esc(r.id) + '" style="background:#1E5237;border:1px solid #36D27B;color:#EAFBF0;font-weight:800;font-size:11.5px;padding:8px 13px;border-radius:8px;white-space:nowrap">Confirm from saldo →</button>' +
          clearBtnFor(r);
      } else if (saldoReq) {
        // requested saldo but balance no longer covers it — flag + cash fallback
        actions = amtInput +
          '<span style="font-size:11px;color:#F0584B;font-family:var(--mono);white-space:nowrap">saldo short</span>' +
          '<button class="lk" data-pay-confirm="' + esc(r.id) + '" style="background:#3D7BF0;color:#fff;font-weight:800;font-size:11.5px;padding:8px 13px;border-radius:8px;white-space:nowrap">Confirm paid →</button>' +
          clearBtnFor(r);
      } else {
        actions = amtInput +
          '<button class="lk" data-pay-confirm="' + esc(r.id) + '" style="background:#3D7BF0;color:#fff;font-weight:800;font-size:11.5px;padding:8px 13px;border-radius:8px;white-space:nowrap">Confirm paid →</button>' +
          clearBtnFor(r);
      }
    }

    return '<div style="display:flex;align-items:center;gap:13px;padding:13px 18px;border-bottom:1px solid #161F33;flex-wrap:wrap">' +
      '<span style="font-family:var(--mono);font-size:10px;font-weight:700;color:' + th.color + ';border:1px solid ' + th.border + ';background:' + th.bg + ';border-radius:6px;padding:3px 0;width:34px;text-align:center;flex-shrink:0">' + esc(r.position) + '</span>' +
      '<div style="width:32px;height:32px;border-radius:50%;background:' + th.bg + ';border:1px solid ' + th.border + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;color:' + th.color + ';flex-shrink:0">' + esc(initials(r.name)) + '</div>' +
      '<div style="flex:1;min-width:140px">' +
        '<div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.name) + '</div>' + meta +
      '</div>' +
      '<span style="font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.06em;color:' + pillCol + ';border:1px solid ' + pillBd + ';background:' + pillBg + ';border-radius:6px;padding:4px 8px;white-space:nowrap;flex-shrink:0">' + pill + '</span>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">' + actions + '</div>' +
    '</div>';
  }

  /* ===============================================================
     ACTIONS
     =============================================================== */
  function amtFor(id) {
    var inp = document.querySelector('#payRoot [data-pay-amt="' + id + '"]');
    if (inp) { var v = parseInt(inp.value, 10); if (!isNaN(v) && v >= 0) return v; }
    return feeOf(selFx());
  }
  function confirmPay(id) {
    var amt = amtFor(id);
    STORE.confirmPayment(id, amt).then(function () {
      state.msg = { text: 'Marked paid · ' + rp(amt) + '.', ok: true };
      loadRegs(render);
    }).catch(function () { state.msg = { text: 'Could not update.', ok: false }; render(); });
  }
  function markUnpaid(id) {
    STORE.markUnpaid(id).then(function () { state.msg = { text: 'Set back to unpaid — any saldo payment was refunded.', ok: true }; loadRegs(render); });
  }
  function clearClaim(id) {
    STORE.clearClaim(id).then(fun