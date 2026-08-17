import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROVIDER = "tvleb_shahid";
const SECRET_NAME = "subly_shahid_worker_secret";
const DEFAULT_BASE_URL = "https://shahid.tvleb.com";
const MAX_PENDING_BATCH = 15;
const BASELINE_PAGE_SIZE = 50;
const BASELINE_MAX_PAGES = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const normalizedPhone = (value: unknown) => {
  const d = digits(value);
  if (d.startsWith("961")) return d;
  if (d.startsWith("0") && d.length >= 8) return `961${d.slice(1)}`;
  if (d.length === 8) return `961${d}`;
  return d;
};
const shortMessage = (value: unknown, fallback = "Supplier request failed") => {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, 500);
};
const normText = (value: unknown) => String(value ?? "").trim().toLowerCase();
const validFutureIso = (value: unknown) => {
  const d = new Date(String(value ?? ""));
  return Number.isFinite(d.getTime()) && d.getTime() > Date.now() ? d.toISOString() : null;
};
const profileFingerprint = (supplierId: unknown, row: any) =>
  [String(supplierId ?? row?.id ?? "").trim(), normText(row?.profileName), normText(row?.email), row?.isFull === true ? "full" : "user"].join("|");

function supplierErrorMessage(body: any, fallback = "Supplier request failed") {
  const parts: string[] = [];
  const top = String(body?.message || "").trim();
  if (top) parts.push(top);
  if (Array.isArray(body?.data)) {
    for (const item of body.data) {
      const path = String(item?.path || "").trim();
      const schemaError = String(item?.schema?.error || "").trim();
      const itemMessage = String(item?.message || "").trim();
      const detail = schemaError || itemMessage;
      if (!detail) continue;
      parts.push(path ? `${path}: ${detail}` : detail);
    }
  }
  return shortMessage([...new Set(parts)].join(" • "), fallback);
}

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) throw new Error("Supabase worker environment is incomplete");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticateInternal(req: Request, service: any) {
  const supplied = req.headers.get("x-subly-shahid-secret") || "";
  if (!supplied) return false;
  const { data, error } = await service.rpc("validate_internal_webhook_secret", { p_name: SECRET_NAME, p_secret: supplied });
  return !error && data === true;
}

async function supplierConfig(service: any) {
  const { data, error } = await service.from("supplier_integrations").select("provider,base_url,enabled,live_purchase_enabled").eq("provider", PROVIDER).maybeSingle();
  if (error) throw error;
  return data || { provider: PROVIDER, base_url: DEFAULT_BASE_URL, enabled: false, live_purchase_enabled: false };
}

async function supplierApiKey(service: any) {
  const { data, error } = await service.rpc("get_tvleb_shahid_api_key");
  if (error) throw error;
  return String(data || "").trim();
}

type SupplierResult = { status: number | null; body: any; networkError: boolean; error: string | null };
async function supplierRequest(baseUrl: string, apiKey: string, method: "GET" | "POST", path: string, body?: Record<string, unknown>, timeoutMs = 12000): Promise<SupplierResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: { "x-api-key": apiKey, accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
        body: method === "POST" ? JSON.stringify(body || {}) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      return { status: null, body: null, networkError: true, error: error instanceof Error ? error.message : "Network request failed" };
    }
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: response.status, body: parsed, networkError: false, error: parsed ? null : "Supplier returned a non-JSON response" };
  } finally { clearTimeout(timer); }
}

async function addIncident(service: any, orderId: string, severity: "info" | "warning" | "critical", code: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await service.from("supplier_incidents").insert({ provider: PROVIDER, order_id: orderId, severity, code, message: shortMessage(message), metadata });
  if (error) console.error("[SHAHID_WORKER] incident insert failed", orderId, code, error.message);
}

async function safeRefund(service: any, orderId: string, reason: string, code: string, httpStatus: number | null = null) {
  const { data, error } = await service.rpc("fail_tvleb_shahid_order_and_refund", { p_order_id: orderId, p_reason: shortMessage(reason), p_code: code, p_http_status: httpStatus });
  if (error) throw error;
  return data;
}

async function markAmbiguous(service: any, orderId: string, reason: string, httpStatus: number | null = null) {
  const { data, error } = await service.rpc("mark_tvleb_shahid_purchase_unknown", { p_order_id: orderId, p_reason: shortMessage(reason), p_http_status: httpStatus });
  if (error) throw error;
  return data;
}

function supplierTypeMonths(type: string) {
  const value = normText(type);
  if (value === "1-month" || /\b1\s*month\b/.test(value)) return 1;
  if (value === "3-month" || /\b3\s*months?\b/.test(value)) return 3;
  if (value === "1-year" || /\b1\s*year\b/.test(value)) return 12;
  return null;
}

type LivePackage = { apiType: string; title: string; price: number; months: number; sourceId: string | null };
function packageFromTypes(body: any, supplierType: string, isFull: boolean): LivePackage | null {
  const months = supplierTypeMonths(supplierType);
  if (!months || body?.success !== true || !Array.isArray(body?.data)) return null;
  const candidates = body.data.filter((item: any) => {
    if (Number(item?.months) !== months) return false;
    const price = Number(isFull ? item?.price?.full : item?.price?.user);
    if (!Number.isFinite(price) || price < 0) return false;
    if (isFull && item?.availableFull === false) return false;
    if (!isFull && item?.availableShared === false) return false;
    return true;
  });
  if (!candidates.length) return null;
  const newSubscriptionCandidates = candidates.filter((item: any) => {
    const label = `${item?.title || ""} ${item?.type || ""}`.toLowerCase();
    return label.includes("shahid") && !label.includes("recharge");
  });
  const chosen = newSubscriptionCandidates[0] || candidates.find((item: any) => !`${item?.title || ""} ${item?.type || ""}`.toLowerCase().includes("recharge")) || candidates[0];
  const apiType = String(chosen?.type || chosen?.title || "").trim();
  const price = Number(isFull ? chosen?.price?.full : chosen?.price?.user);
  if (!apiType || !Number.isFinite(price) || price < 0) return null;
  return { apiType, title: String(chosen?.title || apiType).trim(), price, months, sourceId: String(chosen?.id || chosen?._id || "").trim() || null };
}

function responseStatus(data: any) {
  const raw = String(data?.status || "").trim().toLowerCase();
  if (["pending", "active", "near_expiry", "expired"].includes(raw)) return raw;
  if (String(data?.email || "").toLowerCase().includes("pending")) return "pending";
  return "active";
}

type BaselineRow = { id: string; profileName: string | null; email: string | null; isFull: boolean };
type BaselineResult = { ok: boolean; rows: BaselineRow[]; status: number | null; message: string | null; truncated: boolean };
async function captureProfileBaseline(baseUrl: string, apiKey: string, phone: string): Promise<BaselineResult> {
  const wanted = normalizedPhone(phone);
  const rows: BaselineRow[] = [];
  for (let page = 1; page <= BASELINE_MAX_PAGES; page++) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(BASELINE_PAGE_SIZE), searchKey: wanted });
    const result = await supplierRequest(baseUrl, apiKey, "GET", `/api/v1/shahid/subscriptions?${params.toString()}`);
    if (result.networkError || result.status !== 200 || result.body?.success !== true) {
      return { ok: false, rows: [], status: result.status, message: supplierErrorMessage(result.body, result.error || "Could not capture existing Shahid profiles before purchase"), truncated: false };
    }
    const pageRows = Array.isArray(result.body?.data?.subscriptions) ? result.body.data.subscriptions : [];
    for (const row of pageRows) {
      if (normalizedPhone(row?.phoneNumber) !== wanted) continue;
      rows.push({ id: String(row?.id || "").trim(), profileName: String(row?.profileName || "").trim() || null, email: String(row?.email || "").trim() || null, isFull: row?.isFull === true });
    }
    if (pageRows.length < BASELINE_PAGE_SIZE) return { ok: true, rows, status: result.status, message: null, truncated: false };
  }
  return { ok: false, rows, status: 200, message: "Too many existing Shahid subscriptions were returned to build a safe purchase baseline", truncated: true };
}

function chooseCustomerProfile(rows: any[], phone: string, supplierId: string, metadata: any, isFull: boolean) {
  const wanted = normalizedPhone(phone);
  const candidates = rows.filter((row: any) => normalizedPhone(row?.phoneNumber) === wanted);
  if (!candidates.length) return { match: null, reason: "reseller_phone_not_visible" };
  const expectedProfileName = normText(metadata?.expectedProfileName);
  const expectedEmail = normText(metadata?.expectedEmail);
  if (expectedProfileName || expectedEmail) {
    const exact = candidates.filter((row: any) => {
      if (expectedProfileName && normText(row?.profileName) !== expectedProfileName) return false;
      if (expectedEmail && normText(row?.email) !== expectedEmail) return false;
      return true;
    });
    if (exact.length === 1) return { match: exact[0], reason: "purchase_response_match" };
  }
  const baselineRows = Array.isArray(metadata?.profileBaseline) ? metadata.profileBaseline : [];
  const baselineForAccount = new Set(baselineRows.filter((row: any) => String(row?.id || "").trim() === supplierId).map((row: any) => profileFingerprint(supplierId, row)));
  const newCandidates = candidates.filter((row: any) => !baselineForAccount.has(profileFingerprint(supplierId, row)));
  if (newCandidates.length === 1) return { match: newCandidates[0], reason: "new_profile_since_baseline" };
  if (isFull && candidates.length === 1) return { match: candidates[0], reason: "single_full_account_match" };
  if (candidates.length === 1 && baselineForAccount.size === 0) return { match: candidates[0], reason: "single_first_profile_match" };
  return { match: null, reason: newCandidates.length > 1 ? "multiple_new_profiles_visible" : "profile_not_uniquely_identifiable_yet" };
}

function nextPollSeconds(attempts: number) { if (attempts < 3) return 60; if (attempts < 6) return 120; return 300; }
async function recordPoll(service: any, orderId: string, status: string, httpStatus: number | null, profileName: string | null, expiryAt: string | null, errorText: string | null, nextSeconds: number) {
  const { error } = await service.rpc("record_tvleb_shahid_poll", { p_order_id: orderId, p_status: status, p_http_status: httpStatus, p_profile_name: profileName, p_expiry_at: expiryAt, p_error: errorText, p_next_check_seconds: nextSeconds });
  if (error) throw error;
}

async function deliverProfile(service: any, orderId: string, supplierId: string, isFull: boolean, profile: any, fallbackPrice: number | null) {
  const account = String(profile?.email || "").trim();
  const password = String(profile?.password || "").trim();
  const profileName = String(profile?.profileName || "").trim();
  const expiryAt = validFutureIso(profile?.expiryDate);
  const supplierPrice = Number(profile?.price);
  const price = Number.isFinite(supplierPrice) ? supplierPrice : fallbackPrice;
  if (!account || account.toLowerCase().includes("pending") || !password || !expiryAt || (!isFull && !profileName)) return { delivered: false, reason: "supplier_details_incomplete" };
  const { data, error } = await service.rpc("deliver_tvleb_shahid_order", { p_order_id: orderId, p_supplier_subscription_id: supplierId, p_account: account, p_password: password, p_profile: isFull ? null : profileName, p_expiry_at: expiryAt, p_supplier_price: price });
  if (error) throw error;
  return { delivered: true, data };
}

async function resolveAfterPurchase(service: any, baseUrl: string, apiKey: string, orderId: string, supplierId: string, customerPhone: string, isFull: boolean, supplierPrice: number | null, metadata: any) {
  const result = await supplierRequest(baseUrl, apiKey, "GET", `/api/v1/shahid/subscription/${encodeURIComponent(supplierId)}`);
  if (result.networkError || result.status === null) {
    await recordPoll(service, orderId, "pending", null, null, null, shortMessage(result.error), 60);
    return { delivered: false, pending: true, reason: "status_check_network_error" };
  }
  if (result.status !== 200 || result.body?.success !== true || !Array.isArray(result.body?.data)) {
    await recordPoll(service, orderId, "pending", result.status, null, null, supplierErrorMessage(result.body, result.error || `Status check returned ${result.status}`), result.status === 429 ? 120 : 60);
    return { delivered: false, pending: true, reason: "status_check_not_ready" };
  }
  const choice = chooseCustomerProfile(result.body.data, customerPhone, supplierId, metadata, isFull);
  const matched = choice.match;
  if (!matched) {
    await recordPoll(service, orderId, "pending", result.status, null, null, choice.reason, 60);
    return { delivered: false, pending: true, reason: choice.reason };
  }
  const status = String(matched?.status || "pending").toLowerCase();
  const expiryAt = validFutureIso(matched?.expiryDate);
  if (status === "expired") {
    await recordPoll(service, orderId, "expired", result.status, matched?.profileName || null, expiryAt, "Fresh supplier purchase returned expired", 300);
    await addIncident(service, orderId, "critical", "fresh_purchase_expired", "Supplier returned an expired Shahid subscription after a confirmed purchase.");
    return { delivered: false, pending: false, reason: "supplier_returned_expired" };
  }
  if (status !== "active" && status !== "near_expiry") {
    await recordPoll(service, orderId, "pending", result.status, matched?.profileName || null, expiryAt, null, 60);
    return { delivered: false, pending: true, reason: "supplier_pending" };
  }
  const delivery = await deliverProfile(service, orderId, supplierId, isFull, matched, supplierPrice);
  if (!delivery.delivered) {
    await recordPoll(service, orderId, "pending", result.status, matched?.profileName || null, expiryAt, delivery.reason, 60);
    return { delivered: false, pending: true, reason: delivery.reason };
  }
  return delivery;
}

async function processOrder(service: any, orderId: string) {
  const { data: claim, error: claimError } = await service.rpc("claim_tvleb_shahid_purchase", { p_order_id: orderId });
  if (claimError) throw claimError;
  if (!claim?.claimed) return { ok: true, action: claim?.reason === "queued_behind_reseller_shahid_order" ? "queued" : "noop", reason: claim?.reason || "not_claimed", queuePosition: claim?.queuePosition || null, blockingSubscriptionCode: claim?.blockingSubscriptionCode || null, state: claim?.state || claim?.blockingGuardState || null };

  const config = await supplierConfig(service);
  const apiKey = await supplierApiKey(service);
  const baseUrl = String(claim.baseUrl || config.base_url || DEFAULT_BASE_URL);
  const phone = normalizedPhone(claim.customerPhone);
  const firstName = String(claim.customerFirstName || "").trim();
  const lastName = String(claim.customerLastName || "").trim();
  const supplierType = String(claim.supplierType || "").trim();
  const isFull = claim.isFull === true;
  const storedSupplierCost = Number(claim.supplierCost);
  const resellerPrice = Number(claim.resellerPrice);

  if (!apiKey) return safeRefund(service, orderId, "Shahid API key is not configured", "api_key_missing");
  if (!/^\d{10,15}$/.test(phone)) return safeRefund(service, orderId, "Reseller phone number is invalid for the Shahid supplier", "invalid_reseller_phone");
  if (!firstName || !lastName) return safeRefund(service, orderId, "Reseller name is incomplete for the Shahid supplier", "reseller_name_required");
  if (!supplierTypeMonths(supplierType)) return safeRefund(service, orderId, `Unsupported Shahid mapping type: ${supplierType || "missing"}`, "invalid_supplier_mapping");

  const typeResult = await supplierRequest(baseUrl, apiKey, "GET", "/api/v1/shahid/types");
  if (typeResult.networkError || typeResult.status !== 200 || typeResult.body?.success !== true) return safeRefund(service, orderId, supplierErrorMessage(typeResult.body, typeResult.error || "Could not verify Shahid package before purchase"), "package_preflight_failed", typeResult.status);
  const livePackage = packageFromTypes(typeResult.body, supplierType, isFull);
  if (!livePackage) return safeRefund(service, orderId, "The selected Shahid package is not available from the supplier", "supplier_package_unavailable", typeResult.status);
  const liveSupplierCost = livePackage.price;
  if (Number.isFinite(storedSupplierCost) && storedSupplierCost > 0 && liveSupplierCost > storedSupplierCost + 0.01) return safeRefund(service, orderId, `Supplier cost changed from ${storedSupplierCost.toFixed(2)} to ${liveSupplierCost.toFixed(2)}; purchase blocked`, "supplier_price_increased", typeResult.status);
  if (Number.isFinite(resellerPrice) && liveSupplierCost > resellerPrice) return safeRefund(service, orderId, "Supplier cost is higher than the reseller sale price; purchase blocked", "negative_margin_blocked", typeResult.status);

  const baseline = await captureProfileBaseline(baseUrl, apiKey, phone);
  if (!baseline.ok) return safeRefund(service, orderId, baseline.message || "Could not capture a safe Shahid profile baseline before purchase", baseline.truncated ? "profile_baseline_too_large" : "profile_baseline_failed", baseline.status);

  const prebuyMetadata = {
    routing: "reseller_phone_fifo_v4",
    resellerId: String(claim.resellerId || ""), resellerPhone: phone, orderNumber: Number(claim.orderNumber || 0) || null,
    mappingType: supplierType, resolvedSupplierType: livePackage.apiType, resolvedSupplierTitle: livePackage.title,
    resolvedSupplierPackageId: livePackage.sourceId, isFull, baselineCapturedAt: new Date().toISOString(), profileBaseline: baseline.rows,
  };
  const { error: prebuyError } = await service.rpc("store_tvleb_shahid_prebuy_context", { p_order_id: orderId, p_metadata: prebuyMetadata });
  if (prebuyError) return safeRefund(service, orderId, `Could not store Shahid pre-purchase safety context: ${shortMessage(prebuyError.message)}`, "prebuy_context_store_failed");

  const { error: startedError } = await service.rpc("mark_tvleb_shahid_purchase_started", { p_order_id: orderId });
  if (startedError) throw startedError;

  const buyPayload: Record<string, unknown> = { type: livePackage.apiType, customerPhone: phone, isFull, customerFirstName: firstName, customerLastName: lastName };
  const purchase = await supplierRequest(baseUrl, apiKey, "POST", "/api/v1/shahid/buy", buyPayload, 15000);
  if (purchase.networkError || purchase.status === null) {
    await markAmbiguous(service, orderId, `Network result became ambiguous after Shahid purchase started: ${shortMessage(purchase.error)}`);
    return { ok: false, ambiguous: true, automaticRetry: false };
  }
  if (purchase.status >= 500) {
    await markAmbiguous(service, orderId, `Supplier returned HTTP ${purchase.status} after Shahid purchase started`, purchase.status);
    return { ok: false, ambiguous: true, automaticRetry: false };
  }
  if ([400, 401, 403, 404, 429].includes(purchase.status)) return safeRefund(service, orderId, supplierErrorMessage(purchase.body, `Supplier rejected purchase with HTTP ${purchase.status}`), "supplier_rejected_purchase", purchase.status);
  if (purchase.status < 200 || purchase.status >= 300) {
    await markAmbiguous(service, orderId, `Unexpected HTTP ${purchase.status} after Shahid purchase started`, purchase.status);
    return { ok: false, ambiguous: true, automaticRetry: false };
  }
  if (purchase.body?.success !== true) return safeRefund(service, orderId, supplierErrorMessage(purchase.body, "Supplier rejected Shahid purchase"), "supplier_purchase_failed", purchase.status);

  const purchased = purchase.body?.data;
  const supplierId = String(purchased?.id || "").trim();
  if (!supplierId) {
    await markAmbiguous(service, orderId, "Supplier returned success without a subscription ID", purchase.status);
    return { ok: false, ambiguous: true, automaticRetry: false };
  }
  const supplierStatus = responseStatus(purchased);
  const supplierPriceValue = Number(purchased?.price);
  const supplierPrice = Number.isFinite(supplierPriceValue) ? supplierPriceValue : liveSupplierCost;
  const supplierExpiry = validFutureIso(purchased?.expiryDate);
  const profileName = String(purchased?.profileName || "").trim() || null;
  const expectedEmail = String(purchased?.email || "").trim() || null;
  const metadata = { ...prebuyMetadata, expectedProfileName: profileName, expectedEmail };
  const { error: recordError } = await service.rpc("record_tvleb_shahid_purchase_success_v2", {
    p_order_id: orderId, p_supplier_subscription_id: supplierId, p_supplier_status: supplierStatus, p_customer_phone: phone,
    p_supplier_is_full: isFull, p_supplier_price: supplierPrice, p_supplier_expiry_at: supplierExpiry,
    p_supplier_profile_name: profileName, p_http_status: purchase.status, p_message: shortMessage(purchase.body?.message || "Purchase accepted"), p_metadata: metadata,
  });
  if (recordError) {
    await markAmbiguous(service, orderId, `Supplier purchase succeeded but Subly could not record its link: ${shortMessage(recordError.message)}`, purchase.status);
    return { ok: false, ambiguous: true, automaticRetry: false };
  }
  if (supplierStatus === "pending") return { ok: true, purchased: true, pending: true, supplierId };
  return await resolveAfterPurchase(service, baseUrl, apiKey, orderId, supplierId, phone, isFull, supplierPrice, metadata);
}

async function pollPending(service: any) {
  const config = await supplierConfig(service);
  if (!config.enabled || !config.live_purchase_enabled) return { ok: true, action: "noop", reason: "live_purchase_disabled" };
  const apiKey = await supplierApiKey(service);
  if (!apiKey) throw new Error("TV Leb Shahid API key is not configured");
  const baseUrl = String(config.base_url || DEFAULT_BASE_URL);
  const { data: links, error } = await service.rpc("get_tvleb_shahid_pending_links", { p_limit: MAX_PENDING_BATCH });
  if (error) throw error;
  const pending = Array.isArray(links) ? links : [];
  if (!pending.length) return { ok: true, checked: 0, delivered: 0 };
  const groups = new Map<string, any[]>();
  for (const link of pending) {
    const supplierId = String(link?.supplier_subscription_id || "");
    if (!supplierId) continue;
    if (!groups.has(supplierId)) groups.set(supplierId, []);
    groups.get(supplierId)!.push(link);
  }
  let checked = 0, delivered = 0;
  for (const [supplierId, group] of groups) {
    const result = await supplierRequest(baseUrl, apiKey, "GET", `/api/v1/shahid/subscription/${encodeURIComponent(supplierId)}`);
    checked++;
    if (result.networkError || result.status !== 200 || result.body?.success !== true || !Array.isArray(result.body?.data)) {
      const errorText = supplierErrorMessage(result.body, result.error || `Supplier status check returned ${result.status ?? "network error"}`);
      for (const link of group) {
        const attempts = Number(link?.check_attempts || 0);
        await recordPoll(service, link.order_id, "pending", result.status, null, null, errorText, result.status === 429 ? 120 : nextPollSeconds(attempts));
        if (attempts === 9) await addIncident(service, link.order_id, "warning", "pending_status_delayed", "Shahid purchase is still pending after repeated supplier checks.", { supplierId });
      }
      continue;
    }
    for (const link of group) {
      const attempts = Number(link?.check_attempts || 0);
      const choice = chooseCustomerProfile(result.body.data, link.customer_phone, supplierId, link.metadata || {}, link.supplier_is_full === true);
      const matched = choice.match;
      if (!matched) {
        await recordPoll(service, link.order_id, "pending", result.status, null, null, choice.reason, nextPollSeconds(attempts));
        if (attempts === 9) await addIncident(service, link.order_id, "warning", "pending_profile_not_unique", "Supplier account is visible, but Subly is still waiting for the uniquely identifiable Shahid profile for this queued order.", { supplierId, matchReason: choice.reason });
        continue;
      }
      const status = String(matched?.status || "pending").toLowerCase();
      const expiryAt = validFutureIso(matched?.expiryDate);
      if (status === "expired") {
        await recordPoll(service, link.order_id, "expired", result.status, matched?.profileName || null, expiryAt, "Supplier returned expired status", 300);
        await addIncident(service, link.order_id, "critical", "pending_purchase_became_expired", "A charged Shahid purchase became expired before Subly could deliver it.", { supplierId });
        continue;
      }
      if (status !== "active" && status !== "near_expiry") {
        await recordPoll(service, link.order_id, "pending", result.status, matched?.profileName || null, expiryAt, null, nextPollSeconds(attempts));
        continue;
      }
      const delivery = await deliverProfile(service, link.order_id, supplierId, link.supplier_is_full === true, matched, null);
      if (delivery.delivered) delivered++;
      else await recordPoll(service, link.order_id, "pending", result.status, matched?.profileName || null, expiryAt, delivery.reason, nextPollSeconds(attempts));
    }
  }
  return { ok: true, checked, delivered, pending: pending.length };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
    const service = createServiceClient();
    if (!(await authenticateInternal(req, service))) return json({ ok: false, error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (action === "process_order") {
      const orderId = String(body?.orderId || "").trim();
      if (!orderId) return json({ ok: false, error: "orderId is required" }, 400);
      return json(await processOrder(service, orderId));
    }
    if (action === "poll_pending") return json(await pollPending(service));
    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[SHAHID_WORKER]", error instanceof Error ? error.message : "Unexpected error");
    return json({ ok: false, error: "Shahid worker failed safely" }, 500);
  }
});
