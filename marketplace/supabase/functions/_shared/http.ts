import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const configuredOrigins = [Deno.env.get("STORE_ALLOWED_ORIGINS"), Deno.env.get("STORE_ALLOWED_ORIGIN")]
  .filter(Boolean)
  .flatMap((value) => value!.split(","))
  .map((origin) => origin.trim())
  .filter(Boolean);

const { "Access-Control-Allow-Origin": _sdkOrigin, ...sdkHeadersWithoutOrigin } = supabaseCorsHeaders;
const baseCorsHeaders = {
  ...sdkHeadersWithoutOrigin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Keep the existing single-origin behavior for payment/admin functions that
// have not yet been migrated to request-aware CORS responses.
export const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Origin": Deno.env.get("STORE_ALLOWED_ORIGIN") ?? "http://127.0.0.1:5500",
};

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const isLocalDevelopmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const allowed = configuredOrigins.includes(origin) || isLocalDevelopmentOrigin;
  return {
    ...baseCorsHeaders,
    ...(allowed ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
  };
}

export function jsonResponse(body: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(request ? corsHeadersFor(request) : corsHeaders), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
