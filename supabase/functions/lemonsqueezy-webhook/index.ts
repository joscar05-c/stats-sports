import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET") ?? "";

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function generateAccessCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let p1 = "";
  let p2 = "";
  for (let i = 0; i < 4; i++) {
    p1 += chars[bytes[i] % chars.length];
    p2 += chars[bytes[i + 4] % chars.length];
  }
  return `CVPRO-${p1}-${p2}`;
}

async function verifyLemonSqueezySignature(
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHex || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const cleanSig = signatureHex.trim().toLowerCase();
  if (computedHex.length !== cleanSig.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ cleanSig.charCodeAt(i);
  }
  return diff === 0;
}

function dbHeaders(prefer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  return headers;
}

interface SubRow {
  id: number;
  user_id: string | null;
  email: string;
  access_code: string;
  status: string;
  expires_at: string;
  external_subscription_id: string | null;
  external_order_id: string | null;
}

async function resolveProfileUserId(email: string, explicitUserId: string | null): Promise<string | null> {
  if (explicitUserId) return explicitUserId;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
      { headers: dbHeaders() },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{ id: string }>;
      if (rows[0]?.id) return rows[0].id;
    }
  } catch {
    // Non-fatal fallback
  }
  return null;
}

async function findExistingSubscription(
  externalSubId: string | null,
  externalOrderId: string | null,
): Promise<SubRow | null> {
  const cols =
    "id,user_id,email,access_code,status,expires_at,external_subscription_id,external_order_id";
  if (externalSubId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pro_subscriptions?external_subscription_id=eq.${encodeURIComponent(
        externalSubId,
      )}&select=${cols}&limit=1`,
      { headers: dbHeaders() },
    );
    if (res.ok) {
      const rows = (await res.json()) as SubRow[];
      if (rows[0]) return rows[0];
    }
  }
  if (externalOrderId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pro_subscriptions?external_order_id=eq.${encodeURIComponent(
        externalOrderId,
      )}&select=${cols}&limit=1`,
      { headers: dbHeaders() },
    );
    if (res.ok) {
      const rows = (await res.json()) as SubRow[];
      if (rows[0]) return rows[0];
    }
  }
  return null;
}

async function broadcastUnlock(
  email: string,
  status: string,
  userId: string | null,
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({
        messages: [
          {
            topic: "pro_unlock",
            event: "pro_updated",
            payload: { email, user_id: userId, status, ts: Date.now() },
          },
        ],
      }),
    });
  } catch {
    // Non-fatal; client polling and focus check also catch updates
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }
  if (!WEBHOOK_SECRET) {
    return jsonResp({ error: "LEMONSQUEEZY_WEBHOOK_SECRET not configured" }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResp({ error: "Supabase service credentials missing" }, 500);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-signature") ?? "";
  const valid = await verifyLemonSqueezySignature(rawBody, signature, WEBHOOK_SECRET);
  if (!valid) {
    return jsonResp({ error: "Invalid webhook signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return jsonResp({ error: "Invalid JSON payload" }, 400);
  }

  const meta = (payload.meta ?? {}) as Record<string, unknown>;
  const customData = (meta.custom_data ?? {}) as Record<string, unknown>;
  const dataObj = (payload.data ?? {}) as Record<string, unknown>;
  const attrs = (dataObj.attributes ?? {}) as Record<string, unknown>;

  const eventName = String(meta.event_name ?? req.headers.get("x-event-name") ?? "");
  const dataId = String(dataObj.id ?? "");
  const email = String(attrs.user_email ?? customData.email ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    return jsonResp({ ok: true, ignored: "No customer email present", event: eventName });
  }

  const nowIso = new Date().toISOString();
  const plus31DaysIso = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
  const customerId = attrs.customer_id != null ? String(attrs.customer_id) : null;
  const firstItem = (attrs.first_order_item ?? {}) as Record<string, unknown>;
  const variantId =
    attrs.variant_id != null
      ? String(attrs.variant_id)
      : firstItem.variant_id != null
        ? String(firstItem.variant_id)
        : null;
  const testMode = Boolean(attrs.test_mode ?? meta.test_mode ?? false);

  let targetStatus: "active" | "expired" | "cancelled" | null = null;
  let expiresAt = plus31DaysIso;
  let externalSubId: string | null = null;
  let externalOrderId: string | null = null;

  if (eventName === "order_created") {
    const orderStatus = String(attrs.status ?? "").toLowerCase();
    if (orderStatus !== "paid") {
      return jsonResp({ ok: true, ignored: `Order status ${orderStatus}`, event: eventName });
    }
    externalOrderId = `ls_ord_${dataId}`;
    externalSubId = externalOrderId;
    targetStatus = "active";
  } else if (
    eventName === "subscription_created" ||
    eventName === "subscription_updated" ||
    eventName === "subscription_resumed" ||
    eventName === "subscription_unpaused"
  ) {
    externalSubId = `ls_sub_${dataId}`;
    externalOrderId = attrs.order_id != null ? `ls_ord_${String(attrs.order_id)}` : null;
    const lsStatus = String(attrs.status ?? "active").toLowerCase();
    const endsAt = attrs.ends_at ? String(attrs.ends_at) : null;
    const renewsAt = attrs.renews_at ? String(attrs.renews_at) : null;

    if (lsStatus === "active" || lsStatus === "on_trial") {
      targetStatus = "active";
      expiresAt = endsAt ?? renewsAt ?? plus31DaysIso;
    } else if (lsStatus === "cancelled") {
      if (endsAt && new Date(endsAt).getTime() > Date.now()) {
        targetStatus = "active";
        expiresAt = endsAt;
      } else {
        targetStatus = "cancelled";
        expiresAt = endsAt ?? nowIso;
      }
    } else {
      targetStatus = "expired";
      expiresAt = endsAt ?? nowIso;
    }
  } else if (eventName === "subscription_payment_success") {
    const invStatus = String(attrs.status ?? "paid").toLowerCase();
    if (invStatus !== "paid") {
      return jsonResp({ ok: true, ignored: `Invoice status ${invStatus}`, event: eventName });
    }
    externalSubId =
      attrs.subscription_id != null
        ? `ls_sub_${String(attrs.subscription_id)}`
        : `ls_sub_${dataId}`;
    targetStatus = "active";
    expiresAt = plus31DaysIso;
  } else if (eventName === "subscription_cancelled") {
    externalSubId = `ls_sub_${dataId}`;
    const endsAt = attrs.ends_at ? String(attrs.ends_at) : null;
    if (endsAt && new Date(endsAt).getTime() > Date.now()) {
      targetStatus = "active";
      expiresAt = endsAt;
    } else {
      targetStatus = "cancelled";
      expiresAt = endsAt ?? nowIso;
    }
  } else if (
    eventName === "subscription_expired" ||
    eventName === "subscription_paused" ||
    eventName === "subscription_payment_failed"
  ) {
    externalSubId =
      eventName === "subscription_payment_failed" && attrs.subscription_id != null
        ? `ls_sub_${String(attrs.subscription_id)}`
        : `ls_sub_${dataId}`;
    targetStatus = "expired";
    expiresAt = attrs.ends_at ? String(attrs.ends_at) : nowIso;
  } else {
    return jsonResp({ ok: true, ignored: `Unhandled event ${eventName}` });
  }

  const existing = await findExistingSubscription(externalSubId, externalOrderId);
  const rawCustomUserId =
    typeof customData.user_id === "string" ? customData.user_id.trim() : "";
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const explicitUserId = uuidRegex.test(rawCustomUserId) ? rawCustomUserId : null;
  const resolvedUserId = await resolveProfileUserId(email, explicitUserId ?? existing?.user_id ?? null);

  if (existing) {
    const finalExpires =
      targetStatus === "active" && new Date(existing.expires_at).getTime() > new Date(expiresAt).getTime()
        ? existing.expires_at
        : expiresAt;

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pro_subscriptions?id=eq.${existing.id}`,
      {
        method: "PATCH",
        headers: dbHeaders("return=minimal"),
        body: JSON.stringify({
          user_id: resolvedUserId ?? existing.user_id,
          email,
          status: targetStatus,
          expires_at: finalExpires,
          external_subscription_id: externalSubId ?? existing.external_subscription_id,
          external_order_id: externalOrderId ?? existing.external_order_id,
          customer_id: customerId,
          variant_id: variantId,
          test_mode: testMode,
          updated_at: nowIso,
        }),
      },
    );
    if (!patchRes.ok) {
      return jsonResp({ error: await patchRes.text() }, 500);
    }
    await broadcastUnlock(email, targetStatus, resolvedUserId ?? existing.user_id);
    return jsonResp({ ok: true, action: "updated", event: eventName, status: targetStatus, email });
  }

  if (targetStatus !== "active") {
    return jsonResp({ ok: true, ignored: "No existing row for non-active event", event: eventName });
  }

  const accessCode = generateAccessCode();
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/pro_subscriptions`, {
    method: "POST",
    headers: dbHeaders("return=minimal"),
    body: JSON.stringify({
      user_id: resolvedUserId,
      email,
      access_code: accessCode,
      provider: "lemonsqueezy",
      amount_usd: 5.0,
      status: targetStatus,
      starts_at: nowIso,
      expires_at: expiresAt,
      external_subscription_id: externalSubId,
      external_order_id: externalOrderId,
      customer_id: customerId,
      variant_id: variantId,
      test_mode: testMode,
      updated_at: nowIso,
    }),
  });

  if (!insertRes.ok) {
    return jsonResp({ error: await insertRes.text() }, 500);
  }

  await broadcastUnlock(email, targetStatus, resolvedUserId);
  return jsonResp({ ok: true, action: "created", event: eventName, status: targetStatus, email });
});
