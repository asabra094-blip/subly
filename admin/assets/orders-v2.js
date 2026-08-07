/* Subly Admin Orders v2 */
const legacyAdminLoadOrders = window.loadOrders;
let adminOrderV2Cache = [];
let selectedAdminOrderId = null;

function adminOrderCustomerName(customer){
  if(!customer) return "No customer linked";
  return [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || "Customer";
}

async function loadAdminSubscriptionOrdersV2(){
  const container = document.getElementById("ordersList");
  if(!container) return;

  container.innerHTML = '<div class="empty"><div class="empty-icon">🛒</div><div>Loading orders...</div></div>';

  const {data:orders,error} = await supabaseClient.from("orders").select(`
    id,order_number,user_id,customer_id,product_id,price_paid,status,
    customer_profile_name,created_at,activated_at,expires_at,
    delivery_account,delivery_password,delivery_profile,delivery_pin,
    delivery_url,delivery_notes,rejection_reason
  `).order("created_at",{ascending:false});

  if(error){
    console.error("[SUBLY] Admin orders v2:",error);
    container.innerHTML = `<div class="empty">${escapeHtml(error.message||"Could not load orders.")}</div>`;
    return;
  }

  const rows=orders||[];
  const userIds=[...new Set(rows.map(x=>x.user_id).filter(Boolean))];
  const productIds=[...new Set(rows.map(x=>x.product_id).filter(Boolean))];
  const customerIds=[...new Set(rows.map(x=>x.customer_id).filter(Boolean))];

  const [profilesResult,productsResult,customersResult]=await Promise.all([
    userIds.length?supabaseClient.from("profiles").select("id,username,business_name,reseller_code").in("id",userIds):Promise.resolve({data:[]}),
    productIds.length?supabaseClient.from("products").select("id,app_name,account_type,duration").in("id",productIds):Promise.resolve({data:[]}),
    customerIds.length?supabaseClient.from("customers").select("id,first_name,last_name,phone").in("id",customerIds):Promise.resolve({data:[]})
  ]);

  const profiles=profilesResult.data||[];
  const products=productsResult.data||[];
  const customers=customersResult.data||[];

  adminOrderV2Cache=rows.map(order=>({
    ...order,
    reseller:profiles.find(x=>x.id===order.user_id)||null,
    product:products.find(x=>x.id===order.product_id)||null,
    customer:customers.find(x=>x.id===order.customer_id)||null
  }));

  if(!adminOrderV2Cache.length){
    container.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>No subscription orders yet.</div></div>';
    return;
  }

  container.innerHTML=adminOrderV2Cache.map(order=>{
    const reseller=order.reseller?.business_name||order.reseller?.username||"Unknown reseller";
    const customer=adminOrderCustomerName(order.customer);
    const phone=order.customer?.phone||"—";
    const p=order.product||{};
    const profileWanted=order.customer_profile_name||"—";
    return `<article class="order-card order-v2-card">
      <div class="order-top">
        <div>
          <div class="order-number">Order #${escapeHtml(order.order_number||String(order.id).slice(0,8))}</div>
          <div class="order-name">${escapeHtml(p.app_name||"Unknown product")}</div>
          <div class="order-reseller">${escapeHtml(reseller)}</div>
        </div>
        <span class="status-badge ${escapeHtml(order.status||"")}">${escapeHtml(order.status||"unknown")}</span>
      </div>

      <div class="order-v2-grid">
        <div><span>Customer</span><strong>${escapeHtml(customer)}</strong><small>${escapeHtml(phone)}</small></div>
        <div><span>Account Type</span><strong>${escapeHtml(p.account_type||"Standard")}</strong></div>
        <div><span>Duration</span><strong>${escapeHtml(p.duration||"—")}</strong></div>
        <div><span>Price Paid</span><strong>${money(order.price_paid)}</strong></div>
        <div><span>Ordered At</span><strong>${escapeHtml(formatDateTime(order.created_at))}</strong></div>
        <div><span>Requested Profile</span><strong>${escapeHtml(profileWanted)}</strong></div>
        <div><span>Activated</span><strong>${escapeHtml(formatDateTime(order.activated_at))}</strong></div>
        <div><span>Expires</span><strong>${escapeHtml(formatDateTime(order.expires_at))}</strong></div>
      </div>

      ${order.status==="delivered"?`<div class="delivery-preview">
        <strong>Delivered account</strong>
        <span>${escapeHtml(order.delivery_account||"—")}</span>
        ${order.delivery_profile?`<span>Profile: ${escapeHtml(order.delivery_profile)}</span>`:""}
      </div>`:""}
      ${order.status==="refunded"&&order.rejection_reason?`<div class="refund-note">Refund reason: ${escapeHtml(order.rejection_reason)}</div>`:""}

      ${order.status==="processing"?`<div class="order-actions">
        <button class="order-button primary" onclick="openDeliverOrderV2('${order.id}')">✓ Deliver Order</button>
        <button class="order-button danger" onclick="openRejectOrderV2('${order.id}')">✕ Reject & Refund</button>
      </div>`:""}
    </article>`;
  }).join("");
}

window.loadOrders = async function(){
  if(typeof legacyAdminLoadOrders === "function") await legacyAdminLoadOrders();
  await loadAdminSubscriptionOrdersV2();
};

function openDeliverOrderV2(id){
  const order=adminOrderV2Cache.find(x=>x.id===id); if(!order)return;
  selectedAdminOrderId=id;
  const p=order.product||{};
  document.getElementById("deliverOrderSummary").textContent=`${p.app_name||"Subscription"} • ${p.account_type||"Standard"} • ${p.duration||"—"} • ${adminOrderCustomerName(order.customer)}`;
  ["deliverAccount","deliverPassword","deliverProfile","deliverPin","deliverUrl","deliverNotes"].forEach(x=>{const el=document.getElementById(x);if(el)el.value=""});
  const requested=document.getElementById("deliverRequestedProfile");
  requested.textContent=order.customer_profile_name?`Customer requested profile: ${order.customer_profile_name}`:"No profile name requested.";
  document.getElementById("deliverMessage").textContent="";
  document.getElementById("deliverOrderModal").classList.add("show");
}
function closeDeliverOrderV2(){document.getElementById("deliverOrderModal")?.classList.remove("show");selectedAdminOrderId=null;}

async function submitDeliverOrderV2(){
  if(!selectedAdminOrderId)return;
  const btn=document.getElementById("deliverSubmitButton"),msg=document.getElementById("deliverMessage");
  btn.disabled=true;btn.textContent="Delivering…";msg.textContent="";
  const args={
    p_order_id:selectedAdminOrderId,
    p_account:document.getElementById("deliverAccount").value.trim()||null,
    p_password:document.getElementById("deliverPassword").value.trim()||null,
    p_profile:document.getElementById("deliverProfile").value.trim()||null,
    p_pin:document.getElementById("deliverPin").value.trim()||null,
    p_url:document.getElementById("deliverUrl").value.trim()||null,
    p_notes:document.getElementById("deliverNotes").value.trim()||null
  };
  const {data,error}=await supabaseClient.rpc("admin_deliver_order",args);
  if(error){console.error(error);msg.textContent=error.message||"Could not deliver order.";msg.className="order-modal-message error";}
  else{msg.textContent="Order delivered successfully.";msg.className="order-modal-message success";await loadAdminSubscriptionOrdersV2();setTimeout(closeDeliverOrderV2,650);}
  btn.disabled=false;btn.textContent="Deliver Order";
}

function openRejectOrderV2(id){
  const order=adminOrderV2Cache.find(x=>x.id===id);if(!order)return;
  selectedAdminOrderId=id;
  document.getElementById("rejectOrderSummary").textContent=`Order #${order.order_number||String(order.id).slice(0,8)} • ${money(order.price_paid)} will be returned to the reseller wallet.`;
  document.getElementById("rejectReason").value="";
  document.getElementById("rejectMessage").textContent="";
  document.getElementById("rejectOrderModal").classList.add("show");
}
function closeRejectOrderV2(){document.getElementById("rejectOrderModal")?.classList.remove("show");selectedAdminOrderId=null;}
async function submitRejectOrderV2(){
  if(!selectedAdminOrderId)return;
  if(!confirm("Reject this order and refund the reseller wallet?"))return;
  const btn=document.getElementById("rejectSubmitButton"),msg=document.getElementById("rejectMessage");
  btn.disabled=true;btn.textContent="Refunding…";
  const {data,error}=await supabaseClient.rpc("admin_reject_order",{p_order_id:selectedAdminOrderId,p_reason:document.getElementById("rejectReason").value.trim()||null});
  if(error){console.error(error);msg.textContent=error.message||"Could not reject order.";msg.className="order-modal-message error";}
  else{msg.textContent=`Refunded ${money(data?.refunded||0)} successfully.`;msg.className="order-modal-message success";await loadAdminSubscriptionOrdersV2();setTimeout(closeRejectOrderV2,700);}
  btn.disabled=false;btn.textContent="Reject & Refund";
}

setTimeout(()=>{if(document.body.dataset.page==="orders")loadAdminSubscriptionOrdersV2();},500);
