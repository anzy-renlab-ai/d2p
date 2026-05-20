/* ZeroU Live Console mini-dashboard — IIFE, no deps. */
(function(){
'use strict';

const DATA={
  sessionId:'#4',branch:'main',demo:'agent-game-platform',
  presetName:'saas-web',presetTotal:28,presetStart:8,needHumanStart:23,
  // seed commits (prior session, no fly-in)
  commits:[{sha:'53df272',msg:'README v2'},{sha:'3d2ad5f',msg:'CHANGELOG'}],
  prUrl:'github.com/anzy-renlab-ai/agent-game-platform/pull/6',
};

let mount=document.getElementById('zerou-console')||document.querySelector('[data-zerou-console]');
if(!mount){console.warn('[zerou-console] no mount found');return;}

// Auto-inject CSS, resolved relative to this script's URL
if(!document.querySelector('link[data-zerou-console-css]')){
  let href='mini-dashboard/mini-dashboard.css';
  document.querySelectorAll('script[src]').forEach(s=>{
    if(/mini-dashboard\.js(\?|$)/.test(s.src)) href=s.src.replace(/mini-dashboard\.js(\?.*)?$/,'mini-dashboard.css');
  });
  const link=document.createElement('link');
  link.rel='stylesheet';link.href=href;link.setAttribute('data-zerou-console-css','');
  document.head.appendChild(link);
}

const AGENTS=[['differ','scan'],['implementer','write'],['alignment','haiku'],
  ['behavioral','sonnet'],['adversarial','attack'],['done-check','vision']];
const NODES=[['static','static'],['alignment','align'],['behavioral','behav'],['adversarial','adver']];

mount.className='zu-console';
mount.setAttribute('role','region');
mount.setAttribute('aria-label','ZeroU live console — 自动循环演示');
const M='zu-mono',G='zu-gold';
mount.innerHTML=
`<header class="zu-topbar"><div class="zu-topbar-left">`+
`<span class="zu-mark"></span><span class="zu-brand">ZEROU</span>`+
`<span class="zu-sep">·</span><span class="zu-meta">session <span class="${M} ${G}">${DATA.sessionId}</span></span>`+
`<span class="zu-sep">·</span><span class="zu-meta">branch <span class="${M}">${DATA.branch}</span></span>`+
`<span class="zu-sep zu-hide-sm">·</span><span class="zu-meta zu-hide-sm">${DATA.demo}</span>`+
`</div><div class="zu-topbar-right">`+
`<span class="zu-badge zu-badge-need" data-zu="needHumanBadge"><span class="zu-badge-dot"></span>NEED_HUMAN <span class="${M}" data-zu="needHumanCount">${DATA.needHumanStart}</span></span>`+
`<span class="zu-badge zu-badge-pr" data-zu="prBadge" hidden>✓ PR #6 opened</span>`+
`</div></header>`+
`<div class="zu-preset"><span class="zu-preset-label">preset <span class="${M}">${DATA.presetName}</span></span>`+
`<div class="zu-preset-bar"><div class="zu-preset-fill" data-zu="presetFill" style="--pct:${(DATA.presetStart/DATA.presetTotal)*100}%"></div><div class="zu-preset-ticks"></div></div>`+
`<span class="zu-preset-count"><span class="${M} ${G}" data-zu="presetDone">${DATA.presetStart}</span><span class="zu-preset-slash">/</span><span class="${M}">${DATA.presetTotal}</span></span></div>`+
`<div class="zu-body">`+
`<section class="zu-col zu-col-agents"><h3 class="zu-col-h">AGENTS</h3><ul class="zu-agents">`+
AGENTS.map(([n,r])=>`<li class="zu-agent" data-agent="${n}"><span class="zu-agent-dot"></span><span class="zu-agent-name">${n}</span><span class="zu-agent-role">${r}</span></li>`).join('')+
`</ul></section>`+
`<section class="zu-col zu-col-pipeline"><h3 class="zu-col-h">PIPELINE</h3>`+
`<div class="zu-fix" data-zu="fixBox"><div class="zu-fix-head"><span class="zu-fix-slug">fix/<span data-zu="fixName">—</span></span><span class="zu-fix-attempt">attempt <span class="${M}" data-zu="fixAttempt">—</span></span></div><div class="zu-fix-status" data-zu="fixStatus">idle · waiting for differ</div></div>`+
`<ol class="zu-pipe">`+
NODES.map(([n,l],i)=>`<li class="zu-pipe-node" data-node="${n}"><span class="zu-pipe-dot"></span><span class="zu-pipe-name">${l}</span><span class="zu-pipe-verdict" data-verdict>—</span></li>${i<3?'<li class="zu-pipe-edge"></li>':''}`).join('')+
`</ol><div class="zu-retry" data-zu="retry" hidden><span class="zu-retry-icon">↻</span> retry · <span class="${M}" data-zu="retryNum">—</span>/3</div></section>`+
`<section class="zu-col zu-col-commits"><h3 class="zu-col-h">COMMITS</h3><ul class="zu-commits" data-zu="commits" aria-live="polite"></ul><div class="zu-commits-empty">no merges yet · waiting…</div></section>`+
`</div>`+
`<section class="zu-log"><header class="zu-log-head"><span class="zu-log-h">LOG STREAM</span><span class="zu-log-cursor">●</span><span class="zu-log-clock" data-zu="clock">22:14:00</span></header><ol class="zu-log-list" data-zu="logList" aria-live="polite"></ol></section>`;

const Q=s=>mount.querySelector(s),QA=s=>mount.querySelectorAll(s);
const el={
  presetFill:Q('[data-zu="presetFill"]'),
  presetDone:Q('[data-zu="presetDone"]'),
  needHumanCount:Q('[data-zu="needHumanCount"]'),
  needHumanBadge:Q('[data-zu="needHumanBadge"]'),
  prBadge:Q('[data-zu="prBadge"]'),
  fixBox:Q('[data-zu="fixBox"]'),
  fixName:Q('[data-zu="fixName"]'),
  fixAttempt:Q('[data-zu="fixAttempt"]'),
  fixStatus:Q('[data-zu="fixStatus"]'),
  retry:Q('[data-zu="retry"]'),
  retryNum:Q('[data-zu="retryNum"]'),
  commits:Q('[data-zu="commits"]'),
  logList:Q('[data-zu="logList"]'),
  clock:Q('[data-zu="clock"]'),
};

const state={clockM:14*60+14,clockS:0,preset:DATA.presetStart,need:DATA.needHumanStart,t:[],iv:[]};
const pad=n=>String(n).padStart(2,'0');
const fmt=()=>{const T=state.clockM*60+state.clockS;return`${pad(Math.floor(T/3600)%24)}:${pad(Math.floor(T/60)%60)}:${pad(T%60)}`;};
const fmtS=()=>{const T=state.clockM*60+state.clockS;return`${pad(Math.floor(T/3600)%24)}:${pad(Math.floor(T/60)%60)}`;};
const tick=()=>{state.clockS+=1;while(state.clockS>=60){state.clockS-=60;state.clockM++;}el.clock.textContent=fmt();};

function setAgent(name,s){const n=Q(`.zu-agent[data-agent="${name}"]`);if(!n)return;n.classList.remove('is-active','is-done');if(s)n.classList.add('is-'+s);}
function resetAgents(){QA('.zu-agent').forEach(n=>n.classList.remove('is-active','is-done'));}
function setPipe(name,s,v){const n=Q(`.zu-pipe-node[data-node="${name}"]`);if(!n)return;n.classList.remove('is-working','is-pass','is-fail','is-skip');if(s)n.classList.add('is-'+s);if(v!=null)n.querySelector('[data-verdict]').textContent=v;}
function setEdge(i,s){const e=QA('.zu-pipe-edge')[i];if(!e)return;e.classList.remove('is-pass','is-fail');if(s)e.classList.add('is-'+s);}
function resetPipe(){['static','alignment','behavioral','adversarial'].forEach(n=>setPipe(n,null,'—'));[0,1,2].forEach(i=>setEdge(i,null));}
function setFix(n,a,st,cls){el.fixName.textContent=n;el.fixAttempt.textContent=a;el.fixStatus.textContent=st;el.fixBox.classList.remove('is-failing','is-merged');if(cls)el.fixBox.classList.add('is-'+cls);}
function clearFix(){el.fixName.textContent='—';el.fixAttempt.textContent='—';el.fixStatus.textContent='idle · waiting for differ';el.fixBox.classList.remove('is-failing','is-merged');}
function showRetry(n){el.retry.hidden=false;el.retryNum.textContent=n;}
function hideRetry(){el.retry.hidden=true;}
function setPreset(d){state.preset=d;el.presetDone.textContent=d;el.presetFill.style.setProperty('--pct',(d/DATA.presetTotal)*100+'%');}
function bumpPreset(){setPreset(state.preset+1);}
function setNeed(n){state.need=n;el.needHumanCount.textContent=n;el.needHumanBadge.classList.add('zu-flash');setTimeout(()=>el.needHumanBadge.classList.remove('zu-flash'),500);}
function bumpNeed(){setNeed(state.need+1);}
function pushCommit(sha,msg){
  const li=document.createElement('li');li.className='zu-commit';
  li.innerHTML=`<span class="zu-commit-arrow">▸</span><span class="zu-commit-sha">${sha}</span><span class="zu-commit-msg">${msg}</span>`;
  el.commits.insertBefore(li,el.commits.firstChild);
  const all=el.commits.querySelectorAll('.zu-commit');
  if(all.length>4)all[all.length-1].remove();
}
function clearCommits(){el.commits.innerHTML='';}
function showPR(){el.prBadge.hidden=false;el.prBadge.classList.add('zu-flash');setTimeout(()=>el.prBadge.classList.remove('zu-flash'),500);}
function hidePR(){el.prBadge.hidden=true;el.prBadge.classList.remove('zu-flash');}
function log(msg,kind){
  const li=document.createElement('li');li.className='zu-log-line';
  if(kind)li.classList.add('is-'+kind);
  li.innerHTML=`<span class="zu-log-time">${fmtS()}</span><span class="zu-log-msg">${msg}</span>`;
  el.logList.appendChild(li);
  const all=el.logList.querySelectorAll('.zu-log-line');
  all.forEach((line,i)=>{
    line.classList.remove('is-fade','is-ghost');
    const fe=all.length-1-i;
    if(fe===2)line.classList.add('is-fade');
    if(fe===3)line.classList.add('is-ghost');
    if(fe>3)line.remove();
  });
}
function clearLog(){el.logList.innerHTML='';}

function at(ms,fn){const id=setTimeout(()=>{state.t=state.t.filter(x=>x!==id);try{fn();}catch(e){console.error('[zerou]',e);}},ms);state.t.push(id);}
function clearAll(){state.t.forEach(clearTimeout);state.t=[];state.iv.forEach(clearInterval);state.iv=[];}

function cycle(){
  resetAgents();resetPipe();clearFix();hideRetry();hidePR();clearLog();clearCommits();
  setPreset(DATA.presetStart);setNeed(DATA.needHumanStart);
  // seed prior commits without fly-in
  DATA.commits.forEach(c=>{
    const li=document.createElement('li');li.className='zu-commit';li.style.animation='none';
    li.innerHTML=`<span class="zu-commit-arrow">▸</span><span class="zu-commit-sha">${c.sha}</span><span class="zu-commit-msg">${c.msg}</span>`;
    el.commits.appendChild(li);
  });
  state.clockM=14*60+14;state.clockS=0;el.clock.textContent=fmt();
  state.iv.push(setInterval(tick,1000));

  log('session #4 · ready · waiting for differ');

  // P1 differ
  at(2000,()=>{setAgent('differ','active');log('differ scanning repo + vision');});
  at(5000,()=>log('differ found 28 gaps · 4 complex','event'));
  at(7000,()=>setAgent('differ','done'));
  // P2 auth-csrf · attempt 2 · FAIL at alignment
  at(7200,()=>{setFix('auth-csrf',2,'implementer writing diff…');setAgent('implementer','active');log('implementer · fix/auth-csrf · attempt 2');});
  at(9200,()=>{setAgent('implementer','done');setPipe('static','working','…');setFix('auth-csrf',2,'static gate · tsc + tests');});
  at(10200,()=>{setPipe('static','pass','PASS');setEdge(0,'pass');log('static gate · 0 errors · PASS','pass');setPipe('alignment','working','…');setFix('auth-csrf',2,'alignment · haiku quick-check');});
  at(11400,()=>{setPipe('alignment','fail','0.55');setEdge(1,'fail');log('alignment · 0.55 · FAIL · scope creep','fail');setAgent('alignment','done');setFix('auth-csrf',2,'FAIL · score below 0.7','failing');});
  at(13000,()=>{bumpNeed();log('gap escalated · NEED_HUMAN +1','event');});
  // P3 docs-changelog · attempt 1 · ALL PASS
  at(15000,()=>{resetPipe();resetAgents();setFix('docs-changelog',1,'implementer writing CHANGELOG.md…');setAgent('implementer','active');log('implementer · fix/docs-changelog · attempt 1');});
  at(16800,()=>{setAgent('implementer','done');setPipe('static','working','…');setFix('docs-changelog',1,'static gate · tsc + tests');});
  at(17600,()=>{setPipe('static','pass','PASS');setEdge(0,'pass');log('static gate · 41 tests · PASS','pass');setPipe('alignment','working','…');});
  at(18500,()=>{setPipe('alignment','pass','0.98');setEdge(1,'pass');log('alignment · 0.98 · PASS','pass');setPipe('behavioral','working','…');setFix('docs-changelog',1,'behavioral · sonnet deep review');});
  at(19800,()=>{setPipe('behavioral','pass','APPROVE');setEdge(2,'pass');log('behavioral · APPROVE · 88% conf','pass');setPipe('adversarial','working','…');});
  at(20800,()=>{setPipe('adversarial','skip','SKIP');log('adversarial · SKIP · low sensitivity');setFix('docs-changelog',1,'MERGED · 5aedd6e → main','merged');});
  at(21800,()=>{pushCommit('5aedd6e','docs+');log('MERGED · commit 5aedd6e','merge');bumpPreset();});
  // P4 readme-expansion · attempt 3 + auto-PR
  at(23800,()=>{resetPipe();resetAgents();setFix('readme-expansion',3,'implementer attempt 3…');setAgent('implementer','active');showRetry(3);log('implementer · fix/readme-expansion · attempt 3');});
  at(25400,()=>{setAgent('implementer','done');setPipe('static','pass','PASS');setEdge(0,'pass');});
  at(26100,()=>{setPipe('alignment','pass','0.91');setEdge(1,'pass');log('alignment · 0.91 · PASS','pass');});
  at(26900,()=>{setPipe('behavioral','pass','APPROVE');setEdge(2,'pass');log('behavioral · APPROVE · 82% conf','pass');});
  at(27600,()=>{setPipe('adversarial','skip','SKIP');setFix('readme-expansion',3,'MERGED · 4b58841 → main','merged');hideRetry();});
  at(28300,()=>{pushCommit('4b58841','readme');log('MERGED · commit 4b58841','merge');bumpPreset();});
  at(29200,()=>{showPR();log('PR #6 opened · '+DATA.prUrl,'event');});
  // P5 wrap + loop
  at(30200,()=>{resetPipe();resetAgents();setAgent('done-check','active');clearFix();el.fixStatus.textContent='preset '+state.preset+'/'+DATA.presetTotal+' · session in progress';log('session · preset '+state.preset+'/'+DATA.presetTotal+' · 2 merged · 24 NEED_HUMAN','event');});
  at(32000,()=>{clearAll();cycle();});
}

// IntersectionObserver — only run while visible
let running=false;
const start=()=>{if(running)return;running=true;cycle();};
const stop=()=>{running=false;clearAll();};

if('IntersectionObserver' in window){
  new IntersectionObserver(es=>es.forEach(e=>{e.isIntersecting?start():stop();}),{threshold:0.15}).observe(mount);
}else{
  start();
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stop();}
  else{
    const r=mount.getBoundingClientRect();
    if(r.top<window.innerHeight&&r.bottom>0)start();
  }
});

})();
