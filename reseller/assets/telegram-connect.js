(()=>{
  const BOT_USERNAME='SublyNotificationsbot';
  const CODE_TTL_MS=10*60*1000;

  function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
  function randomCode(){
    const bytes=new Uint8Array(18);crypto.getRandomValues(bytes);
    return 's_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }
  function toast(msg){
    let el=document.getElementById('telegramToast');
    if(!el){el=document.createElement('div');el.id='telegramToast';el.className='telegram-toast';document.body.appendChild(el)}
    el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2200);
  }
  function mount(){
    if(document.body?.dataset?.page!=='dashboard'||document.getElementById('telegramNotificationsPanel'))return;
    const activity=document.getElementById('recentActivity')?.closest('.panel');
    if(!activity)return;
    const panel=document.createElement('div');panel.className='panel telegram-panel';panel.id='telegramNotificationsPanel';
    panel.innerHTML=`<div class="panel-head"><div><div class="panel-title">Telegram Notifications</div><div class="panel-sub">Get private reseller updates directly in Telegram</div></div><span id="telegramStatusBadge" class="telegram-status">Checking…</span></div><div class="panel-body"><div class="telegram-connect-row"><div><div id="telegramConnectionTitle" class="telegram-title">Checking connection…</div><div id="telegramConnectionDetail" class="telegram-detail">Please wait.</div></div><div class="telegram-actions"><button id="telegramConnectBtn" class="telegram-connect-btn" type="button">Connect Telegram</button><button id="telegramDisconnectBtn" class="telegram-disconnect-btn" type="button" hidden>Disconnect</button></div></div></div>`;
    activity.parentNode.insertBefore(panel,activity);
    document.getElementById('telegramConnectBtn').addEventListener('click',connectTelegram);
    document.getElementById('telegramDisconnectBtn').addEventListener('click',disconnectTelegram);
    refreshTelegramConnection();
  }
  async function getOwnConnection(){
    if(!window.currentUser&&!currentUser)return null;
    const uid=(window.currentUser||currentUser)?.id;
    const {data,error}=await supabaseClient.from('reseller_telegram_connections').select('telegram_chat_id,telegram_username,connected_at,notifications_enabled,connect_code_expires_at').eq('reseller_id',uid).maybeSingle();
    if(error)throw error;return data;
  }
  async function refreshTelegramConnection(){
    try{
      const row=await getOwnConnection();
      const connected=!!row?.telegram_chat_id;
      const badge=document.getElementById('telegramStatusBadge'),title=document.getElementById('telegramConnectionTitle'),detail=document.getElementById('telegramConnectionDetail'),connect=document.getElementById('telegramConnectBtn'),disconnect=document.getElementById('telegramDisconnectBtn');
      if(!badge)return;
      badge.textContent=connected?'Connected':'Not connected';badge.classList.toggle('connected',connected);
      title.textContent=connected?'Telegram is connected':'Connect your Telegram';
      detail.textContent=connected?(row.telegram_username?'@'+row.telegram_username+' • Notifications enabled':'Notifications enabled'):'Connect once and Subly can send order, wallet and subscription updates.';
      connect.hidden=connected;disconnect.hidden=!connected;
    }catch(e){console.error('[SUBLY] Telegram status:',e);const d=document.getElementById('telegramConnectionDetail');if(d)d.textContent='Could not check Telegram connection.';}
  }
  async function connectTelegram(){
    const btn=document.getElementById('telegramConnectBtn');if(!btn)return;btn.disabled=true;btn.textContent='Creating link…';
    try{
      const uid=(window.currentUser||currentUser)?.id;if(!uid)throw new Error('Reseller session is not ready.');
      const code=randomCode(),expires=new Date(Date.now()+CODE_TTL_MS).toISOString();
      const {error}=await supabaseClient.from('reseller_telegram_connections').upsert({reseller_id:uid,connect_code:code,connect_code_expires_at:expires,updated_at:new Date().toISOString()},{onConflict:'reseller_id'});
      if(error)throw error;
      const url=`https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(code)}`;
      window.open(url,'_blank','noopener,noreferrer');
      btn.textContent='Telegram opened';toast('Press START in Telegram to finish connecting.');
      let checks=0;const timer=setInterval(async()=>{checks++;try{const row=await getOwnConnection();if(row?.telegram_chat_id){clearInterval(timer);await refreshTelegramConnection();toast('Telegram connected ✓')}}catch{}if(checks>=30){clearInterval(timer);btn.disabled=false;btn.textContent='Connect Telegram';}},2000);
    }catch(e){console.error('[SUBLY] Telegram connect:',e);toast(e.message||'Could not create Telegram link.');btn.disabled=false;btn.textContent='Connect Telegram';}
  }
  async function disconnectTelegram(){
    const btn=document.getElementById('telegramDisconnectBtn');if(!btn)return;if(!confirm('Disconnect Telegram notifications from this reseller account?'))return;
    btn.disabled=true;btn.textContent='Disconnecting…';
    try{
      const uid=(window.currentUser||currentUser)?.id;
      const {error}=await supabaseClient.from('reseller_telegram_connections').delete().eq('reseller_id',uid);if(error)throw error;
      toast('Telegram disconnected.');await refreshTelegramConnection();
    }catch(e){console.error('[SUBLY] Telegram disconnect:',e);toast(e.message||'Could not disconnect Telegram.');}finally{btn.disabled=false;btn.textContent='Disconnect';}
  }
  const style=document.createElement('style');style.textContent=`.telegram-panel{margin-bottom:16px}.telegram-connect-row{display:flex;align-items:center;justify-content:space-between;gap:18px}.telegram-title{font-weight:850;font-size:15px}.telegram-detail{margin-top:5px;color:var(--muted);font-size:12px;line-height:1.5}.telegram-actions{display:flex;gap:8px;flex-wrap:wrap}.telegram-connect-btn,.telegram-disconnect-btn{min-height:42px;padding:0 15px;border-radius:11px;font-weight:850;cursor:pointer}.telegram-connect-btn{border:1px solid rgba(95,185,255,.28);background:linear-gradient(135deg,rgba(36,142,221,.2),rgba(85,78,255,.15));color:#8fd3ff}.telegram-disconnect-btn{border:1px solid rgba(255,101,124,.25);background:rgba(255,101,124,.07);color:#ff9aaa}.telegram-status{padding:6px 9px;border:1px solid rgba(255,255,255,.1);border-radius:999px;color:#aaa3b0;font-size:10px;font-weight:850}.telegram-status.connected{color:#79ddb6;border-color:rgba(73,215,161,.25);background:rgba(73,215,161,.07)}.telegram-toast{position:fixed;left:50%;bottom:24px;z-index:9999;transform:translate(-50%,18px);opacity:0;pointer-events:none;padding:11px 15px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#17131d;color:#fff;font-weight:750;box-shadow:0 16px 50px rgba(0,0,0,.35);transition:.2s}.telegram-toast.show{opacity:1;transform:translate(-50%,0)}@media(max-width:650px){.telegram-connect-row{align-items:stretch;flex-direction:column}.telegram-actions,.telegram-connect-btn,.telegram-disconnect-btn{width:100%}}`;
  document.head.appendChild(style);
  const wait=setInterval(()=>{if(typeof supabaseClient!=='undefined'&&(typeof currentUser!=='undefined'&&currentUser)){clearInterval(wait);mount()}},150);setTimeout(()=>clearInterval(wait),15000);
})();