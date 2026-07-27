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
const html = template.replace(PLACEHOLDER, app);

fs.writeFileSync("korekt-calculator.html", html);
fs.writeFileSync("index.html", html);

// проверка, че наистина е новата версия
const marks = ["кг/бр", "Клиентът разтоварва сам", "Започнете да пишете", "цена по километри", "обоснована промяна", "Изхвърляне на отпадък", "велпапе"];
const missing = marks.filter((m) => !html.includes(m));
console.log("Готово: korekt-calculator.html (" + Math.round(html.length / 1024) + " KB)");
if (missing.length) { console.error("ВНИМАНИЕ: липсват маркери →", missing.join(", ")); process.exit(1); }
console.log("Проверка на маркерите: наред ✓");
