import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_ORDERS_URL = "https://www.sublylb.com/admin/orders.html#shahid";
const esc = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const subId = (order: any) =>
  order?.subscription_code ||
  (order?.id ? `SUB-${String(order.id).replaceAll("-", "").slice(0, 8).toUpperCase()}` : "—");
const fullName = (customer: any) =>
  [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim();

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const supplied = req.headers.get("x-subly-webhook-secret") || "";
    if (!supplied) return new Response("Unauthorized", { status: 401 });

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRole) throw new Error("Supabase environment is incomplete");
    const service = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: valid, error: validationError } = await service.rpc("validate_internal_webhook_secret", {
      p_name: "subly_admin_webhook_secret",
      p_secret: supplied,
    });
    if (validationError || valid !== true) return new Response("Unauthorized", { status: 401 });

    const body = await req.json().catch(() => ({}));
    const incidentId = String(body?.incidentId || "").trim();
    if (!incidentId) return new Response(JSON.stringify({ ok: false, error: "incidentId is required" }), { status: 400, headers: { "content-type": "application/json" } });

    const { data: incident, error: incidentError } = await service
      .from("supplier_incidents")
      .select("id,provider,order_id,severity,code,message,metadata,created_at")
      .eq("id", incidentId)
      .maybeSingle();
    if (incidentError) throw incidentError;
    if (!incident || incident.provider !== "tvleb_shahid") {
      return new Response(JSON.stringify({ ok: true, ignored: true }), { headers: { "content-type": "application/json" } });
    }

    const { data: order } = incident.order_id
      ? await service
          .from("orders")
          .select("id,subscription_code,user_id,product_id,customer_id,status")
          .eq("id", incident.order_id)
          .maybeSingle()
      : { data: null } as any;

    const [resellerResult, productResult, customerResult] = await Promise.all([
      order?.user_id
        ? service.from("profiles").select("username,business_name,reseller_code").eq("id", order.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      order?.product_id
        ? service.from("products").select("app_name,account_type,duration").eq("id", order.product_id).maybeSingle()
        : Promise.resolve({ data: null }),
      order?.customer_id
        ? service.from("customers").select("first_name,last_name,phone").eq("id", order.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const reseller: any = resellerResult.data;
    const product: any = productResult.data;
    const customer: any = customerResult.data;
    const severityIcon = incident.severity === "critical" ? "🚨" : incident.severity === "warning" ? "⚠️" : "ℹ️";
    const autoRetry = incident.metadata?.automaticRetry;

    const text = `${severityIcon} <b>Shahid Automation Alert</b>\n\n` +
      `<b>Severity:</b> ${esc(String(incident.severity || "warning").toUpperCase())}\n` +
      `<b>Subscription ID:</b> <code>${esc(subId(order))}</code>\n` +
      `<b>Reseller:</b> ${esc(reseller?.business_name || reseller?.username || "Unknown reseller")}\n` +
      `<b>Customer:</b> ${esc(fullName(customer) || "Unknown customer")}${customer?.phone ? ` • ${esc(customer.phone)}` : ""}\n` +
      `<b>Product:</b> ${esc(product?.app_name || "Shahid")} • ${esc(product?.account_type || "—")} • ${esc(product?.duration || "—")}\n` +
      `<b>Code:</b> <code>${esc(incident.code)}</code>\n` +
      `<b>Details:</b> ${esc(incident.message)}` +
      (autoRetry === false ? `\n\n<b>Safety:</b> No automatic retry was attempted. The reseller Shahid queue is protected until this is resolved.` : "");

    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("Bottoken") || Deno.env.get("BOTTOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("Idtelegram") || Deno.env.get("IDTELEGRAM");
    if (!token || !chatId) throw new Error("Telegram secrets are missing");

    const telegram = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "Open Shahid Control Center", url: ADMIN_ORDERS_URL }]],
        },
      }),
    });
    if (!telegram.ok) throw new Error(`Telegram ${telegram.status}: ${await telegram.text()}`);

    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("[SHAHID_ADMIN_ALERT]", error instanceof Error ? error.message : "Unexpected error");
    return new Response(JSON.stringify({ ok: false, error: "Shahid alert failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
