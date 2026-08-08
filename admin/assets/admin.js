/* Subly admin shared shell — auth, helpers, navigation and dashboard only. */
const SUPABASE_URL='https://ymcvuwovcrqbhuhrjerd.supabase.co';
const SUPABASE_KEY='sb_publishable_Hu2aLWbK4YjkTPevo6TRtw_dRO4BIPc';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let currentAdminUser=null;
let currentAdminProfile=null;

function money(value){return '$'+Number(value||0).toFixed(2)}
function formatDateTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function formatDate(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}
function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function paymentMethodLabel(value){return ({whish_money:'Whish Money',cash:'Cash',crypto:'Crypto'})[value]||value||'Unknown'}

function closeMobileMenu(){document.getElementById('adminSidebar')?.classList.remove('open');document.getElementById('sidebarBackdrop')?.classList.remove('show');document.body.classList.remove('menu-open');const b=document.getElementById('menuToggle');if(b)b.setAttribute('aria-expanded','false')}
function toggleMobileMenu(){const side=document.getElementById('adminSidebar');if(!side)return;const open=!side.classList.contains('open');side.classList.toggle('open',open);document.getElementById('sidebarBackdrop')?.classList.toggle('show',open);document.body.classList.toggle('menu-open',open);const b=document.getElementById('menuToggle');if(b)b.setAttribute('aria-expanded',String(open))}
async function logout(){try{await supabaseClient.auth.signOut()}finally{location.href='../login.html'}}

async function checkAdmin(){
 const loading=document.getElementById('loadingText');
 try{
  const{data:{user},error}=await supabaseClient.auth.getUser();
  if(error||!user){location.replace('../login.html');return}
  const{data:profile,error:pe}=await supabaseClient.from('profiles').select('id,username,business_name,role,status,tier').eq('id',user.id).single();
  if(pe||!profile||profile.role!=='admin'||profile.status!=='active'){
   await supabaseClient.auth.signOut();location.replace('../login.html');return;
  }
  currentAdminUser=user;currentAdminProfile=profile;
  const name=document.getElementById('adminName');if(name)name.textContent=profile.username||'Administrator';
  document.getElementById('loadingScreen').style.display='none';
  document.getElementById('app').style.display='block';
  if(document.body?.dataset?.page==='dashboard')await loadDashboard();
  window.dispatchEvent(new CustomEvent('subly:admin-ready'));
 }catch(e){console.error('[SUBLY] admin init',e);if(loading)loading.textContent='Something went wrong. Refresh and try again.'}
}

async function loadDashboard(){
 const resellerEl=document.getElementById('resellerCount');if(!resellerEl)return;
 const [resellers,orders,topups,wallets,recent]=await Promise.all([
  supabaseClient.from('profiles').select('*',{count:'exact',head:true}).eq('role','reseller'),
  supabaseClient.from('orders').select('*',{count:'exact',head:true}),
  supabaseClient.from('topup_requests').select('*',{count:'exact',head:true}).eq('status','pending'),
  supabaseClient.from('wallets').select('balance'),
  supabaseClient.from('orders').select('id,order_number,user_id,product_id,status,price_paid,created_at').order('created_at',{ascending:false}).limit(5)
 ]);
 resellerEl.textContent=resellers.error?'—':(resellers.count??0);
 const orderEl=document.getElementById('orderCount');if(orderEl)orderEl.textContent=orders.error?'—':(orders.count??0);
 const topupEl=document.getElementById('topupCount');if(topupEl)topupEl.textContent=topups.error?'—':(topups.count??0);
 const walletEl=document.getElementById('walletTotal');if(walletEl)walletEl.textContent=wallets.error?'—':money((wallets.data||[]).reduce((s,x)=>s+Number(x.balance||0),0));
 const body=document.querySelector('#dashboard .grid .panel .panel-body');if(!body)return;
 if(recent.error){body.innerHTML='<div class="empty">Could not load recent orders.</div>';return}
 const rows=recent.data||[];if(!rows.length){body.innerHTML='<div class="empty"><div class="empty-icon">🛒</div><div>No orders to display yet.</div></div>';return}
 const uids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))],pids=[...new Set(rows.map(x=>x.product_id).filter(Boolean))];
 const [rr,pr]=await Promise.all([
  uids.length?supabaseClient.from('profiles').select('id,username,business_name').in('id',uids):Promise.resolve({data:[]}),
  pids.length?supabaseClient.from('products').select('id,app_name,account_type,duration,logo_url').in('id',pids):Promise.resolve({data:[]})
 ]);
 const profiles=rr.data||[],products=pr.data||[];
 body.innerHTML=rows.map(o=>{const r=profiles.find(x=>x.id===o.user_id)||{},p=products.find(x=>x.id===o.product_id)||{};return `<div class="order-card" style="margin-bottom:10px"><div class="order-top"><div><div class="order-name">${escapeHtml(p.app_name||'Subscription')}</div><div class="order-reseller">${escapeHtml(r.business_name||r.username||'Unknown reseller')} • ${escapeHtml(formatDateTime(o.created_at))}</div></div><span class="status-badge ${escapeHtml(o.status||'')}">${escapeHtml(o.status||'unknown')}</span></div><div class="order-reseller" style="margin-top:8px">#${escapeHtml(o.order_number||String(o.id).slice(0,8))} • ${money(o.price_paid)}</div></div>`}).join('');
}

window.addEventListener('resize',()=>{if(innerWidth>900)closeMobileMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileMenu()});
window.addEventListener('load',checkAdmin);
