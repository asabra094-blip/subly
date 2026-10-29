/* Subly admin shared shell — auth, helpers, navigation and dashboard only. */
(function applySublyBranding(){
  const style=document.createElement('style');
  style.id='subly-branding';
  style.textContent=`
    .brand-logo,.loader-logo{
      width:120px!important;
      height:120px!important;
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
  if(!document.getElementById('subly-admin-v2')){
    const ui=document.createElement('link');
    ui.id='subly-admin-v2';
    ui.rel='stylesheet';
    ui.href='assets/admin-v2.css?v=20260815-1';
    document.head.appendChild(ui);
  }
  let icon=document.querySelector('link[rel="icon"]');
  if(!icon){icon=document.createElement('link');icon.rel='icon';document.head.appendChild(icon)}
  icon.type='image/svg+xml';icon.href='../favicon.svg';
})();

const SUPABASE_URL='https://ymcvuwovcrqbhuhrjerd.supabase.co';
const SUPABASE_KEY='sb_publishable_Hu2aLWbK4YjkTPevo6TRtw_dRO4BIPc';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let currentAdminUser=null;
let currentAdminProfile=null;

function money(value){return '$'+Number(value||0).toFixed(2)}
function formatDateTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function formatDate(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}
function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function dashboardSubscriptionId(order){return order?.subscription_code||`SUB-${String(order?.id||'').replaceAll('-','').slice(0,8).toUpperCase()}`}
function paymentMethodLabel(value){return ({whish_money:'Whish Money',cash:'Cash',crypto:'Crypto'})[value]||value||'Unknown'}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

function closeMobileMenu(){document.getElementById('adminSidebar')?.classList.remove('open');document.getElementById('sidebarBackdrop')?.classList.remove('show');document.body.classList.remove('menu-open');const b=document.getElementById('menuToggle');if(b)b.setAttribute('aria-expanded','false')}
function toggleMobileMenu(){const side=document.getElementById('adminSidebar');if(!side)return;const open=!side.classList.contains('open');side.classList.toggle('open',open);document.getElementById('sidebarBackdrop')?.classList.toggle('show',open);document.body.classList.toggle('menu-open',open);const b=document.getElementById('menuToggle');if(b)b.setAttribute('aria-expanded',String(open))}
async function logout(){try{await supabaseClient.auth.signOut()}finally{location.href='../login.html'}}

async function fetchAdminProfile(userId){
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    const{data,error}=await supabaseClient.from('profiles').select('id,username,business_name,role,status,tier').eq('id',userId).maybeSingle();
    if(!error)return{profile:data,error:null};
    lastError=error;
    if(attempt===0)await sleep(350);
  }
  return{profile:null,error:lastError};
}

function showAdminAuthRetry(message='Could not verify your session. Check your connection and retry.'){
  const loading=document.getElementById('loadingText');
  if(loading)loading.innerHTML=`${escapeHtml(message)}<br><button type="button" onclick="checkAdmin()" style="margin-top:12px;padding:10px 14px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#17151f;color:#fff;font-weight:800;cursor:pointer">Retry</button>`;
}

async function checkAdmin(){
  const loading=document.getElementById('loadingText');
  if(loading)loading.textContent='Checking admin access...';
  try{
    const{data:sessionData,error:sessionError}=await supabaseClient.auth.getSession();
    if(sessionError){console.error('[SUBLY] admin session read',sessionError);showAdminAuthRetry();return}
    const session=sessionData?.session;
    if(!session?.user){location.replace('../login.html');return}

    const user=session.user;
    const{profile,error:profileError}=await fetchAdminProfile(user.id);
    if(profileError){console.error('[SUBLY] admin profile verification',profileError);showAdminAuthRetry('Temporary connection problem. You are still signed in.');return}

    if(!profile){console.warn('[SUBLY] admin profile missing for authenticated user',user.id);showAdminAuthRetry('Your account profile could not be found. Contact support if this continues.');return}

    if(profile.role!=='admin'||profile.status!=='active'){
      await supabaseClient.auth.signOut();
      location.replace('../login.html');
      return;
    }

    currentAdminUser=user;
    currentAdminProfile=profile;
    const name=document.getElementById('adminName');if(name)name.textContent=profile.username||'Administrator';
    const screen=document.getElementById('loadingScreen');if(screen)screen.style.display='none';
    const app=document.getElementById('app');if(app)app.style.display='block';
    if(document.body?.dataset?.page==='dashboard')await loadDashboard();
    window.dispatchEvent(new CustomEvent('subly:admin-ready'));
  }catch(e){
    console.error('[SUBLY] admin init',e);
    showAdminAuthRetry('Temporary error while loading the admin portal. You are still signed in.');
  }
}

async function loadDashboard(){const resellerEl=document.getElementById('resellerCount');if(!resellerEl)return;const[resellers,orders,topups,walletSummary,recent]=await Promise.all([supabaseClient.from('profiles').select('id',{count:'exact',head:true}).eq('role','reseller'),supabaseClient.from('orders').select('id',{count:'exact',head:true}),supabaseClient.from('topup_requests').select('id',{count:'exact',head:true}).eq('status','pending'),supabaseClient.rpc('admin_wallet_summary'),supabaseClient.from('orders').select('id,subscription_code,user_id,product_id,status,price_paid,created_at').order('created_at',{ascending:false}).limit(5)]);resellerEl.textContent=resellers.error?'—':(resellers.count??0);const orderEl=document.getElementById('orderCount');if(orderEl)orderEl.textContent=orders.error?'—':(orders.count??0);const topupEl=document.getElementById('topupCount');if(topupEl)topupEl.textContent=topups.error?'—':(topups.count??0);const walletEl=document.getElementById('walletTotal');if(walletEl)walletEl.textContent=walletSummary.error?'—':money(walletSummary.data?.total_balance||0);const body=document.querySelector('#dashboard .grid .panel .panel-body');if(!body)return;if(recent.error){body.innerHTML='<div class="empty">Could not load recent orders.</div>';return}const rows=recent.data||[];if(!rows.length){body.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>No orders to display yet.</div></div>';return}const uids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))],pids=[...new Set(rows.map(x=>x.product_id).filter(Boolean))];const[rr,pr]=await Promise.all([uids.length?supabaseClient.from('profiles').select('id,username,business_name').in('id',uids):Promise.resolve({data:[],error:null}),pids.length?supabaseClient.from('products').select('id,app_name,account_type,duration,logo_url').in('id',pids):Promise.resolve({data:[],error:null})]);if(rr.error||pr.error){const e=rr.error||pr.error;console.error('[SUBLY] dashboard related data',e);body.innerHTML=`<div class="empty">${escapeHtml(e.message||'Could not load recent order details.')}</div>`;return}const profiles=rr.data||[],products=pr.data||[];body.innerHTML=rows.map(o=>{const r=profiles.find(x=>x.id===o.user_id)||{},p=products.find(x=>x.id===o.product_id)||{};return `<div class="order-card" style="margin-bottom:10px"><div class="order-top"><div><div class="order-name">${escapeHtml(p.app_name||'Subscription')}</div><div class="order-reseller">${escapeHtml(r.business_name||r.username||'Unknown reseller')} • ${escapeHtml(formatDateTime(o.created_at))}</div></div><span class="status-badge ${escapeHtml(o.status||'')}">${escapeHtml(o.status||'unknown')}</span></div><div class="order-reseller" style="margin-top:8px">${escapeHtml(dashboardSubscriptionId(o))} • ${money(o.price_paid)}</div></div>`}).join('')}

window.addEventListener('resize',()=>{if(innerWidth>900)closeMobileMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileMenu()});
window.addEventListener('load',checkAdmin);

/* Global Shahid automation danger indicator. It is read-only and visible on every admin page. */
(function installShahidAdminNavAlert(){
  const style=document.createElement('style');style.id='subly-shahid-nav-alert-style';style.textContent=`.subly-shahid-nav-alert{display:none;place-items:center;min-width:20px;height:20px;padding:0 6px;margin-left:auto;border-radius:999px;background:#ff536a;color:#fff;font-size:9px;font-weight:950;box-shadow:0 0 0 2px rgba(255,83,106,.13)}.subly-shahid-nav-alert.show{display:inline-grid}.nav-btn.shahid-alerting{border-color:rgba(255,83,106,.28)!important}.nav-btn.shahid-alerting .nav-text{color:#fff}`;document.head.appendChild(style);
  let timer=null;
  function ensureBadge(){
    const link=[...document.querySelectorAll('.nav a.nav-btn')].find(a=>{const h=a.getAttribute('href')||'';return h==='orders.html'||h.endsWith('/orders.html')});
    if(!link)return null;
    let badge=link.querySelector('.subly-shahid-nav-alert');
    if(!badge){badge=document.createElement('span');badge.className='subly-shahid-nav-alert';badge.setAttribute('aria-label','Shahid automation alerts');link.appendChild(badge)}
    return{link,badge};
  }
  async function refresh(){
    if(!currentAdminUser)return;
    const ui=ensureBadge();if(!ui)return;
    try{
      const{data,error}=await supabaseClient.rpc('admin_get_tvleb_shahid_alert_summary');if(error)throw error;
      const open=Number(data?.openIncidents||0),unknown=Number(data?.unknownPurchases||0),count=Math.max(open,unknown);
      ui.badge.textContent=count>99?'99+':String(count);
      ui.badge.classList.toggle('show',count>0);ui.link.classList.toggle('shahid-alerting',count>0);
      ui.link.title=count>0?`${count} Shahid automation alert${count===1?'':'s'} — open Orders → Shahid`:'Orders';
    }catch(e){console.warn('[SUBLY] Shahid admin alert badge',e?.message||e)}
  }
  window.loadShahidAdminNavAlert=refresh;
  window.addEventListener('subly:admin-ready',()=>{refresh();if(!timer)timer=setInterval(refresh,60000)});
})();
