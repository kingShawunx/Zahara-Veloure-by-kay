import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFor, isRecord, jsonResponse } from "../_shared/http.ts";

function safeDiagnosticMessage(value: unknown): string {
  return String(value || "Unknown database error")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/\b\+?\d[\d ().-]{7,}\d\b/g, "[number]")
    .slice(0, 300);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(request) });
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, request);
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey) return respond({ error: "Order service is not configured" }, 503);
  if (!authorization?.startsWith("Bearer ")) return respond({ error: "Sign in to continue" }, 401);

  try {
    const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to continue" }, 401);
    const body: unknown = await request.json();
    if (!isRecord(body) || !Array.isArray(body.items) || !isRecord(body.delivery)) return respond({ error: "Invalid checkout details" }, 400);
    if (body.items.length < 1 || body.items.length > 30) return respond({ error: "Invalid cart" }, 400);
    const items = body.items.map((item) => {
      if (!isRecord(item) || typeof item.product_id !== "string" || !Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 25) throw new Error("Invalid cart item");
      return { product_id: item.product_id, quantity: item.quantity, variant: isRecord(item.variant) ? item.variant : {} };
    });
    const delivery = {
      name: typeof body.delivery.name === "string" ? body.delivery.name.trim().slice(0, 120) : "",
      email: typeof body.delivery.email === "string" ? body.delivery.email.trim().slice(0, 254) : "",
      phone: typeof body.delivery.phone === "string" ? body.delivery.phone.trim().slice(0, 40) : "",
      address: typeof body.delivery.address === "string" ? body.delivery.address.trim().slice(0, 250) : "",
      city: typeof body.delivery.city === "string" ? body.delivery.city.trim().slice(0, 100) : "",
      state: typeof body.delivery.state === "string" ? body.delivery.state.trim().slice(0, 100) : "",
      country: typeof body.delivery.country === "string" ? body.delivery.country.trim().slice(0, 80) : "",
      delivery_method: typeof body.delivery.delivery_method === "string" ? body.delivery.delivery_method.trim().slice(0, 40) : "",
      note: typeof body.delivery.note === "string" ? body.delivery.note.trim().slice(0, 500) : "",
      location_link: typeof body.delivery.location_link === "string" ? body.delivery.location_link.trim().slice(0, 500) : "",
    };
    if (delivery.country !== "Nigeria" || delivery.delivery_method !== "standard") return respond({ error: "Choose an available country and delivery method." }, 400);
    const coupon = typeof body.coupon_code === "string" ? body.coupon_code.trim().slice(0, 64) : null;
    if (delivery.location_link && !/^https:\/\/(maps\.app\.goo\.gl|maps\.google\.com|www\.google\.com\/maps|goo\.gl\/maps)\//i.test(delivery.location_link)) return respond({ error: "Use a valid Google Maps sharing link for the delivery location." }, 400);
    if (typeof body.request_key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_key)) return respond({ error: "Checkout session expired. Refresh checkout and try again." }, 400);
    const { data, error } = await client.rpc("create_market_order_once", {
      p_items: items,
      p_delivery: delivery,
      p_coupon_code: coupon,
      p_request_key: body.request_key,
      p_request_negotiation: body.request_negotiation === true,
    });
    if (error) {
      const diagnosticMessage = safeDiagnosticMessage(error.message);
      const checkoutRpcMissing = error.code === "42883" || error.code === "PGRST202" || /function public\.create_market_order_once.*not found|could not find the function.*create_market_order_once/i.test(error.message);
      console.error("[create-order] Database RPC failed", {
        code: error.code || null,
        message: diagnosticMessage,
      });
      return respond({
        error: checkoutRpcMissing
          ? "Checkout setup is incomplete. Please contact the store so it can finish configuring order creation. Your cart is still saved."
          : error.message.toLowerCase().includes("stock") ? "A product no longer has enough stock." : "We could not create this order. Please review the cart and try again.",
        error_code: error.code || null,
        diagnostic_message: diagnosticMessage,
      }, 400);
    }
    return respond({ order: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    const invalidRequest = message === "Invalid cart item" || error instanceof SyntaxError;
    console.error("[create-order] Request processing failed", { category: invalidRequest ? "invalid_request" : "unexpected_failure" });
    return respond({
      error: invalidRequest ? "Checkout details are incomplete or invalid. Please review them and try again." : "We could not confirm whether this order was saved. Keep your cart and retry checkout; the same request key will safely resume the order if it was already created.",
    }, invalidRequest ? 400 : 500);
  }
});
