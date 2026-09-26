/**
 * GET /admin — the control console. One self-contained page: no build step,
 * no dependencies, nothing secret in it. The admin secret is typed in and
 * kept in this tab's sessionStorage only; every call sends it as a header.
 */
export const CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tailzu Control</title>
<style>
:root{--bg:#0e0f11;--panel:#16181b;--line:#26292e;--ink:#e9e7e2;--mute:#8d9096;--amber:#E8A23C;--ok:#5fb37a;--bad:#e0605a;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 var(--sans)}
header{display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
header h1{font-size:15px;letter-spacing:.08em;text-transform:uppercase;margin:0}header h1 b{color:var(--amber)}
header .meta{color:var(--mute);font-size:12px;font-family:var(--mono)}header .sp{flex:1}
main{display:grid;grid-template-columns:minmax(260px,340px) 1fr;min-height:calc(100vh - 53px)}
aside{border-right:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:10px;overflow:auto}
section{padding:16px 20px;display:flex;flex-direction:column;gap:14px;min-width:0}
button,select,input,textarea{font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:6px}
button{padding:6px 12px;cursor:pointer}button:hover{border-color:var(--mute)}button.primary{background:var(--amber);border-color:var(--amber);color:#111;font-weight:600}
button.danger{color:var(--bad)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--amber);outline-offset:1px}
input,select{padding:6px 8px}textarea{width:100%;min-height:340px;padding:10px;font:12.5px/1.5 var(--mono);resize:vertical;tab-size:2}
.rule{border:1px solid var(--line);border-radius:8px;padding:9px 10px;cursor:pointer;display:grid;gap:3px}
.rule:hover,.rule.on{border-color:var(--amber)}.rule .id{font-family:var(--mono);font-size:12.5px}
.rule .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.chip{font-size:11px;padding:1px 7px;border-radius:99px;border:1px solid var(--line);color:var(--mute)}
.chip.s{color:var(--amber);border-color:#5a4520}.chip.off{color:var(--bad)}.note{color:var(--mute);font-size:12px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line)}.tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:8px 12px;color:var(--mute)}
.tabs button.on{color:var(--ink);border-bottom-color:var(--amber)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.grid label{display:grid;gap:3px;font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:.05em}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.msg{font-size:12.5px;font-family:var(--mono);white-space:pre-wrap}.msg.bad{color:var(--bad)}.msg.ok{color:var(--ok)}
.out{border:1px solid var(--line);border-radius:8px;max-height:52vh;overflow:auto;font:12px/1.5 var(--mono)}
.out div{display:grid;grid-template-columns:minmax(200px,42%) 1fr;gap:10px;padding:2px 10px;border-bottom:1px solid #1c1e22}
.out div span:first-child{color:var(--mute);word-break:break-all}.out div span:last-child{word-break:break-all}
.out .add span:last-child{color:var(--ok)}.out .chg span:last-child{color:var(--amber)}.out .del span:last-child{color:var(--bad);text-decoration:line-through}
.out div:hover{background:#1b1d21;cursor:copy}
table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}th{color:var(--mute);font-weight:500}
.gate{max-width:380px;margin:12vh auto;display:grid;gap:10px;padding:0 16px}.gate h1{font-size:18px}.hidden{display:none!important}
@media (max-width:760px){main{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line);max-height:40vh}}
</style>
</head>
<body>
<div class="gate" id="gate">
  <h1>Tailzu <span style="color:var(--amber)">Control</span></h1>
  <p class="note">Change anything any client is sent, live. Paste the server's ADMIN_SECRET. It stays in this tab only.</p>
  <input id="secret" type="password" placeholder="ADMIN_SECRET" autocomplete="off">
  <input id="who" placeholder="Your name, for the history">
  <button class="primary" id="enter">Open console</button>
  <div class="msg bad" id="gateMsg"></div>
</div>
<div id="app" class="hidden">
<header><h1>Tailzu <b>Control</b></h1><span class="meta" id="ver"></span><span class="sp"></span>
  <button id="reload">Reload</button><button id="lock">Lock</button></header>
<main>
<aside>
  <div class="bar"><button class="primary" id="new">New rule</button>
    <select id="tpl" aria-label="Start from"><option value="flag">Change a flag</option><option value="text">Rewrite text</option>
    <option value="node">Patch a node</option><option value="screen">Replace a screen</option><option value="exp">Experiment</option><option value="blank">Blank</option></select></div>
  <div class="msg bad" id="storeErr"></div>
  <div id="rules" style="display:grid;gap:8px"></div>
</aside>
<section>
  <div class="tabs"><button data-t="edit" class="on">Rule</button><button data-t="find">Find a path</button><button data-t="hist">History</button><button data-t="help">How rules work</button></div>
  <div id="t-edit">
    <textarea id="json" spellcheck="false"></textarea>
    <div class="bar" style="margin-top:8px"><button class="primary" id="save">Save live</button><button id="test">Test on preview</button>
      <button id="dup">Duplicate</button><button class="danger" id="del">Delete</button><span class="msg" id="editMsg"></span></div>
  </div>
  <div id="ctxBox">
    <div class="grid">
      <label>Surface<select id="c-surface"><option>bootstrap</option><option>screen</option><option>keyboard</option><option>site</option></select></label>
      <label>Screen id<input id="c-screen" placeholder="home"></label>
      <label>Platform<select id="c-platform"><option>ios</option><option>android</option><option>desktop</option><option>web</option></select></label>
      <label>Keyboard build<input id="c-build" placeholder="40"></label>
      <label>App version<input id="c-appVersion" placeholder="1.0.0"></label>
      <label>Language<input id="c-locale" placeholder="en"></label>
      <label>User id<input id="c-userId" placeholder="(signed out)"></label>
      <label>Bearer token<input id="c-auth" placeholder="optional, to build as a real user"></label>
    </div>
    <div class="bar" style="margin-top:8px"><button id="run">Preview</button><input id="q" placeholder="Filter paths or values" style="flex:1;min-width:160px">
      <label class="note"><input type="checkbox" id="onlyChanged" checked> changed only</label></div>
    <div class="msg" id="applied"></div>
    <div class="out" id="out"></div>
    <p class="note">Click a line to copy its path.</p>
  </div>
  <div id="t-hist" class="hidden"><table><thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Rules</th><th></th></tr></thead><tbody id="hist"></tbody></table></div>
  <div id="t-help" class="hidden note" style="max-width:74ch;color:var(--ink)">
    <p>A rule edits a payload after the code builds it, for whoever it targets. Remove the rule and the code's version comes back.</p>
    <p><b>surface</b>: bootstrap, screen, keyboard, site, or * for all. <b>when</b>: screens, platform, formFactor, build {min,max}, appVersion {min,max}, bundle, locale, signedIn, users, exceptUsers, percent [lo,hi] of users (0–99), from and until (ISO dates). Leave a field out to match everyone.</p>
    <p><b>ops</b>, in order. By path, a JSON Pointer such as /flags/kb.touch.vSlop: set, merge, remove, insert (into an array; "-" appends). By selector, a partial object matched anywhere in the tree, such as {"type":"LetterKey","props":{"char":"q"}}: patch (deep-merge), replace, drop, before, after, append, prepend (into children). Text: {"op":"text","find":"Old words","value":"New words"} rewrites every matching string.</p>
    <p><b>variants</b> make an experiment: each user gets one, stable by user id, weighted. The arm shows up in flags["control.variants"].</p>
    <p>Saving bumps the cache version, so apps refetch screens on next launch. The keyboard picks it up on its next config fetch. Every save is a version you can roll back to.</p>
  </div>
</section>
</main>
</div>
<script>
const $=s=>document.querySelector(s);const S=sessionStorage;let DOC=null,SEL=null,LAST=null;
const TPL={
 flag:{id:"kb-vslop",surface:"keyboard",note:"Taller vertical reach",when:{platform:["ios"]},ops:[{op:"set",path:"/flags/kb.touch.vSlop",value:14}]},
 text:{id:"copy-fix",surface:"*",note:"Rewrite a phrase everywhere",ops:[{op:"text",find:"Old words",value:"New words"}]},
 node:{id:"node-patch",surface:"screen",when:{screens:["home"]},ops:[{op:"patch",select:{type:"Text",props:{content:"Old"}},value:{props:{content:"New"}}}]},
 screen:{id:"screen-swap",surface:"screen",when:{screens:["home"]},ops:[{op:"set",path:"/root",value:{type:"Stack",children:[{type:"Text",props:{content:"Hello"}}]}}]},
 exp:{id:"exp-cta",surface:"screen",note:"Two arms, half each",when:{screens:["paywall"],signedIn:true},variants:[{name:"a",weight:1,ops:[]},{name:"b",weight:1,ops:[{op:"text",find:"Continue",value:"Start now"}]}]},
 blank:{id:"new-rule",surface:"bootstrap",when:{},ops:[]}};
async function api(method,url,body){const r=await fetch(url,{method,headers:{"content-type":"application/json","x-admin-secret":S.getItem("sec")||"","x-admin-name":S.getItem("who")||"admin"},body:body===undefined?undefined:JSON.stringify(body)});
 const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}if(!r.ok)throw Object.assign(new Error(j.message||j.code||("HTTP "+r.status)),{data:j});return j}
function msg(el,t,cls){el.textContent=t;el.className="msg "+(cls||"")}
async function load(){DOC=await api("GET","/v1/admin/control");$("#ver").textContent="v"+DOC.version+" · "+DOC.rules.length+" rules · "+new Date(DOC.updatedAt).toLocaleString();
 msg($("#storeErr"),DOC.lastError||"","bad");renderRules();if(SEL){const r=DOC.rules.find(x=>x.id===SEL);if(r)$("#json").value=JSON.stringify(r,null,2)}}
function summary(r){const w=r.when||{},p=[];for(const k of Object.keys(w)){const v=w[k];p.push(k+":"+(Array.isArray(v)?v.join(","):typeof v==="object"?JSON.stringify(v):v))}
 return (p.join(" · ")||"everyone")+" · "+((r.ops||[]).length)+" ops"+(r.variants?" · "+r.variants.length+" variants":"")}
function renderRules(){const box=$("#rules");box.innerHTML="";
 if(!DOC.rules.length){box.innerHTML='<p class="note">No rules. Everything goes out as the code builds it.</p>';return}
 for(const r of [...DOC.rules].sort((a,b)=>(a.order||0)-(b.order||0)||a.id.localeCompare(b.id))){const d=document.createElement("div");d.className="rule"+(r.id===SEL?" on":"");
  d.innerHTML='<div class="row"><span class="id"></span><span class="chip s"></span>'+(r.enabled===false?'<span class="chip off">off</span>':'')+'</div><div class="note"></div>';
  d.querySelector(".id").textContent=r.id;d.querySelector(".chip").textContent=r.surface;d.querySelector(".note").textContent=(r.note?r.note+" — ":"")+summary(r);
  d.onclick=()=>{SEL=r.id;$("#json").value=JSON.stringify(r,null,2);msg($("#editMsg"),"");renderRules();tab("edit")};box.appendChild(d)}}
function rule(){try{return JSON.parse($("#json").value)}catch(e){throw new Error("Not valid JSON: "+e.message)}}
$("#new").onclick=()=>{const t=structuredClone(TPL[$("#tpl").value]);SEL=null;$("#json").value=JSON.stringify(t,null,2);renderRules();tab("edit");msg($("#editMsg"),"Not saved yet.")};
$("#save").onclick=async()=>{try{const r=rule();const j=await api("PUT","/v1/admin/control/rules/"+encodeURIComponent(r.id),r);SEL=r.id;await load();msg($("#editMsg"),"Live as v"+j.version+".","ok")}
 catch(e){msg($("#editMsg"),e.data&&e.data.issues?e.data.issues.map(i=>i.path.join(".")+": "+i.message).join("\n"):e.message,"bad")}};
$("#del").onclick=async()=>{const r=rule();if(!confirm("Delete rule "+r.id+"? Clients go back to the code's version."))return;try{await api("DELETE","/v1/admin/control/rules/"+encodeURIComponent(r.id));SEL=null;$("#json").value="";await load();msg($("#editMsg"),"Deleted.","ok")}catch(e){msg($("#editMsg"),e.message,"bad")}};
$("#dup").onclick=()=>{try{const r=rule();r.id=r.id+"-copy";r.enabled=false;SEL=null;$("#json").value=JSON.stringify(r,null,2);msg($("#editMsg"),"Copy, disabled, not saved.")}catch(e){msg($("#editMsg"),e.message,"bad")}};
function ctx(){const c={};for(const k of ["platform","appVersion","locale","userId"]){const v=$("#c-"+k).value.trim();if(v)c[k]=v}
 const b=$("#c-build").value.trim();if(b)c.build=Number(b);if(c.userId)c.signedIn=true;if(c.platform==="desktop")c.formFactor="desktop";return c}
async function preview(draft){const body={surface:$("#c-surface").value,screen:$("#c-screen").value.trim()||undefined,ctx:ctx()};
 const a=$("#c-auth").value.trim();if(a)body.authorization=a.startsWith("Bearer ")?a:"Bearer "+a;if(draft)body.draft=draft;
 msg($("#applied"),"Building…");try{LAST=await api("POST","/v1/admin/control/preview",body);
  const ap=LAST.applied||[];msg($("#applied"),(LAST.draftError?"Draft refused: "+LAST.draftError+"\n":"")+"HTTP "+LAST.status+" · "+(ap.length?ap.map(x=>x.rule+(x.variant?"["+x.variant+"]":"")+" op"+x.op+": "+(x.error?"ERROR "+x.error:x.changed+" changed")).join("\n"):"no rule applies to this target"),LAST.draftError||ap.some(x=>x.error)?"bad":"");draw()}
 catch(e){msg($("#applied"),e.message,"bad")}}
function flat(v,p,out){if(v&&typeof v==="object"){const ks=Array.isArray(v)?v.map((_,i)=>i):Object.keys(v);if(!ks.length)out[p||"/"]=JSON.stringify(v);for(const k of ks)flat(v[k],p+"/"+String(k).replace(/~/g,"~0").replace(/\//g,"~1"),out)}else out[p||"/"]=JSON.stringify(v);return out}
function draw(){if(!LAST)return;const A=flat(LAST.base,"",{}),B=flat(LAST.result,"",{}),q=$("#q").value.toLowerCase(),only=$("#onlyChanged").checked;const rows=[];
 for(const k of new Set([...Object.keys(A),...Object.keys(B)])){const a=A[k],b=B[k];const kind=a===undefined?"add":b===undefined?"del":a!==b?"chg":"";if(only&&!kind)continue;
  const v=b===undefined?a:b;if(q&&!k.toLowerCase().includes(q)&&!String(v).toLowerCase().includes(q))continue;rows.push([k,v,kind]);if(rows.length>=1500)break}
 const out=$("#out");out.innerHTML="";if(!rows.length){out.innerHTML='<div><span>'+(only?"Nothing changed for this target.":"No match.")+'</span><span></span></div>';return}
 for(const [k,v,kind] of rows){const d=document.createElement("div");d.className=kind;d.innerHTML="<span></span><span></span>";d.children[0].textContent=k;d.children[1].textContent=v;d.onclick=()=>navigator.clipboard&&navigator.clipboard.writeText(k);out.appendChild(d)}}
$("#run").onclick=()=>preview();$("#test").onclick=()=>{try{const r=rule();$("#onlyChanged").checked=true;preview(r)}catch(e){msg($("#editMsg"),e.message,"bad")}};
$("#q").oninput=draw;$("#onlyChanged").onchange=draw;
async function hist(){const j=await api("GET","/v1/admin/control/history");const tb=$("#hist");tb.innerHTML="";for(const v of j.versions){const tr=document.createElement("tr");
 tr.innerHTML="<td>v"+v.version+"</td><td>"+new Date(v.updatedAt).toLocaleString()+"</td><td></td><td>"+v.rules+"</td><td></td>";tr.children[2].textContent=v.updatedBy||"";
 if(DOC&&v.version!==DOC.version){const b=document.createElement("button");b.textContent="Make live";b.onclick=async()=>{if(!confirm("Make v"+v.version+" live again?"))return;await api("POST","/v1/admin/control/rollback",{version:v.version});await load();hist()};tr.children[4].appendChild(b)}else tr.children[4].textContent="live";tb.appendChild(tr)}}
function tab(t){document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("on",b.dataset.t===t));$("#t-edit").classList.toggle("hidden",t!=="edit");$("#ctxBox").classList.toggle("hidden",!(t==="edit"||t==="find"));
 $("#t-hist").classList.toggle("hidden",t!=="hist");$("#t-help").classList.toggle("hidden",t!=="help");if(t==="hist")hist();if(t==="find")$("#onlyChanged").checked=false}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>tab(b.dataset.t));
$("#reload").onclick=load;$("#lock").onclick=()=>{S.removeItem("sec");location.reload()};
$("#enter").onclick=async()=>{const sv=$("#secret").value.trim();if(sv)S.setItem("sec",sv);const wv=$("#who").value.trim();if(wv||!S.getItem("who"))S.setItem("who",wv||"admin");try{await load();$("#gate").classList.add("hidden");$("#app").classList.remove("hidden")}catch(e){msg($("#gateMsg"),e.message,"bad")}};
$("#secret").onkeydown=e=>{if(e.key==="Enter")$("#enter").click()};
if(S.getItem("sec"))$("#enter").click();
</script>
</body>
</html>`;
