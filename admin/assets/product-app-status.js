/* Subly admin product app availability controls */
(function(){
  const getVariants=()=>{
    const serviceName=document.getElementById('serviceOriginalName')?.value.trim();
    if(!serviceName||typeof adminProductsCache==='undefined')return [];
    return adminProductsCache.filter(item=>item.app_name===serviceName);
  };

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
})();
