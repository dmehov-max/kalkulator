# Как да кача калкулатора на korekt-bg.com

Файлът `korekt-calculator.html` е самостоятелен — съдържа целия калкулатор. Остава само да живее на адрес, който колегите и клиентите отварят.

---

## Вариант А: Netlify Drop — най-бързо (2 минути, безплатно)

Работи с влачене на файл, без акаунт за първия път.

1. Създай папка на компютъра, например `kalkulator`
2. Сложи `korekt-calculator.html` вътре и **преименувай файла на `index.html`**
   (важно е — така адресът е чист, без име на файл)
3. Отвори **app.netlify.com/drop**
4. Влачи цялата папка в полето
5. Готово — получаваш адрес от вида `https://random-name-12345.netlify.app`
6. За по-приличен адрес: регистрирай се безплатно и от Site settings → Change site name го направи например `korekt-kalkulator`

**Резултат:** `https://korekt-kalkulator.netlify.app`

---

## Вариант Б: На поддомейн на korekt-bg.com (най-професионално)

Ако имаш достъп до DNS настройките на домейна:

1. Направи сайта в Netlify по горния начин
2. В Netlify: Domain settings → Add custom domain → `kalkulator.korekt-bg.com`
3. Netlify показва CNAME запис — добави го при регистратора на домейна
4. След 15–60 минути адресът работи, със сертификат

**Резултат:** `https://kalkulator.korekt-bg.com`

---

## Вариант В: Вграждане в страница на сайта (Composity)

След като файлът е качен някъде (Вариант А или Б), го вграждаш като рамка в обикновена страница на сайта.

1. В Composity създай нова страница, например „Калкулатор"
2. Отвори HTML редактора на съдържанието
3. Постави този код, като смениш адреса с твоя:

```html
<iframe
  src="https://korekt-kalkulator.netlify.app"
  style="width:100%; height:1400px; border:0; display:block;"
  title="Калкулатор за приблизителна цена">
</iframe>
```

**Ако Composity изрязва `<iframe>`**, потърси блок/уиджет от типа „HTML", „Embed" или „Custom code" — в такива блокове обикновено е позволен. Ако и това не стане, остава линк-бутон:

```html
<a href="https://korekt-kalkulator.netlify.app"
   style="display:inline-block;background:#e8952f;color:#fff;
          padding:14px 28px;border-radius:999px;font-weight:600;
          text-decoration:none;">
  Изчисли цена за преместване
</a>
```

---

## Вариант Г: GitHub Pages (щом качиш репото)

1. Качи репото в GitHub (папка `korekt-repo` от zip файла)
2. Преименувай `korekt-calculator.html` на `index.html`
3. Settings → Pages → Source: `main` branch → Save

**Резултат:** `https://<твоят-профил>.github.io/<име-на-репото>`

---

## След качването

- Отвори калкулатора и в **⚙ Параметри → Google Sheet база данни** сложи адреса на Apps Script. Така всички калкулации от всички устройства влизат в твоята таблица.
- Провери ставките — те се пазят в браузъра на всяко устройство, но ако Sheet-ът е свързан, важат общите.
- Изпрати линка на колегите. Не им трябва нищо друго освен браузър.

## При промяна на калкулатора

1. Редактирай `korekt-calculator.jsx`
2. `node korekt-calculator.test.mjs` — тестовете трябва да минават
3. `node build.mjs` — пресъздава `korekt-calculator.html`
4. Качи новия файл на същото място (в Netlify: влачиш пак папката)
