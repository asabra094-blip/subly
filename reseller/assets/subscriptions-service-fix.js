/* Final service-specific My Subscriptions rules */
(function(){
  function key(p){return String(p?.app_name||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
  function fullAccount(p){return /full\s*account/i.test(String(p?.account_type||''));}
  function oneUser(p){return /1\s*user|one\s*user/i.test(String(p?.account_type||''));}

  window.subscriptionCopyText=function(o,p,c){
    const lines=[`Service: ${p.app_name||'Subscription'}`,`Plan: ${p.account_type||'Standard'} • ${p.duration||'—'}`];
    const k=key(p);
    if(k==='netflix'){
      if(fullAccount(p)){
        if(o.delivery_account) lines.push(`Email: ${o.delivery_account}`);
        if(o.delivery_password) lines.push(`Password: ${o.delivery_password}`);
      }else{
        if(o.delivery_profile||o.customer_profile_name) lines.push(`Profile: ${o.delivery_profile||o.customer_profile_name}`);
        if(o.delivery_pin) lines.push(`PIN: ${o.delivery_pin}`);
        if(o.delivery_url) lines.push(`Link: ${o.delivery_url}`);
      }
    }else if(k==='osn'||k==='osnplus'){
      if(o.delivery_account) lines.push(`Email: ${o.delivery_account}`);
      if(o.delivery_profile) lines.push(`Profile: ${o.delivery_profile}`);
      if(o.delivery_url) lines.push(`OTP Link: ${o.delivery_url}`);
    }else if(k==='anghami'){
      if(o.customer_profile_name||o.delivery_profile) lines.push(`Anghami Profile: ${o.customer_profile_name||o.delivery_profile}`);
    }else{
      if(o.delivery_account) lines.push(`Email / Account: ${o.delivery_account}`);
      if(o.delivery_password) lines.push(`Password: ${o.delivery_password}`);
      if(o.delivery_profile) lines.push(`Profile: ${o.delivery_profile}`);
    }
    if(o.expires_at) lines.push(`Expiry: ${subDateOnly(o.expires_at)}`);
    if(o.delivery_notes) lines.push(`Notes: ${o.delivery_notes}`);
    return lines.join('\n');
  };

  window.serviceCredentials=function(o,p){
    const k=key(p);
    if(k==='netflix'){
      if(fullAccount(p)){
        return `<div class="sub-service-block"><div class="sub-details-grid">${subField('Email / Account',o.delivery_account)}${subField('Password',o.delivery_password)}</div></div>`;
      }
      return `<div class="sub-service-block netflix-block">${o.delivery_url?`<div class="sub-link-row"><a class="sub-primary-link" href="${escapeHtml(o.delivery_url)}" target="_blank" rel="noopener">Open Netflix Link ↗</a>${subCopyButton(o.delivery_url,'Copy Netflix link')}</div>`:''}<div class="sub-details-grid">${subField('Profile',o.delivery_profile||o.customer_profile_name||'—',{copy:!!(o.delivery_profile||o.customer_profile_name)})}${subField('PIN',o.delivery_pin||'—',{copy:!!o.delivery_pin})}</div></div>`;
    }
    if(k==='osn'||k==='osnplus') return `<div class="sub-service-block"><div class="sub-details-grid">${subField('Email',o.delivery_account)}${o.delivery_profile?subField('Profile',o.delivery_profile):''}${o.delivery_url?subField('OTP Link',o.delivery_url,{link:true}):''}</div></div>`;
    if(k==='anghami') return `<div class="sub-service-block"><div class="sub-details-grid">${subField('Anghami Profile',o.customer_profile_name||o.delivery_profile||'—',{copy:!!(o.customer_profile_name||o.delivery_profile),wide:true})}</div></div>`;
    if(['shahid','amazonprime','amazonprimevideo','primevideo','watchit'].includes(k)) return `<div class="sub-service-block"><div class="sub-details-grid">${subField('Email / Account',o.delivery_account)}${subField('Password',o.delivery_password)}</div></div>`;
    return `<div class="sub-service-block"><div class="sub-details-grid">${o.delivery_account?subField('Account',o.delivery_account):''}${o.delivery_password?subField('Password',o.delivery_password):''}${o.delivery_profile?subField('Profile',o.delivery_profile):''}${o.delivery_pin?subField('PIN',o.delivery_pin):''}${o.delivery_url?subField('Link',o.delivery_url,{link:true}):''}</div></div>`;
  };
})();