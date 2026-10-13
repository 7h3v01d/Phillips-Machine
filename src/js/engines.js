// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// Simulation engines: Phillips's 1949 MONIAC and a modern Australian economy (Oct 2026 calibration).
// Each engine owns its parameters, state, board drawing, controls and experiments.
'use strict';

/* ================= Hydraulic flow solver ================= */
// The economics proposes flows; the plumbing decides what can actually move. A tank can only
// deliver what it holds plus what flows into it during the step, so when its outlets ask for
// more, all of them are throttled together (an emptying tank loses pressure on every pipe).
// Limiting flows before integrating makes conservation structural: no stock is repaired by clamping after an
// impossible transfer. The only normalisation is sub-1e-9 floating-point residue being set to zero.
// Water is created or destroyed only through edges to or from `null` (outside).
//   stocks: { name: level }   edges: [{ from, to, q }] with from/to a stock name or null
function solveFlows(stocks, edges, dt){
  const dir = edges.map(e => e.q >= 0 ? { src:e.from, dst:e.to, mag:e.q } : { src:e.to, dst:e.from, mag:-e.q });
  const names = Object.keys(stocks);
  const k = {}; for (const n of names) k[n] = 1;
  const factor = n => (n !== null && n in k) ? k[n] : 1;
  const outOf = {}; for (const n of names) outOf[n] = 0;
  for (const d of dir) if (d.src !== null && d.src in outOf) outOf[d.src] += d.mag;
  const avail = n => { let v = stocks[n]/dt; for (const d of dir) if (d.dst === n) v += d.mag*factor(d.src); return Math.max(0, v); };
  const short = n => outOf[n] > avail(n)*(1 + 1e-12);
  // Active-set solve. For the tanks that cannot cover their outlets, outflow·k = stock/dt + inflow is a small
  // linear system (at most one equation per tank), solved exactly; tanks that turn out not to be short leave
  // the set and newly short ones join, until the set is stable. Usually zero or one pass.
  const A = new Set(names.filter(short));
  let passes = 0, settled = A.size === 0;
  while (!settled && passes < 16){
    passes++;
    for (const n of names) if (!A.has(n)) k[n] = 1;
    const list = [...A], ix = {}; list.forEach((n, i) => ix[n] = i);
    const Mx = list.map(() => list.map(() => 0)), b = list.map(n => stocks[n]/dt);
    list.forEach((n, i) => {
      Mx[i][i] = outOf[n];
      for (const d of dir) if (d.dst === n){
        if (d.src !== null && d.src in ix) Mx[i][ix[d.src]] -= d.mag; else b[i] += d.mag*factor(d.src);
      }
    });
    const x = gaussSolve(Mx, b);
    if (!x) break;                             // singular (pure circulation between empty tanks): use fallback
    list.forEach((n, i) => { k[n] = Math.min(1, Math.max(0, x[i])); });
    let changed = false;
    for (const n of list) if (k[n] >= 1){ A.delete(n); changed = true; }
    for (const n of names) if (!A.has(n) && short(n)){ A.add(n); changed = true; }
    settled = !changed;
  }
  if (!settled){
    // Fallback: monotone iteration from fully open valves. Factors only ever fall, so it converges to the
    // same greatest feasible flow, just more slowly.
    for (const n of names) k[n] = 1;
    for (let it = 0; it < 10000; it++){
      let change = 0;
      for (const n of names){
        const next = Math.min(k[n], outOf[n] > avail(n) ? avail(n)/outOf[n] : 1);
        change = Math.max(change, k[n] - next); k[n] = next;
      }
      if (change < 1e-15) break;
    }
  }
  const q = dir.map((d, i) => (edges[i].q >= 0 ? 1 : -1) * d.mag*factor(d.src));
  // integrate with the feasible flows
  let created = 0;
  edges.forEach((e, i) => {
    if (e.from !== null) stocks[e.from] -= q[i]*dt; else created += q[i];
    if (e.to !== null) stocks[e.to] += q[i]*dt; else created -= q[i];
  });
  for (const n in stocks) if (stocks[n] < 0 && stocks[n] > -1e-9) stocks[n] = 0;   // float round-off only
  const out = { k, created, by:{}, passes, settled };
  edges.forEach((e, i) => { if (e.k) out.by[e.k] = q[i]; });
  return out;
}

// Gaussian elimination with partial pivoting for the (at most four-tank) throttle system.
function gaussSolve(A, b){
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++){
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++){ if (r === c) continue; const f = M[r][c]/M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f*M[c][j]; }
  }
  return M.map((r, i) => r[n]/r[i]);
}

/* ================= ENGINE 1: Phillips 1949 ================= */
const CLASSIC = (() => {
  const DEFAULTS = {tax:.20, G:20, s:.15, m:.15, b:2, acc:0, omo:0, X0:10, speed:1, floating:true, deficit:true,
    gov:false, Kp:.8, Ki:.3, Kd:1, Ytgt:100, Tlag:1, Tprod:2};
  const p = {...DEFAULTS};
  const YF = 105;
  const E = { id:'classic', p, DEFAULTS, phase:{}, pump:0 };
  E.sub = "A working simulation of A.W.H. (Bill) Phillips's Monetary National Income Analogue Computer, LSE 1949. Water is money. Open the valves and watch the national income settle, overshoot or cycle.";
  E.boardTitle = 'Hydraulic board · 1949';
  E.init = () => { E.st = {Yout:80, TB:80, SB:50, Tr:30, FB:40, Ysm:80, dYsm:0, t:0, hist:[], nextSample:0, f:{}, integ:0, Gpol:0, demand:0, iae:0}; E.step(0.0001); };
  E.step = (dt) => {
    const st = E.st;
    const Yp = st.Yout;                       // output the economy is trying to produce
    const T0 = p.tax * Yp, Yd0 = Yp - T0;
    const S0 = p.s * Yd0, C0 = Yd0 - S0;
    const e = p.floating ? clamp(1 + 0.6*(st.FB-40)/40, 0.5, 2.2) : 1;
    const X0 = p.X0 * Math.pow(e, 0.9);
    const Im0 = clamp(p.m/Math.pow(e,0.6), 0, 0.9) * C0;
    const r = clamp(12 - 0.14*st.SB, 0.5, 15);
    const I0 = Math.max(0, 12 + p.b*(5 - r) + p.acc*st.dYsm);
    const gap = p.Ytgt - Yp;
    if (p.gov){
      st.integ = clamp(st.integ + gap*dt, -300, 300);
      st.demand = p.Kp*gap + p.Ki*st.integ + p.Kd*(-st.dYsm);
      st.iae += Math.abs(gap)*dt;
    } else { st.integ = 0; st.demand = 0; }
    st.Gpol += (st.demand - st.Gpol) * dt / p.Tlag;
    let G0 = clamp(p.G + st.Gpol, 0, 90), borrow0 = 0, repay0 = 0;
    if (st.Tr < 0.5){                          // policy choice: borrow idle balances, or spend only what taxes bring in
      if (p.deficit && st.SB > 0.5) borrow0 = Math.max(0, G0 - T0);
      else G0 = Math.min(G0, T0);
    }
    if (st.Tr > 90) repay0 = (st.Tr - 90) * 2;
    // Pipes between tanks. Domestic consumption leaves and re-enters the transactions tank, so it is not an edge.
    const tanks = { TB:st.TB, SB:st.SB, Tr:st.Tr, FB:st.FB };
    const sol = solveFlows(tanks, [
      {k:'T',  from:'TB', to:'Tr', q:T0},  {k:'S', from:'TB', to:'SB', q:S0},  {k:'Im', from:'TB', to:'FB', q:Im0},
      {k:'G',  from:'Tr', to:'TB', q:G0},  {k:'I', from:'SB', to:'TB', q:I0},  {k:'X',  from:'FB', to:'TB', q:X0},
      {k:'borrow', from:'SB', to:'Tr', q:borrow0}, {k:'repay', from:'Tr', to:'SB', q:repay0},
      {k:'omo', from:null, to:'SB', q:p.omo}
    ], dt);
    Object.assign(st, tanks);
    st.acct = { created: sol.created, k: sol.k };
    st.desired = { Y:Yp, T:T0, S:S0, C:C0, Im:Im0, I:I0, G:G0, X:X0, borrow:borrow0, repay:repay0, omo:p.omo };
    const q = sol.by, kY = sol.k.TB;           // kY < 1 only when the transactions tank runs dry
    const Y = Yp*kY, T = q.T, S = q.S, Im = q.Im, Yd = Y - T, Cn = Yd - S, Cdom = Cn - Im;
    const I = q.I, G = q.G, X = q.X, Ex = Cdom + I + G + X;
    if (p.Tprod > 0.01) st.Yout += (st.TB - st.Yout) * dt / p.Tprod; else st.Yout = st.TB;
    const prev = st.Ysm;
    st.Ysm += (st.Yout - st.Ysm) * dt / 1.5;
    st.dYsm = dt > 0.001 ? (st.Ysm - prev)/dt : 0;
    st.t += dt;
    const u = clamp(1.5 + 30*(1 - Y/YF), 0.6, 14);
    const w = -0.9 + 9.638*Math.pow(u, -1.394);
    st.f = {Y,T,Yd,S,C:Cn,Im,Cdom,I,G,X,E:Ex,omo:q.omo,borrow:q.borrow,repay:q.repay,r,e,u,w, Gpol:st.Gpol, gap, backlog: st.TB - st.Yout};
    if (st.t >= st.nextSample){
      st.hist.push({t:st.t, Y, r, FB:st.FB, u, w, gap, Gpol:st.Gpol, demand:st.demand, gov:p.gov});
      if (st.hist.length > 480) st.hist.shift();
      st.nextSample += 0.25;
    }
  };
  E.timeLabel = t => { const q = Math.floor(t); return `${1949 + Math.floor(q/4)} Q${(q%4)+1}`; };
  E.yearAt = q => 1949 + q/4;
  E.status = () => running ? 'PUMP RUNNING' : 'PUMP STOPPED';
  const tanks = {
    Tr:{x:30,y:100,w:110,h:110,cap:90,name:'TREASURY'},
    SB:{x:370,y:220,w:120,h:140,cap:140,name:'SURPLUS BALANCES'},
    FB:{x:110,y:320,w:110,h:120,cap:100,name:'FOREIGN-HELD'},
    TB:{x:170,y:640,w:220,h:100,cap:200,name:'TRANSACTIONS BALANCES'}
  };
  E.pipes = [
    {k:'Y',   pts:[[390,725],[550,725],[550,30],[280,30],[280,90]], lab:'INCOME Y', lp:[556,380], rot:true},
    {k:'T',   pts:[[280,90],[85,90],[85,100]], lab:'TAXES', lp:[150,84]},
    {k:'Yd',  pts:[[280,90],[280,170]]},
    {k:'S',   pts:[[280,170],[430,170],[430,220]], lab:'SAVING', lp:[300,164]},
    {k:'C',   pts:[[280,170],[280,290]], lab:'CONSUMPTION', lp:[288,212]},
    {k:'Im',  pts:[[280,290],[165,290],[165,320]], lab:'IMPORTS', lp:[176,309]},
    {k:'Cdom',pts:[[280,290],[280,500]], lab:'DOMESTIC C', lp:[288,400]},
    {k:'I',   pts:[[430,360],[430,500],[280,500]], lab:'INVESTMENT', lp:[300,494]},
    {k:'CI',  pts:[[280,500],[280,540]]},
    {k:'G',   pts:[[60,210],[60,540],[280,540]], lab:'GOV. SPENDING', lp:[66,534]},
    {k:'CIG', pts:[[280,540],[280,580]]},
    {k:'X',   pts:[[165,440],[165,580],[280,580]], lab:'EXPORTS', lp:[172,574], over:true},
    {k:'E',   pts:[[280,580],[280,640]], lab:'EXPENDITURE', lp:[288,616]},
    {k:'omo', pts:[[470,100],[470,220]], lab:'OPEN MARKET', lp:[476,150], signed:true}
  ];
  E.flow = k => { const f = E.st.f; if (k==='CI') return f.Cdom + f.I; if (k==='CIG') return f.Cdom + f.I + f.G; return f[k] || 0; };
  E.drawBoard = (ctx) => {
    const st = E.st, f = st.f;
    ctx.fillStyle = C.obsidian; ctx.fillRect(415,50,110,50); ctx.strokeStyle = C.muted; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.strokeRect(415.5,50.5,109,49); ctx.setLineDash([]);
    ctx.font=`700 9px ${FONT}`; ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.textAlign='left'; ctx.fillText('MONETARY', 422, 57); ctx.fillText('AUTHORITY', 422, 69); ctx.fillStyle=C.text; ctx.fillText('bank credit', 422, 83);
    drawTank(ctx, tanks.Tr, st.Tr, f.borrow>0.05 ? {t:`borrowing ${f.borrow.toFixed(1)}/q`, c:C.red} : f.repay>0.05 ? {t:`repaying ${f.repay.toFixed(1)}/q`, c:C.phosphor} : {t:`budget ${(f.T-f.G>=0?'+':'')}${(f.T-f.G).toFixed(1)}/q`});
    drawTank(ctx, tanks.SB, st.SB, {t:'idle money → sets r'});
    drawTank(ctx, tanks.FB, st.FB, {t:`exch. rate ${f.e.toFixed(2)}`});
    drawTank(ctx, tanks.TB, st.TB, {t:`money stock ${(st.TB+st.SB+st.Tr+st.FB).toFixed(0)}`, c:C.muted});
    if (st.acct) for (const n of ['Tr','SB','FB','TB']) drawThrottle(ctx, tanks[n], st.acct.k[n]);
    drawValve(ctx, 280, 90, 't', p.tax);
    drawValve(ctx, 280, 170, 's', p.s);
    drawValve(ctx, 280, 290, 'm', clamp(p.m/Math.pow(f.e,0.6),0,0.9));
    drawGauge(ctx, 500, 225, 130, f.r/15, 'r %', f.r.toFixed(2));
    const sbT = tanks.SB, sy = sbT.y + sbT.h*(1-clamp(st.SB/sbT.cap,0,1));
    const ry = 225 + 130*(1-clamp(f.r/15,0,1));
    ctx.strokeStyle = 'rgba(255,180,84,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(sbT.x+sbT.w-4, sy); ctx.lineTo(500, ry); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.amber; ctx.fillRect(sbT.x+sbT.w-12, sy-3, 10, 6);
    if (p.gov || Math.abs(st.Gpol) > 0.05){
      ctx.fillStyle = C.obsidian; ctx.fillRect(18,262,92,40);
      ctx.strokeStyle = p.gov ? C.phosphor : C.muted; ctx.lineWidth = 1.5; ctx.strokeRect(18.5,262.5,91,39);
      ctx.font=`700 9px ${FONT}`; ctx.textBaseline='top'; ctx.fillStyle = p.gov ? C.phosphor : C.muted;
      ctx.fillText('GOVERNOR', 24, 267);
      ctx.font=`800 12px ${FONT}`; ctx.fillStyle = st.Gpol >= 0 ? C.text : C.red;
      ctx.fillText(`ΔG ${(st.Gpol>=0?'+':'')}${st.Gpol.toFixed(1)}`, 24, 281);
    }
    drawProdLag(ctx, 400, 703, p.Tprod, f.backlog);
    drawPump(ctx, 505, 725, E.pump);
    ctx.font=`700 10px ${FONT}`; ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.textAlign='left';
    ctx.fillText('A.W.H. PHILLIPS · L.S.E. · 1949', 12, 745);
  };
  E.pumpRate = () => 0.5 + E.st.f.Y/25;
  E.readouts = [
    ['Y','Income Y',v=>v.toFixed(1),()=> 'hot'],['C','Consumption'],['I','Investment'],['G','Gov. spending'],['X','Exports'],['Im','Imports'],
    ['T','Taxes'],['S','Saving'],['r','Interest r',v=>v.toFixed(2)+'%',()=>'warm'],['e','Exch. rate',v=>v.toFixed(2)],
    ['u','Unemploy.',v=>v.toFixed(2)+'%',v=> v>6?'bad':v<1.2?'warm':''],['w','Wage infl.',v=>v.toFixed(2)+'%',v=> v>5?'bad':v<0?'warm':''],
    ['Gpol','Policy ΔG',v=>sgn(v)+v.toFixed(1)],['gap','Income gap',v=>sgn(v)+v.toFixed(1)],['backlog','Order backlog',v=>sgn(v)+v.toFixed(1)]
  ];
  E.value = k => E.st.f[k];
  const pct = v => (v*100).toFixed(0)+'%';
  E.groups = [
    {name:'Fiscal policy', sliders:[
      {id:'tax', label:'Tax rate t', min:0, max:.5, step:.01, fmt:pct},
      {id:'G', label:'Government spending G', min:0, max:50, step:.5, fmt:v=>v.toFixed(1)+' /q'}],
      toggles:[{id:'deficit', label:'Allow deficit financing (borrow idle balances)'}]},
    {name:'Households', sliders:[
      {id:'s', label:'Propensity to save s', min:0, max:.5, step:.01, fmt:pct},
      {id:'m', label:'Propensity to import m', min:0, max:.4, step:.01, fmt:pct}]},
    {name:'Investment', sliders:[
      {id:'b', label:'Sensitivity to interest b', min:0, max:5, step:.1, fmt:v=>v.toFixed(1)},
      {id:'acc', label:'Accelerator a (reacts to growth)', min:0, max:3, step:.05, fmt:v=>v.toFixed(2)}]},
    {name:'Money and trade', sliders:[
      {id:'omo', label:'Open-market flow into idle balances', min:-6, max:6, step:.25, fmt:v=>(v>0?'+':'')+v.toFixed(2)+' /q'},
      {id:'X0', label:'Foreign demand for exports X₀', min:0, max:30, step:.5, fmt:v=>v.toFixed(1)+' /q'}],
      toggles:[{id:'floating', label:'Floating exchange rate'}],
      buttons:[
        {label:'Buy bonds: +20 to idle', fn:()=>{ E.st.SB += 20; setCaption('<b>Bank credit expanded.</b> Idle balances jump, the float drops the interest rate, and investment opens up. Income follows with a lag.'); }},
        {label:'Sell bonds: −20', fn:()=>{ E.st.SB = Math.max(0, E.st.SB - 20); setCaption('<b>Bonds sold.</b> Water leaves the idle-balances tank, the interest rate rises and investment is choked back.'); }}]},
    {name:'Treasury governor (Phillips 1954)', sliders:[
      {id:'Kp', label:'Proportional gain Kp', min:0, max:3, step:.05, fmt:v=>v.toFixed(2)},
      {id:'Ki', label:'Integral gain Ki', min:0, max:1.5, step:.05, fmt:v=>v.toFixed(2)},
      {id:'Kd', label:'Derivative gain Kd', min:0, max:4, step:.1, fmt:v=>v.toFixed(1)},
      {id:'Ytgt', label:'Target income', min:70, max:130, step:1, fmt:v=>v.toFixed(0)},
      {id:'Tlag', label:'Policy lag τ', min:.25, max:4, step:.25, fmt:v=>v.toFixed(2)+' q'}],
      toggles:[{id:'gov', label:'Engage governor (adjusts G automatically)', onChange:()=>{ E.st.integ = 0; E.st.iae = 0; }}]},
    {name:'Machine and lags', sliders:[
      {id:'Tprod', label:'Production lag τp (spending → output)', min:0, max:4, step:.25, fmt:v=>v===0?'none':v.toFixed(2)+' q'},
      {id:'speed', label:'Pump speed (sim time)', min:.25, max:4, step:.25, fmt:v=>v.toFixed(2)+'×'}]}
  ];
  // Every experiment starts from the same settled 1949 machine, whatever was running before.
  function settle(){ E.resetParams(); E.init(); for (let i=0;i<1500;i++) E.step(0.02); }
  const fresh = fn => () => { settle(); fn(); };
  function govTest(Kp, Ki, Kd, Tlag){
    settle();
    p.Ytgt = Math.round(E.st.f.Y);
    Object.assign(p, {gov:true, Kp, Ki, Kd, Tlag, X0:4});
    E.st.integ = 0; E.st.iae = 0;
  }
  E.scenarios = [
    ['Fiscal stimulus', fresh(() => { p.G = 30; }), '<b>G raised from 20 to 30.</b> The Treasury drains faster than taxes refill it. The simple multiplier, 10 ÷ 0.42, would add about 24 to income; it actually peaks about 19 higher, because deficit borrowing drains idle balances, the interest rate climbs from about 5% to over 7% and investment is crowded out.'],
    ['Austerity', fresh(() => { p.G = 12; p.tax = .25; }), '<b>G cut to 12, tax raised to 25%.</b> The budget swings to surplus and income falls. Watch unemployment climb along the Phillips curve and wage growth turn negative.'],
    ['Paradox of thrift', fresh(() => { p.s = .30; }), '<b>Saving doubled to 30%.</b> Spending falls and income drops to about 91. Yet total saving nearly doubles: the extra idle money lowers the interest rate below 1%, and investment rises to match it. In Keynes\'s pure paradox, with investment fixed, saving could not rise at all; Phillips\'s interest-rate float is what rescues it here.'],
    ['Credit squeeze', fresh(() => { E.st.SB = Math.max(0, E.st.SB - 35); p.omo = -1; }), '<b>The monetary authority sells bonds</b> and keeps draining idle balances. The float drops, the interest rate climbs and investment falls away.'],
    ['Export boom', fresh(() => { p.X0 = 18; }), '<b>Foreign demand nearly doubles.</b> Income jumps to about 109 and foreign-held balances run down, so the currency appreciates (the exchange-rate index falls from 1.0 to under 0.7). With a floating rate that appreciation eventually prices the whole boom away, and income drifts back to where it started.'],
    ['Trade cycle', fresh(() => { p.acc = 2.4; E.st.TB += 25; }), '<b>Accelerator set to 2.4 and income given a shove.</b> Investment now chases growth, so the economy overshoots and swings: the oscillating dynamics Phillips set out in the 1950 Economica paper.'],
    ['Fixed exchange rate', fresh(() => { p.floating = false; p.m = .25; }), '<b>Peg the exchange rate and raise import appetite.</b> Nothing corrects the trade deficit, so foreign-held balances pile up and money drains out of the domestic economy.'],
    ['Governor: P only', () => govTest(.8, 0, 0, 1), '<b>Proportional policy only.</b> Exports collapse from 10 to 4. Unaided, income would sink to about 84. P control holds it near 92, but a permanent gap remains, because spending only rises while there is an error to react to. Error score ends near 600.'],
    ['Governor: P + I', () => govTest(.8, .8, 0, 1), '<b>Add integral action.</b> The integral keeps building until the gap is closed, so income gets back to target. But the two-quarter production lag means policy keeps pushing after the turn: income swings between about 86 and 110 for years before it settles. Error score near 250.'],
    ['Governor: P + I + D', () => govTest(.8, .8, 3, 1), '<b>Same gains, plus derivative action.</b> Policy now also leans against the rate of change of income, so it eases off while the recovery is still accelerating. Income settles within a couple of years, inside 96 to 101. This is the mix Phillips argued for. Error score near 40.'],
    ['Governor: lag wrecks it', () => govTest(1, 1, 0, 2), '<b>Stronger gains and a half-year policy lag on top of the production lag.</b> Each correction lands after the economy has already turned, so policy amplifies the swings: income runs between about 80 and 111 in the first five years and the error score ends near 360, nine times the P + I + D result. It stops short of exploding only because the governor\'s deficits drain the Treasury and the surplus-balances tank dry by year four: with no idle money left to borrow, the plumbing itself caps what policy can spend. Then set Kd to 3 and watch derivative action calm it (income held within about 95 to 104, error score near 130).']
  ];
  E.startCaption = 'The machine is starting with the transactions tank part-empty. Watch income climb and settle where leakages (taxes, saving, imports) match injections (government, investment, exports).';
  E.resetCaption = 'Reset to the 1949 settings. Income settles near 100 with balanced budget and trade.';
  E.resetParams = () => { Object.keys(p).forEach(k => delete p[k]); Object.assign(p, DEFAULTS); };
  E.reset = () => { E.resetParams(); E.init(); for (let i=0;i<500;i++) E.step(0.02); };
  E.recorder = {
    left:{min:40, max:160, ticks:[40,70,100,130,160], col:C.phosphor, fmt:v=>String(v)},
    right:{min:0, max:15, ticks:[0,5,10,15], col:C.amber, fmt:v=>v+'%'},
    series:[{key:'FB', col:C.teal, w:1.2, min:0, max:100},{key:'r', col:C.amber, w:1.5, axis:'right'},{key:'Y', col:C.phosphor, w:2, axis:'left'}],
    refs:() => { const r = [{axis:'left', v:YF, col:'rgba(75,224,138,0.45)', label:'full capacity'}]; if (p.gov) r.push({axis:'left', v:p.Ytgt, col:'rgba(255,180,84,0.7)', label:'governor target', below:true}); return r; }
  };
  E.recLegend = '<span><i style="background:var(--phosphor)"></i>National income Y</span><span><i style="background:var(--amber)"></i>Interest rate r</span><span><i style="background:var(--teal)"></i>Foreign-held balances</span>';
  E.pcTitle = 'Phillips curve'; E.pcTag = 'Economica 1958';
  E.pcLegend = '<span><i style="background:var(--amber)"></i>ẇ + 0.900 = 9.638 · u<sup>−1.394</sup> (UK 1861–1913 fit)</span><span><i style="background:var(--phosphor)"></i>Where the machine sits now</span>';
  E.drawCurve = (ctx, xT, yT, T, B, R) => {
    ctx.beginPath(); let first=true;
    for (let u=0.75; u<=12; u+=0.05){ const w=-0.9+9.638*Math.pow(u,-1.394); const y=yT(w); if (y<T) continue; first ? ctx.moveTo(xT(u),y) : ctx.lineTo(xT(u),y); first=false; }
    ctx.strokeStyle=C.amber; ctx.lineWidth=2; ctx.stroke();
    return {ykey:'w', ylab:'money wage change ẇ →', cur:{u:E.st.f.u, y:E.st.f.w, lab:`u ${E.st.f.u.toFixed(1)}%  ẇ ${E.st.f.w.toFixed(1)}%`}};
  };
  E.side = 'gov';
  return E;
})();

/* ================= ENGINE 2: Modern Australia, Oct 2026 ================= */
const MODERN = (() => {
  // Units: 100 = one quarter of potential GDP ≈ A$730bn. Rates and inflation in % a year.
  const DEFAULTS = { rule:true, iManual:4.6, phiPi:.5, phiY:.5, target:2.5, qe:0, qeAuto:true,
    G:28.5, tax:.284, s:.065, credit:1, spread:2.0, conf:0, cp:1, iw:3.75, oil:1, Tprod:2, acc:0, speed:1 };
  const p = {...DEFAULTS};
  const K = { Ypot:100, rn:.6, nairu:4.5, kappa:.25, lam:.12, anchor:.10, Tmort:75, depSp:-1, X0:24.7, m:.345,
    L0:5.3, Ib0:12.6, aL:.10, aI:.06, SV0:150, FB0:40, AUD0:.70, bn:7.3, piFloor:5 };
  const rr0 = 4.6 - 3.5;
  const Ln = K.L0 / (1 - K.aL*(rr0 - K.rn));
  const Ibn = K.Ib0 / (1 - K.aI*(rr0 - K.rn));
  let retain = 0.08;
  const E = { id:'modern', p, DEFAULTS, phase:{}, pump:0 };
  E.sub = 'The same hydraulic idea rebuilt for Australia in October 2026: an inflation-targeting Reserve Bank, banks that create money by lending, public debt and QE, and a floating dollar pushed around by capital flows and commodity prices.';
  E.boardTitle = 'Hydraulic board · Australia 2026';
  E.init = () => {
    // Yout 99.8 puts unemployment at 4.6% (Aug 2026). pi is underlying (trimmed-mean) inflation, 3.6%;
    // headline CPI = pi + hE = 4.0%, the extra 0.4 being fuel and electricity.
    E.st = {Yout:99.8, TB:99.8,
      SV:K.SV0, FB:K.FB0, GA:0, D:400, B:106, Bcb:30, e:1, eSlow:1, oilI:1, oilSlow:1,
      i:4.6, pi:3.6, hE:0.4, pie:3.5, Ysm:99.8, dYsm:0, t:0, nextMeet:0.4, log:[], hist:[], nextSample:0, f:{}};
    E.st.f = flows(E.st); E.st.f.istar = ruleRate(E.st, E.st.f.gap); E.st.desired = E.st.f;
  };
  function ruleRate(st, gap){ return K.rn + st.pi + p.phiPi*(st.pi - p.target) + p.phiY*gap; }
  function flows(st){
    const Y = st.Yout, gap = (Y/K.Ypot - 1)*100, u = clamp(K.nairu - 0.5*gap, 0.5, 20);
    const i = st.i, rreal = i - st.pie, rb = i + 0.4 + 0.004*(K.SV0 - st.SV);
    const T = p.tax*Y, MI = (i + p.spread)/400*st.D, R = st.D/K.Tmort;
    const Bint = rb/400*st.B, DI = Math.max(0, i + K.depSp)/400*st.SV;
    const Div = MI - DI, Ret = retain*Y;
    const Tn = T - Bint;
    const Yd = Y - Tn - Ret - MI - R + 0.5*Div;
    // Confidence shifts the split of disposable income between spending and saving. Saving is the residual,
    // so C + S = Yd always holds and a confidence shock never creates or destroys money.
    const Cn = Math.max(0, (1 - p.s)*Yd + p.conf), S = Yd - Cn;
    const L = Math.max(0, p.credit*Ln*(1 - K.aL*(rreal - K.rn)));
    const Ib = Math.max(0, Ibn*(1 - K.aI*(rb - 0.4 - st.pie - K.rn)) + p.acc*st.dYsm);
    const M = K.m*(Cn + Ib + L)*Math.pow(st.e, .5)*(1 + 0.08*(st.oilI - 1));
    const X = K.X0*Math.pow(p.cp, .7)*Math.pow(st.e, -.6);
    const G = p.G;
    const Ex = Cn + Ib + L + G + X - M;
    const Def = G - Tn;
    let q = p.qe;
    if (p.qeAuto && st.i <= 0.11 && gap < -1) q += Math.min(8, -1.5*gap);
    const Kin = (K.m*69.8 - K.X0) + 1.0*((i - p.iw) - 0.85);
    return {Y,gap,u,i,rreal,rb,T,Tn,MI,R,Bint,DI,Div,Ret,Yd,S,C:Cn,L,Ib,M,X,G,E:Ex,Def,q,Kin,
      MP:MI+R, Div2:0.5*Div, DIsv:DI+0.5*Div, Cd:Cn-M, pi:st.pi, cpi:st.pi + st.hE, pie:st.pie, aud:K.AUD0*st.e,
      mort:i+p.spread, hhDebt:st.D/4, pubDebt:(st.B+st.Bcb)/4, rbaBonds:st.Bcb/4, govAcct:st.GA/4, nx:X-M, gdpBn:Y*K.bn,
      backlog: st.TB - st.Yout, cash:i};
  }
  // calibrate retained earnings so spending equals output at neutral settings
  (() => {
    E.init(); const st = E.st; st.Yout = st.TB = K.Ypot; st.i = 3.1; st.pi = 2.5; st.pie = 2.5;
    let lo = 0, hi = .4;
    for (let k=0;k<60;k++){ retain = (lo+hi)/2; const f = flows(st); if (f.E > f.Y) lo = retain; else hi = retain; }
  })();
  E.step = (dt) => {
    const s = E.st, f = flows(s);
    s.desired = f;                             // what the economy wants to do this step
    const gN = (2 + s.pi)/400;                 // nominal growth erodes debt ratios
    // Government financing. Deficits draw on the government account first, then sell bonds out of savings.
    // Surpluses buy back privately held bonds first; once those are gone the surplus builds the government
    // account. Privately held bonds therefore never go negative and nobody pays the government bond interest.
    let fromGA = 0, bond = 0, repay = 0, accum = 0;
    if (f.Def >= 0){ fromGA = Math.min(f.Def, s.GA/dt); bond = f.Def - fromGA; }
    else { const sur = -f.Def; repay = Math.min(sur, Math.max(0, s.B/dt - gN*s.B)); accum = sur - repay; }
    // RBA bond trades: it can only buy bonds private holders still own, and only sell bonds it holds.
    let qWant = f.q;
    if (qWant > 0) qWant = Math.min(qWant, Math.max(0, s.B/dt - gN*s.B - repay));
    else qWant = Math.max(qWant, -Math.max(0, s.Bcb/dt - gN*s.Bcb));
    // Pipes between money tanks; `null` is outside the economy (bank credit creation and repayment, RBA reserves).
    // Taxes, government spending financed by those taxes, bank interest paid back out and domestic consumption
    // all leave and re-enter the deposits tank, so they are not edges.
    const tanks = { TB:s.TB, SV:s.SV, FB:s.FB, GA:s.GA };
    const sol = solveFlows(tanks, [
      {k:'S',   from:'TB', to:'SV', q:f.S},   {k:'Ret', from:'TB', to:'SV', q:f.Ret}, {k:'DIsv', from:'TB', to:'SV', q:f.DIsv},
      {k:'Ib',  from:'SV', to:'TB', q:f.Ib},
      {k:'GAdef', from:'GA', to:'TB', q:fromGA}, {k:'Bond', from:'SV', to:'TB', q:bond},
      {k:'Repay', from:'TB', to:'SV', q:repay},  {k:'Accum', from:'TB', to:'GA', q:accum},
      {k:'M',   from:'TB', to:'FB', q:f.M},   {k:'X',   from:'FB', to:'TB', q:f.X},   {k:'Kin', from:'FB', to:'SV', q:f.Kin},
      {k:'L',   from:null, to:'TB', q:f.L},   {k:'R',   from:'TB', to:null, q:f.R},   {k:'q',   from:null, to:'SV', q:qWant}
    ], dt);
    Object.assign(s, tanks);
    const a = sol.by, kTB = sol.k.TB;
    const defAct = a.GAdef + a.Bond - a.Repay - a.Accum;
    s.acct = { created: sol.created, k: sol.k, L:a.L, R:a.R, q:a.q, Def:defAct, bondNet:a.Bond - a.Repay };
    // Ledgers (records, not water) follow the flows that actually happened.
    s.D += (a.L - a.R)*dt;
    s.B += (a.Bond - a.Repay - a.q - gN*s.B)*dt;
    s.Bcb += (a.q - gN*s.Bcb)*dt;
    if (s.B < 0 && s.B > -1e-9) s.B = 0;       // float round-off only
    if (s.Bcb < 0 && s.Bcb > -1e-9) s.Bcb = 0;
    // The executed flow record. If the deposits tank ran short, everything paid out of it (income and all of
    // its uses) was delivered at the same fraction kTB; the other pipes report what the solver let through.
    // Built this way, C + S = Yd and (E − Y)·dt = Δdeposits hold exactly for what the board displays.
    const act = { ...f };
    for (const key of ['Y','T','Bint','Tn','MI','DI','Div','Div2','Ret','Yd']) act[key] = f[key]*kTB;
    Object.assign(act, { S:a.S, DIsv:a.DIsv, R:a.R, M:a.M, Ib:a.Ib, X:a.X, Kin:a.Kin, q:a.q, L:a.L, Def:defAct,
      GAdef:a.GAdef, Bond:a.Bond, Repay:a.Repay, Accum:a.Accum, throttle:sol.k });
    act.C = act.Yd - act.S; act.G = act.Tn + defAct; act.Cd = act.C - act.M; act.MP = act.MI + act.R;
    act.E = act.C + act.Ib + act.L + act.G + act.X - act.M; act.nx = act.X - act.M; act.gdpBn = act.Y*K.bn;
    // Exchange rate
    const eT = clamp(1 - 0.15*(s.FB - K.FB0)/K.FB0 + 0.3*(p.cp - 1), .55, 1.6);
    s.e += (eT - s.e)*dt/3; s.eSlow += (s.e - s.eSlow)*dt/4;
    // Inflation. Headline CPI = underlying + an energy term; an oil price level shock moves year-ended
    // fuel inflation (≈4% CPI weight) and then fades as the new price level drops out of the year.
    s.oilI += (p.oil - s.oilI)*dt/2;
    s.oilSlow += (s.oilI - s.oilSlow)*dt/4;
    s.hE += (4*(s.oilI/s.oilSlow - 1) - s.hE)*dt/0.5;
    // Underlying inflation: expectations, the output gap, AUD pass-through and second-round energy effects.
    const piRaw = s.pie + K.kappa*f.gap - 10*(s.e - s.eSlow) + 0.3*s.hE;
    // Wages and prices are sticky downwards: deflation saturates smoothly toward −5% a year instead of
    // running away (without this, a frozen high cash rate can drive a century-long debt-deflation spiral).
    const piT = piRaw >= 0 ? piRaw : -K.piFloor*(1 - Math.exp(piRaw/K.piFloor));
    s.pi += (piT - s.pi)*dt/2.0;
    // Households and firms form expectations from the headline number they see, anchored by the target.
    s.pie += (K.lam*((s.pi + s.hE) - s.pie) + K.anchor*(p.target - s.pie))*dt;
    if (p.Tprod > .01) s.Yout += (s.TB - s.Yout)*dt/p.Tprod; else s.Yout = s.TB;
    const prev = s.Ysm; s.Ysm += (s.Yout - s.Ysm)*dt/1.5; s.dYsm = dt > 0.001 ? (s.Ysm - prev)/dt : 0;
    s.t += dt;
    const istar = ruleRate(s, f.gap);
    if (s.t >= s.nextMeet){
      s.nextMeet += 0.5;
      let mv = 0;
      if (p.rule){ const d = istar - s.i; if (d > .2) mv = .25; else if (d < -.2) mv = -.25; if (s.i + mv < 0.1) mv = 0.1 - s.i; }
      else mv = p.iManual - s.i;
      mv = Math.round(mv*100)/100;
      s.log.push([s.t, mv, clamp(s.i + mv, .1, 15)]);
      if (s.log.length > 120) s.log.shift();
      s.i = clamp(s.i + mv, .1, 15);
    }
    s.f = Object.assign(act, { istar });     // the board shows what actually ran this step
    if (s.t >= s.nextSample){
      s.hist.push({t:s.t, Y:s.Yout, i:s.i, pi:s.pi, cpi:s.pi + s.hE, u:s.f.u, pie:s.pie});
      if (s.hist.length > 480) s.hist.shift();
      s.nextSample += 0.25;
    }
  };
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateAt = t => { const y = 2026.75 + t/4; const yr = Math.floor(y + 1e-9); const m = Math.floor((y - yr)*12 + 1e-6); return {yr, m}; };
  E.timeLabel = t => { const d = dateAt(t); return `${MON[d.m]} ${d.yr}`; };
  E.dateStr = t => { const d = dateAt(t); return `${MON[d.m]} ${d.yr}`; };
  E.yearAt = q => 2026.75 + q/4;
  E.status = () => running ? 'PUMP RUNNING' : 'PUMP STOPPED';
  const tanks = {
    TB:{x:180,y:640,w:220,h:100,cap:200,name:'TRANSACTION DEPOSITS'},
    SV:{x:380,y:250,w:120,h:140,cap:260,name:'SAVINGS & SUPER'},
    FB:{x:140,y:330,w:110,h:120,cap:100,name:'FOREIGN-HELD AUD'}
  };
  E.pipes = [
    {k:'Y',   pts:[[400,725],[555,725],[555,30],[290,30],[290,80]], lab:'GDP Y', lp:[561,380], rot:true},
    {k:'Tn',  pts:[[290,80],[80,80],[80,95]], lab:'NET TAXES', lp:[150,74]},
    {k:'Y1',  pts:[[290,80],[290,115]]},
    {k:'Ret', pts:[[290,115],[400,115],[400,250]], lab:'RETAINED PROFIT', lp:[298,109]},
    {k:'Y2',  pts:[[290,115],[290,150]]},
    {k:'MP',  pts:[[290,150],[115,150],[115,185]], lab:'MORTGAGES', lp:[180,144]},
    {k:'Y3',  pts:[[290,150],[290,205]]},
    {k:'Div2',pts:[[170,205],[290,205]], lab:'BANK PAYOUT', lp:[176,199]},
    {k:'Yd',  pts:[[290,205],[290,262]]},
    {k:'S',   pts:[[290,262],[380,262]], lab:'SAVING', lp:[300,256]},
    {k:'C',   pts:[[290,262],[290,300]]},
    {k:'M',   pts:[[290,300],[195,300],[195,330]], lab:'IMPORTS', lp:[205,294]},
    {k:'Cd',  pts:[[290,300],[290,500]], lab:'CONSUMPTION', lp:[298,430]},
    {k:'Ib',  pts:[[440,390],[440,500],[290,500]], lab:'BUSINESS INV.', lp:[300,494]},
    {k:'CI',  pts:[[290,500],[290,530]]},
    {k:'G',   pts:[[40,165],[40,530],[290,530]], lab:'GOVT', lp:[203,524]},
    {k:'CIG', pts:[[290,530],[290,560]]},
    {k:'L',   pts:[[115,240],[115,560],[290,560]], lab:'CREDIT', lp:[203,554], credit:true, over:1},
    {k:'CIGL',pts:[[290,560],[290,590]]},
    {k:'X',   pts:[[195,450],[195,590],[290,590]], lab:'EXPORTS', lp:[201,584], over:2},
    {k:'E',   pts:[[290,590],[290,640]], lab:'SPENDING', lp:[298,622]},
    {k:'DIsv',pts:[[170,232],[368,232],[368,320],[380,320]], lab:'TO SAVERS', lp:[300,228], over:1},
    {k:'Kin', pts:[[250,372],[380,372]], lab:'CAP. IN', lp:[298,366], signed:true, over:2},
    {k:'q',   pts:[[480,100],[480,250]], lab:'QE', lp:[486,180], signed:true, credit:true}
  ];
  E.flow = k => {
    const f = E.st.f;
    if (k==='Y1') return f.Y - f.Tn; if (k==='Y2') return f.Y - f.Tn - f.Ret; if (k==='Y3') return f.Y - f.Tn - f.Ret - f.MP;
    if (k==='CI') return f.Cd + f.Ib; if (k==='CIG') return f.Cd + f.Ib + f.G; if (k==='CIGL') return f.Cd + f.Ib + f.G + f.L;
    return f[k] || 0;
  };
  E.drawBoard = (ctx) => {
    const s = E.st, f = s.f;
    // RBA
    const ruleCol = p.rule ? C.amber : C.red;
    ctx.fillStyle = C.obsidian; ctx.fillRect(405,48,135,52); ctx.strokeStyle = ruleCol; ctx.lineWidth = 1.5; ctx.strokeRect(405.5,48.5,134,51);
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.font=`700 9px ${FONT}`; ctx.fillStyle=ruleCol; ctx.fillText('RESERVE BANK', 411, 53);
    ctx.font=`800 17px ${FONT}`; ctx.fillStyle=C.text; ctx.fillText(`${s.i.toFixed(2)}%`, 411, 65);
    ctx.font=`500 8px ${FONT}`; ctx.fillStyle=C.muted; ctx.fillText(p.rule ? 'cash rate · rule' : 'cash rate · manual', 411, 86);
    // Government
    const bondNet = (f.Bond ?? Math.max(0, f.Def)) - (f.Repay ?? 0);
    drawBox(ctx, 20, 95, 120, 70, 'GOVERNMENT', [
      {t:`${f.Def >= 0 ? 'deficit' : 'surplus'} ${Math.abs(f.Def).toFixed(1)}/q`, c: f.Def > 0 ? C.amber : C.phosphor},
      {t:`bonds ${bondNet >= 0 ? 'sold' : 'bought back'} ${Math.abs(bondNet).toFixed(1)}/q`, c:C.muted},
      {t:`interest ${f.Bint.toFixed(1)}/q`, c:C.muted},
      {t:`account ${s.GA.toFixed(1)}`, c: s.GA > 0.05 ? C.phosphor : C.muted}], C.text);
    // Banks
    drawBox(ctx, 60, 185, 110, 55, 'BANKS', [
      {t:`mortgage ${f.mort.toFixed(2)}%`, c:C.text},
      {t:`repaid ${f.R.toFixed(1)}/q ✕`, c:C.muted},
      {t:`lent   ${f.L.toFixed(1)}/q`, c:C.amber}], C.amber);
    drawTank(ctx, tanks.SV, s.SV, {t:`bond yield ${f.rb.toFixed(2)}%`});
    drawTank(ctx, tanks.FB, s.FB, {t:`AUD ${f.aud.toFixed(3)} US`});
    drawTank(ctx, tanks.TB, s.TB, {t:`GDP A$${f.gdpBn.toFixed(0)}bn/q`, c:C.muted});
    if (f.throttle) for (const n of ['SV','FB','TB']) drawThrottle(ctx, tanks[n], f.throttle[n]);
    // Underlying-inflation thermometer with the 2–3% target band; headline CPI printed beneath
    drawGauge(ctx, 512, 250, 140, clamp(s.pi/8, 0, 1), 'TRIM %', s.pi.toFixed(2), [2/8, 3/8]);
    ctx.font=`500 9px ${FONT}`; ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.textAlign='left';
    ctx.fillText(`CPI ${f.cpi.toFixed(1)}`, 510, 416);
    // debt ledgers (liabilities, not money)
    ctx.font=`700 8px ${FONT}`; ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.textAlign='left';
    ctx.fillText('LEDGERS · debts are records, not water', 14, 606);
    drawLedger(ctx, 14, 622, 150, 'HOUSEHOLD DEBT', f.hhDebt, 160);
    drawLedger(ctx, 14, 656, 150, 'PUBLIC DEBT', f.pubDebt, 160, f.rbaBonds);
    ctx.font=`500 8px ${FONT}`; ctx.fillStyle=C.amber; ctx.fillText(`hatched: held by RBA ${f.rbaBonds.toFixed(1)}%`, 14, 686);
    drawProdLag(ctx, 410, 703, p.Tprod, f.backlog);
    drawPump(ctx, 515, 725, E.pump);
    ctx.font=`700 10px ${FONT}`; ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.textAlign='left';
    ctx.fillText('AUSTRALIA · OCTOBER 2026 CALIBRATION', 14, 745);
  };
  E.pumpRate = () => 0.5 + E.st.f.Y/25;
  E.readouts = [
    ['gdpBn','GDP A$bn/q',v=>v.toFixed(0),()=>'hot'],['gap','Output gap',v=>sgn(v)+v.toFixed(1)+'%',v=> v<-2?'bad':v>2?'warm':''],
    ['cash','Cash rate',v=>v.toFixed(2)+'%',()=>'warm'],['pi','Underlying',v=>v.toFixed(2)+'%',v=> v>3||v<2?(v>4||v<1?'bad':'warm'):'hot'],
    ['cpi','Headline CPI',v=>v.toFixed(2)+'%'],
    ['pie','Expectations',v=>v.toFixed(2)+'%'],['u','Unemploy.',v=>v.toFixed(2)+'%',v=> v>6?'bad':v>5?'warm':''],
    ['aud','AUD/USD',v=>v.toFixed(3)],['mort','Mortgage rate',v=>v.toFixed(2)+'%'],
    ['hhDebt','H/hold debt',v=>v.toFixed(0)+'% GDP'],['pubDebt','Public debt',v=>v.toFixed(1)+'% GDP'],
    ['rbaBonds','RBA bonds',v=>v.toFixed(1)+'% GDP'],['nx','Net exports',v=>sgn(v)+v.toFixed(1)+'% GDP'],
    ['Def','Deficit',v=>v.toFixed(1)+'% GDP'],
    ['rreal','Real cash rate',v=>sgn(v)+v.toFixed(2)+'%',v=> v>1.5?'warm':'']
  ];
  E.value = k => E.st.f[k];
  E.groups = [
    {name:'Reserve Bank', sliders:[
      {id:'target', label:'Inflation target (midpoint)', min:1, max:4, step:.25, fmt:v=>v.toFixed(2)+'%'},
      {id:'phiPi', label:'Response to inflation φπ', min:0, max:2, step:.1, fmt:v=>v.toFixed(1)},
      {id:'phiY', label:'Response to output gap φy', min:0, max:1.5, step:.1, fmt:v=>v.toFixed(1)},
      {id:'iManual', label:'Cash rate when on manual', min:.1, max:9.85, step:.25, fmt:v=>v.toFixed(2)+'%'},
      {id:'qe', label:'QE (+) / QT (−) bond buying', min:-4, max:10, step:.5, fmt:v=>(v>0?'+':'')+v.toFixed(1)+' /q'}],
      toggles:[{id:'rule', label:'Inflation-targeting rule (off = manual cash rate)'},{id:'qeAuto', label:'Automatic QE at the lower bound'}]},
    {name:'Government', sliders:[
      {id:'G', label:'Government spending (% of GDP)', min:18, max:40, step:.5, fmt:v=>v.toFixed(1)+'%'},
      {id:'tax', label:'Net tax rate (taxes less transfers)', min:.18, max:.38, step:.001, fmt:v=>(v*100).toFixed(1)+'%'}]},
    {name:'Households and banks', sliders:[
      {id:'s', label:'Household saving ratio', min:0, max:.2, step:.005, fmt:v=>(v*100).toFixed(1)+'%'},
      {id:'conf', label:'Consumer confidence shift', min:-10, max:5, step:.5, fmt:v=>(v>0?'+':'')+v.toFixed(1)+' /q'},
      {id:'credit', label:'Credit appetite and lending standards', min:.3, max:2, step:.05, fmt:v=>v.toFixed(2)+'×'},
      {id:'spread', label:'Mortgage spread over cash', min:1, max:4, step:.1, fmt:v=>v.toFixed(1)+' pp'}]},
    {name:'Rest of the world', sliders:[
      {id:'cp', label:'Commodity export prices (iron ore, coal, LNG)', min:.5, max:1.6, step:.05, fmt:v=>v.toFixed(2)+'×'},
      {id:'iw', label:'US interest rate', min:0, max:8, step:.25, fmt:v=>v.toFixed(2)+'%'},
      {id:'oil', label:'Oil price index', min:.5, max:2.5, step:.05, fmt:v=>v.toFixed(2)+'×'}]},
    {name:'Machine and lags', sliders:[
      {id:'Tprod', label:'Production lag τp (spending → output)', min:0, max:4, step:.25, fmt:v=>v===0?'none':v.toFixed(2)+' q'},
      {id:'acc', label:'Investment accelerator', min:0, max:3, step:.05, fmt:v=>v.toFixed(2)},
      {id:'speed', label:'Pump speed (sim time)', min:.25, max:4, step:.25, fmt:v=>v.toFixed(2)+'×'}]}
  ];
  const fresh = (fn) => () => { E.resetParams(); E.init(); fn(); };
  E.scenarios = [
    ['Baseline outlook', fresh(()=>{}), '<b>Starting point: October 2026.</b> Cash rate 4.60%, trimmed-mean inflation 3.6%, unemployment 4.6%. Under this rule, inflation drifts back toward the top of the 2–3% band and the RBA trims to about 3.6% within a year, then settles between about 3.85% and 4.1%. Unemployment peaks near 5%. Markets and the banks currently lean toward a hold or further hikes, so treat this as the model\'s path, not a forecast.'],
    ['Oil shock', fresh(()=>{ p.oil = 1.6; }), '<b>Oil prices up 60% over about six months.</b> Fuel lifts headline CPI to a peak of about 4.6% while underlying (trimmed-mean) inflation keeps easing. The RBA\'s rule targets underlying inflation, so it looks through the spike, as central banks generally do with supply shocks, and does not hike. The dearer import bill still drains spending, and unemployment rises to about 5.5%. Watch the dashed headline line part company with the solid underlying line on the recorder.'],
    ['Iron ore slump', fresh(()=>{ p.cp = .7; }), '<b>Commodity export prices fall 30%.</b> Export income drops and unemployment jumps above 8%. The AUD slides toward the low 0.50s, which is the shock absorber: it makes exports competitive again and lifts import prices, so the RBA cuts to about 1.35% and then has to hike again as the recovery overshoots.'],
    ['Housing credit boom', fresh(()=>{ p.credit = 1.4; }), '<b>Lending standards loosen: credit appetite up 40%.</b> New loans create new deposits, so spending and inflation hold up and the RBA keeps the cash rate between 4.1% and 4.85% instead of easing. The lasting result is on the ledger: household debt climbs from about 100% to over 110% of GDP, which makes the economy more sensitive to every future rate rise.'],
    ['Deep recession and QE', fresh(()=>{ p.conf = -8; }), '<b>Households cut spending sharply and save the difference.</b> Unemployment heads toward 9–10%. The RBA cuts 25bp at every meeting to the 0.1% floor. With the cash rate stuck there, automatic QE starts buying bonds: watch the QE pipe open and the hatched RBA share of public debt rise to about 27% of GDP, as in 2020–21.'],
    ['US rates +2 points', fresh(()=>{ p.iw = 5.75; }), '<b>The Fed raises US rates by two points.</b> Capital flows out toward higher US yields, the AUD falls to about 0.65, and imported inflation keeps inflation above target for longer. The RBA still trims to 3.85% in the first year, but then has to climb back to 4.6–4.85% instead of settling near 3.9%.'],
    ['Fiscal stimulus', fresh(()=>{ p.G = 30.5; }), '<b>Government spending up 2% of GDP.</b> Unemployment falls below 4% and inflation stays near 3.3%, so the RBA leans against it with a hike to about 5.35%. The deficit widens and public debt rises from 34% toward 49% of GDP over ten years: the RBA and Treasury pulling in opposite directions.'],
    ['RBA freezes rates', fresh(()=>{ p.rule = false; p.iManual = 4.6; }), '<b>The RBA stops following its rule and holds 4.60% for a decade.</b> As inflation and expectations fall, the real rate keeps rising, so the squeeze tightens on its own. Unemployment drifts above 7% and inflation slides below zero. A rate that looks unchanged is not a neutral policy.']
  ];
  E.startCaption = E.scenarios[0][2];
  E.resetCaption = E.scenarios[0][2];
  E.resetParams = () => { Object.keys(p).forEach(k => delete p[k]); Object.assign(p, DEFAULTS); };
  E.reset = () => { E.resetParams(); E.init(); };
  E.recorder = {
    left:{min:90, max:110, ticks:[90,95,100,105,110], col:C.phosphor, fmt:v=>String(v)},
    right:{min:0, max:8, ticks:[0,2,4,6,8], col:C.amber, fmt:v=>v+'%'},
    series:[{key:'u', col:C.teal, w:1.2, axis:'right'},{key:'cpi', col:C.red, w:1, axis:'right', dash:[4,3]},{key:'pi', col:C.red, w:1.8, axis:'right'},{key:'i', col:C.amber, w:2, axis:'right', step:true},{key:'Y', col:C.phosphor, w:2, axis:'left'}],
    band:{axis:'right', lo:2, hi:3, label:'RBA target 2–3%'},
    refs:() => [{axis:'left', v:100, col:'rgba(75,224,138,0.45)', label:'potential GDP'}],
    markers:(tStart) => E.st.log.filter(l => l[0] >= tStart && l[1] !== 0).map(l => ({t:l[0], v:l[2], up:l[1] > 0}))
  };
  E.recLegend = '<span><i style="background:var(--phosphor)"></i>GDP (100 = potential)</span><span><i style="background:var(--amber)"></i>Cash rate (▲▼ RBA moves)</span><span><i style="background:var(--red)"></i>Underlying inflation (dashed: headline CPI)</span><span><i style="background:var(--teal)"></i>Unemployment</span>';
  E.pcTitle = 'Phillips curve, then and now'; E.pcTag = 'expectations-augmented';
  E.pcLegend = '<span><i style="background:var(--amber)"></i>Short-run curve at today\'s expectations (shifts as they move)</span><span><i style="background:var(--muted)"></i>Phillips 1958 (ghost)</span><span><i style="background:var(--phosphor)"></i>Australia in the model (underlying inflation)</span>';
  E.drawCurve = (ctx, xT, yT, T, B, R, L) => {
    const s = E.st;
    ctx.fillStyle='rgba(75,224,138,0.10)'; ctx.fillRect(L, yT(3), R-L, yT(2)-yT(3));
    ctx.fillStyle='rgba(75,224,138,0.7)'; ctx.font=`500 9px ${FONT}`; ctx.textBaseline='bottom'; ctx.textAlign='right'; ctx.fillText('target 2–3%', R-4, yT(3)-2); ctx.textAlign='left';
    ctx.strokeStyle='rgba(125,139,149,0.35)'; ctx.lineWidth=1.5; ctx.beginPath(); let first=true;
    for (let u=0.75; u<=12; u+=0.05){ const w=-0.9+9.638*Math.pow(u,-1.394); const y=yT(w); if (y<T) continue; first ? ctx.moveTo(xT(u),y) : ctx.lineTo(xT(u),y); first=false; }
    ctx.stroke();
    const nx = xT(K.nairu); ctx.strokeStyle='rgba(200,211,218,0.45)'; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(nx,T); ctx.lineTo(nx,B); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=C.muted; ctx.textBaseline='top'; ctx.fillText('NAIRU ≈4.5%', nx+4, T+4);
    ctx.beginPath(); first = true;
    for (let u=0.5; u<=12; u+=0.1){ const pi = s.pie - 2*K.kappa*(u - K.nairu); const y = yT(pi); if (y < T || y > B) { first = true; continue; } first ? ctx.moveTo(xT(u),y) : ctx.lineTo(xT(u),y); first=false; }
    ctx.strokeStyle=C.amber; ctx.lineWidth=2; ctx.stroke();
    return {ykey:'pi', ylab:'underlying inflation π →', cur:{u:s.f.u, y:s.pi, lab:`u ${s.f.u.toFixed(1)}%  π ${s.pi.toFixed(1)}%`}};
  };
  E.side = 'rba';
  return E;
})();

// Expose engines for the headless test-suite (Node) without affecting the browser build.
globalThis.MONIAC_ENGINES = { CLASSIC, MODERN, solveFlows };
