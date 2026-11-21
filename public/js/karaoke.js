/* Karaoke: sing along with the songs in your music/ folder */
let own = { au: null, notes: null, lrc: null, title: "", key: "", busy: false }, LIB = {};
let kOff = 0, fr = { on: 0, tot: 0 }, kAu = null, kTitle = "", kLrc = null, lyrKey = "", kc = -9;
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const setInfo = t => { $("#kinfo").textContent = t };
const status = () => setInfo(`${own.lrc ? "Lyrics found" : "No lyrics found"} · ${own.notes && own.notes.length ? own.notes.length + " melody notes" : "no melody (freestyle scoring)"}. Ready.`);
function parseLrc(t) {
  const o = [];
  t.split(/\r?\n/).forEach(l => {
    const body = l.replace(/\[[^\]]*\]/g, ""), tx = body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const aw = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g)].map(x => ({ t: +x[1] * 60 + +x[2], w: x[3] })), ws = aw.filter(x => x.w.trim());
    const et = aw.length && !aw[aw.length - 1].w.trim() ? aw[aw.length - 1].t : null;
    const st = [...l.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    st.forEach(x => o.push({ t: +x[1] * 60 + +x[2], text: tx, words: st.length === 1 && ws.length ? ws : null, et: st.length === 1 ? et : null }));
  });
  return o.sort((a, b) => a.t - b.t);
}
function parseMidi(ab) {
  const d = new DataView(ab); let p = 0;
  const str = n => { let s = ""; for (let i = 0; i < n; i++)s += String.fromCharCode(d.getUint8(p++)); return s };
  if (str(4) !== "MThd") throw new Error("Not a MIDI file");
  p += 4; const nt = d.getUint16(p + 2), div = d.getUint16(p + 4); p += 6;
  const tm = [[0, 500000]], trk = [];
  const vl = () => { let v = 0, b; do { b = d.getUint8(p++); v = v * 128 + (b & 127) } while (b & 128); return v };
  for (let k = 0; k < nt && p < d.byteLength; k++) {
    if (str(4) !== "MTrk") break;
    const end = p + d.getUint32(p) + 4; p += 4; let tk = 0, run = 0; const on = {}, ns = [];
    while (p < end) {
      tk += vl(); let st = d.getUint8(p);
      if (st < 128) st = run; else { p++; if (st < 240) run = st }
      if (st === 255) { const ty = d.getUint8(p++), l = vl(); if (ty === 81) tm.push([tk, d.getUint8(p) * 65536 + d.getUint8(p + 1) * 256 + d.getUint8(p + 2)]); p += l }
      else if (st === 240 || st === 247) p += vl();
      else {
        const c = st >> 4, a = d.getUint8(p++), b = c === 12 || c === 13 ? 0 : d.getUint8(p++);
        if ((st & 15) !== 9) { if (c === 9 && b > 0) on[a] = tk; else if (c === 8 || c === 9) { if (on[a] != null) { ns.push([on[a], tk, a]); delete on[a] } } }
      }
    }
    p = end; trk.push(ns);
  }
  tm.sort((a, b) => a[0] - b[0]);
  const sec = t => { let s = 0, lt = 0, tp = 500000; for (const [x, v] of tm) { if (x >= t) break; s += (x - lt) * tp / div / 1e6; lt = x; tp = v } return s + (t - lt) * tp / div / 1e6 };
  const best = trk.sort((a, b) => b.length - a.length)[0] || [];
  best.sort((a, b) => a[0] - b[0] || b[2] - a[2]);
  const out = []; let lastS = -1;
  for (const [a, b, m] of best) { const s = sec(a); if (s - lastS < .03) continue; lastS = s; out.push({ s, e: Math.max(sec(b), s + .1), m, txt: "", ln: 0 }) }
  out.forEach((n, i) => { if (out[i + 1] && n.e > out[i + 1].s) n.e = out[i + 1].s });
  return out;
}
function mkClock(au) {
  const ts = NOW; let on = false;
  if (au) { au.pause(); au.currentTime = 0; return T => { if (on) return au.currentTime; const c = T - ts - 3; if (c >= 0) { on = true; au.play() } return c } }
  return T => T - ts - 3;
}
function freeTick(P, dt) {
  if (P >= 0 && cur) {
    fr.tot += dt;
    if (Math.abs(cur.m - Math.round(cur.m)) <= .3) { fr.on += dt; streak += dt; score += dt * 10 * Math.min(4, 1 + Math.floor(streak)) } else streak = 0;
  } else streak = 0;
  const dur = kAu ? kAu.duration : 0;
  hp = dur ? Math.min(1, Math.max(0, P / dur)) : 0;
  if (P > 1 && (kAu && kAu.ended)) finishFree();
}
function finishFree() {
  const acc = fr.tot ? fr.on / fr.tot : 0, gr = acc >= .85 ? "S" : acc >= .75 ? "A" : acc >= .6 ? "B" : acc >= .45 ? "C" : "D", sc = Math.round(score), key = kTitle + " (freestyle)", old = S.k[key] || 0;
  if (sc > old) { S.k[key] = sc; save() }
  endKaraoke(); mode = "idle"; hp = 0;
  setMsg(`${kTitle}: freestyle grade ${gr}. ${Math.round(acc * 100)}% of your singing was in tune, ${sc} points${sc > old ? " (new best!)" : ""}.`);
}
function kTick(P) {
  const c = Math.floor(P);
  if (P < 0 && c !== kc) { kc = c; tone(96, .06, .08, "square") }
  showLyr(P);
}
function endKaraoke() {
  clock = null; if (kAu) { kAu.pause(); kAu = null }
  lyrKey = ""; lyrIdx = -2; fills = []; $("#lyr").innerHTML = "";
}
function finishKaraoke() {
  const tot = tg.reduce((a, t) => a + (t.e - t.s), 0), acc = tg.reduce((a, t) => a + t.hit, 0) / tot;
  const gr = acc >= .9 ? "S" : acc >= .8 ? "A" : acc >= .65 ? "B" : acc >= .5 ? "C" : "D", sc = Math.round(score), old = S.k[kTitle] || 0;
  if (sc > old) { S.k[kTitle] = sc; save() }
  endKaraoke(); mode = "idle"; hp = 0; $("#kB").textContent = S.k[kTitle] || "–";
  setMsg(`${kTitle}: grade ${gr}, ${Math.round(acc * 100)}% of the melody on pitch, ${sc} points${sc > old ? " (new best!)" : ""}.`);
}
function pickShift(ms) {
  if (!S.c || !$("#kfit").checked) return 0;
  const mid = 12 * Math.round((S.c - med(ms)) / 12); let best = mid, bc = 1e9;
  for (let k = -2; k <= 2; k++) {
    const sh = mid + k * 12, out = ms.filter(m => m + sh < S.lo || m + sh > S.hi).length + Math.abs(k) * .01;
    if (out < bc) { bc = out; best = sh }
  }
  return best;
}
async function startKar() {
  if (!(await startMic())) return;
  if (!own.key) return;
  if (own.busy) { setMsg("Still preparing this song. Isolating the vocals can take a little while the first time."); return }
  endKaraoke(); kOff = parseFloat($("#kOff").value) || 0;
  kTitle = own.title; kc = -9; lyrKey = ""; kAu = own.au;
  t0 = 0; score = 0; streak = 0; trail = []; lastAct = null; lvNow = 0; tol = .6; fr = { on: 0, tot: 0 };
  let ns = own.notes && own.notes.length ? gateByLyrics(own.notes, own.lrc, kOff) : null;
  if (ns && ns.length) ns = unifyRepeats(ns, own.lrc, kOff);
  if (ns && !ns.length) ns = null;
  let sh = 0;
  if (ns) {
    sh = pickShift(ns.map(n => n.m));
    tg = ns.map(n => ({ m: n.m + sh, s: n.s, e: n.e, hit: 0, str: false, txt: "", ln: 0 }));
    const ms = tg.map(t => t.m); vr = [Math.min(...ms) - 2, Math.max(...ms) + 2];
    while (vr[1] - vr[0] < 14) { vr[0]--; vr[1]++ }
  }
  kLrc = own.lrc ? own.lrc.filter(l => l.text).map(l => ({ ...l })) : null;
  if (kLrc) kLrc.forEach((l, k) => {
    const a = l.t + kOff, nx = kLrc[k + 1] ? kLrc[k + 1].t + kOff : 1e9;
    l.nt = ns ? tg.filter(n => n.s >= a - .3 && n.s < nx - .3) : [];
    l.end = l.et != null ? l.et + kOff : l.nt.length ? Math.max(...l.nt.map(n => n.e)) : a + Math.min(10, .5 + .07 * l.text.length, nx - a);
  });
  clock = mkClock(own.au); mode = ns ? "play" : "free";
  setMsg(ns ? `Singing: ${kTitle}.${sh ? ` Moved ${sh > 0 ? "up" : "down"} ${Math.abs(sh / 12)} octave(s) to fit your voice.` : ""} Sing along as the blocks reach the line.`
    : `Freestyle: ${kTitle}. No melody was found, so you are scored on how in tune you sing. Add a .mid file for note-by-note scoring.`);
}
let lyrIdx = -2, fills = [];
/* Fill progress for a whole line: follows the sung notes when known, otherwise an estimate over the line. */
function lineFill(l) {
  const a = l.t + kOff;
  if (l.nt.length) { const tot = l.nt.reduce((x, n) => x + n.e - n.s, 0) || 1; return P => l.nt.reduce((x, n) => x + Math.min(Math.max(P - n.s, 0), n.e - n.s), 0) / tot }
  return P => (P - a) / Math.max(.3, l.end - a);
}
/* Shows the line being sung plus the next two; the current line fills with colour smoothly as it is sung. */
function showLyr(P) {
  if (!kLrc || !kLrc.length) return;
  let i = -1; kLrc.forEach((l, k) => { if (l.t + kOff <= P) i = k });
  const j = Math.max(i, 0), key = i < 0 ? -1 : j;
  if (key !== lyrIdx) {
    lyrIdx = key; const L0 = kLrc[j]; fills = [];
    const cur = i >= 0, wd = cur && L0.words;
    let h = wd ? `<div class="cur">${L0.words.map(w => `<span class="f">${esc(w.w)}</span>`).join("")}</div>`
      : `<div class="${cur ? "cur" : "nxt"}">${cur ? `<span class="f">${esc(L0.text)}</span>` : esc(L0.text)}</div>`;
    h += [1, 2].map(d => kLrc[j + d] ? `<small>${esc(kLrc[j + d].text)}</small>` : "").join("");
    $("#lyr").innerHTML = h;
    const els = [...$("#lyr").querySelectorAll(".f")];
    if (wd) els.forEach((el, k) => {
      const a = L0.words[k].t + kOff, b = Math.max(a + .2, k < els.length - 1 ? L0.words[k + 1].t + kOff : L0.end);
      fills.push({ el, fn: P => (P - a) / (b - a) });
    });
    else if (cur) fills.push({ el: els[0], fn: lineFill(L0) });
  }
  for (const f of fills) f.el.style.setProperty("--p", (-5 + 110 * Math.min(1, Math.max(0, f.fn(P)))) + "%");
}
async function findLyrics(a, t) {
  try {
    const p = { track_name: t }; if (a) p.artist_name = a;
    const h = (await (await fetch("https://lrclib.net/api/search?" + new URLSearchParams(p))).json()).find(x => x.syncedLyrics);
    return h ? parseLrc(h.syncedLyrics) : null;
  } catch (e) { return null }
}
async function loadLibrary() {
  try {
    const r = await fetch("music/"); if (!r.ok) return;
    const g = {};
    for (const f of (await r.json()).filter(f => f.type === "file")) {
      const m = f.name.match(/^(.*)\.([^.]+)$/); if (!m) continue;
      const x = m[2].toLowerCase(); let k = m[1], slot = /^(mp3|m4a|aac|ogg|opus|wav|flac)$/.test(x) ? "audio" : x === "lrc" ? "lrc" : /^midi?$/.test(x) ? "mid" : null;
      if (slot === "audio" && /\.vocals$/i.test(k)) { k = k.slice(0, -7); slot = "vocals" }
      if (x === "json" && /\.notes$/i.test(k)) { k = k.slice(0, -6); slot = "notes" }
      if (slot) (g[k] = g[k] || {})[slot] = f.name;
    }
    const ks = Object.keys(g).filter(k => g[k].audio).sort();
    if (!ks.length) return;
    ks.forEach(k => { LIB["lib:" + k] = { title: k, ...g[k] } });
    $("#ksong").innerHTML = ks.map(k => `<option value="lib:${esc(k).replace(/"/g, "&quot;")}">${esc(k)}</option>`).join("");
    document.querySelector('.tab[data-t="kar"]').hidden = false;
    kSel();
  } catch (e) { }
}
async function loadLib(v) {
  const e = LIB[v]; if (!e) return;
  Object.assign(own, { key: v, title: e.title, notes: null, lrc: null, au: new Audio("music/" + encodeURIComponent(e.audio)), busy: true });
  let off = "0"; try { off = localStorage.getItem("vqo:" + e.title) || "0" } catch (x) { }
  $("#kOff").value = off; $("#kB").textContent = S.k[e.title] || "–"; setInfo("Loading…");
  const u = n => "music/" + encodeURIComponent(n), m = e.title.split(/\s[-–]\s/);
  let lrc = null, notes = null;
  try {
    lrc = e.lrc ? parseLrc(await (await fetch(u(e.lrc))).text()) : await findLyrics(m.length > 1 ? m[0].trim() : "", m.length > 1 ? m.slice(1).join(" - ").trim() : e.title);
    if (e.notes) notes = (await (await fetch(u(e.notes))).json()).notes;
    else {
      let frm = null;
      try { const c = localStorage.getItem("vqf3:" + e.title); if (c) frm = { f: c.split(",").map(x => x === "" ? null : +x), hs: .05, t0: .048 } } catch (x) { }
      if (!frm) {
        const blob = await (await fetch(u(e.vocals || e.audio))).blob();
        frm = await framesFromBlob(blob, (st, p) => { if (own.key === v) setInfo(`${st}… ${Math.round(p * 100)}%`) }, !!e.vocals);
        try { localStorage.setItem("vqf3:" + e.title, frm.f.map(x => x == null ? "" : x).join(",")) } catch (x) { }
      }
      notes = e.mid ? alignMidi(parseMidi(await (await fetch(u(e.mid))).arrayBuffer()), frm) : framesToNotes(frm);
    }
  } catch (x) { setInfo("Could not fully prepare this song. You can still sing it in freestyle mode.") }
  if (own.key === v) { own.lrc = lrc; own.notes = notes; own.busy = false; status() }
}
const kSel = () => { const v = $("#ksong").value; if (v && own.key !== v) loadLib(v) };
$("#ksong").onchange = kSel;
$("#kGo").onclick = startKar;
$("#kStop").onclick = () => { endKaraoke(); mode = "idle"; hp = 0; setMsg("Stopped.") };
$("#kOff").oninput = () => { try { localStorage.setItem("vqo:" + own.title, $("#kOff").value) } catch (e) { } };
loadLibrary();