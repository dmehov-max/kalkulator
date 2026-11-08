# vendor/ — библиотеки с фиксирана версия

Сайтът не тегли JavaScript от чужди CDN при всяко отваряне (unpkg, cdn.tailwindcss.com,
jsdelivr). Ако някой от тях бъде пробит или върне друга версия, кодът му би се изпълнил
с достъп до сесията на влезлия колега. Затова копията са тук и се сервират от същия адрес.

| Файл | Източник | Версия |
|---|---|---|
| `react.production.min.js` | npm `react` → `umd/` | 18.3.1 |
| `react-dom.production.min.js` | npm `react-dom` → `umd/` | 18.3.1 |
| `livekit-client.umd.js` | npm `livekit-client` → `dist/` (без реда за .map) | 2.22.4 |
| `tailwind-play-3.4.17.js` | https://cdn.tailwindcss.com/3.4.17 | 3.4.17 |

`checksums.json` пази SHA-256 на всеки файл. `node build.mjs` и `node security.test.mjs`
спират с грешка, ако някой файл е различен. При съзнателно обновяване на версия:
изтегли новия файл, провери го, обнови таблицата и хеша в `checksums.json`.
