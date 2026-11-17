import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const sbServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!sbUrl || !sbServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "Missing authorization token" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(sbUrl, sbServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const user = userRes.user;
    const email = (user.email ?? "").trim().toLowerCase();

    // Clean related user records before deleting auth user
    await admin.from("yape_plin_requests").delete().eq("user_id", user.id);
    await admin.from("pro_subscriptions").delete().eq("user_id", user.id);
    if (email) {
      await admin.from("pro_subscriptions").delete().ilike("email", email);
    }
    await admin.from("profiles").delete().eq("id", user.id);

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      throw new Error(delErr.message || "Failed to delete user");
    }

    return new Response(JSON.stringify({ ok: true, deleted_user_id: user.id }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
