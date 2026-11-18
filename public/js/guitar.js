/* Guitar tuner and note challenge */
/* ---------- guitar ---------- */
const ST=[["E",40,"6th string, low E"],["A",45,"5th string, A"],["D",50,"4th string, D"],["G",55,"3rd string, G"],["B",59,"2nd string, B"],["E",64,"1st string, high E"]];
const chips=ST.map((s,i)=>{const b=document.createElement("button");b.className="chip";b.innerHTML=`<b>${s[0]}</b><small>${6-i}</small>`;b.onclick=()=>tone(s[1],1.6,.25,"sawtooth");$("#chips").append(b);return b});
let gq=null,gh=0,gs=0;
function newG(){
  const i=Math.floor(Math.random()*6),f=Math.floor(Math.random()*6);gq={m:ST[i][1]+f};gh=0;
  $("#gq").textContent=f?`Play fret ${f} on the ${ST[i][2]} (${nm(gq.m)})`:`Play the open ${ST[i][2]} (${nm(gq.m)})`;
}
function gtrTick(T){
  let near=-1,cents=0;
  if(cur){let b=1e9;ST.forEach((s,i)=>{const d=Math.abs(cur.m-s[1]);if(d<b){b=d;near=i}});cents=(cur.m-ST[near][1])*100;if(b>2.5)near=-1}
  chips.forEach((el,i)=>{el.classList.toggle("on",i===near);el.classList.toggle("ok",i===near&&Math.abs(cents)<8)});
  $("#gt").textContent=near<0?"Tuner: pluck a string":Math.abs(cents)<8?`${ST[near][0]} string is in tune ✓`:cents>0?`${ST[near][0]} string is sharp: tune down`:`${ST[near][0]} string is flat: tune up`;
  if(gq&&cur&&Math.abs(cur.m-gq.m)<.35){if(!gh)gh=T;if(T-gh>=.6){gs++;$("#gs").textContent="Streak: "+gs;newG()}}else gh=0;
  $("#gp").style.width=(gh?Math.min(100,(T-gh)/.6*100):0)+"%";
}
