import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

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
      if (!supabaseUrl || !serviceRoleKey || !anonKey) {
        return json({ error: "Server configuration missing" }, 500);
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Not authenticated" }, 401);

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Invalid login session" }, 401);

      const { data: adminProfile, error: adminError } = await userClient
        .from("profiles")
        .select("role,status")
        .eq("id", user.id)
        .single();

      if (adminError || !adminProfile || adminProfile.role !== "admin" || adminProfile.status !== "active") {
        return json({ error: "Admin access required" }, 403);
      }

      const body = await req.json();
      const userId = String(body?.user_id || "").trim();
      const password = String(body?.password || "");

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        return json({ error: "Invalid reseller ID" }, 400);
      }
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (password.length > 128) return json({ error: "Password is too long" }, 400);

      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: targetProfile, error: targetError } = await adminClient
        .from("profiles")
        .select("id,username,role,status")
        .eq("id", userId)
        .maybeSingle();

      if (targetError) return json({ error: "Could not verify reseller account" }, 500);
      if (!targetProfile || targetProfile.role !== "reseller") {
        return json({ error: "Reseller account not found" }, 404);
      }

      const { data: updated, error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
        password,
      });

      if (updateError || !updated.user) {
        return json({ error: updateError?.message || "Could not change reseller password" }, 400);
      }

      console.log("[SUBLY] reseller password reset", {
        reseller_id: userId,
        reseller_username: targetProfile.username,
        admin_id: user.id,
      });

      return json({
        success: true,
        reseller: {
          id: userId,
          username: targetProfile.username,
        },
      });
    } catch (error) {
      console.error("[SUBLY] admin-reset-reseller-password error:", error);
      return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
    }
  },
};
