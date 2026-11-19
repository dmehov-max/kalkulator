// Supabase Edge Function — автоматичен превод на текстовете на оферта (BG → EN и RU) с Claude.
//
// „Оферти“ (oferti.html) праща списък от български текстове; функцията връща английски и руски
// превод в същия ред. Достъпна е само за логнат служебен акаунт (проверява се сървърно, както в
// livekit-token). Ключът за Claude е тайна на сървъра и не стига до браузъра.
//
// Secrets (Supabase → Edge Functions → Secrets), задават се ръчно:
//   ANTHROPIC_API_KEY  — от console.anthropic.com → API Keys
//   TRANSLATE_MODEL    — по желание, по подразбиране claude-sonnet-5-5

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STAFF_EMAIL = /^[^@\s]+@korekt-bg\.com$/i;

const MAX_TEXTS = 200;
const MAX_TEXT_LEN = 600;

const ALLOWED_ORIGINS = new Set([
  "https://dmehov-max.github.io",
  "http://127.0.0.1:8765", // локален тест
  "http://localhost:8766",
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
    if (!data?.email || !STAFF_EMAIL.test(data.email) || !(data.email_confirmed_at || data.confirmed_at)) return null;
    return data.email;
  } catch {
    return null;
  }
}

const SYSTEM = `You translate text for a Bulgarian moving company's customer quote (Korekt Moving Ltd, "Корект преместване").
You get a JSON array of Bulgarian strings. Return ONLY a JSON object {"en":[...],"ru":[...]} with the English and Russian translation of every string, in the same order and the same length.
Rules:
- Keep numbers, units (ч, км, м³, кг, €), times, dates, phone numbers and arithmetic like "2.0 ч × 2 души × 18 €/ч" exactly; translate only the words ("h", "movers"; "ч", "чел.").
- Keep proper names: the company is "Korekt" in English and "Корект" in Russian. Transliterate or use the usual English/Russian form for Bulgarian city and district names (София = Sofia/София, Люлин = Lyulin/Люлин).
- Moving-industry wording: "разглобяване" = disassembly, "сглобяване" = assembly, "опаковане" = packing, "стреч фолио" = stretch film, "велпапе" = corrugated cardboard, "кашон" = box, "курс" = trip, "оглед" = survey.
- Keep the tone short and neutral, like a price list. Do not add explanations. An empty string stays empty.
- Output valid JSON only, no markdown fence.`;

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json(405, { error: "Само POST." }, origin);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(500, { error: "Липсва ANTHROPIC_API_KEY в Supabase → Edge Functions → Secrets.", code: "no_key" }, origin);
  }

  const accessToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const email = await callerEmail(accessToken);
  if (!email) return json(401, { error: "Влезте в калкулатора, за да превеждате оферти." }, origin);

  let texts: unknown;
  try { texts = (await request.json())?.texts; } catch { return json(400, { error: "Невалидни данни." }, origin); }
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS ||
      texts.some((t) => typeof t !== "string" || t.length > MAX_TEXT_LEN)) {
    return json(400, { error: `Очаквам до ${MAX_TEXTS} текста, всеки до ${MAX_TEXT_LEN} знака.` }, origin);
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("TRANSLATE_MODEL") || "claude-sonnet-5-5",
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(texts) }],
      }),
    });
  } catch {
    return json(502, { error: "Преводът не отговаря. Опитайте пак." }, origin);
  }
  if (!res.ok) return json(502, { error: "Преводът не успя (" + res.status + ").", code: "upstream" }, origin);

  const data = await res.json().catch(() => null);
  const raw: string = (data?.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  let out: { en?: unknown; ru?: unknown } | null = null;
  try { out = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { out = null; }
  const ok = (a: unknown) => Array.isArray(a) && a.length === (texts as string[]).length && a.every((x) => typeof x === "string");
  if (!out || !ok(out.en) || !ok(out.ru)) return json(502, { error: "Преводът дойде в неочакван вид. Опитайте пак.", code: "format" }, origin);
  return json(200, { en: out.en, ru: out.ru }, origin);
});
