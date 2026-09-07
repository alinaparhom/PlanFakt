'use strict';

const { verifyPlanFactApp } = require('./telegram-web-app');

const APP_RECHECK_MS = 60000;      // повторная проверка адреса приложения
const NETWORK_RETRY_MS = 5000;     // пауза после сетевой ошибки
const CONFLICT_RETRY_MS = 30000;   // пауза при конфликте getUpdates (409)
const START_RETRY_MS = 15000;      // пауза перед повторным подключением бота

let stopped = false;
let pollingController = null;
let appRecheckTimer = null;

// Текущее состояние подключения. Его же показывает команда /diag,
// потому что логи сервера администратору обычно недоступны.
const state = {
  username: '',
  webAppUrl: '',
  webAppError: '',
  mainWebApp: false,
  menuButton: ''
};

/** Человеческая причина отказа Telegram API вместо кода ошибки. */
function explain(error) {
  const code = error && error.telegramCode;
  if (code === 401 || code === 404) {
    return 'неверный TELEGRAM_BOT_TOKEN. Проверьте .env и токен в @BotFather → /mybots → API Token';
  }
  if (code === 409) {
    return 'бот уже принимает сообщения в другом месте. Остановите второй запущенный server.js или снимите webhook';
  }
  if (error && error.name === 'TypeError') {
    return `нет доступа к api.telegram.org: ${error.message}`;
  }
  return (error && error.message) || 'неизвестная ошибка';
}

async function startTelegramBot({ token, webAppUrl }) {
  const endpoint = method => `https://api.telegram.org/bot${token}/${method}`;
  const configuredUrl = String(webAppUrl || '').trim();

  async function call(method, payload = {}, signal) {
    const response = await fetch(endpoint(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`ответ не похож на Telegram API (HTTP ${response.status}) — запрос, вероятно, перехватил прокси или firewall`);
    }
    if (!data.ok) {
      throw Object.assign(new Error(data.description || `Telegram API: ${method}`), { telegramCode: data.error_code });
    }
    return data.result;
  }

  /**
   * Проверяем адрес приложения и подключаем кнопку меню.
   * Приложение и reverse proxy часто поднимаются позже бота, поэтому проверка
   * повторяется по таймеру: перезапускать сервер вручную больше не нужно.
   */
  async function connectWebApp() {
    if (!configuredUrl) {
      state.webAppError = 'WEB_APP_URL не задан. Нужен публичный HTTPS-адрес приложения, адрес портала и 127.0.0.1 не подходят';
      return false;
    }
    let verified;
    try {
      verified = await verifyPlanFactApp(configuredUrl);
    } catch (error) {
      state.webAppError = error.message;
      state.webAppUrl = '';
      return false;
    }
    state.webAppError = '';
    if (state.webAppUrl === verified && state.menuButton === 'web_app') return true;

    try {
      await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'План / Факт', web_app: { url: verified } } });
      const actual = await call('getChatMenuButton');
      state.menuButton = actual.type || '';
      if (actual.type !== 'web_app' || (actual.web_app && actual.web_app.url) !== verified) {
        state.webAppError = 'Telegram не подтвердил новый адрес кнопки Mini App';
        return false;
      }
    } catch (error) {
      state.webAppError = `не удалось записать кнопку Mini App: ${explain(error)}`;
      return false;
    }

    state.webAppUrl = verified;
    console.log(`Telegram: Mini App подключён — ${verified}`);
    if (state.mainWebApp) {
      console.warn('Telegram: у бота включён Main Mini App. Кнопку «Открыть приложение» и ссылки t.me/…?startapp= Telegram берёт именно из него, поэтому его адрес нужно заменить вручную: @BotFather → /myapps → выберите приложение → Edit Web App → Edit Link.');
    }
    return true;
  }

  function statusLines() {
    const lines = [`Бот: @${state.username || '—'}`];
    if (state.webAppUrl) lines.push(`Приложение: ${state.webAppUrl} — подключено`);
    else lines.push(`Приложение: не подключено (${state.webAppError || 'причина неизвестна'})`);
    if (state.mainWebApp) lines.push('Main Mini App: включён в BotFather — его ссылку меняют там же (/myapps → Edit Link)');
    return lines;
  }

  async function sendStart(chatId, firstName) {
    const hasApp = Boolean(state.webAppUrl);
    const text = hasApp
      ? `Здравствуйте, ${firstName || 'коллега'}!\n\nОткройте «План / Факт», чтобы отправить ежедневный отчёт или проверить объект.`
      : `Здравствуйте, ${firstName || 'коллега'}!\n\nБот «План / Факт» подключён, а веб-приложение пока недоступно.\n\n${state.webAppError}\n\nПередайте это сообщение администратору портала.`;
    const replyMarkup = hasApp
      ? { inline_keyboard: [[{ text: 'Открыть План / Факт', web_app: { url: state.webAppUrl } }]] }
      : undefined;
    await call('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
  }

  async function handle(update) {
    const message = update.message;
    if (!message || !message.chat || message.chat.type !== 'private') return;
    const command = String(message.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start' || command === '/app') return sendStart(message.chat.id, message.from && message.from.first_name);
    if (command === '/id') return call('sendMessage', { chat_id: message.chat.id, text: `Ваш Telegram ID: ${(message.from && message.from.id) || message.chat.id}\nПередайте его администратору для привязки к объекту.` });
    if (command === '/diag') return call('sendMessage', { chat_id: message.chat.id, text: `Диагностика подключения\n\n${statusLines().join('\n')}` });
    if (command === '/help') return call('sendMessage', { chat_id: message.chat.id, text: 'Команды:\n/start — открыть приложение\n/app — открыть приложение\n/id — узнать Telegram ID\n/diag — проверить подключение\n/help — помощь' });
  }

  /** Подключение к Telegram с повторами: сеть и DNS могут подняться позже сервера. */
  async function connect() {
    while (!stopped) {
      try {
        const bot = await call('getMe');
        state.username = bot.username || '';
        state.mainWebApp = Boolean(bot.has_main_web_app);
        await call('deleteWebhook', { drop_pending_updates: false });
        return true;
      } catch (error) {
        console.error(`Telegram-бот не запущен: ${explain(error)}`);
        if (error && (error.telegramCode === 401 || error.telegramCode === 404)) return false;
        await new Promise(resolve => setTimeout(resolve, START_RETRY_MS));
      }
    }
    return false;
  }

  if (!await connect()) return;
  console.log(`Telegram-бот @${state.username} подключён.`);

  // Кнопку меню не сбрасываем при временно пустом WEB_APP_URL: раньше каждый
  // перезапуск возвращал её к списку команд.
  await connectWebApp();
  if (!state.webAppUrl) console.error(`Telegram Mini App не подключён: ${state.webAppError}`);
  if (configuredUrl) {
    appRecheckTimer = setInterval(() => {
      if (!stopped && !state.webAppUrl) connectWebApp().catch(() => {});
    }, APP_RECHECK_MS);
    if (appRecheckTimer.unref) appRecheckTimer.unref();
  }

  let offset = 0;
  while (!stopped) {
    try {
      pollingController = new AbortController();
      const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, pollingController.signal);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try { await handle(update); } catch (error) { console.error(`Telegram: не удалось обработать сообщение: ${explain(error)}`); }
      }
    } catch (error) {
      if (stopped || error.name === 'AbortError') break;
      console.error(`Telegram: связь временно недоступна: ${explain(error)}`);
      await new Promise(resolve => setTimeout(resolve, error.telegramCode === 409 ? CONFLICT_RETRY_MS : NETWORK_RETRY_MS));
    }
    // Возвращаем управление событийному циклу: иначе мгновенные ответы
    // Telegram не дают отработать таймерам и сигналу остановки.
    await new Promise(resolve => setImmediate(resolve));
  }
}

function stopTelegramBot() {
  stopped = true;
  if (appRecheckTimer) clearInterval(appRecheckTimer);
  appRecheckTimer = null;
  if (pollingController) pollingController.abort();
}

process.once('SIGINT', stopTelegramBot);
process.once('SIGTERM', stopTelegramBot);

module.exports = { startTelegramBot, stopTelegramBot };
