create or replace function public.admin_reseller_rows(
  p_search text default null,
  p_status_filter text default 'current',
  p_sort text default 'debt_desc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(
  id uuid,
  username text,
  business_name text,
  reseller_code text,
  tier text,
  status text,
  created_at timestamptz,
  wallet_balance numeric,
  cash_due numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(trim(coalesce(p_search,'')),'');
  v_status text := lower(trim(coalesce(p_status_filter,'current')));
  v_sort text := lower(trim(coalesce(p_sort,'debt_desc')));
  v_page integer := greatest(coalesce(p_page,1),1);
  v_size integer := least(greatest(coalesce(p_page_size,25),1),100);
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if v_status not in ('current','archived','all') then
    raise exception 'Invalid reseller status filter';
  end if;

  if v_sort not in ('debt_desc','debt_asc','newest','name') then
    raise exception 'Invalid reseller sort';
  end if;

  return query
  with rows as (
    select
      p.id,
      p.username,
      p.business_name,
      p.reseller_code,
      p.tier,
      p.status,
      p.created_at,
      coalesce(w.balance,0)::numeric as wallet_balance,
      greatest(coalesce(d.cash_due,0),0)::numeric as cash_due
    from public.profiles p
    left join public.wallets w on w.user_id=p.id
    left join lateral (
      select coalesce(sum(l.amount),0)::numeric as cash_due
      from public.reseller_cash_ledger l
      where l.user_id=p.id
    ) d on true
    where p.role='reseller'
      and (
        v_status='all'
        or (v_status='archived' and p.status='archived')
        or (v_status='current' and p.status<>'archived')
      )
      and (
        v_search is null
        or concat_ws(' ',p.username,p.business_name,p.reseller_code) ilike '%'||v_search||'%'
      )
  ),
  numbered as (
    select r.*,count(*) over() as total_count
    from rows r
  )
  select
    n.id,n.username,n.business_name,n.reseller_code,n.tier,n.status,n.created_at,
    n.wallet_balance,n.cash_due,n.total_count
  from numbered n
  order by
    case when v_sort='debt_desc' then n.cash_due end desc nulls last,
    case when v_sort='debt_asc' then n.cash_due end asc nulls last,
    case when v_sort='newest' then n.created_at end desc nulls last,
    case when v_sort='name' then lower(coalesce(n.business_name,n.username,'')) end asc nulls last,
    n.created_at desc
  offset (v_page-1)*v_size
  limit v_size;
end;
$$;

revoke all on function public.admin_reseller_rows(text,text,text,integer,integer) from public, anon;
grant execute on function public.admin_reseller_rows(text,text,text,integer,integer) to authenticated;
