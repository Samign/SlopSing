/* Main animation loop, tabs and event wiring */
let tab = "sing", last = 0, octSave = false;
function frame(ts) {
  requestAnimationFrame(frame);
  const T = ts / 1000, dt = Math.min(.1, T - last); last = T; NOW = T; sample(T); readout();
  if (tab === "gtr") { gtrTick(T); return }
  const P = clock ? clock(T) : T;
  if (mode === "cal") calTick(P); else if (mode === "play") { playTick(P, dt); if (clock) kTick(P) }
  else if (mode === "free") { freeTick(P, dt); if (clock) kTick(P) }
  $("#hp").style.width = (hp * 100) + "%"; drawSing(P);
  if (mode === "play" || mode === "free") { const s = Math.round(score); $("#sS").textContent = s; $("#kS").textContent = s }
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  const was = tab; tab = b.dataset.t; endKaraoke(); mode = "idle"; hp = 0;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === b));
  ["sing", "kar", "gtr"].forEach(id => $("#" + id).hidden = id !== tab);
  $("#stage").hidden = tab === "gtr";
  if (tab === "gtr") { if (!gq) newG() } else resize();
  if (tab === "kar" && was !== "kar") { octSave = $("#oct").checked; $("#oct").checked = true; setMsg("Pick a song and press Start song. Octave-forgiving is on, so you can sing in your own octave.") }
  else if (was === "kar" && tab !== "kar") $("#oct").checked = octSave;
});
$("#bMic").onclick = startMic; $("#bCal").onclick = startCal; $("#bGo").onclick = startLevel;
$("#bStop").onclick = () => { endKaraoke(); mode = "idle"; hp = 0; setMsg("Stopped. Pick a level or find your range again.") };
$("#bHear").onclick = () => S.c ? tone(S.c, 1.5) : setMsg("Find your range first, then you can hear your comfort note.");
$("#lvl").onchange = () => { $("#bGo").textContent = "Start level " + $("#lvl").value };
$("#gHear").onclick = () => gq && tone(gq.m, 1.4, .25, "sawtooth");
$("#gSkip").onclick = () => { gs = 0; $("#gs").textContent = "Streak: 0"; newG() };
opts(); stats(); resize();
setMsg(S.c ? `Welcome back! Your range is ${nm(S.lo)}–${nm(S.hi)}. Pick a level and press Start.` : "Welcome! First we’ll find your comfortable note and range. Press “Find my range” and allow the microphone.");
requestAnimationFrame(frame);