/* Subly subscription account-type grouping — separate 1 User / Full Account inside each service. */
(()=>{
  'use strict';

  const originalLoadSummary=loadSummary;
  const accountSummaryRows=[];
  const accountSelected=new Map();
  const accountLoading=new Set();
  const accountErrors=new Map();

  const typeRank=value=>{
    const v=String(value||'Standard').trim().toLowerCase();
    if(v==='1 user')return 1;
    if(v==='full account')return 2;
    if(v==='standard')return 3;
    return 4;
  };
  const normalizedType=value=>String(value||'Standard').trim()||'Standard';
  const serviceMatches=(def,name)=>def?.aliases?.includes(sk({app_name:name}))||false;

  async function loadAccountSummary(){
    const{data,error}=await supabaseClient.rpc('get_my_subscription_account_summary');
    if(error)throw error;
    accountSummaryRows.splice(0,accountSummaryRows.length,...(data||[]));
  }

  loadSummary=async function(){
    const active=await originalLoadSummary();
    try{await loadAccountSummary()}catch(error){console.warn('[SUBLY] account-type subscription summary unavailable',error);accountSummaryRows.length=0}
    return active;
  };

  fetchPage=async function({app=null,state='active',search='',page=1,size=SUB_PAGE_SIZE,accountType=null}){
    const{data,error}=await supabaseClient.rpc('get_my_subscriptions_page_v2',{
      p_app_name:app,
      p_state:state,
      p_search:search||null,
      p_page:page,
      p_page_size:size,
      p_account_type:accountType||null
    });
    if(error)throw error;
    return{rows:data||[],total:Number(data?.[0]?.total_count||0)};
  };

  function summaryTypes(def){
    return accountSummaryRows.filter(row=>serviceMatches(def,row.app_name));
  }

  function optionsFor(def){
    const values=new Map();
    for(const product of subProducts){
      if(product.active===false||!serviceMatches(def,product.app_name))continue;
      const type=normalizedType(product.account_type);
      if(!values.has(type))values.set(type,{type,count:0});
    }
    for(const row of summaryTypes(def)){
      const type=normalizedType(row.account_type);
      const item=values.get(type)||{type,count:0};
      item.count=Number(row.active_count||0);
      values.set(type,item);
    }
    const out=[...values.values()].sort((a,b)=>typeRank(a.type)-typeRank(b.type)||a.type.localeCompare(b.type));
    return out.length?out:[{type:'Standard',count:0}];
  }

  function ensureSelected(def){
    const options=optionsFor(def),key=def.key,current=accountSelected.get(key);
    if(current&&options.some(x=>x.type===current))return current;
    const next=(options.find(x=>x.count>0)||options[0]).type;
    accountSelected.set(key,next);
    return next;
  }

  function selectedCount(def,type){
    const row=summaryTypes(def).find(x=>normalizedType(x.account_type)===type);
    return Number(row?.active_count||0);
  }

  function accountTabsHtml(def,selected){
    const options=optionsFor(def);
    if(options.length<=1)return'';
    const label=st('Account type','نوع الحساب');
    return `<div class="sub-account-tabs" role="tablist" aria-label="${escapeHtml(label)}">${options.map(item=>{
      const active=item.type===selected;
      const onclick=`selectSubAccount(${JSON.stringify(def.key)},${JSON.stringify(item.type)})`;
      return `<button class="sub-account-tab ${active?'active':''}" type="button" role="tab" aria-selected="${active?'true':'false'}" onclick='${escapeHtml(onclick)}'><span>${escapeHtml(sp(item.type))}</span><span class="sub-account-tab-count">${Number(item.count||0)}</span></button>`;
    }).join('')}</div>`;
  }

  loadGroup=async function(service,page=1,render=true){
    const def=typeof service==='string'?serviceDefByKey(service):service;
    if(!def)return;
    const s=serviceSummary(def),selected=ensureSelected(def),key=def.key;
    subPages.set(key,page);
    accountLoading.add(key);
    accountErrors.delete(key);
    if(render)renderSubscriptions();
    try{
      const expected=selectedCount(def,selected);
      if(!expected){
        subRows.set(key,[]);
        subTotals.set(key,0);
      }else{
        const r=await fetchPage({app:s.app_name,accountType:selected,page});
        subRows.set(key,r.rows);
        subTotals.set(key,r.total);
        await loadStates(r.rows);
      }
    }catch(error){
      console.error('[SUBLY] account-type subscriptions',error);
      subRows.set(key,[]);
      subTotals.set(key,0);
      accountErrors.set(key,error?.message||'Could not load subscriptions.');
    }finally{
      accountLoading.delete(key);
      if(render)renderSubscriptions();
    }
  };

  groupHtml=function(s){
    const def=serviceDefByKey(s.key),open=subOpen.has(s.key),selected=def?ensureSelected(def):'Standard';
    const rows=subRows.get(s.key)||[],fallbackTotal=def?selectedCount(def,selected):s.active_count,total=subTotals.get(s.key)??fallbackTotal;
    const pages=Math.max(1,Math.ceil(total/SUB_PAGE_SIZE)),page=subPages.get(s.key)||1;
    const tabs=def?accountTabsHtml(def,selected):'';
    let content='';
    if(open){
      if(accountLoading.has(s.key))content=`${tabs}<div class="sub-account-loading">${escapeHtml(st('Loading subscriptions...','جارٍ تحميل الاشتراكات...'))}</div>`;
      else if(accountErrors.has(s.key))content=`${tabs}<div class="empty">${escapeHtml(st('Could not load this account type. Refresh and try again.','تعذر تحميل نوع الحساب هذا. حدّث الصفحة وحاول مجدداً.'))}</div>`;
      else if(rows.length)content=`${tabs}${rows.map(cardHtml).join('')}${pages>1?pager(`changeSubGroup.bind(null,${JSON.stringify(s.key)})`,page,pages):''}`;
      else content=`${tabs}<div class="empty">${escapeHtml(sar()?`لا توجد اشتراكات ${sp(selected)} في ${s.label}.`:`No ${selected} subscriptions for ${s.label}.`)}</div>`;
    }
    return `<section class="sub-group ${open?'open':''}"><button class="sub-group-head" type="button" onclick='toggleSubGroup(${JSON.stringify(s.key)})'><div class="sub-group-main">${s.logo_url?`<img class="sub-app-logo" src="${escapeHtml(s.logo_url)}" alt="${escapeHtml(s.label)}">`:`<div class="sub-app-logo sub-app-fallback">${escapeHtml(s.label[0]||'S')}</div>`}<div><div class="sub-group-name">${escapeHtml(s.label)}</div><div class="sub-group-count">${sar()?`${s.active_count} اشتراك`: `${s.active_count} subscription${s.active_count===1?'':'s'}`}</div></div></div><span class="sub-chevron">⌄</span></button><div class="sub-group-body">${content}</div></section>`;
  };

  toggleSubGroup=async function(key){
    const def=serviceDefByKey(key);
    if(!def)return;
    if(subOpen.has(key)){
      subOpen.delete(key);
      renderSubscriptions();
      return;
    }
    subOpen.add(key);
    ensureSelected(def);
    renderSubscriptions();
    if(!subRows.has(key))await loadGroup(def,1);
  };

  changeSubGroup=async function(key,d){
    const total=subTotals.get(key)||0,pages=Math.max(1,Math.ceil(total/SUB_PAGE_SIZE)),current=subPages.get(key)||1;
    const next=Math.max(1,Math.min(pages,current+d));
    if(next!==current)await loadGroup(key,next);
  };

  window.selectSubAccount=async function(key,type){
    const def=serviceDefByKey(key);
    if(!def)return;
    const clean=normalizedType(type);
    if(accountSelected.get(key)===clean)return;
    accountSelected.set(key,clean);
    subRows.delete(key);
    subTotals.delete(key);
    subPages.set(key,1);
    accountErrors.delete(key);
    await loadGroup(def,1);
  };
})();
