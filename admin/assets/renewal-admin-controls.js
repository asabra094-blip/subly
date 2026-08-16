/* Subly admin renewal controls — status filters + compact Orders mobile controls. */
(function(){
  'use strict';

  let renewalFilter='pending';

  function addStyles(){
    if(document.getElementById('subly-renewal-admin-controls-css'))return;
    const style=document.createElement('style');
    style.id='subly-renewal-admin-controls-css';
    style.textContent=`
      #renewalOrdersView .renewal-status-tabs{display:flex;align-items:center;gap:6px;max-width:100%;margin:0 0 12px!important;padding:4px!important;overflow-x:auto;scrollbar-width:none;border:1px solid rgba(255,255,255,.065);border-radius:12px;background:rgba(0,0,0,.14)}
      #renewalOrdersView .renewal-status-tabs::-webkit-scrollbar{display:none}
      #renewalOrdersView .renewal-status-tab{appearance:none;flex:0 0 auto;min-height:34px;padding:7px 11px;border:1px solid transparent;border-radius:9px;background:transparent;color:#958d9f;font-size:9.5px;font-weight:820;cursor:pointer;transition:.15s ease}
      #renewalOrdersView .renewal-status-tab:hover{color:#f0eaf4;background:rgba(255,255,255,.03)}
      #renewalOrdersView .renewal-status-tab.active{color:#fff;border-color:rgba(166,108,255,.22);background:linear-gradient(135deg,rgba(145,82,246,.22),rgba(218,71,157,.1));box-shadow:0 6px 15px rgba(92,44,163,.08)}
      #renewalOrdersView .renewal-filter-count{margin-left:auto;flex:0 0 auto;padding:0 6px;color:var(--admin-muted,var(--muted));font-size:9px;white-space:nowrap}

      @media(max-width:700px){
        body[data-page="orders-clean"] .panel-head{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;gap:10px!important}
        body[data-page="orders-clean"] .panel-head>.action,
        body[data-page="orders-clean"] .panel-head>button{width:auto!important;min-width:88px!important;min-height:36px!important;padding:7px 10px!important;align-self:center!important}
        body[data-page="orders-clean"] .order-tabs{min-height:0!important;padding:3px!important;margin-bottom:9px!important}
        body[data-page="orders-clean"] .order-tab,
        body[data-page="orders-clean"] #renewalOrdersView .renewal-status-tab{min-height:36px!important;padding:7px 10px!important;font-size:9px!important}
        body[data-page="orders-clean"] .list-pager{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;align-items:center!important;gap:7px!important;margin:14px 0 2px!important}
        body[data-page="orders-clean"] .list-pager .order-button{width:auto!important;min-width:82px!important;min-height:36px!important;padding:7px 9px!important;font-size:9px!important}
        body[data-page="orders-clean"] .list-pager span{min-width:0!important;text-align:center!important;font-size:9px!important;line-height:1.35!important;white-space:normal!important}
        #renewalOrdersView .renewal-status-tabs{gap:4px;padding:3px!important}
        #renewalOrdersView .renewal-filter-count{display:none}
      }
      @media(max-width:380px){
        body[data-page="orders-clean"] .list-pager .order-button{min-width:72px!important;padding:6px 7px!important}
        body[data-page="orders-clean"] .panel-head>.action,
        body[data-page="orders-clean"] .panel-head>button{min-width:78px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRenewalFilters(){
    const view=document.getElementById('renewalOrdersView');
    const list=document.getElementById('renewalsList');
    if(!view||!list)return null;
    let bar=document.getElementById('renewalStatusFilters');
    if(bar)return bar;
    bar=document.createElement('div');
    bar.id='renewalStatusFilters';
    bar.className='renewal-status-tabs';
    bar.innerHTML=`
      <button type="button" class="renewal-status-tab active" data-renewal-filter="pending" onclick="setAdminRenewalFilter('pending')">Pending</button>
      <button type="button" class="renewal-status-tab" data-renewal-filter="completed" onclick="setAdminRenewalFilter('completed')">Accepted</button>
      <button type="button" class="renewal-status-tab" data-renewal-filter="cancelled" onclick="setAdminRenewalFilter('cancelled')">Cancelled</button>
      <button type="button" class="renewal-status-tab" data-renewal-filter="all" onclick="setAdminRenewalFilter('all')">All</button>
      <span class="renewal-filter-count" id="renewalFilterCount"></span>`;
    view.insertBefore(bar,list);
    return bar;
  }

  function syncFilterButtons(){
    document.querySelectorAll('[data-renewal-filter]').forEach(btn=>btn.classList.toggle('active',btn.dataset.renewalFilter===renewalFilter));
  }

  window.setAdminRenewalFilter=function(status){
    if(!['all','pending','completed','cancelled'].includes(status))return;
    renewalFilter=status;
    adminRenewalPage=1;
    syncFilterButtons();
    loadAdminRenewals();
  };

  window.loadAdminRenewals=async function(){
    const c=document.getElementById('renewalsList');
    if(!c||!currentAdminUser)return;
    ensureRenewalFilters();
    syncFilterButtons();
    c.innerHTML='<div class="empty"><div class="empty-icon">🔁</div><div>Loading renewals...</div></div>';

    const from=(adminRenewalPage-1)*ADMIN_ORDER_PAGE_SIZE,to=from+ADMIN_ORDER_PAGE_SIZE-1;
    let q=supabaseClient.from('renewals')
      .select('id,renewal_number,order_id,user_id,renewal_product_id,price_paid,old_expires_at,new_expires_at,status,created_at,completed_at',{count:'exact'})
      .order('created_at',{ascending:false})
      .range(from,to);
    if(renewalFilter!=='all')q=q.eq('status',renewalFilter);
    try{
      const shahidIds=typeof getShahidProductIds==='function'?await getShahidProductIds():[];
      for(const id of shahidIds)q=q.neq('renewal_product_id',id);
    }catch(e){console.error('[SUBLY] Shahid renewal separation',e);c.innerHTML='<div class="empty">Could not separate Shahid renewals safely.</div>';return}

    const{data,error,count}=await q;
    if(error){c.innerHTML=`<div class="empty">${escapeHtml(error.message||'Could not load renewals.')}</div>`;return}
    adminRenewalTotal=count||0;
    const countLabel=document.getElementById('renewalFilterCount');
    const filterLabel=renewalFilter==='completed'?'accepted':renewalFilter;
    if(countLabel)countLabel.textContent=`${adminRenewalTotal} ${renewalFilter==='all'?'renewals':filterLabel}`;

    const rows=data||[];
    if(!rows.length){
      const label=renewalFilter==='all'?'renewal requests':`${filterLabel} renewals`;
      c.innerHTML=`<div class="empty"><div class="empty-icon">🔁</div><div>No ${escapeHtml(label)}.</div></div>`+orderPager(adminRenewalTotal,adminRenewalPage,'changeAdminRenewalPage','renewals');
      return;
    }

    const uids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))],pids=[...new Set(rows.map(x=>x.renewal_product_id).filter(Boolean))];
    const[rr,pr]=await Promise.all([
      uids.length?supabaseClient.from('profiles').select('id,username,business_name').in('id',uids):Promise.resolve({data:[]}),
      pids.length?supabaseClient.from('products').select('id,app_name,account_type,duration,logo_url').in('id',pids):Promise.resolve({data:[]})
    ]);
    if(rr.error||pr.error){const e=rr.error||pr.error;c.innerHTML=`<div class="empty">${escapeHtml(e.message||'Could not load renewal details.')}</div>`;return}
    const profiles=rr.data||[],products=pr.data||[];
    c.innerHTML=rows.map(x=>{
      const r=profiles.find(v=>v.id===x.user_id)||{},p=products.find(v=>v.id===x.renewal_product_id)||{};
      return `<article class="order-card"><div class="order-top"><div class="admin-order-title">${adminOrderLogo(p)}<div><div class="order-number">Subscription ID ${escapeHtml(adminSubscriptionId({id:x.order_id}))}</div><div class="order-name">${escapeHtml(p.app_name||'Subscription')}</div><div class="order-reseller">${escapeHtml(r.business_name||r.username||'Unknown reseller')}</div></div></div><span class="status-badge ${escapeHtml(x.status||'')}">${escapeHtml(x.status==='completed'?'accepted':(x.status||'unknown'))}</span></div><div class="order-v2-grid"><div><span>Account Type</span><strong>${escapeHtml(p.account_type||'Standard')}</strong></div><div><span>Duration</span><strong>${escapeHtml(p.duration||'—')}</strong></div><div><span>Price Paid</span><strong>${money(x.price_paid)}</strong></div><div><span>Requested</span><strong>${escapeHtml(formatDateTime(x.created_at))}</strong></div><div><span>Current Expiry</span><strong>${escapeHtml(formatDateTime(x.old_expires_at))}</strong></div><div><span>New Expiry</span><strong>${escapeHtml(formatDateTime(x.new_expires_at))}</strong></div></div>${x.status==='pending'?`<div class="order-actions"><button class="order-button success" onclick="openCompleteRenewal('${x.id}')">✓ Complete Renewal</button><button class="order-button danger" onclick="openCancelRenewal('${x.id}')">✕ Cancel & Refund</button></div>`:''}</article>`;
    }).join('')+orderPager(adminRenewalTotal,adminRenewalPage,'changeAdminRenewalPage','renewals');
  };

  addStyles();
  ensureRenewalFilters();
})();
