create table if not exists public.reseller_cash_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  topup_id uuid references public.topup_requests(id) on delete restrict,
  amount numeric(12,2) not null check (amount <> 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  entry_type text not null check (entry_type in ('cash_credit','cash_payment')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.reseller_cash_ledger enable row level security;
revoke all on table public.reseller_cash_ledger from anon, authenticated;
grant all on table public.reseller_cash_ledger to service_role;

create index if not exists reseller_cash_ledger_user_created_idx
  on public.reseller_cash_ledger(user_id, created_at desc);

create unique index if not exists reseller_cash_ledger_topup_credit_uq
  on public.reseller_cash_ledger(topup_id)
  where topup_id is not null and entry_type='cash_credit';

create or replace function public.get_my_cash_due()
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_due numeric(12,2);
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if not exists (
    select 1 from public.profiles
    where id=v_user and role='reseller' and status='active'
  ) then
    raise exception 'Active reseller account required';
  end if;

  select coalesce(sum(amount),0)::numeric(12,2)
  into v_due
  from public.reseller_cash_ledger
  where user_id=v_user;

  return greatest(v_due,0);
end;
$$;

revoke all on function public.get_my_cash_due() from public, anon;
grant execute on function public.get_my_cash_due() to authenticated;

create or replace function public.admin_record_cash_payment(
  p_user_id uuid,
  p_amount numeric,
  p_note text default null
)
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
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_user_id is null then raise exception 'Reseller is required'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than 0';
  end if;
  if p_amount > 100000 then raise exception 'Payment amount is too large'; end if;

  if not exists (
    select 1 from public.profiles
    where id=p_user_id and role='reseller'
  ) then
    raise exception 'Reseller not found';
  end if;

  insert into public.wallets(user_id,balance)
  values(p_user_id,0)
  on conflict(user_id) do nothing;

  select balance into v_wallet_balance
  from public.wallets
  where user_id=p_user_id
  for update;

  select coalesce(sum(amount),0)::numeric(12,2)
  into v_due
  from public.reseller_cash_ledger
  where user_id=p_user_id;

  v_due := greatest(v_due,0);

  if p_amount > v_due then
    raise exception 'Payment exceeds current amount due';
  end if;

  v_new_due := round(v_due - p_amount,2);

  insert into public.reseller_cash_ledger(
    user_id,amount,balance_after,entry_type,note,created_by
  )
  values(
    p_user_id,
    -round(p_amount,2),
    v_new_due,
    'cash_payment',
    nullif(trim(coalesce(p_note,'')),''),
    v_admin
  );

  insert into public.notifications(user_id,type,title,message,link)
  values(
    p_user_id,
    'wallet',
    'Cash payment recorded',
    'Subly recorded a cash payment of '||to_char(round(p_amount,2),'FM999999990.00')||
      ' USD. Remaining amount due: '||to_char(v_new_due,'FM999999990.00')||' USD.',
    'wallet.html'
  );

  return jsonb_build_object(
    'success',true,
    'paid',round(p_amount,2),
    'new_due',v_new_due,
    'wallet_balance',v_wallet_balance
  );
end;
$$;

revoke all on function public.admin_record_cash_payment(uuid,numeric,text) from public, anon;
grant execute on function public.admin_record_cash_payment(uuid,numeric,text) to authenticated;

create or replace function public.admin_wallet_rows_v2(
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(
  user_id uuid,
  username text,
  business_name text,
  reseller_code text,
  tier text,
  status text,
  balance numeric,
  cash_due numeric,
  wallet_updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=least(greatest(coalesce(p_page_size,25),1),100);
  v_search text:=nullif(trim(coalesce(p_search,'')),'');
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    p.id,
    p.username,
    p.business_name,
    p.reseller_code,
    p.tier,
    p.status,
    coalesce(w.balance,0),
    coalesce(d.cash_due,0),
    w.updated_at,
    count(*) over()
  from public.profiles p
  left join public.wallets w on w.user_id=p.id
  left join lateral (
    select coalesce(sum(l.amount),0)::numeric(12,2) cash_due
    from public.reseller_cash_ledger l
    where l.user_id=p.id
  ) d on true
  where p.role='reseller'
    and (
      v_search is null
      or concat_ws(' ',p.username,p.business_name,p.reseller_code,p.tier,p.status) ilike '%'||v_search||'%'
    )
  order by coalesce(p.business_name,p.username),p.created_at desc
  offset (v_page-1)*v_size limit v_size;
end;
$$;

revoke all on function public.admin_wallet_rows_v2(text,integer,integer) from public, anon;
grant execute on function public.admin_wallet_rows_v2(text,integer,integer) to authenticated;

create or replace function public.admin_wallet_summary_v2()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when public.is_admin() then jsonb_build_object(
    'reseller_count',(select count(*) from public.profiles where role='reseller'),
    'total_balance',(select coalesce(sum(balance),0) from public.wallets),
    'total_cash_due',(select greatest(coalesce(sum(amount),0),0) from public.reseller_cash_ledger)
  ) else null end;
$$;

revoke all on function public.admin_wallet_summary_v2() from public, anon;
grant execute on function public.admin_wallet_summary_v2() to authenticated;

create or replace function public.approve_topup(p_topup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin_id uuid;
  v_topup record;
  v_new_balance numeric;
  v_due numeric(12,2):=0;
  v_new_due numeric(12,2):=0;
begin
  v_admin_id := auth.uid();

  if v_admin_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id=v_admin_id and role='admin' and status='active'
  ) then
    raise exception 'Admin access required';
  end if;

  select *
  into v_topup
  from public.topup_requests
  where id=p_topup_id
  for update;

  if not found then raise exception 'Top-up request not found'; end if;
  if v_topup.status <> 'pending' then
    raise exception 'Top-up request has already been reviewed';
  end if;
  if v_topup.amount <= 0 then raise exception 'Invalid top-up amount'; end if;

  insert into public.wallets(user_id,balance)
  values(v_topup.user_id,0)
  on conflict(user_id) do nothing;

  update public.wallets
  set balance=balance+v_topup.amount,updated_at=now()
  where user_id=v_topup.user_id
  returning balance into v_new_balance;

  if v_topup.payment_method='cash' then
    select coalesce(sum(amount),0)::numeric(12,2)
    into v_due
    from public.reseller_cash_ledger
    where user_id=v_topup.user_id;

    v_due := greatest(v_due,0);
    v_new_due := round(v_due + v_topup.amount,2);

    insert into public.reseller_cash_ledger(
      user_id,topup_id,amount,balance_after,entry_type,note,created_by
    )
    values(
      v_topup.user_id,
      v_topup.id,
      round(v_topup.amount,2),
      v_new_due,
      'cash_credit',
      'Cash top-up approved — amount payable to Subly',
      v_admin_id
    );
  end if;

  update public.topup_requests
  set status='approved',reviewed_by=v_admin_id,reviewed_at=now()
  where id=p_topup_id;

  insert into public.wallet_transactions(
    user_id,amount,balance_after,type,description,topup_id,created_by
  )
  values(
    v_topup.user_id,
    v_topup.amount,
    v_new_balance,
    'topup',
    case
      when v_topup.payment_method='cash'
        then 'Cash credit approved • payable to Subly'
      else 'Top-up approved via '||coalesce(v_topup.payment_method,'unknown')
    end,
    v_topup.id,
    v_admin_id
  );

  if v_topup.payment_method='cash' then
    insert into public.notifications(user_id,type,title,message,link)
    values(
      v_topup.user_id,
      'wallet',
      'Cash credit approved',
      to_char(v_topup.amount,'FM999999990.00')||
        ' USD was added to your wallet. Amount due to Subly: '||
        to_char(v_new_due,'FM999999990.00')||' USD.',
      'wallet.html'
    );
  end if;

  return jsonb_build_object(
    'success',true,
    'topup_id',v_topup.id,
    'amount',v_topup.amount,
    'new_balance',v_new_balance,
    'cash_due',case when v_topup.payment_method='cash' then v_new_due else null end
  );
end;
$$;

revoke all on function public.approve_topup(uuid) from public, anon;
grant execute on function public.approve_topup(uuid) to authenticated;
