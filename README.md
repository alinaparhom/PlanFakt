# Telegram-бот и Mini App

В репозитории оставлено только подключение Telegram-бота к сайту и Mini App.

## Подключение

1. Создайте файл настроек:

   ```bash
   cp .env.example .env
   ```

2. Укажите токен бота и публичный HTTPS-адрес сайта:

   ```env
   TELEGRAM_BOT_TOKEN=токен_от_BotFather
   BOT_WEB_APP_URL=https://ваш-домен.example/
   PORT=3000
   ```

3. Запустите сервер:

   ```bash
   npm start
   ```

Бот автоматически добавит команды `/start`, `/app` и кнопку открытия сайта.

## Проверка

```bash
npm run check
curl http://localhost:3000/health
```
