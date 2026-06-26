/* PSIA Website — AUTH module (auth.js)
   --------------------------------------------------------------
   Accounts + sign-in, all through window.PSIA_STORE (so a real
   backend swaps in later without touching views). Provides:

     • the "account" view (sign in / sign up / profile)
     • window.PSIA_AUTH — a small session helper used by the
       header and by the register view (squad.js):
         PSIA_AUTH.user            cached current account (or null)
         PSIA_AUTH.ready           Promise, resolves after first load
         PSIA_AUTH.refresh()       reload session + repaint header
         PSIA_AUTH.requireUser()   Promise<account>  (rejects if none)

   NOTE: the default storage is browser localStorage — soft, client
   side only, NOT real security. See store.js for the backend hooks. */
(function () {
  'use strict';

  var STORE = window.PSIA_STORE;
  var POS = (STORE && STORE.POSITIONS) || ['GK', 'DF', 'MF', 'FW'];
  var POS_LABEL = (STORE && STORE.POSITION_LABEL) ||
    { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortName(name) {
    var parts = String(name || '').trim().split(/\s+/);
    if (parts.length <= 1) return parts[0] || '';
    return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
  }
  function root() { return document.getElementById('authRoot'); }

  /* A ready-made account so you can explore every page without signing up.
     Seeded on load (no auto-session); the "Sign in as demo" button logs in. */
  var DEMO = { name: 'Demo Player', position: 'MF', email: 'demo@psia.com', phone: '08000000000' };
  var ADMIN_HINT = 'psia2026'; // matches the Team-selection passcode in squad.js
  STORE.ensureDemoAccount(DEMO).then(function () { paintHeader(); });

  /* ============================================================
     Session helper (PSIA_AUTH)
     ============================================================ */
  var AUTH = {
    user: null,
    _subs: [],
    onChange: function (fn) { if (typeof fn === 'function') this._subs.push(fn); },
    _emit: function () { var u = this.user; this._subs.forEach(function (f) { try { f(u); } catch (e) {} }); },
    refresh: function () {
      var self = this;
      return STORE.currentUser().then(function (u) {
        self.user = u || null;
        paintHeader();
        self._emit();
        return self.user;
      });
    },
    requireUser: function () {
      return this.user ? Promise.resolve(this.user) : this.refresh().then(function (u) {
        return u ? u : Promise.reject(new Error('Not signed in.'));
      });
    }
  };
  AUTH.ready = AUTH.refresh();
  window.PSIA_AUTH = AUTH;

  /* ---- header sign-in state ---- */
  function paintHeader() {
    var btn = document.getElementById('acctBtn');
    if (btn) {
      btn.textContent = AUTH.user ? shortName(AUTH.user.name) : 'Sign in';
      btn.classList.toggle('signed-in', !!AUTH.user);
    }
    var mob = document.getElementById('mobAcct');
    if (mob) mob.textContent = AUTH.user ? ('Account · ' + shortName(AUTH.user.name)) : 'Sign in';
  }

  /* ============================================================
     ACCOUNT view
     ============================================================ */
  var signupPos = null; // chosen position while creating an account
  var editPos = null;   // chosen position while editing profile

  function renderAccount() {
    var el = root();
    if (!el) return;
    // make sure we have the freshest session before painting
    STORE.currentUser().then(function (u) {
      AUTH.user = u || null;
      paintHeader();
      if (AUTH.user) renderProfile(AUTH.user);
      else renderAuthForms();
    });
  }

  function posChips(attr, current) {
    return '<div class="poschips" data-au-group="' + attr + '">' +
      POS.map(function (p) {
        return '<button type="button" class="poschip' + (p === current ? ' on' : '') +
          '" data-' + attr + '="' + p + '"><b>' + p + '</b><i>' + POS_LABEL[p] + '</i></button>';
      }).join('') + '</div>';
  }

  /* ---- signed out: sign in + create account ---- */
  function renderAuthForms() {
    signupPos = null;
    var el = root();
    el.innerHTML =
      '<div class="page-head"><h1>Your account</h1>' +
      '<p>Sign in to register for matches in one tap. Your name and usual position ' +
      'are saved to your profile, so you never have to type them again.</p></div>' +

      '<section class="sec">' +
        '<div class="shead"><span class="num">01</span><span class="lbl">Sign in</span></div>' +
        '<div class="reg-form" style="max-width:480px">' +
          '<div class="demo-box">' +
            '<div class="demo-h">🎟 Just exploring?</div>' +
            '<p>Use the demo account to see every page — including one-tap registration.</p>' +
            '<button type="button" class="btn btn-primary" id="demoBtn">Sign in as demo →</button>' +
            '<div class="demo-creds">Account: <b>demo@psia.com</b> · Team-selection code: <b>' + ADMIN_HINT + '</b></div>' +
          '</div>' +
          '<label class="fld"><span>Email or phone</span>' +
            '<input id="siId" type="text" autocomplete="username" placeholder="you@email.com or 08…" /></label>' +
          '<div class="reg-actions">' +
            '<button type="button" class="btn btn-primary" id="siBtn">Sign in →</button>' +
            '<span class="reg-msg" id="siMsg"></span>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="sec last">' +
        '<div class="shead"><span class="num gold">02</span><span class="lbl">New here? Create an account</span></div>' +
        '<div class="reg-form">' +
          '<label class="fld"><span>Full name</span>' +
            '<input id="suName" type="text" autocomplete="name" placeholder="e.g. Thona Elisa" /></label>' +
          '<div class="fld"><span>Usual position</span>' + posChips('au-pos', null) + '</div>' +
          '<div class="reg-2col">' +
            '<label class="fld"><span>Email <em>(email or phone required)</em></span>' +
              '<input id="suEmail" type="email" autocomplete="email" placeholder="you@email.com" /></label>' +
            '<label class="fld"><span>Phone <em>(optional)</em></span>' +
              '<input id="suPhone" type="tel" autocomplete="tel" placeholder="08…" /></label>' +
          '</div>' +
          '<div class="reg-actions">' +
            '<button type="button" class="btn btn-primary" id="suBtn">Create account →</button>' +
            '<span class="reg-msg" id="suMsg"></span>' +
          '</div>' +
          '<p class="muted-sm">Email or phone is just your sign-in handle and is visible to coaching staff. No password — this is a soft, community-only sign-in.</p>' +
        '</div>' +
      '</section>';
  }

  /* ---- signed in: profile + edit ---- */
  function renderProfile(u) {
    editPos = u.position;
    var el = root();
    el.innerHTML =
      '<div class="page-head"><h1>Hi, ' + escapeHtml(u.name.split(/\s+/)[0]) + '</h1>' +
      '<p>This is your profile. Match registration uses these details automatically.</p></div>' +

      '<section class="sec">' +
        '<div class="shead"><span class="num">01</span><span class="lbl">Profile</span></div>' +
        '<div class="reg-form">' +
          '<label class="fld"><span>Full name</span>' +
            '<input id="pfName" type="text" autocomplete="name" value="' + escapeHtml(u.name) + '" /></label>' +
          '<div class="fld"><span>Usual position</span>' + posChips('au-epos', u.position) + '</div>' +
          '<div class="reg-2col">' +
            '<label class="fld"><span>Email</span>' +
              '<input id="pfEmail" type="email" value="' + escapeHtml(u.email || '') + '" placeholder="you@email.com" /></label>' +
            '<label class="fld"><span>Phone</span>' +
              '<input id="pfPhone" type="tel" value="' + escapeHtml(u.phone || '') + '" placeholder="08…" /></label>' +
          '</div>' +
          '<div class="reg-actions">' +
            '<button type="button" class="btn btn-primary" id="pfSave">Save changes</button>' +
            '<button type="button" class="btn btn-glass btn-sm" id="goRegister" data-view="register">Register for the match →</button>' +
            '<span class="reg-msg" id="pfMsg"></span>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="sec last">' +
        '<div class="shead"><span class="num gold">02</span><span class="lbl">Session</span></div>' +
        '<div class="reg-form" style="max-width:480px">' +
          '<p class="muted-sm" style="margin:0">Signed in as <b>' + escapeHtml(u.email || u.phone || u.name) + '</b>.</p>' +
          '<div class="reg-actions"><button type="button" class="btn btn-glass" id="signOutBtn">Sign out</button></div>' +
        '</div>' +
      '</section>';
  }

  /* ============================================================
     Actions
     ============================================================ */
  function msg(id, text, ok) {
    var m = document.getElementById(id);
    if (m) { m.textContent = text; m.className = 'reg-msg ' + (ok ? 'ok' : 'err'); }
  }

  function doSignIn() {
    var id = (document.getElementById('siId') || {}).value || '';
    if (!id.trim()) return msg('siMsg', 'Enter your email or phone.');
    STORE.signIn(id).then(function (u) {
      AUTH.user = u; paintHeader(); AUTH._emit();
      // straight to registering — that's why people sign in
      if (window.PSIA_APP) window.PSIA_APP.show('register');
    }).catch(function (e) { msg('siMsg', e.message || 'Could not sign in.'); });
  }

  function doDemoSignIn() {
    STORE.ensureDemoAccount(DEMO)
      .then(function () { return STORE.signIn(DEMO.email); })
      .then(function (u) {
        AUTH.user = u; paintHeader(); AUTH._emit();
        if (window.PSIA_APP) window.PSIA_APP.show('register');
      })
      .catch(function (e) { msg('siMsg', e.message || 'Could not start demo.'); });
  }

  function doSignUp() {
    var name = (document.getElementById('suName') || {}).value || '';
    var email = (document.getElementById('suEmail') || {}).value || '';
    var phone = (document.getElementById('suPhone') || {}).value || '';
    if (!name.trim()) return msg('suMsg', 'Enter your name.');
    if (!signupPos) return msg('suMsg', 'Pick your usual position.');
    STORE.createAccount({ name: name, position: signupPos, email: email, phone: phone })
      .then(function (u) {
        AUTH.user = u; paintHeader(); AUTH._emit();
        if (window.PSIA_APP) window.PSIA_APP.show('register');
      })
      .catch(function (e) { msg('suMsg', e.message || 'Could not create account.'); });
  }

  function doSaveProfile() {
    var name = (document.getElementById('pfName') || {}).value || '';
    var email = (document.getElementById('pfEmail') || {}).value || '';
    var phone = (document.getElementById('pfPhone') || {}).value || '';
    if (!name.trim()) return msg('pfMsg', 'Name can\'t be empty.');
    STORE.updateProfile({ name: name, position: editPos, email: email, phone: phone })
      .then(function (u) {
        AUTH.user = u; paintHeader(); AUTH._emit();
        msg('pfMsg', '✓ Saved', true);
        setTimeout(function () { var m = document.getElementById('pfMsg'); if (m) m.textContent = ''; }, 2200);
      })
      .catch(function (e) { msg('pfMsg', e.message || 'Could not save.'); });
  }

  function doSignOut() {
    STORE.signOut().then(function () {
      AUTH.user = null; paintHeader(); AUTH._emit();
      renderAuthForms();
    });
  }

  /* ============================================================
     Events (delegated, scoped to #authRoot + header acct button)
     ============================================================ */
  function inAuth(t) { return t && t.closest && t.closest('#authRoot'); }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!inAuth(t)) return;

    // position chips (sign-up + edit)
    var sp = t.closest('[data-au-pos]');
    if (sp) {
      signupPos = sp.getAttribute('data-au-pos');
      root().querySelectorAll('[data-au-pos]').forEach(function (c) { c.classList.remove('on'); });
      sp.classList.add('on');
      return;
    }
    var ep = t.closest('[data-au-epos]');
    if (ep) {
      editPos = ep.getAttribute('data-au-epos');
      root().querySelectorAll('[data-au-epos]').forEach(function (c) { c.classList.remove('on'); });
      ep.classList.add('on');
      return;
    }

    if (t.closest('#demoBtn')) { doDemoSignIn(); return; }
    if (t.closest('#siBtn')) { doSignIn(); return; }
    if (t.closest('#suBtn')) { doSignUp(); return; }
    if (t.closest('#pfSave')) { doSaveProfile(); return; }
    if (t.closest('#signOutBtn')) { doSignOut(); return; }
    // #goRegister is handled by app.js router via data-view
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !inAuth(e.target)) return;
    var id = e.target.id;
    if (id === 'siId') { e.preventDefault(); doSignIn(); }
    else if (id === 'suName' || id === 'suEmail' || id === 'suPhone') { e.preventDefault(); doSignUp(); }
  });

  /* ============================================================
     Hook into the router
     ============================================================ */
  window.PSIA_EXTRA_VIEWS = window.PSIA_EXTRA_VIEWS || {};
  window.PSIA_EXTRA_VIEWS.account = function () { return '<div id="authRoot" class="sqRoot"></div>'; };

  var prevAfter = window.PSIA_AFTER_RENDER;
  window.PSIA_AFTER_RENDER = function (view) {
    if (typeof prevAfter === 'function') prevAfter(view);
    paintHeader();
    if (view === 'account') renderAccount();
  };

  // initial header paint once DOM is ready
  paintHeader();
})();
