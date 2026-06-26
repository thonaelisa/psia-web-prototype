/* PSIA Website — view rendering + nav (vanilla JS, no build step). */
/* stats view: immersive hero + leader feature + leaderboard/podium/compact */
(function(){
  const D = window.PSIA_DATA;
  const RMAP = { win:'WIN', draw:'DRAW', loss:'LOSS' };

  /* current sort state for the Stats table (default: Pts, high→low) */
  let statSort = { key:'pts', dir:'desc' };

  /* ---- shared pieces ---- */
  function shead(num, label, gold, link){
    return `<div class="shead">
      <span class="num${gold?' gold':''}">${num}</span>
      <span class="lbl">${label}</span>
      ${link?`<span class="link lk" data-view="matches">${link}</span>`:''}
    </div>`;
  }

  function fixtureCard(){
    const m = D.next, pct = Math.round((m.filled/m.slots)*1000)/10;
    return `<div class="fixture">
      <div class="accent-strip"></div>
      <div class="fixture-grid">
        <div class="fx-left">
          <div class="fx-date">${m.dateLong}</div>
          <div class="fx-teams">
            <div class="fx-home"><img class="fx-crest" src="assets/img/psia-crest.png" alt=""><div><div class="fx-team">PSIA</div><div class="fx-side">HOME</div></div></div>
            <div class="fx-vs">VS</div>
            <div><div class="fx-team away">${m.oppShort}</div><div class="fx-side">AWAY</div></div>
          </div>
          <div class="fx-meta"><span>📍 ${m.venue}</span><span class="dot">·</span><span>${m.format}</span><span class="dot">·</span><span class="mono">${m.fee}</span></div>
        </div>
        <div class="fx-right">
          <div class="fx-rlabel">Spots remaining</div>
          <div class="fx-count"><span class="n">${m.filled}</span><span class="t">/ ${m.slots} registered</span></div>
          <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="btn btn-primary lk" style="margin-top:20px" data-view="register">Register →</div>
        </div>
      </div>
    </div>`;
  }

  function resultCard(x){
    return `<div class="rcard ${x.r} lk" data-match="${x.id}">
      <div class="rcard-top"><span class="rcard-date">${x.date}</span><span class="rbadge ${x.r}">${RMAP[x.r]}</span></div>
      <div class="rscore">${x.sp}–${x.so}</div>
      <div class="rcard-bot"><span class="ropp">vs ${x.opp}</span><span class="rcard-go">Report →</span></div>
    </div>`;
  }

  function ticker(){
    const items = D.results.map(x=>{
      const cls = x.r==='win'?'W':x.r==='draw'?'D':'L';
      return `<span><b>PSIA ${x.sp}–${x.so} ${x.opp.split(' ')[0]}</b> <span class="${cls}">${cls}</span></span><span class="sl">/</span>`;
    }).join('');
    return `<div class="ticker"><div class="ticker-label">FORM</div>
      <div class="ticker-vp"><div class="tick-track">${items}${items}</div></div></div>`;
  }

  /* ---- HERO (home only) ---- */
  function hero(){
    const m = D.next;
    return `<header class="hero">
      <img class="hero-photo" src="assets/img/frontphoto1.jpg" alt="PSIA matchday">
      <div class="hero-ov1"></div><div class="hero-ov2"></div>
      <div class="hero-inner">
        <div class="scorebug">
          <div class="tag">NEXT</div>
          <div class="body"><span class="h">PSIA</span><span class="vs">VS</span><span class="a">${m.oppAbbr}</span><span class="div"></span><span class="time">${m.dateShort}</span></div>
        </div>
        <div class="lower-third">
          <div class="hero-eyebrow"><span class="bar"></span>PS IA-ITB FOOTBALL COMMUNITY</div>
          <h1 class="hero-h1">Where the <span class="hl">squad</span> comes together</h1>
          <p class="hero-sub">Matchdays, call-ups, payments, stats and the in-house fantasy league — one home for everyone who pulls on the PSIA shirt.</p>
          <div class="hero-cta">
            <div class="btn btn-primary lk" data-view="matches">View fixtures</div>
            <div class="btn btn-glass lk" data-scroll="join">Join the squad</div>
          </div>
        </div>
      </div>
    </header>`;
  }

  /* ---- link card (documentation / stats) ---- */
  function linkCard(type, url){
    const map = {
      video:{ icon:'🎬', title:'Match video', sub:'Full match footage · Google Drive', cta:'Watch video' },
      photos:{ icon:'📷', title:'Match photos', sub:'Photo gallery · Google Drive', cta:'View photos' },
      stats:{ icon:'📊', title:'Detailed match stats', sub:'Full breakdown · external stats page', cta:'View stats' },
    }[type];
    const has = url && url !== '#';
    if(!has){
      return `<div class="linkcard disabled">
        <span class="lc-icon">${map.icon}</span>
        <span class="lc-body"><span class="lc-title">${map.title}</span><span class="lc-sub">${map.sub}</span></span>
        <span class="comingsoon">Coming soon</span>
      </div>`;
    }
    return `<a class="linkcard lk" href="${url}" target="_blank" rel="noopener noreferrer">
      <span class="lc-icon">${map.icon}</span>
      <span class="lc-body"><span class="lc-title">${map.title}</span><span class="lc-sub">${map.sub}</span></span>
      <span class="btn btn-primary btn-sm">${map.cta} ↗</span>
    </a>`;
  }

  /* ---- match report page ---- */
  function viewMatch(m){
    return `<div class="page-head"><h1>Match report</h1><p class="mono" style="letter-spacing:.06em">${m.date} · 2026 · ${m.venue}</p></div>
    <section class="sec">
      <div class="fixture">
        <div class="accent-strip"></div>
        <div class="matchsum">
          <div class="ms-top"><span class="rbadge ${m.r}">${RMAP[m.r]}</span><span class="mono ms-date">${m.format}</span></div>
          <div class="ms-row">
            <span class="ms-team">PSIA</span>
            <span class="ms-score">${m.sp}<span class="ms-dash">–</span>${m.so}</span>
            <span class="ms-team away">${m.opp}</span>
          </div>
        </div>
      </div>
    </section>
    <section class="sec last">
      ${shead('01','Match documentation')}
      ${linkCard('video', m.video)}
      <div style="height:12px"></div>
      ${linkCard('photos', m.photos)}
      <div style="height:24px"></div>
      ${shead('02','Match stats', true)}
      ${linkCard('stats', m.stats)}
      <div style="margin-top:28px"><span class="lk backlink" data-view="matches">← Back to matches</span></div>
    </section>`;
  }

  /* ---- VIEWS ---- */
  function viewHome(){
    const s = D.season;
    return `${hero()}
    ${ticker()}
    <section class="sec">
      <div class="statbar">
        <div class="stat-cell"><div class="stat-tick" style="background:var(--win)"></div><div class="stat-num" style="color:var(--win)">${s.wins}</div><div class="stat-label">Wins</div></div>
        <div class="stat-cell"><div class="stat-tick" style="background:var(--draw)"></div><div class="stat-num" style="color:var(--draw)">${s.draws}</div><div class="stat-label">Draw</div></div>
        <div class="stat-cell"><div class="stat-tick" style="background:var(--loss)"></div><div class="stat-num" style="color:var(--loss)">${s.losses}</div><div class="stat-label">Losses</div></div>
        <div class="stat-cell"><div class="stat-tick" style="background:var(--blue)"></div><div class="stat-num" style="color:var(--blue-light)">${s.goals}</div><div class="stat-label">Goals scored</div></div>
      </div>
    </section>

    <section class="sec">
      ${shead('01','Next fixture')}
      ${fixtureCard()}
    </section>

    <section class="sec">
      ${shead('02','Recent results', false, 'View all matches →')}
      <div class="results-grid">${D.results.map(resultCard).join('')}</div>
    </section>

    <section class="sec">
      <div class="standings-grid">
        <div class="panel">
          <div class="panel-head lk" data-view="stats"><span class="num">03</span><span class="lbl">Top scorers</span><span class="panel-go">View all →</span></div>
          <div class="panel-body">${D.scorers.map((p,i)=>`<div class="lrow"><span class="rank">${i+1}</span><span class="name">${p.n}</span><span class="val mono">${p.g}</span></div>`).join('')}</div>
        </div>
        <div class="panel">
          <div class="panel-head lk" data-view="fantasy"><span class="num gold">04</span><span class="lbl">Fantasy league</span><span class="panel-go">View all →</span></div>
          <div class="panel-body">${D.fantasy.map((t,i)=>`<div class="lrow"><span class="rank">${i+1}</span><span class="name">${t.n}</span><span class="val gold mono">${t.p}</span></div>`).join('')}</div>
        </div>
      </div>
    </section>

    <section class="sec last">
      <div class="join" id="join"><div class="glow"></div>
        <h2>Pull on the shirt</h2>
        <p>New faces welcome every matchday. Register, get called up, and start racking up the goals.</p>
        <div class="join-cta">
          <div class="btn btn-dark lk" data-view="register">Join the squad</div>
          <div class="btn btn-glass lk" data-view="matches">View fixtures</div>
        </div>
      </div>
    </section>`;
  }

  /* ---- Matches page: immersive hero (uses matchesphoto1) ---- */
  function matchesHero(){
    const m = D.next;
    return `<header class="hero hero-matches">
      <img class="hero-photo" src="assets/img/matchesphoto1.jpg" alt="PSIA matchday">
      <div class="hero-ov1"></div><div class="hero-ov2"></div>
      <div class="hero-inner">
        <div class="scorebug">
          <div class="tag">NEXT</div>
          <div class="body"><span class="h">PSIA</span><span class="vs">VS</span><span class="a">${m.oppAbbr}</span><span class="div"></span><span class="time">${m.dateShort}</span></div>
        </div>
        <div class="lower-third">
          <div class="hero-eyebrow"><span class="bar"></span>SEASON 2026 · MATCHDAY HUB</div>
          <h1 class="hero-h1">Matches</h1>
          <p class="hero-sub">Register for upcoming games and browse the season so far. Tap any result for its full report.</p>
        </div>
      </div>
    </header>`;
  }

  /* ---- Matches page: broadcast next-fixture spotlight (with live countdown) ---- */
  function nextSpotlight(){
    const m = D.next, pct = Math.round((m.filled/m.slots)*1000)/10, left = Math.max(0, m.slots - m.filled);
    return `<div class="spot">
      <div class="accent-strip"></div>
      <div class="spot-meta">
        <div class="mono spot-date">${m.dateLong}</div>
        <div class="spot-info"><span>📍 ${m.venue}</span><span class="dot">·</span><span>${m.format}</span><span class="dot">·</span><span class="mono">${m.fee}</span></div>
      </div>
      <div class="spot-matchup">
        <div class="spot-side home">
          <div class="spot-tx"><div class="spot-team">PSIA</div><div class="spot-role">HOME</div></div>
          <img class="spot-crest" src="assets/img/psia-crest.png" alt="">
        </div>
        <div class="spot-center">
          <div class="cd-label">KICK-OFF IN</div>
          <div class="cd">
            <div class="cd-u"><div class="cd-n" id="cdDD">--</div><div class="cd-l">DAYS</div></div>
            <span class="cd-sep">:</span>
            <div class="cd-u"><div class="cd-n" id="cdHH">--</div><div class="cd-l">HRS</div></div>
            <span class="cd-sep">:</span>
            <div class="cd-u"><div class="cd-n" id="cdMM">--</div><div class="cd-l">MIN</div></div>
            <span class="cd-sep">:</span>
            <div class="cd-u"><div class="cd-n blue" id="cdSS">--</div><div class="cd-l">SEC</div></div>
          </div>
          <div class="spot-vs">VS</div>
        </div>
        <div class="spot-side away">
          <div class="spot-badge">${m.oppAbbr}</div>
          <div class="spot-tx"><div class="spot-team away">${m.oppShort}</div><div class="spot-role">AWAY</div></div>
        </div>
      </div>
      <div class="spot-cta">
        <div class="spot-fill">
          <div class="spot-spots"><span class="n">${left}</span><span class="t">spots remaining</span><span class="t dim">/ ${m.filled} of ${m.slots} registered</span></div>
          <div class="progress spot-prog"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="btn btn-primary lk" data-view="register">Register →</div>
      </div>
    </div>`;
  }

  /* Sample upcoming fixtures shown on the Matches page when the data feed has
     none yet (edit/replace as real fixtures are added). */
  const DEFAULT_UPCOMING = [
    { dow:'SAT', day:'05', mon:'JUL', time:'20:00', opp:'Banteng FC', venue:'Lapangan Saraga', format:'7v7', fee:'Rp 50.000', filled:4, slots:16 },
    { dow:'SAT', day:'12', mon:'JUL', time:'20:00', opp:'Merpati United', venue:'Lapangan Saraga', format:'7v7', fee:'Rp 50.000', filled:1, slots:16 },
  ];

  /* ---- Matches page: upcoming fixtures (uses data feed, else sample fixtures) ---- */
  function upcomingSection(){
    const u = (Array.isArray(D.upcoming) && D.upcoming.length) ? D.upcoming : DEFAULT_UPCOMING;
    if(!Array.isArray(u) || !u.length) return '';
    const rows = u.map(x=>{
      const pct = x.slots ? Math.round((x.filled/x.slots)*1000)/10 : 0;
      return `<div class="upc-row lk" data-view="register">
        <div class="upc-cal"><div class="d1">${x.dow||''}</div><div class="d2">${x.day||''}</div><div class="d3">${x.mon||''}${x.time?' · '+x.time:''}</div></div>
        <div><div class="upc-team">PSIA <span class="v">vs</span> ${x.opp}</div><div class="upc-sub">📍 ${x.venue||''} · ${x.format||''} · ${x.fee||''}</div></div>
        <div class="upc-prog"><div class="pl">${x.filled||0} / ${x.slots||0} registered</div><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div></div>
        <div class="upc-reg lk" data-view="register">Register →</div>
      </div>`;
    }).join('');
    return `<section class="sec">${shead('02','Upcoming fixtures')}<div class="upc-list">${rows}</div></section>`;
  }

  function viewMatches(){
    const rec = D.results.reduce((a,x)=>{ a[x.r]=(a[x.r]||0)+1; return a; }, {win:0,draw:0,loss:0});
    const num = (n,lbl)=>`<span class="num">${n}</span><span class="lbl">${lbl}</span>`;
    return `${matchesHero()}
    ${ticker()}
    <section class="sec">${shead('01','Next fixture')}${nextSpotlight()}</section>
    ${upcomingSection()}
    <section class="sec last">
      <div class="shead rec">
        <div class="shead-tag">${num(D.upcoming&&D.upcoming.length?'03':'02','All results')}</div>
        <div class="rec-line"><span class="lab">RECORD</span><span class="w">${rec.win}W</span><span class="s">·</span><span class="d">${rec.draw}D</span><span class="s">·</span><span class="l">${rec.loss}L</span></div>
      </div>
      <div class="restable">
        <div class="rt-head"><span></span><span>DATE</span><span>FIXTURE</span><span class="r">SCORE</span><span class="r">REPORT</span></div>
        ${D.results.map(x=>`<div class="rt-row lk" data-match="${x.id}">
          <span class="rt-dot ${x.r}"></span>
          <span class="rt-date">${x.date}</span>
          <span class="rt-fix">PSIA <span class="v">vs</span> ${x.opp}</span>
          <span class="rt-score"><span class="rt-sc">${x.sp}–${x.so}</span><span class="rbadge ${x.r}">${RMAP[x.r]}</span></span>
          <span class="rt-report">Report →</span>
        </div>`).join('')}
      </div>
    </section>`;
  }

  /* ===================== Stats page ===================== */
  let statsMode = 'leaderboard';

  const POS_THEME = {
    GK:  { c:'#F5C542', bg:'#2A2410', bd:'#5A4A12' },
    DEF: { c:'#5C95F5', bg:'#0E1D3A', bd:'#2F5BB0' },
    MID: { c:'#36D27B', bg:'#11271B', bd:'#1E5237' },
    FWD: { c:'#F0584B', bg:'#2A1412', bd:'#5A2420' },
  };
  const POS_FALLBACK = { c:'#9DAAC0', bg:'#152138', bd:'#2C3A55' };
  const AVATAR_PALETTE = ['#7A3D1E','#1E5A4A','#5A4A12','#3D2E7A','#7A1E3D','#1E3F7A','#2E5A7A','#5A2440','#1E5A2E','#5A3A1E','#2E7A5A','#3D1E7A'];
  const MEDAL = { 1:'#F5C542', 2:'#C9D2E0', 3:'#C08457' };

  function statInitials(name){
    const parts = String(name).trim().split(/\s+/);
    if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }
  const posTheme = pos => POS_THEME[pos] || POS_FALLBACK;
  const posLabel = pos => (pos && pos.trim()) ? pos : '—';

  /* points-ranked, enriched rows (rank is the season standing) */
  function rankedStatRows(){
    const rows = D.statsTable.slice().sort((a,b)=>(b.pts-a.pts) || String(a.n).localeCompare(String(b.n)));
    const maxPts = Math.max(1, ...rows.map(r=>Number(r.pts)||0));
    return rows.map((r,i)=>{
      const th = posTheme(r.pos), rank = i+1, m = MEDAL[rank];
      return Object.assign({}, r, {
        rank, th,
        initials: statInitials(r.n),
        avatarBg: AVATAR_PALETTE[i % AVATAR_PALETTE.length],
        chip: `background:${th.bg};border:1px solid ${th.bd};color:${th.c}`,
        rankStyle: m ? `background:${m};color:#0A1326` : 'background:#152138;color:#7E8AA0',
        rowAccent: m ? `border-left:3px solid ${m}` : 'border-left:3px solid transparent',
        barPct: Math.round((Number(r.pts)||0)/maxPts*100),
        medal: m || '',
      });
    });
  }

  /* ---- Leaderboard ---- */
  function lbRowHTML(p){
    return `<div class="lb-grid lb-row" style="${p.rowAccent}">
      <span class="lb-rank" style="${p.rankStyle}">${p.rank}</span>
      <div class="lb-player"><span class="lb-avatar" style="background:${p.avatarBg}">${p.initials}</span><span class="lb-pname">${p.n}</span></div>
      <span><span class="poschip" style="${p.chip}">${posLabel(p.pos)}</span></span>
      <span class="lb-c lb-apps">${p.apps}</span>
      <span class="lb-c">${p.g}</span>
      <span class="lb-c">${p.a}</span>
      <span class="lb-c">${p.cs}</span>
      <div class="lb-pts"><span class="v">${p.pts}</span><span class="lb-bar"><span style="width:${p.barPct}%;background:linear-gradient(90deg,#5C95F566,#5C95F5)"></span></span></div>
    </div>`;
  }
  function lbTableHTML(rows, ptsLabel){
    const head = `<div class="lb-grid lb-head">
      <span>#</span><span>PLAYER</span><span>POS</span>
      <span class="ctr">APPS</span><span class="ctr">G</span><span class="ctr">A</span><span class="ctr">CS</span>
      <span class="rgt">${ptsLabel}</span></div>`;
    return `<div class="lbwrap"><div class="lbmin">${head}${rows.map(lbRowHTML).join('')}</div></div>`;
  }
  const leaderboardHTML = rows => lbTableHTML(rows, 'FANTASY PTS');

  /* ---- Podium ---- */
  function podCardHTML(p){
    const accent = p.medal || '#25324A', ptsColor = p.medal || '#EEF3FB';
    return `<div class="podcard"${p.medal?` style="box-shadow:inset 0 0 0 1px ${p.medal}55"`:''}>
      <div class="pbar" style="background:${accent}"></div>
      <div class="podbody">
        <div class="podtop"><span class="podrank" style="${p.rankStyle}">${p.rank}</span><span class="poschip" style="${p.chip}">${posLabel(p.pos)}</span></div>
        <div class="podname"><span class="av" style="background:${p.avatarBg}">${p.initials}</span><span class="nm">${p.n}</span></div>
        <div class="podpts"><span class="v" style="color:${ptsColor}">${p.pts}</span><span class="u">PTS</span></div>
        <div class="podstats">
          <div><div class="v">${p.g}</div><div class="k">GOALS</div></div>
          <div><div class="v">${p.a}</div><div class="k">ASSIST</div></div>
          <div><div class="v">${p.cs}</div><div class="k">CS</div></div>
          <div><div class="v">${p.apps}</div><div class="k">APPS</div></div>
        </div>
      </div>
    </div>`;
  }
  function podiumHTML(rows){
    return `<div class="podium">${rows.slice(0,3).map(podCardHTML).join('')}</div>
      ${lbTableHTML(rows.slice(3), 'PTS')}`;
  }

  /* ---- Compact (sortable, zebra) ---- */
  function compactHTML(){
    const { key, dir } = statSort, sign = dir==='asc'?1:-1;
    const sorted = rankedStatRows().sort((a,b)=>{
      if(key==='n') return sign * String(a.n).localeCompare(String(b.n));
      const av=Number(a[key])||0, bv=Number(b[key])||0;
      if(av!==bv) return sign*(av-bv);
      return ((Number(b.pts)||0)-(Number(a.pts)||0)) || String(a.n).localeCompare(String(b.n));
    });
    const caret = k => key===k ? ` ${dir==='asc'?'↑':'↓'}` : '';
    const colh = (k,label,align)=>`<span class="colh${key===k?' sorted':''}${align?' '+align:''}" data-sort="${k}">${label}${caret(k)}</span>`;
    const head = `<div class="cmp-grid lb-head cmp-head">
      <span>#</span>${colh('n','PLAYER')}<span>POS</span>
      ${colh('apps','APPS','ctr')}${colh('g','G','ctr')}${colh('a','A','ctr')}${colh('cs','CS','ctr')}${colh('pts','PTS','rgt')}</div>`;
    const rows = sorted.map((p,i)=>`<div class="cmp-grid cmp-row" style="background:${i%2?'#0C1424':'transparent'}">
      <span class="cmp-rk">${p.rank}</span>
      <span class="cmp-nm">${p.n}</span>
      <span class="cmp-pos" style="color:${p.th.c}">${posLabel(p.pos)}</span>
      <span class="lb-c lb-apps">${p.apps}</span>
      <span class="lb-c">${p.g}</span>
      <span class="lb-c">${p.a}</span>
      <span class="lb-c">${p.cs}</span>
      <span class="lb-c cmp-pts">${p.pts}</span></div>`).join('');
    return `<div class="lbwrap"><div class="lbmin">${head}${rows}</div></div>`;
  }

  /* ---- Toggle + active mode body ---- */
  function statsPanelHTML(){
    const rows = rankedStatRows();
    const tab = (mode,label)=>`<span class="modetab${statsMode===mode?' active':''}" data-statmode="${mode}">${label}</span>`;
    const body = statsMode==='podium' ? podiumHTML(rows)
               : statsMode==='compact' ? compactHTML()
               : leaderboardHTML(rows);
    return `<div class="statsbar">
        <div class="shead nomb"><span class="num">02</span><span class="lbl">Full table · ${rows.length} players</span></div>
        <div class="modetabs">${tab('leaderboard','Leaderboard')}${tab('podium','Podium')}${tab('compact','Compact')}</div>
      </div>${body}`;
  }

  /* ---- Stats hero (statsphoto1) ---- */
  function statsHero(){
    const L = rankedStatRo