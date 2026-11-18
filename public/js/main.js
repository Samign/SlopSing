/* Main animation loop, tabs and event wiring */
/* ---------- main loop + wiring ---------- */
let tab="sing",last=0;
function frame(ts){
  requestAnimationFrame(frame);
  const T=ts/1000,dt=Math.min(.1,T-last);last=T;NOW=T;sample(T);readout();
  if(tab==="sing"){
    if(mode==="cal")calTick(T);else if(mode==="play")playTick(T,dt);
    $("#hp").style.width=(hp*100)+"%";drawSing(T);if(mode==="play")$("#sS").textContent=Math.round(score);
  }else gtrTick(T);
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  tab=b.dataset.t;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x===b));
  $("#sing").hidden=tab!=="sing";$("#gtr").hidden=tab!=="gtr";if(tab==="gtr"){mode="idle";if(!gq)newG()}else resize();
});
$("#bMic").onclick=startMic;$("#bCal").onclick=startCal;$("#bGo").onclick=startLevel;
$("#bStop").onclick=()=>{mode="idle";hp=0;setMsg("Stopped. Pick a level or find your range again.")};
$("#bHear").onclick=()=>S.c?tone(S.c,1.5):setMsg("Find your range first, then you can hear your comfort note.");
$("#lvl").onchange=()=>{$("#bGo").textContent="Start level "+$("#lvl").value};
$("#gHear").onclick=()=>gq&&tone(gq.m,1.4,.25,"sawtooth");$("#gSkip").onclick=()=>{gs=0;$("#gs").textContent="Streak: 0";newG()};
opts();stats();resize();
setMsg(S.c?`Welcome back! Your range is ${nm(S.lo)}–${nm(S.hi)}. Pick a level and press Start.`:"Welcome! First we’ll find your comfortable note and range. Press “Find my range” and allow the microphone.");
requestAnimationFrame(frame);
