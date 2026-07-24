import React, { useState, useMemo, useEffect, useRef } from "react";

/* ================================================================== *
 *  КОРЕКТ — Калкулатор за приблизителна цена (v4)
 *  Обем (списък вещи) → часове труд + брой курсове (вместимост камион)
 *  → труд (€/ч) + транспорт. Транспортът смята разстоянието ДВУПОСОЧНО
 *  и времето за път. Извънградско/международно ползва и партньорски
 *  камиони. Всички параметри се сменят живо от „⚙ Параметри".
 * ================================================================== */

const DEFAULTS = {
  currency: "€",

  workerRate: 18,        // €/час на работник
  truckRate: 20,         // €/час транспорт (за градско)
  kmRate: 0.7,           // €/км за извънградско (собствен камион)
  roundTripFactor: 2,    // курсът е двупосочен (отиване + връщане)
  intercityThresholdKm: 50, // над това (еднопосочно) = междуградски курс
  loadHours: 1,          // включено товарене на курс (междуградско+)
  workerDayRate: 144,    // € на ден за придружаващ работник (при пътуваща бригада)
  travelCrew: 1,         // души извън шофьора, които пътуват с камиона
  dayHours: 10,          // часове, след които се брои втори работен ден
  localCrewSize: 2,      // души от местната база, които помагат при разтоварване
  localCrewMinHours: 2,  // минимум таксувана работа на местния екип
  minCrewHours: 2,       // минимум за всяка изпратена бригада (товарене/разтоварване)
  carRatePerKm: 0.3,     // €/км за кола, ако базата не е на маршрута
  routeDetourTolerance: 1.1, // до 10% отклонение се брои "по маршрута"
  overnightThresholdH: 8,// работа + път в едната посока над това → нощувка
  overnightPrice: 40,    // € за нощувка на човек
  unloadHours: 1,        // включено разтоварване на курс

  citySpeed: 30,         // км/ч — средна скорост в града (за времето за път)
  roadSpeed: 65,         // км/ч — средна скорост извън града

  // Собствен камион (метри)
  truck: { l: 4, w: 2, h: 2, payloadKg: 1500 }, // бус до 1.5 т
  fillFactor: 0.85,      // реално полезно запълване

  // Партньорски камиони (за междуградско/международно)
  partnerTrucks: [
    { id: "p20", name: "Партньор 20 м³", capacity: 20, payloadKg: 3500 },
    { id: "p45", name: "Партньор 45 м³ (TIR)", capacity: 45, kmRate: 0.9, payloadKg: 24000 },
  ],

  m3PerManHour: 1.6,     // производителност (пълен цикъл, на работник)
  minLocalHours: 2,      // МИН градско: 2 ч труд И 2 ч транспорт
  cityRoadFactor: 1.3,   // коеф. прав път → шосеен, в рамките на града
  defaultTownKm: 4,      // приблизително разстояние в град без описани квартали
  roadFactorBG: 1.25,    // коеф. прав път → шосеен, между градове

  // Стълби без асансьор — такси на етаж без асансьор, на адрес (товарене + разтоварване)
  floorFeeNoElevator: 0, // €/етаж плоска база (изкл. — пробваме per-кашон)
  boxPerFloor: 0.3,      // €/етаж на кашон без асансьор
  appliancePerFloor: 3,  // €/етаж на нормален уред (пералня/хладилник)
  heavyAppliancePerFloor: 5, // €/етаж на нестандартен уред (двуврат хлад., Miele)

  // Разглобяване/сглобяване и опаковане
  disFactor: 1,           // коеф. върху времето за разглобяване/сглобяване по вещ
  disCrew: 2,             // души, които работят по разглобяването (времената са реални часове)
  stretchRollM: 150,      // метри в една ролка стреч (типична мини ролка)
  stretchRollPrice: 7,    // € за ролка стреч
  wrapMPerManHour: 40,    // метри опаковане на човекочас (10 м ≈ 15 мин)

  minPrice: { local: 80, international: 450 }, // междуградското НЯМА минимум — цената е по километри

  crewTiers: [
    { maxM3: 8, crew: 2 },
    { maxM3: 22, crew: 3 },
    { maxM3: 999, crew: 4 },
  ],

  bgDistances: {
    Пловдив: 150, Варна: 470, Бургас: 385, "Стара Загора": 230,
    "Велико Търново": 220, Русе: 300, Плевен: 170, Шумен: 380,
    Благоевград: 100, Хасково: 240, Ямбол: 300, Сливен: 300,
  },
  euDistances: {
    Германия: 1500, Австрия: 1100, Италия: 1100, Нидерландия: 1900,
    Белгия: 2000, Франция: 2000, Гърция: 500, Румъния: 300,
    Чехия: 1300, Полша: 1300, Испания: 2800, Швеция: 2200,
  },

  sheetEndpoint: "",     // URL на Apps Script уеб приложението (Google Sheet база)

  phone: "0700 1 4485",
  phoneHref: "tel:+35970014485",
};

/* -------- Каталог с вещи -------- */
const CATALOG = [
  { group: "Хол и трапезария", items: [
    { id: "sofa2", label: "Диван 2-местен", m3: 1.4, kg: 45, wrap: 10 },
    { id: "sofa3", label: "Диван 3-местен", m3: 2.0, kg: 60, dis: 0.4, asm: 0.4, wrap: 12, kind: "oversized" },
    { id: "sofaL", label: "Ъглов диван", m3: 3.0, kg: 90, dis: 0.6, asm: 0.7, wrap: 16, kind: "oversized" },
    { id: "armchair", label: "Фотьойл", m3: 0.8, kg: 25, wrap: 6 },
    { id: "tvstand", label: "ТВ + стойка", m3: 0.4, kg: 20, dis: 0.2, asm: 0.25, wrap: 5 },
    { id: "vitrine", label: "Витрина", m3: 1.0, kg: 50, dis: 0.5, asm: 0.6, wrap: 10 },
    { id: "table", label: "Маса за хранене", m3: 0.7, kg: 30, dis: 0.3, asm: 0.4, wrap: 8 },
    { id: "chair", label: "Стол", m3: 0.15, kg: 5, wrap: 3 },
    { id: "shelf", label: "Библиотека / етажерка", m3: 0.8, kg: 35, dis: 0.4, asm: 0.5, wrap: 8 },
  ]},
  { group: "Спалня", items: [
    { id: "bedSingle", label: "Единично легло", m3: 1.0, kg: 40, dis: 0.5, asm: 0.6, wrap: 8 },
    { id: "bedDouble", label: "Двойно легло (рамка + матрак)", m3: 2.0, kg: 70, dis: 0.7, asm: 0.8, wrap: 12, wrapReq: true },
    { id: "mattress", label: "Матрак", m3: 0.6, kg: 25, wrap: 12, wrapReq: true },
    { id: "wardrobe2", label: "Гардероб 2-крилен", m3: 1.2, kg: 70, dis: 1.0, asm: 1.0, wrap: 8 },
    { id: "wardrobe3", label: "Гардероб 3-крилен", m3: 1.8, kg: 110, dis: 1.5, asm: 1.5, wrap: 10 },
    { id: "dresser", label: "Скрин / шкаф", m3: 0.6, kg: 40, dis: 0.4, asm: 0.5, wrap: 8 },
    { id: "nightstand", label: "Нощно шкафче", m3: 0.2, kg: 12, wrap: 4 },
    { id: "desk", label: "Бюро", m3: 0.6, kg: 30, dis: 0.4, asm: 0.5, wrap: 8 },
  ]},
  { group: "Уреди", items: [
    { id: "fridge", label: "Хладилник", m3: 0.6, kg: 60, wrap: 10, wrapReq: true, kind: "appliance" },
    { id: "fridgeXL", label: "Хладилник голям (American)", m3: 1.0, kg: 90, wrap: 14, wrapReq: true, kind: "appliance" },
    { id: "freezer", label: "Фризер", m3: 0.5, kg: 50, wrap: 9, wrapReq: true, kind: "appliance" },
    { id: "washer", label: "Пералня", m3: 0.4, kg: 70, wrap: 8, wrapReq: true, kind: "appliance" },
    { id: "dishwasher", label: "Съдомиялна", m3: 0.4, kg: 45, wrap: 8, wrapReq: true, kind: "appliance" },
    { id: "stove", label: "Готварска печка", m3: 0.4, kg: 45, wrap: 8, wrapReq: true, kind: "appliance" },
    { id: "fridgeSxS", label: "Хладилник двуврат (side-by-side)", m3: 1.2, kg: 120, wrap: 16, wrapReq: true, kind: "appliance_heavy", minCrew: 4 },
    { id: "washerMiele", label: "Пералня Miele", m3: 0.4, kg: 85, wrap: 8, wrapReq: true, kind: "appliance_heavy" },
    { id: "microwave", label: "Микровълнова", m3: 0.1, kg: 15, wrap: 3, wrapReq: true },
    { id: "ac", label: "Климатик (двете тела)", m3: 0.3, kg: 35, wrap: 4, wrapReq: true },
    { id: "boiler", label: "Бойлер", m3: 0.3, kg: 30, wrap: 4, wrapReq: true },
  ]},
  { group: "Кашони и дребни", items: [
    { id: "boxS", label: "Кашон малък", m3: 0.06, kg: 8, kind: "box" },
    { id: "boxM", label: "Кашон среден", m3: 0.1, kg: 12, kind: "box" },
    { id: "boxL", label: "Кашон голям", m3: 0.15, kg: 18, kind: "box" },
    { id: "books", label: "Кашон с книги", m3: 0.06, kg: 25, kind: "box" },
    { id: "suitcase", label: "Куфар / чувал", m3: 0.1, kg: 15 },
    { id: "bike", label: "Велосипед", m3: 0.4, kg: 12, wrap: 6 },
    { id: "art", label: "Огледало / картина", m3: 0.15, kg: 5, wrap: 3 },
  ]},
  { group: "Специални (спец. обработка)", items: [
    { id: "piano", label: "Пиано (пианино)", m3: 1.5, kg: 250, wrap: 16, surcharge: 150 },
    { id: "grand", label: "Роял", m3: 2.5, kg: 400, wrap: 20, surcharge: 250 },
    { id: "safe", label: "Каса / банкомат", m3: 0.5, kg: 300, wrap: 8, surcharge: 200 },
    { id: "gym", label: "Спортен уред (пътека)", m3: 0.8, kg: 60, dis: 0.5, asm: 0.6, wrap: 8 },
  ]},
];
const ITEM_INDEX = Object.fromEntries(CATALOG.flatMap((g) => g.items).map((i) => [i.id, i]));
const totalVolume = (qty) => Object.entries(qty).reduce((s, [id, cnt]) => s + (ITEM_INDEX[id]?.m3 || 0) * cnt, 0);
// часове за разглобяване и за сглобяване (по отделни отметки на вещ)
const disHoursFor = (qty, dis, asm, factor) => {
  let d = 0, a = 0;
  for (const [id, cnt] of Object.entries(qty)) {
    const it = ITEM_INDEX[id];
    if (!it || !cnt) continue;
    if (dis?.[id] && it.dis) d += it.dis * cnt;
    if (asm?.[id] && it.asm) a += it.asm * cnt;
  }
  const k = factor || 1;
  return { dis: d * k, asm: a * k, total: (d + a) * k };
};

// метри стреч фолио: задължителните вещи винаги, останалите — по избор
const wrapMetersFor = (qty, wrap) =>
  Object.entries(qty).reduce((s, [id, cnt]) => {
    const it = ITEM_INDEX[id];
    if (!it?.wrap || !cnt) return s;
    const on = it.wrapReq || wrap?.[id];
    return on ? s + it.wrap * cnt : s;
  }, 0);
const totalWeight = (qty) =>
  Object.entries(qty).reduce((s, [id, cnt]) => s + (ITEM_INDEX[id]?.kg || 0) * cnt, 0);
const countKind = (qty, kind) => Object.entries(qty).reduce((s, [id, cnt]) => s + (ITEM_INDEX[id]?.kind === kind ? cnt : 0), 0);

/* -------- Квартали с приблизителни координати (за оценка на км) -------- */
const NEIGHBORHOODS = {
  "София": [
    { name: "Център", lat: 42.697, lng: 23.322 },
    { name: "Лозенец", lat: 42.674, lng: 23.328 },
    { name: "Изгрев", lat: 42.667, lng: 23.355 },
    { name: "Изток", lat: 42.671, lng: 23.352 },
    { name: "Младост", lat: 42.650, lng: 23.377 },
    { name: "Дружба", lat: 42.660, lng: 23.400 },
    { name: "Студентски град", lat: 42.650, lng: 23.345 },
    { name: "Слатина", lat: 42.690, lng: 23.360 },
    { name: "Подуяне", lat: 42.710, lng: 23.345 },
    { name: "Хаджи Димитър", lat: 42.715, lng: 23.355 },
    { name: "Надежда", lat: 42.730, lng: 23.300 },
    { name: "Банишора", lat: 42.715, lng: 23.310 },
    { name: "Люлин", lat: 42.719, lng: 23.245 },
    { name: "Връбница", lat: 42.735, lng: 23.255 },
    { name: "Обеля", lat: 42.744, lng: 23.269 },
    { name: "Овча купел", lat: 42.680, lng: 23.253 },
    { name: "Красна поляна", lat: 42.700, lng: 23.270 },
    { name: "Красно село", lat: 42.685, lng: 23.290 },
    { name: "Хиподрума", lat: 42.688, lng: 23.297 },
    { name: "Иван Вазов", lat: 42.680, lng: 23.310 },
    { name: "Стрелбище", lat: 42.670, lng: 23.300 },
    { name: "Манастирски ливади", lat: 42.660, lng: 23.300 },
    { name: "Гоце Делчев", lat: 42.665, lng: 23.290 },
    { name: "Витоша", lat: 42.647, lng: 23.313 },
    { name: "Драгалевци", lat: 42.635, lng: 23.318 },
    { name: "Симеоново", lat: 42.630, lng: 23.345 },
    { name: "Бояна", lat: 42.645, lng: 23.265 },
    { name: "Банкя", lat: 42.707, lng: 23.145 },
    { name: "Дървеница", lat: 42.652, lng: 23.348 },
    { name: "Мусагеница", lat: 42.657, lng: 23.350 },
    { name: "Дианабад", lat: 42.665, lng: 23.345 },
    { name: "Малинова долина", lat: 42.640, lng: 23.355 },
    { name: "Кръстова вада", lat: 42.655, lng: 23.325 },
    { name: "Гърдова глава", lat: 42.660, lng: 23.310 },
    { name: "Гео Милев", lat: 42.680, lng: 23.355 },
    { name: "Редута", lat: 42.685, lng: 23.355 },
    { name: "Христо Смирненски", lat: 42.675, lng: 23.345 },
    { name: "Яворов", lat: 42.688, lng: 23.345 },
    { name: "Оборище", lat: 42.700, lng: 23.340 },
    { name: "Сердика", lat: 42.710, lng: 23.325 },
    { name: "Полигона", lat: 42.670, lng: 23.360 },
    { name: "Сухата река", lat: 42.715, lng: 23.360 },
    { name: "Малашевци", lat: 42.725, lng: 23.365 },
    { name: "Орландовци", lat: 42.720, lng: 23.330 },
    { name: "Илиянци", lat: 42.740, lng: 23.330 },
    { name: "Военна рампа", lat: 42.725, lng: 23.310 },
    { name: "Фондови жилища", lat: 42.720, lng: 23.315 },
    { name: "Захарна фабрика", lat: 42.705, lng: 23.290 },
    { name: "Разсадника", lat: 42.705, lng: 23.295 },
    { name: "Илинден", lat: 42.710, lng: 23.295 },
    { name: "Западен парк", lat: 42.700, lng: 23.285 },
    { name: "Факултета", lat: 42.700, lng: 23.280 },
    { name: "Модерно предградие", lat: 42.725, lng: 23.280 },
    { name: "Толстой", lat: 42.735, lng: 23.290 },
    { name: "Свобода", lat: 42.740, lng: 23.310 },
    { name: "Бенковски", lat: 42.755, lng: 23.320 },
    { name: "Требич", lat: 42.760, lng: 23.300 },
    { name: "Филиповци", lat: 42.715, lng: 23.220 },
    { name: "Славия", lat: 42.690, lng: 23.290 },
    { name: "Лагера", lat: 42.680, lng: 23.295 },
    { name: "Белите брези", lat: 42.680, lng: 23.288 },
    { name: "Борово", lat: 42.675, lng: 23.300 },
    { name: "Мотописта", lat: 42.670, lng: 23.305 },
    { name: "Бъкстон", lat: 42.675, lng: 23.285 },
    { name: "Павлово", lat: 42.670, lng: 23.270 },
    { name: "Княжево", lat: 42.660, lng: 23.260 },
    { name: "Горубляне", lat: 42.640, lng: 23.410 },
    { name: "Враждебна", lat: 42.720, lng: 23.430 },
    { name: "Бусманци", lat: 42.670, lng: 23.450 },
    { name: "Челопечене", lat: 42.735, lng: 23.450 },
    { name: "Ботунец", lat: 42.740, lng: 23.470 },
    { name: "Кремиковци", lat: 42.750, lng: 23.470 },
    { name: "Сеславци", lat: 42.745, lng: 23.440 },
    { name: "Нови Искър", lat: 42.810, lng: 23.340 },
    { name: "Божурище", lat: 42.750, lng: 23.200 },
    { name: "Костинброд", lat: 42.810, lng: 23.210 },
    { name: "Елин Пелин", lat: 42.670, lng: 23.600 },
    { name: "Самоков", lat: 42.340, lng: 23.550 },
    { name: "Ботевград", lat: 42.900, lng: 23.790 },
    { name: "Своге", lat: 42.960, lng: 23.350 },
    { name: "Ихтиман", lat: 42.430, lng: 23.820 },
    { name: "Сливница", lat: 42.850, lng: 23.040 },
    { name: "с. Панчарево", lat: 42.600, lng: 23.410 },
    { name: "с. Бистрица", lat: 42.620, lng: 23.390 },
    { name: "с. Владая", lat: 42.630, lng: 23.240 },
    { name: "с. Долни Богров", lat: 42.710, lng: 23.470 },
    { name: "с. Казичене", lat: 42.660, lng: 23.450 },
    { name: "с. Герман", lat: 42.630, lng: 23.420 },
    { name: "с. Мърчаево", lat: 42.600, lng: 23.250 },
  ],
  "Пловдив": [
    { name: "Център", lat: 42.144, lng: 24.749 },
    { name: "Кършияка", lat: 42.160, lng: 24.745 },
    { name: "Тракия", lat: 42.140, lng: 24.790 },
    { name: "Смирненски", lat: 42.130, lng: 24.730 },
    { name: "Кючук Париж", lat: 42.130, lng: 24.745 },
    { name: "Южен", lat: 42.128, lng: 24.755 },
    { name: "Западен", lat: 42.145, lng: 24.720 },
    { name: "Каменица", lat: 42.150, lng: 24.760 },
    { name: "Гагарин", lat: 42.135, lng: 24.775 },
    { name: "Прослав", lat: 42.130, lng: 24.680 },
    { name: "Коматево", lat: 42.100, lng: 24.730 },
    { name: "Остромила", lat: 42.115, lng: 24.730 },
    { name: "Асеновград", lat: 42.020, lng: 24.870 },
    { name: "Стамболийски", lat: 42.130, lng: 24.530 },
    { name: "Куклен", lat: 42.030, lng: 24.780 },
    { name: "с. Марково", lat: 42.090, lng: 24.700 },
    { name: "с. Първенец", lat: 42.080, lng: 24.650 },
    { name: "с. Царацово", lat: 42.200, lng: 24.680 },
    { name: "с. Труд", lat: 42.240, lng: 24.720 },
    { name: "с. Костиево", lat: 42.160, lng: 24.600 },
    { name: "с. Браниполе", lat: 42.080, lng: 24.770 },
  ],
  "Варна": [
    { name: "Център", lat: 43.207, lng: 27.914 },
    { name: "Гръцка махала", lat: 43.205, lng: 27.920 },
    { name: "Чайка", lat: 43.215, lng: 27.920 },
    { name: "Левски", lat: 43.220, lng: 27.910 },
    { name: "Възраждане", lat: 43.225, lng: 27.895 },
    { name: "Трошево", lat: 43.215, lng: 27.900 },
    { name: "Младост", lat: 43.235, lng: 27.870 },
    { name: "Вл. Варненчик", lat: 43.230, lng: 27.850 },
    { name: "Кайсиева градина", lat: 43.240, lng: 27.865 },
    { name: "Аспарухово", lat: 43.180, lng: 27.905 },
    { name: "Галата", lat: 43.160, lng: 27.910 },
    { name: "Виница", lat: 43.240, lng: 27.960 },
    { name: "Аксаково", lat: 43.260, lng: 27.820 },
    { name: "Белослав", lat: 43.190, lng: 27.700 },
    { name: "Игнатиево", lat: 43.280, lng: 27.790 },
    { name: "Девня", lat: 43.220, lng: 27.570 },
    { name: "с. Тополи", lat: 43.220, lng: 27.850 },
    { name: "с. Каменар", lat: 43.250, lng: 27.930 },
    { name: "с. Звездица", lat: 43.150, lng: 27.850 },
    { name: "с. Константиново", lat: 43.150, lng: 27.800 },
  ],
  "Бургас": [
    { name: "Център", lat: 42.494, lng: 27.472 },
    { name: "Възраждане", lat: 42.500, lng: 27.465 },
    { name: "Лазур", lat: 42.500, lng: 27.480 },
    { name: "Зорница", lat: 42.510, lng: 27.475 },
    { name: "Изгрев", lat: 42.515, lng: 27.465 },
    { name: "Славейков", lat: 42.520, lng: 27.460 },
    { name: "Меден рудник", lat: 42.470, lng: 27.440 },
    { name: "Долно Езерово", lat: 42.520, lng: 27.420 },
    { name: "Сарафово", lat: 42.560, lng: 27.520 },
    { name: "Крайморие", lat: 42.440, lng: 27.480 },
    { name: "Айтос", lat: 42.700, lng: 27.250 },
    { name: "Камено", lat: 42.570, lng: 27.300 },
    { name: "Българово", lat: 42.510, lng: 27.290 },
    { name: "с. Равнец", lat: 42.510, lng: 27.280 },
    { name: "с. Банево", lat: 42.550, lng: 27.400 },
    { name: "с. Маринка", lat: 42.420, lng: 27.420 },
    { name: "с. Твърдица", lat: 42.420, lng: 27.450 },
  ],
  "Стара Загора": [
    { name: "Център", lat: 42.425, lng: 25.635 },
    { name: "Три чучура", lat: 42.435, lng: 25.640 },
    { name: "Казански", lat: 42.430, lng: 25.650 },
    { name: "Зора", lat: 42.420, lng: 25.625 },
    { name: "Самара", lat: 42.410, lng: 25.645 },
    { name: "Железник", lat: 42.415, lng: 25.610 },
    { name: "Голеш", lat: 42.440, lng: 25.620 },
    { name: "с. Богомилово", lat: 42.400, lng: 25.580 },
    { name: "с. Хрищени", lat: 42.400, lng: 25.680 },
    { name: "с. Малка Верея", lat: 42.420, lng: 25.550 },
    { name: "с. Кирилово", lat: 42.380, lng: 25.600 },
    { name: "с. Калояновец", lat: 42.350, lng: 25.700 },
  ],
  "Велико Търново": [
    { name: "Център", lat: 43.081, lng: 25.629 },
    { name: "Чолаковци", lat: 43.095, lng: 25.610 },
    { name: "Бузлуджа", lat: 43.070, lng: 25.640 },
    { name: "Картала", lat: 43.090, lng: 25.650 },
    { name: "Акация", lat: 43.075, lng: 25.620 },
    { name: "Асенов", lat: 43.085, lng: 25.655 },
    { name: "Дебелец", lat: 43.050, lng: 25.630 },
    { name: "Килифарево", lat: 42.990, lng: 25.630 },
    { name: "с. Самоводене", lat: 43.130, lng: 25.600 },
    { name: "с. Ресен", lat: 43.230, lng: 25.550 },
    { name: "с. Леденик", lat: 43.100, lng: 25.550 },
    { name: "с. Шемшево", lat: 43.100, lng: 25.570 },
  ],
  "Русе": [
    { name: "Център", lat: 43.849, lng: 25.954 },
    { name: "Здравец", lat: 43.835, lng: 25.960 },
    { name: "Възраждане", lat: 43.845, lng: 25.940 },
    { name: "Ялта", lat: 43.830, lng: 25.950 },
    { name: "Дружба", lat: 43.820, lng: 25.955 },
    { name: "Чародейка", lat: 43.815, lng: 25.965 },
    { name: "Средна кула", lat: 43.860, lng: 25.910 },
    { name: "Мартен", lat: 43.900, lng: 26.050 },
    { name: "с. Николово", lat: 43.830, lng: 26.000 },
    { name: "с. Червена вода", lat: 43.750, lng: 26.050 },
    { name: "с. Басарбово", lat: 43.790, lng: 25.980 },
    { name: "с. Просена", lat: 43.750, lng: 26.000 },
  ],
  "Плевен": [
    { name: "Център", lat: 43.417, lng: 24.617 },
    { name: "Мара Денчева", lat: 43.425, lng: 24.610 },
    { name: "Сторгозия", lat: 43.410, lng: 24.590 },
    { name: "Дружба", lat: 43.400, lng: 24.630 },
    { name: "Кайлъка", lat: 43.395, lng: 24.605 },
    { name: "с. Ясен", lat: 43.450, lng: 24.550 },
    { name: "с. Гривица", lat: 43.400, lng: 24.680 },
    { name: "с. Тученица", lat: 43.370, lng: 24.620 },
    { name: "с. Върбица", lat: 43.450, lng: 24.680 },
    { name: "с. Николаево", lat: 43.480, lng: 24.620 },
  ],
  "Шумен": [
    { name: "Център", lat: 43.271, lng: 26.936 },
    { name: "Тракия", lat: 43.265, lng: 26.950 },
    { name: "Боян Българанов", lat: 43.280, lng: 26.925 },
    { name: "Добруджански", lat: 43.275, lng: 26.945 },
    { name: "Военно училище", lat: 43.260, lng: 26.930 },
    { name: "Дивдядово", lat: 43.240, lng: 26.950 },
    { name: "Царев брод", lat: 43.320, lng: 26.850 },
    { name: "с. Мадара", lat: 43.280, lng: 27.110 },
    { name: "с. Ивански", lat: 43.200, lng: 27.000 },
    { name: "с. Струйно", lat: 43.270, lng: 27.000 },
  ],
  "Перник": [
    { name: "Център", lat: 42.605, lng: 23.037 },
    { name: "Изток", lat: 42.610, lng: 23.055 },
    { name: "Мошино", lat: 42.615, lng: 23.020 },
    { name: "Църква", lat: 42.620, lng: 23.030 },
    { name: "Калкас", lat: 42.595, lng: 23.000 },
    { name: "Тева", lat: 42.590, lng: 23.045 },
    { name: "Хумни дол", lat: 42.600, lng: 23.060 },
    { name: "Драгановец", lat: 42.615, lng: 23.045 },
    { name: "Твърди ливади", lat: 42.598, lng: 23.043 },
    { name: "Радомир", lat: 42.545, lng: 22.965 },
    { name: "Батановци", lat: 42.590, lng: 22.955 },
    { name: "Брезник", lat: 42.740, lng: 22.905 },
    { name: "с. Рударци", lat: 42.630, lng: 23.070 },
    { name: "с. Кладница", lat: 42.620, lng: 23.085 },
    { name: "с. Драгичево", lat: 42.640, lng: 23.075 },
    { name: "с. Дивотино", lat: 42.665, lng: 23.010 },
  ],
};
function haversineKm(a, b) {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
// нормализация: маха "кв.", "ж.к.", "с.", "гр.", регистър и излишни интервали
function normHood(x) {
  return String(x || "").toLowerCase().trim()
    .replace(/^(кв\.?|ж\.?к\.?|жк|с\.?|гр\.?)\s+/i, "")
    .replace(/\s+/g, " ");
}
function findHood(city, name) {
  const list = NEIGHBORHOODS[city];
  if (!list || !name) return null;
  const q = normHood(name);
  if (!q) return null;
  return (
    list.find((x) => normHood(x.name) === q) ||
    list.find((x) => normHood(x.name).startsWith(q)) ||
    list.find((x) => normHood(x.name).includes(q)) ||
    null
  );
}
function cityCenter(city) {
  const list = NEIGHBORHOODS[city];
  if (list) return list.find((x) => x.name === "Център") || list[0];
  return (typeof CITIES !== "undefined" && CITIES[city]) ? CITIES[city] : null;
}
// Непознат квартал НЕ блокира: смята се спрямо центъра на града.
function estimateKm(city, aName, bName, roadFactor) {
  const list = NEIGHBORHOODS[city];
  if (!list || !aName || !bName) return null;
  const center = cityCenter(city);
  const a = findHood(city, aName) || center;
  const b = findHood(city, bName) || center;
  if (!a || !b) return null;
  return Math.max(2, Math.round(haversineKm(a, b) * roadFactor));
}

/* -------- helpers -------- */

/* -------- Градове в България (координати за изчисление на разстояния) ------- */
const CITIES = {
  "София": { lat: 42.697, lng: 23.322 }, "Пловдив": { lat: 42.144, lng: 24.749 },
  "Варна": { lat: 43.207, lng: 27.914 }, "Бургас": { lat: 42.494, lng: 27.472 },
  "Русе": { lat: 43.849, lng: 25.954 }, "Стара Загора": { lat: 42.425, lng: 25.635 },
  "Плевен": { lat: 43.417, lng: 24.617 }, "Сливен": { lat: 42.681, lng: 26.322 },
  "Добрич": { lat: 43.571, lng: 27.827 }, "Шумен": { lat: 43.271, lng: 26.936 },
  "Перник": { lat: 42.605, lng: 23.037 }, "Хасково": { lat: 41.934, lng: 25.556 },
  "Ямбол": { lat: 42.484, lng: 26.503 }, "Пазарджик": { lat: 42.192, lng: 24.333 },
  "Благоевград": { lat: 42.021, lng: 23.094 }, "Велико Търново": { lat: 43.081, lng: 25.629 },
  "Враца": { lat: 43.210, lng: 23.553 }, "Габрово": { lat: 42.874, lng: 25.334 },
  "Асеновград": { lat: 42.012, lng: 24.876 }, "Видин": { lat: 43.991, lng: 22.881 },
  "Казанлък": { lat: 42.619, lng: 25.396 }, "Кюстендил": { lat: 42.284, lng: 22.691 },
  "Кърджали": { lat: 41.650, lng: 25.369 }, "Монтана": { lat: 43.408, lng: 23.225 },
  "Димитровград": { lat: 42.055, lng: 25.598 }, "Търговище": { lat: 43.248, lng: 26.572 },
  "Ловеч": { lat: 43.135, lng: 24.717 }, "Силистра": { lat: 44.117, lng: 27.260 },
  "Разград": { lat: 43.533, lng: 26.525 }, "Горна Оряховица": { lat: 43.127, lng: 25.696 },
  "Смолян": { lat: 41.577, lng: 24.712 }, "Петрич": { lat: 41.398, lng: 23.207 },
  "Сандански": { lat: 41.567, lng: 23.279 }, "Самоков": { lat: 42.338, lng: 23.554 },
  "Дупница": { lat: 42.266, lng: 23.117 }, "Ботевград": { lat: 42.905, lng: 23.792 },
  "Свищов": { lat: 43.617, lng: 25.351 }, "Лом": { lat: 43.821, lng: 23.237 },
  "Троян": { lat: 42.887, lng: 24.716 }, "Велинград": { lat: 42.026, lng: 23.992 },
  "Банско": { lat: 41.838, lng: 23.488 }, "Несебър": { lat: 42.659, lng: 27.736 },
  "Слънчев бряг": { lat: 42.694, lng: 27.711 }, "Созопол": { lat: 42.418, lng: 27.696 },
  "Приморско": { lat: 42.267, lng: 27.759 }, "Царево": { lat: 42.169, lng: 27.848 },
  "Поморие": { lat: 42.560, lng: 27.639 }, "Айтос": { lat: 42.700, lng: 27.249 },
  "Карнобат": { lat: 42.653, lng: 26.992 }, "Нова Загора": { lat: 42.492, lng: 26.017 },
  "Хисаря": { lat: 42.505, lng: 24.708 }, "Карлово": { lat: 42.639, lng: 24.803 },
  "Панагюрище": { lat: 42.494, lng: 24.184 }, "Севлиево": { lat: 43.026, lng: 25.113 },
  "Балчик": { lat: 43.416, lng: 28.166 }, "Каварна": { lat: 43.433, lng: 28.339 },
  "Златни пясъци": { lat: 43.283, lng: 28.042 }, "Албена": { lat: 43.371, lng: 28.081 },
  "Обзор": { lat: 42.818, lng: 27.881 }, "Китен": { lat: 42.235, lng: 27.775 },
  "Чирпан": { lat: 42.200, lng: 25.328 }, "Раднево": { lat: 42.293, lng: 25.930 },
  "Свиленград": { lat: 41.769, lng: 26.199 }, "Харманли": { lat: 41.929, lng: 25.907 },
  "Гоце Делчев": { lat: 41.569, lng: 23.732 }, "Разлог": { lat: 41.887, lng: 23.469 },
  "Пещера": { lat: 42.031, lng: 24.303 }, "Червен бряг": { lat: 43.271, lng: 24.096 },
  "Козлодуй": { lat: 43.778, lng: 23.723 }, "Мездра": { lat: 43.146, lng: 23.706 },
  "Попово": { lat: 43.348, lng: 26.226 }, "Омуртаг": { lat: 43.106, lng: 26.418 },
  "Тутракан": { lat: 44.048, lng: 26.613 }, "Исперих": { lat: 43.716, lng: 26.828 },
  "Провадия": { lat: 43.180, lng: 27.435 }, "Девня": { lat: 43.223, lng: 27.573 },
  "Аксаково": { lat: 43.259, lng: 27.816 }, "Белослав": { lat: 43.190, lng: 27.700 },
};

// намира град по непълно/неточно въведено име
function findCity(name) {
  const q = normHood(name);
  if (!q) return null;
  const keys = Object.keys(CITIES);
  return keys.find((c) => normHood(c) === q)
    || keys.find((c) => normHood(c).startsWith(q))
    || keys.find((c) => normHood(c).includes(q))
    || null;
}

// точка за изчисление: първо квартал в града, после самият град
function pointFor(city, hood) {
  const h = findHood(city, hood);
  if (h) return h;
  const c = cityCenter(city);
  if (c) return c;
  const match = findCity(city);
  return match ? CITIES[match] : null;
}

// разстояние между кои да е две точки в страната
// Градове, в които Корект има екипи
const BASES = ["София", "Пловдив", "Варна", "Бургас", "Русе", "Велико Търново"];

function nearestBase(city, roadFactor) {
  let best = null, bestKm = Infinity;
  for (const b of BASES) {
    const km = estimateKmAny(b, "", city, "", roadFactor);
    if (km != null && km < bestKm) { best = b; bestKm = km; }
  }
  return best ? { city: best, km: bestKm } : null;
}

// базата е "на маршрута", ако отклонението през нея е под допустимото
function baseOnRoute(from, base, to, roadFactor, tolerance) {
  const direct = estimateKmAny(from, "", to, "", roadFactor);
  const a = estimateKmAny(from, "", base, "", roadFactor);
  const b = estimateKmAny(base, "", to, "", roadFactor);
  if (direct == null || a == null || b == null) return false;
  return (a + b) <= direct * (tolerance || 1.1);
}

function estimateKmAny(cityA, hoodA, cityB, hoodB, roadFactor) {
  const a = pointFor(cityA, hoodA), b = pointFor(cityB, hoodB);
  if (!a || !b) return null;
  return Math.max(1, Math.round(haversineKm(a, b) * (roadFactor || 1.25)));
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const crewFor = (vol, p) => (p.crewTiers.find((t) => vol <= t.maxM3) || { crew: 4 }).crew;

function ownTruck(p) {
  return {
    id: "own",
    name: `Собствен ${n(p.truck.l)}×${n(p.truck.w)}×${n(p.truck.h)} м`,
    cap: n(p.truck.l) * n(p.truck.w) * n(p.truck.h) * n(p.fillFactor),
    payloadKg: n(p.truck.payloadKg || 1500),
    kmRate: n(p.kmRate),
  };
}
function fleetFor(service, p) {
  const own = ownTruck(p);
  if (service === "local") return [own];
  const partners = (p.partnerTrucks || []).map((t) => ({
    id: t.id, name: t.name,
    cap: n(t.capacity) * n(p.fillFactor),
    payloadKg: n(t.payloadKg || 3500),
    kmRate: t.kmRate != null && t.kmRate !== "" ? n(t.kmRate) : n(p.kmRate),
  }));
  return [own, ...partners];
}
// курсовете се определят от това, което свърши първо — обемът или тежестта
const tripsFor = (vol, cap, weight, payload) => {
  const byVol = vol > 0 && cap > 0 ? Math.ceil(vol / cap) : 0;
  const byKg = weight > 0 && payload > 0 ? Math.ceil(weight / payload) : 0;
  return Math.max(byVol, byKg);
};
function bestTruck(fleet, vol, weight) {
  let best = null, bestMetric = Infinity, bestTrips = Infinity;
  for (const t of fleet) {
    const tr = tripsFor(vol, t.cap, weight, t.payloadKg);
    if (!tr) continue;
    const metric = tr * t.kmRate; // минимизираме транспортната цена
    if (metric < bestMetric - 1e-9 || (Math.abs(metric - bestMetric) < 1e-9 && tr < bestTrips)) {
      best = t; bestMetric = metric; bestTrips = tr;
    }
  }
  return best || fleet[0];
}

/* -------- ценови двигател -------- */
function computePrice(s, p) {
  const lines = [];
  let total = 0;
  // precise = дребните пера (материали) се показват с точност до стотинка
  const add = (label, amount, precise) => {
    if (!amount) return;
    total += amount;
    lines.push({ label, amount: precise ? Math.round(amount * 100) / 100 : Math.round(amount) });
  };

  const vol = totalVolume(s.qty);
  const weight = totalWeight(s.qty);

  // избор на камион
  const fleet = fleetFor(s.service, p);
  const picked = s.truckId ? fleet.find((t) => t.id === s.truckId) : null;
  const chosen = picked || bestTruck(fleet, vol, weight);
  const cap = chosen ? chosen.cap : 0;
  const payload = chosen ? chosen.payloadKg : 0;
  const trips = tripsFor(vol, cap, weight, payload);
  // кое ограничава — обемът или тежестта
  const tripsByVol = cap > 0 && vol > 0 ? Math.ceil(vol / cap) : 0;
  const tripsByKg = payload > 0 && weight > 0 ? Math.ceil(weight / payload) : 0;
  const weightLimited = tripsByKg > tripsByVol;

  // разстояние (еднопосочно) и бригада
  const localEst = s.service === "local"
    ? (NEIGHBORHOODS[s.city]
        ? estimateKm(s.city, s.pickupHood, s.dropoffHood, n(p.cityRoadFactor || 1.3))
        : (s.city ? n(p.defaultTownKm || 4) : null))
    : null;
  // междуградско: смята се от център до център на градовете (без квартали)
  const bgEst = s.service === "intercity"
    ? estimateKmAny(s.pickupCity, "", s.dropoffCity, "", n(p.roadFactorBG || 1.25))
    : null;
  const oneWayKm = s.service === "local" ? (localEst != null ? localEst : 0)
    : s.service === "intercity" ? (bgEst != null ? bgEst : n(s.km))
    : n(p.euDistances[s.country]);
  let crew = crewFor(vol, p);
  // протокол: някои вещи изискват минимален брой хора (напр. двуврат хладилник → 4)
  let reqCrew = 0;
  Object.entries(s.qty).forEach(([id, cnt]) => { if (cnt > 0 && ITEM_INDEX[id]?.minCrew) reqCrew = Math.max(reqCrew, ITEM_INDEX[id].minCrew); });
  const crewByProtocol = reqCrew > crew;
  if (reqCrew) crew = Math.max(crew, reqCrew);

  // курс = разстояние над прага; далечни "градски" адреси също минават на км тарифа
  const isCourse = oneWayKm >= n(p.intercityThresholdKm);

  // екстри (човекочаса) — достъпът по стълби вече е парична такса, не часове
  const work = disHoursFor(s.qty, s.dis, s.asm, n(p.disFactor || 1));
  const disHours = work.total;                       // реално време (часове)
  const disCrew = n(p.disCrew || 2);                 // толкова души работят по него
  const disManHours = disHours * disCrew;            // → човекочаса за таксуване

  // опаковане със стреч: метри → часове труд + ролки материал
  const wrapMeters = wrapMetersFor(s.qty, s.wrap);
  const wrapManHours = wrapMeters / n(p.wrapMPerManHour || 40);
  const wrapHours = wrapManHours; // човекочаса за опаковане
  const rolls = wrapMeters > 0 ? wrapMeters / n(p.stretchRollM || 20) : 0; // дробна част се таксува пропорционално

  // ПЪТ: градско = еднопосочно (адрес→адрес); извънградско = двупосочно
  const rtFactor = isCourse ? n(p.roundTripFactor) : 1;
  const totalKm = trips * rtFactor * oneWayKm;
  const speed = isCourse ? n(p.roadSpeed || 65) : n(p.citySpeed || 30);
  const driveHours = speed ? totalKm / speed : 0;

  // 1) ПРЕНАСЯНЕ И ПЪТ — това е времето, в което камионът е ангажиран
  let handlingClock; // реални часове
  const minCrewH = n(p.minCrewHours || 2);
  const loadClock = Math.max(n(p.loadHours) * trips, minCrewH);      // мин. 2 ч на изпратена бригада
  const unloadClock = Math.max(n(p.unloadHours) * trips, minCrewH);
  if (isCourse) {
    handlingClock = loadClock + unloadClock;
  } else {
    handlingClock = vol / n(p.m3PerManHour || 1) / crew + driveHours;
    if (handlingClock < n(p.minLocalHours)) handlingClock = n(p.minLocalHours); // мин 2 ч
  }
  // при курс с пътуваща бригада вторият човек се плаща на ДЕН, не на час
  const travelDays = isCourse
    ? Math.max(1, Math.ceil((handlingClock + driveHours) / n(p.dayHours || 10)))
    : 0;
  const dayCrewMode = isCourse && s.courseMode === "dayCrew";

  const localCrewMode = isCourse && s.courseMode === "localCrew";
  const selfUnloadMode = isCourse && s.courseMode === "selfUnload"; // клиентът разтоварва сам

  // База с екип за разтоварване (вариант 2) — автоматично най-близката или ръчно избрана
  const autoBase = localCrewMode ? nearestBase(s.dropoffCity, n(p.roadFactorBG || 1.25)) : null;
  const baseCity = localCrewMode ? (s.baseCity || autoBase?.city || null) : null;
  const baseKm = baseCity ? estimateKmAny(baseCity, "", s.dropoffCity, "", n(p.roadFactorBG || 1.25)) : 0;
  const baseIsOnRoute = baseCity
    ? baseOnRoute(s.pickupCity, baseCity, s.dropoffCity, n(p.roadFactorBG || 1.25), n(p.routeDetourTolerance || 1.1))
    : false;
  // кола трябва, ако базата е встрани от маршрута ИЛИ служителят я е поискал изрично
  const needCar = !!baseCity && (!baseIsOnRoute || !!s.forceCar);

  let handlingManHours;
  if (dayCrewMode) {
    handlingManHours = 0; // трудът се плаща на ден, не на час
    const people = n(p.travelCrew || 1);
    add(`Придружаващ работник — ${travelDays} ${travelDays === 1 ? "ден" : "дни"} × ${people} ${people === 1 ? "човек" : "души"} × ${n(p.workerDayRate)} ${p.currency}/ден`,
        travelDays * people * n(p.workerDayRate));
  } else if (localCrewMode) {
    // товаренето при клиента + местна бригада, която пътува до адреса и разтоварва
    handlingManHours = loadClock * crew;
    add(`Товарене (${s.pickupCity}) — ${loadClock.toFixed(1)} ч × ${crew} души × ${n(p.workerRate)} ${p.currency}/ч`,
        handlingManHours * n(p.workerRate));

    const crewDriveH = baseKm ? (2 * baseKm) / n(p.roadSpeed || 65) : 0;   // отиване и връщане
    const crewWorkH = Math.max(n(p.unloadHours) * trips, n(p.localCrewMinHours || 2)); // мин. 2 ч работа
    const crewHours = crewDriveH + crewWorkH;
    const people = n(p.localCrewSize || 2);
    add(`Местна бригада ${baseCity ? `(${baseCity})` : ""} — ${crewWorkH.toFixed(1)} ч работа + ${crewDriveH.toFixed(1)} ч път × ${people} души × ${n(p.workerRate)} ${p.currency}/ч`,
        crewHours * people * n(p.workerRate));
    handlingManHours += crewHours * people;

    if (baseCity && needCar) {
      add(`Кола ${baseCity} → ${s.dropoffCity} — ${2 * baseKm} км × ${n(p.carRatePerKm)} ${p.currency}/км`,
          2 * baseKm * n(p.carRatePerKm), true);
    }
  } else if (selfUnloadMode) {
    // клиентът разтоварва сам — плаща се само товаренето при него
    handlingManHours = loadClock * crew;
    handlingClock = loadClock;
    add(`Товарене (${s.pickupCity}) — ${loadClock.toFixed(1)} ч × ${crew} души × ${n(p.workerRate)} ${p.currency}/ч`,
        handlingManHours * n(p.workerRate));
  } else {
    handlingManHours = handlingClock * crew;
    if (isCourse) {
      add(`Товарене — ${loadClock.toFixed(1)} ч × ${crew} души × ${n(p.workerRate)} ${p.currency}/ч`, loadClock * crew * n(p.workerRate));
      add(`Разтоварване — ${unloadClock.toFixed(1)} ч × ${crew} души × ${n(p.workerRate)} ${p.currency}/ч`, unloadClock * crew * n(p.workerRate));
    } else {
      add(`Пренасяне и път — ${handlingClock.toFixed(1)} ч × ${crew} души × ${n(p.workerRate)} ${p.currency}/ч`,
          handlingManHours * n(p.workerRate));
    }
  }

  // Нощувка: ако работа + път в ЕДНАТА посока надхвърли прага
  const oneWayDriveH = isCourse && n(p.roadSpeed) ? oneWayKm / n(p.roadSpeed) : 0;
  const nights = isCourse
    ? Math.max(0, Math.ceil((oneWayDriveH + handlingClock - n(p.overnightThresholdH || 8)) / n(p.dayHours || 10)))
    : 0;
  if (nights > 0) {
    const sleepers = 1 + (dayCrewMode ? n(p.travelCrew || 1) : 0); // шофьор (+ придружаващ)
    add(`Нощувка — ${nights} ${nights === 1 ? "нощ" : "нощи"} × ${sleepers} ${sleepers === 1 ? "човек" : "души"} × ${n(p.overnightPrice)} ${p.currency}`,
        nights * sleepers * n(p.overnightPrice));
  }

  // 2) РАЗГЛОБЯВАНЕ/СГЛОБЯВАНЕ — реални часове × хора по демонтажа (камионът чака, но не се таксува)
  if (disManHours) {
    add(`Разглобяване/сглобяване — ${disHours.toFixed(1)} ч × ${disCrew} души × ${n(p.workerRate)} ${p.currency}/ч`,
        disManHours * n(p.workerRate));
  }

  // 3) ОПАКОВАНЕ — човекочаса
  if (wrapManHours) {
    add(`Опаковане — ${wrapManHours.toFixed(1)} чч × ${n(p.workerRate)} ${p.currency}/ч`, wrapManHours * n(p.workerRate));
  }

  const manHours = handlingManHours + disManHours + wrapManHours;
  const clockHours = handlingClock + disHours + (crew ? wrapManHours / crew : wrapManHours); // общ престой на обекта

  // спец. обработка
  Object.entries(s.qty).forEach(([id, cnt]) => {
    const it = ITEM_INDEX[id];
    if (it?.surcharge && cnt > 0) add(`${it.label} — спец. обработка ×${cnt}`, it.surcharge * cnt);
  });

  // СТЪЛБИ — парична такса на етаж, на адрес (товарене + разтоварване)
  const boxes = countKind(s.qty, "box");
  const appNormal = countKind(s.qty, "appliance");
  const appHeavy = countKind(s.qty, "appliance_heavy");
  const oversized = countKind(s.qty, "oversized");
  // стандартни вещи: стълби само при липса на асансьор
  const floorsStd = (a) => (a.floor >= 1 && !a.elevator ? a.floor : 0);
  // едрогабаритни (диван 3-ка и под.): не влизат в пътнически асансьор → стълби, освен при товарен
  const floorsOvr = (a) => (a.floor >= 1 && !(a.elevator && a.elevatorType === "cargo") ? a.floor : 0);
  const perFloorStd = n(p.floorFeeNoElevator) + boxes * n(p.boxPerFloor) + appNormal * n(p.appliancePerFloor) + appHeavy * n(p.heavyAppliancePerFloor);
  const perFloorOvr = oversized * n(p.heavyAppliancePerFloor);
  // при самостоятелно разтоварване стълбите на адреса на доставка са за сметка на клиента
  const floorsStdTot = floorsStd(s.pickup) + (selfUnloadMode ? 0 : floorsStd(s.dropoff));
  const floorsOvrTot = floorsOvr(s.pickup) + (selfUnloadMode ? 0 : floorsOvr(s.dropoff));
  const stairs = floorsStdTot * perFloorStd + floorsOvrTot * perFloorOvr;
  if (stairs) {
    const parts = [];
    if (floorsStdTot && boxes) parts.push(`${boxes} каш.`);
    if (floorsStdTot && appNormal) parts.push(`${appNormal} уред`);
    if (floorsStdTot && appHeavy) parts.push(`${appHeavy} спец.`);
    if (floorsOvrTot && oversized) parts.push(`${oversized} едрогаб.`);
    add(`Стълби без асансьор${parts.length ? " · " + parts.join(", ") : ""}`, stairs);
  }

  // ТРАНСПОРТ (перо) — само за времето, в което камионът реално участва
  if (!isCourse) {
    add(`Транспорт — ${handlingClock.toFixed(1)} ч × ${n(p.truckRate)} ${p.currency}/ч`, handlingClock * n(p.truckRate));
  } else {
    const rate = chosen ? chosen.kmRate : n(p.kmRate);
    if (totalKm) add(`Транспорт — ${totalKm} км × ${rate} ${p.currency}/км`, totalKm * rate);
  }

  // материали
  if (rolls) add(`Стреч фолио — ${wrapMeters} м × ${(n(p.stretchRollPrice) / n(p.stretchRollM || 1)).toFixed(3)} ${p.currency}/м`, rolls * n(p.stretchRollPrice), true);

  // праг
  const floor = n(p.minPrice[s.service]);
  if (total < floor) { lines.push({ label: "Изравняване до минимум", amount: floor - total }); total = floor; }

  return { total: Math.round(total), lines, vol, weight, payload, weightLimited, tripsByVol, tripsByKg, manHours, crew, clockHours, trips, cap, chosen, oneWayKm, totalKm, driveHours, fleet, auto: !picked, isCourse, crewByProtocol, disHours, disManHours, disCrew, work, wrapMeters, wrapHours, wrapManHours, rolls, handlingClock, loadClock, unloadClock, travelDays, dayCrewMode, localCrewMode, selfUnloadMode, baseCity, baseKm, baseIsOnRoute, needCar, nights, oneWayDriveH };
}

/* ================= ЗАПИС НА КАЛКУЛАЦИИ (база данни) ================= *
 *  Всяка показана калкулация се записва автоматично, дори без контакти.
 *  Ключ: calc:<timestamp>-<rand>. Споделено хранилище → достъпно за Корект.
 * =================================================================== */
const CALC_PREFIX = "calc:";

/* --- Устойчив слой над хранилището ---------------------------------
 * Някои среди не позволяват споделено хранилище (или изобщо нямат такова).
 * Опитваме споделено → лично → отказ, и помним кое е проработило.
 * ------------------------------------------------------------------ */
let storageMode = null; // null = непроверено | "shared" | "personal" | "none"
const hasStorage = () => !!(typeof window !== "undefined" && window.storage && typeof window.storage.set === "function");
const modesToTry = () => (storageMode && storageMode !== "none" ? [storageMode] : ["shared", "personal"]);
const getStorageMode = () => storageMode;

async function storageSet(key, value) {
  if (!hasStorage()) { storageMode = "none"; return false; }
  for (const m of modesToTry()) {
    try {
      const res = await window.storage.set(key, value, m === "shared");
      if (res) { storageMode = m; return true; }
    } catch (e) { /* пробваме следващия режим */ }
  }
  storageMode = "none";
  return false;
}

async function storageGet(key) {
  if (!hasStorage()) { storageMode = "none"; return null; }
  for (const m of modesToTry()) {
    try {
      const res = await window.storage.get(key, m === "shared");
      if (res?.value) { storageMode = m; return res.value; }
    } catch (e) { /* липсващ ключ или недостъпен режим */ }
  }
  return null;
}

async function storageList(prefix) {
  if (!hasStorage()) { storageMode = "none"; return []; }
  for (const m of modesToTry()) {
    try {
      const res = await window.storage.list(prefix, m === "shared");
      if (res?.keys) { storageMode = m; return res.keys; }
    } catch (e) { /* пробваме следващия режим */ }
  }
  return [];
}
const PARAMS_KEY = "config:pricing";

// сливане със стойностите по подразбиране, за да не се губят нови полета
function mergeParams(saved) {
  const d = structuredClone(DEFAULTS);
  if (!saved || typeof saved !== "object") return d;
  return {
    ...d, ...saved,
    truck: { ...d.truck, ...(saved.truck || {}) },
    // само познатите прагове — старо "intercity: 350" от запазени настройки се игнорира
    minPrice: {
      local: saved.minPrice?.local ?? d.minPrice.local,
      international: saved.minPrice?.international ?? d.minPrice.international,
    },
    crewTiers: saved.crewTiers || d.crewTiers,
    partnerTrucks: saved.partnerTrucks || d.partnerTrucks,
    bgDistances: { ...d.bgDistances, ...(saved.bgDistances || {}) },
    euDistances: { ...d.euDistances, ...(saved.euDistances || {}) },
  };
}

async function loadParams() {
  try {
    const val = await storageGet(PARAMS_KEY);
    return val ? mergeParams(JSON.parse(val)) : null;
  } catch (e) { return null; }
}

// --- Трайно пазене през Google Sheet (Apps Script) ---
async function pushParamsToSheet(p, endpoint) {
  if (!endpoint) return false;
  try {
    await fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ type: "params", params: p }),
    });
    return true;
  } catch (e) { return false; }
}

async function fetchParamsFromSheet(endpoint) {
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint + (endpoint.includes("?") ? "&" : "?") + "type=params");
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.params ? mergeParams(data.params) : null;
  } catch (e) { return null; }
}

async function saveParams(p) {
  return storageSet(PARAMS_KEY, JSON.stringify(p));
}

function buildRecord(s, p, r, id) {
  const items = Object.entries(s.qty)
    .filter(([, cnt]) => cnt > 0)
    .map(([id, cnt]) => ({ id, label: ITEM_INDEX[id]?.label || id, qty: cnt, m3: +( (ITEM_INDEX[id]?.m3 || 0) * cnt ).toFixed(2) }));
  return {
    id: id || null,
    createdAt: new Date().toISOString(),
    service: s.service,
    city: s.city || null,
    from: s.pickupHood || null,
    to: s.dropoffHood || null,
    destination: s.service === "intercity" ? `${s.pickupCity} → ${s.dropoffCity}` : s.service === "international" ? s.country : null,
    km: r.oneWayKm || 0,
    totalKm: r.totalKm || 0,
    volumeM3: +r.vol.toFixed(2),
    weightKg: r.weight,
    trips: r.trips,
    crew: r.crew,
    hours: +r.clockHours.toFixed(2),
    manHours: +r.manHours.toFixed(2),
    truck: r.chosen?.name || null,
    isCourse: r.isCourse,
    pickup: { floor: s.pickup.floor, elevator: s.pickup.elevator, elevatorType: s.pickup.elevatorType },
    dropoff: { floor: s.dropoff.floor, elevator: s.dropoff.elevator, elevatorType: s.dropoff.elevatorType },
    extras: s.extras,
    disassembly: Object.entries(s.dis || {}).filter(([, v]) => v).map(([id]) => ITEM_INDEX[id]?.label || id),
    disHours: +r.disHours.toFixed(2),
    disManHours: +r.disManHours.toFixed(2),
    courseMode: r.isCourse ? (r.dayCrewMode ? "пътуваща бригада" : r.localCrewMode ? `местен екип (${r.baseCity})` : r.selfUnloadMode ? "клиентът разтоварва сам" : "почасово") : null,
    nights: r.nights || 0,
    travelDays: r.travelDays || 0,
    assembly: Object.entries(s.asm || {}).filter(([, v]) => v).map(([id]) => ITEM_INDEX[id]?.label || id),
    wrapMeters: r.wrapMeters,
    stretchRolls: r.rolls,
    items,
    breakdown: r.lines,
    total: r.total,
    rates: { worker: p.workerRate, truck: p.truckRate, km: p.kmRate },
    paramsSnapshot: p, // ставките, с които е направена калкулацията
    contact: null,
    status: "калкулация",
  };
}

// изпраща записа към Google Sheet (Apps Script), ако е зададен адрес
async function pushToSheet(record, endpoint) {
  if (!endpoint) return null;
  try {
    await fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(record),
    });
    return true;
  } catch (e) {
    console.error("sheet push failed", e);
    return false;
  }
}

async function saveCalc(key, record) {
  return storageSet(key, JSON.stringify(record));
}

async function loadCalcs() {
  const out = [];
  const keys = await storageList(CALC_PREFIX);
  for (const k of keys) {
    try {
      const val = await storageGet(k);
      if (val) out.push({ key: k, ...JSON.parse(val) });
    } catch (e) { /* пропускаме повреден запис */ }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function toCSV(rows) {
  const head = ["Дата", "Услуга", "Град", "От", "До", "Км", "Обем м³", "Курсове", "Бригада", "Часове", "Цена €", "Име", "Телефон", "Имейл", "Статус"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((r) => [
    new Date(r.createdAt).toLocaleString("bg-BG"), r.service, r.city || r.destination || "",
    r.from || "", r.to || "", r.km, r.volumeM3, r.trips, r.crew, r.hours, r.total,
    r.contact?.name || "", r.contact?.phone || "", r.contact?.email || "", r.status,
  ].map(esc).join(","));
  return [head.map(esc).join(","), ...body].join("\n");
}

/* ===== END ENGINE (по-горе всичко е чиста логика — тества се) ===== */

/* -------- UI helpers -------- */
const ink = "#15263f";
const accent = "#e8952f";
const fmtTime = (h) => (h >= 1 ? `${h.toFixed(1)} ч` : `${Math.round(h * 60)} мин`);

function Pill({ active, children, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium transition border ${active ? "text-white border-transparent" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}
      style={active ? { background: ink } : {}}>{children}</button>
  );
}
function Stepper({ value, onChange }) {
  // държим суров текст, за да може полето да се изпразни, докато се пише
  const [raw, setRaw] = useState(String(value || 0));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setRaw(String(value || 0)); }, [value, focused]);

  const handle = (e) => {
    const t = e.target.value.replace(/[^\d]/g, "").slice(0, 5); // само цифри, до 99999
    setRaw(t);
    onChange(t === "" ? 0 : parseInt(t, 10));
  };

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onChange(Math.max(0, value - 1))}
        className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">−</button>
      <input
        type="text" inputMode="numeric" value={raw}
        onChange={handle}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onBlur={() => { setFocused(false); setRaw(String(value || 0)); }}
        className="w-16 h-8 text-center font-semibold text-sm rounded-lg border"
        style={{ color: value ? ink : "#cbd5e1", borderColor: value ? "#cbd5e1" : "#e2e8f0" }}
      />
      <button onClick={() => onChange((value || 0) + 1)}
        className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">+</button>
    </div>
  );
}
function Num({ label, value, onChange, step = 1, suffix }) {
  // държим суров текст, за да са валидни междинни състояния: "", "0.", "0,7"
  const [raw, setRaw] = useState(String(value ?? ""));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setRaw(String(value ?? "")); }, [value, focused]);

  const handle = (e) => {
    const t = e.target.value;
    setRaw(t);
    if (t.trim() === "") { onChange(""); return; }
    const num = parseFloat(t.replace(",", "."));
    if (!Number.isNaN(num)) onChange(num);
  };

  return (
    <label className="block">
      <span className="text-[11px] text-slate-500 leading-tight block">{label}</span>
      <div className="flex items-center gap-1 mt-1">
        <input
          type="text" inputMode="decimal" value={raw}
          onChange={handle}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setRaw(String(value ?? "")); }}
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
        />
        {suffix && <span className="text-xs text-slate-400 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  );
}

function CityInput({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const q = normHood(value);
  const all = Object.keys(CITIES).sort((a, b) => a.localeCompare(b, "bg"));
  const opts = q
    ? all.filter((c) => normHood(c).includes(q)).sort((a, b) => {
        const ai = normHood(a).startsWith(q) ? 0 : 1, bi = normHood(b).startsWith(q) ? 0 : 1;
        return ai - bi || a.localeCompare(b, "bg");
      })
    : all;
  const exact = all.some((c) => normHood(c) === q);
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: value && !exact ? accent : "#e2e8f0" }}
      />
      {open && opts.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg z-30">
          {opts.slice(0, 40).map((c) => (
            <button key={c} type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(c); setOpen(false); }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function HoodInput({ city, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const list = NEIGHBORHOODS[city] || [];
  const q = (value || "").trim().toLowerCase();
  const opts = q ? list.filter((h) => h.name.toLowerCase().includes(q)) : list;
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      {open && opts.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg z-20">
          {opts.map((h) => (
            <button
              key={h.name}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(h.name); setOpen(false); }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
            >
              {h.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ p, setP, saveState }) {
  const upd = (patch) => setP({ ...p, ...patch });

  const exportParams = () => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `korekt-nastroyki-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const importParams = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { setP(mergeParams(JSON.parse(String(reader.result)))); }
      catch (err) { alert("Файлът не е валиден файл с настройки."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const cap = ownTruck(p).cap;
  const setPartner = (i, patch) => {
    const arr = p.partnerTrucks.map((t, j) => (j === i ? { ...t, ...patch } : t));
    upd({ partnerTrucks: arr });
  };
  return (
    <div className="rounded-2xl border-2 bg-white p-5 mb-4" style={{ borderColor: accent }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-bold" style={{ color: ink }}>⚙ Параметри на калкулатора</div>
        <div className="text-xs text-right" style={{ color: saveState === "error" ? "#dc2626" : "#94a3b8" }}>
          {saveState === "saving" ? "Записване…"
            : saveState === "saved-sheet" ? "Записано в Google Sheet ✓"
            : saveState === "saved" ? "Записано ✓"
            : saveState === "unavailable" ? "Важи за сесията (без трайно хранилище)"
            : saveState === "error" ? "Грешка при запис" : ""}
        </div>
      </div>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Ставки и скорости</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Num label="Работник" value={p.workerRate} onChange={(v) => upd({ workerRate: v })} suffix="€/ч" />
        <Num label="Транспорт (градско)" value={p.truckRate} onChange={(v) => upd({ truckRate: v })} suffix="€/ч" />
        <Num label="Извънградско" value={p.kmRate} step={0.05} onChange={(v) => upd({ kmRate: v })} suffix="€/км" />
        <Num label="Двупосочен курс" value={p.roundTripFactor} step={0.5} onChange={(v) => upd({ roundTripFactor: v })} suffix="×" />
        <Num label="Скорост в града" value={p.citySpeed} step={5} onChange={(v) => upd({ citySpeed: v })} suffix="км/ч" />
        <Num label="Скорост извън града" value={p.roadSpeed} step={5} onChange={(v) => upd({ roadSpeed: v })} suffix="км/ч" />
      </div>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Собствен камион — {cap.toFixed(1)} м³/курс</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Num label="Дължина" value={p.truck.l} step={0.1} onChange={(v) => upd({ truck: { ...p.truck, l: v } })} suffix="м" />
        <Num label="Широчина" value={p.truck.w} step={0.1} onChange={(v) => upd({ truck: { ...p.truck, w: v } })} suffix="м" />
        <Num label="Височина" value={p.truck.h} step={0.1} onChange={(v) => upd({ truck: { ...p.truck, h: v } })} suffix="м" />
        <Num label="Полезно запълване" value={p.fillFactor} step={0.05} onChange={(v) => upd({ fillFactor: v })} suffix="×" />
        <Num label="Товароносимост" value={p.truck.payloadKg} step={100} onChange={(v) => upd({ truck: { ...p.truck, payloadKg: v } })} suffix="кг" />
      </div>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Партньорски камиони (междуградско/международно)</div>
      <div className="space-y-2 mb-4">
        {p.partnerTrucks.map((t, i) => (
          <div key={t.id} className="grid grid-cols-[1fr_90px_90px_28px] gap-2 items-end">
            <label className="block">
              <span className="text-[11px] text-slate-500">Име</span>
              <input value={t.name} onChange={(e) => setPartner(i, { name: e.target.value })} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm mt-1" />
            </label>
            <Num label="Вместимост" value={t.capacity} onChange={(v) => setPartner(i, { capacity: v })} suffix="м³" />
            <Num label="€/км" value={t.kmRate ?? ""} step={0.05} onChange={(v) => setPartner(i, { kmRate: v })} />
            <button onClick={() => upd({ partnerTrucks: p.partnerTrucks.filter((_, j) => j !== i) })}
              className="w-7 h-9 rounded-lg border border-slate-200 text-slate-400 hover:text-red-500">×</button>
          </div>
        ))}
        <button onClick={() => upd({ partnerTrucks: [...p.partnerTrucks, { id: "p" + Date.now(), name: "Нов камион", capacity: 30 }] })}
          className="text-xs font-medium" style={{ color: accent }}>+ Добави камион</button>
      </div>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Време и производителност</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Num label="Производителност" value={p.m3PerManHour} step={0.1} onChange={(v) => upd({ m3PerManHour: v })} suffix="м³/чч" />
        <Num label="Мин. градско" value={p.minLocalHours} step={0.5} onChange={(v) => upd({ minLocalHours: v })} suffix="ч" />
        <Num label="Коеф. път (град)" value={p.cityRoadFactor} step={0.05} onChange={(v) => upd({ cityRoadFactor: v })} suffix="×" />
        <Num label="Разстояние в малък град" value={p.defaultTownKm} step={1} onChange={(v) => upd({ defaultTownKm: v })} suffix="км" />
        <Num label="Коеф. демонтаж" value={p.disFactor} step={0.1} onChange={(v) => upd({ disFactor: v })} suffix="×" />
        <Num label="Хора на демонтаж" value={p.disCrew} step={1} onChange={(v) => upd({ disCrew: v })} suffix="души" />
        <Num label="Кашон/етаж" value={p.boxPerFloor} step={0.05} onChange={(v) => upd({ boxPerFloor: v })} suffix="€" />
        <Num label="Уред/етаж" value={p.appliancePerFloor} step={0.5} onChange={(v) => upd({ appliancePerFloor: v })} suffix="€" />
        <Num label="Спец. уред/етаж" value={p.heavyAppliancePerFloor} step={0.5} onChange={(v) => upd({ heavyAppliancePerFloor: v })} suffix="€" />
        <Num label="Плоска база/етаж" value={p.floorFeeNoElevator} step={0.5} onChange={(v) => upd({ floorFeeNoElevator: v })} suffix="€" />
        <Num label="Ролка стреч" value={p.stretchRollM} step={1} onChange={(v) => upd({ stretchRollM: v })} suffix="м" />
        <Num label="Цена ролка" value={p.stretchRollPrice} step={0.5} onChange={(v) => upd({ stretchRollPrice: v })} suffix="€" />
        <Num label="Скорост опаковане" value={p.wrapMPerManHour} step={10} onChange={(v) => upd({ wrapMPerManHour: v })} suffix="м/чч" />
        <Num label="Праг междуградско" value={p.intercityThresholdKm} step={5} onChange={(v) => upd({ intercityThresholdKm: v })} suffix="км" />
        <Num label="Товарене/курс" value={p.loadHours} step={0.5} onChange={(v) => upd({ loadHours: v })} suffix="ч" />
        <Num label="Разтоварване/курс" value={p.unloadHours} step={0.5} onChange={(v) => upd({ unloadHours: v })} suffix="ч" />
        <Num label="Дневна ставка" value={p.workerDayRate} step={1} onChange={(v) => upd({ workerDayRate: v })} suffix="€/ден" />
        <Num label="Пътуват (без шофьор)" value={p.travelCrew} step={1} onChange={(v) => upd({ travelCrew: v })} suffix="души" />
        <Num label="Часове в работен ден" value={p.dayHours} step={1} onChange={(v) => upd({ dayHours: v })} suffix="ч" />
        <Num label="Местен екип" value={p.localCrewSize} step={1} onChange={(v) => upd({ localCrewSize: v })} suffix="души" />
        <Num label="Мин. работа местен екип" value={p.localCrewMinHours} step={0.5} onChange={(v) => upd({ localCrewMinHours: v })} suffix="ч" />
        <Num label="Мин. на изпратена бригада" value={p.minCrewHours} step={0.5} onChange={(v) => upd({ minCrewHours: v })} suffix="ч" />
        <Num label="Кола" value={p.carRatePerKm} step={0.05} onChange={(v) => upd({ carRatePerKm: v })} suffix="€/км" />
        <Num label="Праг за нощувка" value={p.overnightThresholdH} step={1} onChange={(v) => upd({ overnightThresholdH: v })} suffix="ч" />
        <Num label="Нощувка" value={p.overnightPrice} step={5} onChange={(v) => upd({ overnightPrice: v })} suffix="€" />
      </div>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Минимални цени</div>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Градско" value={p.minPrice.local} step={10} onChange={(v) => upd({ minPrice: { ...p.minPrice, local: v } })} suffix="€" />
        <Num label="Международно" value={p.minPrice.international} step={10} onChange={(v) => upd({ minPrice: { ...p.minPrice, international: v } })} suffix="€" />
      </div>

      <p className="text-[11px] text-slate-400 mt-1">
        Стреч: {(Number(p.stretchRollPrice) / Number(p.stretchRollM || 1)).toFixed(3)} {p.currency}/м
      </p>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">Google Sheet база данни</div>
      <label className="block">
        <span className="text-[11px] text-slate-500">Адрес на Apps Script (оставете празно, за да не се изпраща)</span>
        <input value={p.sheetEndpoint || ""} onChange={(e) => upd({ sheetEndpoint: e.target.value })}
          placeholder="https://script.google.com/macros/s/..../exec"
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm mt-1" />
      </label>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button onClick={exportParams} className="text-xs font-semibold px-3 py-1.5 rounded-full text-white" style={{ background: ink }}>
          ⬇ Свали настройките
        </button>
        <label className="text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 cursor-pointer">
          ⬆ Зареди настройки
          <input type="file" accept="application/json,.json" className="hidden" onChange={importParams} />
        </label>
        <button onClick={() => setP(structuredClone(DEFAULTS))} className="text-xs font-medium text-slate-500 hover:text-slate-700 underline ml-auto">
          Върни по подразбиране
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Свалените настройки са файл, който можете да заредите по всяко време — работи и когато средата не пази данни.
      </p>
    </div>
  );
}

function AddressBlock({ title, data, onChange }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-5 bg-white">
      <h4 className="font-semibold mb-4" style={{ color: ink }}>{title}</h4>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2">Вид сграда</label>
          <div className="flex flex-wrap gap-2">
            {["Апартамент", "Къща", "Офис", "Склад"].map((b) => (
              <Pill key={b} active={data.building === b} onClick={() => onChange({ ...data, building: b })}>{b}</Pill>
            ))}
          </div>
        </div>
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">Етаж</label>
            <Stepper value={data.floor || 0} onChange={(v) => onChange({ ...data, floor: v })} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-500 mb-2">Асансьор</label>
            <div className="flex flex-wrap gap-2">
              <Pill active={!data.elevator} onClick={() => onChange({ ...data, elevator: false })}>Няма</Pill>
              <Pill active={data.elevator && data.elevatorType === "passenger"} onClick={() => onChange({ ...data, elevator: true, elevatorType: "passenger" })}>Пътнически</Pill>
              <Pill active={data.elevator && data.elevatorType === "cargo"} onClick={() => onChange({ ...data, elevator: true, elevatorType: "cargo" })}>Товарен</Pill>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STEPS = ["Услуга", "Локация", "Вещи и детайли", "Цена"];

function LogPanel({ onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(false);
  const refresh = async () => { setRows(null); const d = await loadCalcs(); setRows(d); setErr(d.length === 0); };
  useEffect(() => { refresh(); }, []);

  const download = () => {
    const blob = new Blob(["\uFEFF" + toCSV(rows || [])], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `korekt-kalkulacii-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const sum = (rows || []).reduce((t, r) => t + (r.total || 0), 0);
  const withContact = (rows || []).filter((r) => r.contact).length;

  return (
    <div className="rounded-2xl border-2 bg-white p-5 mb-4" style={{ borderColor: ink }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-bold" style={{ color: ink }}>📋 Записани калкулации</div>
        <div className="flex gap-2">
          <button onClick={refresh} className="text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 text-slate-600">Обнови</button>
          {rows?.length > 0 && <button onClick={download} className="text-xs font-semibold px-3 py-1.5 rounded-full text-white" style={{ background: accent }}>Изтегли CSV</button>}
          <button onClick={onClose} className="text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 text-slate-600">Затвори</button>
        </div>
      </div>

      {rows === null && <div className="text-sm text-slate-400">Зареждане…</div>}
      {rows?.length === 0 && (
        <div className="text-sm text-slate-400">
          {getStorageMode() === "none"
            ? "Тази среда не поддържа трайно хранилище. Свържете Google Sheet базата от ⚙ Параметри, за да се пазят калкулациите."
            : "Още няма записани калкулации."}
        </div>
      )}

      {rows?.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Калкулации", rows.length], ["С контакти", withContact], ["Общо стойност", `${sum} €`]].map(([k, v]) => (
              <div key={k} className="rounded-xl px-3 py-2" style={{ background: "#eef1f5" }}>
                <div className="text-[11px] text-slate-500">{k}</div>
                <div className="font-bold text-sm" style={{ color: ink }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="max-h-80 overflow-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="py-1.5 px-1 font-medium">Дата</th>
                  <th className="py-1.5 px-1 font-medium">Маршрут</th>
                  <th className="py-1.5 px-1 font-medium text-right">м³</th>
                  <th className="py-1.5 px-1 font-medium text-right">Цена</th>
                  <th className="py-1.5 px-1 font-medium">Контакт</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td className="py-1.5 px-1 text-slate-500 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("bg-BG")} {new Date(r.createdAt).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="py-1.5 px-1 text-slate-700">
                      {r.service === "local" ? `${r.city}: ${r.from} → ${r.to}` : `${r.service === "intercity" ? "Междугр." : "Межд."}: ${r.destination || ""}`}
                    </td>
                    <td className="py-1.5 px-1 text-right text-slate-600">{r.volumeM3}</td>
                    <td className="py-1.5 px-1 text-right font-semibold" style={{ color: ink }}>{r.total} €</td>
                    <td className="py-1.5 px-1 text-slate-500">{r.contact ? `${r.contact.name || ""} ${r.contact.phone || ""}`.trim() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-[11px] text-slate-400 mt-3">
        {getStorageMode() === "shared"
          ? "Записите се пазят в споделено хранилище и са видими за всички, които ползват калкулатора."
          : getStorageMode() === "personal"
          ? "Записите се пазят локално за това устройство. За обща база свържете Google Sheet от ⚙ Параметри."
          : "За трайна база свържете Google Sheet от ⚙ Параметри."}
      </p>
    </div>
  );
}

export default function KorektCalculator() {
  const [step, setStep] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [p, setP] = useState(() => structuredClone(DEFAULTS));
  const [openGroups, setOpenGroups] = useState({ "Хол и трапезария": true });
  const [s, setS] = useState({
    service: null, city: "", country: "", km: 0, localKm: 12, pickupHood: "", dropoffHood: "", pickupCity: "", dropoffCity: "", truckId: null, courseMode: "hourly", baseCity: "", forceCar: false, qty: {}, dis: {}, asm: {}, wrap: {},
    pickup: { building: "Апартамент", floor: 0, elevator: false, elevatorType: "passenger" },
    dropoff: { building: "Апартамент", floor: 0, elevator: false, elevatorType: "passenger" },
    extras: { packing: false, materials: false, disassembly: false },
    name: "", phone: "", email: "",
  });
  const set = (patch) => setS((prev) => ({ ...prev, ...patch }));
  const setQty = (id, cnt) => setS((prev) => ({ ...prev, qty: { ...prev.qty, [id]: cnt } }));
  const toggle = (field, id) => setS((prev) => ({ ...prev, [field]: { ...prev[field], [id]: !prev[field][id] } }));

  const r = useMemo(() => computePrice(s, p), [s, p]);
  const { total, lines, vol, weight, payload, weightLimited, tripsByVol, tripsByKg, manHours, crew, clockHours, trips, chosen, oneWayKm, totalKm, driveHours, fleet, auto, crewByProtocol, isCourse, disHours, disCrew, wrapMeters, wrapHours, rolls, travelDays, dayCrewMode, localCrewMode, selfUnloadMode, baseCity, baseKm, baseIsOnRoute, needCar, nights, oneWayDriveH } = r;
  const localEst = s.service === "local" ? estimateKm(s.city, s.pickupHood, s.dropoffHood, Number(p.cityRoadFactor) || 1.3) : null;

  // --- зареждане и автоматичен запис на ПАРАМЕТРИТЕ ---
  const [paramsLoaded, setParamsLoaded] = useState(false);
  const [paramSave, setParamSave] = useState("idle"); // idle | saving | saved | error

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await loadParams();
      if (alive && local) setP(local);
      const endpoint = (local || DEFAULTS).sheetEndpoint;
      if (endpoint) {
        const remote = await fetchParamsFromSheet(endpoint);
        if (alive && remote) setP(remote);
      }
      if (alive) setParamsLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!paramsLoaded) return;
    setParamSave("saving");
    const t = setTimeout(() => {
      (async () => {
        const okLocal = await saveParams(p);
        const okSheet = await pushParamsToSheet(p, p.sheetEndpoint);
        setParamSave(okSheet ? "saved-sheet" : okLocal ? "saved" : getStorageMode() === "none" ? "unavailable" : "error");
      })();
    }, 600);
    return () => clearTimeout(t);
  }, [p, paramsLoaded]);

  // --- автоматичен запис на калкулацията при показване на цената ---
  const [showLog, setShowLog] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const recordKey = useRef(null);

  // Всяка калкулация се пази автоматично — без клиентът да прави нищо.
  // Записът се обновява при промяна, вместо да се дублира.
  const pending = useRef(null); // последният запис, готов за изпращане

  useEffect(() => {
    if (!s.service || r.vol <= 0 || r.total <= 0) return;
    if (!recordKey.current) {
      recordKey.current = `${CALC_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
    const key = recordKey.current;
    const rec = buildRecord(s, p, r, key);
    if (s.name || s.phone || s.email) {
      rec.contact = { name: s.name, phone: s.phone, email: s.email };
      rec.status = "заявка";
    }
    pending.current = { key, rec };            // готов веднага, дори да не дочакаме таймера
    setSaveState("saving");
    const t = setTimeout(async () => {
      pushToSheet(rec, p.sheetEndpoint);
      const ok = await saveCalc(key, rec);
      setSaveState(ok ? "saved" : getStorageMode() === "none" ? "unavailable" : "error");
    }, 1200);
    return () => clearTimeout(t);
  }, [s, p]); // eslint-disable-line react-hooks/exhaustive-deps

  // ако страницата се затвори преди таймера — изпращаме веднага
  useEffect(() => {
    const flush = () => {
      const cur = pending.current;
      if (!cur) return;
      try {
        if (p.sheetEndpoint && typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon(p.sheetEndpoint,
            new Blob([JSON.stringify(cur.rec)], { type: "text/plain;charset=utf-8" }));
        }
      } catch (e) { /* без значение — записът в хранилището остава */ }
      saveCalc(cur.key, cur.rec);
    };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [p.sheetEndpoint]);

  const submitRequest = async () => {
    const key = recordKey.current || `${CALC_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    recordKey.current = key;
    const rec = buildRecord(s, p, r, key);
    rec.contact = { name: s.name, phone: s.phone, email: s.email };
    rec.status = "заявка";
    setSaveState("saving");
    pushToSheet(rec, p.sheetEndpoint);
    const ok = await saveCalc(key, rec);
    setSaveState(ok ? "saved" : getStorageMode() === "none" ? "unavailable" : "error");
    alert(ok
      ? "Заявката е записана. Ще се свържем с Вас."
      : "Заявката не можа да се запише автоматично. Моля, обадете се на " + p.phone + ".");
  };

  const canNext =
    (step === 0 && s.service) ||
    (step === 1 && (s.service === "local" ? (s.city && (!NEIGHBORHOODS[s.city] || (s.pickupHood.trim() && s.dropoffHood.trim()))) : s.service === "intercity" ? (!!findCity(s.pickupCity) && !!findCity(s.dropoffCity)) : s.country)) ||
    (step === 2 && vol > 0);

  return (
    <div className="min-h-screen w-full" style={{ background: "#f6f7f9", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-2xl font-extrabold tracking-tight" style={{ color: ink }}>КОРЕКТ<span style={{ color: accent }}>.</span></div>
            <div className="text-xs text-slate-500 -mt-0.5">Калкулатор за приблизителна цена</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowLog((v) => !v)}
              className="text-sm font-semibold px-3 py-2 rounded-full border transition"
              style={{ borderColor: showLog ? ink : "#e2e6ec", color: showLog ? ink : "#64748b" }}>📋 Записи</button>
            <button onClick={() => setShowSettings((v) => !v)}
              className="text-sm font-semibold px-3 py-2 rounded-full border transition"
              style={{ borderColor: showSettings ? accent : "#e2e6ec", color: showSettings ? accent : "#64748b" }}>⚙ Параметри</button>
            <a href={p.phoneHref} className="text-sm font-semibold px-4 py-2 rounded-full text-white" style={{ background: ink }}>{p.phone}</a>
          </div>
        </div>

        {showLog && <LogPanel onClose={() => setShowLog(false)} />}
        {showSettings && <SettingsPanel p={p} setP={setP} saveState={paramSave} />}

        <div className="flex gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className="h-1.5 rounded-full transition-all" style={{ background: i <= step ? accent : "#e2e6ec" }} />
              <div className={`text-[11px] mt-1.5 ${i <= step ? "font-semibold" : "text-slate-400"}`} style={i <= step ? { color: ink } : {}}>{label}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 items-start">
          <div className="space-y-4">
            {/* STEP 0 */}
            {step === 0 && (
              <div className="space-y-3">
                <h2 className="text-xl font-bold" style={{ color: ink }}>Какъв тип услуга Ви трябва?</h2>
                {[
                  { id: "local", t: "Градско преместване", d: "В рамките на Вашия град", m: p.minPrice.local },
                  { id: "intercity", t: "Междуградско", d: "От всяка точка на страната", m: 0 },
                  { id: "international", t: "Международно", d: "Транспорт от и за ЕС", m: p.minPrice.international },
                ].map((o) => (
                  <button key={o.id} onClick={() => { set({ service: o.id, truckId: null }); setStep(1); }}
                    className={`w-full text-left rounded-2xl border p-5 bg-white transition hover:shadow-sm ${s.service === o.id ? "" : "border-slate-200"}`}
                    style={s.service === o.id ? { borderColor: "transparent", boxShadow: `0 0 0 2px ${accent}` } : {}}>
                    <div className="flex justify-between items-center">
                      <div><div className="font-semibold" style={{ color: ink }}>{o.t}</div><div className="text-sm text-slate-500">{o.d}</div></div>
                      <div className="text-right">
                        {o.m ? (
                          <><div className="text-xs text-slate-400">от</div><div className="font-bold" style={{ color: accent }}>{o.m} {p.currency}</div></>
                        ) : (
                          <div className="text-xs text-slate-400">цена по километри</div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* STEP 1 */}
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold" style={{ color: ink }}>Локация</h2>
                {s.service === "local" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-2">В кой град?</label>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {Object.keys(NEIGHBORHOODS).map((g) => (
                          <Pill key={g} active={s.city === g} onClick={() => set({ city: g, pickupHood: "", dropoffHood: "" })}>{g}</Pill>
                        ))}
                      </div>
                      <select value={NEIGHBORHOODS[s.city] ? "" : s.city}
                        onChange={(e) => set({ city: e.target.value, pickupHood: "", dropoffHood: "" })}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <option value="">Друг град или курорт…</option>
                        {Object.keys(CITIES).filter((c) => !NEIGHBORHOODS[c])
                          .sort((a, b) => a.localeCompare(b, "bg"))
                          .map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {s.city && NEIGHBORHOODS[s.city] && (
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Квартали</label>
                          <p className="text-xs text-slate-400 mb-3">Започнете да пишете и изберете квартал от списъка — километрите се изчисляват автоматично.</p>
                          <div className="grid grid-cols-2 gap-3">
                            <HoodInput city={s.city} value={s.pickupHood} onChange={(v) => set({ pickupHood: v })} placeholder="Квартал на товарене" />
                            <HoodInput city={s.city} value={s.dropoffHood} onChange={(v) => set({ dropoffHood: v })} placeholder="Квартал на разтоварване" />
                          </div>
                        </div>
                        {localEst != null && (
                          <div className="space-y-1">
                            <div className="text-sm text-slate-500">Приблизително разстояние: <span className="font-bold" style={{ color: ink }}>{oneWayKm} км</span></div>
                            {(!findHood(s.city, s.pickupHood) || !findHood(s.city, s.dropoffHood)) && (
                              <div className="text-xs" style={{ color: accent }}>
                                Непознат квартал — смятаме приблизително спрямо центъра. Може да продължите; ще уточним при потвърждаване.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {s.service === "local" && s.city && !NEIGHBORHOODS[s.city] && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="text-sm text-slate-500">
                      {s.city}: смятаме с типично разстояние в града — <span className="font-bold" style={{ color: ink }}>{oneWayKm} км</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      За преместване до друг град изберете „Междуградско".
                    </p>
                  </div>
                )}

                {s.service === "intercity" && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">Откъде — докъде</label>
                      <p className="text-xs text-slate-400 mb-3">От всяка точка на страната до всяка друга. Разстоянието се смята от център до център на градовете.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <span className="text-[11px] text-slate-500">Товарене</span>
                        <div className="mt-1">
                          <CityInput value={s.pickupCity} onChange={(v) => set({ pickupCity: v })} placeholder="Започнете да пишете…" />
                        </div>
                      </div>

                      <div>
                        <span className="text-[11px] text-slate-500">Разтоварване</span>
                        <div className="mt-1">
                          <CityInput value={s.dropoffCity} onChange={(v) => set({ dropoffCity: v })} placeholder="Започнете да пишете…" />
                        </div>
                      </div>
                    </div>

                    {s.pickupCity && s.dropoffCity && oneWayKm > 0 && (
                      <div className="text-sm text-slate-500">
                        Приблизително разстояние: <span className="font-bold" style={{ color: ink }}>{oneWayKm} км</span>
                        {oneWayKm < p.intercityThresholdKm && <span className="text-xs" style={{ color: accent }}> · под {p.intercityThresholdKm} км — смята се по почасова тарифа</span>}
                      </div>
                    )}
                    <p className="text-xs text-slate-400">Над {p.intercityThresholdKm} км се смята като курс: двупосочен пробег + по 1 ч товарене и разтоварване.</p>
                  </div>
                )}
                {s.service === "international" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">Държава в ЕС</label>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(p.euDistances).map((g) => (
                        <Pill key={g} active={s.country === g} onClick={() => set({ country: g })}>{g}</Pill>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-xl font-bold" style={{ color: ink }}>Списък с вещи</h2>
                    <div className="text-sm text-slate-500">Общо: <span className="font-bold" style={{ color: accent }}>{vol.toFixed(1)} м³</span></div>
                  </div>
                  <div className="space-y-2">
                    {CATALOG.map((grp) => {
                      const open = openGroups[grp.group];
                      const grpVol = grp.items.reduce((a, i) => a + (s.qty[i.id] || 0) * i.m3, 0);
                      return (
                        <div key={grp.group} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                          <button onClick={() => setOpenGroups((o) => ({ ...o, [grp.group]: !o[grp.group] }))}
                            className="w-full flex items-center justify-between px-4 py-3 text-left">
                            <span className="font-semibold text-sm" style={{ color: ink }}>{grp.group}</span>
                            <span className="flex items-center gap-3">
                              {grpVol > 0 && <span className="text-xs font-medium" style={{ color: accent }}>{grpVol.toFixed(1)} м³</span>}
                              <span className="text-slate-400 text-lg">{open ? "–" : "+"}</span>
                            </span>
                          </button>
                          {open && (
                            <div className="px-4 pb-3 divide-y divide-slate-50">
                              {grp.items.map((it) => {
                                const cnt = s.qty[it.id] || 0;
                                return (
                                  <div key={it.id} className="py-2.5">
                                    <div className="flex items-center justify-between">
                                      <div className="min-w-0 pr-3">
                                        <div className="text-sm text-slate-700 truncate">{it.label}</div>
                                        <div className="text-xs text-slate-400">
                                          {it.m3} м³ · {it.kg} кг/бр{it.surcharge ? ` · спец. +${it.surcharge}${p.currency}` : ""}
                                          {cnt > 0 ? ` · = ${(cnt * it.m3).toFixed(2)} м³ / ${cnt * it.kg} кг` : ""}
                                        </div>
                                      </div>
                                      <Stepper value={cnt} onChange={(v) => setQty(it.id, v)} />
                                    </div>
                                    {cnt > 0 && (it.dis || it.asm || it.wrap) && (
                                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                                        {it.dis && (
                                          <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input type="checkbox" checked={!!s.dis[it.id]} onChange={() => toggle("dis", it.id)} className="w-4 h-4 accent-orange-500" />
                                            <span className="text-xs" style={{ color: s.dis[it.id] ? accent : "#94a3b8" }}>
                                              🔧 разглоби{s.dis[it.id] ? ` +${(it.dis * cnt).toFixed(1)} чч` : ""}
                                            </span>
                                          </label>
                                        )}
                                        {it.asm && (
                                          <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input type="checkbox" checked={!!s.asm[it.id]} onChange={() => toggle("asm", it.id)} className="w-4 h-4 accent-orange-500" />
                                            <span className="text-xs" style={{ color: s.asm[it.id] ? accent : "#94a3b8" }}>
                                              🔩 сглоби{s.asm[it.id] ? ` +${(it.asm * cnt).toFixed(1)} чч` : ""}
                                            </span>
                                          </label>
                                        )}
                                        {it.wrap && (
                                          <label className={`flex items-center gap-1.5 ${it.wrapReq ? "" : "cursor-pointer"}`}>
                                            <input type="checkbox" checked={it.wrapReq || !!s.wrap[it.id]} disabled={it.wrapReq}
                                              onChange={() => toggle("wrap", it.id)} className="w-4 h-4 accent-orange-500" />
                                            <span className="text-xs" style={{ color: it.wrapReq || s.wrap[it.id] ? accent : "#94a3b8" }}>
                                              📦 стреч {it.wrap * cnt} м{it.wrapReq ? " (задължително)" : ""}
                                            </span>
                                          </label>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 rounded-xl px-4 py-3 flex justify-between items-center" style={{ background: "#eef1f5" }}>
                    <span className="text-sm font-medium" style={{ color: ink }}>
                      Обем · тегло · курсове{disHours > 0 ? " · разгл./сглоб." : ""}{wrapMeters > 0 ? " · стреч" : ""}
                    </span>
                    <span className="font-bold" style={{ color: ink }}>
                      {vol.toFixed(1)} м³ · {weight} кг · {trips} курс{trips === 1 ? "" : "а"}{disHours > 0 ? ` · ${disHours.toFixed(1)} ч × ${disCrew}` : ""}{wrapMeters > 0 ? ` · ${rolls.toFixed(1)} рол.` : ""}
                    </span>
                  </div>
                </div>

                {weightLimited && (
                  <div className="rounded-xl p-3 text-sm" style={{ background: "#fff8ef", border: "1px solid #f3ddbd" }}>
                    ⚖️ Курсовете се определят от <b>теглото</b>, не от обема: {weight} кг при товароносимост {payload} кг
                    на курс ({tripsByKg} курса по тегло срещу {tripsByVol} по обем).
                  </div>
                )}

                {/* Организация на курса — кой пътува и как се плаща */}
                {isCourse && vol > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h3 className="font-semibold mb-1" style={{ color: ink }}>Организация на курса</h3>
                    <p className="text-xs text-slate-400 mb-3">
                      Пътят е ≈ {fmtTime(driveHours)} двупосочно
                      ({fmtTime(oneWayDriveH)} в едната посока).
                      {nights > 0 && <span style={{ color: accent }}> · включена е {nights === 1 ? "нощувка" : `${nights} нощувки`}</span>}
                    </p>
                    <div className="space-y-2">
                      <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer"
                        style={{ borderColor: s.courseMode === "dayCrew" ? accent : "#e2e8f0" }}>
                        <input type="radio" name="courseMode" checked={s.courseMode === "dayCrew"}
                          onChange={() => set({ courseMode: "dayCrew" })} className="mt-0.5 accent-orange-500" />
                        <span>
                          <span className="text-sm font-medium block" style={{ color: ink }}>Наши хора пътуват (шофьор + {p.travelCrew})</span>
                          <span className="text-xs text-slate-500">
                            Придружаващият се плаща на ден, не на час — {travelDays} {travelDays === 1 ? "ден" : "дни"} × {p.workerDayRate} {p.currency}
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer"
                        style={{ borderColor: s.courseMode === "localCrew" ? accent : "#e2e8f0" }}>
                        <input type="radio" name="courseMode" checked={s.courseMode === "localCrew"}
                          onChange={() => set({ courseMode: "localCrew" })} className="mt-0.5 accent-orange-500" />
                        <span className="flex-1">
                          <span className="text-sm font-medium block" style={{ color: ink }}>Шофьорът пътува, местен екип разтоварва</span>
                          <span className="text-xs text-slate-500">
                            {p.localCrewSize} души от най-близката база — плаща им се пътят до адреса и обратно плюс работата (минимум {p.localCrewMinHours} ч)
                          </span>
                          {s.courseMode === "localCrew" && (
                            <span className="block mt-2">
                              <select value={s.baseCity} onChange={(e) => set({ baseCity: e.target.value })}
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                                <option value="">Автоматично{baseCity ? ` (${baseCity})` : ""}</option>
                                {BASES.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                              {baseCity && (
                                <span className="block mt-2">
                                  <span className="block text-xs text-slate-500">
                                    {baseCity} → {s.dropoffCity}: {baseKm} км в едната посока ({2 * baseKm} км двупосочно)
                                  </span>
                                  <span className="block text-xs mt-1" style={{ color: needCar ? accent : "#64748b" }}>
                                    {needCar
                                      ? `🚗 със собствена кола — ${2 * baseKm} км × ${p.carRatePerKm} ${p.currency}/км`
                                      : "🚚 качват се на камиона на минаване (без кола)"}
                                  </span>
                                  {baseIsOnRoute && (
                                    <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                                      <input type="checkbox" checked={!!s.forceCar}
                                        onChange={(e) => set({ forceCar: e.target.checked })} className="w-4 h-4 accent-orange-500" />
                                      <span className="text-xs text-slate-500">все пак пътуват с кола</span>
                                    </label>
                                  )}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </label>

                      <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer"
                        style={{ borderColor: s.courseMode === "selfUnload" ? accent : "#e2e8f0" }}>
                        <input type="radio" name="courseMode" checked={s.courseMode === "selfUnload"}
                          onChange={() => set({ courseMode: "selfUnload" })} className="mt-0.5 accent-orange-500" />
                        <span>
                          <span className="text-sm font-medium block" style={{ color: ink }}>Клиентът разтоварва сам</span>
                          <span className="text-xs text-slate-500">
                            Плаща се само товаренето и транспортът — без разтоварване и без стълби на адреса на доставка
                          </span>
                        </span>
                      </label>

                      <label className="flex items-start gap-3 rounded-xl border p-3 cursor-pointer"
                        style={{ borderColor: s.courseMode === "hourly" ? accent : "#e2e8f0" }}>
                        <input type="radio" name="courseMode" checked={s.courseMode === "hourly"}
                          onChange={() => set({ courseMode: "hourly" })} className="mt-0.5 accent-orange-500" />
                        <span>
                          <span className="text-sm font-medium block" style={{ color: ink }}>Почасово (товарене и разтоварване)</span>
                          <span className="text-xs text-slate-500">По 1 ч товарене и 1 ч разтоварване на курс, платени на час</span>
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Избор на камион — само за извънградско/международно */}
                {s.service !== "local" && vol > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2" style={{ color: ink }}>Камион</h3>
                    <div className="flex flex-wrap gap-2">
                      <Pill active={s.truckId === null} onClick={() => set({ truckId: null })}>
                        Автоматично{auto && chosen ? ` (${chosen.name})` : ""}
                      </Pill>
                      {fleet.map((t) => (
                        <Pill key={t.id} active={s.truckId === t.id} onClick={() => set({ truckId: t.id })}>
                          {t.name} · {t.cap.toFixed(0)} м³
                        </Pill>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-2">По-голям камион = по-малко курсове и по-малко пробег.</p>
                  </div>
                )}

                <AddressBlock title="Адрес на товарене" data={s.pickup} onChange={(d) => set({ pickup: d })} />
                <AddressBlock title="Адрес на разтоварване" data={s.dropoff} onChange={(d) => set({ dropoff: d })} />

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-medium mb-1" style={{ color: ink }}>Опаковане</div>
                  <p className="text-xs text-slate-400">
                    Матраците и техниката се опаковат задължително със стреч фолио. За останалите мебели отметнете „📦 стреч" при вещта.
                  </p>
                  {wrapMeters > 0 && (
                    <div className="text-xs mt-2" style={{ color: ink }}>
                      Общо <b>{wrapMeters} м</b> → <b>{rolls.toFixed(1)} ролки</b> × {p.stretchRollPrice} {p.currency} · труд {wrapHours.toFixed(1)} чч
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="rounded-2xl p-6 text-white" style={{ background: ink }}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm opacity-80">Прогнозна цена — по опит</div>
                      <div className="text-4xl font-extrabold mt-1">≈ {total} {p.currency}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm opacity-80">Обем · тегло</div>
                      <div className="text-2xl font-bold mt-1" style={{ color: accent }}>{vol.toFixed(1)} м³</div>
                      <div className="text-sm font-semibold" style={{ color: accent }}>{weight} кг</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {[
                      ["Време труд", `${manHours.toFixed(1)} чч`],
                      ["Бригада", `${crew} души${crewByProtocol ? " (протокол)" : ""} · ${clockHours.toFixed(1)} ч`],
                      ["Курсове", `${trips}`],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.08)" }}>
                        <div className="text-[11px] opacity-70">{k}</div>
                        <div className="font-bold text-sm">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(255,255,255,0.08)" }}>
                    🚚 {chosen?.name} · {!isCourse ? <>път <b>{totalKm} км</b> (адрес→адрес)</> : <>разстояние {oneWayKm} км × {trips} курс{trips === 1 ? "" : "а"} двупосочно = <b>{totalKm} км</b></>} · ≈ {fmtTime(driveHours)}
                  </div>
                  <div className="text-xs opacity-70 mt-3">
                    Ориентировъчна цена. За точна оферта при по-сложни премествания препоръчваме безплатен оглед.
                    {saveState === "saving" && <span className="ml-1">· записва се…</span>}
                    {saveState === "saved" && <span className="ml-1">· Калкулацията е запазена автоматично ✓</span>}
                    {saveState === "unavailable" && <span className="ml-1">· Записът не е наличен в тази среда</span>}
                    {saveState === "error" && <span className="ml-1">· Записът не бе запазен</span>}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="text-sm font-semibold mb-3" style={{ color: ink }}>Вашето задание</div>

                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Услуга</span>
                      <span className="text-right" style={{ color: ink }}>
                        {s.service === "local" ? "Градско преместване" : s.service === "intercity" ? "Междуградско" : "Международно"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Маршрут</span>
                      <span className="text-right" style={{ color: ink }}>
                        {s.service === "local"
                          ? (NEIGHBORHOODS[s.city] ? `${s.city}: ${s.pickupHood} → ${s.dropoffHood} (${oneWayKm} км)` : `${s.city} (${oneWayKm} км)`)
                          : s.service === "intercity" ? `${s.pickupCity} → ${s.dropoffCity} (${oneWayKm} км, център до център)` : `${s.country} (${oneWayKm} км)`}
                      </span>
                    </div>
                    {isCourse && (
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500">Организация</span>
                        <span className="text-right" style={{ color: ink }}>
                          {dayCrewMode ? `Наши хора пътуват · ${travelDays} ${travelDays === 1 ? "ден" : "дни"}` : localCrewMode ? `Местен екип от ${baseCity} · ${needCar ? "с кола" : "пътува с камиона"}` : selfUnloadMode ? "Клиентът разтоварва сам" : "Почасово товарене/разтоварване"}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Товарене</span>
                      <span className="text-right" style={{ color: ink }}>
                        {s.pickup.building}, {s.pickup.floor === 0 ? "партер" : `${s.pickup.floor} ет.`} ·{" "}
                        {s.pickup.elevator ? (s.pickup.elevatorType === "cargo" ? "товарен асансьор" : "пътнически асансьор") : "без асансьор"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Разтоварване</span>
                      <span className="text-right" style={{ color: ink }}>
                        {s.dropoff.building}, {s.dropoff.floor === 0 ? "партер" : `${s.dropoff.floor} ет.`} ·{" "}
                        {s.dropoff.elevator ? (s.dropoff.elevatorType === "cargo" ? "товарен асансьор" : "пътнически асансьор") : "без асансьор"}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">Вещи</div>
                  <div className="space-y-1">
                    {Object.entries(s.qty).filter(([, cnt]) => cnt > 0).map(([id, cnt]) => {
                      const it = ITEM_INDEX[id];
                      if (!it) return null;
                      const tags = [];
                      if (s.dis[id] && it.dis) tags.push("разглобяване");
                      if (s.asm[id] && it.asm) tags.push("сглобяване");
                      if (it.wrapReq) tags.push("стреч (задълж.)");
                      else if (s.wrap[id] && it.wrap) tags.push("стреч");
                      return (
                        <div key={id} className="flex justify-between gap-3 text-sm">
                          <span className="text-slate-600">
                            {cnt} × {it.label}
                            {tags.length > 0 && <span className="text-xs" style={{ color: accent }}> · {tags.join(", ")}</span>}
                          </span>
                          <span className="text-slate-400 text-xs whitespace-nowrap">{(cnt * it.m3).toFixed(2)} м³</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between text-sm font-semibold pt-2 mt-2 border-t border-slate-100" style={{ color: ink }}>
                    <span>Общо {vol.toFixed(1)} м³ · {weight} кг · {trips} курс{trips === 1 ? "" : "а"} · бригада {crew} души</span>
                  </div>

                  {(disHours > 0 || wrapMeters > 0) && (
                    <div className="text-xs text-slate-500 mt-2 leading-relaxed">
                      {disHours > 0 && <>Разглобяване и сглобяване: {disHours.toFixed(1)} ч с {disCrew} души. </>}
                      {wrapMeters > 0 && <>Опаковане със стреч: {wrapMeters} м.</>}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="text-sm font-semibold mb-3" style={{ color: ink }}>Как се формира</div>
                  <div className="space-y-1.5">
                    {lines.map((l, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-600 pr-2">{l.label}</span>
                        <span className="font-medium whitespace-nowrap" style={{ color: ink }}>{l.amount} {p.currency}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-bold pt-2 mt-1 border-t border-slate-100" style={{ color: ink }}>
                      <span>Общо</span><span>{total} {p.currency}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 mt-4 pt-3 border-t border-slate-100 leading-relaxed">
                    Тази цена е ориентировъчна, генерирана на база нашия опит с изкуствен интелект.
                    Запазваме си правото за обоснована промяна на генерираната цена.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="text-sm font-semibold mb-1" style={{ color: ink }}>Заявете потвърждение</div>
                  <p className="text-xs text-slate-400 mb-3">
                    Данните се записват автоматично, докато пишете — бутонът само потвърждава заявката.
                    {saveState === "saving" && <span> · записва се…</span>}
                    {saveState === "saved" && <span style={{ color: accent }}> · запазено ✓</span>}
                  </p>
                  <div className="grid gap-3">
                    <input placeholder="Име" value={s.name} onChange={(e) => set({ name: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                    <input placeholder="Телефон" value={s.phone} onChange={(e) => set({ phone: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                    <input placeholder="Имейл" value={s.email} onChange={(e) => set({ email: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                    <button onClick={submitRequest}
                      className="rounded-xl py-3 font-semibold text-white" style={{ background: accent }}>Изпрати заявка</button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              {step > 0 ? <button onClick={() => setStep(step - 1)} className="text-sm font-medium text-slate-500 hover:text-slate-700">← Назад</button> : <span />}
              {step < 3 && step !== 0 && (
                <button disabled={!canNext} onClick={() => setStep(step + 1)}
                  className="text-sm font-semibold px-6 py-2.5 rounded-full text-white disabled:opacity-40" style={{ background: ink }}>
                  {step === 2 ? "Изчисли цена →" : "Напред →"}
                </button>
              )}
            </div>
          </div>

          {/* Sidebar */}
        </div>
      </div>
    </div>
  );
}
