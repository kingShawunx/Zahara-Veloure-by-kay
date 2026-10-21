import { createClient } from "npm:@supabase/supabase-js@2";

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function toHex(bytes: Uint8Array): string { return [...bytes].map((x) => x.toString(16).padStart(2,"0")).join(""); }

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !serviceKey) return new Response("Webhook not configured", { status: 503 });
  const signature = request.headers.get("x-paystack-signature") || "";
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > 256_000) return new Response("Payload too large", { status: 413 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-512" }, false, ["sign"]);
  const expected = toHex(new Uint8Array(await crypto.subtle.sign("HMAC",key,raw)));
  if (!constantTimeEqual(signature,expected)) return new Response("Invalid signature", { status: 401 });
  try {
    const event = JSON.parse(new TextDecoder().decode(raw));
    if (event.event !== "charge.success") return new Response("Event ignored", { status: 200 });
    const payment = event.data;
    if (payment?.status !== "success" || typeof payment.reference !== "string" || !Number.isInteger(payment.amount) || typeof payment.currency !== "string") return new Response("Invalid payment event", { status: 400 });
    const admin = createClient(url, serviceKey, { auth:{ persistSession:false, autoRefreshToken:false } });
    const { error } = await admin.rpc("confirm_paystack_payment", {
      p_reference: payment.reference,
      p_amount_kobo: payment.amount,
      p_currency: payment.currency,
      p_provider_payload: { status:payment.status, reference:payment.reference, amount:payment.amount, currency:payment.currency },
    });
    if (error) return new Response("Payment confirmation pending retry", { status: 503 });
    return new Response("OK", { status: 200 });
  } catch (_) {
    return new Response("Invalid webhook event", { status: 400 });
  }
});
