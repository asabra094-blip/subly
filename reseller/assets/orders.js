/* Subly reseller orders - single source of truth */
let resellerOrderFilter='all';
let resellerOrders=[];
let resellerOrderProducts=[];
let resellerOrderCustomers=[];

function resellerCustomerName(customer){return customer?[customer.first_name,customer.last_name].filter(Boolean).join(' ').trim()||'Customer':'No customer linked';}
function setResellerOrderFilter(status){resellerOrderFilter=status;document.querySelectorAll('[data-reseller-order-filter]').forEach(b=>b.classList.toggle('active',b.dataset.resellerOrderFilter===status));renderResellerOrders();}

async function initResellerOrdersPage(){
 const container=document.getElementById('ordersList');if(!container||!currentUser)return;
 container.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>Loading orders...</div></div>';
 const {data:orders,error}=await supabaseClient.from('orders').select('id,order_number,user_id,customer_id,product_id,price_paid,status,customer_profile_name,created_at,activated_at,expires_at,delivery_account,delivery_password,delivery_profile,delivery_pin,delivery_url,delivery_notes,rejection_reason').eq('user_id',currentUser.id).order('created_at',{ascending:false});
 if(error){console.error('[SUBLY] reseller orders',error);container.innerHTML=`<div class="empty">${escapeHtml(error.message||'Could not load orders.')}</div>`;return;}
 resellerOrders=orders||[];
 const customerIds=[...new Set(resellerOrders.map(x=>x.customer_id).filter(Boolean))],productIds=[...new Set(resellerOrders.map(x=>x.product_id).filter(Boolean))];
 const [cr,pr]=await Promise.all([
  customerIds.length?supabaseClient.from('customers').select('id,first_name,last_name,phone').in('id',customerIds):Promise.resolve({data:[]}),
  productIds.length?supabaseClient.from('products').select('id,app_name,account_type,duration').in('id',productIds):Promise.resolve({data:[]})
 ]);
 resellerOrderCustomers=cr.data||[];resellerOrderProducts=pr.data||[];renderResellerOrders();
}

function renderResellerOrders(){
 const container=document.getElementById('ordersList');if(!container)return;
 const rows=resellerOrderFilter==='all'?resellerOrders:resellerOrders.filter(o=>o.status===resellerOrderFilter);
 if(!rows.length){container.innerHTML=`<div class="empty"><div class="empty-icon">🛒</div><div>${resellerOrderFilter==='all'?'No orders yet.':'No orders in this category.'}</div></div>`;return;}
 container.innerHTML=rows.map(order=>{
  const p=resellerOrderProducts.find(x=>x.id===order.product_id)||{},c=resellerOrderCustomers.find(x=>x.id===order.customer_id)||null;
  const customer=resellerCustomerName(c);
  return `<article class="order-card reseller-order-v2"><div class="order-top"><div><div class="order-name">${escapeHtml(p.app_name||'Subscription')}</div><div class="order-sub">${escapeHtml(p.account_type||'Standard')} • ${escapeHtml(p.duration||'—')}</div></div><span class="badge ${escapeHtml(order.status||'')}">${escapeHtml(order.status||'unknown')}</span></div><div class="order-info reseller-order-info"><div class="info-box"><div class="info-label">Customer</div><div class="info-value">${escapeHtml(customer)}</div>${c?.phone?`<div class="info-note">${escapeHtml(c.phone)}</div>`:''}</div><div class="info-box"><div class="info-label">Ordered At</div><div class="info-value">${escapeHtml(formatDateTime(order.created_at))}</div></div><div class="info-box"><div class="info-label">Price Paid</div><div class="info-value">${money(order.price_paid)}</div></div><div class="info-box"><div class="info-label">Order #</div><div class="info-value">${escapeHtml(order.order_number||String(order.id).slice(0,8))}</div></div><div class="info-box"><div class="info-label">Requested Profile</div><div class="info-value">${escapeHtml(order.customer_profile_name||'—')}</div></div><div class="info-box"><div class="info-label">Activated</div><div class="info-value">${escapeHtml(formatDateTime(order.activated_at))}</div></div><div class="info-box"><div class="info-label">Expires</div><div class="info-value">${escapeHtml(formatDateTime(order.expires_at))}</div></div><div class="info-box"><div class="info-label">Status</div><div class="info-value">${escapeHtml(order.status||'unknown')}</div></div></div>${order.status==='refunded'?`<div class="reseller-refund-note">Refunded to wallet${order.rejection_reason?` • ${escapeHtml(order.rejection_reason)}`:''}</div>`:''}${order.status==='delivered'?`<div class="reseller-delivery-note"><strong>Delivered account</strong>${order.delivery_account?`<div>Account: ${escapeHtml(order.delivery_account)}</div>`:''}${order.delivery_password?`<div>Password: ${escapeHtml(order.delivery_password)}</div>`:''}${order.delivery_profile?`<div>Profile: ${escapeHtml(order.delivery_profile)}</div>`:''}${order.delivery_pin?`<div>PIN: ${escapeHtml(order.delivery_pin)}</div>`:''}${order.delivery_url?`<div><a href="${escapeHtml(order.delivery_url)}" target="_blank" rel="noopener">Open delivery link</a></div>`:''}${order.delivery_notes?`<div>${escapeHtml(order.delivery_notes)}</div>`:''}</div>`:''}</article>`;
 }).join('');
}

window.addEventListener('load',()=>{const wait=setInterval(()=>{if(currentUser){clearInterval(wait);initResellerOrdersPage();}},50);setTimeout(()=>clearInterval(wait),10000);});
