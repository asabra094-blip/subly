/* Reseller phone management + Shahid supplier routing support. */
(function(){
  let managedId=null;

  const normalizePhone=value=>{
    const d=String(value||'').replace(/\D/g,'');
    if(d.startsWith('961'))return d;
    if(d.startsWith('0')&&d.length>=8)return `961${d.slice(1)}`;
    if(d.length===8)return `961${d}`;
    return d;
  };

  function ensureAddPhoneField(){
    if(document.getElementById('newResellerPhone'))return;
    const business=document.getElementById('newResellerBusiness');
    if(!business)return;
    business.insertAdjacentHTML('afterend','<label for="newResellerPhone">Phone Number</label><input id="newResellerPhone" inputmode="tel" autocomplete="tel" placeholder="Example: 76 123 456 or +961 76 123 456">');
  }

  async function ensureSettingsPhoneField(){
    if(!managedId||document.getElementById('mrPhone'))return;
    const business=document.getElementById('mrBusiness');
    if(!business)return;
    const {data,error}=await supabaseClient.from('profiles').select('phone').eq('id',managedId).eq('role','reseller').maybeSingle();
    if(error){console.error('[SUBLY] reseller phone',error);return;}
    const label=document.createElement('label');
    label.innerHTML=`<span>Phone Number</span><input id="mrPhone" inputmode="tel" autocomplete="tel" placeholder="Example: 76 123 456" value="${escapeHtml(data?.phone||'')}">`;
    business.closest('label')?.insertAdjacentElement('afterend',label);
  }

  function install(){
    ensureAddPhoneField();

    const originalOpenAdd=window.openResellerModal;
    if(typeof originalOpenAdd==='function'){
      window.openResellerModal=function(...args){
        ensureAddPhoneField();
        const out=originalOpenAdd.apply(this,args);
        const phone=document.getElementById('newResellerPhone');
        if(phone)phone.value='';
        return out;
      };
    }

    window.createReseller=async function(){
      ensureAddPhoneField();
      const username=document.getElementById('newResellerUsername')?.value.trim().toLowerCase()||'';
      const business=document.getElementById('newResellerBusiness')?.value.trim()||'';
      const rawPhone=document.getElementById('newResellerPhone')?.value||'';
      const phone=normalizePhone(rawPhone);
      const password=document.getElementById('newResellerPassword')?.value||'';
      const tier=document.getElementById('newResellerTier')?.value||'bronze';
      const msg=document.getElementById('resellerModalMessage');
      const btn=document.getElementById('createResellerButton');
      if(msg)msg.textContent='';
      if(!/^[a-z0-9._-]{3,30}$/.test(username)){if(msg)msg.textContent='Username must be 3–30 letters, numbers, dots, dashes or underscores.';return;}
      if(!business){if(msg)msg.textContent='Business name is required.';document.getElementById('newResellerBusiness')?.focus();return;}
      if(business.length>120){if(msg)msg.textContent='Business name is too long.';return;}
      if(phone.length<10){if(msg)msg.textContent='Enter a valid reseller phone number.';document.getElementById('newResellerPhone')?.focus();return;}
      if(password.length<8){if(msg)msg.textContent='Password must be at least 8 characters.';return;}
      if(!['bronze','silver','gold','diamond'].includes(tier)){if(msg)msg.textContent='Invalid tier.';return;}
      if(btn){btn.disabled=true;btn.textContent='Creating…';}
      try{
        const {data,error}=await supabaseClient.functions.invoke('create-reseller',{body:{username,password,business_name:business,phone,tier}});
        if(error)throw error;
        if(data?.error)throw new Error(data.error);
        closeResellerModal();
        resellerPage=1;
        if(typeof loadResellers==='function')await loadResellers();
      }catch(e){if(msg)msg.textContent=e?.message||'Could not create reseller.';}
      finally{if(btn){btn.disabled=false;btn.textContent='Create Reseller';}}
    };

    const originalOpenManage=window.openResellerManage;
    if(typeof originalOpenManage==='function'){
      window.openResellerManage=async function(id,...args){
        managedId=id||null;
        return await originalOpenManage.call(this,id,...args);
      };
    }

    const originalCloseManage=window.closeResellerManage;
    if(typeof originalCloseManage==='function'){
      window.closeResellerManage=function(...args){
        managedId=null;
        return originalCloseManage.apply(this,args);
      };
    }

    const originalSwitch=window.mrSwitchTab;
    if(typeof originalSwitch==='function'){
      window.mrSwitchTab=async function(tab,...args){
        const out=await originalSwitch.call(this,tab,...args);
        if(tab==='settings')await ensureSettingsPhoneField();
        return out;
      };
    }

    window.mrSaveSettings=async function(){
      if(!managedId)return alert('Reseller not selected.');
      const username=document.getElementById('mrUsername')?.value.trim()||'';
      if(!/^[a-z0-9._-]{3,30}$/i.test(username))return alert('Username must be 3–30 letters, numbers, dots, dashes or underscores.');
      const phone=normalizePhone(document.getElementById('mrPhone')?.value||'');
      if(phone.length<10)return alert('Enter a valid reseller phone number.');
      const {error}=await supabaseClient.rpc('admin_update_reseller_profile',{
        p_user_id:managedId,
        p_username:username,
        p_business_name:document.getElementById('mrBusiness')?.value.trim()||null,
        p_reseller_code:document.getElementById('mrCode')?.value.trim()||null,
        p_tier:document.getElementById('mrTier')?.value,
        p_status:document.getElementById('mrStatus')?.value,
        p_phone:phone
      });
      if(error)return alert(error.message||'Could not update reseller.');
      const id=managedId;
      if(typeof loadResellers==='function')await loadResellers();
      if(typeof window.openResellerManage==='function')await window.openResellerManage(id);
      if(typeof window.mrSwitchTab==='function')await window.mrSwitchTab('settings');
      alert('Reseller updated.');
    };
  }

  window.addEventListener('load',()=>setTimeout(install,0));
})();
