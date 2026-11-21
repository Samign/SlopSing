/* Vocal isolation, melody extraction, MIDI-to-vocal alignment and lyric gating */
const fold = d => ((d % 12) + 18) % 12 - 6;
const medv = a => [...a].sort((x, y) => x - y)[a.length >> 1];
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1)j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]];[im[i], im[j]] = [im[j], im[i]] } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2, tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}
function biquad(x, type, fc, fs) {
  const w = 2 * Math.PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 * .7071), hp = type === "hp";
  const b0 = hp ? (1 + c) / 2 : (1 - c) / 2, b1 = hp ? -(1 + c) : 1 - c, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = (b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y }
}
const tick = () => new Promise(r => setTimeout(r));
/* 1) stereo centre mask (magnitude AND phase similarity), 2) harmonic/percussive masking to remove drums,
   3) band-pass. stem=true skips 1-2 for files that are already vocals only. */
async function isolateVocals(chs, fs, prog, stem) {
  const n = chs[0].length, out = new Float32Array(n), R = chs[1] || chs[0], N = 1024;
  if (stem || n < N * 4) { for (let i = 0; i < n; i++)out[i] = (chs[0][i] + R[i]) / 2 }
  else {
    const Hp = 512, B = N / 2 + 1, F = Math.floor((n - N) / Hp) + 1, pg = (a, b) => prog && prog(a + b);
    const w = new Float32Array(N).map((_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / N));
    const lr = new Float32Array(N), li = new Float32Array(N), rr = new Float32Array(N), ri = new Float32Array(N);
    const Xr = new Float32Array(F * B), Xi = new Float32Array(F * B), A = new Float32Array(F * B);
    for (let f = 0; f < F; f++) {
      const s = f * Hp;
      for (let i = 0; i < N; i++) { lr[i] = chs[0][s + i] * w[i]; rr[i] = R[s + i] * w[i]; li[i] = 0; ri[i] = 0 }
      fft(lr, li, false); fft(rr, ri, false);
      for (let k = 0; k < B; k++) {
        const a = Math.hypot(lr[k], li[k]), b = Math.hypot(rr[k], ri[k]), sm = Math.hypot(lr[k] + rr[k], li[k] + ri[k]);
        const mm = Math.min(a, b) / (Math.max(a, b) + 1e-9), cc = sm / (a + b + 1e-9), g = mm * mm * cc * cc, o = f * B + k;
        Xr[o] = (lr[k] + rr[k]) / 2 * g; Xi[o] = (li[k] + ri[k]) / 2 * g; A[o] = Math.hypot(Xr[o], Xi[o]);
      }
      if (f % 200 === 0) { pg(0, f / F * .5); await tick() }
    }
    const Hm = new Float32Array(F * B), Pm = new Float32Array(F * B), t9 = new Float32Array(9), cl = (v, m) => v < 0 ? 0 : v > m ? m : v;
    for (let b = 0; b < B; b++) {
      for (let f = 0; f < F; f++) { for (let k = 0; k < 9; k++)t9[k] = A[cl(f + k - 4, F - 1) * B + b]; t9.sort(); Hm[f * B + b] = t9[4] }
      if (b % 64 === 0) { pg(.5, b / B * .2); await tick() }
    }
    for (let f = 0; f < F; f++) {
      for (let b = 0; b < B; b++) { for (let k = 0; k < 9; k++)t9[k] = A[f * B + cl(b + k - 4, B - 1)]; t9.sort(); Pm[f * B + b] = t9[4] }
      if (f % 200 === 0) { pg(.7, f / F * .25); await tick() }
    }
    for (let f = 0; f < F; f++) {
      for (let k = 0; k < B; k++) { const o = f * B + k, h = Hm[o] * Hm[o], p = Pm[o] * Pm[o], m = h / (h + p + 1e-12); lr[k] = Xr[o] * m; li[k] = Xi[o] * m }
      for (let k = 1; k < N / 2; k++) { lr[N - k] = lr[k]; li[N - k] = -li[k] }
      fft(lr, li, true); const s = f * Hp; for (let i = 0; i < N; i++)out[s + i] += lr[i];
    }
  }
  for (let k = 0; k < 3; k++)biquad(out, "hp", 160, fs);
  for (let k = 0; k < 2; k++)biquad(out, "lp", 3000, fs);
  let r = 0; for (let i = 0; i < n; i++)r += out[i] * out[i];
  const g = .1 / (Math.sqrt(r / n) || 1); for (let i = 0; i < n; i++)out[i] *= g;
  return out;
}
async function extractFrames(x, fs, prog) {
  const W = Math.round(fs * .096), H = Math.round(fs * .05), f = [];
  for (let i = 0; i + W < x.length; i += H) {
    const fr = yin(x.subarray(i, i + W), fs); f.push(fr ? Math.round(69 + 12 * Math.log2(fr / 440)) : null);
    if (f.length % 100 === 0) { if (prog) prog(i / x.length); await tick() }
  }
  return { f, hs: H / fs, t0: W / fs / 2 };
}
/* Fixes octave jumps and stray blips relative to the local median, smooths, and bridges tiny gaps. */
function cleanFrames(f) {
  const n = f.length, o = f.slice(), W = 15;
  for (let i = 0; i < n; i++) {
    if (f[i] == null) continue;
    const w = []; for (let k = Math.max(0, i - W); k <= Math.min(n - 1, i + W); k++)if (k !== i && f[k] != null) w.push(f[k]);
    if (w.length < 2) { o[i] = null; continue }
    const m = medv(w); let v = f[i];
    if (Math.abs(v - m) > 6) { v += 12 * Math.round((m - v) / 12); if (Math.abs(v - m) > 4) v = null }
    o[i] = v;
  }
  const s = o.slice();
  for (let i = 0; i < n; i++) {
    if (o[i] == null) continue;
    const w = []; for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++)if (o[k] != null) w.push(o[k]);
    if (w.length >= 3) s[i] = medv(w);
  }
  for (let i = 1; i < n - 1; i++) {
    if (s[i] != null) continue;
    let j = i; while (j < n && s[j] == null) j++;
    if (j - i <= 3 && j < n && s[i - 1] != null && Math.abs(s[i - 1] - s[j]) <= 1) for (let k = i; k < j; k++)s[k] = s[i - 1];
    i = j;
  }
  return s;
}
/* A note continues through vibrato; it only splits after a change of a semitone or more that lasts 3 frames. */
function framesToNotes(fr) {
  const { hs, t0 } = fr, f = cleanFrames(fr.f), ns = [];
  let cur = null, dev = [], gap = 0;
  const close = () => {
    if (cur && cur.v.length >= 3) ns.push({ s: cur.i * hs + t0, e: (cur.last + 1) * hs + t0, m: Math.round(medv(cur.v)), txt: "", ln: 0 });
    cur = null; dev = []; gap = 0;
  };
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (v == null) { if (cur && ++gap > 2) close(); continue }
    gap = 0;
    if (!cur) { cur = { i, last: i, v: [v] }; continue }
    if (Math.abs(v - medv(cur.v)) >= 1) {
      dev.push(i);
      if (dev.length >= 3) { const st = dev[0], vs = dev.map(k => f[k]); cur.last = st - 1; close(); cur = { i: st, last: i, v: vs }; dev = [] }
    } else { cur.v.push(v); cur.last = i; dev = [] }
  }
  close();
  return ns;
}
async function framesFromBlob(blob, prog, stem) {
  const c = new AudioContext({ sampleRate: 16000 }), b = await c.decodeAudioData(await blob.arrayBuffer()); c.close();
  const chs = [0, 1].slice(0, b.numberOfChannels).map(i => b.getChannelData(i));
  const x = await isolateVocals(chs, 16000, p => prog && prog("Isolating vocals", p), stem);
  return extractFrames(x, 16000, p => prog && prog("Detecting melody", p));
}
/* Fits a (usually quantised) MIDI melody to the real vocal: finds the global time offset and key, follows
   timing drift note by note, and snaps each target pitch to what the singer actually does. */
function alignMidi(ns, fr) {
  const { f, hs, t0 } = fr, fi = t => Math.round((t - t0) / hs);
  if (!ns.length || f.length < 20) return ns;
  const ratio = (n, d, tau) => {
    const a = fi(n.s + d), b = Math.max(a + 1, fi(n.e + d)); let sc = 0, c = 0;
    for (let i = Math.max(0, a); i < b && i < f.length; i++) { c++; if (f[i] != null) sc += Math.abs(fold(f[i] - n.m - tau)) <= 1 ? 1 : -.2 }
    return c ? sc / c : 0;
  };
  const tot = ns.reduce((a, n) => a + n.e - n.s, 0); let best = -1e9, bd = 0, bt = 0, b0 = -1e9, bd0 = 0;
  for (let tau = -6; tau <= 6; tau++)for (let d = -6; d <= 6.001; d += .1) {
    let s = 0; for (const n of ns) s += ratio(n, d, tau) * (n.e - n.s);
    s /= tot; if (tau === 0 && s > b0) { b0 = s; bd0 = d }
    s -= Math.abs(tau) * .005; if (s > best) { best = s; bd = d; bt = tau }
  }
  if (best < .15) return ns;
  if (bt !== 0 && best < b0 + .08) { bt = 0; bd = bd0 }
  const S = 25, mid = 12, st = .05, K = 4, bp = []; let prev = new Float32Array(S);
  ns.forEach((n, k) => {
    const cur = new Float32Array(S), ptr = new Int8Array(S);
    for (let si = 0; si < S; si++) {
      const sc = ratio(n, bd + (si - mid) * st, bt);
      if (!k) { cur[si] = sc; continue }
      let b = -1e9, bi = si;
      for (let q = Math.max(0, si - K); q <= Math.min(S - 1, si + K); q++) { const v = prev[q] - .04 * Math.abs(q - si); if (v > b) { b = v; bi = q } }
      cur[si] = b + sc; ptr[si] = bi;
    }
    bp.push(ptr); prev = cur;
  });
  let si = 0; prev.forEach((v, i) => { if (v > prev[si]) si = i });
  const sh = new Array(ns.length);
  for (let k = ns.length - 1; k >= 0; k--) { sh[k] = bd + (si - mid) * st; si = bp[k][si] }
  let pe = -1;
  const out = ns.map((n, k) => {
    const s = Math.max(n.s + sh[k], pe - .02), e = Math.max(n.e + sh[k], s + .1), vs = [];
    for (let i = Math.max(0, fi(s)); i < fi(e) && i < f.length; i++)if (f[i] != null && Math.abs(fold(f[i] - n.m - bt)) <= 1.5) vs.push(f[i]);
    let m = n.m + bt; if (vs.length >= 3) m += fold(medv(vs) - m);
    pe = e; return { s, e, m: Math.round(m), txt: "", ln: 0 };
  });
  out.forEach((n, i) => { if (out[i + 1] && n.e > out[i + 1].s - .02) n.e = Math.max(n.s + .08, out[i + 1].s - .02) });
  return out;
}
/* Drops notes that fall outside the times when lyrics are being sung (intros, solos, outros). */
function gateByLyrics(ns, lrc, off) {
  const L = (lrc || []).filter(l => l.text); if (L.length < 2) return ns;
  const iv = L.map((l, k) => {
    const a = l.t + off, nx = L[k + 1] ? L[k + 1].t + off : 1e9;
    const est = l.et != null ? l.et + off : a + Math.max(4, 1.5 + .2 * l.text.length);
    return [a - .5, Math.min(nx - .05, est + 2.5)];
  });
  const out = ns.filter(n => iv.some(v => n.s >= v[0] && n.s <= v[1]));
  return out.length >= ns.length * .3 ? out : ns;
}
/* Lines with the same lyrics are sung to the same melody. Aligns the notes of every repeat of a line, fills notes
   that one repeat is missing, drops notes only one repeat has, and makes the pitches agree. */
function unifyRepeats(ns, lrc, off) {
  const L = (lrc || []).filter(l => l.text);
  if (L.length < 4 || ns.length < 8) return ns;
  const groups = {};
  L.forEach((l, k) => { const q = l.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); if (q.length >= 8) (groups[q] = groups[q] || []).push(k) });
  let out = ns.slice().sort((a, b) => a.s - b.s);
  const align = (T, I) => {
    const nT = T.length, nI = I.length, G = 2, D = [], P = [];
    for (let i = 0; i <= nT; i++) { D.push(new Float32Array(nI + 1)); P.push(new Int8Array(nI + 1)) }
    for (let i = 1; i <= nT; i++) { D[i][0] = i * G; P[i][0] = 1 }
    for (let j = 1; j <= nI; j++) { D[0][j] = j * G; P[0][j] = 2 }
    for (let i = 1; i <= nT; i++)for (let j = 1; j <= nI; j++) {
      const dp = Math.abs(fold(I[j - 1].m - T[i - 1].m)), dt = Math.abs(I[j - 1].r - T[i - 1].r);
      let best = D[i - 1][j] + G, mv = 1;
      if (D[i][j - 1] + G < best) { best = D[i][j - 1] + G; mv = 2 }
      if (dp <= 2.5 && dt <= .8) { const c = D[i - 1][j - 1] + dp + 1.5 * dt; if (c < best) { best = c; mv = 0 } }
      D[i][j] = best; P[i][j] = mv;
    }
    const pairs = []; let i = nT, j = nI;
    while (i > 0 || j > 0) {
      const mv = P[i][j];
      if (i > 0 && j > 0 && mv === 0) { pairs.push([i - 1, j - 1]); i--; j-- } else if (i > 0 && (j === 0 || mv === 1)) i--; else j--;
    }
    return pairs.reverse();
  };
  for (const q in groups) {
    const ks = groups[q]; if (ks.length < 2) continue;
    const inst = ks.map(k => {
      const l = L[k], a = l.t + off, nx = L[k + 1] ? L[k + 1].t + off : a + 12, b = Math.min(nx - .25, l.et != null ? l.et + off + .3 : a + 12);
      return { a, b, notes: out.filter(n => n.s >= a - .25 && n.s < b).map(n => ({ s: n.s, e: n.e, m: n.m, r: n.s - a })) };
    });
    const cnt = inst.map(x => x.notes.length).filter(c => c > 0).sort((x, y) => x - y);
    if (!cnt.length) continue;
    const ref = inst.find(x => x.notes.length === cnt[cnt.length >> 1]);
    const T = ref.notes.map(n => ({ r: n.r, m: n.m, d: n.e - n.s }));
    for (const x of inst) {
      if (x === ref || !x.notes.length) continue;
      const hit = new Set(align(T, x.notes).map(p => p[1]));
      x.notes.forEach((n, j) => {
        if (hit.has(j)) return;
        const nd = n.e - n.s;
        if (T.some(t => n.r < t.r + t.d && n.r + nd > t.r)) return; // split/ornament, not a missing note
        T.push({ r: n.r, m: n.m, d: nd });
      });
      T.sort((p, r) => p.r - r.r);
    }
    const votes = T.map(() => []);
    const maps = inst.map(x => {
      const mp = new Map();
      if (x.notes.length) align(T, x.notes).forEach(([i, j]) => { mp.set(i, j); votes[i].push(x.notes[j].m + 12 * Math.round((T[i].m - x.notes[j].m) / 12)) });
      return mp;
    });
    const need = ks.length >= 3 ? 2 : 1, keep = T.map((t, i) => votes[i].length >= need), cons = T.map((t, i) => votes[i].length ? Math.round(medv(votes[i])) : t.m);
    const res = inst.map((x, xi) => {
      const mp = maps[xi], r = []; let dl = 0;
      T.forEach((t, i) => {
        if (!keep[i]) return;
        if (mp.has(i)) { const n = x.notes[mp.get(i)]; dl = n.s - (x.a + t.r); r.push({ s: n.s, e: n.e, m: cons[i], txt: "", ln: 0 }) }
        else { const s = x.a + t.r + dl; r.push({ s, e: s + t.d, m: cons[i], txt: "", ln: 0 }) }
      });
      r.sort((p, q2) => p.s - q2.s);
      r.forEach((n, k) => { if (r[k + 1] && n.e > r[k + 1].s - .02) n.e = Math.max(n.s + .05, r[k + 1].s - .02) });
      return r.filter(n => n.s < x.b);
    });
    inst.forEach((x, xi) => { out = out.filter(n => !(n.s >= x.a - .25 && n.s < x.b)).concat(res[xi]) });
    out.sort((p, r) => p.s - r.s);
  }
  return out;
}