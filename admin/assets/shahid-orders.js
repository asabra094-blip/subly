/* Dedicated Shahid admin control center. Keeps Shahid automation separate from manual subscription orders. */
const SHAHID_ADMIN_PAGE_SIZE=25;
let shahidAdminSection='orders',shahidOrderFilter='attention',shahidOrderPage=1,shahidOrderTotal=0,shahidOrderRows=[],shahidSearchTimer=null;
let shahidRenewalStatus='pending',shahidRenewalPage=1,shahidRenewalTotal=0,shahidRenewalRows=[];
let shahidIncidentState='open',shahidIncidentPage=1,shahidIncidentTotal=0,shahidIncidentRows=[];
let shahidProductIdsCache=null,selectedShahidAdminOrder=null,shahidHealthTimer=null;

const shahidStateLabel=v=>({attention:'Needs Attention',queued:'Queued',preparing:'Preparing',purchasing:'Purchasing',waiting_supplier:'Waiting Supplier',manual:'Manual',delivered:'Delivered',refunded:'Refunded',cancelled:'Cancelled'})[v]||String(v||'Unknown').replaceAll('_',' ');
const shahidDate=v=>v?formatDateTime(v):'—';
const shahidName=r=>[r?.customer_first_name,r?.customer_last_name].filter(Boolean).join(' ').trim()||'No customer linked';
const shahidSubId=r=>r?.subscription_code||`SUB-${String(r?.id||'').replaceAll('-','').slice(0,8).toUpperCase()}`;
const shahidPager=(total,page,fn,label='orders')=>{const pages=Math.max(1,Math.ceil(total/SHAHID_ADMIN_PAGE_SIZE)),first=total?(page-1)*SHAHID_ADMIN_PAGE_SIZE+1:0,last=Math.min(page*SHAHID_ADMIN_PAGE_SIZE,total);return `<div class="list-pager"><button class="shahid-btn" ${page<=1?'disabled':''} onclick="${fn}(-1)">← Previous</button><span>${total?`${first}–${last} of ${total}`:`0 ${label}`} • Page ${page}/${pages}</span><button class="shahid-btn" ${page>=pages?'disabled':''} onclick="${fn}(1)">Next →</button></div>`};

async function getShahidProductIds(){
  if(shahidProductIdsCache)return shahidProductIdsCache;
  const{data,error}=await supabaseClient.from('products').select('id,app_name').ilike('app_name','shahid');
  if(error)throw error;
  shahidProductIdsCache=(data||[]).map(x=>x.id);
  return shahidProductIdsCache;
}

/* Replace the normal loaders so Shahid never appears mixed into the generic lists. */
loadAdminOrdersClean=async function(){
  const c=document.getElementById('ordersList');if(!c||!currentAdminUser)return;
  c.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>Loading orders...</div></div>';
  try{
    const shahidIds=await getShahidProductIds(),from=(adminOrderPage-1)*ADMIN_ORDER_PAGE_SIZE,to=from+ADMIN_ORDER_PAGE_SIZE-1;
    let q=supabaseClient.from('orders').select('id,subscription_code,user_id,customer_id,product_id,price_paid,status,customer_profile_name,created_at,activated_at,expires_at,delivery_account,delivery_password,delivery_profile,delivery_pin,delivery_url,delivery_notes,rejection_reason',{count:'exact'}).order('created_at',{ascending:false}).range(from,to);
    if(adminOrderFilter!=='all')q=q.eq('status',adminOrderFilter);
    for(const id of shahidIds)q=q.neq('product_id',id);
    const{data,error,count}=await q;if(error)throw error;
    adminOrderTotal=count||0;adminOrders=data||[];
    const uids=[...new Set(adminOrders.map(x=>x.user_id).filter(Boolean))],pids=[...new Set(adminOrders.map(x=>x.product_id).filter(Boolean))],cids=[...new Set(adminOrders.map(x=>x.customer_id).filter(Boolean))];
    const[rr,pr,cr]=await Promise.all([uids.length?supabaseClient.from('profiles').select('id,username,business_name,reseller_code').in('id',uids):Promise.resolve({data:[]}),pids.length?supabaseClient.from('products').select('id,app_name,account_type,duration,logo_url').in('id',pids):Promise.resolve({data:[]}),cids.length?supabaseClient.from('customers').select('id,first_name,last_name,phone').in('id',cids):Promise.resolve({data:[]})]);
    if(rr.error||pr.error||cr.error)throw(rr.error||pr.error||cr.error);
    adminOrderProfiles=rr.data||[];adminOrderProducts=pr.data||[];adminOrderCustomers=cr.data||[];renderAdminOrders();
  }catch(e){console.error('[SUBLY] regular orders',e);c.innerHTML=`<div class="empty">${escapeHtml(e.message||'Could not load orders.')}</div>`}
};

loadAdminRenewals=async function(){
  const c=document.getElementById('renewalsList');if(!c||!currentAdminUser)return;
  c.innerHTML='<div class="empty"><div class="empty-icon">🔁</div><div>Loading renewals...</div></div>';
  try{
    const shahidIds=await getShahidProductIds(),from=(adminRenewalPage-1)*ADMIN_ORDER_PAGE_SIZE,to=from+ADMIN_ORDER_PAGE_SIZE-1;
    let q=supabaseClient.from('renewals').select('id,renewal_number,order_id,user_id,renewal_product_id,price_paid,old_expires_at,new_expires_at,status,created_at,completed_at',{count:'exact'}).order('created_at',{ascending:false}).range(from,to);
    for(const id of shahidIds)q=q.neq('renewal_product_id',id);
    const{data,error,count}=await q;if(error)throw error;
    adminRenewalTotal=count||0;const rows=data||[];
    if(!rows.length){c.innerHTML='<div class="empty"><div class="empty-icon">🔁</div><div>No non-Shahid renewal requests here.</div></div>'+orderPager(adminRenewalTotal,adminRenewalPage,'changeAdminRenewalPage','renewals');return}
    const uids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))],pids=[...new Set(rows.map(x=>x.renewal_product_id).filter(Boolean))];
    const[rr,pr]=await Promise.all([uids.length?supabaseClient.from('profiles').select('id,username,business_name').in('id',uids):Promise.resolve({data:[]}),pids.length?supabaseClient.from('products').select('id,app_name,account_type,duration,logo_url').in('id',pids):Promise.resolve({data:[]})]);
    if(rr.error||pr.error)throw(rr.error||pr.error);const profiles=rr.data||[],products=pr.data||[];
    c.innerHTML=rows.map(x=>{const r=profiles.find(v=>v.id===x.user_id)||{},p=products.find(v=>v.id===x.renewal_product_id)||{};return `<article class="order-card"><div class="order-top"><div class="admin-order-title">${adminOrderLogo(p)}<div><div class="order-number">Subscription ID ${escapeHtml(adminSubscriptionId({id:x.order_id}))}</div><div class="order-name">${escapeHtml(p.app_name||'Subscription')}</div><div class="order-reseller">${escapeHtml(r.business_name||r.username||'Unknown reseller')}</div></div></div><span class="status-badge ${escapeHtml(x.status||'')}">${escapeHtml(x.status||'unknown')}</span></div><div class="order-v2-grid"><div><span>Account Type</span><strong>${escapeHtml(p.account_type||'Standard')}</strong></div><div><span>Duration</span><strong>${escapeHtml(p.duration||'—')}</strong></div><div><span>Price Paid</span><strong>${money(x.price_paid)}</strong></div><div><span>Requested</span><strong>${escapeHtml(formatDateTime(x.created_at))}</strong></div><div><span>Current Expiry</span><strong>${escapeHtml(formatDateTime(x.old_expires_at))}</strong></div><div><span>New Expiry</span><strong>${escapeHtml(formatDateTime(x.new_expires_at))}</strong></div></div>${x.status==='pending'?`<div class="order-actions"><button class="order-button success" onclick="openCompleteRenewal('${x.id}')">✓ Complete Renewal</button><button class="order-button danger" onclick="openCancelRenewal('${x.id}')">✕ Cancel & Refund</button></div>`:''}</article>`}).join('')+orderPager(adminRenewalTotal,adminRenewalPage,'changeAdminRenewalPage','renewals');
  }catch(e){console.error('[SUBLY] regular renewals',e);c.innerHTML=`<div class="empty">${escapeHtml(e.message||'Could not load renewals.')}</div>`}
};

switchAdminOrderView=function(view){
  if(!['subscriptions','shahid','renewals'].includes(view))return;
  document.querySelectorAll('[data-admin-order-view]').forEach(b=>b.classList.toggle('active',b.dataset.adminOrderView===view));
  document.getElementById('subscriptionOrdersView')?.classList.toggle('active',view==='subscriptions');
  document.getElementById('shahidOrdersView')?.classList.toggle('active',view==='shahid');
  document.getElementById('renewalOrdersView')?.classList.toggle('active',view==='renewals');
  if(view==='shahid'){history.replaceState(null,'',location.pathname+location.search+'#shahid');loadShahidAdminControl()}
  else{if(location.hash==='#shahid')history.replaceState(null,'',location.pathname+location.search);if(view==='renewals')loadAdminRenewals();else loadAdminOrdersClean()}
};

function refreshActiveAdminOrderView(){
  if(document.getElementById('shahidOrdersView')?.classList.contains('active'))return loadShahidAdminControl(true);
  if(document.getElementById('renewalOrdersView')?.classList.contains('active'))return loadAdminRenewals();
  return loadAdminOrdersClean();
}

async function loadShahidHealth(){
  const panel=document.getElementById('shahidHealthPanel');if(!panel||!currentAdminUser)return;
  const[{data,error},{data:edgeData,error:edgeError}]=await Promise.all([
    supabaseClient.rpc('admin_get_tvleb_shahid_alert_summary'),
    supabaseClient.functions.invoke('tvleb-shahid',{body:{action:'status'}})
  ]);
  if(error){panel.className='shahid-health danger';panel.innerHTML=`<div class="shahid-health-title">Could not read Shahid automation health</div><div class="shahid-health-copy">${escapeHtml(error.message||'Unknown error')}</div>`;return}
  const s=data||{},danger=Number(s.unknownPurchases||0)+Number(s.openCritical||0),warning=Number(s.openWarning||0);
  panel.className='shahid-health'+(danger?' danger':warning?' warning':'');
  const configured=edgeError?null:edgeData?.configured;
  panel.innerHTML=`<div class="shahid-health-head"><div><div class="shahid-health-title">${danger?'🚨 Shahid automation needs attention':warning?'⚠️ Shahid automation has warnings':'✓ Shahid automation control center'}</div><div class="shahid-health-copy">${danger?'A risky supplier result is blocked. The affected reseller queue will not continue until it is resolved.':warning?'Orders are protected, but review the warning details below.':'Queue, supplier polling and safety guards are reporting normally.'}</div></div><span class="shahid-live-pill ${s.livePurchaseEnabled?'on':'off'}">LIVE BUY ${s.livePurchaseEnabled?'ON':'OFF'}</span></div><div class="shahid-stats"><div class="shahid-stat"><span>API Key</span><strong>${configured===null?'—':configured?'Ready':'Missing'}</strong></div><div class="shahid-stat"><span>Mappings</span><strong>${Number(s.enabledMappings||0)}/${Number(s.totalMappings||0)}</strong></div><div class="shahid-stat"><span>Queued</span><strong>${Number(s.queuedOrders||0)}</strong></div><div class="shahid-stat"><span>Supplier Pending</span><strong>${Number(s.pendingSupplier||0)}</strong></div><div class="shahid-stat warning"><span>Warnings</span><strong>${Number(s.openWarning||0)}</strong></div><div class="shahid-stat danger"><span>Critical / Unknown</span><strong>${danger}</strong></div></div>`;
  const badge=document.getElementById('shahidDangerTabBadge');if(badge){badge.textContent=danger+warning?String(danger+warning):'';badge.style.display=danger+warning?'inline-grid':'none'}
}

function switchShahidAdminSection(section){
  if(!['orders','renewals','alerts'].includes(section))return;shahidAdminSection=section;
  document.querySelectorAll('[data-shahid-section]').forEach(b=>b.classList.toggle('active',b.dataset.shahidSection===section));
  document.querySelectorAll('.shahid-section').forEach(x=>x.classList.toggle('active',x.id===`shahid${section[0].toUpperCase()+section.slice(1)}Section`));
  if(section==='orders')loadShahidOrders();else if(section==='renewals')loadShahidRenewals();else loadShahidIncidents();
}

function setShahidOrderFilter(filter){
  if(!['attention','queue','active','manual','delivered','refunded','all'].includes(filter))return;shahidOrderFilter=filter;shahidOrderPage=1;
  document.querySelectorAll('[data-shahid-filter]').forEach(b=>b.classList.toggle('active',b.dataset.shahidFilter===filter));loadShahidOrders();
}
function queueShahidSearch(){clearTimeout(shahidSearchTimer);shahidSearchTimer=setTimeout(()=>{shahidOrderPage=1;loadShahidOrders()},280)}
function changeShahidOrderPage(d){const pages=Math.max(1,Math.ceil(shahidOrderTotal/SHAHID_ADMIN_PAGE_SIZE)),n=shahidOrderPage+d;if(n<1||n>pages)return;shahidOrderPage=n;loadShahidOrders();window.scrollTo({top:0,behavior:'smooth'})}

async function loadShahidOrders(){
  const c=document.getElementById('shahidOrdersList');if(!c||!currentAdminUser)return;
  c.innerHTML='<div class="shahid-empty">Loading Shahid orders…</div>';
  const search=document.getElementById('shahidOrderSearch')?.value.trim()||null;
  const{data,error}=await supabaseClient.rpc('admin_get_tvleb_shahid_orders_page',{p_filter:shahidOrderFilter,p_search:search,p_page:shahidOrderPage,p_page_size:SHAHID_ADMIN_PAGE_SIZE});
  if(error){c.innerHTML=`<div class="shahid-empty">${escapeHtml(error.message||'Could not load Shahid orders.')}</div>`;return}
  shahidOrderTotal=Number(data?.total||0);shahidOrderRows=Array.isArray(data?.rows)?data.rows:[];renderShahidOrders();
}

function renderShahidOrders(){
  const c=document.getElementById('shahidOrdersList');if(!c)return;
  if(!shahidOrderRows.length){c.innerHTML='<div class="shahid-empty">No Shahid orders in this category.</div>'+shahidPager(shahidOrderTotal,shahidOrderPage,'changeShahidOrderPage');return}
  c.innerHTML=shahidOrderRows.map(r=>{
    const state=r.automation_state||r.status,automated=Boolean(r.guard_state||r.supplier_subscription_id||(r.mapping_enabled&&r.live_purchase_enabled)),attention=state==='attention';
    const logo=r.logo_url?`<img class="shahid-logo" src="${escapeHtml(r.logo_url)}" alt="Shahid">`:'<div class="shahid-logo" style="display:grid;place-items:center;font-weight:900">S</div>';
    const customer=shahidName(r),reseller=r.business_name||r.username||'Unknown reseller';
    const supplierInfo=r.supplier_subscription_id?`${escapeHtml(r.supplier_subscription_id)}${r.supplier_profile_name?` • ${escapeHtml(r.supplier_profile_name)}`:''}`:'Not linked yet';
    const incident=r.latest_incident_message?`<div class="shahid-note ${r.latest_incident_severity==='critical'?'danger':'warning'}"><strong>${escapeHtml(String(r.latest_incident_severity||'warning').toUpperCase())}:</strong> ${escapeHtml(r.latest_incident_message)}${r.latest_incident_code?`<br><small>${escapeHtml(r.latest_incident_code)}</small>`:''}</div>`:'';
    let actions='';
    if(r.status==='processing'&&r.guard_state==='unknown')actions=`<button class="shahid-btn danger" onclick="openShahidRecovery('${r.id}')">🚨 Inspect & Recover</button>`;
    else if(r.status==='processing'&&state==='manual')actions=`<button class="shahid-btn primary" onclick="openShahidManualDelivery('${r.id}')">✓ Manual Deliver</button><button class="shahid-btn danger" onclick="refundManualShahidOrder('${r.id}')">✕ Manual Refund</button>`;
    else if(r.status==='processing'&&automated)actions=`<button class="shahid-btn" onclick="loadShahidOrders()">↻ Refresh Status</button>`;
    if(r.open_incident_count>0)actions+=`<button class="shahid-btn warning" onclick="switchShahidAdminSection('alerts')">View Alerts (${Number(r.open_incident_count)})</button>`;
    return `<article class="shahid-card ${escapeHtml(state)}"><div class="shahid-card-head"><div class="shahid-title-wrap">${logo}<div><div class="shahid-order-title">${escapeHtml(shahidSubId(r))} • ${escapeHtml(r.account_type||'Standard')} • ${escapeHtml(r.duration||'—')}</div><div class="shahid-order-sub">${escapeHtml(reseller)} • Ordered ${escapeHtml(shahidDate(r.created_at))}</div></div></div><span class="shahid-state ${escapeHtml(state)}">${escapeHtml(shahidStateLabel(state))}</span></div><div class="shahid-grid"><div><span>OStories reseller card</span><strong>${escapeHtml(reseller)}</strong><small>${escapeHtml(r.reseller_phone||'Phone missing')}</small></div><div><span>Subly end customer</span><strong>${escapeHtml(customer)}</strong><small>${escapeHtml(r.customer_phone||'—')}</small></div><div><span>Queue</span><strong>${r.status==='processing'&&r.queue_position?`Position #${Number(r.queue_position)}`:'—'}</strong><small>${r.guard_state?`Guard: ${escapeHtml(r.guard_state)}`:r.mapping_enabled?'Ready for automation':'Manual / mapping off'}</small></div><div><span>Price</span><strong>${money(r.price_paid)}</strong><small>Supplier cost ${r.supplier_price!=null?money(r.supplier_price):r.supplier_cost!=null?money(r.supplier_cost):'—'}</small></div><div><span>Supplier subscription</span><strong>${supplierInfo}</strong><small>Status ${escapeHtml(r.supplier_status||'—')}</small></div><div><span>Supplier checks</span><strong>${Number(r.check_attempts||0)} checks</strong><small>${r.last_checked_at?`Last ${escapeHtml(shahidDate(r.last_checked_at))}`:'Not checked yet'}</small></div><div><span>Expiry</span><strong>${escapeHtml(shahidDate(r.supplier_expiry_at||r.expires_at))}</strong><small>${r.fulfilled_at?'Fulfilled':'Supplier expiry used when delivered'}</small></div><div><span>Automation safety</span><strong>${r.guard_state==='unknown'?'QUEUE FROZEN':automated?'Protected':'Manual'}</strong><small>${r.baseline_count?`${Number(r.baseline_count)} pre-buy profile(s) saved`:r.guard_state?'No saved baseline shown':'—'}</small></div></div>${r.guard_last_error?`<div class="shahid-note danger">${escapeHtml(r.guard_last_error)}</div>`:''}${r.supplier_last_error?`<div class="shahid-note warning">Supplier check: ${escapeHtml(r.supplier_last_error)}</div>`:''}${incident}${r.status==='delivered'?`<div class="shahid-note"><strong>Delivered:</strong> ${escapeHtml(r.delivery_account||'—')}${r.delivery_profile?` • Profile ${escapeHtml(r.delivery_profile)}`:''}</div>`:''}${r.status==='refunded'&&r.rejection_reason?`<div class="shahid-note danger">Refund: ${escapeHtml(r.rejection_reason)}</div>`:''}${actions?`<div class="shahid-actions">${actions}</div>`:''}</article>`;
  }).join('')+shahidPager(shahidOrderTotal,shahidOrderPage,'changeShahidOrderPage');
}

function setShahidRenewalStatus(status){if(!['pending','completed','cancelled','all'].includes(status))return;shahidRenewalStatus=status;shahidRenewalPage=1;document.querySelectorAll('[data-shahid-renewal-filter]').forEach(b=>b.classList.toggle('active',b.dataset.shahidRenewalFilter===status));loadShahidRenewals()}
function changeShahidRenewalPage(d){const pages=Math.max(1,Math.ceil(shahidRenewalTotal/SHAHID_ADMIN_PAGE_SIZE)),n=shahidRenewalPage+d;if(n<1||n>pages)return;shahidRenewalPage=n;loadShahidRenewals()}
async function loadShahidRenewals(){
  const c=document.getElementById('shahidRenewalsList');if(!c||!currentAdminUser)return;c.innerHTML='<div class="shahid-empty">Loading Shahid renewals…</div>';
  const{data,error}=await supabaseClient.rpc('admin_get_tvleb_shahid_renewals_page',{p_status:shahidRenewalStatus,p_page:shahidRenewalPage,p_page_size:SHAHID_ADMIN_PAGE_SIZE});
  if(error){c.innerHTML=`<div class="shahid-empty">${escapeHtml(error.message||'Could not load Shahid renewals.')}</div>`;return}
  shahidRenewalTotal=Number(data?.total||0);shahidRenewalRows=Array.isArray(data?.rows)?data.rows:[];
  if(!shahidRenewalRows.length){c.innerHTML='<div class="shahid-empty">No Shahid renewals in this category.</div>'+shahidPager(shahidRenewalTotal,shahidRenewalPage,'changeShahidRenewalPage','renewals');return}
  c.innerHTML=shahidRenewalRows.map(r=>`<article class="shahid-card"><div class="shahid-card-head"><div><div class="shahid-order-title">${escapeHtml(r.subscription_code||`Renewal #${r.renewal_number}`)} • ${escapeHtml(r.account_type||'Shahid')} • ${escapeHtml(r.duration||'—')}</div><div class="shahid-order-sub">${escapeHtml(r.business_name||r.username||'Unknown reseller')} • ${escapeHtml(shahidDate(r.created_at))}</div></div><span class="status-badge ${escapeHtml(r.status||'')}">${escapeHtml(r.status||'unknown')}</span></div><div class="shahid-grid"><div><span>Reseller phone</span><strong>${escapeHtml(r.reseller_phone||'—')}</strong></div><div><span>Price</span><strong>${money(r.price_paid)}</strong></div><div><span>Old expiry</span><strong>${escapeHtml(shahidDate(r.old_expires_at))}</strong></div><div><span>New expiry</span><strong>${escapeHtml(shahidDate(r.new_expires_at))}</strong></div></div>${r.status==='pending'?`<div class="shahid-actions"><button class="shahid-btn primary" onclick="completeShahidRenewal('${r.id}')">✓ I Renewed It in OStories</button><button class="shahid-btn danger" onclick="cancelShahidRenewal('${r.id}')">✕ Cancel & Refund</button></div>`:''}</article>`).join('')+shahidPager(shahidRenewalTotal,shahidRenewalPage,'changeShahidRenewalPage','renewals');
}
async function completeShahidRenewal(id){if(!confirm('Only continue if you already completed this Shahid renewal in OStories. Mark it completed now?'))return;const{error}=await supabaseClient.rpc('complete_renewal',{p_renewal_id:id});if(error)return alert(error.message||'Could not complete renewal.');await loadShahidRenewals();await loadShahidHealth()}
async function cancelShahidRenewal(id){if(!confirm('Cancel this Shahid renewal and refund the reseller wallet?'))return;const{error}=await supabaseClient.rpc('cancel_renewal',{p_renewal_id:id});if(error)return alert(error.message||'Could not cancel renewal.');await loadShahidRenewals();await loadShahidHealth()}

function setShahidIncidentState(state){if(!['open','resolved','all'].includes(state))return;shahidIncidentState=state;shahidIncidentPage=1;document.querySelectorAll('[data-shahid-incident-filter]').forEach(b=>b.classList.toggle('active',b.dataset.shahidIncidentFilter===state));loadShahidIncidents()}
function changeShahidIncidentPage(d){const pages=Math.max(1,Math.ceil(shahidIncidentTotal/SHAHID_ADMIN_PAGE_SIZE)),n=shahidIncidentPage+d;if(n<1||n>pages)return;shahidIncidentPage=n;loadShahidIncidents()}
async function loadShahidIncidents(){
  const c=document.getElementById('shahidIncidentsList');if(!c||!currentAdminUser)return;c.innerHTML='<div class="shahid-empty">Loading automation alerts…</div>';
  const{data,error}=await supabaseClient.rpc('admin_get_tvleb_shahid_incidents_page',{p_state:shahidIncidentState,p_page:shahidIncidentPage,p_page_size:SHAHID_ADMIN_PAGE_SIZE});
  if(error){c.innerHTML=`<div class="shahid-empty">${escapeHtml(error.message||'Could not load alerts.')}</div>`;return}
  shahidIncidentTotal=Number(data?.total||0);shahidIncidentRows=Array.isArray(data?.rows)?data.rows:[];
  if(!shahidIncidentRows.length){c.innerHTML='<div class="shahid-empty">No Shahid automation alerts here.</div>'+shahidPager(shahidIncidentTotal,shahidIncidentPage,'changeShahidIncidentPage','alerts');return}
  c.innerHTML=shahidIncidentRows.map(i=>{const canResolve=!i.resolved&&(i.severity!=='critical'||i.order_status!=='processing');return `<article class="shahid-incident ${escapeHtml(i.severity||'')}"><div class="shahid-incident-head"><div><div class="shahid-incident-code">${i.severity==='critical'?'🚨':i.severity==='warning'?'⚠️':'ℹ️'} ${escapeHtml(String(i.severity||'info').toUpperCase())} • ${escapeHtml(i.code||'automation_alert')}</div><div class="shahid-order-sub">${escapeHtml(i.subscription_code||'No order')} • ${escapeHtml(i.business_name||i.username||'Unknown reseller')} • ${escapeHtml(shahidDate(i.created_at))}</div></div><span class="status-badge ${i.resolved?'delivered':'processing'}">${i.resolved?'resolved':'open'}</span></div><div class="shahid-incident-message">${escapeHtml(i.message||'No details')}</div>${!i.resolved?`<div class="shahid-actions">${i.order_status==='processing'&&i.severity==='critical'&&i.order_id?`<button class="shahid-btn danger" onclick="openShahidRecovery('${i.order_id}')">Resolve Order</button>`:''}${canResolve?`<button class="shahid-btn" onclick="resolveShahidIncident('${i.id}')">Mark Reviewed</button>`:''}</div>`:''}</article>`}).join('')+shahidPager(shahidIncidentTotal,shahidIncidentPage,'changeShahidIncidentPage','alerts');
}
async function resolveShahidIncident(id){const{error}=await supabaseClient.rpc('admin_resolve_tvleb_shahid_incident',{p_incident_id:id});if(error)return alert(error.message||'Could not resolve alert.');await Promise.all([loadShahidIncidents(),loadShahidHealth()])}

async function invokeShahidAdmin(body){
  const{data,error}=await supabaseClient.functions.invoke('tvleb-shahid',{body});
  if(!error)return{data,error:null};
  let details=null;try{if(error.context&&typeof error.context.json==='function')details=await error.context.json()}catch{}
  return{data:details,error};
}

function openShahidRecovery(orderId){
  const r=shahidOrderRows.find(x=>x.id===orderId)||{id:orderId,subscription_code:null};selectedShahidAdminOrder=r;
  document.getElementById('shahidRecoverySummary').innerHTML=`<strong>${escapeHtml(shahidSubId(r))}</strong><br>${escapeHtml(r.business_name||r.username||'Reseller')} • OStories phone ${escapeHtml(r.reseller_phone||'—')}`;
  document.getElementById('shahidSupplierResults').innerHTML='<div class="shahid-empty">Click “Inspect OStories” to safely read the supplier account. No purchase will be made.</div>';
  document.getElementById('shahidRecoverySupplierId').value=r.supplier_subscription_id||'';document.getElementById('shahidRecoveryProfile').value=r.supplier_profile_name||'';
  document.getElementById('shahidRecoveryConfirm').value='';document.getElementById('shahidRecoveryManualVerified').checked=false;setShahidRecoveryMessage('');
  document.getElementById('shahidRecoveryModal').classList.add('show');
}
function closeShahidRecovery(){document.getElementById('shahidRecoveryModal')?.classList.remove('show');selectedShahidAdminOrder=null}
function setShahidRecoveryMessage(text,type=''){const el=document.getElementById('shahidRecoveryMessage');if(el){el.textContent=text;el.className='shahid-message'+(type?` ${type}`:'')}}
async function inspectShahidRecovery(){
  if(!selectedShahidAdminOrder)return;const box=document.getElementById('shahidSupplierResults');box.innerHTML='<div class="shahid-empty">Reading OStories…</div>';setShahidRecoveryMessage('');
  const{data,error}=await invokeShahidAdmin({action:'inspect_order',orderId:selectedShahidAdminOrder.id});
  if(error||!data?.ok){box.innerHTML=`<div class="shahid-empty">${escapeHtml(data?.error||error?.message||'Could not inspect OStories.')}</div>`;return}
  const rows=Array.isArray(data.supplier)?data.supplier:[];
  box.innerHTML=rows.length?rows.map(x=>`<div class="shahid-supplier-row"><div class="shahid-supplier-row-top"><div><strong>${escapeHtml(x.email||'No email')} ${x.profileName?`• ${escapeHtml(x.profileName)}`:''}</strong><small>ID ${escapeHtml(x.id||'—')} • ${escapeHtml(x.status||'—')} • Expires ${escapeHtml(shahidDate(x.expiryDate))}</small></div><button class="shahid-btn" data-supplier-id="${escapeHtml(x.id||'')}" data-profile="${escapeHtml(x.profileName||'')}" onclick="chooseShahidSupplierCandidate(this)">Use</button></div></div>`).join(''):'<div class="shahid-empty">No Shahid subscriptions were returned for this reseller phone.</div>';
  setShahidRecoveryMessage(`Supplier check completed. Saved pre-buy baseline: ${Number(data.guard?.baselineCount||0)} profile(s).`,'success');
}
function chooseShahidSupplierCandidate(btn){document.getElementById('shahidRecoverySupplierId').value=btn.dataset.supplierId||'';document.getElementById('shahidRecoveryProfile').value=btn.dataset.profile||'';setShahidRecoveryMessage('Supplier subscription selected. Review it, then click Link & Recover.','success')}
async function recoverShahidUnknown(){
  if(!selectedShahidAdminOrder)return;const id=document.getElementById('shahidRecoverySupplierId').value.trim(),profile=document.getElementById('shahidRecoveryProfile').value.trim();if(!id)return setShahidRecoveryMessage('Enter or select the supplier subscription ID.','error');
  if(!confirm('Link this OStories subscription to the blocked Subly order? This does NOT buy anything.'))return;
  setShahidRecoveryMessage('Verifying the supplier subscription…');
  const{data,error}=await invokeShahidAdmin({action:'recover_unknown',orderId:selectedShahidAdminOrder.id,supplierSubscriptionId:id,profileName:profile});
  if(error||!data?.ok){setShahidRecoveryMessage(data?.error||error?.message||'Recovery could not be completed.','error');if(Array.isArray(data?.candidates)&&data.candidates.length){document.getElementById('shahidSupplierResults').innerHTML=data.candidates.map(x=>`<div class="shahid-supplier-row"><div class="shahid-supplier-row-top"><div><strong>${escapeHtml(x.email||'No email')} ${x.profileName?`• ${escapeHtml(x.profileName)}`:''}</strong><small>ID ${escapeHtml(x.id||'—')} • ${escapeHtml(x.status||'—')}</small></div><button class="shahid-btn" data-supplier-id="${escapeHtml(x.id||'')}" data-profile="${escapeHtml(x.profileName||'')}" onclick="chooseShahidSupplierCandidate(this)">Use</button></div></div>`).join('')}return}
  setShahidRecoveryMessage(data.delivered?'Recovered and delivered successfully.':'Recovered safely. Supplier fulfillment is still pending and automatic polling will continue.','success');await Promise.all([loadShahidHealth(),loadShahidOrders()]);setTimeout(closeShahidRecovery,900)
}
async function refundUnknownShahid(){
  if(!selectedShahidAdminOrder)return;const confirmation=document.getElementById('shahidRecoveryConfirm').value.trim(),manualVerified=document.getElementById('shahidRecoveryManualVerified').checked;if(confirmation.toUpperCase()!=='REFUND')return setShahidRecoveryMessage('Type REFUND exactly before using the refund recovery.','error');
  if(!manualVerified&&!confirm('Subly will run a supplier safety check first. Continue?'))return;
  if(!confirm('FINAL CHECK: You are confirming that OStories did NOT create this Shahid purchase. Refund the reseller and release the next queued order?'))return;
  setShahidRecoveryMessage('Re-checking OStories before refund…');
  const{data,error}=await invokeShahidAdmin({action:'confirm_not_purchased',orderId:selectedShahidAdminOrder.id,confirmation:'REFUND',manualVerified});
  if(error||!data?.ok){setShahidRecoveryMessage(data?.error||error?.message||'Refund recovery was blocked.','error');return}
  setShahidRecoveryMessage('Verified and refunded. The reseller Shahid queue can continue.','success');await Promise.all([loadShahidHealth(),loadShahidOrders()]);setTimeout(closeShahidRecovery,900)
}

function openShahidManualDelivery(orderId){
  const r=shahidOrderRows.find(x=>x.id===orderId);if(!r)return;selectedShahidAdminOrder=r;
  document.getElementById('shahidManualSummary').textContent=`${shahidSubId(r)} • ${r.account_type||'Shahid'} • ${r.duration||'—'} • ${r.business_name||r.username||'Reseller'}`;
  ['shahidManualAccount','shahidManualPassword','shahidManualProfile','shahidManualNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('shahidManualProfileWrap').style.display=String(r.account_type||'').toLowerCase().includes('full')?'none':'';document.getElementById('shahidManualMessage').textContent='';document.getElementById('shahidManualDeliveryModal').classList.add('show');
}
function closeShahidManualDelivery(){document.getElementById('shahidManualDeliveryModal')?.classList.remove('show');selectedShahidAdminOrder=null}
async function submitShahidManualDelivery(){
  const r=selectedShahidAdminOrder;if(!r)return;const account=document.getElementById('shahidManualAccount').value.trim(),password=document.getElementById('shahidManualPassword').value.trim(),profile=document.getElementById('shahidManualProfile').value.trim(),notes=document.getElementById('shahidManualNotes').value.trim();const msg=document.getElementById('shahidManualMessage');
  if(!account||!password||(!String(r.account_type||'').toLowerCase().includes('full')&&!profile)){msg.textContent='Fill the required Shahid account details.';msg.className='shahid-message error';return}
  const{error}=await supabaseClient.rpc('admin_deliver_order',{p_order_id:r.id,p_account:account,p_password:password,p_profile:profile||null,p_pin:null,p_url:null,p_notes:notes||null});if(error){msg.textContent=error.message||'Could not deliver Shahid order.';msg.className='shahid-message error';return}msg.textContent='Shahid order delivered.';msg.className='shahid-message success';await loadShahidOrders();setTimeout(closeShahidManualDelivery,700)
}
async function refundManualShahidOrder(orderId){const r=shahidOrderRows.find(x=>x.id===orderId);if(!r)return;if(!confirm(`Refund ${shahidSubId(r)}? Only use this for a manual Shahid order that was NOT purchased by automation.`))return;const reason=prompt('Refund reason (optional):','Manual Shahid order cancelled')||null;const{error}=await supabaseClient.rpc('admin_reject_order',{p_order_id:orderId,p_reason:reason});if(error)return alert(error.message||'Could not refund order.');await Promise.all([loadShahidOrders(),loadShahidHealth()])}

async function loadShahidAdminControl(force=false){
  if(!currentAdminUser)return;await loadShahidHealth();
  if(force||shahidAdminSection==='orders')await loadShahidOrders();
  else if(shahidAdminSection==='renewals')await loadShahidRenewals();
  else await loadShahidIncidents();
  if(!shahidHealthTimer)shahidHealthTimer=setInterval(()=>{if(document.getElementById('shahidOrdersView')?.classList.contains('active'))loadShahidHealth()},30000);
}

window.addEventListener('subly:admin-ready',()=>{
  if(document.body?.dataset?.page!=='orders-clean')return;
  loadShahidHealth();
  if(location.hash==='#shahid')setTimeout(()=>switchAdminOrderView('shahid'),0);
});
