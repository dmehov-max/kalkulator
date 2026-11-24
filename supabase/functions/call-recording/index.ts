// Supabase Edge Function — приема звуковия запис на разговор с гласовия асистент и го слага
// в частната кофа „calls“. Вика я само асистентът (заглавие x-agent-key — същият таен ключ,
// с който пише в базата). Записът се закача към калкулацията (data.audio) и се слуша само от
// влезли служители през „Записи“. Решение на Додо, 24.11.2026.
//
//   POST  /functions/v1/call-recording      заглавия: x-agent-key, x-calc-id      тяло: audio/ogg

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 25 * 1024 * 1024; // 15 мин разговор е няколко MB

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rpc(fn: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? await res.json() : null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "Само POST." });
  const agentKey = request.headers.get("x-agent-key") || "";
  const calcId = request.headers.get("x-calc-id") || "";
  if (!agentKey || !/^calc:voice-[A-Za-z0-9_.:-]{1,100}$/.test(calcId)) return json(400, { error: "Липсва ключ или номер на разговора." });

  const hash = await sha256hex(agentKey);
  // ключът е верен И записът на разговора съществува (иначе не качваме нищо)
  if ((await rpc("agent_audio_attach", { p_hash: hash, p_id: calcId, p_path: null, p_bytes: 0 })) !== true) {
    return json(403, { error: "Няма достъп или няма такъв запис." });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > MAX_BYTES) return json(400, { error: "Празен или твърде голям запис." });

  const path = calcId.replace(/[^A-Za-z0-9_.-]/g, "_") + ".ogg";
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/calls/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "audio/ogg", "x-upsert": "true" },
    body: bytes,
  });
  if (!up.ok) return json(502, { error: `Качването не успя (${up.status}).` });

  const ok = await rpc("agent_audio_attach", { p_hash: hash, p_id: calcId, p_path: path, p_bytes: bytes.length });
  return ok === true ? json(200, { ok: true, path, bytes: bytes.length }) : json(500, { error: "Записът е качен, но не се закачи към калкулацията." });
});
