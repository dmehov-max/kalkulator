/**
 * Тестове за сигурност на калкулатора.
 *
 *   node security.test.mjs          — проверки на кода и компилирания сайт (без мрежа)
 *   node security.test.mjs --live   — плюс атака „отвън“ срещу живата база и сайта
 *                                     само с публичния ключ (това, което има всеки хакер)
 *
 * Живите проверки само четат или опитват забранени неща, които базата трябва да откаже.
 * Единственото, което може да остави следа, е опит за регистрация с чужд домейн —
 * ако защитата липсва, ще се появи неподтвърден акаунт *@example.com (тестът го казва).
 *
 * Правата вътре в базата (служител / администратор / спрян акаунт) се проверяват от
 * supabase/tests/rls_security_test.sql — пуска се в Supabase → SQL Editor.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const LIVE = process.argv.includes("--live");
const SITE = "https://dmehov-max.github.io/kalkulator/"; // единственият адрес (Netlify вече не се ползва)
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const jsx = fs.readFileSync("korekt-calculator.jsx", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const SB_URL = jsx.match(/supabaseUrl: "([^"]+)"/)[1];
const SB_KEY = jsx.match(/supabaseKey: "([^"]+)"/)[1];
const anon = (extra) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...extra });
const hash = (algo, data, enc = "base64") => crypto.createHash(algo).update(data).digest(enc);

/* ---------- 1. Код и компилиран сайт ---------- */

await test("публичният ключ в кода е anon (не service_role) и няма други тайни", () => {
  const payload = JSON.parse(Buffer.from(SB_KEY.split(".")[1], "base64url").toString());
  ok(payload.role === "anon", "ключът в кода е с роля " + payload.role);
  const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter((f) => f && !f.startsWith("vendor/") && fs.existsSync(f));
  const bad = [];
  for (const f of tracked) {
    const txt = fs.readFileSync(f, "utf8");
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(txt)) bad.push(f + ": sb_secret_ ключ");
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(txt)) bad.push(f + ": частен ключ");
    if (/AIza[0-9A-Za-z_-]{35}/.test(txt)) bad.push(f + ": Google API ключ");
    for (const jwt of txt.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []) {
      try { const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()); if (p.role && p.role !== "anon") bad.push(`${f}: JWT с роля ${p.role}`); } catch {}
    }
  }
  ok(!bad.length, "намерени тайни: " + bad.join("; "));
});

await test("сайтът зарежда JavaScript само от собствения адрес (vendor/), всеки файл с SRI", () => {
  const srcs = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((a) => /src=/.test(a));
  ok(srcs.length >= 3, "очаквани поне 3 външни скрипта, има " + srcs.length);
  for (const a of srcs) {
    const src = a.match(/src="([^"]+)"/)[1];
    ok(src.startsWith("vendor/"), "скрипт извън vendor/: " + src);
    const integ = (a.match(/integrity="sha384-([^"]+)"/) || [])[1];
    ok(integ === hash("sha384", fs.readFileSync(src)), "грешен/липсващ integrity за " + src);
  }
  ok(!/cdn\.jsdelivr|unpkg\.com|cdn\.tailwindcss/.test(jsx + html), "останала връзка към чужд CDN");
});

await test("библиотеките във vendor/ съвпадат с проверените SHA-256", () => {
  const sums = JSON.parse(fs.readFileSync("vendor/checksums.json", "utf8"));
  for (const [f, want] of Object.entries(sums)) ok(hash("sha256", fs.readFileSync("vendor/" + f), "hex") === want, "променен vendor/" + f);
});

await test("CSP: строга политика, вградените скриптове са разрешени само по хеш", () => {
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  ok(csp, "липсва Content-Security-Policy");
  const dir = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  ok(dir["default-src"]?.join(" ") === "'none'", "default-src не е 'none'");
  for (const k of ["object-src", "base-uri"]) ok(dir[k]?.join(" ") === "'none'", k + " не е 'none'");
  const sp = dir["script-src"] || [];
  ok(!sp.includes("'unsafe-inline'") && !sp.includes("'unsafe-eval'") && !sp.includes("*") && !sp.some((s) => s.startsWith("http")), "script-src е разхлабен: " + sp.join(" "));
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${hash("sha256", m[1])}'`);
  for (const h of inline) ok(sp.includes(h), "вграден скрипт без хеш в CSP (страницата няма да тръгне)");
  ok(sp.length === inline.length + 1, "в script-src има излишни източници");
  ok(!(dir["connect-src"] || []).some((s) => s === "*" || s === "https:" || s === "data:"), "connect-src позволява произволни адреси");
});

await test("защита от вграждане в чужд сайт (clickjacking)", () => {
  ok(/window\.top !== window\.self/.test(html), "липсва frame-buster");
});

await test("адресът на базата не идва от запазени параметри; полетата са махнати от екрана", () => {
  ok(/supabaseUrl: d\.supabaseUrl,\s*supabaseKey: d\.supabaseKey,/.test(jsx), "mergeParams не фиксира supabaseUrl/supabaseKey");
  ok(!/upd\(\{ supabaseUrl/.test(jsx) && !/upd\(\{ supabaseKey/.test(jsx), "в Параметри още може да се смени адресът/ключът на базата");
});

await test("всички заявки към таблиците минават със сесията (authHeaders), не с анонимния ключ", () => {
  const rest = [...jsx.matchAll(/fetch\(`\$\{(?:url|p\.supabaseUrl)\}\/rest\/v1\/([a-z_]+)[^`]*`,\s*\{?\s*(?:[\s\S]{0,200}?)headers: (\w+)\(/g)];
  ok(rest.length >= 6, "намерени само " + rest.length + " заявки — променен ли е кодът?");
  const anonCalls = rest.filter((m) => m[2] !== "authHeaders").map((m) => m[1]);
  ok(!anonCalls.length, "заявки с анонимния ключ към: " + anonCalls.join(", "));
});

await test("регистрацията в екрана е само за @korekt-bg.com", () => {
  ok(/SIGNUP_ALLOWED_DOMAIN = "korekt-bg\.com"/.test(jsx), "липсва ограничението по домейн");
});

await test("сървърните функции проверяват самоличността и домейна сървърно", () => {
  for (const f of ["supabase/functions/admin-users/index.ts", "supabase/functions/livekit-token/index.ts"]) {
    const src = fs.readFileSync(f, "utf8");
    ok(/\/auth\/v1\/user/.test(src), f + ": не проверява токена срещу Supabase");
    ok(/korekt-bg\\\.com/.test(src), f + ": не проверява служебния домейн");
    ok(!/SERVICE_ROLE_KEY"\)\s*\|\|\s*"/.test(src), f + ": service_role ключ с твърда стойност");
  }
  ok(!fs.existsSync("netlify/functions/admin-users.mjs") && !fs.existsSync("netlify.toml"), "Netlify файловете още са в проекта");
  for (const f of ["supabase/functions/admin-users/index.ts", "supabase/functions/livekit-token/index.ts"])
    ok(!/netlify\.app/.test(fs.readFileSync(f, "utf8")), f + ": CORS още пуска Netlify адреса");
});

await test("миграцията заключва всички таблици и регистрацията", () => {
  const sql = fs.readdirSync("supabase/migrations").sort().map((f) => fs.readFileSync("supabase/migrations/" + f, "utf8")).join("\n");
  for (const t of ["calc_params", "catalog_items", "calculations", "offers"]) ok(new RegExp(`revoke all on table public\\.${t} from anon`).test(sql), "anon не е отрязан от " + t);
  ok(/before insert on auth\.users/.test(sql), "липсва trigger срещу чужди домейни при регистрация");
  ok(!/to anon[^;]*\bselect\b/i.test(sql.split("20261108_harden_security")[1] || ""), "има select за anon");
});

/* ---------- 2. Атака отвън срещу живата система (--live) ---------- */

if (LIVE) {
  const get = (path) => fetch(SB_URL + path, { headers: anon() });

  for (const t of ["calc_params", "catalog_items", "calculations", "offers"]) {
    await test(`отвън: таблица ${t} не се чете с публичния ключ`, async () => {
      const r = await get(`/rest/v1/${t}?select=*&limit=1`);
      const body = await r.text();
      ok(r.status === 401 || r.status === 403 || (r.ok && body.trim() === "[]"), `HTTP ${r.status}: ${body.slice(0, 120)}`);
      ok(!r.ok, `HTTP ${r.status} — таблицата е отворена за anon (дори празна, трябва да е отказ)`);
    });
    await test(`отвън: в ${t} не може да се пише`, async () => {
      const r = await fetch(`${SB_URL}/rest/v1/${t}`, {
        method: "POST", headers: anon({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({ id: "security-test-should-fail" }),
      });
      ok(r.status === 401 || r.status === 403, `HTTP ${r.status} — записът не беше отказан`);
    });
  }

  await test("отвън: регистрация с чужд домейн се отказва", async () => {
    const r = await fetch(`${SB_URL}/auth/v1/signup`, {
      method: "POST", headers: anon({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email: `security-probe-${Date.now()}@example.com`, password: crypto.randomBytes(18).toString("base64url") + "aA1!" }),
    });
    ok(!r.ok, `HTTP ${r.status} — регистрацията МИНА (в базата има нов неподтвърден *@example.com акаунт — изтрий го)`);
  });

  await test("отвън: гласовият запис не презаписва обикновени калкулации", async () => {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/save_voice_calc`, {
      method: "POST", headers: anon({ "Content-Type": "application/json" }),
      body: JSON.stringify({ p_id: "calc:1", p_status: "калкулация", p_data: {} }),
    });
    ok(!r.ok, `HTTP ${r.status} — приеха се чужди id`);
  });

  await test("отвън: цените за гласовия асистент са без себестойност и ключове", async () => {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/voice_pricing`, { method: "POST", headers: anon({ "Content-Type": "application/json" }), body: "{}" });
    ok(r.ok, `HTTP ${r.status}`);
    const v = await r.json();
    for (const k of ["mapsApiKey", "supabaseKey", "supabaseUrl", "workerCostDefault", "workerCostByCity", "truckCostPerHour", "truckCostPerKm"]) ok(!(k in (v || {})), "изтича поле " + k);
  });

  for (const fn of ["admin-users", "livekit-token"]) {
    await test(`отвън: функция ${fn} отказва без вход`, async () => {
      const r = await fetch(`${SB_URL}/functions/v1/${fn}`, { method: "POST", headers: anon({ "Content-Type": "application/json" }), body: "{}" });
      ok(r.status === 401 || r.status === 403, `HTTP ${r.status}`);
    });
  }

  await test("отвън: функциите не пускат заявки от чужд сайт (CORS)", async () => {
    const r = await fetch(`${SB_URL}/functions/v1/admin-users`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    ok(r.headers.get("access-control-allow-origin") !== "https://evil.example" && r.headers.get("access-control-allow-origin") !== "*", "CORS пуска " + r.headers.get("access-control-allow-origin"));
  });

  await test("отвън: схемата на базата (OpenAPI) не е достъпна с публичния ключ", async () => {
    const r = await get("/rest/v1/");
    const body = await r.text();
    ok(!/"\/calculations"|"\/calc_params"/.test(body), "OpenAPI изрежда таблиците");
  });

  await test("отвън: живият сайт е новата защитена версия (CSP + без CDN)", async () => {
    const r = await fetch(SITE, { cache: "no-store" });
    const live = await r.text();
    ok(/Content-Security-Policy/.test(live), "живият сайт няма CSP — още не е качена новата версия?");
    ok(!/unpkg\.com|cdn\.tailwindcss\.com/.test(live), "живият сайт още тегли от чужд CDN");
    ok(r.url.startsWith("https://"), "сайтът не е по HTTPS");
  });
}

/* ---------- Резултат ---------- */
const failed = results.filter((r) => !r.ok);
console.log(`\n  Сигурност${LIVE ? " (с атака отвън)" : ""}: ${results.length - failed.length} успешни, ${failed.length} неуспешни (общо ${results.length})\n`);
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : "\n      → " + r.err}`);
if (failed.length) { console.log("\n  ✗ ИМА ДУПКИ\n"); process.exit(1); }
console.log("\n  ✓ Всичко минава\n");
