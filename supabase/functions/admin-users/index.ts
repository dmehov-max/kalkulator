// Supabase Edge Function — административни действия с потребители (списък / спиране / пускане / роля).
// Мигрирано от Netlify Function (netlify/functions/admin-users.mjs, вече оставена непроменена
// и неизползвана), за да не зависи сайтът от Netlify за нищо съществено — статичният сайт
// живее на GitHub Pages (dmehov-max.github.io/kalkulator), а тази функция — на самия Supabase проект.
//
// SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY се инжектират автоматично
// от Supabase във всяка Edge Function на проекта — не се задават ръчно като secrets.
//
// Всяка заявка носи Authorization: Bearer <access_token> на текущата сесия на викащия
// (същата, която пази authSession в клиента). Функцията сама проверява самоличността
// сървърно — не се доверява на скрит бутон в UI-то — като чете /auth/v1/user с този
// токен и проверява дали викащият е администратор: или имейлът съвпада с BOOTSTRAP_ADMIN_EMAIL
// (пази в синхрон с PARAMS_EDITOR_EMAIL в korekt-calculator.jsx — той е администратор винаги,
// за да няма как екипът да се заключи навън от Параметри/Потребители), или app_metadata.role
// на акаунта му е "admin" (зададено оттук, през действието "setRole" — не през user_metadata,
// който всеки логнат сам си променя през панела "Профил", виж supabaseUpdateDisplayName).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// пази в синхрон с PARAMS_EDITOR_EMAIL в korekt-calculator.jsx — единственият администратор,
// който не може да бъде свален (bootstrap, за да няма риск от заключване навън)
const BOOTSTRAP_ADMIN_EMAIL = "d.mehov@korekt-bg.com";

// откъдето позволяваме заявки към тази функция — сайтът се обслужва от този адрес
// (GitHub Pages е основният хостинг вече; Netlify remains като допълнителен адрес засега)
const ALLOWED_ORIGINS = new Set([
  "https://dmehov-max.github.io",
  "https://korekt-kalkulator.netlify.app",
]);

function corsHeaders(origin: string) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://dmehov-max.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(status: number, body: unknown, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// проверява access_token-а на викащия срещу Supabase и връща { email, role } (или null)
async function callerInfo(accessToken: string | null): Promise<{ email: string; role: string } | null> {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.email) return null;
    return { email: data.email, role: data.app_metadata?.role || "employee" };
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY не е наличен." }, origin);

  const accessToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const caller = await callerInfo(accessToken);
  const callerIsAdmin = !!caller && (caller.email.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL || caller.role === "admin");
  if (!callerIsAdmin) {
    return json(403, { error: "Само администратор може да управлява потребители." }, origin);
  }

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "list";

  try {
    if (action === "list" && request.method === "GET") {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: serviceHeaders });
      const data = await res.json().catch(() => null);
      if (!res.ok) return json(res.status, { error: data?.msg || "Грешка при извличане на потребители." }, origin);
      const users = (data?.users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        confirmed_at: u.confirmed_at || u.email_confirmed_at || null,
        banned_until: u.banned_until || null,
        // bootstrap администраторът е винаги "admin" в очите на клиента (виж isAdminSession
        // в jsx), независимо какво пише в app_metadata — показваме го така и тук за консистентност
        role: u.email?.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL ? "admin" : (u.app_metadata?.role || "employee"),
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

    if (action === "setRole" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const id = body?.id;
      const role = body?.role === "admin" ? "admin" : "employee";
      if (!id) return json(400, { error: "Липсва id на потребител." }, origin);
      // app_metadata (не user_metadata!) — само service_role може да го пише, потребителят
      // не може сам да си вдигне ролята през панела "Профил" (виж supabaseUpdateDisplayName)
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: serviceHeaders,
        body: JSON.stringify({ app_metadata: { role } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return json(res.status, { error: data?.msg || "Грешка при промяна на ролята." }, origin);
      return json(200, { ok: true, role }, origin);
    }

    return json(404, { error: "Непозната заявка." }, origin);
  } catch {
    return json(500, { error: "Сървърна грешка." }, origin);
  }
});
