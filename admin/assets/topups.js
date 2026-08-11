/* Subly admin top-ups — single source of truth */
const ADMIN_TOPUP_PAGE_SIZE=25;
let adminTopupFilter='pending';
let adminTopupPage=1;
let adminTopupTotal=0;
let adminTopups=[];
let adminTopupProfiles=[];

function setTopupFilter(filter){adminTopupFilter=filter;adminTopupPage=1;document.querySelectorAll('[data-topup-filter]').forEach(b=>b.classList.toggle('active',b.dataset.topupFilter===filter));loadTopups();}
function adminTopupPager(){const pages=Math.max(1,Math.ceil(adminTopupTotal/ADMIN_TOPUP_PAGE_SIZE)),first=adminTopupTotal?((adminTopupPage-1)*ADMIN_TOPUP_PAGE_SIZE)+1:0,last=Math.min(adminTopupPage*ADMIN_TOPUP_PAGE_SIZE,adminTopupTotal);return `<div class="list-pager"><button class="action" ${adminTopupPage<=1?'disabled':''} onclick="changeAdminTopupPage(-1)">← Previous</button><span>${first}–${last} of ${adminTopupTotal} • Page ${adminTopupPage}/${pages}</span><button class="action" ${adminTopupPage>=pages?'disabled':''} onclick="changeAdminTopupPage(1)">Next →</button></div>`;}
function changeAdminTopupPage(delta){const pages=Math.max(1,Math.ceil(adminTopupTotal/ADMIN_TOPUP_PAGE_SIZE)),next=adminTopupPage+delta;if(next<1||next>pages)return;adminTopupPage=next;loadTopups();}

async function loadTopups(){
 const container=document.getElementById('topupList');if(!container||!currentAdminUser)return;
 container.innerHTML='<div class="empty"><div class="empty-icon">💳</div><div>Loading top-up requests...</div></div>';
 const from=(adminTopupPage-1)*ADMIN_TOPUP_PAGE_SIZE,to=from+ADMIN_TOPUP_PAGE_SIZE-1;
 let q=supabaseClient.from('topup_requests').select('id,user_id,amount,currency,payment_method,payment_reference,note,status,reviewed_by,reviewed_at,created_at',{count:'exact'}).order('created_at',{ascending:false}).range(from,to);
 if(adminTopupFilter!=='all')q=q.eq('status',adminTopupFilter);
 const{data,error,count}=await q;
 if(error){console.error('[SUBLY] top-ups',error);container.innerHTML=`<div class="empty">${escapeHtml(error.message||'Could not load top-up requests.')}</div>`;return;}
 adminTopupTotal=count||0;adminTopups=data||[];
 const uids=[...new Set(adminTopups.map(x=>x.user_id).filter(Boolean))];
 const profiles=uids.length?await supabaseClient.from('profiles').select('id,username,business_name,reseller_code').in('id',uids):{data:[]};
 adminTopupProfiles=profiles.data||[];renderTopups();
}
function renderTopups(){
 const container=document.getElementById('topupList');if(!container)return;
 if(!adminTopups.length){container.innerHTML='<div class="empty"><div class="empty-icon">💳</div><div>No top-up requests in this view.</div></div>'+adminTopupPager();return;}
 container.innerHTML=adminTopups.map(item=>{const r=adminTopupProfiles.find(x=>x.id===item.user_id)||{},name=r.business_name||r.username||'Unknown reseller',status=item.status||'pending';return `<article class="topup-card"><div class="topup-card-head"><div><div class="topup-reseller">${escapeHtml(name)}</div><div class="topup-meta">${escapeHtml(r.username||'')} ${r.reseller_code?`• ID ${escapeHtml(r.reseller_code)}`:''} • ${escapeHtml(formatDateTime(item.created_at))}</div></div><span class="status-badge ${escapeHtml(status)}">${escapeHtml(status)}</span></div><div class="topup-details"><div class="topup-detail"><div class="topup-detail-label">Amount</div><div class="topup-detail-value">${money(item.amount)}</div></div><div class="topup-detail"><div class="topup-detail-label">Payment Method</div><div class="topup-detail-value">${escapeHtml(paymentMethodLabel(item.payment_method))}</div></div><div class="topup-detail"><div class="topup-detail-label">Payment Reference</div><div class="topup-detail-value topup-payment-id">${escapeHtml(item.payment_reference||r.reseller_code||'—')}</div></div><div class="topup-detail"><div class="topup-detail-label">Request ID</div><div class="topup-detail-value">${escapeHtml(String(item.id).slice(0,8))}</div></div></div>${item.note?`<div class="topup-note"><strong>Note:</strong> ${escapeHtml(item.note)}</div>`:''}${status==='pending'?`<div class="topup-actions"><button class="topup-button approve" type="button" onclick="approveTopup('${item.id}',this)">✓ Approve</button><button class="topup-button reject" type="button" onclick="rejectTopup('${item.id}',this)">✕ Reject</button></div>`:`<div class="topup-meta" style="margin-top:12px">Reviewed: ${escapeHtml(formatDateTime(item.reviewed_at))}</div>`}</article>`;}).join('')+adminTopupPager();
}

async function approveTopup(id,button){const request=adminTopups.find(x=>x.id===id);if(!request)return;if(!confirm(`Approve ${money(request.amount)}? Only continue after verifying the payment.`))return;const card=button?.closest('.topup-card'),buttons=card?.querySelectorAll('button')||[];buttons.forEach(x=>x.disabled=true);try{const{data,error}=await supabaseClient.rpc('approve_topup',{p_topup_id:id});if(error)throw error;if(data?.success===false)throw new Error('Could not approve top-up.');await Promise.all([loadTopups(),typeof loadDashboard==='function'?loadDashboard():Promise.resolve()]);}catch(e){alert(e.message||'Could not approve top-up.');buttons.forEach(x=>x.disabled=false);}}
async function rejectTopup(id,button){const request=adminTopups.find(x=>x.id===id);if(!request)return;if(!confirm(`Reject the ${money(request.amount)} top-up request?`))return;const card=button?.closest('.topup-card'),buttons=card?.querySelectorAll('button')||[];buttons.forEach(x=>x.disabled=true);try{const{data,error}=await supabaseClient.rpc('reject_topup',{p_topup_id:id});if(error)throw error;if(data?.success===false)throw new Error('Could not reject top-up.');await loadTopups();}catch(e){alert(e.message||'Could not reject top-up.');buttons.forEach(x=>x.disabled=false);}}
window.addEventListener('subly:admin-ready',()=>{if(document.body?.dataset?.page==='topups')loadTopups();});
