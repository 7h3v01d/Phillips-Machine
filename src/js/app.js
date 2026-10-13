// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// Page wiring: mode switch, controls, readouts, recorders and the animation loop.
'use strict';

/* ================= shared UI ================= */
const ENGINES = {classic: CLASSIC, modern: MODERN};
let eng;
const $ = id => document.getElementById(id);
const capEl = $('caption');
function setCaption(h){ capEl.innerHTML = h; eng.caption = h; }

function buildUI(){
  $('sub').textContent = eng.sub;
  $('boardTitle').textContent = eng.boardTitle;
  ['classic','modern'].forEach(m => $('mode-'+m).setAttribute('aria-pressed', String(eng.id === m)));
  $('readouts').innerHTML = eng.readouts.map(([k,l]) => `<div class="ro" id="ro-${k}"><div class="k">${l}</div><div class="v">–</div></div>`).join('');
  $('scen').innerHTML = eng.scenarios.map((s,i)=>`<button data-i="${i}">${s[0]}</button>`).join('');
  capEl.innerHTML = eng.caption || eng.startCaption;
  const P = eng.p, pre = eng.id + '-';
  $('controls').innerHTML = eng.groups.map((g, gi) => `
    <div class="grp"><h3>${g.name}</h3>
    ${g.sliders.map(s=>`<div class="sl"><label for="${pre}${s.id}">${s.label}</label><output id="${pre}o-${s.id}"></output>
      <input type="range" id="${pre}${s.id}" min="${s.min}" max="${s.max}" step="${s.step}"></div>`).join('')}
    ${(g.toggles||[]).map(t=>`<label class="tog"><input type="checkbox" id="${pre}${t.id}">${t.label}</label>`).join('')}
    ${g.buttons ? `<div class="row">${g.buttons.map((b,bi)=>`<button data-g="${gi}" data-b="${bi}">${b.label}</button>`).join('')}</div>` : ''}
    </div>`).join('');
  eng.groups.forEach(g => {
    g.sliders.forEach(s => $(pre+s.id).addEventListener('input', e => { P[s.id] = parseFloat(e.target.value); $(pre+'o-'+s.id).textContent = s.fmt(P[s.id]); }));
    (g.toggles||[]).forEach(t => $(pre+t.id).addEventListener('change', e => { P[t.id] = e.target.checked; t.onChange && t.onChange(); }));
  });
  $('controls').querySelectorAll('button[data-g]').forEach(b => b.addEventListener('click', () => eng.groups[+b.dataset.g].buttons[+b.dataset.b].fn()));
  syncControls();
  $('recLegend').innerHTML = eng.recLegend;
  $('pcTitle').textContent = eng.pcTitle; $('pcTag').textContent = eng.pcTag; $('pcLegend').innerHTML = eng.pcLegend;
  $('govPanel').hidden = eng.side !== 'gov';
  $('rbaPanel').hidden = eng.side !== 'rba';
  $('notesClassic').hidden = eng.id !== 'classic';
  $('notesModern').hidden = eng.id !== 'modern';
  updateReadouts();
}
function syncControls(){
  const P = eng.p, pre = eng.id + '-';
  eng.groups.forEach(g => {
    g.sliders.forEach(s => { $(pre+s.id).value = P[s.id]; $(pre+'o-'+s.id).textContent = s.fmt(P[s.id]); });
    (g.toggles||[]).forEach(t => { $(pre+t.id).checked = P[t.id]; });
  });
}
$('scen').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = eng.scenarios[+b.dataset.i]; s[1](); syncControls(); setCaption(s[2]);
  if (!running) $('runBtn').click();
});
$('runBtn').onclick = () => { running = !running; $('runBtn').textContent = running ? 'Pause pump' : 'Start pump'; $('statusTag').textContent = eng.status(); };
$('resetBtn').onclick = () => { eng.reset(); syncControls(); setCaption(eng.resetCaption); };
function setMode(m){
  eng = ENGINES[m];
  try { localStorage.setItem('moniac-mode', m); } catch(_) {}
  buildUI();
}
$('mode-classic').onclick = () => setMode('classic');
$('mode-modern').onclick = () => setMode('modern');

/* ---------- readouts and side panels ---------- */
function updateReadouts(){
  eng.readouts.forEach(([k,, fmt, cls]) => {
    const el = $('ro-'+k); if (!el) return;
    const v = eng.value(k);
    el.querySelector('.v').textContent = fmt ? fmt(v) : v.toFixed(1);
    el.className = 'ro ' + (cls ? cls(v) : '');
  });
  $('clock').textContent = eng.timeLabel(eng.st.t);
  $('statusTag').textContent = eng.status();
  if (eng.side === 'gov'){
    $('iaeOut').textContent = eng.st.iae.toFixed(0);
    const gs = $('govState');
    gs.textContent = eng.p.gov ? `GOVERNOR ON · target Y ${eng.p.Ytgt}` : 'GOVERNOR OFF';
    gs.className = 'gov-state ' + (eng.p.gov ? 'on' : 'off');
  } else {
    const s = eng.st, f = s.f, P = eng.p;
    $('rbaRate').textContent = s.i.toFixed(2) + '%';
    $('rbaMode').textContent = P.rule ? 'INFLATION-TARGETING RULE' : 'MANUAL CASH RATE';
    $('rbaMode').style.color = P.rule ? 'var(--phosphor)' : 'var(--red)';
    $('rbaNext').textContent = 'next meeting ' + eng.dateStr(s.nextMeet);
    const d = f.istar - s.i, call = !P.rule ? `manual: move to <b>${P.iManual.toFixed(2)}%</b>` : d > .2 ? 'next meeting: <b>hike 25bp</b>' : d < -.2 ? (s.i <= 0.11 ? 'at the floor: <b>QE does the work</b>' : 'next meeting: <b>cut 25bp</b>') : 'next meeting: <b>hold</b>';
    $('rbaRule').innerHTML = `<div class="eq">rule = 0.60 neutral real + ${s.pi.toFixed(2)} inflation + ${P.phiPi.toFixed(1)}×(${s.pi.toFixed(2)} − ${P.target.toFixed(2)}) + ${P.phiY.toFixed(1)}×(${f.gap.toFixed(2)} gap)</div><div class="eq">= <b>${f.istar.toFixed(2)}%</b> · ${call}</div>`;
    const moves = s.log.slice(-8).reverse();
    $('rbaLog').innerHTML = moves.length ? moves.map(l => `<li><span>${eng.dateStr(l[0])}</span><span class="${l[1]>0?'up':l[1]<0?'dn':'muted'}">${l[1]===0?'hold':(l[1]>0?'+':'')+(l[1]*100).toFixed(0)+'bp'}</span><span>${l[2].toFixed(2)}%</span></li>`).join('') : '<li><span class="muted">No meetings yet in this run</span></li>';
  }
}

/* ---------- machine canvas ---------- */
const mc = $('machine'), mx = mc.getContext('2d');
function drawMachine(){
  const s = sizeCanvas(mc, LW, LH), ctx = mx; ctx.setTransform(s,0,0,s,0,0);
  drawGrid(ctx);
  const under = eng.pipes.filter(pp => !pp.over), o1 = eng.pipes.filter(pp => pp.over === 1 || pp.over === true), o2 = eng.pipes.filter(pp => pp.over === 2);
  under.forEach(pp => drawPipe(ctx, pp, eng.flow(pp.k), eng.phase[pp.k] || 0));
  o1.forEach(pp => drawPipe(ctx, pp, eng.flow(pp.k), eng.phase[pp.k] || 0));
  o2.forEach(pp => drawPipe(ctx, pp, eng.flow(pp.k), eng.phase[pp.k] || 0));
  eng.drawBoard(ctx);
}

/* ---------- chart recorder ---------- */
const rc = $('recorder'), rx = rc.getContext('2d');
function drawRecorder(){
  const RW=600, RH=220, s = sizeCanvas(rc, RW, RH), ctx = rx; ctx.setTransform(s,0,0,s,0,0);
  ctx.fillStyle = C.deep; ctx.fillRect(0,0,RW,RH);
  const L=40, R=RW-44, T=12, B=RH-24, span = 60, rec = eng.recorder, st = eng.st;
  const tEnd = Math.max(span, st.t), tStart = tEnd - span;
  const xOf = t => L + (t - tStart)/span*(R-L);
  const yOf = (v, ax) => B - (v - ax.min)/(ax.max - ax.min)*(B-T);
  ctx.lineWidth = 1;
  if (rec.band){ const ax = rec[rec.band.axis]; ctx.fillStyle='rgba(75,224,138,0.08)'; ctx.fillRect(L, yOf(rec.band.hi, ax), R-L, yOf(rec.band.lo, ax) - yOf(rec.band.hi, ax));
    ctx.fillStyle='rgba(75,224,138,0.6)'; ctx.font=`500 9px ${FONT}`; ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.fillText(rec.band.label, R-4, yOf(rec.band.hi, ax)-1); ctx.textAlign='left'; }
  for (let q = Math.ceil(tStart/4)*4; q <= tEnd; q += 4){
    const x = xOf(q);
    ctx.strokeStyle = q % 20 === 0 ? 'rgba(125,139,149,0.35)' : 'rgba(30,40,49,0.9)';
    ctx.beginPath(); ctx.moveTo(x,T); ctx.lineTo(x,B); ctx.stroke();
    if (q % 8 === 0){ ctx.font=`500 9px ${FONT}`; ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.textAlign='center'; ctx.fillText(String(Math.floor(eng.yearAt(q))), x, B+6); }
  }
  ctx.textAlign='left';
  for (const v of rec.left.ticks){
    const y = yOf(v, rec.left); ctx.strokeStyle='rgba(30,40,49,0.9)'; ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(R,y); ctx.stroke();
    ctx.font=`500 9px ${FONT}`; ctx.fillStyle=rec.left.col; ctx.textBaseline='middle'; ctx.fillText(rec.left.fmt(v), 6, y);
  }
  for (const v of rec.right.ticks){ ctx.fillStyle=rec.right.col; ctx.textBaseline='middle'; ctx.fillText(rec.right.fmt(v), R+8, yOf(v, rec.right)); }
  rec.refs().forEach(r => {
    const y = yOf(r.v, rec[r.axis]);
    ctx.strokeStyle=r.col; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(R,y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=r.col; ctx.font=`500 9px ${FONT}`; ctx.textBaseline = r.below ? 'top' : 'bottom'; ctx.fillText(r.label, L+4, r.below ? y+2 : y-2);
  });
  const pts = st.hist.filter(h => h.t >= tStart);
  rec.series.forEach(se => {
    if (pts.length < 2) return;
    const ax = se.axis ? rec[se.axis] : {min:se.min, max:se.max};
    ctx.beginPath();
    pts.forEach((h,i) => {
      const x = xOf(h.t), y = clamp(yOf(h[se.key], ax), T, B);
      if (!i) ctx.moveTo(x,y); else if (se.step){ const py = clamp(yOf(pts[i-1][se.key], ax), T, B); ctx.lineTo(x,py); ctx.lineTo(x,y); } else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = se.col; ctx.lineWidth = se.w; ctx.stroke();
    const h = pts[pts.length-1]; ctx.fillStyle = se.col; ctx.beginPath(); ctx.arc(xOf(h.t), clamp(yOf(h[se.key], ax),T,B), 3, 0, Math.PI*2); ctx.fill();
  });
  if (rec.markers){
    rec.markers(tStart).forEach(m => {
      const x = xOf(m.t), y = clamp(yOf(m.v, rec.right), T, B);
      ctx.fillStyle = m.up ? C.red : C.phosphor; ctx.beginPath();
      if (m.up){ ctx.moveTo(x, y-9); ctx.lineTo(x-3.5, y-4); ctx.lineTo(x+3.5, y-4); } else { ctx.moveTo(x, y+9); ctx.lineTo(x-3.5, y+4); ctx.lineTo(x+3.5, y+4); }
      ctx.closePath(); ctx.fill();
    });
  }
  ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L+.5,T+.5,R-L,B-T);
}

/* ---------- governor strip (1949) ---------- */
const gc = $('govplot'), gx = gc.getContext('2d');
function drawGov(){
  const W=600, H=180, s = sizeCanvas(gc, W, H), ctx = gx; ctx.setTransform(s,0,0,s,0,0);
  ctx.fillStyle = C.deep; ctx.fillRect(0,0,W,H);
  const st = CLASSIC.st, L=40, R=W-14, T=10, B=H-22, span=60;
  const tEnd = Math.max(span, st.t), tStart = tEnd - span;
  const yT = v => B - (v+20)/40*(B-T);
  ctx.lineWidth=1; ctx.font=`500 9px ${FONT}`;
  for (const v of [-20,-10,0,10,20]){
    const y=yT(v); ctx.strokeStyle = v===0 ? 'rgba(125,139,149,0.55)' : 'rgba(30,40,49,0.9)';
    ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(R,y); ctx.stroke();
    ctx.fillStyle=C.muted; ctx.textBaseline='middle'; ctx.textAlign='right'; ctx.fillText((v>0?'+':'')+v, L-6, y);
  }
  ctx.textAlign='center';
  for (let q = Math.ceil(tStart/8)*8; q <= tEnd; q += 8){ const x = L + (q-tStart)/span*(R-L); ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.fillText(String(1949+q/4), x, B+5); }
  ctx.textAlign='left';
  const pts = st.hist.filter(h => h.t >= tStart);
  ctx.fillStyle='rgba(75,224,138,0.06)';
  pts.forEach((h,i) => { if (h.gov && i){ const x0 = L + (pts[i-1].t-tStart)/span*(R-L), x1 = L + (h.t-tStart)/span*(R-L); ctx.fillRect(x0,T,x1-x0+0.5,B-T); } });
  const trace = (key, col, w, dash) => {
    if (pts.length<2) return;
    ctx.beginPath(); pts.forEach((h,i)=>{ const x=L+(h.t-tStart)/span*(R-L), y=clamp(yT(h[key]),T,B); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.strokeStyle=col; ctx.lineWidth=w; ctx.setLineDash(dash||[]); ctx.stroke(); ctx.setLineDash([]);
  };
  trace('demand', C.red, 1.2, [4,3]);
  trace('Gpol', C.amber, 2);
  trace('gap', C.phosphor, 2);
  ctx.strokeStyle=C.border; ctx.strokeRect(L+.5,T+.5,R-L,B-T);
}

/* ---------- Phillips curve panel ---------- */
const pc = $('pcurve'), px = pc.getContext('2d');
function drawPC(){
  const W=600, H=300, s = sizeCanvas(pc, W, H), ctx = px; ctx.setTransform(s,0,0,s,0,0);
  ctx.fillStyle = C.deep; ctx.fillRect(0,0,W,H);
  const L=48, R=W-16, T=14, B=H-34;
  const xT = u => L + u/12*(R-L), yT = w => B - (w+2)/12*(B-T);
  ctx.lineWidth=1; ctx.font=`500 9px ${FONT}`;
  for (let u=0; u<=12; u+=2){ const x=xT(u); ctx.strokeStyle='rgba(30,40,49,0.9)'; ctx.beginPath(); ctx.moveTo(x,T); ctx.lineTo(x,B); ctx.stroke(); ctx.fillStyle=C.muted; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(u+'%', x, B+6); }
  for (let w=-2; w<=10; w+=2){ const y=yT(w); ctx.strokeStyle= w===0 ? 'rgba(125,139,149,0.5)' : 'rgba(30,40,49,0.9)'; ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(R,y); ctx.stroke(); ctx.fillStyle=C.muted; ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.fillText(w+'%', L-6, y); }
  ctx.textAlign='left';
  const info = eng.drawCurve(ctx, xT, yT, T, B, R, L);
  ctx.fillStyle=C.muted; ctx.font=`500 9px ${FONT}`; ctx.textBaseline='bottom'; ctx.textAlign='left';
  ctx.fillText('unemployment u →', R-110, B+30);
  ctx.save(); ctx.translate(12, T+130); ctx.rotate(-Math.PI/2); ctx.fillText(info.ylab, 0, 0); ctx.restore();
  const recent = eng.st.hist.slice(-120);
  recent.forEach((h,i) => { ctx.fillStyle = `rgba(75,224,138,${0.08 + 0.5*i/recent.length})`; ctx.beginPath(); ctx.arc(xT(clamp(h.u,0,12)), clamp(yT(h[info.ykey]),T,B), 2, 0, Math.PI*2); ctx.fill(); });
  const cx = xT(clamp(info.cur.u,0,12)), cy = clamp(yT(info.cur.y),T,B);
  ctx.strokeStyle=C.phosphor; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(cx,cy,7,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle=C.phosphor; ctx.beginPath(); ctx.arc(cx,cy,3.5,0,Math.PI*2); ctx.fill();
  ctx.font=`700 10px ${FONT}`; ctx.textBaseline='bottom';
  const lbl = info.cur.lab, tw = ctx.measureText(lbl).width; const lx = cx + 12 + tw > R ? cx - 12 - tw : cx + 12;
  ctx.fillText(lbl, lx, cy-6);
  ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L+.5,T+.5,R-L,B-T);
}

/* ---------- loop ---------- */
let last = performance.now(), uiTick = 0;
function frame(now){
  const realDt = Math.min(0.05, (now - last)/1000); last = now;
  if (running){
    const P = eng.p, simDt = realDt * 1.2 * P.speed;
    const n = Math.max(1, Math.ceil(simDt/0.02));
    for (let i=0;i<n;i++) eng.step(simDt/n);
    if (!reduceMotion){
      eng.pipes.forEach(pp => { eng.phase[pp.k] = ((eng.phase[pp.k]||0) + Math.abs(eng.flow(pp.k)) * realDt * 0.9 * Math.sqrt(P.speed)) % 1600; });
      eng.pump += realDt * eng.pumpRate() * Math.sqrt(P.speed);
    }
  }
  drawMachine(); drawRecorder(); drawPC();
  if (eng.side === 'gov') drawGov();
  if ((uiTick += realDt) > 0.1){ uiTick = 0; updateReadouts(); }
  requestAnimationFrame(frame);
}
CLASSIC.reset(); MODERN.reset();
let start = 'modern';
try { const m = localStorage.getItem('moniac-mode'); if (m === 'classic' || m === 'modern') start = m; } catch(_) {}
setMode(start);
requestAnimationFrame(frame);
