'use strict';

const { verifyPlanFactApp } = require('./telegram-web-app');

let stopped = false;
let pollingController = null;

async function startTelegramBot({ token, webAppUrl }) {
  const endpoint = method => `https://api.telegram.org/bot${token}/${method}`;
  let verifiedWebAppUrl = '';

  if (String(webAppUrl || '').trim()) {
    try {
      verifiedWebAppUrl = await verifyPlanFactApp(webAppUrl);
    } catch (error) {
      console.error(`Telegram Mini App не подключён: ${error.message}`);
    }
  } else {
    console.error('Telegram Mini App не подключён: WEB_APP_URL не задан. Адрес портала BIMMAX или 127.0.0.1 использовать нельзя.');
  }

  async function call(method, payload = {}, signal) {
    const response = await fetch(endpoint(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.description || `Telegram API: ${method}`);
    return data.result;
  }

  async function sendStart(chatId, firstName) {
    const hasApp = Boolean(verifiedWebAppUrl);
    const text = hasApp
      ? `Здравствуйте, ${firstName || 'коллега'}!\n\nОткройте «План / Факт», чтобы отправить ежедневный отчёт или проверить объект.`
      : `Здравствуйте, ${firstName || 'коллега'}!\n\nБот «План / Факт» подключён. Веб-приложение ожидает публикации на HTTPS-адресе. После настройки кнопка запуска появится здесь автоматически.`;
    const replyMarkup = hasApp ? { inline_keyboard: [[{ text: 'Открыть План / Факт', web_app: { url: verifiedWebAppUrl } }]] } : undefined;
    await call('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
  }

  async function handle(update) {
    const message = update.message;
    if (!message?.chat || message.chat.type !== 'private') return;
    const command = String(message.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start' || command === '/app') return sendStart(message.chat.id, message.from?.first_name);
    if (command === '/id') return call('sendMessage', { chat_id: message.chat.id, text: `Ваш Telegram ID: ${message.from?.id || message.chat.id}\nПередайте его администратору для привязки к объекту.` });
    if (command === '/help') return call('sendMessage', { chat_id: message.chat.id, text: 'Команды:\n/start — открыть приложение\n/app — открыть приложение\n/id — узнать Telegram ID\n/help — помощь' });
  }

  try {
    const bot = await call('getMe');
    await call('deleteWebhook', { drop_pending_updates: false });
    if (verifiedWebAppUrl) {
      await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'План / Факт', web_app: { url: verifiedWebAppUrl } } });
      console.log(`Telegram-бот @${bot.username} подключён, Mini App: ${verifiedWebAppUrl}`);
    } else {
      // Не сбрасываем уже настроенную кнопку Mini App при временно пустой
      // переменной окружения. Раньше каждый перезапуск возвращал её к командам.
      console.log(`Telegram-бот @${bot.username} подключён. WEB_APP_URL не задан; текущая кнопка меню сохранена.`);
    }

    let offset = 0;
    while (!stopped) {
      try {
        pollingController = new AbortController();
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, pollingController.signal);
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          try { await handle(update); } catch (error) { console.error(`Telegram: не удалось обработать сообщение: ${error.message}`); }
        }
      } catch (error) {
        if (stopped || error.name === 'AbortError') break;
        console.error(`Telegram: связь временно недоступна: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (error) {
    console.error(`Telegram-бот не запущен: ${error.message}`);
  }
}

function stopTelegramBot() {
  stopped = true;
  pollingController?.abort();
}

process.once('SIGINT', stopTelegramBot);
process.once('SIGTERM', stopTelegramBot);

module.exports = { startTelegramBot, stopTelegramBot };
