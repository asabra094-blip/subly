/* Service-aware safeguards layered after subscriptions.js */
function subscriptionCopyText(o,p,c){
  const lines=[
    `Service: ${p?.app_name||'Subscription'}`,
    `Plan: ${p?.account_type||'Standard'} • ${p?.duration||'—'}`
  ];

  if(isNetflix(p)){
    const type=String(p?.account_type||'').toLowerCase();
    const full=type.includes('full');
    if(full){
      if(o.delivery_account) lines.push(`Email / Account: ${o.delivery_account}`);
      if(o.delivery_password) lines.push(`Password: ${o.delivery_password}`);
    }else{
      if(o.delivery_profile||o.customer_profile_name) lines.push(`Profile: ${o.delivery_profile||o.customer_profile_name}`);
      if(o.delivery_pin) lines.push(`PIN: ${o.delivery_pin}`);
      if(o.delivery_url) lines.push(`Link: ${o.delivery_url}`);
    }
  }else if(isOSN(p)){
    if(o.delivery_account) lines.push(`Email: ${o.delivery_account}`);
    if(o.delivery_profile) lines.push(`Profile: ${o.delivery_profile}`);
    if(o.delivery_url) lines.push(`OTP Link: ${o.delivery_url}`);
  }else if(isAnghami(p)){
    if(o.customer_profile_name||o.delivery_profile) lines.push(`Anghami Profile: ${o.customer_profile_name||o.delivery_profile}`);
  }else{
    if(o.delivery_account) lines.push(`Email / Account: ${o.delivery_account}`);
    if(o.delivery_password) lines.push(`Password: ${o.delivery_password}`);
    if(o.delivery_profile) lines.push(`Profile: ${o.delivery_profile}`);
  }

  if(o.expires_at) lines.push(`Expiry: ${subDateOnly(o.expires_at)}`);
  if(o.delivery_notes) lines.push(`Notes: ${o.delivery_notes}`);
  return lines.join('\n');
}
