/* PSIA Website — DATA LAYER (store.js)
   ------------------------------------------------------------------
   Single source of truth for match REGISTRATIONS and admin LINEUPS.

   Everything the registration form and the admin tactical board read or
   write goes through window.PSIA_STORE. The methods are all async (they
   return Promises) even though the default implementation is synchronous
   localStorage — so you can swap in a real backend later WITHOUT touching
   any view code.

   ----------------------------------------------------------------------
   SWAPPING IN A REAL BACKEND (Firebase / Supabase / your own API)
   ----------------------------------------------------------------------
   Implement an object with the same method signatures as LocalBackend
   below, then set:  PSIA_STORE._backend = new MyBackend();
   The marked "// >>> BACKEND" blocks are the only spots that talk to
   storage. Replace those bodies with network calls and you're done.
   ----------------------------------------------------------------------

   POSITIONS (registration): GK | DF | MF | FW
*/
(function () {
  'use strict';

  var POSITIONS = ['GK', 'DF', 'MF', 'FW'];
  var POSITION_LABEL = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };

  /* Map the player-database codes (FWD/DEF/MID/GK) onto our 4 codes,
     used only when seeding demo registrants from PSIA_DATA.statsTable. */
  function normalizePos(raw) {
    var p = String(raw || '').toUpperCase();
    if (p.indexOf('G') === 0) return 'GK';
    if (p.indexOf('D') === 0) return 'DF';
    if (p.indexOf('M') === 0) return 'MF';
    if (p.indexOf('F') === 0 || p.indexOf('W') === 0 || p.indexOf('S') === 0) return 'FW';
    return 'MF';
  }

  function uid() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function resolve(v) { return Promise.resolve(clone(v)); }
  function reject(msg) { return Promise.reject(new Error(msg)); }
  function todayISO() {
    var d = new Date(), m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }
  function sid(p) { return (p || 's_') + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }

  /* Payment fields live ON each registration so "who registered" and "who
     paid" are never out of sync. Flow: unpaid → (player) claimed → (admin) paid.
       payStatus      'unpaid' | 'claimed' | 'paid'   (default 'unpaid')
       payAmount      number | null   (set when the admin confirms)
       payClaimedAt   ms | null       (player tapped "I've paid")
       payConfirmedAt ms | null       (admin finalized — this is the "date paid")
     normalizePay() backfills older rows so views never see undefined. */
  function normalizePay(r) {
    if (!r) return r;
    if (r.payStatus !== 'paid' && r.payStatus !== 'claimed') r.payStatus = 'unpaid';
    r.payAmount = (typeof r.payAmount === 'number') ? r.payAmount : (r.payAmount == null ? null : (+r.payAmount || null));
    if (r.payClaimedAt === undefined) r.payClaimedAt = null;
    if (r.payConfirmedAt === undefined) r.payConfirmedAt = null;
    if (r.payMethod === undefined) r.payMethod = null;   // 'cash'|'transfer'|'saldo'|'manual'|null
    return r;
  }

  /* Saldo (prepaid wallet) lives on the member ACCOUNT so it persists across
     every match. saldo = current balance (integer Rp); saldoLog = audit trail
     of every change (top-up / fee deduction / refund / adjust). */
  function ensureSaldo(a) {
    if (!a) return a;
    if (typeof a.saldo !== 'number') a.saldo = +a.saldo || 0;
    if (!Array.isArray(a.saldoLog)) a.saldoLog = [];
    return a;
  }
  /* Build a club-kas (treasury) income entry for a saldo top-up. Same shape the
     Manage page uses; category 'saldo' is rendered as-is by the treasury views. */
  function saldoTxEntry(acct, opts) {
    return {
      id: sid('tx_saldo_'), date: todayISO(), direction: 'income', category: 'saldo',
      amount: Math.abs(Math.round(+opts.amount || 0)), match_id: null,
      note: 'Saldo top-up — ' + ((acct && acct.name) || 'player') +
            (opts.method ? ' (' + opts.method + ')' : '') + (opts.note ? ' · ' + opts.note : '')
    };
  }

  /* ============================================================
     LocalBackend — default storage (browser localStorage)
     ============================================================ */
  function LocalBackend() {
    this.KEY = 'psia.store.v1';
    this.ACCT_KEY = 'psia.accounts.v1';   // all accounts (array)
    this.SESS_KEY = 'psia.session.v1';     // signed-in account id
    this.CONTENT_KEY = 'psia.content.v1';  // admin content overlay (next/results/stats/…)
  }
  LocalBackend.prototype._read = function () {
    // >>> BACKEND: replace with a fetch of the whole dataset, or split per-collection.
    try {
      var raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : { registrations: [], lineups: {} };
    } catch (e) {
      return { registrations: [], lineups: {} };
    }
  };
  LocalBackend.prototype._write = function (db) {
    // >>> BACKEND: replace with a write (or rely on per-method writes below).
    try { localStorage.setItem(this.KEY, JSON.stringify(db)); } catch (e) {}
  };

  LocalBackend.prototype.listRegistrations = function (matchId) {
    var db = this._read();
    var rows = db.registrations.filter(function (r) { return r.matchId === matchId; });
    rows.forEach(normalizePay);
    rows.sort(function (a, b) { return a.ts - b.ts; });
    return resolve(rows);
  };
  LocalBackend.prototype.addRegistration = function (reg) {
    var db = this._read();
    // de-dupe: by accountId when present (one registration per account per match),
    // otherwise fall back to (matchId, lowercased name).
    var existing = db.registrations.find(function (r) {
      if (reg.accountId && r.accountId) return r.matchId === reg.matchId && r.accountId === reg.accountId;
      return (r.matchId + '::' + r.name.trim().toLowerCase()) === (reg.matchId + '::' + reg.name.trim().toLowerCase());
    });
    if (existing) {
      existing.name = reg.name.trim();
      existing.position = reg.position;
      existing.note = reg.note || '';
      if (reg.accountId) existing.accountId = reg.accountId;
      this._write(db);
      return resolve(existing);
    }
    var row = {
      id: uid(), matchId: reg.matchId, name: reg.name.trim(),
      position: reg.position, note: reg.note || '', accountId: reg.accountId || null, ts: Date.now(),
      payStatus: 'unpaid', payAmount: null, payClaimedAt: null, payConfirmedAt: null, payMethod: null
    };
    db.registrations.push(row);
    this._write(db);
    return resolve(row);
  };
  LocalBackend.prototype.removeRegistration = function (id) {
    var db = this._read();
    db.registrations = db.registrations.filter(function (r) { return r.id !== id; });
    // also strip from any lineup slots
    Object.keys(db.lineups).forEach(function (mid) {
      var slots = db.lineups[mid].slots || {};
      Object.keys(slots).forEach(function (sid) {
        var s = slots[sid];
        if (s.starterId === id) s.starterId = null;
        s.backups = (s.backups || []).filter(function (b) { return b !== id; });
      });
    });
    this._write(db);
    return resolve(true);
  };
  /* Update ONLY the payment fields of one registration (claim / confirm / clear).
     >>> BACKEND: replace with a PATCH of the registration row. */
  LocalBackend.prototype.setPayment = function (id, patch) {
    var db = this._read();
    var row = db.registrations.find(function (r) { return r.id === id; });
    if (!row) return Promise.reject(new Error('Registration not found.'));
    patch = patch || {};
    if (patch.payStatus != null) row.payStatus = patch.payStatus;
    if (patch.payAmount !== undefined) row.payAmount = (patch.payAmount == null ? null : (+patch.payAmount || 0));
    if (patch.payClaimedAt !== undefined) row.payClaimedAt = patch.payClaimedAt;
    if (patch.payConfirmedAt !== undefined) row.payConfirmedAt = patch.payConfirmedAt;
    if (patch.payMethod !== undefined) row.payMethod = patch.payMethod;
    normalizePay(row);
    this._write(db);
    return resolve(row);
  };

  /* ---- SALDO (wallet) -------------------------------------------------
     payFromSaldo / voidPayment bridge the registrations store (KEY) and the
     accounts store (ACCT_KEY); top-ups can also feed the club kas (treasury,
     CONTENT_KEY) so the books stay consistent. >>> BACKEND: these become
     transactional API calls; the view code never changes.                 */
  LocalBackend.prototype._findAcct = function (list, id) {
    return list.find(function (a) { return a.id === id; }) || null;
  };
  LocalBackend.prototype._pushSaldo = function (acct, delta, reason, extra) {
    ensureSaldo(acct); extra = extra || {};
    acct.saldo = Math.round(acct.saldo + Math.round(delta));
    acct.saldoLog.push({
      id: sid('s_'), ts: Date.now(), delta: Math.round(delta), balanceAfter: acct.saldo,
      reason: reason, method: extra.method || null, matchId: extra.matchId || null, note: extra.note || ''
    });
  };
  LocalBackend.prototype.listAccounts = function () {
    var list = this._readAccounts(); list.forEach(ensureSaldo); return resolve(list);
  };
  LocalBackend.prototype.getAccount = function (id) {
    var a = this._findAcct(this._readAccounts(), id); if (a) ensureSaldo(a); return resolve(a || null);
  };
  LocalBackend.prototype.topUpSaldo = function (id, opts) {
    opts = opts || {};
    var amt = Math.abs(Math.round(+opts.amount || 0));
    if (amt <= 0) return reject('Top-up amount must be greater than zero.');
    var list = this._readAccounts(), acct = this._findAcct(list, id);
    if (!acct) return reject('Account not found.');
    this._pushSaldo(acct, amt, 'topup', { method: opts.method || 'cash', note: opts.note || '' });
    this._writeAccounts(list);
    return resolve(acct);
  };
  LocalBackend.prototype.adjustSaldo = function (id, delta, note) {
    var d = Math.round(+delta || 0);
    if (!d) return reject('Enter a non-zero adjustment.');
    var list = this._readAccounts(), acct = this._findAcct(list, id);
    if (!acct) return reject('Account not found.');
    this._pushSaldo(acct, d, 'adjust', { note: note || '' });
    this._writeAccounts(list);
    return resolve(acct);
  };
  LocalBackend.prototype.payFromSaldo = function (regId, amount) {
    var db = this._read();
    var row = db.registrations.find(function (r) { return r.id === regId; });
    if (!row) return reject('Registration not found.');
    if (!row.accountId) return reject('This player has no linked account, so they have no saldo.');
    var list = this._readAccounts(), acct = this._findAcct(list, row.accountId);
    if (!acct) return reject('No account found for this player.');
    ensureSaldo(acct);
    var amt = Math.abs(Math.round(+amount || 0));
    if (amt <= 0) return reject('Amount must be greater than zero.');
    if (acct.saldo < amt) return reject('Not enough saldo — balance is ' + acct.saldo + ', fee is ' + amt + '.');
    this._pushSaldo(acct, -amt, 'fee', { matchId: row.matchId, note: 'Match fee' });
    this._writeAccounts(list);
    row.payStatus = 'paid'; row.payAmount = amt; row.payConfirmedAt = Date.now(); row.payMethod = 'saldo';
    normalizePay(row);
    this._write(db);
    return resolve({ registration: row, account: acct });
  };
  /* Set a registration back to unpaid; if it was settled FROM saldo, credit it
     back so balances never drift. Used for the Payments "Mark unpaid" action. */
  LocalBackend.prototype.voidPayment = function (regId) {
    var db = this._read();
    var row = db.registrations.find(function (r) { return r.id === regId; });
    if (!row) return reject('Registration not found.');
    if (row.payMethod === 'saldo' && row.payStatus === 'paid' && row.accountId) {
      var list = this._readAccounts(), acct = this._findAcct(list, row.accountId);
      if (acct) {
        ensureSaldo(acct);
        this._pushSaldo(acct, Math.abs(Math.round(+row.payAmount || 0)), 'refund', { matchId: row.matchId, note: 'Refund — payment voided' });
        this._writeAccounts(list);
      }
    }
    row.payStatus = 'unpaid'; row.payAmount = null; row.payClaimedAt = null; row.payConfirmedAt = null; row.payMethod = null;
    normalizePay(row);
    this._write(db);
    return resolve(row);
  };
  /* Append one entry to the club kas (treasury content overlay), preserving any
     other content the Manage page has saved. Mirrors the manage.js entry shape. */
  LocalBackend.prototype.addTreasuryEntry = function (entry) {
    var overlay = this.getContentSync() || {};
    var t = overlay.treasury;
    if (!t || typeof t !== 'object') {
      var base = (window.PSIA_DATA && window.PSIA_DATA.treasury) || { opening_balance: 0, entries: [] };
      t = clone(base);
    }
    if (typeof t.opening_balance !== 'number') t.opening_balance = +t.opening_balance || 0;
    if (!Array.isArray(t.entries)) t.entries = [];
    t.entries.push(entry);
    overlay.treasury = t;
    try { localStorage.setItem(this.CONTENT_KEY, JSON.stringify(overlay)); } catch (e) {}
    if (window.PSIA_DATA) window.PSIA_DATA.treasury = clone(t);   // reflect on the live home kas card
    return resolve(t);
  };
  LocalBackend.prototype.getLineup = function (matchId) {
    var db = this._read();
    return resolve(db.lineups[matchId] || null);
  };
  LocalBackend.prototype.saveLineup = function (matchId, lineup) {
    var db = this._read();
    lineup.matchId = matchId;
    lineup.updatedAt = Date.now();
    db.lineups[matchId] = lineup;
    this._write(db);
    return resolve(lineup);
  };
  LocalBackend.prototype.replaceRegistrations = function (matchId, rows) {
    var db = this._read();
    db.registrations = db.registrations.filter(function (r) { return r.matchId !== matchId; });
    db.registrations = db.registrations.concat(rows);
    this._write(db);
    return resolve(rows);
  };

  /* ---- CONTENT OVERLAY -------------------------------------------
     The site's public content (next fixture, results, scorers, fantasy,
     stats table, season totals) ships in assets/js/data.js. The admin
     "Manage" page lets non-technical volunteers edit that content; their
     edits are saved here as an OVERLAY that is merged over PSIA_DATA at
     boot, so the public views show the changes.

     LIMITATION (today): localStorage is per-browser, so edits show up only
     on the device that made them. To make edits public for everyone, the
     admin page exports a fresh data.js (the "publish" step).

     >>> BACKEND: replace these three bodies with calls to a shared store
     (Firebase / Supabase / your API). getContentSync exists only so the
     boot merge can run before first paint on the local prototype; with a
     real backend you'd fetch getContent() asynchronously at boot and
     re-render once it resolves. View code never changes.                 */
  LocalBackend.prototype.getContentSync = function () {
    // >>> BACKEND: not used with a network backend (boot fetch is async).
    try {
      var raw = localStorage.getItem(this.CONTENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  LocalBackend.prototype.getContent = function () {
    return resolve(this.getContentSync());
  };
  LocalBackend.prototype.saveContent = function (overlay) {
    // >>> BACKEND: persist the content overlay to your shared store.
    try { localStorage.setItem(this.CONTENT_KEY, JSON.stringify(overlay)); } catch (e) {}
    return resolve(overlay);
  };
  LocalBackend.prototype.resetContent = function () {
    // >>> BACKEND: clear the shared overlay (revert to the shipped data.js).
    try { localStorage.removeItem(this.CONTENT_KEY); } catch (e) {}
    return resolve(true);
  };

  /* ---- ACCOUNTS + SESSION ----------------------------------------
     Soft, client-side auth: accounts and the "logged-in" session both
     live in localStorage. This is NOT real security — anyone with the
     browser can read it. Swap these >>> BACKEND blocks for real calls
     (Firebase Auth / Supabase / your API) when you add a backend; the
     view code never changes because it only talks to PSIA_STORE.       */
  LocalBackend.prototype._readAccounts = function () {
    // >>> BACKEND: fetch the user/account records.
    try {
      var raw = localStorage.getItem(this.ACCT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  };
  LocalBackend.prototype._writeAccounts = function (list) {
    // >>> BACKEND: persist account records (or rely on your API per-call).
    try { localStorage.setItem(this.ACCT_KEY, JSON.stringify(list)); } catch (e) {}
  };
  LocalBackend.prototype._normId = function (s) { return String(s || '').trim().toLowerCase(); };
  /* Match an account by email OR phone (whichever the person typed). */
  LocalBackend.prototype._findByIdentifier = function (list, identifier) {
    var id = this._normId(identifier);
    if (!id) return null;
    var digits = id.replace(/[^\d]/g, '');
    var self = this;
    return list.find(function (a) {
      if (a.email && self._normId(a.email) === id) return true;
      if (a.phone) {
        var p = String(a.phone).replace(/[^\d]/g, '');
        if (digits && p && p === digits) return true;
      }
      return false;
    }) || null;
  };

  LocalBackend.prototype.createAcco