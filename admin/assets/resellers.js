/* Subly admin reseller list — page-specific source of truth. */
const RESELLER_PAGE_SIZE=25;
let resellerPage=1,resellerTotal=0,resellerSearchTimer=null,managedResellerId=null,resellerLifecycleHooksInstalled=false;

(function loadResellerLifecycleStyles(){
  if(document.getElementById('subly-reseller-lifecycle-css'))return;
  const link=document.createElement('link');
  link.id='subly-reseller-lifecycle-css';
  link.rel='stylesheet';
  link.href='assets/reseller-lifecycle.css?v=20260815-1';
  document.head.appendChild(link);
})();

function ensureResellerToolbar(){
  const list=document.getElementById('resellerList'),body=list?.parentElement;
  if(!body||document.getElementById('resellerToolbar'))return;
  const bar=document.createElement('div');
  bar.id='resellerToolbar';
  bar.className='reseller-toolbar';
  bar.innerHTML='<div class="reseller-toolbar-main"><input id="resellerSearch" type="search" placeholder="Search reseller, business or Payment ID…"><select id="resellerStatusFilter" aria-label="Filter resellers"><option value="current">Current resellers</option><option value="archived">Archived</option><option value="all">All resellers</option></select></div><span id="resellerPageInfo" class="reseller-page-info"></span>';
  body.insertBefore(bar,list);
  document.getElementById('resellerSearch').addEventListener('input',()=>{
    clearTimeout(resellerSearchTimer);
    resellerSearchTimer=setTimeout(()=>{resellerPage=1;loadResellers()},250);
  });
  document.getElementById('resellerStatusFilter').addEventListener('change',()=>{resellerPage=1;loadResellers()});
}
function safeResellerSearch(v){return String(v||'').trim().replace(/[,%()"']/g,' ').replace(/\s+/g,' ').slice(0,80)}
function resellerPager(){const pages=Math.max(1,Math.ceil(resellerTotal/RESELLER_PAGE_SIZE));return `<div class="list-pager reseller-pager"><button class="action" ${resellerPage<=1?'disabled':''} onclick="changeResellerPage(-1)">← Previous</button><span>Page ${resellerPage} of ${pages}</span><button class="action" ${resellerPage>=pages?'disabled':''} onclick="changeResellerPage(1)">Next →</button></div>`}
function changeResellerPage(d){const pages=Math.max(1,Math.ceil(resellerTotal/RESELLER_PAGE_SIZE)),n=resellerPage+d;if(n<1||n>pages)return;resellerPage=n;loadResellers()}

async function loadResellers(){
  const c=document.getElementById('resellerList');
  if(!c||!currentAdminUser)return;
  ensureResellerToolbar();
  c.innerHTML='<div class="empty"><div class="empty-icon">👥</div><div>Loading resellers...</div></div>';
  const from=(resellerPage-1)*RESELLER_PAGE_SIZE,to=from+RESELLER_PAGE_SIZE-1,q=safeResellerSearch(document.getElementById('resellerSearch')?.value),filter=document.getElementById('resellerStatusFilter')?.value||'current';
  let req=supabaseClient.from('profiles').select('id,username,business_name,reseller_code,tier,status,created_at',{count:'exact'}).eq('role','reseller').order('created_at',{ascending:false}).range(from,to);
  if(filter==='archived')req=req.eq('status','archived');
  else if(filter==='current')req=req.neq('status','archived');
  if(q)req=req.or(`username.ilike.%${q}%,business_name.ilike.%${q}%,reseller_code.ilike.%${q}%`);
  const{data,error,count}=await req;
  if(error){console.error('[SUBLY] resellers',error);c.innerHTML=`<div class="empty">${escapeHtml(error.message||'Could not load resellers.')}</div>`;return}
  const rows=data||[];
  resellerTotal=count||0;
  const ids=rows.map(x=>x.id),wr=ids.length?await supabaseClient.from('wallets').select('user_id,balance').in('user_id',ids):{data:[],error:null};
  if(wr.error){console.error('[SUBLY] reseller wallets',wr.error);c.innerHTML=`<div class="empty">${escapeHtml(wr.error.message||'Could not load reseller wallet balances.')}</div>`;return}
  const wallets=wr.data||[],info=document.getElementById('resellerPageInfo');
  if(info){const first=resellerTotal?from+1:0,last=Math.min(to+1,resellerTotal);info.textContent=resellerTotal?`${first}–${last} of ${resellerTotal}`:'0 resellers'}
  if(!rows.length){c.innerHTML='<div class="empty"><div class="empty-icon">👥</div><div>No matching resellers.</div></div>'+resellerPager();return}
  c.innerHTML=rows.map(r=>{
    const wallet=wallets.find(w=>w.user_id===r.id),bal=wallet?.balance??0,status=String(r.status||'unknown'),label=escapeHtml(r.business_name||r.username||'Unnamed reseller'),username=escapeHtml(r.username||'');
    const lifecycle=status==='archived'
      ?`<button class="action reseller-restore-action" onclick="restoreReseller('${r.id}')">Restore</button><button class="action reseller-delete-action" onclick="deleteReseller('${r.id}')">Delete</button>`
      :`<button class="action reseller-archive-action" onclick="archiveReseller('${r.id}')">Archive</button>`;
    return `<div class="reseller-row"><div><div class="reseller-name">${label}</div><div class="reseller-sub">${username} ${r.reseller_code?`• ${escapeHtml(r.reseller_code)}`:''}</div></div><div><span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span></div><div><div class="reseller-name">${escapeHtml((r.tier||'bronze').toUpperCase())}</div><div class="reseller-sub">Wallet ${money(bal)}</div></div><div class="reseller-row-actions"><button class="action" onclick="openResellerManage('${r.id}')">Manage</button>${lifecycle}</div></div>`;
  }).join('')+resellerPager();
}

async function getResellerLifecycleProfile(id){
  const{data,error}=await supabaseClient.from('profiles').select('id,username,business_name,status').eq('id',id).eq('role','reseller').maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Reseller not found');
  return data;
}
async function setResellerArchived(id,archived){
  if(!id)return;
  let p;
  try{p=await getResellerLifecycleProfile(id)}catch(e){alert(e.message||'Could not load reseller.');return}
  const name=p.business_name||p.username||'this reseller',action=archived?'archive':'restore';
  const message=archived
    ?`Archive ${name}?\n\nThey will no longer be able to sign in, but all orders, subscriptions, customers, wallet history and transactions will stay saved.`
    :`Restore ${name}?\n\nTheir account will become active again and they can sign in.`;
  if(!confirm(message))return;
  const{error}=await supabaseClient.rpc('admin_set_reseller_archived',{p_user_id:id,p_archived:archived});
  if(error){alert(error.message||`Could not ${action} reseller.`);return}
  if(managedResellerId===id&&typeof closeResellerManage==='function')closeResellerManage();
  await loadResellers();
}
function archiveReseller(id){return setResellerArchived(id,true)}
function restoreReseller(id){return setResellerArchived(id,false)}

function resellerHistorySummary(check){
  const parts=[];
  const values=[['orders',check?.orders],['customers',check?.customers],['renewals',check?.renewals],['wallet transactions',check?.wallet_transactions],['top-ups',check?.topups],['support issues',check?.support_issues],['contact tickets',check?.contact_tickets],['Telegram connection',check?.telegram_connections],['notifications',check?.notifications]];
  for(const[label,value]of values)if(Number(value||0)>0)parts.push(`${value} ${label}`);
  if(Number(check?.wallet_balance||0)!==0)parts.push(`wallet balance ${money(check.wallet_balance)}`);
  return parts.join(', ');
}
async function deleteReseller(id){
  if(!id)return;
  const{data:check,error:checkError}=await supabaseClient.rpc('admin_reseller_delete_check',{p_user_id:id});
  if(checkError){alert(checkError.message||'Could not check reseller deletion safety.');return}
  const username=String(check?.username||''),name=username||'this reseller';
  if(check?.status!=='archived'){
    alert('Archive this reseller first. Permanent delete is only available after archiving.');
    return;
  }
  if(!check?.can_delete){
    const history=resellerHistorySummary(check);
    alert(`Permanent delete is blocked because ${name} has account history${history?` (${history})`:''}.\n\nKeep this reseller archived instead so the records stay safe.`);
    return;
  }
  const typed=prompt(`PERMANENT DELETE\n\nThis will remove the unused reseller login and profile. This cannot be undone.\n\nType the username exactly to continue:\n${username}`);
  if(typed===null)return;
  if(typed!==username){alert('Username confirmation did not match. Nothing was deleted.');return}
  if(!confirm(`Delete ${name} permanently?\n\nThis is the final confirmation.`))return;
  const{error}=await supabaseClient.rpc('admin_delete_reseller',{p_user_id:id,p_confirmation:typed});
  if(error){alert(error.message||'Could not delete reseller.');return}
  if(managedResellerId===id&&typeof closeResellerManage==='function')closeResellerManage();
  resellerPage=1;
  await loadResellers();
}

function openResellerModal(){const m=document.getElementById('resellerModal');if(!m)return;['newResellerUsername','newResellerBusiness','newResellerPassword'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});document.getElementById('newResellerTier').value='bronze';document.getElementById('resellerModalMessage').textContent='';m.classList.add('show');setTimeout(()=>document.getElementById('newResellerUsername')?.focus(),60)}
function closeResellerModal(){document.getElementById('resellerModal')?.classList.remove('show')}
async function createReseller(){const username=document.getElementById('newResellerUsername').value.trim().toLowerCase(),business=document.getElementById('newResellerBusiness').value.trim(),password=document.getElementById('newResellerPassword').value,tier=document.getElementById('newResellerTier').value,msg=document.getElementById('resellerModalMessage'),btn=document.getElementById('createResellerButton');msg.textContent='';if(!/^[a-z0-9._-]{3,30}$/.test(username)){msg.textContent='Username must be 3–30 letters, numbers, dots, dashes or underscores.';return}if(!business){msg.textContent='Business name is required.';document.getElementById('newResellerBusiness')?.focus();return}if(business.length>120){msg.textContent='Business name is too long.';return}if(password.length<8){msg.textContent='Password must be at least 8 characters.';return}if(!['bronze','silver','gold','diamond'].includes(tier)){msg.textContent='Invalid tier.';return}btn.disabled=true;btn.textContent='Creating…';try{const{data,error}=await supabaseClient.functions.invoke('create-reseller',{body:{username,password,business_name:business,tier}});if(error)throw error;if(data?.error)throw new Error(data.error);closeResellerModal();resellerPage=1;await loadResellers()}catch(e){msg.textContent=e.message||'Could not create reseller.'}finally{btn.disabled=false;btn.textContent='Create Reseller'}}

async function enhanceManagedResellerSettings(){
  if(!managedResellerId)return;
  const{data:p,error}=await supabaseClient.from('profiles').select('id,username,business_name,status').eq('id',managedResellerId).maybeSingle();
  if(error||!p)return;
  const statusSelect=document.getElementById('mrStatus');
  if(statusSelect&&p.status==='archived'&&!statusSelect.querySelector('option[value="archived"]')){
    const option=document.createElement('option');option.value='archived';option.textContent='archived';statusSelect.appendChild(option);
  }
  if(statusSelect)statusSelect.value=p.status;
  if(document.getElementById('mrResellerLifecycleZone'))return;
  const content=document.getElementById('mrContent');if(!content)return;
  const zone=document.createElement('div');zone.id='mrResellerLifecycleZone';zone.className='mr-section reseller-lifecycle-zone';
  zone.innerHTML=`<h3>Account lifecycle</h3><p class="reseller-lifecycle-copy">Archive keeps all reseller history but blocks sign-in. Permanent delete is only allowed for an archived reseller with zero account history.</p><div class="mr-actions">${p.status==='archived'?`<button class="mr-btn reseller-restore-action" onclick="restoreReseller('${p.id}')">Restore Reseller</button><button class="mr-btn reseller-delete-action" onclick="deleteReseller('${p.id}')">Delete Permanently</button>`:`<button class="mr-btn reseller-archive-action" onclick="archiveReseller('${p.id}')">Archive Reseller</button>`}</div>`;
  content.appendChild(zone);
}
function installResellerLifecycleHooks(){
  if(resellerLifecycleHooksInstalled)return;
  resellerLifecycleHooksInstalled=true;
  const originalOpen=window.openResellerManage;
  if(typeof originalOpen==='function')window.openResellerManage=async id=>{managedResellerId=id;return originalOpen(id)};
  const originalClose=window.closeResellerManage;
  if(typeof originalClose==='function')window.closeResellerManage=()=>{managedResellerId=null;return originalClose()};
  const originalSwitch=window.mrSwitchTab;
  if(typeof originalSwitch==='function')window.mrSwitchTab=async x=>{const out=await originalSwitch(x);if(x==='settings')await enhanceManagedResellerSettings();return out};
}

window.addEventListener('subly:admin-ready',loadResellers);
window.addEventListener('load',()=>{installResellerLifecycleHooks();if(currentAdminUser)loadResellers()});
