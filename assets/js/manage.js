/* PSIA Website — MANAGE (admin content editor)
   ------------------------------------------------------------------
   A friendly, passcode-gated page that lets non-technical volunteers
   edit the site's content — the next fixture & price, past results &
   scores, match media links, scorers, fantasy points, player stats and
   the season summary — without touching any code or the spreadsheet.

   HOW IT FITS TOGETHER
   - All edits are saved through window.PSIA_STORE.saveContent() as a
     small "overlay" object. At boot we merge that overlay over
     window.PSIA_DATA, so every public view (Home, Matches, Stats,
     Fantasy) shows the latest content.
   - Today the overlay lives in this browser only (localStorage). To make
     changes visible to everyone, use Publish → "Download data.js" and
     hand that one file to whoever maintains the site (drop it into
     assets/js/). When a shared backend is added later, that manual step
     disappears and nothing else changes — see store.js (>>> BACKEND).

   This view registers itself through window.PSIA_EXTRA_VIEWS.manage and
   fills its root from window.PSIA_AFTER_RENDER, the same pattern squad.js
   and register.js use.
*/
(function () {
  'use strict';

  var STORE = window.PSIA_STORE;
  var KEYS = (STORE && STORE.CONTENT_KEYS) || ['next', 'season', 'results', 'scorers', 'fantasy', 'statsTable', 'treasury'];

  /* Same soft, shared passcode + unlock flag as the Team-selection board,
     so a volunteer who unlocks one tool is trusted for both this session. */
  var PASSCODE = 'psia2026';
  var UNLOCK_KEY = 'psia.admin.unlocked';
  function unlocked() { try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; } }
  function setUnlocked(v) { try { v ? sessionStorage.setItem(UNLOCK_KEY, '1') : sessionStorage.removeItem(UNLOCK_KEY); } catch (e) {} }

  /* ---------------------------------------------------------------
     BOOT: keep a pristine copy of the shipped data, then merge any
     saved overlay over PSIA_DATA so the public site reflects edits.
     >>> BACKEND: with a shared backend, fetch the overlay async here
     and re-render once it resolves instead of this sync read.
     --------------------------------------------------------------- */
  if (!window.PSIA_DATA_ORIGINAL) {
    try { window.PSIA_DATA_ORIGINAL = JSON.parse(JSON.stringify(window.PSIA_DATA || {})); } catch (e) { window.PSIA_DATA_ORIGINAL = {}; }
  }
  function applyOverlay(ov) {
    if (!ov || typeof ov !== 'object') return;
    KEYS.forEach(function (k) { if (ov[k] != null) window.PSIA_DATA[k] = ov[k]; });
  }
  try { applyOverlay(STORE && STORE.getContentSync && STORE.getContentSync()); } catch (e) {}

  /* ---------------------------------------------------------------
     Editing state
     --------------------------------------------------------------- */
  var draft = null;   // working copy of the editable content
  var tab = 'next';
  var dirty = false;
  var POS = ['GK', 'DF', 'MF', 'FW', 'FWD', 'DEF', 'MID', '']; // tolerant for the stats table

  /* Treasury (kas) add-entry form state + category options per direction.
     Forward-compatible with a future club_ledger table — entry fields are
     id / date / direction / category / amount / match_id / note. */
  var txForm = null;
  var TX_CATS = {
    income:  [['match_fee', 'Match fee'], ['dues', 'Dues'], ['sponsor', 'Sponsor'], ['other', 'Other']],
    expense: [['pitch', 'Pitch'], ['referee', 'Referee'], ['equipment', 'Equipment'], ['water', 'Water'], ['other', 'Other']]
  };

  /* How many rows to surface in each list — mirrors tools/convert.py. */
  var TOP_FANTASY = 8, TOP_SCORERS = 6, TOP_STATS = 12;
  /* SheetJS (xlsx) is loaded on demand only when a volunteer opens the
     Excel uploader, so the public site never pays for it. We ship a local
     copy so it works offline / on flaky networks, and fall back to a CDN
     only if that local file is missing. */
  var XLSX_LOCAL = 'assets/js/vendor/xlsx.full.min.js';
  var XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var excelState = { parsed: null, error: null, fileName: '', loading: false };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  /* Default shape for a content key when nothing has shipped yet. */
  function defaultContent(k) {
    if (k === 'next' || k === 'season') return {};
    if (k === 'treasury') return { opening_balance: 0, entries: [] };
    return [];
  }
  function loadDraft() {
    draft = {};
    KEYS.forEach(function (k) {
      var v = window.PSIA_DATA[k];
      draft[k] = v == null ? defaultContent(k) : clone(v);
    });
    /* Guarantee a complete treasury shape even if a partial overlay shipped. */
    if (!draft.treasury || typeof draft.treasury !== 'object') draft.treasury = { opening_balance: 0, entries: [] };
    if (typeof draft.treasury.opening_balance !== 'number') draft.treasury.opening_balance = +draft.treasury.opening_balance || 0;
    if (!Array.isArray(draft.treasury.entries)) draft.treasury.entries = [];
    txForm = null;   // reset the add-entry form to a fresh state
    dirty = false;
  }
  function markDirty() { dirty = true; var b = document.getElementById('mngDirty'); if (b) b.style.visibility = 'visible'; }

  function root() { return document.getElementById('mngRoot'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slug(opp, date) {
    return (String(opp || '') + ' ' + String(date || '')).toLowerCase()
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function autoResult(sp, so) { sp = +sp || 0; so = +so || 0; return sp > so ? 'win' : (sp < so ? 'loss' : 'draw'); }

  /* ===============================================================
     GATE
     =============================================================== */
  function renderGate(failed) {
    var el = root(); if (!el) return;
    el.innerHTML =
      '<div class="page-head"><h1>Manage content</h1><p>Committee tools — enter the shared passcode to edit the site.</p></div>' +
      '<section class="sec last"><div class="gate">' +
        '<div class="gate-icon">🔑</div>' +
        '<div class="gate-title">Enter passcode</div>' +
        '<div class="fld"><span>Passcode</span>' +
          '<input id="mngGate" type="password" placeholder="••••••••" autocomplete="off" />' +
        '</div>' +
        (failed ? '<div class="reg-msg err" style="margin-top:10px">That passcode didn\'t match. Try again.</div>' : '') +
        '<div class="gate-actions"><button class="btn btn-primary" id="mngGateBtn">Unlock →</button></div>' +
      '</div></section>';
    var inp = document.getElementById('mngGate'); if (inp) inp.focus();
  }
  function tryUnlock() {
    var inp = document.getElementById('mngGate');
    if (inp && inp.value === PASSCODE) { setUnlocked(true); loadDraft(); render(); }
    else renderGate(true);
  }

  /* ===============================================================
     SHELL
     =============================================================== */
  var TABS = [
    ['excel', '⬆ Update from Excel'],
    ['next', 'Next match'],
    ['results', 'Results'],
    ['scorers', 'Top scorers'],
    ['fantasy', 'Fantasy'],
    ['statsTable', 'Player stats'],
    ['season', 'Season'],
    ['treasury', 'Treasury'],
    ['saldo', 'Member saldo'],
    ['backup', 'Publish & backup']
  ];

  function render() {
    var el = root(); if (!el) return;
    if (!unlocked()) { renderGate(false); return; }
    if (!draft) loadDraft();
    el.innerHTML =
      '<div class="page-head"><h1>Manage content</h1>' +
        '<p>Edit what visitors see. Make your changes, then press <b>Save changes</b>. ' +
        'To make them visible to everyone, open <b>Publish &amp; backup</b>.</p></div>' +
      '<section class="sec last">' +
        '<div class="mng-note">Changes are saved on <b>this device</b> for now. ' +
        'Use <b>Publish &amp; backup → Download data.js</b> and pass that file to the site maintainer ' +
        'to update the live site for everyone.</div>' +
        '<div class="mng-toolrow">' +
          '<button class="btn btn-glass btn-sm" data-view="admin">🧑‍🤝‍🧑 Open Team selection board →</button>' +
          '<button class="btn btn-glass btn-sm" data-view="payments">💳 Open Payments →</button>' +
        '</div>' +
        '<div class="mng-tabs">' + TABS.map(function (t) {
          return '<button class="mng-tab' + (tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div>' +
        '<div id="mngBody">' + bodyHTML() + '</div>' +
      '</section>' +
      saveBarHTML();
  }

  function bodyHTML() {
    switch (tab) {
      case 'excel': return excelHTML();
      case 'next': return nextHTML();
      case 'results': return resultsHTML();
      case 'scorers': return listHTML('scorers', [['n', 'Player', 'text'], ['g', 'Goals', 'num']], 'Add scorer');
      case 'fantasy': return listHTML('fantasy', [['n', 'Manager / player', 'text'], ['p', 'Points', 'num']], 'Add row');
      case 'statsTable': return statsHTML();
      case 'season': return seasonHTML();
      case 'treasury': return treasuryHTML();
      case 'saldo': return saldoHTML();
      case 'backup': return backupHTML();
    }
    return '';
  }
  function rerenderBody() { var b = document.getElementById('mngBody'); if (b) b.innerHTML = bodyHTML(); }

  function saveBarHTML() {
    return '<div class="mng-savebar">' +
      '<span class="mng-dirty" id="mngDirty" style="visibility:' + (dirty ? 'visible' : 'hidden') + '">Unsaved changes</span>' +
      '<span class="mng-msg" id="mngMsg"></span>' +
      '<button class="btn btn-glass btn-sm" id="mngDiscard">Discard</button>' +
      '<button class="btn btn-primary btn-sm" id="mngSave">Save changes</button>' +
      '</div>';
  }

  /* ---- field helpers ------------------------------------------- */
  function field(label, k, f, type, hint, i) {
    var val = i == null ? (draft[k] ? draft[k][f] : '') : draft[k][i][f];
    var idx = i == null ? '' : ' data-i="' + i + '"';
    return '<label class="fld mng-fld"><span>' + esc(label) + (hint ? ' <em>' + esc(hint) + '</em>' : '') + '</span>' +
      '<input type="' + (type === 'num' ? 'number' : 'text') + '" data-k="' + k + '"' + idx + ' data-f="' + f + '" value="' + esc(val) + '" /></label>';
  }

  /* ---- NEXT MATCH --------------------------------------------- */
  function nextHTML() {
    return '<div class="mng-card">' +
      '<div class="mng-h">Upcoming fixture</div>' +
      '<div class="mng-grid2">' +
        field('Opponent', 'next', 'opp', 'text', 'e.g. Garuda FC') +
        field('Short name', 'next', 'oppShort', 'text', 'shown big, e.g. GARUDA FC') +
        field('Abbreviation', 'next', 'oppAbbr', 'text', '3 letters, e.g. GRD') +
        field('Venue', 'next', 'venue', 'text', 'e.g. Lapangan Saraga') +
      '</div>' +
      '<div class="mng-sub">Date &amp; time</div>' +
      '<div class="mng-grid2">' +
        '<label class="fld mng-fld"><span>Match date</span><input type="date" id="nxDate" /></label>' +
        '<label class="fld mng-fld"><span>Kick-off time</span><input type="time" id="nxTime" /></label>' +
      '</div>' +
      '<button class="btn btn-glass btn-sm mng-inline" id="nxFill">↻ Fill date fields from above</button>' +
      '<div class="mng-grid2">' +
        field('Date (long)', 'next', 'dateLong', 'text', 'SAT · 28 JUN 2026 · 20:00') +
        field('Date (short)', 'next', 'dateShort', 'text', 'SAT · 20:00') +
      '</div>' +
      '<div class="mng-sub">Format, price &amp; slots</div>' +
      '<div class="mng-grid2">' +
        field('Format', 'next', 'format', 'text', 'e.g. 7v7') +
        field('Match fee / price', 'next', 'fee', 'text', 'e.g. Rp 50.000') +
        field('Slots filled', 'next', 'filled', 'num', 'how many signed up') +
        field('Total slots', 'next', 'slots', 'num', 'squad size cap') +
      '</div>' +
    '</div>';
  }

  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function fillNextDate() {
    var d = document.getElementById('nxDate'), t = document.getElementById('nxTime');
    if (!d || !d.value) { msg('Pick a match date first.', true); return; }
    var parts = d.value.split('-'); // YYYY-MM-DD
    var dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var dow = DOW[dt.getDay()], dd = +parts[2], mon = MON[+parts[1] - 1], yr = parts[0];
    var time = (t && t.value) ? t.value : '';
    draft.next.dateLong = dow + ' · ' + dd + ' ' + mon + ' ' + yr + (time ? ' · ' + time : '');
    draft.next.dateShort = dow + (time ? ' · ' + time : '');
    if (!draft.next.oppShort && draft.next.opp) draft.next.oppShort = String(draft.next.opp).toUpperCase();
    if (!draft.next.oppAbbr && draft.next.opp) draft.next.oppAbbr = String(draft.next.opp).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
    markDirty(); rerenderBody();
  }

  /* ---- RESULTS ------------------------------------------------- */
  function resultsHTML() {
    var rows = draft.results.map(function (r, i) {
      return '<div class="mng-rrow" data-i="' + i + '">' +
        '<div class="mng-rgrid">' +
          field('Date', 'results', 'date', 'text', 'e.g. 20 JUN', i) +
          field('Opponent', 'results', 'opp', 'text', '', i) +
          field('Our score', 'results', 'sp', 'num', '', i) +
          field('Their score', 'results', 'so', 'num', '', i) +
          resultSelect(i) +
          field('Venue', 'results', 'venue', 'text', '', i) +
        '</div>' +
        '<details class="mng-links"><summary>Media links (video · photos · stats)</summary>' +
          '<div class="mng-grid2">' +
            field('Video URL', 'results', 'video', 'text', 'leave blank = "Coming soon"', i) +
            field('Photos URL', 'results', 'photos', 'text', '', i) +
            field('Stats URL', 'results', 'stats', 'text', '', i) +
          '</div>' +
        '</details>' +
        '<button class="mng-del" data-del="results" data-i="' + i + '" title="Delete this match">Delete</button>' +
      '</div>';
    }).join('');
    return '<div class="mng-card">' +
      '<div class="mng-h">Past results <em>newest first</em></div>' +
      (rows || '<div class="mng-empty">No results yet.</div>') +
      '<button class="btn btn-glass btn-sm mng-add" data-add="results">+ Add match (at top)</button>' +
    '</div>';
  }
  function resultSelect(i) {
    var r = draft.results[i], cur = r.r || autoResult(r.sp, r.so);
    var opt = function (v, lbl) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + lbl + '</option>'; };
    return '<label class="fld mng-fld"><span>Result</span>' +
      '<select data-k="results" data-i="' + i + '" data-f="r">' +
        opt('win', 'Win') + opt('draw', 'Draw') + opt('loss', 'Loss') +
      '</select></label>';
  }

  /* ---- generic 2-column list (scorers, fantasy) --------------- */
  function listHTML(k, cols, addLabel) {
    var rows = draft[k].map(function (row, i) {
      return '<div class="mng-lrow" data-i="' + i + '">' +
        cols.map(function (c) { return field(c[1], k, c[0], c[2], '', i); }).join('') +
        '<button class="mng-del slim" data-del="' + k + '" data-i="' + i + '">×</button>' +
      '</div>';
    }).join('');
    return '<div class="mng-card">' +
      '<div class="mng-h">' + (k === 'scorers' ? 'Top scorers' : 'Fantasy standings') + '</div>' +
      (rows || '<div class="mng-empty">Nothing here yet.</div>') +
      '<button class="btn btn-glass btn-sm mng-add" data-add="' + k + '">+ ' + addLabel + '</button>' +
    '</div>';
  }

  /* ---- PLAYER STATS ------------------------------------------- */
  function statsHTML() {
    var cols = [['n', 'Player'], ['pos', 'Pos'], ['apps', 'Apps'], ['g', 'G'], ['a', 'A'], ['cs', 'CS'], ['pts', 'Pts']];
    var rows = draft.statsTable.map(function (row, i) {
      return '<div class="mng-srow" data-i="' + i + '">' +
        field('Player', 'statsTable', 'n', 'text', '', i) +
        posSelect(i) +
        field('Apps', 'statsTable', 'apps', 'num', '', i) +
        field('G', 'statsTable', 'g', 'num', '', i) +
        field('A', 'statsTable', 'a', 'num', '', i) +
        field('CS', 'statsTable', 'cs', 'num', '', i) +
        field('Pts', 'statsTable', 'pts', 'num', '', i) +
        '<button class="mng-del slim" data-del="statsTable" data-i="' + i + '">×</button>' +
      '</div>';
    }).join('');
    return '<div class="mng-card">' +
      '<div class="mng-h">Player stats <em>fantasy points drive the leaderboard order</em></div>' +
      (rows || '<div class="mng-empty">No players yet.</div>') +
      '<button class="btn btn-glass btn-sm mng-add" data-add="statsTable">+ Add player</button>' +
    '</div>';
  }
  function posSelect(i) {
    var cur = draft.statsTable[i].pos || '';
    var opts = ['', 'GK', 'DEF', 'MID', 'FWD'];
    return '<label class="fld mng-fld"><span>Pos</span><select data-k="statsTable" data-i="' + i + '" data-f="pos">' +
      opts.map(function (o) { return '<option value="' + o + '"' + (cur === o ? ' selected' : '') + '>' + (o || '—') + '</option>'; }).join('') +
      '</select></label>';
  }

  /* ---- SEASON -------------------------------------------------- */
  function seasonHTML() {
    return '<div class="mng-card">' +
      '<div class="mng-h">Season summary <em>shown on the home stat bar</em></div>' +
      '<div class="mng-grid2">' +
        field('Wins', 'season', 'wins', 'num') +
        field('Draws', 'season', 'draws', 'num') +
        field('Losses', 'season', 'losses', 'num') +
        field('Goals scored', 'season', 'goals', 'num') +
      '</div>' +
      '<button class="btn btn-glass btn-sm mng-inline" id="seasonAuto">↻ Auto-calculate from results</button>' +
      '<div class="mng-hintline">Auto-calculate counts W/D/L from the Results tab and sums "Our score" for goals.</div>' +
    '</div>';
  }
  function seasonAuto() {
    var w = 0, d = 0, l = 0, g = 0;
    draft.results.forEach(function (r) {
      var res = r.r || autoResult(r.sp, r.so);
      if (res === 'win') w++; else if (res === 'loss') l++; else d++;
      g += (+r.sp || 0);
    });
    draft.season = { wins: w, draws: d, losses: l, goals: g };
    markDirty(); rerenderBody();
  }

  /* ===============================================================
     TREASURY (kas) — opening balance + income/expense entries.
     Kas balance = opening_balance + Σincome − Σexpense. Amounts are
     stored POSITIVE; `direction` carries the sign. Entries are kept in
     the overlay (same Save/Publish/Backup/Revert path as everything
     else) so nothing is destroyed before the treasurer publishes.
     =============================================================== */
  function todayISO() {
    var d = new Date(), m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }
  function money(n) {
    var v = Math.round(+n || 0), s = Math.abs(v).toLocaleString('en-US');
    return (v < 0 ? '-' : '') + 'Rp ' + s;
  }
  function freshTxForm() {
    return { date: todayISO(), direction: 'income', category: TX_CATS.income[0][0], amount: '', match_id: '', note: '' };
  }
  function txCatLabel(dir, cat) {
    var list = TX_CATS[dir] || [];
    for (var i = 0; i < list.length; i++) { if (list[i][0] === cat) return list[i][1]; }
    return cat || '—';
  }
  /* Next id as a zero-padded counter based on the current max (tx_0001, …). */
  function nextTxId(entries) {
    var max = 0;
    (entries || []).forEach(function (e) {
      var m = /^tx_(\d+)$/.exec(String(e.id || ''));
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    });
    var s = String(max + 1);
    while (s.length < 4) s = '0' + s;
    return 'tx_' + s;
  }
  function treasuryDraftTotals() {
    var t = draft.treasury || { opening_balance: 0, entries: [] };
    var ob = Math.round(+t.opening_balance || 0), inc = 0, exp = 0;
    (t.entries || []).forEach(function (e) {
      var amt = Math.abs(Math.round(+e.amount || 0));
      if (e.direction === 'income') inc += amt; else exp += amt;
    });
    return { balance: ob + inc - exp, income: inc, expense: exp, opening: ob };
  }
  function kasBarHTML() {
    var t = treasuryDraftTotals();
    return '<div class="mng-kascell"><div class="k">Kas balance</div><div class="v gold">' + money(t.balance) + '</div></div>' +
      '<div class="mng-kascell"><div class="k">In</div><div class="v win">' + money(t.income) + '</div></div>' +
      '<div class="mng-kascell"><div class="k">Out</div><div class="v loss">' + money(t.expense) + '</div></div>';
  }
  function updateKasBar() { var el = document.getElementById('mngKasBar'); if (el) el.innerHTML = kasBarHTML(); }

  function treasuryHTML() {
    if (!txForm) txForm = freshTxForm();
    var cats = TX_CATS[txForm.direction] || [];
    var catOpts = cats.map(function (c) {
      return '<option value="' + c[0] + '"' + (txForm.category === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
    }).join('');
    var matchOpts = '<option value="">— none —</option>' + (draft.results || []).map(function (r) {
      return '<option value="' + esc(r.id) + '"' + (txForm.match_id === r.id ? ' selected' : '') + '>' +
        esc((r.date || '') + ' · ' + (r.opp || '')) + '</option>';
    }).join('');
    var entries = (draft.treasury.entries || []).slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    var rows = entries.map(function (e) {
      var amt = Math.abs(Math.round(+e.amount || 0));
      var signed = (e.direction === 'income' ? '+' : '−') + money(amt);
      var cls = e.direction === 'income' ? 'win' : 'loss';
      return '<div class="mng-trow">' +
        '<span class="t-date mono">' + esc(e.date || '') + '</span>' +
        '<span class="t-cat">' + esc(txCatLabel(e.direction, e.category)) + '</span>' +
        '<span class="t-amt mono ' + cls + '">' + signed + '</span>' +
        '<span class="t-note">' + esc(e.note || '') + '</span>' +
        '<button class="mng-del slim" data-txdel="' + esc(e.id) + '" title="Remove this entry">×</button>' +
      '</div>';
    }).join('');
    return '<div class="mng-card">' +
      '<div class="mng-h">Club treasury <em>kas — income &amp; expenses</em></div>' +
      '<div class="mng-kasbar" id="mngKasBar">' + kasBarHTML() + '</div>' +
      '<div class="mng-sub">Opening balance</div>' +
      '<div class="mng-grid2">' +
        '<label class="fld mng-fld"><span>Opening balance <em>kas before any logged entry (Rp)</em></span>' +
          '<input type="number" id="txOpening" value="' + esc(draft.treasury.opening_balance) + '" /></label>' +
      '</div>' +
      '<div class="mng-sub">Add entry</div>' +
      '<div class="mng-tform">' +
        '<label class="fld mng-fld"><span>Date</span><input type="date" id="txDate" value="' + esc(txForm.date) + '" /></label>' +
        '<label class="fld mng-fld"><span>Direction</span><select id="txDir">' +
          '<option value="income"' + (txForm.direction === 'income' ? ' selected' : '') + '>Income</option>' +
          '<option value="expense"' + (txForm.direction === 'expense' ? ' selected' : '') + '>Expense</option>' +
        '</select></label>' +
        '<label class="fld mng-fld"><span>Category</span><select id="txCat">' + catOpts + '</select></label>' +
        '<label class="fld mng-fld"><span>Amount <em>Rp</em></span><input type="number" id="txAmount" min="0" step="1000" value="' + esc(txForm.amount) + '" /></label>' +
        '<label class="fld mng-fld"><span>Link match <em>optional</em></span><select id="txMatch">' + matchOpts + '</select></label>' +
        '<label class="fld mng-fld mng-tnote"><span>Note</span><input type="text" id="txNote" value="' + esc(txForm.note) + '" placeholder="e.g. GW16 fees collected" /></label>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm mng-inline" id="txAdd">+ Add entry</button>' +
      '<div class="mng-sub">Entries <em>newest first</em></div>' +
      (rows || '<div class="mng-empty">No entries yet.</div>') +
    '</div>';
  }
  function addTxEntry() {
    var amt = Math.abs(Math.round(+txForm.amount || 0));
    if (!txForm.date) { msg('Pick a date for the entry.', true); return; }
    if (!amt) { msg('Enter an amount greater than zero.', true); return; }
    draft.treasury.entries.push({
      id: nextTxId(draft.treasury.entries),
      date: txForm.date,
      direction: txForm.direction === 'expense' ? 'expense' : 'income',
      category: txForm.category || 'other',
      amount: amt,
      match_id: txForm.match_id ? txForm.match_id : null,
      note: (txForm.note || '').trim()
    });
    markDirty();
    // keep date + direction for fast multi-entry, clear the rest
    var dir = txForm.direction;
    txForm = { date: txForm.date, direction: dir, category: (TX_CATS[dir][0] || ['other'])[0], amount: '', match_id: '', note: '' };
    rerenderBody();
    msg('Entry added — press Save changes to keep it.');
  }

  /* ===============================================================
     MEMBER SALDO — prepaid wallets, stored on accounts (PSIA_STORE).
     Top-ups and manual adjustments write IMMEDIATELY (no draft / Save
     step), like the Excel importer. A top-up can also post income to the
     club kas; when it does we re-sync draft.treasury so a later content
     "Save changes" here won't clobber the new entry.
     =============================================================== */
  var saldoState = {
    loaded: false, loading: false, accounts: [], selId: '', q: '',
    form: { amount: '', method: 'cash', note: '', toTreasury: true },
    adj: { amount: '', note: '' }, showLog: false, msg: null
  };
  var SREASONM = { topup: 'Top-up', fee: 'Match fee', refund: 'Refund', adjust: 'Adjustment' };
  function dShortM(ms) { if (!ms) return ''; try { return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); } catch (e) { return ''; } }
  function selAcct() { return saldoState.accounts.find(function (a) { return a.id === saldoState.selId; }) || null; }
  function saldoMatch(a, q) {
    q = (q || '').trim().toLowerCase(); if (!q) return true;
    return (String(a.name || '').toLowerCase().indexOf(q) >= 0) ||
           (String(a.email || '').toLowerCase().indexOf(q) >= 0) ||
           (String(a.phone || '').toLowerCase().indexOf(q) >= 0);
  }
  function loadSaldo() {
    if (saldoState.loading) return;
    saldoState.loading = true;
    STORE.getAccounts().then(function (list) {
      saldoState.accounts = list || []; saldoState.loaded = true; saldoState.loading = false;
      if (tab === 'saldo') rerenderBody();
    });
  }
  function refreshSaldo(then) {
    STORE.getAccounts().then(function (list) { saldoState.accounts = list || []; if (then) then(); rerenderBody(); });
  }
  function memberRowsHTML() {
    var accts = saldoState.accounts.slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    var filtered = accts.filter(function (a) { return saldoMatch(a, saldoState.q); });
    if (!filtered.length) return '<div class="mng-empty">No members match.</div>';
    return filtered.map(function (a) {
      var bal = +a.saldo || 0, selc = a.id === saldoState.selId;
      return '<div class="mng-trow" data-sld-pick="' + esc(a.id) + '" style="cursor:pointer;' + (selc ? 'background:rgba(61,123,240,.10);' : '') + '">' +
        '<span class="t-cat" style="flex:1.2">' + esc(a.name || '—') + '</span>' +
        '<span class="t-note" style="flex:1.6;color:#9DAAC0">' + esc(a.email || a.phone || '') + '</span>' +
        '<span class="t-amt mono" style="color:' + (bal > 0 ? '#36D27B' : (bal < 0 ? '#F0584B' : '#9DAAC0')) + '">' + money(bal) + '</span>' +
      '</div>';
    }).join('');
  }
  function kv(label, val) {
    return '<div style="display:flex;flex-direction:column;gap:3px">' +
      '<span style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:#5E6A82">' + esc(label) + '</span>' +
      '<b style="font-size:13.5px">' + esc(val) + '</b></div>';
  }
  function selectedAcctHTML(a) {
    var f = saldoState.form, adj = saldoState.adj, bal = +a.saldo || 0;
    var log = (a.saldoLog || []).slice().sort(function (x, y) { return y.ts - x.ts; }).slice(0, 12);
    var logHTML = saldoState.showLog
      ? (log.length ? log.map(function (e) {
          var pos = e.delta >= 0;
          return '<div class="mng-trow">' +
            '<span class="t-date mono">' + esc(dShortM(e.ts)) + '</span>' +
            '<span class="t-cat">' + esc(SREASONM[e.reason] || e.reason) + (e.note ? ' · ' + esc(e.note) : '') + '</span>' +
            '<span class="t-amt mono ' + (pos ? 'win' : 'loss') + '">' + (pos ? '+' : '−') + money(Math.abs(e.delta)) + '</span>' +
          '</div>';
        }).join('') : '<div class="mng-empty">No history yet.</div>')
      : '';
    return '<div class="mng-card">' +
      '<div class="mng-h">' + esc(a.name || 'Member') + ' <em>balance ' + money(bal) + '</em></div>' +
      '<div style="display:flex;gap:22px;flex-wrap:wrap;margin-bottom:8px">' +
        kv('Email', a.email || '—') + kv('Phone', a.phone || '—') + kv('Position', a.position || '—') + kv('Member since', a.createdAt ? dShortM(a.createdAt) : '—') +
      '</div>' +
      '<div class="mng-sub">Top up <em>adds to balance</em></div>' +
      '<div class="mng-tform">' +
        '<label class="fld mng-fld"><span>Amount <em>Rp</em></span><input type="number" id="sldAmt" min="0" step="1000" value="' + esc(f.amount) + '" /></label>' +
        '<label class="fld mng-fld"><span>Method</span><select id="sldMethod"><option value="cash"' + (f.method === 'cash' ? ' selected' : '') + '>Cash</option><option value="transfer"' + (f.method === 'transfer' ? ' selected' : '') + '>Transfer</option></select></label>' +
        '<label class="fld mng-fld mng-tnote"><span>Note <em>optional</em></span><input type="text" id="sldNote" value="' + esc(f.note) + '" placeholder="e.g. season top-up" /></label>' +
      '</div>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#9DAAC0;margin:4px 0 2px"><input type="checkbox" id="sldKas"' + (f.toTreasury ? ' checked' : '') + '> Add this top-up to the club kas (Treasury)</label>' +
      '<button class="btn btn-primary btn-sm mng-inline" id="sldTopup">+ Top up saldo</button>' +
      '<div class="mng-sub">Manual adjustment <em>correction, not a cash-in</em></div>' +
      '<div class="mng-tform">' +
        '<label class="fld mng-fld"><span>Amount <em>+ add / − remove</em></span><input type="number" id="sldAdjAmt" step="1000" value="' + esc(adj.amount) + '" placeholder="e.g. -10000" /></label>' +
        '<label class="fld mng-fld mng-tnote"><span>Reason</span><input type="text" id="sldAdjNote" value="' + esc(adj.note) + '" placeholder="why this correction" /></label>' +
      '</div>' +
      '<button class="btn btn-glass btn-sm mng-inline" id="sldAdjust">± Apply adjustment</button>' +
      '<div style="margin-top:14px"><button class="btn btn-glass btn-sm" id="sldLog">' + (saldoState.showLog ? 'Hide history' : 'Show history') + '</button></div>' +
      (saldoState.showLog ? '<div style="margin-top:10px">' + logHTML + '</div>' : '') +
    '</div>';
  }
  function saldoHTML() {
    if (!saldoState.loaded) {
      if (!saldoState.loading) loadSaldo();
      return '<div class="mng-card"><div class="mng-h">Member saldo</div><div class="mng-empty">Loading members…</div></div>';
    }
    var total = saldoState.accounts.reduce(function (s, a) { return s + (+a.saldo || 0); }, 0);
    var note = '<div class="mng-note">Saldo changes apply <b>immediately</b> on this device — the “Save changes” / “Publish” buttons below don’t affect saldo.</div>';
    var listCard = '<div class="mng-card">' +
      '<div class="mng-h">All members <em>' + saldoState.accounts.length + ' · club owes ' + money(total) + '</em></div>' +
      '<label class="fld mng-fld"><span>Search</span><input type="text" id="sldSearch" value="' + esc(saldoState.q) + '" placeholder="name, email or phone" autocomplete="off" /></label>' +
      '<div id="sldList" style="margin-top:8px">' + memberRowsHTML() + '</div>' +
    '</div>';
    var sel = selAcct();
    var detailCard = sel ? selectedAcctHTML(sel)
      : '<div class="mng-card"><div class="mng-empty">Pick a member above to top up or adjust their saldo.</div></div>';
    var m = saldoState.msg ? '<div class="reg-msg ' + (saldoState.msg.ok ? 'ok' : 'err') + '" style="margin-top:6px">' + esc(saldoState.msg.text) + '</div>' : '';
    return note + listCard + detailCard + m;
  }
  function sldDoTopup() {
    var a = selAcct(); if (!a) return;
    var amt = parseInt(saldoState.form.amount, 10) || 0;
    if (amt <= 0) { saldoState.msg = { text: 'Enter a top-up amount.', ok: false }; rerenderBody(); return; }
    var toK = saldoState.form.toTreasury;
    STORE.topUpSaldo(a.id, { amount: amt, method: saldoState.form.method, note: saldoState.form.note, toTreasury: toK }).then(function (acct) {
      if (toK) { try { draft.treasury = clone(window.PSIA_DATA.treasury); } catch (e) {} }
      saldoState.form.amount = ''; saldoState.form.note = '';
      saldoState.msg = { text: 'Topped up ' + acct.name + ' · new balance ' + money(acct.saldo) + (toK ? ' (added to kas)' : '') + '.', ok: true };
      refreshSaldo();
    }).catch(function (e) { saldoState.msg = { text: e.message || 'Could not top up.', ok: false }; rerenderBody(); });
  }
  function sldDoAdjust() {
    var a = selAcct(); if (!a) return;
    var d = parseInt(saldoState.adj.amount, 10) || 0;
    if (!d) { saldoState.msg = { text: 'Enter a non-zero adjustment (e.g. -10000).', ok: false }; rerenderBody(); return; }
    STORE.adjustSaldo(a.id, d, saldoState.adj.note).then(function (acct) {
      saldoState.adj.amount = ''; saldoState.adj.note = '';
      saldoState.msg = { text: 'Adjusted ' + acct.name + ' by ' + (d >= 0 ? '+' : '−') + money(Math.abs(d)) + ' · balance ' + money(acct.saldo) + '.', ok: true };
      refreshSaldo();
    }).catch(function (e) { saldoState.msg = { text: e.message || 'Could not adjust.', ok: false }; rerenderBody(); });
  }

  /* ===============================================================
     UPDATE FROM EXCEL — upload the workbook, parse, confirm, save.
     Reads Top scorers, Fantasy and Player stats from the same
     workbook tools/convert.py uses. Columns are found by HEADER NAME
     (not fixed positions) so the parser keeps working as gameweeks
     are added and columns shift.
     =============================================================== */
  function disp(full) {
    if (!full) return '';
    var s = String(full).trim();
    return s.replace(/\s*\(.*?\)\s*$/, '').trim() || s;
  }
  function nrm(full) { return disp(full).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function n2i(x) { var n = parseFloat(x); return isNaN(n) ? 0 : Math.round(n); }
  function posBucket(raw) {
    if (!raw) return '';
    var s = String(raw).toUpperCase();
    if (s.indexOf('GK') >= 0) return 'GK';
    if (['ST', 'CF', 'AMR', 'AML', 'FW', 'WING'].some(function (t) { return s.indexOf(t) >= 0; })) return 'FWD';
    if (['CB', 'LB', 'RB', 'WB', 'DF'].some(function (t) { return s.indexOf(t) >= 0; })) return 'DEF';
    if (['DM', 'CM', 'AMC', 'MF', 'MID'].some(function (t) { return s.indexOf(t) >= 0; })) return 'MID';
    return '';
  }
  function cellV(ws, r, c) { var a = window.XLSX.utils.encode_cell({ r: r, c: c }); var x = ws[a]; return x ? x.v : null; }
  function wsRange(ws) { return ws['!ref'] ? window.XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }; }
  function findCol(ws, hRow, pred) {
    var rg = wsRange(ws);
    for (var c = rg.s.c; c <= rg.e.c; c++) {
      var v = cellV(ws, hRow, c);
      if (v != null && pred(String(v).trim().toLowerCase())) return c;
    }
    return -1;
  }
  function needSheet(wb, name) {
    var s = wb.Sheets[name];
    if (!s) throw new Error('Couldn’t find the "' + name + '" sheet. Found: ' + wb.SheetNames.join(', '));
    return s;
  }

  /* The actual parse — mirrors tools/convert.py exactly. */
  function parseWorkbook(wb) {
    var X = window.XLSX;
    // --- Fantasy Points: PLAYER + TOTAL POINTS, header row 1, data from row 4
    var fp = needSheet(wb, 'Fantasy Points');
    var fpPlayer = findCol(fp, 0, function (s) { return s === 'player'; });
    var fpTotal = findCol(fp, 0, function (s) { return s === 'total points'; });
    if (fpTotal < 0) fpTotal = findCol(fp, 0, function (s) { return s.indexOf('total') === 0; });
    if (fpPlayer < 0 || fpTotal < 0) throw new Error('"Fantasy Points" sheet is missing a PLAYER or TOTAL POINTS column.');
    var lb = [], rg = wsRange(fp);
    for (var r = 3; r <= rg.e.r; r++) {
      var nm = cellV(fp, r, fpPlayer);
      if (!nm || !String(nm).trim()) continue;
      lb.push({ full: String(nm).trim(), total: n2i(cellV(fp, r, fpTotal)) });
    }

    // --- Player Stats: header row 5, data from row 6
    var ps = needSheet(wb, 'Player Stats');
    var psPlayer = findCol(ps, 4, function (s) { return s === 'player'; });
    var psCaps = findCol(ps, 4, function (s) { return s === 'caps'; });
    var psGoal = findCol(ps, 4, function (s) { return s === 'goal' || s === 'goals'; });
    var psAst = findCol(ps, 4, function (s) { return s === 'assist' || s === 'assists'; });
    var psCs = findCol(ps, 4, function (s) { return s.indexOf('clean') >= 0; });
    if (psPlayer < 0) throw new Error('"Player Stats" sheet is missing its PLAYER column (expected headers on row 5).');
    var stats = [], rg2 = wsRange(ps);
    for (var r2 = 5; r2 <= rg2.e.r; r2++) {
      var nm2 = cellV(ps, r2, psPlayer);
      if (!nm2 || !String(nm2).trim()) continue;
      stats.push({
        full: String(nm2).trim(),
        caps: n2i(cellV(ps, r2, psCaps)), goals: n2i(cellV(ps, r2, psGoal)),
        assists: n2i(cellV(ps, r2, psAst)), cs: n2i(cellV(ps, r2, psCs))
      });
    }

    // --- Player Database: name (col A) + position, header row 1, data from row 2
    var posByName = {};
    var pdb = wb.Sheets['Player Database'];
    if (pdb) {
      var pdName = findCol(pdb, 0, function (s) { return s.indexOf('nama lengkap') >= 0; });
      if (pdName < 0) pdName = 0;
      var pdPos = findCol(pdb, 0, function (s) { return s.indexOf('position') >= 0; });
      if (pdPos < 0) pdPos = 2;
      var rg3 = wsRange(pdb);
      for (var r3 = 1; r3 <= rg3.e.r; r3++) {
        var nm3 = cellV(pdb, r3, pdName);
        if (!nm3 || !String(nm3).trim()) continue;
        posByName[nrm(nm3)] = posBucket(cellV(pdb, r3, pdPos));
      }
    }

    // --- assemble (same rules as convert.py)
    var totalByName = {}; lb.forEach(function (p) { totalByName[nrm(p.full)] = p.total; });

    var scorers = stats.filter(function (p) { return p.goals > 0; })
      .sort(function (a, b) { return b.goals - a.goals; })
      .slice(0, TOP_SCORERS)
      .map(function (p) { return { n: disp(p.full), g: p.goals }; });

    var fantasy = lb.slice(0, TOP_FANTASY).map(function (p) { return { n: disp(p.full), p: p.total }; });

    var statsTable = stats.map(function (p) {
      return {
        n: disp(p.full), pos: posByName[nrm(p.full)] || '',
        apps: p.caps, g: p.goals, a: p.assists, cs: p.cs, pts: (totalByName[nrm(p.full)] || 0)
      };
    }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, TOP_STATS);

    if (!scorers.length && !fantasy.length && !statsTable.length) {
      throw new Error('The workbook opened but no player rows were found. Is this the right file?');
    }
    return { scorers: scorers, fantasy: fantasy, statsTable: statsTable, counts: { lb: lb.length, stats: stats.length } };
  }

  function loadScript(src, ok, fail) {
    var s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  }
  function ensureXLSX(cb) {
    if (window.XLSX) return cb();
    excelState.loading = true; rerenderBody();
    // Try the bundled copy first (works offline); fall back to the CDN.
    loadScript(XLSX_LOCAL,
      function () { excelState.loading = false; cb(); },
      function () {
        loadScript(XLSX_CDN,
          function () { excelState.loading = false; cb(); },
          function () {
            excelState.loading = false;
            excelState.error = 'Could not load the Excel reader. Make sure assets/js/vendor/xlsx.full.min.js exists (or connect to the internet).';
            rerenderBody();
          });
      });
  }
  function handleExcelFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    excelState.fileName = file.name; excelState.error = null; excelState.parsed = null;
    ensureXLSX(function () {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var wb = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          excelState.parsed = parseWorkbook(wb);
          excelState.error = null;
        } catch (err) {
          excelState.parsed = null;
          excelState.error = (err && err.message) ? err.message : 'Could not read that file.';
        }
        rerenderBody();
      };
      reader.onerror = function () { excelState.error = 'Could not read that file.'; rerenderBody(); };
      reader.readAsArrayBuffer(file);
    });
  }
  function confirmExcel() {
    var p = excelState.parsed; if (!p) return;
    draft.scorers = clone(p.scorers);
    draft.fantasy = clone(p.fantasy);
    draft.statsTable = clone(p.statsTable);
    markDirty();
    save();                       // persist overlay + reflect on public views
    excelState.parsed = null;     // close the preview
    msg('Top scorers, fantasy and player stats updated from ' + esc(excelState.fileName) + '.');
    rerenderBody();
  }

  function previewTable(title, head, rows) {
    return '<div class="mng-xl-prev"><div class="mng-xl-cap">' + title + '</div>' +
      '<table class="data"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }
  function excelHTML() {
    var p = excelState.parsed;
    var inner;
    if (excelState.loading) {
      inner = '<div class="mng-xl-status">Loading the Excel reader…</div>';
    } else if (p) {
      var sc = previewTable('Top scorers · ' + p.scorers.length, ['Player', 'Goals'],
        p.scorers.map(function (x) { return '<tr><td class="nm">' + esc(x.n) + '</td><td class="num">' + x.g + '</td></tr>'; }).join(''));
      var fy = previewTable('Fantasy · ' + p.fantasy.length, ['Player', 'Points'],
        p.fantasy.map(function (x) { return '<tr><td class="nm">' + esc(x.n) + '</td><td class="num">' + x.p + '</td></tr>'; }).join(''));
      var stRows = p.statsTable.map(function (x) {
        return '<tr><td class="nm">' + esc(x.n) + '</td><td>' + esc(x.pos || '—') + '</td><td class="num">' + x.apps + '</td><td class="num">' + x.g + '</td><td class="num">' + x.a + '</td><td class="num">' + x.cs + '</td><td class="num">' + x.pts + '</td></tr>';
      }).join('');
      var st = previewTable('Player stats · ' + p.statsTable.length, ['Player', 'Pos', 'Apps', 'G', 'A', 'CS', 'Pts'], stRows);
      inner =
        '<div class="mng-xl-ok">✓ Read <b>' + esc(excelState.fileName) + '</b> — ' +
          p.counts.lb + ' fantasy rows, ' + p.counts.stats + ' player rows. Preview below.</div>' +
        '<div class="mng-xl-grid">' + sc + fy + '</div>' + st +
        '<div class="mng-xl-actions">' +
          '<button class="btn btn-glass btn-sm" id="xlCancel">Cancel</button>' +
          '<button class="btn btn-primary btn-sm" id="xlConfirm">✓ Confirm &amp; save these 3 updates</button>' +
        '</div>';
    } else {
      inner = '<button class="btn btn-primary btn-sm" id="xlPick">⬆ Choose workbook (.xlsx)</button>' +
        (excelState.fileName ? '<span class="mng-xl-file">Last: ' + esc(excelState.fileName) + '</span>' : '');
    }
    return '<div class="mng-card">' +
      '<div class="mng-h">Update from the fantasy workbook <em>scorers · fantasy · player stats</em></div>' +
      '<p class="mng-p">Upload the current <code>PS IA-ITB Fantasy League 2026.xlsx</code>. It reads the ' +
      '<b>Fantasy Points</b>, <b>Player Stats</b> and <b>Player Database</b> sheets, then shows a preview. ' +
      'Confirm to update <b>Top scorers</b>, <b>Fantasy</b> and <b>Player stats</b> together — then it saves. ' +
      'Nothing else on the site is touched.</p>' +
      (excelState.error ? '<div class="mng-xl-err">⚠ ' + esc(excelState.error) + '</div>' : '') +
      inner +
      '<input type="file" id="xlFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />' +
    '</div>';
  }

  /* ---- PUBLISH & BACKUP --------------------------------------- */
  function backupHTML() {
    return '<div class="mng-card">' +
      '<div class="mng-h">Publish to everyone</div>' +
      '<p class="mng-p">Your saved changes show on this device now. To update the <b>live site for all visitors</b>, ' +
      'download a fresh <code>data.js</code> and send it to whoever maintains the website — they replace ' +
      '<code>assets/js/data.js</code> with it. That is the only technical step, and it takes seconds.</p>' +
      '<div class="mng-actions">' +
        '<button class="btn btn-primary btn-sm" id="dlData">⬇ Download data.js (to publish)</button>' +
        '<button class="btn btn-glass btn-sm" id="dlJson">⬇ Download backup (.json)</button>' +
      '</div>' +
      '<div class="mng-h" style="margin-top:28px">Restore</div>' +
      '<p class="mng-p">Revert everything on this device back to the version the site shipped with. ' +
      'This clears your local edits — export a backup first if unsure.</p>' +
      '<button class="btn btn-glass btn-sm" id="revertAll">↺ Revert to shipped version</button>' +
    '</div>';
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
  function buildDataJs() {
    var full = clone(window.PSIA_DATA);
    KEYS.forEach(function (k) { if (draft[k] != null) full[k] = draft[k]; });
    return '/* PSIA Website - content. Edited in the Manage page on ' +
      new Date().toISOString().slice(0, 10) + '. Replaces assets/js/data.js to publish. */\n' +
      'window.PSIA_DATA = ' + JSON.stringify(full, null, 2) + ';\n';
  }

  /* ===============================================================
     SAVE / EVENTS
     =============================================================== */
  function msg(text, isErr) {
    var m = document.getElementById('mngMsg');
    if (!m) return;
    m.textContent = text; m.className = 'mng-msg' + (isErr ? ' err' : ' ok');
    clearTimeout(msg._t); msg._t = setTimeout(function () { if (m) { m.textContent = ''; m.className = 'mng-msg'; } }, 3500);
  }
  function normalize() {
    // numbers as numbers; auto-fill result + id on results
    ['filled', 'slots'].forEach(function (f) { if (draft.next[f] !== '' && draft.next[f] != null) draft.next[f] = +draft.next[f] || 0; });
    ['wins', 'draws', 'losses', 'goals'].forEach(function (f) { draft.season[f] = +draft.season[f] || 0; });
    draft.results.forEach(function (r) {
      r.sp = +r.sp || 0; r.so = +r.so || 0;
      if (!r.r) r.r = autoResult(r.sp, r.so);
      if (!r.id) r.id = slug(r.opp, r.date);
      ['format', 'video', 'photos', 'stats', 'venue'].forEach(function (f) { if (r[f] == null) r[f] = ''; });
    });
    draft.scorers.forEach(function (s) { s.g = +s.g || 0; });
    draft.fantasy.forEach(function (s) { s.p = +s.p || 0; });
    draft.statsTable.forEach(function (s) { ['apps', 'g', 'a', 'cs', 'pts'].forEach(function (f) { s[f] = +s[f] || 0; }); });
    // treasury: integer opening balance; positive integer amounts; sign lives in `direction`
    if (!draft.treasury || typeof draft.treasury !== 'object') draft.treasury = { opening_balance: 0, entries: [] };
    draft.treasury.opening_balance = Math.round(+draft.treasury.opening_balance || 0);
    if (!Array.isArray(draft.treasury.entries)) draft.treasury.entries = [];
    draft.treasury.entries.forEach(function (e) {
      e.amount = Math.abs(Math.round(+e.amount || 0));
      e.direction = e.direction === 'expense' ? 'expense' : 'income';
      if (e.match_id === undefined) e.match_id = null;
      if (e.note == null) e.note = '';
    });
  }
  function save() {
    normalize();
    var overlay = {}; KEYS.forEach(function (k) { overlay[k] = clone(draft[k]); });
    STORE.saveContent(overlay).then(function () {
      applyOverlay(overlay);           // reflect immediately in public views
      dirty = false;
      var b = document.getElementById('mngDirty'); if (b) b.style.visibility = 'hidden';
      rerenderBody();
      msg('Saved. Changes are live on this device — use Publish to share.');
    }).catch(function () { msg('Could not save.', true); });
  }
  function discard() {
    loadDraft(); rerenderBody();
    var b = document.getElementById('mngDirty'); if (b) b.style.visibility = 'hidden';
    msg('Changes discarded.');
  }
  function revertAll() {
    if (!window.confirm('Revert to the shipped version and clear local edits on this device?')) return;
    STORE.resetContent().then(function () {
      window.PSIA_DATA = JSON.parse(JSON.stringify(window.PSIA_DATA_ORIGINAL));
      loadDraft(); rerenderBody();
      msg('Reverted to the shipped version.');
    });
  }

  /* read an edited field back into the draft */
  function onInput(e) {
    var t = e.target;
    if (t && t.id === 'xlFile') { handleExcelFile(t); return; }
    /* Treasury opening-balance + add-entry form (id-based, not data-k) */
    if (t && t.id === 'txOpening') { draft.treasury.opening_balance = t.value; markDirty(); updateKasBar(); return; }
    if (t && t.id === 'txDate') { txForm.date = t.value; return; }
    if (t && t.id === 'txDir') { txForm.direction = t.value; var cs = TX_CATS[t.value] || []; txForm.category = cs.length ? cs[0][0] : ''; rerenderBody(); return; }
    if (t && t.id === 'txCat') { txForm.category = t.value; return; }
    if (t && t.id === 'txAmount') { txForm.amount = t.value; return; }
    if (t && t.id === 'txMatch') { txForm.match_id = t.value; return; }
    if (t && t.id === 'txNote') { txForm.note = t.value; return; }
    /* Member saldo tab (id-based). Search updates only the list to keep focus. */
    if (t && t.id === 'sldSearch') { saldoState.q = t.value; var lst = document.getElementById('sldList'); if (lst) lst.innerHTML = memberRowsHTML(); return; }
    if (t && t.id === 'sldAmt') { saldoState.form.amount = t.value; return; }
    if (t && t.id === 'sldMethod') { saldoState.form.method = t.value; return; }
    if (t && t.id === 'sldNote') { saldoState.form.note = t.value; return; }
    if (t && t.id === 'sldKas') { saldoState.form.toTreasury = t.checked; return; }
    if (t && t.id === 'sldAdjAmt') { saldoState.adj.amount = t.value; return; }
    if (t && t.id === 'sldAdjNote') { saldoState.adj.note = t.value; return; }
    var k = t.getAttribute && t.getAttribute('data-k');
    if (!k || !draft[k]) return;
    var f = t.getAttribute('data-f');
    var iAttr = t.getAttribute('data-i');
    if (iAttr == null) { draft[k][f] = t.value; }
    else { var i = +iAttr; if (draft[k][i]) draft[k][i][f] = t.value; }
    markDirty();
  }

  function blankRow(k) {
    if (k === 'results') return { id: '', date: '', opp: '', sp: 0, so: 0, r: '', venue: '', format: '', video: '', photos: '', stats: '' };
    if (k === 'scorers') return { n: '', g: 0 };
    if (k === 'fantasy') return { n: '', p: 0 };
    if (k === 'statsTable') return { n: '', pos: '', apps: 0, g: 0, a: 0, cs: 0, pts: 0 };
    return {};
  }

  function onClick(e) {
    var t = e.target;
    var gateBtn = t.closest && t.closest('#mngGateBtn'); if (gateBtn) { tryUnlock(); return; }
    if (!unlocked()) return;
    var tb = t.closest && t.closest('[data-tab]');
    if (tb) { tab = tb.getAttribute('data-tab'); render(); return; }
    var add = t.closest && t.closest('[data-add]');
    if (add) { var ak = add.getAttribute('data-add'); if (ak === 'results') draft[ak].unshift(blankRow(ak)); else draft[ak].push(blankRow(ak)); markDirty(); rerenderBody(); return; }
    var del = t.closest && t.closest('[data-del]');
    if (del) { var dk = del.getAttribute('data-del'), di = +del.getAttribute('data-i'); draft[dk].splice(di, 1); markDirty(); rerenderBody(); return; }
    if (t.closest && t.closest('#txAdd')) { addTxEntry(); return; }
    var txdel = t.closest && t.closest('[data-txdel]');
    if (txdel) {
      var tid = txdel.getAttribute('data-txdel');
      draft.treasury.entries = draft.treasury.entries.filter(function (e) { return e.id !== tid; });
      markDirty(); rerenderBody(); return;
    }
    /* Member saldo tab */
    var sldPick = t.closest && t.closest('[data-sld-pick]');
    if (sldPick) {
      saldoState.selId = sldPick.getAttribute('data-sld-pick');
      saldoState.showLog = false; saldoState.msg = null;
      saldoState.form = { amount: '', method: 'cash', note: '', toTreasury: true };
      saldoState.adj = { amount: '', note: '' };
      rerenderBody(); return;
    }
    if (t.closest && t.closest('#sldTopup')) { sldDoTopup(); return; }
    if (t.closest && t.closest('#sldAdjust')) { sldDoAdjust(); return; }
    if (t.closest && t.closest('#sldLog')) { saldoState.showLog = !saldoState.showLog; rerenderBody(); return; }
    if (t.closest && t.closest('#mngSave')) { save(); return; }
    if (t.closest && t.closest('#mngDiscard')) { discard(); return; }
    if (t.closest && t.closest('#xlPick')) { var fi = document.getElementById('xlFile'); if (fi) fi.click(); return; }
    if (t.closest && t.closest('#xlConfirm')) { confirmExcel(); return; }
    if (t.closest && t.closest('#xlCancel')) { excelState.parsed = null; excelState.error = null; rerenderBody(); return; }
    if (t.closest && t.closest('#nxFill')) { fillNextDate(); return; }
    if (t.closest && t.closest('#seasonAuto')) { seasonAuto(); return; }
    if (t.closest && t.closest('#revertAll')) { revertAll(); return; }
    if (t.closest && t.closest('#dlData')) { normalize(); download('data.js', buildDataJs(), 'text/javascript'); msg('data.js downloaded — send it to the site maintainer.'); return; }
    if (t.closest && t.closest('#dlJson')) { normalize(); var o = {}; KEYS.forEach(function (k) { o[k] = draft[k]; }); download('psia-content-backup.json', JSON.stringify(o, null, 2), 'application/json'); msg('Backup downloaded.'); return; }
  }
  function onKey(e) { if (e.key === 'Enter' && document.getElementById('mngGate')) { e.preventDefault(); tryUnlock(); } }

  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  /* ===============================================================
     REGISTER THE VIEW (chain PSIA_AFTER_RENDER, add to EXTRA_VIEWS)
     =============================================================== */
  window.PSIA_EXTRA_VIEWS = window.PSIA_EXTRA_VIEWS || {};
  window.PSIA_EXTRA_VIEWS.manage = function () { return '<div id="mngRoot"></div>'; };

  var prevAfter = window.PSIA_AFTER_RENDER;
  window.PSIA_AFTER_RENDER = function (view) {
    if (typeof prevAfter === 'function') prevAfter(view);
    if (view === 'manage') render();
  };
})();
