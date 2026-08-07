const SUPABASE_URL="https://ymcvuwovcrqbhuhrjerd.supabase.co";
const SUPABASE_KEY="sb_publishable_Hu2aLWbK4YjkTPevo6TRtw_dRO4BIPc";
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

let currentUser=null;
let currentProfile=null;
let productsCache=[];
let pricesCache=[];
let selectedProduct=null;

const CURRENT_RESELLER_PAGE=document.body?.dataset?.page||"dashboard";

function formatDate(value){if(!value)return"—";return new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});}
function formatDateTime(value){if(!value)return"—";return new Date(value).toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});}
function money(value){return"$"+Number(value||0).toFixed(2);}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function paymentMethodLabel(value){if(value==="whish_money")return"Whish Money";if(value==="cash")return"Cash";if(value==="crypto")return"Crypto";return value||"Unknown";}
function transactionLabel(type){return({topup:"Top-up",purchase:"Purchase",renewal:"Renewal",refund:"Refund",adjustment:"Adjustment"})[type]||type||"Transaction";}
function getPaymentCode(){return currentProfile?.reseller_code||"";}
function getProduct(id){return productsCache.find(item=>item.id===id)||null;}

async function checkReseller(){
 const loadingText=document.getElementById("loadingText");
 try{
  const{data:{user},error:userError}=await supabaseClient.auth.getUser();
  if(userError||!user){location.href="../login.html";return;}
  currentUser=user;
  const{data:profile,error:profileError}=await supabaseClient.from("profiles").select("id,username,business_name,reseller_code,role,status,tier").eq("id",user.id).single();
  if(profileError||!profile||profile.role!=="reseller"||profile.status!=="active"){
   await supabaseClient.auth.signOut();location.href="../login.html";return;
  }
  currentProfile=profile;
  const resellerName=document.getElementById("resellerName");if(resellerName)resellerName.textContent=profile.username||"Reseller";
  const sidebarTier=document.getElementById("sidebarTier");if(sidebarTier)sidebarTier.textContent=(profile.tier||"bronze").toUpperCase();
  const tierValue=document.getElementById("tierValue");if(tierValue)tierValue.textContent=(profile.tier||"bronze").replace(/^./,c=>c.toUpperCase());
  const welcomeText=document.getElementById("welcomeText");if(welcomeText)welcomeText.textContent="Welcome, "+(profile.business_name||profile.username||"Reseller")+" 👋";
  const walletCode=document.getElementById("walletResellerCode");if(walletCode)walletCode.textContent=profile.reseller_code||"—";
  document.getElementById("loadingScreen").style.display="none";
  document.getElementById("app").style.display="block";
  await initializeCurrentPage();
 }catch(error){console.error("[SUBLY] Reseller init crashed:",error);if(loadingText)loadingText.textContent="Something went wrong.";}
}

async function initializeCurrentPage(){
 switch(CURRENT_RESELLER_PAGE){
  case"dashboard":await loadWallet();await loadProducts(false);await loadOrders();break;
  case"products":await loadProducts(true);break;
  case"subscriptions":await loadProducts(false);await loadOrders();break;
  case"orders":await loadProducts(false);await loadOrders();break;
  case"wallet":await Promise.all([loadWallet(),loadTopups()]);break;
  case"transactions":await loadTransactions();break;
 }
}

async function loadWallet(){
 const{data,error}=await supabaseClient.from("wallets").select("balance").eq("user_id",currentUser.id).maybeSingle();
 if(error){console.error("[SUBLY] Wallet error:",error);return;}
 const balance=Number(data?.balance||0);
 const a=document.getElementById("walletBalance");if(a)a.textContent=money(balance);
 const b=document.getElementById("walletPageBalance");if(b)b.textContent=money(balance);
 const c=document.getElementById("walletResellerCode");if(c)c.textContent=currentProfile?.reseller_code||"Not assigned";
}

async function loadProducts(renderGrid=true){
 const grid=document.getElementById("productsGrid");
 const{data:products,error:productsError}=await supabaseClient.from("products").select("id,app_name,account_type,duration,active").eq("active",true).order("app_name",{ascending:true});
 if(productsError){console.error("[SUBLY] Products error:",productsError);if(grid)grid.innerHTML='<div class="empty">Could not load products.</div>';return;}
 const{data:prices,error:pricesError}=await supabaseClient.from("product_prices").select("product_id,tier,price").eq("tier",currentProfile.tier);
 if(pricesError)console.error("[SUBLY] Prices error:",pricesError);
 productsCache=products||[];pricesCache=prices||[];
 if(!renderGrid||!grid)return;
 const cards=productsCache.map(product=>{const price=pricesCache.find(row=>row.product_id===product.id);if(!price)return"";return `<div class="product-card"><div class="product-app">${escapeHtml(product.app_name)}</div><div class="product-type">${escapeHtml(product.account_type||"Standard")}</div><div class="product-duration">⏱ ${escapeHtml(product.duration||"—")}</div><div class="product-price">${money(price.price)}</div><button class="buy-button" onclick="openBuyModal('${product.id}')">Buy Subscription</button></div>`;}).join("");
 grid.innerHTML=cards||'<div class="empty"><div class="empty-icon">📦</div>No products available.</div>';
}

async function loadOrders(){
 const{data:orders,error}=await supabaseClient.from("orders").select("id,user_id,product_id,status,created_at,activated_at,expires_at,delivery_url,delivery_text").eq("user_id",currentUser.id).order("created_at",{ascending:false});
 if(error){console.error("[SUBLY] Orders error:",error);return;}
 const rows=orders||[];
 const count=document.getElementById("orderCount");if(count)count.textContent=rows.length;
 const active=rows.filter(order=>order.status==="delivered"&&(!order.expires_at||new Date(order.expires_at)>new Date()));
 const activeCount=document.getElementById("activeCount");if(activeCount)activeCount.textContent=active.length;
 renderOrders(rows);renderSubscriptions(active);renderRecentOrders(rows.slice(0,5));
}

function renderOrders(orders){
 const container=document.getElementById("ordersList");if(!container)return;
 if(!orders.length){container.innerHTML='<div class="empty"><div class="empty-icon">🛒</div>No orders yet.</div>';return;}
 container.innerHTML=orders.map(order=>{const product=getProduct(order.product_id);return `<div class="order-card"><div class="order-top"><div><div class="order-name">${escapeHtml(product?.app_name||"Subscription")}</div><div class="order-sub">${escapeHtml(product?.account_type||"—")} • ${escapeHtml(product?.duration||"—")}</div></div><span class="badge ${escapeHtml(order.status||"")}">${escapeHtml(order.status||"unknown")}</span></div><div class="order-info"><div class="info-box"><div class="info-label">Ordered</div><div class="info-value">${formatDate(order.created_at)}</div></div><div class="info-box"><div class="info-label">Activated</div><div class="info-value">${formatDate(order.activated_at)}</div></div><div class="info-box"><div class="info-label">Expires</div><div class="info-value">${formatDate(order.expires_at)}</div></div><div class="info-box"><div class="info-label">Order ID</div><div class="info-value">${escapeHtml(String(order.id).slice(0,8))}</div></div></div></div>`;}).join("");
}

function renderSubscriptions(subscriptions){
 const container=document.getElementById("subscriptionsList");if(!container)return;
 if(!subscriptions.length){container.innerHTML='<div class="empty"><div class="empty-icon">📺</div>No active subscriptions.</div>';return;}
 container.innerHTML=subscriptions.map(order=>{const product=getProduct(order.product_id);const delivery=order.delivery_url?`<a href="${escapeHtml(order.delivery_url)}" target="_blank" rel="noopener" style="color:#d7baff">Open</a>`:escapeHtml(order.delivery_text||"—");return `<div class="order-card"><div class="order-top"><div><div class="order-name">${escapeHtml(product?.app_name||"Subscription")}</div><div class="order-sub">${escapeHtml(product?.account_type||"—")} • ${escapeHtml(product?.duration||"—")}</div></div><span class="badge delivered">Active</span></div><div class="order-info"><div class="info-box"><div class="info-label">Activated</div><div class="info-value">${formatDate(order.activated_at)}</div></div><div class="info-box"><div class="info-label">Expires</div><div class="info-value">${formatDate(order.expires_at)}</div></div><div class="info-box"><div class="info-label">Delivery</div><div class="info-value">${delivery}</div></div><div class="info-box"><div class="info-label">Status</div><div class="info-value">Active</div></div></div><button class="renew-button" onclick="prepareRenewal('${order.id}')">🔁 Renew Subscription</button></div>`;}).join("");
}

function renderRecentOrders(orders){
 const container=document.getElementById("recentOrders");if(!container)return;
 if(!orders.length){container.innerHTML='<div class="empty"><div class="empty-icon">🛒</div>No orders yet.</div>';return;}
 container.innerHTML=orders.map(order=>{const product=getProduct(order.product_id);return `<div class="order-card"><div class="order-top"><div><div class="order-name">${escapeHtml(product?.app_name||"Subscription")}</div><div class="order-sub">${escapeHtml(product?.duration||"")}</div></div><span class="badge ${escapeHtml(order.status||"")}">${escapeHtml(order.status||"unknown")}</span></div></div>`;}).join("");
}

function openTopupModal(){
 const modal=document.getElementById("topupModal");if(!modal)return;
 document.getElementById("topupAmount").value="";document.getElementById("topupMethod").value="whish_money";document.getElementById("topupNote").value="";
 const message=document.getElementById("topupMessage");if(message){message.textContent="";message.className="topup-message";}
 updateTopupMethodUI();modal.classList.add("show");
}
function closeTopupModal(){document.getElementById("topupModal")?.classList.remove("show");}
function updateTopupMethodUI(){
 const method=document.getElementById("topupMethod")?.value;const instructions=document.getElementById("topupInstructions");const code=getPaymentCode();const box=document.getElementById("topupPaymentCode");if(box)box.textContent=code||"Payment ID unavailable";if(!instructions)return;
 instructions.innerHTML=method==="cash"?`<strong>How to add funds with Cash:</strong><br>1. Arrange the cash payment with Subly.<br>2. Tell the admin your Payment ID: <span class="payment-code">${escapeHtml(code||"Unavailable")}</span><br>3. Enter the amount and submit the request.<br>4. Your wallet is credited only after admin approval.`:`<strong>How to add funds with Whish Money:</strong><br>1. Copy your Payment ID below.<br>2. Send the money through Whish Money.<br>3. Put <span class="payment-code">${escapeHtml(code||"Unavailable")}</span> in the <strong>payment description</strong>.<br>4. Return here, enter the exact amount, and submit.<br>5. Your wallet is credited after admin verification.`;
}
async function copyPaymentCode(){const code=getPaymentCode();if(!code)return;try{await navigator.clipboard.writeText(code);}catch{const t=document.createElement("textarea");t.value=code;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();}const b=document.getElementById("copyPaymentCodeButton");if(b){const old=b.textContent;b.textContent="✓ Copied";setTimeout(()=>b.textContent=old,1400);}}

async function submitTopupRequest(){
 const amount=Number(document.getElementById("topupAmount")?.value||0);const method=document.getElementById("topupMethod")?.value||"";const note=document.getElementById("topupNote")?.value.trim()||null;const code=getPaymentCode();const button=document.getElementById("submitTopupButton");const message=document.getElementById("topupMessage");
 if(!Number.isFinite(amount)||amount<=0){message.textContent="Enter a valid amount greater than $0.";message.className="topup-message error";return;}if(amount>10000){message.textContent="Top-up amount cannot exceed $10,000.";message.className="topup-message error";return;}if(!["whish_money","cash"].includes(method)){message.textContent="Choose a valid payment method.";message.className="topup-message error";return;}if(!code){message.textContent="Your Payment ID is unavailable. Please contact the admin.";message.className="topup-message error";return;}
 button.disabled=true;button.textContent="Submitting...";
 try{const{data,error}=await supabaseClient.rpc("request_topup",{p_amount:amount,p_payment_method:method,p_payment_reference:code,p_note:note});if(error)throw error;if(!data?.success)throw new Error("Could not submit top-up request.");message.textContent=`Top-up request for ${money(amount)} submitted. It is now pending admin verification.`;message.className="topup-message success";await loadTopups();setTimeout(closeTopupModal,1200);}catch(error){console.error("[SUBLY] Top-up request error:",error);message.textContent=error.message||"Could not submit top-up request.";message.className="topup-message error";}finally{button.disabled=false;button.textContent="Submit Top-up Request";}
}

async function loadTopups(){
 const container=document.getElementById("topupHistory");if(!container||!currentUser)return;
 const{data,error}=await supabaseClient.from("topup_requests").select("id,amount,currency,payment_method,payment_reference,note,status,reviewed_at,created_at").eq("user_id",currentUser.id).order("created_at",{ascending:false});
 if(error){console.error("[SUBLY] Top-up history error:",error);container.innerHTML='<div class="empty finance-empty">Could not load top-up history.</div>';return;}
 const rows=data||[];if(!rows.length){container.innerHTML='<div class="empty finance-empty"><div class="empty-icon">💳</div><div>No top-up requests yet.</div></div>';return;}
 container.innerHTML=rows.map(item=>`<div class="finance-item"><div class="finance-main"><div class="finance-title">${money(item.amount)} • ${escapeHtml(paymentMethodLabel(item.payment_method))}</div><div class="finance-sub">Payment ID: ${escapeHtml(item.payment_reference||"—")}${item.note?` • ${escapeHtml(item.note)}`:""}</div></div><div><div class="finance-label">Status</div><span class="badge ${escapeHtml(item.status||"pending")}">${escapeHtml(item.status||"pending")}</span></div><div><div class="finance-label">Amount</div><div class="finance-value">${money(item.amount)}</div></div><div class="finance-date"><div class="finance-label">Submitted</div><div class="finance-value">${formatDateTime(item.created_at)}</div></div></div>`).join("");
}

async function loadTransactions(){
 const container=document.getElementById("transactionsList");if(!container||!currentUser)return;
 const{data,error}=await supabaseClient.from("wallet_transactions").select("id,amount,balance_after,type,description,order_id,topup_id,created_at").eq("user_id",currentUser.id).order("created_at",{ascending:false});
 if(error){console.error("[SUBLY] Transactions error:",error);container.innerHTML='<div class="empty finance-empty">Could not load transaction history.</div>';return;}
 const rows=data||[];if(!rows.length){container.innerHTML='<div class="empty finance-empty"><div class="empty-icon">📜</div><div>No wallet transactions yet.</div></div>';return;}
 container.innerHTML=rows.map(item=>{const amount=Number(item.amount||0);const cls=amount>=0?"credit":"debit";return `<div class="finance-item"><div class="finance-main"><div class="finance-title">${escapeHtml(transactionLabel(item.type))}</div><div class="finance-sub">${escapeHtml(item.description||"")}${item.order_id?` • Order ${escapeHtml(String(item.order_id).slice(0,8))}`:""}</div></div><div><div class="finance-label">Amount</div><div class="tx-amount ${cls}">${amount>0?"+":""}${money(amount)}</div></div><div><div class="finance-label">Balance After</div><div class="finance-value">${money(item.balance_after)}</div></div><div class="finance-date"><div class="finance-label">Date</div><div class="finance-value">${formatDateTime(item.created_at)}</div></div></div>`;}).join("");
}

function openBuyModal(productId){
 const product=getProduct(productId);const price=pricesCache.find(item=>item.product_id===productId);if(!product||!price)return;selectedProduct={...product,price:Number(price.price)};
 document.getElementById("confirmProduct").textContent=product.app_name;document.getElementById("confirmType").textContent=product.account_type||"Standard";document.getElementById("confirmDuration").textContent=product.duration||"—";document.getElementById("confirmPrice").textContent=money(price.price);document.getElementById("buyMessage").textContent="Confirming will charge your wallet once secure ordering is connected.";document.getElementById("buyModal").classList.add("show");
}
function closeBuyModal(){document.getElementById("buyModal")?.classList.remove("show");}
function confirmPurchase(){const msg=document.getElementById("buyMessage");if(msg)msg.textContent="Secure purchasing backend is the next step.";}
function prepareRenewal(orderId){console.log("[SUBLY] Renewal requested for:",orderId);alert("Renewal selection will be connected next.");}

async function logout(){await supabaseClient.auth.signOut();location.href="../login.html";}
function openMobileMenu(){if(innerWidth>760)return;document.body.classList.add("menu-open");document.getElementById("menuToggle")?.setAttribute("aria-expanded","true");}
function closeMobileMenu(){document.body.classList.remove("menu-open");document.getElementById("menuToggle")?.setAttribute("aria-expanded","false");}
function toggleMobileMenu(){document.body.classList.contains("menu-open")?closeMobileMenu():openMobileMenu();}
document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeMobileMenu();closeTopupModal();closeBuyModal();}});
addEventListener("resize",()=>{if(innerWidth>760)closeMobileMenu();});
document.querySelectorAll(".nav-btn").forEach(link=>link.addEventListener("click",()=>{if(innerWidth<=760)closeMobileMenu();}));

checkReseller();
