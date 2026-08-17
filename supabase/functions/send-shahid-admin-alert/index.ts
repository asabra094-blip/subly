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
    const event = body?.event === "resolved" ? "resolved" : "opened";
    if (!incidentId) {
      return new Response(JSON.stringify({ ok: false, error: "incidentId is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { data: incident, error: incidentError } = await service
      .from("supplier_incidents")
      .select("id,provider,order_id,severity,code,message,metadata,resolved,created_at,resolved_at")
      .eq("id", incidentId)
      .maybeSingle();
    if (incidentError) throw incidentError;
    if (!incident || incident.provider !== "tvleb_shahid") {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (event === "opened" && incident.resolved === true) {
      return new Response(JSON.stringify({ ok: true, ignored: true, reason: "already_resolved" }), {
        headers: { "content-type": "application/json" },
      });
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
    const autoRetry = incident.metadata?.automaticRetry;
    const severity = String(incident.severity || "warning").toLowerCase();

    let headline = "⚠️ <b>HEADS UP — Shahid Automation</b>";
    let action = "Keep an eye on this order in the Shahid Control Center.";
    if (event === "resolved") {
      headline = "✅ <b>RESOLVED — Shahid Automation</b>";
      action = "No action is needed unless the order still looks wrong in the admin panel.";
    } else if (severity === "critical") {
      headline = "🚨 <b>CRITICAL — Shahid Needs Attention</b>";
      action = autoRetry === false
        ? "Do NOT retry the supplier purchase manually. Open Shahid → Needs Attention and verify the supplier state first."
        : "Open Shahid → Needs Attention and review this order as soon as possible.";
    }

    const resellerLabel = reseller?.business_name || reseller?.username || "Unknown reseller";
    const resellerCode = reseller?.reseller_code ? ` • ${esc(reseller.reseller_code)}` : "";
    const statusLine = order?.status ? `\n<b>Order status:</b> ${esc(String(order.status).toUpperCase())}` : "";
    const resolvedLine = event === "resolved" && incident.resolved_at
      ? `\n<b>Resolved:</b> ${esc(new Date(incident.resolved_at).toLocaleString("en-GB", { timeZone: "Asia/Beirut" }))}`
      : "";

    const text = `${headline}\n\n` +
      `<b>Subscription:</b> <code>${esc(subId(order))}</code>${statusLine}\n` +
      `<b>Reseller:</b> ${esc(resellerLabel)}${resellerCode}\n` +
      `<b>Customer:</b> ${esc(fullName(customer) || "Unknown customer")}${customer?.phone ? ` • ${esc(customer.phone)}` : ""}\n` +
      `<b>Product:</b> ${esc(product?.app_name || "Shahid")} • ${esc(product?.account_type || "—")} • ${esc(product?.duration || "—")}\n` +
      `<b>Code:</b> <code>${esc(incident.code)}</code>\n` +
      `<b>Details:</b> ${esc(incident.message)}${resolvedLine}\n\n` +
      `<b>${event === "resolved" ? "Status" : "Action"}:</b> ${esc(action)}` +
      (event !== "resolved" && autoRetry === false
        ? `\n\n🛡 <b>Safety lock:</b> Automatic retry is OFF for this incident. The reseller Shahid queue remains protected until the state is safely resolved.`
        : "");

    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("Bottoken") || Deno.env.get("BOTTOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("Idtelegram") || Deno.env.get("IDTELEGRAM");
    if (!token || !chatId) throw new Error("Telegram secrets are missing");

    const buttonText = event === "resolved" ? "Review Resolved Order" : "Open Shahid Control Center";
    const telegram = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: buttonText, url: ADMIN_ORDERS_URL }]],
        },
      }),
    });
    if (!telegram.ok) throw new Error(`Telegram ${telegram.status}: ${await telegram.text()}`);

    return new Response(JSON.stringify({ ok: true, event }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("[SHAHID_ADMIN_ALERT]", error instanceof Error ? error.message : "Unexpected error");
    return new Response(JSON.stringify({ ok: false, error: "Shahid alert failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
