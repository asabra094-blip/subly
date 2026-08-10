(function applySublyBranding(){
  const style=document.createElement('style');
  style.id='subly-branding';
  style.textContent=`
    .brand-logo,.loader-logo{
      width:112px!important;
      height:112px!important;
      border-radius:50%!important;
      object-fit:cover!important;
      object-position:center!important;
      display:block!important;
      overflow:hidden!important;
      background:#08080c!important;
      box-shadow:0 0 0 1px rgba(255,255,255,.08),0 16px 48px rgba(139,92,255,.18)!important;
    }
    .loader-logo{width:145px!important;height:145px!important;animation:sublyBrandFloat 4s ease-in-out infinite!important;}
    @keyframes sublyBrandFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @media(prefers-reduced-motion:reduce){.loader-logo{animation:none!important}}
  `;
  document.head.appendChild(style);
  let icon=document.querySelector('link[rel="icon"]');
  if(!icon){icon=document.createElement('link');icon.rel='icon';document.head.appendChild(icon)}
  icon.type='image/svg+xml';icon.href='../favicon.svg';
})();

const SUPABASE_URL="https://ymcvuwovcrqbhuhrjerd.supabase.co";
const SUPABASE_KEY="sb_publishable_Hu2aLWbK4YjkTPevo6TRtw_dRO4BIPc";
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

let currentUser=null;
let currentProfile=null;
const CURRENT_RESELLER_PAGE=document.body?.dataset?.page||"dashboard";
const RESELLER_TOPUP_PAGE_SIZE=25;
let resellerTopupPage=1;
let resellerTopupTotal=0;

function formatDate(value){if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});}
function formatDateTime(value){if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});}
function money(value){const n=Number(value);return"$"+(Number.isFinite(n)?n:0).toFixed(2);}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function paymentMethodLabel(value){if(value==="whish_money")return"Whish Money";if(value==="cash")return"Cash";if(value==="crypto")return"Crypto";return value||"Unknown";}
function transactionLabel(type){return({topup:"Top-up",purchase:"Purchase",renewal:"Renewal",refund:"Refund",adjustment:"Adjustment",manual_adjustment:"Adjustment"})[type]||type||"Transaction";}
function getPaymentCode(){return currentProfile?.reseller_code||"";}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function fetchResellerProfile(userId){
 let lastError=null;
 for(let attempt=0;attempt<2;attempt++){
  const{data,error}=await supabaseClient.from("profiles").select("id,username,business_name,reseller_code,role,status,tier").eq("id",userId).maybeSingle();
  if(!error)return{profile:data,error:null};
  lastError=error;
  if(attempt===0)await sleep(350);
 }
 return{profile:null,error:lastError};
}

function showResellerAuthRetry(message="Could not verify your session. Check your connection and retry."){
 const loadingText=document.getElementById("loadingText");
 if(loadingText)loadingText.innerHTML=`${escapeHtml(message)}<br><button type="button" onclick="checkReseller()" style="margin-top:12px;padding:10px 14px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#17151f;color:#fff;font-weight:800;cursor:pointer">Retry</button>`;
}

async function checkReseller(){
 const loadingText=document.getElementById("loadingText");
 if(loadingText)loadingText.textContent="Checking reseller access...";
 try{
  const{data:sessionData,error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError){console.error("[SUBLY] Reseller session read:",sessionError);showResellerAuthRetry();return;}
  const session=sessionData?.session;
  if(!session?.user){location.replace("../login.html");return;}

  const user=session.user;
  const{profile,error:profileError}=await fetchResellerProfile(user.id);
  if(profileError){console.error("[SUBLY] Reseller profile verification:",profileError);showResellerAuthRetry("Temporary connection problem. You are still signed in.");return;}
  if(!profile){console.warn("[SUBLY] Reseller profile missing for authenticated user",user.id);showResellerAuthRetry("Your account profile could not be found. Contact support if this continues.");return;}

  if(profile.role!=="reseller"||profile.status!=="active"){
   await supabaseClient.auth.signOut();
   location.replace("../login.html");
   return;
  }

  currentUser=user;
  currentProfile=profile;
  document.getElementById("resellerName")?.replaceChildren(document.createTextNode(profile.username||"Reseller"));
  const sidebarTier=document.getElementById("sidebarTier");if(sidebarTier)sidebarTier.textContent=(profile.tier||"bronze").toUpperCase();
  const tierValue=document.getElementById("tierValue");if(tierValue)tierValue.textContent=(profile.tier||"bronze").replace(/^./,c=>c.toUpperCase());
  const welcomeText=document.getElementById("welcomeText");if(welcomeText)welcomeText.textContent="Welcome, "+(profile.business_name||profile.username||"Reseller")+" 👋";
  const walletCode=document.getElementById("walletResellerCode");if(walletCode)walletCode.textContent=profile.reseller_code||"—";
  const loading=document.getElementById("loadingScreen");if(loading)loading.style.display="none";
  const app=document.getElementById("app");if(app)app.style.display="block";
  await initializeCurrentPage();
 }catch(error){console.error("[SUBLY] Reseller init crashed:",error);showResellerAuthRetry("Temporary error while loading the reseller portal. You are still signed in.");}
}

async function initializeCurrentPage(){
 if(CURRENT_RESELLER_PAGE==="dashboard")await Promise.all([loadWallet(),loadDashboardSummary()]);
 else if(CURRENT_RESELLER_PAGE==="wallet")await Promise.all([loadWallet(),loadTopups()]);
}

async function loadWallet(){
 if(!currentUser)return;
 const{data,error}=await supabaseClient.from("wallets").select("balance").eq("user_id",currentUser.id).maybeSingle();
 if(error){console.error("[SUBLY] Wallet error:",error);return;}
 const balance=Number(data?.balance||0);
 const a=document.getElementById("walletBalance");if(a)a.textContent=money(balance);
 const b=document.getElementById("walletPageBalance");if(b)b.textContent=money(balance);
 const c=document.getElementById("walletResellerCode");if(c)c.textContent=currentProfile?.reseller_code||"Not assigned";
}

function dashboardActivityStatus(kind,status){
 if(kind==="topup")return({pending:{label:"Pending",tone:"pending"},approved:{label:"Approved",tone:"approved"},rejected:{label:"Rejected",tone:"rejected"}})[status]||{label:status||"Unknown",tone:"neutral"};
 return({processing:{label:"Pending",tone:"pending"},delivered:{label:"Delivered",tone:"delivered"},refunded:{label:"Refunded",tone:"refunded"},rejected:{label:"Rejected",tone:"rejected"},cancelled:{label:"Cancelled",tone:"rejected"}})[status]||{label:status||"Unknown",tone:"neutral"};
}

async function loadDashboardSummary(){
 if(!currentUser)return;
 const [ordersCount,activeCount,recentOrders,recentTopups,products]=await Promise.all([
  supabaseClient.from("orders").select("id",{count:"exact",head:true}).eq("user_id",currentUser.id),
  supabaseClient.from("orders").select("id",{count:"exact",head:true}).eq("user_id",currentUser.id).eq("status","delivered").gt("expires_at",new Date().toISOString()),
  supabaseClient.from("orders").select("id,order_number,product_id,status,price_paid,created_at,activated_at").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(8),
  supabaseClient.from("topup_requests").select("id,amount,payment_method,status,created_at,reviewed_at").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(8),
  supabaseClient.from("products").select("id,app_name,account_type,duration,logo_url")
 ]);
 const orderEl=document.getElementById("orderCount");if(orderEl)orderEl.textContent=ordersCount.count??0;
 const activeEl=document.getElementById("activeCount");if(activeEl)activeEl.textContent=activeCount.count??0;
 const container=document.getElementById("recentActivity");if(!container)return;
 if(recentOrders.error||recentTopups.error){console.error("[SUBLY] Dashboard activity error",recentOrders.error||recentTopups.error);container.innerHTML='<div class="empty">Could not load recent activity.</div>';return;}
 const plist=products.data||[];
 const orderActivities=(recentOrders.data||[]).map(order=>{const p=plist.find(x=>x.id===order.product_id)||{},state=dashboardActivityStatus("order",order.status);return{time:order.status==="delivered"&&order.activated_at?order.activated_at:order.created_at,icon:p.logo_url?`<img src="${escapeHtml(p.logo_url)}" alt="${escapeHtml(p.app_name||"Subscription")}">`:'📺',title:`${escapeHtml(p.app_name||"Subscription")} ${state.label.toLowerCase()}`,detail:`${escapeHtml(p.account_type||"Standard")} • ${escapeHtml(p.duration||"—")} • ${money(order.price_paid)}`,status:state};});
 const topupActivities=(recentTopups.data||[]).map(item=>{const state=dashboardActivityStatus("topup",item.status);return{time:item.status!=="pending"&&item.reviewed_at?item.reviewed_at:item.created_at,icon:'💳',title:`Top-up ${state.label.toLowerCase()}`,detail:`${money(item.amount)} • ${escapeHtml(paymentMethodLabel(item.payment_method))}`,status:state};});
 const activities=[...orderActivities,...topupActivities].sort((a,b)=>new Date(b.time||0)-new Date(a.time||0)).slice(0,8);
 if(!activities.length){container.innerHTML='<div class="empty"><div class="empty-icon">⚡</div>No activity yet.</div>';return;}
 container.innerHTML=activities.map(item=>`<div class="activity-item"><div class="activity-icon">${item.icon}</div><div class="activity-main"><div class="activity-title">${item.title}</div><div class="activity-detail">${item.detail}</div></div><div class="activity-side"><span class="activity-badge ${escapeHtml(item.status.tone)}">${escapeHtml(item.status.label)}</span><time>${escapeHtml(formatDateTime(item.time))}</time></div></div>`).join("");
}

function openTopupModal(){
 const modal=document.getElementById("topupModal");if(!modal)return;
 const amount=document.getElementById("topupAmount"),method=document.getElementById("topupMethod"),note=document.getElementById("topupNote");
 if(amount)amount.value="";if(method)method.value="whish_money";if(note)note.value="";
 const message=document.getElementById("topupMessage");if(message){message.textContent="";message.className="topup-message";}
 updateTopupMethodUI();modal.classList.add("show");
}
function closeTopupModal(){document.getElementById("topupModal")?.classList.remove("show");}
function updateTopupMethodUI(){
 const method=document.getElementById("topupMethod")?.value,instructions=document.getElementById("topupInstructions"),code=getPaymentCode(),box=document.getElementById("topupPaymentCode");
 if(box)box.textContent=code||"Payment ID unavailable";if(!instructions)return;
 instructions.innerHTML=method==="cash"?`<strong>How to add funds with Cash:</strong><br>1. Arrange the cash payment with Subly.<br>2. Tell the admin your Payment ID: <span class="payment-code">${escapeHtml(code||"Unavailable")}</span><br>3. Enter the amount and submit the request.<br>4. Your wallet is credited only after admin approval.`:`<strong>How to add funds with Whish Money:</strong><br>1. Copy your Payment ID below.<br>2. Send the money through Whish Money.<br>3. Put <span class="payment-code">${escapeHtml(code||"Unavailable")}</span> in the <strong>payment description</strong>.<br>4. Return here, enter the exact amount, and submit.<br>5. Your wallet is credited after admin verification.`;
}
async function copyPaymentCode(){const code=getPaymentCode();if(!code)return;try{await navigator.clipboard.writeText(code);}catch{const t=document.createElement("textarea");t.value=code;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();}const b=document.getElementById("copyPaymentCodeButton");if(b){const old=b.textContent;b.textContent="✓ Copied";setTimeout(()=>b.textContent=old,1400);}}

async function submitTopupRequest(){
 const amount=Number(document.getElementById("topupAmount")?.value||0),method=document.getElementById("topupMethod")?.value||"",note=document.getElementById("topupNote")?.value.trim()||null,code=getPaymentCode(),button=document.getElementById("submitTopupButton"),message=document.getElementById("topupMessage");
 if(!button||!message)return;
 if(!Number.isFinite(amount)||amount<=0){message.textContent="Enter a valid amount greater than $0.";message.className="topup-message error";return;}
 if(amount>10000){message.textContent="Top-up amount cannot exceed $10,000.";message.className="topup-message error";return;}
 if(!["whish_money","cash"].includes(method)){message.textContent="Choose a valid payment method.";message.className="topup-message error";return;}
 if(!code){message.textContent="Your Payment ID is unavailable. Please contact the admin.";message.className="topup-message error";return;}
 button.disabled=true;button.textContent="Submitting...";
 try{const{data,error}=await supabaseClient.rpc("request_topup",{p_amount:amount,p_payment_method:method,p_payment_reference:code,p_note:note});if(error)throw error;if(!data?.success)throw new Error("Could not submit top-up request.");message.textContent=`Top-up request for ${money(amount)} submitted. It is now pending admin verification.`;message.className="topup-message success";resellerTopupPage=1;await Promise.all([loadTopups(),loadWallet()]);setTimeout(closeTopupModal,1200);}catch(error){console.error("[SUBLY] Top-up request error:",error);message.textContent=error.message||"Could not submit top-up request.";message.className="topup-message error";}finally{button.disabled=false;button.textContent="Submit Top-up Request";}
}

function topupPager(){const pages=Math.max(1,Math.ceil(resellerTopupTotal/RESELLER_TOPUP_PAGE_SIZE)),first=resellerTopupTotal?((resellerTopupPage-1)*RESELLER_TOPUP_PAGE_SIZE)+1:0,last=Math.min(resellerTopupPage*RESELLER_TOPUP_PAGE_SIZE,resellerTopupTotal);return `<div class="list-pager"><button class="secondary-action" ${resellerTopupPage<=1?'disabled':''} onclick="changeResellerTopupPage(-1)">← Previous</button><span>${first}–${last} of ${resellerTopupTotal} • Page ${resellerTopupPage}/${pages}</span><button class="secondary-action" ${resellerTopupPage>=pages?'disabled':''} onclick="changeResellerTopupPage(1)">Next →</button></div>`;}
function changeResellerTopupPage(delta){const pages=Math.max(1,Math.ceil(resellerTopupTotal/RESELLER_TOPUP_PAGE_SIZE)),next=resellerTopupPage+delta;if(next<1||next>pages)return;resellerTopupPage=next;loadTopups();}
async function loadTopups(){
 const container=document.getElementById("topupHistory");if(!container||!currentUser)return;
 const from=(resellerTopupPage-1)*RESELLER_TOPUP_PAGE_SIZE,to=from+RESELLER_TOPUP_PAGE_SIZE-1;
 const{data,error,count}=await supabaseClient.from("topup_requests").select("id,amount,currency,payment_method,payment_reference,note,status,reviewed_at,created_at",{count:"exact"}).eq("user_id",currentUser.id).order("created_at",{ascending:false}).range(from,to);
 if(error){console.error("[SUBLY] Top-up history error:",error);container.innerHTML='<div class="empty finance-empty">Could not load top-up history.</div>';return;}
 resellerTopupTotal=count||0;const rows=data||[];
 if(!rows.length){container.innerHTML='<div class="empty finance-empty"><div class="empty-icon">💳</div><div>No top-up requests yet.</div></div>'+topupPager();return;}
 container.innerHTML=rows.map(item=>`<div class="finance-item"><div class="finance-main"><div class="finance-title">${money(item.amount)} • ${escapeHtml(paymentMethodLabel(item.payment_method))}</div><div class="finance-sub">Payment ID: ${escapeHtml(item.payment_reference||"—")}${item.note?` • ${escapeHtml(item.note)}`:""}</div></div><div><div class="finance-label">Status</div><span class="badge ${escapeHtml(item.status||"pending")}">${escapeHtml(item.status||"pending")}</span></div><div><div class="finance-label">Amount</div><div class="finance-value">${money(item.amount)}</div></div><div class="finance-date"><div class="finance-label">Submitted</div><div class="finance-value">${escapeHtml(formatDateTime(item.created_at))}</div></div></div>`).join("")+topupPager();
}

async function logout(){await supabaseClient.auth.signOut();location.replace("../login.html");}
function openMobileMenu(){if(innerWidth>760)return;document.body.classList.add("menu-open");document.getElementById("menuToggle")?.setAttribute("aria-expanded","true");}
function closeMobileMenu(){document.body.classList.remove("menu-open");document.getElementById("menuToggle")?.setAttribute("aria-expanded","false");}
function toggleMobileMenu(){document.body.classList.contains("menu-open")?closeMobileMenu():openMobileMenu();}
document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeMobileMenu();closeTopupModal();}});
addEventListener("resize",()=>{if(innerWidth>760)closeMobileMenu();});
document.querySelectorAll(".nav-btn").forEach(link=>link.addEventListener("click",()=>{if(innerWidth<=760)closeMobileMenu();}));

checkReseller();