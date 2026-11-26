/**
 * Клиентският калкулator за сайта: klient.html
 *   node build-klient.mjs
 * Взима ценовия двигател от korekt-calculator.jsx (всичко до маркера END ENGINE) и
 * добавя интерфейса от klient.jsx — така цените са винаги еднакви с тези на кол-центъра.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const babel = require("@babel/core");

const raw = fs.readFileSync("korekt-calculator.jsx", "utf8");
const cut = raw.indexOf("/* ===== END ENGINE");
if (cut === -1) { console.error("ГРЕШКА: липсва маркер END ENGINE"); process.exit(1); }
const engine = raw.slice(0, cut).replace(/^import React.*$/m, "const { useState, useMemo, useEffect, useRef } = React;");
const ui = fs.readFileSync("klient.jsx", "utf8");

const compiled = babel.transformSync(engine + "\n" + ui, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  filename: "klient.jsx",
  generatorOpts: { jsescOption: { minimal: true } },
}).code;
const app = compiled + '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(KlientCalculator));';

const hash = (algo, data, enc = "base64") => crypto.createHash(algo).update(data).digest(enc);
let html = fs.readFileSync("klient.template.html", "utf8").replace("/*__APP__*/", () => app);
html = html.replace(/<script src="(vendor\/[^"]+)"><\/script>/g, (m, file) =>
  `<script src="${file}" integrity="sha384-${hash("sha384", fs.readFileSync(file))}"></script>`);
const inlineHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${hash("sha256", m[1])}'`);
const CSP = [
  "default-src 'none'",
  `script-src 'self' ${inlineHashes.join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src https://ncwiyhndgyssepaqyiss.supabase.co https://*.livekit.cloud wss://*.livekit.cloud",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");
html = html.replace("/*__CSP__*/", CSP);
fs.writeFileSync("klient.html", html);
console.log("Готово: klient.html (" + Math.round(html.length / 1024) + " KB)");
