/* ================================================================== *
 *  КОРЕКТ — калкулатор за клиенти (страницата на сайта, без вход)
 *  Ползва същия ценови двигател като korekt-calculator.jsx: build-klient.mjs
 *  слага пред този файл всичко до маркера END ENGINE. Тук е само интерфейсът.
 *  Задание: втори мозък → бизнес\калкулатор-за-клиенти.md
 * ================================================================== */

// Кога НЕ се показва цена, а „подлежи на оглед“ (решения на Додо, 18.11.2026)
const LIMITS = {
  local: { maxM3: 10, maxPriceVat: 300 },          // градско: до 10 м³ и до 300 €
  intercity: { maxM3: 12, maxKg: 1300 },           // извънградско: едно наше камионче
};
const DISCOUNT_PCT = 5;
const DISCOUNT_DAYS = 14;
const PHONE = "0882 944 099";
const PHONE2 = "0888 883 237";
const VAT = 1.2;
const RED = "#d92027", BLUE = "#1d5fc2", INK = "#0f172a";

const K_INITIAL = {
  service: null, city: "София", country: "", km: 0, localKm: 12, pickupHood: "", dropoffHood: "", pickupCity: "", dropoffCity: "", truckId: null, courseMode: "hourly", baseCity: "", labourBase: "", crewOverride: 0, manualHours: 0, kmOverride: 0, hoursOverride: 0, forceCar: false, weFill: true, landfillKm: 0, wasteType: "household", disposalTrucks: 1, deviationOverride: 0, qty: {}, dis: {}, asm: {}, wrap: {}, protect: {}, selfPack: {}, floorFeeOff: {}, fill: {}, buyBox: {}, stretchRollsManual: 0, stretchRollPriceManual: 0,
  pickup: { building: "Апартамент", floor: 0, elevator: false, elevatorType: "passenger", carryDistanceM: 0 },
  dropoff: { building: "Апартамент", floor: 0, elevator: false, elevatorType: "passenger", carryDistanceM: 0 },
  extras: { packing: false, materials: false, disassembly: false },
  name: "", phone: "", email: "", requestNumber: "",
};

// групите от каталога, които клиентът вижда (без отпадъци за изхвърляне)
const CLIENT_GROUPS = CATALOG.filter((g) => !/Отпадък/.test(g.group));
// тежки и обемисти предмети и прецизна техника: цена не се показва — определя се след разговор
// с колега от кол-центъра и при нужда оглед (решение на Додо, 18.11.2026)
const HEAVY_KG = 100;
const SPECIAL_IDS = new Set(CATALOG.filter((g) => /Специални/.test(g.group)).flatMap((g) => g.items.map((i) => i.id)));
const isSpecialItem = (it) => !!it && (SPECIAL_IDS.has(it.id) || !!it.surcharge || it.kind === "appliance_heavy" || (it.kg || 0) >= HEAVY_KG);
const POPULAR = ["fridge", "washer", "sofa3", "wardrobe2", "bed2", "boxM"].filter((id) => ITEM_INDEX[id]);

async function loadLiveParams() {
  const url = DEFAULTS.supabaseUrl, key = DEFAULTS.supabaseKey;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/voice_pricing`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}",
    });
    const value = res.ok ? await res.json() : null;
    if (value && typeof value === "object") return mergeParams(value);
  } catch (e) { /* без връзка — стойностите по подразбиране */ }
  return mergeParams({});
}

async function saveInquiry(id, data) {
  const url = DEFAULTS.supabaseUrl, key = DEFAULTS.supabaseKey;
  const res = await fetch(`${url}/rest/v1/rpc/save_site_inquiry`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id, p_data: data }),
  });
  if (!res.ok) throw new Error("save " + res.status);
  return res.json();
}

function Card({ children, className = "" }) {
  return <div className={"bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 " + className}>{children}</div>;
}
function Label({ children }) { return <div className="text-sm font-semibold text-slate-700 mb-1.5">{children}</div>; }
function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function Stepper({ value, onChange, min = 0, max = 99 }) {
  const btn = "w-10 h-10 rounded-full border border-slate-300 text-xl font-semibold text-slate-700 active:bg-slate-100 disabled:opacity-30";
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="по-малко">−</button>
      <span className="w-8 text-center text-base font-semibold tabular-nums">{value}</span>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label="повече">+</button>
    </div>
  );
}
function Address({ title, a, set }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
      <div className="font-semibold text-slate-800 mb-3">{title}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-600">Етаж <span className="text-slate-400">(0 = партер / къща)</span></span>
        <Stepper value={a.floor} max={25} onChange={(v) => set({ ...a, floor: v })} />
      </div>
      {a.floor > 0 && (
        <label className="flex items-center gap-3 mt-3 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-blue-600" checked={a.elevator} onChange={(e) => set({ ...a, elevator: e.target.checked })} />
          <span className="text-sm text-slate-700">Има асансьор</span>
        </label>
      )}
    </div>
  );
}

function KlientCalculator() {
  const [p, setP] = useState(null);
  const [s, setS] = useState(K_INITIAL);
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [other, setOther] = useState("");
  const [contact, setContact] = useState({ first: "", last: "", phone: "", email: "", consent: false, website: "" });
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);   // { number } след запис
  const [error, setError] = useState("");
  const idRef = useRef("calc:site-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8));

  useEffect(() => { loadLiveParams().then(setP); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);

  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const setQty = (id, v) => setS((x) => { const qty = { ...x.qty }; if (v > 0) qty[id] = v; else delete qty[id]; return { ...x, qty }; });
  const itemCount = Object.values(s.qty).reduce((a, b) => a + b, 0);

  const r = useMemo(() => {
    if (!p || !s.service || !itemCount) return null;
    try { return computePrice(s, p); } catch (e) { return null; }
  }, [p, s, itemCount]);

  const priceVat = r ? Math.round(r.total * VAT) : 0;
  const lim = LIMITS[s.service] || {};
  const reasons = [];
  if (r) {
    if (lim.maxM3 && r.vol > lim.maxM3) reasons.push(`обемът е над ${lim.maxM3} м³`);
    if (lim.maxKg && r.weight > lim.maxKg) reasons.push(`багажът е над ${lim.maxKg} кг`);
    if (lim.maxPriceVat && priceVat > lim.maxPriceVat) reasons.push("задачата е по-голяма от обичайното");
    const special = Object.keys(s.qty).map((id) => ITEM_INDEX[id]).filter(isSpecialItem);
    if (special.length) reasons.push("има тежки, обемисти или прецизни предмети: " + special.map((i) => i.label).join(", "));
    if (other.trim()) reasons.push("има вещи извън списъка");
  }
  const needsSurvey = reasons.length > 0;

  const hoods = (NEIGHBORHOODS[s.city] || []).map((h) => h.name);
  const cities = Object.keys(CITIES);
  const addressOk = s.service === "local" ? !!(s.city && s.pickupHood && s.dropoffHood)
    : !!(s.pickupCity && s.dropoffCity && s.pickupCity !== s.dropoffCity);

  const q = search.trim().toLowerCase();
  const found = q ? CLIENT_GROUPS.flatMap((g) => g.items).filter((i) => i.label.toLowerCase().includes(q)).slice(0, 12) : [];

  const phoneOk = contact.phone.replace(/\D/g, "").length >= 9;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim());
  const formOk = contact.first.trim() && contact.last.trim() && phoneOk && (needsSurvey || emailOk) && contact.consent;

  async function submit() {
    if (!formOk || sending) return;
    if (contact.website) { setDone({ number: null }); return; } // скрито поле — попълват го само ботове
    setSending(true); setError("");
    try {
      const rec = buildRecord({ ...s, name: `${contact.first.trim()} ${contact.last.trim()}`, phone: contact.phone.trim(), email: contact.email.trim() }, p, r, idRef.current, null, "Сайт (клиент)");
      const until = new Date(Date.now() + DISCOUNT_DAYS * 864e5).toISOString().slice(0, 10);
      Object.assign(rec, {
        status: "заявка", source: "сайт",
        contact: { name: `${contact.first.trim()} ${contact.last.trim()}`, phone: contact.phone.trim(), email: contact.email.trim() || null },
        notes: [other.trim() ? "Клиентът добавя (извън списъка): " + other.trim() : "", needsSurvey ? "ЗА ОГЛЕД — на клиента не е показана цена (" + reasons.join("; ") + ")." : ""].filter(Boolean).join("\n") || null,
        site: {
          shownPriceVat: needsSurvey ? null : priceVat,           // какво е видял клиентът — не се променя при редакция
          needsSurvey, surveyReasons: reasons,
          discountPct: needsSurvey ? 0 : DISCOUNT_PCT, discountUntil: needsSurvey ? null : until,
          consentAt: new Date().toISOString(), consentText: "Съгласие за обработка на лични данни за изготвяне на оферта",
        },
      });
      const number = await saveInquiry(idRef.current, rec);
      setDone({ number });
    } catch (e) {
      setError(`Не успяхме да запишем запитването. Моля, обадете се на ${PHONE}.`);
    } finally { setSending(false); }
  }

  const Next = ({ disabled, children, onClick }) => (
    <button type="button" disabled={disabled} onClick={onClick}
      className="w-full rounded-xl py-4 text-base font-bold text-white disabled:opacity-40" style={{ background: BLUE }}>{children}</button>
  );
  const Back = () => step > 0 && !done && (
    <button type="button" onClick={() => setStep(step - 1)} className="text-sm text-slate-500 underline mb-3">← Назад</button>
  );
  const input = "w-full rounded-xl border border-slate-300 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-white border-b-4" style={{ borderColor: RED }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <img src="logo-korekt.png" alt="Корект преместване" className="h-10" />
          <a href={"tel:" + PHONE.replace(/\s/g, "")} className="text-sm font-bold whitespace-nowrap" style={{ color: BLUE }}>☎ {PHONE}</a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: BLUE }}>Колко ще струва преместването?</h1>
          <p className="text-slate-600 mt-1">Отговорете на три въпроса и вижте ориентировъчна цена веднага.</p>
          {!done && <div className="flex gap-1.5 mt-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i <= step ? BLUE : "#cbd5e1" }} />)}</div>}
        </div>

        {!p && <Card><div className="text-slate-500">Зареждане на цените…</div></Card>}

        {p && done && (
          <Card>
            <div className="text-xl font-extrabold" style={{ color: INK }}>Благодарим Ви, {contact.first.trim()}!</div>
            <p className="mt-2 text-slate-700">Запитването е получено{done.number ? <> под № <b>{done.number}</b></> : null}. Наш колега ще Ви се обади на <b>{contact.phone}</b> в работно време, за да уточни подробностите{needsSurvey ? " и да уговори оглед" : " и да потвърди крайната цена"}.</p>
            {!needsSurvey && <p className="mt-3 rounded-xl bg-green-50 border border-green-200 p-3 text-green-900 text-sm">Запазихме Ви <b>{DISCOUNT_PCT}% отстъпка</b> от крайната цена. Важи {DISCOUNT_DAYS} дни.</p>}
            <p className="mt-3 text-sm text-slate-500">Бързате? Обадете се на {PHONE} или {PHONE2}.</p>
          </Card>
        )}

        {p && !done && step === 0 && (
          <Card>
            <div className="text-lg font-bold mb-4">1. Къде се местите?</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {[["local", "В рамките на града", "От адрес до адрес в един град"], ["intercity", "Между градове", "От един град до друг в България"]].map(([id, t, d]) => (
                <button key={id} type="button" onClick={() => { set({ service: id, pickupHood: "", dropoffHood: "", pickupCity: "", dropoffCity: "" }); setStep(1); }}
                  className="text-left rounded-2xl border-2 p-4 hover:border-blue-500" style={{ borderColor: s.service === id ? BLUE : "#e2e8f0" }}>
                  <div className="font-bold text-base">{t}</div>
                  <div className="text-sm text-slate-500 mt-1">{d}</div>
                </button>
              ))}
            </div>
            <p className="text-sm text-slate-500 mt-4">За международно преместване, офис или склад се обадете на {PHONE}.</p>
          </Card>
        )}

        {p && !done && step === 1 && (
          <Card>
            <Back />
            <div className="text-lg font-bold mb-4">2. Адреси</div>
            {s.service === "local" ? (
              <div className="space-y-3">
                <div><Label>Град</Label><Select value={s.city} onChange={(v) => set({ city: v, pickupHood: "", dropoffHood: "" })} options={Object.keys(NEIGHBORHOODS)} placeholder="Изберете град" /></div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>От квартал</Label><Select value={s.pickupHood} onChange={(v) => set({ pickupHood: v })} options={hoods} placeholder="Изберете" /></div>
                  <div><Label>До квартал</Label><Select value={s.dropoffHood} onChange={(v) => set({ dropoffHood: v })} options={hoods} placeholder="Изберете" /></div>
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                <div><Label>От град</Label><Select value={s.pickupCity} onChange={(v) => set({ pickupCity: v })} options={cities} placeholder="Изберете" /></div>
                <div><Label>До град</Label><Select value={s.dropoffCity} onChange={(v) => set({ dropoffCity: v })} options={cities.filter((c) => c !== s.pickupCity)} placeholder="Изберете" /></div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <Address title="Откъде взимаме" a={s.pickup} set={(a) => set({ pickup: a })} />
              <Address title="Къде доставяме" a={s.dropoff} set={(a) => set({ dropoff: a })} />
            </div>
            <div className="mt-5"><Next disabled={!addressOk} onClick={() => setStep(2)}>Напред</Next></div>
          </Card>
        )}

        {p && !done && step === 2 && (
          <Card>
            <Back />
            <div className="text-lg font-bold mb-1">3. Какво ще местим?</div>
            <p className="text-sm text-slate-500 mb-4">Добавете вещите с бутона +. Избрани: <b>{itemCount}</b></p>
            <input className={input} placeholder="Търсене: гардероб, диван, пералня…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {q ? (
              <div className="mt-3 divide-y divide-slate-100">
                {found.length ? found.map((it) => <ItemRow key={it.id} it={it} qty={s.qty[it.id] || 0} setQty={setQty} />) : <div className="py-3 text-sm text-slate-500">Няма такава вещ в списъка. Опишете я в полето най-долу.</div>}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-slate-200">
                  <div className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">Най-чести</div>
                  <div className="px-4 divide-y divide-slate-100">{POPULAR.map((id) => <ItemRow key={id} it={ITEM_INDEX[id]} qty={s.qty[id] || 0} setQty={setQty} />)}</div>
                </div>
                {CLIENT_GROUPS.map((g) => {
                  const n = g.items.reduce((a, i) => a + (s.qty[i.id] || 0), 0);
                  return (
                    <details key={g.group} className="rounded-xl border border-slate-200">
                      <summary className="px-4 py-3 font-semibold cursor-pointer flex justify-between"><span>{g.group}</span>{n > 0 && <span className="text-sm font-bold" style={{ color: BLUE }}>{n} бр.</span>}</summary>
                      <div className="px-4 pb-2 divide-y divide-slate-100">{g.items.map((it) => <ItemRow key={it.id} it={it} qty={s.qty[it.id] || 0} setQty={setQty} />)}</div>
                    </details>
                  );
                })}
              </div>
            )}
            <div className="mt-4">
              <Label>Нещо, което го няма в списъка? <span className="font-normal text-slate-400">(по желание)</span></Label>
              <textarea className={input} rows={2} maxLength={500} placeholder="Напр. пиано, сейф, аквариум 300 л" value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
            <div className="mt-5"><Next disabled={!itemCount} onClick={() => setStep(3)}>Виж цената</Next></div>
          </Card>
        )}

        {p && !done && step === 3 && r && (
          <>
            <Card>
              <Back />
              {needsSurvey ? (
                <>
                  <div className="text-lg font-bold">Цената се определя след разговор с наш колега</div>
                  <p className="mt-2 text-slate-700">За това преместване не можем да покажем цена онлайн ({reasons.join("; ")}). Наш колега ще уточни подробностите по телефона и при нужда ще уговорим безплатен оглед.</p>
                  <a href={"tel:" + PHONE.replace(/\s/g, "")} className="mt-4 block text-center rounded-xl py-4 text-lg font-extrabold text-white" style={{ background: RED }}>☎ Обадете се: {PHONE}</a>
                  <p className="mt-3 text-sm text-slate-500 text-center">или оставете телефон и ние ще Ви се обадим</p>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Ориентировъчна цена</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-5xl font-extrabold tabular-nums" style={{ color: INK }}>{priceVat} €</span>
                    <span className="text-slate-500">с ДДС</span>
                  </div>
                  <div className="mt-3 text-sm text-slate-600">
                    {s.service === "local" ? `${s.city}: ${s.pickupHood} → ${s.dropoffHood}` : `${s.pickupCity} → ${s.dropoffCity}`} · {itemCount} вещи · около {r.vol.toFixed(1)} м³ · {r.crew} души · ≈ {r.clockHours.toFixed(1)} ч
                  </div>
                  <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                    Цената е изчислена автоматично от нашия калкулатор по нашите цени и опит и е ориентировъчна. Възможни са отклонения и си запазваме правото да я променим след уточняване на заданието. За въпроси: {PHONE}.
                  </div>
                </>
              )}
            </Card>

            <Card>
              {!needsSurvey && !showForm ? (
                <>
                  <div className="text-lg font-bold">Устройва ли Ви цената?</div>
                  <p className="mt-1 text-slate-700">Оставете данните си сега и получавате <b>още {DISCOUNT_PCT}% отстъпка</b> от крайната цена, която ще потвърдим по телефона.</p>
                  <button type="button" onClick={() => setShowForm(true)} className="mt-4 w-full rounded-xl py-4 text-lg font-extrabold text-white" style={{ background: RED }}>Вземи {DISCOUNT_PCT}% отстъпка</button>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold mb-3">{needsSurvey ? "Оставете телефон за връзка" : `Вашите данни за ${DISCOUNT_PCT}% отстъпка`}</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div><Label>Име</Label><input className={input} autoComplete="given-name" maxLength={60} value={contact.first} onChange={(e) => setContact({ ...contact, first: e.target.value })} /></div>
                    <div><Label>Фамилия</Label><input className={input} autoComplete="family-name" maxLength={60} value={contact.last} onChange={(e) => setContact({ ...contact, last: e.target.value })} /></div>
                    <div><Label>Телефон</Label><input className={input} type="tel" autoComplete="tel" maxLength={20} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></div>
                    <div><Label>Имейл{needsSurvey && <span className="font-normal text-slate-400"> (по желание)</span>}</Label><input className={input} type="email" autoComplete="email" maxLength={120} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></div>
                  </div>
                  <input type="text" tabIndex={-1} autoComplete="off" value={contact.website} onChange={(e) => setContact({ ...contact, website: e.target.value })} style={{ position: "absolute", left: "-9999px" }} aria-hidden="true" />
                  <label className="flex items-start gap-3 mt-4 cursor-pointer">
                    <input type="checkbox" className="w-5 h-5 mt-0.5 accent-blue-600" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} />
                    <span className="text-sm text-slate-700">Съгласен съм „Корект преместване“ да обработи данните ми, за да изготви оферта и да се свърже с мен.</span>
                  </label>
                  {error && <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>}
                  <div className="mt-4"><Next disabled={!formOk || sending} onClick={submit}>{sending ? "Изпращане…" : needsSurvey ? "Обадете ми се" : `Запази ${DISCOUNT_PCT}% отстъпка`}</Next></div>
                </>
              )}
            </Card>
          </>
        )}
      </main>
      <footer className="max-w-2xl mx-auto px-4 pb-8 text-xs text-slate-400">Корект преместване ООД · {PHONE} · {PHONE2}</footer>
    </div>
  );
}

function ItemRow({ it, qty, setQty }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className={"text-base " + (qty ? "font-semibold text-slate-900" : "text-slate-700")}>{it.label}</span>
      <Stepper value={qty} onChange={(v) => setQty(it.id, v)} />
    </div>
  );
}
