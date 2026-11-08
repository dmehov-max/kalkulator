/**
 * Компилира korekt-calculator.jsx до самостоятелен korekt-calculator.html.
 *
 *   npm i @babel/core @babel/preset-react
 *   node build.mjs
 *
 * Шаблонът korekt-calculator.template.html съдържа стиловете, библиотеките
 * и хранилището; компилираният код се вмъква на мястото на /*__APP__*\/.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const babel = require("@babel/core");

const PLACEHOLDER = "/*__APP__*/";

let src = fs.readFileSync("korekt-calculator.jsx", "utf8");
src = src.replace(/^import React.*$/m, "const { useState, useMemo, useEffect, useRef } = React;");
src = src.replace("export default function KorektCalculator", "function KorektCalculator");

const compiled = babel.transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  filename: "korekt-calculator.jsx",
  generatorOpts: { jsescOption: { minimal: true } }, // запазва кирилицата четима
}).code;

const template = fs.readFileSync("korekt-calculator.template.html", "utf8");
if (!template.includes(PLACEHOLDER)) {
  console.error("ГРЕШКА: липсва " + PLACEHOLDER + " в шаблона");
  process.exit(1);
}

const app = compiled + '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(KorektCalculator));';
let html = template.replace(PLACEHOLDER, app);

// --- Сигурност ---
// 1) библиотеките във vendor/ трябва да са точно проверените копия (виж vendor/README.md)
const hash = (algo, data, enc = "base64") => crypto.createHash(algo).update(data).digest(enc);
const checksums = JSON.parse(fs.readFileSync("vendor/checksums.json", "utf8"));
for (const [file, want] of Object.entries(checksums)) {
  const got = hash("sha256", fs.readFileSync("vendor/" + file), "hex");
  if (got !== want) { console.error(`ГРЕШКА: vendor/${file} е променен (SHA-256 ${got}, очакван ${want})`); process.exit(1); }
}
// 2) външни скриптове само от vendor/, всеки с integrity (SRI) — браузърът отказва променен файл
if (/<script[^>]+src="(?!vendor\/)/i.test(html)) { console.error("ГРЕШКА: <script src> извън vendor/ — сложи библиотеката там"); process.exit(1); }
html = html.replace(/<script src="(vendor\/[^"]+)"><\/script>/g, (m, file) =>
  `<script src="${file}" integrity="sha384-${hash("sha384", fs.readFileSync(file))}"></script>`);
// 3) Content-Security-Policy: тръгва само кодът от този сайт и точно тези вградени скриптове
// (по хеш) — инжектиран скрипт не се изпълнява, а данни не могат да изтекат към адрес извън connect-src
const inlineHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${hash("sha256", m[1])}'`);
const CSP = [
  "default-src 'none'",
  `script-src 'self' ${inlineHashes.join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' https://ncwiyhndgyssepaqyiss.supabase.co wss://ncwiyhndgyssepaqyiss.supabase.co https://routes.googleapis.com https://*.livekit.cloud wss://*.livekit.cloud ws://localhost:7880 ws://127.0.0.1:7880",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
if (!html.includes("/*__CSP__*/")) { console.error("ГРЕШКА: липсва /*__CSP__*/ в шаблона"); process.exit(1); }
html = html.replace("/*__CSP__*/", CSP);

fs.writeFileSync("korekt-calculator.html", html);
fs.writeFileSync("index.html", html);

// проверка, че наистина е новата версия
const marks = ["кг/бр", "Клиентът разтоварва сам", "Започнете да пишете", "цена по километри", "обоснована промяна", "Изхвърляне на отпадък", "велпапе"];
const missing = marks.filter((m) => !html.includes(m));
console.log("Готово: korekt-calculator.html (" + Math.round(html.length / 1024) + " KB)");
if (missing.length) { console.error("ВНИМАНИЕ: липсват маркери →", missing.join(", ")); process.exit(1); }
console.log("Проверка на маркерите: наред ✓");
