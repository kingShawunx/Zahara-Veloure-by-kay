import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey || !secret) return jsonResponse({ error: "Payment verification is not configured" }, 503);
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Sign in to continue" }, 401);
  try {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Sign in to continue" }, 401);
    const body = await request.json();
    if (!body || typeof body.reference !== "string" || body.reference.length > 120) return jsonResponse({ error: "Payment reference is required" }, 400);
    const { data: payment, error: lookupError } = await userClient.from("payments").select("id,provider_reference,amount,currency,status,order_id,orders!inner(id,user_id,payment_status)").eq("provider_reference", body.reference).eq("orders.user_id", user.id).maybeSingle();
    if (lookupError || !payment) return jsonResponse({ error: "Payment reference not found" }, 404);
    if (payment.status === "verified" && payment.orders.payment_status === "paid") return jsonResponse({ verified: true, order_id: payment.order_id });
    if (payment.status !== "initialized" || payment.orders.payment_status !== "pending") return jsonResponse({ error: "This order is not awaiting payment verification." }, 409);

    const providerResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.provider_reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const providerBody = await providerResponse.json();
    const data = providerBody?.data;
    const valid = providerResponse.ok && providerBody.status === true && data?.status === "success" && data.reference === payment.provider_reference && data.currency === payment.currency && Number(data.amount) === Math.round(Number(payment.amount) * 100);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!valid) {
      if (providerResponse.ok && providerBody.status === true && data?.reference === payment.provider_reference && ["failed","abandoned"].includes(data?.status)) {
        await admin.from("payments").update({ status:"failed", provider_payload:{status:data.status,reference:data.reference} }).eq("id",payment.id).eq("status","initialized");
        await admin.from("orders").update({payment_method:null}).eq("id",payment.order_id).eq("payment_method","paystack").eq("payment_status","pending");
      }
      return jsonResponse({ verified: false, error: "Payment has not been verified as successful." }, 402);
    }

    const { data: confirmedOrder, error: confirmError } = await admin.rpc("confirm_paystack_payment", {
      p_reference: payment.provider_reference,
      p_amount_kobo: Number(data.amount),
      p_currency: data.currency,
      p_provider_payload: { status: data.status, reference: data.reference, amount: data.amount, currency: data.currency },
    });
    if (confirmError || !confirmedOrder) return jsonResponse({ error: "Payment was verified but needs support review before order confirmation." }, 502);
    return jsonResponse({ verified: true, order_id: confirmedOrder });
  } catch (_) {
    return jsonResponse({ error: "Payment verification could not be completed" }, 400);
  }
});
