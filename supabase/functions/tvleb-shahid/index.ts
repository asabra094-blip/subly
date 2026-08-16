import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROVIDER = "tvleb_shahid";
const DEFAULT_BASE_URL = "https://shahid.tvleb.com";
const ALLOWED_TYPES = new Set(["1-month", "3-month", "1-year"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const cleanDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const supplierPhone = (value: unknown) => {
  const digits = cleanDigits(value);
  if (digits.startsWith("961")) return digits;
  if (digits.startsWith("0") && digits.length >= 8) return `961${digits.slice(1)}`;
  if (digits.length === 8) return `961${digits}`;
  return digits;
};

async function requireAdmin(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceRole) throw new Error("Supabase environment is incomplete");

  const authorization = req.headers.get("authorization") || "";
  if (!authorization) return { error: json({ ok: false, error: "Unauthorized" }, 401) };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return { error: json({ ok: false, error: "Unauthorized" }, 401) };

  const service = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin" || profile.status !== "active") {
    return { error: json({ ok: false, error: "Admin access required" }, 403) };
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
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "GET",
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = { success: false, message: "Supplier returned a non-JSON response", data: null };
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function validateMockBuy(payload: Record<string, unknown>) {
  const type = String(payload.type || "");
  const phone = cleanDigits(payload.customerPhone);
  const isFull = payload.isFull === true;
  const firstName = String(payload.customerFirstName || "").trim();
  const lastName = String(payload.customerLastName || "").trim();

  if (!ALLOWED_TYPES.has(type)) return { error: "Invalid Shahid type" };
  if (phone.length < 10) return { error: "Customer phone must contain at least 10 digits" };
  if (!firstName || !lastName) return { error: "Customer first and last name are required for safe testing" };
  return {
    value: {
      type,
      customerPhone: phone,
      isFull,
      customerFirstName: firstName,
      customerLastName: lastName,
      countryCode: String(payload.countryCode || "lb").trim().toLowerCase() || "lb",
    },
  };
}

async function buildPreview(service: any, productId: string, customerId: string) {
  if (!productId || !customerId) return { error: "productId and customerId are required" };

  const [{ data: product, error: productError }, { data: customer, error: customerError }, { data: mapping, error: mappingError }] = await Promise.all([
    service.from("products").select("id,app_name,account_type,duration,active").eq("id", productId).maybeSingle(),
    service.from("customers").select("id,first_name,last_name,phone,status").eq("id", customerId).maybeSingle(),
    service.from("supplier_product_mappings").select("supplier_type,supplier_is_full,enabled").eq("provider", PROVIDER).eq("product_id", productId).maybeSingle(),
  ]);

  if (productError) throw productError;
  if (customerError) throw customerError;
  if (mappingError) throw mappingError;
  if (!product || !mapping) return { error: "This product is not mapped to TV Leb Shahid" };
  if (!customer) return { error: "Customer not found" };
  if (String(product.app_name || "").trim().toLowerCase() !== "shahid") return { error: "Only Shahid products are supported" };

  const phone = supplierPhone(customer.phone);
  const payload = {
    type: mapping.supplier_type,
    customerPhone: phone,
    isFull: mapping.supplier_is_full === true,
    customerFirstName: String(customer.first_name || "").trim(),
    customerLastName: String(customer.last_name || "").trim(),
    countryCode: "lb",
  };
  const validation = validateMockBuy(payload);
  if (validation.error) return { error: validation.error, payload, mappingEnabled: mapping.enabled === true };

  return {
    payload: validation.value,
    product: {
      id: product.id,
      appName: product.app_name,
      accountType: product.account_type,
      duration: product.duration,
      active: product.active === true,
    },
    customer: {
      id: customer.id,
      status: customer.status,
      originalPhone: customer.phone,
    },
    mappingEnabled: mapping.enabled === true,
  };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const auth = await requireAdmin(req);
    if ("error" in auth) return auth.error;
    const { service } = auth;
    const config = await supplierConfig(service);
    const apiKey = await supplierApiKey(service);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    if (action === "status") {
      return json({
        ok: true,
        provider: PROVIDER,
        configured: Boolean(apiKey),
        integrationEnabled: config.enabled === true,
        livePurchaseEnabled: config.live_purchase_enabled === true,
        liveBuyRouteAvailable: false,
        phase: "foundation_read_only",
      });
    }

    if (action === "types") {
      if (!apiKey) return json({ ok: false, error: "TV Leb Shahid API key is not configured" }, 503);
      const result = await supplierGet(config.base_url || DEFAULT_BASE_URL, "/api/v1/shahid/types", apiKey);
      return json({ ok: result.status >= 200 && result.status < 300, supplierStatus: result.status, supplier: result.body }, result.status);
    }

    if (action === "preview") {
      const preview = await buildPreview(service, String(body?.productId || ""), String(body?.customerId || ""));
      if (preview.error) return json({ ok: false, supplierCalled: false, ...preview }, 400);
      return json({ ok: true, supplierCalled: false, ...preview });
    }

    if (action === "mock_buy") {
      const check = validateMockBuy(body?.payload || {});
      if (check.error) return json({ ok: false, mock: true, supplierCalled: false, error: check.error }, 400);
      const scenario = body?.scenario === "pending" ? "pending" : "active";
      const v = check.value!;
      const id = "mock-tvleb-shahid-account";
      return json({
        ok: true,
        mock: true,
        supplierCalled: false,
        request: v,
        supplier: {
          success: true,
          message: scenario === "pending" ? "Mock pending fulfillment" : "Mock subscription purchased successfully",
          data: {
            id,
            email: scenario === "pending" ? "pending@tvleb.vip" : "mock-user@tvleb.vip",
            password: scenario === "pending" ? null : "mock-password",
            profileName: v.isFull ? null : "Profile 1",
            expiryDate: "2099-01-01T00:00:00.000Z",
            isFull: v.isFull,
            status: scenario,
            price: 0,
            newBalance: "0.00",
            customer: {
              firstName: v.customerFirstName,
              lastName: v.customerLastName,
              phone: v.customerPhone,
            },
          },
        },
      });
    }

    if (action === "buy") {
      return json({
        ok: false,
        supplierCalled: false,
        error: "Live Shahid purchases are intentionally disabled during the safe foundation phase",
      }, 423);
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[TVLEB_SHAHID]", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
