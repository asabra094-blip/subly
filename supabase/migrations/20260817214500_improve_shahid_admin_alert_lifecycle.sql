create or replace function public.emit_tvleb_shahid_incident_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
  v_recent_duplicate boolean := false;
begin
  if new.provider <> 'tvleb_shahid' then return new; end if;
  if new.severity not in ('warning','critical') then return new; end if;
  if coalesce(new.resolved,false) then return new; end if;

  select exists(
    select 1
    from public.supplier_incidents i
    where i.id <> new.id
      and i.provider = new.provider
      and i.order_id is not distinct from new.order_id
      and i.code = new.code
      and i.severity = new.severity
      and coalesce(i.resolved,false) = false
      and i.created_at >= now() - interval '10 minutes'
  ) into v_recent_duplicate;

  if v_recent_duplicate then return new; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'subly_admin_webhook_secret';
  if v_secret is null then return new; end if;

  perform net.http_post(
    url := 'https://ymcvuwovcrqbhuhrjerd.supabase.co/functions/v1/send-shahid-admin-alert',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-subly-webhook-secret',v_secret
    ),
    body := jsonb_build_object('incidentId',new.id,'event','opened')
  );
  return new;
end;
$function$;

create or replace function public.emit_tvleb_shahid_incident_resolution_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  if new.provider <> 'tvleb_shahid' then return new; end if;
  if coalesce(old.resolved,false) = true or coalesce(new.resolved,false) = false then return new; end if;
  if new.severity not in ('warning','critical') then return new; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'subly_admin_webhook_secret';
  if v_secret is null then return new; end if;

  perform net.http_post(
    url := 'https://ymcvuwovcrqbhuhrjerd.supabase.co/functions/v1/send-shahid-admin-alert',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-subly-webhook-secret',v_secret
    ),
    body := jsonb_build_object('incidentId',new.id,'event','resolved')
  );
  return new;
end;
$function$;

drop trigger if exists trg_tvleb_shahid_incident_resolution_alert on public.supplier_incidents;
create trigger trg_tvleb_shahid_incident_resolution_alert
after update of resolved on public.supplier_incidents
for each row
when (old.resolved is distinct from new.resolved)
execute function public.emit_tvleb_shahid_incident_resolution_alert();

revoke execute on function public.emit_tvleb_shahid_incident_alert() from public, anon, authenticated;
revoke execute on function public.emit_tvleb_shahid_incident_resolution_alert() from public, anon, authenticated;
