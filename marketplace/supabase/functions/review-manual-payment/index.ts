import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey) return jsonResponse({ error: "Payment review service is not configured" }, 503);
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Administrator sign-in required" }, 401);
  try {
    const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Administrator sign-in required" }, 401);
    const { data: profile, error: profileError } = await client.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (profileError || profile?.role !== "admin" || profile.account_status !== "active") return jsonResponse({ error: "Active administrator access required" }, 403);
    const body = await request.json();
    if (!body || typeof body.payment_id !== "string" || typeof body.approve !== "boolean") return jsonResponse({ error: "Invalid payment review" }, 400);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!body.approve && reason.length < 3) return jsonResponse({ error: "Provide a reason of at least 3 characters" }, 400);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc("review_manual_payment", {
      p_payment_id: body.payment_id, p_approve: body.approve, p_reason: reason, p_actor_id: user.id,
    });
    if (error) return jsonResponse({ error: error.message }, 409);
    return jsonResponse({ order_id: data, status: body.approve ? "verified" : "rejected" });
  } catch (_) {
    return jsonResponse({ error: "Payment review could not be completed" }, 400);
  }
});
