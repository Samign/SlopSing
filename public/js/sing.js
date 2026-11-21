/* Singing trainer: range calibration, levels, scoring and canvas game */
/* ---------- sing: levels ---------- */
const LV = [["Hold your note", "Match and hold your comfort note."], ["Little steps", "Move a tone up and down."], ["Major scale", "Climb and descend a major scale."], ["Leaps", "Jump by thirds and fifths."], ["Minor scale", "Climb and descend a minor scale."], ["Arpeggios", "Sing the notes of a chord up to the octave and back."], ["Quick notes", "Shorter notes, so you have to find the pitch fast."], ["Wide intervals", "Jump by fourths, fifths and sixths."], ["Folk melody", "A full melody with repeated notes and steps."], ["Range stretch", "Reach just past your edges to grow your range."]];
const LVD = [[[0, 0, 0], 2.6], [[0, 2, 0, -2, 0, 1, 0], 1.7], [[0, 2, 4, 5, 7, 5, 4, 2, 0], 1.3], [[0, 4, 7, 4, 0, -3, 0, 5, 0], 1.3], [[0, 2, 3, 5, 7, 5, 3, 2, 0], 1.2], [[0, 4, 7, 12, 7, 4, 0], 1.2], [[0, 2, 4, 2, 0, 4, 2, 5, 4, 0], .8], [[0, 5, 0, 7, 0, 9, 0, 12, 0], 1], [[0, 0, 7, 7, 9, 9, 7, 5, 5, 4, 4, 2, 2, 0], .9], null];
const STEPS = [
  { k: "c", need: 1.5, t: "Step 1 of 3: Sing a relaxed “ahh” on a note that feels easy. Hold it steady." },
  { k: "lo", need: 1.2, t: "Step 2 of 3: Glide down and hold the lowest note you can sing without strain." },
  { k: "hi", need: 1.2, t: "Step 3 of 3: Glide up and hold your highest comfortable note. No shouting." }];
let mode = "idle", cal = {}, ci = 0, hold = [], hp = 0, tg = [], vr = [48, 72], t0 = 0, score = 0, streak = 0, trail = [], ctr = S.c || 60, lvNow = 1, lastAct = null;

function opts() {
  const s = $("#lvl"), v = +s.value || S.lvl;
  s.innerHTML = LV.map((x, i) => `<option value="${i + 1}" ${i + 1 > S.lvl ? "disabled" : ""}>${i + 1 > S.lvl ? "Locked: " : ""}${i + 1}. ${x[0]}</option>`).join("");
  s.value = Math.min(v, S.lvl); $("#bGo").textContent = "Start level " + s.value;
}
function stats() {
  $("#sC").textContent = S.c ? nm(S.c) : "–";
  $("#sR").textContent = S.lo ? `${nm(S.lo)}–${nm(S.hi)} (${S.hi - S.lo} st)` : "–";
  $("#sL").textContent = S.lvl; $("#sS").textContent = Math.round(score);
}
async function startCal() {
  if (!(await startMic())) return;
  cal = {}; ci = 0; hold = []; trail = []; mode = "cal"; setMsg(STEPS[0].t);
}
function calTick(T) {
  const st = STEPS[ci], L = hold[hold.length - 1];
  if (cur) { if (L && (Math.abs(cur.m - L.m) > .7 || T - L.t > .3)) hold = []; hold.push({ t: T, m: cur.m }) }
  else if (L && T - L.t > .3) hold = [];
  const d = hold.length > 1 ? T - hold[0].t : 0; hp = Math.min(1, d / st.need);
  if (d >= st.need) {
    const m = Math.round(med(hold.map(h => h.m))); hold = [];
    const ok = st.k === "c" || (st.k === "lo" ? m < cal.c - 1 : m > cal.c + 1);
    if (!ok) { setMsg(`That’s too close to your first note (${nm(cal.c)}). Go a little ${st.k === "lo" ? "lower" : "higher"} and hold it.`); return }
    cal[st.k] = m; ci++;
    if (ci >= STEPS.length) {
      S.c = cal.c; S.lo = Math.max(30, cal.lo); S.hi = Math.min(88, cal.hi); S.lvl = S.lvl || 1; save();
      mode = "idle"; hp = 0; opts(); stats();
      setMsg(`Nice! Comfort note ${nm(S.c)}, range ${nm(S.lo)}–${nm(S.hi)}. Now press Start to train.`);
    } else setMsg(`Got ${nm(m)}. ${STEPS[ci].t}`);
  }
}
async function startLevel() {
  if (!(await startMic())) return;
  if (!S.c) { startCal(); return }
  const l = +$("#lvl").value, { c, lo, hi } = S; let seq, dur;
  const cl = x => Math.max(lo, Math.min(hi, c + x));
  const d = LVD[l - 1]; if (d) { seq = d[0].map(cl); dur = d[1] } else { seq = [c, hi, hi + 1, hi + 2, hi + 1, c, lo, lo - 1, lo - 2, lo - 1, c]; dur = 1.8 }
  tol = l < 5 ? .5 : l < 8 ? .4 : .35;
  clock = null; lvNow = l; t0 = NOW + 3; let s = t0; tg = [];
  for (const m of seq) { tg.push({ m, s, e: s + dur, hit: 0, str: m > hi || m < lo }); s += dur + .35 }
  vr = [Math.min(lo, ...seq) - 2, Math.max(hi, ...seq) + 2]; while (vr[1] - vr[0] < 14) { vr[0]--; vr[1]++ }
  score = 0; streak = 0; trail = []; lastAct = null; mode = "play";
  setMsg(`Level ${l}: ${LV[l - 1][1]} Stay within ${Math.round(tol * 100)} cents of each block.`);
}
let tol = .5, clock = null, dsm = null, dT = -9;
/* Pitch of the target note nearest to time T (the note being sung, or the closest one in a gap). */
function nearNote(T) {
  let b = null, bd = 1e9;
  for (const t of tg) { const d = T < t.s ? t.s - T : T > t.e ? T - t.e : 0; if (d < bd) { bd = d; b = t.m } if (t.s > T + bd) break }
  return b;
}
/* Pitch drawn on screen: folded onto the nearest target's octave (octave-forgiving) and smoothed, so the line
   is continuous and never jumps between a block and the gaps around it. */
function dispPitch(m, ref, T) {
  let v = m;
  if (ref != null) v += 12 * Math.round((ref - v) / 12);
  else if (dsm != null && T - dT < .4 && Math.abs(v - dsm) > 8) v += 12 * Math.round((dsm - v) / 12);
  if (dsm != null && T - dT < .15 && Math.abs(v - dsm) > 8) v += 12 * Math.round((dsm - v) / 12);
  dsm = (dsm == null || T - dT > .25) ? v : dsm + (v - dsm) * .35; dT = T;
  return dsm;
}
const dev = (m, tm) => { let d = m - tm; if ($("#oct").checked) d -= 12 * Math.round(d / 12); return d };
function playTick(T, dt) {
  const a = tg.find(t => T >= t.s && T < t.e);
  if (a !== lastAct) { lastAct = a; if (a && $("#gd").checked) tone(a.m, a.e - a.s, .12) }
  const b = cur ? tg.filter(t => T >= t.s - .12 && T < t.e + .12 && Math.abs(dev(cur.m, t.m)) <= tol).sort((x, y) => Math.abs(dev(cur.m, x.m)) - Math.abs(dev(cur.m, y.m)))[0] : null;
  if (b) { b.hit = Math.min(b.hit + dt, b.e - b.s); streak += dt; score += dt * 10 * Math.min(4, 1 + Math.floor(streak)) }
  else streak = 0;
  hp = Math.max(0, Math.min(1, (T - t0) / (tg[tg.length - 1].e - t0)));
  if (T > tg[tg.length - 1].e + .4) finishLevel();
}
function finishLevel() {
  if (!lvNow) { finishKaraoke(); return }
  const l = lvNow, acc = tg.reduce((a, t) => a + t.hit / (t.e - t.s), 0) / tg.length, pass = acc >= .6;
  const oldLo = S.lo, oldHi = S.hi;
  if (l === LV.length) for (const t of tg) if (t.str && t.hit / (t.e - t.s) >= .6) { S.hi = Math.min(88, Math.max(S.hi, t.m)); S.lo = Math.max(30, Math.min(S.lo, t.m)) }
  const stars = acc >= .9 ? 3 : acc >= .75 ? 2 : acc >= .6 ? 1 : 0;
  S.best[l] = Math.max(S.best[l] || 0, Math.round(acc * 100));
  if (pass) S.lvl = Math.max(S.lvl, Math.min(LV.length, l + 1));
  save(); mode = "idle"; hp = 0; opts(); if (pass) $("#lvl").value = Math.min(S.lvl, LV.length); $("#bGo").textContent = "Start level " + $("#lvl").value; stats();
  const grew = S.lo < oldLo || S.hi > oldHi ? ` Your range grew to ${nm(S.lo)}–${nm(S.hi)}!` : "";
  setMsg(`Level ${l}: ${Math.round(acc * 100)}% ${"★".repeat(stars)}${pass ? " Passed!" : " You need 60% to pass. Try again."}${grew}`);
}

/* ---------- sing: drawing ---------- */
const cv = $("#cv"), g = cv.getContext("2d"); let dpr = 1;
function resize() { dpr = window.devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr }
addEventListener("resize", resize);
function drawSing(T) {
  const W = cv.clientWidth, H = cv.clientHeight, css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = v("--cv"); g.fillRect(0, 0, W, H);
  let lo, hi;
  if (mode === "play") { lo = vr[0]; hi = vr[1] } else { if (cur) ctr += (cur.m - ctr) * .04; lo = ctr - 8; hi = ctr + 8 }
  const sp = H / (hi - lo), y = m => H - (m - lo + .5) * sp, ph = W * .25, pps = 110, X = t => ph + (t - T) * pps;
  g.font = "12px Inter,system-ui"; g.textBaseline = "middle";
  for (let k = Math.ceil(lo - .5); k <= Math.floor(hi + .5); k++) {
    const nat = ![1, 3, 6, 8, 10].includes(((k % 12) + 12) % 12);
    if (!nat) { g.fillStyle = v("--lane"); g.fillRect(0, y(k) - sp / 2, W, sp) }
    if (nat) { g.fillStyle = v("--mut"); g.globalAlpha = .8; g.fillText(nm(k), 6, y(k)); g.globalAlpha = 1 }
  }
  const R = mode === "cal" ? cal : S;
  if (mode !== "play" && R.lo && R.hi) { g.fillStyle = v("--acc"); g.globalAlpha = .1; g.fillRect(0, y(R.hi + .5) - sp / 2 + sp / 2, W, y(R.lo - .5) - y(R.hi + .5)); g.globalAlpha = 1 }
  if (mode !== "play") { g.setLineDash([6, 5]); g.strokeStyle = v("--acc"); for (const k of [R.c, R.lo, R.hi]) { if (!k) continue; g.beginPath(); g.moveTo(0, y(k)); g.lineTo(W, y(k)); g.stroke() } g.setLineDash([]) }
  if (mode === "play") {
    for (const t of tg) {
      const x = X(t.s), w = (t.e - t.s) * pps; if (x > W || x + w < 0) continue;
      const frac = Math.min(1, t.hit / (t.e - t.s)), act = t === lastAct;
      g.fillStyle = v("--blk"); g.fillRect(x, y(t.m) - sp / 2 + 2, w, sp - 4);
      g.fillStyle = v("--ok"); g.fillRect(x, y(t.m) - sp / 2 + 2, w * frac, sp - 4);
      g.lineWidth = act ? 3 : 1.5; g.strokeStyle = t.str ? v("--bad") : v("--acc"); g.strokeRect(x, y(t.m) - sp / 2 + 2, w, sp - 4);
      g.fillStyle = v("--ink"); g.font = "600 13px Inter,system-ui"; g.fillText((t.txt ? t.txt.replace(/-$/, "") : nm(t.m)) + (t.str ? " stretch" : ""), x + 8, y(t.m));
    }
    if (T < t0) { g.fillStyle = v("--ink"); g.font = "700 46px Inter,system-ui"; g.textAlign = "center"; g.fillText(Math.ceil(t0 - T), W * .6, H / 2); g.textAlign = "left" }
  }
  g.strokeStyle = v("--line"); g.lineWidth = 2; g.beginPath(); g.moveTo(ph, 0); g.lineTo(ph, H); g.stroke();
  const fm = cur ? dispPitch(cur.m, mode === "play" && $("#oct").checked ? nearNote(T) : null, T) : 0; if (cur) trail.push({ t: T, m: fm }); while (trail.length && T - trail[0].t > ph / pps + .2) trail.shift();
  g.strokeStyle = v("--acc"); g.lineWidth = 4; g.lineJoin = "round"; g.beginPath();
  trail.forEach((p, i) => { const px = X(p.t), py = y(p.m); if (!i || p.t - trail[i - 1].t > .25) g.moveTo(px, py); else g.lineTo(px, py) }); g.stroke();
  if (cur) {
    const on = lastAct && Math.abs(dev(cur.m, lastAct.m)) <= tol && mode === "play";
    g.fillStyle = on ? v("--ok") : v("--acc"); g.beginPath(); g.arc(ph, y(fm), on ? 10 : 8, 0, 7); g.fill();
  }
}