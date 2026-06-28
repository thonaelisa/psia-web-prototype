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
  function rpA(n) { var v = Math.round(+n || 0); return 'Rp ' + Math.abs(v).toLocaleString('en-US'); }
  function dShort(ms) { if (!ms) return ''; try { return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); } catch (e) { return ''; } }
  var SREASON = { topup: 'Top-up', fee: 'Match fee', refund: 'Refund', adjust: 'Adjustment' };

  /* Read-only saldo (prepaid wallet) panel for the signed-in player. Top-ups
     are committee-only; players just see their balance + recent history. */
  function saldoSectionHTML(u) {
    var bal = (typeof u.saldo === 'number') ? u.saldo : (+u.saldo || 0);
    var log = (u.saldoLog || []).slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 8);
    var rows = log.length ? log.map(function (e) {
      var pos = e.delta >= 0;
      return '<div style="display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid #1F2A41;font-size:13px">' +
        '<span class="mono" style="color:#5E6A82;width:54px">' + dShort(e.ts) + '</span>' +
        '<span style="flex:1">' + (SREASON[e.reason] || e.reason) + (e.note ? ' · ' + escapeHtml(e.note) : '') + '</span>' +
        '<span class="mono" style="color:' + (pos ? '#36D27B' : '#F0584B') + ';white-space:nowrap">' + (pos ? '+' : '−') + rpA(Math.abs(e.delta)) + '</span>' +
      '</div>';
    }).join('') : '<p class="muted-sm" style="margin:10px 0 0">No top-ups yet. The committee can add saldo for you.</p>';
    return '<section class="sec">' +
      '<div class="shead"><span class="num">03</span><span class="lbl">Your saldo</span></div>' +
      '<div class="reg-form" style="max-width:560px">' +
        '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">' +
          '<div style="font-size:30px;font-weight:800;color:' + (bal > 0 ? '#36D27B' : (bal < 0 ? '#F0584B' : '#EEF3FB')) + '">' + rpA(bal) + '</div>' +
          '<div class="muted-sm">prepaid balance · used to cover match fees</div>' +
        '</div>' +
        '<p class="muted-sm" style="margin:8px 0 0">Top-ups are handled by the committee. When you\'re called up, they can settle your match fee straight from this balance.</p>' +
        '<div style="margin-top:12px">' + rows + '</div>' +
      '</div>' +
    '</section>';
  }

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

  /* ---- medical & emergency panel (all optional) ----
     Stored on the account so coaching/medical staff can reach the right people
     and hospital fast if a player is hurt during a match. "RS" = Rumah Sakit. */
  var BLOOD = ['A', 'B', 'AB', 'O', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'];
  function medicalSectionHTML(u) {
    var bt = u.bloodType || '';
    var opts = '<option value="">—</option>' + BLOOD.map(function (b) {
      return '<option value="' + escapeHtml(b) + '"' + (b === bt ? ' selected' : '') + '>' + escapeHtml(b) + '</option>';
    }).join('');
    return '<section class="sec">' +
      '<div class="shead"><span class="num">02</span><span class="lbl">Medical &amp; emergency <em>(optional)</em></span></div>' +
      '<div class="reg-form">' +
        '<p class="muted-sm" style="margin:0 0 4px">All optional. Shared only with coaching and medical staff, so they can act fast if you\'re hurt during a match.</p>' +
        '<div class="reg-2col">' +
          '<label class="fld"><span>Blood type</span>' +
            '<select id="pfBlood" class="inp">' + opts + '</select></label>' +
          '<label class="fld"><span>Preferred hospital <em>(RS)</em></span>' +
            '<input id="pfRs" type="text" value="' + escapeHtml(u.preferredRs || '') + '" placeholder="e.g. RS Borromeus, Bandung" /></label>' +
        '</div>' +
        '<label class="fld"><span>Allergies</span>' +
          '<input id="pfAllergies" type="text" value="' + escapeHtml(u.allergies || '') + '" placeholder="e.g. penicillin, peanuts — leave blank if none" /></label>' +
        '<label class="fld"><span>Medical notes / conditions</span>' +
          '<textarea id="pfMedical" rows="3" placeholder="Anything staff should know — asthma, past injuries, medication, etc.">' + escapeHtml(u.medical || '') + '</textarea></label>' +
        '<div class="reg-2col">' +
          '<label class="fld"><span>Emergency contact</span>' +
            '<input id="pfEmgName" type="text" value="' + escapeHtml(u.emergencyName || '') + '" placeholder="Name" /></label>' +
          '<label class="fld"><span>Emergency phone</span>' +
            '<input id="pfEmgPhone" type="tel" value="' + escapeHtml(u.emergencyPhone || '') + '" placeholder="08…" /></label>' +
        '</div>' +
        '<div class="reg-actions">' +
          '<button type="button" class="btn btn-primary" id="pfSave2">Save changes</button>' +
          '<span class="reg-msg" id="pfMsg2"></span>' +
        '</div>' +
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

      medicalSectionHTML(u) +

      saldoSectionHTML(u) +

      '<section class="sec last">' +
        '<div class="shead"><span class="num gold">04</span><span class="lbl">Session</span></div>' +
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

  function val(id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; }

  // msgId lets either Save button (Profile or Medical) show its own confirmation.
  function doSaveProfile(msgId) {
    msgId = msgId || 'pfMsg';
    var name = val('pfName');
    var email = val('pfEmail');
    var phone = val('pfPhone');
    if (!name.trim()) return msg(msgId, 'Name can\'t be empty.');
    STORE.updateProfile({
      name: name, position: editPos, email: email, phone: phone,
      // medical & emergency — all optional
      bloodType: val('pfBlood'), preferredRs: val('pfRs'),
      allergies: val('pfAllergies'), medical: val('pfMedical'),
      emergencyName: val('pfEmgName'), emergencyPhone: val('pfEmgPhone')
    })
      .then(function (u) {
        AUTH.user = u; paintHeader(); AUTH._emit();
        msg(msgId, '✓ Saved', true);
        setTimeout(function () { var m = document.getElementById(msgId); if (m) m.textContent = ''; }, 2200);
      })
      .catch(function (e) { msg(msgId, e.message || 'Could not save.'); });
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
    if (t.closest('#pfSave')) { doSaveProfile('pfMsg'); return; }
    if (t.closest('#pfSave2')) { doSaveProfile('pfMsg2'); return; }
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
