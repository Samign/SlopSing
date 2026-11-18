/* Shared helpers, saved progress and message line */
const $=s=>document.querySelector(s);
const NN=["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const nm=m=>{m=Math.round(m);return NN[((m%12)+12)%12]+(Math.floor(m/12)-1)};
const m2f=m=>440*2**((m-69)/12);
const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
let S={c:null,lo:null,hi:null,lvl:1,best:{}};
try{Object.assign(S,JSON.parse(localStorage.getItem("vq1")||"{}"))}catch(e){}
const save=()=>{try{localStorage.setItem("vq1",JSON.stringify(S))}catch(e){}};
const setMsg=t=>{$("#msg").textContent=t};
