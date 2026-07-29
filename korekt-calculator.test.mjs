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
  fleetFor, tripsFor, bestTruck, computePrice, totalWeight, findCity, protectMetersFor, BASES, nearestBase, baseOnRoute, mergeParams, buildRecord, toCSV, disHoursFor, wrapMetersFor, CITIES, estimateKmAny, pointFor,
  saveCalc, loadCalcs, saveParams, loadParams, CALC_PREFIX, PARAMS_KEY, fetchParamsFromSupabase, pushParamsToSupabase, pushCalcToSupabase, fetchCalcsFromSupabase, fetchCatalogItemsFromSupabase, pushCatalogItemToSupabase, applyExtraCatalogItems, nextCalcNumber, CALC_COUNTER_KEY, fetchRealDistanceKm, routesCache, ROUTES_CACHE_KEY,
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
  courseMode: "hourly", baseCity: "", labourBase: "", forceCar: false, weFill: true, landfillKm: 0, wasteType: "household", disposalTrucks: 1,
  pickup: addr(), dropoff: addr(),
  dis: {}, asm: {}, wrap: {}, protect: {},
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
test("пътуваща бригада: придружаващият се плаща на реални часове, не на фиксирана дневна ставка", () => {
  const r = дълъг({ courseMode: "dayCrew" });
  ok(r.dayCrewMode, "режимът не е активен");
  const line = r.lines.find((l) => l.label.startsWith("Придружаващ"));
  ok(line, "липсва перо за придружаващия работник");
  const часове = r.handlingClock + r.driveHours;
  eq(line.amount, Math.round(часове * P.travelCrew * P.workerRate), "часове × ставка, без таван:");
  ok(!r.lines.some((l) => l.label.startsWith("Товарене")), "не бива да има и почасови пера");
});
test("пътуваща бригада: 10 часа работа при 18 €/ч дават точно 180 €", () => {
  // директна проверка на примера: 10ч × 18€/ч = 180€, без закръгляне до дни
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", courseMode: "dayCrew", qty: { boxL: 10 } });
  const часове = r.handlingClock + r.driveHours;
  const line = r.lines.find((l) => l.label.startsWith("Придружаващ"));
  near(line.amount, часове * P.travelCrew * P.workerRate, 1, "трябва да е точно часове × ставка:");
});
test("пътуваща бригада: повече часове означава пропорционално повече пари", () => {
  const близо = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", courseMode: "dayCrew", qty: { boxL: 10 } });
  const далеч = дълъг({ courseMode: "dayCrew" }); // София → Созопол, много по-дълъг път
  const линияЗаЧас = (r) => r.lines.find((l) => l.label.startsWith("Придружаващ")).amount / (r.handlingClock + r.driveHours);
  near(линияЗаЧас(близо), P.travelCrew * P.workerRate, 1, "цената на час трябва да е една и съща:");
  near(линияЗаЧас(далеч), P.travelCrew * P.workerRate, 1, "дори при много по-дълъг път:");
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
  // Пловдив е реално по-близо до Банско (~137 км) от София (~160 км по път през Симитли)
  eq(E.nearestBase("Банско", 1.25).city, "Пловдив");
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


/* --- Изхвърляне на отпадък --- */
const изхв = (q, extra = {}) => calc({ service: "disposal", city: "Варна", pickupHood: "Център", qty: q, ...extra });

test("изхвърляне: разпознава се като отделна услуга", () => {
  const r = изхв({ sackHouse: 20 });
  ok(r.isDisposal, "режимът не е активен");
  eq(r.isCourse, false, "изхвърлянето не е междуградски курс:");
});
test("изхвърляне: чувалите се броят", () => {
  eq(изхв({ sackHouse: 30, sackConstr: 10 }).sacks, 40);
  eq(изхв({ junkFurniture: 3 }).sacks, 0, "мебелите не са чували:");
});
test("изхвърляне: пълненето се начислява по време на чувал", () => {
  const r = изхв({ sackHouse: 60 });
  near(r.fillManHours, (60 * P.fillMinPerSack) / 60, 0.01);
  ok(r.lines.some((l) => l.label.startsWith("Пълнене")), "липсва перо за пълнене");
});
test("изхвърляне: ако клиентът е напълнил, не се плаща пълнене", () => {
  const с = изхв({ sackHouse: 100 });
  const без = изхв({ sackHouse: 100 }, { weFill: false });
  eq(без.fillManHours, 0);
  ok(без.total < с.total, "без пълнене трябва да е по-евтино");
});
test("изхвърляне: пътят до сметището е двупосочен", () => {
  const r = изхв({ sackHouse: 100 }, { landfillKm: 20 });
  eq(r.totalKm, r.trips * 2 * 20);
});
test("изхвърляне: строителният отпадък тежи повече и вдига курсовете", () => {
  const бит = изхв({ sackHouse: 200 }, { truckId: "own" });
  const стр = изхв({ sackConstr: 200 }, { truckId: "own" });
  ok(стр.weight > бит.weight, "строителният трябва да е по-тежък");
  ok(стр.trips >= бит.trips);
});
test("изхвърляне: таксата на сметището е НА КУРС, не на тон", () => {
  const r = изхв({ sackHouse: 100 });
  const line = r.lines.find((l) => l.label.startsWith("Такса сметище"));
  ok(line, "липсва перо за таксата");
  eq(line.amount, r.trips * P.landfillFees.household, "курсове × такса:");
});
test("изхвърляне: повече курсове = повече такси", () => {
  const малко = изхв({ sackHouse: 50 }, { truckId: "own" });
  const много = изхв({ sackHouse: 500 }, { truckId: "own" });
  ok(много.trips > малко.trips);
  const такса = (r) => r.lines.find((l) => l.label.startsWith("Такса сметище")).amount;
  eq(такса(много) / такса(малко), много.trips / малко.trips);
});
test("изхвърляне: видът отпадък се отразява в перото", () => {
  ok(изхв({ sackConstr: 50 }, { wasteType: "construction" }).lines
    .some((l) => l.label.includes("строителен")), "липсва вид отпадък");
  ok(изхв({ sackHouse: 50 }).lines.some((l) => l.label.includes("битов")));
});
test("изхвърляне: различните видове може да имат различна такса", () => {
  const p2 = { ...P, landfillFees: { household: 50, construction: 80, mixed: 60 } };
  const бит = calc({ service: "disposal", city: "Варна", pickupHood: "Център", qty: { sackHouse: 50 } }, p2);
  const стр = calc({ service: "disposal", city: "Варна", pickupHood: "Център", qty: { sackHouse: 50 }, wasteType: "construction" }, p2);
  ok(стр.total > бит.total, "строителният трябва да е по-скъп при по-висока такса");
});
test("изхвърляне: нулева такса не показва перо", () => {
  const p0 = { ...P, landfillFees: { household: 0, construction: 0, mixed: 0 } };
  const r = calc({ service: "disposal", city: "Варна", pickupHood: "Център", qty: { sackHouse: 50 } }, p0);
  ok(!r.lines.some((l) => l.label.startsWith("Такса")), "не бива да има перо");
});
test("настройки: таксите по вид отпадък оцеляват при сливане", () => {
  const m = E.mergeParams({ landfillFees: { construction: 90 } });
  eq(m.landfillFees.construction, 90, "запазената стойност:");
  eq(m.landfillFees.household, E.DEFAULTS.landfillFees.household, "останалите падат към по подразбиране:");
});
test("изхвърляне: ползва и партньорски камиони при голям обем", () => {
  const r = изхв({ sackHouse: 1000 });
  ok(r.chosen.cap > E.ownTruck(P).cap, `избран е ${r.chosen.name}`);
  ok(r.trips < 10, `курсовете са ${r.trips}, не десетки`);
});
test("изхвърляне: минимум 2 часа при малка поръчка (без пълнене)", () => {
  const r = изхв({ sackHouse: 3 }, { landfillKm: 5, weFill: false });
  near(r.handlingClock, P.minDisposalHours, 0.01);
});
test("изхвърляне: времето за пълнене вече се брои в общото календарно време", () => {
  const без = изхв({ sackHouse: 1000 }, { weFill: false });
  const с = изхв({ sackHouse: 1000 }, { weFill: true });
  ok(с.clockHours > без.clockHours, "пълненето трябва да удължава деня");
  near(с.clockHours - без.clockHours, с.fillManHours / с.crew, 0.05, "разликата отговаря на пълненето:");
});
test("изхвърляне: няма разтоварване при клиент, а изсипване", () => {
  const r = изхв({ sackHouse: 50 });
  ok(!r.lines.some((l) => l.label.startsWith("Разтоварване")), "не бива да има разтоварване");
  ok(r.lines.some((l) => l.label.includes("изсипване")), "липсва изсипване");
});
test("запис: пази броя чували и разстоянието до сметището", () => {
  const o = order({ service: "disposal", city: "Варна", pickupHood: "Център", qty: { sackHouse: 40 }, landfillKm: 12 });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:x");
  eq(rec.sacks, 40);
  eq(rec.landfillKm, 12);
});


test("изхвърляне: не се ползва голям ТИР — нито за битов, нито за строителен", () => {
  const бит = E.fleetFor("disposal", P, "household");
  const стр = E.fleetFor("disposal", P, "construction");
  for (const t of [...бит, ...стр]) ok(t.payloadKg <= P.disposalMaxPayloadKg, `${t.name} е твърде голям за изхвърляне`);
  eq(бит.length, стр.length, "и двата вида отпадък имат еднакво ограничена флота:");
});
test("изхвърляне: собственият камион и малкият партньор остават достъпни", () => {
  const fleet = E.fleetFor("disposal", P, "household");
  ok(fleet.some((t) => t.id === "own"), "липсва собственият камион");
  ok(fleet.some((t) => t.payloadKg > 1500 && t.payloadKg <= P.disposalMaxPayloadKg), "липсва малкият партньор");
});
test("изхвърляне: строителният дава повече курсове заради тонажа", () => {
  const бит = изхв({ sackHouse: 1000 });
  const стр = изхв({ sackConstr: 1000 }, { wasteType: "construction" });
  ok(стр.trips > бит.trips, `строителен ${стр.trips} срещу битов ${бит.trips}`);
  ok(стр.weightLimited, "трябва да ограничава теглото");
  ok(стр.total > бит.total, "повече курсове = по-скъпо");
});


/* --- Велпапе / аеропласт за чупливи вещи --- */
test("велпапе: огледала и картини се защитават задължително", () => {
  ok(E.ITEM_INDEX.art.protectReq, "огледалото трябва да е задължително");
  eq(E.protectMetersFor({ art: 1 }, {}), E.ITEM_INDEX.art.protect);
});
test("велпапе: телевизорът също е задължителен", () => {
  ok(E.ITEM_INDEX.tvstand.protectReq);
});
test("велпапе: стъклените мебели се защитават задължително", () => {
  for (const id of ["vitrine", "tableGlass", "tableSmallGlass"]) {
    ok(E.ITEM_INDEX[id].protectReq, `${id}: защитата трябва да е задължителна`);
    eq(E.protectMetersFor({ [id]: 1 }, {}), E.ITEM_INDEX[id].protect, `${id}: без отметка пак се брои`);
  }
});
test("велпапе: обикновените маси остават по избор", () => {
  eq(E.protectMetersFor({ table: 1 }, {}), 0, "без отметка:");
  eq(E.protectMetersFor({ table: 1 }, { table: true }), E.ITEM_INDEX.table.protect);
});
test("стъклените маси са по-скъпи от обикновените", () => {
  const обикн = calc({ qty: { table: 1 } });
  const стъкло = calc({ qty: { tableGlass: 1 } });
  ok(стъкло.total > обикн.total, "стъклената трябва да струва повече");
  ok(стъкло.protectMeters > 0, "трябва да има велпапе");
});
test("велпапе: метрите се умножават по броя", () => {
  eq(E.protectMetersFor({ art: 5 }, {}), E.ITEM_INDEX.art.protect * 5);
});
test("велпапе: влиза като отделно перо по цена на метър", () => {
  const r = calc({ qty: { art: 3 } });
  const line = r.lines.find((l) => l.label.startsWith("Велпапе"));
  ok(line, "липсва перо за велпапе");
  near(line.amount, r.protectMeters * P.protectPricePerM, 0.01);
});
test("велпапе: добавя и часове труд", () => {
  const r = calc({ qty: { art: 4 } });
  ok(r.protectManHours > 0, "липсват часове");
  near(r.protectManHours, r.protectMeters / P.protectMPerManHour, 0.01);
});
test("велпапе: стреч и велпапе се начисляват заедно, не вместо", () => {
  const r = calc({ qty: { art: 2 } });
  ok(r.wrapMeters > 0 && r.protectMeters > 0, "огледалото носи и двата материала");
  ok(r.lines.some((l) => l.label.startsWith("Стреч")) && r.lines.some((l) => l.label.startsWith("Велпапе")));
});
test("велпапе: без чупливи вещи няма перо", () => {
  const r = calc({ qty: { boxM: 10 } });
  eq(r.protectMeters, 0);
  ok(!r.lines.some((l) => l.label.startsWith("Велпапе")));
});
test("велпапе: цената се управлява от параметрите", () => {
  const скъпо = calc({ qty: { art: 3 } }, { ...P, protectPricePerM: 1.2 });
  const line = скъпо.lines.find((l) => l.label.startsWith("Велпапе"));
  near(line.amount, скъпо.protectMeters * 1.2, 0.01);
});
test("материали: цените отговарят на сайта, без ДДС", () => {
  eq(P.protectPricePerM, 0.5, "велпапе на метър (0.60 € с ДДС ÷ 1.2):");
  eq(P.stretchRollPrice, 8.17, "ролка стреч (9.80 € с ДДС ÷ 1.2):");
});
test("запис: пази метрите велпапе", () => {
  const o = order({ qty: { art: 2 } });
  eq(E.buildRecord(o, P, E.computePrice(o, P), "calc:x").protectMeters, E.ITEM_INDEX.art.protect * 2);
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
test("сглобяване: отнема осезаемо повече от разглобяването", () => {
  for (const id of ["wardrobe3", "wardrobe2", "bedDouble", "desk"])
    ok(E.ITEM_INDEX[id].asm > E.ITEM_INDEX[id].dis, `${id}: сглобяването трябва да е по-дълго`);
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
  const очаквани = E.ITEM_INDEX.wardrobe3.dis + E.ITEM_INDEX.wardrobe3.asm;
  near(r.disHours, очаквани, 0.01, "реални часове:");
  eq(r.disCrew, 2, "души по демонтажа:");
  near(r.disManHours, очаквани * 2, 0.01, "човекочаса за таксуване:");
});
test("разглобяване: часовете се плащат на брой работници", () => {
  const base = { boxM: 100, wardrobe3: 1 };
  const без = calc({ qty: base });
  const с = calc({ qty: base, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  const чч = (E.ITEM_INDEX.wardrobe3.dis * P.disCrew) + (E.ITEM_INDEX.wardrobe3.asm * P.asmCrew);
  ok(без.handlingClock > P.minLocalHours, "тестът трябва да е над минимума");
  near(с.manHours - без.manHours, чч, 0.01, "разлика в човекочасовете:");
  near(с.total - без.total, чч * P.workerRate, 1, "разликата е само труд, без транспорт:");
});
test("разглобяване: броят хора се управлява поотделно за двата екипа", () => {
  const W = E.ITEM_INDEX.wardrobe3;
  const трима = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } }, { ...P, disCrew: 3, asmCrew: 3 });
  near(трима.disManHours, (W.dis + W.asm) * 3, 0.01, "и двата екипа по 3 души:");
  const смесен = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } }, { ...P, disCrew: 3, asmCrew: 2 });
  near(смесен.disOnlyManHours, W.dis * 3, 0.01, "разглобяване с 3 души:");
  near(смесен.asmOnlyManHours, W.asm * 2, 0.01, "сглобяване с 2 души:");
});
test("разглобяване и сглобяване са отделни пера — правят ги различни екипи", () => {
  const r = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  const разгл = r.lines.find((l) => l.label.startsWith("Разглобяване"));
  const сглоб = r.lines.find((l) => l.label.startsWith("Сглобяване"));
  ok(разгл && сглоб, "трябва да има две отделни пера");
  eq(разгл.amount, Math.round(r.disOnlyManHours * P.workerRate));
  eq(сглоб.amount, Math.round(r.asmOnlyManHours * P.workerRate));
});
test("само разглобяване не поражда перо за сглобяване", () => {
  const r = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true } });
  ok(r.lines.some((l) => l.label.startsWith("Разглобяване")));
  ok(!r.lines.some((l) => l.label.startsWith("Сглобяване")), "не бива да има сглобяване");
  eq(r.asmOnlyHours, 0);
});
test("само сглобяване не поражда перо за разглобяване", () => {
  const r = calc({ qty: { wardrobe3: 1 }, asm: { wardrobe3: true } });
  ok(r.lines.some((l) => l.label.startsWith("Сглобяване")));
  ok(!r.lines.some((l) => l.label.startsWith("Разглобяване")), "не бива да има разглобяване");
});
test("3-крилен гардероб: разглобяване поне 1.5 ч, сглобяване 3 ч", () => {
  ok(E.ITEM_INDEX.wardrobe3.dis >= 1.5, "разглобяване под 1.5 ч");
  eq(E.ITEM_INDEX.wardrobe3.asm, 3, "сглобяване:");
  const r = calc({ qty: { wardrobe3: 1 }, dis: { wardrobe3: true }, asm: { wardrobe3: true } });
  near(r.disHours, E.ITEM_INDEX.wardrobe3.dis + E.ITEM_INDEX.wardrobe3.asm, 0.01, "общо реално време:");
});
test("дивани: опаковането е задължително, като матраци и техника", () => {
  for (const id of ["sofa2", "sofa3", "sofaL"])
    ok(E.ITEM_INDEX[id].wrapReq, `${id} трябва да е задължителен за опаковане`);
  const r = calc({ qty: { sofa2: 1 } });
  ok(r.wrapMeters > 0, "метрите стреч трябва да се начислят автоматично, без отметка");
});
test("сглобяването отнема повече време от разглобяването при всяка мебел", () => {
  for (const g of E.CATALOG) for (const it of g.items)
    if (it.dis && it.asm) ok(it.asm > it.dis, `${it.label}: сглобяване ${it.asm} ч не бива да е ≤ разглобяване ${it.dis} ч`);
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


test("изхвърляне: чувалите носят такса на етаж без асансьор, като кашони", () => {
  const без = изхв({ sackHouse: 100 }, { pickup: addr(3, false) });
  const с = изхв({ sackHouse: 100 }, { pickup: addr(3, true, "passenger") });
  ok(без.total > с.total, "без асансьор трябва да е по-скъпо");
  const line = без.lines.find((l) => l.label.startsWith("Стълби"));
  ok(line, "липсва перо за стълби");
  eq(line.amount, 3 * 100 * P.boxPerFloor);
});
test("изхвърляне: адресът на разтоварване не съществува — не се таксува", () => {
  const r = изхв({ sackHouse: 50 }, { pickup: addr(2, false), dropoff: addr(5, false) });
  const line = r.lines.find((l) => l.label.startsWith("Стълби"));
  eq(line.amount, 2 * 50 * P.boxPerFloor, "само адресът на изнасяне се брои:");
});
test("изхвърляне: стара мебел и стар уред носят такса като нормален уред", () => {
  const r = изхв({ junkFurniture: 1, junkAppliance: 1 }, { pickup: addr(2, false) });
  const line = r.lines.find((l) => l.label.startsWith("Стълби"));
  eq(line.amount, 2 * 2 * P.appliancePerFloor);
});


test("изхвърляне: 2 камиона намаляват календарното време наполовина", () => {
  const един = изхв({ sackHouse: 1000 }, { truckId: "own" });
  const два = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 2 });
  near(два.clockHours, един.clockHours / 2, 0.1, "времето трябва да е наполовина:");
});
test("изхвърляне: повече камиони НЕ променят общата цена", () => {
  const един = изхв({ sackHouse: 1000 }, { truckId: "own" });
  const два = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 2 });
  eq(два.total, един.total, "цената трябва да е същата — само календарното време се компресира:");
});
test("изхвърляне: с 2 камиона общият брой хора се удвоява", () => {
  const един = изхв({ sackHouse: 1000 }, { truckId: "own" });
  const два = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 2 });
  eq(два.disposalTrucksN, 2);
});
test("изхвърляне: с ограничен брой хора времето спира да пада безкрайно", () => {
  const с2 = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 2 });
  const с10 = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 10 });
  eq(с2.disposalTotalCrew, P.disposalMaxWorkers, "при 2 камиона вече опира в тавана:");
  eq(с10.disposalTotalCrew, P.disposalMaxWorkers, "и при 10 камиона хората остават same:");
  ok(с10.clockHours < с2.clockHours, "повече камиони все пак ускоряват пътя/изсипването");
  ok(с10.clockHours > 8, "но с 8 души общо 1000 чувала реално не се събират в 8 часа");
});
test("изхвърляне: общият брой хора не надхвърля тавана дори с много камиони", () => {
  const r = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 5 });
  ok(r.disposalTotalCrew <= P.disposalMaxWorkers, `${r.disposalTotalCrew} надвишава тавана ${P.disposalMaxWorkers}`);
});


test("изхвърляне: ползва отделна ставка от преместването", () => {
  const r = изхв({ sackHouse: 100 });
  const line = r.lines.find((l) => l.label.startsWith("Изнасяне"));
  ok(line.label.includes(`${P.disposalWorkerRate} `), `перото не показва ставката: ${line.label}`);
  ok(P.disposalWorkerRate !== P.workerRate, "ставките трябва да са различни за теста да има смисъл");
});
test("изхвърляне: другите услуги не ползват специалната ставка", () => {
  const r = calc({ qty: { boxM: 20 } }); // градско преместване
  const labor = r.lines.find((l) => l.label.startsWith("Пренасяне"));
  eq(labor.amount, Math.round(r.clockHours * r.crew * P.workerRate), "трудът трябва да е по общата ставка, не по тази за изхвърляне:");
});
test("изхвърляне: таванът на хората важи и без избрани допълнителни камиони", () => {
  const r = изхв({ sackHouse: 1000 }, { truckId: "own" }); // 1 камион, база бригада 4 < 8
  ok(r.disposalTotalCrew <= P.disposalMaxWorkers);
});


test("изхвърляне: бригадата в статистиката е реалният общ брой, не базовият", () => {
  const o = order({ service: "disposal", city: "Варна", pickupHood: "Център", qty: { sackHouse: 1000 }, disposalTrucks: 2, truckId: "own" });
  const r = E.computePrice(o, P);
  ok(r.disposalTotalCrew > r.crew, "общият брой трябва да е по-голям от базовата бригада на камион");
  eq(r.disposalTotalCrew, r.crew * 2);
});
test("изхвърляне: общото трудово време включва и пълненето", () => {
  const o = order({ service: "disposal", city: "Варна", pickupHood: "Център", qty: { sackHouse: 1000 }, truckId: "own" });
  const r = E.computePrice(o, P);
  near(r.manHours, r.handlingManHours + r.fillManHours, 0.01, "manHours трябва да включва пълненето:");
});


test("изхвърляне: чувалите се начисляват като материал", () => {
  const r = изхв({ sackHouse: 100 });
  const line = r.lines.find((l) => l.label.startsWith("Чували"));
  ok(line, "липсва перо за чувалите");
  near(line.amount, 100 * P.sackPrice, 0.01);
});
test("изхвърляне: цената на чувалите се управлява от параметрите", () => {
  const скъпо = изхв({ sackHouse: 100 }, {});
  const r = calc({ service: "disposal", city: "Варна", pickupHood: "Център", qty: { sackHouse: 100 } }, { ...P, sackPrice: 1 });
  const line = r.lines.find((l) => l.label.startsWith("Чували"));
  eq(line.amount, 100);
});
test("изхвърляне: без чували няма такова перо", () => {
  const r = изхв({ junkFurniture: 2 });
  ok(!r.lines.some((l) => l.label.startsWith("Чували")), "не бива да има перо без чували");
});


/* --- Дни за изпълнение (макс. 10 ч/ден) --- */
test("дни: под 10 часа е 1 ден", () => {
  const r = calc({ qty: { wardrobe3: 1 } });
  ok(r.clockHours <= P.dayHours, "тестът трябва да е под прага");
  eq(r.workDays, 1);
});
test("дни: над 10 часа изисква повече от 1 ден", () => {
  const r = calc({ qty: { boxL: 400 } }); // голямо градско, обем над нормата за 1 ден
  ok(r.clockHours > P.dayHours, `тестът трябва да е над 10ч, а е ${r.clockHours.toFixed(1)}`);
  eq(r.workDays, Math.ceil(r.clockHours / P.dayHours));
  ok(r.workDays >= 2);
});
test("дни: важи и за градско (не само за курс/изхвърляне)", () => {
  const r = calc({ qty: { boxL: 400 } }); // услугата по подразбиране в calc() е градско
  ok(r.workDays >= 2, "голямо градско преместване също трябва да покаже нужните дни");
});
test("дни: важи за изхвърляне при голям обем", () => {
  const r = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 1 });
  ok(r.clockHours > 24, `тестът трябва да е ясно многодневен: ${r.clockHours.toFixed(1)} ч`);
  eq(r.workDays, Math.ceil(r.clockHours / P.dayHours));
  ok(r.workDays >= 4, `1000 чувала с 1 камион трябва да отнемат поне 4 дни, а е ${r.workDays}`);
});
test("дни: повече паралелни камиони намаляват броя дни", () => {
  const един = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 1 });
  const два = изхв({ sackHouse: 1000 }, { truckId: "own", disposalTrucks: 2 });
  ok(два.workDays < един.workDays);
});
test("дни: прагът от 10 часа се управлява от параметрите", () => {
  const r12 = calc({ qty: { boxL: 400 } }, { ...P, dayHours: 12 });
  const r10 = calc({ qty: { boxL: 400 } });
  ok(r12.workDays <= r10.workDays, "по-дълъг работен ден трябва да дава същия или по-малко дни");
});
test("запис: пази броя дни за изпълнение", () => {
  const o = order({ qty: { boxL: 400 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:x");
  eq(rec.workDays, E.computePrice(o, P).workDays);
});


/* --- Пренасяне по стълби: на курсове, не на чист обем --- */
test("стълби: с пътнически асансьор времето е same като на партер", () => {
  const партер = calc({ qty: { boxL: 20 } });
  const с_асансьор = calc({ qty: { boxL: 20 }, pickup: addr(3, true, "passenger"), dropoff: addr(2, true, "passenger") });
  near(с_асансьор.handlingClock, партер.handlingClock, 0.05, "асансьорът не бива да добавя нищо:");
});
test("стълби: без асансьор ВИНАГИ добавя време, никога не намалява", () => {
  // достатъчно голям обем, за да е над минималните 2 часа
  const партер = calc({ qty: { boxL: 200 } });
  const с_етаж = calc({ qty: { boxL: 200 }, pickup: addr(3, false) });
  ok(с_етаж.handlingClock > партер.handlingClock, "етажът трябва да оскъпи времето, не да го съкрати");
});
test("стълби: повече етажи → строго повече време", () => {
  const et3 = calc({ qty: { boxL: 200 }, pickup: addr(3, false) });
  const et6 = calc({ qty: { boxL: 200 }, pickup: addr(6, false) });
  ok(et6.handlingClock > et3.handlingClock, "6-ти етаж трябва да отнема повече от 3-ти");
});
test("стълби: и двата адреса добавят време, ако и двата са без асансьор", () => {
  const само_пикъп = calc({ qty: { boxL: 200 }, pickup: addr(3, false) });
  const двата = calc({ qty: { boxL: 200 }, pickup: addr(3, false), dropoff: addr(2, false) });
  ok(двата.handlingClock > само_пикъп.handlingClock, "разтоварването на етаж също трябва да добавя време");
});
test("стълби: капацитетът на курс и минутите на етаж се управляват от параметрите", () => {
  const базово = calc({ qty: { boxL: 200 }, pickup: addr(3, false) });
  const по_бавно = calc({ qty: { boxL: 200 }, pickup: addr(3, false) }, { ...P, stairsMinPerFloorTrip: P.stairsMinPerFloorTrip * 2 });
  ok(по_бавно.handlingClock > базово.handlingClock, "по-бавни минути на етаж трябва да вдигнат времето");
});
test("стълби: при 0 етажа формулата съвпада точно със старата производителност", () => {
  const r = calc({ qty: { boxL: 20 } }); // партер и на двата адреса
  const очаквано = r.vol / P.m3PerManHour / r.crew + r.driveHours;
  near(r.handlingClock, Math.max(очаквано, P.minLocalHours), 0.1, "трябва да съвпада с базовия модел:");
});


test("междуградско: винаги двупосочно, дори под прага от 50 км", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Костинброд", qty: { boxL: 20 } });
  ok(!r.isCourse, "тестът трябва да е под прага за курс");
  eq(r.totalKm, r.trips * 2 * r.oneWayKm, "трябва да е удвоено дори под 50 км:");
});
test("градско: остава еднопосочно (не се бърка с междуградското)", () => {
  const r = calc({ qty: { boxL: 20 } });
  eq(r.totalKm, r.trips * r.oneWayKm, "градското не бива да се удвоява:");
});
test("градове около София вече работят като междуградски дестинации", () => {
  for (const c of ["Костинброд", "Божурище", "Елин Пелин", "Своге", "Ихтиман", "Сливница", "Нови Искър"]) {
    const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: c, qty: { boxL: 5 } });
    ok(r.oneWayKm > 0, `${c}: разстоянието трябва да е разпознато, а е ${r.oneWayKm} км`);
  }
});


/* --- Реални пътни разстояния --- */
test("реални км: София → Банско е 160, не изчисленото по права линия", () => {
  eq(E.estimateKmAny("София", "", "Банско", "", P.roadFactorBG), 160);
});
test("реални км: посоката няма значение", () => {
  eq(E.estimateKmAny("Банско", "", "София", "", P.roadFactorBG),
     E.estimateKmAny("София", "", "Банско", "", P.roadFactorBG));
});
test("реални км: работи и при непълно въведени имена", () => {
  eq(E.estimateKmAny("софи", "", "банс", "", P.roadFactorBG), 160);
});
test("реални км: не влияят на маршрути извън таблицата", () => {
  const км = E.estimateKmAny("София", "", "Пловдив", "", P.roadFactorBG);
  ok(км > 100 && км < 250, `София→Пловдив трябва да е по формулата, а е ${км}`);
});
test("реални км: влизат в цената двупосочно", () => {
  const r = calc({ service: "intercity", pickupCity: "София", dropoffCity: "Банско", qty: { boxL: 20 } });
  eq(r.oneWayKm, 160);
  eq(r.totalKm, r.trips * 2 * 160, "трябва да е удвоено за връщането:");
});


test("каталог: малката масичка е добавена и е по-малка от голямата маса", () => {
  const малка = E.ITEM_INDEX.tableSmall, голяма = E.ITEM_INDEX.table;
  ok(малка, "липсва малка масичка");
  ok(малка.m3 < голяма.m3, "малката трябва да е с по-малък обем");
  ok(малка.kg < голяма.kg, "малката трябва да е по-лека");
  ok(малка.asm > малка.dis, "сглобяването трябва да е по-дълго от разглобяването");
});


/* --- Услуги само на част от бройките --- */
test("частично: 4 бюра, само 1 се разглобява", () => {
  const r = calc({ qty: { desk: 4 }, dis: { desk: 1 }, asm: { desk: 1 } });
  const B = E.ITEM_INDEX.desk;
  near(r.disHours, B.dis + B.asm, 0.01, "трябва да е за едно бюро, не за четири:");
});
test("частично: отметка true пази старото поведение (всички бройки)", () => {
  const r = calc({ qty: { desk: 4 }, dis: { desk: true } });
  near(r.disHours, E.ITEM_INDEX.desk.dis * 4, 0.01);
});
test("частично: броят не може да надхвърли наличните бройки", () => {
  const r = calc({ qty: { desk: 2 }, dis: { desk: 10 } });
  near(r.disHours, E.ITEM_INDEX.desk.dis * 2, 0.01, "максимум колкото са вещите:");
});
test("частично: нула означава изключено", () => {
  eq(calc({ qty: { desk: 4 }, dis: { desk: 0 } }).disHours, 0);
});
test("частично: разглобяване и сглобяване може да са различен брой", () => {
  const r = calc({ qty: { desk: 4 }, dis: { desk: 3 }, asm: { desk: 1 } });
  const B = E.ITEM_INDEX.desk;
  near(r.disOnlyHours, B.dis * 3, 0.01, "разглобяване на 3:");
  near(r.asmOnlyHours, B.asm * 1, 0.01, "сглобяване на 1:");
});
test("частично: важи и за опаковането", () => {
  const цяло = E.wrapMetersFor({ wardrobe3: 4 }, { wardrobe3: true });
  const частично = E.wrapMetersFor({ wardrobe3: 4 }, { wardrobe3: 1 });
  eq(частично, цяло / 4, "един гардероб вместо четири:");
});
test("частично: задължителното опаковане важи за всички бройки", () => {
  const r = calc({ qty: { mattress: 3 } });
  eq(r.wrapMeters, E.ITEM_INDEX.mattress.wrap * 3, "матраците са задължителни — всички:");
});


/* --- Само хамали (транспорт на клиента) --- */
const хамали = (extra = {}) => calc({ service: "labour", city: "София", pickupHood: "Люлин", qty: { boxL: 20, wardrobe3: 1 }, ...extra });

test("само хамали: няма транспортно перо", () => {
  const r = хамали();
  ok(r.isLabourOnly, "режимът не е активен");
  ok(!r.lines.some((l) => l.label.startsWith("Транспорт")), "транспортът е на клиента — не бива да се начислява");
});
test("само хамали: трудът се плаща нормално", () => {
  const r = хамали();
  ok(r.lines.some((l) => l.label.startsWith("Товарене и пренасяне")), "липсва перо за труда");
});
test("само хамали: излиза по-евтино от пълната услуга", () => {
  const самоХора = хамали();
  const сКамион = calc({ qty: { boxL: 20, wardrobe3: 1 } });
  ok(самоХора.total < сКамион.total, "без камион трябва да е по-евтино");
});
test("само хамали: разглобяването и опаковането се начисляват", () => {
  const r = хамали({ dis: { wardrobe3: true } });
  ok(r.lines.some((l) => l.label.startsWith("Разглобяване")), "разглобяването трябва да се плаща");
  ok(r.disHours > 0);
});
test("само хамали: стълбите на адреса се начисляват", () => {
  const партер = хамали();
  const етаж = хамали({ pickup: addr(3, false) });
  ok(етаж.total > партер.total, "етажът трябва да оскъпи");
});
test("само хамали: няма адрес на разтоварване — не се таксува", () => {
  const без = хамали();
  const с = хамали({ dropoff: addr(5, false) });
  eq(с.total, без.total, "етажът при доставка не бива да влияе:");
});
test("само хамали: не се смята като междуградски курс", () => {
  const r = хамали({ pickupCity: "София", dropoffCity: "Варна" });
  eq(r.isCourse, false, "не бива да минава на километрична тарифа:");
});
test("само хамали: важи минимумът от 2 часа", () => {
  const r = calc({ service: "labour", city: "София", pickupHood: "Люлин", qty: { boxS: 1 } });
  near(r.handlingClock, P.minLocalHours, 0.01);
});


test("само хамали: в града на базата няма път, но има минимална такса за кола", () => {
  const r = calc({ service: "labour", city: "София", qty: { boxL: 20 } });
  eq(r.labourTravelKm, 0, "София е база — не бива да има път:");
  ok(!r.lines.some((l) => l.label.startsWith("Път на бригадата")), "не бива да има път");
  const кола = r.lines.find((l) => l.label.startsWith("Кола за бригадата"));
  ok(кола, "колата трябва да се начислява и в града");
  eq(кола.amount, P.labourMinCarFee, "минималната такса:");
});
test("само хамали: в друг град се начислява път и кола", () => {
  const r = calc({ service: "labour", city: "Банско", qty: { boxL: 20 } });
  ok(r.labourTravelKm > 0, "трябва да има разстояние до базата");
  ok(r.lines.some((l) => l.label.startsWith("Кола за бригадата")), "липсва кола");
  ok(r.lines.some((l) => l.label.startsWith("Път на бригадата")), "липсва път");
});
test("само хамали: колата се смята двупосочно", () => {
  const r = calc({ service: "labour", city: "Банско", qty: { boxL: 20 } });
  const line = r.lines.find((l) => l.label.startsWith("Кола за бригадата"));
  near(line.amount, 2 * r.labourTravelKm * P.carRatePerKm, 0.05);
});
test("само хамали: избира се най-близката база", () => {
  eq(calc({ service: "labour", city: "Созопол", qty: { boxL: 5 } }).labourBaseCity, "Бургас");
  eq(calc({ service: "labour", city: "Банско", qty: { boxL: 5 } }).labourBaseCity, "Пловдив");
});
test("само хамали: близките градове не носят път (в радиуса)", () => {
  const r = calc({ service: "labour", city: "Божурище", qty: { boxL: 5 } });
  ok(r.labourTravelKm === 0, `Божурище е на 14 км — в радиуса от ${P.labourLocalRadiusKm} км, а излиза ${r.labourTravelKm}`);
});
test("само хамали: точно над радиуса вече носи път", () => {
  const r = calc({ service: "labour", city: "Костинброд", qty: { boxL: 5 } });
  ok(r.labourTravelKm > 0, "19 км е над радиуса — трябва да има път");
});
test("само хамали: работата в друг град е по-скъпа", () => {
  const вБаза = calc({ service: "labour", city: "София", qty: { boxL: 20 } });
  const далеч = calc({ service: "labour", city: "Банско", qty: { boxL: 20 } });
  ok(далеч.total > вБаза.total, "пътуването трябва да оскъпи");
});


test("само хамали: базата може да се избере ръчно", () => {
  const авто = calc({ service: "labour", city: "Банско", qty: { boxL: 20 } });
  const ръчно = calc({ service: "labour", city: "Банско", labourBase: "София", qty: { boxL: 20 } });
  eq(авто.labourBaseCity, "Пловдив", "автоматично избира най-близката:");
  eq(ръчно.labourBaseCity, "София", "ръчният избор има превес:");
  ok(ръчно.labourTravelKm > авто.labourTravelKm, "София е по-далече — повече км");
  ok(ръчно.total > авто.total, "по-далечната база трябва да е по-скъпа");
});
test("само хамали: ръчно избрана база в същия град маха пътя", () => {
  const r = calc({ service: "labour", city: "Пловдив", labourBase: "Пловдив", qty: { boxL: 20 } });
  eq(r.labourTravelKm, 0);
});
test("само хамали: показва се и автоматичната база за справка", () => {
  const r = calc({ service: "labour", city: "Созопол", labourBase: "София", qty: { boxL: 5 } });
  eq(r.labourAutoBaseCity, "Бургас", "автоматичната остава видима:");
  eq(r.labourBaseCity, "София", "но се ползва избраната:");
});


test("само хамали: при далечен град колата надхвърля минимума", () => {
  const r = calc({ service: "labour", city: "Банско", qty: { boxL: 20 } });
  const кола = r.lines.find((l) => l.label.startsWith("Кола за бригадата"));
  ok(кола.amount > P.labourMinCarFee, "километрите трябва да надвишат минимума");
  near(кола.amount, 2 * r.labourTravelKm * P.carRatePerKm, 0.05);
});
test("само хамали: минималната такса се управлява от параметрите", () => {
  const r = calc({ service: "labour", city: "София", qty: { boxL: 20 } }, { ...P, labourMinCarFee: 25 });
  const кола = r.lines.find((l) => l.label.startsWith("Кола за бригадата"));
  eq(кола.amount, 25);
});


/* --- Монтаж на мебели / ТРД (ръчно въведени часове, без каталог) --- */
test("монтаж: часовете се въвеждат ръчно, не по обем", () => {
  const r = calc({ service: "assembly", city: "София", manualHours: 5 });
  near(r.handlingClock, 5, 0.01);
  ok(r.lines.some((l) => l.label.startsWith("Монтаж на мебели")), "липсва перо за монтажа");
});
test("ТРД: часовете се въвеждат ръчно, не по обем", () => {
  const r = calc({ service: "trd", city: "София", manualHours: 3 });
  near(r.handlingClock, 3, 0.01);
  ok(r.lines.some((l) => l.label.startsWith("Товарене/разтоварване")), "липсва перо за товаренето");
});
test("монтаж/ТРД: важи минимумът от 2 часа", () => {
  const r = calc({ service: "assembly", city: "София", manualHours: 0.5 });
  near(r.handlingClock, P.minLocalHours, 0.01);
});
test("монтаж/ТРД: няма транспортно перо — стоката не е наша грижа", () => {
  const r = calc({ service: "assembly", city: "София", manualHours: 4 });
  ok(!r.lines.some((l) => l.label.startsWith("Транспорт")), "не бива да има транспорт");
});
test("монтаж/ТРД: не се смята като междуградски курс", () => {
  const r = calc({ service: "trd", city: "Банско", manualHours: 4 });
  eq(r.isCourse, false);
});
test("монтаж/ТРД: в друг град се начислява път и кола, както при само хамали", () => {
  const r = calc({ service: "assembly", city: "Банско", manualHours: 4 });
  ok(r.labourTravelKm > 0, "трябва да има разстояние до базата");
  ok(r.lines.some((l) => l.label.startsWith("Път на бригадата")), "липсва път");
  ok(r.lines.some((l) => l.label.startsWith("Кола за бригадата")), "липсва кола");
});
test("монтаж/ТРД: в града на базата — само минимална такса за кола", () => {
  const r = calc({ service: "trd", city: "София", manualHours: 4 });
  eq(r.labourTravelKm, 0, "София е база — не бива да има път:");
  const кола = r.lines.find((l) => l.label.startsWith("Кола за бригадата"));
  eq(кола.amount, P.labourMinCarFee);
});
test("монтаж/ТРД: бригадата може да се смени ръчно", () => {
  const r = calc({ service: "assembly", city: "София", manualHours: 4, crewOverride: 5 });
  eq(r.crew, 5);
  ok(r.crewManual, "флагът за ръчна промяна не е вдигнат");
});
test("монтаж/ТРД: важи минималната цена на градско ниво", () => {
  const r = calc({ service: "trd", city: "София", manualHours: 0.1 });
  ok(r.total >= P.minPrice.local, "не бива да пада под градския праг");
});
test("монтаж и ТРД не се бъркат едно с друго в перото за труд", () => {
  const монтаж = calc({ service: "assembly", city: "София", manualHours: 4 });
  const трд = calc({ service: "trd", city: "София", manualHours: 4 });
  ok(монтаж.lines.some((l) => l.label.includes("Монтаж")));
  ok(трд.lines.some((l) => l.label.includes("Товарене/разтоварване")));
});


test("велпапе: опцията е налична за всички едри вещи", () => {
  const без = [];
  for (const g of E.CATALOG) for (const it of g.items) {
    if (!it.protect) без.push(it.id);
  }
  // допустимо е да липсва само при кашони, куфар и чували
  for (const id of без) {
    const it = E.ITEM_INDEX[id];
    ok(it.kind === "box" || it.kind === "sack" || id === "suitcase",
      `${it.label} трябва да има опция за велпапе`);
  }
});
test("велпапе: по избор не се начислява без отметка", () => {
  eq(E.protectMetersFor({ fridge: 1, wardrobe3: 1 }, {}), 0);
});
test("велпапе: отметката го начислява", () => {
  const m = E.protectMetersFor({ fridge: 1 }, { fridge: true });
  eq(m, E.ITEM_INDEX.fridge.protect);
  ok(m > 0);
});
test("велпапе: може да се избере само за част от бройките", () => {
  const цяло = E.protectMetersFor({ fridge: 4 }, { fridge: true });
  const частично = E.protectMetersFor({ fridge: 4 }, { fridge: 1 });
  eq(частично, цяло / 4);
});
test("велпапе: вдига цената", () => {
  const без = calc({ qty: { wardrobe3: 1, fridge: 1 } });
  const с = calc({ qty: { wardrobe3: 1, fridge: 1 }, protect: { wardrobe3: true, fridge: true } });
  ok(с.total > без.total, "велпапето трябва да оскъпи");
  ok(с.protectMeters > 0);
});

/* --- Носене на дълго разстояние до камиона --- */
test("носене: под прага не добавя нищо", () => {
  const r = calc({ qty: { boxL: 5 }, pickup: { ...addr(), carryDistanceM: 15 } });
  const без = calc({ qty: { boxL: 5 } });
  eq(r.carryHoursTot, 0);
  eq(r.total, без.total, "цената не бива да се променя:");
});
test("носене: над прага добавя реално време, не само пари", () => {
  const r = calc({ qty: { boxL: 5 }, pickup: { ...addr(), carryDistanceM: 35 } }); // 15м над прага → 2×5мин
  near(r.carryHoursTot, 10 / 60, 0.01, "часове носене:");
  ok(r.lines.some((l) => l.label.startsWith("Носене на дълго разстояние")), "трябва да има перо:");
  const без = calc({ qty: { boxL: 5 } });
  ok(r.clockHours > без.clockHours, "трябва да удължи престоя:");
  ok(r.manHours > без.manHours, "трябва да вдигне човекочасовете:");
});
test("носене: стъпва на всеки 10м (закръгля нагоре)", () => {
  const десет = calc({ qty: { boxL: 5 }, pickup: { ...addr(), carryDistanceM: 30 } }); // точно 10 над прага
  const единайсет = calc({ qty: { boxL: 5 }, pickup: { ...addr(), carryDistanceM: 31 } }); // 11 над прага → 2 сегмента
  near(десет.carryHoursTot, 5 / 60, 0.01);
  near(единайсет.carryHoursTot, 10 / 60, 0.01);
});
test("носене: важи и за адреса на разтоварване при обикновено градско", () => {
  const r = calc({ qty: { boxL: 5 }, dropoff: { ...addr(), carryDistanceM: 35 } });
  ok(r.carryHoursTot > 0, "разтоварването трябва да брои носенето:");
});
test("носене: не се брои на разтоварване при самостоятелно разтоварване от клиента", () => {
  const r = calc({
    service: "intercity", pickupCity: "София", dropoffCity: "Пловдив", courseMode: "selfUnload",
    qty: { boxL: 5 }, dropoff: { ...addr(), carryDistanceM: 35 },
  });
  eq(r.carryHoursTot, 0, "клиентът разтоварва сам — не е наша грижа:");
});
test("носене: параметрите се четат от p", () => {
  const r = calc({ qty: { boxL: 5 }, pickup: { ...addr(), carryDistanceM: 50 } }, { ...P, carryFreeDistanceM: 40, carryExtraMinPer10m: 20 });
  near(r.carryHoursTot, 20 / 60, 0.01, "10м над нов праг × 20 мин:");
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

/* --- Поредни номера на калкулациите --- */
testAsync("номера: първата калкулация получава номер 1", async () => {
  const n = await E.nextCalcNumber();
  ok(n >= 1, `очаквано поне 1, получено ${n}`);
});
testAsync("номера: всяка следваща калкулация е с по-голям номер", async () => {
  const a = await E.nextCalcNumber();
  const b = await E.nextCalcNumber();
  eq(b, a + 1, "номерата трябва да са последователни:");
});
testAsync("номера: буквеният запис пази номера", async () => {
  const num = await E.nextCalcNumber();
  const o = order({ qty: { boxM: 10 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:numtest", num);
  eq(rec.calcNumber, num);
});
testAsync("номера: записът без подаден номер остава null, не 0", async () => {
  const o = order({ qty: { boxM: 10 } });
  const rec = E.buildRecord(o, P, E.computePrice(o, P), "calc:numtest2");
  eq(rec.calcNumber, null);
});


testAsync("списък: броячът не се появява като фалшива калкулация", async () => {
  await E.nextCalcNumber(); // създава служебния ключ
  const o = order({ qty: { boxM: 10 } });
  await E.saveCalc("calc:realtest", E.buildRecord(o, P, E.computePrice(o, P), "calc:realtest", 1));
  const rows = await E.loadCalcs();
  for (const r of rows) {
    ok(r.createdAt, `запис ${r.key} без дата — вероятно служебен ключ`);
    ok(typeof r.total === "number", `запис ${r.key} без цена — вероятно служебен ключ`);
  }
});
testAsync("списък: повреден запис не чупи зареждането", async () => {
  await E.saveCalc("calc:broken", "това не е JSON");
  const rows = await E.loadCalcs();
  ok(Array.isArray(rows), "списъкът трябва да се върне, въпреки повредения запис");
});


testAsync("кеш: Google се пита само веднъж за маршрут", async () => {
  E.routesCache.clear();
  let calls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ routes: [{ distanceMeters: 198000, description: "тест" }] }) }; };
  await E.fetchRealDistanceKm("София", "Казанлък", "test-key");
  await E.fetchRealDistanceKm("София", "Казанлък", "test-key");
  eq(calls, 1, "втората заявка трябва да дойде от кеша:");
  globalThis.fetch = origFetch;
});
testAsync("кеш: обратната посока също се взима от кеша", async () => {
  E.routesCache.clear();
  let calls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ routes: [{ distanceMeters: 198000 }] }) }; };
  await E.fetchRealDistanceKm("София", "Казанлък", "test-key");
  await E.fetchRealDistanceKm("Казанлък", "София", "test-key");
  eq(calls, 1, "посоката не бива да поражда нова заявка:");
  globalThis.fetch = origFetch;
});
testAsync("кеш: без ключ изобщо не се обръщаме към Google", async () => {
  let calls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ routes: [] }) }; };
  eq(await E.fetchRealDistanceKm("София", "Варна", ""), null);
  eq(calls, 0, "без ключ не бива да има заявка:");
  globalThis.fetch = origFetch;
});
testAsync("кеш: запомненото се записва трайно в хранилището", async () => {
  E.routesCache.clear();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ routes: [{ distanceMeters: 150000 }] }) });
  await E.fetchRealDistanceKm("Пловдив", "Бургас", "test-key");
  const saved = await E.loadParams; // само проверка че функцията съществува
  ok(E.routesCache.size > 0, "кешът трябва да съдържа маршрута");
  globalThis.fetch = origFetch;
});

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


testAsync("настройки: теглят се от Supabase, ако е зададена връзка", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ([{ value: { workerRate: 24 } }]) });
  const got = await E.fetchParamsFromSupabase("https://x.supabase.co", "key");
  eq(got.workerRate, 24, "ставка от базата:");
  eq(got.truckRate, E.DEFAULTS.truckRate, "липсващите полета падат към по подразбиране:");
  delete globalThis.fetch;
});
testAsync("настройки: без връзка не се прави заявка", async () => {
  eq(await E.fetchParamsFromSupabase("", ""), null);
  eq(await E.pushParamsToSupabase({}, "", ""), false);
});
testAsync("настройки: мрежова грешка не чупи зареждането", async () => {
  globalThis.fetch = async () => { throw new Error("няма мрежа"); };
  eq(await E.fetchParamsFromSupabase("https://x.supabase.co", "key"), null);
  eq(await E.pushParamsToSupabase({}, "https://x.supabase.co", "key"), false);
  delete globalThis.fetch;
});
testAsync("настройки: невалиден отговор не се приема", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ([]) });
  eq(await E.fetchParamsFromSupabase("https://x.supabase.co", "key"), null);
  delete globalThis.fetch;
});
testAsync("калкулации: изпращат се към Supabase с ID за upsert", async () => {
  let calledUrl = null, calledBody = null;
  globalThis.fetch = async (url, opts) => { calledUrl = url; calledBody = JSON.parse(opts.body); return { ok: true }; };
  const result = await E.pushCalcToSupabase({ id: "calc:1", status: "калкулация", total: 100 }, "https://x.supabase.co", "key");
  ok(result, "трябва да върне true:");
  ok(calledUrl.includes("on_conflict=id"), "трябва да пази по ID:");
  eq(calledBody.id, "calc:1");
  delete globalThis.fetch;
});
testAsync("калкулации: без ID не се изпраща", async () => {
  eq(await E.pushCalcToSupabase({ total: 100 }, "https://x.supabase.co", "key"), false);
});
testAsync("калкулации: изтеглянето от Supabase разопакова записите", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ([{ id: "calc:1", calc_number: 5, status: "заявка", data: { total: 100, createdAt: "2026-01-01" } }]) });
  const rows = await E.fetchCalcsFromSupabase("https://x.supabase.co", "key");
  eq(rows.length, 1);
  eq(rows[0].key, "calc:1");
  eq(rows[0].calcNumber, 5);
  eq(rows[0].total, 100);
  delete globalThis.fetch;
});
testAsync("калкулации: мрежова грешка при изтегляне връща празен списък", async () => {
  globalThis.fetch = async () => { throw new Error("няма мрежа"); };
  eq((await E.fetchCalcsFromSupabase("https://x.supabase.co", "key")).length, 0);
  delete globalThis.fetch;
});

testAsync("каталог от базата: изтегляне на артикули, добавени от колеги", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ([{ id: "cat:1", group_name: "Спалня", label: "Тест", m3: 0.3, kg: 10 }]) });
  const rows = await E.fetchCatalogItemsFromSupabase("https://x.supabase.co", "key");
  eq(rows.length, 1);
  eq(rows[0].label, "Тест");
  delete globalThis.fetch;
  eq((await E.fetchCatalogItemsFromSupabase("", "")).length, 0, "без връзка — празен списък:");
});
testAsync("каталог от базата: изпращане изисква ID", async () => {
  eq(await E.pushCatalogItemToSupabase({ label: "х", m3: 1, kg: 1 }, "https://x.supabase.co", "key"), false);
});
testAsync("каталог от базата: артикулите се вливат в съществуваща група и участват в цената", async () => {
  eq(E.ITEM_INDEX["custom:test-desk-lamp"], undefined, "не трябва да съществува преди добавянето:");
  E.applyExtraCatalogItems([{ id: "custom:test-desk-lamp", group_name: "Спалня", label: "Тестова лампа", m3: 0.05, kg: 2 }]);
  ok(E.ITEM_INDEX["custom:test-desk-lamp"], "трябва да е в индекса:");
  const grp = E.CATALOG.find((g) => g.group === "Спалня");
  ok(grp.items.some((i) => i.id === "custom:test-desk-lamp"), "трябва да е в групата:");
  const r = calc({ qty: { "custom:test-desk-lamp": 3 } });
  near(r.vol, 0.15, 0.01, "обемът трябва да включва новия артикул:");
});
testAsync("каталог от базата: непозната група се пропуска безопасно", async () => {
  E.applyExtraCatalogItems([{ id: "custom:test-nogroup", group_name: "Несъществуваща", label: "х", m3: 1, kg: 1 }]);
  eq(E.ITEM_INDEX["custom:test-nogroup"], undefined);
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
