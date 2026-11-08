// Supabase Edge Function — пропуск (token) за гласовия асистент в LiveKit (бутонът „🎤 Разговор“).
//
// Калкулаторът праща Authorization: Bearer <access_token> на логнатия колега. Функцията
// проверява самоличността сървърно (/auth/v1/user, както admin-users) и връща краткотраен
// LiveKit токен за нова стая. Асистентът (korekt-glasov-asistent, agent.py) влиза автоматично
// във всяка нова стая на проекта.
//
// Secrets (Supabase → Edge Functions → Secrets), задават се ръчно:
//   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET  — от LiveKit Cloud → Settings → API keys

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STAFF_EMAIL = /^[^@\s]+@korekt-bg\.com$/i;

const ALLOWED_ORIGINS = new Set([
  "https://dmehov-max.github.io",
  "http://127.0.0.1:8765", // локален тест
]);

function corsHeaders(origin: string) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://dmehov-max.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(status: number, body: unknown, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function callerEmail(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    // само потвърден служебен акаунт (и базата отказва други домейни — виж миграция 20261108_harden_security)
    if (!data?.email || !STAFF_EMAIL.test(data.email) || !(data.email_confirmed_at || data.confirmed_at)) return null;
    return data.email;
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

// LiveKit access token = JWT, подписан с HS256 с API secret-а
async function livekitToken(apiKey: string, apiSecret: string, identity: string, name: string, room: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey, sub: identity, name, nbf: now - 10, exp: now + 15 * 60, // 15 мин за влизане
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  };
  const data = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json(405, { error: "Само POST." }, origin);

  const url = Deno.env.get("LIVEKIT_URL"), apiKey = Deno.env.get("LIVEKIT_API_KEY"), apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!url || !apiKey || !apiSecret) {
    return json(500, { error: "Липсват LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET в Supabase → Edge Functions → Secrets." }, origin);
  }

  const accessToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const email = await callerEmail(accessToken);
  if (!email) return json(401, { error: "Влезте в калкулатора, за да говорите с асистента." }, origin);

  const room = `kalkulator-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const token = await livekitToken(apiKey, apiSecret, `kolega-${crypto.randomUUID().slice(0, 8)}`, email, room);
  return json(200, { url, token, room }, origin);
});
