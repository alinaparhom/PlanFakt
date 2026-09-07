# Размещение «План / Факт» на сервере bimmax.pro

Приложение — Node.js, портал bimmax.pro — PHP. Вместе на одном хостинге они
не живут, поэтому «План / Факт» поднимается отдельным контейнером на том же
сервере и отдаётся наружу поддоменом `plan-fakt.bimmax.pro`.

Telegram Mini App работает только по HTTPS и только с адреса, который отвечает
`{"ok":true,"service":"plan-fakt"}` на `/api/health`. Адрес портала и
`bmsu4.php` для этого не подходят — приложение само их отклоняет
(`telegram-web-app.js`).

## 1. Поддомен

В DNS завести `plan-fakt.bimmax.pro` → тот же IP, что и `bimmax.pro`.

## 2. Секреты

```bash
cd /opt/plan-fakt        # каталог с клоном репозитория
cp .env.example .env
```

Заполнить в `.env`:

| Поле | Значение |
| --- | --- |
| `SESSION_SECRET` | длинная случайная строка, `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | токен бота «План/факт» от BotFather |
| `WEB_APP_URL` | `https://plan-fakt.bimmax.pro` |
| `BMSU_SITE_ORIGINS` | `https://bimmax.pro` |

Токен нужен именно здесь. В `.env` портала (`bimmax.pro/.env`, поле `bmsu4`)
он для этого пути не используется: тот файл читает только PHP-код портала, а
контейнер до него не достаёт.

## 3. Запуск контейнера

```bash
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:4173/api/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"plan-fakt","time":"..."}
```

Контейнер слушает только `127.0.0.1:4173`, данные лежат в постоянном томе
`plan-fakt-data` (`/app/data`).

## 4. nginx

```bash
cp deploy/nginx/plan-fakt.conf /etc/nginx/sites-available/plan-fakt.conf
ln -s /etc/nginx/sites-available/plan-fakt.conf /etc/nginx/sites-enabled/
```

Сертификат выпустить до включения HTTPS-блока:

```bash
certbot --nginx -d plan-fakt.bimmax.pro
```

`certbot --nginx` сам добавит проверочный маршрут; блок
`/.well-known/acme-challenge/` в конфиге нужен только при выпуске через
webroot (тогда каталог `/var/www/certbot` должен существовать).

Проверить и применить:

```bash
nginx -t && systemctl reload nginx
curl -s https://plan-fakt.bimmax.pro/api/health
```

Конфиг рассчитан на nginx 1.25.1+. На более старом убрать строку `http2 on;`
и писать `listen 443 ssl http2;`.

Лимит тела запроса поднят до 48 МБ: отчёт несёт фотографии, импорт ведомости —
файл Excel, а само приложение держит 25 МБ на запрос и 40 МБ на импорт. Таймаут
проксирования — 300 секунд: разбор `.xlsb` идёт через Python и на больших
ведомостях занимает минуты.

## 5. Бот

```bash
npm run telegram:configure
```

Команда сначала запрашивает `${WEB_APP_URL}/api/health` и меняет кнопку бота
только при верном ответе. Если у бота включён Main Mini App, его ссылку меняют
отдельно: `@BotFather` → `/myapps` → `Edit link`.

## 6. Первый вход

Посев создаёт одного администратора:

- логин `Пархоменко`, пароль `286`;
- привязанный Telegram ID — `16370894`.

**Проверьте Telegram ID.** В переписке ID Алины — `816370894`, в посеве
`16370894`, без ведущей восьмёрки. Если ID не совпадёт, при открытии из
Telegram приложение ответит «Telegram ID не найден» и предложит войти по
логину и паролю, а затем подтвердить привязку — это штатный путь, но проще
поправить ID в разделе «Администрирование» заранее.

Пароль `286` сменить сразу после первого входа.

## 7. Карточка на портале (необязательно)

Чтобы «План/факт» открывался и с главной страницы организации, портал должен
знать адрес приложения:

```html
<script>
  window.PLAN_FACT_APP_URL = 'https://plan-fakt.bimmax.pro/';
</script>
<script src="js/bmsu4.js"></script>
```

Адрес можно передать и атрибутом `data-app-url` у тега `script`, либо
`data-plan-fakt-url` у `body`.

## Проверено

На чистом клоне запуском `node server.js` (Node 22):

- сервер стартует, посев данных создаётся сам, `/api/health` отдаёт
  `{"ok":true,"service":"plan-fakt"}`;
- вход из Telegram: подписанный `initData` с привязанным ID открывает аккаунт,
  чужой ID даёт понятный отказ с предложением привязки, подделанная подпись —
  401 «Подпись Telegram недействительна».

Не проверялось в этой среде (нет nginx и не запущен docker-демон):

- сборка образа и `docker compose up` — `Dockerfile` прочитан, ставит Node 20,
  Python, `openpyxl` и `pyxlsb`, но не собирался;
- `nginx -t` для конфига. Прогоните его на сервере до `systemctl reload`.

Собственные тесты репозитория `npm run check` на чистом клоне не проходят:
`telegram_auth_flow_test` и `responsible_report_test` копируют каталог `data/`
и ждут там готовых пользователей, а `data/*.json` в `.gitignore` и создаются
посевом только при первом запуске. Посев (`seedStore`) заводит одного
администратора, роли «ответственный» в нём нет. На развёртывание это не влияет
— `Dockerfile` тесты не запускает.
