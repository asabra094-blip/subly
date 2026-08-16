import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROVIDER = "tvleb_shahid";
const DEFAULT_BASE_URL = "https://shahid.tvleb.com";
const ALLOWED_TYPES = new Set(["1-month", "3-month", "1-year"]);
const ALLOWED_ORIGINS = new Set([
  "https://sublylb.com",
  "https://www.sublylb.com",
]);
const MAX_LOOKUP_PAGES = 10;
const LOOKUP_PAGE_SIZE = 50;

const corsHeaders = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://www.sublylb.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
};

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "content-type": "application/json; charset=utf-8" },
  });

const cleanDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const supplierPhone = (value: unknown) => {
  const digits = cleanDigits(value);
  if (digits.startsWith("961")) return digits;
  if (digits.startsWith("0") && digits.length >= 8) return `961${digits.slice(1)}`;
  if (digits.length === 8) return `961${digits}`;
  return digits;
};
const normText = (value: unknown) => String(value ?? "").trim().toLowerCase();
const profileFingerprint = (supplierId: unknown, row: any) =>
  [String(supplierId ?? row?.id ?? "").trim(), normText(row?.profileName), normText(row?.email), row?.isFull === true ? "full" : "user"].join("|");
const validFutureIso = (value: unknown) => {
  const d = new Date(String(value ?? ""));
  return Number.isFinite(d.getTime()) && d.getTime() > Date.now() ? d.toISOString() : null;
};

async function requireAdmin(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceRole) throw new Error("Supabase environment is incomplete");

  const authorization = req.headers.get("authorization") || "";
  if (!authorization) return { error: json(req, { ok: false, error: "Unauthorized" }, 401) };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return { error: json(req, { ok: false, error: "Unauthorized" }, 401) };

  const service = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin" || profile.status !== "active") {
    return { error: json(req, { ok: false, error: "Admin access required" }, 403) };
  }
  return { service, user };
}

async function supplierConfig(service: any) {
  const { data, error } = await service
    .from("supplier_integrations")
    .select("provider,display_name,base_url,enabled,live_purchase_enabled")
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) throw error;
  return data || {
    provider: PROVIDER,
    display_name: "TV Leb Shahid",
    base_url: DEFAULT_BASE_URL,
    enabled: false,
    live_purchase_enabled: false,
  };
}

async function supplierApiKey(service: any) {
  const { data, error } = await service.rpc("get_tvleb_shahid_api_key");
  if (error) throw error;
  return String(data || "").trim();
}

async function supplierGet(baseUrl: string, path: string, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "GET",
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal: controller.signal,
    });
    let body: any = null;
    try { body = await response.json(); }
    catch { body = { success: false, message: "Supplier returned a non-JSON response", data: null }; }
    return { status: response.status, body };
  } finally { clearTimeout(timer); }
}

function safeRow(row: any) {
  return {
    id: row?.id ?? null,
    email: row?.email ?? null,
    expiryDate: row?.expiryDate ?? null,
    title: row?.title ?? null,
    type: row?.type ?? null,
    isFull: row?.isFull === true,
    profileName: row?.profileName ?? null,
    customerName: row?.customerName ?? null,
    phoneNumber: row?.phoneNumber ?? null,
    status: row?.status ?? null,
    price: row?.price ?? null,
  };
}

function safeSubscriptionsResponse(body: any) {
  const rows = Array.isArray(body?.data?.subscriptions) ? body.data.subscriptions : [];
  return {
    success: body?.success === true,
    message: body?.message ?? null,
    data: { subscriptions: rows.map(safeRow), pagination: body?.data?.pagination ?? null },
  };
}

async function supplierRowsForPhone(baseUrl: string, apiKey: string, phone: string) {
  const wanted = supplierPhone(phone);
  const rows: any[] = [];
  for (let page = 1; page <= MAX_LOOKUP_PAGES; page++) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(LOOKUP_PAGE_SIZE), searchKey: wanted });
    const result = await supplierGet(baseUrl, `/api/v1/shahid/subscriptions?${params.toString()}`, apiKey);
    if (result.status !== 200 || result.body?.success !== true) {
      return { ok: false, status: result.status, rows: [], error: result.body?.message || "Could not read supplier subscriptions" };
    }
    const pageRows = Array.isArray(result.body?.data?.subscriptions) ? result.body.data.subscriptions : [];
    rows.push(...pageRows.filter((r: any) => supplierPhone(r?.phoneNumber) === wanted));
    if (pageRows.length < LOOKUP_PAGE_SIZE) return { ok: true, status: 200, rows, error: null };
  }
  return { ok: false, status: 409, rows, error: "Supplier lookup exceeded the safe pagination limit" };
}

function validateMockBuy(payload: Record<string, unknown>) {
  const type = String(payload.type || "");
  const phone = cleanDigits(payload.customerPhone);
  const isFull = payload.isFull === true;
  const firstName = String(payload.customerFirstName || "").trim();
  const lastName = String(payload.customerLastName || "").trim();
  if (!ALLOWED_TYPES.has(type)) return { error: "Invalid Shahid type" };
  if (phone.length < 10) return { error: "Reseller phone must contain at least 10 digits" };
  if (!firstName || !lastName) return { error: "Reseller first and last name are required for safe testing" };
  return { value: { type, customerPhone: phone, isFull, customerFirstName: firstName, customerLastName: lastName, countryCode: "lb" } };
}

async function buildPreview(service: any, productId: string, customerId: string) {
  if (!productId || !customerId) return { error: "productId and customerId are required" };
  const [{ data: product, error: productError }, { data: customer, error: customerError }, { data: mapping, error: mappingError }] = await Promise.all([
    service.from("products").select("id,app_name,account_type,duration,active").eq("id", productId).maybeSingle(),
    service.from("customers").select("id,reseller_id,status").eq("id", customerId).maybeSingle(),
    service.from("supplier_product_mappings").select("supplier_type,supplier_is_full,enabled").eq("provider", PROVIDER).eq("product_id", productId).maybeSingle(),
  ]);
  if (productError) throw productError;
  if (customerError) throw customerError;
  if (mappingError) throw mappingError;
  if (!product || !mapping) return { error: "This product is not mapped to TV Leb Shahid" };
  if (!customer) return { error: "Customer not found" };
  if (normText(product.app_name) !== "shahid") return { error: "Only Shahid products are supported" };

  const { data: reseller, error: resellerError } = await service
    .from("profiles").select("id,username,business_name,phone,status").eq("id", customer.reseller_id).maybeSingle();
  if (resellerError) throw resellerError;
  if (!reseller) return { error: "Reseller not found" };
  const resellerName = String(reseller.business_name || reseller.username || "Reseller").trim();
  const firstName = resellerName.split(/\s+/)[0] || "Reseller";
  const lastName = resellerName.slice(firstName.length).trim() || String(reseller.username || "Reseller");
  const payload = {
    type: mapping.supplier_type,
    customerPhone: supplierPhone(reseller.phone),
    isFull: mapping.supplier_is_full === true,
    customerFirstName: firstName,
    customerLastName: lastName,
    countryCode: "lb",
  };
  const validation = validateMockBuy(payload);
  if (validation.error) return { error: validation.error, payload, mappingEnabled: mapping.enabled === true };
  return {
    payload: validation.value,
    product: { id: product.id, appName: product.app_name, accountType: product.account_type, duration: product.duration, active: product.active === true },
    reseller: { id: reseller.id, status: reseller.status, phone: reseller.phone },
    sublyCustomerId: customer.id,
    mappingEnabled: mapping.enabled === true,
  };
}

async function loadRecoveryContext(service: any, orderId: string) {
  const { data: order, error: orderError } = await service
    .from("orders").select("id,subscription_code,user_id,product_id,status,price_paid,created_at").eq("id", orderId).maybeSingle();
  if (orderError) throw orderError;
  if (!order) return { error: "Order not found" };
  const [{ data: reseller, error: resellerError }, { data: mapping, error: mappingError }, { data: guard, error: guardError }] = await Promise.all([
    service.from("profiles").select("id,username,business_name,phone,status").eq("id", order.user_id).maybeSingle(),
    service.from("supplier_product_mappings").select("supplier_type,supplier_is_full,enabled").eq("provider", PROVIDER).eq("product_id", order.product_id).maybeSingle(),
    service.from("supplier_purchase_guards").select("order_id,state,ambiguous_at,prebuy_metadata,attempt_count,last_error").eq("provider", PROVIDER).eq("order_id", order.id).maybeSingle(),
  ]);
  if (resellerError) throw resellerError;
  if (mappingError) throw mappingError;
  if (guardError) throw guardError;
  if (!reseller || !mapping || !guard) return { error: "Shahid automation context is incomplete" };
  return { order, reseller, mapping, guard, phone: supplierPhone(reseller.phone) };
}

function chooseRecoveryProfile(rows: any[], ctx: any, supplierId: string, requestedProfile: string) {
  const phone = ctx.phone;
  const candidates = rows.filter((row: any) => supplierPhone(row?.phoneNumber) === phone);
  if (!candidates.length) return { match: null, reason: "The supplier account does not contain this reseller phone", candidates: [] };
  if (ctx.mapping.supplier_is_full === true) {
    const full = candidates.filter((row: any) => row?.isFull === true);
    if (full.length === 1) return { match: full[0], reason: "full_account_match", candidates };
  }
  const wantedProfile = normText(requestedProfile);
  if (wantedProfile) {
    const exact = candidates.filter((row: any) => normText(row?.profileName) === wantedProfile);
    if (exact.length === 1) return { match: exact[0], reason: "admin_profile_match", candidates };
  }
  const baselineRows = Array.isArray(ctx.guard?.prebuy_metadata?.profileBaseline) ? ctx.guard.prebuy_metadata.profileBaseline : [];
  if (baselineRows.length) {
    const baselineForAccount = new Set(
      baselineRows.filter((row: any) => String(row?.id || "").trim() === supplierId).map((row: any) => profileFingerprint(supplierId, row)),
    );
    const newRows = candidates.filter((row: any) => !baselineForAccount.has(profileFingerprint(supplierId, row)));
    if (newRows.length === 1) return { match: newRows[0], reason: "new_profile_since_baseline", candidates };
  }
  if (candidates.length === 1) return { match: candidates[0], reason: "single_candidate", candidates };
  return { match: null, reason: "Select the exact profile shown in OStories before recovering this order", candidates };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed" }, 405);

    const auth = await requireAdmin(req);
    if ("error" in auth) return auth.error;
    const { service } = auth;
    const config = await supplierConfig(service);
    const apiKey = await supplierApiKey(service);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    if (action === "status") {
      return json(req, { ok: true, provider: PROVIDER, configured: Boolean(apiKey), integrationEnabled: config.enabled === true, livePurchaseEnabled: config.live_purchase_enabled === true, liveBuyRouteAvailable: false, phase: "automation_guarded" });
    }

    if (action === "types") {
      if (!apiKey) return json(req, { ok: false, error: "TV Leb Shahid API key is not configured" }, 503);
      const result = await supplierGet(config.base_url || DEFAULT_BASE_URL, "/api/v1/shahid/types", apiKey);
      return json(req, { ok: result.status >= 200 && result.status < 300, supplierStatus: result.status, supplier: result.body }, result.status);
    }

    if (action === "subscriptions") {
      if (!apiKey) return json(req, { ok: false, error: "TV Leb Shahid API key is not configured" }, 503);
      const page = Math.max(1, Math.floor(Number(body?.page) || 1));
      const pageSize = Math.min(50, Math.max(1, Math.floor(Number(body?.pageSize) || 20)));
      const searchKey = String(body?.searchKey || "").trim().slice(0, 120);
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (searchKey) params.set("searchKey", searchKey);
      const result = await supplierGet(config.base_url || DEFAULT_BASE_URL, `/api/v1/shahid/subscriptions?${params.toString()}`, apiKey);
      return json(req, { ok: result.status >= 200 && result.status < 300, supplierStatus: result.status, supplier: safeSubscriptionsResponse(result.body) }, result.status);
    }

    if (action === "inspect_order") {
      if (!apiKey) return json(req, { ok: false, error: "TV Leb Shahid API key is not configured" }, 503);
      const ctx: any = await loadRecoveryContext(service, String(body?.orderId || ""));
      if (ctx.error) return json(req, { ok: false, error: ctx.error }, 400);
      const lookup = await supplierRowsForPhone(config.base_url || DEFAULT_BASE_URL, apiKey, ctx.phone);
      if (!lookup.ok) return json(req, { ok: false, error: lookup.error, supplierStatus: lookup.status }, lookup.status || 502);
      return json(req, {
        ok: true,
        order: { id: ctx.order.id, subscriptionCode: ctx.order.subscription_code, status: ctx.order.status },
        guard: { state: ctx.guard.state, ambiguousAt: ctx.guard.ambiguous_at, baselineCount: Array.isArray(ctx.guard?.prebuy_metadata?.profileBaseline) ? ctx.guard.prebuy_metadata.profileBaseline.length : 0 },
        reseller: { name: ctx.reseller.business_name || ctx.reseller.username, phone: ctx.phone },
        supplier: lookup.rows.map(safeRow),
      });
    }

    if (action === "recover_unknown") {
      if (!apiKey) return json(req, { ok: false, error: "TV Leb Shahid API key is not configured" }, 503);
      const orderId = String(body?.orderId || "").trim();
      const supplierId = String(body?.supplierSubscriptionId || "").trim();
      const requestedProfile = String(body?.profileName || "").trim();
      if (!orderId || !supplierId) return json(req, { ok: false, error: "orderId and supplierSubscriptionId are required" }, 400);
      const ctx: any = await loadRecoveryContext(service, orderId);
      if (ctx.error) return json(req, { ok: false, error: ctx.error }, 400);
      if (ctx.order.status !== "processing" || ctx.guard.state !== "unknown") return json(req, { ok: false, error: "This order is not waiting for unknown-purchase recovery" }, 409);

      const result = await supplierGet(config.base_url || DEFAULT_BASE_URL, `/api/v1/shahid/subscription/${encodeURIComponent(supplierId)}`, apiKey);
      if (result.status !== 200 || result.body?.success !== true || !Array.isArray(result.body?.data)) {
        return json(req, { ok: false, error: result.body?.message || "Supplier subscription could not be read", supplierStatus: result.status }, result.status || 502);
      }
      const choice = chooseRecoveryProfile(result.body.data, ctx, supplierId, requestedProfile);
      if (!choice.match) {
        return json(req, { ok: false, needsProfileSelection: true, error: choice.reason, candidates: choice.candidates.map(safeRow) }, 409);
      }
      const matched = choice.match;
      const status = normText(matched?.status) || "pending";
      const supplierPrice = Number(matched?.price);
      const expiryAt = validFutureIso(matched?.expiryDate);
      const metadata = {
        recoveryReason: choice.reason,
        expectedProfileName: String(matched?.profileName || "").trim() || null,
        expectedEmail: String(matched?.email || "").trim() || null,
      };
      const { error: linkError } = await service.rpc("service_recover_tvleb_shahid_unknown_link", {
        p_order_id: orderId,
        p_supplier_subscription_id: supplierId,
        p_supplier_status: status,
        p_customer_phone: ctx.phone,
        p_supplier_is_full: ctx.mapping.supplier_is_full === true,
        p_supplier_price: Number.isFinite(supplierPrice) ? supplierPrice : null,
        p_supplier_expiry_at: expiryAt,
        p_supplier_profile_name: String(matched?.profileName || "").trim() || null,
        p_http_status: result.status,
        p_metadata: metadata,
      });
      if (linkError) throw linkError;

      let delivered = false;
      let deliveryError: string | null = null;
      if (["active", "near_expiry"].includes(status)) {
        const account = String(matched?.email || "").trim();
        const password = String(matched?.password || "").trim();
        const profile = String(matched?.profileName || "").trim();
        if (account && password && expiryAt && (ctx.mapping.supplier_is_full === true || profile)) {
          const { error } = await service.rpc("deliver_tvleb_shahid_order", {
            p_order_id: orderId,
            p_supplier_subscription_id: supplierId,
            p_account: account,
            p_password: password,
            p_profile: ctx.mapping.supplier_is_full === true ? null : profile,
            p_expiry_at: expiryAt,
            p_supplier_price: Number.isFinite(supplierPrice) ? supplierPrice : null,
          });
          if (error) deliveryError = error.message;
          else delivered = true;
        }
      }
      return json(req, { ok: true, recovered: true, delivered, pending: !delivered, deliveryError, supplier: safeRow(matched) });
    }

    if (action === "confirm_not_purchased") {
      if (!apiKey) return json(req, { ok: false, error: "TV Leb Shahid API key is not configured" }, 503);
      if (String(body?.confirmation || "").trim().toUpperCase() !== "REFUND") return json(req, { ok: false, error: "Type REFUND to confirm" }, 400);
      const orderId = String(body?.orderId || "").trim();
      const ctx: any = await loadRecoveryContext(service, orderId);
      if (ctx.error) return json(req, { ok: false, error: ctx.error }, 400);
      if (ctx.order.status !== "processing" || ctx.guard.state !== "unknown") return json(req, { ok: false, error: "This order is not waiting for unknown-purchase recovery" }, 409);
      const lookup = await supplierRowsForPhone(config.base_url || DEFAULT_BASE_URL, apiKey, ctx.phone);
      if (!lookup.ok) return json(req, { ok: false, error: "Supplier verification failed. Refund is blocked until OStories can be checked safely." }, 502);

      const baseline = Array.isArray(ctx.guard?.prebuy_metadata?.profileBaseline) ? ctx.guard.prebuy_metadata.profileBaseline : [];
      if (baseline.length) {
        const baselineSet = new Set(baseline.map((row: any) => profileFingerprint(row?.id, row)));
        const newRows = lookup.rows.filter((row: any) => !baselineSet.has(profileFingerprint(row?.id, row)));
        if (newRows.length) {
          return json(req, { ok: false, possiblePurchaseFound: true, error: "A supplier subscription/profile exists that was not in the pre-purchase baseline. Refund blocked.", candidates: newRows.map(safeRow) }, 409);
        }
      } else if (body?.manualVerified !== true) {
        return json(req, { ok: false, needsManualVerification: true, error: "This order has no saved pre-purchase baseline. Check OStories manually, then confirm again." }, 409);
      }

      const { data, error } = await service.rpc("service_refund_tvleb_shahid_unknown_purchase", {
        p_order_id: orderId,
        p_reason: "Admin verified OStories and supplier lookup before refunding an ambiguous Shahid purchase",
      });
      if (error) return json(req, { ok: false, error: error.message }, 409);
      return json(req, { ok: true, refunded: true, result: data });
    }

    if (action === "preview") {
      const preview = await buildPreview(service, String(body?.productId || ""), String(body?.customerId || ""));
      if (preview.error) return json(req, { ok: false, supplierCalled: false, ...preview }, 400);
      return json(req, { ok: true, supplierCalled: false, ...preview });
    }

    if (action === "mock_buy") {
      const check = validateMockBuy(body?.payload || {});
      if (check.error) return json(req, { ok: false, mock: true, supplierCalled: false, error: check.error }, 400);
      const scenario = body?.scenario === "pending" ? "pending" : "active";
      const v = check.value!;
      return json(req, {
        ok: true, mock: true, supplierCalled: false, request: v,
        supplier: { success: true, message: scenario === "pending" ? "Mock pending fulfillment" : "Mock subscription purchased successfully", data: {
          id: "mock-tvleb-shahid-account", email: scenario === "pending" ? "pending@tvleb.vip" : "mock-user@tvleb.vip",
          password: scenario === "pending" ? null : "mock-password", profileName: v.isFull ? null : "Profile 1",
          expiryDate: "2099-01-01T00:00:00.000Z", isFull: v.isFull, status: scenario, price: 0, newBalance: "0.00",
          customer: { firstName: v.customerFirstName, lastName: v.customerLastName, phone: v.customerPhone },
        } },
      });
    }

    if (action === "buy") {
      return json(req, { ok: false, supplierCalled: false, error: "Direct browser Shahid purchases are disabled. Live purchases only run through the guarded server-side worker." }, 423);
    }

    return json(req, { ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[TVLEB_SHAHID]", error);
    return json(req, { ok: false, error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
