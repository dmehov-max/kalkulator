/**
 * Тестове за ценовия двигател на калкулатора КОРЕКТ.
 *
 * Стартиране:   node korekt-calculator.test.mjs
 *
 * Как работи: изрязва чистата логика от korekt-calculator.jsx (всичко до
 * маркера "END ENGINE"), зарежда я като модул и проверява правилата.
 * Така тестовете винаги вървят срещу истинския код, а не срещу копие.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "korekt-calculator.jsx");

/* ---------- 1. Изрязване на двигателя ---------- */
const raw = fs.readFileSync(SRC, "utf8");
const cut = raw.indexOf("/* ===== END ENGINE");
if (cut === -1) throw new Error("Липсва маркер END ENGINE в korekt-calculator.jsx");

const engineSrc =
  raw.slice(0, cut).replace(/^import React.*$/m, "") +
  `\nexport { DEFAULTS, CATALOG, ITEM_INDEX, totalVolume, countKind, NEIGHBORHOODS,
  haversineKm, normHood, findHood, cityCenter, estimateKm, crewFor, ownTruck,
  fleetFor, tripsFor, bestTruck, computePrice, totalWeight, findCity, BASES, nearestBase, baseOnRoute, mergeParams, buildRecord, toCSV, disHoursFor, wrapMetersFor, CITIES, estimateKmAny, pointFor,
  saveCalc, loadCalcs, saveParams, loadParams, CALC_PREFIX, PARAMS_KEY, fetchParamsFromSheet, pushParamsToSheet,
  storageSet, storageGet, storageList, getStorageMode, hasStorage };\n`;

const tmp = path.join(os.tmpdir(), `korekt-engine-${Date.now()}.mjs`);
fs.writeFileSync(tmp, engineSrc);

/* ---------- 2. Фалшиво хранилище (за тестове на записа) ---------- */
const store = new Map();
globalThis.window = {
  storage: {
    async get(key, shared) {
      const k = `${shared}:${key}`;
      if (!store.has(k)) throw new Error("not found");
      return { key, value: store.get(k), shared };
    },
    async set(key, value, shared) {
      store.set(`${shared}:${key}`, value);
      return { key, value, shared };
    },
    async list(prefix, shared) {
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(`${shared}:`))
        .map((k) => k.slice(String(shared).length + 1))
        .filter((k) => k.startsWith(prefix || ""));
      return { keys, prefix, shared };
    },
    async delete(key, shared) { store.delete(`${shared}:${key}`); return { key, deleted: true, shared }; },
  },
};

const E = await import(pathToFileURL(tmp).href);
const P = structuredClone(E.DEFAULTS);

/* ---------- 3. Мини тестова рамка ---------- */
let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { failed++; fails.push(`${name}\n     → ${err.message}`); }
}
function eq(actual, expected, msg = "") {
  if (actual !== expected) throw new Error(`${msg} очаквано ${expected}, получено ${actual}`);
}
function near(actual, expected, tol = 0.5, msg = "") {
  if (Math.abs(actual - expected) > tol) throw new Error(`${msg} очаквано ≈${expected}, получено ${actual}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "условието не е изпълнено"); }

/* ---------- 4. Помощни за сглобяване на поръчка ---------- */
const addr = (floor = 0, elevator = false, elevatorType = "passenger") => ({ building: "Апартамент", floor, elevator, elevatorType });
const order = (o = {}) => ({
  service: "local", city: "София", country: "", km: 0, localKm: 0,
  pickupHood: "Център", dropoffHood: "Младост", pickupCity: "София", dropoffCity: "Пловдив", truckId: null, qty: {},
  pickup: addr(), dropoff: addr(),
  dis: {}, asm: {}, wrap: {},
  extras: { packing: false, materials: false, disassembly: false },
  name: "", phone: "", email: "", ...o,
});
const calc = (o, params = P) => E.computePrice(order(o), params);

/* =========================== ТЕСТОВЕ =========================== */

/* --- Кубатура и каталог --- */
test("кубатура: сумира правилно по брой", () => {
  eq(E.totalVolume({ boxM: 10, sofa3: 1 }), 3);
});
test("каталог: всяка вещ има положителна кубатура", () => {
  for (const g of E.CATALOG) for (const it of g.items) ok(it.m3 > 0, `${it.label} без кубатура`);
});
test("каталог: няма повтарящи се id", () => {
  const ids = E.CATALOG.flatMap((g) => g.items.map((i) => i.id));
  eq(new Set(ids).size, ids.length, "дублирани id:");
});

/* --- Курсове --- */
test("курсове: 15 м³ при 13.6 м³/курс = 2 курса", () => {
  eq(E.tripsFor(15, E.ownTruck(P).cap), 2);
});
test("курсове: празна поръчка = 0 курса", () => eq(E.tripsFor(0, 13.6), 0));
test("вместимост: 4×2×2 × 0.85 = 13.6 м³", () => near(E.ownTruck(P).cap, 13.6, 0.01));

/* --- Бригада --- */
test("бригада: ≤8 м³ → 2 души", () => eq(E.crewFor(5, P), 2));
test("бригада: ≤22 м³ → 3 души", () => eq(E.crewFor(15, P), 3));
test("бригада: >22 м³ → 4 души", () => eq(E.crewFor(30, P), 4));
test("протокол: двуврат хладилник изисква 4 души дори при малък обем", () => {
  const r = calc({ qty: { fridgeSxS: 1 } });
  eq(r.crew, 4);
  ok(r.crewByProtocol, "флагът за протокол не е вдигнат");
});

/* --- Градско ценообразуване --- */
test("градско: минимум 2 часа при съвсем малка поръчка", () => {
  const r = calc({ qty: { boxM: 2 }, pickupHood: "Център", dropoffHood: "Център" });
  near(r.clockHours, 2, 0.01, "часове:");
});
test("градско: пренасянето = часове × бригада × ставка", () => {
  const r = calc({ qty: { boxM: 2 }, pickupHood: "Център", dropoffHood: "Център" });
  const labor = r.lines.find((l) => l.label.startsWith("Пренасяне"));
  eq(labor.amount, Math.round(2 * r.crew * P.workerRate));
});
test("градско: транспортът се таксува само за пренасянето и пътя", () => {
  const r = calc({ qty: { sofa3: 1, boxM: 20 } });
  const tr = r.lines.find((l) => l.label.startsWith("Транспорт"));
  eq(tr.amount, Math.round(r.handlingClock * P.truckRate));
});
test("транспортът НЕ се таксува през часовете за разглобяване", () => {
  const без = calc({ qty: { wardrobe3: 1 } });
  const с = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  const tr = (r) => r.lines.find((l) => l.label.startsWith("Транспорт")).amount;
  eq(tr(с), tr(без), "транспортът трябва да е еднакъв:");
  ok(с.clockHours > без.clockHours, "престоят все пак е по-дълъг");
});
test("градско: пренасянето е поне 2 часа дори при една мебел", () => {
  const r = calc({ qty: { wardrobe3: 1 } });
  near(r.handlingClock, 2, 0.01, "часове пренасяне:");
});
test("градско: разстоянието е ЕДНОПОСОЧНО (не се удвоява)", () => {
  const r = calc({ qty: { boxM: 30 } });
  eq(r.totalKm, r.trips * r.oneWayKm, "трябва курсове × еднопосочно");
});
test("градско: работниците се плащат и за времето за път", () => {
  const near5 = calc({ qty: { boxM: 60 }, pickupHood: "Център", dropoffHood: "Лозенец" });
  const far = calc({ qty: { boxM: 60 }, pickupHood: "Банкя", dropoffHood: "Младост" });
  ok(far.clockHours > near5.clockHours, "по-дългият път трябва да дава повече часове");
  ok(far.total > near5.total, "по-дългият път трябва да струва повече");
});

/* --- Курс над 50 км --- */
test("праг: под 50 км НЕ е курс (почасово)", () => {
  const r = calc({ pickupHood: "Център", dropoffHood: "Елин Пелин", qty: { boxM: 50 } });
  ok(r.oneWayKm < 50, `очаквано <50 км, получено ${r.oneWayKm}`);
  eq(r.isCourse, false);
});
test("праг: над 50 км автоматично става курс (километрично)", () => {
  const r = calc({ pickupHood: "Център", dropoffHood: "Самоков", qty: { boxM: 50 } });
  ok(r.oneWayKm >= 50, `очаквано ≥50 км, получено ${r.oneWayKm}`);
  eq(r.isCourse, true);
});
test("курс: разстоянието е ДВУПОСОЧНО", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { boxM: 50 } });
  eq(r.totalKm, r.trips * 2 * r.oneWayKm);
});
test("курс: труд = (товарене + разтоварване) × бригада, с минимум на бригада", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { boxM: 100 } });
  const товарене = Math.max(P.loadHours * r.trips, P.minCrewHours);
  const разтоварване = Math.max(P.unloadHours * r.trips, P.minCrewHours);
  near(r.manHours, (товарене + разтоварване) * r.crew, 0.01);
});
test("курс: транспорт = общ пробег × €/км на камиона", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { boxM: 50 } });
  const tr = r.lines.find((l) => l.label.startsWith("Транспорт"));
  eq(tr.amount, Math.round(r.totalKm * r.chosen.kmRate));
});


/* --- Разстояния из цялата страна --- */
test("страна: разстоянието се смята между кои да е два града", () => {
  const km = E.estimateKmAny("Пловдив", "", "Варна", "", 1.25);
  ok(km > 300 && km < 450, `Пловдив→Варна = ${km} км изглежда сгрешено`);
});
test("страна: не е софия-центрично — Бургас→Варна е кратко", () => {
  const bv = E.estimateKmAny("Бургас", "", "Варна", "", 1.25);
  const bs = E.estimateKmAny("Бургас", "", "София", "", 1.25);
  ok(bv < 200, `Бургас→Варна = ${bv} км`);
  ok(bs > bv, "Бургас→София трябва да е по-далече от Бургас→Варна");
});
test("страна: посоката не променя разстоянието", () => {
  eq(E.estimateKmAny("Русе", "", "Стара Загора", "", 1.25), E.estimateKmAny("Стара Загора", "", "Русе", "", 1.25));
});
test("страна: близки градове минават на почасова тарифа", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Перник", qty: { boxM: 20 } });
  ok(r.oneWayKm < P.intercityThresholdKm, `${r.oneWayKm} км трябва да е под прага`);
  eq(r.isCourse, false, "под 50 км не е курс:");
});
test("страна: далечни градове са курс с двупосочен пробег", () => {
  const r = calc({ service: "intercity", pickupCity: "Варна", dropoffCity: "Благоевград", qty: { boxM: 20 } });
  ok(r.oneWayKm > 400, `${r.oneWayKm} км`);
  eq(r.isCourse, true);
  eq(r.totalKm, r.trips * 2 * r.oneWayKm);
});
test("страна: междуградското се смята от център до център, без квартали", () => {
  const r1 = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", pickupHood: "Банкя", qty: { boxM: 20 } });
  const r2 = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", pickupHood: "", qty: { boxM: 20 } });
  eq(r1.oneWayKm, r2.oneWayKm, "кварталът не бива да променя междуградското разстояние:");
  eq(r1.oneWayKm, E.estimateKmAny("София", "", "Пловдив", "", P.roadFactorBG));
});
test("страна: всички градове имат валидни координати", () => {
  for (const [name, c] of Object.entries(E.CITIES))
    ok(c.lat > 41 && c.lat < 44.3 && c.lng > 22 && c.lng < 28.7, `${name} с невалидни координати`);
});
test("страна: непознат град не чупи изчислението", () => {
  eq(E.estimateKmAny("Няма такъв", "", "София", "", 1.25), null);
});
test("страна: разстоянията са близо до реалните", () => {
  const проверки = [["София", "Пловдив", 150], ["София", "Варна", 470], ["София", "Бургас", 385], ["Варна", "Бургас", 125]];
  for (const [a, b, реално] of проверки) {
    const км = E.estimateKmAny(a, "", b, "", 1.25);
    ok(Math.abs(км - реално) / реално < 0.25, `${a}→${b}: ${км} км срещу реални ${реално} км`);
  }
});


/* --- Пътуваща бригада при дълъг курс --- */
const дълъг = (extra = {}) => calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол",
  qty: { sofa3: 1, boxL: 10, mattress: 1 }, ...extra });

test("курс: товаренето И разтоварването се виждат като отделни пера", () => {
  const r = дълъг();
  ok(r.lines.some((l) => l.label.startsWith("Товарене")), "липсва перо за товарене");
  ok(r.lines.some((l) => l.label.startsWith("Разтоварване")), "липсва перо за разтоварване");
});
test("курс: разтоварването се плаща толкова, колкото товаренето", () => {
  const r = дълъг();
  const т = r.lines.find((l) => l.label.startsWith("Товарене")).amount;
  const рт = r.lines.find((l) => l.label.startsWith("Разтоварване")).amount;
  eq(т, рт);
});
test("пътуваща бригада: плаща се на ден, не на час", () => {
  const r = дълъг({ courseMode: "dayCrew" });
  ok(r.dayCrewMode, "режимът не е активен");
  const line = r.lines.find((l) => l.label.startsWith("Придружаващ"));
  ok(line, "липсва перо за придружаващия работник");
  eq(line.amount, r.travelDays * P.travelCrew * P.workerDayRate);
  ok(!r.lines.some((l) => l.label.startsWith("Товарене")), "не бива да има и почасови пера");
});
test("пътуваща бригада: дълъг път дава повече от един ден", () => {
  const r = дълъг({ courseMode: "dayCrew" });
  ok(r.driveHours > 10, `пътят е ${r.driveHours.toFixed(1)} ч`);
  ok(r.travelDays >= 2, `очаквани поне 2 дни, получени ${r.travelDays}`);
});
test("пътуваща бригада: близък курс е един ден", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", courseMode: "dayCrew", qty: { boxL: 10 } });
  eq(r.travelDays, 1);
});
test("пътуваща бригада: излиза по-скъпо от почасовото при дълъг курс", () => {
  ok(дълъг({ courseMode: "dayCrew" }).total > дълъг().total, "дневната ставка трябва да покрива целия ден");
});
test("пътуваща бригада: режимът важи само за курс, не за градско", () => {
  const r = calc({ qty: { boxM: 20 }, courseMode: "dayCrew" });
  eq(r.dayCrewMode, false, "градското не бива да минава на дневна ставка:");
  ok(r.lines.some((l) => l.label.startsWith("Пренасяне")), "градското си остава почасово");
});
test("запис: пази избраната организация на курса", () => {
  const o = order({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол", courseMode: "dayCrew", qty: { boxL: 10 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:x");
  eq(rec.courseMode, "пътуваща бригада");
  ok(rec.travelDays >= 1);
});



test("въвеждане на град: разпознава непълно име", () => {
  eq(E.findCity("созо"), "Созопол");
  eq(E.findCity("вел"), "Велико Търново");
  eq(E.findCity("благо"), "Благоевград");
});
test("въвеждане на град: не зависи от главни букви и интервали", () => {
  eq(E.findCity("  СОЗОПОЛ "), "Созопол");
});
test("въвеждане на град: непознато име връща нищо", () => {
  eq(E.findCity("Няма такъв град"), null);
  eq(E.findCity(""), null);
});
test("въвеждане на град: непълното име дава същото разстояние", () => {
  const пълно = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол", qty: { boxL: 10 } });
  const непълно = calc({ service: "intercity", pickupCity: "софи", dropoffCity: "созо", qty: { boxL: 10 } });
  eq(непълно.oneWayKm, пълно.oneWayKm);
});

/* --- Вариант 2: местен екип разтоварва --- */
test("бази: екипи има точно в шестте града", () => {
  eq(E.BASES.length, 6);
  for (const b of ["София", "Пловдив", "Варна", "Бургас", "Русе", "Велико Търново"])
    ok(E.BASES.includes(b), `липсва база ${b}`);
});
test("бази: избира се най-близката до адреса на разтоварване", () => {
  eq(E.nearestBase("Созопол", 1.25).city, "Бургас");
  eq(E.nearestBase("Банско", 1.25).city, "София");
  eq(E.nearestBase("Балчик", 1.25).city, "Варна");
});
test("местен екип: плаща се пътят от базата и обратно плюс работата", () => {
  const r = дълъг({ courseMode: "localCrew" });
  eq(r.baseCity, "Бургас");
  const line = r.lines.find((l) => l.label.startsWith("Местна бригада"));
  ok(line, "липсва перо за местната бригада");
  const път = (2 * r.baseKm) / P.roadSpeed;
  const работа = Math.max(P.unloadHours * r.trips, P.localCrewMinHours);
  eq(line.amount, Math.round((път + работа) * P.localCrewSize * P.workerRate));
});
test("местен екип: работата е минимум 2 часа, дори да е по-малко", () => {
  const r = дълъг({ courseMode: "localCrew" });
  ok(P.unloadHours < P.localCrewMinHours, "тестът има смисъл само ако разтоварването е под минимума");
  const line = r.lines.find((l) => l.label.startsWith("Местна бригада"));
  ok(line.label.includes(`${P.localCrewMinHours.toFixed(1)} ч работа`), `перото показва: ${line.label}`);
});
test("местен екип: при голяма поръчка се плаща реалното време, не минимумът", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол",
    courseMode: "localCrew", truckId: "own", qty: { boxL: 400 } });
  ok(r.trips >= 3, `курсовете са ${r.trips}`);
  const line = r.lines.find((l) => l.label.startsWith("Местна бригада"));
  ok(line.label.includes(`${(P.unloadHours * r.trips).toFixed(1)} ч работа`), `перото показва: ${line.label}`);
});
test("местен екип: товаренето при клиента се плаща отделно", () => {
  const r = дълъг({ courseMode: "localCrew" });
  ok(r.lines.some((l) => l.label.startsWith("Товарене (София)")), "липсва перо за товарене");
});
test("маршрут: Бургас е по пътя за Созопол — без кола", () => {
  ok(E.baseOnRoute("София", "Бургас", "Созопол", 1.25, 1.1), "Бургас трябва да е на маршрута");
  const r = дълъг({ courseMode: "localCrew" });
  ok(!r.lines.some((l) => l.label.startsWith("Кола")), "не бива да има кола");
});
test("маршрут: база извън пътя добавя кола по 0.30 €/км", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол",
    courseMode: "localCrew", baseCity: "Варна", qty: { boxL: 10 } });
  eq(r.baseIsOnRoute, false, "Варна не е на пътя София→Созопол:");
  const line = r.lines.find((l) => l.label.startsWith("Кола"));
  ok(line, "липсва перо за кола");
  near(line.amount, 2 * r.baseKm * P.carRatePerKm, 0.05);
});
test("местен екип: базата може да се избере ръчно", () => {
  const r = дълъг({ courseMode: "localCrew", baseCity: "Пловдив" });
  eq(r.baseCity, "Пловдив");
});


test("кола: по маршрута екипът се качва на камиона — без перо за кола", () => {
  const r = дълъг({ courseMode: "localCrew" });
  ok(r.baseIsOnRoute, "Бургас е на маршрута");
  eq(r.needCar, false);
  ok(!r.lines.some((l) => l.label.startsWith("Кола")), "не бива да има кола");
});
test("кола: може да се поиска изрично дори по маршрута", () => {
  const r = дълъг({ courseMode: "localCrew", forceCar: true });
  eq(r.needCar, true);
  const line = r.lines.find((l) => l.label.startsWith("Кола"));
  ok(line, "липсва перо за кола");
  near(line.amount, 2 * r.baseKm * P.carRatePerKm, 0.05);
});
test("кола: перото показва откъде и докъде", () => {
  const r = дълъг({ courseMode: "localCrew", forceCar: true });
  const line = r.lines.find((l) => l.label.startsWith("Кола"));
  ok(line.label.includes("Бургас") && line.label.includes("Созопол"), `перото е: ${line.label}`);
});


/* --- Клиентът разтоварва сам --- */
test("сам: не се плаща разтоварване", () => {
  const r = дълъг({ courseMode: "selfUnload" });
  ok(r.selfUnloadMode, "режимът не е активен");
  ok(!r.lines.some((l) => l.label.startsWith("Разтоварване")), "не бива да има разтоварване");
  ok(r.lines.some((l) => l.label.startsWith("Товарене")), "товаренето остава");
});
test("сам: излиза по-евтино от почасовото", () => {
  ok(дълъг({ courseMode: "selfUnload" }).total < дълъг().total);
});
test("сам: стълбите на адреса на доставка не се таксуват", () => {
  const с_етаж = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол",
    courseMode: "selfUnload", qty: { boxL: 10 }, dropoff: addr(4, false) });
  const без_етаж = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол",
    courseMode: "selfUnload", qty: { boxL: 10 } });
  eq(с_етаж.total, без_етаж.total, "етажът при клиента не бива да оскъпява:");
});
test("сам: стълбите при товарене СЕ таксуват", () => {
  const с_етаж = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол",
    courseMode: "selfUnload", qty: { boxL: 10 }, pickup: addr(4, false) });
  const без = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол",
    courseMode: "selfUnload", qty: { boxL: 10 } });
  ok(с_етаж.total > без.total, "етажът при товарене трябва да оскъпи");
});
test("сам: транспортът остава непроменен", () => {
  const tr = (r) => r.lines.find((l) => l.label.startsWith("Транспорт")).amount;
  eq(tr(дълъг({ courseMode: "selfUnload" })), tr(дълъг()));
});
test("сам: важи само за курс, не за градско", () => {
  eq(calc({ qty: { boxM: 20 }, courseMode: "selfUnload" }).selfUnloadMode, false);
});
test("запис: пази че клиентът разтоварва сам", () => {
  const o = order({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол", courseMode: "selfUnload", qty: { boxL: 10 } });
  eq(E.buildRecord(o, P, E.computePrice(o, P), "calc:x").courseMode, "клиентът разтоварва сам");
});

/* --- Нощувка --- */
test("нощувка: дълъг път в едната посока я включва", () => {
  const r = дълъг();
  ok(r.oneWayDriveH + r.handlingClock > P.overnightThresholdH, "тестът трябва да е над прага");
  ok(r.nights >= 1, "липсва нощувка");
  ok(r.lines.some((l) => l.label.startsWith("Нощувка")), "липсва перо за нощувка");
});
test("нощувка: къс курс не изисква нощувка", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { boxL: 10 } });
  eq(r.nights, 0);
  ok(!r.lines.some((l) => l.label.startsWith("Нощувка")), "не бива да има нощувка");
});
test("нощувка: при пътуваща бригада се плаща и за придружаващия", () => {
  const сам = дълъг();
  const с_екип = дълъг({ courseMode: "dayCrew" });
  const цена = (r) => r.lines.find((l) => l.label.startsWith("Нощувка"))?.amount ?? 0;
  ok(цена(с_екип) > цена(сам), "двама души спят, не един");
});
test("нощувка: градското никога не изисква нощувка", () => {
  eq(calc({ qty: { boxM: 50 } }).nights, 0);
});


test("курс: товаренето е минимум 2 часа — не се праща бригада за час", () => {
  const r = дълъг();
  eq(P.loadHours, 1, "тестът има смисъл само ако заложеното товарене е под минимума:");
  near(r.loadClock, P.minCrewHours, 0.01, "часове товарене:");
  const line = r.lines.find((l) => l.label.startsWith("Товарене"));
  eq(line.amount, Math.round(P.minCrewHours * r.crew * P.workerRate));
});
test("курс: разтоварването също е минимум 2 часа", () => {
  const r = дълъг();
  near(r.unloadClock, P.minCrewHours, 0.01);
});
test("местен екип: товаренето в изходния град също е минимум 2 часа", () => {
  const r = дълъг({ courseMode: "localCrew" });
  const line = r.lines.find((l) => l.label.startsWith("Товарене (София)"));
  ok(line, "липсва перо за товарене");
  eq(line.amount, Math.round(P.minCrewHours * r.crew * P.workerRate));
});
test("курс: при много курсове се плаща реалното време, не минимумът", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Созопол", truckId: "own", qty: { boxL: 400 } });
  ok(r.trips >= 3, `курсовете са ${r.trips}`);
  near(r.loadClock, P.loadHours * r.trips, 0.01, "реални часове:");
});

/* --- Камиони --- */
test("камиони: за градско има само собствен камион", () => {
  eq(E.fleetFor("local", P).length, 1);
});
test("камиони: за междуградско се включват и партньорските", () => {
  ok(E.fleetFor("intercity", P).length > 1);
});
test("камиони: автоматично се избира по-изгодният при голям обем", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { boxL: 300 } });
  ok(r.chosen.cap > E.ownTruck(P).cap, "трябва да избере по-голям камион");
});
test("камиони: ръчният избор надделява над автоматичния", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", truckId: "own", qty: { boxM: 100 } });
  eq(r.chosen.id, "own");
  eq(r.auto, false);
});


/* --- Тегло и товароносимост --- */
test("тегло: всяка вещ има тегло", () => {
  for (const g of E.CATALOG) for (const it of g.items) ok(it.kg > 0, `${it.label} без тегло`);
});
test("тегло: сумира се по брой", () => {
  eq(E.totalWeight({ boxM: 10, wardrobe3: 1 }), 10 * E.ITEM_INDEX.boxM.kg + E.ITEM_INDEX.wardrobe3.kg);
});
test("камион: бусът е до 1.5 тона", () => {
  eq(E.ownTruck(P).payloadKg, 1500);
});
test("курсове: тежък товар в малък обем дава повече курсове", () => {
  // 100 кашона с книги: обем малък, тегло голямо
  const r = calc({ qty: { books: 100 }, truckId: "own" });
  ok(r.weight > P.truck.payloadKg, `теглото е ${r.weight} кг`);
  ok(r.weightLimited, "курсовете трябва да са ограничени от теглото");
  ok(r.trips > r.tripsByVol, `${r.trips} курса срещу ${r.tripsByVol} по обем`);
});
test("курсове: лек обемист товар се ограничава от обема", () => {
  const r = calc({ qty: { mattress: 30 }, truckId: "own" }); // обемисти, но леки
  ok(!r.weightLimited, "обемът трябва да е ограничителят");
  eq(r.trips, r.tripsByVol);
});
test("курсове: взима се по-голямото от двете ограничения", () => {
  const r = calc({ qty: { books: 100 }, truckId: "own" });
  eq(r.trips, Math.max(r.tripsByVol, r.tripsByKg));
});
test("камион: при тежък товар автоматично се избира по-голям", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Варна", qty: { books: 200 } });
  ok(r.payload > 1500, `избран е камион с товароносимост ${r.payload} кг`);
});
test("запис: пази и теглото", () => {
  const o = order({ qty: { wardrobe3: 1 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:x");
  eq(rec.weightKg, E.ITEM_INDEX.wardrobe3.kg);
});
test("тегло: пиано и каса са най-тежките", () => {
  ok(E.ITEM_INDEX.grand.kg >= 300, "роялът трябва да е поне 300 кг");
  ok(E.ITEM_INDEX.safe.kg >= 200, "касата трябва да е поне 200 кг");
});

/* --- Стълби --- */
const stairAmount = (r) => (r.lines.find((l) => l.label.startsWith("Стълби"))?.amount ?? 0);

test("стълби: кашони по 0.30 €/етаж", () => {
  const r = calc({ qty: { boxM: 10 }, pickup: addr(3, false) });
  eq(stairAmount(r), Math.round(3 * 10 * P.boxPerFloor));
});
test("стълби: нормален уред по 3 €/етаж", () => {
  const r = calc({ qty: { washer: 1 }, pickup: addr(2, false) });
  eq(stairAmount(r), 2 * P.appliancePerFloor);
});
test("стълби: нестандартен уред по 5 €/етаж", () => {
  const r = calc({ qty: { washerMiele: 1 }, pickup: addr(2, false) });
  eq(stairAmount(r), 2 * P.heavyAppliancePerFloor);
});
test("стълби: начисляват се и на двата адреса", () => {
  const one = calc({ qty: { washer: 1 }, pickup: addr(2, false) });
  const two = calc({ qty: { washer: 1 }, pickup: addr(2, false), dropoff: addr(2, false) });
  eq(stairAmount(two), stairAmount(one) * 2);
});
test("стълби: товарен асансьор → без такса", () => {
  const r = calc({ qty: { washer: 1, boxM: 10 }, pickup: addr(5, true, "cargo") });
  eq(stairAmount(r), 0);
});
test("стълби: пътнически асансьор освобождава стандартните вещи", () => {
  const r = calc({ qty: { washer: 1, boxM: 10 }, pickup: addr(5, true, "passenger") });
  eq(stairAmount(r), 0);
});
test("едрогабаритни: диван 3-ка се таксува ДОРИ при пътнически асансьор", () => {
  const r = calc({ qty: { sofa3: 1 }, pickup: addr(3, true, "passenger") });
  eq(stairAmount(r), 3 * P.heavyAppliancePerFloor);
});
test("едрогабаритни: товарен асансьор освобождава и дивана", () => {
  const r = calc({ qty: { sofa3: 1 }, pickup: addr(3, true, "cargo") });
  eq(stairAmount(r), 0);
});
test("стълби: партер не се таксува", () => {
  const r = calc({ qty: { washer: 1, sofa3: 1 }, pickup: addr(0, false) });
  eq(stairAmount(r), 0);
});


/* --- Демонтаж/монтаж по вещ --- */
test("демонтаж: неотметнат не добавя часове", () => {
  eq(calc({ qty: { wardrobe3: 1 } }).disHours, 0);
});
test("демонтаж: отметнат добавя часовете на вещта", () => {
  const r = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true } });
  near(r.disHours, E.ITEM_INDEX.wardrobe3.dis, 0.01);
});
test("демонтаж: умножава се по броя", () => {
  const r = calc({ qty: { bedDouble: 3 }, dis: { bedDouble: true } });
  near(r.disHours, E.ITEM_INDEX.bedDouble.dis * 3, 0.01);
});
test("демонтаж: сумира се по няколко вещи", () => {
  const r = calc({ qty: { wardrobe2: 1, desk: 2 }, dis: { wardrobe2: true, desk: true } });
  near(r.disHours, E.ITEM_INDEX.wardrobe2.dis + E.ITEM_INDEX.desk.dis * 2, 0.01);
});
test("демонтаж: отметка върху вещ без демонтаж се игнорира", () => {
  eq(calc({ qty: { boxM: 5 }, dis: { boxM: true } }).disHours, 0);
});
test("демонтаж: вдига крайната цена", () => {
  const без = calc({ qty: { wardrobe3: 2, bedDouble: 1 } });
  const с = calc({ qty: { wardrobe3: 2, bedDouble: 1 }, dis: { wardrobe3: true, bedDouble: true } });
  ok(с.total > без.total, "цената трябва да е по-висока с демонтаж");
});
test("демонтаж: работи и при курс над 50 км", () => {
  const без = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { wardrobe3: 10 } });
  const с = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { wardrobe3: 10 }, dis: { wardrobe3: true } });
  ok(с.manHours > без.manHours, "часовете трябва да нараснат");
  ok(с.total > без.total, "цената трябва да нарасне");
});
test("демонтаж: без праг разликата се вижда и при малка междуградска поръчка", () => {
  const q = { tvstand: 1 };
  const без = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: q });
  const с = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: q, dis: { tvstand: true } });
  ok(с.total > без.total, "демонтажът трябва да оскъпи, а не да изчезне в праг");
});
test("минимум: градското запазва прага си от 2 часа", () => {
  const r = calc({ qty: { boxS: 1 }, pickupHood: "Център", dropoffHood: "Център" });
  ok(r.total >= P.minPrice.local, `${r.total} < ${P.minPrice.local}`);
  near(r.handlingClock, P.minLocalHours, 0.01, "часове пренасяне:");
});
test("демонтаж: коефициентът от параметрите скалира времето", () => {
  const базов = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true } });
  const двоен = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true } }, { ...P, disFactor: 2 });
  near(двоен.disHours, базов.disHours * 2, 0.01);
});
test("демонтаж: показва се като отделно перо в разбивката", () => {
  const r = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true } });
  const line = r.lines.find((l) => l.label.startsWith("Разглобяване"));
  ok(line, "липсва перо за разглобяване");
  eq(line.amount, Math.round(r.disManHours * P.workerRate));
});
test("опаковането е отделно перо", () => {
  const r = calc({ qty: { mattress: 1 } });
  const line = r.lines.find((l) => l.label.startsWith("Опаковане"));
  ok(line, "липсва перо за опаковане");
  eq(line.amount, Math.round(r.wrapManHours * P.workerRate));
});

/* --- Сглобяване --- */
test("сглобяване: отделна отметка от разглобяването", () => {
  const само_разгл = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true } });
  const само_сглоб = calc({ qty: { wardrobe3: 1 }, asm: { wardrobe3: true } });
  const двете = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  near(само_разгл.disHours, E.ITEM_INDEX.wardrobe3.dis, 0.01, "разглобяване:");
  near(само_сглоб.disHours, E.ITEM_INDEX.wardrobe3.asm, 0.01, "сглобяване:");
  near(двете.disHours, E.ITEM_INDEX.wardrobe3.dis + E.ITEM_INDEX.wardrobe3.asm, 0.01, "двете:");
});
test("сглобяване: не отнема по-малко време от разглобяването", () => {
  for (const id of ["wardrobe3", "wardrobe2", "bedDouble", "desk"])
    ok(E.ITEM_INDEX[id].asm >= E.ITEM_INDEX[id].dis, `${id}: сглобяването не бива да е по-кратко`);
});
test("спалня: типичен комплект легло + гардероб се калкулира", () => {
  const r = calc({ qty: { bedDouble: 1, wardrobe3: 1, nightstand: 2 },
    dis: { bedDouble: true, wardrobe3: true, nightstand: true },
    asm: { bedDouble: true, wardrobe3: true, nightstand: true } });
  // нощните шкафчета не се разглобяват — отметките им не трябва да добавят часове
  const очаквано = ["bedDouble", "wardrobe3"].reduce((t, id) => t + E.ITEM_INDEX[id].dis + E.ITEM_INDEX[id].asm, 0);
  near(r.disHours, очаквано, 0.01);
});
test("дребни мебели не се разглобяват", () => {
  for (const id of ["chair", "nightstand"]) {
    ok(E.ITEM_INDEX[id].dis === undefined, `${id} не трябва да има разглобяване`);
    ok(E.ITEM_INDEX[id].asm === undefined, `${id} не трябва да има сглобяване`);
  }
  eq(calc({ qty: { nightstand: 4, chair: 6 }, dis: { nightstand: true, chair: true }, asm: { nightstand: true, chair: true } }).disHours, 0);
});

/* --- Опаковане със стреч --- */
test("стреч: матракът е задължителен за опаковане", () => {
  ok(E.ITEM_INDEX.mattress.wrapReq, "матракът трябва да е задължителен");
  eq(E.wrapMetersFor({ mattress: 1 }, {}), E.ITEM_INDEX.mattress.wrap);
});
test("стреч: техниката е задължителна за опаковане", () => {
  for (const id of ["fridge", "washer", "stove", "fridgeSxS"])
    ok(E.ITEM_INDEX[id].wrapReq, `${id} трябва да е задължителен`);
});
test("стреч: обикновена мебел се опакова само при отметка", () => {
  eq(E.wrapMetersFor({ wardrobe3: 1 }, {}), 0, "без отметка:");
  eq(E.wrapMetersFor({ wardrobe3: 1 }, { wardrobe3: true }), E.ITEM_INDEX.wardrobe3.wrap);
});
test("стреч: метрите се умножават по броя", () => {
  eq(E.wrapMetersFor({ mattress: 3 }, {}), E.ITEM_INDEX.mattress.wrap * 3);
});
test("стреч: ролките се смятат пропорционално на метрите", () => {
  const r = calc({ qty: { mattress: 1 } });
  eq(r.wrapMeters, E.ITEM_INDEX.mattress.wrap);
  near(r.rolls, r.wrapMeters / P.stretchRollM, 0.001);
});
test("стреч: фолиото се таксува пропорционално на метрите, не на цели ролки", () => {
  const r = calc({ qty: { wardrobe3: 1 }, wrap: { wardrobe3: true } });
  eq(r.wrapMeters, 10, "гардероб 3-крилен = 10 м:");
  near(r.rolls, 10 / P.stretchRollM, 0.001, "част от ролка:");
  const line = r.lines.find((l) => l.label.startsWith("Стреч"));
  near(line.amount, 10 * (P.stretchRollPrice / P.stretchRollM), 0.01);
});
test("стреч: цената на метър е разумна, а не колкото цяла ролка", () => {
  const perM = P.stretchRollPrice / P.stretchRollM;
  ok(perM < 0.2, `${perM.toFixed(2)} €/м е твърде висока цена за стреч`);
});
test("опаковане: 3-крилен гардероб отнема около 15 минути", () => {
  const r = calc({ qty: { wardrobe3: 1 }, wrap: { wardrobe3: true } });
  near(r.wrapHours * 60, 15, 1, "минути:");
});
test("разглобяване: часовете са реално време, платено на брой работници", () => {
  const r = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  near(r.disHours, 3, 0.01, "реални часове:");
  eq(r.disCrew, 2, "души по демонтажа:");
  near(r.disManHours, 6, 0.01, "човекочаса за таксуване:");
});
test("разглобяване: 3 ч от 2-ма добавят 6 човекочаса", () => {
  // достатъчно голяма поръчка, за да не е в сила 2-часовият минимум
  const base = { boxM: 100, wardrobe3: 1 };
  const без = calc({ qty: base });
  const с = calc({ qty: base, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  ok(без.handlingClock > P.minLocalHours, "тестът трябва да е над минимума");
  near(с.manHours - без.manHours, 6, 0.01, "разлика в човекочасовете:");
  near(с.total - без.total, 6 * P.workerRate, 1, "разликата е само труд, без транспорт:");
});
test("разглобяване: броят хора се управлява от параметрите", () => {
  const трима = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } }, { ...P, disCrew: 3 });
  near(трима.disManHours, 9, 0.01);
});
test("разглобяване: 3-крилен гардероб е поне 1.5 ч, сглобяването също", () => {
  ok(E.ITEM_INDEX.wardrobe3.dis >= 1.5, "разглобяване под 1.5 ч");
  ok(E.ITEM_INDEX.wardrobe3.asm >= 1.5, "сглобяване под 1.5 ч");
  const r = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  ok(r.disHours >= 3, `общо трябва да е поне 3 чч, а е ${r.disHours}`);
});
test("стреч: материалът влиза като отделно перо по 7 € на ролка", () => {
  const r = calc({ qty: { mattress: 1 } });
  const line = r.lines.find((l) => l.label.startsWith("Стреч"));
  ok(line, "липсва перо за стреч фолио");
  near(line.amount, r.rolls * P.stretchRollPrice, 0.01);
});
test("стреч: опаковането добавя и часове труд", () => {
  const r = calc({ qty: { fridge: 1, washer: 1 } });
  ok(r.wrapHours > 0, "липсват часове за опаковане");
  near(r.wrapHours, r.wrapMeters / P.wrapMPerManHour, 0.01);
});
test("стреч: без вещи за опаковане няма нито ролки, нито часове", () => {
  const r = calc({ qty: { boxM: 10 } });
  eq(r.rolls, 0);
  eq(r.wrapHours, 0);
  ok(!r.lines.some((l) => l.label.startsWith("Стреч")), "не трябва да има перо");
});
test("стреч: цената на ролката се управлява от параметрите", () => {
  const скъпо = calc({ qty: { mattress: 1 } }, { ...P, stretchRollPrice: 14 });
  const line = скъпо.lines.find((l) => l.label.startsWith("Стреч"));
  near(line.amount, скъпо.rolls * 14, 0.01);
});
test("записът пази метри стреч и брой ролки", () => {
  const o = order({ qty: { mattress: 2, wardrobe3: 1 }, asm: { wardrobe3: true } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P));
  ok(rec.wrapMeters > 0 && rec.stretchRolls > 0, "липсват данни за опаковане");
  eq(rec.assembly.length, 1, "сглобяването не е записано:");
});
test("каталог: всяка вещ със стреч има положителни метри", () => {
  for (const g of E.CATALOG) for (const it of g.items)
    if (it.wrap !== undefined) ok(it.wrap > 0, `${it.label} с невалидни метри`);
});
test("демонтаж: записът пази кои мебели се разглобяват", () => {
  const o = order({ qty: { wardrobe3: 1, boxM: 5 }, dis: { wardrobe3: true } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P));
  eq(rec.disassembly.length, 1);
  ok(rec.disHours > 0, "липсват часове за демонтаж");
});
test("каталог: мебелите за разглобяване имат положително време", () => {
  for (const g of E.CATALOG) for (const it of g.items)
    if (it.dis !== undefined) ok(it.dis > 0, `${it.label} с невалидно време за демонтаж`);
});

/* --- Минимални цени --- */
test("минимум: градско не пада под прага", () => {
  const r = calc({ qty: { boxS: 1 }, pickupHood: "Център", dropoffHood: "Център" });
  ok(r.total >= P.minPrice.local, `${r.total} < ${P.minPrice.local}`);
});
test("минимум: междуградското НЯМА долен праг", () => {
  eq(P.minPrice.intercity, undefined, "такова поле не бива да съществува:");
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", qty: { boxS: 1 } });
  ok(!r.lines.some((l) => l.label.includes("минимум")), "не бива да има перо за изравняване");
});


test("минимум: стара запазена стойност от 350 € не се възстановява", () => {
  const merged = E.mergeParams({ minPrice: { local: 90, intercity: 350, international: 500 } });
  eq(merged.minPrice.intercity, undefined, "старият праг трябва да отпадне:");
  eq(merged.minPrice.local, 90, "местният праг се пази:");
  eq(merged.minPrice.international, 500);
});
test("минимум: малка междуградска поръчка си остава евтина", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Перник", qty: { boxS: 1 } });
  ok(!r.lines.some((l) => l.label.includes("минимум")), "не бива да има изравняване");
});

/* --- Спец. обработка --- */
test("пиано: добавя еднократна надценка", () => {
  const base = calc({ qty: { boxM: 10 } });
  const piano = calc({ qty: { boxM: 10, piano: 1 } });
  ok(piano.total > base.total + 100, "надценката за пиано липсва");
});

/* --- Разстояния между квартали --- */
test("квартали: Дървеница е в списъка на София", () => {
  ok(E.findHood("София", "Дървеница"), "Дървеница липсва");
});
test("квартали: разпознава представка 'кв.'", () => {
  eq(E.findHood("София", "кв. Дървеница").name, "Дървеница");
});
test("квартали: разпознава непълно име", () => {
  eq(E.findHood("София", "дървен").name, "Дървеница");
});
test("квартали: непознато име НЕ блокира — смята спрямо центъра", () => {
  const km = E.estimateKm("София", "Няма такъв квартал", "Люлин", 1.3);
  ok(km != null && km > 0, "трябва да върне разстояние, а не null");
});
test("квартали: всички градове имат Център за резервно изчисление", () => {
  for (const city of Object.keys(E.NEIGHBORHOODS)) ok(E.cityCenter(city), `${city} без център`);
});
test("квартали: координатите са в границите на България", () => {
  for (const [city, list] of Object.entries(E.NEIGHBORHOODS))
    for (const h of list)
      ok(h.lat > 41 && h.lat < 44.3 && h.lng > 22 && h.lng < 28.7, `${city}/${h.name} с невалидни координати`);
});
test("квартали: разстоянието расте с отдалечаването", () => {
  const near1 = E.estimateKm("София", "Център", "Лозенец", 1.3);
  const far = E.estimateKm("София", "Център", "Самоков", 1.3);
  ok(far > near1, "по-далечният квартал трябва да дава повече км");
});

/* --- Параметри: сливане и запис --- */
test("mergeParams: пази новите полета по подразбиране", () => {
  const merged = E.mergeParams({ workerRate: 20 });
  eq(merged.workerRate, 20, "новата стойност:");
  eq(merged.truckRate, E.DEFAULTS.truckRate, "липсващото поле:");
  ok(merged.truck && merged.truck.l, "вложените обекти трябва да оцелеят");
});
test("mergeParams: устоява на празен/невалиден вход", () => {
  eq(E.mergeParams(null).workerRate, E.DEFAULTS.workerRate);
});
test("промяна на ставка променя цената", () => {
  const base = calc({ qty: { boxM: 20 } });
  const pricier = calc({ qty: { boxM: 20 } }, { ...P, workerRate: 32 });
  ok(pricier.total > base.total, "по-високата ставка трябва да вдигне цената");
});

/* --- Записи --- */
test("buildRecord: съдържа ключовите полета", () => {
  const o = order({ qty: { boxM: 10, sofa3: 1 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:test");
  ok(rec.createdAt && rec.total > 0 && rec.items.length === 2, "непълен запис");
  ok(rec.paramsSnapshot, "липсва снимка на ставките");
  eq(rec.contact, null, "без контакт по подразбиране:");
});
test("toCSV: заглавен ред + по ред на запис", () => {
  const o = order({ qty: { boxM: 10 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P));
  eq(E.toCSV([rec, rec]).split("\n").length, 3);
});


test("запис: носи ID, за да се обновява, а не да се дублира", () => {
  const o = order({ qty: { boxM: 10 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:abc123");
  eq(rec.id, "calc:abc123");
});
test("запис: без подаден ID полето е празно, а не измислено", () => {
  const o = order({ qty: { boxM: 10 } });
  eq(E.buildRecord(o, P, E.computePrice(o, P)).id, null);
});
test("запис: съдържа всичко нужно за таблицата", () => {
  const o = order({ qty: { wardrobe3: 1, mattress: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:x");
  for (const поле of ["createdAt", "service", "volumeM3", "trips", "crew", "hours", "total", "items", "breakdown"])
    ok(rec[поле] !== undefined, `липсва поле ${поле}`);
  eq(rec.status, "калкулация", "по подразбиране е калкулация, не заявка:");
});

/* ---------- Асинхронни тестове (хранилище) ---------- */
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push([name, fn]); }

testAsync("хранилище: параметрите се записват и зареждат", async () => {
  const changed = { ...P, workerRate: 21.5, kmRate: 0.85 };
  eq(await E.saveParams(changed), true, "записът трябва да успее:");
  const loaded = await E.loadParams();
  eq(loaded.workerRate, 21.5, "ставка работник:");
  eq(loaded.kmRate, 0.85, "ставка км:");
});
testAsync("хранилище: презаписване на параметър взима последната стойност", async () => {
  await E.saveParams({ ...P, workerRate: 18 });
  await E.saveParams({ ...P, workerRate: 19 });
  eq((await E.loadParams()).workerRate, 19);
});
testAsync("хранилище: липсващи параметри не чупят зареждането", async () => {
  await E.saveParams({ workerRate: 25 });
  const loaded = await E.loadParams();
  eq(loaded.workerRate, 25);
  eq(loaded.truckRate, E.DEFAULTS.truckRate, "липсващото поле пада към по подразбиране:");
});
testAsync("хранилище: калкулация се записва и се чете обратно", async () => {
  const o = order({ qty: { boxM: 12 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P));
  const key = `${E.CALC_PREFIX}test-1`;
  eq(await E.saveCalc(key, rec), true);
  const all = await E.loadCalcs();
  ok(all.some((r) => r.key === key), "записът не се намери");
});
testAsync("хранилище: калкулация без контакти пак се пази", async () => {
  const o = order({ qty: { boxM: 5 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P));
  await E.saveCalc(`${E.CALC_PREFIX}test-2`, rec);
  const all = await E.loadCalcs();
  ok(all.some((r) => r.contact === null), "анонимната калкулация липсва");
});
testAsync("хранилище: грешка при запис не хвърля изключение", async () => {
  const backup = globalThis.window.storage.set;
  globalThis.window.storage.set = async () => { throw new Error("мрежов проблем"); };
  eq(await E.saveCalc("calc:fail", {}), false, "трябва да върне false, не да гръмне:");
  eq(await E.saveParams({}), false);
  globalThis.window.storage.set = backup;
});


testAsync("хранилище: пада към лично, ако споделеното е забранено", async () => {
  const backupSet = globalThis.window.storage.set;
  const backupGet = globalThis.window.storage.get;
  globalThis.window.storage.set = async (k, v, shared) => {
    if (shared) throw new Error("споделеното е забранено");
    store.set(`false:${k}`, v); return { key: k, value: v, shared };
  };
  globalThis.window.storage.get = async (k, shared) => {
    if (shared) throw new Error("споделеното е забранено");
    const key = `false:${k}`;
    if (!store.has(key)) throw new Error("not found");
    return { key: k, value: store.get(key), shared };
  };
  eq(await E.saveParams({ ...P, workerRate: 27 }), true, "трябва да успее в личен режим:");
  eq(E.getStorageMode(), "personal", "режим:");
  eq((await E.loadParams()).workerRate, 27);
  globalThis.window.storage.set = backupSet;
  globalThis.window.storage.get = backupGet;
});

testAsync("хранилище: липсващо window.storage не чупи приложението", async () => {
  const backup = globalThis.window.storage;
  delete globalThis.window.storage;
  eq(E.hasStorage(), false, "не трябва да отчита хранилище:");
  eq(await E.saveParams({}), false, "записът връща false, без изключение:");
  eq(await E.loadParams(), null);
  eq((await E.loadCalcs()).length, 0, "списъкът е празен, без грешка:");
  eq(E.getStorageMode(), "none", "режим:");
  globalThis.window.storage = backup;
});


testAsync("настройки: теглят се от Google Sheet, ако е зададен адрес", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, params: { workerRate: 24 } }) });
  const got = await E.fetchParamsFromSheet("https://script.google.com/x/exec");
  eq(got.workerRate, 24, "ставка от Sheet:");
  eq(got.truckRate, E.DEFAULTS.truckRate, "липсващите полета падат към по подразбиране:");
  delete globalThis.fetch;
});
testAsync("настройки: без адрес не се прави заявка", async () => {
  eq(await E.fetchParamsFromSheet(""), null);
  eq(await E.pushParamsToSheet({}, ""), false);
});
testAsync("настройки: мрежова грешка не чупи зареждането", async () => {
  globalThis.fetch = async () => { throw new Error("няма мрежа"); };
  eq(await E.fetchParamsFromSheet("https://script.google.com/x/exec"), null);
  eq(await E.pushParamsToSheet({}, "https://script.google.com/x/exec"), false);
  delete globalThis.fetch;
});
testAsync("настройки: невалиден отговор не се приема", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, params: null }) });
  eq(await E.fetchParamsFromSheet("https://x/exec"), null);
  delete globalThis.fetch;
});


/* ---------- Синтактична проверка на целия файл (вкл. интерфейса) ---------- */
test("файлът е синтактично валиден JSX", () => {
  let parse;
  try { parse = require("@babel/parser").parse; }
  catch (e) { return; } // ако @babel/parser не е инсталиран, пропускаме
  parse(raw, { sourceType: "module", plugins: ["jsx"] });
});

/* ---------- Пускане ---------- */
for (const [name, fn] of asyncTests) {
  try { await fn(); passed++; }
  catch (err) { failed++; fails.push(`${name}\n     → ${err.message}`); }
}

fs.unlinkSync(tmp);

console.log(`\n  Тестове: ${passed} успешни, ${failed} неуспешни (общо ${passed + failed})\n`);
if (fails.length) {
  console.log("  Неуспешни:");
  fails.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
  process.exit(1);
} else {
  console.log("  ✓ Всичко минава\n");
}
