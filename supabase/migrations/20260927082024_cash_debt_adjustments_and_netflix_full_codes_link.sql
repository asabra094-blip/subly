-- Cash debt controls + Netflix Full Account codes-link persistence.
alter table public.reseller_cash_ledger
  drop constraint if exists reseller_cash_ledger_entry_type_check;

alter table public.reseller_cash_ledger
  add constraint reseller_cash_ledger_entry_type_check
  check (entry_type in ('cash_credit','cash_payment','manual_debt_adjustment'));

create or replace function public.admin_adjust_cash_due(p_user_id uuid,p_amount numeric,p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid := auth.uid();
  v_due numeric(12,2);
  v_new_due numeric(12,2);
  v_wallet_balance numeric(12,2);
  v_amount numeric(12,2);
begin
  if v_admin is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_user_id is null then raise exception 'Reseller is required'; end if;
  v_amount:=round(coalesce(p_amount,0),2);
  if v_amount=0 then raise exception 'Adjustment amount cannot be 0'; end if;
  if abs(v_amount)>100000 then raise exception 'Adjustment amount is too large'; end if;
  if nullif(trim(coalesce(p_note,'')),'') is null or length(trim(p_note))<3 then raise exception 'A clear reason is required'; end if;
  if length(trim(p_note))>500 then raise exception 'Reason is too long'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and role='reseller') then raise exception 'Reseller not found'; end if;

  insert into public.wallets(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
  select balance into v_wallet_balance from public.wallets where user_id=p_user_id for update;

  select greatest(coalesce(sum(amount),0),0)::numeric(12,2)
    into v_due from public.reseller_cash_ledger where user_id=p_user_id;
  v_new_due:=round(v_due+v_amount,2);
  if v_new_due<0 then raise exception 'Adjustment would make amount due negative'; end if;

  insert into public.reseller_cash_ledger(user_id,amount,balance_after,entry_type,note,created_by)
  values(p_user_id,v_amount,v_new_due,'manual_debt_adjustment',trim(p_note),v_admin);

  insert into public.notifications(user_id,type,title,message,link)
  values(p_user_id,'wallet','Amount due updated',
    'Subly updated your amount due by '||case when v_amount>0 then '+' else '' end||
    to_char(v_amount,'FM999999990.00')||' USD. Current amount due: '||
    to_char(v_new_due,'FM999999990.00')||' USD.','wallet.html');

  return jsonb_build_object('success',true,'adjustment',v_amount,'previous_due',v_due,'new_due',v_new_due,'wallet_balance',v_wallet_balance);
end;
$$;

revoke all on function public.admin_adjust_cash_due(uuid,numeric,text) from public, anon;
grant execute on function public.admin_adjust_cash_due(uuid,numeric,text) to authenticated;

create or replace function public.admin_cash_due_rows(p_user_ids uuid[])
returns table(user_id uuid,cash_due numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select p.id,greatest(coalesce(sum(l.amount),0),0)::numeric
  from public.profiles p
  left join public.reseller_cash_ledger l on l.user_id=p.id
  where p.role='reseller' and p.id=any(coalesce(p_user_ids,'{}'::uuid[]))
  group by p.id;
end;
$$;

revoke all on function public.admin_cash_due_rows(uuid[]) from public, anon;
grant execute on function public.admin_cash_due_rows(uuid[]) to authenticated;

create or replace function public.admin_deliver_order(
  p_order_id uuid,p_account text default null,p_password text default null,p_profile text default null,
  p_pin text default null,p_url text default null,p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_duration text; v_app text; v_type text; v_activation timestamptz;
  v_account text:=nullif(trim(coalesce(p_account,'')),''); v_password text:=nullif(trim(coalesce(p_password,'')),'');
  v_profile text:=nullif(trim(coalesce(p_profile,'')),''); v_pin text:=nullif(trim(coalesce(p_pin,'')),'');
  v_url text:=nullif(trim(coalesce(p_url,'')),''); v_notes text:=nullif(trim(coalesce(p_notes,'')),'');
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select lower(regexp_replace(coalesce(p.app_name,''),'[^a-zA-Z0-9]','','g')),lower(coalesce(p.account_type,'')),p.duration
    into v_app,v_type,v_duration
  from public.orders o join public.products p on p.id=o.product_id
  where o.id=p_order_id and o.status='processing' for update of o;
  if v_duration is null then raise exception 'Processing order not found'; end if;

  if v_app='shahid' and (
    exists(select 1 from public.supplier_purchase_guards g where g.order_id=p_order_id and g.provider='tvleb_shahid')
    or exists(select 1 from public.supplier_order_links l where l.order_id=p_order_id and l.provider='tvleb_shahid')
    or exists(select 1 from public.orders o join public.supplier_product_mappings m on m.product_id=o.product_id and m.provider='tvleb_shahid' and m.enabled=true
      join public.supplier_integrations i on i.provider='tvleb_shahid' and i.enabled=true and i.live_purchase_enabled=true where o.id=p_order_id)
  ) then raise exception 'Automated Shahid orders must be managed from Orders → Shahid'; end if;

  if v_app='netflix' and v_type like '%full%' then
    if v_account is null or v_password is null or v_url is null then raise exception 'Netflix Full Account requires email/account, password and codes link'; end if;
    v_profile:=null;v_pin:=null;
  elsif v_app='netflix' then
    if v_profile is null or v_pin is null or v_url is null then raise exception 'Netflix 1 User requires profile, PIN and Netflix link'; end if;
    v_account:=null;v_password:=null;
  elsif v_app='anghami' then
    if v_profile is null then raise exception 'Anghami requires the exact username/profile'; end if;
    v_account:=null;v_password:=null;v_pin:=null;v_url:=null;
  elsif v_app in ('osn','osnplus') then
    if v_account is null or v_profile is null or v_url is null then raise exception 'OSN requires email/account, profile and OTP/activation link'; end if;
    v_password:=null;v_pin:=null;
  elsif v_app in ('amazonprime','amazonprimevideo','primevideo','watchit') then
    if v_account is null or v_password is null then raise exception 'This service requires email/account and password'; end if;
    v_profile:=null;v_pin:=null;v_url:=null;
  elsif v_app='shahid' then
    if v_account is null or v_password is null then raise exception 'Shahid requires email/account and password'; end if;
    v_pin:=null;v_url:=null;
  else
    if v_account is null and v_password is null and v_profile is null and v_pin is null and v_url is null and v_notes is null then raise exception 'Delivery information is required'; end if;
  end if;

  v_activation:=now();
  update public.orders set
    delivery_account=v_account,delivery_password=v_password,delivery_profile=v_profile,delivery_pin=v_pin,
    delivery_url=v_url,delivery_notes=v_notes,
    delivery_text=concat_ws(E'\n',
      case when v_account is not null then 'Account: '||v_account end,
      case when v_password is not null then 'Password: '||v_password end,
      case when v_profile is not null then 'Profile: '||v_profile end,
      case when v_pin is not null then 'PIN: '||v_pin end,
      case when v_url is not null then 'Link: '||v_url end,
      case when v_notes is not null then 'Notes: '||v_notes end),
    status='delivered',delivered_at=v_activation,activated_at=v_activation,
    expires_at=v_activation+public.duration_to_interval(v_duration),updated_at=now()
  where id=p_order_id;

  return jsonb_build_object('success',true,'activated_at',v_activation);
end;
$$;

create or replace function public.admin_update_subscription(
  p_order_id uuid,p_account text,p_password text,p_profile text,p_pin text,p_url text,p_notes text,
  p_activated_at timestamptz,p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype; v_app text; v_type text;
  v_account text:=nullif(trim(coalesce(p_account,'')),''); v_password text:=nullif(trim(coalesce(p_password,'')),'');
  v_profile text:=nullif(trim(coalesce(p_profile,'')),''); v_pin text:=nullif(trim(coalesce(p_pin,'')),'');
  v_url text:=nullif(trim(coalesce(p_url,'')),''); v_notes text:=nullif(trim(coalesce(p_notes,'')),'');
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='active') then raise exception 'Admin access required'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status<>'delivered' then raise exception 'Only delivered subscriptions can be edited'; end if;
  select lower(regexp_replace(coalesce(app_name,''),'[^a-zA-Z0-9]','','g')),lower(coalesce(account_type,''))
    into v_app,v_type from public.products where id=v_order.product_id;
  if p_activated_at is not null and p_expires_at is not null and p_expires_at<=p_activated_at then raise exception 'Expiry must be after activation'; end if;

  if v_app='netflix' and v_type like '%full%' then
    if v_account is null or v_password is null or v_url is null then raise exception 'Netflix Full Account requires email/account, password and codes link'; end if;
    v_profile:=null;v_pin:=null;
  elsif v_app='netflix' then
    if v_profile is null or v_pin is null or v_url is null then raise exception 'Netflix 1 User requires profile, PIN and Netflix link'; end if;
    v_account:=null;v_password:=null;
  elsif v_app='anghami' then
    if v_profile is null then raise exception 'Anghami requires the exact username/profile'; end if;
    v_account:=null;v_password:=null;v_pin:=null;v_url:=null;
  elsif v_app in ('osn','osnplus') then
    if v_account is null or v_profile is null or v_url is null then raise exception 'OSN requires email/account, profile and OTP/activation link'; end if;
    v_password:=null;v_pin:=null;
  elsif v_app in ('amazonprime','amazonprimevideo','primevideo','watchit') then
    if v_account is null or v_password is null then raise exception 'This service requires email/account and password'; end if;
    v_profile:=null;v_pin:=null;v_url:=null;
  elsif v_app='shahid' then
    if v_account is null or v_password is null then raise exception 'Shahid requires email/account and password'; end if;
    v_pin:=null;v_url:=null;
  end if;

  update public.orders set
    delivery_account=v_account,delivery_password=v_password,delivery_profile=v_profile,delivery_pin=v_pin,
    delivery_url=v_url,delivery_notes=v_notes,
    delivery_text=concat_ws(E'\n',
      case when v_account is not null then 'Account: '||v_account end,
      case when v_password is not null then 'Password: '||v_password end,
      case when v_profile is not null then 'Profile: '||v_profile end,
      case when v_pin is not null then 'PIN: '||v_pin end,
      case when v_url is not null then 'Link: '||v_url end,
      case when v_notes is not null then 'Notes: '||v_notes end),
    activated_at=coalesce(p_activated_at,activated_at),
    expires_at=coalesce(p_expires_at,expires_at),
    updated_at=now()
  where id=p_order_id;

  insert into public.notifications(user_id,type,title,message,link)
  values(v_order.user_id,'subscription_updated','Subscription updated',
    'Subly updated the account details for subscription '||
    coalesce(v_order.subscription_code,'SUB-'||upper(substr(replace(v_order.id::text,'-',''),1,8)))||'.',
    'subscriptions.html');
  return jsonb_build_object('success',true);
end;
$$;

create or replace function public.admin_reseller_delete_check(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_wallet numeric:=0; v_orders bigint:=0; v_customers bigint:=0; v_renewals bigint:=0;
  v_wallet_tx bigint:=0; v_topups bigint:=0; v_issues bigint:=0; v_contacts bigint:=0;
  v_telegram bigint:=0; v_notifications bigint:=0; v_cash_ledger bigint:=0; v_cash_due numeric:=0;
  v_can_delete boolean;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='active') then raise exception 'Admin access required'; end if;
  select * into v_profile from public.profiles where id=p_user_id and role='reseller';
  if not found then raise exception 'Reseller not found'; end if;

  select coalesce(balance,0) into v_wallet from public.wallets where user_id=p_user_id; v_wallet:=coalesce(v_wallet,0);
  select count(*) into v_orders from public.orders where user_id=p_user_id;
  select count(*) into v_customers from public.customers where reseller_id=p_user_id;
  select count(*) into v_renewals from public.renewals where user_id=p_user_id;
  select count(*) into v_wallet_tx from public.wallet_transactions where user_id=p_user_id;
  select count(*) into v_topups from public.topup_requests where user_id=p_user_id;
  select count(*) into v_issues from public.subscription_issues where reseller_id=p_user_id;
  select count(*) into v_contacts from public.contact_tickets where reseller_id=p_user_id;
  select count(*) into v_telegram from public.reseller_telegram_connections where reseller_id=p_user_id;
  select count(*) into v_notifications from public.notifications where user_id=p_user_id;
  select count(*),greatest(coalesce(sum(amount),0),0) into v_cash_ledger,v_cash_due
    from public.reseller_cash_ledger where user_id=p_user_id;

  v_can_delete:=v_profile.status='archived' and v_wallet=0
    and v_orders=0 and v_customers=0 and v_renewals=0 and v_wallet_tx=0 and v_topups=0
    and v_issues=0 and v_contacts=0 and v_telegram=0 and v_notifications=0 and v_cash_ledger=0;

  return jsonb_build_object(
    'can_delete',v_can_delete,'status',v_profile.status,'username',v_profile.username,
    'wallet_balance',v_wallet,'cash_due',v_cash_due,'cash_ledger',v_cash_ledger,
    'orders',v_orders,'customers',v_customers,'renewals',v_renewals,'wallet_transactions',v_wallet_tx,
    'topups',v_topups,'support_issues',v_issues,'contact_tickets',v_contacts,
    'telegram_connections',v_telegram,'notifications',v_notifications);
end;
$$;
