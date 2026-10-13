// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// Shared palette, state and canvas drawing helpers for the Phillips Machine boards.
'use strict';

const C = {
  obsidian:'#0b0f14', panel:'#11161d', border:'#1e2831', teal:'#2fd6c3', phosphor:'#4be08a',
  amber:'#ffb454', red:'#ff6b6b', text:'#c8d3da', muted:'#7d8b95', deep:'#080b0f', pipe:'#18212b'
};
const FONT = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const LW = 580, LH = 760;
const sgn = v => (v >= 0 ? '+' : '') ;
let running = true;

/* ================= shared drawing helpers ================= */
function sizeCanvas(cv, lw, lh){
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  const w = cv.clientWidth, h = w * lh / lw;
  if (cv.width !== Math.round(w*dpr)) { cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr); }
  return (w*dpr)/lw;
}
function path(ctx, pts){ ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); }
function drawGrid(ctx){
  ctx.fillStyle = C.deep; ctx.fillRect(0,0,LW,LH);
  ctx.strokeStyle = 'rgba(30,40,49,0.7)'; ctx.lineWidth = 1;
  for (let x=0;x<=LW;x+=20){ ctx.beginPath(); ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,LH); ctx.stroke(); }
  for (let y=0;y<=LH;y+=20){ ctx.beginPath(); ctx.moveTo(0,y+.5); ctx.lineTo(LW,y+.5); ctx.stroke(); }
}
function drawPipe(ctx, pp, q, ph){
  const aq = Math.abs(q);
  ctx.lineJoin='miter'; ctx.lineCap='butt';
  path(ctx, pp.pts); ctx.strokeStyle = C.border; ctx.lineWidth = 13; ctx.stroke();
  path(ctx, pp.pts); ctx.strokeStyle = C.pipe; ctx.lineWidth = 9; ctx.stroke();
  if (aq > 0.05){
    const wv = 1.5 + 7*Math.min(1, Math.sqrt(aq/110));
    const col = pp.credit ? C.amber : C.teal, glow = pp.credit ? 'rgba(255,180,84,0.25)' : 'rgba(47,214,195,0.25)';
    path(ctx, pp.pts); ctx.strokeStyle = glow; ctx.lineWidth = wv; ctx.stroke();
    ctx.setLineDash([7,9]); ctx.lineDashOffset = -ph * (pp.signed && q<0 ? -1 : 1);
    path(ctx, pp.pts); ctx.strokeStyle = col; ctx.lineWidth = wv; ctx.stroke();
    ctx.setLineDash([]);
  }
  if (pp.lab){
    ctx.save(); ctx.translate(pp.lp[0], pp.lp[1]);
    if (pp.rot) ctx.rotate(-Math.PI/2);
    ctx.font = `700 9px ${FONT}`; ctx.fillStyle = C.muted; ctx.textBaseline='bottom'; ctx.textAlign='left';
    ctx.fillText(pp.lab, 0, 0);
    ctx.font = `700 10px ${FONT}`; ctx.fillStyle = aq>0.05 ? C.text : C.muted;
    ctx.fillText((pp.signed && q>0?'+':'') + q.toFixed(1), ctx.measureText(pp.lab).width*0.9+8, 0);
    ctx.restore();
  }
}
function drawTank(ctx, t, val, sub){
  const lvl = clamp(val/t.cap, 0, 1), over = val > t.cap;
  ctx.fillStyle = C.obsidian; ctx.fillRect(t.x, t.y, t.w, t.h);
  const wh = t.h*lvl;
  if (wh > 0){
    const g = ctx.createLinearGradient(0, t.y+t.h-wh, 0, t.y+t.h);
    g.addColorStop(0,'rgba(47,214,195,0.55)'); g.addColorStop(1,'rgba(47,214,195,0.18)');
    ctx.fillStyle = g; ctx.fillRect(t.x+1, t.y+t.h-wh, t.w-2, wh);
    ctx.fillStyle = C.teal; ctx.fillRect(t.x+1, t.y+t.h-wh, t.w-2, 1.5);
  }
  ctx.strokeStyle = 'rgba(200,211,218,0.18)'; ctx.lineWidth = 1;
  for (let i=1;i<5;i++){ const yy = t.y + t.h*i/5; ctx.beginPath(); ctx.moveTo(t.x+t.w-8, yy); ctx.lineTo(t.x+t.w, yy); ctx.stroke(); }
  ctx.strokeStyle = over ? C.red : (val < 0.5 ? C.amber : C.text); ctx.lineWidth = 1.5;
  ctx.strokeRect(t.x+.5, t.y+.5, t.w-1, t.h-1);
  ctx.font = `700 9px ${FONT}`; ctx.fillStyle = C.text; ctx.textBaseline='top'; ctx.textAlign='left';
  ctx.fillText(t.name, t.x+5, t.y+5);
  ctx.font = `800 15px ${FONT}`; ctx.fillStyle = over ? C.red : C.text;
  ctx.fillText(t.fmt ? t.fmt(val) : val.toFixed(1), t.x+5, t.y+18);
  if (sub){ ctx.font = `500 9px ${FONT}`; ctx.fillStyle = sub.c || C.amber; ctx.fillText(sub.t, t.x+5, t.y+37); }
  if (over){ ctx.font=`700 9px ${FONT}`; ctx.fillStyle=C.red; ctx.fillText('OVERFLOW', t.x+5, t.y+t.h-14); }
  else if (val < 0.5){ ctx.font=`700 9px ${FONT}`; ctx.fillStyle=C.amber; ctx.fillText('DRY', t.x+5, t.y+t.h-14); }
}
function drawBox(ctx, x, y, w, h, title, lines, accent){
  ctx.fillStyle = C.obsidian; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = accent || C.muted; ctx.lineWidth = 1.5; ctx.strokeRect(x+.5,y+.5,w-1,h-1);
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.font = `700 9px ${FONT}`; ctx.fillStyle = accent || C.muted; ctx.fillText(title, x+6, y+5);
  lines.forEach((ln, i) => {
    ctx.font = `${ln.big ? '800 14px' : '500 9px'} ${FONT}`; ctx.fillStyle = ln.c || C.text;
    ctx.fillText(ln.t, x+6, y + 18 + (ln.big ? 0 : 0) + i*12 + (i>0 && lines[0].big ? 5 : 0));
  });
}
function drawValve(ctx, x, y, label, val){
  ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI/4);
  ctx.fillStyle = C.amber; ctx.fillRect(-6,-6,12,12);
  ctx.fillStyle = C.obsidian; ctx.fillRect(-2.5,-2.5,5,5);
  ctx.restore();
  ctx.font = `700 9px ${FONT}`; ctx.fillStyle = C.amber; ctx.textBaseline='middle'; ctx.textAlign='left';
  ctx.fillText(`${label}=${(val*100).toFixed(0)}%`, x-56, y-12);
}
function drawGauge(ctx, x, y, h, frac, label, value, band){
  ctx.fillStyle = C.obsidian; ctx.fillRect(x, y, 15, h);
  if (band){ ctx.fillStyle = 'rgba(75,224,138,0.25)'; const y1 = y + h*(1-band[1]), y0 = y + h*(1-band[0]); ctx.fillRect(x+1, y1, 13, y0-y1); }
  ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(x+.5, y+.5, 14, h);
  for (let i=0;i<=6;i++){ const yy = y + h*i/6; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x+5, yy); ctx.strokeStyle=C.muted; ctx.stroke(); }
  const py = y + h*(1-clamp(frac,0,1));
  ctx.fillStyle = C.amber; ctx.beginPath(); ctx.moveTo(x+14,py); ctx.lineTo(x+22,py-5); ctx.lineTo(x+22,py+5); ctx.closePath(); ctx.fill();
  ctx.fillRect(x+1, py-1, 13, 2);
  ctx.font = `700 9px ${FONT}`; ctx.fillStyle = C.amber; ctx.textBaseline='top'; ctx.textAlign='left';
  ctx.fillText(label, x-2, y+h+4); ctx.fillStyle = C.text; ctx.fillText(value, x-2, y+h+15);
}
function drawPump(ctx, x, y, angle){
  ctx.fillStyle = C.panel; ctx.strokeStyle = running ? C.teal : C.muted; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x,y,16,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.save(); ctx.translate(x,y); ctx.rotate(angle);
  ctx.strokeStyle = running ? C.teal : C.muted; ctx.lineWidth = 2.5;
  for (let i=0;i<4;i++){ ctx.rotate(Math.PI/2); ctx.beginPath(); ctx.moveTo(0,0); ctx.quadraticCurveTo(6,-4,11,-2); ctx.stroke(); }
  ctx.restore();
  ctx.font = `700 9px ${FONT}`; ctx.fillStyle = C.muted; ctx.textBaseline='top'; ctx.textAlign='left'; ctx.fillText('PUMP', x-12, y+20);
}
function drawProdLag(ctx, x, y, Tprod, backlog){
  const w=74, h=44;
  ctx.fillStyle = C.obsidian; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = Tprod > 0.01 ? C.amber : C.border; ctx.lineWidth = 1.5; ctx.strokeRect(x+.5,y+.5,w-1,h-1);
  ctx.font=`700 8px ${FONT}`; ctx.fillStyle = Tprod > 0.01 ? C.amber : C.muted; ctx.textBaseline='top'; ctx.textAlign='left';
  ctx.fillText('PRODUCTION', x+5, y+4); ctx.fillText(`LAG τ ${Tprod.toFixed(2)}q`, x+5, y+14);
  const mid = x + w/2, bw = clamp(backlog/30, -1, 1) * (w/2 - 5);
  ctx.fillStyle = C.border; ctx.fillRect(x+5, y+31, w-10, 7);
  ctx.fillStyle = backlog >= 0 ? C.amber : C.teal;
  ctx.fillRect(Math.min(mid, mid+bw), y+31, Math.abs(bw), 7);
  ctx.fillStyle = C.text; ctx.fillRect(mid-0.5, y+29, 1, 11);
}
function drawLedger(ctx, x, y, w, label, pct, maxPct, rbaPct){
  ctx.font = `700 9px ${FONT}`; ctx.fillStyle = C.text; ctx.textBaseline='top'; ctx.textAlign='left';
  ctx.fillText(label, x, y);
  ctx.fillStyle = C.amber; ctx.textAlign='right'; ctx.fillText(`${pct.toFixed(0)}% of GDP`, x+w, y); ctx.textAlign='left';
  const by = y + 13, bh = 12, fw = (w) * clamp(pct/maxPct, 0, 1);
  ctx.fillStyle = C.obsidian; ctx.fillRect(x, by, w, bh);
  ctx.fillStyle = 'rgba(255,107,107,0.35)'; ctx.fillRect(x, by, fw, bh);
  if (rbaPct){
    const rw = w * clamp(rbaPct/maxPct, 0, 1);
    ctx.save(); ctx.beginPath(); ctx.rect(x, by, rw, bh); ctx.clip();
    ctx.strokeStyle = C.amber; ctx.lineWidth = 1;
    for (let k=-bh; k<rw; k+=5){ ctx.beginPath(); ctx.moveTo(x+k, by+bh); ctx.lineTo(x+k+bh, by); ctx.stroke(); }
    ctx.restore();
  }
  ctx.strokeStyle = C.red; ctx.lineWidth = 1; ctx.strokeRect(x+.5, by+.5, w-1, bh-1);
}
// When the solver throttles a tank, say so on the tank: the pipes are showing executed flows, not wishes.
function drawThrottle(ctx, t, k){
  if (!(k < 0.995)) return;
  ctx.font = `700 9px ${FONT}`; ctx.fillStyle = C.red; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillText(`RUNNING DRY · ${Math.round(k*100)}% PAID OUT`, t.x+5, t.y+t.h-27);
}
function bridge(ctx, x, y){ ctx.fillStyle = C.deep; ctx.fillRect(x-3, y-8, 6, 16); }
