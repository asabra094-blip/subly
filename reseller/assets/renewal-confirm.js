/* Subly renewal confirmation guard — requires an explicit second confirmation before wallet charge. */
(function(){
  if(typeof window.submitRenewal!=='function'||typeof window.closeRenewalModal!=='function')return;

  const originalSubmitRenewal=window.submitRenewal;
  const originalCloseRenewalModal=window.closeRenewalModal;
  let pendingProductId=null,pendingChoiceButton=null,confirmBusy=false;

  const ar=()=>window.SublyLocale?.language==='ar'||document.documentElement.lang==='ar';
  const txt=(en,arabic)=>ar()?arabic:en;
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function addStyles(){
    if(document.getElementById('renewal-confirm-style'))return;
    const style=document.createElement('style');
    style.id='renewal-confirm-style';
    style.textContent=`
      .renewal-confirm-step{display:none;margin-top:12px;padding:15px;border:1px solid rgba(166,108,255,.24);border-radius:14px;background:linear-gradient(145deg,rgba(166,108,255,.08),rgba(236,88,168,.035));box-shadow:0 12px 30px rgba(0,0,0,.12)}
      .renewal-confirm-step.show{display:block;animation:renewalConfirmIn .18s ease both}
      .renewal-confirm-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:900;color:#fff;margin-bottom:5px}
      .renewal-confirm-copy{font-size:11px;line-height:1.55;color:var(--muted,#9c94a7);margin-bottom:12px}
      .renewal-confirm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}
      .renewal-confirm-item{min-width:0;padding:9px 10px;border:1px solid rgba(255,255,255,.075);border-radius:10px;background:rgba(8,7,12,.34)}
      .renewal-confirm-item span{display:block;color:var(--muted,#9c94a7);font-size:8px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}
      .renewal-confirm-item strong{display:block;font-size:11px;color:#f8f5fb;overflow-wrap:anywhere}
      .renewal-confirm-charge{margin:0 0 12px;padding:10px 11px;border:1px solid rgba(242,198,108,.22);border-radius:10px;background:rgba(242,198,108,.055);color:#e9d49d;font-size:10px;line-height:1.45}
      .renewal-confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .renewal-confirm-actions button{min-height:42px;border-radius:10px;font:inherit;font-size:11px;font-weight:850;cursor:pointer}
      .renewal-confirm-cancel{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);color:#d8d2df}
      .renewal-confirm-pay{border:0;background:linear-gradient(135deg,#a66cff,#ec58a8);color:#fff;box-shadow:0 9px 24px rgba(166,108,255,.16)}
      .renewal-confirm-actions button:disabled{opacity:.55;cursor:not-allowed}
      [data-theme=light] .renewal-confirm-step{background:linear-gradient(145deg,#f6f0ff,#fff7fb);border-color:#d8c7ee;box-shadow:0 10px 28px rgba(70,45,95,.08)}
      [data-theme=light] .renewal-confirm-title,[data-theme=light] .renewal-confirm-item strong{color:#291d32}
      [data-theme=light] .renewal-confirm-item{background:#fff;border-color:#e2d8e8}
      [data-theme=light] .renewal-confirm-charge{background:#fff8e9;border-color:#ead7ab;color:#765b1d}
      [data-theme=light] .renewal-confirm-cancel{background:#f2edf5;border-color:#ded4e4;color:#55495e}
      @keyframes renewalConfirmIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
      @media(max-width:520px){.renewal-confirm-grid{grid-template-columns:1fr}.renewal-confirm-actions{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.renewal-confirm-step.show{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function ensureStep(){
    let step=document.getElementById('renewalConfirmStep');
    if(step)return step;
    const body=document.querySelector('#renewalModal .modal-body');
    if(!body)return null;
    step=document.createElement('div');
    step.id='renewalConfirmStep';
    step.className='renewal-confirm-step';
    const message=document.getElementById('renewalMessage');
    body.insertBefore(step,message||null);
    return step;
  }

  function clearConfirmation(){
    pendingProductId=null;
    pendingChoiceButton=null;
    confirmBusy=false;
    const step=document.getElementById('renewalConfirmStep');
    if(step){step.classList.remove('show');step.innerHTML=''}
    document.getElementById('renewalOptions')?.removeAttribute('aria-hidden');
  }

  function showConfirmation(productId,btn){
    if(!selectedRenewalOrder)return;
    const renewalProduct=subProducts.find(x=>x.id===productId);
    const currentProduct=productOf(selectedRenewalOrder);
    const price=priceFor(productId);
    if(!renewalProduct||price==null){
      const msg=document.getElementById('renewalMessage');
      if(msg){msg.textContent=txt('This renewal option is unavailable. Refresh and try again.','خيار التجديد هذا غير متوفر. حدّث الصفحة وحاول مجدداً.');msg.className='sub-form-message error'}
      return;
    }
    pendingProductId=productId;
    pendingChoiceButton=btn||null;
    const step=ensureStep();
    if(!step)return;
    const subscription=subId(selectedRenewalOrder.id),service=currentProduct?.app_name||txt('Subscription','اشتراك'),account=sp(renewalProduct.account_type||currentProduct?.account_type||'Standard'),duration=sp(renewalProduct.duration||'—');
    step.innerHTML=`
      <div class="renewal-confirm-title">⚠ ${esc(txt('Confirm renewal purchase','تأكيد شراء التجديد'))}</div>
      <div class="renewal-confirm-copy">${esc(txt('Check the details below before continuing. Nothing will be charged until you press Confirm & Pay.','تحقق من التفاصيل أدناه قبل المتابعة. لن يتم خصم أي مبلغ حتى تضغط تأكيد والدفع.'))}</div>
      <div class="renewal-confirm-grid">
        <div class="renewal-confirm-item"><span>${esc(txt('Subscription ID','معرّف الاشتراك'))}</span><strong><bdi>${esc(subscription)}</bdi></strong></div>
        <div class="renewal-confirm-item"><span>${esc(txt('Service','الخدمة'))}</span><strong>${esc(service)}</strong></div>
        <div class="renewal-confirm-item"><span>${esc(txt('Account type','نوع الحساب'))}</span><strong>${esc(account)}</strong></div>
        <div class="renewal-confirm-item"><span>${esc(txt('Renewal period','مدة التجديد'))}</span><strong>${esc(duration)}</strong></div>
        <div class="renewal-confirm-item"><span>${esc(txt('Amount','المبلغ'))}</span><strong>${esc(money(price))}</strong></div>
      </div>
      <div class="renewal-confirm-charge">${esc(txt('Your wallet will be charged immediately after confirmation and the renewal request will be created.','سيتم خصم المبلغ من محفظتك مباشرة بعد التأكيد وإنشاء طلب التجديد.'))}</div>
      <div class="renewal-confirm-actions">
        <button type="button" class="renewal-confirm-cancel" onclick="cancelRenewalPurchase()">${esc(txt('Cancel','إلغاء'))}</button>
        <button type="button" class="renewal-confirm-pay" id="renewalConfirmPayButton" onclick="confirmRenewalPurchase()">${esc(txt('Confirm & Pay','تأكيد والدفع'))} • ${esc(money(price))}</button>
      </div>`;
    step.classList.add('show');
    document.getElementById('renewalOptions')?.setAttribute('aria-hidden','true');
    step.scrollIntoView({block:'nearest',behavior:'smooth'});
  }

  window.submitRenewal=function(productId,btn){
    if(confirmBusy)return;
    showConfirmation(productId,btn);
  };

  window.cancelRenewalPurchase=function(){
    if(confirmBusy)return;
    clearConfirmation();
  };

  window.confirmRenewalPurchase=async function(){
    if(confirmBusy||!pendingProductId||!selectedRenewalOrder)return;
    confirmBusy=true;
    const pay=document.getElementById('renewalConfirmPayButton');
    if(pay){pay.disabled=true;pay.textContent=txt('Processing...','جارٍ التنفيذ...')}
    const productId=pendingProductId,choiceButton=pendingChoiceButton;
    const step=document.getElementById('renewalConfirmStep');
    if(step)step.classList.remove('show');
    document.getElementById('renewalOptions')?.removeAttribute('aria-hidden');
    pendingProductId=null;
    pendingChoiceButton=null;
    try{
      await originalSubmitRenewal(productId,choiceButton||document.createElement('button'));
    } finally {
      confirmBusy=false;
    }
  };

  window.closeRenewalModal=function(){
    clearConfirmation();
    return originalCloseRenewalModal();
  };

  addStyles();
})();
