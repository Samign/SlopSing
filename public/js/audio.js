/* Microphone, pitch detection (YIN), tones and the live readout */
/* ---------- audio + pitch detection ---------- */
let ac, an, buf, mic = false, cur = null, hist = [], NOW = 0;
function ensureAC() { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume() }

async function startMic() {
  if (mic) return true;
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    ensureAC(); an = ac.createAnalyser(); an.fftSize = 4096; ac.createMediaStreamSource(st).connect(an);
    buf = new Float32Array(an.fftSize); mic = true; $("#bMic").textContent = "Microphone on"; $("#bMic").disabled = true;
    $("#hz").textContent = "Listening… sing or play a note."; return true;
  } catch (e) {
    setMsg("Microphone access is blocked. Allow it in your browser’s site settings (or open this page in its own tab), then try again."); return false;
  }
}

function yin(x, sr) {
  let r = 0; for (let i = 0; i < x.length; i++)r += x[i] * x[i];
  if (Math.sqrt(r / x.length) < 0.012) return 0;
  const N = x.length >> 1, mx = Math.min(N - 1, sr / 70 | 0), mn = sr / 1100 | 0, d = new Float32Array(mx + 2), c = new Float32Array(mx + 2);
  for (let t = 1; t <= mx + 1; t++) { let s = 0; for (let i = 0; i < N; i++) { const v = x[i] - x[i + t]; s += v * v } d[t] = s }
  c[0] = 1; let run = 0; for (let t = 1; t <= mx + 1; t++) { run += d[t]; c[t] = d[t] * t / run }
  for (let t = mn; t < mx; t++) {
    if (c[t] < .15) {
      while (t + 1 < mx && c[t + 1] < c[t]) t++;
      const a = c[t - 1], b = c[t], e = c[t + 1], den = a + e - 2 * b; return sr / (t + (den ? (a - e) / (2 * den) : 0))
    }
  }
  return 0;
}

function sample(T) {
  if (!mic) return;
  an.getFloatTimeDomainData(buf); const f = yin(buf, ac.sampleRate);
  if (f) { hist.push(f); if (hist.length > 3) hist.shift(); const fm = med(hist); cur = { t: T, m: 69 + 12 * Math.log2(fm / 440), f: fm } }
  else { cur = null; hist = [] }
}

function tone(m, d, g = .2, type = "triangle") {
  ensureAC(); const o = ac.createOscillator(), n = ac.createGain(), t = ac.currentTime;
  o.type = type; o.frequency.value = m2f(m);
  n.gain.setValueAtTime(0, t); n.gain.linearRampToValueAtTime(g, t + .04);
  n.gain.setValueAtTime(g, t + Math.max(.05, d - .12)); n.gain.linearRampToValueAtTime(0, t + d);
  o.connect(n).connect(ac.destination); o.start(t); o.stop(t + d + .05);
}

/* ---------- readout ---------- */
let lastNote = "";
function readout() {
  const n = $("#note");
  if (cur) {
    const cents = (cur.m - Math.round(cur.m)) * 100, t = nm(cur.m);
    if (t !== lastNote) { n.textContent = t; lastNote = t }
    n.classList.remove("off");
    $("#hz").textContent = `${cur.f.toFixed(1)} Hz · ${cents >= 0 ? "+" : ""}${cents.toFixed(0)} cents`;
    $("#ndl").style.left = (50 + Math.max(-50, Math.min(50, cents))) + "%";
  } else if (mic) { n.classList.add("off") }
}
