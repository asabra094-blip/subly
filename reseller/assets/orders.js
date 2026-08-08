/* Subly reseller orders - single source of truth */
const RESELLER_ORDER_PAGE_SIZE=25;
let resellerOrderFilter='all';
let resellerOrderPage=1;
let resellerOrderTotal=0;
let resellerOrders=[];
let resellerOrderProducts=[];
let resellerOrderCustomers=[];

function resellerCustomerName(customer){return customer?[customer.first_name,customer.last_name].filter(Boolean).join(' ').trim()||'Customer':'No customer linked';}
function resellerOrderLogo(p){return p?.logo_url?`<img class="order-app-logo" src="${escapeHtml(p.logo_url)}" alt="${escapeHtml(p.app_name||'Subscription')}">`:`<div class="order-app-logo order-app-fallback">${escapeHtml((p?.app_name||'S').slice(0,1).toUpperCase())}</div>`;}
function setResellerOrderFilter(status){resellerOrderFilter=status;resellerOrderPage=1;document.querySelectorAll('[data-reseller-order-filter]').forEach(b=>b.classList.toggle('active',b.dataset.resellerOrderFilter===status));loadResellerOrdersPage();}
function resellerOrdersPager(){const pages=Math.max(1,Math.ceil(resellerOrderTotal/RESELLER_ORDER_PAGE_SIZE)),first=resellerOrderTotal?((resellerOrderPage-1)*RESELLER_ORDER_PAGE_SIZE)+1:0,last=Math.min(resellerOrderPage*RESELLER_ORDER_PAGE_SIZE,resellerOrderTotal);return `<div class="list-pager" style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:18px 0 4px"><button class="order-button" ${resellerOrderPage<=1?'disabled':''} onclick="changeResellerOrderPage(-1)">← Previous</button><span style="font-size:12px;color:var(--muted)">${resellerOrderTotal?`${first}–${last} of ${resellerOrderTotal}`:'0 orders'} • Page ${resellerOrderPage}/${pages}</span><button class="order-button" ${resellerOrderPage>=pages?'disabled':''} onclick="changeResellerOrderPage(1)">Next →</button></div>`;}
function changeResellerOrderPage(delta){const pages=Math.max(1,Math.ceil(resellerOrderTotal/RESELLER_ORDER_PAGE_SIZE)),next=resellerOrderPage+delta;if(next<1||next>pages)return;resellerOrderPage=next;loadResellerOrdersPage();window.scrollTo({top:0,behavior:'smooth'});}

async function initResellerOrdersPage(){await loadResellerOrdersPage();}
async function loadResellerOrdersPage(){
 const container=document.getElementById('ordersList');if(!container||!currentUser)return;
 container.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>Loading orders...</div></div>';
 const from=(resellerOrderPage-1)*RESELLER_ORDER_PAGE_SIZE,to=from+RESELLER_ORDER_PAGE_SIZE-1;
 let q=supabaseClient.from('orders').select('id,order_number,user_id,customer_id,product_id,price_paid,status,customer_profile_name,created_at,activated_at,expires_at,delivery_account,delivery_password,delivery_profile,delivery_pin,delivery_url,delivery_notes,rejection_reason',{count:'exact'}).eq('user_id',currentUser.id).order('created_at',{ascending:false}).range(from,to);
 if(resellerOrderFilter!=='all')q=q.eq('status',resellerOrderFilter);
 const {data:orders,error,count}=await q;
 if(error){console.error('[SUBLY] reseller orders',error);container.innerHTML=`<div class="empty">${escapeHtml(error.message||'Could not load orders.')}</div>`;return;}
 resellerOrderTotal=count||0;resellerOrders=orders||[];
 const customerIds=[...new Set(resellerOrders.map(x=>x.customer_id).filter(Boolean))],productIds=[...new Set(resellerOrders.map(x=>x.product_id).filter(Boolean))];
 const [cr,pr]=await Promise.all([
  customerIds.length?supabaseClient.from('customers').select('id,first_name,last_name,phone').in('id',customerIds):Promise.resolve({data:[]}),
  productIds.length?supabaseClient.from('products').select('id,app_name,account_type,duration,logo_url').in('id',productIds):Promise.resolve({data:[]})
 ]);
 resellerOrderCustomers=cr.data||[];resellerOrderProducts=pr.data||[];renderResellerOrders();
}

function renderResellerOrders(){
 const container=document.getElementById('ordersList');if(!container)return;
 const rows=resellerOrders;
 if(!rows.length){container.innerHTML=`<div class="empty"><div class="empty-icon">🛒</div><div>${resellerOrderFilter==='all'?'No orders yet.':'No orders in this category.'}</div></div>${resellerOrdersPager()}`;return;}
 container.innerHTML=rows.map(order=>{
  const p=resellerOrderProducts.find(x=>x.id===order.product_id)||{},c=resellerOrderCustomers.find(x=>x.id===order.customer_id)||null;
  const customer=resellerCustomerName(c);
  return `<article class="order-card reseller-order-v2"><div class="order-top"><div class="order-title-wrap">${resellerOrderLogo(p)}<div><div class="order-name">${escapeHtml(p.app_name||'Subscription')}</div><div class="order-sub">${escapeHtml(p.account_type||'Standard')} • ${escapeHtml(p.duration||'—')}</div></div></div><span class="badge ${escapeHtml(order.status||'')}">${escapeHtml(order.status||'unknown')}</span></div><div class="order-info reseller-order-info"><div class="info-box"><div class="info-label">Customer</div><div class="info-value">${escapeHtml(customer)}</div>${c?.phone?`<div class="info-note">${escapeHtml(c.phone)}</div>`:''}</div><div class="info-box"><div class="info-label">Ordered At</div><div class="info-value">${escapeHtml(formatDateTime(order.created_at))}</div></div><div class="info-box"><div class="info-label">Price Paid</div><div class="info-value">${money(order.price_paid)}</div></div><div class="info-box"><div class="info-label">Order #</div><div class="info-value">${escapeHtml(order.order_number||String(order.id).slice(0,8))}</div></div><div class="info-box"><div class="info-label">Requested Profile</div><div class="info-value">${escapeHtml(order.customer_profile_name||'—')}</div></div><div class="info-box"><div class="info-label">Activated</div><div class="info-value">${escapeHtml(formatDateTime(order.activated_at))}</div></div><div class="info-box"><div class="info-label">Expires</div><div class="info-value">${escapeHtml(formatDateTime(order.expires_at))}</div></div><div class="info-box"><div class="info-label">Status</div><div class="info-value">${escapeHtml(order.status||'unknown')}</div></div></div>${order.status==='refunded'?`<div class="reseller-refund-note">Refunded to wallet${order.rejection_reason?` • ${escapeHtml(order.rejection_reason)}`:''}</div>`:''}${order.status==='delivered'?`<div class="reseller-delivery-note"><strong>Delivered account</strong>${order.delivery_account?`<div>Account: ${escapeHtml(order.delivery_account)}</div>`:''}${order.delivery_password?`<div>Password: ${escapeHtml(order.delivery_password)}</div>`:''}${order.delivery_profile?`<div>Profile: ${escapeHtml(order.delivery_profile)}</div>`:''}${order.delivery_pin?`<div>PIN: ${escapeHtml(order.delivery_pin)}</div>`:''}${order.delivery_url?`<div><a href="${escapeHtml(order.delivery_url)}" target="_blank" rel="noopener">Open delivery link</a></div>`:''}${order.delivery_notes?`<div>${escapeHtml(order.delivery_notes)}</div>`:''}</div>`:''}</article>`;
 }).join('')+resellerOrdersPager();
}

window.addEventListener('load',()=>{const wait=setInterval(()=>{if(currentUser){clearInterval(wait);initResellerOrdersPage();}},50);setTimeout(()=>clearInterval(wait),10000);});