// Netlify Function — административни действия с потребители (списък / спиране / пускане).
// Единственото място, където се използва Supabase service_role ключа — той никога не бива
// да стига до браузъра (за разлика от anon ключа, hardcoded в korekt-calculator.jsx:123,
// който е публичен по дизайн). Ключът се чете тук само от env variable в Netlify:
// Site settings → Environment variables → SUPABASE_SERVICE_ROLE_KEY.
//
// Всяка заявка носи Authorization: Bearer <access_token> на текущата сесия на викащия
// (същата, която пази authSession в клиента). Функцията сама проверява самоличността
// сървърно — не се доверява на скрит бутон в UI-то — като чете /auth/v1/user с този
// токен и сравнява имейла с ADMIN_EMAIL (трябва да съвпада с PARAMS_EDITOR_EMAIL в
// korekt-calculator.jsx).
//
// GitHub Pages (dmehov-max.github.io/kalkulator) е статичен хостинг и не може да пуска
// функции — затова компилираният сайт вика тази функция по абсолютен адрес на Netlify,
// откъдето и да е зареден. CORS по-долу пуска изрично двата известни адреса на сайта.

const SUPABASE_URL = "https://ncwiyhndgyssepaqyiss.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jd2l5aG5kZ3lzc2VwYXF5aXNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjU0MzUsImV4cCI6MjEwMDkwMTQzNX0.ve7p8ZKe0DYgD_LrY0rcPyHAGF-NNLuh0R-2noess7w";
// пази в синхрон с PARAMS_EDITOR_EMAIL в korekt-calculator.jsx
const ADMIN_EMAIL = "d.mehov@korekt-bg.com";
// откъдето позволяваме заявки към тази функция — сайтът се обслужва от двата адреса
const ALLOWED_ORIGINS = new Set([
  "https://korekt-kalkulator.netlify.app",
  "https://dmehov-max.github.io",
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://korekt-kalkulator.netlify.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

// v2 Netlify Functions работят с стандартните Web Request/Response, не старите
// {statusCode, headers, body} обекти от v1 handler-и.
function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// проверява access_token-а на викащия срещу Supabase и връща имейла му (или null)
async function callerEmail(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.email || null;
  } catch (e) {
    return null;
  }
}

export default async (request) => {
  const origin = request.headers.get("origin") || "";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY не е зададен в Netlify env." }, origin);

  const accessToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const email = await callerEmail(accessToken);
  if (!email || email.trim().toLowerCase() !== ADMIN_EMAIL) {
    return json(403, { error: "Само администраторът може да управлява потребители." }, origin);
  }

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "list";

  try {
    if (action === "list" && request.method === "GET") {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: serviceHeaders });
      const data = await res.json().catch(() => null);
      if (!res.ok) return json(res.status, { error: data?.msg || "Грешка при извличане на потребители." }, origin);
      const users = (data?.users || []).map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        confirmed_at: u.confirmed_at || u.email_confirmed_at || null,
        banned_until: u.banned_until || null,
      }));
      return json(200, { users }, origin);
    }

    if ((action === "ban" || action === "unban") && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const id = body?.id;
      if (!id) return json(400, { error: "Липсва id на потребител." }, origin);
      // Supabase конвенция: "876000h" (~100 години) = безсрочно спрян, "none" = пуснат
      const ban_duration = action === "ban" ? "876000h" : "none";
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: serviceHeaders,
        body: JSON.stringify({ ban_duration }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return json(res.status, { error: data?.msg || "Грешка при промяна на достъпа." }, origin);
      return json(200, { ok: true }, origin);
    }

    return json(404, { error: "Непозната заявка." }, origin);
  } catch (e) {
    return json(500, { error: "Сървърна грешка." }, origin);
  }
};
