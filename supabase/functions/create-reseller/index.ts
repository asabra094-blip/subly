import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

const normalizePhone = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("961")) return digits;
  if (digits.startsWith("0") && digits.length >= 8) return `961${digits.slice(1)}`;
  if (digits.length === 8) return `961${digits}`;
  return digits;
};

export default {
  async fetch(req: Request) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    try {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Server configuration missing" }, 500);

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Not authenticated" }, 401);

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Invalid login session" }, 401);

      const { data: adminProfile, error: profileError } = await userClient
        .from("profiles")
        .select("role,status")
        .eq("id", user.id)
        .single();
      if (profileError || !adminProfile || adminProfile.role !== "admin" || adminProfile.status !== "active") {
        return json({ error: "Admin access required" }, 403);
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const body = await req.json();
      const cleanUsername = String(body?.username || "").trim().toLowerCase();
      const cleanBusinessName = String(body?.business_name || "").trim();
      const cleanPhone = normalizePhone(body?.phone);
      const cleanTier = String(body?.tier || "bronze").trim().toLowerCase();
      const password = String(body?.password || "");

      if (!cleanUsername || !password || !cleanBusinessName || !cleanPhone) {
        return json({ error: "Username, password, business name and phone number are required" }, 400);
      }
      if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
        return json({ error: "Username must be 3-30 characters using letters, numbers, _, . or -" }, 400);
      }
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (cleanPhone.length < 10) return json({ error: "Enter a valid reseller phone number" }, 400);
      if (!["bronze", "silver", "gold", "diamond"].includes(cleanTier)) {
        return json({ error: "Invalid reseller tier" }, 400);
      }

      const { data: existing } = await adminClient
        .from("profiles")
        .select("id")
        .eq("username", cleanUsername)
        .maybeSingle();
      if (existing) return json({ error: "Username already exists" }, 409);

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: `${cleanUsername}@subly.invalid`,
        password,
        email_confirm: true,
      });
      if (createError || !created.user) return json({ error: createError?.message || "Could not create reseller" }, 400);

      const { error: profileInsertError } = await adminClient.from("profiles").upsert({
        id: created.user.id,
        username: cleanUsername,
        business_name: cleanBusinessName,
        phone: cleanPhone,
        role: "reseller",
        tier: cleanTier,
        status: "active",
      });
      if (profileInsertError) {
        await adminClient.auth.admin.deleteUser(created.user.id);
        return json({ error: "Could not create reseller profile" }, 500);
      }

      return json({
        success: true,
        reseller: {
          id: created.user.id,
          username: cleanUsername,
          business_name: cleanBusinessName,
          phone: cleanPhone,
          tier: cleanTier,
          status: "active",
        },
      });
    } catch (error) {
      console.error("[SUBLY] create-reseller error:", error);
      return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
    }
  },
};
