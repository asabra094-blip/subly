/* Subly reseller payment destination — keeps the Whish recipient visible and copyable on Wallet/Add Funds. */
(()=>{
  'use strict';

  const WHISH_NUMBER='76 408 625';

  function syncWhishDestination(){
    document.querySelectorAll('[data-whish-number]').forEach(el=>{el.textContent=WHISH_NUMBER});
    const method=document.getElementById('topupMethod')?.value;
    const box=document.getElementById('whishRecipientBox');
    if(box)box.style.display=method==='cash'?'none':'';
  }

  window.copyWhishNumber=async function(button){
    try{
      await navigator.clipboard.writeText(WHISH_NUMBER);
    }catch{
      const t=document.createElement('textarea');
      t.value=WHISH_NUMBER;
      t.style.position='fixed';
      t.style.opacity='0';
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    const b=button instanceof HTMLElement?button:null;
    if(b){
      const old=b.textContent;
      b.textContent=document.documentElement.lang==='ar'?'✓ تم النسخ':'✓ Copied';
      setTimeout(()=>{b.textContent=old},1400);
    }
  };

  const originalUpdate=window.updateTopupMethodUI;
  if(typeof originalUpdate==='function'){
    window.updateTopupMethodUI=function(...args){
      const result=originalUpdate.apply(this,args);
      syncWhishDestination();
      return result;
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',syncWhishDestination,{once:true});
  else syncWhishDestination();
})();
