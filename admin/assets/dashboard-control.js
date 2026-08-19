/* Subly admin dashboard control center — read-only overview layer. */
(()=>{
  'use strict';

  const qs=id=>document.getElementById(id);
  const num=v=>Number(v||0);
  const safeMoney=v=>typeof money==='function'?money(v):('$'+num(v).toFixed(2));
  const safeDate=v=>typeof formatDateTime==='function'?formatDateTime(v):(v?new Date(v).toLocaleString():'—');
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(v):String(v??'');
  let loading=false;
  let attentionLoading=false;
  let attentionTimer=null;

  function setText(id,value){const el=qs(id);if(el)el.textContent=value}
  function setAttention(id,value,tone='warning'){
    const el=qs(id);if(!el)return;
    setText(`${id}Value`,String(value));
    el.classList.remove('critical','warning','good');
    el.classList.add(value>0?tone:'good');
  }
  function stampLiveUpdate(){
    setText('dashboardLastUpdated',`Live • ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`);
  }
  function renderAttention(c){
    const topups=c.topups?.error?0:num(c.topups?.count);
    const renewals=c.pendingRenewals?.error?0:num(c.pendingRenewals?.count);
    const issues=c.openIssues?.error?0:num(c.openIssues?.count);
    const processing=c.processing?.error?0:num(c.processing?.count);
    const shahidOpen=c.shahid?.error?0:Math.max(num(c.shahid?.data?.openIncidents),num(c.shahid?.data?.unknownPurchases));
    setAttention('attentionShahid',shahidOpen,'critical');
    setAttention('attentionTopups',topups,'warning');
    setAttention('attentionRenewals',renewals,'warning');
    setAttention('attentionSupport',issues,'warning');
    setAttention('attentionOrders',processing,'warning');
    setText('attentionTotal',String(shahidOpen+topups+renewals+issues+processing));
    if(!c.topups?.error)setText('topupCount',String(c.topups.count??0));
    stampLiveUpdate();
  }

  async function getAttentionCounts(){
    const [topups,pendingRenewals,openIssues,processing,shahid]=await Promise.all([
      supabaseClient.from('topup_requests').select('id',{count:'exact',head:true}).eq('status','pending'),
      supabaseClient.from('renewals').select('id',{count:'exact',head:true}).eq('status','pending'),
      supabaseClient.from('subscription_issues').select('id',{count:'exact',head:true}).in('status',['open','in_progress']),
      supabaseClient.from('orders').select('id',{count:'exact',head:true}).eq('status','processing'),
      supabaseClient.rpc('admin_get_tvleb_shahid_alert_summary')
    ]);
    return{topups,pendingRenewals,openIssues,processing,shahid};
  }

  async function getCounts(){
    const [resellers,orders,topups,walletSummary,pendingRenewals,openIssues,processing,shahid]=await Promise.all([
      supabaseClient.from('profiles').select('id',{count:'exact',head:true}).eq('role','reseller'),
      supabaseClient.from('orders').select('id',{count:'exact',head:true}),
      supabaseClient.from('topup_requests').select('id',{count:'exact',head:true}).eq('status','pending'),
      supabaseClient.rpc('admin_wallet_summary'),
      supabaseClient.from('renewals').select('id',{count:'exact',head:true}).eq('status','pending'),
      supabaseClient.from('subscription_issues').select('id',{count:'exact',head:true}).in('status',['open','in_progress']),
      supabaseClient.from('orders').select('id',{count:'exact',head:true}).eq('status','processing'),
      supabaseClient.rpc('admin_get_tvleb_shahid_alert_summary')
    ]);
    return{resellers,orders,topups,walletSummary,pendingRenewals,openIssues,processing,shahid};
  }

  async function getActivity(){
    const [orders,topups,wallets]=await Promise.all([
      supabaseClient.from('orders').select('id,subscription_code,user_id,product_id,status,price_paid,created_at,delivered_at').order('created_at',{ascending:false}).limit(8),
      supabaseClient.from('topup_requests').select('id,user_id,amount,status,payment_method,created_at,reviewed_at').order('created_at',{ascending:false}).limit(8),
      supabaseClient.from('wallet_transactions').select('id,user_id,amount,type,description,created_at').order('created_at',{ascending:false}).limit(8)
    ]);
    const errors=[orders.error,topups.error,wallets.error].filter(Boolean);
    if(errors.length)throw errors[0];
    const allUsers=[...(orders.data||[]),...(topups.data||[]),...(wallets.data||[])].map(x=>x.user_id).filter(Boolean);
    const allProducts=(orders.data||[]).map(x=>x.product_id).filter(Boolean);
    const [profiles,products]=await Promise.all([
      allUsers.length?supabaseClient.from('profiles').select('id,username,business_name').in('id',[...new Set(allUsers)]):Promise.resolve({data:[],error:null}),
      allProducts.length?supabaseClient.from('products').select('id,app_name').in('id',[...new Set(allProducts)]):Promise.resolve({data:[],error:null})
    ]);
    if(profiles.error||products.error)throw profiles.error||products.error;
    const pmap=new Map((profiles.data||[]).map(x=>[x.id,x]));
    const productMap=new Map((products.data||[]).map(x=>[x.id,x]));
    const resellerName=id=>{const p=pmap.get(id)||{};return p.business_name||p.username||'Unknown reseller'};
    const items=[];
    for(const o of orders.data||[]){
      const app=productMap.get(o.product_id)?.app_name||'Subscription';
      items.push({time:o.delivered_at||o.created_at,sort:new Date(o.delivered_at||o.created_at||0).getTime(),icon:o.status==='delivered'?'✅':o.status==='refunded'?'↩️':'🛒',title:`${app} order ${o.status||'updated'}`,detail:`${resellerName(o.user_id)} • ${o.subscription_code||'Order'}`,amount:safeMoney(o.price_paid)});
    }
    for(const t of topups.data||[]){
      const time=t.status==='pending'?t.created_at:(t.reviewed_at||t.created_at);
      items.push({time,sort:new Date(time||0).getTime(),icon:t.status==='approved'?'💰':t.status==='rejected'?'❌':'💳',title:`Top-up ${t.status||'updated'}`,detail:`${resellerName(t.user_id)} • ${String(t.payment_method||'payment').replaceAll('_',' ')}`,amount:safeMoney(t.amount)});
    }
    for(const w of wallets.data||[]){
      items.push({time:w.created_at,sort:new Date(w.created_at||0).getTime(),icon:w.amount>=0?'➕':'➖',title:`Wallet ${String(w.type||'transaction').replaceAll('_',' ')}`,detail:`${resellerName(w.user_id)}${w.description?' • '+w.description:''}`,amount:`${num(w.amount)>=0?'+':''}${safeMoney(w.amount)}`});
    }
    return items.sort((a,b)=>b.sort-a.sort).slice(0,10);
  }

  function renderActivity(items){
    const box=qs('adminActivityFeed');if(!box)return;
    if(!items.length){box.innerHTML='<div class="dashboard-empty">No recent activity yet.</div>';return}
    box.innerHTML=items.map(x=>`<div class="activity-row"><div class="activity-icon">${esc(x.icon)}</div><div><div class="activity-title">${esc(x.title)}</div><div class="activity-detail">${esc(x.detail)}</div></div><div class="activity-time">${esc(safeDate(x.time))}<span class="activity-amount">${esc(x.amount||'')}</span></div></div>`).join('');
  }

  async function refreshAttention(){
    if(attentionLoading||loading||!currentAdminUser||document.hidden)return;
    attentionLoading=true;
    try{
      renderAttention(await getAttentionCounts());
    }catch(e){
      console.warn('[SUBLY] attention refresh',e?.message||e);
    }finally{
      attentionLoading=false;
    }
  }

  function startAttentionPolling(){
    if(attentionTimer)clearInterval(attentionTimer);
    attentionTimer=setInterval(refreshAttention,5000);
  }

  async function refreshDashboardControl(){
    if(loading||!currentAdminUser)return;
    loading=true;
    const button=qs('dashboardRefresh');if(button){button.disabled=true;button.textContent='Refreshing…'}
    try{
      const[countData,activity]=await Promise.all([getCounts(),getActivity()]);
      const c=countData;
      setText('resellerCount',c.resellers.error?'—':String(c.resellers.count??0));
      setText('orderCount',c.orders.error?'—':String(c.orders.count??0));
      setText('walletTotal',c.walletSummary.error?'—':safeMoney(c.walletSummary.data?.total_balance||0));
      renderAttention(c);
      renderActivity(activity);
    }catch(e){
      console.error('[SUBLY] dashboard control center',e);
      const box=qs('adminActivityFeed');if(box)box.innerHTML='<div class="dashboard-empty">Could not refresh dashboard activity. Try again.</div>';
    }finally{
      loading=false;
      if(button){button.disabled=false;button.textContent='↻ Refresh'}
    }
  }

  window.refreshDashboardControl=refreshDashboardControl;
  window.refreshDashboardAttention=refreshAttention;
  window.addEventListener('subly:admin-ready',()=>{refreshDashboardControl();startAttentionPolling()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAttention()});
})();
