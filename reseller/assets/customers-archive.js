/* Archived customers UI extension */
let customerView='active';
let allCustomersCache=[];

async function loadCustomers(){
  const {data,error}=await supabaseClient.from('customers')
    .select('id,reseller_id,first_name,last_name,phone,notes,status,created_at,updated_at')
    .eq('reseller_id',currentUser.id)
    .in('status',['active','archived'])
    .order('created_at',{ascending:false});
  if(error){console.error('[SUBLY] Customers',error);qs('customersGrid').innerHTML='<div class="empty">Could not load customers.</div>';return}
  allCustomersCache=data||[];
  updateCustomerTabCounts();
  renderCustomers();
}

function updateCustomerTabCounts(){
  const active=allCustomersCache.filter(c=>c.status==='active').length;
  const archived=allCustomersCache.filter(c=>c.status==='archived').length;
  if(qs('activeCustomerCount'))qs('activeCustomerCount').textContent=active;
  if(qs('archivedCustomerCount'))qs('archivedCustomerCount').textContent=archived;
}

function setCustomerView(view){
  customerView=view==='archived'?'archived':'active';
  qs('activeCustomersTab')?.classList.toggle('active',customerView==='active');
  qs('archivedCustomersTab')?.classList.toggle('active',customerView==='archived');
  qs('activeCustomersTab')?.setAttribute('aria-selected',String(customerView==='active'));
  qs('archivedCustomersTab')?.setAttribute('aria-selected',String(customerView==='archived'));
  if(qs('addCustomerButton'))qs('addCustomerButton').style.display=customerView==='active'?'':'none';
  if(qs('customerCountLabel'))qs('customerCountLabel').textContent=customerView==='active'?'active customers':'archived customers';
  renderCustomers();
}

function renderCustomers(){
  const grid=qs('customersGrid');if(!grid)return;
  const q=(qs('customerSearch')?.value||'').trim().toLowerCase(),qd=digits(q);
  customersCache=allCustomersCache.filter(c=>c.status===customerView);
  const list=customersCache.filter(c=>{const name=customerFullName(c).toLowerCase(),p=digits(c.phone);return !q||name.includes(q)||String(c.phone||'').toLowerCase().includes(q)||(qd&&p.includes(qd))});
  if(qs('customerCount'))qs('customerCount').textContent=list.length;
  if(!list.length){
    const empty=q?'No customers match your search.':customerView==='archived'?'No archived customers.':'No customers yet. Add your first customer.';
    grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${customerView==='archived'?'🗃️':'👥'}</div>${empty}</div>`;return;
  }
  grid.innerHTML=list.map(c=>{const stat=customerStats.get(c.id)||{},active=Number(stat.active_count||0),latest=stat.last_purchase,archived=customerView==='archived';return `<article class="customer-card${archived?' archived-customer-card':''}"><div class="customer-card-top"><div><div class="customer-name">${safe(customerFullName(c))}</div><a class="customer-phone" href="${safe(phoneHref(c.phone))}" target="_blank" rel="noopener noreferrer">📱 ${safe(c.phone)}</a></div><div class="customer-menu" id="menu-${c.id}"><button class="customer-menu-btn" onclick="toggleCustomerMenu('${c.id}',event)" aria-label="Customer options">⋯</button><div class="customer-menu-list"><button onclick="openHistory('${c.id}')">View subscriptions</button><button onclick="openCustomerModal('${c.id}')">Edit customer</button>${archived?`<button class="restore" onclick="restoreCustomer('${c.id}')">Restore customer</button>`:`<button class="danger" onclick="deleteCustomer('${c.id}')">Archive customer</button>`}</div></div></div><div class="customer-meta"><div class="customer-meta-box"><div class="customer-meta-label">Active subscriptions</div><div class="customer-meta-value">${active}</div></div><div class="customer-meta-box"><div class="customer-meta-label">Last purchase</div><div class="customer-meta-value">${latest?formatDate(latest):'—'}</div></div></div><div class="customer-actions">${archived?`<button class="customer-action primary restore-action" onclick="restoreCustomer('${c.id}')">↩ Restore Customer</button><button class="customer-action" onclick="openHistory('${c.id}')">📺 View History</button>`:`<button class="customer-action primary" onclick="openSubscriptionModal('${c.id}')">＋ Add Subscription</button><button class="customer-action" onclick="openWhatsApp('${c.id}')">💬 Open WhatsApp</button>`}</div></article>`}).join('');
}

async function deleteCustomer(id){
  const c=allCustomersCache.find(x=>x.id===id);if(!c||!confirm(`Archive ${customerFullName(c)}? Their old orders and subscription history will be preserved.`))return;
  const{error}=await supabaseClient.from('customers').update({status:'archived'}).eq('id',id).eq('reseller_id',currentUser.id);
  if(error){alert(error.message||'Could not archive customer.');return}
  await loadCustomers();
}

async function restoreCustomer(id){
  const c=allCustomersCache.find(x=>x.id===id);if(!c)return;
  const{error}=await supabaseClient.from('customers').update({status:'active'}).eq('id',id).eq('reseller_id',currentUser.id);
  if(error){alert(error.message||'Could not restore customer.');return}
  await loadCustomers();
}
