/* Subly admin reseller list — page-specific source of truth. */
const RESELLER_PAGE_SIZE=25;
let resellerPage=1,resellerTotal=0,resellerSearchTimer=null,managedResellerId=null,resellerLifecycleHooksInstalled=false,selectedDebtUserId=null,resellerDebtById=new Map();

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
  bar.innerHTML='<div class="reseller-toolbar-main"><input id="resellerSearch" type="search" placeholder="Search reseller, business or Payment ID…"><select id="resellerStatusFilter" aria-label="Filter resellers"><option value="current">Current resellers</option><option value="archived">Archived</option><option value="all">All resellers</option></select><select id="resellerSortFilter" aria-label="Sort resellers"><option value="debt_desc" selected>Debt: Highest → Lowest</option><option value="debt_asc">Debt: Lowest → Highest</option><option value="newest">Newest first</option><option value="name">Name A → Z</option></select></div><span id="resellerPageInfo" class="reseller-page-info"></span>';
  body.insertBefore(bar,list);
  document.getElementById('resellerSearch').addEventListener('input',()=>{
    clearTimeout(resellerSearchTimer);
    resellerSearchTimer=setTimeout(()=>{resellerPage=1;loadResellers()},250);
  });
  document.getElementById('resellerStatusFilter').addEventListener('change',()=>{resellerPage=1;loadResellers()});
  document.getElementById('resellerSortFilter').addEventListener('change',()=>{resellerPage=1;loadResellers()});
}
function safeResellerSearch(v){return String(v||'').trim().replace(/[,%()"']/g,' ').replace(/\s+/g,' ').slice(0,80)}
function resellerPager(){const pages=Math.max(1,Math.ceil(resellerTotal/RESELLER_PAGE_SIZE));return `<div class="list-pager reseller-pager"><button class="action" ${resellerPage<=1?'disabled':''} onclick="changeResellerPage(-1)">← Previous</button><span>Page ${resellerPage} of ${pages}</span><button class="action" ${resellerPage>=pages?'disabled':''} onclick="changeResellerPage(1)">Next →</button></div>`}
function changeResellerPage(d){const pages=Math.max(1,Math.ceil(resellerTotal/RESELLER_PAGE_SIZE)),n=resellerPage+d;if(n<1||n>pages)return;resellerPage=n;loadResellers()}

async function loadResellers(){
  const c=document.getElementById('resellerList');
  if(!c||!currentAdminUser)return;
  ensureResellerToolbar();
  c.innerHTML='<div class="empty"><div class="empty-icon">👥</div><div>Loading resellers...</div></div>';
  const q=safeResellerSearch(document.getElementById('resellerSearch')?.value),filter=document.getElementById('resellerStatusFilter')?.value||'current',sort=document.getElementById('resellerSortFilter')?.value||'debt_desc';
  const{data,error}=await supabaseClient.rpc('admin_reseller_rows',{p_search:q||null,p_status_filter:filter,p_sort:sort,p_page:resellerPage,p_page_size:RESELLER_PAGE_SIZE});
  if(error){console.error('[SUBLY] resellers',error);c.innerHTML=`<div class="empty">${escapeHtml(error.message||'Could not load resellers.')}</div>`;return}
  const rows=data||[];
  resellerTotal=Number(rows[0]?.total_count||0);
  resellerDebtById=new Map(rows.map(x=>[x.id,Number(x.cash_due||0)]));
  const info=document.getElementById('resellerPageInfo'),from=(resellerPage-1)*RESELLER_PAGE_SIZE,to=from+RESELLER_PAGE_SIZE-1;
  if(info){const first=resellerTotal?from+1:0,last=Math.min(to+1,resellerTotal);info.textContent=resellerTotal?`${first}–${last} of ${resellerTotal}`:'0 resellers'}
  if(!rows.length){c.innerHTML='<div class="empty"><div class="empty-icon">👥</div><div>No matching resellers.</div></div>'+resellerPager();return}
  c.innerHTML=rows.map(r=>{
    const bal=Number(r.wallet_balance||0),debt=Number(r.cash_due||0),status=String(r.status||'unknown'),label=escapeHtml(r.business_name||r.username||'Unnamed reseller'),username=escapeHtml(r.username||'');
    const lifecycle=status==='archived'
      ?`<button class="action reseller-restore-action" onclick="restoreReseller('${r.id}')">Restore</button><button class="action reseller-delete-action" onclick="deleteReseller('${r.id}')">Delete</button>`
      :`<button class="action reseller-archive-action" onclick="archiveReseller('${r.id}')">Archive</button>`;
    return `<div class="reseller-row"><div><div class="reseller-title-line"><div class="reseller-name">${label}</div><div class="reseller-wallet-pill" title="Current wallet balance">💰 <span>Wallet</span> <strong>${money(bal)}</strong></div><button class="reseller-debt-pill" type="button" title="Adjust reseller debt" onclick="openResellerDebtAdjust('${r.id}')">🔴 <span>Debt</span> <strong>${money(debt)}</strong></button></div><div class="reseller-sub">${username} ${r.reseller_code?`• ${escapeHtml(r.reseller_code)}`:''}</div></div><div><span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span></div><div><div class="reseller-name">${escapeHtml((r.tier||'bronze').toUpperCase())}</div><div class="reseller-sub">Pricing tier</div></div><div class="reseller-row-actions"><button class="action" onclick="openResellerManage('${r.id}')">Manage</button><button class="action reseller-debt-action" onclick="openResellerDebtAdjust('${r.id}')">Adjust Debt</button>${lifecycle}</div></div>`;
  }).join('')+resellerPager();
}

function ensureResellerDebtModal(){
  if(document.getElementById('resellerDebtModal'))return;
  const m=document.createElement('div');m.id='resellerDebtModal';m.className='modal';
  m.innerHTML='<div class="modal-card" style="max-width:520px"><div class="modal-head"><div><h2>Adjust Debt</h2><p id="resellerDebtTitle">Reseller</p></div><button class="modal-close" type="button" onclick="closeResellerDebtAdjust()">✕</button></div><div class="modal-body"><div class="order-summary-box reseller-debt-summary">Current debt: <strong id="resellerDebtCurrent">$0.00</strong></div><label>Adjustment (+ adds debt / - reduces debt)</label><input id="resellerDebtAmount" type="number" step="0.01" placeholder="Example: 20 or -10"><label>Reason</label><input id="resellerDebtReason" maxlength="500" placeholder="Required reason"><div id="resellerDebtMessage" class="manage-message"></div><button id="resellerDebtSubmit" class="modal-submit" type="button" onclick="submitResellerDebtAdjust()">Apply Debt Adjustment</button></div></div>';
  document.body.appendChild(m);
}
function openResellerDebtAdjust(id){
  const debt=Number(resellerDebtById.get(id)||0),row=[...document.querySelectorAll('.reseller-row')].find(x=>x.querySelector(`[onclick*="'${id}'"]`));
  selectedDebtUserId=id;ensureResellerDebtModal();
  document.getElementById('resellerDebtTitle').textContent=row?.querySelector('.reseller-name')?.textContent||'Reseller';
  document.getElementById('resellerDebtCurrent').textContent=money(debt);
  document.getElementById('resellerDebtAmount').value='';
  document.getElementById('resellerDebtReason').value='';
  const msg=document.getElementById('resellerDebtMessage');msg.textContent='';msg.className='manage-message';
  document.getElementById('resellerDebtModal').classList.add('show');
  setTimeout(()=>document.getElementById('resellerDebtAmount')?.focus(),60);
}
function closeResellerDebtAdjust(){document.getElementById('resellerDebtModal')?.classList.remove('show');selectedDebtUserId=null}
async function submitResellerDebtAdjust(){
  if(!selectedDebtUserId)return;
  const amount=Number(document.getElementById('resellerDebtAmount').value),reason=document.getElementById('resellerDebtReason').value.trim(),current=Number(resellerDebtById.get(selectedDebtUserId)||0),msg=document.getElementById('resellerDebtMessage'),btn=document.getElementById('resellerDebtSubmit');
  if(!Number.isFinite(amount)||amount===0){msg.textContent='Enter a non-zero adjustment. Positive adds debt; negative reduces it.';msg.className='manage-message error';return}
  if(current+amount<0){msg.textContent='Debt cannot go below $0.00.';msg.className='manage-message error';return}
  if(reason.length<3){msg.textContent='Enter a clear reason (at least 3 characters).';msg.className='manage-message error';return}
  if(!confirm(`Adjust debt by ${amount>0?'+':''}${money(amount)}? Wallet balance will not change.`))return;
  btn.disabled=true;btn.textContent='Applying…';
  try{const{data,error}=await supabaseClient.rpc('admin_adjust_cash_due',{p_user_id:selectedDebtUserId,p_amount:amount,p_note:reason});if(error)throw error;msg.textContent=`Debt updated. New debt: ${money(data?.new_due||0)}`;msg.className='manage-message success';await loadResellers();setTimeout(closeResellerDebtAdjust,500)}
  catch(e){msg.textContent=e.message||'Could not adjust debt.';msg.className='manage-message error'}
  finally{btn.disabled=false;btn.textContent='Apply Debt Adjustment'}
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
  const values=[['orders',check?.orders],['customers',check?.customers],['renewals',check?.renewals],['wallet transactions',check?.wallet_transactions],['top-ups',check?.topups],['debt ledger entries',check?.cash_ledger],['support issues',check?.support_issues],['contact tickets',check?.contact_tickets],['Telegram connection',check?.telegram_connections],['notifications',check?.notifications]];
  for(const[label,value]of values)if(Number(value||0)>0)parts.push(`${value} ${label}`);
  if(Number(check?.wallet_balance||0)!==0)parts.push(`wallet balance ${money(check.wallet_balance)}`);if(Number(check?.cash_due||0)!==0)parts.push(`debt ${money(check.cash_due)}`);
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
