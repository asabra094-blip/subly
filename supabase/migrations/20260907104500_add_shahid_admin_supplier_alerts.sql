-- Ensure Shahid admin alerts are emitted even when a safe pre-purchase
-- failure is immediately auto-resolved after the reseller is refunded.
-- Such terminal incidents are sent as a "notice" event so Telegram can
-- distinguish them from unresolved incidents and later resolution events.

create or replace function public.emit_tvleb_shahid_incident_alert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_secret text;
  v_recent_duplicate boolean := false;
  v_event text;
begin
  if new.provider <> 'tvleb_shahid' then return new; end if;
  if new.severity not in ('warning','critical') then return new; end if;

  select exists(
    select 1
    from public.supplier_incidents i
    where i.id <> new.id
      and i.provider = new.provider
      and i.order_id is not distinct from new.order_id
      and i.code = new.code
      and i.severity = new.severity
      and i.created_at >= now() - interval '10 minutes'
  ) into v_recent_duplicate;

  if v_recent_duplicate then return new; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'subly_admin_webhook_secret';
  if v_secret is null then return new; end if;

  v_event := case when coalesce(new.resolved,false) then 'notice' else 'opened' end;

  perform net.http_post(
    url := 'https://ymcvuwovcrqbhuhrjerd.supabase.co/functions/v1/send-shahid-admin-alert',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-subly-webhook-secret',v_secret
    ),
    body := jsonb_build_object('incidentId',new.id,'event',v_event)
  );
  return new;
end;
$function$;
