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
  var KEYS = (STORE && STORE.CONTENT_KEYS) || ['next', 'season', 'results', 'scorers', 'fantasy', 'statsTable'];

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
  function loadDraft() {
    draft = {};
    KEYS.forEach(function (k) {
      var v = window.PSIA_DATA[k];
      draft[k] = v == null ? (k === 'next' || k === 'season' ? {} : []) : clone(v);
    });
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
    excelState.fileName = file.name; excelState.error = null; excelState.par