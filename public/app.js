const $=s=>document.querySelector(s);
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const api=async(p,o={})=>{const r=await fetch('/api/'+p,{...o,headers:{'x-library-code':libCode(),...(localStorage.getItem('at.session')?{Authorization:'Bearer '+localStorage.getItem('at.session')}:{}),...(o.headers||{})}}),j=await r.json();if(!r.ok){const e=new Error(j.error);e.status=r.status;throw e}return j};
const lib=()=>JSON.parse(localStorage.getItem('at.docs')||'[]'),saveLib=l=>localStorage.setItem('at.docs',JSON.stringify(l));
const libCode=()=>{let c=localStorage.getItem('at.lib');if(!c){c=crypto.randomUUID().replace(/-/g,'').slice(0,16);localStorage.setItem('at.lib',c)}return c};
const here=location.pathname.split('/').pop()||'index.html';
const LOGO='<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="8" fill="var(--ink)"/><g fill="none" stroke="var(--surface)" stroke-width="2.2"><rect x="5" y="11" width="12" height="8" rx="4"/><rect x="13" y="11" width="12" height="8" rx="4"/></g></svg>';
const ME=JSON.parse(localStorage.getItem('at.user')||'null');
const SESS=!!localStorage.getItem('at.session');
const ACCT=ME&&localStorage.getItem('at.session')?`<details class="dd"><summary>${String(ME.name).replace(/[<>&"]/g,'')}</summary><div class="menu"><a href="settings.html">Settings</a><a href="#" id="lo">Log out</a></div></details>`:'';
const L1=[['write.html','Dashboard'],['insights.html','Insights'],['classes.html','Classroom'],['verify.html','Verify']],L2=[['setup.html','Setup guide'],['limits.html','What it proves'],['security.html','Security and privacy'],['faq.html','FAQ'],['api.html','API'],['check.html','Independent check']];
const lk=([h,n])=>`<a href="${h}"${here===h?' aria-current="page"':''}>${n}</a>`;
document.body.insertAdjacentHTML('afterbegin',`<header class="nav"><a class="brand" href="/">${LOGO}AuthorTrail</a><nav>${SESS?L1.map(lk).join(''):''}${SESS?'<details class="dd"><summary>Resources</summary><div class="menu">'+L2.map(lk).join('')+'</div></details>':''}${ACCT}</nav></header>`);
document.body.insertAdjacentHTML('beforeend','<footer class="foot"><span>AuthorTrail records how work was made, not what it says. It describes a process and is not an AI detector.</span><span><a href="setup.html">Setup guide</a><a href="security.html">Security</a><a href="faq.html">FAQ</a><a href="api.html">API</a><a href="limits.html">What it proves</a></span></footer>');
// The ribbon: one segment per checkpoint, wider when more text was added; solid = typed, hatched = pasted.
function ribbon(chain){return `<div class="ribbon" role="img" aria-label="Writing process timeline">${chain.map(c=>{const n=Math.max(c.stats.typed+c.stats.pasted,1),p=c.stats.pasted/n*100;return `<div class="seg" style="flex:${Math.min(n,2000)}" title="Checkpoint ${c.index}: ${c.stats.typed} typed, ${c.stats.pasted} pasted"><span class="t" style="width:${100-p}%"></span><span class="p" style="width:${p}%"></span></div>`}).join('')}</div><div class="key"><span><i></i>Typed</span><span><i class="p"></i>Pasted</span></div>`}
const entryHash=(prev,c)=>sha([prev,c.contentHash,JSON.stringify(c.stats),c.serverTime].join('|'));
async function chainOk(chain,genesis){let prev=genesis;for(const c of chain){if(c.prevHash!==prev||await entryHash(prev,c)!==c.hash)return false;prev=c.hash}return true}

// Account guard: every page except the login page needs a signed-in user.
if(here!=='login.html'&&!SESS)location.replace('login.html?next='+encodeURIComponent(here+location.search));
else{document.documentElement.classList.add('ok');
 if(SESS&&here==='login.html')location.replace('write.html');
 else if(SESS)api('auth/me').then(r=>{localStorage.setItem('at.user',JSON.stringify(r.user));localStorage.setItem('at.lib',r.user.libCode)}).catch(e=>{if(e.status===401){['at.session','at.user'].forEach(k=>localStorage.removeItem(k));location.reload()}})}
if($('#lo'))$('#lo').onclick=async e=>{e.preventDefault();try{await api('auth/logout',{method:'POST'})}catch{}['at.session','at.user','at.lib'].forEach(k=>localStorage.removeItem(k));location='/'};
