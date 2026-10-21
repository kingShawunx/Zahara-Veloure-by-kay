import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

// Keep legacy payment records and verification endpoints intact, but do not start new gateway sessions.
const ONLINE_GATEWAY_CHECKOUT_ENABLED = false;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!ONLINE_GATEWAY_CHECKOUT_ENABLED) {
    return jsonResponse({ error: "Paystack checkout is unavailable. Choose bank transfer or contact the store on WhatsApp." }, 410);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey || !secret) return jsonResponse({ error: "Paystack checkout is not configured" }, 503);
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Sign in to continue" }, 401);
  try {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Sign in to continue" }, 401);
    const { data: paymentSetting, error: settingError } = await userClient.from("store_settings").select("value").eq("key", "payment").maybeSingle();
    if (settingError) return jsonResponse({ error: "Payment options could not be checked" }, 503);
    if (paymentSetting?.value?.paystack_enabled !== true) return jsonResponse({ error: "Online payment is not enabled by the store" }, 409);
    const body = await request.json();
    if (!body || typeof body.order_id !== "string") return jsonResponse({ error: "Order is required" }, 400);
    const { data: order, error: orderError } = await userClient.from("orders").select("id,order_number,total,agreed_total,negotiation_status,currency,payment_status,customer_email").eq("id", body.order_id).eq("user_id", user.id).maybeSingle();
    if (orderError || !order) return jsonResponse({ error: "Order not found" }, 404);
    if (order.payment_status !== "pending" || order.negotiation_status === "awaiting_agreement" || order.negotiation_status === "declined" || (order.negotiation_status === "confirmed" && order.agreed_total == null)) return jsonResponse({ error: "This order needs the seller to confirm its final price before payment." }, 409);
    const amount = Number(order.negotiation_status === "confirmed" ? order.agreed_total : order.total);
    if (!Number.isFinite(amount) || amount <= 0) return jsonResponse({ error: "This order cannot be paid" }, 409);
    const { error: methodError } = await userClient.rpc("begin_order_payment", { p_order_id: order.id, p_method: "paystack" });
    if (methodError) return jsonResponse({ error: methodError.message }, 409);
    const { data: existing, error: existingError } = await userClient.from("payments")
      .select("provider_reference,authorization_url")
      .eq("order_id", order.id).eq("provider", "paystack").eq("status", "initialized").maybeSingle();
    if (existingError) return jsonResponse({ error: "Payment status could not be checked" }, 500);
    if (existing) {
      if (existing.authorization_url) return jsonResponse({ authorization_url: existing.authorization_url, reference: existing.provider_reference, resumed: true });
      return jsonResponse({ error: "A payment attempt is already open. Check your previous Paystack tab or contact the store before retrying." }, 409);
    }

    const reference = `ZV-${order.order_number}-${crypto.randomUUID()}`;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: saveError } = await admin.from("payments").insert({ order_id: order.id, provider: "paystack", provider_reference: reference, amount, currency: order.currency, status: "initialized" });
    if (saveError) {
      if (saveError.code === "23505") {
        const { data: raced } = await userClient.from("payments").select("provider_reference,authorization_url").eq("order_id",order.id).eq("provider","paystack").eq("status","initialized").maybeSingle();
        if (raced?.authorization_url) return jsonResponse({ authorization_url:raced.authorization_url,reference:raced.provider_reference,resumed:true });
      } else {
        await admin.from("orders").update({payment_method:null}).eq("id",order.id).eq("payment_method","paystack").eq("payment_status","pending");
      }
      return jsonResponse({ error: "Payment session could not be saved. Contact support before retrying." }, 502);
    }
    let providerResponse: Response;
    try {
      providerResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: order.customer_email, amount: Math.round(amount * 100), currency: order.currency, reference, callback_url: Deno.env.get("PAYSTACK_CALLBACK_URL"), metadata: { order_id: order.id, order_number: order.order_number } }),
      });
    } catch (_) {
      await admin.from("payments").update({ status:"failed" }).eq("provider_reference",reference).eq("status","initialized");
      await admin.from("orders").update({payment_method:null}).eq("id",order.id).eq("payment_method","paystack").eq("payment_status","pending");
      return jsonResponse({ error: "Payment provider could not be reached. Please try again." }, 502);
    }
    const providerBody = await providerResponse.json();
    if (!providerResponse.ok || providerBody.status !== true || !providerBody.data?.authorization_url) {
      await admin.from("payments").update({ status:"failed" }).eq("provider_reference",reference).eq("status","initialized");
      await admin.from("orders").update({payment_method:null}).eq("id",order.id).eq("payment_method","paystack").eq("payment_status","pending");
      return jsonResponse({ error: "Payment could not be initialized. Please try again." }, 502);
    }
    const { error: urlSaveError } = await admin.from("payments").update({ authorization_url: providerBody.data.authorization_url }).eq("provider_reference",reference).eq("status","initialized");
    if (urlSaveError) {
      await admin.from("payments").update({status:"failed"}).eq("provider_reference",reference).eq("status","initialized");
      await admin.from("orders").update({payment_method:null}).eq("id",order.id).eq("payment_method","paystack").eq("payment_status","pending");
      return jsonResponse({ error: "Payment could not be safely resumed. Your order remains unpaid; try again or contact the store." }, 502);
    }
    return jsonResponse({ authorization_url: providerBody.data.authorization_url, reference });
  } catch (_) {
    return jsonResponse({ error: "Payment service could not process this request" }, 400);
  }
});
