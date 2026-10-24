alter table public.orders
  add column if not exists replacement_of_order_id uuid
  references public.orders(id) on delete restrict;

create unique index if not exists orders_replacement_of_order_uq
  on public.orders(replacement_of_order_id)
  where replacement_of_order_id is not null
    and status <> 'refunded';

create or replace function public.replace_expired_subscription(p_order_id uuid)
returns table(order_id uuid, order_number bigint, charged numeric, new_balance numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_tier text;
  v_original record;
  v_replacement_product uuid;
  v_profile_name text;
  v_new record;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select tier into v_tier
  from public.profiles
  where id=v_user and role='reseller' and status='active';
  if v_tier is null then raise exception 'Active reseller account required'; end if;

  select o.id,o.customer_id,o.customer_profile_name,o.delivery_profile,o.expires_at,
         p.id as old_product_id,p.app_name,p.account_type,p.duration
    into v_original
  from public.orders o
  join public.products p on p.id=o.product_id
  where o.id=p_order_id and o.user_id=v_user and o.status='delivered'
  for update of o;

  if not found then raise exception 'Subscription not found'; end if;
  if v_original.expires_at is null or v_original.expires_at>=now() then
    raise exception 'Only expired subscriptions can be replaced';
  end if;
  if v_original.customer_id is null then
    raise exception 'This subscription has no customer to replace for';
  end if;
  if exists(select 1 from public.renewals r where r.order_id=p_order_id and r.status='pending') then
    raise exception 'A renewal request is already pending for this subscription';
  end if;
  if exists(select 1 from public.orders o where o.replacement_of_order_id=p_order_id and o.status<>'refunded') then
    raise exception 'This expired subscription already has an active replacement';
  end if;

  select p.id into v_replacement_product
  from public.products p
  join public.product_apps a
    on lower(btrim(a.app_name))=lower(btrim(p.app_name)) and a.active=true
  join public.product_prices pp
    on pp.product_id=p.id and pp.tier=v_tier
  where p.active=true
    and lower(btrim(p.app_name))=lower(btrim(v_original.app_name))
    and lower(btrim(coalesce(p.account_type,'Standard')))=lower(btrim(coalesce(v_original.account_type,'Standard')))
    and lower(btrim(p.duration))=lower(btrim(v_original.duration))
  order by case when p.id=v_original.old_product_id then 0 else 1 end,p.created_at
  limit 1;

  if v_replacement_product is null then
    raise exception 'The same subscription product is not currently available';
  end if;

  v_profile_name:=coalesce(
    nullif(trim(coalesce(v_original.customer_profile_name,'')),''),
    nullif(trim(coalesce(v_original.delivery_profile,'')),'')
  );

  select * into v_new
  from public.place_customer_order(v_replacement_product,v_original.customer_id,v_profile_name);

  update public.orders
  set replacement_of_order_id=p_order_id
  where id=v_new.order_id;

  return query select v_new.order_id,v_new.order_number,v_new.charged,v_new.new_balance;
exception
  when unique_violation then
    raise exception 'This expired subscription already has an active replacement';
end;
$$;

revoke all on function public.replace_expired_subscription(uuid) from public, anon;
grant execute on function public.replace_expired_subscription(uuid) to authenticated;
