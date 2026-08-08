/* Subly admin product app availability controls */
(function(){
  const style=document.createElement('style');
  style.textContent=`
    .service-status-badge{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.35px;vertical-align:middle;white-space:nowrap}
    .service-status-badge.disabled{color:#ff9aaa;border:1px solid rgba(255,92,114,.28);background:rgba(255,92,114,.08)}
    .service-group.is-deactivated{border-color:rgba(255,92,114,.20)}
    .service-group.is-deactivated .service-group-logo{filter:saturate(.35);opacity:.72}
    @media(max-width:600px){.service-status-badge{font-size:7px;padding:3px 6px;margin-left:5px}}
  `;
  document.head.appendChild(style);

  const getVariants=()=>{
    const serviceName=document.getElementById('serviceOriginalName')?.value.trim();
    if(!serviceName||typeof adminProductsCache==='undefined')return [];
    return adminProductsCache.filter(item=>item.app_name===serviceName);
  };

  function decorateAppGroups(){
    document.querySelectorAll('#adminProductsList .service-group').forEach(group=>{
      const heading=group.querySelector('.service-group-identity h3');
      if(!heading)return;
      const states=[...group.querySelectorAll('.product-state')];
      if(!states.length)return;
      const fullyDisabled=states.every(el=>el.classList.contains('off')||/disabled|deactivated/i.test(el.textContent||''));
      group.classList.toggle('is-deactivated',fullyDisabled);
      let badge=heading.parentElement?.querySelector('.service-status-badge');
      if(fullyDisabled){
        if(!badge){badge=document.createElement('span');heading.insertAdjacentElement('afterend',badge);}
        badge.className='service-status-badge disabled';
        badge.textContent='⏸ Deactivated';
      }else if(badge){badge.remove();}
    });
  }

  function refreshAppStatusButton(){
    const button=document.getElementById('toggleServiceActiveButton');
    if(!button)return;
    const variants=getVariants();
    if(!variants.length){button.disabled=true;button.textContent='App unavailable';return;}
    const fullyDisabled=variants.every(item=>!item.active);
    button.disabled=false;
    button.dataset.nextActive=fullyDisabled?'true':'false';
    button.textContent=fullyDisabled?'▶ Activate App':'⏸ Deactivate App';
    button.classList.toggle('product-reactivate-action',fullyDisabled);
    button.classList.toggle('product-deactivate-action',!fullyDisabled);
  }

  async function toggleCurrentServiceActive(){
    const serviceName=document.getElementById('serviceOriginalName')?.value.trim();
    const button=document.getElementById('toggleServiceActiveButton');
    const message=document.getElementById('serviceEditorMessage');
    const variants=getVariants();
    if(!serviceName||!variants.length||!button)return;

    const activate=variants.every(item=>!item.active);
    const action=activate?'activate':'deactivate';
    const confirmed=window.confirm(
      activate
        ? `Activate ${serviceName}? All variants inside this app will become available to resellers again.`
        : `Deactivate ${serviceName}? All variants inside this app will immediately disappear from reseller Add Subscription.`
    );
    if(!confirmed)return;

    button.disabled=true;
    button.textContent=activate?'Activating…':'Deactivating…';
    if(message){message.textContent='';message.className='product-editor-message';}

    const {error}=await supabaseClient
      .from('products')
      .update({active:activate})
      .eq('app_name',serviceName);

    if(error){
      console.error('[SUBLY] App availability update failed',error);
      if(message){message.textContent=error.message||`Could not ${action} app.`;message.className='product-editor-message error';}
      button.disabled=false;
      refreshAppStatusButton();
      return;
    }

    if(message){
      message.textContent=activate?`${serviceName} is active again.`:`${serviceName} is now deactivated and hidden from resellers.`;
      message.className='product-editor-message success';
    }
    await loadAdminProducts();
    decorateAppGroups();
    refreshAppStatusButton();
  }

  window.toggleCurrentServiceActive=toggleCurrentServiceActive;

  const originalOpen=window.openServiceEditor;
  if(typeof originalOpen==='function'){
    window.openServiceEditor=function(serviceName){
      originalOpen(serviceName);
      requestAnimationFrame(refreshAppStatusButton);
    };
  }

  const target=document.getElementById('adminProductsList');
  if(target){new MutationObserver(()=>requestAnimationFrame(decorateAppGroups)).observe(target,{childList:true,subtree:true});}
  window.addEventListener('load',()=>setTimeout(decorateAppGroups,250));
})();