'use strict';

const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, '..', 'telegram-bot.js');
const realFetch = globalThis.fetch;

/** Каждый сценарий получает свой экземпляр модуля: состояние бота — модульное. */
function loadBot() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function telegramMethod(url) {
  const match = String(url).match(/^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/);
  return match ? match[1] : '';
}

async function withFetch(handler, action) {
  globalThis.fetch = handler;
  try { return await action(); } finally { globalThis.fetch = realFetch; }
}

(async () => {
  // 1. Отозванный токен: бот сообщает причину и не уходит в бесконечные попытки.
  const revokedCalls = [];
  await withFetch(
    async url => {
      revokedCalls.push(telegramMethod(url));
      return { json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' }) };
    },
    async () => {
      const bot = loadBot();
      const errors = [];
      const originalError = console.error;
      console.error = message => errors.push(String(message));
      try {
        await bot.startTelegramBot({ token: '123456789:bad-token', webAppUrl: 'https://plan-fakt.example/' });
      } finally {
        console.error = originalError;
        bot.stopTelegramBot();
      }
      assert.deepEqual(revokedCalls, ['getMe'], 'После 401 повторять запросы бессмысленно');
      assert.ok(errors.some(text => /неверный TELEGRAM_BOT_TOKEN/.test(text)), 'Нужна понятная причина отказа');
    }
  );

  // 2. Приложение не опубликовано: /start работает и объясняет причину.
  const sent = [];
  let updatesServed = 0;
  await withFetch(
    async (url, options = {}) => {
      const method = telegramMethod(url);
      if (!method) {
        // Проверка адреса приложения: по адресу отвечает портал, а не «План / Факт».
        return { ok: true, json: async () => ({ ok: true, service: 'portal' }) };
      }
      const payload = options.body ? JSON.parse(options.body) : {};
      if (method === 'getMe') return { json: async () => ({ ok: true, result: { username: 'OtchetFact_bot', has_main_web_app: true } }) };
      if (method === 'deleteWebhook') return { json: async () => ({ ok: true, result: true }) };
      if (method === 'sendMessage') {
        sent.push(payload);
        return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }
      if (method === 'getUpdates') {
        updatesServed += 1;
        if (updatesServed > 1) return { json: async () => ({ ok: true, result: [] }) };
        return {
          json: async () => ({
            ok: true,
            result: [{ update_id: 10, message: { chat: { id: 55, type: 'private' }, from: { id: 55, first_name: 'Алина' }, text: '/start' } }]
          })
        };
      }
      return { json: async () => ({ ok: true, result: {} }) };
    },
    async () => {
      const bot = loadBot();
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalLog = console.log;
      console.error = () => {};
      console.warn = () => {};
      console.log = () => {};
      const running = bot.startTelegramBot({ token: '123456789:AAHvIkLY9LmRi3hPKR8nDfy2Dv11wJWqq1k', webAppUrl: 'https://plan-fakt.example/' });
      for (let attempt = 0; attempt < 100 && !sent.length; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
      bot.stopTelegramBot();
      await running;
      console.error = originalError;
      console.warn = originalWarn;
      console.log = originalLog;

      assert.equal(sent.length, 1, 'Команда /start осталась без ответа');
      assert.equal(sent[0].reply_markup, undefined, 'Кнопку Mini App нельзя показывать без рабочего приложения');
      assert.match(sent[0].text, /не ведёт на сервер «План \/ Факт»/, 'Пользователь должен видеть причину');
    }
  );

  console.log('Бот объясняет отказ по токену и отвечает на /start без подключённого приложения.');
})().catch(error => {
  globalThis.fetch = realFetch;
  console.error(error);
  process.exit(1);
});
