/* Subly reseller orders v2 */
async function loadResellerOrdersV2(){
  const container=document.getElementById("ordersList");
  if(!container||!currentUser)return;
  container.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>Loading orders...</div></div>';

  const {data:orders,error}=await supabaseClient.from("orders").select(`
    id,order_number,user_id,customer_id,product_id,price_paid,status,
    customer_profile_name,created_at,activated_at,expires_at,
    delivery_account,delivery_profile,delivery_url,rejection_reason
  `).eq("user_id",currentUser.id).order("created_at",{ascending:false});

  if(error){console.error("[SUBLY] reseller orders v2",error);container.innerHTML=`<div class="empty">${escapeHtml(error.message||"Could not load orders.")}</div>`;return;}
  const rows=orders||[];
  const customerIds=[...new Set(rows.map(x=>x.customer_id).filter(Boolean))];
  const productIds=[...new Set(rows.map(x=>x.product_id).filter(Boolean))];
  const [customersResult,productsResult]=await Promise.all([
    customerIds.length?supabaseClient.from("customers").select("id,first_name,last_name,phone").in("id",customerIds):Promise.resolve({data:[]}),
    productIds.length?supabaseClient.from("products").select("id,app_name,account_type,duration").in("id",productIds):Promise.resolve({data:[]})
  ]);
  const customers=customersResult.data||[],products=productsResult.data||[];
  if(!rows.length){container.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>No orders yet.</div></div>';return;}

  container.innerHTML=rows.map(order=>{
    const p=products.find(x=>x.id===order.product_id)||{};
    const c=customers.find(x=>x.id===order.customer_id)||null;
    const customerName=c?[c.first_name,c.last_name].filter(Boolean).join(" ").trim():"No customer linked";
    return `<article class="order-card reseller-order-v2">
      <div class="order-top"><div><div class="order-name">${escapeHtml(p.app_name||"Subscription")}</div><div class="order-sub">${escapeHtml(p.account_type||"Standard")} • ${escapeHtml(p.duration||"—")}</div></div><span class="badge ${escapeHtml(order.status||"")}">${escapeHtml(order.status||"unknown")}</span></div>
      <div class="order-info reseller-order-info">
        <div class="info-box"><div class="info-label">Customer</div><div class="info-value">${escapeHtml(customerName)}</div>${c?.phone?`<div class="info-note">${escapeHtml(c.phone)}</div>`:""}</div>
        <div class="info-box"><div class="info-label">Ordered At</div><div class="info-value">${escapeHtml(formatDateTime(order.created_at))}</div></div>
        <div class="info-box"><div class="info-label">Price Paid</div><div class="info-value">${money(order.price_paid)}</div></div>
        <div class="info-box"><div class="info-label">Order #</div><div class="info-value">${escapeHtml(order.order_number||String(order.id).slice(0,8))}</div></div>
        <div class="info-box"><div class="info-label">Requested Profile</div><div class="info-value">${escapeHtml(order.customer_profile_name||"—")}</div></div>
        <div class="info-box"><div class="info-label">Activated</div><div class="info-value">${escapeHtml(formatDateTime(order.activated_at))}</div></div>
        <div class="info-box"><div class="info-label">Expires</div><div class="info-value">${escapeHtml(formatDateTime(order.expires_at))}</div></div>
        <div class="info-box"><div class="info-label">Status</div><div class="info-value">${escapeHtml(order.status||"unknown")}</div></div>
      </div>
      ${order.status==="refunded"?`<div class="reseller-refund-note">Refunded to wallet${order.rejection_reason?` • ${escapeHtml(order.rejection_reason)}`:""}</div>`:""}
      ${order.status==="delivered"?`<div class="reseller-delivery-note"><strong>Delivered:</strong> ${escapeHtml(order.delivery_account||"Account ready")}${order.delivery_profile?` • Profile: ${escapeHtml(order.delivery_profile)}`:""}${order.delivery_url?` • <a href="${escapeHtml(order.delivery_url)}" target="_blank" rel="noopener">Open link</a>`:""}</div>`:""}
    </article>`;
  }).join("");
}
setTimeout(()=>{if(document.body.dataset.page==="orders")loadResellerOrdersV2();},500);
