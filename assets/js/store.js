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
      position: reg.position, note: reg.note || '', accountId: reg.accountId || null, ts: Date.now()
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

  LocalBackend.prototype.createAccount = function (profile) {
    var list = this._readAccounts();
    var email = (profile.email || '').trim();
    var phone = (profile.phone || '').trim();
    // an email or phone is the sign-in handle, so we need at least one and it must be unique
    if (!email && !phone) return Promise.reject(new Error('Add an email or phone so you can sign in.'));
    if (email && this._findByIdentifier(list, email)) return Promise.reject(new Error('An account with that email already exists — sign in instead.'));
    if (phone && this._findByIdentifier(list, phone)) return Promise.reject(new Error('An account with that phone already exists — sign in instead.'));
    var acct = {
      id: 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: profile.name.trim(),
      position: profile.position,
      email: email,
      phone: phone,
      createdAt: Date.now()
    };
    list.push(acct);
    this._writeAccounts(list);
    // >>> BACKEND: set the session token your auth provider returns.
    try { localStorage.setItem(this.SESS_KEY, acct.id); } catch (e) {}
    return resolve(acct);
  };
  /* Seed an account WITHOUT signing in (used for the demo login). No-op if
     an account with the same email/phone already exists. */
  LocalBackend.prototype.ensureAccount = function (profile) {
    var list = this._readAccounts();
    var found = this._findByIdentifier(list, profile.email) || this._findByIdentifier(list, profile.phone);
    if (found) return resolve(found);
    var acct = {
      id: 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: profile.name.trim(),
      position: profile.position,
      email: (profile.email || '').trim(),
      phone: (profile.phone || '').trim(),
      createdAt: Date.now()
    };
    list.push(acct);
    this._writeAccounts(list);
    return resolve(acct);
  };
  LocalBackend.prototype.signIn = function (identifier) {
    var list = this._readAccounts();
    var acct = this._findByIdentifier(list, identifier);
    if (!acct) return Promise.reject(new Error('No account found for that email or phone.'));
    // >>> BACKEND: here you'd verify a password / OTP before issuing a session.
    try { localStorage.setItem(this.SESS_KEY, acct.id); } catch (e) {}
    return resolve(acct);
  };
  LocalBackend.prototype.signOut = function () {
    // >>> BACKEND: revoke the session token.
    try { localStorage.removeItem(this.SESS_KEY); } catch (e) {}
    return resolve(true);
  };
  LocalBackend.prototype.currentUser = function () {
    var id;
    try { id = localStorage.getItem(this.SESS_KEY); } catch (e) { id = null; }
    if (!id) return resolve(null);
    var acct = this._readAccounts().find(function (a) { return a.id === id; });
    return resolve(acct || null);
  };
  LocalBackend.prototype.updateAccount = function (patch) {
    var sid;
    try { sid = localStorage.getItem(this.SESS_KEY); } catch (e) { sid = null; }
    if (!sid) return Promise.reject(new Error('Not signed in.'));
    var list = this._readAccounts();
    var acct = list.find(function (a) { return a.id === sid; });
    if (!acct) return Promise.reject(new Error('Account not found.'));
    // guard uniqueness if email/phone is being changed
    var newEmail = patch.email != null ? patch.email.trim() : acct.email;
    var newPhone = patch.phone != null ? patch.phone.trim() : acct.phone;
    if (!newEmail && !newPhone) return Promise.reject(new Error('Keep at least an email or phone.'));
    var self = this;
    var clash = list.find(function (a) {
      if (a.id === acct.id) return false;
      if (newEmail && self._normId(a.email) === self._normId(newEmail)) return true;
      if (newPhone && String(a.phone).replace(/[^\d]/g, '') && String(a.phone).replace(/[^\d]/g, '') === String(newPhone).replace(/[^\d]/g, '')) return true;
      return false;
    });
    if (clash) return Promise.reject(new Error('Another account already uses that email or phone.'));
    if (patch.name != null) acct.name = patch.name.trim();
    if (patch.position != null) acct.position = patch.position;
    acct.email = newEmail;
    acct.phone = newPhone;
    this._writeAccounts(list);
    return resolve(acct);
  };

  /* ============================================================
     PSIA_STORE — the public facade used by every view
     ============================================================ */
  var Store = {
    POSITIONS: POSITIONS,
    POSITION_LABEL: POSITION_LABEL,
    _backend: new LocalBackend(),

    // --- registrations -------------------------------------------------
    getRegistrations: function (matchId) {
      return this._backend.listRegistrations(matchId);
    },
    register: function (data) {
      if (!data || !data.name || !data.name.trim()) {
        return Promise.reject(new Error('Name is required'));
      }
      if (POSITIONS.indexOf(data.position) === -1) {
        return Promise.reject(new Error('Pick a position: ' + POSITIONS.join(', ')));
      }
      return this._backend.addRegistration({
        matchId: data.matchId, name: data.name, position: data.position,
        note: data.note, accountId: data.accountId
      });
    },
    unregister: function (id) { return this._backend.removeReg