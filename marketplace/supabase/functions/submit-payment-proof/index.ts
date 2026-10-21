import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey) return jsonResponse({ error: "Payment proof service is not configured" }, 503);
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Sign in to continue" }, 401);
  try {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Sign in to continue" }, 401);
    const { data: paymentSetting, error: settingError } = await userClient.from("store_settings").select("value").eq("key", "payment").maybeSingle();
    if (settingError) return jsonResponse({ error: "Payment options could not be checked" }, 503);
    if (paymentSetting?.value?.manual_transfer_enabled === false) return jsonResponse({ error: "Bank transfer is not enabled by the store" }, 409);
    const body = await request.json();
    if (!body || typeof body.order_id !== "string" || typeof body.proof_path !== "string") return jsonResponse({ error: "Order and receipt are required" }, 400);
    const path = body.proof_path;
    if (!new RegExp(`^${user.id}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp|pdf)$`, "i").test(path)) return jsonResponse({ error: "Invalid proof file path" }, 400);

    const { data: order, error: orderError } = await userClient.from("orders")
      .select("id,total,agreed_total,negotiation_status,payment_status,currency")
      .eq("id", body.order_id).eq("user_id", user.id).maybeSingle();
    if (orderError || !order) return jsonResponse({ error: "Order not found" }, 404);
    if (order.payment_status !== "pending" || order.negotiation_status === "awaiting_agreement" || order.negotiation_status === "declined") return jsonResponse({ error: "Confirm the final order price before submitting payment proof" }, 409);
    const { error: methodError } = await userClient.rpc("begin_order_payment", { p_order_id: order.id, p_method: "manual_transfer" });
    if (methodError) return jsonResponse({ error: methodError.message }, 409);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const folder = `${user.id}/${order.id}`;
    const { data: files, error: filesError } = await admin.storage.from("payment-proofs").list(folder, { limit: 100 });
    const fileName = path.slice(folder.length + 1);
    if (filesError || !files?.some((file) => file.name === fileName)) return jsonResponse({ error: "Uploaded proof could not be verified. Please upload it again." }, 400);

    const { data: pending, error: pendingError } = await userClient.from("payments")
      .select("id,provider_reference,status,proof_path").eq("order_id", order.id)
      .eq("provider", "manual_transfer").eq("status", "pending_verification").maybeSingle();
    if (pendingError) return jsonResponse({ error: "Payment status could not be checked" }, 500);
    if (pending) {
      if (pending.proof_path !== path) await admin.storage.from("payment-proofs").remove([path]);
      return jsonResponse({ payment_id: pending.id, reference: pending.provider_reference, status: pending.status, already_submitted: true });
    }

    const amount = Number(order.negotiation_status === "confirmed" ? order.agreed_total : order.total);
    const reference = `ZV-MANUAL-${crypto.randomUUID()}`;
    const { data: payment, error: insertError } = await admin.from("payments").insert({
      order_id: order.id, provider: "manual_transfer", provider_reference: reference,
      amount, currency: order.currency, status: "pending_verification", proof_path: path,
      submitted_at: new Date().toISOString(),
    }).select("id,provider_reference,status").single();
    if (insertError) {
      await admin.storage.from("payment-proofs").remove([path]);
      return jsonResponse({ error: "Payment proof could not be recorded. Please retry or contact the store." }, 409);
    }
    return jsonResponse({ payment_id: payment.id, reference: payment.provider_reference, status: payment.status });
  } catch (_) {
    return jsonResponse({ error: "Payment proof could not be submitted" }, 400);
  }
});
