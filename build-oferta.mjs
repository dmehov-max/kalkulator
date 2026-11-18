/**
 * Публичната страница на офертата за клиента: oferta.html  (отваря се като oferta.html?t=<токен>)
 *   node build-oferta.mjs
 * Взема oferta-template.html, махва вградените данни и ги зарежда при отваряне от базата
 * (функция public_offer по токен). Приемането и въпросите отиват през accept_offer / offer_message.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const tpl = fs.readFileSync("oferta-template.html", "utf8");
const admin = fs.readFileSync("oferti.html", "utf8");
const key = (admin.match(/const SB_KEY = "([^"]+)"/) || [])[1];
if (!key) { console.error("ГРЕШКА: не намерих SB_KEY в oferti.html"); process.exit(1); }

const foot = tpl.indexOf("</footer>");
const a = tpl.indexOf("<script>", foot), b = tpl.indexOf("</script>", a);
const inner = tpl.slice(a + 8, b);
const s0 = inner.indexOf("/*OFFER-START*/"), s1 = inner.indexOf("/*OFFER-END*/");
if (foot < 0 || a < 0 || s0 < 0 || s1 < 0) { console.error("ГРЕШКА: не намерих мястото на данните в шаблона"); process.exit(1); }
const main = "window.__startOffer = function (OFFER) {\n" + inner.slice(0, s0) + inner.slice(s1 + "/*OFFER-END*/".length) + "\n};";

const loader = `
(async function () {
  const SB = "https://ncwiyhndgyssepaqyiss.supabase.co", KEY = ${JSON.stringify(key)};
  const token = new URLSearchParams(location.search).get("t") || "";
  const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  const rpc = async (fn, body) => {
    const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST", headers: H, body: JSON.stringify(body) });
    const txt = await r.text();
    if (!r.ok) { let m = ""; try { m = JSON.parse(txt).message || ""; } catch (e) {} throw new Error(m || "HTTP " + r.status); }
    return txt ? JSON.parse(txt) : null;
  };
  const fail = (m) => { document.body.innerHTML = '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;text-align:center"><h2>' + m + '</h2><p>Обадете ни се на <a href="tel:070014485">0700 1 4485</a>.</p></div>'; };
  let res = null;
  try { res = /^[A-Za-z0-9]{24,64}$/.test(token) ? await rpc("public_offer", { p_token: token }) : null; } catch (e) { return fail("Офертата не може да се зареди в момента"); }
  if (!res || !res.offer) return fail("Офертата не е намерена или линкът е невалиден");
  window.KOREKT_LIVE = {
    accept: (data) => rpc("accept_offer", { p_token: token, p_data: data }),
    message: (kind, text) => rpc("offer_message", { p_token: token, p_kind: kind, p_text: text }),
  };
  res.offer.acceptedAt = res.acceptedAt || null;
  window.__startOffer(res.offer);
})();`;

const hash = (data) => "'sha256-" + crypto.createHash("sha256").update(data).digest("base64") + "'";
let html = tpl.slice(0, a) + "<script>" + main + "</script>\n<script>" + loader + "</script>" + tpl.slice(b + 9);
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => hash(m[1]));
const CSP = [
  "default-src 'none'",
  "script-src " + hashes.join(" "),
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src data:",
  "connect-src https://ncwiyhndgyssepaqyiss.supabase.co",
  "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join("; ");
const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="no-referrer">\n<meta name="robots" content="noindex, nofollow">\n`;
html = '<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head +
  '</head><body style="margin:0">\n' + html + "\n</body></html>";
fs.writeFileSync("oferta.html", html);
console.log("Готово: oferta.html (" + Math.round(html.length / 1024) + " KB)");
