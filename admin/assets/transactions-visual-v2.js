/* Subly admin transaction visual polish — icons + semantic money colors. */
(()=>{
  'use strict';
  const eventIcon=type=>({topup:'💳',purchase:'🛒',renewal:'🔄',refund:'↩️',manual_adjustment:'⚙️',adjustment:'⚙️'})[type]||'•';
  const eventClass=type=>({topup:'topup',purchase:'purchase',renewal:'purchase',refund:'refund',manual_adjustment:'adjustment',adjustment:'adjustment'})[type]||'adjustment';
  const moneyTone=(type,amount,status)=>{
    const s=String(status||'').toLowerCase();
    if(type==='refund'||s==='refunded')return 'refund';
    if(s==='rejected'||s==='cancelled')return 'debit';
    if(type==='purchase'||type==='renewal'||Number(amount)<0)return 'debit';
    if(type==='topup'||Number(amount)>0||s==='approved'||s==='delivered')return 'credit';
    return 'neutral';
  };
  const amountText=(value,showPlus=true)=>{const n=Number(value||0);return `${showPlus&&n>0?'+':''}${money(n)}`};
  const iconBox=type=>`<div class="tx-event-icon ${eventClass(type)}" aria-hidden="true">${eventIcon(type)}</div>`;

  const originalRenderWallet=renderWallet;
  renderWallet=function(rows,head,body,mobile){
    originalRenderWallet(rows,head,body,mobile);
    mobile.innerHTML=rows.map(x=>{
      const hasProduct=Boolean(x.product_name);
      const visual=hasProduct&&x.product_logo?txMobileLogo(x.product_logo,x.product_name):iconBox(x.tx_type);
      const tone=moneyTone(x.tx_type,x.amount,x.order_status);
      return `<article class="transaction-card"><div class="tx-mobile-top">${visual}<div class="tx-mobile-main"><div class="tx-mobile-title">${escapeHtml(x.product_name||txTypeLabel(x.tx_type))}</div><div class="tx-mobile-sub">${escapeHtml(x.reseller_name||'Unknown reseller')}${x.customer_name?` • ${escapeHtml(x.customer_name)}`:''}</div></div><div class="tx-mobile-amount ${tone}">${amountText(x.amount,true)}</div></div><div class="tx-mobile-row"><div class="tx-mobile-detail">${escapeHtml(txTypeLabel(x.tx_type))}${x.account_type?` • ${escapeHtml(x.account_type)} • ${escapeHtml(x.duration||'—')}`:''}</div>${x.order_status?txStatus(x.order_status):''}</div><div class="tx-mobile-footer"><span class="tx-code">${escapeHtml(x.subscription_code||String(x.record_id).slice(0,8).toUpperCase())}</span><span class="tx-mobile-detail">${escapeHtml(formatDateTime(x.created_at))}</span></div></article>`;
    }).join('');
    body.querySelectorAll('tr').forEach((tr,i)=>{const x=rows[i];if(!x)return;const cells=tr.children;if(cells[4])cells[4].innerHTML=`<span class="tx-money ${moneyTone(x.tx_type,x.amount,x.order_status)}">${amountText(x.amount,true)}</span>`});
  };

  const originalRenderPurchases=renderPurchases;
  renderPurchases=function(rows,head,body,mobile){
    originalRenderPurchases(rows,head,body,mobile);
    mobile.innerHTML=rows.map(o=>{
      const visual=o.product_logo?txMobileLogo(o.product_logo,o.product_name):iconBox('purchase');
      const tone=moneyTone('purchase',-Math.abs(Number(o.amount||0)),o.order_status);
      return `<article class="transaction-card"><div class="tx-mobile-top">${visual}<div class="tx-mobile-main"><div class="tx-mobile-title">${escapeHtml(o.product_name||'Subscription')}</div><div class="tx-mobile-sub">${escapeHtml(o.reseller_name||'Unknown reseller')} • ${escapeHtml(o.customer_name||'No customer')}</div></div><div class="tx-mobile-amount ${tone}">-${money(Math.abs(Number(o.amount||0)))}</div></div><div class="tx-mobile-row"><div class="tx-mobile-detail">${escapeHtml(o.account_type||'Standard')} • ${escapeHtml(o.duration||'—')}</div>${txStatus(o.order_status)}</div><div class="tx-mobile-footer"><span class="tx-code">${escapeHtml(o.subscription_code||String(o.record_id).slice(0,8).toUpperCase())}</span><span class="tx-mobile-detail">${escapeHtml(formatDateTime(o.created_at))}</span></div></article>`;
    }).join('');
    body.querySelectorAll('tr').forEach((tr,i)=>{const o=rows[i];if(!o)return;const cells=tr.children;if(cells[5])cells[5].innerHTML=`<span class="tx-money debit">-${money(Math.abs(Number(o.amount||0)))}</span>`});
  };

  const originalRenderTopups=renderTopups;
  renderTopups=function(rows,head,body,mobile){
    originalRenderTopups(rows,head,body,mobile);
    mobile.innerHTML=rows.map(x=>{
      const tone=moneyTone('topup',x.amount,x.topup_status);
      return `<article class="transaction-card"><div class="tx-mobile-top">${iconBox('topup')}<div class="tx-mobile-main"><div class="tx-mobile-title">Top-up</div><div class="tx-mobile-sub">${escapeHtml(x.reseller_name||'Unknown reseller')} • ${escapeHtml(paymentMethodLabel(x.payment_method))}${x.payment_reference?` • ${escapeHtml(x.payment_reference)}`:''}</div></div><div class="tx-mobile-amount ${tone}">${amountText(x.amount,true)}</div></div><div class="tx-mobile-row"><div class="tx-mobile-detail">Top-up request</div>${txStatus(x.topup_status)}</div><div class="tx-mobile-footer"><span class="tx-code">${escapeHtml(String(x.record_id).slice(0,8).toUpperCase())}</span><span class="tx-mobile-detail">${escapeHtml(formatDateTime(x.created_at))}</span></div></article>`;
    }).join('');
    body.querySelectorAll('tr').forEach((tr,i)=>{const x=rows[i];if(!x)return;const cells=tr.children;if(cells[2])cells[2].innerHTML=`<span class="tx-money ${moneyTone('topup',x.amount,x.topup_status)}">${amountText(x.amount,true)}</span>`});
  };
})();