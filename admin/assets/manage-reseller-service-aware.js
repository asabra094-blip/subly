/* Service-aware subscription editor for Manage Reseller */
(function(){
  const key=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const esc=v=>escapeHtml(v??'');
  const dateInput=v=>v?new Date(v).toISOString().slice(0,16):'';

  function schema(product){
    const app=key(product?.app_name),type=String(product?.account_type||'').toLowerCase();
    if(app==='netflix'){
      if(type.includes('full')) return {hint:'Netflix Full Account: only account/email and password are delivered.',fields:['account','password']};
      return {hint:'Netflix 1 User: deliver only profile name, PIN and Netflix link.',fields:['profile','pin','url']};
    }
    if(app==='osn'||app==='osnplus') return {hint:'OSN: email/account, profile and OTP/activation link.',fields:['account','profile','url']};
    if(app==='anghami') return {hint:'Anghami uses the exact profile name submitted with the order. No extra login details are required.',fields:[]};
    if(['amazonprime','amazonprimevideo','primevideo','watchit'].includes(app)) return {hint:`${product?.app_name||'Service'}: email/account and password.`,fields:['account','password']};
    if(app==='shahid') return {hint:'Shahid: email/account and password. Profile is optional if the supplier provides one.',fields:['account','password','profile']};
    return {hint:'Generic delivery fields for this service.',fields:['account','password','profile','pin','url']};
  }

  const labels={
    account:['Email / Account','email@example.com or account'],
    password:['Password','Password'],
    profile:['Profile name','Profile'],
    pin:['PIN','PIN'],
    url:['Delivery / activation link','https://...']
  };

  function field(name,o){
    const ids={account:'mreAccount',password:'mrePassword',profile:'mreProfile',pin:'mrePin',url:'mreUrl'};
    const vals={account:o.delivery_account,password:o.delivery_password,profile:o.delivery_profile,pin:o.delivery_pin,url:o.delivery_url};
    const [label,ph]=labels[name];
    const wide=name==='url'?' wide':'';
    const type=name==='url'?'url':'text';
    return `<label class="${wide.trim()}"><span>${esc(label)}</span><input id="${ids[name]}" type="${type}" value="${esc(vals[name]||'')}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
  }

  window.mrEditSubscription=async function(id){
    const [{data:o,error:oe}]=await Promise.all([
      supabaseClient.from('orders').select('id,order_number,product_id,customer_profile_name,delivery_account,delivery_password,delivery_profile,delivery_pin,delivery_url,delivery_notes,activated_at,expires_at').eq('id',id).single()
    ]);
    if(oe||!o) return alert(oe?.message||'Could not load subscription.');
    const {data:p,error:pe}=await supabaseClient.from('products').select('id,app_name,account_type,duration,logo_url').eq('id',o.product_id).single();
    if(pe||!p) return alert(pe?.message||'Could not load product.');
    const s=schema(p),m=document.getElementById('mrEditModal');
    const requested=o.customer_profile_name?`<div class="mr-card" style="margin-top:10px"><div class="mr-sub">Customer requested / Anghami profile</div><div class="mr-title" style="margin-top:4px">${esc(o.customer_profile_name)}</div></div>`:'';
    m.innerHTML=`<div class="mr-editor"><div class="mr-card-top"><div><div class="mr-title">Edit ${esc(p.app_name||'Subscription')}</div><div class="mr-sub">${esc(p.account_type||'Standard')} • ${esc(p.duration||'—')} • Order #${esc(o.order_number||String(o.id).slice(0,8))}</div></div><button class="mr-btn" onclick="mrCloseEditor()">✕</button></div><div class="mr-card" style="margin-top:12px;border-color:rgba(155,77,255,.28)"><div class="mr-sub">${esc(s.hint)}</div></div>${requested}<div class="mr-form" style="margin-top:14px">${s.fields.map(x=>field(x,o)).join('')}<label><span>Activated</span><input id="mreActivated" type="datetime-local" value="${dateInput(o.activated_at)}"></label><label><span>Expires</span><input id="mreExpires" type="datetime-local" value="${dateInput(o.expires_at)}"></label><label class="wide"><span>Notes</span><textarea id="mreNotes" rows="3">${esc(o.delivery_notes||'')}</textarea></label></div><div class="mr-actions"><button class="mr-btn primary" onclick='mrSaveSubscriptionServiceAware(${JSON.stringify(o.id)},${JSON.stringify(s.fields)})'>Save Changes</button><button class="mr-btn" onclick="mrCloseEditor()">Cancel</button></div></div>`;
    m.classList.add('show');
  };

  window.mrSaveSubscriptionServiceAware=async function(id,fields){
    const has=n=>fields.includes(n),val=id=>document.getElementById(id)?.value.trim()||null;
    const activated=document.getElementById('mreActivated')?.value||'',expires=document.getElementById('mreExpires')?.value||'';
    const args={
      p_order_id:id,
      p_account:has('account')?val('mreAccount'):null,
      p_password:has('password')?val('mrePassword'):null,
      p_profile:has('profile')?val('mreProfile'):null,
      p_pin:has('pin')?val('mrePin'):null,
      p_url:has('url')?val('mreUrl'):null,
      p_notes:val('mreNotes'),
      p_activated_at:activated?new Date(activated).toISOString():null,
      p_expires_at:expires?new Date(expires).toISOString():null
    };
    const {error}=await supabaseClient.rpc('admin_update_subscription',args);
    if(error) return alert(error.message||'Could not update subscription.');
    window.mrCloseEditor?.();
    await window.mrSwitchTab?.('subscriptions');
    alert('Subscription updated with the correct service fields.');
  };
})();
