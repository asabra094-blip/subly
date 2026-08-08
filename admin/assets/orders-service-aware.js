/* Service-aware delivery form layered after orders.js */
(function(){
  const key=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let deliveryFields=[];

  function schema(product){
    const app=key(product?.app_name),type=String(product?.account_type||'').toLowerCase();
    if(app==='netflix'){
      if(type.includes('full')) return {hint:'Netflix Full Account: enter only email/account and password.',fields:['account','password']};
      return {hint:'Netflix 1 User: enter only profile name, PIN and Netflix link.',fields:['profile','pin','url']};
    }
    if(app==='osn'||app==='osnplus') return {hint:'OSN: enter email/account, profile and OTP/activation link.',fields:['account','profile','url']};
    if(app==='anghami') return {hint:'Anghami is applied to the exact profile requested by the reseller. No login credentials are needed.',fields:[]};
    if(['amazonprime','amazonprimevideo','primevideo','watchit'].includes(app)) return {hint:`${product?.app_name||'Service'}: enter email/account and password.`,fields:['account','password']};
    if(app==='shahid') return {hint:'Shahid: enter email/account and password. Profile is optional if supplied.',fields:['account','password','profile']};
    return {hint:'Generic service: use only the fields actually supplied.',fields:['account','password','profile','pin','url']};
  }

  const all=['deliverAccount','deliverPassword','deliverProfile','deliverPin','deliverUrl'];
  const fieldMap={account:'deliverAccount',password:'deliverPassword',profile:'deliverProfile',pin:'deliverPin',url:'deliverUrl'};

  function showFields(fields){
    const allowed=new Set(fields.map(x=>fieldMap[x]));
    all.forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      const wrap=el.closest('.form-group');
      if(wrap) wrap.style.display=allowed.has(id)?'':'none';
      if(!allowed.has(id)) el.value='';
    });
  }

  window.openDeliverOrder=function(id){
    const order=adminOrders.find(x=>x.id===id);if(!order)return;
    selectedAdminOrderId=id;
    const p=adminOrderProducts.find(x=>x.id===order.product_id)||{},c=adminOrderCustomers.find(x=>x.id===order.customer_id)||null;
    const s=schema(p);deliveryFields=s.fields;
    document.getElementById('deliverOrderSummary').textContent=`${p.app_name||'Subscription'} • ${p.account_type||'Standard'} • ${p.duration||'—'} • ${adminCustomerName(c)}`;
    all.concat('deliverNotes').forEach(x=>{const el=document.getElementById(x);if(el)el.value=''});
    showFields(deliveryFields);
    const req=document.getElementById('deliverRequestedProfile');
    req.innerHTML=`<strong>${s.hint}</strong>${order.customer_profile_name?`<br>Requested profile: ${escapeHtml(order.customer_profile_name)}`:''}`;
    document.getElementById('deliverMessage').textContent='';
    document.getElementById('deliverOrderModal').classList.add('show');
  };

  window.submitDeliverOrder=async function(){
    if(!selectedAdminOrderId)return;
    const btn=document.getElementById('deliverSubmitButton'),msg=document.getElementById('deliverMessage');
    const has=n=>deliveryFields.includes(n),val=id=>document.getElementById(id)?.value.trim()||null;
    btn.disabled=true;btn.textContent='Delivering…';
    const args={
      p_order_id:selectedAdminOrderId,
      p_account:has('account')?val('deliverAccount'):null,
      p_password:has('password')?val('deliverPassword'):null,
      p_profile:has('profile')?val('deliverProfile'):null,
      p_pin:has('pin')?val('deliverPin'):null,
      p_url:has('url')?val('deliverUrl'):null,
      p_notes:val('deliverNotes')
    };
    const{error}=await supabaseClient.rpc('admin_deliver_order',args);
    if(error){msg.textContent=error.message||'Could not deliver order.';msg.className='order-modal-message error'}
    else{msg.textContent='Order delivered successfully.';msg.className='order-modal-message success';await loadAdminOrdersClean();setTimeout(closeDeliverOrder,500)}
    btn.disabled=false;btn.textContent='Deliver Order';
  };
})();
